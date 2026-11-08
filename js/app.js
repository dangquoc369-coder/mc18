/**
 * app.js
 * Entry point - khởi động app và điều phối luồng dữ liệu giữa các module.
 *
 * ĐỢT TỐI ƯU TỐC ĐỘ ĐỔI SYMBOL:
 *   - 4 pane khởi tạo SONG SONG (Promise.all) thay vì tuần tự.
 *   - loadPaneAll(): bắn song song nến chính + nến khung cao + ticker; vẽ chart
 *     NGAY khi có nến chính, không đợi các phần còn lại.
 *   - Chống race: response của symbol/timeframe cũ KHÔNG ghi đè dữ liệu mới
 *     (isPaneCurrent).
 *   - OANDA tải 500 nến lúc đầu (kéo trái sẽ tự tải thêm qua onNeedMoreHistory).
 *   - Giữ chart cũ hiển thị trong lúc tải; chỉ xoá khi dữ liệu mới về.
 *   - Trend tham khảo (7 khung) dời ra SAU 1.5s lúc khởi động, debounce 0.8s khi
 *     đổi symbol -> không tranh băng thông với chart chính.
 *   - ĐÃ BỎ Yahoo.
 *
 * Các phần cũ giữ nguyên: tải thêm lịch sử khi kéo trái, cảnh báo giá
 * ('price:update' -> Store -> 'pane:priceChanged' -> AlertsModule), thông báo
 * tín hiệu BUY/SELL mới ('pane:newSignal').
 */

