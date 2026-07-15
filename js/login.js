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
        background: rgba(10, 12, 20, 0.92);
        display: flex; align-items: center; justify-content: center;
        padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #loginOverlay .login-box {
        width: 100%; max-width: 320px;
        background: #1b1f2b; border: 1px solid #2c3244; border-radius: 14px;
        padding: 24px 20px; box-sizing: border-box;
        box-shadow: 0 12px 40px rgba(0,0,0,0.4);
      }
      #loginOverlay .login-title {
        color: #f0f2f8; font-size: 18px; font-weight: 600; margin-bottom: 6px; text-align: center;
      }
      #loginOverlay .login-sub {
        color: #9aa3b8; font-size: 12.5px; line-height: 1.5; margin-bottom: 18px; text-align: center;
      }
      #loginOverlay input {
        width: 100%; box-sizing: border-box; padding: 11px 12px; margin-bottom: 10px;
        border-radius: 8px; border: 1px solid #333a4d; background: #12151f; color: #f0f2f8;
        font-size: 15px; outline: none;
      }
      #loginOverlay input:focus { border-color: #4f7cff; }
      #loginOverlay .login-error {
        display: none; color: #ff6b6b; font-size: 12.5px; margin: -2px 0 10px; line-height: 1.4;
      }
      #loginOverlay button#loginSubmitBtn {
        width: 100%; padding: 11px; border: none; border-radius: 8px;
        background: #4f7cff; color: #fff; font-size: 15px; font-weight: 600;
        cursor: pointer;
      }
      #loginOverlay button#loginSubmitBtn:disabled { opacity: 0.6; cursor: default; }
      #profileBadgeBtn .btn-text { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: bottom; }

      /* FIX (đợt fix này): nút "👤 tên" trong topbar bị dồn xuống dòng 2
         trên mobile vì topbar-right đã đủ chật (flex-wrap: wrap) - thừa 1
         nút là bị đẩy xuống, chiếm thêm hẳn 1 dòng chiều cao. Giải pháp:
         ẨN hẳn nút này khỏi topbar trên mobile, thay bằng 1 dòng nhỏ trong
         sidebar-header (nơi có sẵn chỗ trống, chỉ hiện khi người dùng bấm
         ☰ mở sidebar - không tranh chỗ với topbar nữa). */
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

  function buildOverlay() {
    injectStyles();
    const overlay = document.createElement('div');
    overlay.id = 'loginOverlay';
    overlay.innerHTML = `
      <div class="login-box">
        <div class="login-title">🔐 DQ Tracker</div>
        <div class="login-sub">
          Nhập tên bạn muốn dùng + 1 mã PIN (4-6 số).<br>
          Tên chưa ai dùng → tự tạo hồ sơ mới cho bạn.<br>
          Tên đã có → nhập đúng PIN cũ để lấy lại cảnh báo của mình.
        </div>
        <input type="text" id="loginUsername" placeholder="Tên của bạn (vd: quoc, chi...)" autocomplete="off">
        <input type="password" id="loginPin" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="PIN (4-6 số)" autocomplete="off">
        <div id="loginError" class="login-error"></div>
        <button id="loginSubmitBtn" type="button">Vào app</button>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function showError(overlay, msg) {
    const el = overlay.querySelector('#loginError');
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
        btn.textContent = 'Vào app';
        return;
      }

      setStoredUsername(data.deviceId);
      // Reload để push-sync.js (và mọi chỗ khác đọc deviceId) chạy lại từ
      // đầu với đúng identity vừa đăng nhập - tránh mọi race condition do
      // đăng nhập giữa chừng lúc các module khác đã chạy.
      window.location.reload();
    } catch (err) {
      console.error('[login.js] Lỗi khi đăng nhập:', err);
      showError(overlay, 'Không kết nối được máy chủ, kiểm tra mạng rồi thử lại.');
      btn.disabled = false;
      btn.textContent = 'Vào app';
    }
  }

  function showLoginOverlay() {
    const overlay = buildOverlay();
    const btn = overlay.querySelector('#loginSubmitBtn');
    const pinInput = overlay.querySelector('#loginPin');
    const usernameInput = overlay.querySelector('#loginUsername');

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
      `Đổi sang tài khoản khác trên máy này?\n\nApp sẽ tải lại và hỏi tên + PIN mới. Tài khoản "${username}" và cảnh báo của nó vẫn còn nguyên trên máy chủ - đăng nhập lại đúng tên + PIN là lấy lại được.`
    );
    if (confirmed) {
      clearStoredUsername();
      window.location.reload();
    }
  }

  // FIX (đợt fix này): tạo 2 nút thay vì 1 - nút trong topbar (chỉ hiện ở
  // desktop) và nút gọn trong sidebar-header (chỉ hiện ở mobile, xem CSS
  // trong injectStyles). Trên mobile, topbar vốn đã chật (flex-wrap) nên
  // thêm 1 nút nữa sẽ bị đẩy xuống dòng 2 chiếm thêm chiều cao - đặt nút
  // trong sidebar-header giải quyết tận gốc vì sidebar có sẵn chỗ trống và
  // chỉ hiện khi người dùng chủ động bấm ☰ mở ra.
  function buildProfileBadge(username) {
    // --- Bản topbar (desktop) - giữ nguyên như cũ ---
    const topbarBtn = document.createElement('button');
    topbarBtn.id = 'profileBadgeBtn';
    topbarBtn.className = 'topbar-btn';
    topbarBtn.type = 'button';
    topbarBtn.innerHTML = `<span class="btn-icon">👤</span><span class="btn-text"> ${username}</span>`;
    topbarBtn.title = 'Bấm để đổi sang tài khoản khác';
    topbarBtn.addEventListener('click', () => confirmSwitchAccount(username));
    const topbarTarget = document.querySelector('.topbar-right') || document.getElementById('topbar');
    if (topbarTarget) {
      topbarTarget.appendChild(topbarBtn);
    }

    // --- Bản sidebar (mobile) - ẩn mặc định, CSS tự hiện khi màn hình hẹp ---
    // Chèn làm 1 HÀNG RIÊNG ngay sau .sidebar-header (không nhét vào BÊN
    // TRONG header - header là 1 flex-row đã chật sẵn logo + nút ☰, nhét
    // thêm vào đó dễ bị tràn/đè lên nhau). #sidebar là flex-column nên 1
    // phần tử block đặt làm sibling của .sidebar-header sẽ tự chiếm trọn 1
    // dòng riêng, không ảnh hưởng gì tới bố cục header.
    const sidebarBtn = document.createElement('div');
    sidebarBtn.id = 'profileBadgeSidebar';
    sidebarBtn.innerHTML = `<span>👤</span><span class="pbs-name">${username}</span><span style="margin-left:auto; opacity:0.6;">⇄</span>`;
    sidebarBtn.title = 'Bấm để đổi sang tài khoản khác';
    sidebarBtn.addEventListener('click', () => confirmSwitchAccount(username));
    const sidebarHeader = document.querySelector('.sidebar-header');
    if (sidebarHeader && sidebarHeader.parentElement) {
      sidebarHeader.insertAdjacentElement('afterend', sidebarBtn);
    }
  }

  function mount() {
    if (!isConfigured()) {
      console.warn('[login.js] Chưa cấu hình WORKER_URL - bỏ qua màn hình đăng nhập.');
      return;
    }
    const username = getStoredUsername();
    if (!username) {
      showLoginOverlay();
      return;
    }
    buildProfileBadge(username);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  return { getStoredUsername };
})();