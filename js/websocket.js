/**
 * websocket.js
 * Dữ liệu realtime cho từng pane độc lập:
 *   - Binance (spot/futures): WebSocket.
 *   - OANDA (XAUUSD): HUB POLL GỘP THEO SYMBOL.
 *       + Mọi luồng OANDA của cùng 1 symbol (kline, htf, sl, 7 trend tham khảo
 *         của MỌI pane) đăng ký vào 1 hub; hub chạy theo LƯỚI thời gian
 *         (OANDA_GRID_MS) và mỗi nhịp chỉ bắn 1 request /api/oanda/live cho
 *         các luồng đã đến hạn -> Worker chỉ mở 1 WebSocket TradingView.
 *       + Giá/% thay đổi lấy từ quote đi kèm response (không poll ticker riêng).
 *       + Mọi khung (kể cả 3h/6h/12h/2d/3d) đều đi qua /live (Worker tự gộp).
 *       + Báo "disconnected" chỉ sau OANDA_FAIL_LIMIT lần lỗi liên tiếp, có
 *         backoff; tab ẩn thì tạm dừng; quay lại / sau lỗi thì xin thêm nến
 *         (catch-up) để lấp khoảng trống.
 *   - ĐÃ BỎ HOÀN TOÀN Yahoo.
 *
 * WATCHDOG chống "socket zombie" (Binance): mỗi 10s quét mọi luồng, luồng nào
 * im lặng quá ngưỡng (60s; trendref 25s) thì tự kết nối lại. OANDA bỏ qua.
 *
 * KHUNG TỔNG HỢP (20m/45m/3h/2d) trên Binance: subscribe khung BASE rồi gộp
 * qua createSyntheticAggregator() (utils.js) trước khi emit.
 */

function getWsUrlForProvider(provider, streamName) {
  if (provider === 'binance_futures') {
    return `wss://fstream.binance.com/ws/${streamName}`;
  }
  return `wss://stream.binance.com:9443/ws/${streamName}`;
}

const connections = new Map();

function getOrCreateEntry(paneId) {
  if (!connections.has(paneId)) {
    connections.set(paneId, {
      klineSocket: null,
      tickerSocket: null,
      htfKlineSocket: null,
      slKlineSocket: null,
      trendRefSockets: {}, // role -> WebSocket
      trendRefReconnectTimers: {}, // role -> timer
      intentionalClose: false,
      klineReconnectTimer: null,
      tickerReconnectTimer: null,
      htfReconnectTimer: null,
      slReconnectTimer: null,

      // OANDA: token huỷ lần lấy giá ban đầu (xem connectOandaTickerStream)
      oandaTickerToken: null,

      meta: { kline: null, ticker: null, htf: null, sl: null, trendref: {} },
      lastMessageAt: { kline: null, ticker: null, htf: null, sl: null, trendref: {} },
      aggregators: { kline: null, htf: null, sl: null, trendref: {} },
    });
  }
  return connections.get(paneId);
}

/** Chuyển 1 message kline Binance -> nến chuẩn. */
function parseBinanceKline(msg) {
  const k = msg.k;
  return {
    time: Math.floor(k.t / 1000),
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
    closed: k.x,
  };
}

function connectKlineStream(paneId, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  closeKlineSocket(paneId);

  const provider = getProviderFor(symbol);
  entry.meta.kline = { symbol, interval, provider };

  if (provider === 'oanda') {
    connectOandaKlineStream(paneId, symbol, interval);
    return;
  }

  const synthetic = isSyntheticInterval(interval);
  const wsInterval = synthetic ? getSyntheticInfo(interval).base : interval;
  entry.aggregators.kline = synthetic ? createSyntheticAggregator(interval) : null;

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const wsUrl = getWsUrlForProvider(provider, `${cleanSymbol}@kline_${wsInterval}`);
  const socket = new WebSocket(wsUrl);
  entry.klineSocket = socket;
  entry.lastMessageAt.kline = Date.now();

  socket.onopen = () => {
    EventBus.emit('ws:status', { paneId, status: 'connected' });
  };

  socket.onmessage = (event) => {
    entry.lastMessageAt.kline = Date.now();
    const baseCandle = parseBinanceKline(JSON.parse(event.data));
    const candle = entry.aggregators.kline ? entry.aggregators.kline.push(baseCandle) : baseCandle;
    EventBus.emit('kline:update', { paneId, candle });
  };

  socket.onerror = () => {
    EventBus.emit('ws:status', { paneId, status: 'disconnected' });
  };

  socket.onclose = () => {
    if (entry.klineSocket !== socket) return;
    if (!entry.intentionalClose) {
      EventBus.emit('ws:status', { paneId, status: 'disconnected' });
      entry.klineReconnectTimer = setTimeout(() => {
        connectKlineStream(paneId, symbol, interval);
      }, 2000);
    }
  };
}

