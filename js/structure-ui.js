/**
 * structure-ui.js
 * Hộp thoại cài đặt chỉ báo "Cấu Trúc" kiểu TradingView (Inputs / Style / Visibility),
 * cùng khuôn với ma-signal-ui.js.
 * Dùng: StructureUI.open(paneId)
 */
const StructureUI = (function () {
  const CSS = `
.stc-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;overscroll-behavior:contain}
.stc-modal{width:520px;max-width:94vw;max-height:90vh;display:flex;flex-direction:column;background:var(--bg-elevated,#1e222d);color:var(--text-primary,#d1d4dc);border:1px solid var(--border-color,rgba(128,128,128,.35));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);overflow:hidden}
.stc-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 6px}
.stc-title{font-size:20px;font-weight:700}
.stc-x{background:transparent;border:none;color:inherit;font-size:26px;cursor:pointer;width:32px;height:32px;border-radius:6px}
.stc-x svg{width:18px;height:18px;display:block;margin:auto}
.stc-tabs{display:flex;gap:22px;padding:0 20px;border-bottom:1px solid var(--border-color,rgba(128,128,128,.3))}
.stc-tab{background:transparent;border:none;color:var(--text-secondary,#9aa3b8);padding:10px 0;font-size:14px;font-weight:600;cursor:pointer;position:relative}
.stc-tab.active{color:inherit}
.stc-tab.active::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:currentColor}
.stc-body{padding:10px 20px 14px;overflow-y:auto;flex:1}
.stc-pane{display:none;flex-direction:column;gap:10px}
.stc-pane.active{display:flex}
.stc-sec{font-size:11px;letter-spacing:.04em;color:var(--text-secondary,#9aa3b8);margin-top:8px;text-transform:uppercase}
.stc-hint{font-size:11.5px;color:var(--text-secondary,#9aa3b8);line-height:1.45;font-style:italic}
.stc-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px;min-height:34px}
.stc-lbl{display:flex;align-items:center;gap:10px;cursor:pointer}
.stc-ctrls{display:flex;align-items:center;gap:8px}
.stc-row input[type=checkbox]{width:17px;height:17px;accent-color:var(--accent-blue,#2962ff);cursor:pointer}
.stc-num{padding:7px 10px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:14px;outline:none}
.stc-num:focus,.stc-sel:focus{border-color:var(--accent-blue,#2962ff)}
.stc-col{width:34px;height:28px;padding:0;border:1px solid var(--border-color,rgba(128,128,128,.4));border-radius:6px;background:transparent;cursor:pointer}
.stc-sel{padding:6px 8px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:13px;outline:none;max-width:230px}
.stc-range{width:90px;accent-color:var(--accent-blue,#2962ff)}
.stc-foot{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--border-color,rgba(128,128,128,.3))}
.stc-btn{padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid var(--border-color,rgba(128,128,128,.5));background:transparent;color:inherit}
.stc-btn.primary{background:var(--accent-blue,#2962ff);border-color:var(--accent-blue,#2962ff);color:var(--on-accent,#fff)}
.stc-group{display:flex;gap:10px}
`;

  function ensureCss() {
    if (document.getElementById('structure-ui-css')) return;
    const st = document.createElement('style');
    st.id = 'structure-ui-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const num = (val, w, attrs) => `<input type="number" step="any" class="stc-num" style="width:${w}px" value="${esc(val)}" ${attrs || ''}>`;
  const col = (val, attrs) => `<input type="color" class="stc-col" value="${val}" ${attrs || ''}>`;
  const chk = (on, attrs) => `<input type="checkbox" ${on ? 'checked' : ''} ${attrs || ''}>`;
  const rng = (val, attrs) => `<input type="range" class="stc-range" min="0" max="60" value="${Math.round(val * 100)}" ${attrs || ''}>`;
  const sel = (opts, cur, attrs) =>
    `<select class="stc-sel" ${attrs || ''}>${opts
      .map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`)
      .join('')}</select>`;
  const secTitle = (t) => `<div class="stc-sec">${t}</div>`;
  const hint = (t) => `<div class="stc-hint">${t}</div>`;
  const row = (label, ctrls) => `<div class="stc-row"><span>${label}</span><div class="stc-ctrls">${ctrls}</div></div>`;
  const crow = (checkbox, label, ctrls) =>
    `<div class="stc-row"><label class="stc-lbl">${checkbox}<span>${label}</span></label><div class="stc-ctrls">${ctrls || ''}</div></div>`;

  function timeframeList() {
    if (typeof TIMEFRAMES !== 'undefined' && Array.isArray(TIMEFRAMES)) {
      return TIMEFRAMES.map((t) => [t.value, t.label || t.value]);
    }
    return ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map((v) => [v, v]);
  }

  function refreshTopEdge() {
    const b = document.body;
    b.style.transform = 'translateZ(0)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        b.style.transform = '';
        window.scrollTo(0, 0);
      });
    });
  }

  function open(paneId) {
    const pid = paneId || (typeof Store !== 'undefined' ? Store.getState().activePaneId : null);
    const inst = window.PaneRegistry && window.PaneRegistry.get(pid);
    if (!inst || !inst.setStructure) return;
    ensureCss();

    const cfg0 = inst.getStructureConfig();
    const tfList = timeframeList();

    const backdrop = document.createElement('div');
    backdrop.className = 'stc-backdrop';
    backdrop.innerHTML = `
      <div class="stc-modal">
        <div class="stc-head"><span class="stc-title">Cấu Trúc</span><button type="button" class="stc-x">${iconHTML('close')}</button></div>
        <div class="stc-tabs">
          <button type="button" class="stc-tab active" data-t="inputs">Inputs</button>
          <button type="button" class="stc-tab" data-t="style">Style</button>
          <button type="button" class="stc-tab" data-t="vis">Visibility</button>
        </div>
        <div class="stc-body">
          <div class="stc-pane active" data-p="inputs"></div>
          <div class="stc-pane" data-p="style"></div>
          <div class="stc-pane" data-p="vis"></div>
        </div>
        <div class="stc-foot">
          <select class="stc-sel" id="stcTpl"><option value="">Defaults</option><option value="reset">Đặt lại mặc định</option></select>
          <div class="stc-group">
            <button type="button" class="stc-btn" id="stcCancel">Cancel</button>
            <button type="button" class="stc-btn primary" id="stcOk">Ok</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    if (typeof SelectFix !== 'undefined') SelectFix.attach(backdrop);

    const q = (s) => backdrop.querySelector(s);
    const qa = (s) => Array.from(backdrop.querySelectorAll(s));

    function fill(c) {
      const st = c.style;

      // ---------- INPUTS ----------
      q('[data-p="inputs"]').innerHTML =
        secTitle('Cấu trúc thị trường') +
        row('Số nến mỗi bên (pivot)', num(c.pivLen, 110, 'id="inPiv" min="1" max="50"')) +
        hint('Đỉnh/đáy chỉ được xác nhận sau khi đủ số nến này đóng ở bên phải.') +
        row('Kiểu phá vỡ', sel([['close', 'Đóng nến (Candle Close)'], ['wick', 'Râu nến (Wick)']], c.brkMode, 'id="inBrk"')) +
        crow(chk(c.showPiv, 'id="inShowPiv"'), 'Hiện nhãn HH / HL / LH / LL') +
        crow(chk(c.showBrk, 'id="inShowBrk"'), 'Hiện BOS / CHoCH') +
        crow(chk(c.showChochBg, 'id="inChochBg"'), 'Tô nền cột nến khi CHoCH') +
        hint('BOS: phá đỉnh/đáy theo đúng xu hướng hiện tại. CHoCH: phá ngược xu hướng (tín hiệu đảo chiều đầu tiên).') +
        secTitle('Dải biến động') +
        crow(chk(c.showBands, 'id="inShowBands"'), 'Hiện dải hỗ trợ / kháng cự') +
        row('WMA (đường giữa)', num(c.wmaLen, 110, 'id="inWma" min="1"')) +
        row('ATR', num(c.atrLen, 110, 'id="inAtr" min="1"')) +
        row('SMA làm mượt ATR', num(c.smoothLen, 110, 'id="inSmooth" min="1"')) +
        row('Hệ số nhân', num(c.bandMult, 110, 'id="inMult" min="0.1" step="0.1"')) +
        crow(chk(c.showMid, 'id="inShowMid"'), 'Hiện đường giữa WMA') +
        hint('Xu hướng tăng chỉ hiện dải dưới (hỗ trợ), xu hướng giảm chỉ hiện dải trên (kháng cự).');

      // ---------- STYLE ----------
      q('[data-p="style"]').innerHTML =
        secTitle('Màu sắc') +
        row('Tăng (HH, HL, BOS/CHoCH tăng, dải hỗ trợ)', col(st.upColor, 'id="sUp"')) +
        row('Giảm (LH, LL, BOS/CHoCH giảm, dải kháng cự)', col(st.downColor, 'id="sDn"')) +
        row('Đường giữa WMA', col(st.midColor, 'id="sMid"')) +
        secTitle('Nét vẽ') +
        row('Độ dày dải', sel([0.5, 1, 1.5, 2, 3, 4, 5, 6].map((w) => [w, w + 'px']), st.bandWidth, 'id="sBandW"')) +
        row('Độ dày đường BOS / CHoCH', sel([0.5, 1, 1.5, 2, 3, 4].map((w) => [w, w + 'px']), st.lineWidth, 'id="sLineW"')) +
        row('Kiểu đường BOS / CHoCH', sel([['solid', 'Liền'], ['dashed', 'Đứt'], ['dotted', 'Chấm']], st.lineStyle, 'id="sLineS"')) +
        row('Cỡ chữ nhãn', sel([8, 9, 10, 11, 12, 14, 16].map((w) => [w, w + 'px']), st.labelSize, 'id="sLabelS"')) +
        row('Độ đậm nền CHoCH', rng(st.bgAlpha, 'id="sBgA"'));

      // ---------- VISIBILITY ----------
      const active = c.tfs || tfList.map((t) => t[0]);
      q('[data-p="vis"]').innerHTML =
        hint('Chỉ hiện chỉ báo ở các khung thời gian được chọn.') +
        tfList.map(([v, label]) => crow(chk(active.includes(v), `class="stc-tf" value="${esc(v)}"`), esc(label))).join('');
    }

    fill(cfg0);

    qa('.stc-tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        qa('.stc-tab').forEach((t) => t.classList.toggle('active', t === tab));
        qa('.stc-pane').forEach((p) => p.classList.toggle('active', p.dataset.p === tab.dataset.t));
      })
    );

    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      refreshTopEdge();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close();
    });
    q('.stc-x').addEventListener('click', close);
    q('#stcCancel').addEventListener('click', close);

    q('#stcTpl').addEventListener('change', (e) => {
      if (e.target.value === 'reset') fill(StructureModule.getDefaults());
      e.target.value = '';
    });

    q('#stcOk').addEventListener('click', () => {
      const int = (id, def) => {
        const v = parseInt(q(id).value, 10);
        return Number.isFinite(v) ? v : def;
      };
      const flt = (id, def) => {
        const v = parseFloat(q(id).value);
        return Number.isFinite(v) ? v : def;
      };
      const tfBoxes = qa('.stc-tf');
      const picked = tfBoxes.filter((c) => c.checked).map((c) => c.value);

      inst.setStructure({
        pivLen: int('#inPiv', 5),
        brkMode: q('#inBrk').value,
        showPiv: q('#inShowPiv').checked,
        showBrk: q('#inShowBrk').checked,
        showChochBg: q('#inChochBg').checked,
        showBands: q('#inShowBands').checked,
        wmaLen: int('#inWma', 100),
        atrLen: int('#inAtr', 14),
        smoothLen: int('#inSmooth', 21),
        bandMult: flt('#inMult', 2),
        showMid: q('#inShowMid').checked,
        style: {
          upColor: q('#sUp').value,
          downColor: q('#sDn').value,
          midColor: q('#sMid').value,
          bandWidth: flt('#sBandW', 3),
          lineWidth: flt('#sLineW', 1),
          lineStyle: q('#sLineS').value,
          labelSize: int('#sLabelS', 10),
          bgAlpha: int('#sBgA', 15) / 100,
        },
        tfs: picked.length === 0 || picked.length === tfBoxes.length ? null : picked,
      });

      if (typeof IndicatorLegend !== 'undefined') IndicatorLegend.render(pid, inst);
      close();
    });
  }

  return { open };
})();