/**
 * timeframe-fit.js
 * Khung giờ nhanh tự lấp đầy chỗ trống theo THỨ TỰ ƯU TIÊN do người dùng chọn.
 * - MIN_VISIBLE khung đầu luôn hiện; các khung sau chỉ hiện khi còn đủ chỗ.
 * - Nút bánh răng mở bảng sắp xếp thứ tự ưu tiên (▲ ▼).
 */
const TimeframeFit = (function () {
  const KEY = 'dq_tf_priority_v1';
  const MIN_VISIBLE = 3;
  const DEFAULT_FIRST = ['5m', '15m', '1h', '2h', '4h', '12h', '1d', '10m', '3d'];
  const root = document.documentElement;
  let popEl = null;
  let popAnchor = null;
  let scheduled = false;

  function injectStyles() {
    if (document.getElementById('tfFitStyles')) return;
    const s = document.createElement('style');
    s.id = 'tfFitStyles';
    s.textContent = `
      #sharedTimeframeGroup { flex-wrap: nowrap; flex-shrink: 0; }
      .tf-gear { display: inline-flex; align-items: center; justify-content: center; padding: 5px 7px; }
      .tf-gear svg { width: 14px; height: 14px; display: block; }
      .tf-pop { position: fixed; z-index: 1000; width: 230px; max-height: min(70vh, 460px);
        overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 10px;
        background: var(--bg-elevated); border: 1px solid var(--border-color);
        border-radius: var(--radius-lg); box-shadow: var(--shadow-md); font-family: var(--font); }
      .tf-pop-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .6px; color: var(--text-secondary); }
      .tf-pop-hint { font-size: 10.5px; line-height: 1.35; color: var(--text-secondary); margin-bottom: 2px; }
      .tf-row { display: flex; align-items: center; gap: 6px; padding: 2px 4px 2px 8px;
        background: var(--bg-main); border: 1px solid var(--border-color);
        border-radius: var(--radius-sm); font-size: 12px; color: var(--text-primary); }
      .tf-row .n { width: 16px; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-secondary); }
      .tf-row.fixed .n { color: var(--accent-blue); }
      .tf-row .l { flex: 1; font-weight: 600; }
      .tf-mv { width: 26px; height: 26px; border: none; background: transparent; cursor: pointer;
        color: var(--text-secondary); border-radius: 4px; font-size: 11px; }
      .tf-mv:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
      .tf-mv:disabled { opacity: .3; cursor: default; }
      .tf-reset { margin-top: 4px; border: 1px solid var(--border-color); background: transparent;
        color: var(--text-primary); border-radius: 8px; padding: 6px 10px; font-size: 11.5px; cursor: pointer; }
    `;
    document.head.appendChild(s);
  }

  /* ===================== Thứ tự ưu tiên ===================== */

  function allValues() {
    return (typeof TIMEFRAMES !== 'undefined' ? TIMEFRAMES : []).map((t) => t.value);
  }

  function loadSaved() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(a) ? a : null;
    } catch (e) {
      return null;
    }
  }

  function getOrder() {
    const all = allValues();
    const out = [];
    (loadSaved() || DEFAULT_FIRST).forEach((v) => {
      if (all.includes(v) && !out.includes(v)) out.push(v);
    });
    all.forEach((v) => { if (!out.includes(v)) out.push(v); }); // khung mới thêm -> xuống cuối
    return out;
  }

  function saveOrder(order) {
    try { localStorage.setItem(KEY, JSON.stringify(order)); } catch (e) { /* bỏ qua */ }
  }

  function shortLabel(v) {
    return /m$/.test(v) ? v : v.toUpperCase(); // 15m, 1H, 4H, 1D, 1W...
  }

  function getList() {
    return getOrder().map((v) => ({ value: v, label: shortLabel(v) }));
  }

  /* ===================== Co giãn theo chỗ trống ===================== */

  function quickButtons() {
    const groupEl = document.getElementById('sharedTimeframeGroup');
    const quick = groupEl && groupEl.querySelector('.timeframe-quick-btns');
    return quick ? Array.from(quick.children) : [];
  }

  /** Về trạng thái gốc (chỉ MIN_VISIBLE khung) - topbar-fit.js gọi trước khi đo. */
  function collapse() {
    quickButtons().forEach((b, i) => { b.style.display = i < MIN_VISIBLE ? '' : 'none'; });
  }

  /** Thêm dần khung theo thứ tự ưu tiên tới khi hết chỗ. */
  function fit() {
    const bar = document.getElementById('controlBar');
    const btns = quickButtons();
    if (!bar || !btns.length) return;
    const quick = btns[0].parentElement;
    if (quick.offsetParent === null || bar.offsetParent === null) return; // đang ẩn
    collapse();
    for (let i = MIN_VISIBLE; i < btns.length; i++) {
      btns[i].style.display = '';
      if (bar.scrollWidth > bar.clientWidth + 1) {
        btns[i].style.display = 'none';
        break;
      }
    }
  }

  /** Màn dọc: tự đo. Màn ngang: topbar-fit.js lo (đo cùng các mức thu gọn). */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!root.classList.contains('tb-merged')) fit();
    });
  }

  /* ===================== Bảng sắp xếp ưu tiên ===================== */

  function closePopover() {
    if (popEl) popEl.remove();
    popEl = null;
    popAnchor = null;
    document.removeEventListener('click', onDocClick, true);
  }

  function onDocClick(e) {
    if (!popEl) return;
    if (popEl.contains(e.target)) return;
    if (popAnchor && popAnchor.contains(e.target)) return;
    closePopover();
  }

  function rerenderBar() {
    if (typeof UI !== 'undefined') UI.renderSharedTimeframeGroup();
  }

  function renderPopRows() {
    popEl.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'tf-pop-title';
    title.textContent = 'Thứ tự ưu tiên khung giờ';
    const hint = document.createElement('div');
    hint.className = 'tf-pop-hint';
    hint.textContent = 'Đổi thứ tự bằng ▲ ▼. Khung ở trên được ưu tiên hiện trước, khung sau tự hiện thêm khi còn chỗ.';
    popEl.append(title, hint);

    const order = getOrder();
    order.forEach((v, i) => {
      const row = document.createElement('div');
      row.className = 'tf-row' + (i < MIN_VISIBLE ? ' fixed' : '');
      row.innerHTML = `<span class="n">${i + 1}</span><span class="l">${shortLabel(v)}</span>`;
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'tf-mv'; up.textContent = '▲'; up.disabled = i === 0;
      const down = document.createElement('button');
      down.type = 'button'; down.className = 'tf-mv'; down.textContent = '▼'; down.disabled = i === order.length - 1;
      const move = (d) => {
        const o = getOrder();
        [o[i], o[i + d]] = [o[i + d], o[i]];
        saveOrder(o);
        renderPopRows();
        rerenderBar();
      };
      up.addEventListener('click', (e) => { e.stopPropagation(); move(-1); });
      down.addEventListener('click', (e) => { e.stopPropagation(); move(1); });
      row.append(up, down);
      popEl.appendChild(row);
    });

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'tf-reset';
    reset.textContent = 'Đặt lại thứ tự mặc định';
    reset.addEventListener('click', (e) => {
      e.stopPropagation();
      try { localStorage.removeItem(KEY); } catch (err) { /* bỏ qua */ }
      renderPopRows();
      rerenderBar();
    });
    popEl.appendChild(reset);
  }

  function positionPopover(anchor) {
    const rect = anchor.getBoundingClientRect();
    popEl.style.visibility = 'hidden';
    popEl.style.top = '0px';
    popEl.style.left = '0px';
    requestAnimationFrame(() => {
      if (!popEl) return;
      const w = popEl.offsetWidth, h = popEl.offsetHeight;
      let left = rect.right - w;
      let top = rect.bottom + 6;
      if (left < 8) left = 8;
      if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
      popEl.style.left = left + 'px';
      popEl.style.top = top + 'px';
      popEl.style.visibility = 'visible';
    });
  }

  function togglePopover(anchor) {
    if (popEl) { closePopover(); return; }
    popEl = document.createElement('div');
    popEl.className = 'tf-pop';
    popAnchor = anchor;
    renderPopRows();
    document.body.appendChild(popEl);
    positionPopover(anchor);
    setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  }

  /** Nút bánh răng - ui.js gắn vào cuối #sharedTimeframeGroup. */
  function makeSettingsButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'timeframe-btn tf-gear';
    btn.title = 'Sắp xếp thứ tự ưu tiên khung giờ';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>';
    btn.addEventListener('click', (e) => { e.stopPropagation(); togglePopover(btn); });
    if (popEl) popAnchor = btn; // thanh vừa vẽ lại -> bảng đang mở bám theo nút mới
    return btn;
  }

  function init() {
    injectStyles();
    const bar = document.getElementById('controlBar');
    if (bar && 'ResizeObserver' in window) new ResizeObserver(schedule).observe(bar);
    window.addEventListener('resize', schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  }

  init();
  return { getList, makeSettingsButton, collapse, fit, schedule };
})();