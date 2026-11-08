/**
 * indicator-legend.js
 * Vẽ 1 legend nhỏ (giống TradingView) đè lên góc trên-trái của mỗi pane,
 * liệt kê các indicator (EMA, SMA50, BB, RSI, MACD) + Volume + chip BUY/SELL.
 *
 * CẬP NHẬT (đợt này) - GỘP EMA THÀNH 1 CHIP:
 *   - Các chip EMA riêng lẻ (EMA21, EMA200) được gộp thành 1 chip "EMA".
 *     Bấm vào chip = bật/tắt tất cả đường EMA. Bấm ⚙ = mở cài đặt.
 *   - Popover cài đặt EMA: danh sách tối đa 10 đường, có nút "+ Thêm đường"
 *     và nút ✕ xoá từng đường. Mỗi đường có: công tắc bật/tắt riêng, chu kỳ,
 *     màu, độ dày nét, nguồn giá (close/open/high/low).
 *   - Popover chỉnh trên bản nháp, chỉ áp vào chart khi bấm "Áp dụng".
 *
 * CẬP NHẬT - THÊM CHECKBOX "THÔNG BÁO TÍN HIỆU BUY/SELL":
 *   - Trong popover cài đặt breakout (mở qua bánh răng ⚙ của chip BUY/SELL),
 *     có checkbox chọn khung thời gian nhận thông báo tín hiệu BUY/SELL mới.
 *
 * CẬP NHẬT - FIX POPOVER BỊ CHE/CẮT TRÊN IPHONE/IPAD:
 *   - positionPopover() append popover thẳng vào document.body (thoát khỏi
 *     overflow:hidden của pane), dùng position: fixed và tự tính toạ độ dựa
 *     trên vị trí thật của chip (getBoundingClientRect), có clamp để không
 *     tràn mép màn hình và tự lật lên trên nếu không đủ chỗ bên dưới.
 */

