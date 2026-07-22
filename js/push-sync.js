/**
 * push-sync.js
 * Đồng bộ cảnh báo giá lên Cloudflare Worker để nhận thông báo NGAY CẢ KHI
 * ĐÃ TẮT APP/ĐÓNG TRÌNH DUYỆT (Web Push thật qua VAPID) - khác với
 * notifications.js (NotificationsModule), module đó chỉ hoạt động khi app
 * còn đang chạy (kể cả chạy nền/tab khác), KHÔNG hoạt động khi app đã đóng
 * hẳn hoặc máy khoá lâu.
 *
 * FIX (đợt fix mới nhất - PHỐI HỢP VỚI login.js, "tài khoản nhẹ" tên+PIN):
 *   Trước đây getDeviceId() TỰ SINH 1 chuỗi ngẫu nhiên nếu localStorage
 *   chưa có gì - đây chính là nguồn gốc vấn đề "2 người dùng chung 1 thiết
 *   bị/trình duyệt thì lẫn cảnh báo của nhau, đổi thiết bị thì mất cảnh
 *   báo cũ" mà không có cách nào đăng nhập lại đúng "danh tính" trên thiết
 *   bị khác.
 *
 *   Giờ đã có login.js lo việc hỏi Tên + PIN và lưu "tên" đó vào ĐÚNG key
 *   DEVICE_ID_KEY này trước khi push-sync.js kịp chạy đồng bộ (login.js
 *   luôn reload trang ngay sau khi đăng nhập xong, nên tới lúc
 *   push-sync.js init() chạy, key này CHẮC CHẮN đã có identity thật do
 *   người dùng chọn).
 *
 *   getDeviceId() ở đây được sửa lại: KHÔNG còn tự sinh id ngẫu nhiên nữa
 *   - nếu chưa có identity thì trả về null, và mọi hàm sync đều bỏ qua
 *     (return sớm) khi chưa có identity. Điều này đảm bảo:
 *     (1) Không bao giờ vô tình tạo ra 1 "hồ sơ ẩn danh ngẫu nhiên" nào
 *         trên Worker nữa - mọi deviceId gửi lên server từ giờ ĐỀU là tên
 *         người dùng tự chọn qua login.js.
 *     (2) Nếu vì lý do gì đó login.js không chạy được (lỗi mạng, JS bị
 *         chặn...), push-sync.js sẽ tự động im lặng bỏ qua thay vì đồng bộ
 *         nhầm dưới 1 danh tính rác.
 *
 * CÁCH HOẠT ĐỘNG (còn lại, không đổi):
 *   1) ensureSubscription(): đăng ký Push Subscription qua PushManager của
 *      trình duyệt (dùng VAPID public key lấy từ Worker), rồi gửi lên Worker
 *      để lưu lại (worker/src/index.js: POST /api/subscribe).
 *   2) syncAlerts()/syncSignals(): mỗi khi có thay đổi, gửi TOÀN BỘ cấu
 *      hình cảnh báo/tín hiệu hiện tại lên Worker. Worker tự kiểm tra bằng
 *      Cron Trigger và gửi push khi tới lúc - không phụ thuộc việc máy có
 *      đang mở app hay không.
 *
 * BẮT BUỘC: đổi WORKER_URL bên dưới thành địa chỉ Worker bạn đã deploy, và
 * PHẢI GIỐNG HỆT WORKER_URL trong login.js.
 */

