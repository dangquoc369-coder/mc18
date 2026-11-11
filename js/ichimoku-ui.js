/**
 * ichimoku-ui.js
 * Hộp thoại cài đặt Ichimoku kiểu TradingView (Inputs / Style / Visibility).
 * Dùng: IchimokuUI.open()  -> mở cho ô đang chọn (hoặc IchimokuUI.open('pane-2')).
 */
const IchimokuUI = (function () {
  const LINES = [
    ['conv', 'Conversion Line'],
    ['base', 'Base Line'],
    ['lag', 'Lagging Span'],
    ['spanA', 'Leading Span A'],
    ['spanB', 'Leading Span B'],
    ['kumoUp', 'Kumo Cloud Upper Line'],
    ['kumoLow', 'Kumo Cloud Lower Line'],
  ];

  const CSS = `
.ich-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center}
.ich-modal{width:460px;max-width:94vw;max-height:90vh;display:flex;flex-direction:column;background:var(--bg-elevated,#1e222d);color:var(--text-primary,#d1d4dc);border:1px solid var(--border-color,rgba(128,128,128,.35));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);font-family:inherit;overflow:hidden}
.ich-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 6px}
.ich-title{font-size:20px;font-weight:700}
.ich-x{background:transparent;border:none;color:inherit;font-size:26px;cursor:pointer;width:32px;height:32px;border-radius:6px}
.ich-tabs{display:flex;gap:22px;padding:0 20px;border-bottom:1px solid var(--border-color,rgba(128,128,128,.3))}
.ich-tab{background:transparent;border:none;color:var(--text-secondary,#9aa3b8);padding:10px 0;font-size:14px;font-weight:600;cursor:pointer;position:relative}
.ich-tab.active{color:inherit}
.ich-tab.active::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:currentColor}
.ich-body{padding:14px 20px;overflow-y:auto;flex:1}
.ich-pane{display:none;flex-direction:column;gap:12px}
.ich-pane.active{display:flex}
.ich-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px;min-height:34px}
.ich-lbl{display:flex;align-items:center;gap:10px;cursor:pointer}
.ich-ctrls{display:flex;align-items:center;gap:8px}
.ich-row input[type=checkbox]{width:17px;height:17px;accent-color:var(--accent-blue,#2962ff);cursor:pointer}
.ich-num{width:110px;padding:7px 10px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:14px;outline:none}
.ich-num:focus,.ich-sel:focus{border-color:var(--accent-blue,#2962ff)}
.ich-col{width:34px;height:28px;padding:0;border:1px solid var(--border-color,rgba(128,128,128,.4));border-radius:6px;background:transparent;cursor:pointer}
.ich-sel{padding:6px 8px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:13px;outline:none}
.ich-range{width:90px;accent-color:var(--accent-blue,#2962ff)}
.ich-sub{padding-left:27px}
.ich-foot{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--border-color,rgba(128,128,128,.3))}
.ich-btn{padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid var(--border-color,rgba(128,128,128,.5));background:transparent;color:inherit}
.ich-btn.primary{background:var(--accent-blue,#2962ff);border-color:var(--accent-blue,#2962ff);color:#fff}
.ich-group{display:flex;gap:10px}
.ich-x svg{width:18px;height:18px;display:block;margin:auto}
`;

  function ensureCss() {
    if (document.getElementById('ichimoku-ui-css')) return;
    const st = document.createElement('style');
    st.id = 'ichimoku-ui-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function timeframeList() {
    if (typeof TIMEFRAMES !== 'undefined' && Array.isArray(TIMEFRAMES)) {
      return TIMEFRAMES.map((t) => [t.value, t.label || t.value]);
    }
    return ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map((v) => [v, v]);
  }

  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  function open(paneId) {
    const pid = paneId || (typeof Store !== 'undefined' ? Store.getState().activePaneId : null);
    const inst = window.PaneRegistry && window.PaneRegistry.get(pid);
    if (!inst || !inst.getIndicatorConfig || !inst.setIchimoku) return;
    ensureCss();

    const current = inst.getIndicatorConfig().ichimoku;
    const tfList = timeframeList();

    const backdrop = document.createElement('div');
    backdrop.className = 'ich-backdrop';
    backdrop.innerHTML = `
      <div class="ich-modal">
        <div class="ich-head"><span class="ich-title">Ichimoku</span><button type="button" class="ich-x">${iconHTML('close')}</button></div>
        <div class="ich-tabs">
          <button type="button" class="ich-tab active" data-t="inputs">Inputs</button>
          <button type="button" class="ich-tab" data-t="style">Style</button>
          <button type="button" class="ich-tab" data-t="vis">Visibility</button>
        </div>
        <div class="ich-body">
          <div class="ich-pane active" data-p="inputs"></div>
          <div class="ich-pane" data-p="style"></div>
          <div class="ich-pane" data-p="vis"></div>
        </div>
        <div class="ich-foot">
          <select class="ich-sel" id="ichTpl"><option value="">Defaults</option><option value="reset">Đặt lại mặc định</option></select>
          <div class="ich-group">
            <button type="button" class="ich-btn" id="ichCancel">Cancel</button>
            <button type="button" class="ich-btn primary" id="ichOk">Ok</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    if (typeof SelectFix !== 'undefined') SelectFix.attach(backdrop);

    const q = (s) => backdrop.querySelector(s);
    const qa = (s) => Array.from(backdrop.querySelectorAll(s));

    function fill(c) {
      q('[data-p="inputs"]').innerHTML = `
        <div class="ich-row"><span>Conversion Line Length</span><input class="ich-num" id="ichConv" type="number" min="1" value="${c.conversion}"></div>
        <div class="ich-row"><span>Base Line Length</span><input class="ich-num" id="ichBase" type="number" min="1" value="${c.base}"></div>
        <div class="ich-row"><span>Leading Span B Length</span><input class="ich-num" id="ichSpanB" type="number" min="1" value="${c.spanB}"></div>
        <div class="ich-row"><span>Lagging Span</span><input class="ich-num" id="ichLag" type="number" min="1" value="${c.lagging}"></div>`;

      q('[data-p="style"]').innerHTML =
        LINES.map(([k, label]) => {
          const l = c.lines[k];
          return `<div class="ich-row">
            <label class="ich-lbl"><input type="checkbox" class="ich-show" data-k="${k}" ${l.show ? 'checked' : ''}><span>${label}</span></label>
            <div class="ich-ctrls">
              <input type="color" class="ich-col" data-k="${k}" value="${l.color}">
              <select class="ich-sel ich-w" data-k="${k}">${[1, 2, 3, 4]
                .map((w) => `<option value="${w}" ${w === l.width ? 'selected' : ''}>${w}px</option>`)
                .join('')}</select>
            </div></div>`;
        }).join('') +
        `<div class="ich-row"><label class="ich-lbl"><input type="checkbox" id="ichCloud" ${c.cloud.show ? 'checked' : ''}><span>Cloud Fill</span></label></div>
         <div class="ich-row ich-sub"><span>Color 0 (Span A &gt; B)</span><div class="ich-ctrls">
           <input type="color" class="ich-col" id="ichC0" value="${c.cloud.color0}">
           <input type="range" class="ich-range" id="ichA0" min="0" max="100" value="${Math.round(c.cloud.alpha0 * 100)}"></div></div>
         <div class="ich-row ich-sub"><span>Color 1 (Span A &lt; B)</span><div class="ich-ctrls">
           <input type="color" class="ich-col" id="ichC1" value="${c.cloud.color1}">
           <input type="range" class="ich-range" id="ichA1" min="0" max="100" value="${Math.round(c.cloud.alpha1 * 100)}"></div></div>`;

      const active = c.tfs || tfList.map((t) => t[0]);
      q('[data-p="vis"]').innerHTML = tfList
        .map(
          ([v, label]) =>
            `<div class="ich-row"><label class="ich-lbl"><input type="checkbox" class="ich-tf" value="${esc(v)}" ${active.includes(v) ? 'checked' : ''}><span>${esc(label)}</span></label></div>`
        )
        .join('');
    }
    fill(current);

    qa('.ich-tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        qa('.ich-tab').forEach((t) => t.classList.toggle('active', t === tab));
        qa('.ich-pane').forEach((p) => p.classList.toggle('active', p.dataset.p === tab.dataset.t));
      })
    );

    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    q('.ich-x').addEventListener('click', close);
    q('#ichCancel').addEventListener('click', close);

    q('#ichTpl').addEventListener('change', (e) => {
      if (e.target.value === 'reset') {
        const d = ChartModule.getIchimokuDefaults();
        fill(d);
      }
      e.target.value = '';
    });

    q('#ichOk').addEventListener('click', () => {
      const lines = {};
      LINES.forEach(([k]) => {
        lines[k] = {
          show: q(`.ich-show[data-k="${k}"]`).checked,
          color: q(`.ich-col[data-k="${k}"]`).value,
          width: parseInt(q(`.ich-w[data-k="${k}"]`).value, 10) || 1,
        };
      });
      const tfBoxes = qa('.ich-tf');
      const picked = tfBoxes.filter((c) => c.checked).map((c) => c.value);
      inst.setIchimoku({
        conversion: parseInt(q('#ichConv').value, 10),
        base: parseInt(q('#ichBase').value, 10),
        spanB: parseInt(q('#ichSpanB').value, 10),
        lagging: parseInt(q('#ichLag').value, 10),
        lines,
        cloud: {
          show: q('#ichCloud').checked,
          color0: q('#ichC0').value,
          alpha0: parseInt(q('#ichA0').value, 10) / 100,
          color1: q('#ichC1').value,
          alpha1: parseInt(q('#ichA1').value, 10) / 100,
        },
        tfs: picked.length === 0 || picked.length === tfBoxes.length ? null : picked,
      });
      if (typeof IndicatorLegend !== 'undefined') IndicatorLegend.render(pid, inst);
      close();
    });
  }

  return { open };
})();