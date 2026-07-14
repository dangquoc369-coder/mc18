/**
 * indicator-legend.js
 * Vẽ 1 legend nhỏ (giống TradingView) đè lên góc trên-trái của mỗi pane,
 * liệt kê các indicator (EMA21, EMA200, RSI14, EMA9(RSI), WMA45(RSI)) +
 * Volume + chip BUY/SELL.
 *
 * CẬP NHẬT (đợt fix này) - THÊM CHECKBOX "THÔNG BÁO TÍN HIỆU BUY/SELL":
 *   - Trong popover cài đặt breakout (mở qua bánh răng ⚙ của chip BUY/SELL),
 *     thêm 1 checkbox để bật/tắt việc gửi thông báo hệ thống mỗi khi pane
 *     này có tín hiệu BUY/SELL MỚI. Lưu qua Store.setPaneSignalAlertEnabled()
 *     - app.js đọc field này (pane.signalAlertEnabled) khi nhận sự kiện
 *     'pane:newSignal' để quyết định có gửi thông báo hay không.
 *
 * CẬP NHẬT (đợt fix này) - FIX POPOVER BỊ CHE/CẮT TRÊN IPHONE/IPAD:
 *   - TRƯỚC ĐÂY: popover là `position: absolute` và là CON của chính cái
 *     chip (chip.appendChild(popover)). Vì .pane-chart-container có
 *     `overflow: hidden`, nên hễ popover tràn ra ngoài rìa pane (đặc biệt
 *     ở layout nhiều ô, pane nhỏ) là bị CẮT CỤT - không cuộn được, không
 *     bấm được nút "Áp dụng" nằm ở phần bị cắt.
 *   - FIX: thêm hàm positionPopover() - append popover thẳng vào
 *     document.body (thoát khỏi overflow:hidden của pane cha), dùng
 *     `position: fixed` (khai báo ở CSS), rồi tự tính toạ độ dựa trên vị
 *     trí thật của cái chip trên màn hình (getBoundingClientRect), có
 *     clamp để không tràn mép trái/phải/trên/dưới và tự lật lên trên nếu
 *     không đủ chỗ bên dưới. CSS cũng thêm max-height + overflow-y: auto
 *     để phòng trường hợp nội dung dài hơn cả màn hình.
 *   - Tất cả các hàm mở popover (openPeriodPopover, openBreakoutSettingsPopover,
 *     openBBGroupPopover, openRSIGroupPopover, openMACDGroupPopover) đều đổi
 *     dòng `chip.appendChild(popover)` thành `positionPopover(popover, chip)`.
 */

