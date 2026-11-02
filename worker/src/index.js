/**
 * dq-tracker-push / src/index.js

 * (Xem chú thích đầy đủ về cron/KV/alerts/signals ở các đợt fix trước -
 * không đổi. Đợt fix NÀY chỉ thêm phần "tài khoản nhẹ" (tên + PIN) để
 * nhiều người dùng chung app không bị lẫn cảnh báo của nhau.)
 *
 * FIX (đợt fix MỚI NHẤT - OANDA XAUUSD REALTIME + NHIỀU LỊCH SỬ):
 *   Trước đây /api/oanda/* dùng Yahoo "GC=F" (futures vàng, KHÔNG phải spot
 *   OANDA) -> giá lệch/trễ so với TradingView, và Yahoo giới hạn lịch sử
 *   intraday (1m: 5d, 15m: 30d...) nên không vẽ thêm nến cũ được.
 *   Giờ OANDA đi qua TradingView WebSocket (OANDA:XAUUSD):
 *     - klines: tới 5000 nến/lần, có endTime thì tự xin thêm (request_more_data)
 *       cho tới khi đủ nến trước mốc đó -> kéo chart về quá khứ được như Binance.
 *     - ticker: giá realtime + bid/ask/high/low/open qua quote session.
 *     - Khung tổng hợp (20m/45m/3h/6h/8h/12h/2d/3d) gộp từ khung nhỏ hơn.
 *     - Nếu TradingView lỗi -> tự rơi về Yahoo cũ làm fallback.
 *   Xem helper tv* ở cuối file.
 *
 * FIX (đợt fix trước - TÀI KHOẢN NHẸ, tên + PIN):
 *   Vấn đề: deviceId trước đây do client TỰ SINH NGẪU NHIÊN
 *   (localStorage, xem push-sync.js) - nghĩa là "tài khoản" thực chất gắn
 *   với TRÌNH DUYỆT, không gắn với NGƯỜI. Nếu 2 người dùng chung 1 trình
 *   duyệt/thiết bị (không xoá dữ liệu giữa các lần) thì họ vô tình dùng
 *   chung 1 deviceId -> cảnh báo lẫn vào nhau; ngược lại nếu 1 người dùng
 *   nhiều thiết bị thì lại có nhiều deviceId khác nhau, không lấy lại được
 *   cảnh báo cũ trên thiết bị mới.
 *
 *   Giải pháp NHẸ (không phải hệ thống bảo mật thật, chỉ đủ để vài người
 *   quen dùng chung app mà không lẫn cảnh báo):
 *     - Người dùng tự chọn 1 "tên" + 1 PIN 4-6 số.
 *     - Tên CHƯA từng dùng -> tạo hồ sơ mới, lưu hash(PIN).
 *     - Tên ĐÃ có -> phải nhập đúng PIN mới đăng nhập được vào đúng hồ sơ.
 *     - Sau khi đăng nhập, CLIENT lưu "tên" đó làm deviceId (xem login.js)
 *       -> mọi thứ còn lại (endpoint /api/alerts, /api/signals,
 *       /api/subscribe, cron...) hoạt động Y NGUYÊN như cũ, không cần sửa
 *       gì thêm - chỉ là "deviceId" giờ do người dùng chọn, không còn là
 *       chuỗi ngẫu nhiên.
 *     - PROFILES_KEY: 1 key KV duy nhất chứa map { username: pinHashHex }
 *       cho TẤT CẢ user - vẫn giữ đúng nguyên tắc "1 blob JSON gộp" như
 *       các key khác, nên KHÔNG làm tăng số lượt đọc/ghi KV theo số lượng
 *       user (chỉ tốn thêm đúng lúc có người đăng nhập/tạo hồ sơ, không
 *       liên quan gì đến tần suất chạy cron).
 *     - Hash PIN bằng SHA-256 (Web Crypto có sẵn trong Workers, không cần
 *       cài thêm thư viện) - KHÔNG lưu PIN dạng plain text.
 *
 * FIX (đợt fix trước - TASK ĐÃ XOÁ CỨ QUAY LẠI KHI DÙNG NHIỀU THIẾT BỊ):
 *   Nguyên nhân gốc: /api/tasks POST là kiểu "full sync" - mỗi thiết bị
 *   gửi TOÀN BỘ danh sách task hiện có trên máy nó lên, server GHI ĐÈ
 *   nguyên mảng cho deviceId đó. Nếu người dùng đăng nhập CÙNG 1 tên/PIN
 *   trên nhiều thiết bị song song:
 *     1) Thiết bị A xoá task X -> gửi full list (không có X) lên server ->
 *        server xoá X thành công.
 *     2) Thiết bị B (đang mở sẵn, CHƯA reload nên local vẫn còn X) sau đó
 *        có bất kỳ thay đổi nào khác (thêm task mới, tick hoàn thành...)
 *        -> syncTasks() của B gửi full list CỦA NÓ lên (vẫn còn X, vì B
 *        chưa hề biết X đã bị xoá) -> ghi đè lên server -> X "sống lại".
 *
 *   Giải pháp: thêm 1 key KV "tasks_deleted_v1" làm TOMBSTONE dùng chung
 *   cho mọi thiết bị cùng deviceId - đây là nguồn sự thật duy nhất, không
 *   phụ thuộc localStorage của riêng thiết bị nào:
 *     - Thêm endpoint DELETE /api/tasks: xoá đúng 1 task khỏi config VÀ
 *       ghi ngay vào tombstone. Client (tasks.js/push-sync.js) gọi thẳng
 *       endpoint này ngay khi người dùng bấm xoá, không đợi full sync.
 *     - POST /api/tasks (full sync) giờ LỌC BỎ mọi id đã có trong
 *       tombstone trước khi ghi - nên dù thiết bị B gửi lên list cũ còn
 *       X, server vẫn không cho X sống lại.
 *     - GET /api/tasks trả thêm "deletedIds" - để MỌI thiết bị khi pull
 *       về đều biết X đã bị xoá và tự dọn X khỏi local của chính nó (xem
 *       TasksModule.mergeDeletedFromServer() trong tasks.js).
 *     - Tombstone tự dọn sau 90 ngày (TASKS_DELETED_TTL_MS) để không phình
 *       KV vô hạn.
 */

import { buildPushPayload } from '@block65/webcrypto-web-push';

// ===== CONFIG: CHỈ client ghi (qua /api/alerts, /api/signals) =====
const ALERTS_CONFIG_KEY = 'alerts_config_v1'; // { [deviceId]: [{id, symbol, price}] }
const SIGNALS_CONFIG_KEY = 'signals_config_v1'; // { [deviceId]: [{paneId, symbol, timeframe, higherTF, lookbackCandles}] }

// ===== STATE: CHỈ cron ghi (checkAlertsAndNotify/checkSignalsAndNotify) =====
const ALERTS_STATE_KEY = 'alerts_state_v1'; // { [deviceId]: { [alertId]: {side, triggered} } }
const SIGNALS_STATE_KEY = 'signals_state_v1'; // { [deviceId]: { [signalStateKey]: {lastNotifiedTime, lastDirection} } }

const TASKS_CONFIG_KEY = 'tasks_config_v1'; // { [deviceId]: [{id,title,note,date,time,repeat,daysOfWeek,enabled}] }
const TASKS_STATE_KEY = 'tasks_state_v1';   // { [deviceId]: { [taskId]: lastNotifiedKey } }
const TASKS_DELETED_KEY = 'tasks_deleted_v1'; // { [deviceId]: { [taskId]: deletedAtTimestampMs } } - tombstone dùng chung mọi thiết bị
const TASKS_DELETED_TTL_MS = 90 * 24 * 60 * 60 * 1000; // tự dọn tombstone sau 90 ngày

const SETUP_CONFIG_KEY = 'setup_config_v1'; // { [deviceId]: { panes, enabledSignalTimeframes, layout, indicatorPrefs, theme } }
const TRADES_CONFIG_KEY = 'trades_config_v1'; // { [deviceId]: [{ticket, symbol, type, lots, openPrice, closePrice, openTime, closeTime, pnl, commission, swap, magic, comment, isBot}] }

const SUBS_KEY = 'subs_v1'; // { [deviceId]: PushSubscriptionJSON }

