/**
 * dq-tracker-push / src/index.js
 *
 * Backend MIỄN PHÍ (Cloudflare Workers + KV) để bắn thông báo cảnh báo giá
 * NGAY CẢ KHI app/trình duyệt trên máy bạn đã tắt hẳn - vì phần "kiểm tra
 * giá + quyết định báo hay không" giờ chạy trên server (Cron Trigger), không
 * còn phụ thuộc vào việc tab có đang mở hay không như AlertsModule cũ.
 *
 * ĐÃ BỎ phần breakout (server-side BUY/SELL signal) để giảm số lượt đọc/ghi
 * Workers KV - tài khoản đã chạm 90% giới hạn free tier. Nếu vẫn còn chạm
 * giới hạn sau khi bỏ breakout, khả năng cao là do phía client gọi
 * /api/alerts quá thường xuyên (mỗi lần gọi tốn 1 read + có thể 1 write) -
 * nên kiểm tra lại tần suất client đồng bộ.
 *
 * (đã thêm lại) phần breakout server-side (checkSignalsAndNotify) - xem
 * ghi chú "FIX (đợt fix này)" bên dưới về lỗi symbol không map được sang
 * Yahoo Finance ticker khiến tính năng này trước đó không hoạt động.
 *
 * FIX (đợt fix mới nhất - giảm tải Workers KV, đã chạm 50% giới hạn/ngày):
 *   1) checkSignalsAndNotify() trước đây gửi noti MỖI KHI có nến mới đóng
 *      thoả điều kiện breakout, kể cả khi vẫn CÙNG CHIỀU với tín hiệu đã báo
 *      trước đó (vd đang BUY, nến sau vẫn breakout lên -> báo BUY tiếp) ->
 *      vừa spam thông báo, vừa ghi KV liên tục. Giờ chỉ ghi KV + gửi push khi
 *      CHIỀU tín hiệu thực sự đảo (BUY -> SELL hoặc ngược lại).
 *   2) Cron trước đây chạy 2 lần/phút (cách nhau 30s) cho CẢ alerts giá lẫn
 *      signals BUY/SELL -> nhân đôi số lượt đọc/ghi KV mỗi ngày. Phần
 *      signals BUY/SELL không cần độ trễ 30s (khung nến ngắn nhất theo dõi
 *      là 5 phút) nên giờ chỉ chạy 1 lần/phút. Alerts giá vẫn giữ 2 lần/phút
 *      như cũ vì cần phản ứng nhanh với biến động giá.
 *
 * 3 endpoint HTTP:
 *   GET  /api/vapid-public-key  -> trả VAPID public key cho client dùng khi
 *                                  subscribe PushManager.
 *   POST /api/subscribe         -> lưu Push Subscription của 1 thiết bị.
 *   POST /api/alerts            -> đồng bộ toàn bộ danh sách cảnh báo giá
 *                                  hiện tại của 1 thiết bị (ghi đè).
 *   POST /api/signals           -> đồng bộ toàn bộ danh sách tín hiệu
 *                                  BUY/SELL cần theo dõi của 1 thiết bị.
 *
 * 1 cron handler (scheduled), cấu hình chạy MỖI PHÚT trong wrangler.toml:
 *   - Gom toàn bộ symbol đang cần theo dõi từ MỌI thiết bị (loại trùng).
 *   - Gọi 1 lần API CoinGecko để lấy giá hiện tại của các symbol cần theo dõi.
 *   - Với mỗi cảnh báo CHƯA triggered: so "phía" hiện tại (trên/dưới mức
 *     cảnh báo) với "phía" đã lưu lần trước - đổi phía = vừa "vượt qua" mức
 *     cảnh báo -> gửi Web Push + đánh dấu triggered (giống hệt logic
 *     checkPrice() trong alerts.js gốc, chỉ khác là chạy trên server).
 *   - Lần đầu tiên thấy 1 cảnh báo (chưa có "side" lưu trước đó) chỉ ghi
 *     nhận baseline, KHÔNG báo ngay - tránh báo nhầm ngay khi vừa tạo cảnh
 *     báo lúc giá đã ở phía đó từ trước.
 *   - Với signals BUY/SELL: chỉ báo khi CHIỀU tín hiệu đảo so với lần báo
 *     trước (xem ghi chú FIX ở trên) - không báo liên tục khi vẫn cùng chiều.
 *
 * LƯU Ý VỀ GIỚI HẠN FREE TIER CỦA WORKERS KV:
 *   - Free tier: ~100.000 lượt đọc/ngày, ~1.000 lượt ghi/ngày.
 *   - Thiết kế ở đây CHỈ GHI khi có thay đổi thật (alert vừa được tạo lần
 *     đầu, vừa triggered, hoặc signal vừa đảo chiều) - không ghi mỗi tick.
 *   - checkAlertsAndNotify chạy 2 lần/phút (2880 lần/ngày), checkSignalsAndNotify
 *     chỉ chạy 1 lần/phút (1440 lần/ngày) để giảm tổng số operation.
 */

