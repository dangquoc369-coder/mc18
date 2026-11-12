/**
 * breakout.js
 * Chế độ tín hiệu BUY/SELL "Breakout" (khung entry phá vùng đỉnh/đáy của N nến khung trend)
 * - mô phỏng lệnh ảo và hiển thị lên chart (CHỈ ĐỂ HIỂN THỊ, không đặt lệnh).
 *
 * Logic:
 *  1. Nến entry ĐÓNG cửa vượt đỉnh (BUY) / thủng đáy (SELL) của N nến khung trend đã đóng gần nhất
 *  2. Vào lệnh ảo tại giá đóng cửa nến đó, SL ban đầu = giá vào -/+ ATR x hệ số
 *  3. Quản lý SL: 'trail' = dời SL theo đáy/đỉnh nến ĐÃ ĐÓNG của khung trailing (giống MA Tự Co Giãn)
 *                 'fixed' = SL cố định
 *  4. Lệnh đóng khi: (a) chạm SL (đã dời), (b) có tín hiệu ngược chiều (đảo lệnh),
 *     (c) TUỲ CHỌN: MACD đổi phe ngược chiều lệnh -> đóng tại giá đóng cửa nến đó
 *  5. Tín hiệu cùng chiều khi đang có lệnh thì bỏ qua
 *
 * Vẽ: toàn bộ bằng canvas primitive theo chỉ số nến (vùng nền rủi ro/lợi nhuận, đường Entry,
 * đường SL dạng bậc thang, điểm thoát + kết quả R, nhãn BUY/SELL) - cùng phong cách ma-signal.js.
 *
 * Thông báo tín hiệu MỚI: setOnNewSignal(cb). Chỉ báo tín hiệu mới phát sinh sau lần chạy
 * "nền" đầu tiên của mỗi bộ dữ liệu (không báo tín hiệu cũ trong lịch sử).
 *
 * API: create(paneId) -> { init, run, configure, getConfig, getMarketStatus, setVisible,
 *                          isVisible, setOnNewSignal, getTrades }
 *      BreakoutModule.getDefaults(), needsExternalTrail(cfg, timeframe), tfSeconds(tf)
 *      run({ entryCandles, higherTFCandles, slCandles, trailCandles, timeframe })
 */

