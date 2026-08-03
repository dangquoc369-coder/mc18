/**
 * tasks.js
 * Mục "Công việc" độc lập với chart: tab chuyển đổi trong sidebar
 * (#sidebarTabChart / #sidebarTabTasks) và 1 trang quản lý riêng
 * (#tasksMainView) thay thế #chartArea + #controlBar khi được chọn -
 * không chiếm chỗ của topbar/controlBar cũ, phù hợp mobile.
 *
 * Đồng bộ lên server (Cloudflare Worker /api/tasks) để cron gửi Web Push
 * thật ngay cả khi app đã đóng hẳn, dùng chung deviceId với AlertsModule.
 */
const TasksModule = (function () {
  const TASKS_STORAGE_KEY = 'dq_tracker_tasks_v1';
  const CHECK_INTERVAL_MS = 30000;
  const API_BASE = (window.PUSH_API_BASE || '');
  const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  let tasks = [];
  let currentView = 'chart'; // 'chart' | 'tasks'
  let currentFilter = 'upcoming'; // 'today' | 'upcoming' | 'all'
  let editingId = null;

  // ---------- Lưu trữ ----------
  function getDeviceId() {
    try {
      if (window.LoginModule && typeof LoginModule.getDeviceId === 'function') {
        return LoginModule.getDeviceId();
      }
    } catch (err) { /* ignore */ }
    return localStorage.getItem('dq_tracker_device_id') || null;
  }

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
    if (sync) syncToServer();
  }

  async function syncToServer() {
    const deviceId = getDeviceId();
    if (!deviceId || !API_BASE) return;
    try {
      await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          tasks: tasks.map((t) => ({
            id: t.id, title: t.title, note: t.note || '', date: t.date, time: t.time,
            repeat: t.repeat, daysOfWeek: t.daysOfWeek || [], enabled: !!t.enabled,
          })),
        }),
      });
    } catch (err) {
      console.error('Lỗi đồng bộ công việc lên server:', err);
    }
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
        </div>`;
      }).join('') + `<button type="button" class="tasks-mini-add-btn" id="miniAddTaskBtn">+ Thêm nhắc việc</button>`;
    }

    listEl.querySelectorAll('.tasks-mini-item').forEach((el) => {
      el.addEventListener('click', () => {
        switchView('tasks');
        openTaskModal(el.dataset.taskId);
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
      card.querySelector('[data-action="remove"]').addEventListener('click', (e) => { e.stopPropagation(); removeTask(id); });
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
    const chartSection = document.getElementById('sidebarChartSection');
    const tasksSection = document.getElementById('sidebarTasksSection');
    const controlBar = document.getElementById('controlBar');
    const chartArea = document.getElementById('chartArea');
    const tasksMainView = document.getElementById('tasksMainView');

    const isTasks = view === 'tasks';
    tabChart?.classList.toggle('active', !isTasks);
    tabTasks?.classList.toggle('active', isTasks);
    chartSection?.classList.toggle('hidden', isTasks);
    tasksSection?.classList.toggle('hidden', !isTasks);
    if (controlBar) controlBar.style.display = isTasks ? 'none' : '';
    if (chartArea) chartArea.style.display = isTasks ? 'none' : '';
    if (tasksMainView) tasksMainView.classList.toggle('hidden', !isTasks);

    if (isTasks) renderMainView();
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

  return { init, upsertTask, removeTask, toggleDone };
})();