/**
 * structure.js
 * Chỉ báo "Cấu Trúc" (Market Structure Confluence) - CHỈ ĐỂ HIỂN THỊ, không có BUY/SELL:
 *
 *  1. Đỉnh / đáy (pivot) -> nhãn HH / HL / LH / LL
 *  2. Phá vỡ đỉnh / đáy gần nhất -> BOS (cùng xu hướng) / CHoCH (đảo xu hướng)
 *     - kiểu phá: đóng nến (close) hoặc râu nến (wick)
 *  3. Dải biến động: WMA(close) ± hệ số x SMA(ATR)
 *     - chỉ hiện dải HỖ TRỢ khi xu hướng tăng, dải KHÁNG CỰ khi xu hướng giảm
 *  4. Tô nền cột nến khi CHoCH
 *
 * Mô phỏng ĐÚNG logic Pine v6 gốc, chạy trên toàn bộ lịch sử đã tải.
 *
 * API: create(paneId) -> { init, run, configure, getConfig, isEnabled, destroy }
 *      StructureModule.getDefaults()
 */
const StructureModule = (function () {
  const DEFAULTS = {
    enabled: false,
    pivLen: 5,
    brkMode: 'close', // 'close' = đóng nến | 'wick' = râu nến
    showPiv: true,
    showBrk: true,
    showChochBg: true,
    showBands: true,
    wmaLen: 100,
    atrLen: 14,
    smoothLen: 21,
    bandMult: 2,
    showMid: false,
    style: {
      upColor: '#1de9b6',
      downColor: '#e53935',
      midColor: '#787b86',
      bandWidth: 3,
      lineWidth: 1,
      lineStyle: 'solid', // 'solid' | 'dashed' | 'dotted'
      labelSize: 10,
      bgAlpha: 0.15,
    },
    tfs: null, // null = hiện ở mọi khung; hoặc ['15m','1h',...]
  };

  const FONT = 'Inter, -apple-system, "Segoe UI", sans-serif';

  // ===================== TIỆN ÍCH =====================
  const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

  function int(v, def, lo, hi) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  }

  function flt(v, def, lo, hi) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  }

  const bool = (v, def) => (v === undefined || v === null ? def : !!v);

  function hexToRgba(hex, a) {
    const h = isHex(hex) ? hex : '#888888';
    return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
  }

  function sanitize(src) {
    const d = DEFAULTS;
    const s = src || {};
    const ss = s.style || {};
    const ds = d.style;
    const col = (k) => (isHex(ss[k]) ? ss[k] : ds[k]);
    return {
      enabled: bool(s.enabled, d.enabled),
      pivLen: int(s.pivLen, d.pivLen, 1, 50),
      brkMode: s.brkMode === 'wick' ? 'wick' : 'close',
      showPiv: bool(s.showPiv, d.showPiv),
      showBrk: bool(s.showBrk, d.showBrk),
      showChochBg: bool(s.showChochBg, d.showChochBg),
      showBands: bool(s.showBands, d.showBands),
      wmaLen: int(s.wmaLen, d.wmaLen, 1, 1000),
      atrLen: int(s.atrLen, d.atrLen, 1, 500),
      smoothLen: int(s.smoothLen, d.smoothLen, 1, 500),
      bandMult: flt(s.bandMult, d.bandMult, 0.1, 50),
      showMid: bool(s.showMid, d.showMid),
      style: {
        upColor: col('upColor'),
        downColor: col('downColor'),
        midColor: col('midColor'),
        bandWidth: flt(ss.bandWidth, ds.bandWidth, 0.5, 6),
        lineWidth: flt(ss.lineWidth, ds.lineWidth, 0.5, 4),
        lineStyle: ['solid', 'dashed', 'dotted'].includes(ss.lineStyle) ? ss.lineStyle : ds.lineStyle,
        labelSize: int(ss.labelSize, ds.labelSize, 7, 20),
        bgAlpha: flt(ss.bgAlpha, ds.bgAlpha, 0, 0.6),
      },
      tfs: Array.isArray(s.tfs) && s.tfs.length ? s.tfs.map(String) : null,
    };
  }

  // ===================== TÍNH TOÁN =====================
  /**
   * Bước 1 + 2: pivot, BOS / CHoCH, xu hướng từng nến.
   * Thứ tự xử lý mỗi nến giống Pine: pivot mới (xác nhận sau `pivLen` nến) -> kiểm tra phá vỡ.
   */
  function computeStructure(candles, cfg) {
    const n = candles.length;
    const L = cfg.pivLen;
    const pivots = [];
    const breaks = [];
    const chochs = [];
    const trend = new Int8Array(n);

    let hiLevel = null;
    let loLevel = null;
    let hiBar = -1;
    let loBar = -1;
    let hiActive = false;
    let loActive = false;
    let tr = 0; // 1 = tăng, -1 = giảm, 0 = chưa xác định

    for (let i = 0; i < n; i++) {
      const bar = candles[i];

      // ---- pivot xác nhận tại nến i (đỉnh/đáy nằm ở nến i - L) ----
      if (i >= 2 * L) {
        const c = i - L;
        const h = candles[c].high;
        const l = candles[c].low;
        let isH = true;
        let isL = true;
        for (let k = 1; k <= L; k++) {
          if (!(h > candles[c - k].high) || !(h >= candles[c + k].high)) isH = false;
          if (!(l < candles[c - k].low) || !(l <= candles[c + k].low)) isL = false;
          if (!isH && !isL) break;
        }
        if (isH) {
          const text = hiLevel === null ? 'H' : h > hiLevel ? 'HH' : 'LH';
          pivots.push({ idx: c, price: h, text, high: true, good: text === 'HH' });
          hiLevel = h;
          hiBar = c;
          hiActive = true;
        }
        if (isL) {
          const text = loLevel === null ? 'L' : l > loLevel ? 'HL' : 'LL';
          pivots.push({ idx: c, price: l, text, high: false, good: text === 'HL' });
          loLevel = l;
          loBar = c;
          loActive = true;
        }
      }

      // ---- phá vỡ ----
      const srcUp = cfg.brkMode === 'close' ? bar.close : bar.high;
      const srcDn = cfg.brkMode === 'close' ? bar.close : bar.low;
      let breakUp = hiActive && hiLevel !== null && srcUp > hiLevel;
      let breakDn = loActive && loLevel !== null && srcDn < loLevel;

      // cùng một nến phá cả hai phía: ưu tiên phía theo hướng nến
      if (breakUp && breakDn) {
        if (bar.close >= bar.open) breakDn = false;
        else breakUp = false;
      }

      const chochUp = breakUp && tr === -1;
      const chochDn = breakDn && tr === 1;

      if (breakUp) {
        breaks.push({ x0: hiBar, x1: i, level: hiLevel, text: chochUp ? 'CHoCH' : 'BOS', up: true });
        if (chochUp) chochs.push({ idx: i, up: true });
        hiActive = false;
        tr = 1;
      }
      if (breakDn) {
        breaks.push({ x0: loBar, x1: i, level: loLevel, text: chochDn ? 'CHoCH' : 'BOS', up: false });
        if (chochDn) chochs.push({ idx: i, up: false });
        loActive = false;
        tr = -1;
      }
      trend[i] = tr;
    }
    return { pivots, breaks, chochs, trend };
  }

  /** Bước 3: WMA(close) ± hệ số x SMA(ATR) - khớp ta.wma / ta.atr (RMA) / ta.sma của Pine. */
  function computeBands(candles, cfg) {
    const n = candles.length;
    const mid = new Array(n).fill(null);
    const upper = new Array(n).fill(null);
    const lower = new Array(n).fill(null);

    // WMA cuốn chiếu O(n)
    const len = cfg.wmaLen;
    const denom = (len * (len + 1)) / 2;
    let S = 0;
    let W = 0;
    for (let i = 0; i < n; i++) {
      const x = candles[i].close;
      if (i < len) {
        S += x;
        W += x * (i + 1);
        if (i === len - 1) mid[i] = W / denom;
      } else {
        W = W - S + len * x;
        S = S + x - candles[i - len].close;
        mid[i] = W / denom;
      }
    }

    // ATR (RMA Wilder, nến đầu TR = high - low)
    const aLen = cfg.atrLen;
    const atr = new Array(n).fill(null);
    let prevClose = null;
    let trSum = 0;
    let rma = null;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const tr =
        prevClose === null
          ? c.high - c.low
          : Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
      prevClose = c.close;
      if (i < aLen) {
        trSum += tr;
        if (i === aLen - 1) {
          rma = trSum / aLen;
          atr[i] = rma;
        }
      } else {
        rma = (rma * (aLen - 1) + tr) / aLen;
        atr[i] = rma;
      }
    }

    // SMA làm mượt ATR
    const sLen = cfg.smoothLen;
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      if (atr[i] === null) continue;
      sum += atr[i];
      cnt++;
      if (cnt > sLen) sum -= atr[i - sLen];
      if (cnt >= sLen && mid[i] !== null) {
        const width = cfg.bandMult * (sum / sLen);
        upper[i] = mid[i] + width;
        lower[i] = mid[i] - width;
      }
    }
    return { mid, upper, lower };
  }

  function compute(candles, cfg) {
    return { ...computeStructure(candles, cfg), ...computeBands(candles, cfg) };
  }

  // ===================== PRIMITIVE VẼ LÊN CHART =====================
  class StructurePrimitive {
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

    _range(n) {
      const range = this._chart.timeScale().getVisibleLogicalRange();
      if (!range) return null;
      return { from: Math.max(0, Math.floor(range.from) - 2), to: Math.min(n - 1, Math.ceil(range.to) + 2) };
    }

    /** Nền cột nến khi CHoCH (bgcolor của Pine). */
    _drawBackground(target) {
      const chart = this._chart;
      if (!chart || !this._series) return;
      const { cfg, candles, data } = this._getState();
      if (!data || !candles || !cfg.showChochBg || !data.chochs.length) return;
      const r = this._range(candles.length);
      if (!r) return;
      const ts = chart.timeScale();
      const st = cfg.style;

      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const h = scope.bitmapSize.height;
        const w = Math.max(1, ts.options().barSpacing * hr);
        data.chochs.forEach((c) => {
          if (c.idx < r.from || c.idx > r.to) return;
          const x = ts.logicalToCoordinate(c.idx);
          if (x === null) return;
          ctx.fillStyle = hexToRgba(c.up ? st.upColor : st.downColor, st.bgAlpha);
          ctx.fillRect(x * hr - w / 2, 0, w, h);
        });
      });
    }

    _drawForeground(target) {
      const chart = this._chart;
      const series = this._series;
      if (!chart || !series) return;
      const { cfg, candles, data } = this._getState();
      if (!data || !candles) return;
      const r = this._range(candles.length);
      if (!r) return;
      const ts = chart.timeScale();
      const st = cfg.style;

      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        // Làm nét kiểu TradingView: độ dày = số pixel thật (0.5px -> 1 pixel máy),
        // nét lẻ đặt giữa pixel, nét chẵn đặt trên ranh giới pixel
        const crispPx = (w) => Math.max(1, Math.round(w * hr));
        const snapV = (v, wPx) => (wPx % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v));
        let curW = 1;
        const setW = (w) => { curW = crispPx(w); ctx.lineWidth = curW; };
        const X = (i) => {
          const x = ts.logicalToCoordinate(i);
          return x === null ? null : snapV(x * hr, curW);
        };
        const Y = (p) => {
          const y = series.priceToCoordinate(p);
          return y === null ? null : snapV(y * vr, curW);
        };
        const rx = (v) => Math.round(v);   // chữ: làm tròn về pixel thật

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'butt';

        // ---- 1) Dải hỗ trợ (xu hướng tăng) / kháng cự (xu hướng giảm) ----
        if (cfg.showBands) {
          [
            { dir: 1, arr: data.lower, color: st.upColor },
            { dir: -1, arr: data.upper, color: st.downColor },
          ].forEach((b) => {
            ctx.strokeStyle = b.color;
            setW(st.bandWidth);
            ctx.beginPath();
            let pen = false;
            for (let i = r.from; i <= r.to; i++) {
              const v = data.trend[i] === b.dir ? b.arr[i] : null;
              const x = v === null ? null : X(i);
              const y = v === null ? null : Y(v);
              if (x === null || y === null) {
                pen = false;
                continue;
              }
              if (pen) ctx.lineTo(x, y);
              else {
                ctx.moveTo(x, y);
                pen = true;
              }
            }
            ctx.stroke();
          });
        }

        // ---- 2) Đường giữa WMA ----
        if (cfg.showMid) {
          ctx.strokeStyle = hexToRgba(st.midColor, 0.6);
          setW(1);
          ctx.beginPath();
          let pen = false;
          for (let i = r.from; i <= r.to; i++) {
            const v = data.mid[i];
            const x = v === null ? null : X(i);
            const y = v === null ? null : Y(v);
            if (x === null || y === null) {
              pen = false;
              continue;
            }
            if (pen) ctx.lineTo(x, y);
            else {
              ctx.moveTo(x, y);
              pen = true;
            }
          }
          ctx.stroke();
        }

        const font = `600 ${Math.round(st.labelSize * vr)}px ${FONT}`;

        // ---- 3) Đường phá vỡ + nhãn BOS / CHoCH ----
        if (cfg.showBrk) {
          setW(st.lineWidth);
          const lw = curW;
          const dash = st.lineStyle === 'dashed' ? [5 * hr, 4 * hr] : st.lineStyle === 'dotted' ? [lw, 3 * hr] : [];
          ctx.setLineDash(dash);
          ctx.font = font;
          ctx.textAlign = 'center';
          data.breaks.forEach((b) => {
            if (b.x1 < r.from || b.x0 > r.to) return;
            const x0 = X(b.x0);
            const x1 = X(b.x1);
            const y = Y(b.level);
            if (x0 === null || x1 === null || y === null) return;
            const color = b.up ? st.upColor : st.downColor;
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();

            const xm = X(Math.floor((b.x0 + b.x1) / 2));
            if (xm === null) return;
            ctx.fillStyle = color;
            ctx.textBaseline = b.up ? 'bottom' : 'top';
            ctx.fillText(b.text, rx(xm), rx(y + (b.up ? -3 : 3) * vr));
          });
          ctx.setLineDash([]);
        }

        // ---- 4) Nhãn HH / HL / LH / LL ----
        if (cfg.showPiv) {
          ctx.font = font;
          ctx.textAlign = 'center';
          data.pivots.forEach((p) => {
            if (p.idx < r.from || p.idx > r.to) return;
            const x = X(p.idx);
            const y = Y(p.price);
            if (x === null || y === null) return;
            ctx.fillStyle = p.good ? st.upColor : st.downColor;
            ctx.textBaseline = p.high ? 'bottom' : 'top';
            ctx.fillText(p.text, rx(x), rx(y + (p.high ? -4 : 4) * vr));
          });
        }

        ctx.restore();
      });
    }
  }

  // ===================== INSTANCE THEO PANE =====================
  function create(paneId) {
    let seriesRef = null;
    let prim = null;
    let cfg = sanitize(null);
    let state = { candles: null, data: null };

    function init(chart, candleSeries) {
      seriesRef = candleSeries;
      prim = new StructurePrimitive(() => ({ cfg, ...state }));
      candleSeries.attachPrimitive(prim);
    }

    function clearState() {
      state = { candles: null, data: null };
      if (prim) prim.requestRedraw();
    }

    function tfOk(timeframe) {
      return !cfg.tfs || !timeframe || cfg.tfs.includes(timeframe);
    }

    /** run({ entryCandles, timeframe }) - tính lại toàn bộ trên các nến đã tải. */
    function run(params) {
      if (!seriesRef || !prim) return;
      const candles = (params && params.entryCandles) || [];
      const timeframe = params && params.timeframe;
      if (!cfg.enabled || !tfOk(timeframe) || candles.length < 2 * cfg.pivLen + 2) {
        if (state.data) clearState();
        return;
      }
      state = { candles, data: compute(candles, cfg) };
      prim.requestRedraw();
    }

    function configure(partial) {
      const cur = JSON.parse(JSON.stringify(cfg));
      const p = partial || {};
      cfg = sanitize({ ...cur, ...p, style: { ...cur.style, ...(p.style || {}) } });
    }

    function getConfig() {
      return JSON.parse(JSON.stringify(cfg));
    }

    function isEnabled() {
      return cfg.enabled;
    }

    function destroy() {
      if (seriesRef && prim) {
        try {
          seriesRef.detachPrimitive(prim);
        } catch (err) {
          // series có thể đã bị huỷ
        }
      }
      prim = null;
      seriesRef = null;
    }

    return { init, run, configure, getConfig, isEnabled, destroy };
  }

  return {
    create,
    getDefaults: () => sanitize(null),
    compute, // dùng để kiểm thử
  };
})();

if (typeof module !== 'undefined') module.exports = StructureModule;