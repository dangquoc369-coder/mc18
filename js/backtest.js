/**
 * backtest.js
 * Chế độ BACKTEST dùng chung cho ma-signal.js và breakout.js (CHỈ ĐỂ HIỂN THỊ).
 *
 * - Cộng PnL (theo R) của MỌI lệnh đã đóng trong phần chart đang tải.
 *   Kéo chart tải thêm nến cũ -> run() chạy lại -> số lệnh, tổng R và khoảng thời gian tự cập nhật.
 * - Vẽ bảng thống kê ở góc trên bên phải của pane:
 *     BACKTEST  +12.34R
 *     45 lệnh · Thắng 38% · PF 1.8 · Max DD -6.2R
 *     01/03/2026 → 12/11/2026 (256 ngày · 18000 nến)
 *
 * API: BacktestModule.computeStats(trades, candles) -> stats
 *      BacktestModule.drawPanel(scope, stats)  (scope = useBitmapCoordinateSpace scope)
 *
 * Load file này TRƯỚC ma-signal.js và breakout.js.
 */
const BacktestModule = (function () {
  function toMs(t) {
    if (typeof t === 'number') return t * 1000; // lightweight-charts: giây UTC
    if (typeof t === 'string') return Date.parse(t);
    if (t && typeof t === 'object' && t.year) return Date.UTC(t.year, t.month - 1, t.day);
    return NaN;
  }

  const p2 = (n) => String(n).padStart(2, '0');

  function fmtDate(ms, withTime) {
    if (!Number.isFinite(ms)) return '--';
    const d = new Date(ms);
    const base = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
    return withTime ? `${base} ${p2(d.getHours())}:${p2(d.getMinutes())}` : base;
  }

  const fmtR = (r) => `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;

  /** Thống kê trên các lệnh ĐÃ ĐÓNG. Lệnh đang mở chỉ báo riêng (R tạm tính), không cộng vào tổng. */
  function computeStats(trades, candles) {
    const list = trades || [];
    const n = candles ? candles.length : 0;

    let total = 0;
    let wins = 0;
    let losses = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let equity = 0;
    let peak = 0;
    let maxDD = 0;
    let count = 0;
    let open = null;

    for (const t of list) {
      if (t.exitIdx === null || !Number.isFinite(t.r)) {
        open = t;
        continue;
      }
      count++;
      total += t.r;
      equity += t.r;
      if (equity > peak) peak = equity;
      if (peak - equity > maxDD) maxDD = peak - equity;
      if (t.r > 0) {
        wins++;
        grossWin += t.r;
      } else {
        losses++;
        grossLoss += -t.r;
      }
    }

    let floating = null;
    if (open && n && open.risk > 0) {
      floating = ((candles[n - 1].close - open.entry) * open.dir) / open.risk;
    }

    const fromMs = n ? toMs(candles[0].time) : NaN;
    const toMsV = n ? toMs(candles[n - 1].time) : NaN;
    const days = Number.isFinite(fromMs) && Number.isFinite(toMsV) ? Math.max(0, Math.round((toMsV - fromMs) / 86400000)) : 0;

    return {
      totalR: total,
      count,
      wins,
      losses,
      winRate: count ? (wins / count) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      avgR: count ? total / count : 0,
      maxDD,
      floatingR: floating,
      candleCount: n,
      fromMs,
      toMs: toMsV,
      days,
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /** Vẽ bảng thống kê ở góc trên bên phải pane. */
  function drawPanel(scope, s) {
    if (!scope || !s) return;
    const ctx = scope.context;
    const hr = scope.horizontalPixelRatio;
    const vr = scope.verticalPixelRatio;
    const W = scope.bitmapSize.width;

    const font = (px, w) => `${w} ${Math.round(px * vr)}px Inter, -apple-system, "Segoe UI", sans-serif`;
    const green = '#26a69a';
    const red = '#ef5350';
    const dim = '#9aa3b8';

    const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2);
    const withTime = s.days < 30;
    const rangeTxt = `${fmtDate(s.fromMs, withTime)} → ${fmtDate(s.toMs, withTime)}`;
    const subTxt = `${s.days} ngày · ${s.candleCount} nến`;
    const statTxt = `${s.count} lệnh · Thắng ${s.winRate.toFixed(0)}% · PF ${pf} · Max DD -${s.maxDD.toFixed(2)}R`;
    const avgTxt = `TB ${fmtR(s.avgR)}/lệnh`;
    const floatTxt = s.floatingR !== null ? `Đang mở: ${fmtR(s.floatingR)} (chưa tính vào tổng)` : '';

    ctx.save();
    ctx.textBaseline = 'middle';

    const head = 'BACKTEST';
    const big = fmtR(s.totalR);
    ctx.font = font(10, 700);
    const wHead = ctx.measureText(head).width;
    ctx.font = font(18, 700);
    const wBig = ctx.measureText(big).width;
    ctx.font = font(11, 500);
    const lines = [statTxt, avgTxt + '   ' + rangeTxt, subTxt];
    if (floatTxt) lines.push(floatTxt);
    let maxW = Math.max(wHead + 12 * hr + wBig, ...lines.map((t) => ctx.measureText(t).width));

    const padX = 10 * hr;
    const padY = 8 * vr;
    const boxW = maxW + padX * 2;
    const lineH = 15 * vr;
    const headH = 24 * vr;
    const boxH = padY * 2 + headH + lines.length * lineH;
    const x = W - boxW - 12 * hr;
    const y = 12 * vr;

    ctx.fillStyle = 'rgba(19,23,34,0.85)';
    roundRect(ctx, x, y, boxW, boxH, 8 * hr);
    ctx.fill();
    ctx.strokeStyle = 'rgba(128,128,128,0.35)';
    ctx.lineWidth = Math.max(1, hr);
    ctx.stroke();

    // dòng tiêu đề: BACKTEST + tổng R
    const cy = y + padY + headH / 2;
    ctx.textAlign = 'left';
    ctx.font = font(10, 700);
    ctx.fillStyle = dim;
    ctx.fillText(head, x + padX, cy);
    ctx.font = font(18, 700);
    ctx.fillStyle = s.totalR >= 0 ? green : red;
    ctx.fillText(big, x + padX + wHead + 12 * hr, cy);

    // các dòng thống kê
    ctx.font = font(11, 500);
    lines.forEach((t, i) => {
      const ly = y + padY + headH + lineH * i + lineH / 2;
      ctx.fillStyle = i === 0 ? '#d1d4dc' : dim;
      ctx.fillText(t, x + padX, ly);
    });

    ctx.restore();
  }

  return { computeStats, drawPanel, fmtR };
})();