// ===== TÀI KHOẢN NHẸ (đợt fix này) =====
const PROFILES_KEY = 'profiles_v1'; // { [username]: pinHashHex }

function withCors(resp) {
  resp.headers.set('Access-Control-Allow-Origin', '*');
  resp.headers.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS'); // ← thêm DELETE
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return resp;
}

const KLINES_MEM = new Map(); // key -> { ts, data, p }
const LIVE_MEM = new Map();
const TICK_MEM = new Map();

/**
 * Cache RAM + DÙNG CHUNG request đang chạy + trả dữ liệu cũ khi nguồn lỗi.
 *  - ttlMs:   dữ liệu còn "tươi" thì trả luôn, không gọi nguồn.
 *  - staleMs: nguồn lỗi (fn trả null/ném lỗi) thì trả dữ liệu cũ nếu chưa quá tuổi này.
 * Nhiều client hỏi cùng lúc -> chỉ 1 lần mở WebSocket TradingView.
 */
async function memoAsync(store, key, ttlMs, fn, staleMs = 0) {
  let e = store.get(key);
  if (!e) {
    e = { ts: 0, data: null, p: null };
    store.set(key, e);
    if (store.size > 200) store.delete(store.keys().next().value);
  }
  if (e.data && Date.now() - e.ts < ttlMs) return e.data;
  if (!e.p) {
    e.p = Promise.resolve()
      .then(fn)
      .catch((err) => {
        console.log('[memo] nguồn lỗi:', err && err.message);
        return null;
      })
      .then((d) => {
        if (d) {
          e.data = d;
          e.ts = Date.now();
        }
        e.p = null;
        return d;
      });
  }
  const d = await e.p;
  if (d) return d;
  if (e.data && Date.now() - e.ts < staleMs) return e.data;
  return null;
}

function jsonNoStore(data) {
  const resp = Response.json(data);
  resp.headers.set('Cache-Control', 'no-store');
  return withCors(resp);
}