import { buildPushPayload } from '@block65/webcrypto-web-push';

const ALERTS_KEY = 'alerts_v1'; // { [deviceId]: [{id, symbol, price, side, triggered}] }
const SIGNALS_KEY = 'signals_v1'; // { [deviceId]: [{paneId, symbol, timeframe, higherTF, lookbackCandles, lastNotifiedTime, lastDirection}] }
const SUBS_KEY = 'subs_v1'; // { [deviceId]: PushSubscriptionJSON }

function withCors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}

async function readJSON(kv, key, fallback) {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

async function writeJSON(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === '/api/vapid-public-key' && request.method === 'GET') {
      return withCors(Response.json({ publicKey: env.VAPID_PUBLIC_KEY }));
    }

    if (url.pathname === '/api/subscribe' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return withCors(new Response('JSON không hợp lệ', { status: 400 }));
      }
      const { deviceId, subscription } = body || {};
      if (!deviceId || !subscription || !subscription.endpoint) {
        return withCors(new Response('Thiếu deviceId hoặc subscription', { status: 400 }));
      }

      const subs = await readJSON(env.TRACKER_KV, SUBS_KEY, {});
      subs[deviceId] = subscription;
      await writeJSON(env.TRACKER_KV, SUBS_KEY, subs);
      return withCors(Response.json({ ok: true }));
    }

    if (url.pathname === '/api/alerts' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return withCors(new Response('JSON không hợp lệ', { status: 400 }));
      }
      const { deviceId, alerts } = body || {};
      if (!deviceId || !Array.isArray(alerts)) {
        return withCors(new Response('Payload không hợp lệ', { status: 400 }));
      }

      const allAlerts = await readJSON(env.TRACKER_KV, ALERTS_KEY, {});
      const existing = allAlerts[deviceId] || [];

      // Giữ lại 'side'/'triggered' đã tính của các cảnh báo còn tồn tại (so
      // theo id) - chỉ alert THỰC SỰ MỚI mới có side=null (chưa có baseline).
      const merged = alerts
        .filter((a) => a && a.id && a.symbol && typeof a.price === 'number')
        .map((a) => {
          const prev = existing.find((e) => e.id === a.id);
          return {
            id: a.id,
            symbol: a.symbol,
            price: a.price,
            side: prev ? prev.side : null,
            triggered: prev ? !!prev.triggered : false,
          };
        });

      if (merged.length > 0) {
        allAlerts[deviceId] = merged;
      } else {
        delete allAlerts[deviceId];
      }
      await writeJSON(env.TRACKER_KV, ALERTS_KEY, allAlerts);
      return withCors(Response.json({ ok: true, count: merged.length }));
    }

    if (url.pathname === '/api/signals' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return withCors(new Response('JSON không hợp lệ', { status: 400 }));
      }
      const { deviceId, signals } = body || {};
      if (!deviceId || !Array.isArray(signals)) {
        return withCors(new Response('Payload không hợp lệ', { status: 400 }));
      }

      const allSignals = await readJSON(env.TRACKER_KV, SIGNALS_KEY, {});
      const existing = allSignals[deviceId] || [];

      // Keep tracking information for existing signals to prevent duplicates
      const merged = signals
        .filter((s) => s && s.paneId && s.symbol && s.timeframe && s.higherTF)
        .map((s) => {
          const prev = existing.find((e) => e.paneId === s.paneId && e.symbol === s.symbol && e.timeframe === s.timeframe);
          return {
            paneId: s.paneId,
            symbol: s.symbol,
            timeframe: s.timeframe,
            higherTF: s.higherTF,
            lookbackCandles: s.lookbackCandles || 2,
            lastNotifiedTime: prev ? prev.lastNotifiedTime : null,
            lastDirection: prev ? prev.lastDirection : null,
          };
        });

      if (merged.length > 0) {
        allSignals[deviceId] = merged;
      } else {
        delete allSignals[deviceId];
      }
      await writeJSON(env.TRACKER_KV, SIGNALS_KEY, allSignals);
      return withCors(Response.json({ ok: true, count: merged.length }));
    }

    return withCors(new Response('Not found', { status: 404 }));
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCronTick(env));
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cloudflare Cron Trigger tối thiểu là 1 phút (không có field giây).
 *
 * - checkAlertsAndNotify (cảnh báo mức giá) vẫn chạy 2 lần/phút (cách nhau
 *   30s bằng setTimeout) để phản ứng nhanh với biến động giá - thời gian
 *   "ngủ" chờ này chỉ tính vào wall time (giới hạn 15 phút cho scheduled
 *   handler), KHÔNG tính vào CPU time.
 * - checkSignalsAndNotify (tín hiệu BUY/SELL breakout) CHỈ chạy 1 lần/phút
 *   vì: (1) khung nến ngắn nhất theo dõi là 5 phút nên không cần độ trễ
 *   30s, (2) mỗi lần chạy đều gọi Yahoo Finance + có thể ghi KV, nên chạy
 *   2 lần/phút sẽ nhân đôi tải không cần thiết - đây là nguyên nhân chính
 *   khiến tài khoản chạm % giới hạn Workers KV free tier.
 */
