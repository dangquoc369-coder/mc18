/**
 * websocket.js
 * Quản lý kết nối WebSocket realtime tới Binance HOẶC Polling tới Yahoo Finance cho từng pane độc lập.
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
      trendRefSockets: {},          // role -> WebSocket
      trendRefReconnectTimers: {},  // role -> timer
      intentionalClose: false,
      klineReconnectTimer: null,
      tickerReconnectTimer: null,
      htfReconnectTimer: null,
      slReconnectTimer: null,

      // Yahoo Polling Timers
      yahooPollTimer: null,
      yahooHtfTimer: null,
      yahooSlTimer: null,
      yahooTrendRefTimers: {},       // role -> timer
    });
  }
  return connections.get(paneId);
}

function connectKlineStream(paneId, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  closeKlineSocket(paneId);

  const provider = getProviderFor(symbol);
  if (provider === 'yahoo') {
    connectYahooKlineStream(paneId, symbol, interval);
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@kline_${interval}`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
  const socket = new WebSocket(wsUrl);
  entry.klineSocket = socket;

  socket.onopen = () => {
    EventBus.emit('ws:status', { paneId, status: 'connected' });
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const k = msg.k;
    const candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      closed: k.x,
    };
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
  if (provider === 'yahoo') {
    connectYahooHigherTF(paneId, symbol, interval);
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@kline_${interval}`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
  const socket = new WebSocket(wsUrl);
  entry.htfKlineSocket = socket;

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const k = msg.k;
    const candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      closed: k.x,
    };
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
  if (provider === 'yahoo') {
    connectYahooSLTF(paneId, symbol, interval);
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@kline_${interval}`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
  const socket = new WebSocket(wsUrl);
  entry.slKlineSocket = socket;

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const k = msg.k;
    const candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      closed: k.x,
    };
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
  if (provider === 'yahoo') {
    connectYahooTrendRef(paneId, role, symbol, interval);
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@kline_${interval}`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
  const socket = new WebSocket(wsUrl);
  entry.trendRefSockets[role] = socket;

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const k = msg.k;
    const candle = {
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      closed: k.x,
    };
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
  if (provider === 'yahoo') {
    // Yahoo uses the primary kline polling loop to emit ticker events, so we do nothing here.
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@ticker`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
  const socket = new WebSocket(wsUrl);
  entry.tickerSocket = socket;

  socket.onmessage = (event) => {
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

/* ===================== YAHOO POLLING IMPLEMENTATION ===================== */

function connectYahooKlineStream(paneId, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  
  const poll = async () => {
    try {
      const candles = await fetchKlines(symbol, interval, 5);
      if (candles && candles.length > 0) {
        const liveCandle = candles[candles.length - 1];
        // Emit Kline update
        EventBus.emit('kline:update', { paneId, candle: liveCandle });
        // Emit price update
        EventBus.emit('price:update', {
          paneId,
          price: liveCandle.close,
          changePercent: null, // UI will calculate or display formatted value
        });
        EventBus.emit('ws:status', { paneId, status: 'connected' });
      }
    } catch (err) {
      console.warn(`Yahoo poll kline error (${paneId}):`, err);
      EventBus.emit('ws:status', { paneId, status: 'disconnected' });
    }
  };

  // Initial poll and set interval
  poll();
  entry.yahooPollTimer = setInterval(poll, 8000);
  EventBus.emit('ws:status', { paneId, status: 'connected' });
}

function connectYahooHigherTF(paneId, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  
  const poll = async () => {
    try {
      const candles = await fetchKlines(symbol, interval, 5);
      if (candles && candles.length > 0) {
        EventBus.emit('kline:update:htf', { paneId, candle: candles[candles.length - 1] });
      }
    } catch (err) {
      console.warn(`Yahoo poll HTF error (${paneId}):`, err);
    }
  };

  poll();
  entry.yahooHtfTimer = setInterval(poll, 12000);
}

function connectYahooSLTF(paneId, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  
  const poll = async () => {
    try {
      const candles = await fetchKlines(symbol, interval, 5);
      if (candles && candles.length > 0) {
        EventBus.emit('kline:update:sl', { paneId, candle: candles[candles.length - 1] });
      }
    } catch (err) {
      console.warn(`Yahoo poll SL error (${paneId}):`, err);
    }
  };

  poll();
  entry.yahooSlTimer = setInterval(poll, 12000);
}

function connectYahooTrendRef(paneId, role, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  
  const poll = async () => {
    try {
      const candles = await fetchKlines(symbol, interval, 5);
      if (candles && candles.length > 0) {
        EventBus.emit('kline:update:trendref', { paneId, role, candle: candles[candles.length - 1] });
      }
    } catch (err) {
      console.warn(`Yahoo poll TrendRef ${role} error (${paneId}):`, err);
    }
  };

  poll();
  entry.yahooTrendRefTimers[role] = setInterval(poll, 15000);
}

/* ===================== TEARDOWN & SOCKET CLOSURES ===================== */

function closeTrendRefKlineSocket(paneId, role) {
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.trendRefReconnectTimers[role]);
  clearInterval(entry.yahooTrendRefTimers[role]);
  delete entry.yahooTrendRefTimers[role];

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
  Object.keys(entry.trendRefSockets).forEach((role) => closeTrendRefKlineSocket(paneId, role));
  Object.keys(entry.yahooTrendRefTimers).forEach((role) => closeTrendRefKlineSocket(paneId, role));
}

function closeKlineSocket(paneId) {
  const entry = connections.get(paneId);
  if (!entry) return;
  clearTimeout(entry.klineReconnectTimer);
  clearInterval(entry.yahooPollTimer);
  entry.yahooPollTimer = null;

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
  clearInterval(entry.yahooHtfTimer);
  entry.yahooHtfTimer = null;

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
  clearInterval(entry.yahooSlTimer);
  entry.yahooSlTimer = null;

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
