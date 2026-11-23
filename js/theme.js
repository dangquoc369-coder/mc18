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
 *
 * CẬP NHẬT (dải status bar trên cùng của iPad/iPhone PWA):
 * Dải này do HỆ THỐNG vẽ nên CSS không tô màu được. Cách duy nhất không phá
 * layout là đổi meta apple-mobile-web-app-status-bar-style theo theme:
 *   - nền tối  -> 'black'   (dải đen đặc, chữ trắng, nội dung nằm bên dưới)
 *   - nền sáng -> 'default' (dải trắng đặc, chữ đen - như hiện tại)
 * Cả hai kiểu đều ĐẶC và đẩy nội dung xuống dưới, nên không cần đổi
 * --safe-top / viewport-fit. Đồng thời cập nhật theme-color cho trình duyệt
 * thường (Safari tab). Đoạn script đầu <head> trong index.html cũng đặt meta
 * này sớm theo theme đã lưu để lần mở app sau đã đúng ngay từ đầu.
 */

const ThemeModule = (function () {
  const STORAGE_KEY = 'dq_tracker_theme_v1';
  let currentTheme = 'dark';
  let btnRef = null;

  // Kiểu status bar + màu theme-color theo từng theme
  const STATUS_BAR_STYLE = { dark: 'black', light: 'default' };
  const THEME_COLOR = { dark: '#10141c', light: '#ffffff' }; // = --bg-panel

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

  function setMeta(name, content) {
    let meta = document.querySelector('meta[name="' + name + '"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', name);
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', content);
  }

  /** Đồng bộ dải status bar hệ thống với theme của app. */
  function applyStatusBar(theme) {
    try {
      setMeta('apple-mobile-web-app-status-bar-style', STATUS_BAR_STYLE[theme] || 'default');
      setMeta('theme-color', THEME_COLOR[theme] || '#ffffff');
    } catch (err) {
      console.error('Không cập nhật được status bar:', err);
    }
  }

  function updateButtonLabel() {
    if (!btnRef) return;
    if (currentTheme === 'dark') {
      btnRef.innerHTML = iconHTML('sun');
      btnRef.title = 'Chuyển sang nền sáng';
    } else {
      btnRef.innerHTML = iconHTML('moon');
      btnRef.title = 'Chuyển sang nền tối';
    }
    btnRef.setAttribute('aria-label', btnRef.title);
  }

  /** Áp dụng 1 theme: đổi attribute trên <html>, lưu lại, báo cho chart.js. */
  function apply(theme) {
    currentTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    persist(currentTheme);
    applyStatusBar(currentTheme);
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
    btn.className = 'topbar-btn topbar-btn-icon-only';
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
      target.appendChild(btn);
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
    applyStatusBar(currentTheme);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountButton);
    } else {
      mountButton();
    }
  }

  init();

  return { getTheme, toggle, apply };
})();