function connectHigherTFKlineStream(paneId, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  closeHigherTFKlineSocket(paneId);

  const provider = getProviderFor(symbol);
  entry.meta.htf = { symbol, interval, provider };

  if (provider === 'oanda') {
    connectOandaHigherTF(paneId, symbol, interval);
    return;
  }

  const synthetic = isSyntheticInterval(interval);
  const wsInterval = synthetic ? getSyntheticInfo(interval).base : interval;
  entry.aggregators.htf = synthetic ? createSyntheticAggregator(interval) : null;

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const wsUrl = getWsUrlForProvider(provider, `${cleanSymbol}@kline_${wsInterval}`);
  const socket = new WebSocket(wsUrl);
  entry.htfKlineSocket = socket;
  entry.lastMessageAt.htf = Date.now();

  socket.onmessage = (event) => {
    entry.lastMessageAt.htf = Date.now();
    const baseCandle = parseBinanceKline(JSON.parse(event.data));
    const candle = entry.aggregators.htf ? entry.aggregators.htf.push(baseCandle) : baseCandle;
    EventBus.emit('kline:update:htf', { paneId, candle });
  };

  socket.onclose = () => {
    if (entry.htfKlineSocket !== socket) return;
    if (!entry.intentionalClose) {
      entry.htfReconnectTimer = setTimeout(() => {
        connectHigherTFKlineStream(paneId, symbol, interval);
      }, 2000);
    }
  };
}

function connectSLKlineStream(paneId, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  closeSLKlineSocket(paneId);

  const provider = getProviderFor(symbol);
  entry.meta.sl = { symbol, interval, provider };

  if (provider === 'oanda') {
    connectOandaSLTF(paneId, symbol, interval);
    return;
  }

  const synthetic = isSyntheticInterval(interval);
  const wsInterval = synthetic ? getSyntheticInfo(interval).base : interval;
  entry.aggregators.sl = synthetic ? createSyntheticAggregator(interval) : null;

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const wsUrl = getWsUrlForProvider(provider, `${cleanSymbol}@kline_${wsInterval}`);
  const socket = new WebSocket(wsUrl);
  entry.slKlineSocket = socket;
  entry.lastMessageAt.sl = Date.now();

  socket.onmessage = (event) => {
    entry.lastMessageAt.sl = Date.now();
    const baseCandle = parseBinanceKline(JSON.parse(event.data));
    const candle = entry.aggregators.sl ? entry.aggregators.sl.push(baseCandle) : baseCandle;
    EventBus.emit('kline:update:sl', { paneId, candle });
  };

  socket.onclose = () => {
    if (entry.slKlineSocket !== socket) return;
    if (!entry.intentionalClose) {
      entry.slReconnectTimer = setTimeout(() => {
        connectSLKlineStream(paneId, symbol, interval);
      }, 2000);
    }
  };
}

function connectTrendRefKlineStream(paneId, role, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  closeTrendRefKlineSocket(paneId, role);

  const provider = getProviderFor(symbol);
  entry.meta.trendref[role] = { symbol, interval, provider };

  if (provider === 'oanda') {
    connectOandaTrendRef(paneId, role, symbol, interval);
    return;
  }

  const synthetic = isSyntheticInterval(interval);
  const wsInterval = synthetic ? getSyntheticInfo(interval).base : interval;
  entry.aggregators.trendref[role] = synthetic ? createSyntheticAggregator(interval) : null;

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const wsUrl = getWsUrlForProvider(provider, `${cleanSymbol}@kline_${wsInterval}`);
  const socket = new WebSocket(wsUrl);
  entry.trendRefSockets[role] = socket;
  entry.lastMessageAt.trendref[role] = Date.now();

  socket.onmessage = (event) => {
    entry.lastMessageAt.trendref[role] = Date.now();
    const baseCandle = parseBinanceKline(JSON.parse(event.data));
    const agg = entry.aggregators.trendref[role];
    const candle = agg ? agg.push(baseCandle) : baseCandle;
    EventBus.emit('kline:update:trendref', { paneId, role, candle });
  };

  socket.onclose = () => {
    if (entry.trendRefSockets[role] !== socket) return;
    if (!entry.intentionalClose) {
      entry.trendRefReconnectTimers[role] = setTimeout(() => {
        connectTrendRefKlineStream(paneId, role, symbol, interval);
      }, 2000);
    }
  };
}