async function readJSON(kv, key, fallback) {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

async function writeJSON(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

// Khoá dùng để định danh 1 signal trong STATE, khớp theo pane + symbol +
// timeframe (không dùng higherTF/lookbackCandles vì đổi mấy cái đó vẫn nên
// giữ nguyên lịch sử lastDirection của cùng 1 "vị trí theo dõi").
function signalStateKey(s) {
  return `${s.paneId}__${s.symbol}__${s.timeframe}`;
}

// Chuẩn hoá tên đăng nhập: chữ thường, khoảng trắng -> gạch dưới, chỉ giữ
// chữ/số/gạch dưới - để dùng thẳng làm deviceId (key trong mọi KV blob
// khác) mà không lo ký tự lạ/khoảng trắng gây lỗi.
function normalizeUsername(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

async function hashPin(pin) {
  const enc = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Dọn các tombstone quá hạn (90 ngày) khỏi 1 map { [taskId]: deletedAtMs }.
// Trả về true nếu có thay đổi (để caller biết còn cần ghi lại KV hay không).
function pruneDeletedMap(map) {
  const now = Date.now();
  let changed = false;
  Object.keys(map).forEach((id) => {
    if (now - map[id] > TASKS_DELETED_TTL_MS) {
      delete map[id];
      changed = true;
    }
  });
  return changed;
}

function normalizeTradeItem(t) {
  if (!t || typeof t !== 'object') return null;
  let symbol = String(t.symbol || 'XAUUSD').trim();
  if (/^[A-Za-z0-9]+c$/i.test(symbol) && symbol.length > 3) {
    symbol = symbol.slice(0, -1);
  }
  symbol = symbol.toUpperCase();

  const magic = Number(t.magic || 0);
  const comment = String(t.comment || '').toLowerCase();
  const isBot = t.isBot !== undefined ? !!t.isBot : (magic > 0 || comment.includes('ea') || comment.includes('bot'));

  const ticket = String(t.ticket || t.id || 'tr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6));
  const type = String(t.type || 'BUY').toUpperCase();
  const lots = Number(t.lots || t.volume || 0.01);
  const openPrice = Number(t.openPrice || 0);
  const closePrice = Number(t.closePrice || 0);
  const openTime = t.openTime ? String(t.openTime) : new Date().toISOString();
  const closeTime = t.closeTime ? String(t.closeTime) : new Date().toISOString();
  const pnl = Number(t.pnl !== undefined ? t.pnl : (t.profit !== undefined ? t.profit : 0));
  const commission = Number(t.commission || 0);
  const swap = Number(t.swap || 0);

  return {
    ticket,
    symbol,
    type,
    lots,
    openPrice,
    closePrice,
    openTime,
    closeTime,
    pnl,
    commission,
    swap,
    magic,
    comment: t.comment || '',
    isBot,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cleanPath = url.pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    if ((cleanPath === '/api/vapid-public-key' || cleanPath === '/vapid-public-key') && request.method === 'GET') {
      return withCors(Response.json({ publicKey: env.VAPID_PUBLIC_KEY }));
    }

    if ((cleanPath === '/api/login' || cleanPath === '/login') && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return withCors(new Response('JSON không hợp lệ', { status: 400 }));
      }

      const rawUsername = body && body.username;
      const pin = body && body.pin;

      if (!rawUsername || !pin || !/^\d{4,6}$/.test(String(pin))) {
        return withCors(
          Response.json({ ok: false, error: 'Tên hoặc PIN không hợp lệ (PIN cần 4-6 chữ số).' }, { status: 400 })
        );
      }

      const username = normalizeUsername(rawUsername);
      if (!username || !/^[a-z0-9_]{2,32}$/.test(username)) {
        return withCors(
          Response.json({ ok: false, error: 'Tên chỉ nên gồm chữ, số, dấu gạch dưới (2-32 ký tự).' }, { status: 400 })
        );
      }

      const profiles = await readJSON(env.TRACKER_KV, PROFILES_KEY, {});
      const pinHash = await hashPin(String(pin));

      if (!profiles[username]) {
        profiles[username] = pinHash;
        await writeJSON(env.TRACKER_KV, PROFILES_KEY, profiles);
        return withCors(Response.json({ ok: true, created: true, deviceId: username }));
      }

      if (profiles[username] !== pinHash) {
        return withCors(Response.json({ ok: false, error: 'Sai PIN cho tên này.' }, { status: 401 }));
      }

      return withCors(Response.json({ ok: true, created: false, deviceId: username }));
    }

    if (url.pathname === '/api/subscribe' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return withCors(new Response('JSON không hợp lệ', { status: 400 }));
      }
      const { deviceId, subscription } = body || {};
      if (!deviceId || !subscription || !subscription.endpoint) {
        return withCors(new Response('Thiếu deviceId hoặc subscription', { status: 400 }));
      }

      const subs = await readJSON(env.TRACKER_KV, SUBS_KEY, {});
      subs[deviceId] = subscription;
      await writeJSON(env.TRACKER_KV, SUBS_KEY, subs);
      return withCors(Response.json({ ok: true }));
    }

    // Chỉ ghi vào ALERTS_CONFIG_KEY - KHÔNG đụng vào ALERTS_STATE_KEY (side/
    // triggered), tránh race condition với cron gây báo lặp (xem đợt fix
    // trước).
    if (url.pathname === '/api/alerts' && request.method === 'GET') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) {
        return withCors(new Response('Thiếu deviceId', { status: 400 }));
      }
      const allConfig = await readJSON(env.TRACKER_KV, ALERTS_CONFIG_KEY, {});
      return withCors(Response.json({ ok: true, alerts: allConfig[deviceId] || [] }));
    }
    if (url.pathname === '/api/alerts' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return withCors(new Response('JSON không hợp lệ', { status: 400 }));
      }
      const { deviceId, alerts } = body || {};
      if (!deviceId || !Array.isArray(alerts)) {
        return withCors(new Response('Payload không hợp lệ', { status: 400 }));
      }

      const allConfig = await readJSON(env.TRACKER_KV, ALERTS_CONFIG_KEY, {});

      const merged = alerts
        .filter((a) => a && a.id && a.symbol && typeof a.price === 'number')
        .map((a) => ({ id: a.id, symbol: a.symbol, price: a.price }));

      const prevStr = JSON.stringify(allConfig[deviceId] || []);
      if (merged.length > 0) {
        allConfig[deviceId] = merged;
      } else {
        delete allConfig[deviceId];
      }
      const nextStr = JSON.stringify(allConfig[deviceId] || []);
      if (prevStr !== nextStr) {
        await writeJSON(env.TRACKER_KV, ALERTS_CONFIG_KEY, allConfig);
      }
      return withCors(Response.json({ ok: true, count: merged.length }));
    }

    if (url.pathname === '/api/tasks' && request.method === 'GET') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) return withCors(new Response('Thiếu deviceId', { status: 400 }));
      const allConfig = await readJSON(env.TRACKER_KV, TASKS_CONFIG_KEY, {});
      const allDeleted = await readJSON(env.TRACKER_KV, TASKS_DELETED_KEY, {});
      const deviceDeleted = allDeleted[deviceId] || {};
      return withCors(Response.json({
        ok: true,
        tasks: allConfig[deviceId] || [],
        // Trả kèm danh sách id đã xoá để MỌI thiết bị pull về đều tự dọn
        // task đó khỏi local của chính nó (xem mergeDeletedFromServer).
        deletedIds: Object.keys(deviceDeleted),
      }));
    }

    if (url.pathname === '/api/tasks' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (err) { return withCors(new Response('JSON không hợp lệ', { status: 400 })); }
      const { deviceId, tasks } = body || {};
      if (!deviceId || !Array.isArray(tasks)) return withCors(new Response('Payload không hợp lệ', { status: 400 }));
      console.log(`[api/tasks] deviceId=${deviceId} nhận ${tasks.length} task(s)`); // thêm dòng này để thấy trong tail

      const allConfig = await readJSON(env.TRACKER_KV, TASKS_CONFIG_KEY, {});
      const allDeleted = await readJSON(env.TRACKER_KV, TASKS_DELETED_KEY, {});
      const deviceDeleted = allDeleted[deviceId] || {};

      const merged = tasks
        .filter((t) => t && t.id && t.title && t.date && t.time)
        // BẮT BUỘC: bỏ qua mọi id đã có trong tombstone - đây là chỗ chặn
        // trường hợp 1 thiết bị/tab khác (chưa biết task đã bị xoá) gửi
        // lên full list cũ còn chứa task đó và ghi đè làm nó "sống lại".
        .filter((t) => !deviceDeleted[t.id])
        .map((t) => ({
          id: t.id, title: t.title, note: t.note || '', date: t.date, time: t.time,
          repeat: t.repeat || 'none', daysOfWeek: Array.isArray(t.daysOfWeek) ? t.daysOfWeek : [],
          enabled: !!t.enabled,
        }));

      const prevStr = JSON.stringify(allConfig[deviceId] || []);
      if (merged.length > 0) allConfig[deviceId] = merged; else delete allConfig[deviceId];
      const nextStr = JSON.stringify(allConfig[deviceId] || []);
      if (prevStr !== nextStr) {
        await writeJSON(env.TRACKER_KV, TASKS_CONFIG_KEY, allConfig);
      }
      return withCors(Response.json({ ok: true, count: merged.length }));
    }

    // Xoá ĐÚNG 1 task và ghi tombstone ngay lập tức - gọi thẳng từ client
    // ngay khi người dùng bấm xoá (không đợi full sync qua POST ở trên).
    // Đây là nguồn sự thật chung cho MỌI thiết bị cùng deviceId.
    if (url.pathname === '/api/tasks' && request.method === 'DELETE') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const deviceId = body?.deviceId || url.searchParams.get('deviceId');
      const taskId = body?.id || body?.taskId || url.searchParams.get('id');
      if (!deviceId || !taskId) return withCors(new Response('Thiếu deviceId hoặc id', { status: 400 }));

      const allConfig = await readJSON(env.TRACKER_KV, TASKS_CONFIG_KEY, {});
      const allDeleted = await readJSON(env.TRACKER_KV, TASKS_DELETED_KEY, {});
      const allTaskState = await readJSON(env.TRACKER_KV, TASKS_STATE_KEY, {});

      let configChanged = false;
      if (allConfig[deviceId]) {
        const before = allConfig[deviceId].length;
        allConfig[deviceId] = allConfig[deviceId].filter((t) => t.id !== taskId);
        if (allConfig[deviceId].length !== before) configChanged = true;
        if (allConfig[deviceId].length === 0) delete allConfig[deviceId];
      }

      const deviceDeleted = allDeleted[deviceId] || (allDeleted[deviceId] = {});
      deviceDeleted[taskId] = Date.now();
      pruneDeletedMap(deviceDeleted); // tiện thể dọn tombstone quá hạn của deviceId này

      let stateChanged = false;
      if (allTaskState[deviceId] && allTaskState[deviceId][taskId] !== undefined) {
        delete allTaskState[deviceId][taskId];
        stateChanged = true;
        if (Object.keys(allTaskState[deviceId]).length === 0) delete allTaskState[deviceId];
      }

      if (configChanged) await writeJSON(env.TRACKER_KV, TASKS_CONFIG_KEY, allConfig);
      await writeJSON(env.TRACKER_KV, TASKS_DELETED_KEY, allDeleted);
      if (stateChanged) await writeJSON(env.TRACKER_KV, TASKS_STATE_KEY, allTaskState);

      return withCors(Response.json({ ok: true }));
    }

    if (url.pathname === '/api/setup' && request.method === 'GET') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) return withCors(new Response('Thiếu deviceId', { status: 400 }));
      const allConfig = await readJSON(env.TRACKER_KV, SETUP_CONFIG_KEY, {});
      return withCors(Response.json({ ok: true, setup: allConfig[deviceId] || null }));
    }

    if (url.pathname === '/api/setup' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (err) { return withCors(new Response('JSON không hợp lệ', { status: 400 })); }
      const { deviceId, setup } = body || {};
      if (!deviceId || !setup || typeof setup !== 'object') {
        return withCors(new Response('Payload không hợp lệ', { status: 400 }));
      }
      const allConfig = await readJSON(env.TRACKER_KV, SETUP_CONFIG_KEY, {});
      const prevStr = JSON.stringify(allConfig[deviceId] || null);
      const nextStr = JSON.stringify(setup);
      if (prevStr !== nextStr) {
        allConfig[deviceId] = setup;
        await writeJSON(env.TRACKER_KV, SETUP_CONFIG_KEY, allConfig);
      }
      return withCors(Response.json({ ok: true }));
    }

    if ((cleanPath === '/api/trades' || cleanPath === '/trades') && request.method === 'GET') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) return withCors(new Response('Thiếu deviceId', { status: 400 }));
      const allTrades = await readJSON(env.TRACKER_KV, TRADES_CONFIG_KEY, {});
      return withCors(Response.json({ ok: true, trades: allTrades[deviceId] || [] }));
    }

    if ((cleanPath === '/api/trades' || cleanPath === '/trades') && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch (err) { return withCors(new Response('JSON không hợp lệ', { status: 400 })); }
      const deviceId = body?.deviceId || url.searchParams.get('deviceId');
      if (!deviceId) return withCors(new Response('Thiếu deviceId', { status: 400 }));

      let incoming = [];
      if (Array.isArray(body.trades)) {
        incoming = body.trades;
      } else if (body.trade && typeof body.trade === 'object') {
        incoming = [body.trade];
      } else if (body.ticket || body.id) {
        incoming = [body];
      }

      const allTrades = await readJSON(env.TRACKER_KV, TRADES_CONFIG_KEY, {});
      const existing = allTrades[deviceId] || [];
      const tradeMap = new Map();
      existing.forEach((t) => tradeMap.set(String(t.ticket), t));

      let addedCount = 0;
      incoming.forEach((raw) => {
        const norm = normalizeTradeItem(raw);
        if (norm && norm.ticket) {
          tradeMap.set(String(norm.ticket), norm);
          addedCount++;
        }
      });

      const updatedList = Array.from(tradeMap.values());
      // Sắp xếp theo closeTime mới nhất trước
      updatedList.sort((a, b) => new Date(b.closeTime) - new Date(a.closeTime));

      const prevStr = JSON.stringify(existing);
      const nextStr = JSON.stringify(updatedList);
      if (prevStr !== nextStr) {
        allTrades[deviceId] = updatedList;
        await writeJSON(env.TRACKER_KV, TRADES_CONFIG_KEY, allTrades);
      }
      return withCors(Response.json({ ok: true, count: updatedList.length, added: addedCount }));
    }

    if ((cleanPath === '/api/trades' || cleanPath === '/trades') && request.method === 'DELETE') {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const deviceId = body?.deviceId || url.searchParams.get('deviceId');
      const ticket = body?.ticket || url.searchParams.get('ticket');
      if (!deviceId) return withCors(new Response('Thiếu deviceId', { status: 400 }));

      const allTrades = await readJSON(env.TRACKER_KV, TRADES_CONFIG_KEY, {});
      if (!allTrades[deviceId]) return withCors(Response.json({ ok: true, count: 0 }));

      if (ticket) {
        allTrades[deviceId] = allTrades[deviceId].filter((t) => String(t.ticket) !== String(ticket));
      } else {
        delete allTrades[deviceId];
      }
      await writeJSON(env.TRACKER_KV, TRADES_CONFIG_KEY, allTrades);
      return withCors(Response.json({ ok: true }));
    }
    // Chỉ ghi vào SIGNALS_CONFIG_KEY - KHÔNG đụng vào SIGNALS_STATE_KEY
    // (lastDirection/lastNotifiedTime), cùng lý do như trên.
    if (url.pathname === '/api/signals' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (err) {
        return withCors(new Response('JSON không hợp lệ', { status: 400 }));
      }
      const { deviceId, signals } = body || {};
      if (!deviceId || !Array.isArray(signals)) {
        return withCors(new Response('Payload không hợp lệ', { status: 400 }));
      }

      const allConfig = await readJSON(env.TRACKER_KV, SIGNALS_CONFIG_KEY, {});

      const merged = signals
        .filter((s) => s && s.paneId && s.symbol && s.timeframe && s.higherTF)
        .map((s) => ({
          paneId: s.paneId,
          symbol: s.symbol,
          timeframe: s.timeframe,
          higherTF: s.higherTF,
          lookbackCandles: s.lookbackCandles || 2,
        }));

      const prevStr = JSON.stringify(allConfig[deviceId] || []);
      if (merged.length > 0) {
        allConfig[deviceId] = merged;
      } else {
        delete allConfig[deviceId];
      }
      const nextStr = JSON.stringify(allConfig[deviceId] || []);
      if (prevStr !== nextStr) {
        await writeJSON(env.TRACKER_KV, SIGNALS_CONFIG_KEY, allConfig);
      }
      return withCors(Response.json({ ok: true, count: merged.length }));
    }

         // ===== OANDA qua TradingView (cache RAM + dùng chung request + trả dữ liệu cũ khi lỗi) =====
    if (url.pathname === '/api/oanda/klines') {
      const symbol = url.searchParams.get('symbol') || 'XAUUSD';
      const interval = url.searchParams.get('interval') || '15m';
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '500', 10) || 500, 1), 5000);
      const endTime = url.searchParams.get('endTime');

      if (!isOandaSymbol(symbol)) {
        return withCors(Response.json({ error: 'symbol không được hỗ trợ' }, { status: 400 }));
      }

      const cacheKey = `${toTradingViewSymbol(symbol)}|${interval}|${limit}|${endTime || ''}`;
      const ttl = endTime ? 10 * 60000 : 8000; // lịch sử cũ cache lâu hơn
      const candles = await memoAsync(
        KLINES_MEM,
        cacheKey,
        ttl,
        () => fetchOandaKlinesTV(symbol, interval, limit, endTime),
        endTime ? 0 : 120000
      );
      if (!candles || !candles.length) {
        return withCors(Response.json({ error: 'TradingView không trả dữ liệu' }, { status: 502 }));
      }
      return jsonNoStore(candles);
    }

    if (url.pathname === '/api/oanda/ticker') {
      const symbol = url.searchParams.get('symbol') || 'XAUUSD';
      if (!isOandaSymbol(symbol)) {
        return withCors(Response.json({ error: 'symbol không được hỗ trợ' }, { status: 400 }));
      }
      const t = await memoAsync(
        TICK_MEM,
        `tick|${toTradingViewSymbol(symbol)}`,
        2000,
        () => fetchOandaTickerTV(symbol),
        30000
      );
      if (!t) return withCors(Response.json({ error: 'TradingView không trả dữ liệu' }, { status: 502 }));
      return jsonNoStore(t);
    }

    // 1 WebSocket TradingView -> vài nến cuối của NHIỀU khung (kể cả khung tổng hợp) + quote.
    // GET /api/oanda/live?symbol=XAUUSD&intervals=5m,15m,1h,6h&n=3
    if (url.pathname === '/api/oanda/live') {
      const symbol = url.searchParams.get('symbol') || 'XAUUSD';
      const intervals = [
        ...new Set(
          (url.searchParams.get('intervals') || '15m')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => TV_INTERVAL_MAP[s])
        ),
      ].slice(0, 14);
      const n = Math.min(Math.max(parseInt(url.searchParams.get('n') || '3', 10) || 3, 1), 100);
      if (!isOandaSymbol(symbol) || intervals.length === 0) {
        return withCors(Response.json({ error: 'tham số không hợp lệ' }, { status: 400 }));
      }
      const key = `live|${toTradingViewSymbol(symbol)}|${[...intervals].sort().join(',')}|${n}`;
      const data = await memoAsync(
        LIVE_MEM,
        key,
        2000,
        async () => {
          let out = (await fetchOandaLiveTV(symbol, intervals, n)) || {};
          // Bù các khung còn thiếu bằng 1 kết nối khác (chia nhỏ từng nhóm 3 khung)
          let missing = intervals.filter((iv) => !out[iv]);
          for (let round = 0; round < 2 && missing.length; round++) {
            const chunk = missing.slice(0, 3);
            const more = await fetchOandaLiveTV(symbol, chunk, n).catch(() => null);
            if (more) {
              Object.keys(more).forEach((k) => { if (k !== '__quote' || !out.__quote) out[k] = more[k]; });
            }
            missing = intervals.filter((iv) => !out[iv]);
          }
          return Object.keys(out).length ? out : null;
        },
        45000
      );
      if (!data) return withCors(Response.json({ error: 'TradingView không trả dữ liệu' }, { status: 502 }));
      return jsonNoStore(data);
    }

    return withCors(new Response('Not found', { status: 404 }));
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCronTick(env));
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCronTick(env) {
  await Promise.allSettled([checkAlertsAndNotify(env), checkSignalsAndNotify(env), checkTasksAndNotify(env)]);
  await sleep(30000);
  await checkAlertsAndNotify(env);
}