const IndicatorLegend = (function () {
  const collapsedState = {};
    const LEGEND_CSS = `
.legend-toggle-btn{display:inline-flex;align-items:center;gap:4px}
.legend-toggle-btn svg{width:14px;height:14px;display:block;flex-shrink:0}
.legend-toggle-btn .lt-chev svg{width:12px;height:12px}
.indicator-gear{display:inline-flex;align-items:center;justify-content:center}
.indicator-gear svg{width:9px;height:9px;display:block}
.ip-cancel svg{width:12px;height:12px;display:block}
.ip-sound-btn{display:inline-flex;align-items:center;gap:5px}
.ip-sound-btn svg{width:13px;height:13px}
`;
  function ensureLegendCss() {
    if (document.getElementById('legend-icon-css')) return;
    const st = document.createElement('style');
    st.id = 'legend-icon-css';
    st.textContent = LEGEND_CSS;
    document.head.appendChild(st);
  }

  const MAX_EMA_LINES = 10;
  const EMA_PALETTE = [
    '#f5c518',
    '#ff5f5f',
    '#2962ff',
    '#26a69a',
    '#ff9800',
    '#7e57c2',
    '#e91e63',
    '#00bcd4',
    '#8bc34a',
    '#9e9e9e',
  ];

  const SL_MODE_LABELS = {
    entry: 'Khung vào lệnh (mặc định)',
    higher: 'Khung trend (cùng cặp entry → trend)',
    custom: 'Khung tuỳ chọn riêng...',
  };

  function isCollapsed(paneId) {
    // Mặc định LUÔN thu gọn khi mới mở chart (paneId chưa có trong
    // collapsedState) - người dùng phải tự bấm "Chỉ báo ▸" mới xem/chọn
    // được danh sách chỉ báo. Sau khi đã bấm 1 lần (mở hoặc đóng), trạng
    // thái đó được nhớ trong collapsedState như cũ cho đến khi tải lại
    // trang.
    return collapsedState[paneId] === undefined ? true : !!collapsedState[paneId];
  }

  function render(paneId, instance) {
    ensureLegendCss();
    const container = document.getElementById(`${paneId}-legend`);
    if (!container) return;
    container.innerHTML = '';

    const collapsed = isCollapsed(paneId);
    container.classList.toggle('legend-collapsed', collapsed);

    container.appendChild(buildCollapseToggle(paneId, instance, collapsed));

    if (collapsed) return;

    // Chip BUY/SELL ở ĐẦU danh sách - đây là chỉ báo chính, nên dễ thấy/dễ bấm nhất.
    container.appendChild(buildBreakoutChip(paneId, instance));

    // 1 chip EMA duy nhất cho toàn bộ các đường EMA
    container.appendChild(buildEMAGroupChip(paneId, instance));

    const config = instance.getIndicatorConfig();
    if (config.sma50) {
      container.appendChild(buildChip(paneId, instance, 'sma50', config.sma50));
    }

    container.appendChild(buildBBGroupChip(paneId, instance));
    container.appendChild(buildRSIGroupChip(paneId, instance, RSI_NDQ));
    container.appendChild(buildMACDGroupChip(paneId, instance));
    container.appendChild(buildIchimokuChip(paneId, instance));

    container.appendChild(buildSimpleToggleChip('#787b86', 'Volume', instance.getVolumeVisible(), (next) => {
      instance.setVolumeVisible(next);
      render(paneId, instance);
    }));
  }

  function buildCollapseToggle(paneId, instance, collapsed) {
    const btn = document.createElement('div');
    btn.className = 'legend-toggle-btn';
    btn.title = collapsed ? 'Mở rộng danh sách chỉ báo' : 'Thu gọn danh sách chỉ báo';
    btn.innerHTML =
      iconHTML('indicators') +
      '<span>Chỉ báo</span>' +
      `<span class="lt-chev">${iconHTML(collapsed ? 'chevronRight' : 'chevronDown')}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      collapsedState[paneId] = !collapsed;
      render(paneId, instance);
    });
    return btn;
  }

  function buildChip(paneId, instance, key, item) {
    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (item.enabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = item.color;

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = `${item.label} ${item.period}`;

    const gear = document.createElement('span');
    gear.className = 'indicator-gear';
    gear.title = 'Chỉnh chu kỳ';
        gear.innerHTML = iconHTML('settings');

    function toggle(e) {
      e.stopPropagation();
      instance.setIndicatorVisible(key, !item.enabled);
      render(paneId, instance);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      openPeriodPopover(chip, paneId, instance, key, item);
    });

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(gear);
    return chip;
  }

  function buildSimpleToggleChip(color, label, enabled, onToggle) {
    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (enabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = color;

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = label;

    function toggle(e) {
      e.stopPropagation();
      onToggle(!enabled);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);

    chip.appendChild(dot);
    chip.appendChild(name);
    return chip;
  }

  function buildBreakoutChip(paneId, instance) {
    const pane = Store.getPane(paneId);
    const enabled = pane ? !!pane.breakoutVisible : false;

    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (enabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = '#2962ff';

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = Store.getPaneSignalMode && Store.getPaneSignalMode(paneId) === 'ma' ? 'BUY/SELL · MA' : 'BUY/SELL';

    const gear = document.createElement('span');
    gear.className = 'indicator-gear';
    gear.title = 'Cài đặt breakout (số nến / nguồn SL / thông báo)';
        gear.innerHTML = iconHTML('settings');

    function toggle(e) {
      e.stopPropagation();
      Store.setPaneBreakoutVisible(paneId, !enabled);
      render(paneId, instance);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Store.getPaneSignalMode && Store.getPaneSignalMode(paneId) === 'ma' && typeof MaSignalUI !== 'undefined') {
        closeAnyOpenPopover();
        MaSignalUI.open(paneId);
      } else {
        closeAnyOpenPopover();
        if (typeof BreakoutUI !== 'undefined') BreakoutUI.open(paneId);
        else openBreakoutSettingsPopover(chip, paneId, instance);
      }
    });

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(gear);
    return chip;
  }

  function closeAnyOpenPopover() {
    document.querySelectorAll('.indicator-popover').forEach((el) => el.remove());
  }

  /**
   * FIX MOBILE: append popover thẳng vào document.body (thoát khỏi
   * overflow:hidden của .pane-chart-container) và tự tính toạ độ dựa trên
   * vị trí thật của "chip" (anchorEl) trên màn hình. Có clamp để popover
   * luôn nằm trọn trong viewport - không bị cắt/che ở iPhone/iPad, kể cả
   * khi chip nằm trong 1 pane nhỏ ở layout 4 ô hoặc ở sát mép màn hình.
   */
  function positionPopover(popover, anchorEl) {
    // Cần đo kích thước thật của popover -> append tạm vào body trước
    // (đang vô hình về mặt layout vì các popover luôn có nội dung cố định,
    // nên việc đo ngay sau khi append là an toàn).
    document.body.appendChild(popover);

    const rect = anchorEl.getBoundingClientRect();
    const margin = 6;
    const popRect = popover.getBoundingClientRect();

    let top = rect.bottom + margin;
    let left = rect.left;

    // Không đủ chỗ bên dưới -> mở lên phía trên chip
    if (top + popRect.height > window.innerHeight - margin) {
      top = rect.top - popRect.height - margin;
    }
    // Vẫn không đủ (chip ở giữa màn hình nhỏ) -> ép nằm trong viewport,
    // phần nội dung dư sẽ tự cuộn nhờ overflow-y: auto (đã khai báo CSS).
    if (top < margin) top = margin;

    // Không để tràn phải/trái
    if (left + popRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popRect.width - margin;
    }
    if (left < margin) left = margin;

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function openPeriodPopover(chip, paneId, instance, key, item) {
    closeAnyOpenPopover();

    const popover = document.createElement('div');
    popover.className = 'indicator-popover';
    popover.addEventListener('click', (e) => e.stopPropagation());

    const label = document.createElement('label');
    label.textContent = `Chu kỳ ${item.label}`;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '1000';
    input.value = item.period;

    const actions = document.createElement('div');
    actions.className = 'indicator-popover-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ip-cancel';
    cancelBtn.textContent = 'Hủy';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'ip-apply';
    applyBtn.textContent = 'Áp dụng';

    function apply() {
      const val = parseInt(input.value, 10);
      if (val && val > 0) {
        instance.setIndicatorPeriod(key, val);
      }
      popover.remove();
      render(paneId, instance);
    }

    applyBtn.addEventListener('click', apply);
    cancelBtn.addEventListener('click', () => popover.remove());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') apply();
      if (e.key === 'Escape') popover.remove();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);
    popover.appendChild(label);
    popover.appendChild(input);
    popover.appendChild(actions);
    positionPopover(popover, chip);

    input.focus();
    input.select();
  }

  /**
   * Popover cài đặt breakout của 1 pane: số nến breakout + nguồn tính SL +
   * khung thời gian nhận thông báo tín hiệu BUY/SELL mới.
   */
  function openBreakoutSettingsPopover(chip, paneId, instance) {
    closeAnyOpenPopover();

    const current = Store.getPaneBreakoutConfig(paneId) || {
      lookbackCandles: 2,
      slMode: 'entry',
      slTimeframe: null,
    };

    const popover = document.createElement('div');
    popover.className = 'indicator-popover wide';
    popover.addEventListener('click', (e) => e.stopPropagation());

    // ---- Chế độ tín hiệu ----
    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'Chế độ tín hiệu';
 
    const modeSelect = document.createElement('select');
    const currentMode = Store.getPaneSignalMode ? Store.getPaneSignalMode(paneId) : 'breakout';
    [['breakout', 'Breakout (mặc định)'], ['ma', 'MA Tự Co Giãn']].forEach(([value, text]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      if (value === currentMode) opt.selected = true;
      modeSelect.appendChild(opt);
    });
 
    const modeHint = document.createElement('div');
    modeHint.className = 'bo-hint';
    modeHint.textContent = 'Chọn "MA Tự Co Giãn" rồi bấm Áp dụng; bấm ⚙ lần nữa để chỉnh MACD, MA, SL, TP, trailing.';
 
    // ---- Số nến breakout ----
    const lookbackLabel = document.createElement('label');
    lookbackLabel.textContent = 'Số nến breakout (khung trend)';

    const lookbackInput = document.createElement('input');
    lookbackInput.type = 'number';
    lookbackInput.min = '1';
    lookbackInput.max = '20';
    lookbackInput.value = current.lookbackCandles;

    // ---- Nguồn tính SL ----
    const slModeLabel = document.createElement('label');
    slModeLabel.textContent = 'Nguồn tính SL (ATR)';

    const slModeSelect = document.createElement('select');
    ['entry', 'higher', 'custom'].forEach((mode) => {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = SL_MODE_LABELS[mode];
      if (mode === current.slMode) opt.selected = true;
      slModeSelect.appendChild(opt);
    });

    // ---- Khung SL tuỳ chọn (chỉ hiện khi slMode = 'custom') ----
    const slTimeframeLabel = document.createElement('label');
    slTimeframeLabel.textContent = 'Khung tính SL';

    const slTimeframeSelect = document.createElement('select');
    TIMEFRAMES.forEach((tf) => {
      const opt = document.createElement('option');
      opt.value = tf.value;
      opt.textContent = tf.label;
      if (tf.value === current.slTimeframe) opt.selected = true;
      slTimeframeSelect.appendChild(opt);
    });
    if (!current.slTimeframe) {
      slTimeframeSelect.value = '1h';
    }

    const slTimeframeRow = document.createElement('div');
    slTimeframeRow.className = 'bo-conditional-row';
    slTimeframeRow.appendChild(slTimeframeLabel);
    slTimeframeRow.appendChild(slTimeframeSelect);

    function updateConditionalVisibility() {
      slTimeframeRow.style.display = slModeSelect.value === 'custom' ? '' : 'none';
    }
    slModeSelect.addEventListener('change', updateConditionalVisibility);
    updateConditionalVisibility();

    const hint = document.createElement('div');
    hint.className = 'bo-hint';
    hint.textContent = 'Ví dụ: vào lệnh M5, SL tính ATR theo H1.';

    // ---- Chọn thông báo BUY/SELL ở TF nào ----
    const tfTitleLabel = document.createElement('label');
    tfTitleLabel.textContent = 'Cảnh báo tín hiệu BUY/SELL ở TF:';
    tfTitleLabel.style.fontWeight = 'bold';
    tfTitleLabel.style.marginTop = '12px';
    tfTitleLabel.style.display = 'block';

    const tfContainer = document.createElement('div');
    tfContainer.className = 'bo-tf-container';
    tfContainer.style.display = 'flex';
    tfContainer.style.flexWrap = 'wrap';
    tfContainer.style.gap = '12px';
    tfContainer.style.margin = '8px 0';

    const signalTFs = [
      { value: '5m', label: 'M5' },
      { value: '15m', label: 'M15' },
      { value: '30m', label: 'M30' },
      { value: '1h', label: 'H1' },
      { value: '2h', label: 'H2' },
    ];

    const currentTFs = Store.getEnabledSignalTimeframes() || [];
    const tfCheckboxes = {};

    signalTFs.forEach((tf) => {
      const label = document.createElement('label');
      label.className = 'ip-checkbox-label';
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '6px';
      label.style.cursor = 'pointer';
      label.style.fontSize = '13px';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = tf.value;
      cb.checked = currentTFs.includes(tf.value);
      tfCheckboxes[tf.value] = cb;

      label.appendChild(cb);
      label.appendChild(document.createTextNode(tf.label));
      tfContainer.appendChild(label);
    });

    const notifyHint = document.createElement('div');
    notifyHint.className = 'bo-hint';
    notifyHint.style.display = 'flex';
    notifyHint.style.flexDirection = 'column';
    notifyHint.style.gap = '6px';
    notifyHint.innerHTML = `
      <span>Chọn các khung thời gian bạn muốn nhận thông báo khi có tín hiệu BUY/SELL mới (kèm âm thanh chuông).</span>
      <button type="button" id="boTestSoundBtn" class="ip-sound-btn" style="align-self:flex-start; background:none; border:1px solid currentColor; padding:2px 8px; border-radius:4px; cursor:pointer; font-size:11px;">${iconHTML('volume')}<span>Thử âm thanh chuông</span></button>
    `;
    setTimeout(() => {
      const b = notifyHint.querySelector('#boTestSoundBtn');
      if (b && typeof NotificationsModule !== 'undefined') {
        b.addEventListener('click', () => NotificationsModule.playSound());
      }
    }, 0);

    const actions = document.createElement('div');
    actions.className = 'indicator-popover-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ip-cancel';
    cancelBtn.textContent = 'Hủy';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'ip-apply';
    applyBtn.textContent = 'Áp dụng';

    function apply() {
      const lookback = parseInt(lookbackInput.value, 10);
      const slMode = slModeSelect.value;
      const slTimeframe = slMode === 'custom' ? slTimeframeSelect.value : null;

      if (Store.setPaneSignalMode) Store.setPaneSignalMode(paneId, modeSelect.value);
 
      Store.setPaneBreakoutConfig(paneId, {
        lookbackCandles: lookback && lookback > 0 ? lookback : current.lookbackCandles,
        slMode,
        slTimeframe,
      });

      const selectedTFs = [];
      signalTFs.forEach((tf) => {
        if (tfCheckboxes[tf.value].checked) {
          selectedTFs.push(tf.value);
        }
      });
      Store.setEnabledSignalTimeframes(selectedTFs);

      if (
        selectedTFs.length > 0 &&
        typeof LoginModule !== 'undefined' &&
        LoginModule.getStoredUsername &&
        !LoginModule.getStoredUsername()
      ) {
        if (LoginModule.showLoginOverlay) {
          LoginModule.showLoginOverlay('Bạn đang ở vai trò Khách. Để nhận thông báo tín hiệu BUY/SELL riêng, vui lòng đăng nhập hoặc lập tài khoản.');
        }
      } else if (
        selectedTFs.length > 0 &&
        NotificationsModule.isSupported() &&
        NotificationsModule.getPermission() === 'default'
      ) {
        NotificationsModule.requestPermission();
      }

      popover.remove();
      render(paneId, instance);
    }

    applyBtn.addEventListener('click', apply);
    cancelBtn.addEventListener('click', () => popover.remove());

    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);

    popover.appendChild(modeLabel);
    popover.appendChild(modeSelect);
    popover.appendChild(modeHint);
    popover.appendChild(lookbackLabel);
    popover.appendChild(lookbackInput);
    popover.appendChild(slModeLabel);
    popover.appendChild(slModeSelect);
    popover.appendChild(slTimeframeRow);
    popover.appendChild(hint);
    popover.appendChild(tfTitleLabel);
    popover.appendChild(tfContainer);
    popover.appendChild(notifyHint);
    popover.appendChild(actions);
    positionPopover(popover, chip);

    lookbackInput.focus();
    lookbackInput.select();
  }

  // --- EMA GROUP CHIP & POPOVER ---
  function buildEMAGroupChip(paneId, instance) {
    const lines = instance.getIndicatorConfig().emaLines || [];
    const isAnyEnabled = lines.some((l) => l.enabled);

    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (isAnyEnabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = (lines[0] && lines[0].color) || '#f5c518';

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = 'EMA';

    const gear = document.createElement('span');
    gear.className = 'indicator-gear';
    gear.title = 'Cài đặt các đường EMA';
        gear.innerHTML = iconHTML('settings');

    function toggle(e) {
      e.stopPropagation();
      // Danh sách trống thì không có gì để bật -> mở cài đặt luôn
      if (lines.length === 0) {
        openEMAGroupPopover(chip, paneId, instance);
        return;
      }
      instance.setEmaGroupVisible(!isAnyEnabled);
      render(paneId, instance);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      openEMAGroupPopover(chip, paneId, instance);
    });

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(gear);
    return chip;
  }

  function openEMAGroupPopover(chip, paneId, instance) {
    closeAnyOpenPopover();

    // Bản nháp - chỉ áp vào chart khi bấm "Áp dụng"
    const draft = (instance.getIndicatorConfig().emaLines || []).map((l) => ({ ...l }));

    const popover = document.createElement('div');
    popover.className = 'indicator-popover wide';
    popover.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('label');
    title.textContent = 'Cấu hình EMA:';
    title.style.fontWeight = 'bold';
    title.style.color = 'var(--text-primary)';

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    list.style.margin = '8px 0';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'ip-cancel';
    addBtn.style.alignSelf = 'flex-start';

    function refreshAddBtn() {
      addBtn.textContent = `+ Thêm đường (${draft.length}/${MAX_EMA_LINES})`;
      addBtn.disabled = draft.length >= MAX_EMA_LINES;
      addBtn.style.opacity = addBtn.disabled ? '0.5' : '1';
    }

    function buildRow(line, index) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.flexWrap = 'wrap';
      row.style.gap = '6px';

      // Công tắc bật/tắt riêng của đường này
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.title = 'Bật/tắt đường này';
      enabled.checked = line.enabled;
      enabled.addEventListener('change', () => {
        line.enabled = enabled.checked;
      });

      // Chu kỳ
      const period = document.createElement('input');
      period.type = 'number';
      period.min = '1';
      period.max = '1000';
      period.value = line.period;
      period.title = 'Chu kỳ';
      period.style.width = '64px';
      period.addEventListener('input', () => {
        const v = parseInt(period.value, 10);
        if (v > 0) line.period = v;
      });

      // Màu
      const color = document.createElement('input');
      color.type = 'color';
      color.title = 'Màu';
      color.value = /^#[0-9a-f]{6}$/i.test(line.color) ? line.color : '#f5c518';
      color.style.width = '32px';
      color.style.padding = '0';
      color.addEventListener('input', () => {
        line.color = color.value;
      });

      // Độ dày nét
      const width = document.createElement('select');
      width.title = 'Độ dày nét';
      [1, 2, 3, 4].forEach((w) => {
        const o = document.createElement('option');
        o.value = w;
        o.textContent = `${w}px`;
        if (w === line.width) o.selected = true;
        width.appendChild(o);
      });
      width.addEventListener('change', () => {
        line.width = parseInt(width.value, 10);
      });

      // Nguồn giá
      const source = document.createElement('select');
      source.title = 'Nguồn giá';
      ['close', 'open', 'high', 'low'].forEach((s) => {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s;
        if (s === line.source) o.selected = true;
        source.appendChild(o);
      });
      source.addEventListener('change', () => {
        line.source = source.value;
      });

      // Xoá đường
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ip-cancel';
      del.title = 'Xóa đường này';
      del.innerHTML = iconHTML('close');
      del.addEventListener('click', () => {
        draft.splice(index, 1);
        renderRows();
        positionPopover(popover, chip);
      });

      [enabled, period, color, width, source, del].forEach((el) => row.appendChild(el));
      return row;
    }

    function renderRows() {
      list.innerHTML = '';
      draft.forEach((line, i) => list.appendChild(buildRow(line, i)));
      refreshAddBtn();
    }

    addBtn.addEventListener('click', () => {
      if (draft.length >= MAX_EMA_LINES) return;
      draft.push({
        id: `ema-${Date.now()}-${draft.length}`,
        period: 50,
        color: EMA_PALETTE[draft.length % EMA_PALETTE.length],
        width: 1,
        source: 'close',
        enabled: true,
      });
      renderRows();
      positionPopover(popover, chip);
    });

    const actions = document.createElement('div');
    actions.className = 'indicator-popover-actions';
    actions.style.marginTop = '8px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ip-cancel';
    cancelBtn.textContent = 'Hủy';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'ip-apply';
    applyBtn.textContent = 'Áp dụng';

    applyBtn.addEventListener('click', () => {
      instance.setEmaLines(draft);
      popover.remove();
      render(paneId, instance);
    });
    cancelBtn.addEventListener('click', () => popover.remove());

    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);

    popover.appendChild(title);
    popover.appendChild(list);
    popover.appendChild(addBtn);
    popover.appendChild(actions);

    renderRows();
    positionPopover(popover, chip);
  }

  // --- BOLINGER BANDS GROUP CHIP & POPOVER ---
  function buildBBGroupChip(paneId, instance) {
    const config = instance.getIndicatorConfig();
    const bbUpper = config.bbUpper;
    const bbMiddle = config.bbMiddle;
    const bbLower = config.bbLower;

    const isAnyEnabled = bbUpper.enabled || bbMiddle.enabled || bbLower.enabled;

    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (isAnyEnabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = '#26a69a';

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = `BB ${bbMiddle.period}`;

    const gear = document.createElement('span');
    gear.className = 'indicator-gear';
    gear.title = 'Cài đặt Bollinger Bands';
        gear.innerHTML = iconHTML('settings');

    function toggle(e) {
      e.stopPropagation();
      if (isAnyEnabled) {
        instance.setIndicatorVisible('bbUpper', false);
        instance.setIndicatorVisible('bbMiddle', false);
        instance.setIndicatorVisible('bbLower', false);
      } else {
        instance.setIndicatorVisible('bbUpper', true);
        instance.setIndicatorVisible('bbMiddle', true);
        instance.setIndicatorVisible('bbLower', true);
      }
      render(paneId, instance);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      openBBGroupPopover(chip, paneId, instance);
    });

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(gear);
    return chip;
  }

  function openBBGroupPopover(chip, paneId, instance) {
    closeAnyOpenPopover();

    const config = instance.getIndicatorConfig();
    const bbUpper = config.bbUpper;
    const bbMiddle = config.bbMiddle;
    const bbLower = config.bbLower;

    const popover = document.createElement('div');
    popover.className = 'indicator-popover wide';
    popover.addEventListener('click', (e) => e.stopPropagation());

    const bbTitle = document.createElement('label');
    bbTitle.textContent = 'Cấu hình Bollinger Bands:';
    bbTitle.style.fontWeight = 'bold';
    bbTitle.style.color = 'var(--text-primary)';

    const periodRow = document.createElement('div');
    periodRow.className = 'indicator-popover-row';
    const periodLabel = document.createElement('span');
    periodLabel.textContent = 'Chu kỳ';
    periodLabel.style.fontSize = '11px';
    periodLabel.style.color = 'var(--text-secondary)';
    const periodInput = document.createElement('input');
    periodInput.type = 'number';
    periodInput.min = '1';
    periodInput.max = '200';
    periodInput.value = bbMiddle.period;
    periodRow.appendChild(periodLabel);
    periodRow.appendChild(periodInput);

    const upperRow = document.createElement('div');
    upperRow.className = 'indicator-popover-row';
    const upperLabel = document.createElement('label');
    upperLabel.className = 'ip-checkbox-label';
    const upperCheckbox = document.createElement('input');
    upperCheckbox.type = 'checkbox';
    upperCheckbox.checked = bbUpper.enabled;
    upperLabel.appendChild(upperCheckbox);
    upperLabel.appendChild(document.createTextNode('Đường trên (Upper)'));
    upperRow.appendChild(upperLabel);

    const middleRow = document.createElement('div');
    middleRow.className = 'indicator-popover-row';
    const middleLabel = document.createElement('label');
    middleLabel.className = 'ip-checkbox-label';
    const middleCheckbox = document.createElement('input');
    middleCheckbox.type = 'checkbox';
    middleCheckbox.checked = bbMiddle.enabled;
    middleLabel.appendChild(middleCheckbox);
    middleLabel.appendChild(document.createTextNode('Đường giữa (Basis)'));
    middleRow.appendChild(middleLabel);

    const lowerRow = document.createElement('div');
    lowerRow.className = 'indicator-popover-row';
    const lowerLabel = document.createElement('label');
    lowerLabel.className = 'ip-checkbox-label';
    const lowerCheckbox = document.createElement('input');
    lowerCheckbox.type = 'checkbox';
    lowerCheckbox.checked = bbLower.enabled;
    lowerLabel.appendChild(lowerCheckbox);
    lowerLabel.appendChild(document.createTextNode('Đường dưới (Lower)'));
    lowerRow.appendChild(lowerLabel);

    const actions = document.createElement('div');
    actions.className = 'indicator-popover-actions';
    actions.style.marginTop = '8px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ip-cancel';
    cancelBtn.textContent = 'Hủy';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'ip-apply';
    applyBtn.textContent = 'Áp dụng';

    function apply() {
      const p = parseInt(periodInput.value, 10);
      if (p && p > 0) {
        instance.setIndicatorPeriod('bbUpper', p);
        instance.setIndicatorPeriod('bbMiddle', p);
        instance.setIndicatorPeriod('bbLower', p);
      }

      instance.setIndicatorVisible('bbUpper', upperCheckbox.checked);
      instance.setIndicatorVisible('bbMiddle', middleCheckbox.checked);
      instance.setIndicatorVisible('bbLower', lowerCheckbox.checked);

      popover.remove();
      render(paneId, instance);
    }

    applyBtn.addEventListener('click', apply);
    cancelBtn.addEventListener('click', () => popover.remove());

    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);

    popover.appendChild(bbTitle);
    popover.appendChild(periodRow);
    popover.appendChild(upperRow);
    popover.appendChild(middleRow);
    popover.appendChild(lowerRow);
    popover.appendChild(actions);

    positionPopover(popover, chip);
    periodInput.focus();
    periodInput.select();
  }

  /** Ô chọn màu + độ dày nét (1-4px) dùng chung cho RSI / EMA(RSI) / WMA(RSI). */
  function buildLineStyleControls(item) {
    const color = document.createElement('input');
    color.type = 'color';
    color.title = 'Màu';
    color.value = /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#7e57c2';
    color.style.width = '32px';
    color.style.padding = '0';

    const width = document.createElement('select');
    width.title = 'Độ dày nét';
    [1, 2, 3, 4].forEach((w) => {
      const o = document.createElement('option');
      o.value = w;
      o.textContent = `${w}px`;
      if (w === Math.round(item.width || 1)) o.selected = true;
      width.appendChild(o);
    });

    return { color, width };
  }

  function styleRow(row) {
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.flexWrap = 'wrap';
    row.style.gap = '6px';
  }

  /**
   * Phần cài đặt bổ sung của RSI (giống chỉ báo "RSI by NĐQ" trên TradingView):
   * nguồn giá, 7 mức RSI, bảng giá theo mức RSI, nền 30-70, RSI SnR tự động.
   * Trả về { element, read } - read() lấy giá trị hiện tại của các ô nhập.
   */
  function buildRsiExtrasSection(ex) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '6px';
    wrap.style.marginTop = '8px';
    wrap.style.paddingTop = '8px';
    wrap.style.borderTop = '1px solid var(--border-color)';

    function sectionTitle(text) {
      const t = document.createElement('label');
      t.textContent = text;
      t.style.fontWeight = 'bold';
      t.style.color = 'var(--text-primary)';
      return t;
    }

    function smallLabel(text) {
      const s = document.createElement('span');
      s.textContent = text;
      s.style.fontSize = '11px';
      s.style.color = 'var(--text-secondary)';
      return s;
    }

    function colorInput(value) {
      const c = document.createElement('input');
      c.type = 'color';
      c.value = value;
      c.style.width = '32px';
      c.style.padding = '0';
      return c;
    }

    function numberInput(value, min, max, width) {
      const n = document.createElement('input');
      n.type = 'number';
      n.min = String(min);
      n.max = String(max);
      n.value = value;
      n.style.width = width;
      return n;
    }

    function checkboxRow(text, checked) {
      const row = document.createElement('div');
      row.className = 'indicator-popover-row';
      const label = document.createElement('label');
      label.className = 'ip-checkbox-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(text));
      row.appendChild(label);
      return { row, cb };
    }

    function wrapRow(...children) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.flexWrap = 'wrap';
      row.style.gap = '6px';
      children.forEach((c) => row.appendChild(c));
      return row;
    }

    wrap.appendChild(sectionTitle('RSI by NĐQ:'));

    // ---- Nguồn giá ----
    const sourceSelect = document.createElement('select');
    ['close', 'open', 'high', 'low'].forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      if (s === ex.source) o.selected = true;
      sourceSelect.appendChild(o);
    });
    sourceSelect.style.width = '90px';
    wrap.appendChild(wrapRow(smallLabel('Nguồn giá RSI'), sourceSelect));

    // ---- 7 mức RSI ----
    wrap.appendChild(smallLabel('Mức RSI (đường ngang + bảng giá):'));
    const levelInputs = ex.levels.map((v) => numberInput(v, 1, 99, '44px'));
    wrap.appendChild(wrapRow(...levelInputs));

    // ---- Nền mờ 30-70 ----
    const fill = checkboxRow('Nền mờ giữa mức 30 và 70', ex.showFill);
    wrap.appendChild(fill.row);

    // ---- Bảng giá theo mức RSI ----
    const ladder = checkboxRow('Bảng giá theo mức RSI', ex.showLadder);
    wrap.appendChild(ladder.row);
    const ladderColor = colorInput(ex.ladderColor);
    const ladderWmaColor = colorInput(ex.ladderWmaColor);
    wrap.appendChild(
      wrapRow(smallLabel('Màu chữ'), ladderColor, smallLabel('Màu chữ WMA'), ladderWmaColor)
    );

    // ---- RSI hỗ trợ / kháng cự tự động ----
    const snr = checkboxRow('RSI hỗ trợ / kháng cự tự động', ex.showSnr);
    wrap.appendChild(snr.row);
    const lookbackInputs = ex.snrLookbacks.map((v) => numberInput(v, 2, 1000, '52px'));
    wrap.appendChild(wrapRow(smallLabel('Số nến'), ...lookbackInputs));
    const snrResColor = colorInput(ex.snrResistanceColor);
    const snrSupColor = colorInput(ex.snrSupportColor);
    wrap.appendChild(wrapRow(smallLabel('Kháng cự'), snrResColor, smallLabel('Hỗ trợ'), snrSupColor));

    return {
      element: wrap,
      read() {
        return {
          source: sourceSelect.value,
          levels: levelInputs.map((i) => i.value),
          showFill: fill.cb.checked,
          showLadder: ladder.cb.checked,
          ladderColor: ladderColor.value,
          ladderWmaColor: ladderWmaColor.value,
          showSnr: snr.cb.checked,
          snrLookbacks: lookbackInputs.map((i) => i.value),
          snrResistanceColor: snrResColor.value,
          snrSupportColor: snrSupColor.value,
        };
      },
    };
  }

  // --- RSI GROUP CHIP & POPOVER ---
  const RSI_NDQ = {
    keys: ['rsi', 'emaRsi', 'wmaRsi'],
    label: 'RSI NĐQ',
    title: 'Cấu hình RSI NĐQ:',
    gearTitle: 'Cài đặt RSI NĐQ (bảng giá, hỗ trợ/kháng cự RSI...)',
    extras: true,
  };

  function buildRSIGroupChip(paneId, instance, variant) {
  const config = instance.getIndicatorConfig();
  const rsi = config[variant.keys[0]];
  const emaRsi = config[variant.keys[1]];
  const wmaRsi = config[variant.keys[2]];

  const isAnyEnabled = rsi.enabled || emaRsi.enabled || wmaRsi.enabled;

  const chip = document.createElement('div');
  chip.className = 'indicator-chip' + (isAnyEnabled ? '' : ' disabled');

  const dot = document.createElement('span');
  dot.className = 'indicator-dot';
  dot.style.background = rsi.color;

  const name = document.createElement('span');
  name.className = 'indicator-name';
  name.textContent = `${variant.label} ${rsi.period}`;

  const gear = document.createElement('span');
  gear.className = 'indicator-gear';
  gear.title = variant.gearTitle;
      gear.innerHTML = iconHTML('settings');

  function toggle(e) {
    e.stopPropagation();

    if (isAnyEnabled) {
      instance.setIndicatorVisible(variant.keys[0], false);
      instance.setIndicatorVisible(variant.keys[1], false);
      instance.setIndicatorVisible(variant.keys[2], false);
    } else {
      instance.setIndicatorVisible(variant.keys[0], true);
      instance.setIndicatorVisible(variant.keys[1], true);
      instance.setIndicatorVisible(variant.keys[2], true);
    }

    render(paneId, instance);
  }

  // Click vào bánh răng để mở cài đặt
  gear.addEventListener('click', (e) => {
    e.stopPropagation();

    if (variant.extras && typeof RsiNdqUI !== 'undefined') {
      closeAnyOpenPopover();
      RsiNdqUI.open(paneId);
    } else {
      openRSIGroupPopover(chip, paneId, instance, variant);
    }
  });

  // Click vào chip để bật/tắt nhóm RSI
  chip.addEventListener('click', toggle);

  chip.appendChild(dot);
  chip.appendChild(name);
  chip.appendChild(gear);

  return chip;
}

  function openRSIGroupPopover(chip, paneId, instance, variant) {
    closeAnyOpenPopover();

    const config = instance.getIndicatorConfig();
    const rsi = config[variant.keys[0]];
    const emaRsi = config[variant.keys[1]];
    const wmaRsi = config[variant.keys[2]];

    const popover = document.createElement('div');
    popover.className = 'indicator-popover wide';
    popover.addEventListener('click', (e) => e.stopPropagation());

    const rsiTitle = document.createElement('label');
    rsiTitle.textContent = variant.title;
    rsiTitle.style.fontWeight = 'bold';
    rsiTitle.style.color = 'var(--text-primary)';

    const rsiRow = document.createElement('div');
    rsiRow.className = 'indicator-popover-row';
    const rsiCheckboxLabel = document.createElement('label');
    rsiCheckboxLabel.className = 'ip-checkbox-label';
    const rsiCheckbox = document.createElement('input');
    rsiCheckbox.type = 'checkbox';
    rsiCheckbox.checked = rsi.enabled;
    rsiCheckboxLabel.appendChild(rsiCheckbox);
    rsiCheckboxLabel.appendChild(document.createTextNode('Hiển thị RSI'));

    const rsiPeriodInput = document.createElement('input');
    rsiPeriodInput.type = 'number';
    rsiPeriodInput.min = '1';
    rsiPeriodInput.max = '200';
    rsiPeriodInput.value = rsi.period;
    rsiRow.appendChild(rsiCheckboxLabel);
    rsiRow.appendChild(rsiPeriodInput);
    const rsiStyle = buildLineStyleControls(rsi);
    rsiRow.appendChild(rsiStyle.color);
    rsiRow.appendChild(rsiStyle.width);
    styleRow(rsiRow);

    const emaRow = document.createElement('div');
    emaRow.className = 'indicator-popover-row';
    const emaCheckboxLabel = document.createElement('label');
    emaCheckboxLabel.className = 'ip-checkbox-label';
    const emaCheckbox = document.createElement('input');
    emaCheckbox.type = 'checkbox';
    emaCheckbox.checked = emaRsi.enabled;
    emaCheckboxLabel.appendChild(emaCheckbox);
    emaCheckboxLabel.appendChild(document.createTextNode('EMA (RSI)'));

    rsiCheckbox.addEventListener('change', () => {
      if (rsiCheckbox.checked) {
        emaCheckbox.checked = true;
        wmaCheckbox.checked = true;
      }
    });
    const emaPeriodInput = document.createElement('input');
    emaPeriodInput.type = 'number';
    emaPeriodInput.min = '1';
    emaPeriodInput.max = '200';
    emaPeriodInput.value = emaRsi.period;
    emaRow.appendChild(emaCheckboxLabel);
    emaRow.appendChild(emaPeriodInput);
    const emaStyle = buildLineStyleControls(emaRsi);
    emaRow.appendChild(emaStyle.color);
    emaRow.appendChild(emaStyle.width);
    styleRow(emaRow);

    const wmaRow = document.createElement('div');
    wmaRow.className = 'indicator-popover-row';
    const wmaCheckboxLabel = document.createElement('label');
    wmaCheckboxLabel.className = 'ip-checkbox-label';
    const wmaCheckbox = document.createElement('input');
    wmaCheckbox.type = 'checkbox';
    wmaCheckbox.checked = wmaRsi.enabled;
    wmaCheckboxLabel.appendChild(wmaCheckbox);
    wmaCheckboxLabel.appendChild(document.createTextNode('WMA (RSI)'));
    const wmaPeriodInput = document.createElement('input');
    wmaPeriodInput.type = 'number';
    wmaPeriodInput.min = '1';
    wmaPeriodInput.max = '200';
    wmaPeriodInput.value = wmaRsi.period;
    wmaRow.appendChild(wmaCheckboxLabel);
    wmaRow.appendChild(wmaPeriodInput);
    const wmaStyle = buildLineStyleControls(wmaRsi);
    wmaRow.appendChild(wmaStyle.color);
    wmaRow.appendChild(wmaStyle.width);
    styleRow(wmaRow);

    // Phần bổ sung giống "RSI by NĐQ" (nguồn giá, mức RSI, bảng giá, SnR...)
    const extrasUI = variant.extras ? buildRsiExtrasSection(config.rsiExtras) : null;
    if (extrasUI) popover.style.width = '280px';

    const actions = document.createElement('div');
    actions.className = 'indicator-popover-actions';
    actions.style.marginTop = '8px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ip-cancel';
    cancelBtn.textContent = 'Hủy';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'ip-apply';
    applyBtn.textContent = 'Áp dụng';

    function apply() {
      const rsiP = parseInt(rsiPeriodInput.value, 10);
      const emaP = parseInt(emaPeriodInput.value, 10);
      const wmaP = parseInt(wmaPeriodInput.value, 10);

      if (rsiP && rsiP > 0) instance.setIndicatorPeriod(variant.keys[0], rsiP);
      if (emaP && emaP > 0) instance.setIndicatorPeriod(variant.keys[1], emaP);
      if (wmaP && wmaP > 0) instance.setIndicatorPeriod(variant.keys[2], wmaP);

      instance.setIndicatorStyle(variant.keys[0], { color: rsiStyle.color.value, width: rsiStyle.width.value });
      instance.setIndicatorStyle(variant.keys[1], { color: emaStyle.color.value, width: emaStyle.width.value });
      instance.setIndicatorStyle(variant.keys[2], { color: wmaStyle.color.value, width: wmaStyle.width.value });
      if (extrasUI) instance.setRsiExtras(extrasUI.read());

      instance.setIndicatorVisible(variant.keys[0], rsiCheckbox.checked);
      instance.setIndicatorVisible(variant.keys[1], emaCheckbox.checked);
      instance.setIndicatorVisible(variant.keys[2], wmaCheckbox.checked);

      popover.remove();
      render(paneId, instance);
    }

    applyBtn.addEventListener('click', apply);
    cancelBtn.addEventListener('click', () => popover.remove());

    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);

    popover.appendChild(rsiTitle);
    popover.appendChild(rsiRow);
    popover.appendChild(emaRow);
    popover.appendChild(wmaRow);
    if (extrasUI) popover.appendChild(extrasUI.element);
    popover.appendChild(actions);

    positionPopover(popover, chip);
    rsiPeriodInput.focus();
    rsiPeriodInput.select();
  }

  // --- MACD GROUP CHIP & POPOVER ---
  function buildMACDGroupChip(paneId, instance) {
    const config = instance.getIndicatorConfig();
    const macdLine = config.macdLine;
    const macdSignal = config.macdSignal;
    const macdHist = config.macdHist;

    const isAnyEnabled = macdLine.enabled || macdSignal.enabled || macdHist.enabled;

    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (isAnyEnabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = '#2962ff';

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = `MACD ${macdLine.period}, ${macdHist.period}, ${macdSignal.period}`;

    const gear = document.createElement('span');
    gear.className = 'indicator-gear';
    gear.title = 'Cài đặt MACD';
        gear.innerHTML = iconHTML('settings');

    function toggle(e) {
      e.stopPropagation();
      if (isAnyEnabled) {
        instance.setIndicatorVisible('macdLine', false);
        instance.setIndicatorVisible('macdSignal', false);
        instance.setIndicatorVisible('macdHist', false);
      } else {
        instance.setIndicatorVisible('macdLine', true);
        instance.setIndicatorVisible('macdSignal', true);
        instance.setIndicatorVisible('macdHist', true);
      }
      render(paneId, instance);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      openMACDGroupPopover(chip, paneId, instance);
    });

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(gear);
    return chip;
  }

  function openMACDGroupPopover(chip, paneId, instance) {
    closeAnyOpenPopover();

    const config = instance.getIndicatorConfig();
    const macdLine = config.macdLine;
    const macdSignal = config.macdSignal;
    const macdHist = config.macdHist;

    const popover = document.createElement('div');
    popover.className = 'indicator-popover wide';
    popover.addEventListener('click', (e) => e.stopPropagation());

    const macdTitle = document.createElement('label');
    macdTitle.textContent = 'Cấu hình MACD:';
    macdTitle.style.fontWeight = 'bold';
    macdTitle.style.color = 'var(--text-primary)';

    const fastRow = document.createElement('div');
    fastRow.className = 'indicator-popover-row';
    const fastLabel = document.createElement('span');
    fastLabel.textContent = 'Fast EMA';
    fastLabel.style.fontSize = '11px';
    fastLabel.style.color = 'var(--text-secondary)';
    const fastInput = document.createElement('input');
    fastInput.type = 'number';
    fastInput.min = '1';
    fastInput.max = '200';
    fastInput.value = macdLine.period;
    fastRow.appendChild(fastLabel);
    fastRow.appendChild(fastInput);

    const slowRow = document.createElement('div');
    slowRow.className = 'indicator-popover-row';
    const slowLabel = document.createElement('span');
    slowLabel.textContent = 'Slow EMA';
    slowLabel.style.fontSize = '11px';
    slowLabel.style.color = 'var(--text-secondary)';
    const slowInput = document.createElement('input');
    slowInput.type = 'number';
    slowInput.min = '1';
    slowInput.max = '200';
    slowInput.value = macdHist.period;
    slowRow.appendChild(slowLabel);
    slowRow.appendChild(slowInput);

    const sigRow = document.createElement('div');
    sigRow.className = 'indicator-popover-row';
    const sigLabel = document.createElement('span');
    sigLabel.textContent = 'Signal EMA';
    sigLabel.style.fontSize = '11px';
    sigLabel.style.color = 'var(--text-secondary)';
    const sigInput = document.createElement('input');
    sigInput.type = 'number';
    sigInput.min = '1';
    sigInput.max = '200';
    sigInput.value = macdSignal.period;
    sigRow.appendChild(sigLabel);
    sigRow.appendChild(sigInput);

    const lineRow = document.createElement('div');
    lineRow.className = 'indicator-popover-row';
    const lineLabel = document.createElement('label');
    lineLabel.className = 'ip-checkbox-label';
    const lineCheckbox = document.createElement('input');
    lineCheckbox.type = 'checkbox';
    lineCheckbox.checked = macdLine.enabled;
    lineLabel.appendChild(lineCheckbox);
    lineLabel.appendChild(document.createTextNode('MACD Line'));
    lineRow.appendChild(lineLabel);

    const signalRow = document.createElement('div');
    signalRow.className = 'indicator-popover-row';
    const signalLabel = document.createElement('label');
    signalLabel.className = 'ip-checkbox-label';
    const signalCheckbox = document.createElement('input');
    signalCheckbox.type = 'checkbox';
    signalCheckbox.checked = macdSignal.enabled;
    signalLabel.appendChild(signalCheckbox);
    signalLabel.appendChild(document.createTextNode('Signal Line'));
    signalRow.appendChild(signalLabel);

    const histRow = document.createElement('div');
    histRow.className = 'indicator-popover-row';
    const histLabel = document.createElement('label');
    histLabel.className = 'ip-checkbox-label';
    const histCheckbox = document.createElement('input');
    histCheckbox.type = 'checkbox';
    histCheckbox.checked = macdHist.enabled;
    histLabel.appendChild(histCheckbox);
    histLabel.appendChild(document.createTextNode('Histogram'));
    histRow.appendChild(histLabel);

    const actions = document.createElement('div');
    actions.className = 'indicator-popover-actions';
    actions.style.marginTop = '8px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ip-cancel';
    cancelBtn.textContent = 'Hủy';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'ip-apply';
    applyBtn.textContent = 'Áp dụng';

    function apply() {
      const fastP = parseInt(fastInput.value, 10);
      const slowP = parseInt(slowInput.value, 10);
      const sigP = parseInt(sigInput.value, 10);

      if (fastP && fastP > 0) instance.setIndicatorPeriod('macdLine', fastP);
      if (slowP && slowP > 0) instance.setIndicatorPeriod('macdHist', slowP);
      if (sigP && sigP > 0) instance.setIndicatorPeriod('macdSignal', sigP);

      instance.setIndicatorVisible('macdLine', lineCheckbox.checked);
      instance.setIndicatorVisible('macdSignal', signalCheckbox.checked);
      instance.setIndicatorVisible('macdHist', histCheckbox.checked);

      popover.remove();
      render(paneId, instance);
    }

    applyBtn.addEventListener('click', apply);
    cancelBtn.addEventListener('click', () => popover.remove());

    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);

    popover.appendChild(macdTitle);
    popover.appendChild(fastRow);
    popover.appendChild(slowRow);
    popover.appendChild(sigRow);
    popover.appendChild(lineRow);
    popover.appendChild(signalRow);
    popover.appendChild(histRow);
    popover.appendChild(actions);

    positionPopover(popover, chip);
    fastInput.focus();
    fastInput.select();
  }

  document.addEventListener('click', closeAnyOpenPopover);

    // --- ICHIMOKU CHIP ---
  // Bấm chấm/tên = bật/tắt. Bấm ⚙ = mở hộp thoại cài đặt 3 tab (ichimoku-ui.js).
  function buildIchimokuChip(paneId, instance) {
    const ich = instance.getIndicatorConfig().ichimoku;

    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (ich.enabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = ich.lines.conv.color;

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = `Ichimoku ${ich.conversion},${ich.base},${ich.spanB},${ich.lagging}`;

    const gear = document.createElement('span');
    gear.className = 'indicator-gear';
    gear.title = 'Cài đặt Ichimoku';
        gear.innerHTML = iconHTML('settings');

    function toggle(e) {
      e.stopPropagation();
      instance.setIchimoku({ enabled: !ich.enabled });
      render(paneId, instance);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAnyOpenPopover();
      if (typeof IchimokuUI !== 'undefined') IchimokuUI.open(paneId);
    });

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(gear);
    return chip;
  }

  return { render };
})();