function connectTickerStream(paneId, symbol) {
  const entry = getOrCreateEntry(paneId);
  closeTickerSocket(paneId);

  const provider = getProviderFor(symbol);
  entry.meta.ticker = { symbol, provider };

  if (provider === 'oanda') {
    connectOandaTickerStream(paneId, symbol);
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const wsUrl = getWsUrlForProvider(provider, `${cleanSymbol}@ticker`);
  const socket = new WebSocket(wsUrl);
  entry.tickerSocket = socket;
  entry.lastMessageAt.ticker = Date.now();

  socket.onmessage = (event) => {
    entry.lastMessageAt.ticker = Date.now();
    const msg = JSON.parse(event.data);
    EventBus.emit('price:update', {
      paneId,
      price: parseFloat(msg.c),
      changePercent: parseFloat(msg.P),
    });
  };

  socket.onclose = () => {
    if (entry.tickerSocket !== socket) return;
    if (!entry.intentionalClose) {
      entry.tickerReconnectTimer = setTimeout(() => connectTickerStream(paneId, symbol), 2000);
    }
  };
}

/* =====================================================================
 * OANDA: HUB POLL GỘP THEO SYMBOL
 * ===================================================================== */

// Nhịp lưới 1s. Mọi chu kỳ là BỘI SỐ của nhịp này nên các luồng đến hạn cùng lúc
// vẫn gộp thành 1 request.
const OANDA_GRID_MS = 1000;
const OANDA_PERIOD_KLINE_FAST = 1000;   // ô ĐANG CHỌN: 1s
const OANDA_PERIOD_KLINE_SLOW = 3000;   // các ô khác: 3s
const OANDA_PERIOD_HTF_SL = 9000;       // khung cao / khung SL (như cũ)
const OANDA_PERIOD_TREND_FAST = 15000;  // trend m5/m15/m30 (như cũ)
const OANDA_PERIOD_TREND_SLOW = 30000;  // trend khung lớn (như cũ)
const OANDA_BACKOFF_BASE_MS = 3000;     // nền cho backoff khi lỗi (trước đây dùng chung OANDA_GRID_MS)

const OANDA_FAIL_LIMIT = 3; // số lần lỗi LIÊN TIẾP mới báo "mất kết nối"
const OANDA_BACKOFF_MAX_MS = 30000;
const OANDA_CATCHUP_BARS = 60; // số nến xin lại sau lỗi / sau khi tab ẩn lâu
const OANDA_CATCHUP_AFTER_HIDDEN_MS = 20000;

const oandaHubs = new Map(); // symbol -> hub
let oandaHiddenAt = null;

/** Mốc lưới kế tiếp (ms epoch) tính từ `now`. */
function oandaNextGrid(now) {
  return Math.floor(now / OANDA_GRID_MS) * OANDA_GRID_MS + OANDA_GRID_MS;
}

function oandaGetHub(symbol) {
  let hub = oandaHubs.get(symbol);
  if (!hub) {
    hub = {
      symbol,
      subs: new Map(), // id -> sub
      timer: null,
      running: false,
      fails: 0,
      skipUntil: 0,
      down: false,
      catchup: false,
    };
    oandaHubs.set(symbol, hub);
  }
  return hub;
}

function oandaSchedule(hub) {
  if (hub.timer || hub.running) return;
  const now = Date.now();
  let delay = OANDA_GRID_MS - (now % OANDA_GRID_MS) + 30;
  if (hub.skipUntil > now) delay = Math.max(delay, hub.skipUntil - now);
  hub.timer = setTimeout(() => oandaTick(hub), delay);
}

/** Bắt hub chạy ngay (vd. tab vừa hiện lại): mọi luồng thành "đến hạn". */
function oandaKick(hub) {
  if (hub.running) return;
  hub.skipUntil = 0;
  hub.subs.forEach((s) => {
    s.nextAt = 0;
  });
  clearTimeout(hub.timer);
  hub.timer = setTimeout(() => oandaTick(hub), 150);
}

function oandaEmitKlineStatus(hub, status) {
  hub.subs.forEach((s) => {
    if (s.key !== 'kline') return;
    s.statusSent = status === 'connected';
    EventBus.emit('ws:status', { paneId: s.paneId, status });
  });
}

async function oandaTick(hub) {
  hub.timer = null;
  if (oandaHubs.get(hub.symbol) !== hub) return;
  if (hub.subs.size === 0) {
    oandaHubs.delete(hub.symbol);
    return;
  }
  if (document.visibilityState === 'hidden') {
    oandaSchedule(hub);
    return;
  }

  const now = Date.now();
  const due = [...hub.subs.values()].filter((s) => s.nextAt <= now);
  if (due.length === 0) {
    oandaSchedule(hub);
    return;
  }

  hub.running = true;
  const catchup = hub.catchup;
  const intervals = [...new Set(due.map((s) => s.interval))];

  try {
    const data = await fetchOandaLiveMulti(hub.symbol, intervals, catchup ? OANDA_CATCHUP_BARS : 3);
    if (oandaHubs.get(hub.symbol) !== hub) return;

    hub.fails = 0;
    hub.skipUntil = 0;
    hub.catchup = false;
    hub.down = false;

    const quote = data && data.__quote ? data.__quote : null;
    const after = Date.now();

    due.forEach((s) => {
      if (hub.subs.get(s.id) !== s) return; // đã huỷ trong lúc chờ
      s.nextAt = oandaNextGrid(after) + s.periodMs - OANDA_GRID_MS;

      const all = Array.isArray(data && data[s.interval]) ? data[s.interval] : [];
      const changed = [];
      all.forEach((bar) => {
        const sig = `${bar.open}|${bar.high}|${bar.low}|${bar.close}|${bar.volume}`;
        if (s.seen.get(bar.time) !== sig) {
          s.seen.set(bar.time, sig);
          changed.push(bar);
        }
      });
      while (s.seen.size > 200) s.seen.delete(s.seen.keys().next().value);

      if (all.length === 0 && !quote) return;
      try {
        s.onUpdate(changed, quote, all);
      } catch (err) {
        console.error(`[oanda-hub] lỗi xử lý ${s.id}:`, err);
      }

      if (s.key === 'kline' && !s.statusSent && all.length > 0) {
        s.statusSent = true;
        EventBus.emit('ws:status', { paneId: s.paneId, status: 'connected' });
      }
    });
  } catch (err) {
    if (oandaHubs.get(hub.symbol) === hub) {
      hub.fails++;
      hub.catchup = true; // lần thành công kế tiếp xin thêm nến để lấp khoảng trống
      hub.skipUntil = Date.now() + Math.min(OANDA_BACKOFF_BASE_MS * Math.pow(2, hub.fails - 1), OANDA_BACKOFF_MAX_MS);
      console.warn(`[oanda-hub] ${hub.symbol} lỗi lần ${hub.fails}:`, err && err.message ? err.message : err);
      if (hub.fails >= OANDA_FAIL_LIMIT && !hub.down) {
        hub.down = true;
        oandaEmitKlineStatus(hub, 'disconnected');
      }
    }
  } finally {
    hub.running = false;
    if (oandaHubs.get(hub.symbol) === hub) oandaSchedule(hub);
  }
}

/**
 * Đăng ký 1 luồng vào hub của symbol.
 * onUpdate(changedBars, quote|null, allBars): gọi mỗi khi luồng đến hạn và có dữ liệu.
 */
const OANDA_CLIENT_SYNTH = new Set(['10m', '2w']);   // khung Worker không có -> tự gộp từ khung base

function oandaSubscribe(paneId, key, symbol, interval, periodMs, onUpdate) {
  oandaUnsubscribe(paneId, key);

  let fetchInterval = interval;
  if (OANDA_CLIENT_SYNTH.has(interval)) {
    const info = getSyntheticInfo(interval);
    const agg = createSyntheticAggregator(interval);
    fetchInterval = info.base;
    const inner = onUpdate;
    onUpdate = (changed, quote, all) => {
      // nến base đến theo thứ tự thời gian -> gộp dần thành nến 10m
      const merged = changed.map((b) => agg.push(b));
      inner(merged, quote, all);
    };
  }

  const hub = oandaGetHub(symbol);
  const id = `${paneId}|${key}`;
  hub.subs.set(id, {
    id,
    paneId,
    key,
    interval: fetchInterval,   // hub hỏi Worker khung base
    periodMs,
    onUpdate,
    seen: new Map(),
    statusSent: false,
    nextAt: oandaNextGrid(Date.now()) + periodMs - OANDA_GRID_MS,
  });
  oandaSchedule(hub);
}

function oandaUnsubscribe(paneId, key) {
  const id = `${paneId}|${key}`;
  oandaHubs.forEach((hub, symbol) => {
    if (hub.subs.delete(id) && hub.subs.size === 0) {
      clearTimeout(hub.timer);
      hub.timer = null;
      oandaHubs.delete(symbol);
    }
  });
}

/** Ô đang chọn poll nhanh (1s), các ô khác poll chậm (3s). */
function oandaKlinePeriodFor(paneId) {
  const active = Store.getState().activePaneId;
  return paneId === active ? OANDA_PERIOD_KLINE_FAST : OANDA_PERIOD_KLINE_SLOW;
}

/** Đổi ô đang chọn -> chỉnh lại nhịp ngay, không phải tải lại luồng. */
function oandaRetuneKlinePeriods() {
  oandaHubs.forEach((hub) => {
    hub.subs.forEach((s) => {
      if (s.key !== 'kline') return;
      const p = oandaKlinePeriodFor(s.paneId);
      if (p === s.periodMs) return;
      s.periodMs = p;
      if (p === OANDA_PERIOD_KLINE_FAST) s.nextAt = 0; // vừa thành ô đang chọn -> lấy ngay nhịp tới
    });
  });
}
EventBus.on('pane:focused', oandaRetuneKlinePeriods);

function connectOandaKlineStream(paneId, symbol, interval) {
  EventBus.emit('ws:status', { paneId, status: 'connecting' });
  oandaSubscribe(paneId, 'kline', symbol, interval, oandaKlinePeriodFor(paneId), (changed, quote, all) => {
    changed.forEach((candle) => EventBus.emit('kline:update', { paneId, candle }));

    const last = all.length ? all[all.length - 1] : null;
    const price = quote && Number.isFinite(quote.lastPrice) ? quote.lastPrice : last ? last.close : null;
    if (price === null || price === undefined) return;
    EventBus.emit('price:update', {
      paneId,
      price,
      changePercent: quote && Number.isFinite(quote.changePercent) ? quote.changePercent : undefined,
      bid: quote ? quote.bid : undefined,
      ask: quote ? quote.ask : undefined,
    });
  });
}

function connectOandaHigherTF(paneId, symbol, interval) {
  oandaSubscribe(paneId, 'htf', symbol, interval, OANDA_PERIOD_HTF_SL, (changed) =>
    changed.forEach((candle) => EventBus.emit('kline:update:htf', { paneId, candle }))
  );
}

function connectOandaSLTF(paneId, symbol, interval) {
  oandaSubscribe(paneId, 'sl', symbol, interval, OANDA_PERIOD_HTF_SL, (changed) =>
    changed.forEach((candle) => EventBus.emit('kline:update:sl', { paneId, candle }))
  );
}

const OANDA_TREND_FAST = new Set(['1m', '3m', '5m', '15m', '30m']);

function connectOandaTrendRef(paneId, role, symbol, interval) {
  const period = OANDA_TREND_FAST.has(interval) ? OANDA_PERIOD_TREND_FAST : OANDA_PERIOD_TREND_SLOW;
  oandaSubscribe(paneId, 'tr:' + role, symbol, interval, period, (changed) =>
    changed.forEach((candle) => EventBus.emit('kline:update:trendref', { paneId, role, candle }))
  );
}

/**
 * Giá ban đầu của OANDA: lấy 1 lần (thử lại tối đa 3 lần). Sau đó giá + % do
 * hub cập nhật qua quote trong /live (không còn poll ticker riêng).
 */
function connectOandaTickerStream(paneId, symbol) {
  const entry = getOrCreateEntry(paneId);
  const token = {};
  entry.oandaTickerToken = token;

  const attempt = async (n) => {
    if (entry.oandaTickerToken !== token) return;
    try {
      const t = await fetch24hTicker(symbol);
      if (entry.oandaTickerToken !== token) return;
      if (t && typeof t.lastPrice === 'number' && !Number.isNaN(t.lastPrice)) {
        EventBus.emit('price:update', {
          paneId,
          price: t.lastPrice,
          changePercent: t.changePercent,
          bid: t.bid,
          ask: t.ask,
        });
      }
    } catch (err) {
      if (n < 3) setTimeout(() => attempt(n + 1), 2500);
    }
  };
  attempt(1);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      oandaHiddenAt = Date.now();
      return;
    }
    const hiddenFor = oandaHiddenAt ? Date.now() - oandaHiddenAt : 0;
    oandaHiddenAt = null;
    if (hiddenFor > 5000) {
      oandaHubs.forEach((hub) => {
        if (hiddenFor > OANDA_CATCHUP_AFTER_HIDDEN_MS) hub.catchup = true;
        oandaKick(hub);
      });
    }
  });
}

