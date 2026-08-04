/**
 * push-sync.js
 * Đồng bộ cảnh báo giá / tín hiệu / công việc lên Cloudflare Worker để nhận
 * thông báo NGAY CẢ KHI ĐÃ TẮT APP/ĐÓNG TRÌNH DUYỆT (Web Push thật qua
 * VAPID) - khác với notifications.js (NotificationsModule), module đó chỉ
 * hoạt động khi app còn đang chạy (kể cả chạy nền/tab khác), KHÔNG hoạt
 * động khi app đã đóng hẳn hoặc máy khoá lâu.
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
 * ĐỢT FIX NÀY (THÊM ĐỒNG BỘ CÔNG VIỆC / TASKS - xem tasks.js):
 *   tasks.js KHÔNG tự fetch lên server nữa - nó chỉ lưu local rồi bắn sự
 *   kiện 'tasks:changed'. Thêm syncTasks()/pullTasksFromServer() ở đây,
 *   theo ĐÚNG khuôn đã dùng cho syncAlerts()/pullAlertsFromServer(), để
 *   toàn bộ luồng auth + domain Worker CHỈ có 1 nguồn sự thật (WORKER_URL +
 *   DEVICE_ID_KEY ở file này) - tránh lặp/lệch cấu hình như bug cũ.
 *
 * CÁCH HOẠT ĐỘNG (còn lại, không đổi):
 *   1) ensureSubscription(): đăng ký Push Subscription qua PushManager của
 *      trình duyệt (dùng VAPID public key lấy từ Worker), rồi gửi lên Worker
 *      để lưu lại (worker/src/index.js: POST /api/subscribe).
 *   2) syncAlerts()/syncSignals()/syncTasks(): mỗi khi có thay đổi, gửi
 *      TOÀN BỘ cấu hình hiện tại lên Worker. Worker tự kiểm tra bằng Cron
 *      Trigger và gửi push khi tới lúc - không phụ thuộc việc máy có đang
 *      mở app hay không.
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

  async function safeFetch(url, options = {}, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[push-sync] Sync warning (${url}):`, err.message || err);
      return null;
    }
  }

  /** Tải cấu hình giao diện (panes, symbols, timeframes, breakout, indicator, layout, theme) từ server.
   * BẮT BUỘC chạy ĐẦU TIÊN khi ứng dụng khởi động hoặc sau khi đăng nhập tài khoản. */
  async function pullSetupFromServer() {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId) return;
    try {
      const res = await safeFetch(`${WORKER_URL}/api/setup?deviceId=${encodeURIComponent(deviceId)}`);
      if (!res || !res.ok) return;
      const data = await res.json();
      if (data && data.ok && data.setup && typeof data.setup === 'object') {
        const remoteSetup = data.setup;

        if (remoteSetup.indicatorPrefs && typeof IndicatorPrefsModule !== 'undefined' && IndicatorPrefsModule.saveAll) {
          IndicatorPrefsModule.saveAll(remoteSetup.indicatorPrefs);
        }

        if (remoteSetup.theme && typeof ThemeModule !== 'undefined' && ThemeModule.apply) {
          if (ThemeModule.getTheme() !== remoteSetup.theme) {
            ThemeModule.apply(remoteSetup.theme);
          }
        }

        const changed = Store.applyRemoteSetup(remoteSetup);

        if (changed) {
          const state = Store.getState();
          EventBus.emit('layout:changed', {
            layout: state.layout,
            visiblePaneIds: Store.getVisiblePaneIds(),
            orientation: state.orientation,
          });
          state.panes.forEach((p) => {
            EventBus.emit('pane:symbolChanged', { paneId: p.id, symbol: p.symbol });
            EventBus.emit('pane:timeframeChanged', { paneId: p.id, timeframe: p.timeframe });
            EventBus.emit('pane:breakoutConfigChanged', {
              paneId: p.id,
              breakoutLookback: p.breakoutLookback,
              slMode: p.slMode,
              slTimeframe: p.slTimeframe,
            });
          });
        }
      }
    } catch (err) {
      console.warn('Tải cấu hình (setup) từ Worker:', err);
    }
  }

  function getSetupPayload() {
    const state = Store.getState();
    const panes = state.panes.map((p) => ({
      symbol: p.symbol,
      timeframe: p.timeframe,
      breakoutLookback: p.breakoutLookback,
      slMode: p.slMode,
      slTimeframe: p.slTimeframe,
      breakoutVisible: p.breakoutVisible,
      signalAlertEnabled: p.signalAlertEnabled,
    }));
    const enabledSignalTimeframes = Store.getEnabledSignalTimeframes() || [];
    const layout = state.layout;
    const indicatorPrefs = typeof IndicatorPrefsModule !== 'undefined' && IndicatorPrefsModule.loadAll
      ? IndicatorPrefsModule.loadAll()
      : {};
    const theme = typeof ThemeModule !== 'undefined' && ThemeModule.getTheme
      ? ThemeModule.getTheme()
      : 'dark';

    return {
      panes,
      enabledSignalTimeframes,
      layout,
      indicatorPrefs,
      theme,
    };
  }

  async function syncSetup() {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId) return;
    try {
      const setup = getSetupPayload();
      await safeFetch(`${WORKER_URL}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, setup }),
      });
    } catch (err) {
      console.warn('Đồng bộ cấu hình (setup) lên Worker:', err);
    }
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
      const res = await safeFetch(`${WORKER_URL}/api/alerts?deviceId=${encodeURIComponent(deviceId)}`);
      if (!res || !res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.alerts)) {
        AlertsModule.mergeFromServer(data.alerts);
      }
    } catch (err) {
      console.warn('Tải cảnh báo từ Worker:', err);
    }
  }

  /** Tương tự pullAlertsFromServer() nhưng cho CÔNG VIỆC (tasks.js). PHẢI
   * chạy TRƯỚC syncTasks() lần đầu, cùng lý do hệt như alerts: nếu không,
   * máy mới đăng nhập (local rỗng) sẽ gửi mảng rỗng lên và server XOÁ mất
   * toàn bộ công việc đã lưu từ thiết bị khác (index.js: merged.length===0
   * -> delete allConfig[deviceId]). */
  async function pullTasksFromServer() {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId) return;
    if (typeof TasksModule === 'undefined' || !TasksModule.mergeFromServer) return;
    try {
      const res = await safeFetch(`${WORKER_URL}/api/tasks?deviceId=${encodeURIComponent(deviceId)}`);
      if (!res || !res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.tasks)) {
        TasksModule.mergeFromServer(data.tasks);
      }
    } catch (err) {
      console.warn('Tải công việc từ Worker:', err);
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
        const res = await safeFetch(`${WORKER_URL}/api/vapid-public-key`);
        if (!res || !res.ok) return null;
        const { publicKey } = await res.json();
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      await safeFetch(`${WORKER_URL}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, subscription: sub.toJSON() }),
      });

      return sub;
    } catch (err) {
      console.warn('Đăng ký Web Push:', err);
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

      await safeFetch(`${WORKER_URL}/api/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, alerts }),
      });
    } catch (err) {
      console.warn('Đồng bộ cảnh báo lên Worker:', err);
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

      await safeFetch(`${WORKER_URL}/api/signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, signals }),
      });
    } catch (err) {
      console.warn('Đồng bộ tín hiệu lên Worker:', err);
    }
  }

  /** Đồng bộ TOÀN BỘ công việc/lời nhắc (tasks.js) lên Worker. Được gọi mỗi
   * khi tasks.js bắn sự kiện 'tasks:changed' (thêm/sửa/xoá/bật-tắt), và
   * 1 lần lúc khởi động (sau pullTasksFromServer). */
  async function syncTasks() {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId) return; // chưa đăng nhập - chờ login.js
    if (typeof TasksModule === 'undefined' || !TasksModule.getAllTasks) return;
    try {
      await ensureSubscription();

      const tasks = TasksModule.getAllTasks().map((t) => ({
        id: t.id,
        title: t.title,
        note: t.note || '',
        category: t.category || 'plan',
        priority: t.priority || 'medium',
        symbol: t.symbol || '',
        date: t.date,
        time: t.time,
        repeat: t.repeat,
        daysOfWeek: t.daysOfWeek || [],
        enabled: !!t.enabled,
      }));

      const res = await safeFetch(`${WORKER_URL}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, tasks }),
      });
      if (res && !res.ok) {
        console.warn('Đồng bộ công việc thất bại, HTTP status:', res.status);
      }
    } catch (err) {
      console.warn('Đồng bộ công việc lên Worker:', err);
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

    // Đồng bộ lại mỗi khi danh sách công việc/lời nhắc đổi (tasks.js bắn
    // sự kiện này trong persist()). syncTasks() tự bỏ qua nếu chưa đăng
    // nhập hoặc TasksModule chưa sẵn sàng.
    EventBus.on('tasks:changed', () => syncTasks());

    // Đồng bộ tín hiệu & setup khi có thay đổi cấu hình pane, symbol, timeframe, breakout, indicator, layout hoặc theme
    EventBus.on('pane:symbolChanged', () => { syncSetup(); syncSignals(); });
    EventBus.on('pane:timeframeChanged', () => { syncSetup(); syncSignals(); });
    EventBus.on('pane:breakoutConfigChanged', () => { syncSetup(); syncSignals(); });
    EventBus.on('layout:changed', () => syncSetup());
    EventBus.on('theme:changed', () => syncSetup());
    EventBus.on('indicator:changed', () => syncSetup());

    // Nếu người dùng vừa cấp quyền thông báo (bấm nút ở banner), đăng ký +
    // đồng bộ ngay thay vì chờ lần đổi cảnh báo tiếp theo.
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'notifAllowBtn') {
        setTimeout(() => {
          syncSetup();
          syncAlerts();
          syncSignals();
          syncTasks();
        }, 500);
      }
    });

    // Đồng bộ 1 lần lúc khởi động. Nếu chưa đăng nhập (chưa có deviceId),
    // các hàm này tự bỏ qua - login.js sẽ hiện màn đăng nhập; sau khi đăng
    // nhập xong trang sẽ reload và luồng này chạy lại từ đầu với deviceId hợp lệ.
    //
    // THỨ TỰ BẮT BUỘC: pull TRƯỚC sync (setup -> alerts -> tasks -> sync tất cả)
    setTimeout(async () => {
      await pullSetupFromServer();
      await pullAlertsFromServer();
      await pullTasksFromServer();
      syncSetup();
      syncAlerts();
      syncSignals();
      syncTasks();
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { syncAlerts, syncSignals, syncTasks, syncSetup, pullSetupFromServer, ensureSubscription };
})();