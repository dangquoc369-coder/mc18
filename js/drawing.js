/**
 * js/drawing.js
 * Bộ công cụ vẽ kiểu TradingView:
 *  - Vẽ cả vùng tương lai (logicalIndex), kéo sửa từng điểm neo
 *  - Floating toolbar nhỏ khi chọn hình (màu / khoá / cài đặt / nhân bản / xoá)
 *  - Modal cài đặt 3 tab (Style / Coordinates / Visibility), Fib retracement đầy đủ như TradingView
 *  - NHỚ STYLE THEO TỪNG CÔNG CỤ: mỗi khi chỉnh màu / độ dày / nét đứt / độ mờ / cấu hình Fib...
 *    của 1 hình thì style đó được lưu lại và tự áp cho các hình mới cùng loại (dùng chung 4 pane,
 *    lưu cục bộ trong LocalStore khoá 'drawing_tool_styles', nằm trong file sao lưu "Dữ liệu").
 *
 * options:
 *   onAlertRequested(price), onToolChanged()
 *   timeframes: ['1m','5m','15m','1h','4h','1d']   (tuỳ chọn, để bật tab Visibility theo khung)
 *   getTimeframe(): trả về khung hiện tại           (tuỳ chọn)
 *
 * API tĩnh (DrawingModule):
 *   create(...), getToolStyle(type), resetToolStyles(type?)
 * Sự kiện: window 'drawing:styleChanged' khi kho style thay đổi.
 */

