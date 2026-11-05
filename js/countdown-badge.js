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
      this._views = [{
        zOrder: () => 'top',
        renderer: () => ({ draw: (t) => this._draw(t) }),
      }];
    }

    attached(p) {
      this._series = p.series;
      this._requestUpdate = p.requestUpdate;
    }

    detached() {
      this._series = null;
      this._requestUpdate = null;
    }

    updateAllViews() {}

    priceAxisPaneViews() {
      return this._views;
    }

    setData(d) {
      this.data = d;
      if (this._requestUpdate) this._requestUpdate();
    }

    _draw(target) {
      const series = this._series;
      const d = this.data;
      if (!series || !d) return;
      const yc = series.priceToCoordinate(d.price);
      if (yc === null || yc === undefined) return;

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
        ctx.restore();
      });
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
    if (st && st.series !== series) st = null; // series bị tạo lại
    if (!st) {
      const prim = new PriceCountdownPrimitive();
      series.attachPrimitive(prim);
      series.applyOptions({ lastValueVisible: false });
      st = { prim, series, key: '' };
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