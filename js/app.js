/**
 * app.js
 * Entry point - khởi động app và điều phối luồng dữ liệu giữa các module.
 *
 * (Phần 1: tự động tải thêm lịch sử khi kéo sang trái - xem onNeedMoreHistory.)
 *
 * (Phần 2, CẢNH BÁO):
 *   - Khởi động NotificationsModule (đăng ký service worker + hiện banner
 *     xin quyền thông báo lần đầu nếu chưa quyết định).
 *   - Lắng nghe 'pane:priceChanged' (do Store.setPaneLastPrice bắn ra) ->
 *     gọi AlertsModule.checkPrice(symbol, price) để phát hiện lúc giá vượt
 *     qua mức cảnh báo đã đặt.
 *   - Lắng nghe 'pane:newSignal' (bắn ra từ chart.js khi breakout.js phát
 *     hiện tín hiệu BUY/SELL MỚI) -> nếu pane đó đã bật signalAlertEnabled,
 *     gửi thông báo hệ thống dạng "M5 vào lệnh BUY" (ví dụ).
 *
 * ĐỢT FIX NÀY (SỬA LỖI CẢNH BÁO GIÁ KHÔNG HOẠT ĐỘNG):
 *   - websocket.js phát ra sự kiện 'price:update' mỗi khi có giá ticker mới
 *     (realtime), nhưng TRƯỚC ĐÂY không có nơi nào trong app lắng nghe sự
 *     kiện này -> Store chỉ có giá tại thời điểm tải trang (qua
 *     loadInitialPrice() gọi 1 lần REST API), rồi bị "đóng băng" mãi mãi.
 *     Hệ quả: AlertsModule.checkPrice() không bao giờ được gọi lại với giá
 *     MỚI -> cảnh báo giá gần như không bao giờ kích hoạt.
 *   - Thêm onTickerPriceUpdate(): nối 'price:update' -> Store.setPaneLastPrice(),
 *     việc này sẽ tự động bắn tiếp 'pane:priceChanged' (Store đã có sẵn logic
 *     này) -> vừa cập nhật UI giá vừa cho AlertsModule kiểm tra cảnh báo với
 *     giá thật, theo thời gian thực.
 */