const BreakoutModule = (function () {
  const DEFAULTS = {
    lookbackCandles: 2, // số nến khung TREND dùng để xác định vùng breakout
    slSource: 'entry', // 'entry' | 'higher' | 'custom' (khung tính ATR)
    atrPeriod: 14,
    atrMultiplier: 2.5,
    exitMode: 'trail', // 'trail' = Trailing SL | 'fixed' = SL cố định
    trailTf: '1h', // khung nến dùng để dời SL
    onlyProfit: true, // chỉ dịch SL khi SL mới nằm trên giá vào (khoá lời)
    closeOnFlip: false, // đóng lệnh ảo khi MACD đổi phe ngược chiều lệnh
    backtest: false, // hiện bảng backtest: tổng R của mọi lệnh trên phần chart đã tải
    macdFast: 44,
    macdSlow: 88,
    macdSig: 62,
    style: {
      buyColor: '#26a69a',
      sellColor: '#ef5350',
      slColor: '#ef5350',
      tpColor: '#26a69a', // màu điểm thoát / SL khi lệnh thắng (đã khoá lời)
      entryColor: '#787b86',
      lineWidth: 1,
      showLabels: true, // nhãn BUY / SELL
      showEntry: true, // đường giá vào
      showSl: true, // đường SL (bậc thang theo trailing)
      showZones: true, // tô nền vùng rủi ro / lợi nhuận
      zoneAlpha: 0.08,
      showExit: true, // chấm điểm thoát lệnh
      showResult: true, // chữ kết quả theo R cạnh điểm thoát
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

  /** '15m' -> 900, '1h' -> 3600, '1d' -> 86400, '1w', '1M'. 0 nếu không hợp lệ. */
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

  /** Chuẩn hoá cấu hình (chặn giá trị sai từ hộp thoại / localStorage). */
  function sanitize(src) {
    const d = DEFAULTS;
    const s = src || {};
    const ss = s.style || {};
    const ds = d.style;
    const col = (k) => (isHex(ss[k]) ? ss[k] : ds[k]);
    return {
      lookbackCandles: int(s.lookbackCandles, d.lookbackCandles, 1, 20),
      slSource: ['entry', 'higher', 'custom'].includes(s.slSource) ? s.slSource : d.slSource,
      atrPeriod: int(s.atrPeriod, d.atrPeriod, 1, 200),
      atrMultiplier: flt(s.atrMultiplier, d.atrMultiplier, 0.1, 50),
      exitMode: s.exitMode === 'fixed' ? 'fixed' : s.exitMode === 'trail' ? 'trail' : d.exitMode,
      trailTf: typeof s.trailTf === 'string' && tfSeconds(s.trailTf) > 0 ? s.trailTf : d.trailTf,
      onlyProfit: bool(s.onlyProfit, d.onlyProfit),
      closeOnFlip: bool(s.closeOnFlip, d.closeOnFlip),
      backtest: bool(s.backtest, d.backtest),
      macdFast: int(s.macdFast, d.macdFast, 1, 500),
      macdSlow: int(s.macdSlow, d.macdSlow, 1, 500),
      macdSig: int(s.macdSig, d.macdSig, 1, 500),
      style: {
        buyColor: col('buyColor'),
        sellColor: col('sellColor'),
        slColor: col('slColor'),
        tpColor: col('tpColor'),
        entryColor: col('entryColor'),
        lineWidth: int(ss.lineWidth, ds.lineWidth, 1, 4),
        showLabels: bool(ss.showLabels, ds.showLabels),
        showEntry: bool(ss.showEntry, ds.showEntry),
        showSl: bool(ss.showSl, ds.showSl),
        showZones: bool(ss.showZones, ds.showZones),
        zoneAlpha: flt(ss.zoneAlpha, ds.zoneAlpha, 0, 0.6),
        showExit: bool(ss.showExit, ds.showExit),
        showResult: bool(ss.showResult, ds.showResult),
      },
      tfs: Array.isArray(s.tfs) && s.tfs.length ? s.tfs.map(String) : null,
    };
  }

  /** EMA kiểu EA/Pine: nến đầu tiên làm giá trị khởi tạo. */
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

  /** Phe MACD từng nến: true = phe tăng (MACD > Signal). Cùng cách tính với EA MA Tự Co Giãn. */
  function macdBull(candles, fast, slow, sig) {
    const closes = candles.map((c) => c.close);
    const ef = emaSeeded(closes, fast);
    const es = emaSeeded(closes, slow);
    const macd = ef.map((v, i) => v - es[i]);
    const sg = emaSeeded(macd, sig);
    return macd.map((v, i) => v > sg[i]);
  }

  // ===================== TREND THAM KHẢO (Breakout 3 nến trước) =====================
  function detectOwnTimeframeTrend(closedCandles) {
    const len = closedCandles.length;
    if (len < 4) {
      return { trend: 'sideway', breakDistance: 0, maxHigh123: null, minLow123: null };
    }

    const c1 = closedCandles[len - 1]; // nến vừa đóng
    const c2 = closedCandles[len - 2];
    const c3 = closedCandles[len - 3];
    const c4 = closedCandles[len - 4];

    const maxHigh123 = Math.max(c2.high, c3.high, c4.high);
    const minLow123 = Math.min(c2.low, c3.low, c4.low);

    let trend = 'sideway';
    let breakDistance = 0;

    if (c1.close > maxHigh123) {
      trend = 'up';
      breakDistance = c1.close - maxHigh123;
    } else if (c1.close < minLow123) {
      trend = 'down';
      breakDistance = minLow123 - c1.close;
    }

    return { trend, breakDistance, maxHigh123, minLow123 };
  }

  // ===================== TIỆN ÍCH GHÉP KHUNG (multi-timeframe align) =====================
  function buildClosedSeries(rawCandles) {
    const candles = (rawCandles || []).slice().sort((a, b) => a.time - b.time);
    if (candles.length < 2) {
      return candles.map((c) => ({ ...c, closeTime: c.time }));
    }
    const diffs = [];
    for (let i = 1; i < candles.length; i++) diffs.push(candles[i].time - candles[i - 1].time);
    diffs.sort((a, b) => a - b);
    const duration = diffs[Math.floor(diffs.length / 2)];
    return candles.map((c) => ({ ...c, closeTime: c.time + duration }));
  }

  function makeAligner(series) {
    let pointer = 0;
    return function advanceTo(time) {
      while (pointer < series.length && series[pointer].closeTime <= time) pointer++;
      return pointer;
    };
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

  /** Giá thoát khi chạm SL: nếu nến mở cửa gap qua SL thì thoát tại giá mở cửa (thực tế hơn). */
  function slExitPrice(trade, bar) {
    return trade.dir === 1 ? Math.min(trade.sl, bar.open) : Math.max(trade.sl, bar.open);
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

  class BreakoutTradePrimitive {
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
      const s = this._getState();
      if (!s.visible || !s.candles) return;
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const candles = s.candles;
      const cfg = s.cfg;
      const st = cfg.style;
      const n = candles.length;
      const from = Math.max(0, Math.floor(range.from) - 2);
      const to = Math.min(n - 1, Math.ceil(range.to) + 2);
      const isTrail = cfg.exitMode === 'trail';

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

        s.trades.forEach((t) => {
          const endIdx = t.exitIdx !== null ? t.exitIdx : n - 1;
          if (t.entryIdx > to || endIdx < from) return;
          const x0 = X(t.entryIdx);
          let x1 = X(endIdx);
          if (x0 === null || x1 === null) return;
          if (x1 - x0 < 6 * hr) x1 = x0 + 6 * hr;
          const yE = Y(t.entry);
          const yS0 = Y(t.sl0);
          if (yE === null || yS0 === null) return;

          // Trailing: lệnh thắng -> SL xanh, lệnh thua -> đỏ.
          // Lệnh còn mở: xanh khi SL đã dời qua giá vào (đã khoá lời), ngược lại đỏ.
          const profitable =
            t.exitIdx !== null ? t.r >= 0 : t.dir === 1 ? t.sl > t.entry : t.sl < t.entry;
          const slLineColor = isTrail && profitable ? st.tpColor : st.slColor;

          // vùng nền rủi ro / lợi nhuận đã khoá
          if (st.showZones) {
            ctx.fillStyle = hexToRgba(st.slColor, st.zoneAlpha);
            ctx.fillRect(x0, Math.min(yE, yS0), x1 - x0, Math.abs(yS0 - yE));
            if (isTrail && profitable) {
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
          if (st.showExit && t.exitIdx !== null) {
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
            if (!bar) return;
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
 
        // Bảng BACKTEST (tổng R của mọi lệnh đã đóng trên phần chart đã tải)
        if (cfg.backtest && typeof BacktestModule !== 'undefined') {
          BacktestModule.drawPanel(scope, BacktestModule.computeStats(s.trades, candles));
        }
      });
    }
  }

  // ===================== INSTANCE THEO PANE =====================
  function create(paneId) {
    let candleSeriesRef = null;
    let prim = null;
    let visible = false; // bật/tắt hiển thị

    let CONFIG = sanitize(null);

    // Danh sách lệnh ảo đã mô phỏng trong lần chạy gần nhất
    let trades = [];
    let current = null; // lệnh đang mở
    let lastCandles = null; // nến entry của lần chạy gần nhất (primitive dùng để đặt nhãn)

    // Trạng thái lệnh đang mở (getMarketStatus đọc)
    let activeTradeOpen = false;
    let activeDirection = 0; // 1 = BUY, -1 = SELL
    let activeEntryPrice = 0;
    let activeSLPrice = 0; // SL hiện tại (đã dời nếu trailing)
    let activeRisk = 0; // rủi ro ban đầu (giá vào - SL ban đầu)

    // Trend tham khảo
    let lastTrend = 'sideway';

    // Thông báo tín hiệu MỚI
    let onNewSignalCb = null;
    let lastNotifiedEntryTime = null;
    let hasBaseline = false; // đã có lần chạy đầy đủ nào kể từ lần reset dữ liệu/cấu hình gần nhất chưa

    function configure(options) {
      const before = JSON.stringify(CONFIG);
      const p = options || {};
      CONFIG = sanitize({ ...CONFIG, ...p, style: { ...CONFIG.style, ...(p.style || {}) } });
      if (JSON.stringify(CONFIG) !== before) hasBaseline = false; // đổi cài đặt: không báo nhầm tín hiệu cũ
    }

    function getConfig() {
      return JSON.parse(JSON.stringify(CONFIG));
    }

    function setOnNewSignal(cb) {
      onNewSignalCb = cb;
    }

    function init(chart, candleSeries) {
      candleSeriesRef = candleSeries;
      prim = new BreakoutTradePrimitive(() => ({
        cfg: CONFIG,
        candles: lastCandles,
        trades,
        visible,
      }));
      candleSeries.attachPrimitive(prim);
    }

    function tfOk(timeframe) {
      return !CONFIG.tfs || !timeframe || CONFIG.tfs.includes(timeframe);
    }

    function clearOutputs() {
      trades = [];
      current = null;
      lastCandles = null;
      activeTradeOpen = false;
      if (prim) prim.requestRedraw();
    }

    function resetRunState() {
      activeTradeOpen = false;
      activeDirection = 0;
      activeEntryPrice = 0;
      activeSLPrice = 0;
      activeRisk = 0;
      current = null;
      trades = [];
    }

    function openTrade(idx, time, direction, entryPrice, slDistance) {
      const sl = direction === 1 ? entryPrice - slDistance : entryPrice + slDistance;
      current = {
        dir: direction,
        entryIdx: idx,
        entryTime: time,
        entry: entryPrice,
        risk: slDistance,
        sl,
        sl0: sl,
        slPath: [{ idx, sl }], // lịch sử dời SL (vẽ bậc thang)
        exitIdx: null,
        exitTime: null,
        exitPrice: null,
        reason: null, // 'sl' | 'flip' | 'reverse'
        r: null,
      };
      trades.push(current);
      activeTradeOpen = true;
      activeDirection = direction;
      activeEntryPrice = entryPrice;
      activeSLPrice = sl;
      activeRisk = slDistance;
    }

    function closeTrade(idx, time, price, reason) {
      if (!current) return;
      current.exitIdx = idx;
      current.exitTime = time;
      current.exitPrice = price;
      current.reason = reason;
      current.r = ((price - current.entry) * current.dir) / current.risk;
      current = null;
      activeTradeOpen = false;
    }

    function checkSLAgainstBar(bar) {
      if (!current) return false;
      if (current.dir === 1 && bar.low <= current.sl) return true;
      if (current.dir === -1 && bar.high >= current.sl) return true;
      return false;
    }

    function computeBreakoutZone(series, count) {
      const n = CONFIG.lookbackCandles;
      if (count < n) return null;
      const windowCandles = series.slice(count - n, count);
      const maxHigh = Math.max(...windowCandles.map((c) => c.high));
      const minLow = Math.min(...windowCandles.map((c) => c.low));
      return { maxHigh, minLow };
    }

    /**
     * run({ entryCandles, higherTFCandles, slCandles, trailCandles, timeframe })
     */
    function run(params) {
      if (!candleSeriesRef) return;

      const p = params || {};
      const entryCandles = p.entryCandles || [];
      const higherTFCandlesRaw = p.higherTFCandles || [];
      const slCandlesRaw = p.slCandles;
      const trailCandlesRaw = p.trailCandles;
      const timeframe = p.timeframe;

      resetRunState();

      if (entryCandles.length < 2) {
        // Dữ liệu trống (đổi symbol/khung): bộ dữ liệu mới -> chưa có baseline
        clearOutputs();
        lastTrend = 'sideway';
        hasBaseline = false;
        lastNotifiedEntryTime = null;
        return;
      }

      if (!tfOk(timeframe)) {
        clearOutputs();
        hasBaseline = false;
        return;
      }

      const n = entryCandles.length;
      const entryClosed = entryCandles.slice(0, -1);
      const entryForming = entryCandles[n - 1];

      // Trend tham khảo (không lọc lệnh)
      lastTrend = detectOwnTimeframeTrend(entryClosed).trend;

      // Khung TREND (lớn hơn) dùng để phát hiện breakout
      const htfSeries = buildClosedSeries(higherTFCandlesRaw);
      const htfAlign = makeAligner(htfSeries);

      // Khung tính ATR cho SL
      let slSeriesRaw;
      if (CONFIG.slSource === 'higher') slSeriesRaw = higherTFCandlesRaw;
      else if (CONFIG.slSource === 'custom') slSeriesRaw = slCandlesRaw || entryClosed;
      else slSeriesRaw = entryClosed;
      const slSeries = buildClosedSeries(slSeriesRaw);
      const slAlign = makeAligner(slSeries);

      let atrFull = null;
      try {
        atrFull = IndicatorModule.calcATR(slSeries, CONFIG.atrPeriod);
      } catch (e) {
        atrFull = null;
      }

      if (entryClosed.length < 1 || htfSeries.length < CONFIG.lookbackCandles) {
        // Chưa đủ nến khung trend để so sánh -> chưa phát hiện được breakout
        clearOutputs();
        return;
      }

      // Khung trailing: lớn hơn khung vào lệnh -> nến tải riêng; ngược lại dùng chính nến entry
      let trailSeries = null;
      if (CONFIG.exitMode === 'trail') {
        if (needsExternalTrail(CONFIG, timeframe)) {
          trailSeries = trailCandlesRaw && trailCandlesRaw.length ? trailCandlesRaw : null; // chưa tải xong -> tạm chưa trailing
        } else {
          trailSeries = entryCandles;
        }
      }
      const trailLookup = trailSeries ? makeLookup(trailSeries) : null;

      // Phe MACD (chỉ tính khi bật "đóng lệnh khi MACD đổi phe")
      const bull =
        CONFIG.closeOnFlip && entryClosed.length > 1
          ? macdBull(entryClosed, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSig)
          : null;

      let lastLoopSignal = null;

      for (let i = 0; i < entryClosed.length; i++) {
        const bar = entryClosed[i];

        // 1) Chạm SL (SL hiện hành, kể cả SL đã dời)
        if (current && checkSLAgainstBar(bar)) {
          closeTrade(i, bar.time, slExitPrice(current, bar), 'sl');
        }

        // 2) Trailing: nến đầu tiên của 1 nến khung trailing mới -> dời SL tới đáy/đỉnh nến khung đó VỪA ĐÓNG.
        //    SL mới có hiệu lực từ nến kế tiếp (giống MA Tự Co Giãn).
        if (current && trailLookup && i > current.entryIdx) {
          const cur = trailLookup(bar.time);
          const prev = trailLookup(entryClosed[i - 1].time);
          if (cur >= 1 && prev >= 0 && cur !== prev) {
            const tb = trailSeries[cur - 1];
            const cand = current.dir === 1 ? tb.low : tb.high;
            const ok =
              current.dir === 1
                ? cand > current.sl && cand < bar.close && (!CONFIG.onlyProfit || cand > current.entry)
                : cand < current.sl && cand > bar.close && (!CONFIG.onlyProfit || cand < current.entry);
            if (ok) {
              current.sl = cand;
              current.slPath.push({ idx: i + 1, sl: cand });
              activeSLPrice = cand;
            }
          }
        }

        // 3) MACD đổi phe ngược chiều lệnh -> đóng tại giá đóng cửa nến này
        let blockedDir = 0;
        if (current && bull && i >= 1) {
          const flipBuy = bull[i] && !bull[i - 1];
          const flipSell = !bull[i] && bull[i - 1];
          if ((current.dir === 1 && flipSell) || (current.dir === -1 && flipBuy)) {
            blockedDir = current.dir; // không vào lại CÙNG chiều ngay trên nến này
            closeTrade(i, bar.time, bar.close, 'flip');
          }
        }

        // 4) Tín hiệu breakout
        const htfCount = htfAlign(bar.time);
        const zone = computeBreakoutZone(htfSeries, htfCount);
        if (!zone) continue;

        let direction = 0;
        if (bar.close > zone.maxHigh) direction = 1;
        else if (bar.close < zone.minLow) direction = -1;
        if (direction === 0) continue;

        if (current && direction === current.dir) continue;
        if (blockedDir === direction) continue;

        const slCount = slAlign(bar.time);
        if (slCount < CONFIG.atrPeriod + 1) continue;
        let atr;
        if (atrFull && atrFull.length === slSeries.length) {
          atr = atrFull[slCount - 1];
        } else {
          const atrArr = IndicatorModule.calcATR(slSeries.slice(0, slCount), CONFIG.atrPeriod);
          atr = atrArr[atrArr.length - 1];
        }
        if (!atr) continue;
        const slDistance = atr * CONFIG.atrMultiplier;

        if (current) closeTrade(i, bar.time, bar.close, 'reverse'); // đảo lệnh
        openTrade(i, bar.time, direction, bar.close, slDistance);
        lastLoopSignal = { time: bar.time, direction };
      }

      // Nến đang hình thành: chỉ kiểm tra chạm SL
      if (current && checkSLAgainstBar(entryForming)) {
        closeTrade(n - 1, entryForming.time, slExitPrice(current, entryForming), 'sl');
      }

      lastCandles = entryCandles;
      if (prim) prim.requestRedraw();

      // ===== Báo tín hiệu MỚI =====
      // Chỉ báo khi tín hiệu gần nhất rơi đúng nến đã đóng gần nhất, khác lần đã báo,
      // và không phải lần chạy đầy đủ đầu tiên của bộ dữ liệu này (baseline).
      if (lastLoopSignal && entryClosed.length > 0) {
        const latestClosedTime = entryClosed[entryClosed.length - 1].time;
        if (lastLoopSignal.time === latestClosedTime) {
          const isNewSignal = lastLoopSignal.time !== lastNotifiedEntryTime;
          if (isNewSignal && hasBaseline && onNewSignalCb) {
            onNewSignalCb(lastLoopSignal.direction, lastLoopSignal.time);
          }
          if (isNewSignal) lastNotifiedEntryTime = lastLoopSignal.time;
        }
      }
      hasBaseline = true;
    }

    function setVisible(v) {
      visible = !!v;
      if (prim) prim.requestRedraw();
    }

    function isVisible() {
      return visible;
    }

    function getTrades() {
      return trades.map((t) => ({ ...t, slPath: t.slPath.map((s) => ({ ...s })) }));
    }

    function getStats() {
      return BacktestModule.computeStats(trades, lastCandles);
    }

    function getMarketStatus(params) {
      const entryCandles = Array.isArray(params) ? params : (params && params.entryCandles) || [];
      const higherTFCandlesRaw = Array.isArray(params) ? [] : (params && params.higherTFCandles) || [];

      if (!entryCandles || entryCandles.length < 5) {
        return { ok: false, reason: 'Chưa đủ dữ liệu nến để phân tích.' };
      }

      const closed = entryCandles.slice(0, -1);
      const forming = entryCandles[entryCandles.length - 1];
      const c1 = closed[closed.length - 1];

      const trendResult = detectOwnTimeframeTrend(closed);

      let crossTF = null;
      if (higherTFCandlesRaw && higherTFCandlesRaw.length >= CONFIG.lookbackCandles) {
        const htfSeries = buildClosedSeries(higherTFCandlesRaw);
        const htfAlign = makeAligner(htfSeries);
        const htfCount = htfAlign(c1.time);
        const zone = computeBreakoutZone(htfSeries, htfCount);
        if (zone) {
          crossTF = {
            maxHigh: zone.maxHigh,
            minLow: zone.minLow,
            distanceToHighZone: zone.maxHigh - c1.close,
            distanceToLowZone: c1.close - zone.minLow,
          };
        }
      }

      return {
        ok: true,
        paneId,
        lastClosedCandleTime: c1.time,
        trend: trendResult.trend,
        breakDistance: trendResult.breakDistance,
        maxHigh12: trendResult.maxHigh123,
        minLow12: trendResult.minLow123,
        maxHigh123: trendResult.maxHigh123,
        minLow123: trendResult.minLow123,
        crossTF,
        currentPrice: forming.close,
        activeTradeOpen,
        activeDirection,
        activeEntryPrice,
        activeSLPrice,
        risk: activeTradeOpen ? activeRisk : null,
      };
    }

    return {
      init,
      run,
      configure,
      getConfig,
      getMarketStatus,
      setVisible,
      isVisible,
      setOnNewSignal,
      getTrades,
      getStats,
    };
  }

  return { create, getDefaults: () => sanitize(null), needsExternalTrail, tfSeconds };
})();