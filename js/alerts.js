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
    return alerts.filter((a) => a.symbol === symbol && !a.triggered);
  }

  function getAllAlerts() {
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

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = 'alertsListBtn';
    btn.className = 'topbar-btn';
    btn.type = 'button';
    btn.innerHTML = '<span class="btn-icon">🔔</span><span class="btn-text"> Cảnh báo</span>';
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
        <span>🔔 Danh sách cảnh báo giá</span>
        <span class="ms-close">✕</span>
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

    body.innerHTML = `
      <div class="ms-row ms-bold">🔔 Cảnh báo giá</div>
      ${priceHTML}
      <div class="ms-divider"></div>
      <div class="ms-row ms-bold">📊 Thông báo tín hiệu BUY/SELL</div>
      ${signalHTML}
    `;

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

  return { addPriceAlert, removeAlert, getAlertsForSymbol, getAllAlerts, checkPrice };
})();