const DrawingModule = (function () {
  const TOUCH_CROSSHAIR_OFFSET = 40;
  const EXTEND_FACTOR = 60;
  const SAVE_DEBOUNCE_MS = 500;
  const HANDLE_RADIUS = 5;

  const SINGLE_ANCHOR_TOOLS = ['hline', 'vline', 'hray'];
  const TWO_ANCHOR_TOOLS = ['trendline', 'ray', 'extendedline', 'rectangle', 'circle', 'arrow', 'fib', 'long', 'short'];
  const THREE_ANCHOR_TOOLS = ['triangle', 'channel', 'fibextension'];
  const DASHED_STYLE_TOOLS = ['hline', 'vline', 'hray', 'trendline', 'ray', 'extendedline', 'rectangle', 'circle', 'triangle', 'arrow', 'channel'];
  // Hình có vùng tô nền bên trong: có thể tắt nền, khi tắt chỉ còn đường bao quanh
  const FILL_TOOLS = ['rectangle', 'circle', 'triangle', 'channel', 'long', 'short'];
  // (Không công cụ nào còn bị phát sáng / đậm lên khi chạm hoặc rê chuột - chỉ hiện điểm tròn di chuyển)
  const NO_GLOW_TOOLS = ['trendline', 'ray', 'extendedline', 'arrow', 'hline', 'vline', 'hray', 'channel'];

  const TOOL_DISPLAY_NAMES = {
    hline: 'Đường ngang', vline: 'Đường dọc', hray: 'Tia ngang',
    trendline: 'Đường xu hướng', ray: 'Tia (Ray)', extendedline: 'Đường mở rộng',
    rectangle: 'Hình chữ nhật', circle: 'Hình tròn / Ellipse', triangle: 'Tam giác',
    channel: 'Kênh giá song song', fib: 'Fib retracement', fibextension: 'Fib extension',
    long: 'Lệnh Long', short: 'Lệnh Short', arrow: 'Mũi tên', text: 'Ghi chú',
  };

  // Danh sách mức Fib giống TradingView (xếp 2 cột, đọc từ trái sang phải)
  const DEFAULT_FIB_LEVELS = [
    { level: 0, color: '#787b86', enabled: true },
    { level: 0.236, color: '#f23645', enabled: true },
    { level: 0.382, color: '#ff9800', enabled: true },
    { level: 0.5, color: '#4caf50', enabled: true },
    { level: 0.618, color: '#089981', enabled: true },
    { level: 0.786, color: '#00bcd4', enabled: true },
    { level: 1, color: '#787b86', enabled: true },
    { level: 1.618, color: '#2962ff', enabled: true },
    { level: 2.618, color: '#f23645', enabled: false },
    { level: 3.618, color: '#9c27b0', enabled: false },
    { level: 4.236, color: '#e91e63', enabled: false },
    { level: 1.272, color: '#81c784', enabled: false },
    { level: 1.414, color: '#f23645', enabled: false },
    { level: 2.272, color: '#81c784', enabled: false },
    { level: 2.414, color: '#2962ff', enabled: false },
    { level: 2, color: '#00bcd4', enabled: false },
    { level: 3, color: '#ff9800', enabled: false },
    { level: 3.272, color: '#4caf50', enabled: false },
    { level: 3.414, color: '#9c27b0', enabled: false },
    { level: 4, color: '#f23645', enabled: false },
    { level: 4.272, color: '#e91e63', enabled: false },
    { level: 4.414, color: '#ff9800', enabled: false },
    { level: 4.618, color: '#089981', enabled: false },
    { level: 4.764, color: '#2962ff', enabled: false },
  ];

  const FIB_DEFAULTS = {
    showTrendline: true,
    trendColor: '#787b86',
    trendStyle: 'dashed',
    levelsWidth: 1,
    levelsStyle: 'solid',
    extend: 'none',            // none | left | right | both
    bg: true,
    bgOpacity: 0.15,
    reverse: false,
    showPrices: true,
    showLevels: true,
    levelsMode: 'values',      // values | percents
    labelH: 'left',            // left | right
    labelV: 'top',             // top | middle | bottom
    showText: false,
    text: '',
    textH: 'center',
    textV: 'middle',
    fontSize: 10,
    levels: DEFAULT_FIB_LEVELS,
  };

  const LINE_STYLES = [['solid', 'Nét liền'], ['dashed', 'Nét đứt'], ['dotted', 'Chấm']];

  const ICON = {
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
    grip: '<svg viewBox="0 0 24 24" class="grip"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
    dashed: '<svg viewBox="0 0 24 24"><path d="M3 12h4M10 12h4M17 12h4"/></svg>',
    solid: '<svg viewBox="0 0 24 24"><path d="M3 12h18"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    fill: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 19l8-14M4 14l9-9M12 19l8-8"/></svg>',
    textT: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
  };


const DTV_CSS = `
.dtv-tb{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:100;display:flex;align-items:center;gap:2px;padding:4px 6px;background:#1e222d;border:1px solid rgba(255,255,255,.14);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.5);color:#d1d4dc;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.dtv-tb-grip{width:18px;height:28px;display:flex;align-items:center;justify-content:center;cursor:grab;color:#6a6d78}
.dtv-tb-grip:active{cursor:grabbing}
.dtv-tb-grip svg{width:14px;height:14px;fill:currentColor;stroke:none}
.dtv-tb-sep{width:1px;height:20px;background:rgba(255,255,255,.14);margin:0 4px}
.dtv-tb-btn{background:transparent;border:none;color:#b2b5be;width:30px;height:30px;border-radius:5px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.dtv-tb-btn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.dtv-tb-btn:hover{background:rgba(255,255,255,.1);color:#fff}
.dtv-tb-btn.active{color:#2962ff;background:rgba(41,98,255,.16)}
.dtv-tb-color{position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:5px;cursor:pointer}
.dtv-tb-color:hover{background:rgba(255,255,255,.1)}
.dtv-tb-color input{width:18px;height:18px;padding:0;border:2px solid #fff;border-radius:50%;background:transparent;cursor:pointer}
.dtv-tb-select{background:transparent;border:none;color:#d1d4dc;font-size:12px;padding:5px 2px;border-radius:5px;cursor:pointer;outline:none}
.dtv-tb-select:hover{background:rgba(255,255,255,.1)}
.dtv-tb-select option{background:#1e222d;color:#d1d4dc}

.dtv-modal-backdrop{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.65);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
.dtv-modal{width:480px;max-width:94vw;background:#1e222d;border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.7);display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#f0f3f8}
.dtv-modal-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.08)}
.dtv-modal-title{font-size:16px;font-weight:600;color:#fff}
.dtv-modal-close{background:transparent;border:none;color:#9aa3b8;cursor:pointer;font-size:22px;width:28px;height:28px;border-radius:4px}
.dtv-modal-close:hover{background:rgba(255,255,255,.1);color:#fff}
.dtv-modal-tabs{display:flex;gap:24px;padding:0 20px;border-bottom:1px solid rgba(255,255,255,.08)}
.dtv-modal-tab{background:transparent;border:none;color:#9aa3b8;padding:12px 0;font-size:14px;font-weight:500;cursor:pointer;position:relative}
.dtv-modal-tab.active{color:#fff}
.dtv-modal-tab.active::after{content:'';position:absolute;bottom:-1px;left:0;width:100%;height:2px;background:#2962ff}
.dtv-modal-body{padding:20px;max-height:62vh;overflow-y:auto}
.dtv-modal .tab-pane{display:flex;flex-direction:column;gap:14px}
.dtv-modal-row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}
.dtv-modal-sep{height:1px;background:rgba(255,255,255,.08)}
.dtv-modal-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
.dtv-ctrls{display:flex;align-items:center;gap:8px}
.dtv-check{display:flex;align-items:center;gap:8px;cursor:pointer}
.dtv-check input[type=checkbox],.dtv-fib-item input[type=checkbox]{width:16px;height:16px;cursor:pointer;accent-color:#2962ff}
.dtv-mini{display:flex;align-items:center;gap:6px;font-size:12px;color:#9aa3b8}
.dtv-select,.dtv-input{background:#12151c;border:1px solid rgba(255,255,255,.18);border-radius:6px;color:#fff;padding:5px 8px;font-size:12px;outline:none}
.dtv-select:focus,.dtv-input:focus{border-color:#2962ff}
.dtv-input[type=number]{width:96px;font-family:monospace}
.dtv-color{width:32px;height:26px;padding:0;border:none;background:transparent;cursor:pointer;border-radius:4px}
.dtv-range{width:150px;accent-color:#2962ff;cursor:pointer}
textarea.dtv-input{width:100%;min-height:56px;resize:vertical;font-family:inherit;line-height:1.4}
.dtv-fib-item{display:flex;align-items:center;gap:8px}
.dtv-fib-item input[type=number]{width:70px;background:#12151c;border:1px solid rgba(255,255,255,.15);border-radius:4px;color:#fff;padding:4px 6px;font-size:12px;font-family:monospace}
.dtv-fib-item input[type=color]{width:26px;height:26px;padding:0;border:none;background:transparent;cursor:pointer;border-radius:3px}
.dtv-modal-footer{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-top:1px solid rgba(255,255,255,.08);background:#161a25}
.dtv-modal-btn-group{display:flex;gap:10px}
.dtv-modal-btn{padding:8px 18px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;border:none}
.dtv-modal-btn.cancel{background:transparent;color:#9aa3b8;border:1px solid rgba(255,255,255,.2)}
.dtv-modal-btn.cancel:hover{background:rgba(255,255,255,.08);color:#fff}
.dtv-modal-btn.primary{background:#2962ff;color:#fff}
.dtv-modal-btn.primary:hover{background:#1e4bd8}
`;

function ensureStyles() {
  if (document.getElementById('dtv-styles')) return;
  const st = document.createElement('style');
  st.id = 'dtv-styles';
  st.textContent = DTV_CSS;
  document.head.appendChild(st);
}

  const hasLocalStore = () => typeof LocalStore !== 'undefined';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const hex6 = (c, fb) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : fb || '#f2a339');
  const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const dashFor = (style) => (style === 'dashed' ? [6, 4] : style === 'dotted' ? [2, 3] : []);

  function selectHTML(id, options, cur) {
    return `<select id="${id}" class="dtv-select">${options
      .map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`)
      .join('')}</select>`;
  }

  // ===================== KHO STYLE NHỚ THEO CÔNG CỤ (DÙNG CHUNG CẢ 4 PANE) =====================
  // Dạng: { trendline: {color,width,dashed,opacity}, fib: {...cấu hình Fib...}, long: {..., rr}, ... }
  const TOOL_STYLES_KEY = 'drawing_tool_styles';
  const STYLE_KEYS = ['color', 'width', 'dashed', 'opacity', 'rr', 'fill', 'textColor', 'fontSize', 'textH', 'textV', 'bold', 'italic'];
  // Chữ ghi chú của Fib là riêng từng hình nên không nhớ
  const FIB_KEYS = Object.keys(FIB_DEFAULTS).filter((k) => k !== 'text');
  let toolStyles = null;

  function getToolStyles() {
    if (!toolStyles) {
      const saved = hasLocalStore() ? LocalStore.read(TOOL_STYLES_KEY, null) : null;
      toolStyles = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
      // Chuyển template Fib kiểu cũ (nếu có)
      if (!toolStyles.fib && hasLocalStore()) {
        const old = LocalStore.read('drawing_fib_template', null);
        if (old && typeof old === 'object' && Object.keys(old).length) {
          delete old.text;
          toolStyles.fib = old;
        }
      }
    }
    return toolStyles;
  }

  function notifyStyleChanged() {
    try {
      window.dispatchEvent(new CustomEvent('drawing:styleChanged'));
    } catch (e) { /* bỏ qua */ }
  }

  function saveToolStyles() {
    if (hasLocalStore()) LocalStore.write(TOOL_STYLES_KEY, getToolStyles());
    notifyStyleChanged();
  }

  /** Bản sao style đã nhớ của 1 công cụ ({} nếu chưa có). */
  function styleOf(type) {
    return clone(getToolStyles()[type] || {});
  }

  /** Ghi nhớ style hiện tại của hình d làm mặc định cho công cụ cùng loại. */
  function rememberStyle(d) {
    if (!d || !d.type) return;
    const s = {};
    (d.type === 'fib' ? FIB_KEYS : STYLE_KEYS).forEach((k) => {
      if (d[k] !== undefined) s[k] = clone(d[k]);
    });
    getToolStyles()[d.type] = s;
    saveToolStyles();
  }

  function setToolStyle(type, obj) {
    getToolStyles()[type] = obj;
    saveToolStyles();
  }

  /** Xoá style đã nhớ: của 1 công cụ (có type) hoặc của tất cả (không truyền). */
  function resetToolStyles(type) {
    if (type) delete getToolStyles()[type];
    else toolStyles = {};
    saveToolStyles();
  }
  
    // ===================== NAM CHÂM (MAGNET) - DÙNG CHUNG 4 PANE =====================
  const MAGNET_KEY = 'drawing_magnet_mode';       // 'off' | 'weak' | 'strong'
  const MAGNET_WEAK_PX = 24;                      // yếu: chỉ hít khi cách O/H/L/C <= 24px
  let magnetMode = null;

  function getMagnetMode() {
    if (magnetMode === null) {
      const saved = hasLocalStore() ? LocalStore.read(MAGNET_KEY, 'off') : 'off';
      magnetMode = ['off', 'weak', 'strong'].includes(saved) ? saved : 'off';
    }
    return magnetMode;
  }

  function setMagnetMode(mode) {
    if (!['off', 'weak', 'strong'].includes(mode)) return;
    magnetMode = mode;
    if (hasLocalStore()) LocalStore.write(MAGNET_KEY, mode);
    try {
      window.dispatchEvent(new CustomEvent('drawing:magnetChanged', { detail: { mode } }));
    } catch (e) { /* bỏ qua */ }
  }

  function create(paneId, chart, candleSeries, container, options = {}) {
    const { onAlertRequested, onToolChanged, timeframes, getTimeframe, getCandles } = options;
    ensureStyles();

    let currentTool = 'cursor';
    let drawings = [];

    let defaultStyle = (hasLocalStore() && LocalStore.read('drawing_default_style', null)) || { color: null, width: 1.5 };

    let allDrawingsHidden = false;
    let dragStart = null;
    let previewDrawing = null;
    let hoverPoint = null;
    let touchRawPoint = null;
    let pendingTouchPlacement = null;
    let pendingThirdPoint = null;

    let isDraggingShape = false;
    let isDraggingHandle = false;
    let draggedHandleName = null;
    let draggedDrawingIndex = null;
    let draggedDrawingOriginal = null;
    let dragStartPixel = null;

    let hoveredDrawingIndex = null;
    let selectedDrawingIndex = null;
    let toolbarEl = null;
    let toolStartCount = 0;

    let currentSymbol = null;
    let saveTimer = null;
    let lastSavedStr = '[]';

    /** Tạo hình mới: mặc định chung -> mặc định riêng của loại -> style đã nhớ của công cụ. */
    function newDrawing(type, geom, base = {}) {
      return {
        type,
        ...geom,
        color: defaultStyle.color,
        width: defaultStyle.width,
        ...base,
        ...styleOf(type),
      };
    }

    const computed = window.getComputedStyle(container);
    if (computed.position === 'static') container.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.className = 'draw-canvas';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);
    const canvasCtx = canvas.getContext('2d');
    let ctx = canvasCtx;              // ctx tạm thời trỏ sang context của chart khi primitive vẽ
    let inPrimitive = false;
    let primSize = { width: 0, height: 0 };
    let primitiveUpdate = null;

    function resizeCanvas() {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    function candleList() {
  const c = typeof getCandles === 'function' ? getCandles() : null;
  return Array.isArray(c) ? c : [];
}

// Độ rộng 1 nến = chênh lệch nhỏ nhất giữa các nến gần đầu/cuối (tránh bị lệch bởi khoảng nghỉ cuối tuần)
function barInterval(c, atEnd) {
  const n = c.length;
  if (n < 2) return 60;
  const from = atEnd ? Math.max(1, n - 10) : 1;
  const to = atEnd ? n - 1 : Math.min(n - 1, 10);
  let m = Infinity;
  for (let i = from; i <= to; i++) {
    const d = c[i].time - c[i - 1].time;
    if (d > 0 && d < m) m = d;
  }
  return Number.isFinite(m) ? m : 60;
}

// Thời gian -> vị trí nến NGUYÊN (nến chứa mốc thời gian đó), giống TradingView
function timeToLogical(t) {
  const c = candleList();
  const n = c.length;
  if (!n || typeof t !== 'number' || Number.isNaN(t)) return null;
  if (t >= c[n - 1].time) {
    return n - 1 + Math.floor((t - c[n - 1].time) / barInterval(c, true) + 1e-6);
  }
  if (t < c[0].time) {
    return Math.floor((t - c[0].time) / barInterval(c, false) + 1e-6);
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid].time <= t) lo = mid; else hi = mid;
  }
  return c[hi].time <= t ? hi : lo;
}

// Vị trí nến -> thời gian MỞ của nến đó (vùng tương lai/quá khứ: ngoại suy theo độ rộng nến)
function logicalToTime(l) {
  const c = candleList();
  const n = c.length;
  if (!n || typeof l !== 'number' || Number.isNaN(l)) return null;
  const r = Math.round(l);
  if (r > n - 1) return c[n - 1].time + (r - (n - 1)) * barInterval(c, true);
  if (r < 0) return c[0].time + r * barInterval(c, false);
  return c[r].time;
}

function pointToX(p) {
  if (!p) return null;
  let t = p.time;
  // Hình cũ chỉ có logicalIndex: đổi sang time 1 lần
  if ((t === undefined || t === null) && p.logicalIndex !== undefined && p.logicalIndex !== null) {
    const conv = logicalToTime(p.logicalIndex);
    if (conv === null) return null;
    p.time = conv;
    delete p.logicalIndex;
    t = conv;
  }
  if (t === undefined || t === null) return null;
  const l = timeToLogical(t);
  return l === null ? null : chart.timeScale().logicalToCoordinate(l);
}

function xToPointInfo(x) {
  const l = chart.timeScale().coordinateToLogical(x);
  return { time: l === null || l === undefined ? null : logicalToTime(l) };
}

    function priceToY(price) {
      return candleSeries.priceToCoordinate(price);
    }


    function yToPrice(y) {
      return candleSeries.coordinateToPrice(y);
    }

    // ===================== LƯU / NẠP HÌNH VẼ =====================
    function drawingsKey(sym) {
      return 'drawings:' + sym;
    }

    function flushSave() {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (!currentSymbol || !hasLocalStore()) return;
      const str = JSON.stringify(drawings);
      if (str === lastSavedStr) return;
      LocalStore.write(drawingsKey(currentSymbol), drawings);
      lastSavedStr = str;
    }

    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    }

    function resetInteractionState() {
      selectedDrawingIndex = null;
      hoveredDrawingIndex = null;
      hideToolbar();
      dragStart = null;
      previewDrawing = null;
      pendingThirdPoint = null;
      pendingTouchPlacement = null;
      isDraggingShape = false;
      isDraggingHandle = false;
      draggedDrawingIndex = null;
      draggedDrawingOriginal = null;
      dragStartPixel = null;
    }

    function loadForSymbol(symbol) {
      flushSave();
      currentSymbol = symbol || null;
      resetInteractionState();
      const saved = currentSymbol && hasLocalStore() ? LocalStore.read(drawingsKey(currentSymbol), []) : [];
      drawings = Array.isArray(saved) ? saved : [];
      lastSavedStr = JSON.stringify(drawings);
      redraw();
    }

    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave();
    });

    function getThemeTextColor() {
      const theme = (typeof ThemeModule !== 'undefined' && ThemeModule.getTheme()) || 'dark';
      return theme === 'light' ? '#12151c' : '#e6e9f0';
    }

    function getThemeHaloColor() {
      const theme = (typeof ThemeModule !== 'undefined' && ThemeModule.getTheme()) || 'dark';
      return theme === 'light' ? '#ffffff' : '#0c0d14';
    }

    function getScreenXY(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      if (e.pointerType === 'touch' && currentTool !== 'cursor') {
        y = Math.max(0, y - TOUCH_CROSSHAIR_OFFSET);
      }
      return { x, y };
    }

    function setTool(tool) {
      currentTool = tool;
      const isInteractive = tool !== 'cursor';
      canvas.style.pointerEvents = isInteractive ? 'auto' : 'none';
      canvas.style.cursor = isInteractive ? 'crosshair' : 'default';
      if (isInteractive) {
        toolStartCount = drawings.length;
        selectedDrawingIndex = null;
        hideToolbar();
        if (allDrawingsHidden && tool !== 'eraser') allDrawingsHidden = false;
      }
      dragStart = null;
      previewDrawing = null;
      pendingThirdPoint = null;
      pendingTouchPlacement = null;
            resetTouchDrawing();
      if (isInteractive && tool !== 'eraser' && isCoarsePointer()) {
        const { width, height } = getRect();
        touchCursor = { x: width / 2, y: height / 2 };
        syncTouchHover();
        updateTouchPreview();
      } else {
        hoverPoint = null;
      }
      redraw();
    }

    function returnToCursorAfterDraw() {
      const created = drawings.length > toolStartCount;
      setTool('cursor');
      if (created) {
        // Giống TradingView: vẽ xong thì chọn luôn hình đó và hiện toolbar cài đặt
        selectedDrawingIndex = drawings.length - 1;
        showToolbar(selectedDrawingIndex);
        redraw();
      }
      if (typeof onToolChanged === 'function') onToolChanged();
    }

    function clearAll() {
      drawings = [];
      selectedDrawingIndex = null;
      hideToolbar();
      redraw();
    }

    function getRect() {
      if (inPrimitive) return primSize;
      const rect = container.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }

    function isVisibleNow(d) {
      if (!Array.isArray(d.tfs) || typeof getTimeframe !== 'function') return true;
      return d.tfs.includes(getTimeframe());
    }

        function drawHandle(x, y) {
      if (x === null || y === null || x === undefined || y === undefined) return;
      const touch = isCoarsePointer();
      const r = touch ? 9 : HANDLE_RADIUS;
      ctx.save();
      if (touch) {
        ctx.beginPath();
        ctx.arc(x, y, r + 7, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(41, 98, 255, 0.18)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#2962ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    function drawBoxText(d, rx, ry, rw, rh, baseColor) {
      if (!d.text || rw < 8 || rh < 8) return;
      const fs = Number(d.fontSize) || 12;
      const pad = 6;
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.font = `${d.italic ? 'italic ' : ''}${d.bold ? 700 : 500} ${fs}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = 'alphabetic';
 
      // Tự xuống dòng theo bề rộng hình, giữ các dòng người dùng tự ngắt
      const maxW = Math.max(10, rw - pad * 2);
      const lines = [];
      String(d.text).split('\n').forEach((para) => {
        let cur = '';
        para.split(/\s+/).forEach((w) => {
          const test = cur ? cur + ' ' + w : w;
          if (cur && ctx.measureText(test).width > maxW) {
            lines.push(cur);
            cur = w;
          } else {
            cur = test;
          }
        });
        lines.push(cur);
      });
 
      const lh = fs * 1.25;
      const blockH = lines.length * lh;
      const h = d.textH || 'center';
      const v = d.textV || 'middle';
      let top;
      if (v === 'top') top = ry + pad;
      else if (v === 'bottom') top = ry + rh - pad - blockH;
      else top = ry + (rh - blockH) / 2;
 
      let tx;
      let align;
      if (h === 'left') { tx = rx + pad; align = 'left'; }
      else if (h === 'right') { tx = rx + rw - pad; align = 'right'; }
      else { tx = rx + rw / 2; align = 'center'; }
 
      ctx.textAlign = align;
      ctx.fillStyle = d.textColor || baseColor;
      lines.forEach((ln, i) => ctx.fillText(ln, tx, top + i * lh + fs));
      ctx.restore();
    }
 
    function extendPointBeyond(x1, y1, x2, y2, factor) {
      return { x: x1 + (x2 - x1) * factor, y: y1 + (y2 - y1) * factor };
    }

    function drawArrowHead(toX, toY, fromX, fromY, color) {
      const angle = Math.atan2(toY - fromY, toX - fromX);
      const headLen = 11;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6.5), toY - headLen * Math.sin(angle - Math.PI / 6.5));
      ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6.5), toY - headLen * Math.sin(angle + Math.PI / 6.5));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }

    function redraw() {
  const { width, height } = getRect();
  canvasCtx.clearRect(0, 0, width, height);
  if (previewDrawing) drawShape(previewDrawing, true);
  drawCrosshair();
  if (primitiveUpdate) primitiveUpdate();
  extraUpdaters.forEach((f) => f());   // <-- THÊM
  scheduleSave();
}
    function toRGBA(baseColor, alpha) {
      let r = 242, g = 163, b = 57;
      if (baseColor && baseColor.startsWith('#') && baseColor.length >= 7) {
        const pr = parseInt(baseColor.slice(1, 3), 16);
        const pg = parseInt(baseColor.slice(3, 5), 16);
        const pb = parseInt(baseColor.slice(5, 7), 16);
        if (!isNaN(pr) && !isNaN(pg) && !isNaN(pb)) { r = pr; g = pg; b = pb; }
      }
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // ===================== FIB RETRACEMENT =====================
    // Giống TradingView: mức 0 nằm ở điểm 2 (điểm thả), mức 1 ở điểm 1. "Reverse" đảo ngược lại.
    function computeFib(d, isPreview) {
      const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
      const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
      if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) return null;

      const cfg = { ...FIB_DEFAULTS, ...(isPreview ? styleOf('fib') : {}), ...d };
      const { width } = getRect();
      let xl = Math.min(x1, x2), xr = Math.max(x1, x2);
      if (cfg.extend === 'left' || cfg.extend === 'both') xl = 0;
      if (cfg.extend === 'right' || cfg.extend === 'both') xr = width;

      const pA = d.p1.price, pB = d.p2.price;
      const priceAt = (lvl) => (cfg.reverse ? pA + lvl * (pB - pA) : pB + lvl * (pA - pB));

      const rows = [];
      (cfg.levels || [])
        .filter((l) => l && l.enabled && Number.isFinite(l.level))
        .sort((a, b) => a.level - b.level)
        .forEach((l) => {
          const price = priceAt(l.level);
          const y = priceToY(price);
          if (y !== null && y !== undefined) rows.push({ lvl: l.level, price, y, color: hex6(l.color, '#787b86') });
        });

      return { cfg, x1, y1, x2, y2, xl, xr, rows };
    }

    function drawFib(g) {
      const { cfg, x1, y1, x2, y2, xl, xr, rows } = g;
      const { width } = getRect();
      const fs = Number(cfg.fontSize) || 10;
      ctx.shadowBlur = 0;

      // Nền giữa các mức
      if (cfg.bg) {
        for (let i = 0; i < rows.length - 1; i++) {
          ctx.fillStyle = toRGBA(rows[i + 1].color, cfg.bgOpacity);
          ctx.fillRect(xl, Math.min(rows[i].y, rows[i + 1].y), xr - xl, Math.abs(rows[i + 1].y - rows[i].y));
        }
      }

      // Đường xu hướng nối 2 điểm
      if (cfg.showTrendline) {
        ctx.strokeStyle = hex6(cfg.trendColor, '#787b86');
        ctx.lineWidth = 1;
        ctx.setLineDash(dashFor(cfg.trendStyle));
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Đường các mức
      ctx.lineWidth = Number(cfg.levelsWidth) || 1;
      ctx.setLineDash(dashFor(cfg.levelsStyle));
      rows.forEach((r) => {
        ctx.strokeStyle = r.color;
        ctx.beginPath();
        ctx.moveTo(xl, r.y);
        ctx.lineTo(xr, r.y);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // Nhãn
      ctx.font = `${fs}px sans-serif`;
      ctx.textBaseline = 'alphabetic';
      rows.forEach((r) => {
        const parts = [];
        if (cfg.showLevels) {
          parts.push(cfg.levelsMode === 'percents' ? (r.lvl * 100).toFixed(1).replace(/\.0$/, '') + '%' : String(r.lvl));
        }
        if (cfg.showPrices) parts.push(cfg.showLevels ? `(${formatPrice(r.price)})` : formatPrice(r.price));
        if (!parts.length) return;
        const label = parts.join(' ');
        const w = ctx.measureText(label).width;

        let lx, align;
        if (cfg.labelH === 'right') {
          lx = xr + 6; align = 'left';
          if (lx + w > width) { lx = xr - 4; align = 'right'; }
        } else {
          lx = xl - 6; align = 'right';
          if (lx - w < 0) { lx = xl + 4; align = 'left'; }
        }
        const ly = cfg.labelV === 'middle' ? r.y + fs * 0.35 : cfg.labelV === 'bottom' ? r.y + fs + 2 : r.y - 3;

        ctx.textAlign = align;
        ctx.fillStyle = r.color;
        ctx.fillText(label, lx, ly);
      });

      // Chữ ghi chú trên hình
      if (cfg.showText && cfg.text) {
        const ys = rows.map((r) => r.y).concat([y1, y2]);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        let tx, align;
        if (cfg.textH === 'left') { tx = xl + 6; align = 'left'; }
        else if (cfg.textH === 'right') { tx = xr - 6; align = 'right'; }
        else { tx = (xl + xr) / 2; align = 'center'; }
        const ty = cfg.textV === 'top' ? minY + fs + 4 : cfg.textV === 'bottom' ? maxY - 6 : (minY + maxY) / 2 + fs * 0.35;
        ctx.textAlign = align;
        ctx.fillStyle = getThemeTextColor();
        ctx.fillText(cfg.text, tx, ty);
      }
      ctx.textAlign = 'start';
    }

    // ===================== VẼ HÌNH =====================
    const NOOP_DRAW = function () {};
 
    /** Vẽ 1 hình. Hình có nền mà đã tắt nền thì chỉ còn đường bao quanh (bỏ qua mọi lệnh tô màu). */
    function drawShape(d, isPreview, idx) {
      const noFill = d.fill === false && FILL_TOOLS.includes(d.type);
      const c = ctx;
      if (noFill) {
        c.fill = NOOP_DRAW;
        c.fillRect = NOOP_DRAW;
      }
      try {
        drawShapeInner(d, isPreview, idx);
      } finally {
        if (noFill) {
          delete c.fill;
          delete c.fillRect;
        }
      }
    }
 
    function drawShapeInner(d, isPreview, idx) {
      const isHovered = idx !== undefined && idx === hoveredDrawingIndex;
      const isSelected = idx !== undefined && idx === selectedDrawingIndex;
      const showHandles = isSelected || (isHovered && !isCoarsePointer() && !drawings[idx].locked);

      ctx.save();
      ctx.globalAlpha = d.opacity === undefined ? 1 : d.opacity;

      const baseColor = d.color || '#f2a339';
      const baseWidth = d.width || 1.5;
      ctx.strokeStyle = isPreview ? (baseColor === '#f2a339' ? 'rgba(242, 163, 57, 0.55)' : baseColor + '88') : baseColor;

      ctx.lineWidth = baseWidth; // không còn phát sáng / đậm lên khi chạm hoặc rê chuột

      if (d.type === 'hline') {
        const y = priceToY(d.price);
        if (y === null || y === undefined) { ctx.restore(); return; }
        if (d.dashed !== false) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(getRect().width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = baseColor;
        ctx.font = '10px sans-serif';
        ctx.fillText(formatPrice(d.price), 4, y - 4);
        if (showHandles) drawHandle(getRect().width / 2, y);

      } else if (d.type === 'vline') {
        const x = pointToX(d);
        if (x === null || x === undefined) { ctx.restore(); return; }
        const { height } = getRect();
        if (d.dashed !== false) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.setLineDash([]);
        if (showHandles) drawHandle(x, height / 2);

      } else if (d.type === 'hray') {
        const x = pointToX(d.p);
        const y = priceToY(d.p.price);
        if ([x, y].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        const { width } = getRect();
        if (d.dashed !== false) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = baseColor;
        ctx.font = '10px sans-serif';
        ctx.fillText(formatPrice(d.p.price), x + 4, y - 4);
        if (showHandles) drawHandle(x, y);

      } else if (d.type === 'trendline' || d.type === 'ray' || d.type === 'extendedline') {
        const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
        const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        let startX = x1, startY = y1, endX = x2, endY = y2;
        if (d.type === 'ray') {
          const ext = extendPointBeyond(x1, y1, x2, y2, EXTEND_FACTOR);
          endX = ext.x; endY = ext.y;
        } else if (d.type === 'extendedline') {
          const extA = extendPointBeyond(x2, y2, x1, y1, EXTEND_FACTOR);
          const extB = extendPointBeyond(x1, y1, x2, y2, EXTEND_FACTOR);
          startX = extA.x; startY = extA.y; endX = extB.x; endY = extB.y;
        }

        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.setLineDash([]);

        if (showHandles) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'arrow') {
        const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
        const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        drawArrowHead(x2, y2, x1, y1, ctx.strokeStyle);
        if (showHandles) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'rectangle') {
        const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
        const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);

        ctx.fillStyle = toRGBA(baseColor, 0.12);
        ctx.fillRect(rx, ry, rw, rh);
        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        drawBoxText(d, rx, ry, rw, rh, baseColor);
        ctx.setLineDash([]);
        if (showHandles) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'circle') {
        const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
        const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        const rxRad = Math.abs(x2 - x1) / 2, ryRad = Math.abs(y2 - y1) / 2;

        ctx.fillStyle = toRGBA(baseColor, 0.12);
        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rxRad, ryRad, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        if (showHandles) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'triangle') {
        const pts = [d.p1, d.p2, d.p3].map((p) => ({ x: pointToX(p), y: priceToY(p.price) }));
        if (pts.some((p) => p.x === null || p.y === null || p.x === undefined || p.y === undefined)) { ctx.restore(); return; }

        ctx.fillStyle = toRGBA(baseColor, 0.12);
        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        if (showHandles) pts.forEach((p) => drawHandle(p.x, p.y));

      } else if (d.type === 'channel') {
        const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
        const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
        const x3 = pointToX(d.p3), y3 = priceToY(d.p3.price);
        if ([x1, y1, x2, y2, x3, y3].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        const lineYAt = (x) => (x2 === x1 ? y1 : y1 + ((x - x1) / (x2 - x1)) * (y2 - y1));
        const offsetY = y3 - lineYAt(x3);

        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x1, y1 + offsetY);
        ctx.lineTo(x2, y2 + offsetY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = toRGBA(baseColor, 0.1);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x2, y2 + offsetY);
        ctx.lineTo(x1, y1 + offsetY);
        ctx.closePath();
        ctx.fill();

        if (showHandles) { drawHandle(x1, y1); drawHandle(x2, y2); drawHandle(x3, y3); }

      } else if (d.type === 'fib') {
        const g = computeFib(d, isPreview);
        if (!g) { ctx.restore(); return; }
        drawFib(g);
        if (showHandles) { drawHandle(g.x1, g.y1); drawHandle(g.x2, g.y2); }

      } else if (d.type === 'fibextension') {
        const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
        const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
        const x3 = pointToX(d.p3), y3 = priceToY(d.p3.price);
        if ([x1, y1, x2, y2, x3, y3].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        const diff = d.p2.price - d.p1.price;
        const levels = [0, 0.382, 0.618, 1, 1.272, 1.618, 2.0, 2.618];
        const spanStart = Math.min(x1, x2, x3);
        const spanEnd = Math.max(x1, x2, x3) + Math.abs(x2 - x1) * 0.6 + 30;

        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = isPreview ? 'rgba(242, 163, 57, 0.4)' : 'rgba(124, 132, 150, 0.5)';
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
        ctx.stroke();
        ctx.setLineDash([]);

        levels.forEach((lvl) => {
          const price = d.p3.price + lvl * diff;
          const y = priceToY(price);
          if (y === null || y === undefined) return;
          ctx.strokeStyle = isPreview ? 'rgba(242, 163, 57, 0.4)' : (lvl === 1 ? 'rgba(242, 163, 57, 0.9)' : 'rgba(124, 132, 150, 0.8)');
          ctx.beginPath();
          ctx.moveTo(spanStart, y);
          ctx.lineTo(spanEnd, y);
          ctx.stroke();
          ctx.fillStyle = isPreview ? 'rgba(242, 163, 57, 0.6)' : '#7c8496';
          ctx.font = '10px sans-serif';
          ctx.fillText(`${lvl.toFixed(3)} (${formatPrice(price)})`, spanEnd + 4, y + 3);
        });
        if (showHandles) { drawHandle(x1, y1); drawHandle(x2, y2); drawHandle(x3, y3); }

      } else if (d.type === 'long' || d.type === 'short') {
        const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
        const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        const rr = d.rr || 2;
        const entryPrice = d.p1.price;
        const stopPrice = d.p2.price;
        const risk = d.type === 'long' ? entryPrice - stopPrice : stopPrice - entryPrice;
        const targetPrice = d.type === 'long' ? entryPrice + risk * rr : entryPrice - risk * rr;

        const yEntry = y1;
        const yStop = y2;
        const yTarget = priceToY(targetPrice);

        const rx = Math.min(x1, x2), rw = Math.abs(x2 - x1) || 60;

        ctx.setLineDash([]);
        if (yTarget !== null && yTarget !== undefined) {
          ctx.fillStyle = 'rgba(34, 201, 160, 0.16)';
          ctx.fillRect(rx, Math.min(yEntry, yTarget), rw, Math.abs(yTarget - yEntry));
        }
        ctx.fillStyle = 'rgba(255, 90, 103, 0.16)';
        ctx.fillRect(rx, Math.min(yEntry, yStop), rw, Math.abs(yStop - yEntry));

        ctx.strokeStyle = baseColor;
        ctx.beginPath(); ctx.moveTo(rx, yEntry); ctx.lineTo(rx + rw, yEntry); ctx.stroke();
        ctx.strokeStyle = '#ff5a67';
        ctx.beginPath(); ctx.moveTo(rx, yStop); ctx.lineTo(rx + rw, yStop); ctx.stroke();
        if (yTarget !== null && yTarget !== undefined) {
          ctx.strokeStyle = '#22c9a0';
          ctx.beginPath(); ctx.moveTo(rx, yTarget); ctx.lineTo(rx + rw, yTarget); ctx.stroke();
        }

        ctx.font = '10px sans-serif';
        ctx.fillStyle = baseColor;
        ctx.fillText(`${d.type === 'long' ? 'LONG' : 'SHORT'} · Vào ${formatPrice(entryPrice)}`, rx + 4, yEntry - 4);
        ctx.fillStyle = '#ff5a67';
        ctx.fillText(`SL ${formatPrice(stopPrice)}`, rx + 4, yStop + 12);
        if (yTarget !== null && yTarget !== undefined) {
          ctx.fillStyle = '#22c9a0';
          ctx.fillText(`TP ${formatPrice(targetPrice)} (R:R 1:${rr})`, rx + 4, yTarget - 4);
        }
        const showHandles = isSelected || (isHovered && !isCoarsePointer() && !drawings[idx].locked);
        if (showHandles) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'text') {
        const x = pointToX(d.p);
        const y = priceToY(d.p.price);
        if (x === null || y === null || x === undefined || y === undefined) { ctx.restore(); return; }

        const fontSize = 13;
        ctx.font = `500 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textBaseline = 'alphabetic';

        const fillColor = d.color || getThemeTextColor();
        const haloColor = getThemeHaloColor();

        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeStyle = haloColor;
        ctx.lineWidth = 3;
        ctx.strokeText(d.text, x, y);

        ctx.fillStyle = fillColor;
        ctx.fillText(d.text, x, y);

        if (isSelected) {
          const textWidth = ctx.measureText(d.text).width;
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(x - 4, y - fontSize - 2, textWidth + 8, fontSize + 8);
          ctx.setLineDash([]);
        }
        const showHandles = isSelected || (isHovered && !isCoarsePointer() && !drawings[idx].locked);
        if (showHandles) drawHandle(x, y);
      }
      ctx.restore();
    }

    function drawCrosshair() {
      if (!hoverPoint || currentTool === 'cursor') return;
      const { width, height } = getRect();
      const { x, y, price } = hoverPoint;

      ctx.save();
      ctx.strokeStyle = 'rgba(120, 123, 134, 0.65)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      
            if (hoverPoint.snapped) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(41, 98, 255, 0.25)';
        ctx.fill();
        ctx.strokeStyle = '#2962ff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      if (touchRawPoint) {
        ctx.strokeStyle = 'rgba(242, 163, 57, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(touchRawPoint.x, touchRawPoint.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(touchRawPoint.x, touchRawPoint.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(242, 163, 57, 0.7)';
        ctx.fill();
      }
      
            if (touchCursor) {
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, 2 * Math.PI);
        ctx.strokeStyle = '#f2a339';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, 2 * Math.PI);
        ctx.fillStyle = '#f2a339';
        ctx.fill();

        const hint = pendingThirdPoint ? 'Chạm để chốt điểm thứ 3'
          : touchAnchors.length === 1 ? 'Chạm để chốt điểm cuối'
          : 'Kéo để di chuyển · Chạm để đặt điểm';
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#f2a339';
        ctx.textAlign = 'center';
        ctx.fillText(hint, width / 2, 16);
        ctx.textAlign = 'start';
      }
      
      if (price !== null && price !== undefined && !Number.isNaN(price)) {
        const label = formatPrice(price);
        ctx.font = '10px sans-serif';
        const textWidth = ctx.measureText(label).width;
        const boxW = textWidth + 8;
        const boxH = 16;
        const boxY = Math.min(Math.max(y - boxH / 2, 0), height - boxH);

        ctx.fillStyle = '#f2a339';
        ctx.fillRect(width - boxW, boxY, boxW, boxH);
        ctx.fillStyle = '#0a0e14';
        ctx.fillText(label, width - boxW + 4, boxY + 11);
      }

      if (pendingThirdPoint) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#f2a339';
        ctx.fillText('Chạm/bấm để chốt điểm neo thứ 3', Math.min(x + 10, width - 160), Math.max(y - 12, 12));
      }

      ctx.restore();
    }

        // Giữ Ctrl/⌘ = đảo trạng thái nam châm tạm thời (tắt -> yếu, bật -> tắt)
    function effectiveMagnet(e) {
      const m = getMagnetMode();
      if (e && (e.ctrlKey || e.metaKey)) return m === 'off' ? 'weak' : 'off';
      return m;
    }

    // Tìm giá O/H/L/C gần con trỏ nhất của cây nến đang trỏ tới
    function snapToOHLC(x, y, mode) {
      const c = candleList();
      const n = c.length;
      if (!n) return null;
      const lg = chart.timeScale().coordinateToLogical(x);
      if (lg === null || lg === undefined) return null;
      const i = Math.round(lg);
      if (i < 0 || i > n - 1) return null;          // vùng tương lai/quá khứ: không có nến để hít
      const k = c[i];
      let best = null, bestD = Infinity;
      [k.open, k.high, k.low, k.close].forEach((p) => {
        const py = priceToY(p);
        if (py === null || py === undefined) return;
        const dd = Math.abs(py - y);
        if (dd < bestD) { bestD = dd; best = p; }
      });
      if (best === null) return null;
      if (mode === 'weak' && bestD > MAGNET_WEAK_PX) return null;
      return { price: best };
    }

    // Từ toạ độ màn hình -> toạ độ/giá sau khi áp nam châm
    function resolveMagnet(x, y, mode) {
      const out = { x, y, price: yToPrice(y), snapped: false };
      if (mode === 'off') return out;
      // Trục thời gian: luôn dính vào giữa nến
      const info = xToPointInfo(x);
      if (info.time !== null && info.time !== undefined) {
        const px = pointToX({ time: info.time });
        if (px !== null && px !== undefined) out.x = px;
      }
      // Trục giá: hít vào O/H/L/C
      const m = snapToOHLC(x, y, mode);
      if (m) {
        out.price = m.price;
        const py = priceToY(m.price);
        if (py !== null && py !== undefined) out.y = py;
        out.snapped = true;
      }
      return out;
    }

    function pointFromEvent(e, useMagnet) {
      const { x, y } = getScreenXY(e);
      const r = resolveMagnet(x, y, useMagnet ? effectiveMagnet(e) : 'off');
      const info = xToPointInfo(r.x);
      return { logicalIndex: info.logicalIndex, time: info.time, price: r.price };
    }

    function distToSegment(xp, yp, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (dx === 0 && dy === 0) return Math.hypot(xp - x1, yp - y1);
      const t = ((xp - x1) * dx + (yp - y1) * dy) / (dx * dx + dy * dy);
      const clampedT = Math.max(0, Math.min(1, t));
      return Math.hypot(xp - (x1 + clampedT * dx), yp - (y1 + clampedT * dy));
    }

    function boundsHit(x, y, xs, ys, margin) {
      const rx = Math.min(...xs) - margin, ry = Math.min(...ys) - margin;
      const rw = Math.max(...xs) - Math.min(...xs) + margin * 2;
      const rh = Math.max(...ys) - Math.min(...ys) + margin * 2;
      return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
    }
        const handleHitR = () => (isCoarsePointer() ? 24 : HANDLE_RADIUS + 6);
    const hitTol = () => (isCoarsePointer() ? 9 : 6);
    // ===================== HIT TEST =====================
    function outlineHit(d, x, y) {
      const tol = hitTol();
      const P = (p) => ({ x: pointToX(p), y: priceToY(p.price) });
      const valid = (...ps) => ps.every((p) => p.x !== null && p.x !== undefined && p.y !== null && p.y !== undefined);
      const near = (a, b) => distToSegment(x, y, a.x, a.y, b.x, b.y) <= tol;
 
      if (d.type === 'rectangle') {
        const a = P(d.p1);
        const b = P(d.p2);
        if (!valid(a, b)) return false;
        const l = Math.min(a.x, b.x), r = Math.max(a.x, b.x);
        const t = Math.min(a.y, b.y), bt = Math.max(a.y, b.y);
        return near({ x: l, y: t }, { x: r, y: t }) || near({ x: r, y: t }, { x: r, y: bt }) ||
               near({ x: r, y: bt }, { x: l, y: bt }) || near({ x: l, y: bt }, { x: l, y: t });
      }
      if (d.type === 'circle') {
        const a = P(d.p1);
        const b = P(d.p2);
        if (!valid(a, b)) return false;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
        if (rx < 1 || ry < 1) return Math.hypot(x - cx, y - cy) <= tol + Math.max(rx, ry);
        const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
        return Math.abs(k - 1) * Math.min(rx, ry) <= tol;
      }
      if (d.type === 'triangle') {
        const a = P(d.p1), b = P(d.p2), c = P(d.p3);
        if (!valid(a, b, c)) return false;
        return near(a, b) || near(b, c) || near(c, a);
      }
      if (d.type === 'channel') {
        const a = P(d.p1), b = P(d.p2), c = P(d.p3);
        if (!valid(a, b, c)) return false;
        const lineYAt = (px) => (b.x === a.x ? a.y : a.y + ((px - a.x) / (b.x - a.x)) * (b.y - a.y));
        const off = c.y - lineYAt(c.x);
        return near(a, b) || near({ x: a.x, y: a.y + off }, { x: b.x, y: b.y + off });
      }
      return false;
    }
 
    function findHandleAt(pt) {
      if (allDrawingsHidden || selectedDrawingIndex === null) return null;
      const d = drawings[selectedDrawingIndex];
      if (!d || d.locked) return null;

      const clickX = pointToX(pt);
      const clickY = priceToY(pt.price);
      if (clickX === null || clickY === null) return null;

      const checkHandle = (p) => {
        if (!p) return false;
        const hx = pointToX(p);
        const hy = priceToY(p.price);
        if (hx === null || hy === null) return false;
        return Math.hypot(clickX - hx, clickY - hy) <= handleHitR();
      };

      if (d.type === 'hline') {
        const hy = priceToY(d.price);
        if (hy !== null && Math.hypot(clickX - getRect().width / 2, clickY - hy) <= handleHitR()) return 'price';
      } else if (d.type === 'vline') {
        const hx = pointToX(d);
        if (hx !== null && Math.hypot(clickX - hx, clickY - getRect().height / 2) <= handleHitR()) return 'time';
      } else if (d.type === 'hray' || d.type === 'text') {
        if (checkHandle(d.p)) return 'p';
      } else if (d.p3) {
        if (checkHandle(d.p1)) return 'p1';
        if (checkHandle(d.p2)) return 'p2';
        if (checkHandle(d.p3)) return 'p3';
      } else if (d.p1 && d.p2) {
        if (checkHandle(d.p1)) return 'p1';
        if (checkHandle(d.p2)) return 'p2';
      }
      return null;
    }

    function findDrawingAt(pt) {
      if (allDrawingsHidden) return null;
      const x = pointToX(pt);
      const y = priceToY(pt.price);
      if (x === null || y === null) return null;

      for (let i = drawings.length - 1; i >= 0; i--) {
        const d = drawings[i];
        if (!isVisibleNow(d)) continue;
 
        // Hình đã tắt nền: chỉ chọn được khi chạm trúng ĐƯỜNG BAO, không chọn khi chạm vào bên trong
        if (d.fill === false && ['rectangle', 'circle', 'triangle', 'channel'].includes(d.type)) {
          if (outlineHit(d, x, y)) return { index: i };
          continue;
        }

        if (d.type === 'hline') {
          const dy = priceToY(d.price);
          if (dy !== null && Math.abs(dy - y) < hitTol()) return { index: i };

        } else if (d.type === 'vline') {
          const dx_ = pointToX(d);
          if (dx_ !== null && Math.abs(dx_ - x) < hitTol()) return { index: i };

        } else if (d.type === 'hray') {
          const px = pointToX(d.p), py = priceToY(d.p.price);
          if (px !== null && py !== null && Math.abs(py - y) < hitTol() && x >= px - hitTol()) return { index: i };

        } else if (d.type === 'trendline' || d.type === 'ray' || d.type === 'extendedline' || d.type === 'arrow') {
          const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
          const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
          if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
            let sx = x1, sy = y1, ex = x2, ey = y2;
            if (d.type === 'ray') { const e_ = extendPointBeyond(x1, y1, x2, y2, EXTEND_FACTOR); ex = e_.x; ey = e_.y; }
            if (d.type === 'extendedline') {
              const a = extendPointBeyond(x2, y2, x1, y1, EXTEND_FACTOR);
              const b = extendPointBeyond(x1, y1, x2, y2, EXTEND_FACTOR);
              sx = a.x; sy = a.y; ex = b.x; ey = b.y;
            }
            if (distToSegment(x, y, sx, sy, ex, ey) < hitTol()) return { index: i };
          }

                } else if (d.type === 'fib') {
          const g = computeFib(d, false);
          if (g) {
            const tol = hitTol();
            let hit = false;
            // 1. Các đường mức (chỉ trong khoảng ngang của hình)
            if (x >= g.xl - tol && x <= g.xr + tol) {
              hit = g.rows.some((r) => Math.abs(r.y - y) <= tol);
            }
            // 2. Đường xu hướng nối 2 điểm neo
            if (!hit && g.cfg.showTrendline) {
              hit = distToSegment(x, y, g.x1, g.y1, g.x2, g.y2) <= tol;
            }
            if (hit) return { index: i };
          }

        } else if (d.type === 'rectangle' || d.type === 'circle' || d.type === 'long' || d.type === 'short') {
          const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
          const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
          if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
            if (boundsHit(x, y, [x1, x2], [y1, y2], 8)) return { index: i };
          }

        } else if (d.type === 'triangle' || d.type === 'channel' || d.type === 'fibextension') {
          const pts = [d.p1, d.p2, d.p3].map((p) => ({ x: pointToX(p), y: priceToY(p.price) }));
          if (pts.every((p) => p.x !== null && p.y !== null)) {
            if (boundsHit(x, y, pts.map((p) => p.x), pts.map((p) => p.y), 8)) return { index: i };
          }

        } else if (d.type === 'text') {
          const tx = pointToX(d.p), ty = priceToY(d.p.price);
          if (tx !== null && ty !== null) {
            ctx.font = '500 13px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const w = ctx.measureText(d.text).width;
            const margin = 6;
            if (x >= tx - margin && x <= tx + w + margin && y >= ty - 13 - margin && y <= ty + margin) return { index: i };
          }
        }
      }
      return null;
    }

    // ===================== FLOATING TOOLBAR (giống TradingView: giữa-trên chart, kéo được) =====================
    let toolbarPos = null; // {left, top} sau khi người dùng kéo

    function hideToolbar() {
      if (toolbarEl) {
        toolbarEl.remove();
        toolbarEl = null;
      }
    }

    function placeToolbar() {
      if (!toolbarEl || !toolbarPos) return;
      toolbarEl.style.left = toolbarPos.left + 'px';
      toolbarEl.style.top = toolbarPos.top + 'px';
      toolbarEl.style.transform = 'none';
    }

    // Toolbar cố định một chỗ (như TradingView) nên không cần đổi vị trí theo hình
    function repositionToolbarOnly() {}

    function makeToolbarBtn(iconSvg, title, onClick, active) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dtv-tb-btn' + (active ? ' active' : '');
      btn.title = title;
      btn.innerHTML = iconSvg;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(btn);
      });
      return btn;
    }

    function makeToolbarSep() {
      const s = document.createElement('div');
      s.className = 'dtv-tb-sep';
      return s;
    }

    function cloneDrawing(idx) {
      const src = drawings[idx];
      if (!src) return;
      const c = clone(src);
      delete c.locked;
      const shift = (p) => {
        const x = pointToX(p), y = priceToY(p.price);
        if (x === null || y === null || x === undefined || y === undefined) return p;
        const i = xToPointInfo(x + 20);
        return { logicalIndex: i.logicalIndex, time: i.time, price: yToPrice(y + 20) };
      };
      if (c.type === 'hline') {
        const y = priceToY(c.price);
        if (y !== null && y !== undefined) c.price = yToPrice(y + 20);
      } else if (c.type === 'vline') {
        const x = pointToX(c);
        if (x !== null && x !== undefined) { const i = xToPointInfo(x + 20); c.logicalIndex = i.logicalIndex; c.time = i.time; }
      } else if (c.p) {
        c.p = shift(c.p);
      } else {
        ['p1', 'p2', 'p3'].forEach((k) => { if (c[k]) c[k] = shift(c[k]); });
      }
      drawings.push(c);
      selectedDrawingIndex = drawings.length - 1;
      showToolbar(selectedDrawingIndex);
      redraw();
    }

    function openBoxTextEditor(idx) {
      const d = drawings[idx];
      if (!d || d.type !== 'rectangle') return;
      const x1 = pointToX(d.p1), y1 = priceToY(d.p1.price);
      const x2 = pointToX(d.p2), y2 = priceToY(d.p2.price);
      if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) return;
      hideToolbar();
 
      const input = document.createElement('input');
      input.type = 'text';
      input.value = d.text || '';
      input.placeholder = 'Nhập chữ trong hình...';
      input.style.position = 'absolute';
      input.style.left = `${Math.max(4, (x1 + x2) / 2 - 90)}px`;
      input.style.top = `${Math.max(4, (y1 + y2) / 2 - 14)}px`;
      input.style.width = '180px';
      input.style.background = '#1e222d';
      input.style.color = '#ffffff';
      input.style.border = '1px solid #f2a339';
      input.style.borderRadius = '4px';
      input.style.padding = '4px 8px';
      input.style.fontSize = '12px';
      input.style.zIndex = '9999';
      container.appendChild(input);
      setTimeout(() => { input.focus(); input.select(); }, 50);
 
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        if (save) {
          const v = input.value;
          if (v.trim()) d.text = v; else delete d.text;
        }
        input.remove();
        if (drawings[idx] === d) {
          selectedDrawingIndex = idx;
          showToolbar(idx);
        }
        redraw();
        if (save) rememberStyle(d);
      };
 
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') finish(true);
        if (ev.key === 'Escape') finish(false);
      });
      ['pointerdown', 'mousedown', 'click'].forEach((evt) => input.addEventListener(evt, (ev) => ev.stopPropagation()));
      input.addEventListener('blur', () => finish(true));
    }
 
    function showToolbar(idx) {
      hideToolbar();
      const d = drawings[idx];
      if (!d) return;

      toolbarEl = document.createElement('div');
      toolbarEl.className = 'dtv-tb';
      ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu'].forEach((ev) =>
        toolbarEl.addEventListener(ev, (e) => e.stopPropagation())
      );

      // Tay nắm để kéo toolbar
      const grip = document.createElement('div');
      grip.className = 'dtv-tb-grip';
      grip.title = 'Kéo để di chuyển';
      grip.innerHTML = ICON.grip;
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const tr = toolbarEl.getBoundingClientRect();
        const cr = container.getBoundingClientRect();
        const offX = e.clientX - tr.left, offY = e.clientY - tr.top;
        const move = (ev) => {
          const w = toolbarEl ? toolbarEl.offsetWidth : 0;
          toolbarPos = {
            left: Math.max(0, Math.min(ev.clientX - cr.left - offX, cr.width - w)),
            top: Math.max(0, Math.min(ev.clientY - cr.top - offY, cr.height - 40)),
          };
          placeToolbar();
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
      toolbarEl.appendChild(grip);
      toolbarEl.appendChild(makeToolbarSep());

      // Màu nét (Fib dùng màu riêng từng mức nên không hiện)
      if (d.type !== 'fib') {
        const colorWrap = document.createElement('label');
        colorWrap.className = 'dtv-tb-color';
        colorWrap.title = 'Màu';
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = hex6(d.color, '#f2a339');
        colorInput.addEventListener('input', () => { d.color = colorInput.value; redraw(); });
        colorInput.addEventListener('change', () => { d.color = colorInput.value; rememberStyle(d); });
        colorWrap.appendChild(colorInput);
        toolbarEl.appendChild(colorWrap);
      }

      // Độ dày nét
      if (d.type !== 'text') {
        const isFibT = d.type === 'fib';
        const cur = isFibT ? d.levelsWidth || 1 : d.width || 1.5;
        const widths = [1, 1.5, 2, 3, 4];
        if (!widths.includes(cur)) widths.push(cur);
        const sel = document.createElement('select');
        sel.className = 'dtv-tb-select';
        sel.title = 'Độ dày nét';
        widths.sort((a, b) => a - b).forEach((w) => {
          const o = document.createElement('option');
          o.value = w;
          o.textContent = w + 'px';
          if (w === cur) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => {
          const v = parseFloat(sel.value);
          if (isFibT) d.levelsWidth = v; else d.width = v;
          redraw();
          rememberStyle(d);
        });
        toolbarEl.appendChild(sel);
      }

      // Nét liền / nét đứt
      if (DASHED_STYLE_TOOLS.includes(d.type)) {
        const dashedNow = () => (d.type === 'hline' || d.type === 'vline' || d.type === 'hray' ? d.dashed !== false : !!d.dashed);
        toolbarEl.appendChild(
          makeToolbarBtn(dashedNow() ? ICON.dashed : ICON.solid, 'Nét liền / nét đứt', (btn) => {
            d.dashed = !dashedNow();
            btn.innerHTML = dashedNow() ? ICON.dashed : ICON.solid;
            redraw();
            rememberStyle(d);
          })
        );
      }

      toolbarEl.appendChild(makeToolbarSep());

 
      // Bật / tắt nền (khi tắt chỉ còn đường bao quanh)
      if (FILL_TOOLS.includes(d.type)) {
        toolbarEl.appendChild(
          makeToolbarBtn(ICON.fill, 'Bật / tắt nền', (btn) => {
            d.fill = d.fill === false;
            btn.classList.toggle('active', d.fill !== false);
            redraw();
            rememberStyle(d);
          }, d.fill !== false)
        );
      }
 
      // Viết chữ trong hình chữ nhật
      if (d.type === 'rectangle') {
        toolbarEl.appendChild(makeToolbarBtn(ICON.textT, 'Viết chữ trong hình', () => openBoxTextEditor(idx), !!d.text));
      }
 
      // Cài đặt chi tiết (bánh răng)
      toolbarEl.appendChild(makeToolbarBtn(ICON.gear, 'Cài đặt chi tiết', () => openSettingsModal(idx)));
      toolbarEl.appendChild(makeToolbarBtn(ICON.copy, 'Nhân bản', () => cloneDrawing(idx)));
      toolbarEl.appendChild(
        makeToolbarBtn(d.locked ? ICON.lock : ICON.unlock, d.locked ? 'Mở khoá' : 'Khoá vị trí', () => {
          d.locked = !d.locked;
          showToolbar(idx);
        }, !!d.locked)
      );
      toolbarEl.appendChild(
        makeToolbarBtn(ICON.trash, 'Xoá', () => {
          drawings.splice(idx, 1);
          selectedDrawingIndex = null;
          hideToolbar();
          redraw();
        })
      );

      container.appendChild(toolbarEl);
      placeToolbar();
    }

    // ===================== MODAL CÀI ĐẶT (Style / Coordinates / Visibility) =====================
    function getAnchorDefs(d) {
      if (d.type === 'hline') return [{ key: 'self', label: 'Giá', price: true }];
      if (d.type === 'vline') return [{ key: 'self', label: 'Thanh nến', bar: true }];
      if (d.type === 'hray' || d.type === 'text') return [{ key: 'p', label: 'Điểm', price: true, bar: true }];
      if (d.type === 'long' || d.type === 'short') {
        return [
          { key: 'p1', label: 'Vào lệnh', price: true, bar: true },
          { key: 'p2', label: 'Dừng lỗ', price: true, bar: true },
        ];
      }
      if (d.p3) {
        return [
          { key: 'p1', label: 'Điểm 1', price: true, bar: true },
          { key: 'p2', label: 'Điểm 2', price: true, bar: true },
          { key: 'p3', label: 'Điểm 3', price: true, bar: true },
        ];
      }
      if (d.p1 && d.p2) {
        return [
          { key: 'p1', label: 'Điểm 1', price: true, bar: true },
          { key: 'p2', label: 'Điểm 2', price: true, bar: true },
        ];
      }
      return [];
    }

    function renderFibStyleHTML(cfg) {
      const levelItems = (cfg.levels || [])
        .map(
          (l) => `
        <div class="dtv-fib-item">
          <input type="checkbox" class="fib-chk" ${l.enabled ? 'checked' : ''}>
          <input type="number" step="any" class="fib-val" value="${esc(l.level)}">
          <input type="color" class="fib-col" value="${hex6(l.color, '#787b86')}">
        </div>`
        )
        .join('');

      return `
        <div class="dtv-modal-row">
          <label class="dtv-check"><input type="checkbox" id="fTrend" ${cfg.showTrendline ? 'checked' : ''}><span>Trend line</span></label>
          <div class="dtv-ctrls">
            <input type="color" id="fTrendColor" class="dtv-color" value="${hex6(cfg.trendColor, '#787b86')}">
            ${selectHTML('fTrendStyle', LINE_STYLES, cfg.trendStyle)}
          </div>
        </div>
        <div class="dtv-modal-row">
          <span>Levels line</span>
          <div class="dtv-ctrls">
            ${selectHTML('fLevelsWidth', [[1, '1px'], [1.5, '1.5px'], [2, '2px'], [3, '3px']], cfg.levelsWidth)}
            ${selectHTML('fLevelsStyle', LINE_STYLES, cfg.levelsStyle)}
          </div>
        </div>
        <div class="dtv-modal-row">
          <span>Extend</span>
          <div class="dtv-ctrls">
            ${selectHTML('fExtend', [['none', "Don't extend"], ['left', 'Extend left'], ['right', 'Extend right'], ['both', 'Extend both']], cfg.extend)}
          </div>
        </div>
        <div class="dtv-modal-sep"></div>
        <div class="dtv-modal-grid-2">${levelItems}</div>
        <div class="dtv-modal-sep"></div>
        <div class="dtv-modal-row">
          <span>Use one color</span>
          <div class="dtv-ctrls"><input type="color" id="fOneColor" class="dtv-color" value="#2962ff"></div>
        </div>
        <div class="dtv-modal-row">
          <label class="dtv-check"><input type="checkbox" id="fBg" ${cfg.bg ? 'checked' : ''}><span>Background</span></label>
          <div class="dtv-ctrls">
            <input type="range" id="fBgOpacity" class="dtv-range" min="0" max="100" value="${Math.round(cfg.bgOpacity * 100)}">
          </div>
        </div>
        <div class="dtv-modal-row">
          <label class="dtv-check"><input type="checkbox" id="fReverse" ${cfg.reverse ? 'checked' : ''}><span>Reverse</span></label>
        </div>
        <div class="dtv-modal-row">
          <label class="dtv-check"><input type="checkbox" id="fPrices" ${cfg.showPrices ? 'checked' : ''}><span>Prices</span></label>
        </div>
        <div class="dtv-modal-row">
          <label class="dtv-check"><input type="checkbox" id="fLevels" ${cfg.showLevels ? 'checked' : ''}><span>Levels</span></label>
          <div class="dtv-ctrls">${selectHTML('fLevelsMode', [['values', 'Values'], ['percents', 'Percents']], cfg.levelsMode)}</div>
        </div>
        <div class="dtv-modal-row">
          <span>Labels</span>
          <div class="dtv-ctrls">
            ${selectHTML('fLabelH', [['left', 'Left'], ['right', 'Right']], cfg.labelH)}
            ${selectHTML('fLabelV', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], cfg.labelV)}
          </div>
        </div>
        <div class="dtv-modal-row">
          <label class="dtv-check"><input type="checkbox" id="fShowText" ${cfg.showText ? 'checked' : ''}><span>Text</span></label>
          <div class="dtv-ctrls">
            <input type="text" id="fText" class="dtv-input" style="width:120px" value="${esc(cfg.text)}" placeholder="Nội dung...">
          </div>
        </div>
        <div class="dtv-modal-row">
          <span></span>
          <div class="dtv-ctrls">
            ${selectHTML('fTextH', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], cfg.textH)}
            ${selectHTML('fTextV', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], cfg.textV)}
          </div>
        </div>
        <div class="dtv-modal-row">
          <span>Font size</span>
          <div class="dtv-ctrls">${selectHTML('fFontSize', [8, 9, 10, 11, 12, 14, 16, 20].map((n) => [n, n]), cfg.fontSize)}</div>
        </div>
      `;
    }

    function renderGeneralStyleHTML(d) {
      const opacityPct = Math.round((d.opacity === undefined ? 1 : d.opacity) * 100);
      let html = '';

      if (d.type === 'text') {
        html += `
          <div class="dtv-modal-row">
            <span>Nội dung</span>
            <input type="text" id="gText" class="dtv-input" style="width:220px" value="${esc(d.text)}">
          </div>`;
      }

      html += `
        <div class="dtv-modal-row">
          <span>Màu sắc</span>
          <div class="dtv-ctrls"><input type="color" id="gColor" class="dtv-color" value="${hex6(d.color, '#f2a339')}"></div>
        </div>
        <div class="dtv-modal-row">
          <span>Độ mờ</span>
          <div class="dtv-ctrls"><input type="range" id="gOpacity" class="dtv-range" min="10" max="100" value="${opacityPct}"></div>
        </div>`;

      if (d.type !== 'text') {
        html += `
        <div class="dtv-modal-row">
          <span>Độ dày</span>
          <div class="dtv-ctrls">${selectHTML('gWidth', [[1, '1px'], [1.5, '1.5px'], [2.5, '2.5px'], [4, '4px']], d.width || 1.5)}</div>
        </div>`;
      }

      if (DASHED_STYLE_TOOLS.includes(d.type)) {
        const isDashed = d.type === 'hline' || d.type === 'vline' || d.type === 'hray' ? d.dashed !== false : !!d.dashed;
        html += `
        <div class="dtv-modal-row">
          <span>Kiểu nét</span>
          <div class="dtv-ctrls">${selectHTML('gDash', [['solid', 'Nét liền'], ['dashed', 'Nét đứt']], isDashed ? 'dashed' : 'solid')}</div>
        </div>`;
      }
      if (FILL_TOOLS.includes(d.type)) {
        html += `
        <div class="dtv-modal-row">
          <label class="dtv-check"><input type="checkbox" id="gFill" ${d.fill !== false ? 'checked' : ''}><span>Tô nền bên trong hình (tắt = chỉ còn đường bao)</span></label>
        </div>`;
      }
 
      if (d.type === 'rectangle') {
        html += `
        <div class="dtv-modal-sep"></div>
        <div class="dtv-modal-row"><span>Chữ trong hình</span></div>
        <textarea id="gBoxText" class="dtv-input" placeholder="Nhập chữ...">${esc(d.text || '')}</textarea>
        <div class="dtv-modal-row">
          <span>Màu chữ</span>
          <div class="dtv-ctrls"><input type="color" id="gBoxColor" class="dtv-color" value="${hex6(d.textColor || d.color, '#f2a339')}"></div>
        </div>
        <div class="dtv-modal-row">
          <span>Cỡ chữ</span>
          <div class="dtv-ctrls">
            ${selectHTML('gBoxSize', [10, 11, 12, 14, 16, 18, 20, 24, 32].map((n) => [n, n]), d.fontSize || 12)}
            <label class="dtv-check"><input type="checkbox" id="gBoxBold" ${d.bold ? 'checked' : ''}><span><b>B</b></span></label>
            <label class="dtv-check"><input type="checkbox" id="gBoxItalic" ${d.italic ? 'checked' : ''}><span><i>I</i></span></label>
          </div>
        </div>
        <div class="dtv-modal-row">
          <span>Căn chữ</span>
          <div class="dtv-ctrls">
            ${selectHTML('gBoxH', [['left', 'Trái'], ['center', 'Giữa'], ['right', 'Phải']], d.textH || 'center')}
            ${selectHTML('gBoxV', [['top', 'Trên'], ['middle', 'Giữa'], ['bottom', 'Dưới']], d.textV || 'middle')}
          </div>
        </div>`;
      }
 
      return html;
    }

    function renderCoordinatesHTML(d) {
      const defs = getAnchorDefs(d);
      let html = defs
        .map((a) => {
          const target = a.key === 'self' ? d : d[a.key];
          if (!target) return '';
          const lg = target.time !== undefined && target.time !== null ? timeToLogical(target.time) : null;
const bar = lg !== null ? Math.round(lg * 100) / 100 : '';
          return `
          <div class="dtv-modal-row">
            <span>${a.label}</span>
            <div class="dtv-ctrls">
              ${a.price ? `<label class="dtv-mini">Giá <input type="number" step="any" class="dtv-input coord" data-key="${a.key}" data-field="price" value="${esc(target.price)}"></label>` : ''}
              ${a.bar ? `<label class="dtv-mini">Nến <input type="number" step="any" class="dtv-input coord" data-key="${a.key}" data-field="logicalIndex" value="${esc(bar)}"></label>` : ''}
            </div>
          </div>`;
        })
        .join('');

      if (d.type === 'long' || d.type === 'short') {
        html += `
          <div class="dtv-modal-row">
            <span>Tỷ lệ R:R</span>
            <div class="dtv-ctrls"><label class="dtv-mini">1 : <input type="number" step="any" min="0.1" id="coordRR" class="dtv-input" value="${esc(d.rr || 2)}"></label></div>
          </div>`;
      }
      return html || '<div class="dtv-modal-row"><span>Hình này không có toạ độ để chỉnh.</span></div>';
    }

    function renderVisibilityHTML(d) {
      if (!Array.isArray(timeframes) || typeof getTimeframe !== 'function') {
        return '<div class="dtv-modal-row"><span>Hình vẽ hiển thị trên mọi khung thời gian.</span></div>';
      }
      const active = Array.isArray(d.tfs) ? d.tfs : timeframes;
      return timeframes
        .map(
          (tf) => `
        <div class="dtv-modal-row">
          <label class="dtv-check"><input type="checkbox" class="tf-chk" value="${esc(tf)}" ${active.includes(tf) ? 'checked' : ''}><span>${esc(tf)}</span></label>
        </div>`
        )
        .join('');
    }

    function openSettingsModal(idx) {
      const d = drawings[idx];
      if (!d) return;
      hideToolbar();

      const isFib = d.type === 'fib';
      const cfg = isFib ? computeFibCfg(d) : null;

      const backdrop = document.createElement('div');
      backdrop.className = 'dtv-modal-backdrop';
      backdrop.innerHTML = `
        <div class="dtv-modal">
          <div class="dtv-modal-header">
            <span class="dtv-modal-title">${esc(TOOL_DISPLAY_NAMES[d.type] || 'Cài đặt đường vẽ')}</span>
            <button type="button" class="dtv-modal-close">×</button>
          </div>
          <div class="dtv-modal-tabs">
            <button type="button" class="dtv-modal-tab active" data-tab="style">Style</button>
            <button type="button" class="dtv-modal-tab" data-tab="coordinates">Coordinates</button>
            <button type="button" class="dtv-modal-tab" data-tab="visibility">Visibility</button>
          </div>
          <div class="dtv-modal-body">
            <div class="tab-pane" id="pane-style">${isFib ? renderFibStyleHTML(cfg) : renderGeneralStyleHTML(d)}</div>
            <div class="tab-pane" id="pane-coordinates" style="display:none;">${renderCoordinatesHTML(d)}</div>
            <div class="tab-pane" id="pane-visibility" style="display:none;">${renderVisibilityHTML(d)}</div>
          </div>
          <div class="dtv-modal-footer">
            <div>
              ${isFib ? `<select id="fTemplate" class="dtv-select">
                <option value="">Template</option>
                <option value="save">Lưu làm mặc định</option>
                <option value="reset">Đặt lại mặc định</option>
              </select>` : ''}
            </div>
            <div class="dtv-modal-btn-group">
              <button type="button" class="dtv-modal-btn cancel" id="modalCancel">Huỷ</button>
              <button type="button" class="dtv-modal-btn primary" id="modalOk">Ok</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(backdrop);

      const q = (sel) => backdrop.querySelector(sel);
      const qa = (sel) => Array.from(backdrop.querySelectorAll(sel));

      // Tabs
      const tabs = qa('.dtv-modal-tab');
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          tabs.forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');
          qa('.tab-pane').forEach((p) => { p.style.display = 'none'; });
          q(`#pane-${tab.dataset.tab}`).style.display = 'block';
        });
      });

      // Use one color -> đổi toàn bộ màu các mức
      if (isFib) {
        q('#fOneColor').addEventListener('input', (e) => {
          qa('.fib-col').forEach((c) => { c.value = e.target.value; });
        });
      }

      const closeModal = () => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        if (drawings[idx] === d) {
          selectedDrawingIndex = idx;
          showToolbar(idx);
        }
        redraw();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
      };
      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('keydown', (e) => e.stopPropagation());
      backdrop.addEventListener('pointerdown', (e) => e.stopPropagation());
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
      q('.dtv-modal-close').addEventListener('click', closeModal);
      q('#modalCancel').addEventListener('click', closeModal);

      // Gom giá trị của form Fib vào object đích (hình vẽ hoặc template)
      const collectFibInto = (t) => {
        t.showTrendline = q('#fTrend').checked;
        t.trendColor = q('#fTrendColor').value;
        t.trendStyle = q('#fTrendStyle').value;
        t.levelsWidth = parseFloat(q('#fLevelsWidth').value) || 1;
        t.levelsStyle = q('#fLevelsStyle').value;
        t.extend = q('#fExtend').value;
        t.levels = qa('.dtv-fib-item')
          .map((item) => ({
            level: parseFloat(item.querySelector('.fib-val').value),
            color: item.querySelector('.fib-col').value,
            enabled: item.querySelector('.fib-chk').checked,
          }))
          .filter((l) => Number.isFinite(l.level));
        t.bg = q('#fBg').checked;
        t.bgOpacity = parseInt(q('#fBgOpacity').value, 10) / 100;
        t.reverse = q('#fReverse').checked;
        t.showPrices = q('#fPrices').checked;
        t.showLevels = q('#fLevels').checked;
        t.levelsMode = q('#fLevelsMode').value;
        t.labelH = q('#fLabelH').value;
        t.labelV = q('#fLabelV').value;
        t.showText = q('#fShowText').checked;
        t.text = q('#fText').value;
        t.textH = q('#fTextH').value;
        t.textV = q('#fTextV').value;
        t.fontSize = parseInt(q('#fFontSize').value, 10) || 10;
      };

      if (isFib) {
        q('#fTemplate').addEventListener('change', (e) => {
          const action = e.target.value;
          e.target.value = '';
          if (action === 'save') {
            const t = {};
            collectFibInto(t);
            delete t.text; // chữ ghi chú là riêng từng hình
            setToolStyle('fib', t);
          } else if (action === 'reset') {
            resetToolStyles('fib');
            Object.assign(d, clone({ ...FIB_DEFAULTS, levels: DEFAULT_FIB_LEVELS }));
            backdrop.remove();
            document.removeEventListener('keydown', onKey, true);
            redraw();
            openSettingsModal(idx);
          }
        });
      }

      q('#modalOk').addEventListener('click', () => {
        // Style
        if (isFib) {
          collectFibInto(d);
        } else {
          d.color = q('#gColor').value;
          d.opacity = parseInt(q('#gOpacity').value, 10) / 100;
          if (q('#gWidth')) d.width = parseFloat(q('#gWidth').value) || d.width;
          if (q('#gDash')) d.dashed = q('#gDash').value === 'dashed';
          if (q('#gText')) {
            const v = q('#gText').value.trim();
            if (v) d.text = v;
          }
        }

        // Nền + chữ trong hình chữ nhật
        if (q('#gFill')) d.fill = q('#gFill').checked;
        if (q('#gBoxText')) {
          const txt = q('#gBoxText').value;
          if (txt.trim()) d.text = txt; else delete d.text;
          d.fontSize = parseInt(q('#gBoxSize').value, 10) || 12;
          d.bold = q('#gBoxBold').checked;
          d.italic = q('#gBoxItalic').checked;
          d.textH = q('#gBoxH').value;
          d.textV = q('#gBoxV').value;
          const tc = q('#gBoxColor').value;
          if (tc.toLowerCase() === hex6(d.color, '#f2a339').toLowerCase()) delete d.textColor; else d.textColor = tc;
        }
 
        // Coordinates (chỉ ghi đè ô nào người dùng đã sửa)
        qa('.coord').forEach((input) => {
          if (input.value === input.defaultValue) return;
          const v = parseFloat(input.value);
          if (!Number.isFinite(v)) return;
          const target = input.dataset.key === 'self' ? d : d[input.dataset.key];
          if (target) {
  if (input.dataset.field === 'logicalIndex') {
    target.time = logicalToTime(v);
    delete target.logicalIndex;
  } else {
    target[input.dataset.field] = v;
  }
}
        });
        const rrInput = q('#coordRR');
        if (rrInput) {
          const rr = parseFloat(rrInput.value);
          if (Number.isFinite(rr) && rr > 0) d.rr = rr;
        }

        // Visibility theo khung thời gian
        const tfChecks = qa('.tf-chk');
        if (tfChecks.length) {
          const picked = tfChecks.filter((c) => c.checked).map((c) => c.value);
          if (picked.length === tfChecks.length || picked.length === 0) delete d.tfs;
          else d.tfs = picked;
        }

        // Nhớ style này cho các hình mới cùng loại
        rememberStyle(d);
        closeModal();
      });
    }

    // Lấy cấu hình Fib hiện tại của hình (đã điền mặc định cho hình cũ)
    function computeFibCfg(d) {
      return { ...clone({ ...FIB_DEFAULTS, levels: DEFAULT_FIB_LEVELS }), ...clone(d) };
    }

    // ===================== NHẬP GHI CHÚ =====================
    function openTextInputAt(screenXY, pt) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Nhập ghi chú...';
      input.style.position = 'absolute';
      input.style.left = `${screenXY.x}px`;
      input.style.top = `${screenXY.y}px`;
      input.style.background = '#1e222d';
      input.style.color = '#ffffff';
      input.style.border = '1px solid #f2a339';
      input.style.borderRadius = '4px';
      input.style.padding = '4px 8px';
      input.style.fontSize = '12px';
      input.style.zIndex = '9999';

      container.appendChild(input);
      setTimeout(() => { input.focus(); }, 50);

      let submitted = false;
      const submitText = () => {
        if (submitted) return;
        submitted = true;
        const val = input.value.trim();
        if (val) {
          drawings.push(newDrawing('text', { text: val, p: pt }));
          redraw();
        }
        input.remove();
        returnToCursorAfterDraw();
      };

      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') submitText();
        if (ev.key === 'Escape') {
          submitted = true;
          input.remove();
          returnToCursorAfterDraw();
        }
      });

      input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      input.addEventListener('mousedown', (ev) => ev.stopPropagation());
      input.addEventListener('click', (ev) => ev.stopPropagation());
      input.addEventListener('blur', submitText);
    }
    
        // ===================== VẼ CẢM ỨNG KIỂU TRADINGVIEW MOBILE =====================
    const TOUCH_MOVE_THRESHOLD = 8; // px: kéo ít hơn mức này vẫn tính là "chạm"
    let touchCursor = null;         // {x, y} vị trí crosshair (toạ độ canvas)
    let touchAnchors = [];          // các điểm neo đã chốt
    let touchGesture = null;        // thao tác ngón tay đang diễn ra

    const isCoarsePointer = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const isTouchDrawing = (e) => e.pointerType === 'touch' && currentTool !== 'cursor' && currentTool !== 'eraser';
    const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function touchPoint() {
      const r = resolveMagnet(touchCursor.x, touchCursor.y, getMagnetMode());
      const info = xToPointInfo(r.x);
      return { logicalIndex: info.logicalIndex, time: info.time, price: r.price };
    }

    function syncTouchHover() {
      if (!touchCursor) return;
      const r = resolveMagnet(touchCursor.x, touchCursor.y, getMagnetMode());
      hoverPoint = { x: r.x, y: r.y, price: r.price, snapped: r.snapped };
    }

    function resetTouchDrawing() {
      touchCursor = null;
      touchAnchors = [];
      touchGesture = null;
      pendingThirdPoint = null;
    }

    function makeSingleAnchor(tool, pt) {
      if (tool === 'hline') return newDrawing('hline', { price: pt.price }, { dashed: true });
      if (tool === 'vline') return newDrawing('vline', { logicalIndex: pt.logicalIndex, time: pt.time }, { dashed: true });
      return newDrawing('hray', { p: pt }, { dashed: true });
    }

    function updateTouchPreview() {
      previewDrawing = null;
      if (!touchCursor) return;
      const pt = touchPoint();
      if (pt.price === null || pt.price === undefined || Number.isNaN(pt.price)) return;
      if (pendingThirdPoint) {
        previewDrawing = { ...pendingThirdPoint, p3: pt };
      } else if (touchAnchors.length === 1 &&
                 (TWO_ANCHOR_TOOLS.includes(currentTool) || THREE_ANCHOR_TOOLS.includes(currentTool))) {
        previewDrawing = newDrawing(currentTool, { p1: touchAnchors[0], p2: pt });
      } else if (SINGLE_ANCHOR_TOOLS.includes(currentTool)) {
        previewDrawing = makeSingleAnchor(currentTool, pt);
      }
    }

    // Chạm (không kéo) = chốt 1 điểm tại crosshair
    function touchConfirmPoint() {
      const pt = touchPoint();
      if (pt.price === null || pt.price === undefined || Number.isNaN(pt.price)) return;
      const tool = currentTool;

      if (tool === 'alert') {
        if (onAlertRequested) onAlertRequested(pt.price);
        returnToCursorAfterDraw();
        return;
      }
      if (tool === 'text') {
        openTextInputAt({ x: touchCursor.x, y: touchCursor.y }, pt);
        return;
      }
      if (SINGLE_ANCHOR_TOOLS.includes(tool)) {
        drawings.push(makeSingleAnchor(tool, pt));
        previewDrawing = null;
        redraw();
        returnToCursorAfterDraw();
        return;
      }
      // Điểm thứ 3 của tam giác / kênh / fib extension
      if (pendingThirdPoint) {
        drawings.push({ ...pendingThirdPoint, p3: pt });
        pendingThirdPoint = null;
        previewDrawing = null;
        redraw();
        returnToCursorAfterDraw();
        return;
      }
      // Công cụ 2-3 điểm
      if (touchAnchors.length === 0) {
        touchAnchors = [pt];
        return;
      }
      const p1 = touchAnchors[0];
      if (TWO_ANCHOR_TOOLS.includes(tool)) {
        const extra = {};
        if (tool === 'long' || tool === 'short') extra.rr = 2;
        if (tool === 'fib') Object.assign(extra, clone({ ...FIB_DEFAULTS, levels: DEFAULT_FIB_LEVELS }));
        drawings.push(newDrawing(tool, { p1, p2: pt }, { dashed: false, ...extra }));
        previewDrawing = null;
        redraw();
        returnToCursorAfterDraw();
      } else if (THREE_ANCHOR_TOOLS.includes(tool)) {
        pendingThirdPoint = newDrawing(tool, { p1, p2: pt }, { dashed: false });
        touchAnchors = [];
      }
    }

    function touchDown(e) {
      if (!touchCursor) {
        const { width, height } = getRect();
        touchCursor = { x: width / 2, y: height / 2 };
      }
      touchGesture = { sx: e.clientX, sy: e.clientY, cx: touchCursor.x, cy: touchCursor.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    }

    function touchMove(e) {
      if (!touchGesture || !touchCursor) return;
      const dx = e.clientX - touchGesture.sx;
      const dy = e.clientY - touchGesture.sy;
      if (!touchGesture.moved && Math.hypot(dx, dy) < TOUCH_MOVE_THRESHOLD) return;
      touchGesture.moved = true;
      const { width, height } = getRect();
      touchCursor = { x: clampNum(touchGesture.cx + dx, 0, width), y: clampNum(touchGesture.cy + dy, 0, height) };
      syncTouchHover();
      updateTouchPreview();
      redraw();
    }

    function touchUp(e) {
      const g = touchGesture;
      if (g) touchMove(e); // áp vị trí cuối cùng của ngón tay
      touchGesture = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ }
      if (g && !g.moved && touchCursor) touchConfirmPoint();
      updateTouchPreview();
      redraw();
    }
    // ===================== SỰ KIỆN CON TRỎ =====================
    function onPointerDown(e) {
      if (isTouchDrawing(e)) { touchDown(e); return; }      // <-- THÊM
      if (pendingThirdPoint) {
        const pt = pointFromEvent(e, true);
        if (pt.price !== null && pt.price !== undefined) {
          drawings.push({ ...pendingThirdPoint, p3: pt });
          pendingThirdPoint = null;
          previewDrawing = null;
          redraw();
          returnToCursorAfterDraw();
        }
        return;
      }

      const pt = pointFromEvent(e, currentTool !== 'cursor' && currentTool !== 'eraser');

      if (currentTool === 'cursor') {
        const handleName = findHandleAt(pt);
        if (handleName) {
          isDraggingHandle = true;
          draggedHandleName = handleName;
          draggedDrawingIndex = selectedDrawingIndex;
          draggedDrawingOriginal = clone(drawings[selectedDrawingIndex]);
          dragStartPixel = { x: e.clientX, y: e.clientY };
          canvas.setPointerCapture(e.pointerId);
          e.stopPropagation();
          e.preventDefault();
          return;
        }

        const match = findDrawingAt(pt);
        if (match !== null) {
          selectedDrawingIndex = match.index;
          showToolbar(match.index);
          if (!drawings[match.index].locked) {
            isDraggingShape = true;
            draggedDrawingIndex = match.index;
            draggedDrawingOriginal = clone(drawings[match.index]);
            dragStartPixel = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
          }
          e.stopPropagation();
          e.preventDefault();
        } else {
          selectedDrawingIndex = null;
          hideToolbar();
        }
        redraw();
        return;
      }

      if (currentTool === 'eraser') {
        const match = findDrawingAt(pt);
        if (match !== null && !drawings[match.index].locked) {
          drawings.splice(match.index, 1);
          redraw();
        }
        return;
      }

      if (e.pointerType === 'touch' && (SINGLE_ANCHOR_TOOLS.includes(currentTool) || currentTool === 'alert' || currentTool === 'text')) {
        pendingTouchPlacement = currentTool;
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      if (currentTool === 'alert') {
        if (pt.price === null || pt.price === undefined || Number.isNaN(pt.price)) return;
        if (onAlertRequested) onAlertRequested(pt.price);
        returnToCursorAfterDraw();
        return;
      }

      if (currentTool === 'text') {
        e.preventDefault();
        e.stopPropagation();
        openTextInputAt(getScreenXY(e), pt);
        return;
      }

      if (currentTool === 'hline') {
        if (pt.price === null || pt.price === undefined) return;
        drawings.push(newDrawing('hline', { price: pt.price }, { dashed: true }));
        redraw();
        returnToCursorAfterDraw();
        return;
      }
      if (currentTool === 'vline') {
        drawings.push(newDrawing('vline', { logicalIndex: pt.logicalIndex, time: pt.time }, { dashed: true }));
        redraw();
        returnToCursorAfterDraw();
        return;
      }
      if (currentTool === 'hray') {
        if (pt.price === null || pt.price === undefined) return;
        drawings.push(newDrawing('hray', { p: pt }, { dashed: true }));
        redraw();
        returnToCursorAfterDraw();
        return;
      }

      dragStart = pt;
      canvas.setPointerCapture(e.pointerId);
    }

    let moveRafPending = false;
    let latestMoveEvent = null;

    function onPointerMove(e) {
      latestMoveEvent = e;
      if (moveRafPending) return;
      moveRafPending = true;
      requestAnimationFrame(() => {
        moveRafPending = false;
        handlePointerMove(latestMoveEvent);
      });
    }

    function handlePointerMove(e) {
      if (isTouchDrawing(e)) { touchMove(e); return; }      // <-- THÊM
      const wantMagnet = (currentTool !== 'cursor' && currentTool !== 'eraser') || isDraggingHandle;
      const { x, y } = getScreenXY(e);
      const r = resolveMagnet(x, y, wantMagnet ? effectiveMagnet(e) : 'off');
      const pt = pointFromEvent(e, wantMagnet);
      hoverPoint = { x: r.x, y: r.y, price: r.price, snapped: r.snapped };

      if (e.pointerType === 'touch' && currentTool !== 'cursor') {
        const rect = canvas.getBoundingClientRect();
        touchRawPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      } else {
        touchRawPoint = null;
      }

      if (pendingThirdPoint) {
        previewDrawing = { ...pendingThirdPoint, p3: pt };
        redraw();
        return;
      }

      if (pendingTouchPlacement) {
        if (pendingTouchPlacement === 'hline') {
          previewDrawing = newDrawing('hline', { price: pt.price }, { dashed: true });
        } else if (pendingTouchPlacement === 'vline') {
          previewDrawing = newDrawing('vline', { logicalIndex: pt.logicalIndex, time: pt.time }, { dashed: true });
        } else if (pendingTouchPlacement === 'hray') {
          previewDrawing = newDrawing('hray', { p: pt }, { dashed: true });
        }
        redraw();
        return;
      }

      if (currentTool === 'cursor') {
        // Kéo nút tròn điểm neo
        if (isDraggingHandle && draggedDrawingIndex !== null) {
          const d = drawings[draggedDrawingIndex];
          if (d) {
            if (draggedHandleName === 'p1') d.p1 = pt;
            else if (draggedHandleName === 'p2') d.p2 = pt;
            else if (draggedHandleName === 'p3') d.p3 = pt;
            else if (draggedHandleName === 'p') d.p = pt;
            else if (draggedHandleName === 'price') d.price = pt.price;
            else if (draggedHandleName === 'time') { d.time = pt.time; d.logicalIndex = pt.logicalIndex; }
            repositionToolbarOnly(draggedDrawingIndex);
          }
          redraw();
          return;
        }

        // Kéo cả hình
        if (isDraggingShape && draggedDrawingOriginal) {
          const dx = e.clientX - dragStartPixel.x;
          const dy = e.clientY - dragStartPixel.y;
          const orig = draggedDrawingOriginal;
          const d = drawings[draggedDrawingIndex];

          if (d) {
            const shiftPoint = (pOrig) => {
              const xO = pointToX(pOrig);
              const yO = priceToY(pOrig.price);
              if (xO === null || yO === null) return pOrig;
              const info = xToPointInfo(xO + dx);
              return { logicalIndex: info.logicalIndex, time: info.time, price: yToPrice(yO + dy) };
            };

            if (d.type === 'hline') {
              const yOrig = priceToY(orig.price);
              if (yOrig !== null) d.price = yToPrice(yOrig + dy);
            } else if (d.type === 'vline') {
              const xOrig = pointToX(orig);
              if (xOrig !== null) {
                const info = xToPointInfo(xOrig + dx);
                d.time = info.time; d.logicalIndex = info.logicalIndex;
              }
            } else if (d.type === 'hray' || d.type === 'text') {
              d.p = shiftPoint(orig.p);
            } else if (d.p3) {
              d.p1 = shiftPoint(orig.p1);
              d.p2 = shiftPoint(orig.p2);
              d.p3 = shiftPoint(orig.p3);
            } else if (d.p1 && d.p2) {
              d.p1 = shiftPoint(orig.p1);
              d.p2 = shiftPoint(orig.p2);
            }
            repositionToolbarOnly(draggedDrawingIndex);
          }
        } else {
          const matchHandle = findHandleAt(pt);
          if (matchHandle) {
            canvas.style.pointerEvents = 'auto';
            canvas.style.cursor = 'pointer';
          } else {
            const match = findDrawingAt(pt);
            if (match !== null) {
              hoveredDrawingIndex = match.index;
              canvas.style.pointerEvents = 'auto';
              canvas.style.cursor = 'move';
            } else {
              hoveredDrawingIndex = null;
              canvas.style.pointerEvents = 'none';
              canvas.style.cursor = 'default';
            }
          }
        }
        redraw();
        return;
      }

      if (dragStart && currentTool !== 'alert' && currentTool !== 'text' && currentTool !== 'eraser' &&
          !SINGLE_ANCHOR_TOOLS.includes(currentTool)) {
        // Preview dùng luôn style đã nhớ của công cụ
        previewDrawing = newDrawing(currentTool, { p1: dragStart, p2: pt });
      }
      redraw();
    }

    function onPointerUp(e) {
      if (isTouchDrawing(e)) { touchUp(e); return; }        // <-- THÊM
      if (e.pointerType === 'touch') {
        hoverPoint = null;
        touchRawPoint = null;
      }

      if (pendingTouchPlacement) {
        const tool = pendingTouchPlacement;
        const pt = pointFromEvent(e, true);
        pendingTouchPlacement = null;
        previewDrawing = null;

        if (tool === 'hline' && pt.price !== null && !Number.isNaN(pt.price)) {
          drawings.push(newDrawing('hline', { price: pt.price }, { dashed: true }));
          redraw();
          returnToCursorAfterDraw();
        } else if (tool === 'vline') {
          drawings.push(newDrawing('vline', { logicalIndex: pt.logicalIndex, time: pt.time }, { dashed: true }));
          redraw();
          returnToCursorAfterDraw();
        } else if (tool === 'hray' && pt.price !== null) {
          drawings.push(newDrawing('hray', { p: pt }, { dashed: true }));
          redraw();
          returnToCursorAfterDraw();
        } else if (tool === 'alert' && pt.price !== null) {
          if (onAlertRequested) onAlertRequested(pt.price);
          redraw();
          returnToCursorAfterDraw();
        } else if (tool === 'text') {
          redraw();
          openTextInputAt(getScreenXY(e), pt);
        } else {
          redraw();
        }
        return;
      }

      if (currentTool === 'cursor') {
        if (isDraggingHandle || isDraggingShape) {
          canvas.releasePointerCapture(e.pointerId);
          isDraggingHandle = false;
          draggedHandleName = null;
          isDraggingShape = false;
          draggedDrawingIndex = null;
          draggedDrawingOriginal = null;
          dragStartPixel = null;
          redraw();
        }
        if (e.pointerType === 'touch') canvas.style.pointerEvents = 'none';   // <-- THÊM
        return;
      }

      if (currentTool === 'alert' || currentTool === 'text' || currentTool === 'eraser' || !dragStart) {
        redraw();
        return;
      }

      const pt = pointFromEvent(e, true);
      let shapeCreated = false;

      if (TWO_ANCHOR_TOOLS.includes(currentTool)) {
        const extra = {};
        if (currentTool === 'long' || currentTool === 'short') extra.rr = 2;
        // Fib: "đóng băng" cấu hình đầy đủ vào hình vừa vẽ (style đã nhớ sẽ ghi đè lên mặc định)
        if (currentTool === 'fib') Object.assign(extra, clone({ ...FIB_DEFAULTS, levels: DEFAULT_FIB_LEVELS }));
        drawings.push(newDrawing(currentTool, { p1: dragStart, p2: pt }, { dashed: false, ...extra }));
        shapeCreated = true;
      } else if (THREE_ANCHOR_TOOLS.includes(currentTool)) {
        pendingThirdPoint = newDrawing(currentTool, { p1: dragStart, p2: pt }, { dashed: false });
      }

      dragStart = null;
      previewDrawing = null;
      redraw();
      if (shapeCreated) returnToCursorAfterDraw();
    }

    function onContainerPointerMove(e) {
      if (currentTool !== 'cursor' || isDraggingShape || isDraggingHandle) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const info = xToPointInfo(x);
      const price = yToPrice(y);

      if (price === null || Number.isNaN(price)) {
        canvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'default';
        if (hoveredDrawingIndex !== null) {
          hoveredDrawingIndex = null;
          redraw();
        }
        return;
      }

      const pt = { logicalIndex: info.logicalIndex, time: info.time, price: price };
      const matchHandle = findHandleAt(pt);
      if (matchHandle) {
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'pointer';
        return;
      }

      const match = findDrawingAt(pt);
      if (match !== null) {
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'move';
        if (hoveredDrawingIndex !== match.index) {
          hoveredDrawingIndex = match.index;
          redraw();
        }
      } else {
        canvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'default';
        if (hoveredDrawingIndex !== null) {
          hoveredDrawingIndex = null;
          redraw();
        }
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('mousedown', (e) => {
      if (currentTool === 'text') {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', () => {
      touchGesture = null;
      dragStart = null;
      previewDrawing = null;
      hoverPoint = null;
      touchRawPoint = null;
      pendingTouchPlacement = null;
      pendingThirdPoint = null;
      isDraggingShape = false;
      isDraggingHandle = false;
      draggedDrawingIndex = null;
      draggedDrawingOriginal = null;
      dragStartPixel = null;
      redraw();
    });
    canvas.addEventListener('pointerleave', () => {
      if (currentTool === 'cursor') canvas.style.pointerEvents = 'none';
      if (touchCursor) return;                              // <-- THÊM
       hoverPoint = null; touchRawPoint = null; redraw(); });

    // Nhấp đúp vào hình = mở cài đặt chi tiết (giống TradingView)
    canvas.addEventListener('dblclick', (e) => {
      if (currentTool !== 'cursor') return;
      const match = findDrawingAt(pointFromEvent(e));
      if (match !== null) {
        selectedDrawingIndex = match.index;
        openSettingsModal(match.index);
      }
    });

    // Chuột phải vào hình = mở cài đặt chi tiết
    canvas.addEventListener('contextmenu', (e) => {
      if (currentTool !== 'cursor') return;
      const match = findDrawingAt(pointFromEvent(e));
      if (match !== null) {
        e.preventDefault();
        selectedDrawingIndex = match.index;
        openSettingsModal(match.index);
      }
    });

    // Chọn hình ngay khi bấm, không cần canvas đã bật pointer-events từ trước.
    // Chạy ở pha capture nên chặn được chart kéo/cuộn khi bấm trúng hình.
        // Chạm nhẹ để chọn hình (cảm ứng): chỉ chọn khi nhấc tay mà chưa kéo
    let touchGrabActive = false; // đang nắm hình/điểm neo bằng cảm ứng -> chặn chart nhận touch    
    let touchTap = null; // {id, x, y, t, index}
    window.addEventListener('pointermove', (e) => {
      if (touchTap && e.pointerId === touchTap.id &&
          Math.hypot(e.clientX - touchTap.x, e.clientY - touchTap.y) > 10) touchTap = null;
    });
    window.addEventListener('pointercancel', () => { touchTap = null; });
    window.addEventListener('pointerup', (e) => {
      const t = touchTap;
      touchTap = null;
      if (!t || e.pointerId !== t.id || currentTool !== 'cursor') return;
      if (Date.now() - t.t > 500) return;
      if (t.index !== null) {
        selectedDrawingIndex = t.index;
        showToolbar(t.index);
      } else {
        selectedDrawingIndex = null;
        hideToolbar();
      }
      redraw();
    });

    // Chọn hình ngay khi bấm (chuột). Chạy ở pha capture nên chặn được chart kéo/cuộn khi bấm trúng hình.
    container.addEventListener('pointerdown', (e) => {
      if (currentTool !== 'cursor' || e.target === canvas) return;
      if (e.target.closest && e.target.closest('.dtv-tb, input, select, button, textarea')) return;
      if (e.button !== undefined && e.button !== 0) return;
      const pt = pointFromEvent(e);
      if (pt.price === null || pt.price === undefined || Number.isNaN(pt.price)) return;

      const handle = findHandleAt(pt);
      const match = handle ? null : findDrawingAt(pt);

      if (e.pointerType === 'touch') {
        // Chỉ "nắm" được khi chạm trúng điểm neo, hoặc thân hình ĐANG ĐƯỢC CHỌN
        const grab = handle || (match && match.index === selectedDrawingIndex);
        if (grab) {
          canvas.style.pointerEvents = 'auto';
          onPointerDown(e);
          touchGrabActive = isDraggingHandle || isDraggingShape;   // <-- THÊM (hình bị khoá thì không chặn, để chart cuộn)
        } else {
          // Không chặn -> chart cuộn bình thường; nếu chỉ là cú chạm thì chọn lúc nhấc tay
          touchTap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), index: match ? match.index : null };
        }
        return;
      }

      if (handle || match) {
        canvas.style.pointerEvents = 'auto';
        onPointerDown(e);
      }
    }, true);
    
        // Chặn chart nhận cử chỉ cảm ứng khi đang kéo hình/điểm neo (pha capture nên chạy trước chart)
    const blockChartTouch = (e) => {
      if (!touchGrabActive) return;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    };
    container.addEventListener('touchstart', blockChartTouch, { capture: true, passive: false });
    container.addEventListener('touchmove', blockChartTouch, { capture: true, passive: false });
    const endChartTouch = (e) => {
      if (!touchGrabActive) return;
      e.stopPropagation();
      if (e.touches.length === 0) touchGrabActive = false;
    };
    container.addEventListener('touchend', endChartTouch, true);
    container.addEventListener('touchcancel', endChartTouch, true);

    container.addEventListener('pointermove', onContainerPointerMove);
    container.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;      // <-- THÊM: cảm ứng bỏ chọn bằng cú chạm (ở trên)
      if (currentTool !== 'cursor') return;
      if (e.target === canvas) return;
      if (selectedDrawingIndex !== null || toolbarEl) {
        selectedDrawingIndex = null;
        hideToolbar();
        redraw();
      }
    });

        // ===================== GẮN HÌNH VẼ VÀO CHART (primitive) =====================
    // Chart tự gọi draw() trong lượt render của nó -> hình luôn dính chart, không trễ.
    const primitiveView = {
      zOrder: () => 'top',
      renderer: () => ({
        draw(target) {
          if (allDrawingsHidden) return;
          target.useMediaCoordinateSpace((scope) => {
            ctx = scope.context;          // tạm thời vẽ lên context của chart
            inPrimitive = true;
            primSize = scope.mediaSize;   // {width, height} của vùng chart (không gồm trục giá)
            try {
              drawings.forEach((d, idx) => {
                if (isVisibleNow(d)) drawShape(d, false, idx);
              });
            } finally {
              ctx = canvasCtx;            // trả về canvas riêng cho preview/crosshair
              inPrimitive = false;
            }
          });
        },
      }),
    };

    // ===== ĐƯỜNG DỌC TRÊN CÁC PANE PHỤ (RSI / MACD) =====
