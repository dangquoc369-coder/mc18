/**
 * websocket.js
 * Quản lý kết nối WebSocket realtime tới Binance HOẶC Polling tới Yahoo Finance cho từng pane độc lập.
 *
 * ============================================================================
 * CẬP NHẬT (đợt fix "Trend Scalp/trạng thái thị trường bị đứng hình"):
 *
 *   TRIỆU CHỨNG: trạng thái thị trường (đặc biệt Trend Scalp - dùng nến M5)
 *   nhiều lúc không cập nhật trong thời gian dài; bấm nút 🔄 reload ở panel
 *   Trạng thái thị trường KHÔNG có tác dụng; chỉ có ĐỔI SYMBOL mới thấy cập
 *   nhật lại.
 *
 *   NGUYÊN NHÂN: nút reload ở marketstatus.js chỉ tính lại
 *   (TrendReferenceModule.compute()) từ dữ liệu ĐANG CÓ SẴN trong bộ nhớ -
 *   nó không đụng gì tới WebSocket cả. Nếu 1 socket bị "zombie" (kết nối
 *   TCP/WS về mặt kỹ thuật vẫn "mở" nhưng không còn nhận được message nào
 *   nữa - cực kỳ hay gặp trên điện thoại khi khoá màn hình/chuyển app nền,
 *   đổi giữa wifi và 4G, mạng chập chờn...) thì sự kiện `onclose` của trình
 *   duyệt CÓ THỂ KHÔNG BAO GIỜ được bắn ra -> logic tự kết nối lại (vốn chỉ
 *   chạy trong onclose) không bao giờ được kích hoạt -> dữ liệu đứng im
 *   VĨNH VIỄN cho tới khi có 1 hành động ép đóng+mở lại toàn bộ socket, mà
 *   trong app này chỉ có việc ĐỔI SYMBOL mới làm vậy (xem
 *   closeAllTrendRefKlineSockets()/connectSockets() trong app.js).
 *
 *   GIẢI PHÁP - "watchdog" phát hiện socket im lặng bất thường:
 *     - Mỗi luồng (kline/ticker/htf/sl/mỗi khung trend tham khảo) đều được
 *       ghi lại mốc thời gian NHẬN MESSAGE GẦN NHẤT (lastMessageAt) và thông
 *       tin cần thiết để tự kết nối lại (meta: symbol/interval/provider).
 *     - runStaleWatchdog() chạy định kỳ (mỗi 20s) quét toàn bộ pane đang mở:
 *       nếu 1 luồng KHÔNG nhận được bất kỳ message nào trong quá
 *       STALE_THRESHOLD_MS (60s), coi là "zombie" và CHỦ ĐỘNG gọi lại đúng
 *       hàm connect tương ứng - không cần đợi onclose.
 *       (Binance đẩy update cho nến đang hình thành gần như liên tục, không
 *       phải chỉ lúc đóng nến, nên 60s không có message nào là dấu hiệu rõ
 *       ràng của kết nối có vấn đề, không phải chuyện bình thường.)
 *     - Thêm lắng nghe 'visibilitychange': khi tab được MỞ LẠI (từ nền lên
 *       foreground), setInterval của trình duyệt trước đó có thể đã bị tạm
 *       dừng khá lâu - kiểm tra NGAY lúc này thay vì đợi tới vòng watchdog
 *       định kỳ tiếp theo, xử lý đúng kịch bản phổ biến nhất trên di động.
 *     - Yahoo (dùng polling, không phải WebSocket) được BỎ QUA trong
 *       watchdog vì cơ chế polling (setInterval gọi fetchKlines) đã tự lặp
 *       lại độc lập, không có khái niệm "socket zombie" tương tự.
 * ============================================================================
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

      // ĐỢT FIX (watchdog chống "socket zombie"): meta lưu đủ thông tin để
      // tự gọi lại đúng hàm connect tương ứng khi phát hiện luồng im lặng
      // bất thường; lastMessageAt lưu mốc thời gian NHẬN MESSAGE gần nhất
      // của từng luồng - xem runStaleWatchdog() ở cuối file.
      meta: { kline: null, ticker: null, htf: null, sl: null, trendref: {} },
      lastMessageAt: { kline: null, ticker: null, htf: null, sl: null, trendref: {} },
    });
  }
  return connections.get(paneId);
}

function connectKlineStream(paneId, symbol, interval) {
  const entry = getOrCreateEntry(paneId);
  closeKlineSocket(paneId);

  const provider = getProviderFor(symbol);
  entry.meta.kline = { symbol, interval, provider };

  if (provider === 'yahoo') {
    connectYahooKlineStream(paneId, symbol, interval);
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@kline_${interval}`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
  const socket = new WebSocket(wsUrl);
  entry.klineSocket = socket;
  // Mốc khởi tạo NGAY khi vừa mở socket - tránh watchdog hiểu nhầm là "im
  // lặng" trong lúc socket còn đang bắt tay, chưa kịp có message đầu tiên.
  entry.lastMessageAt.kline = Date.now();

  socket.onopen = () => {
    EventBus.emit('ws:status', { paneId, status: 'connected' });
  };

  socket.onmessage = (event) => {
    entry.lastMessageAt.kline = Date.now();
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
  entry.meta.htf = { symbol, interval, provider };

  if (provider === 'yahoo') {
    connectYahooHigherTF(paneId, symbol, interval);
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@kline_${interval}`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
  const socket = new WebSocket(wsUrl);
  entry.htfKlineSocket = socket;
  entry.lastMessageAt.htf = Date.now();

  socket.onmessage = (event) => {
    entry.lastMessageAt.htf = Date.now();
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
  entry.meta.sl = { symbol, interval, provider };

  if (provider === 'yahoo') {
    connectYahooSLTF(paneId, symbol, interval);
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@kline_${interval}`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
  const socket = new WebSocket(wsUrl);
  entry.slKlineSocket = socket;
  entry.lastMessageAt.sl = Date.now();

  socket.onmessage = (event) => {
    entry.lastMessageAt.sl = Date.now();
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
  entry.meta.trendref[role] = { symbol, interval, provider };

  if (provider === 'yahoo') {
    connectYahooTrendRef(paneId, role, symbol, interval);
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@kline_${interval}`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
  const socket = new WebSocket(wsUrl);
  entry.trendRefSockets[role] = socket;
  entry.lastMessageAt.trendref[role] = Date.now();

  socket.onmessage = (event) => {
    entry.lastMessageAt.trendref[role] = Date.now();
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
  entry.meta.ticker = { symbol, provider };

  if (provider === 'yahoo') {
    // Yahoo uses the primary kline polling loop to emit ticker events, so we do nothing here.
    return;
  }

  const cleanSymbol = getCleanSymbol(symbol).toLowerCase();
  const streamName = `${cleanSymbol}@ticker`;
  const wsUrl = getWsUrlForProvider(provider, streamName);
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
  delete entry.meta.trendref[role];
  delete entry.lastMessageAt.trendref[role];

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
  entry.meta.kline = null;
  entry.lastMessageAt.kline = null;

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
  entry.meta.htf = null;
  entry.lastMessageAt.htf = null;

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
  entry.meta.sl = null;
  entry.lastMessageAt.sl = null;

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
 * WATCHDOG CHỐNG "SOCKET ZOMBIE" (đợt fix "Trend Scalp bị đứng hình")
 * Xem giải thích đầy đủ ở đầu file. Tóm tắt: mỗi 20 giây, quét toàn bộ
 * luồng của mọi pane đang mở; luồng nào quá 60 giây không nhận được bất kỳ
 * message nào thì bị coi là "zombie" và được CHỦ ĐỘNG kết nối lại - không
 * cần đợi (và không phụ thuộc vào) sự kiện onclose của trình duyệt.
 * ===================================================================== */

