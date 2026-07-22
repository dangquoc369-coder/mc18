/**
 * indicator-prefs.js
 * Lưu lại chỉ báo (RSI/EMA/MACD/BB...) đang bật + period của từng pane,
 * để mở lại app vẫn giữ nguyên chỉ báo đang xem - KHÔNG bị reset về mặc
 * định như trước đây.
 *
 * "Khoá" theo đúng tài khoản đang đăng nhập (LoginModule.getStoredUsername()
 * - tên đã xác thực bằng PIN qua login.js): mỗi tài khoản có 1 key
 * localStorage RIÊNG, nên đổi sang tài khoản khác trên cùng máy sẽ KHÔNG
 * bị đọc nhầm chỉ báo của tài khoản trước đó. Nếu chưa đăng nhập (hoặc
 * WORKER_URL chưa cấu hình - xem login.js), storageKey() trả về null và
 * module này im lặng bỏ qua toàn bộ lưu/đọc - không có gì bị lưu "vô danh".
 */
const IndicatorPrefsModule = (function () {
  function storageKey() {
    const username =
      typeof LoginModule !== 'undefined' && LoginModule.getStoredUsername
        ? LoginModule.getStoredUsername()
        : null;
    if (!username) return null;
    return `dq_tracker_indicator_prefs_v1_${username}`;
  }

  function loadAll() {
    const key = storageKey();
    if (!key) return {};
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.error('[indicator-prefs.js] Lỗi khi đọc:', err);
      return {};
    }
  }

  function saveAll(data) {
    const key = storageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      console.error('[indicator-prefs.js] Lỗi khi lưu:', err);
    }
  }

  function getPanePrefs(paneId) {
    return loadAll()[paneId] || null;
  }

  function setPanePrefs(paneId, prefs) {
    const all = loadAll();
    all[paneId] = prefs;
    saveAll(all);
  }

  return { getPanePrefs, setPanePrefs };
})();