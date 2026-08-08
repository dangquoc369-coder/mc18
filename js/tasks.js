/**
 * tasks.js
 * Quản lý "Công việc & Lời nhắc Trading" chuyên nghiệp
 * Hỗ trợ phân loại chuyên sâu cho Trader (Kế hoạch, Quản trị rủi ro, Nhật ký, VPS/Hệ thống),
 * độ ưu tiên (Cao, Trung bình, Thấp), gắn Symbol cặp giao dịch, Mẫu gợi ý nhanh (Trading Presets),
 * Bảng thống kê tiến độ (Dashboard KPI Cards) và bộ lọc đa năng.
 *
 * FIX (đợt fix mới nhất - TASK ĐÃ XOÁ CỨ QUAY LẠI):
 *   Nguyên nhân: mergeFromServer() trước đây chỉ biết "thêm task nếu local
 *   chưa có id đó" - nó KHÔNG phân biệt được giữa "id này chưa từng tồn tại"
 *   và "id này đã từng tồn tại nhưng người dùng đã chủ động xoá". Vì vậy nếu
 *   1 lượt GET /api/tasks chạy và trả về dữ liệu CŨ (ví dụ: do POST xoá lên
 *   server bị debounce/mất mạng/đóng tab chưa kịp gửi xong, hoặc do
 *   pullTasksFromServer() chạy lại lúc load trang), task vừa xoá sẽ bị
 *   mergeFromServer() nhét lại vào local -> cảm giác "xoá không được".
 *
 *   Giải pháp: thêm cơ chế "tombstone" - mỗi khi xoá 1 task, lưu lại id đó
 *   (kèm thời điểm xoá) vào 1 key localStorage riêng
 *   (DELETED_STORAGE_KEY). mergeFromServer() sẽ BỎ QUA mọi id nằm trong
 *   danh sách tombstone này, dù server có trả về hay không. Tombstone được
 *   tự động dọn sau DELETED_TTL_MS (90 ngày) để không phình vô hạn.
 *
 *   Lưu ý: đây là fix ở phía CLIENT (đủ cho trường hợp dùng 1 thiết bị/1
 *   tab). Nếu dùng nhiều thiết bị/nhiều tab đồng thời, thiết bị/tab KHÁC
 *   (chưa biết task đã bị xoá) vẫn có thể POST đè nguyên danh sách cũ của
 *   nó lên server và làm task "sống lại" trên server thật sự - trường hợp
 *   đó cần sửa thêm ở worker (endpoint DELETE riêng + đồng bộ tombstone
 *   qua server), không nằm trong phạm vi file này.
 */
