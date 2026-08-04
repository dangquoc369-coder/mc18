/**
 * analytics.js
 * Phần Phân Tích Nhật Ký Lệnh Trading (Trading Analytics & Performance Journal)
 *
 * TÍNH NĂNG CHÍNH:
 * 1. Phân tích hiệu suất chuyên sâu chuyên nghiệp (Quant Metrics) KHÔNG DÙNG AI:
 *    - Total Trades, Win Rate %, Gross Profit, Gross Loss, Net Profit (USD)
 *    - Profit Factor (PF), Expected Payoff ($/trade)
 *    - Sharpe Ratio, Sortino Ratio, Calmar Ratio, Recovery Factor
 *    - Max Drawdown ($ & %), Max Consecutive Wins/Losses, Payoff Ratio
 * 2. Phân biệt theo Tài khoản (Tên + PIN của người dùng hiện tại, chỉ hiện đúng tài khoản đó).
 * 3. Phân biệt Lệnh Bot (EA) vs Lệnh Tay (Manual) dựa trên magic number / comment.
 * 4. Chuẩn hóa Symbol & PnL:
 *    - Symbol: XAUUSDc -> XAUUSD, BTCUSDc -> BTCUSD (luôn bỏ đuôi 'c')
 *    - PnL: Mặc định tự động quy đổi từ tài khoản USC (cent) sang USD (PnL_USD = PnL_USC / 100).
 * 5. Biểu đồ đường Lợi nhuận Tích lũy (Cumulative PnL / Equity Curve Canvas 2D interactive).
 * 6. Mã nguồn MQL5 EA MT5 chuẩn chỉnh + Hướng dẫn kết nối VPS MT5 chi tiết.
 * 7. Tối ưu phân trang & mượt mà 60fps khi lưu hàng nghìn lệnh giao dịch.
 */

