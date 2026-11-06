/**
 * api.js
 * Các lời gọi REST tới Binance (spot/futures) và OANDA (qua Worker -> TradingView).
 * Không đụng vào DOM / Store -> chỉ trả dữ liệu đã format sẵn.
 *
 *   - ĐÃ BỎ HOÀN TOÀN Yahoo.
 *   - fetchKlines(): cache 20s + chống gọi trùng (cùng key đang tải -> dùng chung Promise).
 *   - OANDA: mọi request tới Worker đều có TIMEOUT + tự thử lại 1 lần khi lỗi
 *     mạng / 5xx / 429 (fetchWithRetry) -> 1 lần chớp lỗi không làm rớt kết nối.
 *   - fetchOandaLiveMulti(): 1 request lấy vài nến cuối của NHIỀU khung + quote
 *     (giá, %, bid/ask) trong "__quote". Dùng cho hub poll trong websocket.js.
 *   - fetchOandaLive(): giữ lại cho code cũ (gộp nhiều lời gọi trong 400ms).
 *
 * Khung TỔNG HỢP (20m/45m/3h/2d) trên Binance: tải nến base rồi gộp bằng
 * aggregateCandles() (utils.js).
 */

const BINANCE_REST_BASE = 'https://api.binance.com';
const WORKER_FALLBACK_URL = 'https://dq-tracker-push.quocngyendanght.workers.dev';

function getBackendBaseUrl() {
  return WORKER_FALLBACK_URL;
}

/** Loại bỏ hậu tố _PERP nếu có để gửi symbol sạch lên Binance. */
function getCleanSymbol(symbol) {
  if (symbol && symbol.endsWith('_PERP')) {
    return symbol.replace('_PERP', '');
  }
  return symbol;
}

/**
 * Nhà cung cấp dữ liệu cho symbol:
 *  - XAUUSD / GOLD / OANDA:... -> 'oanda'
 *  - hậu tố _PERP hoặc XAUUSDT -> 'binance_futures'
 *  - còn lại                   -> 'binance' (spot)
 */
function getProviderFor(symbol) {
  if (!symbol) return 'oanda';
  const s = String(symbol).trim().toUpperCase();
  if (s === 'XAUUSD' || s === 'GOLD' || s.startsWith('OANDA:') || s.endsWith(':OANDA')) {
    return 'oanda';
  }
  if (symbol.endsWith('_PERP') || symbol === 'XAUUSDT') {
    return 'binance_futures';
  }
  return 'binance';
}

/* ===================== FETCH CÓ TIMEOUT + THỬ LẠI ===================== */

/**
 * fetch với timeout; thử lại khi lỗi mạng / timeout / 5xx / 429.
 * Trả Response (ok) hoặc ném lỗi.
 */
async function fetchWithRetry(url, { timeoutMs = 12000, retries = 1, retryDelayMs = 700 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(to);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
      lastErr.status = res.status;
      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable) throw lastErr;
    } catch (err) {
      clearTimeout(to);
      lastErr = err;
      if (err && err.status && !(err.status >= 500 || err.status === 429)) throw err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  throw lastErr || new Error('fetch lỗi');
}

/**
 * Khung TỔNG HỢP cho Binance: tải nến base rồi gộp. Tải dư 1 bucket để
 * bucket đầu không bị thiếu nến, sau đó cắt về đúng `limit`.
 */
async function fetchSyntheticKlines(symbol, interval, limit, endTime) {
  const info = SYNTHETIC_TIMEFRAMES[interval];
  const baseLimit = Math.min(1000, (limit + 1) * info.factor);
  const baseCandles = await fetchKlinesRaw(symbol, info.base, baseLimit, endTime);
  const aggregated = aggregateCandles(baseCandles, interval);
  return aggregated.length > limit ? aggregated.slice(aggregated.length - limit) : aggregated;
}

/* ===================== CACHE + CHỐNG GỌI TRÙNG ===================== */

const KLINES_CACHE = new Map(); // key -> { ts, data }
const KLINES_INFLIGHT = new Map(); // key -> Promise
const KLINES_TTL_MS = 20000;
const KLINES_CACHE_MAX = 80;

