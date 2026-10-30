/**
 * login.js
 * "Tài khoản nhẹ" (tên + PIN) - để nhiều người dùng chung app KHÔNG bị lẫn
 * cảnh báo của nhau, thay cho deviceId sinh ngẫu nhiên hoàn toàn như trước.
 *
 * ĐÂY KHÔNG PHẢI hệ thống bảo mật thật (PIN chỉ 4-6 số, không giới hạn số
 * lần thử) - chỉ đủ để vài người quen biết nhau dùng chung 1 app mà không
 * vô tình lẫn cảnh báo, và đăng nhập lại đúng "hồ sơ" của mình trên thiết
 * bị khác. KHÔNG dùng cho dữ liệu nhạy cảm.
 *
 * CÁCH HOẠT ĐỘNG:
 *   - Nếu localStorage CHƯA có identity (key dq_tracker_device_id_v1,
 *     GIỐNG HỆT key mà push-sync.js dùng làm deviceId) -> hiện màn hình
 *     đăng nhập che toàn bộ app, bắt nhập Tên + PIN trước khi dùng.
 *   - Gọi POST /api/login (worker/src/index.js): tên chưa ai dùng -> tạo
 *     hồ sơ mới; tên đã có -> phải đúng PIN mới qua.
 *   - Đăng nhập xong -> lưu "tên" (đã chuẩn hoá) vào ĐÚNG key localStorage
 *     mà push-sync.js đọc làm deviceId -> RELOAD lại trang. Sau khi reload,
 *     push-sync.js chạy lại từ đầu, tự động dùng đúng identity mới, đồng
 *     bộ alerts/signals như bình thường - không cần sửa gì thêm ở
 *     push-sync.js ngoài việc chặn nó tự sinh ID ngẫu nhiên (xem
 *     push-sync.js đã cập nhật).
 *   - Có 1 nút "👤 <tên>" ở góc topbar để đổi sang tài khoản khác (xoá
 *     identity cục bộ + reload) - dữ liệu trên server của tài khoản cũ
 *     không mất, đăng nhập lại đúng tên + PIN là lấy lại được.
 *
 * BẮT BUỘC: WORKER_URL bên dưới phải GIỐNG HỆT WORKER_URL trong
 * push-sync.js (2 chỗ luôn phải khớp nhau).
 */

