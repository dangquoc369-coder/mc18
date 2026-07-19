/**
 * marketstatus.js
 * Nút "Trạng thái thị trường" - CHỈ 1 NÚT DUY NHẤT dùng chung cho cả 4 pane.
 *
 * (Các đợt fix trước: getMarketStatus nhận { entryCandles, higherTFCandles },
 * bỏ injectStyles() cứng màu để theo theme sáng/tối - không đổi, xem comment
 * gốc phía dưới.)
 *
 * CẬP NHẬT (đợt fix này - NÚT RELOAD THỦ CÔNG + THỜI GIAN CẬP NHẬT):
 *   Vấn đề: TrendReferenceModule đôi khi cập nhật chậm hơn 1 nhịp so với dữ
 *   liệu nến mới nhất (do cách căn chỉnh đa khung/aligner, xem trend-
 *   reference.js) - trước đây muốn chắc ăn phải F5 lại cả trang.
 *   Giải pháp: thêm nút 🔄 ngay trong header của panel - bấm là gọi lại
 *   showStatus() (tính lại toàn bộ, y hệt logic cũ, không cần reload trang).
 *   Đồng thời thêm dòng "Cập nhật lúc HH:MM:SS" - set lại mỗi lần
 *   showStatus() chạy (dù do bấm nút reload, do đổi pane qua
 *   EventBus 'pane:focused', hay mở panel lần đầu) - để luôn biết chắc panel
 *   đang hiển thị dữ liệu tính tại thời điểm nào, không đoán mò "có phải live
 *   không".
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
    if (v === 'up') return { text: '📈 Tăng', cls: 'ms-trend-up' };
    if (v === 'down') return { text: '📉 Giảm', cls: 'ms-trend-down' };
    if (v === 'sideway') return { text: '⏸️ Sideway', cls: 'ms-trend-side' };
    return { text: '⏳ Đang xác định...', cls: 'ms-muted' };
  }

  function labelForScalp(v) {
    if (v === 'up') return { text: '📈 Xu hướng tăng', cls: 'ms-trend-up' };
    if (v === 'down') return { text: '📉 Xu hướng giảm', cls: 'ms-trend-down' };
    return { text: '⏳ Đang xác định...', cls: 'ms-muted' };
  }

  /**
   * Trend tham khảo MỚI: luôn báo đủ Swing H1|H4|D1 + Scalp, KHÔNG phụ thuộc
   * timeframe đang mở của pane - lấy từ TrendReferenceModule instance riêng
   * của pane (xem TrendRefRegistry trong app.js).
   */
  function buildTrendReferenceHTML(trendRef) {
    if (!trendRef) {
      return `<div class="ms-row ms-muted">⚠️ Chưa có dữ liệu trend tham khảo.</div>`;
    }
    const h1 = labelForSwing(trendRef.swing.h1);
    const h4 = labelForSwing(trendRef.swing.h4);
    const d1 = labelForSwing(trendRef.swing.d1);
    const scalp = labelForScalp(trendRef.scalp);

    return `
      <div class="ms-row ms-bold">🧭 TREND SWING (tham khảo)</div>
      <div class="ms-row ${h1.cls}">H1: ${h1.text}</div>
      <div class="ms-row ${h4.cls}">H4: ${h4.text}</div>
      <div class="ms-row ${d1.cls}">D1: ${d1.text}</div>
      <div class="ms-divider"></div>
      <div class="ms-row ms-bold">⚡ TREND SCALP (tham khảo)</div>
      <div class="ms-row ${scalp.cls}">${scalp.text}</div>
    `;
  }

  function buildStatusHTML(status, paneLabel, trendRef) {
    if (!status.ok) {
      return `<div class="ms-row ms-muted">${status.reason}</div>`;
    }

    const trendRefHTML = buildTrendReferenceHTML(trendRef);

    let tradeHTML = '';
    if (status.activeTradeOpen) {
      const dirLabel = status.activeDirection === 1 ? 'BUY 🔵' : 'SELL 🔴';
      tradeHTML = `
        <div class="ms-divider"></div>
        <div class="ms-row ms-bold">📌 ĐANG THEO DÕI LỆNH: ${dirLabel}</div>
        <div class="ms-row">Entry: ${formatPriceLocalMS(status.activeEntryPrice)}</div>
        <div class="ms-row">Stop Loss: ${formatPriceLocalMS(status.activeSLPrice)}</div>
        <div class="ms-row">Giá hiện tại: ${formatPriceLocalMS(status.currentPrice)}</div>
        <div class="ms-row">📏 Risk: ${formatPriceLocalMS(status.risk)}</div>
        <div class="ms-row ms-muted">🎯 Sẽ cảnh báo khi chạm SL hoặc có đảo chiều</div>`;
    } else {
      tradeHTML = `
        <div class="ms-divider"></div>
        <div class="ms-row ms-bold">⏳ KHÔNG CÓ LỆNH NÀO ĐANG THEO DÕI</div>
        <div class="ms-row ms-muted">🎯 Sẽ cảnh báo khi có tín hiệu breakout mới</div>`;
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
        <span>📊 Trạng thái thị trường</span>
        <span class="ms-header-actions">
          <span class="ms-reload" title="Làm mới ngay">🔄</span>
          <span class="ms-close" title="Đóng">✕</span>
        </span>
      </div>
      <div class="ms-row ms-muted ms-updated-row" id="msLastUpdated">🕒 Cập nhật lúc --:--:--</div>
      <div id="marketStatusBody"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('.ms-close').addEventListener('click', () => panel.classList.remove('open'));
    panel.querySelector('.ms-reload').addEventListener('click', () => showStatus(panel));
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
    // Luôn cập nhật mốc giờ, kể cả khi có lỗi ở trên - để biết chính xác lần
    // tính gần nhất là lúc nào.
    if (updatedEl) updatedEl.textContent = `🕒 Cập nhật lúc ${formatNowClock()}`;
    panel.classList.add('open');
  }

  function createButton(panel) {
    const btn = document.createElement('button');
    btn.id = 'marketStatusBtn';
    btn.className = 'topbar-btn';
    btn.type = 'button';
    btn.innerHTML = '<span class="btn-icon">📊</span><span class="btn-text"> Trạng thái thị trường</span>';
    btn.title = 'Xem trạng thái thị trường';
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