/* ===================== TEARDOWN & SOCKET CLOSURES ===================== */

function closeTrendRefKlineSocket(paneId, role) {
  oandaUnsubscribe(paneId, 'tr:' + role);
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.trendRefReconnectTimers[role]);
  delete entry.meta.trendref[role];
  delete entry.lastMessageAt.trendref[role];
  delete entry.aggregators.trendref[role];

  const sock = entry.trendRefSockets[role];
  if (sock) {
    entry.intentionalClose = true;
    sock.onclose = null;
    sock.close();
    entry.trendRefSockets[role] = null;
    entry.intentionalClose = false;
  }
}

function closeAllTrendRefKlineSockets(paneId) {
  const entry = connections.get(paneId);
  if (!entry) return;
  const roles = new Set([...Object.keys(entry.trendRefSockets), ...Object.keys(entry.meta.trendref)]);
  roles.forEach((role) => closeTrendRefKlineSocket(paneId, role));
}

function closeKlineSocket(paneId) {
  oandaUnsubscribe(paneId, 'kline');
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.klineReconnectTimer);
  entry.meta.kline = null;
  entry.lastMessageAt.kline = null;
  entry.aggregators.kline = null;

  if (entry.klineSocket) {
    entry.intentionalClose = true;
    entry.klineSocket.onclose = null;
    entry.klineSocket.close();
    entry.klineSocket = null;
    entry.intentionalClose = false;
  }
}