async function runCronTick(env) {
  await Promise.allSettled([checkAlertsAndNotify(env), checkSignalsAndNotify(env)]);
  await sleep(30000);
  await checkAlertsAndNotify(env);
}

async function checkAlertsAndNotify(env) {
  const allAlerts = await readJSON(env.TRACKER_KV, ALERTS_KEY, {});
  const subs = await readJSON(env.TRACKER_KV, SUBS_KEY, {});

  console.log(
    `[cron] devices=${Object.keys(allAlerts).length} subs=${Object.keys(subs).length}`
  );

  const symbolSet = new Set();
  Object.values(allAlerts).forEach((list) => {
    (list || []).forEach((a) => {
      if (!a.triggered) symbolSet.add(a.symbol);
    });
  });
  if (symbolSet.size === 0) {
    console.log('[cron] không có cảnh báo nào đang chờ - bỏ qua.');
    return;
  }

  const prices = await fetchCoinGeckoPrices(env, [...symbolSet]);
  if (!prices) {
    console.log('[cron] lỗi lấy giá từ CoinGecko.');
    return;
  }
  console.log('[cron] giá hiện tại:', JSON.stringify(prices));

  let alertsChanged = false;
  let subsChanged = false;

  for (const deviceId of Object.keys(allAlerts)) {
    const list = allAlerts[deviceId] || [];
    const subscription = subs[deviceId];

    for (const alert of list) {
      if (alert.triggered) continue;
      const price = prices[alert.symbol];
      if (price === undefined || Number.isNaN(price)) continue;

      const side = price >= alert.price ? 'above' : 'below';

      if (alert.side === null || alert.side === undefined) {
        // Lần đầu thấy cảnh báo này kể từ khi đồng bộ - chỉ lưu baseline.
        console.log(
          `[cron] baseline mới cho ${deviceId}/${alert.symbol}@${alert.price}: giá hiện tại ${price} (${side})`
        );
        alert.side = side;
        alertsChanged = true;
        continue;
      }

      if (alert.side !== side) {
        console.log(
          `[cron] KÍCH HOẠT ${deviceId}/${alert.symbol}@${alert.price}: ${alert.side} -> ${side}, giá=${price}, có subscription=${!!subscription}`
        );
        alert.side = side;
        alert.triggered = true;
        alertsChanged = true;

        if (subscription) {
          const stillValid = await sendPush(env, subscription, {
            title: '🔔 Cảnh báo giá',
            body: `${alert.symbol} đã chạm mức ${price}`,
          });
          console.log(`[cron] gửi push cho ${deviceId} - subscription còn hợp lệ: ${stillValid}`);
          if (!stillValid) {
            delete subs[deviceId];
            subsChanged = true;
          }
        }
      }
    }
  }

  if (alertsChanged) await writeJSON(env.TRACKER_KV, ALERTS_KEY, allAlerts);
  if (subsChanged) await writeJSON(env.TRACKER_KV, SUBS_KEY, subs);
}

