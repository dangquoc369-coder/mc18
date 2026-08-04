/**
 * tasks.js
 * Mục "Công việc" độc lập với chart: tab chuyển đổi trong sidebar
 * (#sidebarTabChart / #sidebarTabTasks) và 1 trang quản lý riêng
 * (#tasksMainView) thay thế #chartArea + #controlBar khi được chọn -
 * không chiếm chỗ của topbar/controlBar cũ, phù hợp mobile.
 *
 * ĐỒNG BỘ SERVER (ĐỢT FIX NÀY):
 *   Trước đây module này TỰ fetch lên `window.PUSH_API_BASE` (biến không
 *   hề tồn tại) và tự đọc deviceId qua `LoginModule.getDeviceId()` (hàm
 *   cũng không tồn tại) -> mọi request không bao giờ tới đúng Cloudflare
 *   Worker, nên: (1) wrangler tail không thấy gì, (2) KV không lưu, (3)
 *   cron không có gì để kiểm tra -> không bao giờ nhận được Web Push khi
 *   app đã tắt.
 *
 *   Sửa lại: tasks.js KHÔNG tự fetch nữa. Nó chỉ:
 *     - Bắn sự kiện 'tasks:changed' mỗi khi danh sách đổi (thêm/sửa/xoá/
 *       bật-tắt) - push-sync.js (đã có sẵn WORKER_URL + deviceId thật,
 *       dùng chung với AlertsModule) lắng nghe sự kiện này và tự đồng bộ
 *       lên `${WORKER_URL}/api/tasks`.
 *     - Expose `getAllTasks()` để push-sync.js đọc danh sách hiện tại lúc
 *       đồng bộ.
 *     - Expose `mergeFromServer()` để push-sync.js gọi lúc khởi động (SAU
 *       khi GET `/api/tasks` về) - PHẢI gọi hàm này TRƯỚC lần đồng bộ đầu
 *       tiên, nếu không máy mới (local rỗng) sẽ gửi mảng rỗng lên và server
 *       xoá mất toàn bộ task cũ - đúng bug đã được xử lý cho AlertsModule
 *       (xem pullAlertsFromServer trong push-sync.js).
 *
 * Việc báo cục bộ khi app đang mở (NotificationsModule.notify) vẫn giữ
 * nguyên như cũ, chạy song song, không phụ thuộc đồng bộ server.
 */
