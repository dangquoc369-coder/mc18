/**
 * watchlist.js
 * Watchlist cục bộ: danh sách ở sidebar + nút sao trên từng ô chart.
 * Lưu qua Store.* (-> LocalStore), không đụng cloud.
 * CẬP NHẬT: sao / nút xoá dùng icon SVG (star, starOutline, close).
 */
const WatchlistModule = (function () {
  function injectStyles() {
    if (document.getElementById('watchlistStyles')) return;
    const s = document.createElement('style');
    s.id = 'watchlistStyles';
    s.textContent = `
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
      .wl-star { background: none; border: none; cursor: pointer; line-height: 1;
        padding: 0 4px; color: var(--text-secondary); pointer-events: auto;
        display: inline-flex; align-items: center; align-self: center; }
      .wl-star .icon-svg { width: 15px; height: 15px; }
      .wl-star.on { color: #f5c518; }
    `;
    document.head.appendChild(s);
  }

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
      list.innerHTML = `<li class="wl-empty">Watchlist trống. Bấm ${iconInline('starOutline')} cạnh tên cặp trên chart để thêm.</li>`;
      return;
    }

    items.forEach((sym) => {
      const li = document.createElement('li');
      li.className = 'wl-item' + (active && active.symbol === sym ? ' active' : '');
      li.innerHTML = `<span>${sym}</span><button type="button" class="wl-remove" title="Bỏ khỏi watchlist">${iconHTML('close')}</button>`;
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

  function ensureStars() {
    Store.getState().panes.forEach((pane) => {
      const row = document.querySelector(`#${pane.id} .pane-symbol-row`);
      if (!row) return;
      let star = row.querySelector('.wl-star');
      if (!star) {
        star = document.createElement('button');
        star.type = 'button';
        star.className = 'wl-star';
        star.addEventListener('pointerdown', (e) => e.stopPropagation());
        star.addEventListener('click', (e) => {
          e.stopPropagation();
          const p = Store.getPane(pane.id);
          if (p) Store.toggleWatchlist(p.symbol);
        });
        const symEl = row.querySelector('.pane-symbol');
        if (symEl && symEl.nextSibling) row.insertBefore(star, symEl.nextSibling);
        else row.appendChild(star);
      }
      const on = Store.isInWatchlist(Store.getPane(pane.id).symbol);
      star.innerHTML = iconHTML(on ? 'star' : 'starOutline');
      star.classList.toggle('on', on);
      star.title = on ? 'Bỏ khỏi watchlist' : 'Thêm vào watchlist';
    });
  }

  function refresh() {
    renderSidebar();
    ensureStars();
  }

  function init() {
    injectStyles();
    refresh();
    EventBus.on('watchlist:changed', refresh);
    EventBus.on('pane:symbolChanged', refresh);
    EventBus.on('pane:focused', renderSidebar);
  }

  init();
  return { refresh };
})();