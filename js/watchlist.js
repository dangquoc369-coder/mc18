/**
 * watchlist.js  (bản kiểu TradingView)
 *
 * Sidebar MỞ RỘNG : mỗi dòng = Mã (+nhãn PERP/OANDA) | Giá | % thay đổi.
 *   - Giá/% realtime: Binance qua 1 WebSocket miniTicker gộp (spot + futures),
 *     OANDA (XAUUSD) poll 15s + ăn theo giá của ô chart đang hiển thị mã đó.
 *   - Nút "Sửa": hiện tay nắm kéo-thả (chuột + cảm ứng iPad) và nút xoá.
 *     Máy có chuột: rê vào dòng là thấy tay nắm + nút xoá luôn.
 *   - Dòng của mã đang chọn tô nổi; mã đang hiện ở ô khác có chấm mờ.
 *
 * Sidebar THU GỌN : cột mini (#wlMini) gồm nút kính lúp + các ô "BTC +1.2%".
 *   - Bấm ô = áp mã cho ô chart đang chọn.
 *   - Bấm kính lúp = mở khung tìm kiếm nổi (dùng lại đúng ô tìm kiếm cũ, có sao).
 *   - Cột mini chỉ hiện khi đang ở tab "Biểu đồ" (xem CSS :has bên dưới).
 *
 * Không đụng chế độ fullscreen. Lưu thứ tự qua Store.reorderWatchlist.
 *
 * API công khai (ui.js dùng): WatchlistModule.starHTML(symbol)
 */