async function checkAlertsAndNotify(env) {
  const allConfig = await readJSON(env.TRACKER_KV, ALERTS_CONFIG_KEY, {});
  const allState = await readJSON(env.TRACKER_KV, ALERTS_STATE_KEY, {});
  const subs = await readJSON(env.TRACKER_KV, SUBS_KEY, {});

  console.log(
    `[cron] devices=${Object.keys(allConfig).length} subs=${Object.keys(subs).length}`
  );

  const symbolSet = new Set();
  Object.keys(allConfig).forEach((deviceId) => {
    const list = allConfig[deviceId] || [];
    const deviceState = allState[deviceId] || {};
    list.forEach((a) => {
      const st = deviceState[a.id];
      if (!st || !st.triggered) symbolSet.add(a.symbol);
    });
  });
  if (symbolSet.size === 0) {
    console.log('[cron] không có cảnh báo nào đang chờ - bỏ qua.');
    return;
  }

  const prices = await fetchCoinGeckoPrices(env, [...symbolSet]);
  if (!prices) {
    console.log('[cron] lỗi lấy giá từ CoinGecko.');
    return;
  }
  console.log('[cron] giá hiện tại:', JSON.stringify(prices));

  let stateChanged = false;
  let subsChanged = false;

  for (const deviceId of Object.keys(allConfig)) {
    const list = allConfig[deviceId] || [];
    const subscription = subs[deviceId];
    const deviceState = allState[deviceId] || (allState[deviceId] = {});

    for (const alertCfg of list) {
      const st = deviceState[alertCfg.id] || (deviceState[alertCfg.id] = { side: null, triggered: false });
      if (st.triggered) continue;

      const price = prices[alertCfg.symbol];
      if (price === undefined || Number.isNaN(price)) continue;

      const side = price >= alertCfg.price ? 'above' : 'below';

      if (st.side === null || st.side === undefined) {
        console.log(
          `[cron] baseline mới cho ${deviceId}/${alertCfg.symbol}@${alertCfg.price}: giá hiện tại ${price} (${side})`
        );
        st.side = side;
        stateChanged = true;
        continue;
      }

      if (st.side !== side) {
        console.log(
          `[cron] KÍCH HOẠT ${deviceId}/${alertCfg.symbol}@${alertCfg.price}: ${st.side} -> ${side}, giá=${price}, có subscription=${!!subscription}`
        );
        st.side = side;
        st.triggered = true;
        stateChanged = true;

        if (subscription) {
          const stillValid = await sendPush(env, subscription, {
            title: '🔔 Cảnh báo giá',
            body: `${alertCfg.symbol} đã chạm mức ${price}`,
          });
          console.log(`[cron] gửi push cho ${deviceId} - subscription còn hợp lệ: ${stillValid}`);
          if (!stillValid) {
            delete subs[deviceId];
            subsChanged = true;
          }
        }
      }
    }

    const validIds = new Set(list.map((a) => a.id));
    Object.keys(deviceState).forEach((id) => {
      if (!validIds.has(id)) {
        delete deviceState[id];
        stateChanged = true;
      }
    });
    if (Object.keys(deviceState).length === 0) {
      delete allState[deviceId];
    }
  }

  Object.keys(allState).forEach((deviceId) => {
    if (!allConfig[deviceId]) {
      delete allState[deviceId];
      stateChanged = true;
    }
  });

  if (stateChanged) await writeJSON(env.TRACKER_KV, ALERTS_STATE_KEY, allState);
  if (subsChanged) await writeJSON(env.TRACKER_KV, SUBS_KEY, subs);
}
// Cloudflare Worker chạy Date theo UTC (không có múi giờ hệ thống), còn
// HH:MM người dùng nhập là giờ Việt Nam (ICT, UTC+7) - phải tự bù offset
// khi so khớp, nếu không lời nhắc server-side sẽ báo lệch đúng 7 tiếng.
const TZ_OFFSET_MIN = 7 * 60;

