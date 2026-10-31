/**
 * indicator.js
 * Chỉ chứa các hàm TÍNH TOÁN thuần (không đụng vào chart/DOM).
 *
 * CẬP NHẬT - RSI giống chỉ báo "RSI by NĐQ" trên TradingView:
 *   - calcRSI: thêm tham số `source` (close/open/high/low) giống ô "Source" bên Pine.
 *   - calcRSIState: trả về avgGain / avgLoss (RMA kiểu Wilder) tại từng nến.
 *   - calcRSITargetPrice: công thức tính "giá cần đạt để RSI chạm 1 mức" (bảng giá
 *     theo mức RSI), giữ ĐÚNG công thức của Pine (nhân với length).
 */

const IndicatorModule = (function () {
  function calcSMA(values, period) {
    const result = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      const slice = values.slice(i + 1 - period, i + 1);
      if (slice.some((v) => v === null || v === undefined)) continue;
      result[i] = slice.reduce((a, b) => a + b, 0) / period;
    }
    return result;
  }

  function calcEMA(values, period) {
    const k = 2 / (period + 1);
    const result = new Array(values.length).fill(null);
    let emaPrev;

    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value === null || value === undefined) continue;

      if (emaPrev === undefined) {
        if (i + 1 < period) continue;
        const seed = values.slice(i + 1 - period, i + 1);
        if (seed.some((v) => v === null || v === undefined)) continue;
        emaPrev = seed.reduce((a, b) => a + b, 0) / period;
        result[i] = emaPrev;
        continue;
      }

      emaPrev = value * k + emaPrev * (1 - k);
      result[i] = emaPrev;
    }
    return result;
  }

  function calcWMA(values, period) {
    const result = new Array(values.length).fill(null);
    const denom = (period * (period + 1)) / 2;

    for (let i = period - 1; i < values.length; i++) {
      let sum = 0;
      let weight = 1;
      let ok = true;
      for (let j = i - period + 1; j <= i; j++) {
        if (values[j] === null || values[j] === undefined) {
          ok = false;
          break;
        }
        sum += values[j] * weight;
        weight++;
      }
      result[i] = ok ? sum / denom : null;
    }
    return result;
  }

  /** RSI (Wilder, seed bằng SMA - giống ta.rsi của Pine). `source` = close/open/high/low. */
  function calcRSI(candles, period = 14, source = 'close') {
    const closes = candles.map((c) => (c[source] !== undefined ? c[source] : c.close));
    const rsi = new Array(closes.length).fill(null);
    if (closes.length <= period) return rsi;

    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gainSum += diff;
      else lossSum -= diff;
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
  }

  /**
   * avgGain / avgLoss (RMA kiểu Wilder) SAU KHI xử lý nến i, tính theo giá đóng cửa.
   * Giá trị null cho các nến đầu (chưa đủ `period` nến).
   */
  function calcRSIState(candles, period = 14) {
    const n = candles.length;
    const avgGain = new Array(n).fill(null);
    const avgLoss = new Array(n).fill(null);
    if (n <= period) return { avgGain, avgLoss };

    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= period; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff >= 0) gainSum += diff;
      else lossSum -= diff;
    }
    let ag = gainSum / period;
    let al = lossSum / period;
    avgGain[period] = ag;
    avgLoss[period] = al;

    for (let i = period + 1; i < n; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      ag = (ag * (period - 1) + gain) / period;
      al = (al * (period - 1) + loss) / period;
      avgGain[i] = ag;
      avgLoss[i] = al;
    }
    return { avgGain, avgLoss };
  }

  /**
   * Giá cần đạt để RSI chạm `targetRSI` - GIỮ ĐÚNG công thức f_calc_target_price của Pine:
   *   RS = 100/(100 - targetRSI) - 1
   *   targetRSI >= 50: giá = closePrev + (RS*avgLoss - avgGain) * length
   *   targetRSI <  50: giá = closePrev - (avgGain/RS - avgLoss) * length
   */
  function calcRSITargetPrice(targetRSI, closePrev, avgGain, avgLoss, length) {
    const targetRS = 100 / (100 - targetRSI) - 1;
    if (targetRSI >= 50) {
      const requiredGain = targetRS * avgLoss - avgGain;
      return closePrev + requiredGain * length;
    }
    const requiredLoss = avgGain / targetRS - avgLoss;
    return closePrev - requiredLoss * length;
  }

  function calcATR(candles, period = 14) {
    const n = candles.length;
    const atr = new Array(n).fill(null);
    if (n <= period) return atr;

    const tr = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        tr[i] = candles[i].high - candles[i].low;
        continue;
      }
      const highLow = candles[i].high - candles[i].low;
      const highClosePrev = Math.abs(candles[i].high - candles[i - 1].close);
      const lowClosePrev = Math.abs(candles[i].low - candles[i - 1].close);
      tr[i] = Math.max(highLow, highClosePrev, lowClosePrev);
    }

    let sum = 0;
    for (let i = 1; i <= period; i++) sum += tr[i];
    let atrPrev = sum / period;
    atr[period] = atrPrev;

    for (let i = period + 1; i < n; i++) {
      atrPrev = (atrPrev * (period - 1) + tr[i]) / period;
      atr[i] = atrPrev;
    }
    return atr;
  }

  function calcBB(values, period = 20, multiplier = 2) {
    const n = values.length;
    const middle = calcSMA(values, period);
    const upper = new Array(n).fill(null);
    const lower = new Array(n).fill(null);

    for (let i = period - 1; i < n; i++) {
      if (middle[i] === null) continue;
      const slice = values.slice(i + 1 - period, i + 1);
      if (slice.some((v) => v === null || v === undefined)) continue;

      const mean = middle[i];
      const squaredDiffs = slice.map((v) => Math.pow(v - mean, 2));
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
      const stdDev = Math.sqrt(variance);

      upper[i] = mean + multiplier * stdDev;
      lower[i] = mean - multiplier * stdDev;
    }
    return { middle, upper, lower };
  }

  function calcMACD(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const n = values.length;
    const fastEMA = calcEMA(values, fastPeriod);
    const slowEMA = calcEMA(values, slowPeriod);
    const macdLine = new Array(n).fill(null);

    for (let i = 0; i < n; i++) {
      if (fastEMA[i] !== null && slowEMA[i] !== null) {
        macdLine[i] = fastEMA[i] - slowEMA[i];
      }
    }

    const signalLine = calcEMA(macdLine, signalPeriod);
    const hist = new Array(n).fill(null);

    for (let i = 0; i < n; i++) {
      if (macdLine[i] !== null && signalLine[i] !== null) {
        hist[i] = macdLine[i] - signalLine[i];
      }
    }

    return { macd: macdLine, signal: signalLine, hist };
  }

  function toSeriesData(candles, values) {
    return candles
      .map((c, i) => ({ time: c.time, value: values[i] }))
      .filter((d) => d.value !== null && d.value !== undefined);
  }

  return {
    calcSMA,
    calcEMA,
    calcWMA,
    calcRSI,
    calcRSIState,
    calcRSITargetPrice,
    calcATR,
    calcBB,
    calcMACD,
    toSeriesData,
  };
})();