const LoginModule = (function () {
  const WORKER_URL = 'https://dq-tracker-push.quocngyendanght.workers.dev';
  const DEVICE_ID_KEY = 'dq_tracker_device_id_v1'; // PHẢI khớp push-sync.js

  function isConfigured() {
    return !!WORKER_URL && WORKER_URL.startsWith('https://');
  }

  function getStoredUsername() {
    try {
      return localStorage.getItem(DEVICE_ID_KEY);
    } catch (err) {
      return null;
    }
  }

  function setStoredUsername(username) {
    try {
      localStorage.setItem(DEVICE_ID_KEY, username);
    } catch (err) {
      console.error('[login.js] Không lưu được tài khoản vào localStorage:', err);
    }
  }

  function clearStoredUsername() {
    try {
      localStorage.removeItem(DEVICE_ID_KEY);
    } catch (err) {
      // bỏ qua
    }
  }

  function injectStyles() {
    if (document.getElementById('loginModuleStyles')) return;
    const style = document.createElement('style');
    style.id = 'loginModuleStyles';
    // Style tối giản, KHÔNG phụ thuộc biến CSS của theme.js (màn hình đăng
    // nhập hiện TRƯỚC khi app/theme sẵn sàng) - dùng nền tối trung tính,
    // đủ đọc được ở cả 2 theme, không cần đồng bộ theo nền sáng/tối.
    style.textContent = `
      #loginOverlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(10, 12, 20, 0.88);
        backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #loginOverlay .login-box {
        width: 100%; max-width: 330px;
        background: #1b1f2b; border: 1px solid #2c3244; border-radius: 14px;
        padding: 22px 20px; box-sizing: border-box;
        box-shadow: 0 16px 48px rgba(0,0,0,0.5);
        position: relative;
      }
      #loginOverlay .login-header {
        display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
      }
      #loginOverlay .login-title {
        color: #f0f2f8; font-size: 17.5px; font-weight: 600;
      }
      #loginOverlay .login-close-btn {
        background: none; border: none; color: #9aa3b8; font-size: 20px;
        line-height: 1; cursor: pointer; padding: 4px 6px; border-radius: 6px;
      }
      #loginOverlay .login-close-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
      #loginOverlay .login-sub {
        color: #9aa3b8; font-size: 12.5px; line-height: 1.5; margin-bottom: 16px;
      }
      #loginOverlay .login-notice {
        padding: 8px 10px; background: rgba(79, 124, 255, 0.12);
        border: 1px solid rgba(79, 124, 255, 0.28); border-radius: 8px;
        color: #b8c8ff; font-size: 12px; margin-bottom: 12px; line-height: 1.45;
      }
      #loginOverlay input {
        width: 100%; box-sizing: border-box; padding: 11px 12px; margin-bottom: 10px;
        border-radius: 8px; border: 1px solid #333a4d; background: #12151f; color: #f0f2f8;
        font-size: 14.5px; outline: none;
      }
      #loginOverlay input:focus { border-color: #4f7cff; }
      #loginOverlay .login-error {
        display: none; color: #ff6b6b; font-size: 12.5px; margin: -2px 0 10px; line-height: 1.4;
      }
      #loginOverlay button#loginSubmitBtn {
        width: 100%; padding: 11px; border: none; border-radius: 8px;
        background: #4f7cff; color: #fff; font-size: 14.5px; font-weight: 600;
        cursor: pointer; margin-top: 2px;
      }
      #loginOverlay button#loginSubmitBtn:disabled { opacity: 0.6; cursor: default; }
      #loginOverlay button#loginCancelBtn {
        width: 100%; padding: 9px; margin-top: 8px;
        border: 1px solid #333a4d; border-radius: 8px;
        background: transparent; color: #9aa3b8; font-size: 13px;
        cursor: pointer; transition: all 0.15s;
      }
      #loginOverlay button#loginCancelBtn:hover {
        color: #f0f2f8; border-color: #4f7cff;
      }
      #profileBadgeBtn .btn-text { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: bottom; }
      #profileBadgeBtn.is-guest {
        border: 1px dashed var(--accent-blue, #4f7cff);
        color: var(--accent-blue, #4f7cff);
      }

      /* Nút profile trên sidebar cho mobile */
      #profileBadgeSidebar {
        display: none;
        align-items: center;
        gap: 6px;
        margin: 10px 12px 4px;
        padding: 7px 10px;
        border: 1px solid var(--border-color, #2c3244);
        border-radius: 6px;
        font-size: 12px;
        color: var(--text-primary, #d1d4dc);
        cursor: pointer;
        width: fit-content;
        max-width: calc(100% - 24px);
        box-sizing: border-box;
      }
      #profileBadgeSidebar.is-guest {
        border: 1px dashed var(--accent-blue, #4f7cff);
        background: rgba(79, 124, 255, 0.08);
        color: var(--accent-blue, #4f7cff);
      }
      #profileBadgeSidebar .pbs-name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px;
      }
      @media (max-width: 900px) {
        #profileBadgeBtn { display: none !important; }
        #profileBadgeSidebar { display: flex !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function buildOverlay(notice = '') {
    injectStyles();
    const existing = document.getElementById('loginOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'loginOverlay';
    overlay.innerHTML = `
      <div class="login-box">
        <div class="login-header">
          <div class="login-title">🔐 Tài khoản & Cảnh báo</div>
          <button type="button" class="login-close-btn" id="loginCloseBtn" title="Đóng (tiếp tục vai trò Khách)">✕</button>
        </div>
        ${notice ? `<div class="login-notice">${notice}</div>` : ''}
        <div class="login-sub">
          Nhập Tên + mã PIN (4-6 số):<br>
          • <b>Tên mới</b> → tự lập tài khoản, lưu và nhận cảnh báo riêng.<br>
          • <b>Tên đã có</b> → nhập đúng PIN để đồng bộ lại cảnh báo riêng.<br>
          • Hoặc tiếp tục dùng với vai trò <b>Khách</b> (không có cảnh báo riêng).
        </div>
        <input type="text" id="loginUsername" placeholder="Tên của bạn (vd: quoc, chi...)" autocomplete="off">
        <input type="password" id="loginPin" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="PIN (4-6 số)" autocomplete="off">
        <div id="loginError" class="login-error"></div>
        <button id="loginSubmitBtn" type="button">Vào tài khoản</button>
        <button id="loginCancelBtn" type="button">Tiếp tục vai trò Khách</button>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function showError(overlay, msg) {
    const el = overlay.querySelector('#loginError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  async function submitLogin(overlay) {
    const usernameInput = overlay.querySelector('#loginUsername');
    const pinInput = overlay.querySelector('#loginPin');
    const btn = overlay.querySelector('#loginSubmitBtn');
    const username = usernameInput.value.trim();
    const pin = pinInput.value.trim();

    if (!username) {
      showError(overlay, 'Vui lòng nhập tên.');
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      showError(overlay, 'PIN cần đúng 4-6 chữ số.');
      return;
    }

    showError(overlay, '');
    btn.disabled = true;
    btn.textContent = 'Đang kiểm tra...';

    try {
      const res = await fetch(`${WORKER_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, pin }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.ok) {
        showError(overlay, (data && data.error) || 'Đăng nhập thất bại, thử lại.');
        btn.disabled = false;
        btn.textContent = 'Vào tài khoản';
        return;
      }

      setStoredUsername(data.deviceId);
      // Reload để push-sync.js và các module khác chạy với tài khoản vừa đăng nhập
      window.location.reload();
    } catch (err) {
      console.error('[login.js] Lỗi khi đăng nhập:', err);
      showError(overlay, 'Không kết nối được máy chủ, kiểm tra mạng rồi thử lại.');
      btn.disabled = false;
      btn.textContent = 'Vào tài khoản';
    }
  }

  function showLoginOverlay(notice = '') {
    const overlay = buildOverlay(notice);
    const btn = overlay.querySelector('#loginSubmitBtn');
    const cancelBtn = overlay.querySelector('#loginCancelBtn');
    const closeBtn = overlay.querySelector('#loginCloseBtn');
    const pinInput = overlay.querySelector('#loginPin');
    const usernameInput = overlay.querySelector('#loginUsername');

    const closeHandler = () => overlay.remove();
    if (cancelBtn) cancelBtn.addEventListener('click', closeHandler);
    if (closeBtn) closeBtn.addEventListener('click', closeHandler);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeHandler();
    });

    btn.addEventListener('click', () => submitLogin(overlay));
    pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitLogin(overlay);
    });
    usernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pinInput.focus();
    });
    usernameInput.focus();
  }

  function confirmSwitchAccount(username) {
    const confirmed = window.confirm(
      `Tài khoản hiện tại: "${username}"\n\nBạn có muốn đổi sang tài khoản khác hoặc chuyển về vai trò Khách?\n\n- Bấm OK để đăng xuất (dữ liệu & cảnh báo riêng trên máy chủ vẫn còn nguyên).`
    );
    if (confirmed) {
      clearStoredUsername();
      window.location.reload();
    }
  }

  function buildProfileBadge(username) {
    const oldTopbar = document.getElementById('profileBadgeBtn');
    if (oldTopbar) oldTopbar.remove();
    const oldSidebar = document.getElementById('profileBadgeSidebar');
    if (oldSidebar) oldSidebar.remove();

    const isGuest = !username;

    // --- Bản topbar (desktop) ---
    const topbarBtn = document.createElement('button');
    topbarBtn.id = 'profileBadgeBtn';
    topbarBtn.className = `topbar-btn ${isGuest ? 'is-guest' : ''}`;
    topbarBtn.type = 'button';
    if (isGuest) {
      topbarBtn.innerHTML = `<span class="btn-icon">${iconHTML('account')}</span><span class="btn-text"> Khách</span>`;
      topbarBtn.title = 'Bạn đang ở vai trò Khách (không ghi đè, không có cảnh báo). Bấm để đăng nhập hoặc lập tài khoản riêng.';
      topbarBtn.addEventListener('click', () => showLoginOverlay());
    } else {
      topbarBtn.innerHTML = `<span class="btn-icon">${iconHTML('account')}</span><span class="btn-text"> ${username}</span>`;
      topbarBtn.title = `Tài khoản: ${username} (bấm để đổi tài khoản hoặc về vai trò Khách)`;
      topbarBtn.addEventListener('click', () => confirmSwitchAccount(username));
    }
    const topbarTarget = document.querySelector('.topbar-right') || document.getElementById('topbar');
    if (topbarTarget) {
      topbarTarget.appendChild(topbarBtn);
    }

    // --- Bản sidebar (mobile) ---
    const sidebarBtn = document.createElement('div');
    sidebarBtn.id = 'profileBadgeSidebar';
    sidebarBtn.className = isGuest ? 'is-guest' : '';
    if (isGuest) {
      sidebarBtn.innerHTML = `<span class="ms-ico" style="margin:0">${Icons.account}</span><span class="pbs-name">Khách (Đăng nhập)</span><span style="margin-left:auto; opacity:0.7; display:inline-flex;">${iconHTML('chevronRight')}</span>`;
      sidebarBtn.title = 'Bạn đang ở vai trò Khách. Bấm để đăng nhập hoặc lập tài khoản riêng.';
      sidebarBtn.addEventListener('click', () => showLoginOverlay());
    } else {
      sidebarBtn.innerHTML = `<span class="ms-ico" style="margin:0">${Icons.account}</span><span class="pbs-name">${username}</span><span style="margin-left:auto; opacity:0.6; display:inline-flex;">${iconHTML('repeat')}</span>`;
      sidebarBtn.title = `Tài khoản: ${username} (bấm để đổi tài khoản hoặc về vai trò Khách)`;
      sidebarBtn.addEventListener('click', () => confirmSwitchAccount(username));
    }
    const sidebarHeader = document.querySelector('.sidebar-header');
    if (sidebarHeader && sidebarHeader.parentElement) {
      sidebarHeader.insertAdjacentElement('afterend', sidebarBtn);
    }
  }

  function mount() {
    injectStyles();
    const username = getStoredUsername();
    // Tạo badge hiển thị vai trò hiện tại (Khách hoặc Tên tài khoản)
    buildProfileBadge(username);
    // KHÔNG tự động bật showLoginOverlay() khi mở app - vào thẳng vai trò Khách thoải mái
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  return {
    getStoredUsername,
    isGuest: () => !getStoredUsername(),
    showLoginOverlay,
  };
})();