/**
 * pane-tf-select.js (v3)
 * Trên khung symbol của TỪNG ô chart, CHỈ khi body.app-fullscreen:
 *   - dropdown SYMBOL (lấy từ watchlist)
 *   - dropdown KHUNG THỜI GIAN
 * Ngoài fullscreen: cả hai bị ẩn, không chiếm chỗ chart.
 * Phụ thuộc: Store, EventBus, TIMEFRAMES, SelectFix (nạp sau symbol-size.js).
 */
(function () {
  const STYLE_ID = 'paneTfSelectStyles';
 
  // 15m giữ nguyên, còn lại in hoa: 1H, 4H, 1D, 1W... (khớp timeframe-fit.js)
  function tfLabel(v) {
    return /m$/.test(v) ? v : String(v).toUpperCase();
  }
 
  // Tên symbol hiển thị gọn trên nút
  function symLabel(sym) {
    if (sym.endsWith('_PERP')) return sym.replace('_PERP', ' (Futures)');
    return sym.replace('OANDA:', '');
  }
 
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      /* ---- Nút khung giờ ---- */
      .sfx-btn.pane-tf-btn {
        display: none;
        pointer-events: auto;
        min-width: 0;
        max-width: none;
        height: 16px;
        padding: 0 4px;
        gap: 0;
        font-size: 10px;
        font-weight: 600;
        line-height: 1;
        color: var(--accent-blue);
        background: transparent;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        justify-content: center;
      }
      .sfx-btn.pane-tf-btn:hover,
      .sfx-btn.pane-tf-btn.open { border-color: var(--accent-blue); }
      .pane-tf-btn .sfx-c { display: none; }
      body.app-fullscreen .sfx-btn.pane-tf-btn { display: inline-flex; }
 
      /* ---- Nút symbol (thay chữ .pane-symbol khi fullscreen) ---- */
      .sfx-btn.pane-wl-btn {
        display: none;
        pointer-events: auto;
        min-width: 0;
        max-width: 150px;
        height: auto;
        padding: 0 2px;
        gap: 3px;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.2;
        color: var(--text-primary);
        background: transparent;
        border: none;
        border-radius: var(--radius-sm);
      }
      .sfx-btn.pane-wl-btn:hover,
      .sfx-btn.pane-wl-btn.open { background: var(--bg-hover); }
      .pane-wl-btn .sfx-c { font-size: 8px; }
      body.app-fullscreen .sfx-btn.pane-wl-btn { display: inline-flex; }
      body.app-fullscreen .chart-pane .pane-symbol { display: none; }
    `;
    document.head.appendChild(s);
  }
 
  /* ===================== Khung giờ ===================== */
 
  function buildTfSelect(paneId, current) {
    const sel = document.createElement('select');
    sel.className = 'pane-tf-select';
    sel.dataset.paneId = paneId;
    (typeof TIMEFRAMES !== 'undefined' ? TIMEFRAMES : []).forEach((tf) => {
      const opt = document.createElement('option');
      opt.value = tf.value;
      opt.textContent = tfLabel(tf.value);
      sel.appendChild(opt);
    });
    sel.value = current;
    sel.addEventListener('change', () => Store.setPaneTimeframe(paneId, sel.value));
    return sel;
  }
 
  /* ===================== Symbol (watchlist) ===================== */
 
  /** Dựng lại danh sách option = watchlist (+ symbol hiện tại nếu chưa có). */
  function fillSymbolOptions(sel, current) {
    const list = Store.getWatchlist();
    if (current && !list.includes(current)) list.unshift(current);
    sel.innerHTML = '';
    list.forEach((sym) => {
      const opt = document.createElement('option');
      opt.value = sym;
      opt.textContent = symLabel(sym);
      sel.appendChild(opt);
    });
    sel.value = current; // SelectFix hook setter -> nhãn nút tự cập nhật
  }
 
  function buildSymSelect(paneId, current) {
    const sel = document.createElement('select');
    sel.className = 'pane-wl-select';
    sel.dataset.paneId = paneId;
    fillSymbolOptions(sel, current);
    sel.addEventListener('change', () => Store.setPaneSymbol(paneId, sel.value));
    return sel;
  }
 
  function refreshSymbolSelect(paneId) {
    const sel = document.querySelector('.pane-wl-select[data-pane-id="' + paneId + '"]');
    const p = Store.getPane(paneId);
    if (sel && p) fillSymbolOptions(sel, p.symbol);
  }
 
  /* ===================== Gắn vào từng ô ===================== */
 
  /** Bọc select bằng SelectFix; select phải đã nằm trong DOM. */
  function enhance(sel, btnClass, title) {
    if (typeof SelectFix === 'undefined') {
      sel.style.display = 'inline-block'; // dự phòng: select gốc
      return;
    }
    SelectFix.enhance(sel);
    const btn = sel.previousElementSibling; // SelectFix chèn nút NGAY TRƯỚC select
    if (btn && btn.tagName === 'BUTTON') {
      btn.classList.add(btnClass);
      btn.title = title;
    }
  }
 
  function init() {
    injectStyles();
 
    document.querySelectorAll('.chart-pane').forEach((pane) => {
      const row = pane.querySelector('.pane-symbol-row');
      const p = Store.getPane(pane.id);
      if (!row || !p) return;
 
      // --- Symbol: ngay sau chữ .pane-symbol ---
      if (!row.querySelector('.pane-wl-select')) {
        const symEl = row.querySelector('.pane-symbol');
        const symSel = buildSymSelect(pane.id, p.symbol);
        if (symEl) symEl.insertAdjacentElement('afterend', symSel);
        else row.insertBefore(symSel, row.firstChild);
        enhance(symSel, 'pane-wl-btn', 'Đổi symbol (watchlist) của ô này');
      }
 
      // --- Khung giờ: trước nút "Aa" (hoặc cuối hàng) ---
      if (!row.querySelector('.pane-tf-select')) {
        const tfSel = buildTfSelect(pane.id, p.timeframe);
        const aaBtn = row.querySelector('.sym-size-btn');
        if (aaBtn) row.insertBefore(tfSel, aaBtn);
        else row.appendChild(tfSel);
        enhance(tfSel, 'pane-tf-btn', 'Đổi khung thời gian của ô này');
      }
    });
 
    // Khung đổi từ nơi khác -> đồng bộ
    EventBus.on('pane:timeframeChanged', ({ paneId, timeframe }) => {
      const sel = document.querySelector('.pane-tf-select[data-pane-id="' + paneId + '"]');
      if (sel && sel.value !== timeframe) sel.value = timeframe;
    });
 
    // Symbol đổi từ nơi khác (sidebar, tìm kiếm...) -> đồng bộ
    EventBus.on('pane:symbolChanged', ({ paneId }) => refreshSymbolSelect(paneId));
 
    // Watchlist thêm/bớt -> cập nhật danh sách của mọi ô
    EventBus.on('watchlist:changed', () => {
      Store.getState().panes.forEach((p) => refreshSymbolSelect(p.id));
    });
  }
 
  init();
})();