const AlertsModule = (function () {
  const STORAGE_KEY = 'dq_tracker_price_alerts_v1';

  // ĐỢT FIX NÀY: nhãn hiển thị cho các khung giờ thông báo tín hiệu BUY/SELL
  // (Store.getEnabledSignalTimeframes()) - dùng để liệt kê trong panel Cảnh
  // báo, để người dùng thấy và xoá tay được y hệt cảnh báo giá.
  const SIGNAL_TF_LABELS = {
    '5m': 'M5',
    '15m': 'M15',
    '30m': 'M30',
    '1h': 'H1',
    '2h': 'H2',
  };

  let alerts = load();
  let panelEl = null;
  const lastPriceForSymbol = {};

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('Lỗi khi đọc cảnh báo đã lưu:', err);
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
    } catch (err) {
      console.error('Lỗi khi lưu cảnh báo:', err);
    }
  }

  function addPriceAlert(symbol, price) {
    if (typeof LoginModule !== 'undefined' && LoginModule.getStoredUsername && !LoginModule.getStoredUsername()) {
      if (LoginModule.showLoginOverlay) {
        LoginModule.showLoginOverlay('Bạn đang ở vai trò Khách. Hãy lập hoặc đăng nhập tài khoản để đặt và nhận cảnh báo riêng.');
      }
      return null;
    }
    const alert = {
      id: uid('alert'),
      symbol,
      price,
      triggered: false,
      createdAt: Date.now(),
    };
    alerts.push(alert);
    persist();
    EventBus.emit('alerts:changed', {});
    renderPanel();
    return alert;
  }

  function removeAlert(id) {
    alerts = alerts.filter((a) => a.id !== id);
    persist();
    EventBus.emit('alerts:changed', {});
    renderPanel();
  }

  function getAlertsForSymbol(symbol) {
    if (typeof LoginModule !== 'undefined' && LoginModule.getStoredUsername && !LoginModule.getStoredUsername()) {
      return [];
    }
    return alerts.filter((a) => a.symbol === symbol && !a.triggered);
  }

  function getAllAlerts() {
    if (typeof LoginModule !== 'undefined' && LoginModule.getStoredUsername && !LoginModule.getStoredUsername()) {
      return [];
    }
    return alerts.slice();
  }

  /**
   * ĐỢT FIX NÀY: gỡ 1 khung giờ khỏi danh sách thông báo tín hiệu BUY/SELL
   * (Store.getEnabledSignalTimeframes()) - gọi khi người dùng bấm "Xoá" ở
   * mục tín hiệu trong panel Cảnh báo, y hệt cách removeAlert() xoá 1 cảnh
   * báo giá. Việc lưu lại (localStorage) + đồng bộ ngược lại checkbox trong
   * popover cài đặt breakout (indicator-legend.js) đã do Store lo sẵn, ở
   * đây chỉ cần lọc bỏ phần tử rồi gọi lại Store.setEnabledSignalTimeframes.
   */
  function removeSignalTimeframe(tf) {
    const current = Store.getEnabledSignalTimeframes() || [];
    Store.setEnabledSignalTimeframes(current.filter((t) => t !== tf));
    renderPanel();
  }

  function checkPrice(symbol, price) {
    // Vai trò khách: không phát cảnh báo
    if (typeof LoginModule !== 'undefined' && LoginModule.getStoredUsername && !LoginModule.getStoredUsername()) {
      return;
    }
    const prev = lastPriceForSymbol[symbol];
    lastPriceForSymbol[symbol] = price;
    if (prev === undefined || price === null || price === undefined || Number.isNaN(price)) return;

    let changed = false;
    alerts.forEach((a) => {
      if (a.triggered || a.symbol !== symbol) return;
      const crossedUp = prev < a.price && price >= a.price;
      const crossedDown = prev > a.price && price <= a.price;
      if (crossedUp || crossedDown) {
        a.triggered = true;
        changed = true;
        NotificationsModule.notify('🔔 Cảnh báo giá', `${symbol} đã chạm mức ${formatPrice(a.price)}`);
      }
    });

    if (changed) {
      persist();
      EventBus.emit('alerts:changed', {});
      renderPanel();
    }
  }
  /** Gộp cảnh báo tải về từ server vào danh sách local - dùng khi đăng
   * nhập trên máy mới (push-sync.js gọi trước khi đồng bộ ngược lên), để
   * KHÔNG bị ghi đè/xoá mất cảnh báo cũ chỉ vì máy mới chưa có gì trong
   * localStorage. Bỏ qua id đã tồn tại (tránh trùng nếu gọi nhiều lần). */
  function mergeFromServer(remoteAlerts) {
    if (!Array.isArray(remoteAlerts) || remoteAlerts.length === 0) return;
    const existingIds = new Set(alerts.map((a) => a.id));
    let added = false;
    remoteAlerts.forEach((r) => {
      if (!r || !r.id || !r.symbol || typeof r.price !== 'number' || existingIds.has(r.id)) return;
      alerts.push({ id: r.id, symbol: r.symbol, price: r.price, triggered: false, createdAt: Date.now() });
      added = true;
    });
    if (added) {
      persist();
      EventBus.emit('alerts:changed', {});
      renderPanel();
    }
  }

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = 'alertsListBtn';
    btn.className = 'topbar-btn';
    btn.type = 'button';
    btn.innerHTML = btn.innerHTML = `<span class="btn-icon">${iconHTML('bell')}</span><span class="btn-text"> Cảnh báo</span>`;;
    btn.title = 'Xem và quản lý cảnh báo';
    btn.addEventListener('click', () => {
      if (panelEl.classList.contains('open')) {
        panelEl.classList.remove('open');
      } else {
        renderPanel();
        panelEl.classList.add('open');
      }
    });
    return btn;
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'alertsListPanel';
    panel.className = 'ms-panel';
    panel.innerHTML = `
      <div class="ms-header">
        <span>${iconInline('bell')} Danh sách cảnh báo giá</span>
        <span class="ms-close">${iconHTML('close')}</span>
      </div>
      <div id="alertsListBody"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.ms-close').addEventListener('click', () => panel.classList.remove('open'));
    return panel;
  }

  function renderPanel() {
    if (!panelEl) return;
    const body = panelEl.querySelector('#alertsListBody');
    const isGuest = typeof LoginModule !== 'undefined' && LoginModule.getStoredUsername && !LoginModule.getStoredUsername();

    if (isGuest) {
      body.innerHTML = `
        <div style="padding: 16px 14px; text-align: center; background: rgba(79, 124, 255, 0.08); border: 1px solid rgba(79, 124, 255, 0.25); border-radius: 12px; margin-bottom: 12px;">
          <div style="display:flex; justify-content:center; margin-bottom:8px; color:var(--accent-blue);"><span class="ms-ico" style="width:32px;height:32px;margin:0;">${Icons.account}</span></div>
          <div style="font-size: 14px; font-weight: 600; color: var(--text-primary, #f0f2f8); margin-bottom: 6px;">
            Bạn đang ở vai trò Khách
          </div>
          <div style="font-size: 12.5px; color: var(--text-secondary, #9aa3b8); line-height: 1.55; margin-bottom: 14px;">
            Vai trò Khách giúp bạn theo dõi biểu đồ thoải mái, không ghi đè dữ liệu lên máy chủ và không có cảnh báo. Hãy lập tài khoản để cài đặt và nhận các <b>cảnh báo riêng</b> (giá, tín hiệu BUY/SELL).
          </div>
          <button id="guestPromptLoginBtn" type="button" style="width: 100%; padding: 10px; border-radius: 8px; background: #4f7cff; color: #fff; font-weight: 600; border: none; cursor: pointer; font-size: 13.5px;">
            Đăng nhập / Lập tài khoản ngay
          </button>
        </div>
        <div class="ms-row ms-muted" style="text-align: center; font-size: 12px;">
          Chỉ cần Tên + PIN để nhận cảnh báo riêng mà không sợ bị trùng lặp với người khác.
        </div>
      `;
      const btn = body.querySelector('#guestPromptLoginBtn');
      if (btn) {
        btn.addEventListener('click', () => {
          if (panelEl) panelEl.classList.remove('open');
          if (typeof LoginModule !== 'undefined' && LoginModule.showLoginOverlay) {
            LoginModule.showLoginOverlay('Lập hoặc đăng nhập tài khoản để bật và nhận cảnh báo riêng của bạn:');
          }
        });
      }
      return;
    }

    const list = getAllAlerts();
    const enabledTFs = (Store.getEnabledSignalTimeframes() || []).slice();

    // ---- Mục 1: Cảnh báo giá (như cũ) ----
    let priceHTML = '';
    if (list.length === 0) {
      priceHTML = `<div class="ms-row ms-muted">Chưa có cảnh báo nào. Chọn công cụ 🔔 trong thanh vẽ rồi click lên chart để đặt mức giá.</div>`;
    } else {
      priceHTML = list
        .slice()
        .reverse()
        .map(
          (a) => `
          <div class="alert-item ${a.triggered ? 'alert-triggered' : ''}">
            <div>
              <div class="ms-bold">${a.symbol}</div>
              <div class="ms-muted">Mức: ${formatPrice(a.price)}${a.triggered ? ' · đã chạm' : ''}</div>
            </div>
            <button data-id="${a.id}" class="alert-remove-btn" type="button">Xoá</button>
          </div>`
        )
        .join('');
    }

    // ---- Mục 2 (ĐỢT FIX NÀY): Thông báo tín hiệu BUY/SELL đang bật ----
    // Đây là các khung giờ người dùng đã tích trong popover ⚙ cài đặt
    // breakout (indicator-legend.js) - liệt kê lại ở đây để thấy rõ đang
    // bật khung nào và xoá tay được, y hệt cảnh báo giá.
    let signalHTML = '';
    if (enabledTFs.length === 0) {
      signalHTML = `<div class="ms-row ms-muted">Chưa bật thông báo tín hiệu BUY/SELL ở khung nào. Mở ⚙ cài đặt của chip BUY/SELL trên chart để chọn khung.</div>`;
    } else {
      signalHTML = enabledTFs
        .map(
          (tf) => `
          <div class="alert-item">
            <div>
              <div class="ms-bold">${SIGNAL_TF_LABELS[tf] || tf}</div>
              <div class="ms-muted">Báo khi có tín hiệu BUY/SELL mới ở khung này</div>
            </div>
            <button data-tf="${tf}" class="alert-remove-btn" type="button">Xoá</button>
          </div>`
        )
        .join('');
    }

    const isSoundOn = typeof NotificationsModule !== 'undefined' ? NotificationsModule.getSoundEnabled() : true;

    body.innerHTML = `
      <div class="ms-row ms-bold" style="display:flex; justify-content:space-between; align-items:center;">
        <span>${iconInline('volume')} Âm thanh thông báo</span>
        <div>
          <button id="testSoundBtn" type="button" class="alert-remove-btn" style="margin-right:6px; background:var(--accent-color, #2962ff); color:#fff; border:none;">Thử chuông</button>
          <button id="toggleSoundBtn" type="button" class="alert-remove-btn">${isSoundOn ? 'Tắt' : 'Bật'}</button>
        </div>
      </div>
      <div class="ms-divider"></div>
      <div class="ms-row ms-bold">${iconInline('bell')} Cảnh báo giá</div>
      ${priceHTML}
      <div class="ms-divider"></div>
      <div class="ms-row ms-bold">${iconInline('tabChart')} Thông báo tín hiệu BUY/SELL</div>
      ${signalHTML}
    `;

    const testSoundBtn = body.querySelector('#testSoundBtn');
    if (testSoundBtn) {
      testSoundBtn.addEventListener('click', () => {
        if (typeof NotificationsModule !== 'undefined') {
          NotificationsModule.playSound();
        }
      });
    }

    const toggleSoundBtn = body.querySelector('#toggleSoundBtn');
    if (toggleSoundBtn) {
      toggleSoundBtn.addEventListener('click', () => {
        if (typeof NotificationsModule !== 'undefined') {
          const nextState = !NotificationsModule.getSoundEnabled();
          NotificationsModule.setSoundEnabled(nextState);
          renderPanel();
        }
      });
    }

    body.querySelectorAll('.alert-remove-btn[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => removeAlert(btn.dataset.id));
    });
    body.querySelectorAll('.alert-remove-btn[data-tf]').forEach((btn) => {
      btn.addEventListener('click', () => removeSignalTimeframe(btn.dataset.tf));
    });
  }

  function mountUI() {
    panelEl = buildPanel();
    const btn = buildButton();
    const target = document.querySelector('.topbar-right') || document.getElementById('topbar');
    if (target) {
      target.appendChild(btn);
    } else {
      btn.style.position = 'fixed';
      btn.style.top = '10px';
      btn.style.right = '160px';
      btn.style.zIndex = '9999';
      document.body.appendChild(btn);
    }
  }

  function init() {
    // ĐỢT FIX NÀY: khi danh sách khung giờ thông báo tín hiệu BUY/SELL đổi
    // từ nơi khác (vd người dùng tích/bỏ tích trong popover ⚙ của chip
    // BUY/SELL - xem indicator-legend.js gọi Store.setEnabledSignalTimeframes()),
    // panel Cảnh báo cần vẽ lại để đồng bộ đúng danh sách hiện tại.
    EventBus.on('pane:breakoutConfigChanged', renderPanel);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountUI);
    } else {
      mountUI();
    }
  }

  init();

  return { addPriceAlert, removeAlert, getAlertsForSymbol, getAllAlerts, checkPrice, mergeFromServer };
})();