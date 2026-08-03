/**
 * tasks.js
 * Quản lý công việc hằng ngày (to-do) kèm lời nhắc: đặt ngày giờ, lặp lại
 * (không lặp / hằng ngày / hằng tuần / hằng tháng). Báo cục bộ qua
 * NotificationsModule khi app đang chạy, đồng thời đồng bộ lên server để
 * cron của Cloudflare Worker gửi Web Push THẬT ngay cả khi app đã đóng hẳn
 * (dùng lại đúng cơ chế deviceId như AlertsModule - xem push-sync.js/login.js).
 */
const TasksModule = (function () {
  const TASKS_STORAGE_KEY = 'dq_tracker_tasks_v1';
  const CHECK_INTERVAL_MS = 30000;
  // Đổi cho khớp domain Worker đang dùng cho /api/alerts, /api/signals...
  const API_BASE = (window.PUSH_API_BASE || '');

  let tasks = [];
  let panelEl = null;

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
    } catch (err) {
      tasks = [];
    }
  }

  function persist({ sync = true } = {}) {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    renderList();
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

  function uid() {
    return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateKeyOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function lastDayOfMonth(year, monthIndex) { return new Date(year, monthIndex + 1, 0).getDate(); }

  /**
   * Trả về occurrence GẦN NHẤT (<= now) mà chưa được báo (task.lastNotifiedKey
   * khác dateKey occurrence đó). Nhờ vậy nếu 30s không chạy đúng lúc (máy
   * ngủ, tab nền lâu) thì lần check kế tiếp vẫn bắt được, không bỏ sót.
   */
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

  function checkDueTasks() {
    const now = new Date();
    let changed = false;
    tasks.forEach((task) => {
      const occ = getDueOccurrence(task, now);
      if (!occ || task.lastNotifiedKey === occ.key) return;

      NotificationsModule.notify('📝 Nhắc việc', task.title + (task.note ? ` - ${task.note}` : ''));
      task.lastNotifiedKey = occ.key;
      if (task.repeat === 'none' || !task.repeat) {
        task.enabled = false;
        task.done = true;
      }
      changed = true;
    });
    if (changed) persist();
  }

  function addTask(input) {
    const task = {
      id: uid(), title: (input.title || '').trim(), note: (input.note || '').trim(),
      date: input.date, time: input.time, repeat: input.repeat || 'none',
      daysOfWeek: input.daysOfWeek || [], enabled: true, done: false, lastNotifiedKey: null,
    };
    if (!task.title || !task.date || !task.time) return null;
    tasks.push(task);
    persist();
    return task;
  }

  function removeTask(id) { tasks = tasks.filter((t) => t.id !== id); persist(); }

  function toggleEnabled(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    t.enabled = !t.enabled;
    if (t.enabled) t.lastNotifiedKey = null;
    persist();
  }

  const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  function repeatLabel(t) {
    if (t.repeat === 'daily') return 'Hằng ngày';
    if (t.repeat === 'weekly') {
      const days = t.daysOfWeek || [];
      return days.length ? `Hằng tuần (${days.map((d) => WEEKDAY_LABELS[d]).join(', ')})` : 'Hằng tuần';
    }
    if (t.repeat === 'monthly') return 'Hằng tháng';
    return 'Một lần';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderList() {
    if (!panelEl) return;
    const listEl = panelEl.querySelector('#tasksListBody');
    if (!listEl) return;

    if (tasks.length === 0) {
      listEl.innerHTML = `<div class="ms-muted">Chưa có công việc nào.</div>`;
      return;
    }
    const sorted = [...tasks].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    listEl.innerHTML = sorted.map((t) => `
      <div class="alert-item${t.done ? ' alert-triggered' : ''}" data-task-id="${t.id}">
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
          <span class="ms-bold" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.title)}</span>
          <span class="ms-muted" style="font-size:11px;">${t.date} ${t.time} · ${repeatLabel(t)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <input type="checkbox" class="task-enable-toggle" ${t.enabled ? 'checked' : ''} ${t.done ? 'disabled' : ''} style="accent-color:var(--accent-blue);cursor:pointer;">
          <button type="button" class="alert-remove-btn task-remove-btn">Xoá</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.task-enable-toggle').forEach((el) => {
      el.addEventListener('change', (e) => toggleEnabled(e.target.closest('[data-task-id]').dataset.taskId));
    });
    listEl.querySelectorAll('.task-remove-btn').forEach((el) => {
      el.addEventListener('click', (e) => removeTask(e.target.closest('[data-task-id]').dataset.taskId));
    });
  }

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.id = 'tasksPanel';
    panelEl.className = 'ms-panel';
    panelEl.innerHTML = `
      <div class="ms-header">
        <span>📝 Công việc &amp; lời nhắc</span>
        <span class="ms-close" id="tasksPanelClose">✕</span>
      </div>
      <form id="taskAddForm" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
        <input type="text" id="taskTitleInput" placeholder="Tên công việc..." required
          style="background:var(--bg-main);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:6px 8px;color:var(--text-primary);font-size:12px;">
        <div style="display:flex;gap:6px;">
          <input type="date" id="taskDateInput" required
            style="flex:1;background:var(--bg-main);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:6px 8px;color:var(--text-primary);font-size:12px;">
          <input type="time" id="taskTimeInput" required
            style="width:90px;background:var(--bg-main);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:6px 8px;color:var(--text-primary);font-size:12px;">
        </div>
        <select id="taskRepeatInput"
          style="background:var(--bg-main);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:6px 8px;color:var(--text-primary);font-size:12px;">
          <option value="none">Không lặp lại</option>
          <option value="daily">Lặp hằng ngày</option>
          <option value="weekly">Lặp hằng tuần</option>
          <option value="monthly">Lặp hằng tháng</option>
        </select>
        <div id="taskWeekdaysRow" class="dt-swatch-row" style="display:none;">
          ${WEEKDAY_LABELS.map((label, i) => `<button type="button" class="dt-swatch-btn task-weekday-btn" data-day="${i}">${label}</button>`).join('')}
        </div>
        <button type="submit" style="border:none;border-radius:var(--radius-sm);padding:7px;font-size:12px;font-weight:600;cursor:pointer;background:var(--accent-blue);color:var(--on-accent);">
          + Thêm nhắc việc
        </button>
      </form>
      <div class="ms-divider"></div>
      <div id="tasksListBody"></div>
    `;
    document.body.appendChild(panelEl);

    panelEl.querySelector('#tasksPanelClose').addEventListener('click', closePanel);

    const repeatSelect = panelEl.querySelector('#taskRepeatInput');
    const weekdaysRow = panelEl.querySelector('#taskWeekdaysRow');
    const selectedDays = new Set();

    repeatSelect.addEventListener('change', () => {
      weekdaysRow.style.display = repeatSelect.value === 'weekly' ? 'flex' : 'none';
    });

    weekdaysRow.querySelectorAll('.task-weekday-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const day = Number(btn.dataset.day);
        if (selectedDays.has(day)) { selectedDays.delete(day); btn.classList.remove('active'); }
        else { selectedDays.add(day); btn.classList.add('active'); }
      });
    });

    panelEl.querySelector('#taskAddForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const created = addTask({
        title: panelEl.querySelector('#taskTitleInput').value,
        date: panelEl.querySelector('#taskDateInput').value,
        time: panelEl.querySelector('#taskTimeInput').value,
        repeat: repeatSelect.value,
        daysOfWeek: [...selectedDays].sort(),
      });
      if (created) {
        e.target.reset();
        selectedDays.clear();
        weekdaysRow.querySelectorAll('.task-weekday-btn').forEach((b) => b.classList.remove('active'));
        weekdaysRow.style.display = 'none';
      }
    });

    renderList();
  }

  function openPanel() { if (!panelEl) buildPanel(); panelEl.classList.add('open'); }
  function closePanel() { if (panelEl) panelEl.classList.remove('open'); }
  function togglePanel() { (panelEl && panelEl.classList.contains('open')) ? closePanel() : openPanel(); }

  function injectTopbarButton() {
    const container = document.querySelector('#topbar .topbar-right');
    if (!container) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'tasksBtn';
    btn.className = 'topbar-btn';
    btn.innerHTML = `📝 <span class="btn-text">Công việc</span>`;
    btn.addEventListener('click', togglePanel);
    container.appendChild(btn);
  }

  function init() {
    load();
    injectTopbarButton();
    setInterval(checkDueTasks, CHECK_INTERVAL_MS);
    checkDueTasks(); // bắt occurrence bị lỡ ngay lúc mở lại app
  }

  return { init, addTask, removeTask, toggleEnabled };
})();