/**
 * Bảng ánh xạ base symbol (dạng sàn, vd "BTC") -> CoinGecko coin id (vd
 * "bitcoin"). CoinGecko không nhận thẳng symbol sàn vì 1 symbol có thể
 * trùng giữa nhiều coin khác nhau - phải quy về đúng 1 "id" duy nhất.
 * Danh sách dưới đây phủ các coin phổ biến nhất; nếu bạn theo dõi 1 symbol
 * không có trong bảng, cron sẽ log cảnh báo "không map được coingecko id"
 * cho symbol đó - báo lại để mình bổ sung thêm.
 */
const SYMBOL_TO_COINGECKO_ID = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', TON: 'the-open-network',
  TRX: 'tron', DOT: 'polkadot', MATIC: 'matic-network', POL: 'polygon-ecosystem-token',
  LINK: 'chainlink', LTC: 'litecoin', BCH: 'bitcoin-cash', AVAX: 'avalanche-2',
  ATOM: 'cosmos', UNI: 'uniswap', NEAR: 'near', APT: 'aptos', ARB: 'arbitrum',
  OP: 'optimism', SUI: 'sui', SEI: 'sei-network', INJ: 'injective-protocol',
  FIL: 'filecoin', ETC: 'ethereum-classic', XLM: 'stellar', ICP: 'internet-computer',
  HBAR: 'hedera-hashgraph', VET: 'vechain', ALGO: 'algorand', AAVE: 'aave',
  MKR: 'maker', SAND: 'the-sandbox', MANA: 'decentraland', AXS: 'axie-infinity',
  FTM: 'fantom', RUNE: 'thorchain', GRT: 'the-graph', EGLD: 'multiversx',
  THETA: 'theta-token', XTZ: 'tezos', EOS: 'eos', KAS: 'kaspa',
  PEPE: 'pepe', SHIB: 'shiba-inu', WIF: 'dogwifcoin', BONK: 'bonk',
  FLOKI: 'floki', USDT: 'tether', USDC: 'usd-coin', DAI: 'dai',
};

// Danh sách quote asset thường gặp, xếp dài -> ngắn để tách đúng base/quote
// từ 1 symbol dạng dính liền như "BTCUSDT" (không có dấu phân cách).
const QUOTE_ASSETS = [
  'FDUSD', 'USDT', 'USDC', 'TUSD', 'BUSD', 'DAI',
  'USD', 'EUR', 'GBP', 'TRY', 'BRL',
  'BTC', 'ETH', 'BNB',
];

function splitSymbol(symbol) {
  for (const quote of QUOTE_ASSETS) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return { base: symbol.slice(0, -quote.length), quote };
    }
  }
  return null;
}

// CoinGecko KHÔNG nhận USDT/USDC/... làm vs_currency (chỉ hỗ trợ usd, eur,
// và vài crypto như btc/eth/bnb) - coi các stablecoin này tương đương USD.
const STABLECOIN_AS_USD = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD', 'DAI']);

function vsCurrencyFor(quote) {
  return STABLECOIN_AS_USD.has(quote) ? 'usd' : quote.toLowerCase();
}

/**
 * Lấy giá hiện tại của các symbol cần theo dõi, dùng CoinGecko Public API
 * (keyless, miễn phí, không cần đăng ký) thay vì sàn giao dịch hay
 * CryptoCompare (CryptoCompare đã đóng cửa tier miễn phí không key từ
 * 21/5/2026). CoinGecko không phải sàn giao dịch nên không áp geo-block
 * theo IP datacenter như Binance/Bybit.
 *
 * CoinGecko dùng "coin id" (vd "bitcoin") thay vì symbol sàn (vd "BTC"),
 * nên cần tách symbol rồi tra qua SYMBOL_TO_COINGECKO_ID trước khi gọi -
 * phía client vẫn gửi/lưu symbol dạng "BTCUSDT" như cũ, không cần đổi gì.
 */
