/**
 * ma-signal.js
 * Chế độ tín hiệu BUY/SELL "MA Tự Co Giãn" - mô phỏng ĐÚNG logic của EA MT5
 * và vẽ lên chart (CHỈ ĐỂ HIỂN THỊ, không đặt lệnh):
 *
 *  1. MACD = EMA(fast) - EMA(slow); tín hiệu = EMA(sig) của MACD  -> phe tăng/giảm
 *  2. Bộ đếm nhịp: mỗi nến cùng phe +1, đổi phe về 1
 *  3. MA tự co giãn: độ dài = min(base + đếm - 1, max), SMA của giá đóng cửa
 *  4. Vào lệnh khi MACD vừa đổi phe (tại giá mở cửa nến kế tiếp), CHỈ khi không còn lệnh cũ
 *     - Đóng lệnh do đổi phe ngược -> vào luôn lệnh ngược tại cùng giá
 *     - Bị quét SL mà MACD vẫn cùng phe -> vào lại cùng hướng (tuỳ chọn reentry)
 *  5. SL ban đầu: đáy/đỉnh N nến, hoặc ATR x hệ số
 *  6. Thoát lệnh: (a) TP cố định theo R, hoặc (b) Trailing SL theo đáy/đỉnh nến đóng
 *     của khung chọn được; tuỳ chọn đóng lệnh khi MACD đổi phe ngược
 *
 * Vẽ mọi tín hiệu trong lịch sử: mô phỏng lần lượt từng lệnh (vào -> SL dời -> thoát)
 * rồi mới tìm tín hiệu kế tiếp, giống hệt EA.
 *
 * API: create(paneId) -> { init, run, configure, getConfig, setVisible, isVisible,
 *                          setOnNewSignal, destroy }
 *      MaSignalModule.getDefaults(), needsExternalTrail(cfg, timeframe), tfSeconds(tf)
 */
