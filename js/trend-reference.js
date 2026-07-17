/**
 * trend-reference.js
 * Module tính TREND THAM KHẢO kiểu mới - HOÀN TOÀN TÁCH BIỆT với breakout.js.
 *
 * Lưu ý quan trọng: phần LỆNH ẢO (BUY/SELL/SL) không đổi gì cả - vẫn do
 * breakout.js xử lý riêng theo entry/higher timeframe mà người dùng chọn ở
 * từng pane. File này CHỈ phục vụ hiển thị "trend tham khảo", tính theo các
 * khung thời gian CỐ ĐỊNH, không phụ thuộc vào timeframe đang xem của pane.
 *
 * ===== TREND SWING (báo đủ 3 dòng H1 | H4 | D1, dù pane đang mở TF nào) =====
 *   - H1  : vùng = High/Low của 2 nến H6  đã đóng gần nhất -> test bằng nến M15 đã đóng gần nhất.
 *   - H4  : vùng = High/Low của 2 nến H12 đã đóng gần nhất -> test bằng nến M30 đã đóng gần nhất.
 *   - D1  : vùng = High/Low của 2 nến D2  đã đóng gần nhất -> test bằng nến H2  đã đóng gần nhất.
 *   Nến test nằm TRONG vùng -> "sideway". Nến test breakout khỏi vùng -> "up"/"down".
 *   Đây là phép test tại 1 thời điểm (nến gần nhất), KHÔNG có bộ nhớ trạng thái.
 *
 *   (CẬP NHẬT ĐỢT NÀY: đổi cặp khung của cả 3 chân Swing sang M15&H6 /
 *   M30&H12 / H2&D2 - trước đây là M15&H4 / H1&D1 / H2&D3. Xem chi tiết cách
 *   ghép nến D2 - vì Binance KHÔNG có sẵn interval 2 ngày - ở hàm buildD2Raw()
 *   bên dưới.)
 *
 *   Số nến signal liên tiếp cần thiết để chuyển sang "sideway" vẫn dùng
 *   chung hằng số SIDEWAY_CONSECUTIVE_CANDLES ở dưới, áp dụng cho cả 3 chân
 *   Swing (H1, H4, D1) vì cả 3 đều gọi chung hàm computeSwingLeg().
 *
 * ===== TREND SCALP (chỉ 2 trạng thái, không có sideway) =====
 *   - vùng = High/Low của 2 nến H2 đã đóng gần nhất -> test bằng M5.
 *   - Khi M5 breakout khỏi vùng thì đổi hướng ("up"/"down"). Khi M5 nằm
 *     TRONG vùng thì GIỮ NGUYÊN hướng đang có trước đó (không có sideway).
 *   -> Đây là logic có "bộ nhớ", phải lặp qua toàn bộ lịch sử M5 đã tải để
 *      xác định đúng hướng đang giữ tại thời điểm hiện tại.
 *   (Không đổi trong đợt fix này.)
 *
 * Dữ liệu nến của các khung THẬT (5m, 15m, 30m, 2h, 6h, 12h, 1d) được app.js
 * tải (REST) và đẩy realtime (WebSocket) vào đây qua setCandles()/
 * upsertCandle(), y hệt cách chart.js/breakout.js đang nhận dữ liệu - xem
 * app.js/websocket.js.
 *
 * Riêng D2 (2 ngày) KHÔNG phải interval có sẵn trên Binance nên KHÔNG cần
 * app.js tải/đẩy gì thêm - module này tự ghép nến D2 từ dữ liệu D1 (raw.d1)
 * đã có sẵn, xem buildD2Raw().
 */

