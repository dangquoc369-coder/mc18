/**
 * select-fix.js  (v2)
 * Thay <select> native bằng dropdown tự vẽ để iOS/iPadOS (PWA) không mở "bong bóng"
 * hệ thống làm mờ / xám status bar.
 *
 *   SelectFix.enhance(selectEl)  - bọc 1 <select> đã nằm trong DOM (dùng cho ui.js, drawing.js)
 *   SelectFix.attach(rootEl)     - bọc mọi <select> trong rootEl, kể cả cái được dựng lại sau này
 *                                  (dùng cho các hộp thoại cài đặt)
 *
 * <select> gốc vẫn còn trong DOM (ẩn): code cũ đọc/ghi .value và nghe 'change' vẫn chạy.
 * Menu luôn gắn vào <body>, màu theo biến theme của app (sáng/tối tự đổi).
 */
const SelectFix = (function () {
  const CSS = `
.sfx-btn{display:inline-flex;align-items:center;justify-content:space-between;gap:8px;min-width:90px;max-width:230px;padding:6px 8px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:var(--text-primary,inherit);font-size:13px;font-family:inherit;cursor:pointer;text-align:left}
.sfx-btn:focus,.sfx-btn.open{outline:none;border-color:var(--accent-blue,#2962ff)}
.sfx-btn.sfx-ghost{min-width:0;border:none;background:transparent;padding:5px 4px;font-size:12px;border-radius:5px}
.sfx-btn.sfx-ghost:hover{background:var(--bg-hover,rgba(128,128,128,.15))}
.sfx-inherit{text-align:left;font-family:inherit;color:var(--text-primary)}
.sfx-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sfx-c{font-size:10px;opacity:.7;flex-shrink:0}
.sfx-menu{position:fixed;z-index:100001;overflow-y:auto;background:var(--bg-elevated,#1e222d);color:var(--text-primary,#d1d4dc);border:1px solid var(--border-color,rgba(128,128,128,.4));border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:4px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;font-family:inherit}
.sfx-item{padding:9px 12px;font-size:13.5px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sfx-item:hover{background:var(--bg-hover,rgba(128,128,128,.15))}
.sfx-item.sel{color:var(--accent-blue,#2962ff);font-weight:700}
`;

  let menu = null;
  let menuBtn = null;

  function ensureCss() {
    if (document.getElementById('select-fix-css')) return;
    const st = document.createElement('style');
    st.id = 'select-fix-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function closeMenu() {
    if (menu) menu.remove();
    if (menuBtn) menuBtn.classList.remove('open');
    menu = null;
    menuBtn = null;
  }

  function openMenu(btn, sel) {
    closeMenu();
    menuBtn = btn;
    btn.classList.add('open');
    menu = document.createElement('div');
    menu.className = 'sfx-menu';
    Array.from(sel.options).forEach((o) => {
      const it = document.createElement('div');
      it.className = 'sfx-item' + (o.value === sel.value ? ' sel' : '');
      it.textContent = o.textContent;
      it.addEventListener('click', (e) => {
        e.stopPropagation();
        const changed = o.value !== sel.value;
        sel.value = o.value;
        closeMenu();
        if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      menu.appendChild(it);
    });
    document.body.appendChild(menu);

    const r = btn.getBoundingClientRect();
    const vh = window.innerHeight;
    const maxH = Math.min(menu.scrollHeight + 10, 300);
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const up = below < maxH && above > below;
    const h = Math.min(maxH, up ? above : below);
    menu.style.maxHeight = h + 'px';
    menu.style.minWidth = Math.max(r.width, 90) + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = (up ? r.top - h - 4 : r.bottom + 4) + 'px';
    const cur = menu.querySelector('.sel');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function enhance(sel) {
    if (!sel || sel.dataset.sfx || !sel.parentNode) return;
    sel.dataset.sfx = '1';

    const inherit = sel.classList.contains('timeframe-select'); // giữ nguyên giao diện + CSS của thanh điều khiển
    const ghost = sel.classList.contains('dtv-tb-select');       // thanh công cụ hình vẽ
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = inherit ? 'sfx-inherit ' + sel.className : 'sfx-btn' + (ghost ? ' sfx-ghost' : '');
    if (sel.title) btn.title = sel.title;

    const label = () => {
      const o = sel.options[sel.selectedIndex];
      const text = o ? o.textContent : '';
      if (inherit) {
        btn.textContent = text;
      } else {
        btn.innerHTML = '<span class="sfx-t"></span><span class="sfx-c">&#9662;</span>';
        btn.firstChild.textContent = text;
      }
    };
    label();

    // Code cũ gán sel.value = ... (reset, đồng bộ layout) cũng cập nhật nhãn
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get() { return desc.get.call(sel); },
      set(v) { desc.set.call(sel, v); label(); },
    });
    sel.addEventListener('change', label);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu && menuBtn === btn) closeMenu();
      else openMenu(btn, sel);
    });

    sel.style.display = 'none';
    sel.parentNode.insertBefore(btn, sel);
  }

  function enhanceAll(root) {
    root.querySelectorAll('select:not([data-sfx])').forEach(enhance);
  }

  function attach(root) {
    enhanceAll(root);
    new MutationObserver(() => enhanceAll(root)).observe(root, { childList: true, subtree: true });
  }

  // ---- đóng menu: bấm ra ngoài / Esc / cuộn / xoay ----
  ensureCss();
  document.addEventListener(
    'click',
    (e) => {
      if (!menu) return;
      if (menu.contains(e.target) || (menuBtn && menuBtn.contains(e.target))) return;
      closeMenu();
    },
    true
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && menu) {
        e.stopImmediatePropagation();
        e.preventDefault();
        closeMenu();
      }
    },
    true
  );
  window.addEventListener('resize', closeMenu);
  window.addEventListener(
    'scroll',
    (e) => {
      if (menu && !(e.target && e.target.nodeType === 1 && menu.contains(e.target)) && e.target !== menu) closeMenu();
    },
    true
  );

  return { enhance, attach };
})();