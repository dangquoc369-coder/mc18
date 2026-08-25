/**
 * utils.js
 * Các hàm tiện ích thuần (pure functions) + EventBus dùng chung toàn app.
 * File này KHÔNG phụ thuộc vào bất kỳ module nào khác -> phải load đầu tiên.
 */

/* ===================== EVENT BUS ===================== */
const EventBus = (function () {
  // eventName -> Map(originalCallback -> wrapperFunction)
  const registry = new Map();

  function on(eventName, callback) {
    const wrapper = (e) => callback(e.detail);
    if (!registry.has(eventName)) registry.set(eventName, new Map());
    registry.get(eventName).set(callback, wrapper);
    window.addEventListener(eventName, wrapper);
  }

  function off(eventName, callback) {
    const map = registry.get(eventName);
    if (!map) return;
    const wrapper = map.get(callback);
    if (wrapper) {
      window.removeEventListener(eventName, wrapper);
      map.delete(callback);
    }
  }

  function emit(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  return { on, off, emit };
})();

/* ===================== FORMATTERS ===================== */

/**
 * Format giá theo số thập phân phù hợp.
 * Giá càng nhỏ thì càng cần nhiều số lẻ (vd: SHIB, PEPE).
 */
function formatPrice(value) {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const num = Number(value);
  let decimals = 2;
  if (num < 1) decimals = 6;
  else if (num < 10) decimals = 4;
  else if (num < 1000) decimals = 2;
  else decimals = 2;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Alias dùng trong drawing.js để format giá trên đường ngang (giữ cùng quy tắc với formatPrice). */
function formatPriceLocal(value) {
  return formatPrice(value);
}

/**
 * Rút gọn volume lớn thành dạng K / M / B.
 */
function formatVolume(value) {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const num = Number(value);
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
}

/**
 * Format % thay đổi giá, kèm dấu +/-.
 */
function formatPercent(value) {
  if (value === null || value === undefined || isNaN(value)) return '--';
  const num = Number(value);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/**
 * Debounce: trì hoãn gọi hàm cho đến khi ngừng gọi trong khoảng `delay` ms.
 * Dùng cho ô tìm kiếm symbol.
 */
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Sinh 1 chuỗi id ngắn, dùng cho các nhu cầu phụ (không dùng để đặt tên
 * pane - pane id cố định là 'pane-1'..'pane-4', xem storage.js).
 */
function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Map timeframe hiển thị (UI) -> interval Binance API.
 * Lưu ý: Binance phân biệt hoa/thường - '1w' (tuần) viết thường,
 * '1M' (tháng) viết hoa M. Gõ sai hoa/thường sẽ khiến API trả lỗi 400.
 */
const TIMEFRAMES = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '20m', value: '20m' },   // mới - tổng hợp
  { label: '30m', value: '30m' },
  { label: '45m', value: '45m' },   // mới - tổng hợp
  { label: '1H', value: '1h' },
  { label: '2H', value: '2h' },
  { label: '3H', value: '3h' },     // mới - tổng hợp
  { label: '4H', value: '4h' },
  { label: '6H', value: '6h' },     // mới - native Binance
  { label: '8H', value: '8h' },     // mới - native Binance
  { label: '12H', value: '12h' },
  { label: '1D', value: '1d' },
  { label: '2D', value: '2d' },     // mới - tổng hợp
  { label: '3D', value: '3d' },
  { label: 'W', value: '1w' },
  { label: 'M', value: '1M' },
];

/* =====================================================================
 * KHUNG THỜI GIAN TỔNG HỢP (SYNTHETIC TIMEFRAMES)
 * Binance KHÔNG hỗ trợ native các khung: 20m, 45m, 3h, 2d. Ta tự dựng
 * bằng cách gộp N nến của 1 khung nhỏ hơn (base) thành 1 nến lớn hơn.
 *
 * QUY TẮC CANH MỐC (bucket alignment): epoch-aligned - bucketStart =
 * floor(t / bucketSeconds) * bucketSeconds - GIỐNG cách Binance tự canh
 * các khung gốc (vd 4h canh theo 00:00/04:00 UTC). countdown.js PHẢI
 * dùng đúng công thức Math.ceil tương ứng để không bị lệch.
 *
 * GIỚI HẠN QUAN TRỌNG: chỉ áp dụng cho symbol Binance (spot/futures).
 * Yahoo Finance KHÔNG hỗ trợ tổng hợp (interval của Yahoo do server-side
 * quyết định, không đi qua luồng này) - xem ghi chú trong api.js.
 * ===================================================================== */
const SYNTHETIC_TIMEFRAMES = {
  '20m': { base: '5m', baseSeconds: 5 * 60, factor: 4 },
  '45m': { base: '15m', baseSeconds: 15 * 60, factor: 3 },
  '3h':  { base: '1h', baseSeconds: 60 * 60, factor: 3 },
  '2d':  { base: '1d', baseSeconds: 24 * 60 * 60, factor: 2 },
};

function isSyntheticInterval(interval) {
  return Object.prototype.hasOwnProperty.call(SYNTHETIC_TIMEFRAMES, interval);
}

function getSyntheticInfo(interval) {
  return SYNTHETIC_TIMEFRAMES[interval] || null;
}

function getSyntheticBucketSeconds(interval) {
  const info = SYNTHETIC_TIMEFRAMES[interval];
  return info ? info.baseSeconds * info.factor : null;
}

/**
 * Gộp 1 mảng nến BASE (đã sort tăng dần theo time, dùng cho dữ liệu REST
 * lịch sử) thành mảng nến tổng hợp. Không dùng cho luồng realtime - xem
 * createSyntheticAggregator() bên dưới cho trường hợp đó (cần xử lý
 * volume của nến đang chạy khác hẳn, không được cộng dồn thô).
 */
function aggregateCandles(baseCandles, interval) {
  const info = SYNTHETIC_TIMEFRAMES[interval];
  if (!info) return baseCandles.slice();
  const bucketSeconds = info.baseSeconds * info.factor;

  const buckets = new Map();
  const order = [];

  baseCandles.forEach((c) => {
    const bucketStart = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    let agg = buckets.get(bucketStart);
    if (!agg) {
      agg = { time: bucketStart, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      buckets.set(bucketStart, agg);
      order.push(bucketStart);
    } else {
      agg.high = Math.max(agg.high, c.high);
      agg.low = Math.min(agg.low, c.low);
      agg.close = c.close; // yêu cầu baseCandles đến theo thứ tự thời gian tăng dần
      agg.volume += c.volume;
    }
  });

  return order.map((t) => buckets.get(t));
}

/**
 * Bộ GỘP NẾN TỔNG HỢP REALTIME - dùng ở websocket.js. Giữ 1 bucket đang
 * "chạy" và cập nhật dần theo từng nến base đến (kể cả nến base CHƯA
 * đóng - Binance gửi lại volume TÍCH LUỸ của base đó nhiều lần trước khi
 * đóng, KHÔNG được cộng dồn mỗi message).
 *
 * Cách xử lý volume đúng: lưu volume theo TỪNG base-index trong bucket
 * (Map idx -> volume mới nhất của base đó), tổng volume = sum toàn bộ
 * map. Message lặp lại cho cùng 1 idx chỉ THAY THẾ giá trị, không cộng.
 */
function createSyntheticAggregator(interval) {
  const info = SYNTHETIC_TIMEFRAMES[interval];
  if (!info) return null;
  const bucketSeconds = info.baseSeconds * info.factor;

  let bucketTime = null;
  let open = null, high = null, low = null, close = null;
  let baseVolumes = new Map(); // baseIndex -> volume của base đó (giá trị mới nhất)

  function totalVolume() {
    let sum = 0;
    baseVolumes.forEach((v) => { sum += v; });
    return sum;
  }

  /** Nạp trước dữ liệu lịch sử (REST) để bucket đang chạy có volume đúng
   *  ngay từ đầu, thay vì phải đợi tự tích luỹ lại từ 0 qua WebSocket.
   *  seedBaseVolume: tổng volume của các base ĐÃ ĐÓNG trong bucket này
   *  trước khi WS bắt đầu theo dõi - lưu dưới key -1 (không trùng idx
   *  thật 0..factor-1) nên không bao giờ bị ghi đè hay cộng trùng. */
  function seed(aggregatedCandle, seedBaseVolume) {
    bucketTime = aggregatedCandle.time;
    open = aggregatedCandle.open;
    high = aggregatedCandle.high;
    low = aggregatedCandle.low;
    close = aggregatedCandle.close;
    baseVolumes = new Map([[-1, seedBaseVolume]]);
  }

  function push(baseCandle) {
    const bStart = Math.floor(baseCandle.time / bucketSeconds) * bucketSeconds;
    const idx = Math.round((baseCandle.time - bStart) / info.baseSeconds);

    if (bucketTime !== bStart) {
      bucketTime = bStart;
      open = baseCandle.open;
      high = baseCandle.high;
      low = baseCandle.low;
      baseVolumes = new Map();
    } else {
      high = high === null ? baseCandle.high : Math.max(high, baseCandle.high);
      low = low === null ? baseCandle.low : Math.min(low, baseCandle.low);
    }
    close = baseCandle.close;
    baseVolumes.set(idx, baseCandle.volume);

    const isLastBaseOfBucket = idx === info.factor - 1;
    return {
      time: bucketTime,
      open, high, low, close,
      volume: totalVolume(),
      closed: !!baseCandle.closed && isLastBaseOfBucket,
    };
  }

  return { push, seed };
}