const WatchlistModule = (function () {
  const MOBILE_BP = 900;
  const QUOTE_POLL_MS = 15000;
 
  const SEARCH_SVG =
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';
  const GRIP_SVG =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
 
  const els = new Map();    // symbol -> { li, last, chg, mini, miniChg }
  const quotes = new Map(); // symbol -> { price, pct }
  let wrapEl = null;
  let listEl = null;
  let miniEl = null;
 
  /* ===================== CSS ===================== */
 
  function injectStyles() {
    if (document.getElementById('watchlistStyles')) return;
    const s = document.createElement('style');
    s.id = 'watchlistStyles';
    s.textContent = `
      /* ---------- Sidebar mở rộng ---------- */
      .wl-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; }
      .wl-head { display: flex; align-items: center; justify-content: space-between;
        padding: 2px 10px 6px 16px; font-size: 10.5px; color: var(--text-secondary); }
      .wl-edit-btn { border: 1px solid var(--border-color); background: transparent; color: var(--text-secondary);
        border-radius: 999px; padding: 2px 10px; font-size: 10.5px; font-family: var(--font); cursor: pointer; }
      .wl-edit-btn:hover { color: var(--accent-blue); border-color: var(--accent-blue); }
      .wl-edit-btn.on { background: var(--accent-blue); border-color: var(--accent-blue); color: var(--on-accent); font-weight: 600; }
 
      .wl-list { list-style: none; margin: 0; padding: 0 0 8px; flex: 1; min-height: 0; overflow-y: auto; }
      .wl-item { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto 58px;
        align-items: center; column-gap: 6px; height: 38px; padding: 0 10px 0 16px; cursor: pointer;
        font-size: 12.5px; color: var(--text-primary); user-select: none; -webkit-user-select: none;
        -webkit-touch-callout: none; transition: background-color 0.12s ease; }
      .wl-list.wl-sorting .wl-item { transition: transform 0.15s ease; }
      .wl-item:hover { background: var(--bg-hover); }
      .wl-item.active { background: var(--accent-blue-soft); box-shadow: inset 2px 0 0 var(--accent-blue); }
      .wl-item.shown:not(.active)::before { content: ''; position: absolute; left: 6px; top: 50%;
        width: 4px; height: 4px; margin-top: -2px; border-radius: 50%; background: var(--text-secondary); opacity: 0.7; }
      .wl-item.wl-dragging { transition: none !important; z-index: 5; background: var(--bg-elevated);
        box-shadow: var(--shadow-md); }
 
      .wl-sym { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
      .wl-sym b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wl-tag { font-style: normal; font-size: 8.5px; line-height: 1.4; color: var(--text-secondary);
        border: 1px solid var(--border-color); border-radius: 3px; padding: 0 3px; flex-shrink: 0; }
      .wl-last { font-family: var(--font-mono); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; border-radius: 3px; }
      .wl-chg { font-family: var(--font-mono); font-size: 11px; text-align: right; font-variant-numeric: tabular-nums;
        color: var(--text-secondary); }
      .wl-chg.up { color: var(--green); }
      .wl-chg.down { color: var(--red); }
      .wl-last.flash-up { animation: wlFlashUp 0.5s ease-out; }
      .wl-last.flash-down { animation: wlFlashDown 0.5s ease-out; }
      @keyframes wlFlashUp { from { background: rgba(34, 201, 160, 0.35); } to { background: transparent; } }
      @keyframes wlFlashDown { from { background: rgba(255, 90, 103, 0.35); } to { background: transparent; } }
 
      .wl-grip { position: absolute; left: 0; top: 0; bottom: 0; width: 16px; display: none;
        align-items: center; justify-content: center; cursor: grab; touch-action: none; color: var(--text-secondary); }
      .wl-grip:active { cursor: grabbing; }
      .wl-edit .wl-grip { display: flex; }
 
      .wl-remove { display: none; background: none; border: none; color: var(--text-secondary); cursor: pointer;
        padding: 3px; border-radius: 4px; align-items: center; justify-content: center; }
      .wl-remove .icon-svg { width: 12px; height: 12px; }
      .wl-remove:hover { color: var(--red); background: var(--red-soft); }
      .wl-edit .wl-item { grid-template-columns: minmax(0, 1fr) auto 52px 22px; }
      .wl-edit .wl-remove { display: inline-flex; }
 
      @media (hover: hover) {
        .wl-item:hover .wl-grip { display: flex; }
        .wl-list:not(.wl-edit) .wl-item:hover .wl-remove { display: inline-flex; position: absolute;
          right: 6px; top: 50%; transform: translateY(-50%); background: var(--bg-hover); }
        .wl-list:not(.wl-edit) .wl-item:hover .wl-chg { visibility: hidden; }
      }
      .wl-empty { padding: 10px 14px; font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
 
      /* ---------- Nút sao trong kết quả tìm kiếm (giữ như cũ) ---------- */
      .symbol-search-item:has(.wl-add) { position: relative; padding-right: 40px; }
      .wl-add { position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
        background: none; border: none; cursor: pointer; padding: 4px; line-height: 1;
        color: var(--text-secondary); display: inline-flex; align-items: center; border-radius: 4px; }
      .wl-add .icon-svg { width: 15px; height: 15px; }
      .wl-add:hover { color: #f5c518; background: rgba(127,127,127,0.15); }
      .wl-add.on { color: #f5c518; }
      @media (hover: hover) {
        .symbol-search-item .wl-add:not(.on) { opacity: 0; }
        .symbol-search-item:hover .wl-add { opacity: 1; }
      }
 
      /* ---------- Cột mini khi sidebar THU GỌN ---------- */
      #wlMini { display: none; flex-direction: column; align-items: stretch; gap: 2px; flex: 1; min-height: 0;
        overflow-y: auto; overflow-x: hidden; padding: 6px 4px; scrollbar-width: none; }
      #wlMini::-webkit-scrollbar { width: 0; height: 0; }
      @media (min-width: 901px) {
        #sidebar.collapsed:has(#sidebarTabChart.active) #wlMini { display: flex; }
      }
      .wlm-search { height: 34px; flex-shrink: 0; border: 1px solid var(--border-color); background: var(--bg-elevated);
        color: var(--text-secondary); border-radius: 6px; cursor: pointer; display: flex; align-items: center;
        justify-content: center; margin-bottom: 4px; }
      .wlm-search:hover, .wlm-search.open { color: var(--accent-blue); border-color: var(--accent-blue); }
      .wlm-search .icon-svg { width: 16px; height: 16px; }
      .wlm-item { position: relative; flex-shrink: 0; height: 40px; border: 0; background: transparent;
        color: var(--text-primary); border-radius: 6px; cursor: pointer; font-family: var(--font);
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 0; }
      .wlm-item:hover { background: var(--bg-hover); }
      .wlm-item.active { background: var(--accent-blue-soft); }
      .wlm-item.active::before { content: ''; position: absolute; left: 0; top: 7px; bottom: 7px; width: 2px;
        border-radius: 2px; background: var(--accent-blue); }
      .wlm-item.shown:not(.active)::after { content: ''; position: absolute; right: 4px; top: 5px; width: 4px; height: 4px;
        border-radius: 50%; background: var(--text-secondary); opacity: 0.7; }
      .wlm-item b { font-size: 10.5px; font-weight: 700; letter-spacing: 0.2px; line-height: 1.1; }
      .wlm-item b sup { font-size: 7px; font-weight: 600; margin-left: 1px; color: var(--text-secondary); }
      .wlm-item i { font-style: normal; font-family: var(--font-mono); font-size: 9px; line-height: 1.1;
        color: var(--text-secondary); font-variant-numeric: tabular-nums; }
      .wlm-item i.up { color: var(--green); }
      .wlm-item i.down { color: var(--red); }
 
      /* ---------- Khung tìm kiếm nổi khi sidebar thu gọn ---------- */
      @media (min-width: 901px) {
        #sidebar.collapsed.wl-search-open .symbol-search {
          display: block !important; position: fixed; width: 300px; z-index: 1200;
          background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: var(--radius-lg);
          box-shadow: var(--shadow-md); padding: 10px;
        }
        #sidebar.collapsed.wl-search-open .symbol-search .symbol-search-results { top: 46px; left: 10px; right: 10px; }
      }
      @media (max-width: 900px) { #wlMini { display: none !important; } }
    `;
    document.head.appendChild(s);
  }
 
  /* ===================== Tiện ích ===================== */
 
  function escAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
 
  /** Tên hiển thị + nhãn nguồn. XAUUSD -> OANDA, XAUUSDT / *_PERP -> PERP. */
  function parts(sym) {
    const p = typeof getProviderFor === 'function' ? getProviderFor(sym) : 'binance';
    const name = String(sym).replace(/^OANDA:/, '').replace(/_PERP$/, '');
    const tag = p === 'oanda' ? 'OANDA' : p === 'binance_futures' ? 'PERP' : '';
    return { name, tag };
  }
 
  /** Nhãn ngắn cho cột mini: BTCUSDT -> BTC, XAUUSD -> XAU. */
  function shortLabel(sym) {
    let s = String(sym).replace(/^OANDA:/, '').replace(/_PERP$/, '');
    const t = s.replace(/USDT$/, '').replace(/USD$/, '');
    return (t || s).slice(0, 5);
  }
 
  function fmtPrice(p) {
    return typeof formatPrice === 'function' ? formatPrice(p) : String(p);
  }
  function fmtPct(p) {
    return typeof formatPercent === 'function' ? formatPercent(p) : (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
  }
  function fmtPctShort(p) {
    return (p >= 0 ? '+' : '') + p.toFixed(Math.abs(p) >= 10 ? 1 : 2) + '%';
  }
 
  function selectSymbol(sym) {
    Store.setPaneSymbol(Store.getState().activePaneId, sym);
    const sb = document.getElementById('sidebar');
    if (sb && window.innerWidth <= MOBILE_BP) sb.classList.remove('mobile-open');
  }
 
  /* ===================== Dựng khung ===================== */
 
  function ensureStructure() {
    const section = document.getElementById('sidebarChartSection');
    const sidebar = document.getElementById('sidebar');
    if (!section || !sidebar) return false;
 
    const old = document.getElementById('symbolList');
    if (old) old.style.display = 'none'; // danh sách "Phổ biến" cũ (ui.js vẫn cần phần tử này tồn tại)
    const title = section.querySelector('.sidebar-section-title');
    if (title) title.textContent = 'Watchlist';
 
    wrapEl = document.getElementById('wlWrap');
    if (!wrapEl) {
      wrapEl = document.createElement('div');
      wrapEl.id = 'wlWrap';
      wrapEl.className = 'wl-wrap';
      wrapEl.innerHTML =
        '<div class="wl-head"><span>Mã giao dịch</span><button type="button" class="wl-edit-btn" id="wlEditBtn" title="Sắp xếp / xoá mã">Sửa</button></div>' +
        '<ul id="watchlistList" class="wl-list"></ul>';
      // Đặt ngay sau tiêu đề để bấm tiêu đề thu/mở được cả danh sách
      if (title) title.after(wrapEl);
      else section.appendChild(wrapEl);
 
      const editBtn = wrapEl.querySelector('#wlEditBtn');
      editBtn.addEventListener('click', () => {
        const on = !wrapEl.querySelector('#watchlistList').classList.contains('wl-edit');
        wrapEl.querySelector('#watchlistList').classList.toggle('wl-edit', on);
        editBtn.classList.toggle('on', on);
        editBtn.textContent = on ? 'Xong' : 'Sửa';
      });
    }
    listEl = wrapEl.querySelector('#watchlistList');
 
    miniEl = document.getElementById('wlMini');
    if (!miniEl) {
      miniEl = document.createElement('div');
      miniEl.id = 'wlMini';
      const sbtn = document.createElement('button');
      sbtn.type = 'button';
      sbtn.id = 'wlMiniSearch';
      sbtn.className = 'wlm-search';
      sbtn.title = 'Tìm cặp giao dịch';
      sbtn.innerHTML = SEARCH_SVG;
      sbtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sidebar.classList.contains('wl-search-open')) closeSearchPopup();
        else openSearchPopup(sbtn);
      });
      miniEl.appendChild(sbtn);
      sidebar.appendChild(miniEl); // local-store.js sẽ chèn chân sidebar SAU phần tử này
    }
    return true;
  }
 
  /* ===================== Render danh sách ===================== */
 
  function render() {
    if (!listEl || !miniEl) return;
    els.clear();
    listEl.innerHTML = '';
    miniEl.querySelectorAll('.wlm-item').forEach((n) => n.remove());
 
    const items = Store.getWatchlist();
    if (items.length === 0) {
      listEl.innerHTML = `<li class="wl-empty">Watchlist trống. Tìm cặp giao dịch ở ô tìm kiếm rồi bấm ${iconInline('starOutline')} để thêm.</li>`;
      return;
    }
 
    items.forEach((sym) => {
      const { name, tag } = parts(sym);
 
      const li = document.createElement('li');
      li.className = 'wl-item';
      li.dataset.sym = sym;
      li.innerHTML =
        `<span class="wl-grip" title="Kéo để sắp xếp">${GRIP_SVG}</span>` +
        `<span class="wl-sym"><b>${escAttr(name)}</b>${tag ? `<i class="wl-tag">${tag}</i>` : ''}</span>` +
        '<span class="wl-last">--</span><span class="wl-chg">--</span>' +
        `<button type="button" class="wl-remove" title="Bỏ khỏi watchlist">${iconHTML('close')}</button>`;
 
      li.addEventListener('click', (e) => {
        if (e.target.closest('.wl-grip') || e.target.closest('.wl-remove')) return;
        selectSymbol(sym);
      });
      li.querySelector('.wl-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        Store.removeFromWatchlist(sym);
      });
      bindDrag(li.querySelector('.wl-grip'), li);
      listEl.appendChild(li);
 
      const mini = document.createElement('button');
      mini.type = 'button';
      mini.className = 'wlm-item';
      mini.title = parts(sym).name + (tag ? ' (' + tag + ')' : '');
      mini.innerHTML = `<b>${escAttr(shortLabel(sym))}${tag === 'PERP' ? '<sup>F</sup>' : ''}</b><i>--</i>`;
      mini.addEventListener('click', () => selectSymbol(sym));
      miniEl.appendChild(mini);
 
      els.set(sym, {
        li,
        last: li.querySelector('.wl-last'),
        chg: li.querySelector('.wl-chg'),
        mini,
        miniChg: mini.querySelector('i'),
      });
    });
 
    refreshActive();
    items.forEach((sym) => paint(sym, null));
  }
 
  function refreshActive() {
    const act = Store.getActivePane();
    const actSym = act && act.symbol;
    const shown = new Set(
      Store.getVisiblePaneIds().map((id) => {
        const p = Store.getPane(id);
        return p && p.symbol;
      })
    );
    els.forEach((e, sym) => {
      const isAct = sym === actSym;
      const isShown = !isAct && shown.has(sym);
      e.li.classList.toggle('active', isAct);
      e.li.classList.toggle('shown', isShown);
      e.mini.classList.toggle('active', isAct);
      e.mini.classList.toggle('shown', isShown);
    });
  }
 
  /* ===================== Giá / % ===================== */
 
  function setQuote(sym, price, pct) {
    if (!Number.isFinite(price)) return;
    const prev = quotes.get(sym) || null;
    const q = { price, pct: Number.isFinite(pct) ? pct : prev ? prev.pct : null };
    quotes.set(sym, q);
    paint(sym, prev);
  }
 
  function paint(sym, prev) {
    const e = els.get(sym);
    const q = quotes.get(sym);
    if (!e || !q) return;
 
    e.last.textContent = fmtPrice(q.price);
    if (prev && prev.price !== q.price) {
      const cls = q.price > prev.price ? 'flash-up' : 'flash-down';
      e.last.classList.remove('flash-up', 'flash-down');
      void e.last.offsetWidth; // chạy lại animation
      e.last.classList.add(cls);
    }
 
    const dir = q.pct === null ? '' : q.pct >= 0 ? 'up' : 'down';
    e.chg.textContent = q.pct === null ? '--' : fmtPct(q.pct);
    e.chg.className = 'wl-chg ' + dir;
    e.miniChg.textContent = q.pct === null ? '--' : fmtPctShort(q.pct);
    e.miniChg.className = dir;
 
    const { name, tag } = parts(sym);
    e.mini.title = `${name}${tag ? ' (' + tag + ')' : ''}  ${fmtPrice(q.price)}${q.pct === null ? '' : '  ' + fmtPct(q.pct)}`;
  }
 
  /* ===================== Nguồn dữ liệu giá ===================== */
 
  let feedKey = '';
  let feedsRunning = false;
  let sockets = [];
  let oandaTimer = null;
 
  function stopFeeds() {
    feedsRunning = false;
    sockets.forEach((h) => {
      h.closed = true;
      clearTimeout(h.retry);
      try { h.ws.close(); } catch (e) { /* bỏ qua */ }
    });
    sockets = [];
    clearInterval(oandaTimer);
    oandaTimer = null;
  }
 
  function openBinance(list, futures) {
    if (!list.length) return;
    const map = {};
    const streams = list.map((sym) => {
      const c = getCleanSymbol(sym);
      map[c.toUpperCase()] = sym;
      return c.toLowerCase() + '@miniTicker';
    });
    const base = futures ? 'wss://fstream.binance.com/stream?streams=' : 'wss://stream.binance.com:9443/stream?streams=';
    const h = { ws: null, closed: false, retry: null };
    try {
      h.ws = new WebSocket(base + streams.join('/'));
    } catch (e) {
      return;
    }
    h.ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        const d = m && (m.data || m);
        if (!d || !d.s || !map[d.s]) return;
        const c = parseFloat(d.c);
        const o = parseFloat(d.o);
        setQuote(map[d.s], c, o > 0 ? ((c - o) / o) * 100 : undefined);
      } catch (e) { /* bỏ qua gói lỗi */ }
    };
    h.ws.onclose = () => {
      if (h.closed) return;
      h.retry = setTimeout(() => {
        if (!h.closed) syncFeeds(true);
      }, 3000);
    };
    sockets.push(h);
  }
 
  function startOandaPoll(list) {
    if (!list.length || typeof fetch24hTicker !== 'function') return;
    const run = async () => {
      for (const sym of list) {
        if (!feedsRunning) return;
        try {
          const t = await fetch24hTicker(sym);
          setQuote(sym, t.lastPrice, t.changePercent);
        } catch (e) { /* lần sau thử lại */ }
      }
    };
    run();
    oandaTimer = setInterval(run, QUOTE_POLL_MS);
  }
 
  function startFeeds() {
    feedsRunning = true;
    const spot = [];
    const fut = [];
    const oanda = [];
    Store.getWatchlist().forEach((sym) => {
      const p = getProviderFor(sym);
      if (p === 'oanda') oanda.push(sym);
      else if (p === 'binance_futures') fut.push(sym);
      else spot.push(sym);
    });
    openBinance(spot, false);
    openBinance(fut, true);
    startOandaPoll(oanda);
  }
 
  /** Chỉ dựng lại kết nối khi TẬP symbol đổi (đổi thứ tự thì giữ nguyên). */
  function syncFeeds(force) {
    const key = Store.getWatchlist().slice().sort().join('|');
    if (!force && key === feedKey && feedsRunning) return;
    stopFeeds();
    feedKey = key;
    if (document.visibilityState === 'hidden') return;
    startFeeds();
  }
 
  /* ===================== Kéo-thả sắp xếp (chuột + cảm ứng) ===================== */
 
  function bindDrag(grip, li) {
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
 
      const list = li.parentElement;
      const rows = Array.from(list.querySelectorAll('.wl-item'));
      const from = rows.indexOf(li);
      const h = li.offsetHeight || 38;
      const startY = e.clientY;
      let to = from;
 
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* bỏ qua */ }
      li.classList.add('wl-dragging');
      list.classList.add('wl-sorting');
 
      const onMove = (ev) => {
        let dy = ev.clientY - startY;
        dy = Math.max(-from * h, Math.min((rows.length - 1 - from) * h, dy));
        li.style.transform = `translateY(${dy}px)`;
        to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
        rows.forEach((r, i) => {
          if (r === li) return;
          let shift = 0;
          if (from < to && i > from && i <= to) shift = -h;
          else if (from > to && i >= to && i < from) shift = h;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
 
      const finish = (commit) => {
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onUp);
        grip.removeEventListener('pointercancel', onCancel);
        rows.forEach((r) => {
          r.style.transform = '';
          r.classList.remove('wl-dragging');
        });
        list.classList.remove('wl-sorting');
        if (commit && to !== from) {
          const order = rows.map((r) => r.dataset.sym);
          order.splice(from, 1);
          order.splice(to, 0, li.dataset.sym);
          if (typeof Store.reorderWatchlist === 'function') Store.reorderWatchlist(order);
        }
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
 
      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onUp);
      grip.addEventListener('pointercancel', onCancel);
    });
  }
 
  /* ===================== Tìm kiếm nổi khi sidebar thu gọn ===================== */
 
  function openSearchPopup(anchor) {
    const sb = document.getElementById('sidebar');
    const box = sb && sb.querySelector('.symbol-search');
    if (!sb || !box || !sb.classList.contains('collapsed')) return;
    const r = anchor.getBoundingClientRect();
    sb.classList.add('wl-search-open');
    box.style.top = Math.max(8, r.top) + 'px';
    box.style.left = r.right + 8 + 'px';
    anchor.classList.add('open');
    const inp = document.getElementById('symbolSearchInput');
    if (inp) setTimeout(() => inp.focus(), 0);
  }
 
  function closeSearchPopup() {
    const sb = document.getElementById('sidebar');
    if (!sb || !sb.classList.contains('wl-search-open')) return;
    const box = sb.querySelector('.symbol-search');
    sb.classList.remove('wl-search-open');
    if (box) {
      box.style.top = '';
      box.style.left = '';
    }
    const btn = document.getElementById('wlMiniSearch');
    if (btn) btn.classList.remove('open');
    const res = document.getElementById('symbolSearchResults');
    if (res) res.classList.add('hidden');
  }
 
  function bindSearchPopup() {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
 
    document.addEventListener('click', (e) => {
      if (!sb.classList.contains('wl-search-open')) return;
      if (e.target.closest('.symbol-search') || e.target.closest('#wlMiniSearch')) return;
      closeSearchPopup();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sb.classList.contains('wl-search-open')) closeSearchPopup();
    });
    // Chọn xong 1 mã trong kết quả -> đóng khung nổi (bấm sao thì giữ nguyên)
    const res = document.getElementById('symbolSearchResults');
    if (res) {
      res.addEventListener('click', (e) => {
        if (e.target.closest('.wl-add')) return;
        if (e.target.closest('.symbol-search-item[data-symbol]')) setTimeout(closeSearchPopup, 0);
      });
    }
    // Mở rộng sidebar lại -> khung nổi không còn cần
    new MutationObserver(() => {
  if (!sb.classList.contains('collapsed') && sb.classList.contains('wl-search-open')) {
    closeSearchPopup();
  }
}).observe(sb, { attributes: true, attributeFilter: ['class'] });
  }
 
  /* ===================== Kết quả tìm kiếm: nút sao ===================== */
 
  function starHTML(symbol) {
    const on = Store.isInWatchlist(symbol);
    return `<button type="button" class="wl-add${on ? ' on' : ''}" data-wl-symbol="${escAttr(symbol)}" title="${on ? 'Bỏ khỏi watchlist' : 'Thêm vào watchlist'}">${iconHTML(on ? 'star' : 'starOutline')}</button>`;
  }
 
  function refreshSearchStars() {
    document.querySelectorAll('#symbolSearchResults .wl-add').forEach((btn) => {
      const sym = btn.dataset.wlSymbol;
      const on = Store.isInWatchlist(sym);
      btn.classList.toggle('on', on);
      btn.innerHTML = iconHTML(on ? 'star' : 'starOutline');
      btn.title = on ? 'Bỏ khỏi watchlist' : 'Thêm vào watchlist';
    });
  }
 
  /** Bắt sự kiện ở pha CAPTURE: bấm sao thì xử lý và chặn, listener "chọn symbol" của ui.js không chạy. */
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
    box.addEventListener('mousedown', (e) => {
      if (e.target.closest('.wl-add')) e.preventDefault();
    }, true);
  }
 
  function removeOldPaneStars() {
    document.querySelectorAll('.pane-symbol-row .wl-star').forEach((el) => el.remove());
  }
 
  /* ===================== Khởi tạo ===================== */
 
  function onWatchlistChanged() {
    render();
    refreshSearchStars();
    syncFeeds(false);
  }
 
  function init() {
    injectStyles();
    removeOldPaneStars();
    if (!ensureStructure()) return;
    render();
    bindSearchResults();
    bindSearchPopup();
 
    EventBus.on('watchlist:changed', onWatchlistChanged);
    EventBus.on('pane:symbolChanged', () => {
      refreshActive();
      closeSearchPopup();
    });
    EventBus.on('pane:focused', refreshActive);
    EventBus.on('layout:changed', refreshActive);
 
    // OANDA: ô chart đang hiện mã này có giá realtime hơn -> dùng luôn
    EventBus.on('pane:priceChanged', ({ paneId, price, changePercent }) => {
      const p = Store.getPane(paneId);
      if (!p || !Store.isInWatchlist(p.symbol)) return;
      if (getProviderFor(p.symbol) !== 'oanda') return;
      setQuote(p.symbol, price, changePercent);
    });
 
    // Tab ẩn -> ngắt kết nối cho nhẹ pin; hiện lại -> nối lại
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stopFeeds();
      else syncFeeds(true);
    });
 
    syncFeeds(true);
  }
 
  init();
  return { refresh: onWatchlistChanged, starHTML };
})();