function localPartsFromUtc(utcMs) {
  const s = new Date(utcMs + TZ_OFFSET_MIN * 60000);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate() };
}
function localToUtcMs(y, m, d, hh, mm) {
  return Date.UTC(y, m, d, hh, mm, 0, 0) - TZ_OFFSET_MIN * 60000;
}
function lastDayOfMonthUTC(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}
function dateKeyLocal(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

function getDueOccurrenceServer(task, nowUtcMs) {
  if (!task.enabled) return null;
  const [hh, mm] = (task.time || '00:00').split(':').map(Number);
  const [ay, am, ad] = (task.date || '1970-01-01').split('-').map(Number);
  const anchorUtcMs = localToUtcMs(ay, am - 1, ad, 0, 0);
  const now = localPartsFromUtc(nowUtcMs);

  if (task.repeat === 'none' || !task.repeat) {
    const dueUtc = localToUtcMs(ay, am - 1, ad, hh, mm);
    return dueUtc <= nowUtcMs ? { key: 'once', timestamp: dueUtc } : null;
  }

  if (task.repeat === 'daily') {
    for (let back = 0; back < 2; back++) {
      const d = new Date(Date.UTC(now.y, now.m, now.d - back));
      const y2 = d.getUTCFullYear(), m2 = d.getUTCMonth(), d2 = d.getUTCDate();
      const candidateUtc = localToUtcMs(y2, m2, d2, hh, mm);
      if (candidateUtc > nowUtcMs) continue;
      if (localToUtcMs(y2, m2, d2, 0, 0) < anchorUtcMs) return null;
      return { key: dateKeyLocal(y2, m2, d2), timestamp: candidateUtc };
    }
    return null;
  }

  if (task.repeat === 'weekly') {
    const days = (task.daysOfWeek && task.daysOfWeek.length)
      ? task.daysOfWeek : [new Date(Date.UTC(ay, am - 1, ad)).getUTCDay()];
    for (let back = 0; back < 8; back++) {
      const d = new Date(Date.UTC(now.y, now.m, now.d - back));
      const y2 = d.getUTCFullYear(), m2 = d.getUTCMonth(), d2 = d.getUTCDate(), day2 = d.getUTCDay();
      const candidateUtc = localToUtcMs(y2, m2, d2, hh, mm);
      if (candidateUtc > nowUtcMs) continue;
      if (localToUtcMs(y2, m2, d2, 0, 0) < anchorUtcMs) break;
      if (days.includes(day2)) return { key: dateKeyLocal(y2, m2, d2), timestamp: candidateUtc };
    }
    return null;
  }

  if (task.repeat === 'monthly') {
    for (let back = 0; back < 2; back++) {
      const mIdx = now.m - back;
      const y2 = now.y + Math.floor(mIdx / 12);
      const m2 = ((mIdx % 12) + 12) % 12;
      const day = Math.min(ad, lastDayOfMonthUTC(y2, m2));
      const candidateUtc = localToUtcMs(y2, m2, day, hh, mm);
      if (candidateUtc > nowUtcMs) continue;
      if (localToUtcMs(y2, m2, day, 0, 0) < anchorUtcMs) break;
      return { key: dateKeyLocal(y2, m2, day), timestamp: candidateUtc };
    }
    return null;
  }
  return null;
}

async function checkTasksAndNotify(env) {
  const allConfig = await readJSON(env.TRACKER_KV, TASKS_CONFIG_KEY, {});
  console.log(`[cron-tasks] devices=${Object.keys(allConfig).length}`); // thêm dòng này
  const allState = await readJSON(env.TRACKER_KV, TASKS_STATE_KEY, {});
  const subs = await readJSON(env.TRACKER_KV, SUBS_KEY, {});
  if (Object.keys(allConfig).length === 0) return;

  const now = Date.now();
  let stateChanged = false;
  let subsChanged = false;

  for (const deviceId of Object.keys(allConfig)) {
    const list = allConfig[deviceId] || [];
    const subscription = subs[deviceId];
    const deviceState = allState[deviceId] || (allState[deviceId] = {});

    for (const task of list) {
      const occ = getDueOccurrenceServer(task, now);
      if (!occ || deviceState[task.id] === occ.key) continue;

      deviceState[task.id] = occ.key;
      stateChanged = true;

      if (subscription) {
        const stillValid = await sendPush(env, subscription, {
          title: '📝 Nhắc việc',
          body: task.note ? `${task.title} - ${task.note}` : task.title,
        });
        if (!stillValid) { delete subs[deviceId]; subsChanged = true; }
      }
    }

    const validIds = new Set(list.map((t) => t.id));
    Object.keys(deviceState).forEach((id) => {
      if (!validIds.has(id)) { delete deviceState[id]; stateChanged = true; }
    });
    if (Object.keys(deviceState).length === 0) delete allState[deviceId];
  }

  Object.keys(allState).forEach((deviceId) => {
    if (!allConfig[deviceId]) { delete allState[deviceId]; stateChanged = true; }
  });

  if (stateChanged) await writeJSON(env.TRACKER_KV, TASKS_STATE_KEY, allState);
  if (subsChanged) await writeJSON(env.TRACKER_KV, SUBS_KEY, subs);
}
const SYMBOL_TO_COINGECKO_ID = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', TON: 'the-open-network',
  TRX: 'tron', DOT: 'polkadot', MATIC: 'matic-network', POL: 'polygon-ecosystem-token',
  LINK: 'chainlink', LTC: 'litecoin', BCH: 'bitcoin-cash', AVAX: 'avalanche-2',
  ATOM: 'cosmos', UNI: 'uniswap', NEAR: 'near', APT: 'aptos', ARB: 'arbitrum',
  OP: 'optimism', SUI: 'sui', SEI: 'sei-network', INJ: 'injective-protocol',
  FIL: 'filecoin', ETC: 'ethereum-classic', XLM: 'stellar', ICP: 'internet-computer',
  HBAR: 'hedera-hashgraph', VET: 'vechain', ALGO: 'algorand', AAVE: 'aave',
  MKR: 'maker', SAND: 'the-sandbox', MANA: 'decentraland', AXS: 'axie-infinity',
  FTM: 'fantom', RUNE: 'thorchain', GRT: 'the-graph', EGLD: 'multiversx',
  THETA: 'theta-token', XTZ: 'tezos', EOS: 'eos', KAS: 'kaspa',
  PEPE: 'pepe', SHIB: 'shiba-inu', WIF: 'dogwifcoin', BONK: 'bonk',
  FLOKI: 'floki', USDT: 'tether', USDC: 'usd-coin', DAI: 'dai',
};

