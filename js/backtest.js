/**
 * backtest.js
 * Chế độ BACKTEST dùng chung cho ma-signal.js và breakout.js (CHỈ ĐỂ HIỂN THỊ).
 *
 * - Cộng PnL (theo R) của MỌI lệnh đã đóng trong phần chart đang tải.
 *   Kéo chart tải thêm nến cũ -> run() chạy lại -> số lệnh, tổng R và khoảng thời gian tự cập nhật.
 * - Vẽ bảng thống kê GỌN ở góc trên bên phải pane, KHÔNG có nền:
 *     BACKTEST  +12.34R
 *     45 lệnh · Thắng 38% · PF 1.8 · Max DD -6.2R
 *     01/03/26 → 12/11/26 · 256 ngày
 *   Chữ có viền mờ cùng màu nền chart nên đọc rõ trên cả theme sáng lẫn tối.
 * - Tự co theo bề rộng pane: pane hẹp (điện thoại / lưới 4 ô) dùng chữ nhỏ và câu ngắn hơn,
 *   dòng nào không vừa bề rộng thì tự bỏ.
 *
 * API: BacktestModule.computeStats(trades, candles) -> stats
 *      BacktestModule.drawPanel(scope, stats)  (scope = useBitmapCoordinateSpace scope)
 *
 * Load file này TRƯỚC ma-signal.js và breakout.js.
 */
const BacktestModule = (function () {
  // Màu chữ theo theme (khớp CHART_THEME trong chart.js). Lãi/lỗ dùng màu nến, đọc được trên cả 2 nền.
  const PALETTE = {
    dark: {
      text: '#d1d4dc',
      dim: '#9aa3b8',
      halo: 'rgba(12,13,20,0.78)',
      win: '#26b59f',
      loss: '#f5535f',
    },
    light: {
      text: '#131722',
      dim: '#5d6578',
      halo: 'rgba(255,255,255,0.85)',
      win: '#08806c',
      loss: '#d92c3a',
    },
  };

  function isLight() {
    try {
      return document.documentElement.getAttribute('data-theme') === 'light';
    } catch (err) {
      return false;
    }
  }

  function toMs(t) {
    if (typeof t === 'number') return t * 1000; // lightweight-charts: giây UTC
    if (typeof t === 'string') return Date.parse(t);
    if (t && typeof t === 'object' && t.year) return Date.UTC(t.year, t.month - 1, t.day);
    return NaN;
  }

  const p2 = (n) => String(n).padStart(2, '0');

  /** Ngày ngắn dd/MM/yy; khoảng ngắn (< 30 ngày) thì dd/MM HH:mm. */
  function fmtDate(ms, withTime) {
    if (!Number.isFinite(ms)) return '--';
    const d = new Date(ms);
    if (withTime) return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
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

  /** Vẽ bảng thống kê gọn, không nền, ở góc trên bên phải pane. */
  function drawPanel(scope, s) {
    if (!scope || !s) return;
    const ctx = scope.context;
    const hr = scope.horizontalPixelRatio;
    const vr = scope.verticalPixelRatio;
    const W = scope.bitmapSize.width;
    const wMedia = W / hr;
    const narrow = wMedia < 520;
    const pal = isLight() ? PALETTE.light : PALETTE.dark;

    const fsSmall = narrow ? 10 : 11;
    const fsBig = narrow ? 14 : 15;
    const fontOf = (px, weight) => `${weight} ${Math.round(px * vr)}px Inter, -apple-system, "Segoe UI", sans-serif`;

    const pf = s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2);
    const withTime = s.days < 30;
    const range = `${fmtDate(s.fromMs, withTime)} → ${fmtDate(s.toMs, withTime)}`;

    const stat = narrow
      ? `${s.count} lệnh · ${s.winRate.toFixed(0)}% · PF ${pf} · DD ${s.maxDD.toFixed(1)}R`
      : `${s.count} lệnh · Thắng ${s.winRate.toFixed(0)}% · PF ${pf} · Max DD -${s.maxDD.toFixed(2)}R`;
    let when = `${range} · ${s.days} ngày`;
    if (!narrow) {
      when += ` · TB ${fmtR(s.avgR)}/lệnh`;
      if (s.floatingR !== null) when += ` · Mở ${fmtR(s.floatingR)}`;
    }

    const rightX = W - 8 * hr;
    const maxTextW = W - 16 * hr;
    let y = 6 * vr;

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * hr;
    ctx.strokeStyle = pal.halo;

    const drawText = (str, x, cy, color, align) => {
      ctx.textAlign = align || 'right';
      ctx.strokeText(str, x, cy);
      ctx.fillStyle = color;
      ctx.fillText(str, x, cy);
    };

    // Dòng 1: BACKTEST + tổng R (số to, xanh/đỏ)
    const bigH = (fsBig + 4) * vr;
    const big = fmtR(s.totalR);
    ctx.font = fontOf(fsBig, 700);
    const bigW = ctx.measureText(big).width;
    drawText(big, rightX, y + bigH / 2, s.totalR >= 0 ? pal.win : pal.loss);
    ctx.font = fontOf(fsSmall - 1, 700);
    drawText('BACKTEST', rightX - bigW - 6 * hr, y + bigH / 2, pal.dim);
    y += bigH;

    // Các dòng phụ: dòng nào không vừa bề rộng pane thì bỏ
    const smallH = (fsSmall + 4) * vr;
    ctx.font = fontOf(fsSmall, 500);
    [
      [stat, pal.text],
      [when, pal.dim],
    ].forEach(([str, color]) => {
      if (ctx.measureText(str).width > maxTextW) return;
      drawText(str, rightX, y + smallH / 2, color);
      y += smallH;
    });

    ctx.restore();
  }

  return { computeStats, drawPanel, fmtR };
})();