/**
 * ui.js
 * Render sidebar (danh sách symbol + tìm kiếm) - DÙNG CHUNG cho cả 4 pane,
 * nhưng khi chọn 1 symbol thì áp dụng cho PANE ĐANG FOCUS (activePaneId).
 *
 * ============================================================================
 * CẬP NHẬT (đợt nâng cấp "bộ công cụ vẽ chuyên nghiệp" - THU GỌN TOOLBAR):
 *
 *   Trước đây mỗi công cụ vẽ là 1 nút riêng trong #sharedDrawGroup -> với
 *   ~20 công cụ mới sẽ tràn dòng, đặc biệt trên mobile. Giờ thanh công cụ
 *   chỉ còn CỐ ĐỊNH 5 nút, không phụ thuộc số lượng công cụ:
 *
 *     [↖ Con trỏ] [ icon-công-cụ-vẽ ▾ ] [🔔 Cảnh báo] [⌫ Tẩy] [🗑 Xoá hết]
 *
 *   Nút "combo" ở giữa LUÔN hiện icon của công cụ vẽ hình đang dùng/gần
 *   nhất (mặc định Đường xu hướng) - bấm vào là chọn lại đúng công cụ đó
 *   ngay lập tức (không cần mở bảng), giống hành vi "nhớ công cụ cuối" của
 *   TradingView. Bấm mũi tên ▾ cạnh bên mới MỞ BẢNG (flyout) liệt kê toàn
 *   bộ công cụ theo từng NHÓM (Đường kẻ / Fibonacci / Hình vẽ / Lệnh giao
 *   dịch / Ghi chú) - bảng này định vị TUYỆT ĐỐI (position: fixed) ngay
 *   dưới nút, tự dịch vào trong nếu gần sát mép màn hình, và tự đóng khi
 *   chọn xong 1 công cụ hoặc bấm ra ngoài - xem hideFlyout()/toggleFlyout().
 *
 *   Cảnh báo giá (🔔) và Tẩy (⌫) vẫn giữ làm nút riêng vì là 2 công cụ dùng
 *   RẤT thường xuyên, không đáng để giấu vào trong bảng.
 * ============================================================================
 */

