/**
 * local-store.js
 * Kho lưu trữ cục bộ theo từng tài khoản (Khách = 'guest').
 * Thứ tự đọc: key của tài khoản -> key của 'guest' -> key cũ (legacy), rồi
 * copy về key của tài khoản (di trú 1 lần, người dùng không mất dữ liệu cũ).
 *
 * CẬP NHẬT: nút "💾 Dữ liệu" không còn nằm trong topbar (tránh làm hàng
 * topbar bị tràn xuống dòng trên iPhone/iPad) mà nằm ở CHÂN SIDEBAR
 * (.sidebar-footer, style trong css/topbar-landscape.css). Panel sao lưu
 * mở ngay phía trên nút đó.
 */
const LocalStore = (function () {
  const DEVICE_ID_KEY = 'dq_tracker_device_id_v1';
  const PREFIX = 'dqt';
  const EXTRA_KEYS = [
    'dq_tracker_theme_v1',
    'dq_tracker_tasks_v1',
    'dq_tracker_deleted_tasks_v1',
    'dq_tracker_sound_enabled_v1',
  ];

  function ns() {
    try { return localStorage.getItem(DEVICE_ID_KEY) || 'guest'; } catch (e) { return 'guest'; }
  }
  function keyFor(name, space) { return `${PREFIX}:${space || ns()}:${name}`; }
  function indicatorKeyFor(space) { return `dq_tracker_indicator_prefs_v1_${space}`; }

  function read(name, fallback, legacyKey) {
    try {
      const mine = keyFor(name);
      let raw = localStorage.getItem(mine);
      if (raw === null && ns() !== 'guest') raw = localStorage.getItem(keyFor(name, 'guest'));
      if (raw === null && legacyKey) raw = localStorage.getItem(legacyKey);
      if (raw === null) return fallback;
      if (localStorage.getItem(mine) === null) localStorage.setItem(mine, raw); // di trú
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function write(name, value) {
    try {
      localStorage.setItem(keyFor(name), JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[LocalStore] Không ghi được (đầy bộ nhớ?):', name, e.message || e);
      return false;
    }
  }

  function remove(name) {
    try { localStorage.removeItem(keyFor(name)); } catch (e) {}
  }

  // ===== Sao lưu / khôi phục =====
  function exportAll() {
    const data = {};
    const space = ns();
    const p = `${PREFIX}:${space}:`;
    const ind = indicatorKeyFor(space);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(p) || k === ind || EXTRA_KEYS.includes(k)) data[k] = localStorage.getItem(k);
    }
    return { app: 'DQTracker', version: 1, ns: space, exportedAt: new Date().toISOString(), data };
  }

  function importAll(payload) {
    if (!payload || payload.app !== 'DQTracker' || !payload.data) throw new Error('File sao lưu không hợp lệ');
    const space = ns();
    const srcPrefix = `${PREFIX}:${payload.ns}:`;
    const srcInd = indicatorKeyFor(payload.ns);
    let count = 0;
    Object.entries(payload.data).forEach(([k, v]) => {
      let target = null;
      if (k.startsWith(srcPrefix)) target = keyFor(k.slice(srcPrefix.length));
      else if (k === srcInd) target = indicatorKeyFor(space);
      else if (EXTRA_KEYS.includes(k)) target = k;
      if (target) { localStorage.setItem(target, v); count++; }
    });
    return count;
  }

  // ===== Nút "💾 Dữ liệu" ở CHÂN SIDEBAR + panel sao lưu =====
  function mountBackupUI() {
    if (document.getElementById('backupBtn')) return; // tránh gắn 2 lần

    const panel = document.createElement('div');
    panel.id = 'backupPanel';
    panel.className = 'ms-panel';
    panel.innerHTML = `
      <div class="ms-header"><span>${iconInline('database')} Dữ liệu trên thiết bị</span><span class="ms-close">${iconHTML('close')}</span></div>
      <div class="ms-row ms-muted" style="line-height:1.5">
        Watchlist, bố cục, chỉ báo, hình vẽ và nhật ký lệnh chỉ lưu trên thiết bị này.
        Hãy sao lưu định kỳ, nhất là trước khi xoá dữ liệu Safari hoặc đổi máy.
      </div>
      <div class="ms-row" style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="alert-remove-btn" id="backupExportBtn">${iconHTML('download')} Xuất file sao lưu</button>
        <button type="button" class="alert-remove-btn" id="backupImportBtn">${iconHTML('upload')} Khôi phục từ file</button>
      </div>
      <input type="file" id="backupFileInput" accept="application/json,.json" style="display:none">
    `;
    document.body.appendChild(panel);

    const btn = document.createElement('button');
    btn.id = 'backupBtn';
    btn.className = 'sidebar-footer-btn';
    btn.type = 'button';
    btn.innerHTML = `<span class="sfb-icon">${iconHTML('database')}</span><span class="sfb-text">Dữ liệu</span>`;
    btn.title = 'Sao lưu / khôi phục dữ liệu trên thiết bị';

    function setOpen(open) {
      panel.classList.toggle('open', open);
      btn.classList.toggle('open', open);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!panel.classList.contains('open'));
    });
    panel.querySelector('.ms-close').addEventListener('click', () => setOpen(false));

    // Panel nằm ngoài #sidebar: nếu để click lọt lên document thì
    // sidebar-resize.js (mobile) sẽ coi là "bấm ra ngoài" và tự đóng drawer.
    panel.addEventListener('click', (e) => e.stopPropagation());

    // Bấm ra ngoài panel thì đóng lại
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('open')) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      setOpen(false);
    });

    // Gắn nút vào chân sidebar (nằm ngoài vùng tab nên luôn hiện ở mọi tab)
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      const footer = document.createElement('div');
      footer.className = 'sidebar-footer';
      footer.appendChild(btn);
      sidebar.appendChild(footer);
    } else {
      btn.style.position = 'fixed';
      btn.style.left = '10px';
      btn.style.bottom = '10px';
      btn.style.width = 'auto';
      btn.style.zIndex = '9999';
      document.body.appendChild(btn);
    }

    panel.querySelector('#backupExportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tradingpro-backup-${ns()}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });

    const fileInput = panel.querySelector('#backupFileInput');
    panel.querySelector('#backupImportBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        if (!confirm('Khôi phục sẽ GHI ĐÈ dữ liệu cục bộ hiện tại của tài khoản này. Tiếp tục?')) return;
        const n = importAll(payload);
        alert(`✅ Đã khôi phục ${n} mục dữ liệu. Ứng dụng sẽ tải lại.`);
        location.reload();
      } catch (err) {
        alert('❌ Không đọc được file: ' + (err.message || err));
      } finally {
        fileInput.value = '';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBackupUI);
  else mountBackupUI();

  return { read, write, remove, ns, exportAll, importAll };
})();