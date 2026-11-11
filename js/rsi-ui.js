/**
 * rsi-ui.js
 * Hộp thoại cài đặt "RSI By NĐQ" kiểu TradingView (Inputs / Style / Visibility).
 * Dùng: RsiNdqUI.open(paneId)
 */
const RsiNdqUI = (function () {
  const KEYS = [['rsi', 'RSI'], ['emaRsi', 'EMA'], ['wmaRsi', 'WMA']];
  const DEFAULT_LINES = {
    rsi: { period: 14, color: '#9c27b0', width: 1 },
    emaRsi: { period: 9, color: '#2962ff', width: 1 },
    wmaRsi: { period: 45, color: '#ff9800', width: 1 },
  };
  const STYLES = [['solid', 'Liền'], ['dashed', 'Đứt'], ['dotted', 'Chấm']];
  const SOURCES = [['close', 'Close'], ['open', 'Open'], ['high', 'High'], ['low', 'Low']];

  const CSS = `
.ndq-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center}
.ndq-modal{width:520px;max-width:94vw;max-height:90vh;display:flex;flex-direction:column;background:var(--bg-elevated,#1e222d);color:var(--text-primary,#d1d4dc);border:1px solid var(--border-color,rgba(128,128,128,.35));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);overflow:hidden}
.ndq-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 6px}
.ndq-title{font-size:20px;font-weight:700}
.ndq-x{background:transparent;border:none;color:inherit;font-size:26px;cursor:pointer;width:32px;height:32px;border-radius:6px}
.ndq-tabs{display:flex;gap:22px;padding:0 20px;border-bottom:1px solid var(--border-color,rgba(128,128,128,.3))}
.ndq-tab{background:transparent;border:none;color:var(--text-secondary,#9aa3b8);padding:10px 0;font-size:14px;font-weight:600;cursor:pointer;position:relative}
.ndq-tab.active{color:inherit}
.ndq-tab.active::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:currentColor}
.ndq-body{padding:10px 20px 14px;overflow-y:auto;flex:1}
.ndq-pane{display:none;flex-direction:column;gap:10px}
.ndq-pane.active{display:flex}
.ndq-sec{font-size:11px;letter-spacing:.04em;color:var(--text-secondary,#9aa3b8);margin-top:8px;text-transform:uppercase}
.ndq-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px;min-height:34px}
.ndq-lbl{display:flex;align-items:center;gap:10px;cursor:pointer}
.ndq-ctrls{display:flex;align-items:center;gap:8px}
.ndq-row input[type=checkbox]{width:17px;height:17px;accent-color:var(--accent-blue,#2962ff);cursor:pointer}
.ndq-num{padding:7px 10px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:14px;outline:none}
.ndq-num:focus,.ndq-sel:focus{border-color:var(--accent-blue,#2962ff)}
.ndq-col{width:34px;height:28px;padding:0;border:1px solid var(--border-color,rgba(128,128,128,.4));border-radius:6px;background:transparent;cursor:pointer}
.ndq-sel{padding:6px 8px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:13px;outline:none}
.ndq-range{width:70px;accent-color:var(--accent-blue,#2962ff)}
.ndq-foot{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--border-color,rgba(128,128,128,.3))}
.ndq-btn{padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid var(--border-color,rgba(128,128,128,.5));background:transparent;color:inherit}
.ndq-btn.primary{background:var(--accent-blue,#2962ff);border-color:var(--accent-blue,#2962ff);color:#fff}
.ndq-group{display:flex;gap:10px}
.ndq-x svg{width:18px;height:18px;display:block;margin:auto}
`;

  function ensureCss() {
    if (document.getElementById('rsi-ndq-ui-css')) return;
    const st = document.createElement('style');
    st.id = 'rsi-ndq-ui-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const num = (cls, val, w, attrs) =>
    `<input type="number" step="any" class="ndq-num ${cls}" style="width:${w}px" value="${esc(val)}" ${attrs || ''}>`;
  const col = (cls, val, attrs) => `<input type="color" class="ndq-col ${cls}" value="${val}" ${attrs || ''}>`;
  const rng = (cls, a, attrs) =>
    `<input type="range" class="ndq-range ${cls}" min="0" max="100" value="${Math.round(a * 100)}" ${attrs || ''}>`;
  const chk = (cls, on, attrs) => `<input type="checkbox" class="${cls}" ${on ? 'checked' : ''} ${attrs || ''}>`;
  const sel = (cls, opts, cur, attrs) =>
    `<select class="ndq-sel ${cls}" ${attrs || ''}>${opts
      .map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`)
      .join('')}</select>`;
  const row = (label, ctrls) =>
    `<div class="ndq-row"><span>${label}</span><div class="ndq-ctrls">${ctrls}</div></div>`;
  const crow = (checkbox, label, ctrls) =>
    `<div class="ndq-row"><label class="ndq-lbl">${checkbox}<span>${label}</span></label><div class="ndq-ctrls">${ctrls || ''}</div></div>`;

  function timeframeList() {
    if (typeof TIMEFRAMES !== 'undefined' && Array.isArray(TIMEFRAMES)) {
      return TIMEFRAMES.map((t) => [t.value, t.label || t.value]);
    }
    return ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map((v) => [v, v]);
  }

  function open(paneId) {
    const pid = paneId || (typeof Store !== 'undefined' ? Store.getState().activePaneId : null);
    const inst = window.PaneRegistry && window.PaneRegistry.get(pid);
    if (!inst || !inst.setRsiExtras) return;
    ensureCss();

    const cfg = inst.getIndicatorConfig();
    const tfList = timeframeList();

    const backdrop = document.createElement('div');
    backdrop.className = 'ndq-backdrop';
    backdrop.innerHTML = `
      <div class="ndq-modal">
        <div class="ndq-head"><span class="ndq-title">RSI By NĐQ</span><button type="button" class="ndq-x">${iconHTML('close')}</button></div>
        <div class="ndq-tabs">
          <button type="button" class="ndq-tab active" data-t="inputs">Inputs</button>
          <button type="button" class="ndq-tab" data-t="style">Style</button>
          <button type="button" class="ndq-tab" data-t="vis">Visibility</button>
        </div>
        <div class="ndq-body">
          <div class="ndq-pane active" data-p="inputs"></div>
          <div class="ndq-pane" data-p="style"></div>
          <div class="ndq-pane" data-p="vis"></div>
        </div>
        <div class="ndq-foot">
          <select class="ndq-sel" id="ndqTpl"><option value="">Defaults</option><option value="reset">Đặt lại mặc định</option></select>
          <div class="ndq-group">
            <button type="button" class="ndq-btn" id="ndqCancel">Cancel</button>
            <button type="button" class="ndq-btn primary" id="ndqOk">Ok</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    if (typeof SelectFix !== 'undefined') SelectFix.attach(backdrop);

    const q = (s) => backdrop.querySelector(s);
    const qa = (s) => Array.from(backdrop.querySelectorAll(s));

    function fill(L, ex) {
      // ---------- INPUTS ----------
      q('[data-p="inputs"]').innerHTML =
        `<div class="ndq-sec">RSI</div>` +
        row('RSI Length', num('in-p', L.rsi.period, 110, 'data-k="rsi" min="1"')) +
        row('Source', sel('', SOURCES, ex.source, 'id="inSrc"')) +
        row('EMA Length', num('in-p', L.emaRsi.period, 110, 'data-k="emaRsi" min="1"')) +
        row('WMA Length', num('in-p', L.wmaRsi.period, 110, 'data-k="wmaRsi" min="1"')) +
        KEYS.map(([k, label]) => row(`${label} color`, col('in-c', L[k].color, `data-k="${k}" data-link="c-${k}"`))).join('') +
        `<div class="ndq-sec">PRICE LADDER</div>` +
        crow(chk('', ex.showLadder, 'id="inLadder"'), 'Show price ladder') +
        ex.levels.map((v, i) => row(`RSI level ${i + 1}`, num('in-lv', v, 110, `data-i="${i}" data-link="lv-${i}" min="1" max="99"`))).join('') +
        row('Text color', col('', ex.ladderColor, 'id="inLc"')) +
        row(`Text color for WMA${L.wmaRsi.period}`, col('', ex.ladderWmaColor, 'id="inLcw"')) +
        `<div class="ndq-sec">AUTO SNR</div>` +
        crow(chk('', ex.showSnr, 'id="inSnr"'), 'Enable') +
        ex.snrLookbacks.map((v, i) => row(`RSI SnR Lookback level ${i + 1}`, num('in-lb', v, 110, `data-i="${i}" min="2"`))).join('') +
        row('Support line', col('', ex.snrSupportColor, 'id="inSupC"') + rng('', ex.snrSupportAlpha, 'id="inSupA"')) +
        row('Resistance line', col('', ex.snrResistanceColor, 'id="inResC"') + rng('', ex.snrResistanceAlpha, 'id="inResA"'));

      // ---------- STYLE ----------
      const lineCtrls = (cls, l, attrs, link) =>
        col(`${cls}-c`, l.color, `${attrs} ${link || ''}`) +
        rng(`${cls}-a`, l.alpha, attrs) +
        sel(`${cls}-s`, STYLES, l.style, attrs);

      q('[data-p="style"]').innerHTML =
        KEYS.map(([k, label]) =>
          crow(
            chk('ln-en', L[k].enabled, `data-k="${k}"`),
            label,
            col('ln-c', L[k].color, `data-k="${k}" data-link="c-${k}"`) +
              sel('ln-w', [1, 2, 3, 4].map((w) => [w, w + 'px']), L[k].width, `data-k="${k}"`)
          )
        ).join('') +
        ex.levels.map((v, i) => {
          const l = ex.levelStyles[i];
          return crow(
            chk('lv-en', l.show, `data-i="${i}"`),
            `RSI level ${i + 1}`,
            lineCtrls('lv', l, `data-i="${i}"`) + num('lv-v', v, 60, `data-i="${i}" data-link="lv-${i}" min="1" max="99"`)
          );
        }).join('') +
        [['bandLow', 'RSI 30'], ['bandHigh', 'RSI 70']].map(([b, label]) => {
          const l = ex[b];
          return crow(
            chk('bd-en', l.show, `data-b="${b}"`),
            label,
            lineCtrls('bd', l, `data-b="${b}"`) + num('bd-v', l.value, 60, `data-b="${b}" min="1" max="99"`)
          );
        }).join('') +
        crow(chk('', ex.bg.show, 'id="bgEn"'), 'Hlines Background', col('', ex.bg.color, 'id="bgC"') + rng('', ex.bg.alpha, 'id="bgA"'));

      // ---------- VISIBILITY ----------
      const active = ex.tfs || tfList.map((t) => t[0]);
      q('[data-p="vis"]').innerHTML = tfList
        .map(([v, label]) => crow(chk('ndq-tf', active.includes(v), `value="${esc(v)}"`), esc(label)))
        .join('');
    }

    const lines0 = {};
    KEYS.forEach(([k]) => {
      lines0[k] = { enabled: cfg[k].enabled, period: cfg[k].period, color: cfg[k].color, width: cfg[k].width || 1 };
    });
    fill(lines0, cfg.rsiExtras);

    // Ô dùng chung giữa 2 tab (màu, giá trị mức RSI) luôn đồng bộ
    backdrop.addEventListener('input', (e) => {
      const l = e.target.dataset && e.target.dataset.link;
      if (!l) return;
      qa(`[data-link="${l}"]`).forEach((el) => { if (el !== e.target) el.value = e.target.value; });
    });

    qa('.ndq-tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        qa('.ndq-tab').forEach((t) => t.classList.toggle('active', t === tab));
        qa('.ndq-pane').forEach((p) => p.classList.toggle('active', p.dataset.p === tab.dataset.t));
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
    q('.ndq-x').addEventListener('click', close);
    q('#ndqCancel').addEventListener('click', close);

    q('#ndqTpl').addEventListener('change', (e) => {
      if (e.target.value === 'reset') {
        const L = {};
        KEYS.forEach(([k]) => { L[k] = { enabled: lines0[k].enabled, ...DEFAULT_LINES[k] }; });
        fill(L, ChartModule.getRsiDefaults());
      }
      e.target.value = '';
    });

    const alpha = (sel_) => parseInt(q(sel_).value, 10) / 100;

    q('#ndqOk').addEventListener('click', () => {
      const lines = {};
      KEYS.forEach(([k]) => {
        lines[k] = {
          enabled: q(`.ln-en[data-k="${k}"]`).checked,
          period: parseInt(q(`.in-p[data-k="${k}"]`).value, 10),
          color: q(`.ln-c[data-k="${k}"]`).value,
          width: parseInt(q(`.ln-w[data-k="${k}"]`).value, 10) || 1,
        };
      });
      const tfBoxes = qa('.ndq-tf');
      const picked = tfBoxes.filter((c) => c.checked).map((c) => c.value);
      const lineOf = (cls, attr, id) => ({
        show: q(`.${cls}-en[${attr}="${id}"]`).checked,
        color: q(`.${cls}-c[${attr}="${id}"]`).value,
        alpha: parseInt(q(`.${cls}-a[${attr}="${id}"]`).value, 10) / 100,
        style: q(`.${cls}-s[${attr}="${id}"]`).value,
      });
      const band = (b) => ({ ...lineOf('bd', 'data-b', b), value: parseFloat(q(`.bd-v[data-b="${b}"]`).value) });

      const ex = {
        source: q('#inSrc').value,
        levels: qa('.lv-v').map((i) => i.value),
        levelStyles: qa('.lv-v').map((_, i) => lineOf('lv', 'data-i', i)),
        bandLow: band('bandLow'),
        bandHigh: band('bandHigh'),
        bg: { show: q('#bgEn').checked, color: q('#bgC').value, alpha: alpha('#bgA') },
        showLadder: q('#inLadder').checked,
        ladderColor: q('#inLc').value,
        ladderWmaColor: q('#inLcw').value,
        showSnr: q('#inSnr').checked,
        snrLookbacks: qa('.in-lb').map((i) => i.value),
        snrSupportColor: q('#inSupC').value,
        snrSupportAlpha: alpha('#inSupA'),
        snrResistanceColor: q('#inResC').value,
        snrResistanceAlpha: alpha('#inResA'),
        tfs: picked.length === 0 || picked.length === tfBoxes.length ? null : picked,
      };

      KEYS.forEach(([k]) => {
        inst.setIndicatorStyle(k, { color: lines[k].color, width: lines[k].width });
        if (lines[k].period > 0) inst.setIndicatorPeriod(k, lines[k].period);
      });
      inst.setRsiExtras(ex);                                   // lưu tfs trước khi bật/tắt
      KEYS.forEach(([k]) => inst.setIndicatorVisible(k, lines[k].enabled));

      if (typeof IndicatorLegend !== 'undefined') IndicatorLegend.render(pid, inst);
      close();
    });
  }

  return { open };
})();