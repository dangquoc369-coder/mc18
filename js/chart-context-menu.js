/**
 * js/chart-context-menu.js
 * Menu chuột phải cho chart (giống TradingView) + ảnh chụp + cài đặt giao diện chart.
 *
 * Gồm 2 module toàn cục:
 *
 *  1) ChartAppearance  - cài đặt giao diện DÙNG CHUNG cho mọi pane, lưu cục bộ (LocalStore):
 *       lưới ngang / dọc, màu lưới, màu nến tăng / giảm, độ mờ volume.
 *       get() / set(partial) / reset() ; phát sự kiện EventBus 'chart:appearanceChanged'.
 *       chart.js lắng nghe sự kiện này để áp màu nến + lưới cho từng pane.
 *
 *  2) ChartContextMenu - menu chuột phải (máy tính) / nhấn giữ (iPad, điện thoại).
 *       attach({ paneId, container, chart, resetView, getDrawingTool, getLegendEntries })
 *         -> trả về { destroy }
 *
 * Menu:
 *   Reset chart view (Alt + R)
 *   Thang giá  >  Tự động co giãn | Thường | Logarit | Phần trăm
 *   Hiện lưới (bật / tắt)
 *   Lưu ảnh chart (Ctrl + Alt + S) | Sao chép ảnh chart (Ctrl + Alt + C)
 *   Cài đặt chart...  (lưới, màu nến, độ mờ volume)
 *
 * Phải nạp SAU utils/local-store/storage/theme và TRƯỚC chart.js.
 */

/* ========================================================================
 *  1. CHART APPEARANCE
 * ====================================================================== */