const MaSignalModule = (function () {
  const DEFAULTS = {
    fastLen: 44,
    slowLen: 88,
    sigLen: 62,
    baseLen: 50,
    maxLen: 350,
    showMa: true,
    slMode: 'swing', // 'swing' = đáy/đỉnh N nến | 'atr' = ATR x hệ số
    slBars: 75,
    atrPeriod: 14,
    atrMult: 2,
    exitMode: 'trail', // 'trail' = Trailing SL | 'tp' = chốt lời cố định
    rr: 3.3,
    trailTf: '1h',
    onlyProfit: true, // chỉ dịch SL khi SL mới nằm trên giá vào (khoá lời)
    closeOnFlip: false, // đóng lệnh khi MACD đổi phe ngược
    reentry: true, // bị quét SL mà MACD chưa đổi phe -> vào lại cùng hướng
    backtest: false, // hiện bảng backtest: tổng R của mọi lệnh trên phần chart đã tải
    style: {
      buyColor: '#26a69a',
      sellColor: '#ef5350',
      maBullColor: '#f2a339',
      maBearColor: '#9aa3b8',
      maWidth: 2,
      slColor: '#ef5350',
      tpColor: '#26a69a',
      entryColor: '#787b86',
      lineWidth: 1,
      showEntry: true,
      showSl: true,
      showTp: true,
      showZones: true,
      zoneAlpha: 0.08,
      showLabels: true,
      showResult: true,
    },
    tfs: null, // null = hiện ở mọi khung; hoặc ['15m','1h',...]
  };

  // ===================== TIỆN ÍCH =====================
  const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

  function int(v, def, lo, hi) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  }

  function flt(v, def, lo, hi) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  }

  const bool = (v, def) => (v === undefined || v === null ? def : !!v);

  function hexToRgba(hex, a) {
    const h = isHex(hex) ? hex : '#888888';
    return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
  }

  /** '15m' -> 900, '1h' -> 3600, '1d' -> 86400, '1w', '1M' (tháng ~30 ngày). 0 nếu không hợp lệ. */
  function tfSeconds(tf) {
    const m = /^(\d+)([mhdwM])$/.exec(String(tf || ''));
    if (!m) return 0;
    const unit = { m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 }[m[2]];
    return parseInt(m[1], 10) * unit;
  }

  /** Khung trailing lớn hơn khung vào lệnh -> cần nến khung đó tải riêng. Ngược lại dùng chính nến khung vào lệnh. */
  function needsExternalTrail(cfg, timeframe) {
    const a = tfSeconds(cfg.trailTf);
    const b = tfSeconds(timeframe);
    return cfg.exitMode === 'trail' && b > 0 && a > b;
  }

  function sanitize(src) {
    const d = DEFAULTS;
    const s = src || {};
    const ss = s.style || {};
    const ds = d.style;
    const col = (k) => (isHex(ss[k]) ? ss[k] : ds[k]);
    const cfg = {
      fastLen: int(s.fastLen, d.fastLen, 1, 500),
      slowLen: int(s.slowLen, d.slowLen, 1, 500),
      sigLen: int(s.sigLen, d.sigLen, 1, 500),
      baseLen: int(s.baseLen, d.baseLen, 1, 1000),
      maxLen: int(s.maxLen, d.maxLen, 1, 2000),
      showMa: bool(s.showMa, d.showMa),
      slMode: s.slMode === 'atr' ? 'atr' : 'swing',
      slBars: int(s.slBars, d.slBars, 1, 1000),
      atrPeriod: int(s.atrPeriod, d.atrPeriod, 1, 200),
      atrMult: flt(s.atrMult, d.atrMult, 0.1, 50),
      exitMode: s.exitMode === 'tp' ? 'tp' : 'trail',
      rr: flt(s.rr, d.rr, 0.1, 50),
      trailTf: typeof s.trailTf === 'string' && tfSeconds(s.trailTf) > 0 ? s.trailTf : d.trailTf,
      onlyProfit: bool(s.onlyProfit, d.onlyProfit),
      closeOnFlip: bool(s.closeOnFlip, d.closeOnFlip),
      reentry: bool(s.reentry, d.reentry),
      backtest: bool(s.backtest, d.backtest),
      style: {
        buyColor: col('buyColor'),
        sellColor: col('sellColor'),
        maBullColor: col('maBullColor'),
        maBearColor: col('maBearColor'),
        maWidth: int(ss.maWidth, ds.maWidth, 1, 4),
        slColor: col('slColor'),
        tpColor: col('tpColor'),
        entryColor: col('entryColor'),
        lineWidth: int(ss.lineWidth, ds.lineWidth, 1, 4),
        showEntry: bool(ss.showEntry, ds.showEntry),
        showSl: bool(ss.showSl, ds.showSl),
        showTp: bool(ss.showTp, ds.showTp),
        showZones: bool(ss.showZones, ds.showZones),
        zoneAlpha: flt(ss.zoneAlpha, ds.zoneAlpha, 0, 0.6),
        showLabels: bool(ss.showLabels, ds.showLabels),
        showResult: bool(ss.showResult, ds.showResult),
      },
      tfs: Array.isArray(s.tfs) && s.tfs.length ? s.tfs.map(String) : null,
    };
    if (cfg.maxLen < cfg.baseLen) cfg.maxLen = cfg.baseLen;
    return cfg;
  }

  // ===================== TÍNH TOÁN =====================
  /** EMA kiểu Pine/EA: nến đầu tiên làm giá trị khởi tạo. */
  function emaSeeded(vals, len) {
    const k = 2 / (len + 1);
    const out = new Array(vals.length);
    let e = vals[0];
    out[0] = e;
    for (let i = 1; i < vals.length; i++) {
      e = k * vals[i] + (1 - k) * e;
      out[i] = e;
    }
    return out;
  }

  /** Phe MACD, bộ đếm nhịp và đường MA tự co giãn cho từng nến. */
  function compute(candles, cfg) {
    const n = candles.length;
    const closes = candles.map((c) => c.close);
    const ef = emaSeeded(closes, cfg.fastLen);
    const es = emaSeeded(closes, cfg.slowLen);
    const macd = ef.map((v, i) => v - es[i]);
    const sig = emaSeeded(macd, cfg.sigLen);

    const bull = new Array(n);
    const count = new Array(n);
    const pre = new Float64Array(n + 1); // tổng cộng dồn để tính SMA O(1)
    for (let i = 0; i < n; i++) {
      bull[i] = macd[i] > sig[i];
      count[i] = i === 0 ? 1 : bull[i] === bull[i - 1] ? count[i - 1] + 1 : 1;
      pre[i + 1] = pre[i] + closes[i];
    }

    const ma = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const len = Math.min(cfg.baseLen + count[i] - 1, cfg.maxLen);
      if (len >= 1 && i >= len - 1) ma[i] = (pre[i + 1] - pre[i + 1 - len]) / len;
    }
    return { bull, count, ma };
  }

  /** Tra nến khung trailing chứa mốc thời gian t (nến mở cửa gần nhất có time <= t). */
  function makeLookup(series) {
    const times = series.map((c) => c.time);
    return function (t) {
      let lo = 0;
      let hi = times.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) {
          ans = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return ans;
    };
  }

  /** SL/TP bị chạm trong 1 nến? SL được ưu tiên nếu cả hai cùng chạm (thận trọng). */
  function checkExit(p, bar) {
    if (p.dir === 1) {
      if (bar.low <= p.sl) return { price: Math.min(p.sl, bar.open), reason: 'sl' };
      if (p.tp !== null && bar.high >= p.tp) return { price: Math.max(p.tp, bar.open), reason: 'tp' };
    } else {
      if (bar.high >= p.sl) return { price: Math.max(p.sl, bar.open), reason: 'sl' };
      if (p.tp !== null && bar.low <= p.tp) return { price: Math.min(p.tp, bar.open), reason: 'tp' };
    }
    return null;
  }

  /**
   * Mô phỏng lần lượt từng lệnh như EA:
   *  - hành động (vào lệnh / dời SL / đóng khi đổi phe) diễn ra ở ĐẦU nến b+1, dựa trên nến b đã đóng
   *  - còn lệnh thì bỏ qua tín hiệu mới; hết lệnh mới tìm tín hiệu kế tiếp
   *  - đóng do đổi phe ngược -> vào luôn lệnh ngược tại cùng giá next.open
   *  - bị quét SL (kể cả trailing) mà MACD vẫn cùng phe với lệnh vừa đóng
   *    -> vào lại cùng hướng ở nến kế tiếp (và các nến sau nếu lần đầu chưa vào được),
   *       cho tới khi MACD đổi phe
   */
  function simulate(candles, cfg, comp, atr, trailSeries) {
    const n = candles.length;
    const trades = [];
    const bull = comp.bull;
    const lookup = trailSeries && trailSeries.length ? makeLookup(trailSeries) : null;
    let pos = null;
    let reDir = 0; // hướng cần vào lại sau khi bị quét SL (0 = không có)

    const finish = (p, idx, price, reason) => {
      p.exitIdx = idx;
      p.exitPrice = price;
      p.reason = reason;
      p.r = ((price - p.entry) * p.dir) / p.risk;
      trades.push(p);
    };

    for (let b = 0; b < n; b++) {
      const bar = candles[b];

      // 1) SL / TP chạm ngay trong nến b (kể cả nến vừa vào lệnh)
      if (pos && b >= pos.entryIdx) {
        const hit = checkExit(pos, bar);
        if (hit) {
          finish(pos, b, hit.price, hit.reason);
          if (hit.reason === 'sl' && cfg.reentry) reDir = pos.dir; // bị quét SL -> xét vào lại
          pos = null;
        }
      }

      // 2) Nến đang hình thành (cuối cùng) chưa có tín hiệu / chưa quản lý lệnh
      if (b > n - 2) continue;
      const next = candles[b + 1];
      const flipBuy = b >= 1 && bull[b] && !bull[b - 1];
      const flipSell = b >= 1 && !bull[b] && bull[b - 1];

      // 3) Đang có lệnh: đóng khi đổi phe ngược / dời SL theo nến khung trailing
      if (pos) {
        if (cfg.closeOnFlip && ((pos.dir === 1 && flipSell) || (pos.dir === -1 && flipBuy))) {
          finish(pos, b + 1, next.open, 'flip');
          pos = null;
          reDir = 0; // rơi xuống bước 4: tín hiệu đổi phe sẽ vào lệnh ngược
        } else if (cfg.exitMode === 'trail' && lookup && b > pos.entryIdx) {
          const cur = lookup(bar.time);
          const prev = b > 0 ? lookup(candles[b - 1].time) : -1;
          if (cur >= 1 && prev >= 0 && cur !== prev) {
            // nến chart đầu tiên của nến khung lớn mới -> lấy đáy/đỉnh nến khung lớn VỪA ĐÓNG
            const cand = pos.dir === 1 ? trailSeries[cur - 1].low : trailSeries[cur - 1].high;
            const ok =
              pos.dir === 1
                ? cand > pos.sl && cand < bar.close && (!cfg.onlyProfit || cand > pos.entry)
                : cand < pos.sl && cand > bar.close && (!cfg.onlyProfit || cand < pos.entry);
            if (ok) {
              // giá mở nến kế đã vượt qua SL mới -> coi như bị quét ngay
              if ((pos.dir === 1 && next.open <= cand) || (pos.dir === -1 && next.open >= cand)) {
                finish(pos, b + 1, next.open, 'trail');
                if (cfg.reentry) reDir = pos.dir;
                pos = null; // rơi xuống bước 4 (đổi phe -> lệnh ngược; còn cùng phe -> vào lại)
              } else {
                pos.sl = cand;
                pos.slPath.push({ idx: b + 1, sl: cand });
              }
            }
          }
        }
      }
      if (pos) continue;

      // 4) Hết lệnh: tìm tín hiệu để vào lệnh tại giá mở cửa nến kế tiếp
      //    - đổi phe (flipBuy/flipSell), hoặc
      //    - vào lại: MACD vẫn cùng phe với lệnh vừa bị quét SL
      if (reDir !== 0 && !flipBuy && !flipSell && (bull[b] ? 1 : -1) !== reDir) reDir = 0;
      const dir = flipBuy ? 1 : flipSell ? -1 : reDir;
      if (dir === 0) continue;
      const isReentry = !flipBuy && !flipSell;

      const entry = next.open;
      let sl;
      if (cfg.slMode === 'atr') {
        const a = atr ? atr[b] : null;
        if (!a) continue;
        sl = dir === 1 ? entry - a * cfg.atrMult : entry + a * cfg.atrMult;
      } else {
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = Math.max(0, b - cfg.slBars + 1); k <= b; k++) {
          if (candles[k].low < lo) lo = candles[k].low;
          if (candles[k].high > hi) hi = candles[k].high;
        }
        sl = dir === 1 ? lo : hi;
      }
      const risk = dir === 1 ? entry - sl : sl - entry;
      if (!(risk > 0)) continue; // chưa vào được: reDir được giữ để thử lại ở nến sau

      reDir = 0;
      pos = {
        dir,
        reentry: isReentry,
        signalIdx: b,
        signalTime: bar.time,
        entryIdx: b + 1,
        entry,
        sl,
        sl0: sl,
        risk,
        tp: cfg.exitMode === 'tp' ? (dir === 1 ? entry + cfg.rr * risk : entry - cfg.rr * risk) : null,
        slPath: [{ idx: b + 1, sl }],
        exitIdx: null,
        exitPrice: null,
        reason: null,
        r: null,
      };
    }

    if (pos) trades.push(pos); // lệnh vẫn đang mở
    return trades;
  }

  // ===================== PRIMITIVE VẼ LÊN CHART =====================
  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  class MaSignalPrimitive {
    constructor(getState) {
      this._getState = getState;
      this._chart = null;
      this._series = null;
      this._requestUpdate = null;
      this._views = [{ zOrder: () => 'top', renderer: () => ({ draw: (t) => this._draw(t) }) }];
    }

    attached(p) {
      this._chart = p.chart;
      this._series = p.series;
      this._requestUpdate = p.requestUpdate;
    }

    detached() {
      this._chart = null;
      this._series = null;
      this._requestUpdate = null;
    }

    updateAllViews() {}

    paneViews() {
      return this._views;
    }

    requestRedraw() {
      if (this._requestUpdate) this._requestUpdate();
    }

    _draw(target) {
      const chart = this._chart;
      const series = this._series;
      if (!chart || !series) return;
      const { cfg, candles, comp, trades } = this._getState();
      if (!candles || !comp) return;
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const n = candles.length;
      const from = Math.max(0, Math.floor(range.from) - 2);
      const to = Math.min(n - 1, Math.ceil(range.to) + 2);
      const st = cfg.style;

      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context;
        const hr = scope.horizontalPixelRatio;
        const vr = scope.verticalPixelRatio;
        const X = (i) => {
          const x = ts.logicalToCoordinate(i);
          return x === null ? null : x * hr;
        };
        const Y = (p) => {
          const y = series.priceToCoordinate(p);
          return y === null ? null : y * vr;
        };
        const lw = Math.max(1, Math.round(st.lineWidth * hr));
        const dash = [4 * hr, 4 * hr];

        ctx.save();
        ctx.lineJoin = 'round';

        // ---- 1) Đường MA tự co giãn ----
        if (cfg.showMa) {
          ctx.lineWidth = Math.max(1, Math.round(st.maWidth * hr));
          for (let i = Math.max(from, 1); i <= to; i++) {
            if (comp.ma[i] === null || comp.ma[i - 1] === null) continue;
            const x0 = X(i - 1);
            const x1 = X(i);
            const y0 = Y(comp.ma[i - 1]);
            const y1 = Y(comp.ma[i]);
            if (x0 === null || x1 === null || y0 === null || y1 === null) continue;
            ctx.strokeStyle = comp.bull[i] ? st.maBullColor : st.maBearColor;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
        }

        // ---- 2) Từng lệnh: vùng nền, Entry / SL / TP, nhãn BUY/SELL, điểm thoát ----
        trades.forEach((t) => {
          const endIdx = t.exitIdx !== null ? t.exitIdx : n - 1;
          if (t.entryIdx > to || endIdx < from) return;
          let x0 = X(t.entryIdx);
          let x1 = X(endIdx);
          if (x0 === null || x1 === null) return;
          if (x1 - x0 < 6 * hr) x1 = x0 + 6 * hr;
          const yE = Y(t.entry);
          const yS0 = Y(t.sl0);
          if (yE === null || yS0 === null) return;
          const yT = t.tp !== null ? Y(t.tp) : null;

          // Trailing (không có TP): lệnh thắng -> SL màu xanh, lệnh thua -> màu đỏ.
          // Lệnh còn mở: xanh khi SL đã dời qua giá vào (đã khoá lời), ngược lại đỏ.
          const isTrail = t.tp === null;
          const profitable =
            t.exitIdx !== null ? t.r >= 0 : t.dir === 1 ? t.sl > t.entry : t.sl < t.entry;
          const slLineColor = isTrail && profitable ? st.tpColor : st.slColor;

          // vùng nền rủi ro / lợi nhuận
          if (st.showZones) {
            ctx.fillStyle = hexToRgba(st.slColor, st.zoneAlpha);
            ctx.fillRect(x0, Math.min(yE, yS0), x1 - x0, Math.abs(yS0 - yE));
            if (yT !== null) {
              ctx.fillStyle = hexToRgba(st.tpColor, st.zoneAlpha);
              ctx.fillRect(x0, Math.min(yE, yT), x1 - x0, Math.abs(yT - yE));
            } else if (isTrail && profitable) {
              const yF = Y(t.sl);
              if (yF !== null) {
                ctx.fillStyle = hexToRgba(st.tpColor, st.zoneAlpha);
                ctx.fillRect(x0, Math.min(yE, yF), x1 - x0, Math.abs(yF - yE));
              }
            }
          }

          // đường giá vào
          if (st.showEntry) {
            ctx.strokeStyle = st.entryColor;
            ctx.lineWidth = lw;
            ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.moveTo(x0, yE);
            ctx.lineTo(x1, yE);
            ctx.stroke();
          }

          // đường TP
          if (st.showTp && yT !== null) {
            ctx.strokeStyle = st.tpColor;
            ctx.lineWidth = lw;
            ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.moveTo(x0, yT);
            ctx.lineTo(x1, yT);
            ctx.stroke();
          }

          // đường SL dạng bậc thang (đi theo các lần dời SL)
          if (st.showSl) {
            ctx.strokeStyle = slLineColor;
            ctx.lineWidth = lw;
            ctx.setLineDash([]);
            ctx.beginPath();
            let started = false;
            let prevSl = null;
            t.slPath.forEach((p) => {
              const px = X(p.idx);
              const py = Y(p.sl);
              if (px === null || py === null) return;
              if (!started) {
                ctx.moveTo(px, py);
                started = true;
              } else {
                ctx.lineTo(px, prevSl);
                ctx.lineTo(px, py);
              }
              prevSl = py;
            });
            if (started) {
              ctx.lineTo(x1, prevSl);
              ctx.stroke();
            }
          }
          ctx.setLineDash([]);

          // điểm thoát + kết quả theo R
          if (t.exitIdx !== null) {
            const yX = Y(t.exitPrice);
            if (yX !== null) {
              const win = t.r >= 0;
              ctx.fillStyle = win ? st.tpColor : st.slColor;
              ctx.beginPath();
              ctx.arc(x1, yX, 3.5 * hr, 0, Math.PI * 2);
              ctx.fill();
              if (st.showResult) {
                const txt = `${win ? '+' : ''}${t.r.toFixed(2)}R`;
                ctx.font = `600 ${Math.round(10 * vr)}px Inter, -apple-system, "Segoe UI", sans-serif`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = win ? st.tpColor : st.slColor;
                ctx.fillText(txt, x1 + 7 * hr, yX + (win ? -7 : 7) * vr);
              }
            }
          }

          // nhãn BUY / SELL tại nến vào lệnh
          if (st.showLabels) {
            const bar = candles[t.entryIdx];
            const buy = t.dir === 1;
            const yEdge = Y(buy ? bar.low : bar.high);
            if (yEdge !== null) {
              const color = buy ? st.buyColor : st.sellColor;
              const gap = 6 * vr;
              const ah = 7 * vr;
              const aw = 6 * hr;
              ctx.fillStyle = color;
              ctx.beginPath();
              if (buy) {
                ctx.moveTo(x0, yEdge + gap);
                ctx.lineTo(x0 - aw, yEdge + gap + ah);
                ctx.lineTo(x0 + aw, yEdge + gap + ah);
              } else {
                ctx.moveTo(x0, yEdge - gap);
                ctx.lineTo(x0 - aw, yEdge - gap - ah);
                ctx.lineTo(x0 + aw, yEdge - gap - ah);
              }
              ctx.closePath();
              ctx.fill();

              const text = buy ? 'BUY' : 'SELL';
              ctx.font = `700 ${Math.round(10 * vr)}px Inter, -apple-system, "Segoe UI", sans-serif`;
              const tw = ctx.measureText(text).width;
              const w = tw + 8 * hr;
              const h = 14 * vr;
              const cy = buy ? yEdge + gap + ah + h / 2 + 2 * vr : yEdge - gap - ah - h / 2 - 2 * vr;
              ctx.fillStyle = color;
              roundRectPath(ctx, x0 - w / 2, cy - h / 2, w, h, 3 * hr);
              ctx.fill();
              ctx.fillStyle = '#ffffff';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(text, x0, cy + 0.5 * vr);
            }
          }
        });

        ctx.restore();
 
        // ---- 3) Bảng BACKTEST (tổng R của mọi lệnh đã đóng trên phần chart đã tải) ----
        if (cfg.backtest && typeof BacktestModule !== 'undefined') {
          BacktestModule.drawPanel(scope, BacktestModule.computeStats(trades, candles));
        }
      });
    }
  }

  // ===================== INSTANCE THEO PANE =====================
  function create(paneId) {
    let seriesRef = null;
    let prim = null;
    let cfg = sanitize(null);
    let visible = false;
    let state = { candles: null, comp: null, trades: [] };

    // Thông báo tín hiệu MỚI (cùng cơ chế baseline với breakout.js)
    let onNewSignalCb = null;
    let lastNotifiedSignalTime = null;
    let hasBaseline = false;

    function init(chart, candleSeries) {
      seriesRef = candleSeries;
      prim = new MaSignalPrimitive(() => ({ cfg, ...state }));
      candleSeries.attachPrimitive(prim);
    }

    function clearState() {
      state = { candles: null, comp: null, trades: [] };
      if (prim) prim.requestRedraw();
    }

    function tfOk(timeframe) {
      return !cfg.tfs || !timeframe || cfg.tfs.includes(timeframe);
    }

    /**
     * run({ entryCandles, trailCandles, timeframe })
     *  - trailCandles: nến khung trailing (chỉ cần khi khung trailing LỚN hơn khung vào lệnh)
     */
    function run(params) {
      if (!seriesRef || !prim) return;
      const candles = (params && params.entryCandles) || [];
      const timeframe = params && params.timeframe;

      if (!visible || !tfOk(timeframe) || candles.length < 5) {
        clearState();
        hasBaseline = false;
        return;
      }

      const comp = compute(candles, cfg);

      let trailSeries = null;
      if (cfg.exitMode === 'trail') {
        if (needsExternalTrail(cfg, timeframe)) {
          const tc = params.trailCandles;
          trailSeries = tc && tc.length ? tc : null; // chưa tải xong -> tạm chưa trailing
        } else {
          trailSeries = candles;
        }
      }

      let atr = null;
      if (cfg.slMode === 'atr') {
        try {
          atr = IndicatorModule.calcATR(candles, cfg.atrPeriod);
        } catch (err) {
          atr = null;
        }
      }

      const trades = simulate(candles, cfg, comp, atr, trailSeries);
      state = { candles, comp, trades };
      prim.requestRedraw();

      // Báo khi có lệnh VỪA vào ở nến hiện tại (tín hiệu xuất hiện ở nến đã đóng gần nhất)
      const latest = trades.length ? trades[trades.length - 1] : null;
      if (latest && latest.entryIdx === candles.length - 1) {
        const isNew = latest.signalTime !== lastNotifiedSignalTime;
        if (isNew && hasBaseline && onNewSignalCb) onNewSignalCb(latest.dir, latest.signalTime);
        if (isNew) lastNotifiedSignalTime = latest.signalTime;
      }
      hasBaseline = true;
    }

    function configure(partial) {
      const cur = JSON.parse(JSON.stringify(cfg));
      const p = partial || {};
      cfg = sanitize({ ...cur, ...p, style: { ...cur.style, ...(p.style || {}) } });
      hasBaseline = false; // đổi cài đặt: không báo nhầm tín hiệu cũ
    }

    function getConfig() {
      return JSON.parse(JSON.stringify(cfg));
    }

    function setVisible(v) {
      visible = !!v;
      if (!visible) {
        clearState();
        hasBaseline = false;
      }
    }

    function isVisible() {
      return visible;
    }

    function setOnNewSignal(cb) {
      onNewSignalCb = cb;
    }

    function destroy() {
      if (seriesRef && prim) {
        try {
          seriesRef.detachPrimitive(prim);
        } catch (err) {
          // series có thể đã bị huỷ
        }
      }
      prim = null;
      seriesRef = null;
    }

    /** Danh sách lệnh đã mô phỏng (dùng để thống kê hoặc kiểm thử). */
    function getTrades() {
      return state.trades.slice();
    }

    /** Thống kê backtest (tổng R, số lệnh, winrate, PF, max DD, khoảng thời gian). */
    function getStats() {
      return BacktestModule.computeStats(state.trades, state.candles);
    }

    return { init, run, configure, getConfig, setVisible, isVisible, setOnNewSignal, getTrades, getStats, destroy };
  }

  return {
    create,
    getDefaults: () => sanitize(null),
    needsExternalTrail,
    tfSeconds,
  };
})();