const IndicatorLegend = (function () {
  const collapsedState = {};

  const SL_MODE_LABELS = {
    entry: 'Khung vào lệnh (mặc định)',
    higher: 'Khung trend (cùng cặp entry → trend)',
    custom: 'Khung tuỳ chọn riêng...',
  };

  function isCollapsed(paneId) {
    return !!collapsedState[paneId];
  }

  function render(paneId, instance) {
    const container = document.getElementById(`${paneId}-legend`);
    if (!container) return;
    container.innerHTML = '';

    const collapsed = isCollapsed(paneId);
    container.classList.toggle('legend-collapsed', collapsed);

    container.appendChild(buildCollapseToggle(paneId, instance, collapsed));

    if (collapsed) return;

    // ĐỢT FIX NÀY: đưa chip BUY/SELL lên ĐẦU danh sách (trước EMA21, EMA200...)
    // theo yêu cầu người dùng - đây là chỉ báo chính, nên dễ thấy/dễ bấm nhất.
    container.appendChild(buildBreakoutChip(paneId, instance));

    const config = instance.getIndicatorConfig();
    ['ema21', 'ema200', 'sma50'].forEach((key) => {
      if (config[key]) {
        container.appendChild(buildChip(paneId, instance, key, config[key]));
      }
    });

    container.appendChild(buildBBGroupChip(paneId, instance));
    container.appendChild(buildRSIGroupChip(paneId, instance));
    container.appendChild(buildMACDGroupChip(paneId, instance));

    container.appendChild(buildSimpleToggleChip('#787b86', 'Volume', instance.getVolumeVisible(), (next) => {
      instance.setVolumeVisible(next);
      render(paneId, instance);
    }));
  }

  function buildCollapseToggle(paneId, instance, collapsed) {
    const btn = document.createElement('div');
    btn.className = 'legend-toggle-btn';
    btn.title = collapsed ? 'Mở rộng danh sách chỉ báo' : 'Thu gọn danh sách chỉ báo';
    btn.textContent = collapsed ? '📊 Chỉ báo ▸' : 'Chỉ báo ▾';
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
    gear.textContent = '⚙';

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
    name.textContent = 'BUY/SELL';

    const gear = document.createElement('span');
    gear.className = 'indicator-gear';
    gear.title = 'Cài đặt breakout (số nến / nguồn SL / thông báo)';
    gear.textContent = '⚙';

    function toggle(e) {
      e.stopPropagation();
      Store.setPaneBreakoutVisible(paneId, !enabled);
      render(paneId, instance);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      openBreakoutSettingsPopover(chip, paneId, instance);
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
   * (đợt fix này) checkbox bật/tắt thông báo tín hiệu BUY/SELL mới.
   */
  function openBreakoutSettingsPopover(chip, paneId, instance) {
    closeAnyOpenPopover();

    const current = Store.getPaneBreakoutConfig(paneId) || {
      lookbackCandles: 2,
      slMode: 'entry',
      slTimeframe: null,
    };
    const pane = Store.getPane(paneId);

    const popover = document.createElement('div');
    popover.className = 'indicator-popover wide';
    popover.addEventListener('click', (e) => e.stopPropagation());

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
    notifyHint.textContent = 'Chọn các khung thời gian bạn muốn nhận thông báo khi có tín hiệu BUY/SELL mới (cần cấp quyền thông báo cho trình duyệt/app trước).';

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
    gear.textContent = '⚙';

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

  // --- RSI GROUP CHIP & POPOVER ---
  function buildRSIGroupChip(paneId, instance) {
    const config = instance.getIndicatorConfig();
    const rsi = config.rsi;
    const emaRsi = config.emaRsi;
    const wmaRsi = config.wmaRsi;

    const isAnyEnabled = rsi.enabled || emaRsi.enabled || wmaRsi.enabled;

    const chip = document.createElement('div');
    chip.className = 'indicator-chip' + (isAnyEnabled ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'indicator-dot';
    dot.style.background = rsi.color;

    const name = document.createElement('span');
    name.className = 'indicator-name';
    name.textContent = `RSI ${rsi.period}`;

    const gear = document.createElement('span');
    gear.className = 'indicator-gear';
    gear.title = 'Cài đặt RSI, EMA(RSI) và WMA(RSI)';
    gear.textContent = '⚙';

    function toggle(e) {
      e.stopPropagation();
      if (isAnyEnabled) {
        instance.setIndicatorVisible('rsi', false);
        instance.setIndicatorVisible('emaRsi', false);
        instance.setIndicatorVisible('wmaRsi', false);
      } else {
        instance.setIndicatorVisible('rsi', true);
        instance.setIndicatorVisible('emaRsi', true);
        instance.setIndicatorVisible('wmaRsi', true);
      }
      render(paneId, instance);
    }

    dot.addEventListener('click', toggle);
    name.addEventListener('click', toggle);
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
      openRSIGroupPopover(chip, paneId, instance);
    });

    chip.appendChild(dot);
    chip.appendChild(name);
    chip.appendChild(gear);
    return chip;
  }

  function openRSIGroupPopover(chip, paneId, instance) {
    closeAnyOpenPopover();

    const config = instance.getIndicatorConfig();
    const rsi = config.rsi;
    const emaRsi = config.emaRsi;
    const wmaRsi = config.wmaRsi;

    const popover = document.createElement('div');
    popover.className = 'indicator-popover wide';
    popover.addEventListener('click', (e) => e.stopPropagation());

    const rsiTitle = document.createElement('label');
    rsiTitle.textContent = 'Cấu hình RSI:';
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

      if (rsiP && rsiP > 0) instance.setIndicatorPeriod('rsi', rsiP);
      if (emaP && emaP > 0) instance.setIndicatorPeriod('emaRsi', emaP);
      if (wmaP && wmaP > 0) instance.setIndicatorPeriod('wmaRsi', wmaP);

      instance.setIndicatorVisible('rsi', rsiCheckbox.checked);
      instance.setIndicatorVisible('emaRsi', emaCheckbox.checked);
      instance.setIndicatorVisible('wmaRsi', wmaCheckbox.checked);

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
    gear.textContent = '⚙';

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

  return { render };
})();