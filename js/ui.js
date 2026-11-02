/**
 * ui.js
 * Render sidebar (danh sách symbol + tìm kiếm) - DÙNG CHUNG cho cả 4 pane,
 * nhưng khi chọn 1 symbol thì áp dụng cho PANE ĐANG FOCUS (activePaneId).
 *
 * ============================================================================
 * THANH CÔNG CỤ VẼ (THU GỌN) - chỉ còn nút cố định, không phụ thuộc số công cụ:
 *
 *     [↖ Con trỏ] [ icon-công-cụ-vẽ ▾ ] [🔔 Cảnh báo] [⌫ Tẩy] [👁 Ẩn/hiện] [🗑 Xoá hết]
 *
 *   Nút "combo" ở giữa hiện icon công cụ vẽ hình đang dùng/gần nhất - bấm vào là
 *   chọn lại đúng công cụ đó ngay (không cần mở bảng). Bấm mũi tên ▾ để mở BẢNG
 *   (flyout) liệt kê toàn bộ công cụ theo nhóm.
 *
 * CẬP NHẬT - NHỚ STYLE THEO CÔNG CỤ (xem drawing.js):
 *   - Nút combo hiện chấm màu = màu đã nhớ của công cụ đang chọn.
 *   - Trong bảng, công cụ nào đã có style nhớ sẽ có chấm xanh nhỏ ở góc icon.
 *   - Chân bảng có nút "Đặt lại style đã nhớ" (xoá style nhớ của TẤT CẢ công cụ).
 *   - Tự cập nhật khi drawing.js phát sự kiện 'drawing:styleChanged'.
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
        { id: 'trendline', icon: 'trendline', title: 'Đường xu hướng' },
        { id: 'ray', icon: 'ray', title: 'Tia (Ray)' },
        { id: 'extendedline', icon: 'extendedline', title: 'Đường mở rộng' },
        { id: 'hline', icon: 'hline', title: 'Đường ngang' },
        { id: 'hray', icon: 'hray', title: 'Tia ngang' },
        { id: 'vline', icon: 'vline', title: 'Đường dọc' },
      ],
    },
    {
      id: 'fib', label: 'Fibonacci',
      tools: [
        { id: 'fib', icon: 'fib', title: 'Thoái lui Fibonacci' },
        { id: 'fibextension', icon: 'fibextension', title: 'Mở rộng Fibonacci (Fib Extension)' },
      ],
    },
    {
      id: 'shapes', label: 'Hình vẽ & Kênh giá',
      tools: [
        { id: 'rectangle', icon: 'rectangle', title: 'Hình chữ nhật' },
        { id: 'circle', icon: 'circle', title: 'Hình tròn / Ellipse' },
        { id: 'triangle', icon: 'triangle', title: 'Tam giác' },
        { id: 'channel', icon: 'channel', title: 'Kênh giá song song' },
      ],
    },
    {
      id: 'position', label: 'Lệnh giao dịch',
      tools: [
        { id: 'long', icon: 'long', title: 'Lệnh Long (tự tính TP theo R:R)' },
        { id: 'short', icon: 'short', title: 'Lệnh Short (tự tính TP theo R:R)' },
      ],
    },
    {
      id: 'annotate', label: 'Ghi chú',
      tools: [
        { id: 'text', icon: 'text', title: 'Chữ / Ghi chú' },
        { id: 'arrow', icon: 'arrow', title: 'Mũi tên' },
      ],
    },
  ];

  let lastDrawShapeTool = 'trendline'; // nhớ công cụ vẽ hình gần nhất để hiện icon trên nút combo
  let flyoutEl = null;
  let flyoutAnchor = null; // nút mũi tên đã mở bảng

  // CSS nhỏ cho chấm màu / dấu "đã nhớ style" / nút đặt lại (tự nạp, không cần sửa file css)
  const UI_EXTRA_CSS = `
.draw-tool-btn.has-color-dot{position:relative}
.draw-tool-btn.has-color-dot::after{content:'';position:absolute;right:3px;bottom:3px;width:7px;height:7px;border-radius:50%;background:var(--dot-color,#f2a339);border:1px solid var(--bg-elevated,#1a1d26);pointer-events:none}
.draw-flyout-item .dfi-icon{position:relative}
.draw-flyout-item.has-style .dfi-icon::after{content:'';position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:var(--accent-blue,#2962ff)}
.draw-flyout-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:10px;border-top:1px solid var(--border-color,rgba(255,255,255,.12))}
.draw-flyout-hint{font-size:10.5px;color:var(--text-secondary,#9aa3b8);line-height:1.3}
.draw-flyout-reset{flex-shrink:0;background:transparent;border:1px solid var(--border-color,rgba(255,255,255,.2));color:var(--text-primary,#fff);border-radius:8px;padding:6px 10px;font-size:11.5px;cursor:pointer}
.draw-flyout-reset:disabled{opacity:.4;cursor:default}
@media (hover:hover){.draw-flyout-reset:not(:disabled):hover{background:var(--bg-hover,rgba(255,255,255,.08))}}
`;

  function ensureUiStyles() {
    if (document.getElementById('ui-extra-styles')) return;
    const st = document.createElement('style');
    st.id = 'ui-extra-styles';
    st.textContent = UI_EXTRA_CSS;
    document.head.appendChild(st);
  }

  /** Style đã nhớ của 1 công cụ (rỗng nếu chưa có hoặc drawing.js chưa nạp). */
  function getRememberedStyle(toolId) {
    if (typeof DrawingModule === 'undefined' || typeof DrawingModule.getToolStyle !== 'function') return {};
    try {
      return DrawingModule.getToolStyle(toolId) || {};
    } catch (e) {
      return {};
    }
  }

  function hasRememberedStyle(toolId) {
    return Object.keys(getRememberedStyle(toolId)).length > 0;
  }

  function findToolMeta(id) {
    for (const cat of DRAW_TOOL_CATEGORIES) {
      const t = cat.tools.find((t) => t.id === id);
      if (t) return t;
    }
    return null;
  }

  function bindSectionTitleCollapses() {
    document.querySelectorAll('.sidebar-section-title').forEach((titleEl) => {
      if (titleEl.dataset.collapseBound) return;
      titleEl.dataset.collapseBound = 'true';
      titleEl.addEventListener('click', () => {
        titleEl.classList.toggle('collapsed-title');
      });
    });
  }

  function init() {
    ensureUiStyles();
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
    bindSectionTitleCollapses();

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
      const isOanda = symbol === 'XAUUSD' || symbol.startsWith('OANDA:');
      let displayName = symbol;
      if (isFutures) {
        displayName = symbol.replace('_PERP', ' (Futures)');
      } else if (isOanda) {
        displayName = symbol.replace('OANDA:', '') + ' (OANDA)';
      }
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

    let oandaMatches = [];
    try {
      const oandaResults = await searchOandaSymbols(query);
      oandaMatches = (oandaResults || []).map((item) => ({
        symbol: item.id || `OANDA:${item.symbol}`,
        display: item.symbol || item.id,
        name: item.description || item.name || '',
        source: 'OANDA',
      }));
    } catch (err) {
      console.error('OANDA search error:', err);
    }

    // Đảm bảo XAUUSD OANDA luôn hiển thị khi tìm vàng/gold/xau
    const qUpper = query.trim().toUpperCase();
    if (['XAU', 'GOLD', 'VÀNG', 'VANG'].some((k) => qUpper.includes(k))) {
      const hasXAU = oandaMatches.some(
        (m) => m.display === 'XAUUSD' || m.symbol === 'XAUUSD' || m.symbol === 'OANDA:XAUUSD'
      );
      if (!hasXAU) {
        oandaMatches.unshift({
          symbol: 'XAUUSD',
          display: 'XAUUSD',
          name: 'Vàng (Gold CFD - OANDA)',
          source: 'OANDA',
        });
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

    return [...oandaMatches, ...binanceMatches].slice(0, 20);
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
    flyoutAnchor = null;
    document.removeEventListener('click', onDocClickCloseFlyout, true);
  }

  function onDocClickCloseFlyout(e) {
    if (!flyoutEl) return;
    if (flyoutEl.contains(e.target)) return;
    // Bấm lại đúng nút mũi tên: để toggleFlyout tự đóng, tránh đóng rồi mở lại
    if (flyoutAnchor && flyoutAnchor.contains(e.target)) return;
    hideFlyout();
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
    flyoutAnchor = anchorBtn;

    let anyRemembered = false;

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
        const remembered = hasRememberedStyle(t.id);
        if (remembered) anyRemembered = true;

        const b = document.createElement('button');
        b.type = 'button';
        b.className =
          'draw-flyout-item' + (t.id === lastDrawShapeTool ? ' active' : '') + (remembered ? ' has-style' : '');
        b.title = remembered ? t.title + ' - đã nhớ style của bạn' : t.title;
        const iconSvg = (typeof Icons !== 'undefined' && Icons[t.icon]) ? Icons[t.icon] : (t.label || '');
        b.innerHTML = `<span class="dfi-icon">${iconSvg}</span><span class="dfi-label">${t.title}</span>`;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          selectDrawTool(t.id);
        });
        grid.appendChild(b);
      });
      catEl.appendChild(grid);
      flyoutEl.appendChild(catEl);
    });

    // Chân bảng: đặt lại toàn bộ style đã nhớ
    const footer = document.createElement('div');
    footer.className = 'draw-flyout-footer';
    footer.innerHTML = '<span class="draw-flyout-hint">Chấm xanh = công cụ đã nhớ style của bạn</span>';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'draw-flyout-reset';
    resetBtn.textContent = 'Đặt lại style đã nhớ';
    resetBtn.disabled = !anyRemembered;
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Xoá style đã nhớ của TẤT CẢ công cụ vẽ? (Hình đã vẽ không bị ảnh hưởng)')) return;
      hideFlyout();
      if (typeof DrawingModule !== 'undefined' && typeof DrawingModule.resetToolStyles === 'function') {
        DrawingModule.resetToolStyles();
      }
    });
    footer.appendChild(resetBtn);
    flyoutEl.appendChild(footer);

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

  // Nút thanh công cụ: hỗ trợ cả icon SVG lẫn text
  function makeToolbarBtn(labelOrIcon, title, active, onClick, isIcon) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'draw-tool-btn' + (active ? ' active' : '');
    if (isIcon && Icons[labelOrIcon]) {
      setIcon(btn, labelOrIcon);
    } else {
      btn.textContent = labelOrIcon;
    }
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

    // 1. Con trỏ - dùng icon SVG
    groupEl.appendChild(makeToolbarBtn('cursor', 'Con trỏ', activeTool === 'cursor', () => selectDrawTool('cursor'), true));

    // 2. Combo: icon công cụ vẽ hình gần nhất + mũi tên mở bảng chọn
    const meta = findToolMeta(lastDrawShapeTool) || { icon: 'trendline', title: 'Đường xu hướng' };
    const combo = document.createElement('div');
    combo.className = 'draw-tool-combo';

    const iconKey = meta.icon || meta.id || 'trendline';
    const mainBtn = makeToolbarBtn(
      iconKey,
      meta.title + ' (bấm mũi tên bên phải để chọn công cụ khác)',
      activeTool === lastDrawShapeTool,
      () => selectDrawTool(lastDrawShapeTool),
      true
    );
    mainBtn.classList.add('draw-tool-combo-main');

    // Chấm màu = màu đã nhớ của công cụ này (Fib không có màu chung nên không hiện)
    const remembered = getRememberedStyle(lastDrawShapeTool);
    if (typeof remembered.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(remembered.color)) {
      mainBtn.classList.add('has-color-dot');
      mainBtn.style.setProperty('--dot-color', remembered.color);
      mainBtn.title += ' · màu đã nhớ: ' + remembered.color;
    }

    const caretBtn = document.createElement('button');
    caretBtn.type = 'button';
    caretBtn.className = 'draw-tool-btn draw-tool-combo-caret';
    caretBtn.innerHTML = iconHTML('chevronDown');
    caretBtn.title = 'Chọn công cụ vẽ khác';
    caretBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFlyout(caretBtn);
    });

    combo.appendChild(mainBtn);
    combo.appendChild(caretBtn);
    groupEl.appendChild(combo);

    // 3. Cảnh báo giá
    groupEl.appendChild(makeToolbarBtn('bell', 'Đặt cảnh báo giá (click lên chart)', activeTool === 'alert', () => selectDrawTool('alert'), true));

    // 4. Tẩy
    groupEl.appendChild(makeToolbarBtn('eraser', 'Tẩy / Xoá từng hình (click vào hình)', activeTool === 'eraser', () => selectDrawTool('eraser'), true));

    // 5. Ẩn/hiện tất cả
    const isHidden = drawing ? drawing.getAllHidden() : false;
    const hideBtn = makeToolbarBtn(
      isHidden ? 'eyeOff' : 'eye',
      isHidden ? 'Đang ẩn tất cả hình vẽ - bấm để hiện lại' : 'Ẩn tạm thời tất cả hình vẽ (ô đang chọn)',
      isHidden,
      () => {
        if (!drawing) return;
        drawing.setAllHidden(!isHidden);
        renderSharedDrawGroup();
      },
      true
    );
    groupEl.appendChild(hideBtn);

    // 6. Xoá tất cả
    groupEl.appendChild(makeToolbarBtn('trash', 'Xoá tất cả hình vẽ (ô đang chọn)', false, () => selectDrawTool('clear'), true));
  }

  /* ===================== LAYOUT (1/2/3/4 Ô) ===================== */

    function renderLayoutButtons() {
    const groupEl = document.getElementById('layoutGroup');
    if (!groupEl) return;
    groupEl.innerHTML = '';

    const orientation = Store.getState().orientation;
    const currentLayout = Store.getState().layout;
    const layouts = LayoutModule.getAvailableLayouts(orientation);

    layouts.forEach((n) => {
      const btn = document.createElement('button');
      btn.className = 'timeframe-btn' + (n === currentLayout ? ' active' : '');
      btn.dataset.layout = n;
      btn.innerHTML = n + '<span class="btn-text"> ô</span>';
      btn.title = `Chọn layout ${n} ô`;
      btn.addEventListener('click', () => Store.setLayout(n));
      groupEl.appendChild(btn);
    });

    // Dạng thu gọn: 1 ô chọn duy nhất, chỉ hiện khi topbar thiếu chỗ (xem topbar-landscape.css)
    const select = document.createElement('select');
    select.className = 'timeframe-select layout-select';
    select.title = 'Chọn số ô';
    layouts.forEach((n) => {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n + ' ô';
      opt.selected = n === currentLayout;
      select.appendChild(opt);
    });
    select.addEventListener('change', (e) => Store.setLayout(parseInt(e.target.value, 10)));
    groupEl.appendChild(select);
  }

    function highlightActiveLayoutButton(layout) {
    const groupEl = document.getElementById('layoutGroup');
    if (!groupEl) return;
    groupEl.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === String(layout));
    });
    const sel = groupEl.querySelector('.layout-select');
    if (sel) sel.value = String(layout);
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

    // Kho style nhớ thay đổi (drawing.js phát) -> cập nhật chấm màu trên nút combo
    window.addEventListener('drawing:styleChanged', () => renderSharedDrawGroup());
  }

  return { init, renderSharedDrawGroup, renderSharedTimeframeGroup };
})();