const TasksModule = (function () {
  const TASKS_STORAGE_KEY = 'dq_tracker_tasks_v1';
  const CHECK_INTERVAL_MS = 30000;
  const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  let tasks = [];
  let currentView = 'chart'; // 'chart' | 'tasks'
  let currentFilter = 'upcoming'; // 'today' | 'upcoming' | 'all'
  let editingId = null;

  // ---------- Lưu trữ local ----------
  function load() {
    try {
      const raw = localStorage.getItem(TASKS_STORAGE_KEY);
      tasks = raw ? JSON.parse(raw) : [];
    } catch (err) { tasks = []; }
  }

  function persist({ sync = true } = {}) {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    renderSidebarMiniList();
    if (currentView === 'tasks') renderMainView();
    // Không tự fetch ở đây nữa - push-sync.js lắng nghe sự kiện này và tự
    // gửi TOÀN BỘ danh sách (qua getAllTasks()) lên đúng Worker + deviceId.
    if (sync) EventBus.emit('tasks:changed', {});
  }

  /**
   * Gộp danh sách task tải VỀ từ server (do push-sync.js gọi sau khi GET
   * /api/tasks?deviceId=...) vào local - chỉ thêm task nào chưa có ở máy
   * này (theo id), không ghi đè task local đang có. Gọi với sync:false để
   * không lập tức gửi ngược lên server (tránh vòng lặp không cần thiết).
   */
  function mergeFromServer(serverTasks) {
    if (!Array.isArray(serverTasks)) return;
    const localIds = new Set(tasks.map((t) => t.id));
    let changed = false;
    serverTasks.forEach((st) => {
      if (!st || !st.id || localIds.has(st.id)) return;
      tasks.push({
        id: st.id,
        title: st.title || '',
        note: st.note || '',
        date: st.date,
        time: st.time,
        repeat: st.repeat || 'none',
        daysOfWeek: st.daysOfWeek || [],
        enabled: !!st.enabled,
        done: false,
        lastNotifiedKey: null,
      });
      changed = true;
    });
    if (changed) persist({ sync: false });
  }

  /** push-sync.js gọi hàm này để lấy danh sách hiện tại và POST lên server. */
  function getAllTasks() {
    return tasks;
  }

  // ---------- Tiện ích ngày giờ ----------
  function uid() { return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateKeyOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function lastDayOfMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }
  function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  function getDueOccurrence(task, now) {
    if (!task.enabled) return null;
    const [hh, mm] = (task.time || '00:00').split(':').map(Number);
    const [ay, am, ad] = (task.date || '1970-01-01').split('-').map(Number);
    const anchor = new Date(ay, (am || 1) - 1, ad || 1);

    if (task.repeat === 'none' || !task.repeat) {
      const due = new Date(ay, (am || 1) - 1, ad || 1, hh, mm, 0, 0);
      return due <= now ? { key: 'once', timestamp: due.getTime() } : null;
    }
    if (task.repeat === 'daily') {
      let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
      if (candidate > now) candidate.setDate(candidate.getDate() - 1);
      if (candidate < anchor) return null;
      return { key: dateKeyOf(candidate), timestamp: candidate.getTime() };
    }
    if (task.repeat === 'weekly') {
      const days = (task.daysOfWeek && task.daysOfWeek.length) ? task.daysOfWeek : [anchor.getDay()];
      for (let back = 0; back < 8; back++) {
        const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hh, mm, 0, 0);
        if (candidate > now) continue;
        if (candidate < anchor) break;
        if (days.includes(candidate.getDay())) return { key: dateKeyOf(candidate), timestamp: candidate.getTime() };
      }
      return null;
    }
    if (task.repeat === 'monthly') {
      for (let back = 0; back < 2; back++) {
        const mIdx = now.getMonth() - back;
        const y = now.getFullYear() + Math.floor(mIdx / 12);
        const m = ((mIdx % 12) + 12) % 12;
        const day = Math.min(ad, lastDayOfMonth(y, m));
        const candidate = new Date(y, m, day, hh, mm, 0, 0);
        if (candidate > now) continue;
        if (candidate < anchor) break;
        return { key: dateKeyOf(candidate), timestamp: candidate.getTime() };
      }
      return null;
    }
    return null;
  }

  /** Occurrence SẮP TỚI gần nhất (để hiển thị trong danh sách, khác với "đã đến hạn" dùng để báo). */
  function getNextOccurrenceDate(task) {
    const [hh, mm] = (task.time || '00:00').split(':').map(Number);
    const [ay, am, ad] = (task.date || '1970-01-01').split('-').map(Number);
    if (task.repeat === 'none' || !task.repeat) {
      return new Date(ay, (am || 1) - 1, ad || 1, hh, mm, 0, 0);
    }
    const now = new Date();
    if (task.repeat === 'daily') {
      const c = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
      if (c < now) c.setDate(c.getDate() + 1);
      return c;
    }
    if (task.repeat === 'weekly') {
      const days = (task.daysOfWeek && task.daysOfWeek.length) ? task.daysOfWeek : [new Date(ay, am - 1, ad).getDay()];
      for (let add = 0; add < 8; add++) {
        const c = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, hh, mm, 0, 0);
        if (c >= now && days.includes(c.getDay())) return c;
      }
    }
    if (task.repeat === 'monthly') {
      for (let add = 0; add < 2; add++) {
        const mIdx = now.getMonth() + add;
        const y = now.getFullYear() + Math.floor(mIdx / 12);
        const m = ((mIdx % 12) + 12) % 12;
        const day = Math.min(ad, lastDayOfMonth(y, m));
        const c = new Date(y, m, day, hh, mm, 0, 0);
        if (c >= now) return c;
      }
    }
    return new Date(ay, (am || 1) - 1, ad || 1, hh, mm, 0, 0);
  }

  function checkDueTasks() {
    const now = new Date();
    let changed = false;
    tasks.forEach((task) => {
      const occ = getDueOccurrence(task, now);
      if (!occ || task.lastNotifiedKey === occ.key) return;
      NotificationsModule.notify('📝 Nhắc việc', task.title + (task.note ? ` - ${task.note}` : ''));
      task.lastNotifiedKey = occ.key;
      if (task.repeat === 'none' || !task.repeat) { task.enabled = false; task.done = true; }
      changed = true;
    });
    if (changed) persist();
  }

  // ---------- CRUD ----------
  function upsertTask(input) {
    if (!input.title || !input.date || !input.time) return null;
    if (input.id) {
      const t = tasks.find((x) => x.id === input.id);
      if (!t) return null;
      Object.assign(t, {
        title: input.title.trim(), note: (input.note || '').trim(), date: input.date, time: input.time,
        repeat: input.repeat || 'none', daysOfWeek: input.daysOfWeek || [],
      });
      t.lastNotifiedKey = null; t.done = false; t.enabled = true;
      persist();
      return t;
    }
    const task = {
      id: uid(), title: input.title.trim(), note: (input.note || '').trim(),
      date: input.date, time: input.time, repeat: input.repeat || 'none',
      daysOfWeek: input.daysOfWeek || [], enabled: true, done: false, lastNotifiedKey: null,
    };
    tasks.push(task);
    persist();
    return task;
  }

  function removeTask(id) { tasks = tasks.filter((t) => t.id !== id); persist(); }
  function toggleDone(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.enabled = !t.done;
    if (!t.done) t.lastNotifiedKey = null;
    persist();
  }

  function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
  function repeatLabel(t) {
    if (t.repeat === 'daily') return 'Hằng ngày';
    if (t.repeat === 'weekly') {
      const days = t.daysOfWeek || [];
      return days.length ? `Hằng tuần (${days.map((d) => WEEKDAY_LABELS[d]).join(', ')})` : 'Hằng tuần';
    }
    if (t.repeat === 'monthly') return 'Hằng tháng';
    return null;
  }

  // ---------- Sidebar: danh sách rút gọn ----------
  function renderSidebarMiniList() {
    const listEl = document.getElementById('sidebarTasksMiniList');
    if (!listEl) return;
    const now = new Date();

    const withNext = tasks
      .filter((t) => t.enabled || t.done)
      .map((t) => ({ t, next: t.done ? null : getNextOccurrenceDate(t) }))
      .sort((a, b) => {
        if (a.t.done !== b.t.done) return a.t.done ? 1 : -1;
        return (a.next?.getTime() || 0) - (b.next?.getTime() || 0);
      })
      .slice(0, 20);

    if (withNext.length === 0) {
      listEl.innerHTML = `<div class="tasks-mini-empty">Chưa có nhắc việc nào.</div>
        <button type="button" class="tasks-mini-add-btn" id="miniAddTaskBtn">+ Thêm nhắc việc</button>`;
    } else {
      listEl.innerHTML = withNext.map(({ t, next }) => {
        const overdue = next && next < now && !t.done;
        const timeLabel = t.done ? 'Xong' : (next ? `${pad2(next.getHours())}:${pad2(next.getMinutes())} · ${pad2(next.getDate())}/${pad2(next.getMonth() + 1)}` : '');
        return `
        <div class="tasks-mini-item${overdue ? ' overdue' : ''}${t.done ? ' done' : ''}" data-task-id="${t.id}">
          <span class="tasks-mini-dot"></span>
          <span class="tasks-mini-title">${escapeHtml(t.title)}</span>
          <span class="tasks-mini-time">${timeLabel}</span>
          <button type="button" class="alert-remove-btn tasks-mini-remove-btn" data-remove-id="${t.id}" title="Xoá công việc này">✕</button>
        </div>`;
      }).join('') + `<button type="button" class="tasks-mini-add-btn" id="miniAddTaskBtn">+ Thêm nhắc việc</button>`;
    }

    // Bấm vào phần thân của mục -> mở modal sửa. Bấm nút ✕ -> xoá NGAY tại
    // đây (có xác nhận), không mở modal - dùng stopPropagation để 2 vùng
    // bấm không giẫm lên nhau.
    listEl.querySelectorAll('.tasks-mini-item').forEach((el) => {
      el.addEventListener('click', () => {
        switchView('tasks');
        openTaskModal(el.dataset.taskId);
      });
    });
    listEl.querySelectorAll('.tasks-mini-remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTask(btn.dataset.removeId);
      });
    });
    const addBtn = document.getElementById('miniAddTaskBtn');
    if (addBtn) addBtn.addEventListener('click', () => { switchView('tasks'); openTaskModal(); });
  }

  // ---------- Main view: trang công việc chuyên nghiệp ----------
  function getFilteredGroupedTasks() {
    const now = new Date();
    const withNext = tasks.map((t) => ({ t, next: t.done ? null : getNextOccurrenceDate(t) }));

    let filtered = withNext;
    if (currentFilter === 'today') {
      filtered = withNext.filter(({ t, next }) => !t.done && next && isSameDay(next, now));
    } else if (currentFilter === 'upcoming') {
      filtered = withNext.filter(({ t }) => t.enabled && !t.done);
    } // 'all' giữ nguyên toàn bộ kể cả đã xong

    filtered.sort((a, b) => {
      if (a.t.done !== b.t.done) return a.t.done ? 1 : -1;
      return (a.next?.getTime() || 0) - (b.next?.getTime() || 0);
    });

    const groups = new Map();
    filtered.forEach(({ t, next }) => {
      const label = t.done ? 'Đã hoàn thành' : (next ? dateKeyOf(next) : 'Khác');
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ t, next });
    });
    return groups;
  }

  function formatGroupLabel(key, now) {
    if (key === 'Đã hoàn thành' || key === 'Khác') return key;
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (isSameDay(date, now)) return 'Hôm nay';
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    if (isSameDay(date, tomorrow)) return 'Ngày mai';
    return `${pad2(d)}/${pad2(m)}/${y}`;
  }

  function renderMainView() {
    const container = document.getElementById('tasksMainView');
    if (!container) return;
    const now = new Date();
    const groups = getFilteredGroupedTasks();

    let bodyHtml = '';
    if (groups.size === 0) {
      bodyHtml = `<div class="tv-empty-state">Không có công việc nào ở mục này.<br>Bấm "+ Thêm việc" để tạo lời nhắc mới.</div>`;
    } else {
      for (const [key, items] of groups.entries()) {
        bodyHtml += `<div class="tv-group-title">${formatGroupLabel(key, now)}</div>`;
        items.forEach(({ t, next }) => {
          const overdue = next && next < now && !t.done;
          const timeStr = next ? `${pad2(next.getHours())}:${pad2(next.getMinutes())}` : '';
          const repeat = repeatLabel(t);
          bodyHtml += `
          <div class="tv-card${overdue ? ' overdue' : ''}${t.done ? ' done' : ''}" data-task-id="${t.id}">
            <input type="checkbox" class="tv-card-check" ${t.done ? 'checked' : ''} data-action="toggle">
            <div class="tv-card-body" data-action="edit">
              <div class="tv-card-title">${escapeHtml(t.title)}</div>
              ${t.note ? `<div class="tv-card-note">${escapeHtml(t.note)}</div>` : ''}
              <div class="tv-card-meta">
                ${timeStr ? `<span class="tv-card-time">🕒 ${timeStr}</span>` : ''}
                ${repeat ? `<span class="tv-card-repeat-tag">🔁 ${repeat}</span>` : ''}
              </div>
            </div>
            <button type="button" class="tv-card-remove" data-action="remove">✕</button>
          </div>`;
        });
      }
    }

    container.innerHTML = `
      <div class="tv-header">
        <div>
          <div class="tv-title">📝 Công việc &amp; lời nhắc</div>
          <div class="tv-subtitle">${tasks.filter((t) => t.enabled && !t.done).length} việc đang chờ nhắc</div>
        </div>
        <button type="button" class="tv-add-btn" id="tvAddBtn">+ Thêm việc</button>
      </div>
      <div class="tv-filters">
        <button type="button" class="tv-filter-btn${currentFilter === 'today' ? ' active' : ''}" data-filter="today">Hôm nay</button>
        <button type="button" class="tv-filter-btn${currentFilter === 'upcoming' ? ' active' : ''}" data-filter="upcoming">Sắp tới</button>
        <button type="button" class="tv-filter-btn${currentFilter === 'all' ? ' active' : ''}" data-filter="all">Tất cả</button>
      </div>
      <div id="tvBody">${bodyHtml}</div>
    `;

    container.querySelector('#tvAddBtn').addEventListener('click', () => openTaskModal());
    container.querySelectorAll('.tv-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => { currentFilter = btn.dataset.filter; renderMainView(); });
    });
    container.querySelectorAll('.tv-card').forEach((card) => {
      const id = card.dataset.taskId;
      card.querySelector('[data-action="toggle"]').addEventListener('click', (e) => { e.stopPropagation(); toggleDone(id); });
      card.querySelector('[data-action="remove"]').addEventListener('click', (e) => {
        e.stopPropagation();
        removeTask(id);
      });
      card.querySelector('[data-action="edit"]').addEventListener('click', () => openTaskModal(id));
    });
  }

  // ---------- Modal thêm/sửa ----------
  function openTaskModal(taskId) {
    editingId = taskId || null;
    const existing = taskId ? tasks.find((t) => t.id === taskId) : null;

    const backdrop = document.createElement('div');
    backdrop.className = 'tv-modal-backdrop';
    backdrop.innerHTML = `
      <div class="tv-modal">
        <div class="tv-modal-title">${existing ? 'Sửa việc' : 'Thêm việc mới'}</div>
        <div>
          <label>Tên công việc</label>
          <input type="text" id="tmTitle" value="${existing ? escapeHtml(existing.title) : ''}" placeholder="Ví dụ: Họp với khách hàng" required>
        </div>
        <div>
          <label>Ghi chú (tuỳ chọn)</label>
          <textarea id="tmNote" placeholder="Chi tiết thêm...">${existing ? escapeHtml(existing.note || '') : ''}</textarea>
        </div>
        <div class="tv-modal-row">
          <div><label>Ngày</label><input type="date" id="tmDate" value="${existing ? existing.date : ''}" required></div>
          <div><label>Giờ</label><input type="time" id="tmTime" value="${existing ? existing.time : ''}" required></div>
        </div>
        <div>
          <label>Lặp lại</label>
          <select id="tmRepeat">
            <option value="none">Không lặp lại</option>
            <option value="daily">Hằng ngày</option>
            <option value="weekly">Hằng tuần</option>
            <option value="monthly">Hằng tháng</option>
          </select>
        </div>
        <div id="tmWeekdaysRow" class="dt-swatch-row" style="display:none;">
          ${WEEKDAY_LABELS.map((label, i) => `<button type="button" class="dt-swatch-btn tm-weekday-btn" data-day="${i}">${label}</button>`).join('')}
        </div>
        <div class="tv-modal-actions">
          ${existing ? `<button type="button" class="tv-modal-cancel" id="tmDelete" style="color:var(--red);margin-right:auto;">🗑 Xoá</button>` : ''}
          <button type="button" class="tv-modal-cancel" id="tmCancel">Huỷ</button>
          <button type="button" class="tv-modal-save" id="tmSave">Lưu</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const repeatSelect = backdrop.querySelector('#tmRepeat');
    const weekdaysRow = backdrop.querySelector('#tmWeekdaysRow');
    const selectedDays = new Set(existing?.daysOfWeek || []);

    if (existing) {
      repeatSelect.value = existing.repeat || 'none';
      if (existing.repeat === 'weekly') weekdaysRow.style.display = 'flex';
    }
    weekdaysRow.querySelectorAll('.tm-weekday-btn').forEach((btn) => {
      const day = Number(btn.dataset.day);
      if (selectedDays.has(day)) btn.classList.add('active');
      btn.addEventListener('click', () => {
        if (selectedDays.has(day)) { selectedDays.delete(day); btn.classList.remove('active'); }
        else { selectedDays.add(day); btn.classList.add('active'); }
      });
    });
    repeatSelect.addEventListener('change', () => {
      weekdaysRow.style.display = repeatSelect.value === 'weekly' ? 'flex' : 'none';
    });

    function close() { backdrop.remove(); }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#tmCancel').addEventListener('click', close);

    const deleteBtn = backdrop.querySelector('#tmDelete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        removeTask(existing.id);
        close();
      });
    }
    backdrop.querySelector('#tmSave').addEventListener('click', () => {
      const title = backdrop.querySelector('#tmTitle').value.trim();
      const date = backdrop.querySelector('#tmDate').value;
      const time = backdrop.querySelector('#tmTime').value;
      if (!title || !date || !time) return;
      upsertTask({
        id: editingId, title, note: backdrop.querySelector('#tmNote').value,
        date, time, repeat: repeatSelect.value, daysOfWeek: [...selectedDays].sort(),
      });
      close();
    });
  }

  // ---------- Chuyển đổi tab sidebar + main view ----------
  function switchView(view) {
    currentView = view;
    const tabChart = document.getElementById('sidebarTabChart');
    const tabTasks = document.getElementById('sidebarTabTasks');
    const tabAnalytics = document.getElementById('sidebarTabAnalytics');

    const chartSection = document.getElementById('sidebarChartSection');
    const tasksSection = document.getElementById('sidebarTasksSection');
    const analyticsSection = document.getElementById('sidebarAnalyticsSection');

    const controlBar = document.getElementById('controlBar');
    const chartArea = document.getElementById('chartArea');
    const tasksMainView = document.getElementById('tasksMainView');
    const analyticsMainView = document.getElementById('analyticsMainView');

    tabChart?.classList.toggle('active', view === 'chart');
    tabTasks?.classList.toggle('active', view === 'tasks');
    tabAnalytics?.classList.toggle('active', view === 'analytics');

    chartSection?.classList.toggle('hidden', view !== 'chart');
    tasksSection?.classList.toggle('hidden', view !== 'tasks');
    analyticsSection?.classList.toggle('hidden', view !== 'analytics');

    if (controlBar) controlBar.style.display = view === 'chart' ? '' : 'none';
    if (chartArea) chartArea.style.display = view === 'chart' ? '' : 'none';
    if (tasksMainView) tasksMainView.classList.toggle('hidden', view !== 'tasks');
    if (analyticsMainView) analyticsMainView.classList.toggle('hidden', view !== 'analytics');

    if (view === 'tasks') {
      renderMainView();
    } else if (view === 'analytics') {
      if (typeof AnalyticsModule !== 'undefined') AnalyticsModule.switchView('analytics');
    } else {
      requestAnimationFrame(() => {
        if (typeof EventBus !== 'undefined' && typeof Store !== 'undefined') {
          EventBus.emit('layout:changed', {
            layout: Store.getState().layout,
            visiblePaneIds: Store.getVisiblePaneIds(),
          });
        }
      });
    }
  }

  function bindTabs() {
    document.getElementById('sidebarTabChart')?.addEventListener('click', () => switchView('chart'));
    document.getElementById('sidebarTabTasks')?.addEventListener('click', () => switchView('tasks'));
  }

  function init() {
    load();
    bindTabs();
    renderSidebarMiniList();
    setInterval(checkDueTasks, CHECK_INTERVAL_MS);
    checkDueTasks(); // bắt occurrence bị lỡ ngay lúc mở lại app
  }

  return { init, upsertTask, removeTask, toggleDone, getAllTasks, mergeFromServer };
})();