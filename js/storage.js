/**
 * storage.js
 * State trung tâm (single source of truth) cho toàn bộ app.
 *
 * `state.panes` - mảng tối đa 4 pane, MỖI pane có symbol/timeframe/candles
 * ĐỘC LẬP hoàn toàn với nhau. Pane id CỐ ĐỊNH là 'pane-1'..'pane-4' (khớp với
 * 4 container cố định trong index.html).
 *
 * CẬP NHẬT (đợt fix trước) - cấu hình BUY/SELL (breakout) riêng từng pane:
 *   - breakoutLookback, slMode, slTimeframe (xem giải thích chi tiết trong
 *     bản gốc, không đổi).
 *
 * CẬP NHẬT (đợt fix này) - CẢNH BÁO TÍN HIỆU BUY/SELL:
 *   - Thêm field `signalAlertEnabled` (mặc định false) cho mỗi pane - bật/tắt
 *     qua checkbox trong popover cài đặt breakout (xem indicator-legend.js).
 *     Khi bật, app.js sẽ gửi thông báo hệ thống mỗi khi breakout.js phát
 *     hiện tín hiệu BUY/SELL MỚI ở pane đó (xem 'pane:newSignal' trong
 *     app.js/breakout.js).
 *   - setPaneSignalAlertEnabled(paneId, enabled) để cập nhật field này.
 */

