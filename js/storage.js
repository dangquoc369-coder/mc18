/**
 * storage.js
 * State trung tâm (single source of truth) cho toàn bộ app.
 *
 * LOCAL-FIRST: mọi cấu hình giao diện đều lưu TRỰC TIẾP trên thiết bị qua
 * LocalStore (js/local-store.js - PHẢI nạp TRƯỚC file này), không còn đồng bộ
 * lên cloud:
 *   - Cấu hình 4 pane (symbol, timeframe, breakout, SL...)   -> 'panes'
 *   - Layout (1/2/3/4 ô) + tỉ lệ kéo splitter                -> 'layout', 'layout_ratios'
 *   - Ô đang chọn (dùng cho layout 1 ô)                      -> 'active_pane'
 *   - Khung giờ thông báo tín hiệu BUY/SELL                  -> 'signal_tfs'
 *   - Watchlist                                              -> 'watchlist'
 * (Chỉ cảnh báo giá / tín hiệu / nhắc việc vẫn lên cloud - xem push-sync.js,
 *  vì cần server để đẩy Web Push khi đã tắt app.)
 *
 * `state.panes` - mảng 4 pane, MỖI pane có symbol/timeframe/candles ĐỘC LẬP.
 * Pane id CỐ ĐỊNH là 'pane-1'..'pane-4' (khớp 4 container trong index.html).
 */