const TasksModule = (function () {
  const TASKS_STORAGE_KEY = 'dq_tracker_tasks_v1';
  const DELETED_STORAGE_KEY = 'dq_tracker_deleted_tasks_v1'; // { [id]: deletedAtTimestamp }
  const DELETED_TTL_MS = 90 * 24 * 60 * 60 * 1000; // tự dọn tombstone sau 90 ngày
  const CHECK_INTERVAL_MS = 30000;
  const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  let deletedIds = {};

  function getIconSvg(name, extraClass = '') {
    if (typeof Icons !== 'undefined' && Icons[name]) {
      const cls = extraClass ? `icon-svg ${extraClass}` : 'icon-svg';
      return Icons[name].replace('<svg ', `<svg class="${cls}" `);
    }
    return '';
  }

  // Categories chuyên biệt cho Trading
  const CATEGORIES = {
    plan: { label: 'Trading Plan', iconKey: 'plan', tagClass: 'tv-cat-plan' },
    risk: { label: 'Quản Trị Rủi Ro', iconKey: 'risk', tagClass: 'tv-cat-risk' },
    journal: { label: 'Nhật Ký & Review', iconKey: 'journal', tagClass: 'tv-cat-journal' },
    system: { label: 'VPS & Hệ Thống', iconKey: 'system', tagClass: 'tv-cat-system' },
    other: { label: 'Cá Nhân & Khác', iconKey: 'other', tagClass: 'tv-cat-other' },
  };

  // Priorities
  const PRIORITIES = {
    high: { label: 'Ưu tiên Cao', shortLabel: 'Cao', iconKey: 'prioHigh', color: 'var(--red)', tagClass: 'tv-prio-high' },
    medium: { label: 'Trung bình', shortLabel: 'TB', iconKey: 'prioMedium', color: '#f59e0b', tagClass: 'tv-prio-medium' },
    low: { label: 'Thấp', shortLabel: 'Thấp', iconKey: 'prioLow', color: 'var(--accent-blue)', tagClass: 'tv-prio-low' },
  };

  // Trading Presets (Mẫu lời nhắc sẵn có cho Trader)
  const TRADING_PRESETS = [
    {
      iconKey: 'calendar',
      title: 'Review Lịch Kinh Tế (FOMC/CPI/NFP)',
      category: 'plan',
      priority: 'high',
      time: '19:30',
      note: 'Xem biến động tin tức quan trọng trước phiên Mỹ',
    },
    {
      iconKey: 'risk',
      title: 'Kiểm Tra Risk & Cài Stoploss Lệnh Swing',
      category: 'risk',
      priority: 'high',
      time: '15:00',
      note: 'Rà soát lại tỷ lệ Risk/Reward, Volume Lot và Margin',
    },
    {
      iconKey: 'journal',
      title: 'Tổng Kết Nhật Ký & Lệnh Trading Cuối Ngày',
      category: 'journal',
      priority: 'medium',
      time: '21:00',
      note: 'Đánh giá tỷ lệ Win/Loss, lý do vào lệnh và tâm lý giao dịch',
    },
    {
      iconKey: 'system',
      title: 'Kiểm Tra VPS & Trạng Thái Kết Nối EA MQL5',
      category: 'system',
      priority: 'medium',
      time: '08:00',
      note: 'Đảm bảo terminal MT5 và Webhook đồng bộ hoạt động bình thường',
    },
    {
      iconKey: 'target',
      title: 'Lên Plan Trading & Vùng Key Level Tuần Mới',
      category: 'plan',
      priority: 'medium',
      time: '09:00',
      note: 'Phân tích các khung D1/W1 cho XAUUSD & Cặp tiền chính',
    },
  ];
  let currentView = 'chart'; // 'chart' | 'tasks'
  let currentFilter = 'today'; // 'today' | 'upcoming' | 'overdue' | 'done' | 'all'
  let currentCategory = 'all'; // 'all' | 'plan' | 'risk' | 'journal' | 'system' | 'other'
  let currentPriority = 'all'; // 'all' | 'high' | 'medium' | 'low'
  let searchQuery = '';
  let editingId = null;

  // ---------- Storage ----------
  function load() {
    try {
      const raw = localStorage.getItem(TASKS_STORAGE_KEY);
      tasks = raw ? JSON.parse(raw) : [];
      // Ensure defaults for older items
      tasks.forEach((t) => {
        if (!t.category) t.category = 'plan';
        if (!t.priority) t.priority = 'medium';
        if (t.symbol === undefined) t.symbol = '';
      });
    } catch (err) {
      tasks = [];
    }
    loadDeletedIds();
  }

  // ---------- Tombstone (danh sách id đã xoá) ----------
  function loadDeletedIds() {
    try {
      const raw = localStorage.getItem(DELETED_STORAGE_KEY);
      deletedIds = raw ? JSON.parse(raw) : {};
    } catch (err) {
      deletedIds = {};
    }
    // Dọn các tombstone quá hạn (90 ngày) để không phình localStorage mãi
    const now = Date.now();
    let pruned = false;
    Object.keys(deletedIds).forEach((id) => {
      if (now - deletedIds[id] > DELETED_TTL_MS) {
        delete deletedIds[id];
        pruned = true;
      }
    });
    if (pruned) persistDeletedIds();
  }

  function persistDeletedIds() {
    localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(deletedIds));
  }

  function markDeleted(id) {
    deletedIds[id] = Date.now();
    persistDeletedIds();
  }

  function persist({ sync = true } = {}) {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
    renderSidebarMiniList();
    if (currentView === 'tasks') renderMainView();
    if (sync && typeof EventBus !== 'undefined') EventBus.emit('tasks:changed', {});
  }

  function mergeFromServer(serverTasks) {
    if (!Array.isArray(serverTasks)) return;
    const localIds = new Set(tasks.map((t) => t.id));
    let changed = false;
    serverTasks.forEach((st) => {
      if (!st || !st.id || localIds.has(st.id)) return;
      if (deletedIds[st.id]) return; // task này đã bị xoá trước đó -> không hồi sinh
      tasks.push({
        id: st.id,
        title: st.title || '',
        note: st.note || '',
        category: st.category || 'plan',
        priority: st.priority || 'medium',
        symbol: st.symbol || '',
        date: st.date,
        time: st.time,
        repeat: st.repeat || 'none',
        daysOfWeek: st.daysOfWeek || [],
        enabled: st.enabled !== undefined ? !!st.enabled : true,
        done: !!st.done,
        lastNotifiedKey: null,
      });
      changed = true;
    });
    if (changed) persist({ sync: false });
  }

  function getAllTasks() {
    return tasks;
  }

  // ---------- Utilities ----------
  function uid() { return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateKeyOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function todayDateStr() { const d = new Date(); return dateKeyOf(d); }
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
      const days = (task.daysOfWeek && task.daysOfWeek.length) ? task.daysOfWeek : [new Date(ay, (am || 1) - 1, ad).getDay()];
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
      const catInfo = CATEGORIES[task.category] || CATEGORIES.plan;
      const prioInfo = PRIORITIES[task.priority] || PRIORITIES.medium;
      const titlePrefix = `[${prioInfo.shortLabel}] Nhắc việc - ${catInfo.label}`;
      if (typeof NotificationsModule !== 'undefined') {
        NotificationsModule.notify(titlePrefix, task.title + (task.note ? ` - ${task.note}` : ''));
      }
      task.lastNotifiedKey = occ.key;
      if (task.repeat === 'none' || !task.repeat) {
        task.enabled = false;
        task.done = true;
      }
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
        title: input.title.trim(),
        note: (input.note || '').trim(),
        category: input.category || 'plan',
        priority: input.priority || 'medium',
        symbol: (input.symbol || '').trim().toUpperCase(),
        date: input.date,
        time: input.time,
        repeat: input.repeat || 'none',
        daysOfWeek: input.daysOfWeek || [],
      });
      t.lastNotifiedKey = null;
      t.done = false;
      t.enabled = true;
      persist();
      return t;
    }
    const task = {
      id: uid(),
      title: input.title.trim(),
      note: (input.note || '').trim(),
      category: input.category || 'plan',
      priority: input.priority || 'medium',
      symbol: (input.symbol || '').trim().toUpperCase(),
      date: input.date,
      time: input.time,
      repeat: input.repeat || 'none',
      daysOfWeek: input.daysOfWeek || [],
      enabled: true,
      done: false,
      lastNotifiedKey: null,
    };
    tasks.push(task);
    persist();
    return task;
  }

  function duplicateTask(id) {
    const original = tasks.find((t) => t.id === id);
    if (!original) return;
    const newTask = {
      ...JSON.parse(JSON.stringify(original)),
      id: uid(),
      title: original.title + ' (Bản sao)',
      done: false,
      enabled: true,
      lastNotifiedKey: null,
    };
    tasks.push(newTask);
    persist();
  }

  function removeTask(id) {
    tasks = tasks.filter((t) => t.id !== id);
    markDeleted(id); // ghi tombstone để mergeFromServer không hồi sinh task này
    persist();
  }

  function toggleDone(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.enabled = !t.done;
    if (!t.done) t.lastNotifiedKey = null;
    persist();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function repeatLabel(t) {
    if (t.repeat === 'daily') return 'Hằng ngày';
    if (t.repeat === 'weekly') {
      const days = t.daysOfWeek || [];
      return days.length ? `Hằng tuần (${days.map((d) => WEEKDAY_LABELS[d]).join(', ')})` : 'Hằng tuần';
    }
    if (t.repeat === 'monthly') return 'Hằng tháng';
    return null;
  }

  // ---------- Sidebar Mini List ----------
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
      .slice(0, 15);

    if (withNext.length === 0) {
      listEl.innerHTML = `<div class="tasks-mini-empty">Chưa có nhắc việc nào.</div>
        <button type="button" class="tasks-mini-add-btn" id="miniAddTaskBtn">+ Thêm nhắc việc</button>`;
    } else {
      listEl.innerHTML = withNext.map(({ t, next }) => {
        const overdue = next && next < now && !t.done;
        const timeLabel = t.done ? 'Xong' : (next ? `${pad2(next.getHours())}:${pad2(next.getMinutes())} · ${pad2(next.getDate())}/${pad2(next.getMonth() + 1)}` : '');
        const prio = PRIORITIES[t.priority] || PRIORITIES.medium;
        return `
        <div class="tasks-mini-item${overdue ? ' overdue' : ''}${t.done ? ' done' : ''}" data-task-id="${t.id}">
          <span class="tasks-mini-dot" style="background: ${prio.color}"></span>
          <div class="tasks-mini-content">
            <span class="tasks-mini-title">${escapeHtml(t.title)}</span>
            <div class="tasks-mini-sub">${t.symbol ? `<span class="tasks-mini-sym">${escapeHtml(t.symbol)}</span>` : ''} ${timeLabel}</div>
          </div>
          <button type="button" class="alert-remove-btn tasks-mini-remove-btn" data-remove-id="${t.id}" title="Xoá công việc này">✕</button>
        </div>`;
      }).join('') + `<button type="button" class="tasks-mini-add-btn" id="miniAddTaskBtn">+ Thêm nhắc việc</button>`;
    }

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

  // ---------- Main View: Professional Dashboard ----------
  function getFilteredGroupedTasks() {
    const now = new Date();
    const withNext = tasks.map((t) => ({ t, next: t.done ? null : getNextOccurrenceDate(t) }));

    let filtered = withNext;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(({ t }) =>
        t.title.toLowerCase().includes(q) ||
        (t.note && t.note.toLowerCase().includes(q)) ||
        (t.symbol && t.symbol.toLowerCase().includes(q))
      );
    }

    // Filter by view
    if (currentFilter === 'today') {
      filtered = filtered.filter(({ t, next }) => !t.done && next && isSameDay(next, now));
    } else if (currentFilter === 'upcoming') {
      filtered = filtered.filter(({ t }) => t.enabled && !t.done);
    } else if (currentFilter === 'overdue') {
      filtered = filtered.filter(({ t, next }) => !t.done && next && next < now);
    } else if (currentFilter === 'done') {
      filtered = filtered.filter(({ t }) => t.done);
    }

    // Category filter
    if (currentCategory !== 'all') {
      filtered = filtered.filter(({ t }) => t.category === currentCategory);
    }

    // Priority filter
    if (currentPriority !== 'all') {
      filtered = filtered.filter(({ t }) => t.priority === currentPriority);
    }

    filtered.sort((a, b) => {
      if (a.t.done !== b.t.done) return a.t.done ? 1 : -1;
      const prioOrder = { high: 0, medium: 1, low: 2 };
      const pDiff = (prioOrder[a.t.priority] || 1) - (prioOrder[b.t.priority] || 1);
      if (pDiff !== 0) return pDiff;
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

    // Stats calculations
    const todayTasks = tasks.filter((t) => {
      const next = getNextOccurrenceDate(t);
      return next && isSameDay(next, now);
    });
    const todayDone = todayTasks.filter((t) => t.done).length;
    const todayTotal = todayTasks.length;
    const todayPct = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 0;

    const overdueCount = tasks.filter((t) => {
      if (t.done || !t.enabled) return false;
      const next = getNextOccurrenceDate(t);
      return next && next < now;
    }).length;

    const highPrioCount = tasks.filter((t) => !t.done && t.enabled && t.priority === 'high').length;
    const upcomingCount = tasks.filter((t) => !t.done && t.enabled).length;

    const groups = getFilteredGroupedTasks();

    let bodyHtml = '';
    if (groups.size === 0) {
      bodyHtml = `
      <div class="tv-empty-state">
        <div class="tv-empty-icon">${getIconSvg('journal')}</div>
        <div class="tv-empty-title">Không tìm thấy công việc phù hợp</div>
        <div class="tv-empty-desc">Thử thay đổi bộ lọc hoặc thêm một lời nhắc trading mới từ menu bên trên.</div>
        <button type="button" class="tv-add-btn" id="tvEmptyAddBtn" style="margin-top:12px;">+ Thêm công việc mới</button>
      </div>`;
    } else {
      for (const [key, items] of groups.entries()) {
        bodyHtml += `<div class="tv-group-title">${formatGroupLabel(key, now)} (${items.length})</div>`;
        items.forEach(({ t, next }) => {
          const overdue = next && next < now && !t.done;
          const timeStr = next ? `${pad2(next.getHours())}:${pad2(next.getMinutes())}` : '';
          const dateStr = next ? `${pad2(next.getDate())}/${pad2(next.getMonth() + 1)}` : '';
          const repeat = repeatLabel(t);
          const cat = CATEGORIES[t.category] || CATEGORIES.plan;
          const prio = PRIORITIES[t.priority] || PRIORITIES.medium;

          bodyHtml += `
          <div class="tv-card ${prio.tagClass}${overdue ? ' overdue' : ''}${t.done ? ' done' : ''}" data-task-id="${t.id}">
            <div class="tv-card-check-wrap">
              <input type="checkbox" class="tv-card-check" ${t.done ? 'checked' : ''} data-action="toggle">
            </div>
            <div class="tv-card-body" data-action="edit">
              <div class="tv-card-header-row">
                <div class="tv-card-title">${escapeHtml(t.title)}</div>
                <div class="tv-card-prio-badge" style="color: ${prio.color}; background: ${prio.color}15;">
                  ${getIconSvg(prio.iconKey)} ${prio.shortLabel}
                </div>
              </div>
              ${t.note ? `<div class="tv-card-note">${escapeHtml(t.note)}</div>` : ''}
              <div class="tv-card-meta">
                <span class="tv-card-tag ${cat.tagClass}">${getIconSvg(cat.iconKey)} ${cat.label}</span>
                ${t.symbol ? `<span class="tv-card-tag tv-tag-symbol">${getIconSvg('trendUp')} ${escapeHtml(t.symbol)}</span>` : ''}
                ${timeStr ? `<span class="tv-card-time ${overdue ? 'tv-time-overdue' : ''}">${getIconSvg('clock')} ${timeStr} (${dateStr})</span>` : ''}
                ${repeat ? `<span class="tv-card-repeat-tag">${getIconSvg('repeat')} ${repeat}</span>` : ''}
              </div>
            </div>
            <div class="tv-card-actions">
              <button type="button" class="tv-card-act-btn" data-action="duplicate" title="Nhân bản công việc">${getIconSvg('copy')}</button>
              <button type="button" class="tv-card-act-btn tv-remove" data-action="remove" title="Xoá">${getIconSvg('close')}</button>
            </div>
          </div>`;
        });
      }
    }

    container.innerHTML = `
      <!-- TOP HEADER & TITLE -->
      <div class="tv-header">
        <div>
          <div class="tv-title">
            ${getIconSvg('tabTasks')}
            Công Việc &amp; Lời Nhắc Trading
          </div>
          <div class="tv-subtitle">Hệ thống quản trị thời gian, kiểm soát kế hoạch &amp; kỷ luật giao dịch chuyên sâu</div>
        </div>
        <button type="button" class="tv-add-btn" id="tvAddBtn">+ Thêm việc mới</button>
      </div>

      <!-- DASHBOARD KPI CARDS -->
      <div class="tv-dashboard-grid">
        <div class="tv-kpi-card">
          <div class="tv-kpi-title">Tiến Độ Hôm Nay</div>
          <div class="tv-kpi-value">${todayDone}/${todayTotal} <span class="tv-kpi-unit">hoàn thành</span></div>
          <div class="tv-progress-bar-bg">
            <div class="tv-progress-bar-fill" style="width: ${todayPct}%;"></div>
          </div>
          <div class="tv-kpi-sub">${todayPct}% công việc đã hoàn tất</div>
        </div>

        <div class="tv-kpi-card">
          <div class="tv-kpi-title">Sắp Tới / Đang Chờ</div>
          <div class="tv-kpi-value">${upcomingCount} <span class="tv-kpi-unit">việc</span></div>
          <div class="tv-kpi-sub">Tổng số lời nhắc đang kích hoạt</div>
        </div>

        <div class="tv-kpi-card ${overdueCount > 0 ? 'tv-kpi-warning' : ''}">
          <div class="tv-kpi-title">Quá Hạn</div>
          <div class="tv-kpi-value">${overdueCount} <span class="tv-kpi-unit">việc trễ</span></div>
          <div class="tv-kpi-sub">${overdueCount > 0 ? `${getIconSvg('risk')} Cần xử lý ngay` : 'Không có việc trễ hạn'}</div>
        </div>

        <div class="tv-kpi-card">
          <div class="tv-kpi-title">Ưu Tiên Cao</div>
          <div class="tv-kpi-value" style="color:var(--red);">${highPrioCount} <span class="tv-kpi-unit">khẩn cấp</span></div>
          <div class="tv-kpi-sub">${getIconSvg('prioHigh')} Nhiệm vụ quan trọng hàng đầu</div>
        </div>
      </div>

      <!-- TRADING QUICK PRESETS BAR -->
      <div class="tv-presets-section">
        <div class="tv-presets-title">${getIconSvg('prioMedium')} Mẫu Lời Nhắc Giao Dịch Nhanh (Trading Presets):</div>
        <div class="tv-presets-list">
          ${TRADING_PRESETS.map((p, idx) => `
            <button type="button" class="tv-preset-chip" data-preset-idx="${idx}">
              <span class="tv-preset-icon">${getIconSvg(p.iconKey)}</span>
              <span class="tv-preset-text">${escapeHtml(p.title)}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- SEARCH & MULTI-FILTER BAR -->
      <div class="tv-control-bar">
        <div class="tv-search-box">
          <span class="tv-search-icon">${getIconSvg('search')}</span>
          <input type="text" id="tvSearchInput" value="${escapeHtml(searchQuery)}" placeholder="Tìm công việc, ghi chú, symbol...">
          ${searchQuery ? `<button type="button" id="tvClearSearch" class="tv-clear-search">${getIconSvg('close')}</button>` : ''}
        </div>

        <!-- Filter tabs: Time -->
        <div class="tv-filters">
          <button type="button" class="tv-filter-btn${currentFilter === 'today' ? ' active' : ''}" data-filter="today">Hôm nay</button>
          <button type="button" class="tv-filter-btn${currentFilter === 'upcoming' ? ' active' : ''}" data-filter="upcoming">Sắp tới</button>
          <button type="button" class="tv-filter-btn${currentFilter === 'overdue' ? ' active' : ''}" data-filter="overdue">Quá hạn (${overdueCount})</button>
          <button type="button" class="tv-filter-btn${currentFilter === 'done' ? ' active' : ''}" data-filter="done">Đã xong</button>
          <button type="button" class="tv-filter-btn${currentFilter === 'all' ? ' active' : ''}" data-filter="all">Tất cả (${tasks.length})</button>
        </div>

        <!-- Category Select Dropdown -->
        <div class="tv-dropdown-filter">
          <select id="tvCategorySelect">
            <option value="all" ${currentCategory === 'all' ? 'selected' : ''}>Tất cả danh mục</option>
            ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${currentCategory === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>

        <!-- Priority Select Dropdown -->
        <div class="tv-dropdown-filter">
          <select id="tvPrioritySelect">
            <option value="all" ${currentPriority === 'all' ? 'selected' : ''}>Tất cả độ ưu tiên</option>
            ${Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}" ${currentPriority === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- MAIN TASK LIST BODY -->
      <div id="tvBody">${bodyHtml}</div>
    `;

    // Event Bindings
    container.querySelector('#tvAddBtn')?.addEventListener('click', () => openTaskModal());
    container.querySelector('#tvEmptyAddBtn')?.addEventListener('click', () => openTaskModal());

    const searchInput = container.querySelector('#tvSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderMainView();
      });
    }
    container.querySelector('#tvClearSearch')?.addEventListener('click', () => {
      searchQuery = '';
      renderMainView();
    });

    container.querySelectorAll('.tv-preset-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.presetIdx);
        const preset = TRADING_PRESETS[idx];
        if (preset) {
          openTaskModal(null, {
            title: preset.title,
            note: preset.note,
            category: preset.category,
            priority: preset.priority,
            time: preset.time,
            date: todayDateStr(),
          });
        }
      });
    });

    container.querySelectorAll('.tv-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        renderMainView();
      });
    });

    const catSel = container.querySelector('#tvCategorySelect');
    if (catSel) {
      catSel.addEventListener('change', (e) => {
        currentCategory = e.target.value;
        renderMainView();
      });
    }

    const prioSel = container.querySelector('#tvPrioritySelect');
    if (prioSel) {
      prioSel.addEventListener('change', (e) => {
        currentPriority = e.target.value;
        renderMainView();
      });
    }

    container.querySelectorAll('.tv-card').forEach((card) => {
      const id = card.dataset.taskId;
      card.querySelector('[data-action="toggle"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDone(id);
      });
      card.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTask(id);
      });
      card.querySelector('[data-action="duplicate"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        duplicateTask(id);
      });
      card.querySelector('[data-action="edit"]')?.addEventListener('click', () => openTaskModal(id));
    });
  }

  // ---------- Modal thêm/sửa chuyên nghiệp ----------
  function openTaskModal(taskId, initialData = null) {
    editingId = taskId || null;
    const existing = taskId ? tasks.find((t) => t.id === taskId) : initialData;

    const defaultDate = existing?.date || todayDateStr();
    const defaultTime = existing?.time || '19:30';

    const backdrop = document.createElement('div');
    backdrop.className = 'tv-modal-backdrop';
    backdrop.innerHTML = `
      <div class="tv-modal">
        <div class="tv-modal-header">
          <div class="tv-modal-title">${taskId ? `${getIconSvg('pencil')} Chỉnh Sửa Công Việc` : `${getIconSvg('plus')} Thêm Lời Nhắc Mới`}</div>
          <button type="button" class="tv-modal-close" id="tmCloseBtn">${getIconSvg('close')}</button>
        </div>

        <div class="tv-modal-form">
          <div>
            <label>Tên công việc / Lời nhắc <span style="color:var(--red)">*</span></label>
            <input type="text" id="tmTitle" value="${existing ? escapeHtml(existing.title) : ''}" placeholder="Ví dụ: Kiểm tra tin tức FOMC & CPI" required autofocus>
          </div>

          <div class="tv-modal-row">
            <div>
              <label>Danh mục</label>
              <select id="tmCategory">
                ${Object.entries(CATEGORIES).map(([k, v]) => `
                  <option value="${k}" ${(existing?.category || 'plan') === k ? 'selected' : ''}>${v.label}</option>
                `).join('')}
              </select>
            </div>
            <div>
              <label>Mức độ ưu tiên</label>
              <select id="tmPriority">
                ${Object.entries(PRIORITIES).map(([k, v]) => `
                  <option value="${k}" ${(existing?.priority || 'medium') === k ? 'selected' : ''}>${v.label}</option>
                `).join('')}
              </select>
            </div>
          </div>

          <div class="tv-modal-row">
            <div>
              <label>Cặp tiền / Symbol (tuỳ chọn)</label>
              <input type="text" id="tmSymbol" value="${existing?.symbol ? escapeHtml(existing.symbol) : ''}" placeholder="Ví dụ: XAUUSD, EURUSD">
            </div>
            <div>
              <label>Ghi chú thêm</label>
              <input type="text" id="tmNote" value="${existing?.note ? escapeHtml(existing.note) : ''}" placeholder="Ghi chú chi tiết...">
            </div>
          </div>

          <div class="tv-modal-row">
            <div><label>Ngày thực hiện <span style="color:var(--red)">*</span></label><input type="date" id="tmDate" value="${defaultDate}" required></div>
            <div><label>Giờ nhắc <span style="color:var(--red)">*</span></label><input type="time" id="tmTime" value="${defaultTime}" required></div>
          </div>

          <!-- Quick Time Selection Buttons -->
          <div>
            <label>Chọn giờ nhanh:</label>
            <div class="tv-quick-time-row">
              <button type="button" class="tv-quick-time-btn" data-time="08:00">${getIconSvg('sun')} Sáng (08:00)</button>
              <button type="button" class="tv-quick-time-btn" data-time="14:00">${getIconSvg('sun')} Trưa (14:00)</button>
              <button type="button" class="tv-quick-time-btn" data-time="19:30">${getIconSvg('moon')} Phiên Mỹ (19:30)</button>
              <button type="button" class="tv-quick-time-btn" data-time="21:00">${getIconSvg('moon')} Tối (21:00)</button>
            </div>
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

          <div id="tmWeekdaysRow" class="dt-swatch-row" style="display:none; margin-top: -4px;">
            ${WEEKDAY_LABELS.map((label, i) => `<button type="button" class="dt-swatch-btn tm-weekday-btn" data-day="${i}">${label}</button>`).join('')}
          </div>
        </div>

        <div class="tv-modal-actions">
          ${taskId ? `<button type="button" class="tv-modal-cancel" id="tmDelete" style="color:var(--red);margin-right:auto;">${getIconSvg('trash')} Xoá công việc</button>` : ''}
          <button type="button" class="tv-modal-cancel" id="tmCancel">Huỷ</button>
          <button type="button" class="tv-modal-save" id="tmSave">Lưu Công Việc</button>
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
        if (selectedDays.has(day)) {
          selectedDays.delete(day);
          btn.classList.remove('active');
        } else {
          selectedDays.add(day);
          btn.classList.add('active');
        }
      });
    });

    repeatSelect.addEventListener('change', () => {
      weekdaysRow.style.display = repeatSelect.value === 'weekly' ? 'flex' : 'none';
    });

    backdrop.querySelectorAll('.tv-quick-time-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const timeInput = backdrop.querySelector('#tmTime');
        if (timeInput) timeInput.value = btn.dataset.time;
      });
    });

    function close() { backdrop.remove(); }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#tmCancel').addEventListener('click', close);
    backdrop.querySelector('#tmCloseBtn').addEventListener('click', close);

    const deleteBtn = backdrop.querySelector('#tmDelete');
    if (deleteBtn && taskId) {
      deleteBtn.addEventListener('click', () => {
        removeTask(taskId);
        close();
      });
    }

    backdrop.querySelector('#tmSave').addEventListener('click', () => {
      const title = backdrop.querySelector('#tmTitle').value.trim();
      const date = backdrop.querySelector('#tmDate').value;
      const time = backdrop.querySelector('#tmTime').value;
      if (!title || !date || !time) {
        alert('Vui lòng điền tên công việc, ngày và giờ nhắc.');
        return;
      }
      upsertTask({
        id: editingId,
        title,
        category: backdrop.querySelector('#tmCategory').value,
        priority: backdrop.querySelector('#tmPriority').value,
        symbol: backdrop.querySelector('#tmSymbol').value,
        note: backdrop.querySelector('#tmNote').value,
        date,
        time,
        repeat: repeatSelect.value,
        daysOfWeek: [...selectedDays].sort(),
      });
      close();
    });
  }

  // ---------- View Switching ----------
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
    checkDueTasks();
  }

  return {
    init,
    upsertTask,
    removeTask,
    toggleDone,
    duplicateTask,
    getAllTasks,
    mergeFromServer,
    switchView,
  };
})();