const QUOTE_ASSETS = [
  'FDUSD', 'USDT', 'USDC', 'TUSD', 'BUSD', 'DAI',
  'USD', 'EUR', 'GBP', 'TRY', 'BRL',
  'BTC', 'ETH', 'BNB',
];

function splitSymbol(symbol) {
  for (const quote of QUOTE_ASSETS) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return { base: symbol.slice(0, -quote.length), quote };
    }
  }
  return null;
}

const STABLECOIN_AS_USD = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD', 'DAI']);

function vsCurrencyFor(quote) {
  return STABLECOIN_AS_USD.has(quote) ? 'usd' : quote.toLowerCase();
}

async function fetchCoinGeckoPrices(env, symbols) {
  const pairs = symbols
    .map((symbol) => ({ symbol, parsed: splitSymbol(symbol) }))
    .filter((p) => p.parsed !== null)
    .map((p) => ({ ...p, id: SYMBOL_TO_COINGECKO_ID[p.parsed.base] }));

  const unmapped = pairs.filter((p) => !p.id).map((p) => p.symbol);
  if (unmapped.length > 0) {
    console.log('[cron] không map được coingecko id cho symbol:', unmapped.join(', '));
  }

  const mapped = pairs.filter((p) => p.id);
  if (mapped.length === 0) {
    console.log('[cron] không có symbol nào map được sang CoinGecko id.');
    return {};
  }

  const ids = [...new Set(mapped.map((p) => p.id))];
  const vsCurrencies = [...new Set(mapped.map((p) => vsCurrencyFor(p.parsed.quote)))];
  const targetUrl =
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}` +
    `&vs_currencies=${encodeURIComponent(vsCurrencies.join(','))}`;

  let res;
  try {
    res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'dq-tracker-push/1.0 (personal price alert worker)',
        Accept: 'application/json',
        ...(env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {}),
      },
    });
  } catch (err) {
    console.log('[cron] fetch CoinGecko ném lỗi (network):', err.message);
    return null;
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '(không đọc được body)');
    console.log(`[cron] CoinGecko trả về lỗi HTTP ${res.status} ${res.statusText}: ${bodyText.slice(0, 300)}`);
    if (res.status === 429 && !env.COINGECKO_API_KEY) {
      console.log('[cron] gợi ý: set secret COINGECKO_API_KEY (free Demo key tại coingecko.com/en/api/pricing) để có quota riêng, tránh bị chia sẻ theo IP.');
    }
    return null;
  }
  const data = await res.json();

  const map = {};
  mapped.forEach(({ symbol, parsed, id }) => {
    const price = data[id] && data[id][vsCurrencyFor(parsed.quote)];
    if (typeof price === 'number') {
      map[symbol] = price;
    }
  });
  return map;
}

async function sendPush(env, subscription, { title, body }) {
  try {
    const vapid = {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    };
    const message = {
      data: JSON.stringify({ title, body }),
      options: { ttl: 60 },
    };
    const payload = await buildPushPayload(message, subscription, vapid);
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: payload.headers,
      body: payload.body,
    });
    return res.status !== 404 && res.status !== 410;
  } catch (err) {
    console.error('Lỗi khi gửi push:', err);
    return true;
  }
}

const TIMEFRAME_SECS = {
  '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200,
  '4h': 14400, '12h': 43200, '1d': 86400, '3d': 259200,
};

async function fetchSignalKlines(symbol, timeframe) {
  try {
    if (isOandaSymbol(symbol)) {
      return await fetchOandaKlinesTV(symbol, timeframe, 300, null);
    }
    const isFut = symbol.endsWith('_PERP');
    const clean = symbol.replace(/_PERP$/, '');
    // data-api.binance.vision: endpoint dữ liệu công khai, ít bị chặn IP hơn api.binance.com
    const base = isFut
      ? 'https://fapi.binance.com/fapi/v1/klines'
      : 'https://data-api.binance.vision/api/v3/klines';
    const res = await fetch(`${base}?symbol=${clean}&interval=${timeframe}&limit=300`);
    if (!res.ok) {
      console.log(`[signals-cron] Binance lỗi ${res.status} cho ${symbol} (${timeframe})`);
      return null;
    }
    const raw = await res.json();
    return raw.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
    }));
  } catch (err) {
    console.log(`[signals-cron] fetch lỗi ${symbol} (${timeframe}):`, err.message);
    return null;
  }
}

async function checkSignalsAndNotify(env) {
  const allConfig = await readJSON(env.TRACKER_KV, SIGNALS_CONFIG_KEY, {});
  const allState = await readJSON(env.TRACKER_KV, SIGNALS_STATE_KEY, {});
  const subs = await readJSON(env.TRACKER_KV, SUBS_KEY, {});

  if (Object.keys(allConfig).length === 0) {
    return;
  }

  let stateChanged = false;
  let subsChanged = false;

  const candleCache = new Map();
  async function getCandlesCached(symbol, timeframe) {
    const key = `${symbol}_${timeframe}`;
    if (candleCache.has(key)) {
      return candleCache.get(key);
    }
    const promise = fetchSignalKlines(symbol, timeframe);
    candleCache.set(key, promise);
    return promise;
  }

  for (const deviceId of Object.keys(allConfig)) {
    const list = allConfig[deviceId] || [];
    const subscription = subs[deviceId];
    const deviceState = allState[deviceId] || (allState[deviceId] = {});

    for (const cfg of list) {
      const { symbol, timeframe, higherTF, lookbackCandles } = cfg;
      const sKey = signalStateKey(cfg);
      const state = deviceState[sKey] || (deviceState[sKey] = { lastNotifiedTime: null, lastDirection: null });

      const entryCandles = await getCandlesCached(symbol, timeframe);
      const higherCandles = await getCandlesCached(symbol, higherTF);

      if (!entryCandles || entryCandles.length < 2 || !higherCandles || higherCandles.length < lookbackCandles) {
        console.log(
          `[signals-cron] thiếu dữ liệu nến cho ${deviceId}/${symbol} (${symbol}) ` +
          `entry=${timeframe}:${entryCandles ? entryCandles.length : 'null'} ` +
          `higher=${higherTF}:${higherCandles ? higherCandles.length : 'null'} (cần >= ${lookbackCandles}) - bỏ qua.`
        );
        continue;
      }

      const entryClosed = entryCandles.slice(0, -1);
      if (entryClosed.length === 0) continue;
      const lastEntry = entryClosed[entryClosed.length - 1];

      const htfSecs = TIMEFRAME_SECS[higherTF];
      if (!htfSecs) {
        console.log(`[signals-cron] higherTF không hợp lệ: ${higherTF}`);
        continue;
      }
      const htfSeries = higherCandles.map(c => ({ ...c, closeTime: c.time + htfSecs }));

      const closedHtf = htfSeries.filter(c => c.closeTime <= lastEntry.time);
      if (closedHtf.length < lookbackCandles) continue;

      const windowCandles = closedHtf.slice(-lookbackCandles);
      const maxHigh = Math.max(...windowCandles.map(c => c.high));
      const minLow = Math.min(...windowCandles.map(c => c.low));

      let direction = 0;
      if (lastEntry.close > maxHigh) {
        direction = 1;
      } else if (lastEntry.close < minLow) {
        direction = -1;
      }

      console.log(
        `[signals-cron][DEBUG] ${symbol} (${symbol}) entry=${timeframe} higher=${higherTF} ` +
        `lastEntryClose=${lastEntry.close} maxHigh=${maxHigh} minLow=${minLow} direction=${direction} ` +
        `lastDirection=${state.lastDirection} lastEntryTime=${lastEntry.time}`
      );

      if (direction === 0) {
        continue;
      }

      if (state.lastDirection !== direction) {
        state.lastNotifiedTime = lastEntry.time;
        state.lastDirection = direction;
        stateChanged = true;

        const dirLabel = direction === 1 ? 'BUY 🔵' : 'SELL 🔴';
        const tfLabel = timeframe;

        if (subscription) {
          const stillValid = await sendPush(env, subscription, {
            title: `📊 Tín hiệu ${dirLabel} mới!`,
            body: `${symbol} (${tfLabel}) đã xuất hiện tín hiệu ${dirLabel} đột phá`,
          });
          console.log(`[signals-cron] Gửi push tín hiệu cho ${deviceId} - subscription còn hợp lệ: ${stillValid}`);
          if (!stillValid) {
            delete subs[deviceId];
            subsChanged = true;
          }
        }
      }
    }

    const validKeys = new Set(list.map(signalStateKey));
    Object.keys(deviceState).forEach((k) => {
      if (!validKeys.has(k)) {
        delete deviceState[k];
        stateChanged = true;
      }
    });
    if (Object.keys(deviceState).length === 0) {
      delete allState[deviceId];
    }
  }

  Object.keys(allState).forEach((deviceId) => {
    if (!allConfig[deviceId]) {
      delete allState[deviceId];
      stateChanged = true;
    }
  });

  if (stateChanged) {
    await writeJSON(env.TRACKER_KV, SIGNALS_STATE_KEY, allState);
  }
  if (subsChanged) {
    await writeJSON(env.TRACKER_KV, SUBS_KEY, subs);
  }
}

// =====================================================================
// OANDA qua TRADINGVIEW WEBSOCKET (realtime + nhiều lịch sử)
// =====================================================================

const TV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// tv: interval của TradingView | secs: độ dài 1 nến tv | mult: nếu có thì gộp lên (giây)
const TV_INTERVAL_MAP = {
  '1m':  { tv: '1',   secs: 60 },
  '3m':  { tv: '3',   secs: 180 },
  '5m':  { tv: '5',   secs: 300 },
  '15m': { tv: '15',  secs: 900 },
  '30m': { tv: '30',  secs: 1800 },
  '1h':  { tv: '60',  secs: 3600 },
  '2h':  { tv: '120', secs: 7200 },
  '4h':  { tv: '240', secs: 14400 },
  '1d':  { tv: '1D',  secs: 86400 },
  '1w':  { tv: '1W',  secs: 604800 },
  '1M':  { tv: '1M',  secs: 2592000 },
  // khung tổng hợp (gộp từ khung nhỏ hơn)
  '20m': { tv: '5',   secs: 300,   mult: 1200 },
  '45m': { tv: '15',  secs: 900,   mult: 2700 },
  '3h':  { tv: '60',  secs: 3600,  mult: 10800 },
  '6h':  { tv: '60',  secs: 3600,  mult: 21600 },
  '8h':  { tv: '60',  secs: 3600,  mult: 28800 },
  '12h': { tv: '60',  secs: 3600,  mult: 43200 },
  '2d':  { tv: '1D',  secs: 86400, mult: 172800 },
  '3d':  { tv: '1D',  secs: 86400, mult: 259200 },
};

function isOandaSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  return s === 'XAUUSD' || s === 'GOLD' || s.startsWith('OANDA:') || s.endsWith(':OANDA');
}

function toTradingViewSymbol(symbol) {
  const s = String(symbol || 'XAUUSD').trim().toUpperCase();
  if (s.startsWith('OANDA:')) return s;
  if (s.endsWith(':OANDA')) return 'OANDA:' + s.replace(':OANDA', '');
  if (s === 'GOLD') return 'OANDA:XAUUSD';
  return 'OANDA:' + s;
}

function tvRand(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 14);
}
function tvFrame(s) { return `~m~${s.length}~m~${s}`; }
function tvSend(ws, m, p) { ws.send(tvFrame(JSON.stringify({ m, p }))); }
function tvParseFrames(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length && raw.startsWith('~m~', i)) {
    const j = raw.indexOf('~m~', i + 3);
    if (j < 0) break;
    const len = parseInt(raw.slice(i + 3, j), 10);
    out.push(raw.slice(j + 3, j + 3 + len));
    i = j + 3 + len;
  }
  return out;
}

async function tvOpenSocket() {
  const TIMEOUT = Symbol('timeout');
  for (const host of ['data', 'prodata']) {
    try {
      const attempt = (async () => {
        const r = await fetch(`https://${host}.tradingview.com/socket.io/websocket?from=chart%2F&type=chart`, {
          headers: { Upgrade: 'websocket', Origin: 'https://www.tradingview.com', 'User-Agent': TV_UA },
        });
        if (!r.webSocket) return null;
        r.webSocket.accept();
        return r.webSocket;
      })();
      const res = await Promise.race([attempt, sleep(5000).then(() => TIMEOUT)]);
      if (res === TIMEOUT) {
        console.log(`[tv] mở websocket ${host} quá 5s - thử host khác`);
        // Socket mở muộn thì đóng luôn, tránh rò rỉ
        attempt.then((w) => { try { if (w) w.close(); } catch (e) {} }).catch(() => {});
        continue;
      }
      if (res) return res;
    } catch (e) {
      console.log(`[tv] mở websocket ${host} lỗi:`, e.message);
    }
  }
  return null;
}

