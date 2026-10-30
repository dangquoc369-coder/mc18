/**
 * fullscreen.js
 * Nút "Toàn màn hình" DÙNG CHUNG trên topbar - phóng to TOÀN BỘ #chartArea
 * (giữ nguyên layout 1/2/3/4 ô), ẩn tạm sidebar/topbar/controlBar.
 *
 * - Giải pháp CHÍNH (chạy cả trên iOS standalone PWA): gắn class
 *   'app-fullscreen' lên <body>; css/style.css ẩn sidebar/topbar/controlBar
 *   và ghim #chartArea phủ kín viewport. Safari iOS không hỗ trợ
 *   requestFullscreen() cho phần tử thường nên không thể chỉ dựa vào API đó.
 * - Có thử thêm Element.requestFullscreen() (ẩn thanh địa chỉ Android/desktop),
 *   bọc try/catch, thất bại thì bỏ qua.
 * - Mỗi pane-chart-container có ResizeObserver riêng (chart.js) nên tự
 *   resize chart khi vùng đổi kích thước.
 * - Thoát: bấm lại nút, phím Esc, thoát fullscreen hệ thống, hoặc nút nổi
 *   #fullscreenExitBtn (cần cho mobile vì topbar bị ẩn khi fullscreen).
 *
 * FIX (size sai ở layout 1/2/3 ô sau khi thoát fullscreen): enter()/exit()
 * là async, ĐỢI Promise của requestFullscreen()/exitFullscreen() + vài
 * khung hình rồi MỚI gỡ/thêm class CSS và bắn lại 'layout:changed' (kèm các
 * lần bắn bù 100/300ms) để #app đã ổn định kích thước trước khi chart đo -
 * vì chart tạo với autoSize:false nên size đo sai sẽ bị chốt cứng.
 *
 * CẬP NHẬT: icon SVG (maximize/minimize/close) thay ký tự ⛶ ⤢ ✕.
 */

const FullscreenModule = (function () {
  let isFullscreen = false;
  let btnRef = null;

  function isNativeFullscreenSupported() {
    return !!(document.documentElement.requestFullscreen && document.fullscreenEnabled);
  }

  function updateButton() {
    if (!btnRef) return;
    // Chỉ icon, không kèm chữ (tiết kiệm diện tích mọi thiết bị)
    if (isFullscreen) {
      btnRef.innerHTML = iconHTML('minimize');
      btnRef.title = 'Thoát toàn màn hình (Esc)';
    } else {
      btnRef.innerHTML = iconHTML('maximize');
      btnRef.title = 'Phóng to toàn bộ vùng chart';
    }
  }

  /** Đợi thêm n khung hình animation (mặc định 3). */
  function waitAFewFrames(n = 3) {
    return new Promise((resolve) => {
      let count = 0;
      function tick() {
        count++;
        if (count >= n) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  function emitLayoutChanged() {
    EventBus.emit('layout:changed', {
      layout: Store.getState().layout,
      visiblePaneIds: Store.getVisiblePaneIds(),
      orientation: Store.getState().orientation,
    });
  }

  async function enter() {
    if (isFullscreen) return;
    isFullscreen = true;
    updateButton();

    // CSS fallback bật ngay (tức thì, và là cách DUY NHẤT chạy trên iOS Safari)
    document.body.classList.add('app-fullscreen');
    emitLayoutChanged();

    // requestFullscreen() bất đồng bộ + có animation thật - đợi xong rồi đo lại
    if (isNativeFullscreenSupported()) {
      try {
        const target = document.getElementById('app') || document.documentElement;
        await target.requestFullscreen();
        await waitAFewFrames();
      } catch (err) {
        // Bị từ chối/không hỗ trợ - CSS fallback đã đủ
      }
    }

    emitLayoutChanged();
    setTimeout(emitLayoutChanged, 300);
  }

  async function exit() {
    if (!isFullscreen) return;
    isFullscreen = false;
    updateButton();

    // PHẢI đợi native fullscreen thoát THẬT SỰ XONG rồi mới gỡ class CSS và
    // tính lại layout (xem FIX ở đầu file).
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (err) {
        // bỏ qua - vẫn gỡ CSS fallback bên dưới
      }
      await waitAFewFrames(2);
    }

    document.body.classList.remove('app-fullscreen');
    await waitAFewFrames(2);
    emitLayoutChanged();

    setTimeout(emitLayoutChanged, 100);
    setTimeout(emitLayoutChanged, 300);
  }

  function toggle() {
    if (isFullscreen) exit();
    else enter();
  }

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = 'fullscreenToggleBtn';
    btn.className = 'topbar-btn topbar-btn-icon-only';
    btn.type = 'button';
    btn.addEventListener('click', toggle);
    btnRef = btn;
    updateButton();
    return btn;
  }

  function buildExitButton() {
    const btn = document.createElement('button');
    btn.id = 'fullscreenExitBtn';
    btn.type = 'button';
    btn.title = 'Thoát toàn màn hình';
    btn.innerHTML = iconHTML('close');
    btn.addEventListener('click', exit);
    document.body.appendChild(btn);
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
      btn.style.right = '20px';
      btn.style.zIndex = '9999';
      document.body.appendChild(btn);
    }

    // Nút thoát nổi - luôn có trong DOM, CSS tự ẩn/hiện theo class 'app-fullscreen'
    buildExitButton();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isFullscreen) exit();
    });

    // Thoát fullscreen hệ thống bằng cách khác -> đồng bộ lại trạng thái
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && isFullscreen) exit();
    });
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountButton);
    } else {
      mountButton();
    }
  }

  init();

  return { toggle, enter, exit };
})();