(async function App() {
  const KLINES_LIMIT = 1000;
  const OANDA_INITIAL_LIMIT = 500;

  const paneInstances = {}; // paneId -> ChartModule instance
  const trendRefInstances = {}; // paneId -> TrendReferenceModule instance
  const trendRefTimers = {}; // paneId -> timeout id (tải trend tham khảo trễ)
  const trailTimers = {}; // paneId -> interval id (làm mới nến khung trailing của chế độ MA)
  const bkTrailTimers = {}; 
  const bkTrailKeys = {};

  window.PaneRegistry = {
    get(paneId) {
      return paneInstances[paneId];
    },
  };

  // Registry riêng cho trend tham khảo, marketstatus.js đọc từ đây.
  window.TrendRefRegistry = {
    get(paneId) {
      return trendRefInstances[paneId];
    },
  };

  try {
    await init();
  } catch (err) {
    console.warn('Cảnh báo khởi động app:', err.message || err);
  }

  async function init() {
    UI.init();
    CountdownModule.init();
    NotificationsModule.init();
    TasksModule.init();
    if (typeof AnalyticsModule !== 'undefined') {
      AnalyticsModule.init();
    }

    const state = Store.getState();

    // Đăng ký sự kiện TRƯỚC khi tải dữ liệu để không bỏ lỡ sự kiện nào.
    EventBus.on('pane:symbolChanged', onPaneSymbolOrTimeframeChanged);
    EventBus.on('pane:timeframeChanged', onPaneSymbolOrTimeframeChanged);
    EventBus.on('kline:update:htf', onHigherTFKlineUpdate);
    EventBus.on('kline:update:sl', onSLKlineUpdate);
    EventBus.on('pane:breakoutConfigChanged', onBreakoutConfigChanged);
    EventBus.on('layout:changed', onLayoutChanged);
    EventBus.on('pane:needMoreHistory', onNeedMoreHistory);
    EventBus.on('kline:update:trendref', onTrendRefKlineUpdate);
    // Trend tham khảo chỉ phụ thuộc SYMBOL, không phụ thuộc timeframe.
    EventBus.on('pane:symbolChanged', onPaneSymbolChangedForTrendRef);

    // Kiểm tra cảnh báo giá mỗi khi có giá mới của bất kỳ pane nào.
    EventBus.on('pane:priceChanged', onPricePotentiallyAlertable);
    // Giá ticker realtime (websocket.js) -> Store -> 'pane:priceChanged'.
    EventBus.on('price:update', onTickerPriceUpdate);
    // Thông báo hệ thống khi có tín hiệu BUY/SELL mới.
    EventBus.on('pane:newSignal', onPaneNewSignal);

    await Promise.all(state.panes.map((pane) => setupPane(pane.id)));

    UI.renderSharedDrawGroup();
  }

  function onLayoutChanged({ visiblePaneIds }) {
    let attempts = 0;
    const lastSizes = {};

    function tryResize() {
      attempts++;
      let allStable = true;

      visiblePaneIds.forEach((paneId) => {
        const instance = paneInstances[paneId];
        if (!instance) return;

        const container = document.getElementById(`${paneId}-container`);
        const w = container ? container.clientWidth : 0;
        const h = container ? container.clientHeight : 0;

        if (w === 0 || h === 0) {
          allStable = false;
        } else {
          const prev = lastSizes[paneId];
          if (!prev || prev.w !== w || prev.h !== h) {
            allStable = false;
          }
          lastSizes[paneId] = { w, h };
        }

        instance.resize();
      });

      if (!allStable && attempts < 40) {
        requestAnimationFrame(tryResize);
      }
    }

    requestAnimationFrame(() => requestAnimationFrame(tryResize));
  }

  /* ===================== TẢI DỮ LIỆU 1 PANE ===================== */

  /** OANDA (TradingView WS) tải ít nến hơn cho nhanh; Binance giữ 1000. */
  function getInitialLimit(symbol) {
    return getProviderFor(symbol) === 'oanda' ? OANDA_INITIAL_LIMIT : KLINES_LIMIT;
  }

  /** Pane còn đang ở đúng symbol/timeframe này không (chống race khi đổi liên tục)? */
  function isPaneCurrent(paneId, symbol, timeframe) {
    const p = Store.getPane(paneId);
    return !!p && p.symbol === symbol && p.timeframe === timeframe;
  }

  async function setupPane(paneId) {
    const container = document.getElementById(`${paneId}-container`);
    if (!container) {
      console.error(`Không tìm thấy container cho ${paneId}`);
      return;
    }

    const instance = ChartModule.create(paneId);
    instance.initChart(container);
    paneInstances[paneId] = instance;
    IndicatorLegend.render(paneId, instance);

    // Tạo instance trend tham khảo ngay (rẻ), nhưng TẢI dữ liệu trễ.
    setupTrendReference(paneId);

    await loadPaneAll(paneId, instance);
  }

  async function onPaneSymbolOrTimeframeChanged({ paneId }) {
    const instance = paneInstances[paneId];
    if (!instance || !Store.getPane(paneId)) return;

    closePaneChartSockets(paneId);
    delete bkTrailKeys[paneId];

    // KHÔNG clearData() ngay: giữ chart cũ hiển thị trong lúc tải (cảm giác
    // nhanh hơn). clearData() được gọi ngay trước khi nạp dữ liệu mới.
    const statusEl = document.getElementById(`${paneId}-status`);
    if (statusEl) {
      statusEl.className = 'connection-status connecting';
      statusEl.textContent = 'Đang tải...';
    }

    await loadPaneAll(paneId, instance);
  }

  /**
   * Bắn SONG SONG: nến chính + nến khung cao + ticker. Vẽ chart ngay khi có
   * nến chính; khung cao/ticker về sau sẽ cập nhật tiếp.
   */
  async function loadPaneAll(paneId, instance) {
    const pane = Store.getPane(paneId);
    if (!pane) return;
    const { symbol, timeframe } = pane;
    const isOanda = getProviderFor(symbol) === 'oanda';
    const limit = getInitialLimit(symbol);
    const higherTF = ChartModule.getHigherTimeframeFor(timeframe);

    const mainP = fetchKlines(symbol, timeframe, limit);
    const htfP = higherTF
      ? fetchKlines(symbol, higherTF, limit).catch((err) => {
          console.error(`[${paneId}] Lỗi khi tải nến khung trend (${higherTF}):`, err);
          return null;
        })
      : null;
    // OANDA: connectOandaTickerStream() đã poll giá ngay khi kết nối -> khỏi tải thêm.
    const tickerP = isOanda ? null : fetch24hTicker(symbol).catch(() => null);

    let candles;
    try {
      candles = await mainP;
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải dữ liệu:`, err);
      const statusEl = document.getElementById(`${paneId}-status`);
      if (statusEl && isPaneCurrent(paneId, symbol, timeframe)) {
        statusEl.className = 'connection-status disconnected';
        statusEl.textContent = 'Lỗi tải dữ liệu';
      }
      return;
    }
    if (!isPaneCurrent(paneId, symbol, timeframe)) return;

    instance.clearData(); // dọn chart cũ ngay trước khi nạp dữ liệu mới
    Store.setPaneCandles(paneId, candles);
    instance.loadInitialData(candles);
    IndicatorLegend.render(paneId, instance);
    connectSockets(paneId, symbol, timeframe);

    if (tickerP) {
      tickerP.then((t) => {
        if (t && isPaneCurrent(paneId, symbol, timeframe)) {
          Store.setPaneLastPrice(paneId, t.lastPrice, t.changePercent);
        }
      });
    }

    // Khung cao (đã tải song song từ trước).
    if (!higherTF) {
      instance.setHigherTFCandles([]);
    } else {
      const htfCandles = await htfP;
      if (!isPaneCurrent(paneId, symbol, timeframe)) return;
      if (htfCandles) instance.setHigherTFCandles(htfCandles);
      connectHigherTFKlineStream(paneId, symbol, higherTF);
    }

    if (!isPaneCurrent(paneId, symbol, timeframe)) return;
    await syncBreakoutConfig(paneId, instance, Store.getPane(paneId));
  }

  async function onNeedMoreHistory({ paneId }) {
    const instance = paneInstances[paneId];
    const pane = Store.getPane(paneId);
    if (!instance || !pane) return;
    if (instance.isLoadingOlder() || instance.isNoMoreOlder()) return;

    const existingCandles = instance.getCandles();
    const oldest = existingCandles[0];
    if (!oldest) return;

    const { symbol, timeframe } = pane;

    instance.setLoadingOlder(true);
    const statusEl = document.getElementById(`${paneId}-status`);
    const previousStatusText = statusEl ? statusEl.textContent : null;
    if (statusEl) statusEl.textContent = 'Đang tải thêm dữ liệu cũ...';

    try {
      const endTime = oldest.time * 1000 - 1;
      const older = await fetchKlines(symbol, timeframe, KLINES_LIMIT, endTime);

      // Đã đổi symbol/timeframe trong lúc chờ -> bỏ kết quả.
      if (!isPaneCurrent(paneId, symbol, timeframe)) return;

      if (!older || older.length === 0) {
        instance.setNoMoreOlder(true);
      } else {
        instance.prependCandles(older);
        Store.setPaneCandles(paneId, instance.getCandles());
        if (older.length < KLINES_LIMIT) {
          instance.setNoMoreOlder(true);
        }
      }
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải thêm nến cũ:`, err);
    } finally {
      instance.setLoadingOlder(false);
      if (statusEl && isPaneCurrent(paneId, symbol, timeframe)) {
        statusEl.textContent = previousStatusText || '';
      }
    }
  }

  function onHigherTFKlineUpdate({ paneId, candle }) {
    const instance = paneInstances[paneId];
    if (!instance) return;
    instance.upsertHigherTFCandle(candle);
  }

  /* ===================== TREND THAM KHẢO ===================== */
  /*
   * Danh sách khung được đọc ĐỘNG từ TrendReferenceModule.ROLE_INTERVAL
   * (m5, m15, m30, h2, h6, h12, d1). D2 do trend-reference.js tự ghép từ D1,
   * nên KHÔNG gọi REST/WebSocket riêng cho "d2".
   */

  function scheduleTrendRefLoad(paneId, delayMs) {
    clearTimeout(trendRefTimers[paneId]);
    trendRefTimers[paneId] = setTimeout(() => {
      const inst = trendRefInstances[paneId];
      const pane = Store.getPane(paneId);
      if (inst && pane) loadTrendReferenceData(paneId, inst, pane.symbol);
    }, delayMs);
  }

  function setupTrendReference(paneId) {
    trendRefInstances[paneId] = TrendReferenceModule.create(paneId);
    scheduleTrendRefLoad(paneId, 1500); // nhường băng thông cho chart chính trước
  }

    async function loadTrendReferenceData(paneId, instance, symbol) {
    closeAllTrendRefKlineSockets(paneId);
    const roles = Object.keys(TrendReferenceModule.ROLE_INTERVAL);
    const queue = roles.slice();

    const worker = async () => {
      while (queue.length) {
        const role = queue.shift();
        const pre = Store.getPane(paneId);
        if (!pre || pre.symbol !== symbol) return; // đã đổi symbol giữa chừng
        const interval = TrendReferenceModule.ROLE_INTERVAL[role];
        try {
          const candles = await fetchKlines(symbol, interval, 80);
          const cur = Store.getPane(paneId);
          if (!cur || cur.symbol !== symbol) return;
          instance.setCandles(role, candles);
        } catch (err) {
          console.error(`[${paneId}] Lỗi khi tải nến trend tham khảo (${role}):`, err);
        }
        const cur = Store.getPane(paneId);
        if (cur && cur.symbol === symbol) {
          connectTrendRefKlineStream(paneId, role, symbol, interval);
        }
      }
    };

    // Tối đa 2 khung tải cùng lúc (tránh dồn 7 request OANDA một lượt)
    await Promise.all([worker(), worker()]);
  }

  function onTrendRefKlineUpdate({ paneId, role, candle }) {
    const instance = trendRefInstances[paneId];
    if (!instance) return;
    instance.upsertCandle(role, candle);
  }

  /**
   * Đổi symbol: đóng socket trend cũ NGAY, nhưng debounce 800ms việc tải lại
   * (bấm lướt qua nhiều symbol không bắn 7 request mỗi lần). KHÔNG áp dụng khi
   * chỉ đổi timeframe.
   */
  function onPaneSymbolChangedForTrendRef({ paneId }) {
    if (!trendRefInstances[paneId]) return;
    closeAllTrendRefKlineSockets(paneId);
    scheduleTrendRefLoad(paneId, 800);
  }

  /* ===================== KHUNG SL / BREAKOUT ===================== */

  async function loadSLData(paneId, instance, symbol, slTimeframe) {
    try {
      const candles = await fetchKlines(symbol, slTimeframe, KLINES_LIMIT);
      const cur = Store.getPane(paneId);
      if (!cur || cur.symbol !== symbol) return;
      instance.setSLCandles(candles);
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải nến khung SL (${slTimeframe}):`, err);
    }
    const cur = Store.getPane(paneId);
    if (cur && cur.symbol === symbol) connectSLKlineStream(paneId, symbol, slTimeframe);
  }

  function teardownSLData(paneId, instance) {
    closeSLKlineSocket(paneId);
    instance.setSLCandles(null);
  }

  function onSLKlineUpdate({ paneId, candle }) {
    const instance = paneInstances[paneId];
    if (!instance) return;
    instance.upsertSLCandle(candle);
  }

  async function syncBreakoutConfig(paneId, instance, pane) {
    instance.configureBreakout({
      slSource: pane.slMode,
      lookbackCandles: pane.breakoutLookback,
    });

    // Cập nhật trạng thái hiển thị của chỉ báo breakout theo cấu hình lưu trữ
    instance.setSignalState(pane.signalMode || 'breakout', !!pane.breakoutVisible);
    syncMaTrail(paneId, instance, pane); // tải nến khung trailing ở nền, không chặn luồng
    syncBreakoutTrail(paneId, instance, pane);

    if (pane.slMode === 'custom' && pane.slTimeframe) {
      await loadSLData(paneId, instance, pane.symbol, pane.slTimeframe);
    } else {
      teardownSLData(paneId, instance);
    }
  }


  async function syncBreakoutTrail(paneId, instance, pane) {
  const cfg = instance.getBreakoutSettings();
  const active = (pane.signalMode || 'breakout') === 'breakout' && !!pane.breakoutVisible;
  if (!active || !BreakoutModule.needsExternalTrail(cfg, pane.timeframe)) {
    clearInterval(bkTrailTimers[paneId]);
    delete bkTrailTimers[paneId];
    delete bkTrailKeys[paneId];
    instance.setBreakoutTrailCandles(null);
    return;
  }
  const { symbol, timeframe } = pane;
  const trailTf = cfg.trailTf;
  const key = `${symbol}|${timeframe}|${trailTf}`;
  if (bkTrailKeys[paneId] === key) return; // đã/đang tải đúng cấu hình này
  bkTrailKeys[paneId] = key;
  clearInterval(bkTrailTimers[paneId]);

  const load = async () => {
    const cur = Store.getPane(paneId);
    if (!cur || cur.symbol !== symbol || cur.timeframe !== timeframe) return;
    try {
      const candles = await fetchKlines(symbol, trailTf, KLINES_LIMIT);
      const again = Store.getPane(paneId);
      if (!again || again.symbol !== symbol || again.timeframe !== timeframe) return;
      instance.setBreakoutTrailCandles(candles);
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải nến khung trailing breakout (${trailTf}):`, err);
    }
  };

  await load();
  if (bkTrailKeys[paneId] === key) {
    clearInterval(bkTrailTimers[paneId]);
    bkTrailTimers[paneId] = setInterval(load, 60000);
  }
}

  /**
   * Chế độ "MA Tự Co Giãn" + Trailing: cần nến của khung trailing khi khung đó LỚN hơn khung vào lệnh.
   * Tải 1 lần rồi làm mới mỗi 60 giây (chỉ dùng nến đã đóng nên không cần realtime).
   */
  async function syncMaTrail(paneId, instance, pane) {
    clearInterval(trailTimers[paneId]);
    delete trailTimers[paneId];
 
    const cfg = instance.getMaSignalConfig();
    const active = (pane.signalMode || 'breakout') === 'ma' && !!pane.breakoutVisible;
    if (!active || !MaSignalModule.needsExternalTrail(cfg, pane.timeframe)) {
      instance.setMaTrailCandles(null);
      return;
    }
 
    const { symbol, timeframe } = pane;
    const trailTf = cfg.trailTf;
    const load = async () => {
      const cur = Store.getPane(paneId);
      if (!cur || cur.symbol !== symbol || cur.timeframe !== timeframe) return;
      try {
        const candles = await fetchKlines(symbol, trailTf, KLINES_LIMIT);
        const again = Store.getPane(paneId);
        if (!again || again.symbol !== symbol || again.timeframe !== timeframe) return;
        instance.setMaTrailCandles(candles);
      } catch (err) {
        console.error(`[${paneId}] Lỗi khi tải nến khung trailing (${trailTf}):`, err);
      }
    };
 
    await load();
    const cur = Store.getPane(paneId);
    if (cur && cur.symbol === symbol && cur.timeframe === timeframe) {
      clearInterval(trailTimers[paneId]);
      trailTimers[paneId] = setInterval(load, 60000);
    }
  }
 
  async function onBreakoutConfigChanged({ paneId }) {
    if (paneId) {
      const instance = paneInstances[paneId];
      const pane = Store.getPane(paneId);
      if (!instance || !pane) return;
      await syncBreakoutConfig(paneId, instance, pane);
    } else {
      for (const pId in paneInstances) {
        const instance = paneInstances[pId];
        const pane = Store.getPane(pId);
        if (instance && pane) {
          await syncBreakoutConfig(pId, instance, pane);
        }
      }
    }
  }

  /* ===================== GIÁ / CẢNH BÁO / TÍN HIỆU ===================== */

  /**
   * Mỗi khi 1 pane có giá mới (đã ghi vào Store), kiểm tra xem giá đó có vừa
   * vượt qua mức cảnh báo nào của đúng symbol đó không.
   */
  function onPricePotentiallyAlertable({ paneId, price }) {
    const pane = Store.getPane(paneId);
    if (!pane || price === null || price === undefined) return;
    AlertsModule.checkPrice(pane.symbol, price);
  }

  /**
   * Nhận giá ticker REALTIME (websocket.js, 'price:update') và ghi vào Store.
   * Store.setPaneLastPrice() tự bắn 'pane:priceChanged' -> cập nhật UI giá và
   * kiểm tra cảnh báo giá.
   */
  function onTickerPriceUpdate({ paneId, price, changePercent }) {
    Store.setPaneLastPrice(paneId, price, changePercent);
  }

  /**
   * Breakout.js (qua chart.js) vừa phát hiện 1 tín hiệu BUY/SELL MỚI ở 1 pane.
   * Chỉ gửi thông báo nếu pane đó hiển thị BUY/SELL và timeframe nằm trong
   * danh sách được chọn.
   */
  function onPaneNewSignal({ paneId, direction }) {
    // Vai trò khách: không phát cảnh báo tín hiệu
    if (typeof LoginModule !== 'undefined' && LoginModule.getStoredUsername && !LoginModule.getStoredUsername()) {
      return;
    }

    const pane = Store.getPane(paneId);
    if (!pane || !pane.breakoutVisible) return;

    const enabledTFs = Store.getEnabledSignalTimeframes() || [];
    if (!enabledTFs.includes(pane.timeframe)) return;

    const tfLabel = (TIMEFRAMES.find((t) => t.value === pane.timeframe) || {}).label || pane.timeframe;
    const dirLabel = direction === 1 ? 'BUY' : 'SELL';

    NotificationsModule.notify(`📊 ${pane.symbol} (${tfLabel})`, `${tfLabel} vào lệnh ${dirLabel}`);
  }
})();