const Store = (function () {
  const DEFAULT_PANE_CONFIG = [
    { id: 'pane-1', symbol: 'BTCUSDT', timeframe: '15m' },
    { id: 'pane-2', symbol: 'ETHUSDT', timeframe: '1h' },
    { id: 'pane-3', symbol: 'BNBUSDT', timeframe: '4h' },
    { id: 'pane-4', symbol: 'SOLUSDT', timeframe: '1d' },
  ];

  function makePane(cfg) {
    return {
      id: cfg.id,
      symbol: cfg.symbol,
      timeframe: cfg.timeframe,
      candles: [],
      lastPrice: null,
      priceChangePercent: null,
      // Cấu hình breakout/SL riêng của pane này
      breakoutLookback: 2,
      slMode: 'entry', // 'entry' | 'higher' | 'custom'
      slTimeframe: null, // vd '1h' - chỉ dùng khi slMode === 'custom'
      breakoutVisible: false,
      // Cảnh báo tín hiệu BUY/SELL riêng của pane này (đợt fix này)
      signalAlertEnabled: false,
    };
  }

  // Danh sách pane hiển thị theo từng layout id.
  const LAYOUT_PANES = {
    '1': (activeId) => [activeId],
    '2': () => ['pane-1', 'pane-2'],
    '3': () => ['pane-1', 'pane-2', 'pane-3'],
    '4': () => ['pane-1', 'pane-2', 'pane-3', 'pane-4'],
  };

  const PANES_STORAGE_KEY = 'dq_tracker_panes_config_v2';

  function loadSavedPanes() {
    try {
      const raw = localStorage.getItem(PANES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 4) {
          return parsed.map((saved, idx) => {
            const def = DEFAULT_PANE_CONFIG[idx];
            return {
              id: def.id,
              symbol: saved.symbol || def.symbol,
              timeframe: saved.timeframe || def.timeframe,
              candles: [],
              lastPrice: null,
              priceChangePercent: null,
              breakoutLookback: saved.breakoutLookback !== undefined ? saved.breakoutLookback : 2,
              slMode: saved.slMode || 'entry',
              slTimeframe: saved.slTimeframe || null,
              breakoutVisible: saved.breakoutVisible !== undefined ? !!saved.breakoutVisible : false,
              signalAlertEnabled: !!saved.signalAlertEnabled,
            };
          });
        }
      }
    } catch (err) {
      console.error('Lỗi khi tải cấu hình pane:', err);
    }
    return DEFAULT_PANE_CONFIG.map(makePane);
  }

  function savePanes() {
    try {
      const data = state.panes.map(p => ({
        symbol: p.symbol,
        timeframe: p.timeframe,
        breakoutLookback: p.breakoutLookback,
        slMode: p.slMode,
        slTimeframe: p.slTimeframe,
        breakoutVisible: p.breakoutVisible,
        signalAlertEnabled: p.signalAlertEnabled,
      }));
      localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('Lỗi khi lưu cấu hình pane:', err);
    }
  }

  const ENABLED_SIGNAL_TIMEFRAMES_KEY = 'dq_tracker_enabled_signal_timeframes_v1';

  function loadSavedSignalTimeframes() {
    try {
      const raw = localStorage.getItem(ENABLED_SIGNAL_TIMEFRAMES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (err) {
      console.error('Lỗi khi tải cấu hình timeframe tín hiệu:', err);
    }
    // ĐỢT FIX NÀY: mặc định KHÔNG bật sẵn khung giờ nào cả (trước đây mặc
    // định có sẵn ['5m','15m','30m','1h','2h'] khiến vừa bật chỉ báo
    // BUY/SELL là đã tự động có thông báo ở các khung đó mà người dùng
    // chưa hề tự tích). Giờ người dùng phải tự vào popover ⚙ của chip
    // BUY/SELL, tự tích khung nào thì khung đó mới được bật thông báo.
    return [];
  }

  function saveEnabledSignalTimeframes(tfs) {
    try {
      localStorage.setItem(ENABLED_SIGNAL_TIMEFRAMES_KEY, JSON.stringify(tfs));
    } catch (err) {
      console.error('Lỗi khi lưu cấu hình timeframe tín hiệu:', err);
    }
  }

  const state = {
    panes: loadSavedPanes(),
    activePaneId: 'pane-1',
    layout: '1',
    orientation: 'landscape',
    layoutRatios: {},
    popularSymbols: [
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XAUUSDT'
    ],
    allSymbols: [],
    enabledSignalTimeframes: loadSavedSignalTimeframes(),
  };

  function getState() {
    return state;
  }

  function getPane(paneId) {
    return state.panes.find((p) => p.id === paneId) || null;
  }

  function getActivePane() {
    return getPane(state.activePaneId);
  }

  function getVisiblePaneIds() {
    const fn = LAYOUT_PANES[state.layout] || LAYOUT_PANES['1'];
    return fn(state.activePaneId);
  }

  function maxPanesForOrientation(orientation) {
    return orientation === 'portrait' ? 3 : 4;
  }

  function setActivePane(paneId) {
    if (!getPane(paneId) || state.activePaneId === paneId) return;
    state.activePaneId = paneId;
    EventBus.emit('pane:focused', { paneId });
    if (state.layout === '1') {
      EventBus.emit('layout:changed', {
        layout: state.layout,
        visiblePaneIds: getVisiblePaneIds(),
        orientation: state.orientation,
      });
    }
  }

  function setLayout(layout) {
    layout = String(layout);
    if (!LAYOUT_PANES[layout]) return;
    const max = maxPanesForOrientation(state.orientation);
    if (Number(layout) > max) layout = String(max);
    if (state.layout === layout) return;
    state.layout = layout;
    let visible = getVisiblePaneIds();
    if (!visible.includes(state.activePaneId)) {
      state.activePaneId = visible[0];
      EventBus.emit('pane:focused', { paneId: state.activePaneId });
      visible = getVisiblePaneIds();
    }
    EventBus.emit('layout:changed', { layout, visiblePaneIds: visible, orientation: state.orientation });
  }

  function setOrientation(orientation) {
    if (state.orientation === orientation) return;
    state.orientation = orientation;

    const max = maxPanesForOrientation(orientation);
    if (Number(state.layout) > max) {
      state.layout = String(max);
    }

    let visible = getVisiblePaneIds();
    if (!visible.includes(state.activePaneId)) {
      state.activePaneId = visible[0];
    }

    EventBus.emit('orientation:changed', { orientation });
    EventBus.emit('layout:changed', {
      layout: state.layout,
      visiblePaneIds: getVisiblePaneIds(),
      orientation: state.orientation,
    });
  }

  function getLayoutRatioKey(layout, orientation) {
    return `${layout}-${orientation}`;
  }

  function getLayoutRatios(layout, orientation) {
    return state.layoutRatios[getLayoutRatioKey(layout, orientation)] || null;
  }

  function setLayoutRatios(layout, orientation, ratios) {
    state.layoutRatios[getLayoutRatioKey(layout, orientation)] = ratios;
  }

  function setPaneSymbol(paneId, symbol) {
    const pane = getPane(paneId);
    if (!pane || pane.symbol === symbol) return;
    pane.symbol = symbol;
    pane.candles = [];
    pane.lastPrice = null;
    pane.priceChangePercent = null;
    savePanes();
    EventBus.emit('pane:symbolChanged', { paneId, symbol });
  }

  function setPaneTimeframe(paneId, timeframe) {
    const pane = getPane(paneId);
    if (!pane || pane.timeframe === timeframe) return;
    pane.timeframe = timeframe;
    pane.candles = [];
    savePanes();
    EventBus.emit('pane:timeframeChanged', { paneId, timeframe });
  }

  function setPaneCandles(paneId, candles) {
    const pane = getPane(paneId);
    if (!pane) return;
    pane.candles = candles;
    EventBus.emit('pane:candlesLoaded', { paneId, candles });
  }

  function upsertPaneCandle(paneId, candle) {
    const pane = getPane(paneId);
    if (!pane) return;
    const candles = pane.candles;
    const last = candles[candles.length - 1];
    if (last && last.time === candle.time) {
      candles[candles.length - 1] = candle;
    } else if (!last || candle.time > last.time) {
      candles.push(candle);
    }
  }

  function setPaneLastPrice(paneId, price, changePercent) {
    const pane = getPane(paneId);
    if (!pane) return;
    pane.lastPrice = price;
    if (changePercent !== undefined) pane.priceChangePercent = changePercent;
    EventBus.emit('pane:priceChanged', { paneId, price, changePercent: pane.priceChangePercent });
  }

  function setAllSymbols(list) {
    state.allSymbols = list;
  }

  function setPaneBreakoutConfig(paneId, config) {
    const pane = getPane(paneId);
    if (!pane) return;
    if (config.lookbackCandles !== undefined) pane.breakoutLookback = config.lookbackCandles;
    if (config.slMode !== undefined) pane.slMode = config.slMode;
    if (config.slTimeframe !== undefined) pane.slTimeframe = config.slTimeframe;

    savePanes();
    EventBus.emit('pane:breakoutConfigChanged', {
      paneId,
      breakoutLookback: pane.breakoutLookback,
      slMode: pane.slMode,
      slTimeframe: pane.slTimeframe,
    });
  }

  function getPaneBreakoutConfig(paneId) {
    const pane = getPane(paneId);
    if (!pane) return null;
    return {
      lookbackCandles: pane.breakoutLookback,
      slMode: pane.slMode,
      slTimeframe: pane.slTimeframe,
    };
  }

  /** Bật/tắt thông báo tín hiệu BUY/SELL của 1 pane (đợt fix này). */
  function setPaneSignalAlertEnabled(paneId, enabled) {
    const pane = getPane(paneId);
    if (!pane) return;
    pane.signalAlertEnabled = !!enabled;
    savePanes();
    EventBus.emit('pane:breakoutConfigChanged', {
      paneId,
      breakoutLookback: pane.breakoutLookback,
      slMode: pane.slMode,
      slTimeframe: pane.slTimeframe,
    });
  }

  /** Bật/tắt hiển thị chỉ báo breakout của 1 pane (đợt fix này). */
  function setPaneBreakoutVisible(paneId, visible) {
    const pane = getPane(paneId);
    if (!pane) return;
    pane.breakoutVisible = !!visible;
    savePanes();
    EventBus.emit('pane:breakoutConfigChanged', {
      paneId,
      breakoutLookback: pane.breakoutLookback,
      slMode: pane.slMode,
      slTimeframe: pane.slTimeframe,
    });
  }

  function getEnabledSignalTimeframes() {
    return state.enabledSignalTimeframes;
  }

  function setEnabledSignalTimeframes(tfs) {
    state.enabledSignalTimeframes = tfs;
    saveEnabledSignalTimeframes(tfs);
    EventBus.emit('pane:breakoutConfigChanged', {});
  }

  return {
    getState,
    getPane,
    getActivePane,
    getVisiblePaneIds,
    maxPanesForOrientation,
    setActivePane,
    setLayout,
    setOrientation,
    getLayoutRatios,
    setLayoutRatios,
    setPaneSymbol,
    setPaneTimeframe,
    setPaneCandles,
    upsertPaneCandle,
    setPaneLastPrice,
    setAllSymbols,
    setPaneBreakoutConfig,
    getPaneBreakoutConfig,
    setPaneSignalAlertEnabled,
    setPaneBreakoutVisible,
    getEnabledSignalTimeframes,
    setEnabledSignalTimeframes,
  };
})();