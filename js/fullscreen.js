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
 *
 *   - ĐỢT FIX NÀY (LỖI SIZE SAI Ở LAYOUT 1/2/3 Ô SAU KHI THOÁT FULLSCREEN):
 *     Trước đây enter()/exit() gỡ/thêm class 'app-fullscreen' và bắn
 *     'layout:changed' NGAY LẬP TỨC, đồng thời chỉ "bắn lệnh"
 *     requestFullscreen()/exitFullscreen() mà KHÔNG đợi nó thật sự hoàn
 *     tất. Nhưng 2 API này đều là bất đồng bộ và có animation phóng to/thu
 *     nhỏ THẬT của trình duyệt trên phần tử #app (khác với #chartArea, nơi
 *     class CSS 'app-fullscreen' tác động) - nghĩa là có một khoảng thời
 *     gian ngắn #app vẫn còn ở kích thước fullscreen cũ trong khi
 *     #chartArea đã bị gỡ position:fixed và rơi vào dòng chảy layout của
 *     #app. ResizeObserver trong chart.js đo trúng đúng kích thước "phồng
 *     tạm" này và gọi chart.resize() với size sai - vì chart tạo với
 *     autoSize:false nên size sai này bị "chốt cứng", không có gì tự sửa
 *     lại. Layout 4 ô tình cờ thoát được vì lưới 2x2 có nhiều lần đổi
 *     kích thước chồng lấp trong lúc animation diễn ra nên tự "dọn" lại
 *     đúng ở lần đo cuối; layout 1/2/3 ô chỉ có 1 lần đổi kích thước nên
 *     dễ bị chốt sai vĩnh viễn.
 *     Sửa: enter()/exit() giờ là async, dùng await lên chính Promise của
 *     requestFullscreen()/exitFullscreen() (khi trình duyệt hỗ trợ), rồi
 *     đợi thêm vài khung hình (waitAFewFrames) trước khi gỡ/thêm class CSS
 *     và bắn lại 'layout:changed' - đảm bảo #app đã thật sự ổn định kích
 *     thước trước khi đo. Có thêm 1 lần bắn lại sau 300ms để vét luôn
 *     những thiết bị/trình duyệt có animation chậm hơn dự kiến.
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

  /** Đợi thêm n khung hình animation (mặc định 3) - dùng sau khi Promise của
   * requestFullscreen()/exitFullscreen() đã resolve, vì 1 số trình duyệt vẫn
   * cần thêm vài frame nữa để áp dụng xong kích thước cửa sổ/khối fullscreen
   * thật, animation co/giãn chưa chắc đã vẽ xong ngay khung hình kế tiếp. */
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

    // Bật CSS fallback ngay lập tức (hiệu ứng tức thì, và là giải pháp DUY
    // NHẤT hoạt động trên iOS Safari - nơi requestFullscreen() trên phần tử
    // thường không được hỗ trợ).
    document.body.classList.add('app-fullscreen');
    emitLayoutChanged();

    // requestFullscreen() cũng bất đồng bộ + có animation phóng to thật của
    // hệ điều hành/trình duyệt trên #app - đợi nó xong hẳn rồi đo/emit lại
    // 1 lần nữa, tránh trường hợp #app còn đang ở kích thước cũ (nhỏ hơn)
    // trong khi #chartArea đã pin theo #app.
    if (isNativeFullscreenSupported()) {
      try {
        const target = document.getElementById('app') || document.documentElement;
        await target.requestFullscreen();
        await waitAFewFrames();
      } catch (err) {
        // Trình duyệt từ chối hoặc không hỗ trợ đầy đủ - bỏ qua, CSS
        // fallback ở trên đã đủ để tính năng hoạt động.
      }
    }

    emitLayoutChanged();
    // Vét thêm 1 lần phòng khi animation phóng to chậm hơn dự kiến.
    setTimeout(emitLayoutChanged, 300);
  }

  async function exit() {
    if (!isFullscreen) return;
    isFullscreen = false;
    updateButton();

    // QUAN TRỌNG: phải đợi native fullscreen thoát THẬT SỰ XONG (Promise
    // resolve + vài khung hình để hệ điều hành/trình duyệt co #app về đúng
    // kích thước cũ) RỒI MỚI gỡ class 'app-fullscreen' và tính lại layout.
    // Gỡ CSS ngay lập tức (như trước đây) khiến #chartArea rơi vào dòng
    // chảy layout của #app trong lúc #app vẫn còn đang ở kích thước
    // fullscreen thật (to hơn) - ResizeObserver đo nhầm kích thước tạm này
    // và chart.resize() chốt cứng luôn ở đó vì autoSize:false.
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (err) {
        // bỏ qua - vẫn tiếp tục gỡ CSS fallback bình thường bên dưới
      }
      await waitAFewFrames();
    }

    document.body.classList.remove('app-fullscreen');
    emitLayoutChanged();

    // Vét thêm 1 lần sau 300ms phòng khi thiết bị/trình duyệt nào đó có
    // animation co cửa sổ chậm hơn vài frame kể trên.
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
    // exit() tự kiểm tra document.fullscreenElement nên gọi lại vẫn an toàn
    // dù native fullscreen đã tự thoát trước đó.
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