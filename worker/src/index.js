/**
 * dq-tracker-push / src/index.js
 *
 * (Xem chú thích đầy đủ về cron/KV/alerts/signals ở các đợt fix trước -
 * không đổi. Đợt fix NÀY chỉ thêm phần "tài khoản nhẹ" (tên + PIN) để
 * nhiều người dùng chung app không bị lẫn cảnh báo của nhau.)
 *
 * FIX (đợt fix mới nhất - TÀI KHOẢN NHẸ, tên + PIN):
 *   Vấn đề: deviceId trước đây do client TỰ SINH NGẪU NHIÊN
 *   (localStorage, xem push-sync.js) - nghĩa là "tài khoản" thực chất gắn
 *   với TRÌNH DUYỆT, không gắn với NGƯỜI. Nếu 2 người dùng chung 1 trình
 *   duyệt/thiết bị (không xoá dữ liệu giữa các lần) thì họ vô tình dùng
 *   chung 1 deviceId -> cảnh báo lẫn vào nhau; ngược lại nếu 1 người dùng
 *   nhiều thiết bị thì lại có nhiều deviceId khác nhau, không lấy lại được
 *   cảnh báo cũ trên thiết bị mới.
 *
 *   Giải pháp NHẸ (không phải hệ thống bảo mật thật, chỉ đủ để vài người
 *   quen dùng chung app mà không lẫn cảnh báo):
 *     - Người dùng tự chọn 1 "tên" + 1 PIN 4-6 số.
 *     - Tên CHƯA từng dùng -> tạo hồ sơ mới, lưu hash(PIN).
 *     - Tên ĐÃ có -> phải nhập đúng PIN mới đăng nhập được vào đúng hồ sơ.
 *     - Sau khi đăng nhập, CLIENT lưu "tên" đó làm deviceId (xem login.js)
 *       -> mọi thứ còn lại (endpoint /api/alerts, /api/signals,
 *       /api/subscribe, cron...) hoạt động Y NGUYÊN như cũ, không cần sửa
 *       gì thêm - chỉ là "deviceId" giờ do người dùng chọn, không còn là
 *       chuỗi ngẫu nhiên.
 *     - PROFILES_KEY: 1 key KV duy nhất chứa map { username: pinHashHex }
 *       cho TẤT CẢ user - vẫn giữ đúng nguyên tắc "1 blob JSON gộp" như
 *       các key khác, nên KHÔNG làm tăng số lượt đọc/ghi KV theo số lượng
 *       user (chỉ tốn thêm đúng lúc có người đăng nhập/tạo hồ sơ, không
 *       liên quan gì đến tần suất chạy cron).
 *     - Hash PIN bằng SHA-256 (Web Crypto có sẵn trong Workers, không cần
 *       cài thêm thư viện) - KHÔNG lưu PIN dạng plain text.
 */

import { buildPushPayload } from '@block65/webcrypto-web-push';

// ===== CONFIG: CHỈ client ghi (qua /api/alerts, /api/signals) =====
const ALERTS_CONFIG_KEY = 'alerts_config_v1'; // { [deviceId]: [{id, symbol, price}] }
const SIGNALS_CONFIG_KEY = 'signals_config_v1'; // { [deviceId]: [{paneId, symbol, timeframe, higherTF, lookbackCandles}] }

// ===== STATE: CHỈ cron ghi (checkAlertsAndNotify/checkSignalsAndNotify) =====
const ALERTS_STATE_KEY = 'alerts_state_v1'; // { [deviceId]: { [alertId]: {side, triggered} } }
const SIGNALS_STATE_KEY = 'signals_state_v1'; // { [deviceId]: { [signalStateKey]: {lastNotifiedTime, lastDirection} } }

const SUBS_KEY = 'subs_v1'; // { [deviceId]: PushSubscriptionJSON }

// ===== TÀI KHOẢN NHẸ (đợt fix này) =====
const PROFILES_KEY = 'profiles_v1'; // { [username]: pinHashHex }

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