const ChartAppearance = (function () {
  const KEY = 'chart_appearance';
  const DEFAULTS = Object.freeze({
    gridVert: true,
    gridHorz: true,
    gridColor: null, // null = theo giao diện sáng/tối
    upColor: '#089981',
    downColor: '#F23645',
    volumeAlpha: 0.5,
  });

  const PRESETS = [
    { id: 'tv', label: 'TradingView', up: '#089981', down: '#F23645' },
    { id: 'classic', label: 'Cổ điển', up: '#26a69a', down: '#ef5350' },
    { id: 'blue-red', label: 'Xanh dương / Đỏ', up: '#2962ff', down: '#f23645' },
    { id: 'blue-orange', label: 'Xanh dương / Cam (dễ phân biệt)', up: '#2962ff', down: '#ff9800' },
    { id: 'mono', label: 'Trắng / Đen', up: '#d1d4dc', down: '#4a4e5a' },
  ];

  const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

  function sanitize(src) {
    const s = src || {};
    const a = parseFloat(s.volumeAlpha);
    return {
      gridVert: s.gridVert === undefined ? DEFAULTS.gridVert : !!s.gridVert,
      gridHorz: s.gridHorz === undefined ? DEFAULTS.gridHorz : !!s.gridHorz,
      gridColor: isHex(s.gridColor) ? s.gridColor : null,
      upColor: isHex(s.upColor) ? s.upColor : DEFAULTS.upColor,
      downColor: isHex(s.downColor) ? s.downColor : DEFAULTS.downColor,
      volumeAlpha: Number.isFinite(a) ? Math.min(1, Math.max(0.1, a)) : DEFAULTS.volumeAlpha,
    };
  }

  let state = null;
  let emitRaf = null;

  function read() {
    try {
      if (typeof LocalStore !== 'undefined') return LocalStore.read(KEY, null);
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function write(v) {
    try {
      if (typeof LocalStore !== 'undefined') LocalStore.write(KEY, v);
      else localStorage.setItem(KEY, JSON.stringify(v));
    } catch (err) {
      /* bỏ qua */
    }
  }

  function get() {
    if (!state) state = sanitize(read());
    return { ...state };
  }

  // Gộp nhiều thay đổi liên tiếp (kéo ô chọn màu / thanh trượt) thành 1 lần phát / khung hình
  function emit() {
    if (emitRaf !== null) return;
    emitRaf = requestAnimationFrame(() => {
      emitRaf = null;
      if (typeof EventBus !== 'undefined') EventBus.emit('chart:appearanceChanged', { appearance: get() });
    });
  }

  function set(partial) {
    state = sanitize({ ...get(), ...(partial || {}) });
    write(state);
    emit();
    return get();
  }

  function reset() {
    state = sanitize(null);
    write(state);
    emit();
    return get();
  }

  return { get, set, reset, PRESETS, DEFAULTS };
})();

/* ========================================================================
 *  2. CHART CONTEXT MENU
 * ====================================================================== */
const ChartContextMenu = (function () {
  // Đổi chữ hiển thị ở đây nếu muốn
  const LABELS = {
    reset: 'Reset chart view',
    scale: 'Thang giá',
    autoScale: 'Tự động co giãn',
    scaleNormal: 'Thường',
    scaleLog: 'Logarit',
    scalePercent: 'Phần trăm',
    grid: 'Hiện lưới',
    save: 'Lưu ảnh',
    copy: 'Sao chép ảnh',
    saveThis: 'Lưu ảnh ô này',
    copyThis: 'Sao chép ảnh ô này',
    saveAll: 'Lưu ảnh tất cả ô',
    copyAll: 'Sao chép ảnh tất cả ô',
    settings: 'Cài đặt chart...',
  };

  const FONT_UI = 'Inter, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const LONG_PRESS_MS = 860; // nhấn giữ 0,86s mới hiện menu (tránh chạm nhầm khi cuộn)
  const LONG_PRESS_MOVE_PX = 6; // nhấn giữ mà di chuyển quá 6px thì hủy menu

  const svg = (p) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
  const ICONS = {
    reset: svg('<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v5h5"/>'),
    scale: svg('<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>'),
    grid: svg('<path d="M4 4h16v16H4zM4 12h16M12 4v16"/>'),
    camera: svg('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>'),
    check: svg('<path d="M5 12l5 5 9-10"/>'),
    chev: svg('<path d="M9 6l6 6-6 6"/>'),
  };

  const instances = new Map(); // paneId -> handle
  let menuEl = null;
  let menuCleanup = null;
  let dialogEl = null;
  let dialogCleanup = null;
  let toastEl = null;
  let toastTimer = null;
  let globalKeysBound = false;

  /* ---------------------------- tiện ích ---------------------------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const isMac = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
  const kbd = (s) => (isMac() ? s.replace('Ctrl', '⌃').replace('Alt', '⌥').replace('Shift', '⇧') : s);

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function currentTheme() {
    return (typeof ThemeModule !== 'undefined' && ThemeModule.getTheme && ThemeModule.getTheme()) || 'dark';
  }

  function paneInfo(paneId) {
    return (typeof Store !== 'undefined' && Store.getPane && Store.getPane(paneId)) || {};
  }

  function tfLabel(tf) {
    if (typeof TIMEFRAMES !== 'undefined') {
      const f = TIMEFRAMES.find((t) => t.value === tf);
      if (f) return f.label;
    }
    return tf || '';
  }

  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }

  /* ---------------------------- thông báo nhỏ ---------------------------- */
  function toast(msg, kind) {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = el('div', 'cm-toast' + (kind === 'error' ? ' error' : ''));
    toastEl.setAttribute('role', 'status');
    toastEl.innerHTML = kind === 'error' ? '' : '<span class="cm-toast-ic">' + ICONS.check + '</span>';
    toastEl.appendChild(el('span', '', msg));
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.remove();
      toastEl = null;
    }, 2400);
  }

  /* ---------------------------- thang giá ---------------------------- */
  const scaleKey = (paneId) => 'chart_scale_mode:' + paneId;

  function scaleOptions(h) {
    try {
      return h.chart.priceScale('right').options();
    } catch (err) {
      return {};
    }
  }

  function restoreScale(h) {
    try {
      const saved = typeof LocalStore !== 'undefined' ? LocalStore.read(scaleKey(h.paneId), 0) : 0;
      const mode = Number(saved);
      if (mode === 1 || mode === 2) h.chart.priceScale('right').applyOptions({ mode });
    } catch (err) {
      /* bỏ qua */
    }
  }

  function setScaleMode(h, mode) {
    try {
      h.chart.priceScale('right').applyOptions({ mode });
      if (typeof LocalStore !== 'undefined') LocalStore.write(scaleKey(h.paneId), mode);
    } catch (err) {
      /* bỏ qua */
    }
  }

  function setAutoScale(h, on) {
    try {
      h.chart.priceScale('right').applyOptions({ autoScale: !!on });
    } catch (err) {
      /* bỏ qua */
    }
  }

  /* ====================================================================
   *  ẢNH CHỤP: ảnh chart (gồm hình vẽ, chỉ báo, đường cảnh báo, các pane
   *  RSI/MACD) + khung symbol/giá + danh sách chỉ báo đang hiện + chân trang
   * ================================================================== */
  function roundRectPath(ctx, x, y, w, hgt, r) {
    r = Math.max(0, Math.min(r, w / 2, hgt / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + hgt, r);
    ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
    ctx.arcTo(x, y + hgt, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function visibleColor(c) {
    if (!c || c === 'transparent') return false;
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return true;
    const parts = m[1].split(',');
    return !(parts.length === 4 && parseFloat(parts[3]) === 0);
  }

  function paintBox(ctx, node, cr, s) {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const cs = getComputedStyle(node);
    if (visibleColor(cs.backgroundColor)) {
      ctx.fillStyle = cs.backgroundColor;
      roundRectPath(ctx, (r.left - cr.left) * s, (r.top - cr.top) * s, r.width * s, r.height * s, (parseFloat(cs.borderTopLeftRadius) || 0) * s);
      ctx.fill();
    }
    return { r, cs };
  }

  function paintText(ctx, node, cr, s) {
    const box = paintBox(ctx, node, cr, s);
    if (!box || !node.textContent) return;
    const { r, cs } = box;
    ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + parseFloat(cs.fontSize) * s + 'px ' + cs.fontFamily;
    ctx.fillStyle = cs.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.textContent, (r.left - cr.left + r.width / 2) * s, (r.top - cr.top + r.height / 2) * s + 0.5 * s);
  }

  function drawHeader(ctx, h, cr, s) {
    const pane = h.container.closest('.chart-pane');
    const row = pane && pane.querySelector('.pane-symbol-row');
    let left = 6 * s;
    let bottom = 6 * s;

    if (row) {
      const rr = row.getBoundingClientRect();
      left = (rr.left - cr.left) * s;
      bottom = (rr.bottom - cr.top) * s;
      paintBox(ctx, row, cr, s);
      row.querySelectorAll('.pane-symbol, .price, .change, .candle-countdown').forEach((n) => paintText(ctx, n, cr, s));
    }

    // Danh sách chỉ báo đang hiện (lấy từ chart.js nên đúng kể cả khi legend đang thu gọn)
    const entries = typeof h.opts.getLegendEntries === 'function' ? h.opts.getLegendEntries() : [];
    if (!entries.length) return;

    const fs = 10.5 * s;
    const chipH = 18 * s;
    const padX = 7 * s;
    const gap = 4 * s;
    const dotR = 3.5 * s;
    const maxX = cr.width * s - 70 * s;
    const bg = cssVar('--overlay-bg', 'rgba(16,20,28,0.86)');
    const fg = cssVar('--text-primary', '#e6e9f0');

    ctx.font = '500 ' + fs + 'px ' + FONT_UI;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let x = left;
    let y = bottom + 4 * s;
    entries.forEach((en) => {
      const tw = ctx.measureText(en.text).width;
      const w = padX * 2 + dotR * 2 + 5 * s + tw;
      if (x + w > maxX && x > left) {
        x = left;
        y += chipH + gap;
      }
      ctx.fillStyle = bg;
      roundRectPath(ctx, x, y, w, chipH, 4 * s);
      ctx.fill();
      ctx.fillStyle = en.color || '#787b86';
      ctx.beginPath();
      ctx.arc(x + padX + dotR, y + chipH / 2, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.fillText(en.text, x + padX + dotR * 2 + 5 * s, y + chipH / 2 + 0.5 * s);
      x += w + gap;
    });
  }

  function drawFooter(ctx, h, top, footerH, width, s) {
    const p = paneInfo(h.paneId);
    const symEl = document.getElementById(h.paneId + '-symbol');
    const sym = (symEl && symEl.textContent) || p.symbol || '';
    const left = [sym, tfLabel(p.timeframe), new Date().toLocaleString('vi-VN')].filter(Boolean).join('  ·  ');

    ctx.fillStyle = cssVar('--bg-panel', '#10141c');
    ctx.fillRect(0, top, width, footerH);
    ctx.fillStyle = cssVar('--border-color', '#212837');
    ctx.fillRect(0, top, width, Math.max(1, Math.round(s)));

    ctx.textBaseline = 'middle';
    ctx.font = '500 ' + 11 * s + 'px ' + FONT_UI;
    ctx.textAlign = 'left';
    ctx.fillStyle = cssVar('--text-secondary', '#7c8496');
    ctx.fillText(left, 10 * s, top + footerH / 2 + 0.5 * s);

    ctx.textAlign = 'right';
    ctx.font = '700 ' + 11.5 * s + 'px ' + FONT_UI;
    ctx.fillStyle = cssVar('--accent-blue', '#f2a339');
    ctx.fillText('TradingPro - NĐQ', width - 10 * s, top + footerH / 2 + 0.5 * s);
  }

    // Ảnh xuất tối thiểu gấp đôi độ phân giải CSS (màn 1x vẫn ra ảnh 2x, chữ header/footer vẽ vector nên sắc nét)
  const MIN_EXPORT_SCALE = 2;

  function buildScreenshotCanvas(h) {
    // Lightweight Charts >= 5.0.9: takeScreenshot(addTopLayer, includeCrosshair)
    // addTopLayer = true  -> gộp sẵn hình vẽ, tín hiệu, primitive lớp trên
    // includeCrosshair = false -> không có đường ngắm trong ảnh
    try { h.chart.clearCrosshairPosition(); } catch (e) { /* bỏ qua */ }
    const chartCanvas = h.chart.takeScreenshot(true, false);

    const cr = h.container.getBoundingClientRect();
    const native = chartCanvas.width / (cr.width || chartCanvas.width); // = devicePixelRatio của chart
    const boost = native < MIN_EXPORT_SCALE ? MIN_EXPORT_SCALE / native : 1;
    const s = native * boost; // tỉ lệ cuối cùng so với px CSS

    const chartW = Math.round(chartCanvas.width * boost);
    const chartH = Math.round(chartCanvas.height * boost);
    const footerH = Math.round(26 * s);

    const out = document.createElement('canvas');
    out.width = chartW;
    out.height = chartH + footerH;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(chartCanvas, 0, 0, chartW, chartH);

    drawHeader(ctx, h, cr, s);
    drawFooter(ctx, h, chartH, footerH, out.width, s);
    return out;
  }


    function visibleHandles() {
    return Array.from(instances.values()).filter(
      (h) => h.container.offsetParent !== null && h.container.clientWidth > 0 && h.container.clientHeight > 0
    );
  }

  // iOS Safari giới hạn canvas ~16,7 triệu pixel; vượt quá sẽ ra ảnh trắng
  const MAX_CANVAS_PIXELS = 16000000;

  /** Chụp mọi ô đang hiện rồi ghép theo đúng bố cục lưới trên màn hình. */
  function buildAllCanvas() {
    const hs = visibleHandles();
    if (!hs.length) throw new Error('Không có ô nào đang hiện');

    const items = hs.map((h) => ({
      r: h.container.getBoundingClientRect(),
      canvas: buildScreenshotCanvas(h),
    }));

    const TOL = 4;
    const uniq = (vals) => {
      const out = [];
      vals.slice().sort((a, b) => a - b).forEach((v) => {
        if (!out.length || v - out[out.length - 1] > TOL) out.push(v);
      });
      return out;
    };
    const slot = (arr, v) => {
      let k = 0;
      for (let i = 0; i < arr.length; i++) if (v >= arr[i] - TOL) k = i;
      return k;
    };

    const cols = uniq(items.map((i) => i.r.left));
    const rows = uniq(items.map((i) => i.r.top));
    const colW = cols.map(() => 0);
    const rowH = rows.map(() => 0);
    items.forEach((it) => {
      it.c = slot(cols, it.r.left);
      it.rw = slot(rows, it.r.top);
      colW[it.c] = Math.max(colW[it.c], it.canvas.width);
      rowH[it.rw] = Math.max(rowH[it.rw], it.canvas.height);
    });

    const s = items[0].canvas.width / (items[0].r.width || items[0].canvas.width);
    const gap = Math.max(2, Math.round(3 * s));
    const colX = [];
    const rowY = [];
    let W = 0;
    let H = 0;
    colW.forEach((w, i) => { colX[i] = W; W += w + (i < colW.length - 1 ? gap : 0); });
    rowH.forEach((hh, i) => { rowY[i] = H; H += hh + (i < rowH.length - 1 ? gap : 0); });

    // Quá lớn -> thu nhỏ vừa đủ để không vượt giới hạn canvas
    const f = W * H > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / (W * H)) : 1;

    const out = document.createElement('canvas');
    out.width = Math.round(W * f);
    out.height = Math.round(H * f);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = cssVar('--border-color', '#212837'); // màu khe giữa các ô
    ctx.fillRect(0, 0, out.width, out.height);
    items.forEach((it) => {
      ctx.drawImage(
        it.canvas,
        Math.round(colX[it.c] * f),
        Math.round(rowY[it.rw] * f),
        Math.round(it.canvas.width * f),
        Math.round(it.canvas.height * f)
      );
    });
    return out;
  }

  function fileNameAll() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
    return 'TradingPro_tat-ca-o_' + stamp + '.png';
  }

  function fileName(h) {
    const p = paneInfo(h.paneId);
    const sym = String(p.symbol || 'chart').replace(/[^\w.-]+/g, '_');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
    return sym + '_' + (p.timeframe || 'tf') + '_' + stamp + '.png';
  }

  const canvasToBlob = (canvas) =>
    new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/png'));

  async function saveCanvas(canvas, name) {
    const blob = await canvasToBlob(canvas);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && navigator.canShare && navigator.share) {
      const file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name });
          return 'shared';
        } catch (err) {
          if (err && err.name === 'AbortError') return 'cancel';
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  }

    function makeCanvas(h, all) {
    try {
      return all ? buildAllCanvas() : buildScreenshotCanvas(h);
    } catch (err) {
      console.error('[chart-context-menu] Chụp ảnh lỗi:', err);
      toast('Không chụp được ảnh chart', 'error');
      return null;
    }
  }

  async function doSave(h, all) {
    const canvas = makeCanvas(h, all);
    if (!canvas) return;
    try {
      const r = await saveCanvas(canvas, all ? fileNameAll() : fileName(h));
      if (r === 'saved') toast(all ? 'Đã lưu ảnh tất cả ô' : 'Đã lưu ảnh chart');
      else if (r === 'shared') toast('Đã mở bảng chia sẻ / lưu ảnh');
    } catch (err) {
      console.error(err);
      toast('Không lưu được ảnh', 'error');
    }
  }

  function doCopy(h, all) {
    const canvas = makeCanvas(h, all);
    if (!canvas) return;
    const name = all ? fileNameAll() : fileName(h);
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast('Trình duyệt không cho sao chép ảnh (cần HTTPS) - đang lưu thành file', 'error');
      saveCanvas(canvas, name).catch(() => {});
      return;
    }
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': canvasToBlob(canvas) })])
      .then(() => toast(all ? 'Đã sao chép ảnh tất cả ô vào clipboard' : 'Đã sao chép ảnh chart vào clipboard'))
      .catch((err) => {
        console.warn('[chart-context-menu] Clipboard bị chặn:', err);
        toast('Không sao chép được - đang lưu thành file', 'error');
        saveCanvas(canvas, name).catch(() => {});
      });
  }

  /* ====================================================================
   *  MENU
   * ================================================================== */
  function buildItems(h) {
    const multi = visibleHandles().length > 1;
    const so = scaleOptions(h);
    const PSM = (typeof LightweightCharts !== 'undefined' && LightweightCharts.PriceScaleMode) || { Normal: 0, Logarithmic: 1, Percentage: 2 };
    const mode = so.mode === undefined ? PSM.Normal : so.mode;
    const ap = ChartAppearance.get();
    const gridOn = ap.gridVert || ap.gridHorz;

    return [
      { label: LABELS.reset, icon: ICONS.reset, shortcut: kbd('Alt + R'), onClick: () => h.opts.resetView() },
      { type: 'sep' },
      {
        label: LABELS.scale,
        icon: ICONS.scale,
        children: [
          { label: LABELS.autoScale, toggle: so.autoScale !== false, onClick: () => setAutoScale(h, so.autoScale === false) },
          { type: 'sep' },
          { label: LABELS.scaleNormal, checked: mode === PSM.Normal, onClick: () => setScaleMode(h, PSM.Normal) },
          { label: LABELS.scaleLog, checked: mode === PSM.Logarithmic, onClick: () => setScaleMode(h, PSM.Logarithmic) },
          { label: LABELS.scalePercent, checked: mode === PSM.Percentage, onClick: () => setScaleMode(h, PSM.Percentage) },
        ],
      },
      {
        label: LABELS.grid,
        icon: ICONS.grid,
        toggle: gridOn,
        onClick: () => ChartAppearance.set({ gridVert: !gridOn, gridHorz: !gridOn }),
      },
      { type: 'sep' },
            ...(multi
        ? [
            { label: LABELS.saveThis, icon: ICONS.camera, shortcut: kbd('Ctrl + Alt + S'), onClick: () => doSave(h, false) },
            { label: LABELS.copyThis, icon: ICONS.copy, shortcut: kbd('Ctrl + Alt + C'), onClick: () => doCopy(h, false) },
            { label: LABELS.saveAll, icon: ICONS.camera, shortcut: kbd('Ctrl + Alt + Shift + S'), onClick: () => doSave(h, true) },
            { label: LABELS.copyAll, icon: ICONS.copy, shortcut: kbd('Ctrl + Alt + Shift + C'), onClick: () => doCopy(h, true) },
          ]
        : [
            { label: LABELS.save, icon: ICONS.camera, shortcut: kbd('Ctrl + Alt + S'), onClick: () => doSave(h, false) },
            { label: LABELS.copy, icon: ICONS.copy, shortcut: kbd('Ctrl + Alt + C'), onClick: () => doCopy(h, false) },
          ]),
      { type: 'sep' },
      { label: LABELS.settings, icon: ICONS.gear, onClick: () => openSettings(h) },
    ];
  }

  function openSub(row) {
    const parent = row.parentElement;
    parent.querySelectorAll(':scope > .cm-item.open').forEach((r) => {
      if (r !== row) r.classList.remove('open');
    });
    row.classList.add('open');
    const sub = row.querySelector(':scope > .cm-sub');
    if (!sub) return;
    sub.classList.remove('cm-flip');
    sub.style.top = '-7px';
    let r = sub.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) sub.classList.add('cm-flip');
    r = sub.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) sub.style.top = -7 - (r.bottom - window.innerHeight + 8) + 'px';
  }

  function buildList(items, isSub) {
    const list = el('div', 'cm-list' + (isSub ? ' cm-sub' : ''));
    list.setAttribute('role', 'menu');

    items.forEach((it) => {
      if (it.type === 'sep') {
        list.appendChild(el('div', 'cm-sep'));
        return;
      }
      const row = el('div', 'cm-item' + (it.checked ? ' is-checked' : '') + (it.disabled ? ' disabled' : ''));
      row.setAttribute('role', 'menuitem');
      row.tabIndex = -1;

      const ic = el('span', 'cm-ic');
      ic.innerHTML = it.checked ? ICONS.check : it.icon || '';
      row.appendChild(ic);
      row.appendChild(el('span', 'cm-label', it.label));
      if (it.shortcut) row.appendChild(el('span', 'cm-kbd', it.shortcut));
      if (it.toggle !== undefined) row.appendChild(el('span', 'cm-sw' + (it.toggle ? ' on' : '')));

      if (it.children) {
        const chev = el('span', 'cm-chev');
        chev.innerHTML = ICONS.chev;
        row.appendChild(chev);
        row.appendChild(buildList(it.children, true));
        let hoverTimer = null;
        row.addEventListener('mouseenter', () => {
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => openSub(row), 80);
        });
        row.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
        row.addEventListener('click', (e) => {
          if (e.target.closest('.cm-sub')) return;
          e.stopPropagation();
          if (row.classList.contains('open')) row.classList.remove('open');
          else openSub(row);
        });
      } else {
        row.addEventListener('mouseenter', () => {
          list.querySelectorAll(':scope > .cm-item.open').forEach((r) => r.classList.remove('open'));
        });
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (it.disabled) return;
          closeMenu();
          if (typeof it.onClick === 'function') it.onClick();
        });
      }
      list.appendChild(row);
    });
    return list;
  }

  function closeMenu() {
    if (menuCleanup) menuCleanup();
    menuCleanup = null;
    if (menuEl) menuEl.remove();
    menuEl = null;
  }

  function openMenu(h, x, y) {
    closeMenu();
    if (typeof Store !== 'undefined' && Store.getState && Store.getState().activePaneId !== h.paneId) {
      Store.setActivePane(h.paneId); // giống click vào ô: chọn ô này làm ô đang focus
    }

    menuEl = buildList(buildItems(h), false);
    menuEl.classList.add('cm-menu');
    menuEl.tabIndex = -1;
    document.body.appendChild(menuEl);

    const r = menuEl.getBoundingClientRect();
    let left = x + 2;
    let top = y + 2;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, x - r.width - 2);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    menuEl.style.left = left + 'px';
    menuEl.style.top = top + 'px';

    const onDown = (e) => {
      if (menuEl && !menuEl.contains(e.target)) closeMenu();
    };
    const onWheel = (e) => {
      if (menuEl && !menuEl.contains(e.target)) closeMenu();
    };
    const onClose = () => closeMenu();
    const onKey = (e) => {
      if (!menuEl) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        return;
      }
      const active = document.activeElement;
      const inMenu = active && menuEl.contains(active) && active.classList.contains('cm-item');
      const list = inMenu ? active.parentElement : menuEl;
      const rows = Array.from(list.querySelectorAll(':scope > .cm-item:not(.disabled)'));

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!rows.length) return;
        let i = rows.indexOf(active);
        i = e.key === 'ArrowDown' ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
        rows[i].focus();
      } else if (e.key === 'ArrowRight' && inMenu && active.querySelector(':scope > .cm-sub')) {
        e.preventDefault();
        openSub(active);
        const first = active.querySelector(':scope > .cm-sub > .cm-item:not(.disabled)');
        if (first) first.focus();
      } else if (e.key === 'ArrowLeft' && inMenu && list.classList.contains('cm-sub')) {
        e.preventDefault();
        const parentRow = list.parentElement;
        parentRow.classList.remove('open');
        parentRow.focus();
      } else if ((e.key === 'Enter' || e.key === ' ') && inMenu) {
        e.preventDefault();
        active.click();
      }
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    menuCleanup = () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }

  /* ====================================================================
   *  HỘP CÀI ĐẶT CHART (lưới + màu nến) - áp dụng trực tiếp, Huỷ = hoàn lại
   * ================================================================== */
  function closeDialog(restore) {
    if (dialogCleanup) dialogCleanup(restore);
    dialogCleanup = null;
    if (dialogEl) dialogEl.remove();
    dialogEl = null;
  }

  function openSettings() {
    closeMenu();
    closeDialog(false);

    const snapshot = ChartAppearance.get();
    const themeGrid = currentTheme() === 'light' ? '#eef1f8' : '#161720';

    dialogEl = el('div', 'cm-dialog-backdrop');
    dialogEl.innerHTML = `
      <div class="cm-dialog" role="dialog" aria-modal="true" aria-label="Cài đặt chart">
        <div class="cm-dialog-head">
          <span class="cm-dialog-title">Cài đặt chart</span>
          <button type="button" class="cm-x" aria-label="Đóng">&times;</button>
        </div>
        <div class="cm-dialog-body">
          <div class="cm-group">
            <div class="cm-group-title">Lưới</div>
            <label class="cm-row"><span>Lưới ngang</span><span class="cm-swwrap"><input type="checkbox" id="cmGridH"><span class="cm-sw"></span></span></label>
            <label class="cm-row"><span>Lưới dọc</span><span class="cm-swwrap"><input type="checkbox" id="cmGridV"><span class="cm-sw"></span></span></label>
            <div class="cm-row">
              <span>Màu lưới</span>
              <span class="cm-ctrls">
                <label class="cm-inline"><input type="checkbox" id="cmGridAuto"> Theo giao diện</label>
                <input type="color" id="cmGridColor" class="cm-color">
              </span>
            </div>
          </div>
          <div class="cm-group">
            <div class="cm-group-title">Màu nến</div>
            <div class="cm-presets" id="cmPresets"></div>
            <div class="cm-row"><span>Nến tăng</span><input type="color" id="cmUp" class="cm-color"></div>
            <div class="cm-row"><span>Nến giảm</span><input type="color" id="cmDown" class="cm-color"></div>
            <div class="cm-row">
              <span>Độ đậm Volume</span>
              <span class="cm-ctrls"><input type="range" id="cmVol" class="cm-range" min="10" max="100" step="5"><span class="cm-val" id="cmVolVal"></span></span>
            </div>
          </div>
        </div>
        <div class="cm-dialog-foot">
          <button type="button" class="cm-btn ghost" id="cmReset">Đặt lại mặc định</button>
          <span class="cm-spacer"></span>
          <button type="button" class="cm-btn" id="cmCancel">Huỷ</button>
          <button type="button" class="cm-btn primary" id="cmOk">Ok</button>
        </div>
      </div>`;
    document.body.appendChild(dialogEl);

    const q = (sel) => dialogEl.querySelector(sel);
    const presetsEl = q('#cmPresets');

    ChartAppearance.PRESETS.forEach((p) => {
      const b = el('button', 'cm-preset');
      b.type = 'button';
      b.dataset.id = p.id;
      b.title = p.label;
      b.innerHTML = '<span class="cm-pc" style="background:' + p.up + '"></span><span class="cm-pc" style="background:' + p.down + '"></span><span class="cm-pl"></span>';
      b.querySelector('.cm-pl').textContent = p.label;
      b.addEventListener('click', () => {
        ChartAppearance.set({ upColor: p.up, downColor: p.down });
        sync();
      });
      presetsEl.appendChild(b);
    });

    function sync() {
      const a = ChartAppearance.get();
      q('#cmGridH').checked = a.gridHorz;
      q('#cmGridV').checked = a.gridVert;
      q('#cmGridAuto').checked = !a.gridColor;
      q('#cmGridColor').value = a.gridColor || themeGrid;
      q('#cmGridColor').disabled = !a.gridColor;
      q('#cmUp').value = a.upColor;
      q('#cmDown').value = a.downColor;
      q('#cmVol').value = Math.round(a.volumeAlpha * 100);
      q('#cmVolVal').textContent = Math.round(a.volumeAlpha * 100) + '%';
      presetsEl.querySelectorAll('.cm-preset').forEach((b) => {
        const p = ChartAppearance.PRESETS.find((x) => x.id === b.dataset.id);
        b.classList.toggle('active', !!p && p.up.toLowerCase() === a.upColor.toLowerCase() && p.down.toLowerCase() === a.downColor.toLowerCase());
      });
    }
    sync();

    q('#cmGridH').addEventListener('change', (e) => ChartAppearance.set({ gridHorz: e.target.checked }));
    q('#cmGridV').addEventListener('change', (e) => ChartAppearance.set({ gridVert: e.target.checked }));
    q('#cmGridAuto').addEventListener('change', (e) => {
      ChartAppearance.set({ gridColor: e.target.checked ? null : q('#cmGridColor').value });
      sync();
    });
    q('#cmGridColor').addEventListener('input', (e) => ChartAppearance.set({ gridColor: e.target.value }));
    q('#cmUp').addEventListener('input', (e) => {
      ChartAppearance.set({ upColor: e.target.value });
      sync();
    });
    q('#cmDown').addEventListener('input', (e) => {
      ChartAppearance.set({ downColor: e.target.value });
      sync();
    });
    q('#cmVol').addEventListener('input', (e) => {
      ChartAppearance.set({ volumeAlpha: parseInt(e.target.value, 10) / 100 });
      q('#cmVolVal').textContent = e.target.value + '%';
    });
    q('#cmReset').addEventListener('click', () => {
      ChartAppearance.reset();
      sync();
    });

    const cancel = () => closeDialog(true);
    q('#cmCancel').addEventListener('click', cancel);
    q('.cm-x').addEventListener('click', cancel);
    q('#cmOk').addEventListener('click', () => closeDialog(false));
    dialogEl.addEventListener('mousedown', (e) => {
      if (e.target === dialogEl) cancel();
    });
    ['keydown', 'pointerdown'].forEach((ev) => dialogEl.addEventListener(ev, (e) => e.stopPropagation()));

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    dialogCleanup = (restore) => {
      document.removeEventListener('keydown', onKey, true);
      if (restore) ChartAppearance.set(snapshot);
    };
    q('#cmOk').focus();
  }

  /* ====================================================================
   *  PHÍM TẮT TOÀN CỤC (áp dụng cho ô đang chọn)
   * ================================================================== */
  function activeHandle() {
    const id = typeof Store !== 'undefined' && Store.getState ? Store.getState().activePaneId : null;
    const h = instances.get(id);
    if (!h || h.container.offsetParent === null) return null; // ô đang ẩn / không ở tab Biểu đồ
    return h;
  }

  function bindGlobalKeys() {
    if (globalKeysBound) return;
    globalKeysBound = true;
    document.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('.dtv-modal-backdrop, .cm-dialog-backdrop')) return;
      if (!e.altKey || e.metaKey) return;

      const isReset = e.code === 'KeyR' && !e.ctrlKey;
      const isSave = e.code === 'KeyS' && e.ctrlKey;
      const isCopy = e.code === 'KeyC' && e.ctrlKey;
      if (!isReset && !isSave && !isCopy) return;

      const all = e.shiftKey && (isSave || isCopy);
      const h = activeHandle() || visibleHandles()[0];
      if (!h) return;
      e.preventDefault();
      closeMenu();
      if (isReset) h.opts.resetView();
      else if (isSave) doSave(h, all);
      else doCopy(h, all);
    });
  }

  /* ====================================================================
   *  GẮN VÀO 1 PANE
   * ================================================================== */
  function attach(opts) {
    const { paneId, container, chart } = opts;
    if (!container || !chart) return { destroy() {} };
    if (instances.has(paneId)) instances.get(paneId).destroy();

    const h = { paneId, container, chart, opts };
    const tool = () => (typeof opts.getDrawingTool === 'function' ? opts.getDrawingTool() : 'cursor');

    restoreScale(h);

    // ---- chuột phải ----
    const onContext = (e) => {
      cancelLongPress();
      if (e.defaultPrevented) return; // drawing.js đã xử lý (chuột phải vào hình vẽ)
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, .dtv-tb')) return;
      e.preventDefault();
      if (tool() !== 'cursor') return; // đang vẽ: không mở menu, cũng không hiện menu của trình duyệt
      openMenu(h, e.clientX, e.clientY);
    };

    // ---- nhấn giữ (iPad / điện thoại không có chuột phải) ----
    let lp = null;
    function cancelLongPress() {
      if (!lp) return;
      clearTimeout(lp.timer);
      window.removeEventListener('pointermove', onLpMove, true);
      window.removeEventListener('pointerup', cancelLongPress, true);
      window.removeEventListener('pointercancel', cancelLongPress, true);
      lp = null;
    }
    function onLpMove(e) {
      if (!lp || e.pointerId !== lp.id) return;
      if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_MOVE_PX) cancelLongPress();
    }
    const onDown = (e) => {
      if (e.pointerType === 'mouse') {
        cancelLongPress();
        return;
      }
      if (!e.isPrimary) {
        cancelLongPress(); // chạm thêm ngón thứ 2 = đang zoom
        return;
      }
      if (tool() !== 'cursor') return;
      if (e.target.closest && e.target.closest('input, textarea, select, button, .dtv-tb')) return;
      cancelLongPress();
      lp = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
  const { x, y } = lp || { x: e.clientX, y: e.clientY };
  cancelLongPress();
  try { h.chart.clearCrosshairPosition(); } catch (_) {}
  if (navigator.vibrate) navigator.vibrate(8);
  openMenu(h, x, y);
}, LONG_PRESS_MS),
      };
      window.addEventListener('pointermove', onLpMove, true);
      window.addEventListener('pointerup', cancelLongPress, true);
      window.addEventListener('pointercancel', cancelLongPress, true);
    };

    container.addEventListener('contextmenu', onContext);
    container.addEventListener('pointerdown', onDown, true);
    bindGlobalKeys();

    h.destroy = () => {
      cancelLongPress();
      container.removeEventListener('contextmenu', onContext);
      container.removeEventListener('pointerdown', onDown, true);
      closeMenu();
      instances.delete(paneId);
    };
    instances.set(paneId, h);
    return { destroy: h.destroy };
  }

  return { attach, closeMenu, openSettings };
})();