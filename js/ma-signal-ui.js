/**
 * ma-signal-ui.js
 * Hộp thoại cài đặt chế độ tín hiệu "MA Tự Co Giãn" kiểu TradingView (Inputs / Style / Visibility),
 * cùng phong cách với rsi-ui.js.
 * Dùng: MaSignalUI.open(paneId)
 */
const MaSignalUI = (function () {
  const CSS = `
.mas-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;overscroll-behavior:contain}
.mas-modal{width:520px;max-width:94vw;max-height:90vh;display:flex;flex-direction:column;background:var(--bg-elevated,#1e222d);color:var(--text-primary,#d1d4dc);border:1px solid var(--border-color,rgba(128,128,128,.35));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);overflow:hidden}
.mas-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 6px}
.mas-title{font-size:20px;font-weight:700}
.mas-x{background:transparent;border:none;color:inherit;font-size:26px;cursor:pointer;width:32px;height:32px;border-radius:6px}
.mas-x svg{width:18px;height:18px;display:block;margin:auto}
.mas-tabs{display:flex;gap:22px;padding:0 20px;border-bottom:1px solid var(--border-color,rgba(128,128,128,.3))}
.mas-tab{background:transparent;border:none;color:var(--text-secondary,#9aa3b8);padding:10px 0;font-size:14px;font-weight:600;cursor:pointer;position:relative}
.mas-tab.active{color:inherit}
.mas-tab.active::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:currentColor}
.mas-body{padding:10px 20px 14px;overflow-y:auto;flex:1}
.mas-pane{display:none;flex-direction:column;gap:10px}
.mas-pane.active{display:flex}
.mas-sec{font-size:11px;letter-spacing:.04em;color:var(--text-secondary,#9aa3b8);margin-top:8px;text-transform:uppercase}
.mas-hint{font-size:11.5px;color:var(--text-secondary,#9aa3b8);line-height:1.45;font-style:italic}
.mas-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px;min-height:34px}
.mas-lbl{display:flex;align-items:center;gap:10px;cursor:pointer}
.mas-ctrls{display:flex;align-items:center;gap:8px}
.mas-row input[type=checkbox]{width:17px;height:17px;accent-color:var(--accent-blue,#2962ff);cursor:pointer}
.mas-num{padding:7px 10px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:14px;outline:none}
.mas-num:focus,.mas-sel:focus{border-color:var(--accent-blue,#2962ff)}
.mas-col{width:34px;height:28px;padding:0;border:1px solid var(--border-color,rgba(128,128,128,.4));border-radius:6px;background:transparent;cursor:pointer}
.mas-sel{padding:6px 8px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:13px;outline:none;max-width:230px}
.mas-range{width:90px;accent-color:var(--accent-blue,#2962ff)}
.mas-foot{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--border-color,rgba(128,128,128,.3))}
.mas-btn{padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid var(--border-color,rgba(128,128,128,.5));background:transparent;color:inherit}
.mas-btn.primary{background:var(--accent-blue,#2962ff);border-color:var(--accent-blue,#2962ff);color:var(--on-accent,#fff)}
.mas-group{display:flex;gap:10px}
`;

  function ensureCss() {
    if (document.getElementById('ma-signal-ui-css')) return;
    const st = document.createElement('style');
    st.id = 'ma-signal-ui-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const num = (val, w, attrs) => `<input type="number" step="any" class="mas-num" style="width:${w}px" value="${esc(val)}" ${attrs || ''}>`;
  const col = (val, attrs) => `<input type="color" class="mas-col" value="${val}" ${attrs || ''}>`;
  const chk = (on, attrs) => `<input type="checkbox" ${on ? 'checked' : ''} ${attrs || ''}>`;
  const rng = (val, attrs) => `<input type="range" class="mas-range" min="0" max="40" value="${Math.round(val * 100)}" ${attrs || ''}>`;
  const sel = (opts, cur, attrs) =>
    `<select class="mas-sel" ${attrs || ''}>${opts
      .map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`)
      .join('')}</select>`;
  const secTitle = (t) => `<div class="mas-sec">${t}</div>`;
  const hint = (t) => `<div class="mas-hint">${t}</div>`;
  const row = (label, ctrls, cond) =>
    `<div class="mas-row"${cond ? ` data-cond="${cond}"` : ''}><span>${label}</span><div class="mas-ctrls">${ctrls}</div></div>`;
  const crow = (checkbox, label, ctrls, cond) =>
    `<div class="mas-row"${cond ? ` data-cond="${cond}"` : ''}><label class="mas-lbl">${checkbox}<span>${label}</span></label><div class="mas-ctrls">${ctrls || ''}</div></div>`;

  function timeframeList(current) {
    let list;
    if (typeof TIMEFRAMES !== 'undefined' && Array.isArray(TIMEFRAMES)) {
      list = TIMEFRAMES.map((t) => [t.value, t.label || t.value]);
    } else {
      list = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map((v) => [v, v]);
    }
    if (current && !list.some((t) => t[0] === current)) list.push([current, current]);
    return list;
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
    if (!inst || !inst.setMaSignal) return;
    ensureCss();

    const cfg0 = inst.getMaSignalConfig();
    const mode0 = typeof Store !== 'undefined' && Store.getPaneSignalMode ? Store.getPaneSignalMode(pid) : 'ma';
    const tfList = timeframeList(cfg0.trailTf);

    const backdrop = document.createElement('div');
    backdrop.className = 'mas-backdrop';
    backdrop.innerHTML = `
      <div class="mas-modal">
        <div class="mas-head"><span class="mas-title">BUY/SELL · MA Tự Co Giãn</span><button type="button" class="mas-x">${iconHTML('close')}</button></div>
        <div class="mas-tabs">
          <button type="button" class="mas-tab active" data-t="inputs">Inputs</button>
          <button type="button" class="mas-tab" data-t="style">Style</button>
          <button type="button" class="mas-tab" data-t="vis">Visibility</button>
        </div>
        <div class="mas-body">
          <div class="mas-pane active" data-p="inputs"></div>
          <div class="mas-pane" data-p="style"></div>
          <div class="mas-pane" data-p="vis"></div>
        </div>
        <div class="mas-foot">
          <select class="mas-sel" id="masTpl"><option value="">Defaults</option><option value="reset">Đặt lại mặc định</option></select>
          <div class="mas-group">
            <button type="button" class="mas-btn" id="masCancel">Cancel</button>
            <button type="button" class="mas-btn primary" id="masOk">Ok</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const q = (s) => backdrop.querySelector(s);
    const qa = (s) => Array.from(backdrop.querySelectorAll(s));

    const updateCond = () => {
      const state = { exit: q('#masExit').value, sl: q('#masSl').value };
      qa('[data-cond]').forEach((el) => {
        const [k, v] = el.dataset.cond.split(':');
        el.style.display = state[k] === v ? '' : 'none';
      });
    };

    function fill(c, mode) {
      const st = c.style;

      // ---------- INPUTS ----------
      q('[data-p="inputs"]').innerHTML =
        secTitle('Chế độ') +
        row('Chế độ tín hiệu BUY/SELL', sel([['breakout', 'Breakout (mặc định)'], ['ma', 'MA Tự Co Giãn']], mode, 'id="masMode"')) +
        hint('Tín hiệu vẽ cho mọi lịch sử: mỗi lệnh được mô phỏng từ lúc vào tới lúc thoát rồi mới tìm tín hiệu kế tiếp.') +
        secTitle('MACD (xác định phe)') +
        row('Fast EMA', num(c.fastLen, 110, 'id="inFast" min="1"')) +
        row('Slow EMA', num(c.slowLen, 110, 'id="inSlow" min="1"')) +
        row('Signal EMA', num(c.sigLen, 110, 'id="inSig" min="1"')) +
        secTitle('MA tự co giãn') +
        row('Độ dài cơ sở', num(c.baseLen, 110, 'id="inBase" min="1"')) +
        row('Độ dài tối đa', num(c.maxLen, 110, 'id="inMax" min="1"')) +
        crow(chk(c.showMa, 'id="inShowMa"'), 'Hiện đường MA trên chart') +
        secTitle('Cắt lỗ ban đầu') +
        row('Cách đặt SL', sel([['swing', 'Đáy/đỉnh N nến'], ['atr', 'ATR × hệ số']], c.slMode, 'id="masSl"')) +
        row('Số nến (đáy/đỉnh)', num(c.slBars, 110, 'id="inSlBars" min="1"'), 'sl:swing') +
        row('ATR period', num(c.atrPeriod, 110, 'id="inAtrP" min="1"'), 'sl:atr') +
        row('ATR multiplier', num(c.atrMult, 110, 'id="inAtrM" min="0.1" step="0.1"'), 'sl:atr') +
        secTitle('Thoát lệnh') +
        row('Cách thoát', sel([['trail', 'Trailing SL'], ['tp', 'Chốt lời cố định (TP)']], c.exitMode, 'id="masExit"')) +
        row('TP (số lần R)', num(c.rr, 110, 'id="inRr" min="0.1" step="0.1"'), 'exit:tp') +
        row('Khung nến trailing', sel(tfList, c.trailTf, 'id="inTrailTf"'), 'exit:trail') +
        crow(chk(c.onlyProfit, 'id="inOnlyProfit"'), 'Chỉ dịch SL khi SL mới nằm trên giá vào (khóa lời)', '', 'exit:trail') +
        hint('Trailing: mỗi khi 1 nến của khung đã chọn đóng, SL dời tới đáy (lệnh Buy) hoặc đỉnh (lệnh Sell) của nến đó, chỉ dời theo hướng có lợi.') +
        crow(chk(c.closeOnFlip, 'id="inFlip"'), 'Đóng lệnh khi MACD đổi phe ngược');

      // ---------- STYLE ----------
      q('[data-p="style"]').innerHTML =
        secTitle('Tín hiệu') +
        row('Màu BUY', col(st.buyColor, 'id="sBuy"')) +
        row('Màu SELL', col(st.sellColor, 'id="sSell"')) +
        crow(chk(st.showLabels, 'id="sLabels"'), 'Hiện nhãn BUY / SELL') +
        crow(chk(st.showResult, 'id="sResult"'), 'Hiện kết quả lệnh (theo R)') +
        secTitle('Đường MA') +
        row('Màu khi phe tăng', col(st.maBullColor, 'id="sMaBull"')) +
        row('Màu khi phe giảm', col(st.maBearColor, 'id="sMaBear"')) +
        row('Độ dày', sel([1, 2, 3, 4].map((w) => [w, w + 'px']), st.maWidth, 'id="sMaW"')) +
        secTitle('Entry / SL / TP') +
        crow(chk(st.showEntry, 'id="sShowEntry"'), 'Đường giá vào', col(st.entryColor, 'id="sEntry"')) +
        crow(chk(st.showSl, 'id="sShowSl"'), 'Đường SL', col(st.slColor, 'id="sSl"')) +
        crow(chk(st.showTp, 'id="sShowTp"'), 'Đường TP', col(st.tpColor, 'id="sTp"')) +
        row('Độ dày đường', sel([1, 2, 3, 4].map((w) => [w, w + 'px']), st.lineWidth, 'id="sLw"')) +
        crow(chk(st.showZones, 'id="sZones"'), 'Tô nền vùng rủi ro / lợi nhuận', rng(st.zoneAlpha, 'id="sZoneA"'));

      // ---------- VISIBILITY ----------
      const active = c.tfs || tfList.map((t) => t[0]);
      q('[data-p="vis"]').innerHTML =
        hint('Chỉ hiện tín hiệu ở các khung thời gian được chọn.') +
        tfList.map(([v, label]) => crow(chk(active.includes(v), `class="mas-tf" value="${esc(v)}"`), esc(label))).join('');

      updateCond();
    }

    fill(cfg0, mode0);
    backdrop.addEventListener('change', updateCond);

    qa('.mas-tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        qa('.mas-tab').forEach((t) => t.classList.toggle('active', t === tab));
        qa('.mas-pane').forEach((p) => p.classList.toggle('active', p.dataset.p === tab.dataset.t));
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
    q('.mas-x').addEventListener('click', close);
    q('#masCancel').addEventListener('click', close);

    q('#masTpl').addEventListener('change', (e) => {
      if (e.target.value === 'reset') fill(MaSignalModule.getDefaults(), q('#masMode').value);
      e.target.value = '';
    });

    q('#masOk').addEventListener('click', () => {
      const int = (id, def) => {
        const v = parseInt(q(id).value, 10);
        return Number.isFinite(v) ? v : def;
      };
      const flt = (id, def) => {
        const v = parseFloat(q(id).value);
        return Number.isFinite(v) ? v : def;
      };
      const tfBoxes = qa('.mas-tf');
      const picked = tfBoxes.filter((c) => c.checked).map((c) => c.value);

      const next = {
        fastLen: int('#inFast', 44),
        slowLen: int('#inSlow', 88),
        sigLen: int('#inSig', 62),
        baseLen: int('#inBase', 50),
        maxLen: int('#inMax', 350),
        showMa: q('#inShowMa').checked,
        slMode: q('#masSl').value,
        slBars: int('#inSlBars', 75),
        atrPeriod: int('#inAtrP', 14),
        atrMult: flt('#inAtrM', 2),
        exitMode: q('#masExit').value,
        rr: flt('#inRr', 3.3),
        trailTf: q('#inTrailTf').value,
        onlyProfit: q('#inOnlyProfit').checked,
        closeOnFlip: q('#inFlip').checked,
        style: {
          buyColor: q('#sBuy').value,
          sellColor: q('#sSell').value,
          maBullColor: q('#sMaBull').value,
          maBearColor: q('#sMaBear').value,
          maWidth: int('#sMaW', 2),
          slColor: q('#sSl').value,
          tpColor: q('#sTp').value,
          entryColor: q('#sEntry').value,
          lineWidth: int('#sLw', 1),
          showEntry: q('#sShowEntry').checked,
          showSl: q('#sShowSl').checked,
          showTp: q('#sShowTp').checked,
          showZones: q('#sZones').checked,
          zoneAlpha: parseInt(q('#sZoneA').value, 10) / 100,
          showLabels: q('#sLabels').checked,
          showResult: q('#sResult').checked,
        },
        tfs: picked.length === 0 || picked.length === tfBoxes.length ? null : picked,
      };

      inst.setMaSignal(next);
      if (typeof Store !== 'undefined' && Store.setPaneSignalMode) Store.setPaneSignalMode(pid, q('#masMode').value);
      if (typeof IndicatorLegend !== 'undefined') IndicatorLegend.render(pid, inst);
      close();
    });
  }

  return { open };
})();