/**
 * watchlist.js
 * Watchlist cục bộ: danh sách ở sidebar + nút sao nằm trong KẾT QUẢ TÌM KIẾM
 * (giống TradingView). Không còn nút sao trên hàng symbol của chart.
 * Lưu qua Store.* (-> LocalStore), không đụng cloud.
 *
 * API công khai (ui.js dùng):
 *   WatchlistModule.starHTML(symbol)  -> chuỗi HTML nút sao cho 1 dòng kết quả
 */
const WatchlistModule = (function () {
  function injectStyles() {
    if (document.getElementById('watchlistStyles')) return;
    const s = document.createElement('style');
    s.id = 'watchlistStyles';
    s.textContent = `
      /* ---- Danh sách watchlist ở sidebar ---- */
      .wl-list { list-style: none; margin: 0; padding: 0; }
      .wl-item { display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px; cursor: pointer; font-size: 13px; color: var(--text-primary);
        border-left: 2px solid transparent; }
      .wl-item:hover { background: var(--bg-elevated, rgba(127,127,127,0.12)); }
      .wl-item.active { border-left-color: var(--accent-blue, #4f7cff); background: rgba(79,124,255,0.1); }
      .wl-remove { background: none; border: none; color: var(--text-secondary); cursor: pointer;
        padding: 3px 5px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; }
      .wl-remove .icon-svg { width: 12px; height: 12px; }
      .wl-remove:hover { color: var(--red, #ff5a67); }
      .wl-empty { padding: 10px 12px; font-size: 12px; color: var(--text-secondary); line-height: 1.5; }

      /* ---- Nút sao trong kết quả tìm kiếm ---- */
      .symbol-search-item:has(.wl-add) { position: relative; padding-right: 40px; }
      .wl-add { position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
        background: none; border: none; cursor: pointer; padding: 4px; line-height: 1;
        color: var(--text-secondary); display: inline-flex; align-items: center;
        border-radius: 4px; }
      .wl-add .icon-svg { width: 15px; height: 15px; }
      .wl-add:hover { color: #f5c518; background: rgba(127,127,127,0.15); }
      .wl-add.on { color: #f5c518; }
      /* Máy có chuột: sao chỉ hiện khi rê chuột (sao đã thêm luôn hiện). iPad: luôn hiện. */
      @media (hover: hover) {
        .symbol-search-item .wl-add:not(.on) { opacity: 0; }
        .symbol-search-item:hover .wl-add { opacity: 1; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ===================== Tiện ích ===================== */

  function displayName(sym) {
    if (sym.endsWith('_PERP')) return sym.replace('_PERP', ' (Futures)');
    if (sym.startsWith('OANDA:')) return sym.replace('OANDA:', '') + ' (OANDA)';
    if (sym === 'XAUUSD') return 'XAUUSD (OANDA)';
    return sym;
  }

  function escAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ===================== Sidebar: danh sách watchlist ===================== */

  function ensureListEl() {
    const section = document.getElementById('sidebarChartSection');
    if (!section) return null;
    let list = document.getElementById('watchlistList');
    if (!list) {
      const old = document.getElementById('symbolList');
      if (old) old.style.display = 'none'; // thay danh sách "Phổ biến" cố định
      const title = section.querySelector('.sidebar-section-title');
      if (title) title.textContent = 'Watchlist';
      list = document.createElement('ul');
      list.id = 'watchlistList';
      list.className = 'wl-list';
      section.appendChild(list);
    }
    return list;
  }

  function renderSidebar() {
    const list = ensureListEl();
    if (!list) return;
    const items = Store.getWatchlist();
    const active = Store.getActivePane();
    list.innerHTML = '';

    if (items.length === 0) {
      list.innerHTML = `<li class="wl-empty">Watchlist trống. Tìm cặp giao dịch ở ô tìm kiếm rồi bấm ${iconInline('starOutline')} để thêm.</li>`;
      return;
    }

    items.forEach((sym) => {
      const li = document.createElement('li');
      li.className = 'wl-item' + (active && active.symbol === sym ? ' active' : '');
      li.innerHTML = `<span>${escAttr(displayName(sym))}</span><button type="button" class="wl-remove" title="Bỏ khỏi watchlist">${iconHTML('close')}</button>`;
      li.addEventListener('click', () => {
        Store.setPaneSymbol(Store.getState().activePaneId, sym); // áp cho ô đang chọn
      });
      li.querySelector('.wl-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        Store.removeFromWatchlist(sym);
      });
      list.appendChild(li);
    });
  }

  /* ===================== Kết quả tìm kiếm: nút sao ===================== */

  /** HTML nút sao cho 1 dòng kết quả (ui.js gọi khi render). */
  function starHTML(symbol) {
    const on = Store.isInWatchlist(symbol);
    return `<button type="button" class="wl-add${on ? ' on' : ''}" data-wl-symbol="${escAttr(symbol)}" title="${on ? 'Bỏ khỏi watchlist' : 'Thêm vào watchlist'}">${iconHTML(on ? 'star' : 'starOutline')}</button>`;
  }

  /** Cập nhật trạng thái sao của các dòng đang hiện (không render lại danh sách). */
  function refreshSearchStars() {
    document.querySelectorAll('#symbolSearchResults .wl-add').forEach((btn) => {
      const sym = btn.dataset.wlSymbol;
      const on = Store.isInWatchlist(sym);
      btn.classList.toggle('on', on);
      btn.innerHTML = iconHTML(on ? 'star' : 'starOutline');
      btn.title = on ? 'Bỏ khỏi watchlist' : 'Thêm vào watchlist';
    });
  }

  /**
   * Ủy quyền sự kiện ở pha CAPTURE trên khung kết quả: bấm sao thì xử lý và
   * chặn luôn, nên listener "chọn symbol" của dòng (trong ui.js) không chạy.
   * Nhờ vậy ui.js không cần gắn listener cho từng nút sao.
   */
  function bindSearchResults() {
    const box = document.getElementById('symbolSearchResults');
    if (!box) return;

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('.wl-add');
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();
      Store.toggleWatchlist(btn.dataset.wlSymbol);
    }, true);

    // Giữ focus ở ô nhập khi bấm sao
    box.addEventListener('mousedown', (e) => {
      if (e.target.closest('.wl-add')) e.preventDefault();
    }, true);
  }

  /* ===================== Dọn nút sao cũ trên hàng symbol ===================== */

  function removeOldPaneStars() {
    document.querySelectorAll('.pane-symbol-row .wl-star').forEach((el) => el.remove());
  }

  /* ===================== Khởi tạo ===================== */

  function onWatchlistChanged() {
    renderSidebar();
    refreshSearchStars();
  }

  function init() {
    injectStyles();
    removeOldPaneStars();
    renderSidebar();
    bindSearchResults();
    EventBus.on('watchlist:changed', onWatchlistChanged);
    EventBus.on('pane:symbolChanged', renderSidebar);
    EventBus.on('pane:focused', renderSidebar);
  }

  init();
  return { refresh: onWatchlistChanged, starHTML };
})();