const extraUpdaters = new Set();

const vlineExtraView = {
  zOrder: () => 'top',
  renderer: () => ({
    draw(target) {
      if (allDrawingsHidden) return;
      target.useMediaCoordinateSpace((scope) => {
        const c = scope.context;
        const { height } = scope.mediaSize;
        drawings.forEach((d, idx) => {
          if (d.type !== 'vline' || !isVisibleNow(d)) return;
          const x = pointToX(d);
          if (x === null || x === undefined) return;
          const selected = idx === selectedDrawingIndex;
          c.save();
          c.globalAlpha = d.opacity === undefined ? 1 : d.opacity;
          c.strokeStyle = d.color || '#f2a339';
          c.lineWidth = (d.width || 1.5) + (selected ? 1 : 0);
          if (d.dashed !== false) c.setLineDash([4, 3]);
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x, height);
          c.stroke();
          c.restore();
        });
      });
    },
  }),
};

/** Primitive chỉ vẽ đường dọc - chart.js gắn vào series của pane RSI / MACD. */
function createVlinePrimitive() {
  let upd = null;
  return {
    attached: ({ requestUpdate }) => { upd = requestUpdate; extraUpdaters.add(upd); },
    detached: () => { if (upd) extraUpdaters.delete(upd); upd = null; },
    updateAllViews() {},
    paneViews: () => [vlineExtraView],
  };
}

    candleSeries.attachPrimitive({
      attached: ({ requestUpdate }) => { primitiveUpdate = requestUpdate; },
      detached: () => { primitiveUpdate = null; },
      updateAllViews() {},
      paneViews: () => [primitiveView],
    });

    const resizeObs = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        resizeCanvas();
      });
    });
    resizeObs.observe(container);
    resizeCanvas();

    function setAllHidden(v) {
      allDrawingsHidden = !!v;
      if (allDrawingsHidden) {
        selectedDrawingIndex = null;
        hideToolbar();
      }
      redraw();
    }

    function getAllHidden() {
      return allDrawingsHidden;
    }

    return {
  setTool,
  clearAll,
  redraw,
  getTool: () => currentTool,
  isAwaitingThirdPoint: () => !!pendingThirdPoint,
  setAllHidden,
  getAllHidden,
  loadForSymbol,
  flushSave,
  createVlinePrimitive,   // <-- THÊM

  getOldestTime() {
    let m = Infinity;
    const take = (p) => {
      if (p && typeof p.time === 'number' && p.time < m) {
        m = p.time;
      }
    };

    drawings.forEach((d) => {
      take(d);
      take(d.p);
      take(d.p1);
      take(d.p2);
      take(d.p3);
    });

    return m;
  },
};
  }

  function formatPrice(v) {
    if (typeof formatPriceLocal === 'function') return formatPriceLocal(v);
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });
  }

    return {
    create,
    getToolStyle: styleOf,
    resetToolStyles,
    getMagnetMode,
    setMagnetMode,
  };
})();