// Chuẩn hoá tên đăng nhập: chữ thường, khoảng trắng -> gạch dưới, chỉ giữ
// chữ/số/gạch dưới - để dùng thẳng làm deviceId (key trong mọi KV blob
// khác) mà không lo ký tự lạ/khoảng trắng gây lỗi.
function normalizeUsername(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

async function hashPin(pin) {
  const enc = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

    // ===== TÀI KHOẢN NHẸ (đợt fix này) =====
    // Tên CHƯA từng dùng -> tạo hồ sơ mới với PIN gửi lên.
    // Tên ĐÃ có -> phải khớp PIN đã lưu mới cho đăng nhập.
    // Trả về deviceId = username đã chuẩn hoá, để client lưu làm deviceId
    // dùng chung với toàn bộ hệ thống alerts/signals/subs cũ.
    if (url.pathname === '/api/login' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return withCors(new Response('JSON không hợp lệ', { status: 400 }));
      }

      const rawUsername = body && body.username;
      const pin = body && body.pin;

      if (!rawUsername || !pin || !/^\d{4,6}$/.test(String(pin))) {
        return withCors(
          Response.json({ ok: false, error: 'Tên hoặc PIN không hợp lệ (PIN cần 4-6 chữ số).' }, { status: 400 })
        );
      }

      const username = normalizeUsername(rawUsername);
      if (!username || !/^[a-z0-9_]{2,32}$/.test(username)) {
        return withCors(
          Response.json({ ok: false, error: 'Tên chỉ nên gồm chữ, số, dấu gạch dưới (2-32 ký tự).' }, { status: 400 })
        );
      }

      const profiles = await readJSON(env.TRACKER_KV, PROFILES_KEY, {});
      const pinHash = await hashPin(String(pin));

      if (!profiles[username]) {
        profiles[username] = pinHash;
        await writeJSON(env.TRACKER_KV, PROFILES_KEY, profiles);
        return withCors(Response.json({ ok: true, created: true, deviceId: username }));
      }

      if (profiles[username] !== pinHash) {
        return withCors(Response.json({ ok: false, error: 'Sai PIN cho tên này.' }, { status: 401 }));
      }

      return withCors(Response.json({ ok: true, created: false, deviceId: username }));
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

    // Chỉ ghi vào ALERTS_CONFIG_KEY - KHÔNG đụng vào ALERTS_STATE_KEY (side/
    // triggered), tránh race condition với cron gây báo lặp (xem đợt fix
    // trước).
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

    // Chỉ ghi vào SIGNALS_CONFIG_KEY - KHÔNG đụng vào SIGNALS_STATE_KEY
    // (lastDirection/lastNotifiedTime), cùng lý do như trên.
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
    const deviceState = allState[deviceId] || (allState[deviceId] = {});

    for (const alertCfg of list) {
      const st = deviceState[alertCfg.id] || (deviceState[alertCfg.id] = { side: null, triggered: false });
      if (st.triggered) continue;

      const price = prices[alertCfg.symbol];
      if (price === undefined || Number.isNaN(price)) continue;

      const side = price >= alertCfg.price ? 'above' : 'below';

      if (st.side === null || st.side === undefined) {
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

  Object.keys(allState).forEach((deviceId) => {
    if (!allConfig[deviceId]) {
      delete allState[deviceId];
      stateChanged = true;
    }
  });

  if (stateChanged) await writeJSON(env.TRACKER_KV, ALERTS_STATE_KEY, allState);
  if (subsChanged) await writeJSON(env.TRACKER_KV, SUBS_KEY, subs);
}

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

const STABLECOIN_AS_USD = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD', 'DAI']);

function vsCurrencyFor(quote) {
  return STABLECOIN_AS_USD.has(quote) ? 'usd' : quote.toLowerCase();
}

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
        'User-Agent': 'dq-tracker-push/1.0 (personal price alert worker)',
        Accept: 'application/json',
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
    return true;
  }
}

const TIMEFRAME_SECS = {
  '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200,
  '4h': 14400, '12h': 43200, '1d': 86400, '3d': 259200,
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
      groups.set(bucket, { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
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
        direction = 1;
      } else if (lastEntry.close < minLow) {
        direction = -1;
      }

      console.log(
        `[signals-cron][DEBUG] ${symbol} (${yahooSymbol}) entry=${timeframe} higher=${higherTF} ` +
        `lastEntryClose=${lastEntry.close} maxHigh=${maxHigh} minLow=${minLow} direction=${direction} ` +
        `lastDirection=${state.lastDirection} lastEntryTime=${lastEntry.time}`
      );

      if (direction === 0) {
        continue;
      }

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