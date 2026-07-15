/**
 * dq-tracker-push / src/index.js
 *
 * Backend MIỄN PHÍ (Cloudflare Workers + KV) để bắn thông báo cảnh báo giá
 * NGAY CẢ KHI app/trình duyệt trên máy bạn đã tắt hẳn - vì phần "kiểm tra
 * giá + quyết định báo hay không" giờ chạy trên server (Cron Trigger), không
 * còn phụ thuộc vào việc tab có đang mở hay không như AlertsModule cũ.
 *
 * FIX (đợt fix mới nhất - SỬA LỖI BÁO LẶP 1 CHIỀU LIÊN TỤC):
 *   Nguyên nhân thật sự: cả CRON và CLIENT (push-sync.js gọi /api/alerts,
 *   /api/signals) cùng đọc-sửa-ghi (read-modify-write) CHUNG 1 KEY KV chứa
 *   cả "cấu hình" (id/symbol/price, hoặc paneId/symbol/timeframe...) LẪN
 *   "trạng thái đã báo" (side/triggered, hoặc lastDirection/lastNotifiedTime).
 *
 *   Kịch bản gây lỗi (race condition / lost update):
 *     1) Cron đọc key, tính ra tín hiệu mới, chuẩn bị ghi lại key với
 *        side/lastDirection đã cập nhật.
 *     2) ĐÚNG lúc đó, client tự động sync lại (vd app resume sau khi khoá
 *        màn hình - push-sync.js có gọi lại syncAlerts()/syncSignals() lúc
 *        khởi động và mỗi khi có thay đổi cấu hình). Client đọc key NGAY
 *        TRƯỚC khi cron ghi xong -> lấy phải bản CŨ (side/lastDirection
 *        chưa cập nhật).
 *     3) Cron ghi xong bản MỚI.
 *     4) Client ghi ĐÈ lại bằng bản merge dựa trên dữ liệu CŨ nó đọc ở bước
 *        2 -> side/lastDirection bị "hoàn tác" về giá trị trước đó.
 *     5) Tick cron kế tiếp: vì state đã bị revert, điều kiện so sánh
 *        side/lastDirection lại đúng dù giá/chiều không hề đổi thật ->
 *        BÁO LẶP LẠI tín hiệu/cảnh báo cũ, dù server code so sánh "đổi
 *        chiều mới báo" là ĐÚNG về mặt logic.
 *
 *   Cách sửa: tách MỖI loại dữ liệu thành 2 key KV riêng biệt:
 *     - *_CONFIG_KEY : CHỈ client ghi (qua /api/alerts, /api/signals) - chỉ
 *       chứa thông tin cấu hình thuần (id/symbol/price hoặc
 *       paneId/symbol/timeframe/higherTF/lookbackCandles). KHÔNG chứa
 *       side/triggered/lastDirection/lastNotifiedTime.
 *     - *_STATE_KEY   : CHỈ cron ghi (checkAlertsAndNotify/
 *       checkSignalsAndNotify) - chứa side/triggered hoặc
 *       lastDirection/lastNotifiedTime, khớp theo id (alerts) hoặc
 *       paneId+symbol+timeframe (signals).
 *   Vì client KHÔNG BAO GIỜ ghi vào *_STATE_KEY nữa, cron là bên DUY NHẤT
 *   ghi key đó -> không còn 2 tiến trình tranh nhau ghi đè cùng 1 key ->
 *   hết lost update -> hết báo lặp.
 *
 * (Các ghi chú cũ về giới hạn Workers KV, breakout server-side, tần suất
 * cron... vẫn giữ nguyên như các đợt fix trước, không đổi.)
 *
 * 3 endpoint HTTP:
 *   GET  /api/vapid-public-key  -> trả VAPID public key cho client dùng khi
 *                                  subscribe PushManager.
 *   POST /api/subscribe         -> lưu Push Subscription của 1 thiết bị.
 *   POST /api/alerts            -> đồng bộ CẤU HÌNH cảnh báo giá hiện tại
 *                                  của 1 thiết bị (ghi đè CONFIG, KHÔNG đụng
 *                                  vào STATE side/triggered).
 *   POST /api/signals           -> đồng bộ CẤU HÌNH tín hiệu BUY/SELL cần
 *                                  theo dõi của 1 thiết bị (ghi đè CONFIG,
 *                                  KHÔNG đụng vào STATE lastDirection/
 *                                  lastNotifiedTime).
 *
 * 1 cron handler (scheduled), cấu hình chạy MỖI PHÚT trong wrangler.toml:
 *   - Gom toàn bộ symbol đang cần theo dõi từ MỌI thiết bị (loại trùng).
 *   - Gọi 1 lần API CoinGecko để lấy giá hiện tại của các symbol cần theo dõi.
 *   - Với mỗi cảnh báo CHƯA triggered: so "phía" hiện tại (trên/dưới mức
 *     cảnh báo) với "phía" đã lưu lần trước (đọc/ghi ở ALERTS_STATE_KEY) -
 *     đổi phía = vừa "vượt qua" mức cảnh báo -> gửi Web Push + đánh dấu
 *     triggered.
 *   - Lần đầu tiên thấy 1 cảnh báo (chưa có "side" lưu trước đó) chỉ ghi
 *     nhận baseline, KHÔNG báo ngay - tránh báo nhầm ngay khi vừa tạo cảnh
 *     báo lúc giá đã ở phía đó từ trước.
 *   - Với signals BUY/SELL: chỉ báo khi CHIỀU tín hiệu đảo so với lần báo
 *     trước (đọc/ghi ở SIGNALS_STATE_KEY) - không báo liên tục khi vẫn
 *     cùng chiều.
 *
 * LƯU Ý VỀ GIỚI HẠN FREE TIER CỦA WORKERS KV:
 *   - Free tier: ~100.000 lượt đọc/ngày, ~1.000 lượt ghi/ngày.
 *   - Thiết kế ở đây CHỈ GHI khi có thay đổi thật (alert vừa được tạo lần
 *     đầu, vừa triggered, hoặc signal vừa đảo chiều) - không ghi mỗi tick.
 *   - Việc tách CONFIG/STATE thành 2 key riêng KHÔNG làm tăng số lượt đọc
 *     đáng kể (mỗi lượt cron chạy đọc thêm 1 key nhỏ), nhưng giảm hẳn số
 *     lượt ghi "vô ích" do bị client ghi đè lặp lại logic cũ.
 *   - checkAlertsAndNotify chạy 2 lần/phút (2880 lần/ngày), checkSignalsAndNotify
 *     chỉ chạy 1 lần/phút (1440 lần/ngày) để giảm tổng số operation.
 */

