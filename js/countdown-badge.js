/**
 * countdown-badge.js
 * Vẽ NHÃN GIÁ 2 DÒNG (giá + đếm ngược nến) thẳng lên trục giá của chart
 * bằng primitive (priceAxisPaneViews) - giống TradingView.
 * Nhãn giá mặc định của thư viện được tắt, nhãn này thay thế.
 * Chữ đếm ngược lấy từ #pane-N-countdown (chỉ giữ số và ':').
 * Cần chart.js trả về getSeries().
 */
const CountdownBadge = (function () {
  const UP = '#089981';
  const DOWN = '#F23645';
  const LINE1_H = 21;       // chiều cao dòng giá (px) - khớp nhãn giá gốc
  const LINE2_H = 18;       // chiều cao dòng đếm ngược (px)
  const PAD_X = 9;          // lề trái chữ (px)
  const RADIUS = 3;
  const state = {};         // paneId -> { prim, series, key }

  class PriceCountdownPrimitive {
    constructor(getSeries) {
      this._getSeries = getSeries;
      this._series = null;
      this._requestUpdate = null;
      this.data = null; // { priceText, price, up, text }
      this._chart = null;
      this._crossY = null; // toạ độ Y (px) của con trỏ trong pane chính
      this._rect = null;   // vùng ô giá lần vẽ gần nhất (px, hệ toạ độ media)
      this._views = [{
        zOrder: () => 'top',
        renderer: () => ({ draw: (t) => this._draw(t) }),
      }];
    }

    attached(p) {
      this._series = p.series;
      this._chart = p.chart;
      this._requestUpdate = p.requestUpdate;
    }
 
    detached() {
      this._series = null;
      this._chart = null;
      this._requestUpdate = null;
      this._crossY = null;
      this._rect = null;
    }

    updateAllViews() {}

    priceAxisPaneViews() {
      return this._views;
    }

    setData(d) {
      this.data = d;
      if (this._requestUpdate) this._requestUpdate();
    }

    /** Nhận Y của con trỏ; chỉ yêu cầu vẽ lại khi con trỏ ở gần ô giá. */
    setCrosshairY(y) {
      const v = typeof y === 'number' && Number.isFinite(y) ? y : null;
      const old = this._crossY;
      this._crossY = v;
      const r = this._rect;
      if (!r || !this._requestUpdate) return;
      const near = (q) => q !== null && q >= r.top - 24 && q <= r.bottom + 24;
      if (near(old) || near(v)) this._requestUpdate();
    }

    _draw(target) {
      const series = this._series;
      const d = this.data;
      if (!series || !d) return;
      const yc = series.priceToCoordinate(d.price);
      if (yc === null || yc === undefined) {
        this._rect = null;
        return;
      }
 
      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        const W = scope.bitmapSize.width;
        const H = scope.bitmapSize.height;
 
        const totalH = (LINE1_H + LINE2_H) * vr;
        let top = Math.round(yc * vr - (LINE1_H * vr) / 2);
        // Giữ nhãn trong vùng trục giá (kẹp mép trên/dưới như TradingView)
        top = Math.max(0, Math.min(top, H - totalH));
        this._rect = { top: top / vr, bottom: (top + totalH) / vr };
        const r = RADIUS * vr;
 
        ctx.save();
        ctx.fillStyle = d.up ? UP : DOWN;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(0, top, W, totalH, r);
        else ctx.rect(0, top, W, totalH);
        ctx.fill();
 
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const fam = 'Inter, -apple-system, "Segoe UI", sans-serif';
        const x = PAD_X * hr;
 
        ctx.font = `600 ${Math.round(11 * vr)}px ${fam}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(d.priceText, x, top + (LINE1_H * vr) / 2);
 
        ctx.font = `600 ${Math.round(11 * vr)}px ${fam}`;
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.fillText(d.text, x, top + LINE1_H * vr + (LINE2_H * vr) / 2);
 
        // Nhãn cross vẽ SAU CÙNG = nằm trên ô giá
        this._drawCrossLabel(ctx, { vr, W, H, top, totalH, x, fam });
        ctx.restore();
      });
    }
 
    _drawCrossLabel(ctx, g) {
      const y = this._crossY;
      const series = this._series;
      if (y === null || y === undefined || !series) return;
 
      const h = LINE1_H * g.vr;
      let top = Math.round(y * g.vr - h / 2);
      top = Math.max(0, Math.min(top, g.H - h));
      // Không chạm ô giá -> nhãn gốc của thư viện đã hiện đúng, khỏi vẽ lại
      if (top >= g.top + g.totalH || top + h <= g.top) return;
 
      const price = series.coordinateToPrice(y);
      if (price === null || price === undefined) return;
      let text;
      try {
        text = series.priceFormatter().format(price);
      } catch (e) {
        text = String(price);
      }
      let bg = '#131722';
      try {
        bg = this._chart.options().crosshair.horzLine.labelBackgroundColor || bg;
      } catch (e) { /* dùng màu mặc định */ }
 
      ctx.fillStyle = bg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, top, g.W, h, RADIUS * g.vr);
      else ctx.rect(0, top, g.W, h);
      ctx.fill();
 
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${Math.round(11 * g.vr)}px ${g.fam}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, g.x, top + h / 2);
    }
  }

  function getInst(paneId) {
    return window.PaneRegistry && window.PaneRegistry.get(paneId);
  }

  function removeOldOverlay() {
    document.querySelectorAll('.cd-badge').forEach((el) => el.remove());
  }

  function injectStyles() {
    if (document.getElementById('countdownBadgeStyles')) return;
    const s = document.createElement('style');
    s.id = 'countdownBadgeStyles';
    s.textContent = `.chart-pane.cd-on .pane-symbol-row .candle-countdown { display: none !important; }`;
    document.head.appendChild(s);
  }

  /** Gắn primitive vào series nến của pane (1 lần) và tắt nhãn giá gốc. */
  function ensure(paneId) {
    const inst = getInst(paneId);
    if (!inst || typeof inst.getSeries !== 'function') return null;
    const series = inst.getSeries();
    if (!series) return null;

    let st = state[paneId];
    if (st && st.series !== series) {
      // series bị tạo lại: gỡ đăng ký cũ rồi làm lại
      try { st.chart.unsubscribeCrosshairMove(st.handler); } catch (e) { /* bỏ qua */ }
      st = null;
    }
    if (!st) {
      const prim = new PriceCountdownPrimitive();
      series.attachPrimitive(prim);
      series.applyOptions({ lastValueVisible: false });
 
      // Theo dõi con trỏ để nhãn cross đè lên ô giá (chỉ pane chính, paneIndex 0)
      const chart = typeof inst.getChart === 'function' ? inst.getChart() : null;
      let handler = null;
      if (chart) {
        handler = (param) => {
          const p = param && param.point;
          const inMain = !!p && (param.paneIndex === undefined || param.paneIndex === 0);
          prim.setCrosshairY(inMain ? p.y : null);
        };
        chart.subscribeCrosshairMove(handler);
      }
      st = { prim, series, key: '', chart, handler };
      state[paneId] = st;
    }
    return st;
  }

  function formatPrice(series, price) {
    try {
      const f = series.priceFormatter();
      if (f && typeof f.format === 'function') return f.format(price);
    } catch (e) { /* bỏ qua */ }
    return String(price);
  }

  function updatePane(paneId) {
    const pane = document.getElementById(paneId);
    const src = document.getElementById(paneId + '-countdown');
    const inst = getInst(paneId);
    if (!pane || !src || !inst || pane.offsetParent === null) {
      if (pane) pane.classList.remove('cd-on');
      return;
    }
    const st = ensure(paneId);
    if (!st) return;

    const text = (src.textContent || '').replace(/[^0-9:]/g, '');
    const candles = inst.getCandles();
    const last = candles[candles.length - 1];
    if (!text || text.indexOf(':') === -1 || !last) {
      pane.classList.remove('cd-on');
      return;
    }

    const price = last.close;
    const up = last.close >= last.open;
    const key = [price, up, text].join('|');
    pane.classList.add('cd-on');
    if (key === st.key) return;
    st.key = key;
    st.prim.setData({ price, up, text, priceText: formatPrice(st.series, price) });
  }

  function loop() {
    try {
      Store.getState().panes.forEach((p) => updatePane(p.id));
    } catch (e) { /* vòng lặp vẫn chạy tiếp */ }
    requestAnimationFrame(loop);
  }

  function init() {
    injectStyles();
    removeOldOverlay();
    requestAnimationFrame(loop);
  }

  init();
  return {};
})();