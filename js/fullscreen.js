/**
 * fullscreen.js
 * Thêm 1 nút "⛶ Toàn màn hình" DÙNG CHUNG (giống nút "Trạng thái thị
 * trường"/"Cảnh báo") vào topbar - bấm vào sẽ phóng to TOÀN BỘ #chartArea
 * (tức là giữ nguyên layout 1/2/3/4 ô đang chọn, không đổi ô nào đang hiển
 * thị) chiếm hết màn hình, ẩn tạm sidebar/topbar/control bar để có nhiều
 * chỗ nhìn chart hơn.
 *
 * CÁCH HOẠT ĐỘNG:
 *   - Giải pháp CHÍNH (luôn hoạt động, kể cả iOS standalone PWA): gắn class
 *     'app-fullscreen' lên <body> - css/style.css sẽ ẩn #sidebar/#topbar/
 *     #controlBar/#mobileSidebarToggle và đặt #chartArea thành
 *     position: fixed; inset: 0 để phủ kín toàn bộ viewport. KHÔNG cần sửa
 *     gì ở layout.js/ui.js - layout 1/2/3/4 ô bên trong #chartArea vẫn do
 *     layout.js quyết định như bình thường.
 *     Lý do không dựa hẳn vào Element.requestFullscreen(): Safari trên iOS
 *     (kể cả app đã "Thêm vào màn hình chính") KHÔNG hỗ trợ API này cho
 *     phần tử thường (chỉ hỗ trợ <video>) - nếu chỉ dùng API đó, tính năng
 *     sẽ không chạy trên iPhone.
 *   - Mỗi pane-chart-container bên trong đã có ResizeObserver riêng (xem
 *     chart.js: setupResize()) tự phát hiện container đổi kích thước và tự
 *     gọi chart.resize() cho TỪNG pane đang hiển thị -> không cần gọi
 *     resize() thủ công ở đây khi phóng to/thu nhỏ.
 *   - CÓ THỬ THÊM Element.requestFullscreen() nếu trình duyệt hỗ trợ (ẩn
 *     luôn thanh địa chỉ trên Android Chrome/trình duyệt máy tính) - bọc
 *     trong try/catch, thất bại thì bỏ qua lặng lẽ vì giải pháp CSS ở trên
 *     đã đủ để tính năng hoạt động mọi nơi.
 *   - Thoát bằng: bấm lại nút, phím Esc (desktop), hoặc thoát fullscreen hệ
 *     thống (vd nút back Android) - đều được đồng bộ lại đúng trạng thái.
 *   - ĐỢT FIX MỚI: trên mobile không có phím Esc, và nút "⛶" ở topbar cũng
 *     bị ẩn đi cùng topbar khi đang fullscreen (xem CSS
 *     body.app-fullscreen #topbar { display: none }) -> người dùng không
 *     còn cách nào để thoát! Thêm 1 nút "✕" NỔI riêng (#fullscreenExitBtn),
 *     tạo 1 lần lúc khởi động, luôn nằm ngoài #topbar nên KHÔNG bị ẩn theo -
 *     chỉ hiện ra (qua CSS `body.app-fullscreen #fullscreenExitBtn`) đúng
 *     lúc đang fullscreen, ở góc trên-phải, đủ lớn để bấm bằng ngón tay.
 */

const FullscreenModule = (function () {
  let isFullscreen = false;
  let btnRef = null;

  function isNativeFullscreenSupported() {
    return !!(document.documentElement.requestFullscreen && document.fullscreenEnabled);
  }

  function updateButton() {
    if (!btnRef) return;
    // CHỈ hiện icon, không kèm chữ (tối ưu diện tích trên mọi thiết bị,
    // kể cả desktop) - khác với các nút topbar khác (Cảnh báo/Trạng thái
    // thị trường) vốn có thêm nhãn chữ (ẩn riêng trên mobile qua .btn-text).
    if (isFullscreen) {
      btnRef.textContent = '⤢';
      btnRef.title = 'Thoát toàn màn hình (Esc)';
    } else {
      btnRef.textContent = '⛶';
      btnRef.title = 'Phóng to toàn bộ vùng chart';
    }
  }

  async function enterNativeFullscreenIfSupported() {
    if (!isNativeFullscreenSupported()) return;
    try {
      const target = document.getElementById('app') || document.documentElement;
      await target.requestFullscreen();
    } catch (err) {
      // Trình duyệt từ chối hoặc không hỗ trợ đầy đủ - bỏ qua, đã có CSS
      // fallback (position: fixed trên #chartArea) đảm nhiệm việc phóng to.
    }
  }

  function exitNativeFullscreenIfActive() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  function enter() {
    if (isFullscreen) return;
    isFullscreen = true;
    document.body.classList.add('app-fullscreen');
    updateButton();
    enterNativeFullscreenIfSupported();

    // #chartArea vừa đổi kích thước (chiếm toàn màn hình) - báo cho
    // layout.js vẽ lại splitter/placements cho đúng khung hình mới. Việc
    // resize canvas thật sự của từng chart đã do ResizeObserver lo tự động.
    EventBus.emit('layout:changed', {
      layout: Store.getState().layout,
      visiblePaneIds: Store.getVisiblePaneIds(),
      orientation: Store.getState().orientation,
    });
  }

  function exit() {
    if (!isFullscreen) return;
    isFullscreen = false;
    document.body.classList.remove('app-fullscreen');
    updateButton();
    exitNativeFullscreenIfActive();

    EventBus.emit('layout:changed', {
      layout: Store.getState().layout,
      visiblePaneIds: Store.getVisiblePaneIds(),
      orientation: Store.getState().orientation,
    });
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
    btn.textContent = '✕';
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

    // Nút thoát nổi - luôn tồn tại trong DOM (kể cả không ở fullscreen),
    // CSS tự ẩn/hiện theo class 'app-fullscreen' trên <body> (xem
    // css/style.css) nên không cần JS tạo/huỷ mỗi lần bấm.
    buildExitButton();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isFullscreen) exit();
    });

    // Nếu người dùng thoát fullscreen hệ thống bằng cách khác (vd nút back
    // trên Android khi đã vào native fullscreen) -> đồng bộ lại trạng thái.
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