/**
 * Lấy nến từ TradingView. Có thể tải nhiều hơn 5000 nến bằng cách xin thêm
 * (request_more_data) cho tới khi đủ `limit` nến TRƯỚC cutoffSec (nếu có).
 * Trả về mảng nến tăng dần theo time (giây) hoặc null nếu lỗi.
 */
async function tvFetchBars(tvSymbol, tvInterval, limit, cutoffSec) {
  const ws = await tvOpenSocket();
  if (!ws) return null;

  return new Promise((resolve) => {
    const cs = tvRand('cs');
    const bars = new Map();
    let rounds = 0;
    let lastSize = 0;
    let settled = false;
    const MAX_ROUNDS = 20;

    const toArr = () => [...bars.values()].sort((a, b) => a.time - b.time);
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      resolve(v);
    };
    const timer = setTimeout(() => finish(bars.size ? toArr() : null), 12000);

    const enough = () => {
      const arr = toArr();
      const usable = cutoffSec ? arr.filter((b) => b.time < cutoffSec).length : arr.length;
      return usable >= limit;
    };

    ws.addEventListener('message', (ev) => {
      for (const msg of tvParseFrames(String(ev.data))) {
        if (msg.startsWith('~h~')) { ws.send(tvFrame(msg)); continue; } // heartbeat
        let j;
        try { j = JSON.parse(msg); } catch (e) { continue; }

        if (j.m === 'timescale_update' || j.m === 'du') {
          const s = j.p && j.p[1] && j.p[1].sds_1 && j.p[1].sds_1.s;
          if (Array.isArray(s)) {
            for (const x of s) {
              const v = x.v;
              if (!v || v[1] == null) continue;
              bars.set(v[0], { time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 });
            }
          }
        } else if (j.m === 'series_completed') {
          if (enough() || bars.size === lastSize || rounds >= MAX_ROUNDS) {
            finish(toArr());
          } else {
            lastSize = bars.size;
            rounds++;
            tvSend(ws, 'request_more_data', [cs, 'sds_1', 2000]);
          }
        } else if (j.m === 'symbol_error' || j.m === 'critical_error' || j.m === 'series_error') {
          console.log('[tv] lỗi từ TradingView:', msg.slice(0, 200));
          finish(bars.size ? toArr() : null);
        }
      }
    });
    ws.addEventListener('close', () => finish(bars.size ? toArr() : null));
    ws.addEventListener('error', () => finish(bars.size ? toArr() : null));

    tvSend(ws, 'set_auth_token', ['unauthorized_user_token']);
    tvSend(ws, 'chart_create_session', [cs, '']);
    tvSend(ws, 'resolve_symbol', [cs, 'sds_sym_1', '=' + JSON.stringify({ symbol: tvSymbol, adjustment: 'splits', session: 'regular' })]);
    tvSend(ws, 'create_series', [cs, 'sds_1', 's1', 'sds_sym_1', tvInterval, Math.min(5000, Math.max(50, limit)), '']);
  });
}

