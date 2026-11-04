/**
 * marketstatus.js
 * Nút "Phân Tích" - CHỈ 1 NÚT DUY NHẤT dùng chung cho cả 4 pane.
 *
 * Lịch sử: getMarketStatus nhận { entryCandles, higherTFCandles }; panel bám
 * theme sáng/tối (không hardcode màu); nút 🔄 làm mới thủ công (đá lại socket
 * trend tham khảo của pane đang xem qua forceReconnectPaneTrendRef) + dòng
 * "Cập nhật lúc HH:MM:SS" để biết chắc dữ liệu tính lúc nào.
 *
 * CẬP NHẬT: toàn bộ emoji đổi sang icon SVG cùng phong cách app
 * (icons-ui.js). Logic giữ nguyên.
 */

(function () {
  function formatPriceLocalMS(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    const digits = Math.abs(value) < 1 ? 6 : 2;
    return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatTime(unixSeconds) {
    if (!unixSeconds) return '--';
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  }

  /** Giờ:phút:giây hiện tại của MÁY người dùng - dùng cho dòng "Cập nhật lúc". */
  function formatNowClock() {
    return new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function labelForSwing(v) {
    if (v === 'up') return { icon: 'trendUp', text: 'Tăng', cls: 'ms-trend-up' };
    if (v === 'down') return { icon: 'trendDown', text: 'Giảm', cls: 'ms-trend-down' };
    if (v === 'sideway') return { icon: 'sideway', text: 'Sideway', cls: 'ms-trend-side' };
    return { icon: 'clock', text: 'Đang xác định...', cls: 'ms-muted' };
  }

  function labelForScalp(v) {
    if (v === 'up') return { icon: 'trendUp', text: 'Xu hướng tăng', cls: 'ms-trend-up' };
    if (v === 'down') return { icon: 'trendDown', text: 'Xu hướng giảm', cls: 'ms-trend-down' };
    return { icon: 'clock', text: 'Đang xác định...', cls: 'ms-muted' };
  }

  /**
   * Trend tham khảo: luôn báo đủ Swing H1|H4|D1 + Scalp, KHÔNG phụ thuộc
   * timeframe đang mở của pane - lấy từ TrendReferenceModule instance riêng
   * của pane (xem TrendRefRegistry trong app.js).
   */
  function buildTrendReferenceHTML(trendRef) {
    if (!trendRef) {
      return `<div class="ms-row ms-muted">${iconInline('warning')} Chưa có dữ liệu trend tham khảo.</div>`;
    }
    const h1 = labelForSwing(trendRef.swing.h1);
    const h4 = labelForSwing(trendRef.swing.h4);
    const d1 = labelForSwing(trendRef.swing.d1);
    const scalp = labelForScalp(trendRef.scalp);

    return `
      <div class="ms-row ms-bold">${iconInline('compass')} TREND SWING (tham khảo)</div>
      <div class="ms-row ${h1.cls}">H1: ${iconInline(h1.icon)} ${h1.text}</div>
      <div class="ms-row ${h4.cls}">H4: ${iconInline(h4.icon)} ${h4.text}</div>
      <div class="ms-row ${d1.cls}">D1: ${iconInline(d1.icon)} ${d1.text}</div>
      <div class="ms-divider"></div>
      <div class="ms-row ms-bold">${iconInline('prioMedium')} TREND SCALP (tham khảo)</div>
      <div class="ms-row ${scalp.cls}">${iconInline(scalp.icon)} ${scalp.text}</div>
    `;
  }

  function buildStatusHTML(status, paneLabel, trendRef) {
    if (!status.ok) {
      return `<div class="ms-row ms-muted">${status.reason}</div>`;
    }

    const trendRefHTML = buildTrendReferenceHTML(trendRef);

    let tradeHTML = '';
    if (status.activeTradeOpen) {
      const isBuy = status.activeDirection === 1;
      const dirLabel = isBuy
        ? `<span class="ms-trend-up">BUY</span>`
        : `<span class="ms-trend-down">SELL</span>`;
      tradeHTML = `
        <div class="ms-divider"></div>
        <div class="ms-row ms-bold">${iconInline('pin')} ĐANG THEO DÕI LỆNH: ${dirLabel}</div>
        <div class="ms-row">Entry: ${formatPriceLocalMS(status.activeEntryPrice)}</div>
        <div class="ms-row">Stop Loss: ${formatPriceLocalMS(status.activeSLPrice)}</div>
        <div class="ms-row">Giá hiện tại: ${formatPriceLocalMS(status.currentPrice)}</div>
        <div class="ms-row">${iconInline('ruler')} Risk: ${formatPriceLocalMS(status.risk)}</div>
        <div class="ms-row ms-muted">${iconInline('target')} Sẽ cảnh báo khi chạm SL hoặc có đảo chiều</div>`;
    } else {
      tradeHTML = `
        <div class="ms-divider"></div>
        <div class="ms-row ms-bold">${iconInline('clock')} KHÔNG CÓ LỆNH NÀO ĐANG THEO DÕI</div>
        <div class="ms-row ms-muted">${iconInline('target')} Sẽ cảnh báo khi có tín hiệu breakout mới</div>`;
    }

    return `
      <div class="ms-row ms-bold">${paneLabel}</div>
      <div class="ms-divider"></div>
      ${trendRefHTML}
      ${tradeHTML}
    `;
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'marketStatusPanel';
    panel.className = 'ms-panel';
    panel.innerHTML = `
      <div class="ms-header">
        <span>${iconInline('marketStatus')} Phân Tích</span>
        <span class="ms-header-actions">
          <span class="ms-reload" title="Làm mới ngay">${iconHTML('reload')}</span>
          <span class="ms-close" title="Đóng">${iconHTML('close')}</span>
        </span>
      </div>
      <div class="ms-row ms-muted ms-updated-row" id="msLastUpdated">${iconInline('clock')} Cập nhật lúc --:--:--</div>
      <div id="marketStatusBody"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.ms-close').addEventListener('click', () => panel.classList.remove('open'));
    panel.querySelector('.ms-reload').addEventListener('click', () => {
      const reloadIcon = panel.querySelector('.ms-reload');
      const activePane = Store.getActivePane();

      // Reload ĐÁ LẠI đúng socket trend tham khảo (M5/H2) của pane đang xem,
      // xử lý lúc socket bị "zombie" mà watchdog (mỗi 10s) chưa kịp bắt.
      if (typeof forceReconnectPaneTrendRef === 'function') {
        forceReconnectPaneTrendRef(activePane.id);
      }

      if (reloadIcon) {
        reloadIcon.classList.add('ms-reload-spinning');
        setTimeout(() => reloadIcon.classList.remove('ms-reload-spinning'), 800);
      }

      showStatus(panel);
      // Socket vừa reconnect cần 1 nhịp mới có message đầu - tính lại sau ~1.5s
      setTimeout(() => {
        if (panel.classList.contains('open')) showStatus(panel);
      }, 1500);
    });
    return panel;
  }

  function showStatus(panel) {
    const body = panel.querySelector('#marketStatusBody');
    const updatedEl = panel.querySelector('#msLastUpdated');
    try {
      const activePane = Store.getActivePane();
      const instance = window.PaneRegistry.get(activePane.id);
      const entryCandles = instance.getCandles();
      const higherTFCandles = typeof instance.getHigherTFCandles === 'function' ? instance.getHigherTFCandles() : [];
      const status = instance.getBreakout().getMarketStatus({ entryCandles, higherTFCandles });

      const trendRefInstance = window.TrendRefRegistry ? window.TrendRefRegistry.get(activePane.id) : null;
      const trendRef = trendRefInstance ? trendRefInstance.compute() : null;

      const paneLabel = `Pane đang xem: ${activePane.symbol} (${activePane.timeframe})`;
      body.innerHTML = buildStatusHTML(status, paneLabel, trendRef);
    } catch (err) {
      body.innerHTML = `<div class="ms-row ms-muted">Lỗi khi lấy trạng thái: ${err.message}</div>`;
      console.error('marketstatus.js error:', err);
    }
    // Luôn cập nhật mốc giờ, kể cả khi có lỗi - để biết lần tính gần nhất.
    if (updatedEl) updatedEl.innerHTML = `${iconInline('clock')} Cập nhật lúc ${formatNowClock()}`;
    panel.classList.add('open');
  }

  function createButton(panel) {
    const btn = document.createElement('button');
    btn.id = 'marketStatusBtn';
    btn.className = 'topbar-btn';
    btn.type = 'button';
    btn.innerHTML = `<span class="btn-icon">${iconHTML('marketStatus')}</span><span class="btn-text"> Phân Tích</span>`;
    btn.title = 'Xem Phân Tích';
    btn.addEventListener('click', () => {
      if (panel.classList.contains('open')) {
        panel.classList.remove('open');
      } else {
        showStatus(panel);
      }
    });
    return btn;
  }

  function bindAutoRefreshOnFocusChange(panel) {
    EventBus.on('pane:focused', () => {
      if (panel.classList.contains('open')) showStatus(panel);
    });
  }

  function mount() {
    const panel = createPanel();
    const btn = createButton(panel);
    bindAutoRefreshOnFocusChange(panel);

    const target = document.querySelector('.topbar-right') || document.getElementById('topbar');
    if (target) {
      target.appendChild(btn);
    } else {
      btn.style.position = 'fixed';
      btn.style.top = '10px';
      btn.style.right = '20px';
      btn.style.zIndex = '9999';
      document.body.appendChild(btn);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();