function closeHigherTFKlineSocket(paneId) {
  oandaUnsubscribe(paneId, 'htf');
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.htfReconnectTimer);
  entry.meta.htf = null;
  entry.lastMessageAt.htf = null;
  entry.aggregators.htf = null;

  if (entry.htfKlineSocket) {
    entry.intentionalClose = true;
    entry.htfKlineSocket.onclose = null;
    entry.htfKlineSocket.close();
    entry.htfKlineSocket = null;
    entry.intentionalClose = false;
  }
}

function closeSLKlineSocket(paneId) {
  oandaUnsubscribe(paneId, 'sl');
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.slReconnectTimer);
  entry.meta.sl = null;
  entry.lastMessageAt.sl = null;
  entry.aggregators.sl = null;

  if (entry.slKlineSocket) {
    entry.intentionalClose = true;
    entry.slKlineSocket.onclose = null;
    entry.slKlineSocket.close();
    entry.slKlineSocket = null;
    entry.intentionalClose = false;
  }
}

function closeTickerSocket(paneId) {
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.tickerReconnectTimer);
  entry.oandaTickerToken = null;
  entry.meta.ticker = null;
  entry.lastMessageAt.ticker = null;

  if (entry.tickerSocket) {
    entry.intentionalClose = true;
    entry.tickerSocket.onclose = null;
    entry.tickerSocket.close();
    entry.tickerSocket = null;
    entry.intentionalClose = false;
  }
}