/**
 * Lấy nến (format chuẩn Lightweight Charts).
 * @param {string} symbol  vd: BTCUSDT, BTCUSDT_PERP, XAUUSD
 * @param {string} interval vd: 15m, 1h, 1d (hoặc tổng hợp 20m/45m/3h/2d)
 * @param {number} limit
 * @param {number|null} endTime  ms epoch - chỉ lấy nến đóng TRƯỚC mốc này (tải lịch sử cũ)
 *
 * Chỉ cache khi KHÔNG có endTime. Luôn trả BẢN SAO mảng nên nơi gọi sửa thoải mái.
 */
function fetchKlines(symbol, interval, limit = 1000, endTime = null) {
  if (endTime) return fetchKlinesRaw(symbol, interval, limit, endTime);

  const key = `${symbol}|${interval}|${limit}`;
  const hit = KLINES_CACHE.get(key);
  if (hit && Date.now() - hit.ts < KLINES_TTL_MS) {
    return Promise.resolve(hit.data.slice());
  }
  if (KLINES_INFLIGHT.has(key)) {
    return KLINES_INFLIGHT.get(key).then((d) => d.slice());
  }

  const p = fetchKlinesRaw(symbol, interval, limit, null)
    .then((data) => {
      KLINES_CACHE.set(key, { ts: Date.now(), data });
      if (KLINES_CACHE.size > KLINES_CACHE_MAX) {
        KLINES_CACHE.delete(KLINES_CACHE.keys().next().value);
      }
      return data;
    })
    .finally(() => KLINES_INFLIGHT.delete(key));

  KLINES_INFLIGHT.set(key, p);
  return p.then((d) => d.slice());
}

