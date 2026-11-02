/**
 * chart.js
 * Mỗi pane = 1 instance ChartModule (Lightweight Charts + chỉ báo + breakout
 * + bộ công cụ vẽ).
 *
 * LOCAL-FIRST:
 *   - Chỉ báo bật/tắt + period: lưu qua IndicatorPrefsModule (localStorage).
 *   - Hình vẽ: DrawingModule lưu cục bộ THEO TỪNG SYMBOL; chart.js chỉ có
 *     việc báo cho drawing nạp đúng bộ hình khi pane đổi symbol
 *     (handleSymbolChangedForDrawing) và lưu nốt khi destroy().
 *   - Màu theme: đọc từ ThemeModule (cũng lưu cục bộ).
 *
 * CẬP NHẬT - NHÓM EMA:
 *   - Các đường EMA riêng lẻ (ema21, ema200) được thay bằng 1 danh sách
 *     `emaLines` (tối đa 10 đường). Mỗi đường có: period, color, width
 *     (độ dày nét), source (close/open/high/low) và enabled (bật/tắt riêng).
 *   - API mới: setEmaLines(lines), setEmaGroupVisible(visible); đọc danh
 *     sách qua getIndicatorConfig().emaLines.
 *   - Dữ liệu đã lưu kiểu cũ (ema21/ema200) tự được chuyển thành 2 đường đầu.
 */
