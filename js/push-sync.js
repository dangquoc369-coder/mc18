/**
 * push-sync.js
 * CHỈ đồng bộ những thứ cần server để đẩy Web Push khi đã tắt app:
 *   - push subscription, cảnh báo giá, tín hiệu BUY/SELL, nhắc việc (tasks).
 * Bố cục / chỉ báo / theme / watchlist / hình vẽ / nhật ký lệnh KHÔNG còn
 * đi qua cloud - xem local-store.js.
 */
const PushSync = (function () {
  const WORKER_URL = 'https://dq-tracker-push.quocngyendanght.workers.dev';
  const DEVICE_ID_KEY = 'dq_tracker_device_id_v1'; // PHẢI khớp login.js

  function isConfigured() {
    return !!WORKER_URL && WORKER_URL.startsWith('https://');
  }

  function getDeviceId() {
    try { return localStorage.getItem(DEVICE_ID_KEY) || null; } catch (err) { return null; }
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

  // Hash gọn của payload lần gửi gần nhất -> không gửi lại nếu không đổi (tiết kiệm request)
  const lastSent = { alerts: '', signals: '', tasks: '' };

  async function pullAlertsFromServer() {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId) return;
    try {
      const res = await safeFetch(`${WORKER_URL}/api/alerts?deviceId=${encodeURIComponent(deviceId)}`);
      if (!res || !res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.alerts)) AlertsModule.mergeFromServer(data.alerts);
    } catch (err) {
      console.warn('Tải cảnh báo từ Worker:', err);
    }
  }

  async function pullTasksFromServer() {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId) return;
    if (typeof TasksModule === 'undefined' || !TasksModule.mergeFromServer) return;
    try {
      const res = await safeFetch(`${WORKER_URL}/api/tasks?deviceId=${encodeURIComponent(deviceId)}`);
      if (!res || !res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.deletedIds) && data.deletedIds.length > 0 && TasksModule.mergeDeletedFromServer) {
        TasksModule.mergeDeletedFromServer(data.deletedIds);
      }
      if (data && Array.isArray(data.tasks)) TasksModule.mergeFromServer(data.tasks);
    } catch (err) {
      console.warn('Tải công việc từ Worker:', err);
    }
  }

  async function ensureSubscription() {
    if (!isConfigured()) return null;
    const deviceId = getDeviceId();
    if (!deviceId) return null;
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

  async function postIfChanged(kind, path, bodyObj) {
    const deviceId = getDeviceId();
    const str = JSON.stringify(bodyObj);
    if (lastSent[kind] === str) return; // không đổi -> khỏi gọi mạng
    const res = await safeFetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, ...bodyObj }),
    });
    if (res && res.ok) lastSent[kind] = str;
    else if (res) console.warn(`Đồng bộ ${kind} thất bại, HTTP`, res.status);
  }

  async function syncAlerts() {
    if (!isConfigured() || !getDeviceId()) return;
    try {
      await ensureSubscription();
      const alerts = AlertsModule.getAllAlerts()
        .filter((a) => !a.triggered)
        .map((a) => ({ id: a.id, symbol: a.symbol, price: a.price }));
      await postIfChanged('alerts', '/api/alerts', { alerts });
    } catch (err) {
      console.warn('Đồng bộ cảnh báo lên Worker:', err);
    }
  }

  async function syncSignals() {
    if (!isConfigured() || !getDeviceId()) return;
    try {
      await ensureSubscription();
      const state = Store.getState();
      const enabledTFs = Store.getEnabledSignalTimeframes() || [];
      const signals = [];
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
      await postIfChanged('signals', '/api/signals', { signals });
    } catch (err) {
      console.warn('Đồng bộ tín hiệu lên Worker:', err);
    }
  }

  async function syncTasks() {
    if (!isConfigured() || !getDeviceId()) return;
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
      await postIfChanged('tasks', '/api/tasks', { tasks });
    } catch (err) {
      console.warn('Đồng bộ công việc lên Worker:', err);
    }
  }

  async function deleteTaskOnServer(id) {
    if (!isConfigured()) return;
    const deviceId = getDeviceId();
    if (!deviceId || !id) return;
    const res = await safeFetch(`${WORKER_URL}/api/tasks`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, id }),
    });
    if (res && !res.ok) console.warn('Xoá công việc trên Worker thất bại, HTTP', res.status);
    lastSent.tasks = ''; // buộc lần sync kế tiếp gửi lại danh sách mới
  }

  function init() {
    if (!isConfigured()) {
      console.warn('[push-sync.js] Chưa cấu hình WORKER_URL - push khi tắt app sẽ không hoạt động.');
      return;
    }

    EventBus.on('alerts:changed', () => syncAlerts());
    EventBus.on('tasks:changed', () => syncTasks());
    EventBus.on('tasks:deleted', ({ id } = {}) => deleteTaskOnServer(id));

    // Tín hiệu phụ thuộc symbol/timeframe/breakout của pane
    EventBus.on('pane:symbolChanged', () => syncSignals());
    EventBus.on('pane:timeframeChanged', () => syncSignals());
    EventBus.on('pane:breakoutConfigChanged', () => syncSignals());

    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'notifAllowBtn') {
        setTimeout(() => { syncAlerts(); syncSignals(); syncTasks(); }, 500);
      }
    });

    // Thứ tự bắt buộc: pull TRƯỚC sync
    setTimeout(async () => {
      await pullAlertsFromServer();
      await pullTasksFromServer();
      syncAlerts();
      syncSignals();
      syncTasks();
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { syncAlerts, syncSignals, syncTasks, ensureSubscription, deleteTaskOnServer };
})();