/**
 * Đóng các luồng của CHART (kline, htf, sl, ticker) nhưng GIỮ trend tham khảo.
 * Dùng khi đổi symbol/timeframe: trend tham khảo có đường tải lại riêng
 * (đổi symbol) hoặc không cần đổi (chỉ đổi timeframe).
 */
function closePaneChartSockets(paneId) {
  closeKlineSocket(paneId);
  closeHigherTFKlineSocket(paneId);
  closeSLKlineSocket(paneId);
  closeTickerSocket(paneId);
}

function closePaneSockets(paneId) {
  closePaneChartSockets(paneId);
  closeAllTrendRefKlineSockets(paneId);
  connections.delete(paneId);
}

function closeAllSockets() {
  Array.from(connections.keys()).forEach(closePaneSockets);
}

function connectSockets(paneId, symbol, timeframe) {
  connectKlineStream(paneId, symbol, timeframe);
  connectTickerStream(paneId, symbol);
}

/* =====================================================================
 * WATCHDOG CHỐNG "SOCKET ZOMBIE" (chỉ áp dụng cho WebSocket Binance)
 * ===================================================================== */

const STALE_THRESHOLD_MS = 60 * 1000;
const STALE_THRESHOLD_MS_TRENDREF = 25 * 1000;
const WATCHDOG_INTERVAL_MS = 10 * 1000;