function tvAggregate(candles, mult) {
  const groups = new Map();
  for (const c of candles) {
    const bucket = Math.floor(c.time / mult) * mult;
    const g = groups.get(bucket);
    if (!g) {
      groups.set(bucket, { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.volume += c.volume;
    }
  }
  return [...groups.values()].sort((a, b) => a.time - b.time);
}

async function fetchOandaKlinesTV(symbol, interval, limit, endTimeMs) {
  const m = TV_INTERVAL_MAP[interval] || TV_INTERVAL_MAP['15m'];
  const cutoffSec = endTimeMs ? Math.floor(Number(endTimeMs) / 1000) : null;
  const factor = m.mult ? Math.ceil(m.mult / m.secs) : 1;
  const needBase = (limit + 1) * factor;

  let bars = await tvFetchBars(toTradingViewSymbol(symbol), m.tv, needBase, cutoffSec);
  if (!bars || bars.length === 0) return null;

  if (cutoffSec) bars = bars.filter((b) => b.time < cutoffSec);
  if (m.mult) bars = tvAggregate(bars, m.mult);
  return bars.slice(-limit);
}

/** Giá realtime + thống kê ngày qua quote session của TradingView. */
async function fetchOandaTickerTV(symbol) {
  const ws = await tvOpenSocket();
  if (!ws) return null;

  return new Promise((resolve) => {
    const qs = tvRand('qs');
    const tvSymbol = toTradingViewSymbol(symbol);
    const acc = {};
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      resolve(v);
    };
    const build = () => (acc.lp == null ? null : {
      lastPrice: acc.lp,
      changePercent: acc.chp || 0,
      bid: acc.bid ?? acc.lp,
      ask: acc.ask ?? acc.lp,
      high: acc.high_price ?? acc.lp,
      low: acc.low_price ?? acc.lp,
      open: acc.open_price ?? acc.lp,
      volume: acc.volume || 0,
    });
    const timer = setTimeout(() => finish(build()), 6000);

    ws.addEventListener('message', (ev) => {
      for (const msg of tvParseFrames(String(ev.data))) {
        if (msg.startsWith('~h~')) { ws.send(tvFrame(msg)); continue; }
        let j;
        try { j = JSON.parse(msg); } catch (e) { continue; }
        if (j.m === 'qsd' && j.p && j.p[1] && j.p[1].v) {
          Object.assign(acc, j.p[1].v);
          if (acc.lp != null && acc.chp != null) finish(build());
        } else if (j.m === 'quote_completed') {
          finish(build());
        }
      }
    });
    ws.addEventListener('close', () => finish(build()));
    ws.addEventListener('error', () => finish(build()));

    tvSend(ws, 'set_auth_token', ['unauthorized_user_token']);
    tvSend(ws, 'quote_create_session', [qs]);
    tvSend(ws, 'quote_set_fields', [qs, 'lp', 'ch', 'chp', 'bid', 'ask', 'high_price', 'low_price', 'open_price', 'volume']);
    tvSend(ws, 'quote_add_symbols', [qs, tvSymbol]);
  });
}
/**
 * 1 WS TradingView, MỖI khung nền = 1 chart session riêng (tài khoản ẩn danh
 * chỉ cho 1 series / session). Các khung tổng hợp dùng chung series nền
 * (1h -> 1h/3h/6h/12h). Trả { '15m': [...], ..., __quote: {...} } hoặc null.
 */
async function fetchOandaLiveTV(symbol, intervals, n = 3) {
  const ws = await tvOpenSocket();
  if (!ws) return null;
  const tvSymbol = toTradingViewSymbol(symbol);

  // tv interval nền -> { cs, need, bars }
  const plan = new Map();
  intervals.forEach((iv) => {
    const m = TV_INTERVAL_MAP[iv];
    if (!m) return;
    const factor = m.mult ? Math.ceil(m.mult / m.secs) : 1;
    const need = Math.min(5000, m.mult ? (n + 1) * factor : n);
    const p = plan.get(m.tv);
    if (p) p.need = Math.max(p.need, need);
    else plan.set(m.tv, { cs: tvRand('cs'), need, bars: new Map() });
  });
  const byCs = {};
  plan.forEach((p) => { byCs[p.cs] = p; });

  return new Promise((resolve) => {
    const qs = tvRand('qs');
    const acc = {};
    const done = new Set();
    let quoteReady = false;
    let settled = false;

    const build = () => {
      const out = {};
      intervals.forEach((iv) => {
        const m = TV_INTERVAL_MAP[iv];
        const p = m && plan.get(m.tv);
        if (!p || p.bars.size === 0) return;
        let arr = [...p.bars.values()].sort((a, b) => a.time - b.time);
        if (m.mult) arr = tvAggregate(arr, m.mult);
        out[iv] = arr.slice(-n);
      });
      if (acc.lp != null) {
        out.__quote = {
          lastPrice: acc.lp,
          changePercent: acc.chp || 0,
          bid: acc.bid ?? acc.lp,
          ask: acc.ask ?? acc.lp,
          high: acc.high_price ?? acc.lp,
          low: acc.low_price ?? acc.lp,
          open: acc.open_price ?? acc.lp,
        };
      }
      return Object.keys(out).length ? out : null;
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      resolve(build());
    };
    const maybeFinish = () => {
      if (done.size >= plan.size && quoteReady) finish();
    };
    const timer = setTimeout(finish, 9000);

    ws.addEventListener('message', (ev) => {
      for (const msg of tvParseFrames(String(ev.data))) {
        if (msg.startsWith('~h~')) { ws.send(tvFrame(msg)); continue; }
        let j;
        try { j = JSON.parse(msg); } catch (e) { continue; }

        if (j.m === 'timescale_update' || j.m === 'du') {
          const plp = byCs[j.p && j.p[0]];
          const s = plp && j.p[1] && j.p[1].sds_1 && j.p[1].sds_1.s;
          if (!plp || !Array.isArray(s)) continue;
          s.forEach((x) => {
            const v = x.v;
            if (v && v[1] != null) {
              plp.bars.set(v[0], { time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 });
            }
          });
        } else if (j.m === 'series_completed') {
          if (byCs[j.p && j.p[0]]) done.add(j.p[0]);
          maybeFinish();
        } else if (j.m === 'qsd' && j.p && j.p[1] && j.p[1].v) {
          Object.assign(acc, j.p[1].v);
          if (acc.lp != null && acc.chp != null) { quoteReady = true; maybeFinish(); }
        } else if (j.m === 'quote_completed') {
          quoteReady = true;
          maybeFinish();
        } else if (j.m === 'critical_error' || j.m === 'symbol_error' || j.m === 'series_error') {
          console.log('[tv] lỗi từ TradingView (live):', msg.slice(0, 200));
          finish(); // trả phần đã có
        }
      }
    });
    ws.addEventListener('close', finish);
    ws.addEventListener('error', finish);

    tvSend(ws, 'set_auth_token', ['unauthorized_user_token']);
    plan.forEach((p, tvInterval) => {
      tvSend(ws, 'chart_create_session', [p.cs, '']);
      tvSend(ws, 'resolve_symbol', [p.cs, 'sds_sym_1', '=' + JSON.stringify({ symbol: tvSymbol, adjustment: 'splits', session: 'regular' })]);
      tvSend(ws, 'create_series', [p.cs, 'sds_1', 's1', 'sds_sym_1', tvInterval, p.need, '']);
    });
    tvSend(ws, 'quote_create_session', [qs]);
    tvSend(ws, 'quote_set_fields', [qs, 'lp', 'ch', 'chp', 'bid', 'ask', 'high_price', 'low_price', 'open_price']);
    tvSend(ws, 'quote_add_symbols', [qs, tvSymbol]);
  });
}