const ChartModule = (function () {
  const ENTRY_TO_HIGHER_TF = {
    '2h': '2d',
    '1h': '1d',
    '30m': '12h',
    '15m': '4h',
    '5m': '2h',
  };

  function getHigherTimeframeFor(entryTimeframe) {
    return ENTRY_TO_HIGHER_TF[entryTimeframe] || null;
  }

  // Lightweight Charts vẽ bằng canvas nên không đọc được biến CSS - màu ở
  // đây phải khớp thủ công với :root / :root[data-theme="light"] trong
  // css/style.css.
  const CHART_THEME = {
    dark: {
      background: '#0c0d14',
      text: '#d1d4dc',
      grid: '#161720',
      border: '#202127',
    },
    light: {
      background: '#ffffff',
      text: '#131722',
      grid: '#eef1f8',
      border: '#e2e5ed',
    },
  };

  const MAX_EMA_LINES = 10;
  const EMA_SOURCES = ['close', 'open', 'high', 'low'];

  // ===== RSI BY NĐQ: các phần vẽ thêm lên pane RSI (giống chỉ báo trên TradingView) =====
  const RSI_EXTRAS_DEFAULT = {
    source: 'close',
    levels: [20, 30, 40, 50, 60, 70, 80],
    showFill: true, // nền mờ giữa mức 30 và 70
    showLadder: true, // bảng giá theo mức RSI (Price ladder)
    ladderColor: '#cfcfcf',
    ladderWmaColor: '#f23645',
    showSnr: true, // đường hỗ trợ / kháng cự RSI tự động
    snrLookbacks: [34, 89, 200],
    snrResistanceColor: '#5289ff',
    snrSupportColor: '#5289ff',
  };
  const RSI_LABEL_OFFSET_BARS = 15; // Pine vẽ nhãn / đường tới bar_index + 15

  function isHexColor(c) {
    return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  }

  function hexToRgba(hex, alpha) {
    const h = isHexColor(hex) ? hex : '#5289ff';
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /** Chuẩn hoá cài đặt RSI mở rộng (chặn giá trị sai từ popover / localStorage). */
  function sanitizeRsiExtras(src) {
    const d = RSI_EXTRAS_DEFAULT;
    const s = src || {};
    const levels = d.levels.map((def, i) => {
      const v = parseFloat(s.levels && s.levels[i]);
      return Number.isFinite(v) ? Math.min(99, Math.max(1, v)) : def;
    });
    const snrLookbacks = d.snrLookbacks.map((def, i) => {
      const v = parseInt(s.snrLookbacks && s.snrLookbacks[i], 10);
      return v >= 2 ? Math.min(v, 1000) : def;
    });
    return {
      source: EMA_SOURCES.includes(s.source) ? s.source : d.source,
      levels,
      showFill: s.showFill === undefined ? d.showFill : !!s.showFill,
      showLadder: s.showLadder === undefined ? d.showLadder : !!s.showLadder,
      ladderColor: isHexColor(s.ladderColor) ? s.ladderColor : d.ladderColor,
      ladderWmaColor: isHexColor(s.ladderWmaColor) ? s.ladderWmaColor : d.ladderWmaColor,
      showSnr: s.showSnr === undefined ? d.showSnr : !!s.showSnr,
      snrLookbacks,
      snrResistanceColor: isHexColor(s.snrResistanceColor) ? s.snrResistanceColor : d.snrResistanceColor,
      snrSupportColor: isHexColor(s.snrSupportColor) ? s.snrSupportColor : d.snrSupportColor,
    };
  }

  /** Giống str.tostring(price, '#.###') của Pine: tối đa 3 số lẻ, bỏ số 0 thừa. */
  function formatLadderPrice(p) {
    return String(Math.round(p * 1000) / 1000);
  }

  /**
   * Primitive gắn vào 1 series của pane RSI để vẽ thêm:
   *   - lớp dưới: nền mờ 30-70 + các đường ngang mức RSI (chấm chấm)
   *   - lớp trên: đường SnR tự động + nhãn giá theo mức RSI ở mép phải
   * Toạ độ được tính lại ở MỖI lần vẽ nên tự theo khi kéo / zoom chart.
   */
  class RsiExtrasPrimitive {
    constructor(getState) {
      this._getState = getState;
      this._chart = null;
      this._series = null;
      this._requestUpdate = null;
      this._views = [
        { zOrder: () => 'bottom', renderer: () => ({ draw: (t) => this._drawBackground(t) }) },
        { zOrder: () => 'top', renderer: () => ({ draw: (t) => this._drawForeground(t) }) },
      ];
    }

    attached(param) {
      this._chart = param.chart;
      this._series = param.series;
      this._requestUpdate = param.requestUpdate;
    }

    detached() {
      this._chart = null;
      this._series = null;
      this._requestUpdate = null;
    }

    updateAllViews() {}

    paneViews() {
      return this._views;
    }

    requestRedraw() {
      if (this._requestUpdate) this._requestUpdate();
    }

    _drawBackground(target) {
      const series = this._series;
      if (!series) return;
      const { config } = this._getState();
      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        const width = scope.bitmapSize.width;
        const toY = (price) => {
          const c = series.priceToCoordinate(price);
          return c === null ? null : c * vr;
        };

        if (config.showFill) {
          const y70 = toY(70);
          const y30 = toY(30);
          if (y70 !== null && y30 !== null) {
            ctx.fillStyle = 'rgba(89,112,185,0.10)';
            ctx.fillRect(0, Math.min(y70, y30), width, Math.abs(y30 - y70));
          }
        }

        ctx.save();
        ctx.strokeStyle = 'rgba(120,123,134,0.5)';
        ctx.lineWidth = Math.max(1, Math.round(hr));
        ctx.setLineDash([2 * hr, 3 * hr]);
        config.levels.forEach((level) => {
          const y = toY(level);
          if (y === null) return;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        });
        ctx.restore();
      });
    }

    _drawForeground(target) {
      const series = this._series;
      const chart = this._chart;
      if (!series || !chart) return;
      const { config, data } = this._getState();
      if (!data) return;
      const timeScale = chart.timeScale();

      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        const widthMedia = scope.bitmapSize.width / hr;
        const toY = (price) => {
          const c = series.priceToCoordinate(price);
          return c === null ? null : c * vr;
        };
        const xEnd = timeScale.logicalToCoordinate(data.lastIndex + RSI_LABEL_OFFSET_BARS);

        if (config.showSnr && xEnd !== null) {
          ctx.save();
          ctx.lineWidth = Math.max(1, Math.round(hr));
          data.snr.forEach((item) => {
            const x1 = timeScale.logicalToCoordinate(item.startIndex);
            const y = toY(item.value);
            if (x1 === null || y === null) return;
            ctx.strokeStyle = hexToRgba(
              item.kind === 'high' ? config.snrResistanceColor : config.snrSupportColor,
              0.5
            );
            ctx.beginPath();
            ctx.moveTo(x1 * hr, y);
            ctx.lineTo(xEnd * hr, y);
            ctx.stroke();
          });
          ctx.restore();
        }

        if (config.showLadder && data.labels.length) {
          ctx.save();
          ctx.font = `${Math.round(11 * vr)}px Inter, -apple-system, "Segoe UI", sans-serif`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          // Nhãn căn phải tại bar_index + 15; nếu nằm ngoài khung nhìn thì ghim sát mép phải pane
          const maxX = widthMedia - 6;
          const x = Math.min(xEnd === null ? maxX : xEnd, maxX) * hr;
          data.labels.forEach((l) => {
            const y = toY(l.rsi);
            if (y === null) return;
            ctx.fillStyle = l.kind === 'wma' ? config.ladderWmaColor : config.ladderColor;
            ctx.fillText(l.text, x, y);
          });
          ctx.restore();
        }
      });
    }
  }
  
    // ===== MÀU NẾN + RÂU DÀY (giống TradingView) =====
  const CANDLE_UP = '#089981';
  const CANDLE_DOWN = '#F23645';
  const VOLUME_UP = 'rgba(8,153,129,0.5)';
  const VOLUME_DOWN = 'rgba(242,54,69,0.5)';
    const WICK_RATIO = 0.024; // độ dày râu = 2.4% khoảng cách giữa 2 nến (đo từ ảnh TradingView)

  /** Vẽ râu nến tỉ lệ theo mức zoom giống TradingView (thư viện chỉ vẽ cố định 1px). */
  class ThickWickPrimitive {
    constructor(getCandles) {
      this._getCandles = getCandles;
      this._chart = null;
      this._series = null;
      this._views = [
        { zOrder: () => 'normal', renderer: () => ({ draw: (t) => this._draw(t) }) },
      ];
    }

    attached(param) {
      this._chart = param.chart;
      this._series = param.series;
    }

    detached() {
      this._chart = null;
      this._series = null;
    }

    updateAllViews() {}

    paneViews() {
      return this._views;
    }

    _draw(target) {
      const chart = this._chart;
      const series = this._series;
      if (!chart || !series) return;
      const candles = this._getCandles();
      if (!candles || candles.length === 0) return;
      const timeScale = chart.timeScale();
      const range = timeScale.getVisibleLogicalRange();
      if (!range) return;
      const barSpacing = timeScale.options().barSpacing;

      const from = Math.max(0, Math.floor(range.from) - 1);
      const to = Math.min(candles.length - 1, Math.ceil(range.to) + 1);

      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        // Tối thiểu 1 pixel thật; zoom to thì dày dần theo tỉ lệ
        let w = Math.max(Math.floor(hr), Math.round(barSpacing * hr * WICK_RATIO));
        if (w % 2 === 0 && hr % 2 !== 0) w += 1; // lẻ pixel để râu nằm giữa nến, không nhoè
        for (let i = from; i <= to; i++) {
          const c = candles[i];
          const x = timeScale.logicalToCoordinate(i);
          const yHigh = series.priceToCoordinate(c.high);
          const yLow = series.priceToCoordinate(c.low);
          if (x === null || yHigh === null || yLow === null) continue;
          const left = Math.round(x * hr) - Math.floor(w / 2);
          const top = Math.round(yHigh * vr);
          const bottom = Math.round(yLow * vr);
          ctx.fillStyle = c.close >= c.open ? CANDLE_UP : CANDLE_DOWN;
          ctx.fillRect(left, top, w, Math.max(1, bottom - top));
        }
      });
    }
  }

  function create(paneId) {
    let chart = null;
    let containerRef = null;
    let candleSeries = null;
    let volumeSeries = null;
    let resizeObserver = null;
    let volumeVisible = true;

    // Mỗi đường EMA có 1 series riêng, key theo id của đường.
    const emaSeriesMap = new Map();
    let emaLines = [
      { id: 'ema-1', period: 21, color: '#f5c518', width: 1, source: 'close', enabled: false },
      { id: 'ema-2', period: 200, color: '#ff5f5f', width: 1, source: 'close', enabled: false },
    ];

    let sma50Series = null;
    let bbUpperSeries = null;
    let bbMiddleSeries = null;
    let bbLowerSeries = null;
    let rsiSeries = null;
    let emaRsiSeries = null;
    let wmaRsiSeries = null;
    // RSI cổ điển (bản cũ): 3 series riêng, độc lập với "RSI NĐQ" ở trên
    let rsiCSeries = null;
    let emaRsiCSeries = null;
    let wmaRsiCSeries = null;
    let macdLineSeries = null;
    let macdSignalSeries = null;
    let macdHistSeries = null;

    // RSI mở rộng: cài đặt, dữ liệu tính cho nến cuối, primitive vẽ thêm
    let rsiExtras = sanitizeRsiExtras(null);
    let rsiExtrasData = null;
    let rsiPrim = null;
    let rsiPrimHost = null;

    let currentCandles = [];

    let loadingOlder = false;
    let noMoreOlder = false;

    let higherTFCandles = [];
    let slCandles = null;

    let alertPriceLines = [];

    let recomputeRafId = null;
    let needIndicatorRecompute = false;

    const indicatorConfig = {
      sma50: { label: 'SMA', color: '#2962ff', period: 50, enabled: false },
      bbUpper: { label: 'BB Upper', color: '#26a69a', period: 20, enabled: false },
      bbMiddle: { label: 'BB Middle', color: '#787b86', period: 20, enabled: false },
      bbLower: { label: 'BB Lower', color: '#ef5350', period: 20, enabled: false },
      // Màu mặc định giống Pine: tím / xanh dương / cam, nét 1px
      rsi: { label: 'RSI', color: '#9c27b0', width: 1, period: 14, enabled: false },
      emaRsi: { label: 'EMA(RSI)', color: '#2962ff', width: 1, period: 9, enabled: false },
      wmaRsi: { label: 'WMA(RSI)', color: '#ff9800', width: 1, period: 45, enabled: false },
      // RSI cổ điển (bản cũ): màu/chu kỳ như trước, trục cố định 36-84, có vạch 30/40/50/60/70
      rsiC: { label: 'RSI', color: '#7e57c2', width: 1, period: 14, enabled: false },
      emaRsiC: { label: 'EMA(RSI)', color: '#26a69a', width: 1, period: 9, enabled: false },
      wmaRsiC: { label: 'WMA(RSI)', color: '#ef5350', width: 1, period: 45, enabled: false },
      macdLine: { label: 'MACD Line', color: '#2962ff', period: 12, enabled: false },
      macdSignal: { label: 'MACD Signal', color: '#ff9800', period: 9, enabled: false },
      macdHist: { label: 'MACD Hist', color: '#26a69a', period: 26, enabled: false },
    };

    const breakout = BreakoutModule.create(paneId);

    breakout.setOnNewSignal((direction, time) => {
      EventBus.emit('pane:newSignal', { paneId, direction, time });
    });

    let drawing = null;

    function runBreakout() {
      breakout.run({
        entryCandles: currentCandles,
        higherTFCandles,
        slCandles: slCandles || undefined,
      });
    }

    function scheduleRecompute(needIndicators) {
      if (needIndicators) needIndicatorRecompute = true;
      if (recomputeRafId !== null) return;
      recomputeRafId = requestAnimationFrame(() => {
        recomputeRafId = null;
        if (needIndicatorRecompute) {
          needIndicatorRecompute = false;
          renderIndicators(currentCandles);
        }
        runBreakout();
      });
    }

    function handleKlineUpdate({ paneId: sourcePaneId, candle }) {
      if (sourcePaneId !== paneId) return;
      Store.upsertPaneCandle(paneId, candle);

      candleSeries.update({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });

      volumeSeries.update({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? VOLUME_UP : VOLUME_DOWN,
      });

      const lastIndex = currentCandles.length - 1;
      if (lastIndex >= 0 && currentCandles[lastIndex].time === candle.time) {
        currentCandles[lastIndex] = candle;
      } else {
        currentCandles.push(candle);
      }
      scheduleRecompute(true);
    }

    /** Áp màu chart (nền/lưới/chữ/viền trục) theo theme hiện tại. */
    function applyChartTheme(theme) {
      if (!chart) return;
      const c = CHART_THEME[theme] || CHART_THEME.dark;
      chart.applyOptions({
        layout: {
          background: { type: 'solid', color: c.background },
          textColor: c.text,
          panes: { separatorColor: c.border },
        },
        grid: {
          vertLines: { color: c.grid },
          horzLines: { color: c.grid },
        },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
      });
    }

    function handleThemeChanged({ theme }) {
      applyChartTheme(theme);
    }

    /** Đổi symbol của pane này -> nạp đúng bộ hình vẽ đã lưu của symbol mới
     * (hình của symbol cũ được lưu lại trước đó bên trong drawing). */
    function handleSymbolChangedForDrawing({ paneId: pid, symbol }) {
      if (pid !== paneId || !drawing) return;
      drawing.loadForSymbol(symbol);
    }

    function initChart(container) {
      containerRef = container;

      const initialTheme = (typeof ThemeModule !== 'undefined' && ThemeModule.getTheme()) || 'dark';
      const initialColors = CHART_THEME[initialTheme] || CHART_THEME.dark;

      chart = LightweightCharts.createChart(container, {
        autoSize: true, // để thư viện tự resize theo container
        layout: {
          background: { type: 'solid', color: initialColors.background },
          textColor: initialColors.text,
          panes: { separatorColor: initialColors.border },
        },
        grid: {
          vertLines: { color: initialColors.grid },
          horzLines: { color: initialColors.grid },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: initialColors.border },
        timeScale: { borderColor: initialColors.border, timeVisible: true, secondsVisible: false },
      });

             candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: CANDLE_UP,
        downColor: CANDLE_DOWN,
        borderVisible: false,
        wickVisible: false,
      });
      candleSeries.attachPrimitive(new ThickWickPrimitive(() => currentCandles));

      breakout.init(chart, candleSeries);

      volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const overlayOpts = {
        lineWidth: 1,
        title: '',
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: false,
      };
      sma50Series = chart.addSeries(LightweightCharts.LineSeries, { ...overlayOpts, color: '#2962ff' }, 0);
      bbUpperSeries = chart.addSeries(LightweightCharts.LineSeries, { ...overlayOpts, color: '#26a69a' }, 0);
      bbMiddleSeries = chart.addSeries(LightweightCharts.LineSeries, { ...overlayOpts, color: '#787b86' }, 0);
      bbLowerSeries = chart.addSeries(LightweightCharts.LineSeries, { ...overlayOpts, color: '#ef5350' }, 0);

      // Tạo series cho các đường EMA hiện có
      syncEmaSeries();

      updatePaneStretchFactors();

      setupResize(container);

      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return;
        if (range.from < 15 && !loadingOlder && !noMoreOlder) {
          EventBus.emit('pane:needMoreHistory', { paneId });
        }
      });

      EventBus.on('kline:update', handleKlineUpdate);
      EventBus.on('alerts:changed', renderAlertLines);
      EventBus.on('theme:changed', handleThemeChanged);

      drawing = DrawingModule.create(paneId, chart, candleSeries, container, {
        onAlertRequested: (price) => {
          const pane = Store.getPane(paneId);
          if (!pane) return;
          AlertsModule.addPriceAlert(pane.symbol, price);
        },
        onToolChanged: () => {
          EventBus.emit('pane:drawToolChanged', { paneId });
        },
      });

      // Nạp hình vẽ đã lưu của symbol hiện tại + theo dõi các lần đổi symbol sau.
      const initPane = Store.getPane(paneId);
      if (initPane) drawing.loadForSymbol(initPane.symbol);
      EventBus.on('pane:symbolChanged', handleSymbolChangedForDrawing);

      return chart;
    }

    let lastWidth = 0;
    let lastHeight = 0;
    let resizeRafId = null;

    function applyResize() {
      if (!chart || !containerRef) return;
      const width = Math.floor(containerRef.clientWidth);
      const height = Math.floor(containerRef.clientHeight);
      if (width <= 0 || height <= 0) return;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      chart.resize(width, height);
    }

    function setupResize(container) {
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(() => {
        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(() => {
          resizeRafId = null;
          applyResize();
        });
      });
      resizeObserver.observe(container);
    }

    function resize() {
      if (resizeRafId) {
        cancelAnimationFrame(resizeRafId);
        resizeRafId = null;
      }
      applyResize();
    }

    // ===== NHÓM EMA =====

    /** Chuẩn hoá 1 đường EMA (chặn giá trị sai khi đọc từ localStorage / popover). */
    function sanitizeEmaLine(l, i) {
      const period = parseInt(l.period, 10);
      const width = parseInt(l.width, 10);
      return {
        id: l.id || `ema-${Date.now()}-${i}`,
        period: period > 0 ? Math.min(period, 1000) : 21,
        color: typeof l.color === 'string' && l.color ? l.color : '#f5c518',
        width: width >= 1 && width <= 4 ? width : 1,
        source: EMA_SOURCES.includes(l.source) ? l.source : 'close',
        enabled: !!l.enabled,
      };
    }

    /** Đồng bộ series trên chart với danh sách emaLines (thêm/xóa/cập nhật style). */
    function syncEmaSeries() {
      if (!chart) return;
      const ids = new Set(emaLines.map((l) => l.id));
      emaSeriesMap.forEach((s, id) => {
        if (!ids.has(id)) {
          try {
            chart.removeSeries(s);
          } catch (err) {
            // Series có thể đã bị huỷ - bỏ qua an toàn.
          }
          emaSeriesMap.delete(id);
        }
      });
      emaLines.forEach((l) => {
        const opts = {
          color: l.color,
          lineWidth: l.width,
          visible: l.enabled,
          title: '',
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        };
        const s = emaSeriesMap.get(l.id);
        if (s) s.applyOptions(opts);
        else emaSeriesMap.set(l.id, chart.addSeries(LightweightCharts.LineSeries, opts, 0));
      });
    }

    /** Thay toàn bộ danh sách đường EMA (tối đa MAX_EMA_LINES). */
    function setEmaLines(lines) {
      emaLines = (lines || []).slice(0, MAX_EMA_LINES).map(sanitizeEmaLine);
      syncEmaSeries();
      renderIndicators(currentCandles);
      persistIndicatorPrefs();
    }

    /** Bật/tắt TẤT CẢ đường EMA cùng lúc (khi bấm chip "EMA"). */
    function setEmaGroupVisible(visible) {
      setEmaLines(emaLines.map((l) => ({ ...l, enabled: visible })));
    }

    function getEmaLines() {
      return emaLines.map((l) => ({ ...l }));
    }

    // ===== RSI BY NĐQ: dữ liệu + vẽ thêm =====

        /** Trục RSI: tối thiểu 30-70, luôn gồm cả các mức ngang, tự nới ra nếu dữ liệu vượt biên. */
    function rsiAutoscaleProvider(original) {
      const info = original();
      if (!info || !info.priceRange) return info;
      let min = Math.min(30, info.priceRange.minValue);
      let max = Math.max(70, info.priceRange.maxValue);
      if (rsiExtras.levels.length) {
        min = Math.min(min, ...rsiExtras.levels);
        max = Math.max(max, ...rsiExtras.levels);
      }
      return { priceRange: { minValue: min, maxValue: max }, margins: info.margins };
    }

    /** Gắn primitive vào 1 series đang có của pane RSI (rsi -> emaRsi -> wmaRsi). */
    function ensureRsiPrimitive() {
      const host = rsiSeries || emaRsiSeries || wmaRsiSeries || null;
      if (host === rsiPrimHost) return;
      if (rsiPrimHost && rsiPrim) {
        try {
          rsiPrimHost.detachPrimitive(rsiPrim);
        } catch (err) {
          // Series cũ có thể đã bị gỡ khỏi chart - bỏ qua an toàn.
        }
      }
      rsiPrim = null;
      rsiPrimHost = null;
      if (!host) return;
      rsiPrim = new RsiExtrasPrimitive(() => ({ config: rsiExtras, data: rsiExtrasData }));
      host.attachPrimitive(rsiPrim);
      rsiPrimHost = host;
    }

    /**
     * Tính nhãn "bảng giá theo mức RSI" + các đường SnR cho NẾN CUỐI (giống Pine:
     * chỉ nến cuối mới có nhãn / đường). avgGain, avgLoss và close[1] lấy tại
     * nến liền trước, đúng như code Pine.
     */
    function updateRsiExtras(candles, rsi, wmaOfRsi) {
      if (!rsiPrim) return;
      const n = candles.length;
      const L = n - 1;
      const data = { lastIndex: L, labels: [], snr: [] };
      const len = indicatorConfig.rsi.period;

      if (rsiExtras.showLadder && n >= 3) {
        const state = IndicatorModule.calcRSIState(candles, len);
        const avgGain = state.avgGain[L - 1];
        const avgLoss = state.avgLoss[L - 1];
        const prevClose = candles[L - 1].close;
        if (avgGain !== null && avgLoss !== null) {
          rsiExtras.levels.forEach((level) => {
            const price = IndicatorModule.calcRSITargetPrice(level, prevClose, avgGain, avgLoss, len);
            if (Number.isFinite(price)) {
              data.labels.push({ kind: 'level', rsi: level, text: formatLadderPrice(price) });
            }
          });
          const wma = wmaOfRsi[L];
          if (wma !== null && wma !== undefined && wma > 0 && wma < 100) {
            const price = IndicatorModule.calcRSITargetPrice(wma, prevClose, avgGain, avgLoss, len);
            if (Number.isFinite(price)) {
              data.labels.push({ kind: 'wma', rsi: wma, text: formatLadderPrice(price) });
            }
          }
        }
      }

      if (rsiExtras.showSnr) {
        const firstValid = rsi.findIndex((v) => v !== null && v !== undefined);
        rsiExtras.snrLookbacks.forEach((lb) => {
          // Cần đủ `lb` nến RSI trước nến cuối (giống Pine: chưa đủ thì không vẽ)
          if (firstValid < 0 || L - lb < firstValid) return;
          let hi = -Infinity;
          let hiIdx = -1;
          let lo = Infinity;
          let loIdx = -1;
          for (let j = L - 1; j >= L - lb; j--) {
            const v = rsi[j];
            if (v > hi) {
              hi = v;
              hiIdx = j;
            }
            if (v < lo) {
              lo = v;
              loIdx = j;
            }
          }
          // Pine bắt đầu đường ở nến liền SAU nến đạt đỉnh/đáy (do dùng rsi[1])
          if (hiIdx >= 0) data.snr.push({ kind: 'high', startIndex: hiIdx + 1, value: hi });
          if (loIdx >= 0) data.snr.push({ kind: 'low', startIndex: loIdx + 1, value: lo });
        });
      }

      rsiExtrasData = data;
      rsiPrim.requestRedraw();
    }

    function getRsiExtras() {
      return JSON.parse(JSON.stringify(rsiExtras));
    }

    /** Đổi cài đặt RSI mở rộng (nguồn giá, mức RSI, bảng giá, SnR, màu...). */
    function setRsiExtras(partial) {
      rsiExtras = sanitizeRsiExtras({ ...rsiExtras, ...(partial || {}) });
      renderIndicators(currentCandles);
      if (rsiPrim) rsiPrim.requestRedraw();
      persistIndicatorPrefs();
    }

    function renderIndicators(candles) {
      if (!candles || candles.length === 0) return;
      const closes = candles.map((c) => c.close);

      // Chỉ tính các đường EMA đang bật
      emaLines.forEach((l) => {
        const s = emaSeriesMap.get(l.id);
        if (!s || !l.enabled) return;
        const vals = candles.map((c) => (c[l.source] !== undefined ? c[l.source] : c.close));
        s.setData(IndicatorModule.toSeriesData(candles, IndicatorModule.calcEMA(vals, l.period)));
      });

      const sma50 = IndicatorModule.calcSMA(closes, indicatorConfig.sma50.period);
      if (sma50Series) sma50Series.setData(IndicatorModule.toSeriesData(candles, sma50));

      const bb = IndicatorModule.calcBB(closes, indicatorConfig.bbMiddle.period, 2);
      if (bbMiddleSeries) bbMiddleSeries.setData(IndicatorModule.toSeriesData(candles, bb.middle));
      if (bbUpperSeries) bbUpperSeries.setData(IndicatorModule.toSeriesData(candles, bb.upper));
      if (bbLowerSeries) bbLowerSeries.setData(IndicatorModule.toSeriesData(candles, bb.lower));

      const rsi = IndicatorModule.calcRSI(candles, indicatorConfig.rsi.period, rsiExtras.source);
      const emaOfRsi = IndicatorModule.calcEMA(rsi, indicatorConfig.emaRsi.period);
      const wmaOfRsi = IndicatorModule.calcWMA(rsi, indicatorConfig.wmaRsi.period);
      if (rsiSeries) rsiSeries.setData(IndicatorModule.toSeriesData(candles, rsi));
      if (emaRsiSeries) emaRsiSeries.setData(IndicatorModule.toSeriesData(candles, emaOfRsi));
      if (wmaRsiSeries) wmaRsiSeries.setData(IndicatorModule.toSeriesData(candles, wmaOfRsi));
      updateRsiExtras(candles, rsi, wmaOfRsi);

      // RSI cổ điển (luôn tính theo close, không có phần vẽ thêm)
      if (rsiCSeries || emaRsiCSeries || wmaRsiCSeries) {
        const rsiC = IndicatorModule.calcRSI(candles, indicatorConfig.rsiC.period);
        if (rsiCSeries) rsiCSeries.setData(IndicatorModule.toSeriesData(candles, rsiC));
        if (emaRsiCSeries) {
          const v = IndicatorModule.calcEMA(rsiC, indicatorConfig.emaRsiC.period);
          emaRsiCSeries.setData(IndicatorModule.toSeriesData(candles, v));
        }
        if (wmaRsiCSeries) {
          const v = IndicatorModule.calcWMA(rsiC, indicatorConfig.wmaRsiC.period);
          wmaRsiCSeries.setData(IndicatorModule.toSeriesData(candles, v));
        }
      }

      const macd = IndicatorModule.calcMACD(
        closes,
        indicatorConfig.macdLine.period,
        indicatorConfig.macdHist.period,
        indicatorConfig.macdSignal.period
      );
      if (macdLineSeries) macdLineSeries.setData(IndicatorModule.toSeriesData(candles, macd.macd));
      if (macdSignalSeries) macdSignalSeries.setData(IndicatorModule.toSeriesData(candles, macd.signal));

      if (macdHistSeries) {
        const histData = candles
          .map((c, i) => {
            const val = macd.hist[i];
            if (val === null || val === undefined) return null;
            return {
              time: c.time,
              value: val,
              color: val >= 0 ? 'rgba(38, 166, 154, 0.6)' : 'rgba(239, 83, 80, 0.6)',
            };
          })
          .filter((d) => d !== null);
        macdHistSeries.setData(histData);
      }
    }

    /** Lưu lại toàn bộ trạng thái bật/tắt + period của mọi chỉ báo trong
     * pane này (cục bộ, theo tài khoản) - gọi mỗi khi bật/tắt hoặc đổi period.
     * Danh sách EMA lưu riêng ở key `emaLines`. */
    function persistIndicatorPrefs() {
      if (typeof IndicatorPrefsModule === 'undefined') return;
      const prefs = {};
      Object.keys(indicatorConfig).forEach((k) => {
        prefs[k] = {
          enabled: indicatorConfig[k].enabled,
          period: indicatorConfig[k].period,
          color: indicatorConfig[k].color,
          width: indicatorConfig[k].width,
        };
      });
      prefs.emaLines = emaLines.map((l) => ({ ...l }));
      prefs.rsiExtras = JSON.parse(JSON.stringify(rsiExtras));
      IndicatorPrefsModule.setPanePrefs(paneId, prefs);
    }

    /** Khôi phục chỉ báo đã lưu của pane này - gọi sau khi nến đầu tiên đã
     * tải xong (xem loadInitialData). Đặt period TRƯỚC khi bật để lần render
     * đầu đã đúng luôn. */
    function restoreIndicatorPrefs() {
      if (typeof IndicatorPrefsModule === 'undefined') return;
      const saved = IndicatorPrefsModule.getPanePrefs(paneId);
      if (!saved) return;

      // EMA: đọc danh sách mới, hoặc di trú dữ liệu cũ ema21/ema200.
      // (Không gọi persist ở đây để khỏi ghi đè prefs khi các chỉ báo khác
      // chưa được khôi phục xong.)
      if (Array.isArray(saved.emaLines)) {
        emaLines = saved.emaLines.slice(0, MAX_EMA_LINES).map(sanitizeEmaLine);
        syncEmaSeries();
        scheduleRecompute(true);
      } else if (saved.ema21 || saved.ema200) {
        emaLines = emaLines.map((l, i) => {
          const s = i === 0 ? saved.ema21 : saved.ema200;
          return s ? { ...l, period: s.period || l.period, enabled: !!s.enabled } : l;
        });
        syncEmaSeries();
        scheduleRecompute(true);
      }

      // RSI mở rộng (nguồn giá, mức RSI, bảng giá, SnR...)
      if (saved.rsiExtras) {
        rsiExtras = sanitizeRsiExtras(saved.rsiExtras);
        scheduleRecompute(true);
      }

      Object.keys(saved).forEach((k) => {
        if (!indicatorConfig[k]) return;
        if (saved[k].period) indicatorConfig[k].period = saved[k].period;
        if (STYLABLE_KEYS.includes(k)) {
          if (typeof saved[k].color === 'string' && /^#[0-9a-f]{6}$/i.test(saved[k].color)) {
            indicatorConfig[k].color = saved[k].color;
          }
          const w = parseInt(saved[k].width, 10);
          if (w >= 1 && w <= 4) indicatorConfig[k].width = w;
        }
        if (saved[k].enabled) setIndicatorVisible(k, true);
      });
    }

    function seriesForKey(key) {
      return {
        sma50: sma50Series,
        bbMiddle: bbMiddleSeries,
        bbUpper: bbUpperSeries,
        bbLower: bbLowerSeries,
        rsi: rsiSeries,
        emaRsi: emaRsiSeries,
        wmaRsi: wmaRsiSeries,
        rsiC: rsiCSeries,
        emaRsiC: emaRsiCSeries,
        wmaRsiC: wmaRsiCSeries,
        macdLine: macdLineSeries,
        macdSignal: macdSignalSeries,
        macdHist: macdHistSeries,
      }[key];
    }

    function updatePaneStretchFactors() {
      if (!chart) return;
      try {
        const panes = chart.panes();
        if (!panes || panes.length === 0) return;

        const pane1Active = !!(
          rsiSeries ||
          emaRsiSeries ||
          wmaRsiSeries ||
          rsiCSeries ||
          emaRsiCSeries ||
          wmaRsiCSeries
        );
        const pane2Active = !!(macdLineSeries || macdSignalSeries || macdHistSeries);

        let f0 = 1.0;
        let f1 = 0.0;
        let f2 = 0.0;

        if (pane1Active && pane2Active) {
          f0 = 0.6;
          f1 = 0.2;
          f2 = 0.2;
        } else if (pane1Active) {
          f0 = 0.75;
          f1 = 0.25;
        } else if (pane2Active) {
          f0 = 0.75;
          f2 = 0.25;
        }

        if (panes[0] && typeof panes[0].setStretchFactor === 'function') panes[0].setStretchFactor(f0);
        if (panes[1] && typeof panes[1].setStretchFactor === 'function') panes[1].setStretchFactor(f1);
        if (panes[2] && typeof panes[2].setStretchFactor === 'function') panes[2].setStretchFactor(f2);
      } catch (err) {
        console.warn(`[${paneId}] Không thể cập nhật tỉ lệ pane:`, err);
      }
    }

    function setIndicatorVisible(key, visible) {
      const cfg = indicatorConfig[key];
      if (!cfg) return;
      cfg.enabled = visible;

      if (visible) {
        const series = seriesForKey(key);
        if (!series) {
          const fixedRSIRangeProvider = rsiAutoscaleProvider;

          if (key === 'rsi') {
            rsiSeries = chart.addSeries(
              LightweightCharts.LineSeries,
              {
                color: '#7e57c2',
                lineWidth: 1.5,
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
                autoscaleInfoProvider: fixedRSIRangeProvider,
              },
              1
            );
            // Các đường mức RSI (20..80) giờ do RsiExtrasPrimitive vẽ - xem ensureRsiPrimitive()
          } else if (key === 'emaRsi') {
            emaRsiSeries = chart.addSeries(
              LightweightCharts.LineSeries,
              {
                color: '#26a69a',
                lineWidth: 1.5,
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
                autoscaleInfoProvider: fixedRSIRangeProvider,
              },
              1
            );
          } else if (key === 'wmaRsi') {
            wmaRsiSeries = chart.addSeries(
              LightweightCharts.LineSeries,
              {
                color: '#ef5350',
                lineWidth: 1.5,
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
                autoscaleInfoProvider: fixedRSIRangeProvider,
              },
              1
            );
          } else if (key === 'rsiC' || key === 'emaRsiC' || key === 'wmaRsiC') {
                        // RSI cổ điển: trục tối thiểu 30-70, tự nới ra nếu dữ liệu vượt biên
            const classicRangeProvider = (original) => {
              const info = original();
              if (!info || !info.priceRange) return info;
              return {
                priceRange: {
                  minValue: Math.min(30, info.priceRange.minValue),
                  maxValue: Math.max(70, info.priceRange.maxValue),
                },
                margins: info.margins,
              };
            };
            const s = chart.addSeries(
              LightweightCharts.LineSeries,
              {
                color: cfg.color,
                lineWidth: cfg.width,
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
                autoscaleInfoProvider: classicRangeProvider,
              },
              1
            );
            if (key === 'rsiC') {
              rsiCSeries = s;
              [50, 40, 60, 30, 70].forEach((level) => {
                s.createPriceLine({
                  price: level,
                  color: level === 50 ? '#5d6274' : '#595e6d',
                  lineWidth: 1,
                  lineStyle: LightweightCharts.LineStyle.Dotted,
                  axisLabelVisible: true,
                  title: '',
                });
              });
            } else if (key === 'emaRsiC') emaRsiCSeries = s;
            else wmaRsiCSeries = s;
          } else if (key === 'macdLine') {
            macdLineSeries = chart.addSeries(
              LightweightCharts.LineSeries,
              {
                color: '#2962ff',
                lineWidth: 1.5,
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
              },
              2
            );
          } else if (key === 'macdSignal') {
            macdSignalSeries = chart.addSeries(
              LightweightCharts.LineSeries,
              {
                color: '#ff9800',
                lineWidth: 1.5,
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
              },
              2
            );
          } else if (key === 'macdHist') {
            macdHistSeries = chart.addSeries(
              LightweightCharts.HistogramSeries,
              {
                color: '#26a69a',
                title: '',
                priceLineVisible: false,
                lastValueVisible: false,
              },
              2
            );
          } else {
            const s = seriesForKey(key);
            if (s) s.applyOptions({ visible: true });
          }
        } else {
          series.applyOptions({ visible: true });
        }
      } else {
        const series = seriesForKey(key);
        if (series) {
          if (
            ['rsi', 'emaRsi', 'wmaRsi', 'rsiC', 'emaRsiC', 'wmaRsiC', 'macdLine', 'macdSignal', 'macdHist'].includes(
              key
            )
          ) {
            chart.removeSeries(series);
            if (key === 'rsi') rsiSeries = null;
            else if (key === 'emaRsi') emaRsiSeries = null;
            else if (key === 'wmaRsi') wmaRsiSeries = null;
            else if (key === 'rsiC') rsiCSeries = null;
            else if (key === 'emaRsiC') emaRsiCSeries = null;
            else if (key === 'wmaRsiC') wmaRsiCSeries = null;
            else if (key === 'macdLine') macdLineSeries = null;
            else if (key === 'macdSignal') macdSignalSeries = null;
            else if (key === 'macdHist') macdHistSeries = null;
          } else {
            series.applyOptions({ visible: false });
          }
        }
      }

      applyLineStyle(key);
      ensureRsiPrimitive();
      scheduleRecompute(true);
      updatePaneStretchFactors();
      persistIndicatorPrefs();
    }

    const STYLABLE_KEYS = ['rsi', 'emaRsi', 'wmaRsi', 'rsiC', 'emaRsiC', 'wmaRsiC'];

    /** Áp màu + độ dày nét đã lưu trong indicatorConfig lên series (nếu series đang tồn tại). */
    function applyLineStyle(key) {
      const cfg = indicatorConfig[key];
      if (!cfg || !STYLABLE_KEYS.includes(key)) return;
      const s = seriesForKey(key);
      if (s) s.applyOptions({ color: cfg.color, lineWidth: cfg.width });
    }

    /** Đổi màu / độ dày nét (1-4) của RSI, EMA(RSI), WMA(RSI). */
    function setIndicatorStyle(key, style) {
      const cfg = indicatorConfig[key];
      if (!cfg || !STYLABLE_KEYS.includes(key) || !style) return;
      if (typeof style.color === 'string' && /^#[0-9a-f]{6}$/i.test(style.color)) cfg.color = style.color;
      const w = parseInt(style.width, 10);
      if (w >= 1 && w <= 4) cfg.width = w;
      applyLineStyle(key);
      persistIndicatorPrefs();
    }

    function setIndicatorPeriod(key, period) {
      const cfg = indicatorConfig[key];
      if (!cfg || !period || period <= 0) return;
      cfg.period = period;
      renderIndicators(currentCandles);
      persistIndicatorPrefs();
    }

    function getIndicatorConfig() {
      return {
        ...JSON.parse(JSON.stringify(indicatorConfig)),
        emaLines: getEmaLines(),
        rsiExtras: getRsiExtras(),
      };
    }

    function setVolumeVisible(visible) {
      volumeVisible = visible;
      if (volumeSeries) volumeSeries.applyOptions({ visible });
    }

    function getVolumeVisible() {
      return volumeVisible;
    }

    function setHigherTFCandles(candles) {
      higherTFCandles = candles ? candles.slice() : [];
      runBreakout();
    }

    function upsertHigherTFCandle(candle) {
      const idx = higherTFCandles.findIndex((c) => c.time === candle.time);
      if (idx >= 0) higherTFCandles[idx] = candle;
      else higherTFCandles.push(candle);
      scheduleRecompute(false);
    }

    function getHigherTFCandles() {
      return higherTFCandles.slice();
    }

    function setSLCandles(candles) {
      slCandles = candles ? candles.slice() : null;
      runBreakout();
    }

    function upsertSLCandle(candle) {
      if (!slCandles) slCandles = [];
      const idx = slCandles.findIndex((c) => c.time === candle.time);
      if (idx >= 0) slCandles[idx] = candle;
      else slCandles.push(candle);
      scheduleRecompute(false);
    }

    function configureBreakout(options) {
      breakout.configure(options || {});
      runBreakout();
    }

    function getBreakoutConfig() {
      return breakout.getConfig();
    }

    function clearAlertLines() {
      alertPriceLines.forEach((line) => {
        try {
          candleSeries.removePriceLine(line);
        } catch (err) {
          // Series có thể đã bị huỷ - bỏ qua an toàn.
        }
      });
      alertPriceLines = [];
    }

    function renderAlertLines() {
      clearAlertLines();
      const pane = Store.getPane(paneId);
      if (!pane || !candleSeries) return;

      AlertsModule.getAlertsForSymbol(pane.symbol).forEach((a) => {
        const line = candleSeries.createPriceLine({
          price: a.price,
          color: '#f5c518',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: '🔔 Cảnh báo',
        });
        alertPriceLines.push(line);
      });
    }

    function loadInitialData(candles) {
      currentCandles = candles.slice();

      candleSeries.setData(
        candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
      );
      volumeSeries.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? VOLUME_UP : VOLUME_DOWN,
        }))
      );

      renderIndicators(currentCandles);
      runBreakout();
      renderAlertLines();
      restoreIndicatorPrefs();
    }

    function clearData() {
      if (candleSeries) candleSeries.setData([]);
      if (volumeSeries) volumeSeries.setData([]);
      emaSeriesMap.forEach((s) => s.setData([]));
      if (sma50Series) sma50Series.setData([]);
      if (bbUpperSeries) bbUpperSeries.setData([]);
      if (bbMiddleSeries) bbMiddleSeries.setData([]);
      if (bbLowerSeries) bbLowerSeries.setData([]);
      if (rsiSeries) rsiSeries.setData([]);
      if (emaRsiSeries) emaRsiSeries.setData([]);
      if (wmaRsiSeries) wmaRsiSeries.setData([]);
      if (rsiCSeries) rsiCSeries.setData([]);
      if (emaRsiCSeries) emaRsiCSeries.setData([]);
      if (wmaRsiCSeries) wmaRsiCSeries.setData([]);
      if (macdLineSeries) macdLineSeries.setData([]);
      if (macdSignalSeries) macdSignalSeries.setData([]);
      if (macdHistSeries) macdHistSeries.setData([]);
      currentCandles = [];
      higherTFCandles = [];
      slCandles = null;
      rsiExtrasData = null;
      if (rsiPrim) rsiPrim.requestRedraw();
      resetHistoryFlags();
      runBreakout();
    }

    function isLoadingOlder() {
      return loadingOlder;
    }

    function setLoadingOlder(v) {
      loadingOlder = !!v;
    }

    function isNoMoreOlder() {
      return noMoreOlder;
    }

    function setNoMoreOlder(v) {
      noMoreOlder = !!v;
    }

    function resetHistoryFlags() {
      loadingOlder = false;
      noMoreOlder = false;
    }

    function prependCandles(olderCandles) {
      if (!olderCandles || olderCandles.length === 0) return;

      const firstExistingTime = currentCandles.length ? currentCandles[0].time : Infinity;
      const filtered = olderCandles
        .filter((c) => c.time < firstExistingTime)
        .sort((a, b) => a.time - b.time);

      if (filtered.length === 0) return;

      currentCandles = filtered.concat(currentCandles);

      const timeScale = chart.timeScale();
      const beforeRange = timeScale.getVisibleLogicalRange();

      candleSeries.setData(
        currentCandles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
      );
      volumeSeries.setData(
        currentCandles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? VOLUME_UP : VOLUME_DOWN,
        }))
      );

      renderIndicators(currentCandles);
      runBreakout();

      if (beforeRange) {
        const addedCount = filtered.length;
        timeScale.setVisibleLogicalRange({
          from: beforeRange.from + addedCount,
          to: beforeRange.to + addedCount,
        });
      }
    }

    function destroy() {
      EventBus.off('kline:update', handleKlineUpdate);
      EventBus.off('alerts:changed', renderAlertLines);
      EventBus.off('theme:changed', handleThemeChanged);
      EventBus.off('pane:symbolChanged', handleSymbolChangedForDrawing);
      if (drawing) drawing.flushSave(); // lưu nốt hình vẽ trước khi huỷ
      if (resizeObserver) resizeObserver.disconnect();
      if (recomputeRafId !== null) {
        cancelAnimationFrame(recomputeRafId);
        recomputeRafId = null;
      }
      if (chart) chart.remove();
      chart = null;
      emaSeriesMap.clear();
    }

    return {
      initChart,
      loadInitialData,
      clearData,
      destroy,
      resize,
      setIndicatorVisible,
      setIndicatorPeriod,
      setIndicatorStyle,
      getIndicatorConfig,
      setEmaLines,
      setEmaGroupVisible,
      setRsiExtras,
      setVolumeVisible,
      getVolumeVisible,
      setHigherTFCandles,
      upsertHigherTFCandle,
      getHigherTFCandles,
      setSLCandles,
      upsertSLCandle,
      configureBreakout,
      getBreakoutConfig,
      isLoadingOlder,
      setLoadingOlder,
      isNoMoreOlder,
      setNoMoreOlder,
      prependCandles,
      getCandles: () => currentCandles.slice(),
      getBreakout: () => breakout,
      getDrawing: () => drawing,
    };
  }

  return { create, getHigherTimeframeFor, ENTRY_TO_HIGHER_TF };
})();