function getStaleThreshold(key) {
  return key.indexOf('trendref:') === 0 ? STALE_THRESHOLD_MS_TRENDREF : STALE_THRESHOLD_MS;
}

function forceReconnectStaleStream(paneId, key) {
  const entry = connections.get(paneId);
  if (!entry) return;

  if (key === 'kline' && entry.meta.kline) {
    const m = entry.meta.kline;
    connectKlineStream(paneId, m.symbol, m.interval);
  } else if (key === 'ticker' && entry.meta.ticker) {
    const m = entry.meta.ticker;
    connectTickerStream(paneId, m.symbol);
  } else if (key === 'htf' && entry.meta.htf) {
    const m = entry.meta.htf;
    connectHigherTFKlineStream(paneId, m.symbol, m.interval);
  } else if (key === 'sl' && entry.meta.sl) {
    const m = entry.meta.sl;
    connectSLKlineStream(paneId, m.symbol, m.interval);
  } else if (key.indexOf('trendref:') === 0) {
    const role = key.slice('trendref:'.length);
    const m = entry.meta.trendref[role];
    if (m) connectTrendRefKlineStream(paneId, role, m.symbol, m.interval);
  }
}

function checkStreamStaleness(paneId, key, meta, lastAt, now) {
  if (!meta || meta.provider === 'oanda') return;
  if (!lastAt) return;
  const threshold = getStaleThreshold(key);
  if (now - lastAt > threshold) {
    console.warn(
      `[ws-watchdog] Pane "${paneId}" - luồng "${key}" im lặng ${Math.round((now - lastAt) / 1000)}s ` +
        `(ngưỡng ${threshold / 1000}s) - tự động kết nối lại.`
    );
    forceReconnectStaleStream(paneId, key);
  }
}

/** Ép kết nối lại NGAY các luồng trend tham khảo của 1 pane (nút 🔄 ở marketstatus.js). */
function forceReconnectPaneTrendRef(paneId) {
  const entry = connections.get(paneId);
  if (!entry) return;
  Object.keys(entry.meta.trendref).forEach((role) => {
    forceReconnectStaleStream(paneId, `trendref:${role}`);
  });
}

function runStaleWatchdog() {
  const now = Date.now();
  connections.forEach((entry, paneId) => {
    checkStreamStaleness(paneId, 'kline', entry.meta.kline, entry.lastMessageAt.kline, now);
    checkStreamStaleness(paneId, 'ticker', entry.meta.ticker, entry.lastMessageAt.ticker, now);
    checkStreamStaleness(paneId, 'htf', entry.meta.htf, entry.lastMessageAt.htf, now);
    checkStreamStaleness(paneId, 'sl', entry.meta.sl, entry.lastMessageAt.sl, now);
    Object.keys(entry.meta.trendref).forEach((role) => {
      checkStreamStaleness(
        paneId,
        `trendref:${role}`,
        entry.meta.trendref[role],
        entry.lastMessageAt.trendref[role],
        now
      );
    });
  });
}

setInterval(runStaleWatchdog, WATCHDOG_INTERVAL_MS);

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runStaleWatchdog();
    }
  });
}