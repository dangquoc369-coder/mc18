/**
 * symbol-size.js
 * Nút "Aa" trên khung symbol (chỉ hiện ở mobile): đổi vòng cỡ khung
 * m (vừa) -> s (nhỏ) -> xs (tối giản). Lưu cục bộ.
 */
(function () {
  const KEY = 'dq_symbol_size_v1';
  const SIZES = ['m', 's', 'xs'];

  function load() {
    try {
      const v = localStorage.getItem(KEY);
      return SIZES.includes(v) ? v : 'm';
    } catch (err) {
      return 'm';
    }
  }
  function save(v) {
    try {
      localStorage.setItem(KEY, v);
    } catch (err) {
      // Bỏ qua nếu trình duyệt chặn localStorage.
    }
  }

  let current = load();
  function apply() {
    document.documentElement.setAttribute('data-sym-size', current);
  }

  function inject() {
    document.querySelectorAll('.pane-symbol-row').forEach((row) => {
      if (row.querySelector('.sym-size-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sym-size-btn';
      btn.title = 'Đổi cỡ khung symbol';
      btn.textContent = 'Aa';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        current = SIZES[(SIZES.indexOf(current) + 1) % SIZES.length];
        apply();
        save(current);
      });
      row.appendChild(btn);
    });
  }

  apply();
  inject();
})();