(async function App() {
  const KLINES_LIMIT = 1000;

  const paneInstances = {}; // paneId -> ChartModule instance

  window.PaneRegistry = {
    get(paneId) {
      return paneInstances[paneId];
    },
  };
  const trendRefInstances = {}; // paneId -> TrendReferenceModule instance

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
    console.error('Lỗi khởi động app:', err);
  }

  async function init() {
    UI.init();
    CountdownModule.init();
    NotificationsModule.init();

    const state = Store.getState();

    for (const pane of state.panes) {
      await setupPane(pane.id);
    }

    EventBus.on('pane:symbolChanged', onPaneSymbolOrTimeframeChanged);
    EventBus.on('pane:timeframeChanged', onPaneSymbolOrTimeframeChanged);
    EventBus.on('kline:update:htf', onHigherTFKlineUpdate);
    EventBus.on('kline:update:sl', onSLKlineUpdate);
    EventBus.on('pane:breakoutConfigChanged', onBreakoutConfigChanged);
    EventBus.on('layout:changed', onLayoutChanged);
    EventBus.on('pane:needMoreHistory', onNeedMoreHistory);
    EventBus.on('kline:update:trendref', onTrendRefKlineUpdate);
    // Trend tham khảo chỉ phụ thuộc SYMBOL của pane, không phụ thuộc
    // timeframe đang xem -> chỉ reload khi đổi symbol, không đổi timeframe.
    EventBus.on('pane:symbolChanged', onPaneSymbolChangedForTrendRef);

    // Kiểm tra cảnh báo giá mỗi khi có giá mới của bất kỳ pane nào.
    EventBus.on('pane:priceChanged', onPricePotentiallyAlertable);

    // ĐỢT FIX NÀY: đồng bộ giá ticker realtime từ WebSocket (websocket.js)
    // vào Store. Thiếu dòng này là lý do chính khiến cảnh báo giá "không
    // chạy" - Store không có giá mới nên không ai kiểm tra được.
    EventBus.on('price:update', onTickerPriceUpdate);

    // Gửi thông báo hệ thống khi có tín hiệu BUY/SELL mới ở pane đã bật cảnh báo.
    EventBus.on('pane:newSignal', onPaneNewSignal);

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

    const pane = Store.getPane(paneId);
    await loadPaneData(paneId, instance, pane.symbol, pane.timeframe);
    connectSockets(paneId, pane.symbol, pane.timeframe);
    await loadInitialPrice(paneId, pane.symbol);
    await loadHigherTFData(paneId, instance, pane.symbol, pane.timeframe);
    await syncBreakoutConfig(paneId, instance, pane);
    await setupTrendReference(paneId, pane.symbol); // thêm dòng này
  }

  async function onPaneSymbolOrTimeframeChanged({ paneId }) {
    const instance = paneInstances[paneId];
    const pane = Store.getPane(paneId);
    if (!instance || !pane) return;

    closePaneSockets(paneId);
    instance.clearData();

    try {
      await loadPaneData(paneId, instance, pane.symbol, pane.timeframe);
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải dữ liệu:`, err);
    }

    connectSockets(paneId, pane.symbol, pane.timeframe);
    await loadInitialPrice(paneId, pane.symbol);
    await loadHigherTFData(paneId, instance, pane.symbol, pane.timeframe);
    await syncBreakoutConfig(paneId, instance, pane);
  }

  async function loadPaneData(paneId, instance, symbol, timeframe) {
    const candles = await fetchKlines(symbol, timeframe, KLINES_LIMIT);
    Store.setPaneCandles(paneId, candles);
    instance.loadInitialData(candles);
  }

  async function onNeedMoreHistory({ paneId }) {
    const instance = paneInstances[paneId];
    const pane = Store.getPane(paneId);
    if (!instance || !pane) return;
    if (instance.isLoadingOlder() || instance.isNoMoreOlder()) return;

    const existingCandles = instance.getCandles();
    const oldest = existingCandles[0];
    if (!oldest) return;

    instance.setLoadingOlder(true);
    const statusEl = document.getElementById(`${paneId}-status`);
    const previousStatusText = statusEl ? statusEl.textContent : null;
    if (statusEl) statusEl.textContent = 'Đang tải thêm dữ liệu cũ...';

    try {
      const endTime = oldest.time * 1000 - 1;
      const older = await fetchKlines(pane.symbol, pane.timeframe, KLINES_LIMIT, endTime);

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
      if (statusEl) statusEl.textContent = previousStatusText || '';
    }
  }

  async function loadHigherTFData(paneId, instance, symbol, timeframe) {
    const higherTF = ChartModule.getHigherTimeframeFor(timeframe);

    if (!higherTF) {
      instance.setHigherTFCandles([]);
      return;
    }

    try {
      const candles = await fetchKlines(symbol, higherTF, KLINES_LIMIT);
      instance.setHigherTFCandles(candles);
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải nến khung trend (${higherTF}):`, err);
    }

    connectHigherTFKlineStream(paneId, symbol, higherTF);
  }

  function onHigherTFKlineUpdate({ paneId, candle }) {
    const instance = paneInstances[paneId];
    if (!instance) return;
    instance.upsertHigherTFCandle(candle);
  }

  /**
   * Khởi tạo 1 instance TrendReferenceModule riêng cho pane này và tải dữ
   * liệu ban đầu cho các khung THẬT lấy từ Binance - danh sách này được đọc
   * ĐỘNG từ TrendReferenceModule.ROLE_INTERVAL (m5, m15, m30, h2, h6, h12,
   * d1) - xem trend-reference.js. Không hardcode danh sách khung ở đây, nên
   * nếu sau này đổi cặp khung của Trend Swing/Scalp thì CHỈ cần sửa
   * ROLE_INTERVAL/SWING_LEGS bên trend-reference.js, app.js tự động tải
   * đúng khung mới mà không cần sửa gì thêm.
   *
   * Riêng D2 (2 ngày, dùng cho chân D1 của Trend Swing) KHÔNG có trong
   * ROLE_INTERVAL vì Binance không có interval 2 ngày - trend-reference.js
   * tự ghép D2 nội bộ từ dữ liệu D1 đã tải, nên vòng lặp roles bên dưới
   * KHÔNG gọi REST/WebSocket riêng cho "d2".
   */
  async function setupTrendReference(paneId, symbol) {
    const instance = TrendReferenceModule.create(paneId);
    trendRefInstances[paneId] = instance;
    await loadTrendReferenceData(paneId, instance, symbol);
  }

  async function loadTrendReferenceData(paneId, instance, symbol) {
    closeAllTrendRefKlineSockets(paneId);
    const roles = Object.keys(TrendReferenceModule.ROLE_INTERVAL);

    await Promise.all(roles.map(async (role) => {
      const interval = TrendReferenceModule.ROLE_INTERVAL[role];
      try {
        const candles = await fetchKlines(symbol, interval, KLINES_LIMIT);
        instance.setCandles(role, candles);
      } catch (err) {
        console.error(`[${paneId}] Lỗi khi tải nến trend tham khảo (${role}):`, err);
      }
      connectTrendRefKlineStream(paneId, role, symbol, interval);
    }));
  }

  function onTrendRefKlineUpdate({ paneId, role, candle }) {
    const instance = trendRefInstances[paneId];
    if (!instance) return;
    instance.upsertCandle(role, candle);
  }

  /**
   * Đổi symbol -> trend tham khảo của pane đó phải tải lại từ đầu (các khung
   * thật trong ROLE_INTERVAL), vì toàn bộ dữ liệu cũ thuộc symbol cũ không
   * còn dùng được. KHÔNG áp dụng khi chỉ đổi timeframe của pane (trend tham
   * khảo không phụ thuộc timeframe đang xem).
   */
  async function onPaneSymbolChangedForTrendRef({ paneId, symbol }) {
    const instance = trendRefInstances[paneId];
    if (!instance) return;
    await loadTrendReferenceData(paneId, instance, symbol);
  }

  async function loadSLData(paneId, instance, symbol, slTimeframe) {
    try {
      const candles = await fetchKlines(symbol, slTimeframe, KLINES_LIMIT);
      instance.setSLCandles(candles);
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải nến khung SL (${slTimeframe}):`, err);
    }
    connectSLKlineStream(paneId, symbol, slTimeframe);
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
    instance.getBreakout().setVisible(!!pane.breakoutVisible);

    if (pane.slMode === 'custom' && pane.slTimeframe) {
      await loadSLData(paneId, instance, pane.symbol, pane.slTimeframe);
    } else {
      teardownSLData(paneId, instance);
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

  async function loadInitialPrice(paneId, symbol) {
    try {
      const { lastPrice, changePercent } = await fetch24hTicker(symbol);
      Store.setPaneLastPrice(paneId, lastPrice, changePercent);
    } catch (err) {
      console.error(`[${paneId}] Lỗi khi tải giá ban đầu:`, err);
    }
  }

  /**
   * Mỗi khi 1 pane có giá mới (đã được ghi vào Store - xem
   * onTickerPriceUpdate bên dưới, hoặc lúc tải giá ban đầu), kiểm tra xem
   * giá đó có vừa vượt qua mức cảnh báo nào của đúng symbol đó không.
   */
  function onPricePotentiallyAlertable({ paneId, price }) {
    const pane = Store.getPane(paneId);
    if (!pane || price === null || price === undefined) return;
    AlertsModule.checkPrice(pane.symbol, price);
  }

  /**
   * ĐỢT FIX NÀY: nhận giá ticker REALTIME từ websocket.js (sự kiện
   * 'price:update', bắn ra từ connectTickerStream() mỗi khi có tick giá
   * mới) và ghi vào Store. Store.setPaneLastPrice() sẽ tự bắn tiếp
   * 'pane:priceChanged' -> vừa cập nhật UI giá (ui.js đã lắng nghe sẵn) vừa
   * kích hoạt kiểm tra cảnh báo giá (onPricePotentiallyAlertable ở trên).
   *
   * Đây chính là mắt xích còn thiếu khiến cảnh báo giá "đặt xong nhưng
   * không bao giờ kêu": trước đây Store chỉ có giá tại thời điểm tải trang.
   */
  function onTickerPriceUpdate({ paneId, price, changePercent }) {
    Store.setPaneLastPrice(paneId, price, changePercent);
  }

  /**
   * Breakout.js (qua chart.js) vừa phát hiện 1 tín hiệu BUY/SELL MỚI ở 1
   * pane. Chỉ gửi thông báo nếu pane đó hiển thị BUY/SELL và timeframe nằm trong danh sách được chọn.
   */
  function onPaneNewSignal({ paneId, direction }) {
    const pane = Store.getPane(paneId);
    if (!pane || !pane.breakoutVisible) return;

    const enabledTFs = Store.getEnabledSignalTimeframes() || [];
    if (!enabledTFs.includes(pane.timeframe)) return;

    const tfLabel = (TIMEFRAMES.find((t) => t.value === pane.timeframe) || {}).label || pane.timeframe;
    const dirLabel = direction === 1 ? 'BUY' : 'SELL';

    NotificationsModule.notify(
      `📊 ${pane.symbol} (${tfLabel})`,
      `${tfLabel} vào lệnh ${dirLabel}`
    );
  }
})();