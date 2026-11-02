/**
 * mobile-logo.js
 * Tạo logo app nằm cạnh nút 3 gạch (chỉ hiện ở mobile dọc khi sidebar đang đóng).
 * Sao chép logo từ sidebar nên luôn đồng bộ màu theme.
 */
(function () {
  if (document.getElementById('mobileLogo')) return;
  const src = document.querySelector('#sidebar .logo-mark');
  if (!src) return;
  const wrap = document.createElement('div');
  wrap.id = 'mobileLogo';
  wrap.setAttribute('aria-hidden', 'true');
  // Đổi id gradient để không trùng với logo trong sidebar
  wrap.innerHTML = src.innerHTML.split('logoGrad').join('logoGradMobile');
  document.body.appendChild(wrap);
})();