const TrendReferenceModule = (function () {
  // Khung -> interval Binance tương ứng. Đây đều là các interval CÓ SẴN
  // trên Binance. D2 (2 ngày) KHÔNG có trong danh sách này vì Binance không
  // hỗ trợ interval 2d - D2 được tự ghép nội bộ từ D1, xem buildD2Raw().
  const ROLE_INTERVAL = {
    m5: '5m',
    m15: '15m',
    m30: '30m',
    h2: '2h',
    h6: '6h',
    h12: '12h',
    d1: '1d',
  };

  // Cấu hình 3 "chân" của Trend Swing: signalRole đóng nến để test, zoneRole
  // cung cấp vùng High/Low (2 nến đã đóng gần nhất của khung đó).
  // zoneRole = 'd2' là trường hợp đặc biệt: không lấy trực tiếp từ raw['d2']
  // (không tồn tại) mà được ghép động từ raw['d1'] - xem getZoneRaw().
  const SWING_LEGS = [
    { key: 'h1', signalRole: 'm15', zoneRole: 'h6' },
    { key: 'h4', signalRole: 'm30', zoneRole: 'h12' },
    { key: 'd1', signalRole: 'h2', zoneRole: 'd2' },
  ];

  // Trend Scalp: 1 chân duy nhất, có bộ nhớ trạng thái (không sideway).
  const SCALP_LEG = { signalRole: 'm5', zoneRole: 'h2' };

  const ZONE_LOOKBACK = 2; // luôn là 2 nến, cố định, không cấu hình được

  // Số nến signal liên tiếp phải đóng TRONG vùng zone thì Trend Swing
  // (H1/H4/D1) mới được coi là "sideway" - đổi số này để chỉnh độ nhạy: số
  // nhỏ hơn -> chuyển sang sideway nhanh hơn (dễ nhạy/dễ nhiễu hơn); số lớn
  // hơn -> chậm hơn nhưng chắc chắn hơn. Áp dụng CHUNG cho cả 3 chân Swing vì
  // cả 3 đều gọi chung computeSwingLeg(). KHÔNG ảnh hưởng Trend Scalp
  // (computeScalpTrend() không dùng hằng số này, logic scalp không có
  // sideway).
  const SIDEWAY_CONSECUTIVE_CANDLES = 15;

  // ===== Các hàm tiện ích căn chỉnh đa khung (giống ý tưởng trong breakout.js,
  // tách riêng ở đây để trend-reference.js không phụ thuộc vào breakout.js) =====

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

  function computeZone(series, count) {
    if (count < ZONE_LOOKBACK) return null;
    const win = series.slice(count - ZONE_LOOKBACK, count);
    return {
      maxHigh: Math.max(...win.map((c) => c.high)),
      minLow: Math.min(...win.map((c) => c.low)),
    };
  }

  /**
   * Tự ghép nến D2 (2 ngày) từ nến D1 (raw.d1) - vì Binance không có sẵn
   * interval 2d cho khung ngày trở lên (chỉ có 1d và 3d).
   *
   * Cách ghép: gom các nến D1 ĐÃ ĐÓNG theo từng cặp 2 nến liên tiếp, bắt đầu
   * từ nến D1 đã đóng CŨ NHẤT hiện có trong bộ nhớ:
   *   open = open nến D1 đầu cặp
   *   close = close nến D1 cuối cặp
   *   high = max(high 2 nến), low = min(low 2 nến)
   *   time = time nến D1 đầu cặp
   *   closeTime = closeTime nến D1 cuối cặp (đã tính bởi buildClosedSeries)
   *
   * Nến D1 đang chạy (forming, phần tử cuối raw.d1) luôn được gộp cùng nến
   * D1 lẻ còn lại (nếu có) thành 1 nến D2 "đang chạy" ở cuối mảng kết quả -
   * đúng quy ước chung của raw[role] trong module này (phần tử cuối = đang
   * chạy, chưa đóng).
   *
   * Lưu ý: mốc chia cặp 2-ngày phụ thuộc vào SỐ LƯỢNG nến D1 lịch sử đang có
   * trong bộ nhớ (do app.js quyết định tải bao nhiêu nến D1). Nếu số nến D1
   * lịch sử thay đổi, mốc ghép cặp D2 có thể lệch đi vài ngày so với lần
   * trước - đây là đánh đổi cố hữu khi tự ghép nến từ khung nhỏ hơn thay vì
   * dùng interval 2d thật từ sàn.
   */
  function buildD2Raw(d1Raw) {
    const closedD1Series = buildClosedSeries(d1Raw);
    const d1 = (d1Raw || []).slice().sort((a, b) => a.time - b.time);
    if (d1.length < 1) return [];

    const closed = d1.slice(0, -1);
    const forming = d1[d1.length - 1];

    const result = [];
    let i = 0;
    for (; i + 1 < closed.length; i += 2) {
      const a = closed[i];
      const b = closed[i + 1];
      const bClosed = closedD1Series[i + 1];
      result.push({
        time: a.time,
        open: a.open,
        high: Math.max(a.high, b.high),
        low: Math.min(a.low, b.low),
        close: b.close,
        closeTime: bClosed ? bClosed.closeTime : b.time,
      });
    }

    // Nến D1 lẻ còn lại (nếu có) + nến D1 đang chạy -> gộp thành 1 nến D2
    // "đang chạy" (forming), luôn đứng cuối mảng kết quả.
    if (i < closed.length) {
      const a = closed[i];
      result.push({
        time: a.time,
        open: a.open,
        high: Math.max(a.high, forming.high),
        low: Math.min(a.low, forming.low),
        close: forming.close,
      });
    } else {
      result.push({
        time: forming.time,
        open: forming.open,
        high: forming.high,
        low: forming.low,
        close: forming.close,
      });
    }

    return result;
  }

  function create(paneId) {
    // raw[role] = mảng nến thô của khung đó (nến CUỐI CÙNG luôn là nến đang
    // chạy/forming - giống quy ước currentCandles trong chart.js/breakout.js).
    const raw = {};
    Object.keys(ROLE_INTERVAL).forEach((role) => {
      raw[role] = [];
    });

    function setCandles(role, candles) {
      if (!ROLE_INTERVAL[role]) return;
      raw[role] = candles ? candles.slice() : [];
    }

    function upsertCandle(role, candle) {
      if (!ROLE_INTERVAL[role]) return;
      const arr = raw[role];
      const last = arr[arr.length - 1];
      if (last && last.time === candle.time) {
        arr[arr.length - 1] = candle;
      } else if (!last || candle.time > last.time) {
        arr.push(candle);
      }
    }

    function getClosed(role) {
      const arr = raw[role];
      if (!arr || arr.length < 2) return [];
      return arr.slice(0, -1); // bỏ nến cuối (đang chạy, chưa đóng)
    }

    /** Trả về mảng nến thô (raw) của 1 zoneRole, kể cả trường hợp đặc biệt
     * 'd2' (ghép động từ raw.d1, không có sẵn trong `raw`). */
    function getZoneRaw(zoneRole) {
      if (zoneRole === 'd2') return buildD2Raw(raw.d1);
      return raw[zoneRole];
    }

    /** 1 chân Trend Swing: test nến signal đã đóng gần nhất so với vùng zone.
     * Để chuyển sang sideway, cần ít nhất SIDEWAY_CONSECUTIVE_CANDLES nến
     * signal liên tiếp đóng trong vùng zone tương ứng tại thời điểm đó. Nếu
     * không đủ, xu hướng cũ (up/down/sideway trước đó) sẽ được giữ nguyên.
     */
    function computeSwingLeg(leg) {
      const signalClosed = getClosed(leg.signalRole);
      const zoneRaw = getZoneRaw(leg.zoneRole);
      if (signalClosed.length < 1 || !zoneRaw || zoneRaw.length < ZONE_LOOKBACK) return null;

      const zoneSeries = buildClosedSeries(zoneRaw);
      const align = makeAligner(zoneSeries);

      const insideArray = new Array(signalClosed.length).fill(false);
      let direction = null;

      for (let i = 0; i < signalClosed.length; i++) {
        const bar = signalClosed[i];
        const count = align(bar.time);
        const zone = computeZone(zoneSeries, count);
        if (!zone) continue;

        const isInsideZone = bar.close >= zone.minLow && bar.close <= zone.maxHigh;
        insideArray[i] = isInsideZone;

        if (bar.close > zone.maxHigh) {
          direction = 'up';
        } else if (bar.close < zone.minLow) {
          direction = 'down';
        } else {
          // Nằm trong vùng zone: kiểm tra SIDEWAY_CONSECUTIVE_CANDLES nến
          // liên tiếp đóng trong zone.
          let consecutiveInside = true;
          for (let k = 0; k < SIDEWAY_CONSECUTIVE_CANDLES; k++) {
            if (i - k < 0 || !insideArray[i - k]) {
              consecutiveInside = false;
              break;
            }
          }
          if (consecutiveInside) {
            direction = 'sideway';
          }
          // Nếu không đủ số nến liên tiếp yêu cầu, direction giữ nguyên xu
          // hướng trước đó.
        }
      }

      return direction;
    }

    /**
     * Trend Scalp: lặp qua TOÀN BỘ lịch sử nến signal (M5) đã đóng, mỗi lần
     * breakout khỏi vùng (H2) thì đổi hướng; nằm trong vùng thì giữ nguyên
     * hướng trước đó. Không có "sideway". Trả về null nếu trong toàn bộ dữ
     * liệu đã tải chưa từng có 1 lần breakout nào (rất hiếm, coi như chưa
     * xác định được - UI sẽ hiện "Đang xác định...").
     */
    function computeScalpTrend() {
      const signalClosed = getClosed(SCALP_LEG.signalRole);
      const zoneRaw = raw[SCALP_LEG.zoneRole];
      if (signalClosed.length < 1 || !zoneRaw || zoneRaw.length < ZONE_LOOKBACK) return null;

      const zoneSeries = buildClosedSeries(zoneRaw);
      const align = makeAligner(zoneSeries);

      let direction = null;
      for (let i = 0; i < signalClosed.length; i++) {
        const bar = signalClosed[i];
        const count = align(bar.time);
        const zone = computeZone(zoneSeries, count);
        if (!zone) continue;

        if (bar.close > zone.maxHigh) direction = 'up';
        else if (bar.close < zone.minLow) direction = 'down';
        // else: đang trong vùng -> giữ nguyên direction hiện có, không đổi
      }
      return direction;
    }

    /** Trả về { swing: { h1, h4, d1 }, scalp } - dùng cho UI hiển thị. */
    function compute() {
      const swing = {};
      SWING_LEGS.forEach((leg) => {
        swing[leg.key] = computeSwingLeg(leg);
      });
      return { swing, scalp: computeScalpTrend() };
    }

    return { setCandles, upsertCandle, compute };
  }

  return { create, ROLE_INTERVAL };
})();