const PushSync = (function () {
  const WORKER_URL = 'https://dq-tracker-push.quocngyendanght.workers.dev';
  const DEVICE_ID_KEY = 'dq_tracker_device_id_v1'; // PHẢI khớp login.js

  function isConfigured() {
    return !!WORKER_URL && WORKER_URL.startsWith('https://');
  }

  // FIX: KHÔNG còn tự sinh id ngẫu nhiên. Trả về null nếu người dùng chưa
  // đăng nhập (chưa có identity do login.js lưu) - mọi hàm gọi hàm này bên
  // dưới đều phải tự kiểm tra null và bỏ qua.
  function getDeviceId() {
    try {
      return localStorage.getItem(DEVICE_ID_KEY) || null;
    } catch (err) {
      return null;
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }
  
  /** Tải cảnh báo đã lưu trên server về, gộp vào local TRƯỚC KHI syncAlerts()
   * chạy lần đầu - bắt buộc phải làm bước này trước, nếu không syncAlerts()
   * sẽ gửi mảng rỗng (local chưa có gì trên máy mới) lên server và server
   * sẽ XOÁ LUÔN cấu hình cũ (xem index.js: merged.length === 0 -> delete). */
  async function pullAlertsFromServer() {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId) return;
    try {
      const res = await fetch(`${WORKER_URL}/api/alerts?deviceId=${encodeURIComponent(deviceId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.alerts)) {
        AlertsModule.mergeFromServer(data.alerts);
      }
    } catch (err) {
      console.error('Lỗi khi tải cảnh báo từ Worker:', err);
    }
  }

  async function ensureSubscription() {
    if (!isConfigured()) return null;
    const deviceId = getDeviceId();
    if (!deviceId) return null; // chưa đăng nhập - chờ login.js
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    if (!('Notification' in window) || Notification.permission !== 'granted') return null;

    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        const res = await fetch(`${WORKER_URL}/api/vapid-public-key`);
        if (!res.ok) throw new Error('Không lấy được VAPID public key từ Worker');
        const { publicKey } = await res.json();
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      await fetch(`${WORKER_URL}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, subscription: sub.toJSON() }),
      });

      return sub;
    } catch (err) {
      console.error('Lỗi khi đăng ký Web Push:', err);
      return null;
    }
  }

  async function syncAlerts() {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId) return; // chưa đăng nhập - chờ login.js
    try {
      await ensureSubscription();

      const alerts = AlertsModule.getAllAlerts()
        .filter((a) => !a.triggered)
        .map((a) => ({ id: a.id, symbol: a.symbol, price: a.price }));

      await fetch(`${WORKER_URL}/api/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, alerts }),
      });
    } catch (err) {
      console.error('Lỗi khi đồng bộ cảnh báo lên Worker:', err);
    }
  }

  async function syncSignals() {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId) return; // chưa đăng nhập - chờ login.js
    try {
      await ensureSubscription();

      const state = Store.getState();
      const signals = [];
      const enabledTFs = Store.getEnabledSignalTimeframes() || [];

      state.panes.forEach((p) => {
        if (p.breakoutVisible && enabledTFs.includes(p.timeframe)) {
          const higherTF = ChartModule.getHigherTimeframeFor(p.timeframe);
          if (higherTF) {
            signals.push({
              paneId: p.id,
              symbol: p.symbol,
              timeframe: p.timeframe,
              higherTF,
              lookbackCandles: p.breakoutLookback || 2,
            });
          }
        }
      });

      await fetch(`${WORKER_URL}/api/signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, signals }),
      });
    } catch (err) {
      console.error('Lỗi khi đồng bộ tín hiệu lên Worker:', err);
    }
  }

  function init() {
    if (!isConfigured()) {
      console.warn(
        '[push-sync.js] Chưa cấu hình WORKER_URL - thông báo khi tắt app sẽ KHÔNG hoạt động. ' +
          'Xem HUONG_DAN.md để deploy Cloudflare Worker rồi cập nhật WORKER_URL trong file này.'
      );
      return;
    }

    // Đồng bộ lại mỗi khi danh sách cảnh báo đổi (thêm/xoá/kích hoạt).
    // syncAlerts() tự bỏ qua nếu chưa có deviceId (chưa đăng nhập).
    EventBus.on('alerts:changed', () => syncAlerts());

    // Đồng bộ tín hiệu khi có thay đổi cấu hình pane, symbol, timeframe hoặc breakout/signal
    EventBus.on('pane:symbolChanged', () => syncSignals());
    EventBus.on('pane:timeframeChanged', () => syncSignals());
    EventBus.on('pane:breakoutConfigChanged', () => syncSignals());

    // Nếu người dùng vừa cấp quyền thông báo (bấm nút ở banner), đăng ký +
    // đồng bộ ngay thay vì chờ lần đổi cảnh báo tiếp theo.
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'notifAllowBtn') {
        setTimeout(() => {
          syncAlerts();
          syncSignals();
        }, 500);
      }
    });

    // Đồng bộ 1 lần lúc khởi động, phòng trường hợp đã có quyền từ trước
    // (vd mở lại app sau khi đã cấp quyền ở lần dùng trước). Nếu chưa đăng
    // nhập (chưa có deviceId), 2 hàm này tự bỏ qua - login.js sẽ hiện màn
    // đăng nhập; sau khi đăng nhập xong trang sẽ reload và luồng này chạy
    // lại từ đầu với deviceId hợp lệ.
    setTimeout(async () => {
      await pullAlertsFromServer(); // BẮT BUỘC chạy trước - xem giải thích ở hàm trên
      syncAlerts();
      syncSignals();
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { syncAlerts, ensureSubscription };
})();