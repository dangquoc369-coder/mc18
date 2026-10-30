/**
 * topbar-fit.js
 * Giữ topbar (màn NGANG, class html.tb-merged) luôn trên 1 hàng và HIỆN CHỮ
 * trên các nút càng nhiều càng tốt. Khi không đủ chỗ, lần lượt thu gọn:
 *
 *   level 0: đầy đủ - nút khung giờ nhanh (15m/1H/4H/1D) + chữ trên mọi nút
 *   level 1: ẩn nút khung giờ nhanh, chỉ còn ô chọn (hiện khung đang dùng, bấm mũi tên để chọn khác)
 *   level 2: + nút "Trạng thái thị trường" chỉ còn icon (chữ dài nhất)
 *   level 3: + mọi nút chỉ còn icon
 *
 * Mỗi lần đo bắt đầu lại từ level 0 rồi tăng dần tới khi vừa, nên khi rộng
 * ra (xoay máy, đổi cỡ cửa sổ, đổi tên tài khoản...) giao diện tự mở lại.
 * CSS tương ứng nằm trong css/topbar-landscape.css (data-tb-level).
 * Nếu đã ở level 3 mà vẫn tràn thì #controlBar tự cuộn ngang (không xuống dòng).
 */
(function () {
  const root = document.documentElement;
  const MAX_LEVEL = 3;
  let scheduled = false;

  function overflowing(topbar, bar) {
    if (topbar.scrollWidth > topbar.clientWidth + 1) return true;
    if (bar && bar.offsetWidth > 0 && bar.scrollWidth > bar.clientWidth + 1) return true;
    return false;
  }

  function fit() {
    scheduled = false;
    const topbar = document.getElementById('topbar');
    const bar = document.getElementById('controlBar');
    if (!topbar) return;

    if (!root.classList.contains('tb-merged')) {
      root.removeAttribute('data-tb-level');
      return;
    }

    let level = 0;
    root.setAttribute('data-tb-level', '0');
    while (level < MAX_LEVEL && overflowing(topbar, bar)) {
      level++;
      root.setAttribute('data-tb-level', String(level));
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(fit);
  }

  function init() {
    const topbar = document.getElementById('topbar');
    const bar = document.getElementById('controlBar');
    if (!topbar) return;

    if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(topbar);

    // Các module thêm/đổi nút (theme, cảnh báo, tài khoản...), ui.js vẽ lại khung giờ
    new MutationObserver(schedule).observe(topbar, { childList: true, subtree: true, characterData: true });
    // tasks.js / analytics.js ẩn-hiện #controlBar bằng style.display
    if (bar) new MutationObserver(schedule).observe(bar, { attributes: true, attributeFilter: ['style'] });

    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', () => setTimeout(schedule, 150));
    window.addEventListener('load', schedule);
    if (window.matchMedia) {
      const mq = window.matchMedia('(orientation: landscape)');
      if (mq.addEventListener) mq.addEventListener('change', schedule);
      else if (mq.addListener) mq.addListener(schedule);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();