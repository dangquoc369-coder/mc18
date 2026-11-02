/**
 * websocket.js
 * Dữ liệu realtime cho từng pane độc lập:
 *   - Binance (spot/futures): WebSocket.
 *   - OANDA (XAUUSD): polling gộp - 1 timer / luồng, mỗi nhịp 1 request, các
 *     khung cùng symbol được gộp vào 1 request /api/oanda/live (api.js) nên
 *     Worker chỉ mở 1 WebSocket TradingView cho tất cả.
 *   - ĐÃ BỎ HOÀN TOÀN Yahoo.
 *
 * ĐỢT TỐI ƯU:
 *   - OANDA: tab ẩn (visibilityState hidden) -> tạm dừng poll; cờ `busy` chống
 *     request chồng nhau; vòng đầu KHÔNG poll ngay (dữ liệu vừa được tải xong).
 *   - Poll kline OANDA phát changePercent = undefined để Store GIỮ nguyên %
 *     thay đổi (trước đây phát null làm mất %).
 *
 * WATCHDOG chống "socket zombie" (Binance): mỗi 10s quét mọi luồng, luồng nào
 * im lặng quá ngưỡng (60s; trendref 25s) thì tự kết nối lại; kiểm tra ngay khi
 * tab hiện lại. OANDA (polling) được bỏ qua trong watchdog.
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

      // OANDA: key -> setInterval id (kline | htf | sl | ticker | tr:<role>)
      oanda: {},

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

/* ===================== OANDA: 1 TIMER / LUỒNG, GỘP REQUEST ===================== */

// Khung KHÔNG có sẵn trên TradingView (Worker tự gộp) -> không đi qua /live.
const OANDA_NON_LIVE = new Set(['6h', '8h', '12h', '3d']);

/** Nến cuối của 1 khung OANDA: native -> /live (gộp 1 WS); tổng hợp -> REST thường. */
async function oandaLastCandle(symbol, interval) {
  if (isSyntheticInterval(interval) || OANDA_NON_LIVE.has(interval)) {
    const c = await fetchKlines(symbol, interval, 3);
    return c[c.length - 1];
  }
  const bars = await fetchOandaLive(symbol, interval);
  return bars[bars.length - 1];
}

/**
 * Khởi động 1 vòng poll OANDA. KHÔNG poll ngay lần đầu (dữ liệu vừa được tải
 * bằng REST), chỉ bắt đầu sau `periodMs`. Tab ẩn -> bỏ qua nhịp.
 */
function startOandaLoop(paneId, key, symbol, interval, periodMs, onCandle) {
  const entry = getOrCreateEntry(paneId);
  clearOandaLoop(entry, key);

  let busy = false;
  const poll = async () => {
    if (busy || document.visibilityState === 'hidden') return;
    busy = true;
    try {
      const c = await oandaLastCandle(symbol, interval);
      if (c) onCandle(c);
    } catch (err) {
      if (key === 'kline') EventBus.emit('ws:status', { paneId, status: 'disconnected' });
    } finally {
      busy = false;
    }
  };
  entry.oanda[key] = setInterval(poll, periodMs);
}

function clearOandaLoop(entry, key) {
  if (entry.oanda && entry.oanda[key]) {
    clearInterval(entry.oanda[key]);
    delete entry.oanda[key];
  }
}

function connectOandaKlineStream(paneId, symbol, interval) {
  startOandaLoop(paneId, 'kline', symbol, interval, 4000, (candle) => {
    EventBus.emit('kline:update', { paneId, candle });
    EventBus.emit('price:update', { paneId, price: candle.close, changePercent: undefined });
    EventBus.emit('ws:status', { paneId, status: 'connected' });
  });
  EventBus.emit('ws:status', { paneId, status: 'connected' });
}

function connectOandaHigherTF(paneId, symbol, interval) {
  startOandaLoop(paneId, 'htf', symbol, interval, 10000, (candle) =>
    EventBus.emit('kline:update:htf', { paneId, candle })
  );
}

function connectOandaSLTF(paneId, symbol, interval) {
  startOandaLoop(paneId, 'sl', symbol, interval, 10000, (candle) =>
    EventBus.emit('kline:update:sl', { paneId, candle })
  );
}

function connectOandaTrendRef(paneId, role, symbol, interval) {
  startOandaLoop(paneId, 'tr:' + role, symbol, interval, 15000, (candle) =>
    EventBus.emit('kline:update:trendref', { paneId, role, candle })
  );
}

function connectOandaTickerStream(paneId, symbol) {
  const entry = getOrCreateEntry(paneId);
  clearOandaLoop(entry, 'ticker');

  const poll = async () => {
    if (document.visibilityState === 'hidden') return;
    try {
      const t = await fetch24hTicker(symbol);
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
      /* bỏ qua - nhịp sau thử lại */
    }
  };

  poll(); // giá hiển thị ngay (app.js không tải ticker riêng cho OANDA)
  entry.oanda.ticker = setInterval(poll, 5000);
}

/* ===================== TEARDOWN & SOCKET CLOSURES ===================== */

function closeTrendRefKlineSocket(paneId, role) {
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.trendRefReconnectTimers[role]);
  clearOandaLoop(entry, 'tr:' + role);
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
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.klineReconnectTimer);
  clearOandaLoop(entry, 'kline');
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
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.htfReconnectTimer);
  clearOandaLoop(entry, 'htf');
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
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.slReconnectTimer);
  clearOandaLoop(entry, 'sl');
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
  clearOandaLoop(entry, 'ticker');
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

function closePaneSockets(paneId) {
  closeKlineSocket(paneId);
  closeHigherTFKlineSocket(paneId);
  closeSLKlineSocket(paneId);
  closeTickerSocket(paneId);
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