const STALE_THRESHOLD_MS = 60 * 1000; // 60s không có message nào -> coi là bất thường
// ĐỢT FIX: trendref (M5/H2 cho Trend Scalp) cần realtime hơn các luồng
// khác - Binance đẩy update gần như liên tục nên 25s im lặng đã là bất
// thường rõ ràng, không cần đợi tới 60s như luồng kline/htf/sl chính.
const STALE_THRESHOLD_MS_TRENDREF = 25 * 1000;
const WATCHDOG_INTERVAL_MS = 10 * 1000; // giảm từ 20s -> 10s để bắt kịp ngưỡng 25s ở trên

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
  if (!meta || meta.provider === 'yahoo') return;
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

/** Ép kết nối lại NGAY các luồng trend tham khảo (m5/h2...) của 1 pane -
 *  dùng cho nút 🔄 reload thủ công ở marketstatus.js. Khác với watchdog,
 *  hàm này KHÔNG cần đợi vượt ngưỡng im lặng - người dùng nghi ngờ dữ liệu
 *  đứng là được phép "đá" lại ngay, không phải đổi symbol như trước đây. */
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
      checkStreamStaleness(paneId, `trendref:${role}`, entry.meta.trendref[role], entry.lastMessageAt.trendref[role], now);
    });
  });
}

setInterval(runStaleWatchdog, WATCHDOG_INTERVAL_MS);

// Trình duyệt (đặc biệt trên di động) thường TẠM DỪNG setInterval khi tab bị
// đưa xuống nền để tiết kiệm pin - đây chính là kịch bản phổ biến nhất khiến
// dữ liệu "đứng hình" cho tới khi người dùng tự tay đổi symbol. Kiểm tra lại
// NGAY khi tab được mở lại (visible), không đợi tới vòng watchdog định kỳ
// tiếp theo (vốn cũng có thể vừa bị treo suốt thời gian tab ở nền).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runStaleWatchdog();
    }
  });
}