const AnalyticsModule = (function () {
  const TRADES_STORAGE_KEY = 'dq_tracker_trades_v1';

  let trades = [];
  let currentView = 'chart'; // 'chart' | 'tasks' | 'analytics'

  // Bộ lọc
  let filterType = 'all';    // 'all' | 'bot' | 'manual'
  let filterSymbol = 'all';  // 'all' | 'XAUUSD' | 'BTCUSD' | 'OTHER'
  let filterTime = 'all';    // 'all' | '7d' | '30d' | 'month'

  // Phân trang
  let currentPage = 1;
  const pageSize = 20;

  // Lấy deviceId (tên tài khoản người dùng)
  function getDeviceId() {
    try {
      return localStorage.getItem('dq_tracker_device_id_v1') || 'default_user';
    } catch (e) {
      return 'default_user';
    }
  }

  // Tải dữ liệu từ LocalStorage
  function loadLocalTrades() {
    try {
      const raw = localStorage.getItem(TRADES_STORAGE_KEY);
      trades = raw ? JSON.parse(raw) : [];
    } catch (err) {
      trades = [];
    }
  }

  // Lưu xuống LocalStorage và đồng bộ server nếu cần
  function persistLocalTrades({ sync = true } = {}) {
    try {
      localStorage.setItem(TRADES_STORAGE_KEY, JSON.stringify(trades));
    } catch (err) {
      console.error('[analytics.js] Lỗi lưu trades:', err);
    }
    if (currentView === 'analytics') {
      renderMainView();
    }
    if (sync) {
      syncTradesToServer();
    }
  }

  // Chuẩn hóa 1 bản ghi lệnh
  function normalizeTrade(t) {
    if (!t) return null;
    let symbol = String(t.symbol || 'XAUUSD').trim();
    if (/^[A-Za-z0-9]+c$/i.test(symbol) && symbol.length > 3) {
      symbol = symbol.slice(0, -1);
    }
    symbol = symbol.toUpperCase();

    const magic = Number(t.magic || 0);
    const comment = String(t.comment || '').toLowerCase();
    const isBot = t.isBot !== undefined ? !!t.isBot : (magic > 0 || comment.includes('ea') || comment.includes('bot'));

    const ticket = String(t.ticket || t.id || 'tr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6));
    const type = String(t.type || 'BUY').toUpperCase();
    const lots = Number(t.lots || t.volume || 0.01);
    const openPrice = Number(t.openPrice || 0);
    const closePrice = Number(t.closePrice || 0);
    const openTime = t.openTime ? String(t.openTime) : new Date().toISOString();
    const closeTime = t.closeTime ? String(t.closeTime) : new Date().toISOString();

    // PnL thô từ broker - giữ nguyên con số, chỉ gắn đơn vị USD
    const rawPnl = Number(t.pnl !== undefined ? t.pnl : (t.profit !== undefined ? t.profit : 0));
    const pnlUSD = t.pnlUSD !== undefined ? Number(t.pnlUSD) : rawPnl;

    const commission = Number(t.commission || 0);
    const swap = Number(t.swap || 0);

    return {
      ticket,
      symbol,
      type,
      lots,
      openPrice,
      closePrice,
      openTime,
      closeTime,
      rawPnl,
      pnlUSD,
      commission,
      swap,
      magic,
      comment: t.comment || '',
      isBot
    };
  }

  // Đồng bộ lên Server
  async function syncTradesToServer() {
    const deviceId = getDeviceId();
    if (!deviceId) return;
    try {
      const url = (typeof WORKER_URL !== 'undefined' ? WORKER_URL : 'https://dq-tracker-push.quocngyendanght.workers.dev') + '/api/trades';
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, trades })
      });
    } catch (err) {
      console.error('[analytics.js] Lỗi sync server:', err);
    }
  }

  // Tải từ Server về
  async function pullTradesFromServer() {
    const deviceId = getDeviceId();
    if (!deviceId) return;
    try {
      const url = (typeof WORKER_URL !== 'undefined' ? WORKER_URL : 'https://dq-tracker-push.quocngyendanght.workers.dev') + `/api/trades?deviceId=${encodeURIComponent(deviceId)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.trades)) {
        mergeFromServer(data.trades);
      }
    } catch (err) {
      console.warn('[analytics.js] Không thể kết nối server pull (offline):', err.message || err);
    }
  }

  function mergeFromServer(serverTrades) {
    if (!Array.isArray(serverTrades)) return;
    const existingMap = new Map();
    trades.forEach((t) => existingMap.set(String(t.ticket), t));

    let changed = false;
    serverTrades.forEach((st) => {
      const norm = normalizeTrade(st);
      if (norm && !existingMap.has(norm.ticket)) {
        existingMap.set(norm.ticket, norm);
        changed = true;
      }
    });

    if (changed) {
      trades = Array.from(existingMap.values());
      trades.sort((a, b) => new Date(b.closeTime) - new Date(a.closeTime));
      persistLocalTrades({ sync: false });
    }
  }

  // Lọc danh sách lệnh theo điều kiện
  function getFilteredTrades() {
    const now = new Date();
    return trades.filter((t) => {
      // Lọc theo Bot/Manual
      if (filterType === 'bot' && !t.isBot) return false;
      if (filterType === 'manual' && t.isBot) return false;

      // Lọc theo Symbol
      if (filterSymbol === 'XAUUSD' && t.symbol !== 'XAUUSD') return false;
      if (filterSymbol === 'BTCUSD' && t.symbol !== 'BTCUSD') return false;
      if (filterSymbol === 'OTHER' && (t.symbol === 'XAUUSD' || t.symbol === 'BTCUSD')) return false;

      // Lọc theo thời gian
      if (filterTime !== 'all') {
        const tDate = new Date(t.closeTime);
        const diffDays = (now - tDate) / (1000 * 60 * 60 * 24);
        if (filterTime === '7d' && diffDays > 7) return false;
        if (filterTime === '30d' && diffDays > 30) return false;
        if (filterTime === 'month') {
          if (tDate.getMonth() !== now.getMonth() || tDate.getFullYear() !== now.getFullYear()) return false;
        }
      }

      return true;
    });
  }

  // ===== TÍNH TOÁN CÁC CHỈ SỐ FINANCIAL QUANT METRICS =====
  function computeMetrics(filteredList) {
    if (!Array.isArray(filteredList)) {
      filteredList = [];
    }
    const totalTrades = filteredList.length;
    if (totalTrades === 0) {
      return {
        totalTrades: 0, winCount: 0, lossCount: 0, evenCount: 0, winRate: 0,
        netProfitUSD: 0, grossProfitUSD: 0, grossLossUSD: 0, profitFactor: 0,
        expectedPayoffUSD: 0, avgWinUSD: 0, avgLossUSD: 0, payoffRatio: 0,
        maxDrawdownUSD: 0, maxDrawdownPercent: 0, maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0, sharpeRatio: 0, sortinoRatio: 0,
        recoveryFactor: 0, calmarRatio: 0,
        sortedChronological: []
      };
    }

    let winCount = 0;
    let lossCount = 0;
    let evenCount = 0;
    let grossProfitUSD = 0;
    let grossLossUSD = 0;

    let currentWinStreak = 0;
    let maxConsecutiveWins = 0;
    let currentLossStreak = 0;
    let maxConsecutiveLosses = 0;

    // Sắp xếp tăng dần theo thời gian đóng lệnh để tính Equity Curve
    const sortedChronological = [...filteredList].sort((a, b) => new Date(a.closeTime) - new Date(b.closeTime));

    const pnlList = [];
    let cumulativePnl = 0;
    let peakEquity = 0;
    let maxDrawdownUSD = 0;
    let maxDrawdownPercent = 0;

    sortedChronological.forEach((t) => {
      const pnl = t.pnlUSD;
      pnlList.push(pnl);
      cumulativePnl += pnl;

      if (pnl > 0) {
        winCount++;
        grossProfitUSD += pnl;
        currentWinStreak++;
        if (currentWinStreak > maxConsecutiveWins) maxConsecutiveWins = currentWinStreak;
        currentLossStreak = 0;
      } else if (pnl < 0) {
        lossCount++;
        grossLossUSD += Math.abs(pnl);
        currentLossStreak++;
        if (currentLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentLossStreak;
        currentWinStreak = 0;
      } else {
        evenCount++;
        currentWinStreak = 0;
        currentLossStreak = 0;
      }

      // Max Drawdown calculation
      if (cumulativePnl > peakEquity) {
        peakEquity = cumulativePnl;
      }
      const ddUSD = peakEquity - cumulativePnl;
      if (ddUSD > maxDrawdownUSD) {
        maxDrawdownUSD = ddUSD;
      }
      // Giả định vốn cơ sở là $1,000 + peakEquity
      const baseCapital = 1000 + Math.max(0, peakEquity);
      const ddPct = (ddUSD / baseCapital) * 100;
      if (ddPct > maxDrawdownPercent) {
        maxDrawdownPercent = ddPct;
      }
    });

    const netProfitUSD = grossProfitUSD - grossLossUSD;
    const winRate = (winCount / totalTrades) * 100;
    const profitFactor = grossLossUSD > 0 ? grossProfitUSD / grossLossUSD : (grossProfitUSD > 0 ? 99 : 0);
    const expectedPayoffUSD = netProfitUSD / totalTrades;
    const avgWinUSD = winCount > 0 ? grossProfitUSD / winCount : 0;
    const avgLossUSD = lossCount > 0 ? grossLossUSD / lossCount : 0;
    const payoffRatio = avgLossUSD > 0 ? avgWinUSD / avgLossUSD : 0;

    // Sharpe Ratio
    const meanPnl = netProfitUSD / totalTrades;
    const variance = pnlList.reduce((acc, val) => acc + Math.pow(val - meanPnl, 2), 0) / (totalTrades || 1);
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (meanPnl / stdDev) * Math.sqrt(Math.min(totalTrades, 252)) : 0;

    // Sortino Ratio (Downside deviation)
    const downsideLosses = pnlList.filter((p) => p < 0);
    const downsideVar = downsideLosses.reduce((acc, val) => acc + Math.pow(val, 2), 0) / (totalTrades || 1);
    const downsideStdDev = Math.sqrt(downsideVar);
    const sortinoRatio = downsideStdDev > 0 ? (meanPnl / downsideStdDev) * Math.sqrt(Math.min(totalTrades, 252)) : 0;

    // Recovery Factor
    const recoveryFactor = maxDrawdownUSD > 0 ? netProfitUSD / maxDrawdownUSD : (netProfitUSD > 0 ? 99 : 0);

    // Calmar Ratio
    const calmarRatio = maxDrawdownPercent > 0 ? (netProfitUSD / 1000 * 100) / maxDrawdownPercent : 0;

    return {
      totalTrades, winCount, lossCount, evenCount, winRate,
      netProfitUSD, grossProfitUSD, grossLossUSD, profitFactor,
      expectedPayoffUSD, avgWinUSD, avgLossUSD, payoffRatio,
      maxDrawdownUSD, maxDrawdownPercent, maxConsecutiveWins,
      maxConsecutiveLosses, sharpeRatio, sortinoRatio,
      recoveryFactor, calmarRatio, sortedChronological
    };
  }

  // Format số tiền USD
  function fmtUSD(val, showPlus = false) {
    const num = Number(val || 0);
    const prefix = showPlus && num > 0 ? '+' : '';
    return prefix + '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD';
  }

  // Format phần trăm
  function fmtPct(val) {
    return Number(val || 0).toFixed(1) + '%';
  }

  // ===== GIAO DIỆN CHÍNH (RENDER) =====
  function renderMainView() {
    const container = document.getElementById('analyticsMainView');
    if (!container) return;

    const filteredList = getFilteredTrades();
    const metrics = computeMetrics(filteredList);
    const username = getDeviceId();

    // Phân trang
    const totalPages = Math.ceil(filteredList.length / pageSize) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * pageSize;
    const pageItems = filteredList.slice(startIndex, startIndex + pageSize);

    // HTML cho thẻ Thống kê
    const netClass = metrics.netProfitUSD >= 0 ? 'an-positive' : 'an-negative';

    container.innerHTML = `
      <div class="an-container">

        <!-- Top Header Bar -->
        <div class="an-header">
          <div class="an-header-title-box">
            <h2 class="an-title">📈 Phân Tích Nhật Ký Lệnh Trading (Quant Analytics)</h2>
            <div class="an-subtitle">
              Tài khoản: <strong>${escapeHtml(username)}</strong> &bull; Tự động đồng bộ từ EA MQL5 &bull; Đơn vị hiển thị: <strong>USD</strong>
            </div>
          </div>
          <div class="an-header-actions">
            <button type="button" class="an-btn primary" id="anOpenEaModalBtn">🤖 Mã EA MT5 (MQL5)</button>
            <button type="button" class="an-btn" id="anAddManualTradeBtn">+ Thêm lệnh tay</button>
            <button type="button" class="an-btn danger" id="anClearTradesBtn">🗑 Xóa nhật ký</button>
          </div>
        </div>

        <!-- Bộ Lọc (Filters Bar) -->
        <div class="an-filters-card">
          <div class="an-filter-group">
            <label>Nguồn lệnh:</label>
            <div class="an-segmented">
              <button type="button" class="an-seg-btn ${filterType === 'all' ? 'active' : ''}" data-filter-type="all">Tất cả</button>
              <button type="button" class="an-seg-btn ${filterType === 'bot' ? 'active' : ''}" data-filter-type="bot">🤖 Bot EA</button>
              <button type="button" class="an-seg-btn ${filterType === 'manual' ? 'active' : ''}" data-filter-type="manual">✋ Lệnh tay</button>
            </div>
          </div>

          <div class="an-filter-group">
            <label>Cặp tiền:</label>
            <div class="an-segmented">
              <button type="button" class="an-seg-btn ${filterSymbol === 'all' ? 'active' : ''}" data-filter-symbol="all">Tất cả</button>
              <button type="button" class="an-seg-btn ${filterSymbol === 'XAUUSD' ? 'active' : ''}" data-filter-symbol="XAUUSD">XAUUSD</button>
              <button type="button" class="an-seg-btn ${filterSymbol === 'BTCUSD' ? 'active' : ''}" data-filter-symbol="BTCUSD">BTCUSD</button>
              <button type="button" class="an-seg-btn ${filterSymbol === 'OTHER' ? 'active' : ''}" data-filter-symbol="OTHER">Khác</button>
            </div>
          </div>

          <div class="an-filter-group">
            <label>Thời gian:</label>
            <div class="an-segmented">
              <button type="button" class="an-seg-btn ${filterTime === 'all' ? 'active' : ''}" data-filter-time="all">Tất cả</button>
              <button type="button" class="an-seg-btn ${filterTime === '7d' ? 'active' : ''}" data-filter-time="7d">7 ngày</button>
              <button type="button" class="an-seg-btn ${filterTime === '30d' ? 'active' : ''}" data-filter-time="30d">30 ngày</button>
              <button type="button" class="an-seg-btn ${filterTime === 'month' ? 'active' : ''}" data-filter-time="month">Tháng này</button>
            </div>
          </div>
        </div>

        <!-- Grid Thống Kê Chỉ Số Chuyên Sâu (Quant Metrics Grid) -->
        <div class="an-metrics-grid">
          
          <div class="an-card highlight-card">
            <div class="an-card-label">Tổng Lợi Nhuận Ròng</div>
            <div class="an-card-value ${netClass}">${fmtUSD(metrics.netProfitUSD, true)}</div>
            <div class="an-card-sub">Gross Win: ${fmtUSD(metrics.grossProfitUSD)} | Loss: ${fmtUSD(metrics.grossLossUSD)}</div>
          </div>

          <div class="an-card">
            <div class="an-card-label">Tỷ Lệ Thắng (Win Rate)</div>
            <div class="an-card-value">${fmtPct(metrics.winRate)}</div>
            <div class="an-card-sub">${metrics.winCount} thắng &bull; ${metrics.lossCount} thua &bull; ${metrics.evenCount} hòa</div>
          </div>

          <div class="an-card">
            <div class="an-card-label">Profit Factor (PF)</div>
            <div class="an-card-value ${metrics.profitFactor >= 1.5 ? 'an-positive' : (metrics.profitFactor < 1.0 ? 'an-negative' : '')}">
              ${metrics.profitFactor > 0 ? metrics.profitFactor.toFixed(2) : 'N/A'}
            </div>
            <div class="an-card-sub">Lãi gross / Lỗ gross</div>
          </div>

          <div class="an-card">
            <div class="an-card-label">Expected Payoff / Lệnh</div>
            <div class="an-card-value ${metrics.expectedPayoffUSD >= 0 ? 'an-positive' : 'an-negative'}">
              ${fmtUSD(metrics.expectedPayoffUSD, true)}
            </div>
            <div class="an-card-sub">Kỳ vọng lợi nhuận bình quân</div>
          </div>

          <div class="an-card">
            <div class="an-card-label">Sharpe Ratio</div>
            <div class="an-card-value ${metrics.sharpeRatio >= 1 ? 'an-positive' : ''}">
              ${metrics.sharpeRatio.toFixed(2)}
            </div>
            <div class="an-card-sub">Hiệu quả theo rủi ro</div>
          </div>

          <div class="an-card">
            <div class="an-card-label">Sortino Ratio</div>
            <div class="an-card-value ${metrics.sortinoRatio >= 1.5 ? 'an-positive' : ''}">
              ${metrics.sortinoRatio.toFixed(2)}
            </div>
            <div class="an-card-sub">Rủi ro biến động âm</div>
          </div>

          <div class="an-card">
            <div class="an-card-label">Max Drawdown</div>
            <div class="an-card-value an-negative">
              -${fmtUSD(metrics.maxDrawdownUSD)} (${fmtPct(metrics.maxDrawdownPercent)})
            </div>
            <div class="an-card-sub">Sụt giảm tài sản lớn nhất từ đỉnh</div>
          </div>

          <div class="an-card">
            <div class="an-card-label">Lãi TB / Lỗ TB &amp; Payoff Ratio</div>
            <div class="an-card-value">
              ${metrics.payoffRatio.toFixed(2)}
            </div>
            <div class="an-card-sub">Avg Win: +${fmtUSD(metrics.avgWinUSD)} | Avg Loss: -${fmtUSD(metrics.avgLossUSD)}</div>
          </div>

          <div class="an-card">
            <div class="an-card-label">Chuỗi Thắng / Thua Liên Tiếp</div>
            <div class="an-card-value">
              <span class="an-positive">${metrics.maxConsecutiveWins}W</span> / <span class="an-negative">${metrics.maxConsecutiveLosses}L</span>
            </div>
            <div class="an-card-sub">Chuỗi dài nhất trong kỳ</div>
          </div>

          <div class="an-card">
            <div class="an-card-label">Recovery Factor</div>
            <div class="an-card-value ${metrics.recoveryFactor >= 2 ? 'an-positive' : ''}">
              ${metrics.recoveryFactor.toFixed(2)}
            </div>
            <div class="an-card-sub">Khả năng hồi phục tài khoản</div>
          </div>

        </div>

        <!-- Biểu đồ Đường Lợi Nhuận Tích Lũy (Cumulative Equity Curve) -->
        <div class="an-chart-card">
          <div class="an-chart-header">
            <div class="an-chart-title">📊 Biểu Đồ Lợi Nhuận Tích Lũy (Cumulative Equity Curve - USD)</div>
            <div class="an-chart-tag">Tự động cập nhật 2D Canvas</div>
          </div>
          <div class="an-canvas-wrapper" id="anCanvasWrapper">
            <canvas id="anEquityCanvas"></canvas>
            <div id="anChartTooltip" class="an-tooltip hidden"></div>
          </div>
        </div>

        <!-- Mô Phỏng Monte Carlo & Quản Trị Rủi Ro (Quant Risk Lab) -->
        <div class="an-mc-card">
          <div class="an-mc-header">
            <div>
              <div class="an-mc-title">🎲 Mô Phỏng Monte Carlo &amp; Quản Trị Rủi Ro (Quant Risk Lab)</div>
              <div class="an-mc-subtitle">Xáo trộn chuỗi lệnh ngẫu nhiên &amp; tính toán rủi ro cháy tài khoản, Kelly Criterion, Worst Drawdown</div>
            </div>
            <div class="an-mc-controls">
              <div class="an-mc-input-group">
                <label>Vốn ban đầu ($):</label>
                <input type="number" id="anMcCapital" value="10000" step="500" min="100" style="width:90px;">
              </div>
              <div class="an-mc-input-group">
                <label>Số lần chạy:</label>
                <select id="anMcSims">
                  <option value="1000" selected>1,000 lần</option>
                  <option value="2500">2,500 lần</option>
                  <option value="5000">5,000 lần</option>
                </select>
              </div>
              <button type="button" class="an-btn primary" id="anRunMcBtn">🚀 Chạy Mô Phỏng Monte Carlo</button>
            </div>
          </div>

          <!-- Màn hình kết quả Monte Carlo -->
          <div id="anMcResultsArea">
            <!-- Rendered by runAndRenderMonteCarlo() -->
          </div>
        </div>

        <!-- Bảng Nhật Ký Lệnh (Trades Table) -->
        <div class="an-table-card">
          <div class="an-table-header">
            <div class="an-table-title">📝 Lịch Sử Lệnh Giao Dịch (${filteredList.length} lệnh)</div>
            <div class="an-table-pagination">
              <button type="button" class="an-btn-sm" id="anPrevPageBtn" ${currentPage <= 1 ? 'disabled' : ''}>&laquo; Trước</button>
              <span>Trang ${currentPage} / ${totalPages}</span>
              <button type="button" class="an-btn-sm" id="anNextPageBtn" ${currentPage >= totalPages ? 'disabled' : ''}>Sau &raquo;</button>
            </div>
          </div>

          <div class="an-table-wrapper">
            <table class="an-table">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Thời gian đóng</th>
                  <th>Cặp tiền</th>
                  <th>Loại</th>
                  <th>Khối lượng</th>
                  <th>Giá vào</th>
                  <th>Giá đóng</th>
                  <th>PnL (USD)</th>
                  <th>Nguồn</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                ${pageItems.length === 0 ? `
                  <tr>
                    <td colspan="10" class="an-empty">Chưa có dữ liệu lệnh nào phù hợp bộ lọc. Dán mã MQL5 EA vào MT5 VPS hoặc thêm lệnh tay.</td>
                  </tr>
                ` : pageItems.map((t) => {
                  const pnlClass = t.pnlUSD > 0 ? 'an-positive' : (t.pnlUSD < 0 ? 'an-negative' : '');
                  return `
                    <tr>
                      <td><code>#${t.ticket}</code></td>
                      <td>${formatDateStr(t.closeTime)}</td>
                      <td><strong>${escapeHtml(t.symbol)}</strong></td>
                      <td><span class="an-badge ${t.type === 'BUY' ? 'buy' : 'sell'}">${t.type}</span></td>
                      <td>${t.lots} lot</td>
                      <td>${t.openPrice ? t.openPrice.toFixed(2) : '-'}</td>
                      <td>${t.closePrice ? t.closePrice.toFixed(2) : '-'}</td>
                      <td class="${pnlClass} ms-bold">${fmtUSD(t.pnlUSD, true)}</td>
                      <td><span class="an-source ${t.isBot ? 'bot' : 'manual'}">${t.isBot ? '🤖 EA Bot' : '✋ Tay'}</span></td>
                      <td>
                        <button type="button" class="an-icon-btn remove" data-action="delete" data-ticket="${t.ticket}">🗑</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;

    // Gắn sự kiện các nút lọc
    container.querySelectorAll('[data-filter-type]').forEach((b) => {
      b.addEventListener('click', () => { filterType = b.dataset.filterType; currentPage = 1; renderMainView(); });
    });
    container.querySelectorAll('[data-filter-symbol]').forEach((b) => {
      b.addEventListener('click', () => { filterSymbol = b.dataset.filterSymbol; currentPage = 1; renderMainView(); });
    });
    container.querySelectorAll('[data-filter-time]').forEach((b) => {
      b.addEventListener('click', () => { filterTime = b.dataset.filterTime; currentPage = 1; renderMainView(); });
    });

    // Sự kiện phân trang
    container.querySelector('#anPrevPageBtn')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderMainView(); }
    });
    container.querySelector('#anNextPageBtn')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; renderMainView(); }
    });

    // Action buttons
    container.querySelector('#anOpenEaModalBtn')?.addEventListener('click', openEaModal);
    container.querySelector('#anAddManualTradeBtn')?.addEventListener('click', openManualTradeModal);
    container.querySelector('#anClearTradesBtn')?.addEventListener('click', clearAllTrades);

    // Monte Carlo button listener
    container.querySelector('#anRunMcBtn')?.addEventListener('click', () => {
      const capInput = document.getElementById('anMcCapital');
      const simSelect = document.getElementById('anMcSims');
      const capital = parseFloat(capInput?.value) || 10000;
      const sims = parseInt(simSelect?.value) || 1000;
      runAndRenderMonteCarlo(getFilteredTrades(), capital, sims);
    });

    // Delete trade row
    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ticket = btn.dataset.ticket;
        deleteTrade(ticket);
      });
    });

    // Render Canvas Charts (Equity Curve & Monte Carlo)
    requestAnimationFrame(() => {
      drawEquityCurve(metrics.sortedChronological);
      const capInput = document.getElementById('anMcCapital');
      const simSelect = document.getElementById('anMcSims');
      const capital = parseFloat(capInput?.value) || 10000;
      const sims = parseInt(simSelect?.value) || 1000;
      runAndRenderMonteCarlo(filteredList, capital, sims);
    });
  }

  // ===== THUẬT TOÁN MÔ PHỎNG MONTE CARLO & QUANT RISK =====
  function runMonteCarloSimulation(tradesList, initialCapital = 10000, numSims = 1000) {
    let pnlArray = [];
    if (tradesList && tradesList.length > 0) {
      pnlArray = tradesList.map((t) => t.pnlUSD);
    } else {
      pnlArray = [50, -30, 45, -35, 60, -25, -40, 70, 30, -30, 55, -20, 80, -45, 40, -30, 65, -35, 50, -25];
    }

    const targetTradeCount = Math.max(pnlArray.length, 50);

    const winCount = pnlArray.filter((p) => p > 0).length;
    const winRate = winCount / pnlArray.length;
    const wins = pnlArray.filter((p) => p > 0);
    const losses = pnlArray.filter((p) => p < 0);
    const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 1;
    const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;
    const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 1;

    let kellyFraction = winRate - ((1 - winRate) / payoffRatio);
    if (isNaN(kellyFraction) || kellyFraction < 0) kellyFraction = 0;
    if (kellyFraction > 0.5) kellyFraction = 0.5;

    const simulatedMaxDrawdownsUSD = [];
    const simulatedMaxDrawdownsPct = [];
    const simulatedFinalEquities = [];
    const simulatedMaxLossStreaks = [];
    let countRuin20 = 0;
    let countRuin50 = 0;

    const simulatedPaths = [];

    for (let s = 0; s < numSims; s++) {
      let currentEquity = initialCapital;
      let peak = initialCapital;
      let maxDDUSD = 0;
      let maxDDPct = 0;
      let currentLossStreak = 0;
      let maxLossStreak = 0;

      const path = [currentEquity];

      for (let t = 0; t < targetTradeCount; t++) {
        const randIdx = Math.floor(Math.random() * pnlArray.length);
        const pnl = pnlArray[randIdx];

        currentEquity += pnl;
        if (currentEquity > peak) {
          peak = currentEquity;
        }
        const ddUSD = peak - currentEquity;
        const ddPct = peak > 0 ? (ddUSD / peak) * 100 : 0;

        if (ddUSD > maxDDUSD) maxDDUSD = ddUSD;
        if (ddPct > maxDDPct) maxDDPct = ddPct;

        if (pnl < 0) {
          currentLossStreak++;
          if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
        } else if (pnl > 0) {
          currentLossStreak = 0;
        }

        if (s < 40) {
          path.push(currentEquity);
        }
      }

      simulatedMaxDrawdownsUSD.push(maxDDUSD);
      simulatedMaxDrawdownsPct.push(maxDDPct);
      simulatedFinalEquities.push(currentEquity);
      simulatedMaxLossStreaks.push(maxLossStreak);

      if (maxDDPct >= 20) countRuin20++;
      if (maxDDPct >= 50) countRuin50++;

      if (s < 40) {
        simulatedPaths.push(path);
      }
    }

    simulatedMaxDrawdownsUSD.sort((a, b) => a - b);
    simulatedMaxDrawdownsPct.sort((a, b) => a - b);
    simulatedFinalEquities.sort((a, b) => a - b);
    simulatedMaxLossStreaks.sort((a, b) => a - b);

    const p50DDUSD = simulatedMaxDrawdownsUSD[Math.floor(numSims * 0.50)] || 0;
    const p95DDUSD = simulatedMaxDrawdownsUSD[Math.floor(numSims * 0.95)] || 0;
    const p99DDUSD = simulatedMaxDrawdownsUSD[Math.floor(numSims * 0.99)] || 0;

    const p50DDPct = simulatedMaxDrawdownsPct[Math.floor(numSims * 0.50)] || 0;
    const p95DDPct = simulatedMaxDrawdownsPct[Math.floor(numSims * 0.95)] || 0;
    const p99DDPct = simulatedMaxDrawdownsPct[Math.floor(numSims * 0.99)] || 0;

    const p95LossStreak = simulatedMaxLossStreaks[Math.floor(numSims * 0.95)] || 0;

    const probRuin20 = (countRuin20 / numSims) * 100;
    const probRuin50 = (countRuin50 / numSims) * 100;

    const adviceList = [];
    if (p95DDPct > 20) {
      adviceList.push(`⚠️ <strong>Rủi ro sụt giảm cao (High Drawdown Risk)</strong>: Mô phỏng xáo trộn cho thấy ở độ tin cậy 95%, Max Drawdown có thể sụt giảm tới <strong>-${p95DDPct.toFixed(1)}% (-$${p95DDUSD.toFixed(0)} USD)</strong>. Hãy cân nhắc hạ 30% - 50% khối lượng lot.`);
    } else {
      adviceList.push(`✅ <strong>Kiểm soát sụt giảm tốt (Safe Drawdown Profile)</strong>: Mức Drawdown kịch bản xấu (95% tin cậy) giữ ở mức <strong>-${p95DDPct.toFixed(1)}% (-$${p95DDUSD.toFixed(0)} USD)</strong>, rất an toàn.`);
    }

    if (p95LossStreak >= 5) {
      adviceList.push(`🎲 <strong>Cảnh báo chuỗi thua ngẫu nhiên (Sequence Risk)</strong>: Trong ${numSims.toLocaleString()} kịch bản mô phỏng, có 95% khả năng xuất hiện chuỗi thua liên tiếp lên tới <strong>${p95LossStreak} lệnh liên tiếp</strong>. Đừng vội tăng vol khi gặp chuỗi lỗ.`);
    }

    if (kellyFraction > 0) {
      const halfKelly = kellyFraction * 0.5;
      adviceList.push(`💡 <strong>Tỷ lệ vị thế Kelly (Kelly Criterion)</strong>: Mức Full Kelly tối ưu toán học là <strong>${(kellyFraction * 100).toFixed(1)}%</strong> vốn. Khuyên dùng <strong>Half-Kelly (${(halfKelly * 100).toFixed(1)}%)</strong> để vừa tối ưu tăng trưởng vừa tránh biến động nặng.`);
    } else {
      adviceList.push(`🚨 <strong>Chiến lược kỳ vọng âm (Negative Expectancy)</strong>: Tỷ lệ Win/Loss hiện tại cho kết quả Kelly ≤ 0. Nên tối ưu hóa điểm vào lệnh (Risk:Reward ≥ 1.2) trước khi nâng vốn.`);
    }

    return {
      numSims,
      initialCapital,
      targetTradeCount,
      p50DDUSD, p95DDUSD, p99DDUSD,
      p50DDPct, p95DDPct, p99DDPct,
      p95LossStreak,
      probRuin20, probRuin50,
      kellyFraction,
      simulatedPaths,
      adviceList,
      hasRealTrades: tradesList && tradesList.length > 0
    };
  }

  function runAndRenderMonteCarlo(tradesList, initialCapital = 10000, numSims = 1000) {
    const area = document.getElementById('anMcResultsArea');
    if (!area) return;

    const mcData = runMonteCarloSimulation(tradesList, initialCapital, numSims);
    if (!mcData) return;

    area.innerHTML = `
      ${!mcData.hasRealTrades ? `
        <div style="font-size:12px; padding:8px 12px; background:rgba(242, 163, 57, 0.12); border:1px solid rgba(242, 163, 57, 0.3); border-radius:6px; color:var(--text-primary); margin-bottom:12px;">
          ℹ️ <strong>Đang dùng bộ dữ liệu mẫu Benchmark</strong> (${mcData.numSims.toLocaleString()} lần xáo trộn). Khi bạn thêm lệnh thực tế, mô phỏng sẽ tự động tính chính xác theo lịch sử giao dịch của bạn.
        </div>
      ` : ''}

      <div class="an-mc-grid">
        <div class="an-card">
          <div class="an-card-label">Worst Drawdown (95% Tin cậy)</div>
          <div class="an-card-value an-negative">-${fmtUSD(mcData.p95DDUSD)}</div>
          <div class="an-card-sub">-${mcData.p95DDPct.toFixed(1)}% vốn ban đầu &bull; 99% CI: -${mcData.p99DDPct.toFixed(1)}%</div>
        </div>

        <div class="an-card">
          <div class="an-card-label">Xác Suất Sụt Giảm Cháy > 20%</div>
          <div class="an-card-value ${mcData.probRuin20 > 5 ? 'an-negative' : 'an-positive'}">
            ${mcData.probRuin20.toFixed(1)}%
          </div>
          <div class="an-card-sub">Sụt giảm > 50%: ${mcData.probRuin50.toFixed(1)}%</div>
        </div>

        <div class="an-card">
          <div class="an-card-label">Quản Lý Vốn Half-Kelly</div>
          <div class="an-card-value ${mcData.kellyFraction > 0 ? 'an-positive' : 'an-negative'}">
            ${(mcData.kellyFraction * 50).toFixed(1)}%
          </div>
          <div class="an-card-sub">Full Kelly: ${(mcData.kellyFraction * 100).toFixed(1)}% vốn tối ưu</div>
        </div>

        <div class="an-card">
          <div class="an-card-label">Dự Báo Chuỗi Thua Liên Tiếp</div>
          <div class="an-card-value an-negative">
            ${mcData.p95LossStreak} Lệnh
          </div>
          <div class="an-card-sub">95% kịch bản không quá ${mcData.p95LossStreak} thua liền</div>
        </div>
      </div>

      <div style="margin-top:14px; position:relative;" id="anMcCanvasWrapper">
        <div style="font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:6px;">
          📈 Biểu Đồ Quạt Các Kịch Bản Mô Phỏng (${mcData.numSims.toLocaleString()} Đường Equity)
        </div>
        <canvas id="anMcCanvas"></canvas>
      </div>

      <div class="an-mc-advice-box" style="margin-top:14px;">
        <div class="an-mc-advice-title">🧠 Lời Khuyên &amp; Chỉ Số Quản Trị Rủi Ro Chuyên Nghiệp</div>
        <div class="an-mc-advice-list">
          ${mcData.adviceList.map((adv) => `<div class="an-mc-advice-item">${adv}</div>`).join('')}
        </div>
      </div>
    `;

    requestAnimationFrame(() => {
      drawMonteCarloChart(mcData);
    });
  }

  function drawMonteCarloChart(mcData) {
    const canvas = document.getElementById('anMcCanvas');
    const wrapper = document.getElementById('anMcCanvasWrapper');
    if (!canvas || !wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = 220;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    const paths = mcData.simulatedPaths || [];
    if (paths.length === 0) return;

    const steps = paths[0].length;
    const padding = { top: 20, right: 30, bottom: 25, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    let minEq = mcData.initialCapital;
    let maxEq = mcData.initialCapital;

    paths.forEach((p) => {
      p.forEach((val) => {
        if (val < minEq) minEq = val;
        if (val > maxEq) maxEq = val;
      });
    });

    const range = (maxEq - minEq) || 100;
    const yMin = minEq - range * 0.08;
    const yMax = maxEq + range * 0.08;

    function getX(stepIdx) {
      if (steps <= 1) return padding.left;
      return padding.left + (stepIdx / (steps - 1)) * chartW;
    }

    function getY(val) {
      return padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
    }

    const initY = getY(mcData.initialCapital);
    ctx.beginPath();
    ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)';
    ctx.setLineDash([4, 4]);
    ctx.moveTo(padding.left, initY);
    ctx.lineTo(width - padding.right, initY);
    ctx.stroke();
    ctx.setLineDash([]);

    paths.forEach((p) => {
      ctx.beginPath();
      p.forEach((val, stepIdx) => {
        const x = getX(stepIdx);
        const y = getY(val);
        if (stepIdx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = isLight ? 'rgba(41, 98, 255, 0.15)' : 'rgba(41, 98, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    ctx.fillStyle = isLight ? '#676f7e' : 'rgba(200, 205, 220, 0.6)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('$' + Math.round(maxEq), padding.left - 6, padding.top + 10);
    ctx.fillText('$' + Math.round(mcData.initialCapital), padding.left - 6, initY + 3);
    ctx.fillText('$' + Math.round(minEq), padding.left - 6, height - padding.bottom);
  }

  // ===== VẼ BIỂU ĐỒ EQUITY CURVE (CANVAS 2D) =====
  function drawEquityCurve(sortedTrades) {
    const canvas = document.getElementById('anEquityCanvas');
    const wrapper = document.getElementById('anCanvasWrapper');
    const tooltip = document.getElementById('anChartTooltip');
    if (!canvas || !wrapper) return;

    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = 260;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    if (!Array.isArray(sortedTrades) || sortedTrades.length === 0) {
      ctx.fillStyle = isLight ? '#676f7e' : 'rgba(150, 150, 150, 0.8)';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Chưa có dữ liệu lệnh để vẽ biểu đồ lợi nhuận', width / 2, height / 2);
      return;
    }

    // Tính mốc tích lũy PnL
    const points = [{ time: sortedTrades[0].closeTime, pnl: 0, cumPnl: 0, trade: null }];
    let cum = 0;
    sortedTrades.forEach((t) => {
      cum += t.pnlUSD;
      points.push({ time: t.closeTime, pnl: t.pnlUSD, cumPnl: cum, trade: t });
    });

    const padding = { top: 20, right: 30, bottom: 30, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const minPnl = Math.min(0, ...points.map((p) => p.cumPnl));
    const maxPnl = Math.max(0, ...points.map((p) => p.cumPnl));
    const range = (maxPnl - minPnl) || 10;
    const yMargin = range * 0.1;
    const yMin = minPnl - yMargin;
    const yMax = maxPnl + yMargin;

    function getX(index) {
      if (points.length <= 1) return padding.left;
      return padding.left + (index / (points.length - 1)) * chartW;
    }

    function getY(val) {
      return padding.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
    }

    // Đường 0 tham chiếu
    const zeroY = getY(0);
    ctx.beginPath();
    ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)';
    ctx.setLineDash([4, 4]);
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(width - padding.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Gradient tô bên dưới đường
    const lineGrad = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    const lastCum = points[points.length - 1].cumPnl;
    if (lastCum >= 0) {
      lineGrad.addColorStop(0, 'rgba(38, 166, 154, 0.35)');
      lineGrad.addColorStop(1, 'rgba(38, 166, 154, 0.0)');
    } else {
      lineGrad.addColorStop(0, 'rgba(239, 83, 80, 0.35)');
      lineGrad.addColorStop(1, 'rgba(239, 83, 80, 0.0)');
    }

    // Đường Curve
    ctx.beginPath();
    points.forEach((p, idx) => {
      const x = getX(idx);
      const y = getY(p.cumPnl);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Fill area
    ctx.lineTo(getX(points.length - 1), zeroY);
    ctx.lineTo(padding.left, zeroY);
    ctx.closePath();
    ctx.fillStyle = lineGrad;
    ctx.fill();

    // Line stroke
    ctx.beginPath();
    points.forEach((p, idx) => {
      const x = getX(idx);
      const y = getY(p.cumPnl);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lastCum >= 0 ? '#26a69a' : '#ef5350';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Điểm nút (Dots)
    points.forEach((p, idx) => {
      const x = getX(idx);
      const y = getY(p.cumPnl);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = p.pnl >= 0 ? '#26a69a' : '#ef5350';
      ctx.fill();
    });

    // Tooltip khi di chuột
    let activePoint = null;
    canvas.onmousemove = (e) => {
      const bbox = canvas.getBoundingClientRect();
      const mouseX = e.clientX - bbox.left;
      const mouseY = e.clientY - bbox.top;

      let closest = null;
      let minDist = Infinity;

      points.forEach((p, idx) => {
        const x = getX(idx);
        const y = getY(p.cumPnl);
        const dist = Math.hypot(mouseX - x, mouseY - y);
        if (dist < minDist && dist < 30) {
          minDist = dist;
          closest = { ...p, x, y };
        }
      });

      if (closest && tooltip) {
        activePoint = closest;
        tooltip.classList.remove('hidden');
        tooltip.style.left = (closest.x + 10) + 'px';
        tooltip.style.top = (closest.y - 10) + 'px';
        tooltip.innerHTML = `
          <div><strong>${closest.trade ? closest.trade.symbol : 'Bắt đầu'}</strong> #${closest.trade ? closest.trade.ticket : '0'}</div>
          <div>PnL Lệnh: <span class="${closest.pnl >= 0 ? 'an-positive' : 'an-negative'}">${fmtUSD(closest.pnl, true)}</span></div>
          <div>Tích Lũy: <strong>${fmtUSD(closest.cumPnl, true)}</strong></div>
          <div style="font-size:10px; opacity:0.7;">${formatDateStr(closest.time)}</div>
        `;
      } else if (tooltip) {
        tooltip.classList.add('hidden');
      }
    };

    canvas.onmouseleave = () => {
      if (tooltip) tooltip.classList.add('hidden');
    };
  }

  // ===== XOÁ VÀ XỬ LÝ LỆNH =====
  function deleteTrade(ticket) {
    if (!ticket) return;
    if (confirm(`Bạn có chắc chắn muốn xóa lệnh #${ticket} không?`)) {
      trades = trades.filter((t) => String(t.ticket) !== String(ticket));
      persistLocalTrades({ sync: true });
    }
  }

  function clearAllTrades() {
    if (confirm('⚠️ Bạn có chắc chắn muốn XOÁ TOÀN BỘ nhật ký lệnh của tài khoản này không?')) {
      trades = [];
      persistLocalTrades({ sync: true });
    }
  }

  // ===== MODAL THÊM LỆNH TAY MANUAL =====
  function openManualTradeModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'an-modal-backdrop';
    backdrop.innerHTML = `
      <div class="an-modal">
        <div class="an-modal-title">✋ Thêm Lệnh Giao Dịch Thủ Công</div>
        <div class="an-form-group">
          <label>Cặp tiền (Symbol)</label>
          <select id="mtSymbol">
            <option value="XAUUSD">XAUUSD (Vàng)</option>
            <option value="BTCUSD">BTCUSD (Bitcoin)</option>
            <option value="EURUSD">EURUSD</option>
            <option value="GBPUSD">GBPUSD</option>
          </select>
        </div>
        <div class="an-form-row">
          <div class="an-form-group">
            <label>Loại lệnh</label>
            <select id="mtType">
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          <div class="an-form-group">
            <label>Khối lượng (Lots)</label>
            <input type="number" id="mtLots" value="0.01" step="0.01" min="0.01">
          </div>
        </div>
        <div class="an-form-row">
          <div class="an-form-group">
            <label>Giá vào (Entry)</label>
            <input type="number" id="mtOpenPrice" value="2400.00" step="0.01">
          </div>
          <div class="an-form-group">
            <label>Giá đóng (Close)</label>
            <input type="number" id="mtClosePrice" value="2410.00" step="0.01">
          </div>
        </div>
        <div class="an-form-group">
          <label>Lợi nhuận PnL (USD)</label>
          <input type="number" id="mtPnl" value="10.00" step="0.1">
        </div>
        <div class="an-modal-actions">
          <button type="button" class="an-btn" id="mtCancelBtn">Hủy</button>
          <button type="button" class="an-btn primary" id="mtSaveBtn">Lưu Lệnh</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    backdrop.querySelector('#mtCancelBtn').addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#mtSaveBtn').addEventListener('click', () => {
      const symbol = backdrop.querySelector('#mtSymbol').value;
      const type = backdrop.querySelector('#mtType').value;
      const lots = parseFloat(backdrop.querySelector('#mtLots').value) || 0.01;
      const openPrice = parseFloat(backdrop.querySelector('#mtOpenPrice').value) || 0;
      const closePrice = parseFloat(backdrop.querySelector('#mtClosePrice').value) || 0;
      const pnlUSD = parseFloat(backdrop.querySelector('#mtPnl').value) || 0;

      const newTrade = normalizeTrade({
        ticket: 'm_' + Date.now().toString(36),
        symbol,
        type,
        lots,
        openPrice,
        closePrice,
        pnlUSD,
        closeTime: new Date().toISOString(),
        isBot: false,
        comment: 'Manual Trade'
      });

      trades.unshift(newTrade);
      persistLocalTrades({ sync: true });
      backdrop.remove();
    });
  }

  // ===== MODAL EA MT5 MQL5 SCRIPT & HƯỚNG DẪN =====
  function openEaModal() {
    const username = getDeviceId();
    const serverUrl = typeof WORKER_URL !== 'undefined' ? WORKER_URL : 'https://dq-tracker-push.quocngyendanght.workers.dev';

    const mql5Code = `//+------------------------------------------------------------------+
//|                                          TradingPro_EA_Sync.mq5 |
//|                                  Copyright 2026, TradingPro App |
//+------------------------------------------------------------------+
#property copyright "TradingPro"
#property link      ""
#property version   "1.00"
#property strict

//--- INPUT CONFIGURATION
input string   InpServerUrl     = "${serverUrl}"; // URL Server Backend (Allow WebRequest URL)
input string   InpDeviceId      = "${username}"; // Tên tài khoản của bạn (Chỉ nhập Tên, KHÔNG cần nhập PIN)
input bool     InpIsCentAccount = true;                                                 // Tài khoản Cent (USC)?
input int      InpSyncInterval  = 10;                                                   // Khoảng thời gian sync (giây)

int OnInit()
{
   if(StringLen(InpDeviceId) == 0)
   {
      Print("[TradingPro EA] LỖI: Bạn chưa nhập InpDeviceId!");
      return(INIT_FAILED);
   }
   EventSetTimer(InpSyncInterval);
   Print("[TradingPro EA] Đã kết nối EA cho tài khoản: ", InpDeviceId);
   SyncHistoryTrades();
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   SyncHistoryTrades();
}

void SyncHistoryTrades()
{
   if(!HistorySelect(0, TimeCurrent() + 86400)) return;
   
   int totalDeals = HistoryDealsTotal();
   if(totalDeals <= 0) return;

   string jsonTrades = "[";
   int count = 0;

   for(int i = 0; i < totalDeals; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket <= 0) continue;

      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT) continue;

      long dealType = HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) continue;

      string rawSymbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      string symbol = NormalizeSymbol(rawSymbol);
      
      double lots = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double price = HistoryDealGetDouble(ticket, DEAL_PRICE);
      double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double comm = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      double swap = HistoryDealGetDouble(ticket, DEAL_SWAP);
      datetime dealTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      long magic = HistoryDealGetInteger(ticket, DEAL_MAGIC);
      string comment = HistoryDealGetString(ticket, DEAL_COMMENT);

      string typeStr = (dealType == DEAL_TYPE_BUY) ? "BUY" : "SELL";
      
      if(count > 0) jsonTrades += ",";
      
      jsonTrades += "{";
      jsonTrades += "\\"ticket\\":\\"" + IntegerToString(ticket) + "\\",";
      jsonTrades += "\\"symbol\\":\\"" + symbol + "\\",";
      jsonTrades += "\\"type\\":\\"" + typeStr + "\\",";
      jsonTrades += "\\"lots\\":" + DoubleToString(lots, 2) + ",";
      jsonTrades += "\\"closePrice\\":" + DoubleToString(price, 5) + ",";
      jsonTrades += "\\"closeTime\\":\\"" + TimeToString(dealTime, TIME_DATE|TIME_SECONDS) + "\\",";
      jsonTrades += "\\"pnl\\":" + DoubleToString(profit, 2) + ",";
      jsonTrades += "\\"commission\\":" + DoubleToString(comm, 2) + ",";
      jsonTrades += "\\"swap\\":" + DoubleToString(swap, 2) + ",";
      jsonTrades += "\\"magic\\":" + IntegerToString(magic) + ",";
      jsonTrades += "\\"comment\\":\\"" + SanitizeJson(comment) + "\\",";
      jsonTrades += "\\"isBot\\":" + (magic != 0 ? "true" : "false");
      jsonTrades += "}";

      count++;
   }

   jsonTrades += "]";
   if(count == 0) return;

   string payload = "{\\"deviceId\\":\\"" + InpDeviceId + "\\",\\"trades\\":" + jsonTrades + "}";

   string cleanUrl = InpServerUrl;
   StringTrimLeft(cleanUrl);
   StringTrimRight(cleanUrl);
   while(StringLen(cleanUrl) > 0 && StringSubstr(cleanUrl, StringLen(cleanUrl) - 1, 1) == "/")
   {
      cleanUrl = StringSubstr(cleanUrl, 0, StringLen(cleanUrl) - 1);
   }

   string endpoint = cleanUrl;
   if(StringFind(cleanUrl, "/api/trades") < 0 && StringFind(cleanUrl, "/trades") < 0)
   {
      endpoint = cleanUrl + "/api/trades";
   }

   SendJsonPost(endpoint, payload, count);
}