const UI = (function () {
  let searchDebounceTimer = null;

  // Công cụ vẽ HÌNH (không tính cursor/alert/eraser/clear) - nhóm theo danh
  // mục để hiển thị trong bảng chọn (flyout). id phải khớp CHÍNH XÁC với
  // "currentTool" mà drawing.js hiểu.
  const DRAW_TOOL_CATEGORIES = [
    {
      id: 'lines', label: 'Đường kẻ',
      tools: [
        { id: 'trendline', label: '╱', title: 'Đường xu hướng' },
        { id: 'ray', label: '↗', title: 'Tia (Ray)' },
        { id: 'extendedline', label: '↔', title: 'Đường mở rộng' },
        { id: 'hline', label: '─', title: 'Đường ngang' },
        { id: 'hray', label: '⟶', title: 'Tia ngang' },
        { id: 'vline', label: '│', title: 'Đường dọc' },
      ],
    },
    {
      id: 'fib', label: 'Fibonacci',
      tools: [
        { id: 'fib', label: '𝄒', title: 'Thoái lui Fibonacci' },
        { id: 'fibextension', label: 'F+', title: 'Mở rộng Fibonacci (Fib Extension)' },
      ],
    },
    {
      id: 'shapes', label: 'Hình vẽ & Kênh giá',
      tools: [
        { id: 'rectangle', label: '▭', title: 'Hình chữ nhật' },
        { id: 'circle', label: '◯', title: 'Hình tròn / Ellipse' },
        { id: 'triangle', label: '△', title: 'Tam giác' },
        { id: 'channel', label: '≋', title: 'Kênh giá song song' },
      ],
    },
    {
      id: 'position', label: 'Lệnh giao dịch',
      tools: [
        { id: 'long', label: 'L↑', title: 'Lệnh Long (tự tính TP theo R:R)' },
        { id: 'short', label: 'S↓', title: 'Lệnh Short (tự tính TP theo R:R)' },
      ],
    },
    {
      id: 'annotate', label: 'Ghi chú',
      tools: [
        { id: 'text', label: 'Ｔ', title: 'Chữ / Ghi chú' },
        { id: 'arrow', label: '➔', title: 'Mũi tên' },
      ],
    },
  ];

  let lastDrawShapeTool = 'trendline'; // nhớ công cụ vẽ hình gần nhất để hiện icon trên nút combo
  let flyoutEl = null;

  function findToolMeta(id) {
    for (const cat of DRAW_TOOL_CATEGORIES) {
      const t = cat.tools.find((t) => t.id === id);
      if (t) return t;
    }
    return null;
  }

  function init() {
    renderPopularSymbols();
    renderLayoutButtons();
    renderSharedTimeframeGroup();
    renderSharedDrawGroup();
    bindSymbolSearch();
    bindPaneFocusClicks();
    bindPaneHeaderTexts();
    bindPriceUpdates();
    bindConnectionStatus();
    bindPaneFocusedEvent();
    bindLayoutChangedEvent();
    bindOrientationChangedEvent();
    bindDrawToolChanged();

    LayoutModule.initOrientationWatcher();
    LayoutModule.render();
    highlightActivePaneBorder(Store.getState().activePaneId);
  }

  /* ===================== SIDEBAR: DANH SÁCH SYMBOL ===================== */

  function renderPopularSymbols() {
    const state = Store.getState();
    const activeSymbol = Store.getActivePane().symbol;
    const listEl = document.getElementById('symbolList');
    listEl.innerHTML = '';

    state.popularSymbols.forEach((symbol) => {
      const li = document.createElement('li');
      li.dataset.symbol = symbol;
      li.className = symbol === activeSymbol ? 'active' : '';
      const isFutures = symbol.endsWith('_PERP');
      const displayName = isFutures ? symbol.replace('_PERP', ' (Futures)') : symbol;
      li.innerHTML = `
        <span class="sym-name">${displayName}</span>
        <span class="sym-price" data-symbol-price="${symbol}">--</span>
      `;
      li.addEventListener('click', () => selectSymbol(symbol));
      listEl.appendChild(li);
    });
  }

  function selectSymbol(symbol) {
    document.getElementById('symbolSearchResults').classList.add('hidden');
    document.getElementById('symbolSearchInput').value = '';
    const paneId = Store.getState().activePaneId;
    Store.setPaneSymbol(paneId, symbol);
  }

  function bindSymbolSearch() {
    const input = document.getElementById('symbolSearchInput');
    const resultsEl = document.getElementById('symbolSearchResults');

    input.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      const query = input.value.trim().toUpperCase();

      if (!query) {
        resultsEl.classList.add('hidden');
        return;
      }

      searchDebounceTimer = setTimeout(async () => {
        const matches = await searchSymbols(query);
        renderSearchResults(matches, resultsEl);
      }, 250);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.symbol-search')) {
        resultsEl.classList.add('hidden');
      }
    });
  }

  async function searchSymbols(query) {
    const state = Store.getState();
    if (state.allSymbols.length === 0) {
      try {
        const all = await fetchAllSymbols();
        Store.setAllSymbols(all);
      } catch (err) {
        console.error('Không tải được danh sách symbol:', err);
      }
    }

    const binanceMatches = state.allSymbols
      .filter((s) => s.includes(query))
      .slice(0, 8)
      .map((s) => {
        const isFutures = s.endsWith('_PERP');
        const cleanSymbol = isFutures ? s.replace('_PERP', '') : s;
        return {
          symbol: s,
          display: cleanSymbol,
          source: isFutures ? 'Binance Futures' : 'Binance Spot',
        };
      });

    let yahooMatches = [];
    try {
      const results = await searchYahooSymbols(query);
      yahooMatches = results.map((item) => ({
        symbol: item.symbol,
        display: item.symbol,
        name: item.name,
        source: `Yahoo · ${item.exchange}`,
      }));
    } catch (err) {
      console.error('Yahoo search error:', err);
    }

    return [...binanceMatches, ...yahooMatches].slice(0, 20);
  }

  function renderSearchResults(matches, resultsEl) {
    if (matches.length === 0) {
      resultsEl.innerHTML = '<div class="symbol-search-item">Không tìm thấy</div>';
    } else {
      resultsEl.innerHTML = matches
        .map(
          (m) => `
        <div class="symbol-search-item" data-symbol="${m.symbol}">
          <div class="ssi-main">
            <span class="ssi-symbol">${m.display}</span>
            ${m.name ? `<span class="ssi-name">${m.name}</span>` : ''}
          </div>
          <span class="ssi-source">${m.source}</span>
        </div>`
        )
        .join('');
      resultsEl.querySelectorAll('.symbol-search-item[data-symbol]').forEach((el) => {
        el.addEventListener('click', () => selectSymbol(el.dataset.symbol));
      });
    }
    resultsEl.classList.remove('hidden');
  }

  /* ===================== HÀNG TIMEFRAME DÙNG CHUNG ===================== */

  function renderSharedTimeframeGroup() {
    const groupEl = document.getElementById('sharedTimeframeGroup');
    if (!groupEl) return;
    const activePane = Store.getActivePane();
    groupEl.innerHTML = '';

    const quickGroup = document.createElement('div');
    quickGroup.className = 'timeframe-quick-btns';

    const popular = [
      { label: '15m', value: '15m' },
      { label: '1H', value: '1h' },
      { label: '4H', value: '4h' },
      { label: '1D', value: '1d' }
    ];

    popular.forEach((tf) => {
      const btn = document.createElement('button');
      btn.className = 'timeframe-btn' + (tf.value === activePane.timeframe ? ' active' : '');
      btn.textContent = tf.label;
      btn.addEventListener('click', () => {
        Store.setPaneTimeframe(Store.getState().activePaneId, tf.value);
      });
      quickGroup.appendChild(btn);
    });
    groupEl.appendChild(quickGroup);

    const select = document.createElement('select');
    select.className = 'timeframe-select';

    TIMEFRAMES.forEach((tf) => {
      const opt = document.createElement('option');
      opt.value = tf.value;
      opt.textContent = tf.label;
      opt.selected = tf.value === activePane.timeframe;
      select.appendChild(opt);
    });

    select.addEventListener('change', (e) => {
      Store.setPaneTimeframe(Store.getState().activePaneId, e.target.value);
    });

    groupEl.appendChild(select);
  }

  /* ===================== HÀNG CÔNG CỤ VẼ DÙNG CHUNG (THU GỌN) ===================== */

  function hideFlyout() {
    if (flyoutEl) {
      flyoutEl.remove();
      flyoutEl = null;
    }
    document.removeEventListener('click', onDocClickCloseFlyout, true);
  }

  function onDocClickCloseFlyout(e) {
    if (flyoutEl && !flyoutEl.contains(e.target)) hideFlyout();
  }

  function getActiveDrawingInstance() {
    return window.PaneRegistry && window.PaneRegistry.get(Store.getState().activePaneId);
  }

  function selectDrawTool(id) {
    const inst = getActiveDrawingInstance();
    hideFlyout();
    if (!inst) return;
    if (id === 'clear') {
      inst.getDrawing().clearAll();
      return;
    }
    if (findToolMeta(id)) lastDrawShapeTool = id;
    inst.getDrawing().setTool(id);
    renderSharedDrawGroup();
  }

  function toggleFlyout(anchorBtn) {
    if (flyoutEl) { hideFlyout(); return; }

    flyoutEl = document.createElement('div');
    flyoutEl.className = 'draw-flyout';

    DRAW_TOOL_CATEGORIES.forEach((cat) => {
      const catEl = document.createElement('div');
      catEl.className = 'draw-flyout-category';

      const title = document.createElement('div');
      title.className = 'draw-flyout-category-title';
      title.textContent = cat.label;
      catEl.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'draw-flyout-grid';
      cat.tools.forEach((t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'draw-flyout-item' + (t.id === lastDrawShapeTool ? ' active' : '');
        b.innerHTML = `<span class="dfi-icon">${t.label}</span><span class="dfi-label">${t.title}</span>`;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          selectDrawTool(t.id);
        });
        grid.appendChild(b);
      });
      catEl.appendChild(grid);
      flyoutEl.appendChild(catEl);
    });

    document.body.appendChild(flyoutEl);
    positionFlyout(flyoutEl, anchorBtn);

    // Đăng ký sau 1 tick để tránh chính cú click MỞ flyout lọt luôn vào
    // listener đóng flyout (bubbling lên document ngay trong cùng 1 sự kiện).
    setTimeout(() => {
      document.addEventListener('click', onDocClickCloseFlyout, true);
    }, 0);
  }

  function positionFlyout(el, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    el.style.position = 'fixed';
    el.style.visibility = 'hidden';
    el.style.top = '0px';
    el.style.left = '0px';

    requestAnimationFrame(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;

      let left = rect.left;
      let top = rect.bottom + 6;

      if (left + w > vw - 8) left = vw - w - 8;
      if (left < 8) left = 8;
      if (top + h > vh - 8) top = Math.max(8, rect.top - h - 6);

      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.visibility = 'visible';
    });
  }

  function makeToolbarBtn(label, title, active, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'draw-tool-btn' + (active ? ' active' : '');
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderSharedDrawGroup() {
    const groupEl = document.getElementById('sharedDrawGroup');
    if (!groupEl) return;
    groupEl.innerHTML = '';
    hideFlyout();

    const inst = getActiveDrawingInstance();
    const drawing = inst ? inst.getDrawing() : null;
    const activeTool = drawing ? drawing.getTool() : 'cursor';

    if (findToolMeta(activeTool)) lastDrawShapeTool = activeTool;

    // 1. Con trỏ
    groupEl.appendChild(makeToolbarBtn('↖', 'Con trỏ', activeTool === 'cursor', () => selectDrawTool('cursor')));

    // 2. Combo: icon công cụ vẽ hình gần nhất + mũi tên mở bảng chọn
    const meta = findToolMeta(lastDrawShapeTool) || { label: '╱', title: 'Đường xu hướng' };
    const combo = document.createElement('div');
    combo.className = 'draw-tool-combo';

    const mainBtn = makeToolbarBtn(
      meta.label,
      meta.title + ' (bấm mũi tên bên phải để chọn công cụ khác)',
      activeTool === lastDrawShapeTool,
      () => selectDrawTool(lastDrawShapeTool)
    );
    mainBtn.classList.add('draw-tool-combo-main');

    const caretBtn = document.createElement('button');
    caretBtn.type = 'button';
    caretBtn.className = 'draw-tool-btn draw-tool-combo-caret';
    caretBtn.textContent = '▾';
    caretBtn.title = 'Chọn công cụ vẽ khác';
    caretBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFlyout(caretBtn);
    });

    combo.appendChild(mainBtn);
    combo.appendChild(caretBtn);
    groupEl.appendChild(combo);

    // 3. Cảnh báo giá
    groupEl.appendChild(makeToolbarBtn('🔔', 'Đặt cảnh báo giá (click lên chart)', activeTool === 'alert', () => selectDrawTool('alert')));

    // 4. Tẩy
    groupEl.appendChild(makeToolbarBtn('⌫', 'Tẩy / Xoá từng hình (click vào hình)', activeTool === 'eraser', () => selectDrawTool('eraser')));

    // 5. Ẩn/hiện tất cả hình vẽ (giống icon 👁 "Hide all drawings" của
    // TradingView) - không đổi tool, chỉ bật/tắt hiển thị.
    const isHidden = drawing ? drawing.getAllHidden() : false;
    const hideBtn = makeToolbarBtn(isHidden ? '🙈' : '👁', isHidden ? 'Đang ẩn tất cả hình vẽ - bấm để hiện lại' : 'Ẩn tạm thời tất cả hình vẽ (ô đang chọn)', isHidden, () => {
      if (!drawing) return;
      drawing.setAllHidden(!isHidden);
      renderSharedDrawGroup();
    });
    groupEl.appendChild(hideBtn);

    // 6. Xoá tất cả (hành động, không phải tool)
    groupEl.appendChild(makeToolbarBtn('🗑', 'Xoá tất cả hình vẽ (ô đang chọn)', false, () => selectDrawTool('clear')));
  }

  /* ===================== LAYOUT (1/2/3/4 Ô) ===================== */

  function renderLayoutButtons() {
    const groupEl = document.getElementById('layoutGroup');
    if (!groupEl) return;
    groupEl.innerHTML = '';

    const orientation = Store.getState().orientation;
    const labels = { '1': '1 ô', '2': '2 ô', '3': '3 ô', '4': '4 ô' };

    LayoutModule.getAvailableLayouts(orientation).forEach((n) => {
      const btn = document.createElement('button');
      btn.className = 'timeframe-btn' + (n === Store.getState().layout ? ' active' : '');
      btn.dataset.layout = n;
      btn.innerHTML = n + '<span class="btn-text"> ô</span>';
      btn.title = `Chọn layout ${n} ô`;
      btn.addEventListener('click', () => Store.setLayout(n));
      groupEl.appendChild(btn);
    });
  }

  function highlightActiveLayoutButton(layout) {
    const groupEl = document.getElementById('layoutGroup');
    if (!groupEl) return;
    groupEl.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === String(layout));
    });
  }

  function bindLayoutChangedEvent() {
    EventBus.on('layout:changed', ({ layout }) => highlightActiveLayoutButton(layout));
  }

  function bindOrientationChangedEvent() {
    EventBus.on('orientation:changed', () => renderLayoutButtons());
  }

  /* ===================== FOCUS / HEADER PANE ===================== */

  function bindPaneFocusClicks() {
    Store.getState().panes.forEach((pane) => {
      const el = document.getElementById(pane.id);
      if (!el) return;
      el.addEventListener('click', () => Store.setActivePane(pane.id));
    });
  }

  function highlightActivePaneBorder(activePaneId) {
    Store.getState().panes.forEach((pane) => {
      const el = document.getElementById(pane.id);
      if (el) el.classList.toggle('pane-focused', pane.id === activePaneId);
    });
  }

  function bindPaneFocusedEvent() {
    EventBus.on('pane:focused', ({ paneId }) => {
      highlightActivePaneBorder(paneId);
      renderPopularSymbols();
      renderSharedTimeframeGroup();
      renderSharedDrawGroup();
    });
  }

  function bindPaneHeaderTexts() {
    Store.getState().panes.forEach((pane) => updatePaneSymbolText(pane.id, pane.symbol));

    EventBus.on('pane:symbolChanged', ({ paneId, symbol }) => {
      updatePaneSymbolText(paneId, symbol);
      if (paneId === Store.getState().activePaneId) renderPopularSymbols();
    });

    EventBus.on('pane:timeframeChanged', ({ paneId }) => {
      if (paneId === Store.getState().activePaneId) renderSharedTimeframeGroup();
    });
  }

  function updatePaneSymbolText(paneId, symbol) {
    const el = document.getElementById(`${paneId}-symbol`);
    if (el) {
      const isFutures = symbol.endsWith('_PERP');
      const displayName = isFutures ? symbol.replace('_PERP', ' (Futures)') : symbol;
      el.textContent = displayName;
    }
  }

  /* ===================== GIÁ / TRẠNG THÁI KẾT NỐI ===================== */

  function bindPriceUpdates() {
    EventBus.on('pane:priceChanged', ({ paneId, price, changePercent }) => {
      updatePanePriceUI(paneId, price, changePercent);
    });
  }

  function updatePanePriceUI(paneId, price, changePercent) {
    const pane = Store.getPane(paneId);
    if (!pane) return;

    const priceEl = document.getElementById(`${paneId}-price`);
    const changeEl = document.getElementById(`${paneId}-change`);

    if (priceEl) priceEl.textContent = formatPrice(price);

    if (changeEl && changePercent !== undefined && changePercent !== null) {
      changeEl.textContent = formatPercent(changePercent);
      changeEl.className = 'change ' + (changePercent >= 0 ? 'up' : 'down');
    }

    const sidebarPriceEl = document.querySelector(`[data-symbol-price="${pane.symbol}"]`);
    if (sidebarPriceEl) {
      sidebarPriceEl.textContent = formatPrice(price);
      sidebarPriceEl.className = 'sym-price ' + (changePercent >= 0 ? 'up' : changePercent < 0 ? 'down' : '');
    }
  }

  function bindConnectionStatus() {
    EventBus.on('ws:status', ({ paneId, status }) => {
      const el = document.getElementById(`${paneId}-status`);
      if (!el) return;
      el.className = 'connection-status ' + status;
      el.textContent =
        status === 'connected' ? 'Đã kết nối' : status === 'disconnected' ? 'Mất kết nối...' : 'Đang kết nối...';
    });
  }

  function bindDrawToolChanged() {
    EventBus.on('pane:drawToolChanged', ({ paneId }) => {
      if (paneId === Store.getState().activePaneId) renderSharedDrawGroup();
    });
  }

  return { init, renderSharedDrawGroup, renderSharedTimeframeGroup };
})();