import { buildPushPayload } from '@block65/webcrypto-web-push';

// ===== CONFIG: CHỈ client ghi (qua /api/alerts, /api/signals) =====
const ALERTS_CONFIG_KEY = 'alerts_config_v1'; // { [deviceId]: [{id, symbol, price}] }
const SIGNALS_CONFIG_KEY = 'signals_config_v1'; // { [deviceId]: [{paneId, symbol, timeframe, higherTF, lookbackCandles}] }

// ===== STATE: CHỈ cron ghi (checkAlertsAndNotify/checkSignalsAndNotify) =====
const ALERTS_STATE_KEY = 'alerts_state_v1'; // { [deviceId]: { [alertId]: {side, triggered} } }
const SIGNALS_STATE_KEY = 'signals_state_v1'; // { [deviceId]: { [signalStateKey]: {lastNotifiedTime, lastDirection} } }

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

// Khoá dùng để định danh 1 signal trong STATE, khớp theo pane + symbol +
// timeframe (không dùng higherTF/lookbackCandles vì đổi mấy cái đó vẫn nên
// giữ nguyên lịch sử lastDirection của cùng 1 "vị trí theo dõi").
function signalStateKey(s) {
  return `${s.paneId}__${s.symbol}__${s.timeframe}`;
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

    // FIX: /api/alerts giờ CHỈ ghi vào ALERTS_CONFIG_KEY - không còn đọc
    // lại "existing" để giữ side/triggered rồi ghi đè cả 2 thứ chung 1 key
    // như bản cũ (đó chính là nguồn gốc race condition với cron). State
    // (side/triggered) nằm hẳn ở ALERTS_STATE_KEY, chỉ cron được đụng vào.
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

      const allConfig = await readJSON(env.TRACKER_KV, ALERTS_CONFIG_KEY, {});

      const merged = alerts
        .filter((a) => a && a.id && a.symbol && typeof a.price === 'number')
        .map((a) => ({ id: a.id, symbol: a.symbol, price: a.price }));

      if (merged.length > 0) {
        allConfig[deviceId] = merged;
      } else {
        delete allConfig[deviceId];
      }
      await writeJSON(env.TRACKER_KV, ALERTS_CONFIG_KEY, allConfig);
      return withCors(Response.json({ ok: true, count: merged.length }));
    }

    // FIX: tương tự /api/alerts - /api/signals giờ CHỈ ghi vào
    // SIGNALS_CONFIG_KEY, không còn đọc lại "existing" để giữ
    // lastNotifiedTime/lastDirection rồi ghi đè chung 1 key với cron.
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

      const allConfig = await readJSON(env.TRACKER_KV, SIGNALS_CONFIG_KEY, {});

      const merged = signals
        .filter((s) => s && s.paneId && s.symbol && s.timeframe && s.higherTF)
        .map((s) => ({
          paneId: s.paneId,
          symbol: s.symbol,
          timeframe: s.timeframe,
          higherTF: s.higherTF,
          lookbackCandles: s.lookbackCandles || 2,
        }));

      if (merged.length > 0) {
        allConfig[deviceId] = merged;
      } else {
        delete allConfig[deviceId];
      }
      await writeJSON(env.TRACKER_KV, SIGNALS_CONFIG_KEY, allConfig);
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
 *   2 lần/phút sẽ nhân đôi tải không cần thiết.
 */
