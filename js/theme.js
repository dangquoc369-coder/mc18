/**
 * theme.js
 * Chuyển đổi NỀN SÁNG / NỀN TỐI cho TOÀN BỘ app (kiểu TradingView).
 *
 * Cách làm: đặt attribute `data-theme="light"` hoặc `data-theme="dark"` lên
 * thẻ <html> - css/style.css định nghĩa lại các biến CSS theo attribute này
 * nên hầu hết giao diện tự đổi theo. Riêng chart Lightweight Charts (vẽ bằng
 * canvas, không đọc được biến CSS) nhận sự kiện 'theme:changed' qua EventBus
 * để tự applyOptions() đổi màu (xem chart.js).
 *
 * Lựa chọn theme lưu vào localStorage. Đoạn script đầu <head> (index.html)
 * đã đặt data-theme TRƯỚC khi trang vẽ để tránh "nháy" nền; module này chỉ
 * đọc lại để đồng bộ nút bấm.
 *
 * CẬP NHẬT: nút dùng icon SVG (sun/moon trong icons-ui.js) thay emoji.
 */

const ThemeModule = (function () {
  const STORAGE_KEY = 'dq_tracker_theme_v1';
  let currentTheme = 'dark';
  let btnRef = null;

  function readSavedTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'light' ? 'light' : 'dark';
    } catch (err) {
      return 'dark';
    }
  }

  function persist(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (err) {
      console.error('Không lưu được lựa chọn theme:', err);
    }
  }

  function updateButtonLabel() {
    if (!btnRef) return;
    if (currentTheme === 'dark') {
      btnRef.innerHTML = `<span class="btn-icon">${iconHTML('sun')}</span><span class="btn-text"> Nền sáng</span>`;
      btnRef.title = 'Chuyển sang nền sáng';
    } else {
      btnRef.innerHTML = `<span class="btn-icon">${iconHTML('moon')}</span><span class="btn-text"> Nền tối</span>`;
      btnRef.title = 'Chuyển sang nền tối';
    }
  }

  /** Áp dụng 1 theme: đổi attribute trên <html>, lưu lại, báo cho chart.js. */
  function apply(theme) {
    currentTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    persist(currentTheme);
    updateButtonLabel();
    EventBus.emit('theme:changed', { theme: currentTheme });
  }

  function toggle() {
    apply(currentTheme === 'dark' ? 'light' : 'dark');
  }

  function getTheme() {
    return currentTheme;
  }

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = 'themeToggleBtn';
    btn.className = 'topbar-btn';
    btn.type = 'button';
    btn.addEventListener('click', toggle);
    btnRef = btn;
    updateButtonLabel();
    return btn;
  }

  function mountButton() {
    const btn = buildButton();
    const target = document.querySelector('.topbar-right') || document.getElementById('topbar');
    if (target) {
      target.insertBefore(btn, target.firstChild ? target.firstChild.nextSibling : null);
    } else {
      btn.style.position = 'fixed';
      btn.style.top = '10px';
      btn.style.right = '260px';
      btn.style.zIndex = '9999';
      document.body.appendChild(btn);
    }
  }

  function init() {
    currentTheme = readSavedTheme();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountButton);
    } else {
      mountButton();
    }
  }

  init();

  return { getTheme, toggle, apply };
})();