async function fetchCoinGeckoPrices(env, symbols) {
  const pairs = symbols
    .map((symbol) => ({ symbol, parsed: splitSymbol(symbol) }))
    .filter((p) => p.parsed !== null)
    .map((p) => ({ ...p, id: SYMBOL_TO_COINGECKO_ID[p.parsed.base] }));

  const unmapped = pairs.filter((p) => !p.id).map((p) => p.symbol);
  if (unmapped.length > 0) {
    console.log('[cron] không map được coingecko id cho symbol:', unmapped.join(', '));
  }

  const mapped = pairs.filter((p) => p.id);
  if (mapped.length === 0) {
    console.log('[cron] không có symbol nào map được sang CoinGecko id.');
    return {};
  }

  const ids = [...new Set(mapped.map((p) => p.id))];
  const vsCurrencies = [...new Set(mapped.map((p) => vsCurrencyFor(p.parsed.quote)))];
  const targetUrl =
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}` +
    `&vs_currencies=${encodeURIComponent(vsCurrencies.join(','))}`;

  let res;
  try {
    res = await fetch(targetUrl, {
      headers: {
        // CoinGecko trả 403 nếu request không có User-Agent mô tả rõ ràng.
        'User-Agent': 'dq-tracker-push/1.0 (personal price alert worker)',
        Accept: 'application/json',
        // Có key riêng thì được quota 30 call/phút thay vì bị chia sẻ theo
        // IP datacenter (rất dễ bị 429 vì nhiều Worker khác dùng chung IP).
        // Nếu chưa set secret COINGECKO_API_KEY thì header này bị bỏ qua,
        // request vẫn chạy ở chế độ keyless như cũ.
        ...(env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {}),
      },
    });
  } catch (err) {
    console.log('[cron] fetch CoinGecko ném lỗi (network):', err.message);
    return null;
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '(không đọc được body)');
    console.log(`[cron] CoinGecko trả về lỗi HTTP ${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`);
    if (res.status === 429 && !env.COINGECKO_API_KEY) {
      console.log('[cron] gợi ý: set secret COINGECKO_API_KEY (free Demo key tại coingecko.com/en/api/pricing) để có quota riêng, tránh bị chia sẻ theo IP.');
    }
    return null;
  }
  const data = await res.json();

  const map = {};
  mapped.forEach(({ symbol, parsed, id }) => {
    const price = data[id] && data[id][vsCurrencyFor(parsed.quote)];
    if (typeof price === 'number') {
      map[symbol] = price;
    }
  });
  return map;
}

async function sendPush(env, subscription, { title, body }) {
  try {
    const vapid = {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    };
    const message = {
      data: JSON.stringify({ title, body }),
      options: { ttl: 60 },
    };
    const payload = await buildPushPayload(message, subscription, vapid);
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: payload.headers,
      body: payload.body,
    });
    return res.status !== 404 && res.status !== 410;
  } catch (err) {
    console.error('Lỗi khi gửi push:', err);
    return true; // lỗi tạm thời (mạng...) - không vội xoá subscription
  }
}

const TIMEFRAME_SECS = {
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '12h': 43200,
  '1d': 86400,
  '3d': 259200,
};

const INTERVAL_MAP = {
  '1m': { interval: '1m', range: '5d', secs: 60, multiplier: 0 },
  '5m': { interval: '5m', range: '30d', secs: 300, multiplier: 0 },
  '15m': { interval: '15m', range: '30d', secs: 900, multiplier: 0 },
  '30m': { interval: '30m', range: '30d', secs: 1800, multiplier: 0 },
  '1h': { interval: '60m', range: '60d', secs: 3600, multiplier: 0 },
  '2h': { interval: '60m', range: '60d', secs: 3600, multiplier: 7200 },
  '4h': { interval: '60m', range: '60d', secs: 3600, multiplier: 14400 },
  '12h': { interval: '60m', range: '60d', secs: 3600, multiplier: 43200 },
  '1d': { interval: '1d', range: '1y', secs: 86400, multiplier: 0 },
  '3d': { interval: '1d', range: '2y', secs: 86400, multiplier: 259200 },
};

/**
 * FIX (đợt fix trước): trước đây fetchYahooKlines() được gọi thẳng với
 * symbol dạng sàn (vd "BTCUSDT", "ETHUSDT") - Yahoo Finance KHÔNG hiểu
 * format này (ticker crypto trên Yahoo có dạng "BTC-USD", "ETH-USD"...),
 * nên request luôn thất bại/rỗng và checkSignalsAndNotify() luôn `continue`
 * ngay ở bước kiểm tra `!entryCandles` mà KHÔNG log lỗi gì -> tính năng
 * cảnh báo tín hiệu BUY/SELL im lặng không bao giờ hoạt động.
 *
 * Hàm này tái dùng splitSymbol()/STABLECOIN_AS_USD đã có sẵn (dùng chung
 * với phần CoinGecko) để tách base/quote rồi ghép lại thành ticker Yahoo
 * đúng chuẩn "BASE-QUOTE" (coi mọi stablecoin quy về USD, giống cách xử lý
 * bên fetchCoinGeckoPrices).
 *
 * Trả về null nếu không tách được symbol (để phân biệt với lỗi mạng/API).
 */
function toYahooTicker(symbol) {
  const parsed = splitSymbol(symbol);
  if (!parsed) return null;
  const quote = STABLECOIN_AS_USD.has(parsed.quote) ? 'USD' : parsed.quote;
  return `${parsed.base}-${quote}`;
}

function aggregateCandles(candles, multiplierInSeconds) {
  if (!multiplierInSeconds || multiplierInSeconds <= 1) return candles;
  const groups = new Map();
  for (const c of candles) {
    const bucket = Math.floor(c.time / multiplierInSeconds) * multiplierInSeconds;
    if (!groups.has(bucket)) {
      groups.set(bucket, {
        time: bucket,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      });
    } else {
      const g = groups.get(bucket);
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.volume += c.volume;
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.time - b.time);
}

/**
 * `symbol` truyền vào đây PHẢI là ticker đúng chuẩn Yahoo Finance (vd
 * "BTC-USD"), không phải symbol dạng sàn ("BTCUSDT") - xem toYahooTicker().
 * Thêm log lỗi rõ ràng ở mọi nhánh thất bại (khác bản gốc chỉ trả về null
 * lặng lẽ) để dễ debug qua `wrangler tail` khi tính năng tín hiệu không
 * hoạt động như mong đợi.
 */
async function fetchYahooKlines(symbol, timeframe) {
  const mapping = INTERVAL_MAP[timeframe];
  if (!mapping) {
    console.log(`[signals-cron] timeframe không hợp lệ: ${timeframe}`);
    return null;
  }
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${mapping.interval}&range=${mapping.range}`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
  } catch (err) {
    console.log(`[signals-cron] fetch Yahoo ném lỗi (network) cho ${symbol} (${timeframe}):`, err.message);
    return null;
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '(không đọc được body)');
    console.log(`[signals-cron] Yahoo trả về lỗi HTTP ${response.status} ${response.statusText} cho ${symbol} (${timeframe}): ${bodyText.slice(0, 300)}`);
    return null;
  }

  const data = await response.json();
  const result = data.chart?.result?.[0];
  if (!result) {
    const errDesc = data.chart?.error?.description || '(không có mô tả lỗi)';
    console.log(`[signals-cron] Yahoo không trả về result cho ${symbol} (${timeframe}): ${errDesc}`);
    return null;
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators.quote[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  let candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (opens[i] === null || closes[i] === null || Number.isNaN(opens[i]) || Number.isNaN(closes[i])) continue;
    candles.push({
      time: timestamps[i],
      open: Number(opens[i]),
      high: Number(highs[i] ?? opens[i]),
      low: Number(lows[i] ?? closes[i]),
      close: Number(closes[i]),
      volume: Number(volumes[i] ?? 0),
    });
  }

  if (candles.length === 0) {
    console.log(`[signals-cron] Yahoo trả về 0 nến hợp lệ cho ${symbol} (${timeframe}).`);
  }

  if (mapping.multiplier > 0) {
    candles = aggregateCandles(candles, mapping.multiplier);
  }
  return candles;
}