string NormalizeSymbol(string sym)
{
   int len = StringLen(sym);
   if(len > 3 && StringSubstr(sym, len - 1, 1) == "c")
   {
      return StringSubstr(sym, 0, len - 1);
   }
   return sym;
}

string SanitizeJson(string s)
{
   StringReplace(s, "\\"", "\\\\\\"");
   StringReplace(s, "\\r", "");
   StringReplace(s, "\\n", "");
   return s;
}

void SendJsonPost(string url, string jsonBody, int itemCount)
{
   char data[];
   char result[];
   string headers = "Content-Type: application/json\\r\\n";
   string resultHeaders;
   
   StringToCharArray(jsonBody, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, ArraySize(data) - 1);

   ResetLastError();
   int res = WebRequest("POST", url, headers, 3000, data, result, resultHeaders);
   if(res == 200)
   {
      Print("[TradingPro EA] ✅ Đồng bộ thành công ", itemCount, " lệnh lên App!");
   }
   else
   {
      Print("[TradingPro EA] ❌ Error code: ", res, " | Err: ", GetLastError(), " | URL: ", url);
   }
}`;

    const backdrop = document.createElement('div');
    backdrop.className = 'an-modal-backdrop';
    backdrop.innerHTML = `
      <div class="an-modal large">
        <div class="an-modal-title">🤖 Mã Nguồn EA MQL5 Cho MT5 VPS &amp; Hướng Dẫn</div>
        <div class="an-guide-box">
          <p><strong>CÁC BƯỚC CÀI ĐẶT EA LÊN MT5 VPS:</strong></p>
          <ol>
            <li>Mở <strong>MT5 trên VPS</strong> &rarr; Nhấn phím <code>F4</code> để mở trình soạn thảo <strong>MetaEditor</strong>.</li>
            <li>Vào <code>File</code> &rarr; <code>New</code> &rarr; Chọn <strong>Expert Advisor (template)</strong> &rarr; Đặt tên <code>TradingPro_EA_Sync</code> &rarr; Nhấn Finish.</li>
            <li>Xóa toàn bộ mã mặc định, nhấn nút <strong>📋 Copy Mã MQL5</strong> bên dưới và DÁN vào MetaEditor.</li>
            <li>Nhấn <code>F7</code> (Compile) để biên dịch. Màn hình báo <em>0 errors, 0 warnings</em> là xong.</li>
            <li>Trên giao diện MT5 chính: Vào <code>Tools</code> &rarr; <code>Options</code> &rarr; Chọn tab <code>Expert Advisors</code>.</li>
            <li>Tích chọn <code>Allow WebRequest for listed URL</code> và thêm URL Server Backend này vào danh sách (<strong>KHÔNG</strong> phải link GitHub Pages): <br><code style="color:var(--accent-blue);font-weight:bold;">${serverUrl}</code></li>
            <li>Kéo EA <code>TradingPro_EA_Sync</code> vào 1 biểu đồ bất kỳ và bật <code>Algo Trading</code>. Tại tab <strong>Inputs</strong>:
              <ul>
                <li><strong>InpDeviceId:</strong> Chỉ cần điền <strong>Tên tài khoản (Username)</strong> của bạn (ví dụ: <code>${escapeHtml(username)}</code>), <strong>KHÔNG</strong> cần điền PIN. (Nút Copy Mã ở dưới đã tự điền sẵn tên này).</li>
                <li><strong>InpServerUrl:</strong> Giữ nguyên đường link Server Backend ở trên.</li>
              </ul>
            </li>
          </ol>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
          <label style="font-weight:600;">Mã nguồn MQL5 (Đã tích hợp Tên + PIN tài khoản của bạn):</label>
          <button type="button" class="an-btn primary" id="anCopyCodeBtn">📋 Copy Mã MQL5</button>
        </div>

        <textarea readonly class="an-code-area" id="anCodeArea">${mql5Code}</textarea>

        <div class="an-modal-actions" style="margin-top:12px;">
          <button type="button" class="an-btn" id="anCloseEaModalBtn">Đóng</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    backdrop.querySelector('#anCloseEaModalBtn').addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#anCopyCodeBtn').addEventListener('click', () => {
      const codeArea = backdrop.querySelector('#anCodeArea');
      codeArea.select();
      navigator.clipboard.writeText(mql5Code).then(() => {
        alert('✅ Đã copy mã MQL5 vào bộ nhớ tạm!');
      }).catch(() => {
        document.execCommand('copy');
        alert('✅ Đã copy mã MQL5!');
      });
    });
  }

  // Utility ngày tháng
  function formatDateStr(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) {
      return isoStr;
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ===== CHUYỂN ĐỔI TAB VIEW =====
  function switchView(view) {
    currentView = view;
    const tabChart = document.getElementById('sidebarTabChart');
    const tabTasks = document.getElementById('sidebarTabTasks');
    const tabAnalytics = document.getElementById('sidebarTabAnalytics');

    const chartSection = document.getElementById('sidebarChartSection');
    const tasksSection = document.getElementById('sidebarTasksSection');
    const analyticsSection = document.getElementById('sidebarAnalyticsSection');

    const controlBar = document.getElementById('controlBar');
    const chartArea = document.getElementById('chartArea');
    const tasksMainView = document.getElementById('tasksMainView');
    const analyticsMainView = document.getElementById('analyticsMainView');

    tabChart?.classList.toggle('active', view === 'chart');
    tabTasks?.classList.toggle('active', view === 'tasks');
    tabAnalytics?.classList.toggle('active', view === 'analytics');

    chartSection?.classList.toggle('hidden', view !== 'chart');
    tasksSection?.classList.toggle('hidden', view !== 'tasks');
    analyticsSection?.classList.toggle('hidden', view !== 'analytics');

    if (controlBar) controlBar.style.display = view === 'chart' ? '' : 'none';
    if (chartArea) chartArea.style.display = view === 'chart' ? '' : 'none';
    if (tasksMainView) tasksMainView.classList.toggle('hidden', view !== 'tasks');
    if (analyticsMainView) analyticsMainView.classList.toggle('hidden', view !== 'analytics');

    if (view === 'analytics') {
      renderMainView();
      renderSidebarSummary();
    } else if (view === 'chart') {
      requestAnimationFrame(() => {
        if (typeof EventBus !== 'undefined' && typeof Store !== 'undefined') {
          EventBus.emit('layout:changed', {
            layout: Store.getState().layout,
            visiblePaneIds: Store.getVisiblePaneIds(),
          });
        }
      });
    }
  }

  function renderSidebarSummary() {
    const el = document.getElementById('sidebarAnalyticsSummary');
    if (!el) return;
    const metrics = computeMetrics(getFilteredTrades());
    el.innerHTML = `
      <div class="an-sb-card">
        <div class="an-sb-row"><span>Tổng số lệnh:</span> <strong>${metrics.totalTrades}</strong></div>
        <div class="an-sb-row"><span>Win Rate:</span> <span class="an-positive ms-bold">${fmtPct(metrics.winRate)}</span></div>
        <div class="an-sb-row"><span>PnL (USD):</span> <span class="${metrics.netProfitUSD >= 0 ? 'an-positive' : 'an-negative'} ms-bold">${fmtUSD(metrics.netProfitUSD, true)}</span></div>
        <div class="an-sb-footer">Tự động phân biệt Bot &amp; Tay</div>
      </div>
    `;
  }

  function bindTabs() {
    document.getElementById('sidebarTabAnalytics')?.addEventListener('click', () => switchView('analytics'));
  }

  function init() {
    loadLocalTrades();
    bindTabs();
    pullTradesFromServer();
  }

  return {
    init,
    switchView,
    getFilteredTrades,
    pullTradesFromServer,
    syncTradesToServer
  };
})();