async function fetchKlinesRaw(symbol, interval, limit, endTime) {
  const provider = getProviderFor(symbol);

  if (provider === 'oanda') {
    // 10m: Worker không hỗ trợ -> tải 5m rồi gộp ở client
     if (interval === '10m' || interval === '2w') return fetchSyntheticKlines(symbol, interval, limit, endTime);

    let url =
      `${WORKER_FALLBACK_URL}/api/oanda/klines?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    if (endTime) url += `&endTime=${endTime}`;
    let res;
    try {
      res = await fetchWithRetry(url, { timeoutMs: 25000, retries: 1, retryDelayMs: 1000 });
    } catch (err) {
      throw new Error(`fetchKlines OANDA lỗi: ${err && err.message ? err.message : 'network error'}`);
    }
    return await res.json();
  }

  // Binance spot / futures
  if (isSyntheticInterval(interval)) {
    return fetchSyntheticKlines(symbol, interval, limit, endTime);
  }

  const cleanSymbol = getCleanSymbol(symbol);
  const baseUrl = provider === 'binance_futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
  const path = provider === 'binance_futures' ? '/fapi/v1/klines' : '/api/v3/klines';

  let url = `${baseUrl}${path}?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`;
  if (endTime) url += `&endTime=${endTime}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetchKlines Binance (${provider}) lỗi: ${res.status} ${res.statusText}`);
  }
  const raw = await res.json();
  // Mỗi phần tử raw: [openTime, open, high, low, close, volume, closeTime, ...]
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

/* ===================== OANDA LIVE ===================== */

/**
 * 1 request -> vài nến cuối của NHIỀU khung + quote.
 * Kết quả: { '15m': [bars], '1h': [bars], ..., __quote: {lastPrice, changePercent, bid, ask, ...} }
 * Mọi khung (kể cả 3h/6h/12h/2d/3d) đều được Worker hỗ trợ.
 * @param {number} n số nến cuối mỗi khung (mặc định 3; catch-up có thể xin tới 100)
 */
async function fetchOandaLiveMulti(symbol, intervals, n = 3) {
  const list = [...new Set(intervals)].filter(Boolean);
  if (list.length === 0) return {};
  let url =
    `${WORKER_FALLBACK_URL}/api/oanda/live?symbol=${encodeURIComponent(symbol)}` +
    `&intervals=${encodeURIComponent(list.join(','))}`;
  if (n > 3) url += `&n=${Math.min(100, Math.floor(n))}`;
  const res = await fetchWithRetry(url, { timeoutMs: 6000, retries: 1, retryDelayMs: 500 });
  return await res.json();
}

const LIVE_BATCH = new Map(); // symbol -> { intervals:Set, waiters:[], timer }

/**
 * (Giữ cho code cũ) Lấy vài nến cuối của 1 khung OANDA. Mọi lời gọi cùng
 * symbol trong cửa sổ 400ms được gộp thành 1 request.
 * @returns {Promise<Array>} mảng nến (tăng dần theo time)
 */
function fetchOandaLive(symbol, interval) {
  return new Promise((resolve, reject) => {
    let batch = LIVE_BATCH.get(symbol);
    if (!batch) {
      batch = { intervals: new Set(), waiters: [], timer: null };
      LIVE_BATCH.set(symbol, batch);
      const b = batch;
      b.timer = setTimeout(async () => {
        LIVE_BATCH.delete(symbol);
        try {
          const data = await fetchOandaLiveMulti(symbol, [...b.intervals]);
          b.waiters.forEach((w) => w.resolve(data[w.interval] || []));
        } catch (err) {
          b.waiters.forEach((w) => w.reject(err));
        }
      }, 400);
    }
    batch.intervals.add(interval);
    batch.waiters.push({ interval, resolve, reject });
  });
}

/* ===================== TICKER / DANH SÁCH SYMBOL ===================== */

/** Giá 24h hiện tại (hiển thị giá ban đầu). */
async function fetch24hTicker(symbol) {
  const provider = getProviderFor(symbol);

  if (provider === 'oanda') {
    let res;
    try {
      res = await fetchWithRetry(`${WORKER_FALLBACK_URL}/api/oanda/ticker?symbol=${encodeURIComponent(symbol)}`, {
        timeoutMs: 10000,
        retries: 1,
        retryDelayMs: 800,
      });
    } catch (err) {
      throw new Error('fetch24hTicker OANDA lỗi');
    }
    const data = await res.json();
    return {
      lastPrice: parseFloat(data.lastPrice),
      changePercent: parseFloat(data.changePercent),
      bid: data.bid,
      ask: data.ask,
      high: data.high,
      low: data.low,
    };
  }

  const cleanSymbol = getCleanSymbol(symbol);
  const baseUrl = provider === 'binance_futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
  const path = provider === 'binance_futures' ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr';

  const res = await fetch(`${baseUrl}${path}?symbol=${cleanSymbol}`);
  if (!res.ok) {
    throw new Error(`fetch24hTicker Binance (${provider}) lỗi: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return {
    lastPrice: parseFloat(data.lastPrice),
    changePercent: parseFloat(data.priceChangePercent),
  };
}

/** Toàn bộ symbol USDT đang giao dịch trên Binance (spot + futures _PERP). */
async function fetchAllSymbols() {
  try {
    const [spotRes, futuresRes] = await Promise.all([
      fetch('https://api.binance.com/api/v3/exchangeInfo').catch(() => null),
      fetch('https://fapi.binance.com/fapi/v1/exchangeInfo').catch(() => null),
    ]);

    let spotSymbols = [];
    if (spotRes && spotRes.ok) {
      const data = await spotRes.json();
      spotSymbols = data.symbols
        .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map((s) => s.symbol);
    }

    let futuresSymbols = [];
    if (futuresRes && futuresRes.ok) {
      const data = await futuresRes.json();
      futuresSymbols = data.symbols
        .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map((s) => s.symbol + '_PERP');
    }

    return [...spotSymbols, ...futuresSymbols].sort();
  } catch (err) {
    console.error('Lỗi fetchAllSymbols:', err);
    return [];
  }
}

/** Tìm symbol OANDA - hiện chỉ hỗ trợ vàng (XAUUSD), không cần gọi mạng. */
async function searchOandaSymbols(query) {
  if (!query) return [];
  const q = query.trim().toUpperCase();
  if (['XAU', 'GOLD', 'VÀNG', 'VANG'].some((k) => q.includes(k))) {
    return [
      {
        id: 'OANDA:XAUUSD',
        symbol: 'XAUUSD',
        description: 'Gold (OANDA CFD)',
        exchange: 'OANDA',
      },
    ];
  }
  return [];
}