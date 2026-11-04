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
  // >1 = nhạy hơn. 1 = như mặc định, 1.8-2.5 là hợp với mobile
  const PINCH_ZOOM_GAIN = 2.0;
  const MAX_BAR_SPACING = 60;
  const MIN_BAR_SPACING = 0.5;
  const EMA_SOURCES = ['close', 'open', 'high', 'low'];

  

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
  const RSI_LABEL_OFFSET_BARS = 15; // Pine vẽ nhãn / đường tới bar_index + 15
  const RSI_LINE_DEFAULT = { show: true, color: '#787b86', alpha: 0.5, style: 'dotted' };
  const RSI_LINE_STYLES = ['solid', 'dashed', 'dotted'];
  const RSI_EXTRAS_DEFAULT = {
    source: 'close',
    levels: [20, 30, 40, 50, 60, 70, 80],
    levelStyles: [0, 1, 2, 3, 4, 5, 6].map(() => ({ ...RSI_LINE_DEFAULT })),
    bandLow: { ...RSI_LINE_DEFAULT, value: 30 },
    bandHigh: { ...RSI_LINE_DEFAULT, value: 70 },
    bg: { show: true, color: '#5970b9', alpha: 0.1 }, // "Hlines Background"
    showLadder: true,
    ladderColor: '#cfcfcf',
    ladderWmaColor: '#f23645',
    showSnr: true,
    snrLookbacks: [34, 89, 200],
    snrResistanceColor: '#5289ff',
    snrSupportColor: '#5289ff',
    snrResistanceAlpha: 0.5,
    snrSupportAlpha: 0.5,
    tfs: null, // null = hiện ở mọi khung
  };

  function clampAlpha(v, def) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : def;
  }

  function sanitizeRsiLine(src, def) {
    const s = src || {};
    return {
      show: s.show === undefined ? def.show : !!s.show,
      color: isHexColor(s.color) ? s.color : def.color,
      alpha: clampAlpha(s.alpha, def.alpha),
      style: RSI_LINE_STYLES.includes(s.style) ? s.style : def.style,
    };
  }

  /** Chuẩn hoá cài đặt RSI mở rộng (chặn giá trị sai từ hộp thoại / localStorage). */
  function sanitizeRsiExtras(src) {
    const d = RSI_EXTRAS_DEFAULT;
    const s = src || {};
    const levels = d.levels.map((def, i) => {
      const v = parseFloat(s.levels && s.levels[i]);
      return Number.isFinite(v) ? Math.min(99, Math.max(1, v)) : def;
    });
    const levelStyles = d.levelStyles.map((def, i) => sanitizeRsiLine(s.levelStyles && s.levelStyles[i], def));
    const band = (key) => {
      const b = sanitizeRsiLine(s[key], d[key]);
      const v = parseFloat(s[key] && s[key].value);
      b.value = Number.isFinite(v) ? Math.min(99, Math.max(1, v)) : d[key].value;
      return b;
    };
    const snrLookbacks = d.snrLookbacks.map((def, i) => {
      const v = parseInt(s.snrLookbacks && s.snrLookbacks[i], 10);
      return v >= 2 ? Math.min(v, 1000) : def;
    });
    const sb = s.bg || {};
    // tương thích dữ liệu cũ: showFill -> bg.show
    const bgShow = sb.show !== undefined ? !!sb.show : s.showFill !== undefined ? !!s.showFill : d.bg.show;
    return {
      source: EMA_SOURCES.includes(s.source) ? s.source : d.source,
      levels,
      levelStyles,
      bandLow: band('bandLow'),
      bandHigh: band('bandHigh'),
      bg: {
        show: bgShow,
        color: isHexColor(sb.color) ? sb.color : d.bg.color,
        alpha: clampAlpha(sb.alpha, d.bg.alpha),
      },
      showLadder: s.showLadder === undefined ? d.showLadder : !!s.showLadder,
      ladderColor: isHexColor(s.ladderColor) ? s.ladderColor : d.ladderColor,
      ladderWmaColor: isHexColor(s.ladderWmaColor) ? s.ladderWmaColor : d.ladderWmaColor,
      showSnr: s.showSnr === undefined ? d.showSnr : !!s.showSnr,
      snrLookbacks,
      snrResistanceColor: isHexColor(s.snrResistanceColor) ? s.snrResistanceColor : d.snrResistanceColor,
      snrSupportColor: isHexColor(s.snrSupportColor) ? s.snrSupportColor : d.snrSupportColor,
      snrResistanceAlpha: clampAlpha(s.snrResistanceAlpha, d.snrResistanceAlpha),
      snrSupportAlpha: clampAlpha(s.snrSupportAlpha, d.snrSupportAlpha),
      tfs: Array.isArray(s.tfs) && s.tfs.length ? s.tfs.map(String) : null,
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
        { zOrder: () => 'normal', renderer: () => ({ draw: (t) => this._drawLevels(t) }) },
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
        
        

        if (config.bg.show) {
          const yH = toY(config.bandHigh.value);
          const yL = toY(config.bandLow.value);
          if (yH !== null && yL !== null) {
            ctx.fillStyle = hexToRgba(config.bg.color, config.bg.alpha);
            ctx.fillRect(0, Math.min(yH, yL), width, Math.abs(yL - yH));
          }
        }

        
      });
    }

        _drawLevels(target) {
      const series = this._series;
      if (!series) return;
      const { config } = this._getState();
      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        const width = scope.bitmapSize.width;
        const lw = Math.max(1, Math.floor(hr));
        const step = { dashed: [4 * lw, 4 * lw], dotted: [lw, 2 * lw] };

        // Mỗi mức giá chỉ vẽ một lần (band 30/70 trùng level 2/6 thì band thắng)
        const lines = new Map();
        config.levels.forEach((v, i) => {
          if (config.levelStyles[i].show) lines.set(v, config.levelStyles[i]);
        });
        [config.bandLow, config.bandHigh].forEach((b) => {
          if (b.show) lines.set(b.value, b);
        });

        lines.forEach((l, v) => {
          const yc = series.priceToCoordinate(v);
          if (yc === null) return;
          const y = Math.round(yc * vr) - Math.floor(lw / 2);
          ctx.fillStyle = hexToRgba(l.color, l.alpha);
          if (l.style === 'solid') {
            ctx.fillRect(0, y, width, lw);
            return;
          }
          const [on, off] = step[l.style] || step.dotted;
          for (let x = 0; x < width; x += on + off) ctx.fillRect(x, y, on, lw);
        });
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
          ctx.lineWidth = Math.max(1, Math.floor(hr));
          data.snr.forEach((item) => {
            const x1 = timeScale.logicalToCoordinate(item.startIndex);
            const y = toY(item.value);
            if (x1 === null || y === null) return;
                        ctx.strokeStyle =
              item.kind === 'high'
                ? hexToRgba(config.snrResistanceColor, config.snrResistanceAlpha)
                : hexToRgba(config.snrSupportColor, config.snrSupportAlpha);
            ctx.beginPath();
            const lwS = Math.max(1, Math.floor(hr));
            const ys = Math.round(y - (lwS % 2 ? 0.5 : 0)) + (lwS % 2 ? 0.5 : 0);
            ctx.moveTo(Math.round(x1 * hr), ys);
            ctx.lineTo(Math.round(xEnd * hr), ys);
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
  
    // ===== ICHIMOKU (giống TradingView) =====
  const ICHIMOKU_DEFAULT = {
    enabled: false,
    conversion: 9,
    base: 26,
    spanB: 52,
    lagging: 26,
    lines: {
      conv: { show: true, color: '#2962ff', width: 1 },
      base: { show: true, color: '#b71c1c', width: 1 },
      lag: { show: true, color: '#43a047', width: 1 },
      spanA: { show: true, color: '#a5d6a7', width: 1 },
      spanB: { show: true, color: '#ef9a9a', width: 1 },
      kumoUp: { show: false, color: '#8aa4ff', width: 1 },
      kumoLow: { show: false, color: '#8aa4ff', width: 1 },
    },
    cloud: { show: true, color0: '#43a047', alpha0: 0.15, color1: '#f23645', alpha1: 0.15 },
    tfs: null, // null = hiện ở mọi khung; hoặc ['15m','1h',...]
  };
  const ICHI_LINE_KEYS = ['conv', 'base', 'lag', 'spanA', 'spanB', 'kumoUp', 'kumoLow'];

  function sanitizeIchimoku(src) {
    const d = ICHIMOKU_DEFAULT;
    const s = src || {};
    const int = (v, def, hi) => {
      const n = parseInt(v, 10);
      return n >= 1 ? Math.min(n, hi) : def;
    };
    const alpha = (v, def) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : def;
    };
    const lines = {};
    ICHI_LINE_KEYS.forEach((k) => {
      const dl = d.lines[k];
      const sl = (s.lines && s.lines[k]) || {};
      const w = parseInt(sl.width, 10);
      lines[k] = {
        show: sl.show === undefined ? dl.show : !!sl.show,
        color: isHexColor(sl.color) ? sl.color : dl.color,
        width: w >= 1 && w <= 4 ? w : dl.width,
      };
    });
    const sc = s.cloud || {};
    return {
      enabled: !!s.enabled,
      conversion: int(s.conversion, d.conversion, 500),
      base: int(s.base, d.base, 500),
      spanB: int(s.spanB, d.spanB, 500),
      lagging: int(s.lagging, d.lagging, 500),
      lines,
      cloud: {
        show: sc.show === undefined ? d.cloud.show : !!sc.show,
        color0: isHexColor(sc.color0) ? sc.color0 : d.cloud.color0,
        alpha0: alpha(sc.alpha0, d.cloud.alpha0),
        color1: isHexColor(sc.color1) ? sc.color1 : d.cloud.color1,
        alpha1: alpha(sc.alpha1, d.cloud.alpha1),
      },
      tfs: Array.isArray(s.tfs) && s.tfs.length ? s.tfs.map(String) : null,
    };
  }

  /** Tô đám mây (Kumo) giữa Leading Span A và B, đổi màu khi 2 đường cắt nhau. Gắn vào candleSeries. */
  class IchimokuCloudPrimitive {
    constructor(getState) {
      this._getState = getState;
      this._chart = null;
      this._series = null;
      this._requestUpdate = null;
      this._views = [{ zOrder: () => 'bottom', renderer: () => ({ draw: (t) => this._draw(t) }) }];
    }

    attached(p) {
      this._chart = p.chart;
      this._series = p.series;
      this._requestUpdate = p.requestUpdate;
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

    _draw(target) {
      const chart = this._chart;
      const series = this._series;
      if (!chart || !series) return;
      const { cfg, data } = this._getState();
      if (!data || !cfg.cloud.show) return;
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const from = Math.max(0, Math.floor(range.from) - 1);
      const to = Math.min(data.a.length - 2, Math.ceil(range.to) + 1);

      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        const X = (j) => {
          const x = ts.logicalToCoordinate(j);
          return x === null ? null : x * hr;
        };
        const Y = (p) => {
          const y = series.priceToCoordinate(p);
          return y === null ? null : y * vr;
        };
        const p0 = new Path2D();
        const p1 = new Path2D();
        const poly = (path, pts) => {
          path.moveTo(pts[0][0], pts[0][1]);
          for (let k = 1; k < pts.length; k++) path.lineTo(pts[k][0], pts[k][1]);
          path.closePath();
        };

        for (let j = from; j <= to; j++) {
          const a0 = data.a[j], b0 = data.b[j], a1 = data.a[j + 1], b1 = data.b[j + 1];
          if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
          const x0 = X(j), x1 = X(j + 1);
          if (x0 === null || x1 === null) continue;
          const ya0 = Y(a0), yb0 = Y(b0), ya1 = Y(a1), yb1 = Y(b1);
          if (ya0 === null || yb0 === null || ya1 === null || yb1 === null) continue;
          const d0 = a0 - b0, d1 = a1 - b1;
          if (d0 >= 0 && d1 >= 0) {
            poly(p0, [[x0, ya0], [x1, ya1], [x1, yb1], [x0, yb0]]);
          } else if (d0 <= 0 && d1 <= 0) {
            poly(p1, [[x0, ya0], [x1, ya1], [x1, yb1], [x0, yb0]]);
          } else {
            // 2 đường cắt nhau giữa 2 nến: tách thành 2 tam giác
            const t = d0 / (d0 - d1);
            const xi = x0 + (x1 - x0) * t;
            const yi = ya0 + (ya1 - ya0) * t;
            poly(d0 > 0 ? p0 : p1, [[x0, ya0], [xi, yi], [x0, yb0]]);
            poly(d1 > 0 ? p0 : p1, [[xi, yi], [x1, ya1], [x1, yb1]]);
          }
        }
        ctx.fillStyle = hexToRgba(cfg.cloud.color0, cfg.cloud.alpha0);
        ctx.fill(p0);
        ctx.fillStyle = hexToRgba(cfg.cloud.color1, cfg.cloud.alpha1);
        ctx.fill(p1);
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
    let macdLineSeries = null;
    let macdSignalSeries = null;
    let macdHistSeries = null;

    // RSI mở rộng: cài đặt, dữ liệu tính cho nến cuối, primitive vẽ thêm
    let rsiExtras = sanitizeRsiExtras(null);
    let rsiExtrasData = null;
    let rsiPrim = null;
    let rsiPrimHost = null;

    let currentCandles = [];
    
    let ichimoku = sanitizeIchimoku(null);
    const ichiSeries = {};      // chỉ tạo series cho đường đang hiển thị
    let ichiCloudData = null;
    let ichiPrim = null;
    let restoring = false;      // đang khôi phục prefs: không render/lưu lặp
    let pendingViewReset = false;
    const VIEW_RIGHT_PAD = 8;   // số nến trống bên phải khi nhảy tới nến mới nhất
    const OVERLAY_OPTS = {
      lineWidth: 1,
      title: '',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    };

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

        let lastRecomputeAt = 0;
    function scheduleRecompute(needIndicators) {
      if (needIndicators) needIndicatorRecompute = true;
      if (recomputeRafId !== null) return;
      // Throttle: tối đa 1 lần tính / 250ms (tick realtime đến rất dày)
      const wait = Math.max(0, 250 - (performance.now() - lastRecomputeAt));
      recomputeRafId = setTimeout(() => {
        recomputeRafId = null;
        lastRecomputeAt = performance.now();
        if (needIndicatorRecompute) {
          needIndicatorRecompute = false;
          renderIndicators(currentCandles);
        }
        runBreakout();
      }, wait);
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

  handleScale: {
    pinch: false, // Tắt zoom bằng thao tác chụm/mở 2 ngón tay
  },

  layout: {
    background: { type: 'solid', color: initialColors.background },
    textColor: initialColors.text,
    panes: { separatorColor: initialColors.border },
  },

  grid: {
    vertLines: { color: initialColors.grid },
    horzLines: { color: initialColors.grid },
  },

  crosshair: {
    mode: LightweightCharts.CrosshairMode.Normal
  },

  rightPriceScale: {
    borderColor: initialColors.border
  },

  timeScale: {
    borderColor: initialColors.border,
    timeVisible: true,
    secondsVisible: false
  },
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


      updatePaneStretchFactors();
      setupPinchZoom(container);

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
  getCandles: () => currentCandles,

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
      if (pendingViewReset) resetView();
    }
    
    let pinchCleanup = null;

function setupPinchZoom(container) {
  if (pinchCleanup) pinchCleanup();

  let startDist = 0;
  let startSpacing = 0;
  let anchorLogical = null;
  let anchorX = 0;

  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  function onStart(e) {
    if (e.touches.length !== 2 || !chart) {
      startDist = 0;
      return;
    }
    const ts = chart.timeScale();
    const rect = container.getBoundingClientRect();
    startDist = dist(e.touches);
    startSpacing = ts.options().barSpacing;
    // Điểm giữa 2 ngón = điểm neo, zoom quanh điểm này
    anchorX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
    anchorLogical = ts.coordinateToLogical(anchorX);
  }

  function onMove(e) {
    if (e.touches.length !== 2 || !startDist || !chart || anchorLogical === null) return;
    e.preventDefault();

    const ts = chart.timeScale();
    const ratio = dist(e.touches) / startDist;
    const spacing = Math.min(
      MAX_BAR_SPACING,
      Math.max(MIN_BAR_SPACING, startSpacing * Math.pow(ratio, PINCH_ZOOM_GAIN))
    );
    ts.applyOptions({ barSpacing: spacing });

    // Giữ nến dưới điểm neo đứng yên: tính lại rightOffset
    const lastIndex = currentCandles.length - 1;
    const W = ts.width();
    const rightOffset = (W - anchorX) / spacing - 0.5 - (lastIndex - anchorLogical);
    ts.scrollToPosition(rightOffset, false);
  }

  function onEnd(e) {
    if (e.touches.length < 2) startDist = 0;
  }

  container.addEventListener('touchstart', onStart, { passive: true });
  container.addEventListener('touchmove', onMove, { passive: false });
  container.addEventListener('touchend', onEnd, { passive: true });
  container.addEventListener('touchcancel', onEnd, { passive: true });

  pinchCleanup = () => {
    container.removeEventListener('touchstart', onStart);
    container.removeEventListener('touchmove', onMove);
    container.removeEventListener('touchend', onEnd);
    container.removeEventListener('touchcancel', onEnd);
    pinchCleanup = null;
  };
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
    
        // ===== NHẢY TỚI VÙNG CÓ NẾN KHI ĐỔI SYMBOL / KHUNG =====
    function resetView() {
      if (!chart || currentCandles.length === 0) return;
      const ts = chart.timeScale();
      const w = ts.width();
      if (!w) {            // ô chưa có kích thước (đang ẩn) -> làm lại khi resize
        pendingViewReset = true;
        return;
      }
      pendingViewReset = false;
      try {
        // Người dùng từng kéo trục giá thì autoScale bị tắt -> bật lại, tránh "lạc" khỏi vùng giá mới
        chart.priceScale('right').applyOptions({ autoScale: true });
        const n = currentCandles.length;
        const bars = Math.max(20, w / Math.max(MIN_BAR_SPACING, ts.options().barSpacing));
        const to = n - 1 + VIEW_RIGHT_PAD;
        ts.setVisibleLogicalRange({ from: to - bars, to });
      } catch (err) {
        // bỏ qua
      }
    }

    // ===== ICHIMOKU =====
    function ichimokuActive() {
      if (!ichimoku.enabled) return false;
      if (!ichimoku.tfs) return true;
      const p = Store.getPane(paneId);
      return !!p && ichimoku.tfs.includes(p.timeframe);
    }

    /** Tạo / xoá series theo đúng những đường đang bật (đường tắt thì không tồn tại -> không tốn tài nguyên). */
    function syncIchimokuSeries(active) {
      if (!chart) return;
      ICHI_LINE_KEYS.forEach((k) => {
        const l = ichimoku.lines[k];
        const cur = ichiSeries[k];
        if (!(active && l.show)) {
          if (cur) {
            try { chart.removeSeries(cur); } catch (err) { /* bỏ qua */ }
            delete ichiSeries[k];
          }
          return;
        }
        const opts = { ...OVERLAY_OPTS, color: l.color, lineWidth: l.width };
        if (cur) cur.applyOptions(opts);
        else ichiSeries[k] = chart.addSeries(LightweightCharts.LineSeries, opts, 0);
      });

      const needPrim = active && ichimoku.cloud.show;
      if (needPrim && !ichiPrim) {
        ichiPrim = new IchimokuCloudPrimitive(() => ({ cfg: ichimoku, data: ichiCloudData }));
        candleSeries.attachPrimitive(ichiPrim);
      } else if (!needPrim && ichiPrim) {
        try { candleSeries.detachPrimitive(ichiPrim); } catch (err) { /* bỏ qua */ }
        ichiPrim = null;
      }
    }

    function renderIchimoku(candles) {
      const active = ichimokuActive();
      syncIchimokuSeries(active);
      if (!active) {
        ichiCloudData = null;
        return;
      }
      const n = candles ? candles.length : 0;
      if (n < 2) return;

      const cfg = ichimoku;
      const disp = cfg.lagging - 1; // TradingView: dịch (lagging - 1) nến
      const L = cfg.lines;
      const needSpans = L.spanA.show || L.spanB.show || L.kumoUp.show || L.kumoLow.show || cfg.cloud.show;

      const donchian = (len) => {
        const out = new Array(n).fill(null);
        for (let i = len - 1; i < n; i++) {
          let hi = -Infinity, lo = Infinity;
          for (let j = i - len + 1; j <= i; j++) {
            if (candles[j].high > hi) hi = candles[j].high;
            if (candles[j].low < lo) lo = candles[j].low;
          }
          out[i] = (hi + lo) / 2;
        }
        return out;
      };

      // Độ rộng 1 nến (khớp cách drawing.js tính) để kéo dài thời gian sang tương lai
      let step = 60;
      if (n >= 2) {
        let m = Infinity;
        for (let i = Math.max(1, n - 10); i < n; i++) {
          const dt = candles[i].time - candles[i - 1].time;
          if (dt > 0 && dt < m) m = dt;
        }
        if (Number.isFinite(m)) step = m;
      }
      const timeAt = (j) => (j < n ? candles[j].time : candles[n - 1].time + (j - (n - 1)) * step);

      const conv = donchian(cfg.conversion);
      const base = donchian(cfg.base);

      if (ichiSeries.conv) {
        const d = [];
        conv.forEach((v, i) => { if (v !== null) d.push({ time: candles[i].time, value: v }); });
        ichiSeries.conv.setData(d);
      }
      if (ichiSeries.base) {
        const d = [];
        base.forEach((v, i) => { if (v !== null) d.push({ time: candles[i].time, value: v }); });
        ichiSeries.base.setData(d);
      }
      if (ichiSeries.lag) {
        const d = [];
        for (let i = 0; i + disp < n; i++) d.push({ time: candles[i].time, value: candles[i + disp].close });
        ichiSeries.lag.setData(d);
      }

      if (!needSpans) {
        ichiCloudData = null;
        return;
      }
      const b52 = donchian(cfg.spanB);
      const m = n + disp;
      const a = new Array(m).fill(null);
      const b = new Array(m).fill(null);
      for (let i = 0; i < n; i++) {
        if (conv[i] !== null && base[i] !== null) a[i + disp] = (conv[i] + base[i]) / 2;
        if (b52[i] !== null) b[i + disp] = b52[i];
      }

      const spanData = (arr) => {
        const d = [];
        for (let j = 0; j < m; j++) if (arr[j] !== null) d.push({ time: timeAt(j), value: arr[j] });
        return d;
      };
      if (ichiSeries.spanA) ichiSeries.spanA.setData(spanData(a));
      if (ichiSeries.spanB) ichiSeries.spanB.setData(spanData(b));
      if (ichiSeries.kumoUp || ichiSeries.kumoLow) {
        const up = [], low = [];
        for (let j = 0; j < m; j++) {
          if (a[j] === null || b[j] === null) continue;
          up.push({ time: timeAt(j), value: Math.max(a[j], b[j]) });
          low.push({ time: timeAt(j), value: Math.min(a[j], b[j]) });
        }
        if (ichiSeries.kumoUp) ichiSeries.kumoUp.setData(up);
        if (ichiSeries.kumoLow) ichiSeries.kumoLow.setData(low);
      }

      ichiCloudData = { a, b };
      if (ichiPrim) ichiPrim.requestRedraw();
    }

    function getIchimoku() {
      return JSON.parse(JSON.stringify(ichimoku));
    }

    /** Đổi cài đặt Ichimoku (gộp từng phần: lines/cloud được merge sâu). */
    function setIchimoku(partial) {
      const cur = getIchimoku();
      const p = partial || {};
      const merged = { ...cur, ...p, lines: { ...cur.lines }, cloud: { ...cur.cloud, ...(p.cloud || {}) } };
      if (p.lines) {
        Object.keys(p.lines).forEach((k) => {
          merged.lines[k] = { ...cur.lines[k], ...p.lines[k] };
        });
      }
      ichimoku = sanitizeIchimoku(merged);
      renderIchimoku(currentCandles);
      persistIndicatorPrefs();
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

        /** Chỉ tạo series cho đường EMA đang BẬT; đường tắt thì gỡ khỏi chart. */
    function syncEmaSeries() {
      if (!chart) return;
      const wanted = new Set(emaLines.filter((l) => l.enabled).map((l) => l.id));
      emaSeriesMap.forEach((s, id) => {
        if (!wanted.has(id)) {
          try { chart.removeSeries(s); } catch (err) { /* bỏ qua */ }
          emaSeriesMap.delete(id);
        }
      });
      emaLines.forEach((l) => {
        if (!l.enabled) return;
        const opts = { ...OVERLAY_OPTS, color: l.color, lineWidth: l.width };
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


        // Khung giờ hiện tại có được phép hiện RSI NĐQ không (tab Visibility)
    function rsiTfOk() {
      if (!rsiExtras.tfs) return true;
      const p = Store.getPane(paneId);
      return !!p && rsiExtras.tfs.includes(p.timeframe);
    }

    function tfAllowed(key) {
      return ['rsi', 'emaRsi', 'wmaRsi'].includes(key) ? rsiTfOk() : true;
    }

    /** Đồng bộ series RSI NĐQ với khung hiện tại: khung bị ẩn thì gỡ series (không tính, không tốn tài nguyên). */
    function reconcileRsiTf() {
      const prev = restoring;
      restoring = true;
      try {
        const should = rsiTfOk();
        ['rsi', 'emaRsi', 'wmaRsi'].forEach((k) => {
          if (!indicatorConfig[k].enabled) return;
          if (should !== !!seriesForKey(k)) setIndicatorVisible(k, true);
        });
      } finally {
        restoring = prev;
      }
    }

    // ===== RSI BY NĐQ: dữ liệu + vẽ thêm =====

        /** Trục RSI: tối thiểu 30-70, luôn gồm cả các mức ngang, tự nới ra nếu dữ liệu vượt biên. */
    function rsiAutoscaleProvider(original) {
      const info = original();
      if (!info || !info.priceRange) return info;
      let min = Math.min(rsiExtras.bandLow.value, info.priceRange.minValue);
      let max = Math.max(rsiExtras.bandHigh.value, info.priceRange.maxValue);
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
      reconcileRsiTf();
      renderIndicators(currentCandles);
      if (rsiPrim) rsiPrim.requestRedraw();
      persistIndicatorPrefs();
    }

    function renderIndicators(candles) {
      if (!candles || candles.length === 0) return;
      renderIchimoku(candles);
      const closes = candles.map((c) => c.close);

      // Chỉ tính các đường EMA đang bật
      emaLines.forEach((l) => {
        const s = emaSeriesMap.get(l.id);
        if (!s || !l.enabled) return;
        const vals = candles.map((c) => (c[l.source] !== undefined ? c[l.source] : c.close));
        s.setData(IndicatorModule.toSeriesData(candles, IndicatorModule.calcEMA(vals, l.period)));
      });

            if (indicatorConfig.sma50.enabled && sma50Series) {
        const sma50 = IndicatorModule.calcSMA(closes, indicatorConfig.sma50.period);
        sma50Series.setData(IndicatorModule.toSeriesData(candles, sma50));
      }

      if (indicatorConfig.bbMiddle.enabled || indicatorConfig.bbUpper.enabled || indicatorConfig.bbLower.enabled) {
        const bb = IndicatorModule.calcBB(closes, indicatorConfig.bbMiddle.period, 2);
        if (bbMiddleSeries) bbMiddleSeries.setData(IndicatorModule.toSeriesData(candles, bb.middle));
        if (bbUpperSeries) bbUpperSeries.setData(IndicatorModule.toSeriesData(candles, bb.upper));
        if (bbLowerSeries) bbLowerSeries.setData(IndicatorModule.toSeriesData(candles, bb.lower));
      }

      if (rsiSeries || emaRsiSeries || wmaRsiSeries) {
        const rsi = IndicatorModule.calcRSI(candles, indicatorConfig.rsi.period, rsiExtras.source);
        const emaOfRsi = IndicatorModule.calcEMA(rsi, indicatorConfig.emaRsi.period);
        const wmaOfRsi = IndicatorModule.calcWMA(rsi, indicatorConfig.wmaRsi.period);
        if (rsiSeries) rsiSeries.setData(IndicatorModule.toSeriesData(candles, rsi));
        if (emaRsiSeries) emaRsiSeries.setData(IndicatorModule.toSeriesData(candles, emaOfRsi));
        if (wmaRsiSeries) wmaRsiSeries.setData(IndicatorModule.toSeriesData(candles, wmaOfRsi));
        updateRsiExtras(candles, rsi, wmaOfRsi);
      }


        if (macdLineSeries || macdSignalSeries || macdHistSeries) {
        const macd = IndicatorModule.calcMACD(
          closes,
          indicatorConfig.macdLine.period,
          indicatorConfig.macdHist.period,
          indicatorConfig.macdSignal.period
        );

        if (macdLineSeries) {
          macdLineSeries.setData(
            IndicatorModule.toSeriesData(candles, macd.macd)
          );
        }

        if (macdSignalSeries) {
          macdSignalSeries.setData(
            IndicatorModule.toSeriesData(candles, macd.signal)
          );
        }

        if (macdHistSeries) {
          const histData = candles
            .map((c, i) => {
              const val = macd.hist[i];
              if (val === null || val === undefined) return null;

              return {
                time: c.time,
                value: val,
                color: val >= 0
                  ? 'rgba(38, 166, 154, 0.6)'
                  : 'rgba(239, 83, 80, 0.6)',
              };
            })
            .filter((d) => d !== null);

          macdHistSeries.setData(histData);
        }
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
      prefs.ichimoku = JSON.parse(JSON.stringify(ichimoku));
      prefs.volumeVisible = volumeVisible;
      IndicatorPrefsModule.setPanePrefs(paneId, prefs);
    }

    /** Khôi phục chỉ báo đã lưu của pane này - gọi sau khi nến đầu tiên đã
     * tải xong (xem loadInitialData). Đặt period TRƯỚC khi bật để lần render
     * đầu đã đúng luôn. */
        function restoreIndicatorPrefs() {
      if (typeof IndicatorPrefsModule === 'undefined') return;
      const saved = IndicatorPrefsModule.getPanePrefs(paneId);
      if (!saved) return;

      restoring = true;
      try {
        if (Array.isArray(saved.emaLines)) {
          const next = saved.emaLines.slice(0, MAX_EMA_LINES).map(sanitizeEmaLine);
          if (JSON.stringify(next) !== JSON.stringify(emaLines)) {
            emaLines = next;
            syncEmaSeries();
          }
        } else if (saved.ema21 || saved.ema200) {
          emaLines = emaLines.map((l, i) => {
            const s = i === 0 ? saved.ema21 : saved.ema200;
            return s ? { ...l, period: s.period || l.period, enabled: !!s.enabled } : l;
          });
          syncEmaSeries();
        }

        if (saved.rsiExtras) rsiExtras = sanitizeRsiExtras(saved.rsiExtras);
        if (saved.ichimoku) ichimoku = sanitizeIchimoku(saved.ichimoku);

        if (typeof saved.volumeVisible === 'boolean') {
          volumeVisible = saved.volumeVisible;
          if (volumeSeries) volumeSeries.applyOptions({ visible: volumeVisible });
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
          if (saved[k].enabled && !indicatorConfig[k].enabled) setIndicatorVisible(k, true);
        });
      } finally {
        restoring = false;
      }
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

        const pane1Active = !!(rsiSeries || emaRsiSeries || wmaRsiSeries);
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

      if (visible && tfAllowed(key)) {
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
                    } else if (['sma50', 'bbUpper', 'bbMiddle', 'bbLower'].includes(key)) {
            const s = chart.addSeries(LightweightCharts.LineSeries, { ...OVERLAY_OPTS, color: cfg.color }, 0);
            if (key === 'sma50') sma50Series = s;
            else if (key === 'bbUpper') bbUpperSeries = s;
            else if (key === 'bbMiddle') bbMiddleSeries = s;
            else bbLowerSeries = s;
          }
        } else {
          series.applyOptions({ visible: true });
        }
      } else {
        const series = seriesForKey(key);
        if (series) {
                    if (
            ['rsi', 'emaRsi', 'wmaRsi', 'macdLine', 'macdSignal', 'macdHist',
              'sma50', 'bbUpper', 'bbMiddle', 'bbLower'].includes(key)
          ) {
            chart.removeSeries(series);
            if (key === 'rsi') rsiSeries = null;
            else if (key === 'emaRsi') emaRsiSeries = null;
            else if (key === 'wmaRsi') wmaRsiSeries = null;
            else if (key === 'macdLine') macdLineSeries = null;
            else if (key === 'macdSignal') macdSignalSeries = null;
            else if (key === 'macdHist') macdHistSeries = null;
            else if (key === 'sma50') sma50Series = null;
            else if (key === 'bbUpper') bbUpperSeries = null;
            else if (key === 'bbMiddle') bbMiddleSeries = null;
            else if (key === 'bbLower') bbLowerSeries = null;
          } else {
            series.applyOptions({ visible: false });
          }
        }
      }

      applyLineStyle(key);
      ensureRsiPrimitive();
      updatePaneStretchFactors();
      if (!restoring) {
        scheduleRecompute(true);
        persistIndicatorPrefs();
      }
    }

    const STYLABLE_KEYS = ['rsi', 'emaRsi', 'wmaRsi'];

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
        ichimoku: getIchimoku(),
      };
    }

    function setVolumeVisible(visible) {
      volumeVisible = visible;
      if (volumeSeries) volumeSeries.applyOptions({ visible });
      persistIndicatorPrefs();
    }

    function getVolumeVisible() {
      return volumeVisible;
    }

    function setHigherTFCandles(candles) {
      higherTFCandles = candles ? candles.slice() : [];
      scheduleRecompute(false);          // <- đổi
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
      scheduleRecompute(false);          // <- đổi
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
      scheduleRecompute(false);          // <- đổi
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
      restoreIndicatorPrefs(); // trước khi render để chỉ tính chỉ báo ĐÚNG 1 LẦN
      reconcileRsiTf(); // đổi khung giờ: tự gỡ / dựng lại RSI NĐQ theo tab Visibility

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
      resetView(); // luôn nhảy tới vùng có nến mới nhất
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
      if (macdLineSeries) macdLineSeries.setData([]);
      if (macdSignalSeries) macdSignalSeries.setData([]);
      if (macdHistSeries) macdHistSeries.setData([]);
      Object.values(ichiSeries).forEach((s) => s.setData([]));
      ichiCloudData = null;
      if (ichiPrim) ichiPrim.requestRedraw();
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
        clearTimeout(recomputeRafId);
        recomputeRafId = null;
      }
      if (pinchCleanup) pinchCleanup();
      Object.keys(ichiSeries).forEach((k) => delete ichiSeries[k]);
      ichiPrim = null;
      rsiPrim = null;
      rsiPrimHost = null;
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
      setIchimoku,
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

    return {create, getHigherTimeframeFor, ENTRY_TO_HIGHER_TF, getIchimokuDefaults: () => sanitizeIchimoku(null), getRsiDefaults: () => sanitizeRsiExtras(null),
  };
})();