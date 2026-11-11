/**
 * breakout-ui.js
 * Hộp thoại cài đặt chế độ tín hiệu "Breakout" kiểu TradingView (Inputs / Style / Visibility),
 * cùng phong cách với ma-signal-ui.js và rsi-ui.js.
 * Dùng: BreakoutUI.open(paneId)
 */
const BreakoutUI = (function () {
  const CSS = `
.bko-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center}
.bko-modal{width:520px;max-width:94vw;max-height:90vh;display:flex;flex-direction:column;background:var(--bg-elevated,#1e222d);color:var(--text-primary,#d1d4dc);border:1px solid var(--border-color,rgba(128,128,128,.35));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.5);overflow:hidden}
.bko-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px 6px}
.bko-title{font-size:20px;font-weight:700}
.bko-x{background:transparent;border:none;color:inherit;font-size:26px;cursor:pointer;width:32px;height:32px;border-radius:6px}
.bko-x svg{width:18px;height:18px;display:block;margin:auto}
.bko-tabs{display:flex;gap:22px;padding:0 20px;border-bottom:1px solid var(--border-color,rgba(128,128,128,.3))}
.bko-tab{background:transparent;border:none;color:var(--text-secondary,#9aa3b8);padding:10px 0;font-size:14px;font-weight:600;cursor:pointer;position:relative}
.bko-tab.active{color:inherit}
.bko-tab.active::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:currentColor}
.bko-body{padding:10px 20px 14px;overflow-y:auto;flex:1}
.bko-pane{display:none;flex-direction:column;gap:10px}
.bko-pane.active{display:flex}
.bko-sec{font-size:11px;letter-spacing:.04em;color:var(--text-secondary,#9aa3b8);margin-top:8px;text-transform:uppercase}
.bko-hint{font-size:11.5px;color:var(--text-secondary,#9aa3b8);line-height:1.45;font-style:italic}
.bko-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px;min-height:34px}
.bko-lbl{display:flex;align-items:center;gap:10px;cursor:pointer}
.bko-ctrls{display:flex;align-items:center;gap:8px}
.bko-row input[type=checkbox]{width:17px;height:17px;accent-color:var(--accent-blue,#2962ff);cursor:pointer}
.bko-num{padding:7px 10px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:14px;outline:none}
.bko-num:focus,.bko-sel:focus{border-color:var(--accent-blue,#2962ff)}
.bko-col{width:34px;height:28px;padding:0;border:1px solid var(--border-color,rgba(128,128,128,.4));border-radius:6px;background:transparent;cursor:pointer}
.bko-sel{padding:6px 8px;border-radius:8px;border:1px solid var(--border-color,rgba(128,128,128,.4));background:var(--bg-main,#12151c);color:inherit;font-size:13px;outline:none;max-width:230px}
.bko-range{width:90px;accent-color:var(--accent-blue,#2962ff)}
.bko-foot{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid var(--border-color,rgba(128,128,128,.3))}
.bko-btn{padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid var(--border-color,rgba(128,128,128,.5));background:transparent;color:inherit}
.bko-btn.primary{background:var(--accent-blue,#2962ff);border-color:var(--accent-blue,#2962ff);color:var(--on-accent,#fff)}
.bko-btn.small{padding:4px 10px;font-size:12px;display:inline-flex;align-items:center;gap:5px}
.bko-btn.small svg{width:13px;height:13px}
.bko-group{display:flex;gap:10px}
`;

  const SIGNAL_TFS = [['5m', 'M5'], ['15m', 'M15'], ['30m', 'M30'], ['1h', 'H1'], ['2h', 'H2']];
  const PANE_DEFAULTS = { lookbackCandles: 2, slMode: 'entry', slTimeframe: null };

  function ensureCss() {
    if (document.getElementById('breakout-ui-css')) return;
    const st = document.createElement('style');
    st.id = 'breakout-ui-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const esc = (v) => String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const num = (val, w, attrs) => `<input type="number" step="any" class="bko-num" style="width:${w}px" value="${esc(val)}" ${attrs || ''}>`;
  const col = (val, attrs) => `<input type="color" class="bko-col" value="${val}" ${attrs || ''}>`;
  const chk = (on, attrs) => `<input type="checkbox" ${on ? 'checked' : ''} ${attrs || ''}>`;
  const rng = (val, attrs) => `<input type="range" class="bko-range" min="0" max="40" value="${Math.round(val * 100)}" ${attrs || ''}>`;
  const sel = (opts, cur, attrs) =>
    `<select class="bko-sel" ${attrs || ''}>${opts
      .map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`)
      .join('')}</select>`;
  const secTitle = (t) => `<div class="bko-sec">${t}</div>`;
  const hint = (t) => `<div class="bko-hint">${t}</div>`;
  const row = (label, ctrls, cond) =>
    `<div class="bko-row"${cond ? ` data-cond="${cond}"` : ''}><span>${label}</span><div class="bko-ctrls">${ctrls}</div></div>`;
  const crow = (checkbox, label, ctrls, cond) =>
    `<div class="bko-row"${cond ? ` data-cond="${cond}"` : ''}><label class="bko-lbl">${checkbox}<span>${label}</span></label><div class="bko-ctrls">${ctrls || ''}</div></div>`;

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

  function open(paneId) {
    const pid = paneId || (typeof Store !== 'undefined' ? Store.getState().activePaneId : null);
    const inst = window.PaneRegistry && window.PaneRegistry.get(pid);
    if (!inst || !inst.setBreakoutSettings) return;
    ensureCss();

    const cfg0 = inst.getBreakoutSettings();
    const pane0 = (Store.getPaneBreakoutConfig && Store.getPaneBreakoutConfig(pid)) || PANE_DEFAULTS;
    const mode0 = Store.getPaneSignalMode ? Store.getPaneSignalMode(pid) : 'breakout';
    const slTfList = timeframeList(pane0.slTimeframe);

    const backdrop = document.createElement('div');
    backdrop.className = 'bko-backdrop';
    backdrop.innerHTML = `
      <div class="bko-modal">
        <div class="bko-head"><span class="bko-title">BUY/SELL · Breakout</span><button type="button" class="bko-x">${iconHTML('close')}</button></div>
        <div class="bko-tabs">
          <button type="button" class="bko-tab active" data-t="inputs">Inputs</button>
          <button type="button" class="bko-tab" data-t="style">Style</button>
          <button type="button" class="bko-tab" data-t="vis">Visibility</button>
        </div>
        <div class="bko-body">
          <div class="bko-pane active" data-p="inputs"></div>
          <div class="bko-pane" data-p="style"></div>
          <div class="bko-pane" data-p="vis"></div>
        </div>
        <div class="bko-foot">
          <select class="bko-sel" id="bkoTpl"><option value="">Defaults</option><option value="reset">Đặt lại mặc định</option></select>
          <div class="bko-group">
            <button type="button" class="bko-btn" id="bkoCancel">Cancel</button>
            <button type="button" class="bko-btn primary" id="bkoOk">Ok</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    if (typeof SelectFix !== 'undefined') SelectFix.attach(backdrop);

    const q = (s) => backdrop.querySelector(s);
    const qa = (s) => Array.from(backdrop.querySelectorAll(s));

    const updateCond = () => {
      const slEl = q('#bkoSl');
      const flipEl = q('#inFlip');
      const exitEl = q('#bkoExit');
      if (!slEl || !flipEl || !exitEl) return;
      const state = { sl: slEl.value, flip: flipEl.checked ? '1' : '0', exit: exitEl.value };
      qa('[data-cond]').forEach((el) => {
        const [k, v] = el.dataset.cond.split(':');
        el.style.display = state[k] === v ? '' : 'none';
      });
    };

    function fill(c, pane, mode) {
      const st = c.style;
      const enabledTFs = (Store.getEnabledSignalTimeframes && Store.getEnabledSignalTimeframes()) || [];
      const trailList = timeframeList(c.trailTf);

      // ---------- INPUTS ----------
      q('[data-p="inputs"]').innerHTML =
        secTitle('Chế độ') +
        row('Chế độ tín hiệu BUY/SELL', sel([['breakout', 'Breakout (mặc định)'], ['ma', 'MA Tự Co Giãn']], mode, 'id="bkoMode"')) +
        hint('Chọn "MA Tự Co Giãn" rồi bấm Ok; bấm ⚙ lần nữa để chỉnh các thông số của chế độ đó.') +
        secTitle('Vùng breakout') +
        row('Số nến khung trend', num(pane.lookbackCandles, 110, 'id="inLookback" min="1" max="20"')) +
        hint('BUY/SELL khi nến khung vào lệnh ĐÓNG cửa vượt đỉnh / thủng đáy của N nến khung trend gần nhất. Khung trend tự suy ra từ khung chart (vd H1 → D1).') +
        secTitle('Cắt lỗ ban đầu (ATR)') +
        row('Nguồn tính ATR', sel([['entry', 'Khung vào lệnh (mặc định)'], ['higher', 'Khung trend'], ['custom', 'Khung tuỳ chọn riêng']], pane.slMode, 'id="bkoSl"')) +
        row('Khung tính ATR', sel(slTfList, pane.slTimeframe || '1h', 'id="inSlTf"'), 'sl:custom') +
        row('ATR period', num(c.atrPeriod, 110, 'id="inAtrP" min="1"')) +
        row('ATR multiplier', num(c.atrMultiplier, 110, 'id="inAtrM" min="0.1" step="0.1"')) +
        hint('SL = giá vào ∓ ATR × hệ số. Ví dụ: vào lệnh M5, SL tính ATR theo H1.') +
        secTitle('Quản lý SL') +
        row('Cách quản lý SL', sel([['trail', 'Trailing SL'], ['fixed', 'SL cố định']], c.exitMode, 'id="bkoExit"')) +
        row('Khung nến trailing', sel(trailList, c.trailTf, 'id="inTrailTf"'), 'exit:trail') +
        crow(chk(c.onlyProfit, 'id="inOnlyProfit"'), 'Chỉ dịch SL khi SL mới nằm trên giá vào (khoá lời)', '', 'exit:trail') +
        hint('Trailing: mỗi khi 1 nến của khung đã chọn đóng, SL dời tới đáy (BUY) / đỉnh (SELL) của nến đó, chỉ dời theo hướng có lợi.') +
        secTitle('Thoát lệnh') +
        crow(chk(c.closeOnFlip, 'id="inFlip"'), 'Đóng lệnh khi MACD đổi phe ngược') +
        row('MACD Fast EMA', num(c.macdFast, 110, 'id="inMFast" min="1"'), 'flip:1') +
        row('MACD Slow EMA', num(c.macdSlow, 110, 'id="inMSlow" min="1"'), 'flip:1') +
        row('MACD Signal EMA', num(c.macdSig, 110, 'id="inMSig" min="1"'), 'flip:1') +
        hint('Khi MACD đổi phe ngược chiều lệnh đang mở, lệnh ảo được đóng tại giá đóng cửa của nến đó. Sau khi đóng, tín hiệu breakout kế tiếp mới được vào (không vào lại cùng chiều ngay trên nến đóng). Bật "Hiện điểm thoát" ở tab Style để thấy chỗ đóng lệnh.') +
        secTitle('Thông báo tín hiệu') +
        hint('Chọn các khung thời gian muốn nhận thông báo (kèm âm thanh chuông) khi có tín hiệu BUY/SELL mới. Cần đăng nhập.') +
        SIGNAL_TFS.map(([v, l]) => crow(chk(enabledTFs.includes(v), `class="bko-ntf" value="${v}"`), l)).join('') +
        `<div><button type="button" class="bko-btn small" id="bkoSound">${iconHTML('volume')}<span>Thử âm thanh chuông</span></button></div>`;

      // ---------- STYLE ----------
      q('[data-p="style"]').innerHTML =
        secTitle('Tín hiệu') +
        row('Màu BUY', col(st.buyColor, 'id="sBuy"')) +
        row('Màu SELL', col(st.sellColor, 'id="sSell"')) +
        crow(chk(st.showLabels, 'id="sLabels"'), 'Hiện nhãn BUY / SELL') +
        secTitle('Entry / SL') +
        crow(chk(st.showEntry, 'id="sShowEntry"'), 'Đường giá vào', col(st.entryColor, 'id="sEntry"')) +
        crow(chk(st.showSl, 'id="sShowSl"'), 'Đường SL (bậc thang theo trailing)', col(st.slColor, 'id="sSl"')) +
        row('Độ dày đường', sel([1, 2, 3, 4].map((w) => [w, w + 'px']), st.lineWidth, 'id="sLw"')) +
        crow(chk(st.showZones, 'id="sZones"'), 'Tô nền vùng rủi ro / lợi nhuận', rng(st.zoneAlpha, 'id="sZoneA"')) +
        secTitle('Điểm thoát lệnh') +
        crow(chk(st.showExit, 'id="sShowExit"'), 'Hiện điểm thoát lệnh (chạm SL / đảo lệnh / MACD đổi phe)') +
        crow(chk(st.showResult, 'id="sResult"'), 'Hiện kết quả lệnh (theo R)') +
        row('Màu khi thắng (điểm thoát / SL đã khoá lời)', col(st.tpColor, 'id="sWin"')) +
        hint('Điểm thoát khi thua dùng màu của đường SL.');

      // ---------- VISIBILITY ----------
      const visList = timeframeList(null);
      const active = c.tfs || visList.map((t) => t[0]);
      q('[data-p="vis"]').innerHTML =
        hint('Chỉ hiện tín hiệu ở các khung thời gian được chọn.') +
        visList.map(([v, label]) => crow(chk(active.includes(v), `class="bko-tf" value="${esc(v)}"`), esc(label))).join('');

      updateCond();
    }

    // Nếu có lỗi khi dựng nội dung: hiện lỗi ngay trong hộp thoại (và console) thay vì để trống
    function safeFill(c, pane, mode) {
      try {
        fill(c, pane, mode);
      } catch (err) {
        console.error('[BreakoutUI] Lỗi dựng hộp thoại:', err);
        q('[data-p="inputs"]').innerHTML = `<div class="bko-hint" style="font-style:normal;color:#ef5350">Lỗi: ${esc(err && err.message)}</div>`;
      }
    }

    safeFill(cfg0, pane0, mode0);
    backdrop.addEventListener('change', updateCond);

    backdrop.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('#bkoSound') && typeof NotificationsModule !== 'undefined') {
        NotificationsModule.playSound();
      }
    });

    qa('.bko-tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        qa('.bko-tab').forEach((t) => t.classList.toggle('active', t === tab));
        qa('.bko-pane').forEach((p) => p.classList.toggle('active', p.dataset.p === tab.dataset.t));
      })
    );

    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
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
    q('.bko-x').addEventListener('click', close);
    q('#bkoCancel').addEventListener('click', close);

    q('#bkoTpl').addEventListener('change', (e) => {
      if (e.target.value === 'reset') safeFill(BreakoutModule.getDefaults(), PANE_DEFAULTS, q('#bkoMode') ? q('#bkoMode').value : 'breakout');
      e.target.value = '';
    });

    q('#bkoOk').addEventListener('click', () => {
      const int = (id, def) => {
        const v = parseInt(q(id).value, 10);
        return Number.isFinite(v) ? v : def;
      };
      const flt = (id, def) => {
        const v = parseFloat(q(id).value);
        return Number.isFinite(v) ? v : def;
      };
      const tfBoxes = qa('.bko-tf');
      const picked = tfBoxes.filter((c) => c.checked).map((c) => c.value);

      const slMode = q('#bkoSl').value;
      const lookback = Math.min(20, Math.max(1, int('#inLookback', 2)));

      const next = {
        atrPeriod: int('#inAtrP', 14),
        atrMultiplier: flt('#inAtrM', 2.5),
        exitMode: q('#bkoExit').value,
        trailTf: q('#inTrailTf').value,
        onlyProfit: q('#inOnlyProfit').checked,
        closeOnFlip: q('#inFlip').checked,
        macdFast: int('#inMFast', 44),
        macdSlow: int('#inMSlow', 88),
        macdSig: int('#inMSig', 62),
        style: {
          buyColor: q('#sBuy').value,
          sellColor: q('#sSell').value,
          slColor: q('#sSl').value,
          tpColor: q('#sWin').value,
          entryColor: q('#sEntry').value,
          lineWidth: int('#sLw', 1),
          showLabels: q('#sLabels').checked,
          showEntry: q('#sShowEntry').checked,
          showSl: q('#sShowSl').checked,
          showZones: q('#sZones').checked,
          zoneAlpha: parseInt(q('#sZoneA').value, 10) / 100,
          showExit: q('#sShowExit').checked,
          showResult: q('#sResult').checked,
        },
        tfs: picked.length === 0 || picked.length === tfBoxes.length ? null : picked,
      };

      const selectedNtf = qa('.bko-ntf').filter((c) => c.checked).map((c) => c.value);
      const mode = q('#bkoMode').value;

      // Số nến / nguồn SL / khung SL nằm trong Store (đồng bộ nến khung SL do app.js lo)
      Store.setPaneBreakoutConfig(pid, {
        lookbackCandles: lookback,
        slMode,
        slTimeframe: slMode === 'custom' ? q('#inSlTf').value : null,
      });
      inst.setBreakoutSettings(next);
      if (Store.setEnabledSignalTimeframes) Store.setEnabledSignalTimeframes(selectedNtf);
      if (Store.setPaneSignalMode) Store.setPaneSignalMode(pid, mode);
      if (typeof IndicatorLegend !== 'undefined') IndicatorLegend.render(pid, inst);
      close();

      // Quyền thông báo / đăng nhập (giống popover cũ)
      if (selectedNtf.length > 0) {
        const guest =
          typeof LoginModule !== 'undefined' && LoginModule.getStoredUsername && !LoginModule.getStoredUsername();
        if (guest) {
          if (LoginModule.showLoginOverlay) {
            LoginModule.showLoginOverlay('Bạn đang ở vai trò Khách. Để nhận thông báo tín hiệu BUY/SELL riêng, vui lòng đăng nhập hoặc lập tài khoản.');
          }
        } else if (
          typeof NotificationsModule !== 'undefined' &&
          NotificationsModule.isSupported() &&
          NotificationsModule.getPermission() === 'default'
        ) {
          NotificationsModule.requestPermission();
        }
      }
    });
  }

  return { open };
})();