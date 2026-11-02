/**
 * api.js
 * Các lời gọi REST tới Binance (spot/futures) và OANDA (qua Worker -> TradingView).
 * Không đụng vào DOM / Store -> chỉ trả dữ liệu đã format sẵn.
 *
 * ĐỢT TỐI ƯU TỐC ĐỘ:
 *   - ĐÃ BỎ HOÀN TOÀN Yahoo.
 *   - fetchKlines(): cache 20s + chống gọi trùng (cùng key đang tải -> dùng chung Promise).
 *   - OANDA gọi THẲNG Worker (bỏ bước thử same-origin gây thừa 1 round-trip).
 *   - fetchOandaLive(): gộp nhiều khung của cùng 1 symbol vào 1 request
 *     (Worker chỉ mở 1 WebSocket TradingView cho tất cả) - dùng cho vòng poll
 *     realtime trong websocket.js.
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
    let url =
      `${WORKER_FALLBACK_URL}/api/oanda/klines?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    if (endTime) url += `&endTime=${endTime}`;
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) {
      throw new Error(`fetchKlines OANDA lỗi: ${res ? res.status : 'network error'}`);
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

/* ===================== OANDA LIVE (GỘP NHIỀU KHUNG / 1 REQUEST) ===================== */

const LIVE_BATCH = new Map(); // symbol -> { intervals:Set, waiters:[], timer }

/**
 * Lấy vài nến cuối của 1 khung OANDA. Mọi lời gọi cùng symbol trong cửa sổ
 * 400ms được gộp thành 1 request /api/oanda/live (Worker mở 1 WebSocket
 * TradingView duy nhất cho tất cả các khung).
 * CHỈ dùng cho khung native của TradingView (không dùng cho 20m/45m/3h/6h/8h/12h/2d/3d).
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
          const res = await fetch(
            `${WORKER_FALLBACK_URL}/api/oanda/live?symbol=${encodeURIComponent(symbol)}` +
              `&intervals=${[...b.intervals].join(',')}`
          );
          if (!res.ok) throw new Error('live ' + res.status);
          const data = await res.json();
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

/** Giá 24h hiện tại (hiển thị giá ban đầu / poll ticker OANDA). */
async function fetch24hTicker(symbol) {
  const provider = getProviderFor(symbol);

  if (provider === 'oanda') {
    const res = await fetch(`${WORKER_FALLBACK_URL}/api/oanda/ticker?symbol=${encodeURIComponent(symbol)}`).catch(
      () => null
    );
    if (!res || !res.ok) {
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