async function runCronTick(env) {
  await Promise.allSettled([checkAlertsAndNotify(env), checkSignalsAndNotify(env)]);
  await sleep(30000);
  await checkAlertsAndNotify(env);
}

async function checkAlertsAndNotify(env) {
  const allConfig = await readJSON(env.TRACKER_KV, ALERTS_CONFIG_KEY, {});
  const allState = await readJSON(env.TRACKER_KV, ALERTS_STATE_KEY, {});
  const subs = await readJSON(env.TRACKER_KV, SUBS_KEY, {});

  console.log(
    `[cron] devices=${Object.keys(allConfig).length} subs=${Object.keys(subs).length}`
  );

  const symbolSet = new Set();
  Object.keys(allConfig).forEach((deviceId) => {
    const list = allConfig[deviceId] || [];
    const deviceState = allState[deviceId] || {};
    list.forEach((a) => {
      const st = deviceState[a.id];
      if (!st || !st.triggered) symbolSet.add(a.symbol);
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

  let stateChanged = false;
  let subsChanged = false;

  for (const deviceId of Object.keys(allConfig)) {
    const list = allConfig[deviceId] || [];
    const subscription = subs[deviceId];
    // Lấy (hoặc tạo mới) object state riêng cho device này - cron là bên
    // DUY NHẤT ghi vào đây nên không sợ bị client ghi đè mất.
    const deviceState = allState[deviceId] || (allState[deviceId] = {});

    for (const alertCfg of list) {
      const st = deviceState[alertCfg.id] || (deviceState[alertCfg.id] = { side: null, triggered: false });
      if (st.triggered) continue;

      const price = prices[alertCfg.symbol];
      if (price === undefined || Number.isNaN(price)) continue;

      const side = price >= alertCfg.price ? 'above' : 'below';

      if (st.side === null || st.side === undefined) {
        // Lần đầu thấy cảnh báo này kể từ khi đồng bộ - chỉ lưu baseline.
        console.log(
          `[cron] baseline mới cho ${deviceId}/${alertCfg.symbol}@${alertCfg.price}: giá hiện tại ${price} (${side})`
        );
        st.side = side;
        stateChanged = true;
        continue;
      }

      if (st.side !== side) {
        console.log(
          `[cron] KÍCH HOẠT ${deviceId}/${alertCfg.symbol}@${alertCfg.price}: ${st.side} -> ${side}, giá=${price}, có subscription=${!!subscription}`
        );
        st.side = side;
        st.triggered = true;
        stateChanged = true;

        if (subscription) {
          const stillValid = await sendPush(env, subscription, {
            title: '🔔 Cảnh báo giá',
            body: `${alertCfg.symbol} đã chạm mức ${price}`,
          });
          console.log(`[cron] gửi push cho ${deviceId} - subscription còn hợp lệ: ${stillValid}`);
          if (!stillValid) {
            delete subs[deviceId];
            subsChanged = true;
          }
        }
      }
    }

    // Dọn rác: xoá state của những alert đã bị người dùng xoá khỏi config
    // (không còn nằm trong list) - tránh state phình to vô hạn theo thời
    // gian. Việc này không gây race vì chỉ cron đọc VÀ ghi ALERTS_STATE_KEY.
    const validIds = new Set(list.map((a) => a.id));
    Object.keys(deviceState).forEach((id) => {
      if (!validIds.has(id)) {
        delete deviceState[id];
        stateChanged = true;
      }
    });
    if (Object.keys(deviceState).length === 0) {
      delete allState[deviceId];
    }
  }

  // Dọn rác state của device không còn config nào (đã xoá hết cảnh báo).
  Object.keys(allState).forEach((deviceId) => {
    if (!allConfig[deviceId]) {
      delete allState[deviceId];
      stateChanged = true;
    }
  });

  if (stateChanged) await writeJSON(env.TRACKER_KV, ALERTS_STATE_KEY, allState);
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
 * Yahoo Finance KHÔNG hiểu ticker dạng sàn (vd "BTCUSDT") - ticker crypto
 * trên Yahoo có dạng "BTC-USD", "ETH-USD"... Hàm này tái dùng splitSymbol()/
 * STABLECOIN_AS_USD (dùng chung với phần CoinGecko) để tách base/quote rồi
 * ghép lại thành ticker Yahoo đúng chuẩn "BASE-QUOTE" (coi mọi stablecoin
 * quy về USD, giống cách xử lý bên fetchCoinGeckoPrices).
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
 * Log lỗi rõ ràng ở mọi nhánh thất bại để dễ debug qua `wrangler tail`.
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
  const allConfig = await readJSON(env.TRACKER_KV, SIGNALS_CONFIG_KEY, {});
  const allState = await readJSON(env.TRACKER_KV, SIGNALS_STATE_KEY, {});
  const subs = await readJSON(env.TRACKER_KV, SUBS_KEY, {});

  if (Object.keys(allConfig).length === 0) {
    return;
  }

  let stateChanged = false;
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

  for (const deviceId of Object.keys(allConfig)) {
    const list = allConfig[deviceId] || [];
    const subscription = subs[deviceId];
    // Cron là bên DUY NHẤT ghi vào deviceState - client không còn đụng vào
    // SIGNALS_STATE_KEY nữa (xem /api/signals ở trên).
    const deviceState = allState[deviceId] || (allState[deviceId] = {});

    for (const cfg of list) {
      const { symbol, timeframe, higherTF, lookbackCandles } = cfg;
      const sKey = signalStateKey(cfg);
      const state = deviceState[sKey] || (deviceState[sKey] = { lastNotifiedTime: null, lastDirection: null });

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

      console.log(
        `[signals-cron][DEBUG] ${symbol} (${yahooSymbol}) entry=${timeframe} higher=${higherTF} ` +
        `lastEntryClose=${lastEntry.close} maxHigh=${maxHigh} minLow=${minLow} direction=${direction} ` +
        `lastDirection=${state.lastDirection} lastEntryTime=${lastEntry.time}`
      );

      if (direction === 0) {
        continue;
      }

      // Chỉ báo + ghi KV khi CHIỀU tín hiệu thực sự đảo so với lần báo
      // trước (BUY -> SELL hoặc SELL -> BUY). state.lastDirection ban đầu
      // là null nên tín hiệu đầu tiên (BUY hoặc SELL) vẫn được báo bình
      // thường. Vì chỉ cron ghi state này, giá trị không còn bị client ghi
      // đè/hoàn tác nữa -> hết báo lặp.
      if (state.lastDirection !== direction) {
        state.lastNotifiedTime = lastEntry.time;
        state.lastDirection = direction;
        stateChanged = true;

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

    // Dọn rác: xoá state của những signal đã bị người dùng xoá/đổi cấu hình
    // khỏi config (đổi timeframe/symbol tạo ra sKey khác, cái cũ không còn
    // dùng nữa). An toàn vì chỉ cron đọc VÀ ghi SIGNALS_STATE_KEY.
    const validKeys = new Set(list.map(signalStateKey));
    Object.keys(deviceState).forEach((k) => {
      if (!validKeys.has(k)) {
        delete deviceState[k];
        stateChanged = true;
      }
    });
    if (Object.keys(deviceState).length === 0) {
      delete allState[deviceId];
    }
  }

  // Dọn rác state của device không còn config nào.
  Object.keys(allState).forEach((deviceId) => {
    if (!allConfig[deviceId]) {
      delete allState[deviceId];
      stateChanged = true;
    }
  });

  if (stateChanged) {
    await writeJSON(env.TRACKER_KV, SIGNALS_STATE_KEY, allState);
  }
  if (subsChanged) {
    await writeJSON(env.TRACKER_KV, SUBS_KEY, subs);
  }
}