async function checkSignalsAndNotify(env) {
  const allSignals = await readJSON(env.TRACKER_KV, SIGNALS_KEY, {});
  const subs = await readJSON(env.TRACKER_KV, SUBS_KEY, {});

  if (Object.keys(allSignals).length === 0) {
    return;
  }

  let signalsChanged = false;
  let subsChanged = false;

  // Cache Yahoo Finance fetch requests so we only fetch once per symbol + timeframe in the same run
  const candleCache = new Map();
  async function getCandlesCached(symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;
    if (candleCache.has(key)) {
      return candleCache.get(key);
    }
    const promise = fetchYahooKlines(symbol, timeframe);
    candleCache.set(key, promise);
    return promise;
  }

  for (const deviceId of Object.keys(allSignals)) {
    const list = allSignals[deviceId] || [];
    const subscription = subs[deviceId];

    for (const signal of list) {
      const { symbol, timeframe, higherTF, lookbackCandles } = signal;

      // FIX: symbol lưu trong signal là dạng sàn (vd "BTCUSDT") - phải đổi
      // sang ticker Yahoo (vd "BTC-USD") trước khi fetch, nếu không request
      // sẽ luôn thất bại.
      const yahooSymbol = toYahooTicker(symbol);
      if (!yahooSymbol) {
        console.log(`[signals-cron] không tách được base/quote cho symbol: ${symbol} - bỏ qua.`);
        continue;
      }

      const entryCandles = await getCandlesCached(yahooSymbol, timeframe);
      const higherCandles = await getCandlesCached(yahooSymbol, higherTF);

      if (!entryCandles || entryCandles.length < 2 || !higherCandles || higherCandles.length < lookbackCandles) {
        console.log(
          `[signals-cron] thiếu dữ liệu nến cho ${deviceId}/${symbol} (${yahooSymbol}) ` +
          `entry=${timeframe}:${entryCandles ? entryCandles.length : 'null'} ` +
          `higher=${higherTF}:${higherCandles ? higherCandles.length : 'null'} (cần >= ${lookbackCandles}) - bỏ qua.`
        );
        continue;
      }

      const entryClosed = entryCandles.slice(0, -1);
      if (entryClosed.length === 0) continue;
      const lastEntry = entryClosed[entryClosed.length - 1];

      const htfSecs = TIMEFRAME_SECS[higherTF];
      if (!htfSecs) {
        console.log(`[signals-cron] higherTF không hợp lệ: ${higherTF}`);
        continue;
      }
      const htfSeries = higherCandles.map(c => ({ ...c, closeTime: c.time + htfSecs }));

      const closedHtf = htfSeries.filter(c => c.closeTime <= lastEntry.time);
      if (closedHtf.length < lookbackCandles) continue;

      const windowCandles = closedHtf.slice(-lookbackCandles);
      const maxHigh = Math.max(...windowCandles.map(c => c.high));
      const minLow = Math.min(...windowCandles.map(c => c.low));

      let direction = 0;
      if (lastEntry.close > maxHigh) {
        direction = 1; // BUY
      } else if (lastEntry.close < minLow) {
        direction = -1; // SELL
      }

      // DEBUG (tạm thời - xoá sau khi test xong): in ra các giá trị dùng để
      // tính breakout, để xác nhận nến fetch đúng và logic tính direction
      // chạy đúng mà không cần chờ tín hiệu thật xảy ra.
      console.log(
        `[signals-cron][DEBUG] ${symbol} (${yahooSymbol}) entry=${timeframe} higher=${higherTF} ` +
        `lastEntryClose=${lastEntry.close} maxHigh=${maxHigh} minLow=${minLow} direction=${direction} ` +
        `lastDirection=${signal.lastDirection} lastEntryTime=${lastEntry.time}`
      );

      if (direction === 0) {
        continue;
      }

      // FIX (đợt fix mới nhất): chỉ báo + ghi KV khi CHIỀU tín hiệu thực sự
      // đảo so với lần báo trước (BUY -> SELL hoặc SELL -> BUY). Trước đây
      // so sánh theo `lastNotifiedTime !== lastEntry.time` nên MỖI nến mới
      // đóng thoả điều kiện breakout đều báo lại, kể cả khi vẫn cùng chiều
      // với tín hiệu đã báo - gây báo liên tục + tốn KV write không cần
      // thiết. `lastDirection` ban đầu là null nên tín hiệu đầu tiên (BUY
      // hoặc SELL) vẫn được báo bình thường như cũ.
      if (signal.lastDirection !== direction) {
        signal.lastNotifiedTime = lastEntry.time;
        signal.lastDirection = direction;
        signalsChanged = true;

        const dirLabel = direction === 1 ? 'BUY 🔵' : 'SELL 🔴';
        const tfLabel = timeframe;

        if (subscription) {
          const stillValid = await sendPush(env, subscription, {
            title: `📊 Tín hiệu ${dirLabel} mới!`,
            body: `${symbol} (${tfLabel}) đã xuất hiện tín hiệu ${dirLabel} đột phá`,
          });
          console.log(`[signals-cron] Gửi push tín hiệu cho ${deviceId} - subscription còn hợp lệ: ${stillValid}`);
          if (!stillValid) {
            delete subs[deviceId];
            subsChanged = true;
          }
        }
      }
    }
  }

  if (signalsChanged) {
    await writeJSON(env.TRACKER_KV, SIGNALS_KEY, allSignals);
  }
  if (subsChanged) {
    await writeJSON(env.TRACKER_KV, SUBS_KEY, subs);
  }
}