const Store = (function () {
  const DEFAULT_PANE_CONFIG = [
    { id: 'pane-1', symbol: 'XAUUSD', timeframe: '15m' },
    { id: 'pane-2', symbol: 'BTCUSDT', timeframe: '1h' },
    { id: 'pane-3', symbol: 'ETHUSDT', timeframe: '4h' },
    { id: 'pane-4', symbol: 'SOLUSDT', timeframe: '1d' },
  ];

  const DEFAULT_WATCHLIST = ['XAUUSD', 'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XAUUSDT'];

  // Key cũ (trước khi có LocalStore) - dùng để di trú dữ liệu 1 lần.
  const LEGACY_PANES_KEY = 'dq_tracker_panes_config_v2';
  const LEGACY_SIGNAL_TF_KEY = 'dq_tracker_enabled_signal_timeframes_v1';

  function makePane(cfg) {
    return {
      id: cfg.id,
      symbol: cfg.symbol,
      timeframe: cfg.timeframe,
      candles: [],
      lastPrice: null,
      priceChangePercent: null,
      breakoutLookback: 2,
      slMode: 'entry', // 'entry' | 'higher' | 'custom'
      slTimeframe: null, // vd '1h' - chỉ dùng khi slMode === 'custom'
      breakoutVisible: false,
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

  // ===== Đọc / ghi cục bộ =====
  function loadSavedPanes() {
    const parsed = LocalStore.read('panes', null, LEGACY_PANES_KEY);
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
    return DEFAULT_PANE_CONFIG.map(makePane);
  }

  function savePanes() {
    LocalStore.write(
      'panes',
      state.panes.map((p) => ({
        symbol: p.symbol,
        timeframe: p.timeframe,
        breakoutLookback: p.breakoutLookback,
        slMode: p.slMode,
        slTimeframe: p.slTimeframe,
        breakoutVisible: p.breakoutVisible,
        signalAlertEnabled: p.signalAlertEnabled,
      }))
    );
  }

  // Mặc định KHÔNG bật sẵn khung giờ nào - người dùng tự tích trong popover
  // ⚙ của chip BUY/SELL.
  function loadSavedSignalTimeframes() {
    const v = LocalStore.read('signal_tfs', [], LEGACY_SIGNAL_TF_KEY);
    return Array.isArray(v) ? v : [];
  }

  function saveEnabledSignalTimeframes(tfs) {
    LocalStore.write('signal_tfs', tfs);
  }

  function loadSavedLayout() {
    const l = String(LocalStore.read('layout', '1'));
    return LAYOUT_PANES[l] ? l : '1';
  }

  function loadSavedActivePane() {
    const id = LocalStore.read('active_pane', 'pane-1');
    return /^pane-[1-4]$/.test(String(id)) ? id : 'pane-1';
  }

  function loadSavedWatchlist() {
    const l = LocalStore.read('watchlist', null);
    return Array.isArray(l) ? l.filter((s) => typeof s === 'string' && s) : DEFAULT_WATCHLIST.slice();
  }

  const initialWatchlist = loadSavedWatchlist();

  const state = {
    panes: loadSavedPanes(),
    activePaneId: loadSavedActivePane(),
    layout: loadSavedLayout(),
    orientation: 'landscape',
    layoutRatios: LocalStore.read('layout_ratios', {}) || {},
    watchlist: initialWatchlist,
    popularSymbols: initialWatchlist.slice(), // giữ để ui.js (nếu còn đọc) vẫn chạy
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
    LocalStore.write('active_pane', paneId);
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
    LocalStore.write('layout', state.layout);
    let visible = getVisiblePaneIds();
    if (!visible.includes(state.activePaneId)) {
      state.activePaneId = visible[0];
      LocalStore.write('active_pane', state.activePaneId);
      EventBus.emit('pane:focused', { paneId: state.activePaneId });
      visible = getVisiblePaneIds();
    }
    EventBus.emit('layout:changed', { layout, visiblePaneIds: visible, orientation: state.orientation });
  }

  // Xoay màn hình có thể ép layout xuống thấp hơn (dọc tối đa 3 ô) nhưng
  // KHÔNG ghi đè lựa chọn đã lưu - xoay lại ngang sẽ về đúng layout cũ.
  function setOrientation(orientation) {
    if (state.orientation === orientation) return;
    state.orientation = orientation;

    const max = maxPanesForOrientation(orientation);
    if (Number(state.layout) > max) {
      state.layout = String(max);
    } else {
      const saved = loadSavedLayout();
      if (Number(saved) <= max) state.layout = saved;
    }

    const visible = getVisiblePaneIds();
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

  // Kéo splitter phát sinh rất nhiều lần/giây -> chỉ ghi xuống máy sau 300ms
  // kể từ lần kéo cuối (debounce), tránh ghi localStorage liên tục.
  let ratiosTimer = null;
  function setLayoutRatios(layout, orientation, ratios) {
    state.layoutRatios[getLayoutRatioKey(layout, orientation)] = ratios;
    clearTimeout(ratiosTimer);
    ratiosTimer = setTimeout(() => LocalStore.write('layout_ratios', state.layoutRatios), 300);
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

  function emitBreakoutChanged(paneId, pane) {
    EventBus.emit('pane:breakoutConfigChanged', {
      paneId,
      breakoutLookback: pane.breakoutLookback,
      slMode: pane.slMode,
      slTimeframe: pane.slTimeframe,
    });
  }

  function setPaneBreakoutConfig(paneId, config) {
    const pane = getPane(paneId);
    if (!pane) return;
    if (config.lookbackCandles !== undefined) pane.breakoutLookback = config.lookbackCandles;
    if (config.slMode !== undefined) pane.slMode = config.slMode;
    if (config.slTimeframe !== undefined) pane.slTimeframe = config.slTimeframe;
    savePanes();
    emitBreakoutChanged(paneId, pane);
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

  /** Bật/tắt thông báo tín hiệu BUY/SELL của 1 pane. */
  function setPaneSignalAlertEnabled(paneId, enabled) {
    const pane = getPane(paneId);
    if (!pane) return;
    pane.signalAlertEnabled = !!enabled;
    savePanes();
    emitBreakoutChanged(paneId, pane);
  }

  /** Bật/tắt hiển thị chỉ báo breakout của 1 pane. */
  function setPaneBreakoutVisible(paneId, visible) {
    const pane = getPane(paneId);
    if (!pane) return;
    pane.breakoutVisible = !!visible;
    savePanes();
    emitBreakoutChanged(paneId, pane);
  }

  function getEnabledSignalTimeframes() {
    return state.enabledSignalTimeframes;
  }

  function setEnabledSignalTimeframes(tfs) {
    state.enabledSignalTimeframes = tfs;
    saveEnabledSignalTimeframes(tfs);
    EventBus.emit('pane:breakoutConfigChanged', {});
  }

  // ===== WATCHLIST (cục bộ) =====
  function getWatchlist() {
    return state.watchlist.slice();
  }

  function isInWatchlist(symbol) {
    return state.watchlist.includes(symbol);
  }

  function persistWatchlist() {
    LocalStore.write('watchlist', state.watchlist);
    state.popularSymbols = state.watchlist.slice();
    EventBus.emit('watchlist:changed', { list: getWatchlist() });
  }

  function addToWatchlist(symbol) {
    symbol = String(symbol || '').trim();
    if (!symbol || state.watchlist.includes(symbol)) return;
    state.watchlist.push(symbol);
    persistWatchlist();
  }

  function removeFromWatchlist(symbol) {
    const next = state.watchlist.filter((s) => s !== symbol);
    if (next.length === state.watchlist.length) return;
    state.watchlist = next;
    persistWatchlist();
  }

  function toggleWatchlist(symbol) {
    if (isInWatchlist(symbol)) removeFromWatchlist(symbol);
    else addToWatchlist(symbol);
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
    getWatchlist,
    isInWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    toggleWatchlist,
  };
})();