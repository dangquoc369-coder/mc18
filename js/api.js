/**
 * api.js
 * Tất cả các lời gọi REST API tới Binance & Yahoo Finance.
 * Không đụng vào DOM, không đụng vào Store trực tiếp -> chỉ trả dữ liệu đã format sẵn.
 */

const BINANCE_REST_BASE = 'https://api.binance.com';

/**
 * Loại bỏ hậu tố _PERP nếu có để gửi symbol sạch lên Binance.
 */
function getCleanSymbol(symbol) {
  if (symbol && symbol.endsWith('_PERP')) {
    return symbol.replace('_PERP', '');
  }
  return symbol;
}

/**
 * Xác định nhà cung cấp dữ liệu cho symbol.
 * - Suffix _PERP hoặc là XAUUSDT -> 'binance_futures'.
 * - crypto Binance chuẩn (vd: BTCUSDT) -> 'binance'.
 * - Các symbol khác (Forex, Cổ phiếu, Chỉ số...) -> 'yahoo'.s
 */
function getProviderFor(symbol) {
  if (!symbol) return 'yahoo';
  if (symbol.endsWith('_PERP') || symbol === 'XAUUSDT') {
    return 'binance_futures';
  }
  if (symbol.endsWith('USDT') && !symbol.includes('=')) {
    return 'binance';
  }
  return 'yahoo';
}

/**
 * Lấy dữ liệu nến (klines) từ Binance hoặc Yahoo Finance, format sẵn theo chuẩn Lightweight Charts.
 * @param {string} symbol - vd: BTCUSDT, EURUSD=X, AAPL
 * @param {string} interval - vd: 15m, 1h, 1d
 * @param {number} limit - số lượng nến tối đa (Binance cho phép tới 1000)
 * @param {number|null} endTime - mốc thời gian (ms, epoch) - nếu truyền, chỉ
 *   lấy các nến có thời gian ĐÓNG trước mốc này. Dùng để tải lịch sử cũ hơn.
 * @returns {Promise<Array<{time:number, open:number, high:number, low:number, close:number, volume:number}>>}
 */
async function fetchKlines(symbol, interval, limit = 1000, endTime = null) {
  const provider = getProviderFor(symbol);

  if (provider === 'yahoo') {
    let url = `/api/yahoo/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}`;
    if (endTime) {
      url += `&endTime=${endTime}`;
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`fetchKlines Yahoo lỗi: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }

  // Binance or Binance Futures
  const cleanSymbol = getCleanSymbol(symbol);
  const baseUrl = provider === 'binance_futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
  const path = provider === 'binance_futures' ? '/fapi/v1/klines' : '/api/v3/klines';

  let url = `${baseUrl}${path}?symbol=${cleanSymbol}&interval=${interval}&limit=${limit}`;
  if (endTime) {
    url += `&endTime=${endTime}`;
  }
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

/**
 * Lấy giá 24h ticker hiện tại (dùng để hiển thị giá ban đầu trước khi WS kết nối xong).
 * @param {string} symbol
 */
async function fetch24hTicker(symbol) {
  const provider = getProviderFor(symbol);

  if (provider === 'yahoo') {
    const res = await fetch(`/api/yahoo/ticker?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) {
      throw new Error(`fetch24hTicker Yahoo lỗi: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }

  // Binance or Binance Futures
  const cleanSymbol = getCleanSymbol(symbol);
  const baseUrl = provider === 'binance_futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
  const path = provider === 'binance_futures' ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr';

  const url = `${baseUrl}${path}?symbol=${cleanSymbol}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch24hTicker Binance (${provider}) lỗi: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return {
    lastPrice: parseFloat(data.lastPrice),
    changePercent: parseFloat(data.priceChangePercent),
  };
}

/**
 * Lấy toàn bộ danh sách symbol đang giao dịch Binance.
 */
async function fetchAllSymbols() {
  const spotUrl = 'https://api.binance.com/api/v3/exchangeInfo';
  const futuresUrl = 'https://fapi.binance.com/fapi/v1/exchangeInfo';

  try {
    const [spotRes, futuresRes] = await Promise.all([
      fetch(spotUrl).catch(() => null),
      fetch(futuresUrl).catch(() => null),
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

    // Merge and sort
    const all = [...spotSymbols, ...futuresSymbols].sort();
    return all;
  } catch (err) {
    console.error('Lỗi fetchAllSymbols:', err);
    return [];
  }
}

/**
 * Tìm kiếm symbol tích hợp (gồm Binance và Yahoo Finance).
 */
async function searchYahooSymbols(query) {
  if (!query) return [];
  try {
    const res = await fetch(`/api/yahoo/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`Yahoo Search HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Lỗi tìm kiếm Yahoo:', err);
    return [];
  }
}
