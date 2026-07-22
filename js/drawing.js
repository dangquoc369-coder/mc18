/**
 * drawing.js
 * Bộ công cụ vẽ nâng cao kiểu TradingView cho MỖI pane, độc lập với nhau.
 *
 * ============================================================================
 * CẬP NHẬT (đợt nâng cấp "bộ công cụ vẽ chuyên nghiệp"):
 *
 *   Bổ sung thêm nhiều công cụ vẽ mới bên cạnh các công cụ gốc (Con trỏ,
 *   Đường ngang, Đường xu hướng, Hình chữ nhật, Fib Retracement, Chữ/Ghi chú,
 *   Tẩy, Xoá tất cả):
 *
 *     Đường kẻ:    Tia (Ray), Đường mở rộng (Extended Line), Tia ngang
 *                  (Horizontal Ray), Đường dọc (Vertical Line)
 *     Kênh giá:    Kênh giá song song (Parallel Channel) - 3 điểm neo
 *     Fibonacci:   Fib Extension - 3 điểm neo
 *     Hình vẽ:     Hình tròn/Ellipse, Tam giác (3 điểm neo)
 *     Lệnh:        Long Position, Short Position - tự tính Take Profit theo
 *                  tỷ lệ R:R (mặc định 2), sửa được trong bảng công cụ
 *     Ghi chú:     Mũi tên (Arrow) - có đầu mũi tên
 *
 *   KIẾN TRÚC NEO (ANCHOR) - để không phải viết lại toàn bộ pipeline cũ:
 *     - Công cụ 1 điểm neo "đơn":     hline (giá), vline (thời gian),
 *                                     hray (1 điểm {time,price})
 *     - Công cụ 2 điểm neo (p1, p2):  trendline, ray, extendedline,
 *                                     rectangle, circle, arrow, fib,
 *                                     long, short
 *     - Công cụ 3 điểm neo (p1,p2,p3): triangle, channel, fibextension
 *   Nhờ vậy toàn bộ logic kéo-thả để DI CHUYỂN hình đã vẽ (khi ở tool
 *   "Con trỏ") chỉ cần viết theo NHÓM neo ở trên, không phải viết riêng cho
 *   từng loại hình - xem handlePointerMove() nhánh isDraggingShape.
 *
 *   LUỒNG ĐẶT HÌNH 3 ĐIỂM NEO (triangle/channel/fibextension):
 *     Bước 1-2 giống hệt công cụ 2 điểm (giữ chuột/tay xuống - kéo - nhả ra
 *     để đặt điểm 1 và điểm 2, y hệt vẽ Hình chữ nhật). Nhưng thay vì quay
 *     lại "Con trỏ" ngay, sang trạng thái pendingThirdPoint: hình xem trước
 *     bám theo con trỏ/ngón tay, và cú CHẠM/CLICK tiếp theo (không cần kéo)
 *     sẽ chốt điểm neo thứ 3 rồi mới thực sự tạo hình và quay về Con trỏ.
 *
 *   Mọi cơ chế mobile gốc (offset crosshair khỏi ngón tay, "giữ tay để
 *   chỉnh - nhấc tay để đặt" cho công cụ 1 điểm, tự quay về Con trỏ sau khi
 *   vẽ xong...) được GIỮ NGUYÊN và áp dụng luôn cho các công cụ mới.
 * ============================================================================
 */

const DrawingModule = (function () {
  const TOUCH_CROSSHAIR_OFFSET = 40; // px - đẩy điểm vẽ lên trên khỏi ngón tay
  const EXTEND_FACTOR = 60; // hệ số "kéo dài vô tận" cho Tia/Đường mở rộng - canvas tự cắt phần thừa ngoài khung nhìn, không cần tính toán clip chính xác

  // Công cụ chỉ cần 1 điểm neo để đặt hình (không cần kéo)
  const SINGLE_ANCHOR_TOOLS = ['hline', 'vline', 'hray'];
  // Công cụ cần 2 điểm neo (kéo từ điểm 1 sang điểm 2, giống Hình chữ nhật gốc)
  const TWO_ANCHOR_TOOLS = ['trendline', 'ray', 'extendedline', 'rectangle', 'circle', 'arrow', 'fib', 'long', 'short'];
  // Công cụ cần 3 điểm neo (2 điểm đầu kéo-thả như trên, điểm 3 chốt bằng 1 cú chạm/click tiếp theo)
  const THREE_ANCHOR_TOOLS = ['triangle', 'channel', 'fibextension'];
  // Các loại hình cho phép bật/tắt nét đứt trong bảng công cụ
  const DASHED_STYLE_TOOLS = ['hline', 'vline', 'hray', 'trendline', 'ray', 'extendedline', 'rectangle', 'circle', 'triangle', 'arrow', 'channel'];

  // Tên hiển thị (tiếng Việt) cho tiêu đề bảng thuộc tính - CẬP NHẬT (đợt
  // nâng cấp bảng thuộc tính "chuyên nghiệp hơn" kiểu TradingView).
  const TOOL_DISPLAY_NAMES = {
    hline: 'Đường ngang', vline: 'Đường dọc', hray: 'Tia ngang',
    trendline: 'Đường xu hướng', ray: 'Tia (Ray)', extendedline: 'Đường mở rộng',
    rectangle: 'Hình chữ nhật', circle: 'Hình tròn / Ellipse', triangle: 'Tam giác',
    channel: 'Kênh giá song song', fib: 'Fibonacci Retracement', fibextension: 'Fibonacci Extension',
    long: 'Lệnh Long', short: 'Lệnh Short', arrow: 'Mũi tên', text: 'Ghi chú',
  };

  const PRESET_COLORS = ['#f2a339', '#22c9a0', '#ff5a67', '#2962ff', '#d1a53d', '#7e57c2', '#ffffff'];

  function create(paneId, chart, candleSeries, container, options = {}) {
    const { onAlertRequested, onToolChanged } = options;

    let currentTool = 'cursor'; // cursor | hline | vline | hray | trendline | ray | extendedline | rectangle | circle | triangle | channel | fib | fibextension | long | short | arrow | text | eraser | alert
    let drawings = [];
    // Style mặc định áp cho MỌI hình vẽ mới tạo - người dùng có thể "Đặt làm
    // mặc định" ngay trong bảng thuộc tính của 1 hình đã vẽ (xem nút ⭐).
    let defaultStyle = { color: null, width: 1.5 };
    // Ẩn/hiện TOÀN BỘ hình vẽ của pane này bằng 1 nút (giống icon 👁 "Hide
    // all drawings" của TradingView) - khi bật, không vẽ VÀ không bắt sự
    // kiện (cursor/eraser không tương tác được) cho tới khi bật lại.
    let allDrawingsHidden = false;
    let dragStart = null;
    let previewDrawing = null;
    let hoverPoint = null; // { x, y, price } - vị trí crosshair (đã đẩy lên nếu là cảm ứng)
    let touchRawPoint = null; // { x, y } - vị trí NGÓN TAY thật (chưa đẩy), dùng vẽ đường nối
    let pendingTouchPlacement = null; // 'hline' | 'vline' | 'hray' | 'alert' | 'text' - đang giữ tay để đặt, chưa commit
    let pendingThirdPoint = null; // { type, p1, p2, ... } - đã đặt xong 2 điểm neo của công cụ 3 điểm, đang chờ chốt điểm neo thứ 3

    let isDraggingShape = false;
    let draggedDrawingIndex = null;
    let draggedDrawingOriginal = null;
    let dragStartPixel = null;

    let hoveredDrawingIndex = null;
    let selectedDrawingIndex = null;
    let toolbarEl = null;

    // Đảm bảo container có vị trí tương đối
    const computed = window.getComputedStyle(container);
    if (computed.position === 'static') container.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.className = 'draw-canvas';
    canvas.style.touchAction = 'none'; // chặn cuộn trang khi đang kéo vẽ trên mobile
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    function timeToX(time) {
      return chart.timeScale().timeToCoordinate(time);
    }
    function priceToY(price) {
      return candleSeries.priceToCoordinate(price);
    }
    function xToTime(x) {
      return chart.timeScale().coordinateToTime(x);
    }
    function yToPrice(y) {
      return candleSeries.coordinateToPrice(y);
    }

    /** Màu chữ mặc định theo theme hiện tại (khi người dùng CHƯA tự chọn
     * màu riêng cho ghi chú đó) - giống TradingView: chữ ăn theo màu chữ
     * chính của theme, không cố định 1 màu. */
    function getThemeTextColor() {
      const theme = (typeof ThemeModule !== 'undefined' && ThemeModule.getTheme()) || 'dark';
      return theme === 'light' ? '#12151c' : '#e6e9f0';
    }

    /** Màu "viền mảnh cùng nền" (halo) vẽ NGAY DƯỚI chữ để chữ luôn đọc rõ
     * dù đè lên nến sáng/tối - kỹ thuật giống nhãn bản đồ, THAY THẾ hoàn
     * toàn cho hộp nền cũ. */
    function getThemeHaloColor() {
      const theme = (typeof ThemeModule !== 'undefined' && ThemeModule.getTheme()) || 'dark';
      return theme === 'light' ? '#ffffff' : '#0c0d14';
    }
    /**
     * Toạ độ màn hình (px trong canvas) của 1 sự kiện con trỏ. Trên CẢM ỨNG
     * và khi đang ở 1 công cụ VẼ (không phải 'cursor'), y được đẩy lên trên
     * TOUCH_CROSSHAIR_OFFSET px để điểm sẽ vẽ không bị ngón tay che mất -
     * xem drawCrosshair() vẽ đường nối xuống đúng vị trí ngón tay thật.
     * KHÔNG áp dụng offset này cho tool 'cursor' (chọn/kéo hình có sẵn) vì
     * lúc đó cần chạm ĐÚNG vào hình, không phải điểm bị dịch lên.
     */
    function getScreenXY(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      if (e.pointerType === 'touch' && currentTool !== 'cursor') {
        y = Math.max(0, y - TOUCH_CROSSHAIR_OFFSET);
      }
      return { x, y };
    }

    function setTool(tool) {
      currentTool = tool;
      const isInteractive = tool !== 'cursor';
      canvas.style.pointerEvents = isInteractive ? 'auto' : 'none';
      canvas.style.cursor = isInteractive ? 'crosshair' : 'default';
      if (isInteractive) {
        selectedDrawingIndex = null;
        hideToolbar();
        // Nếu đang bật "Ẩn tất cả" (👁) mà người dùng chọn 1 công cụ vẽ mới
        // (khác Con trỏ/Tẩy), tự động hiện lại - tránh việc vừa vẽ xong hình
        // lại "biến mất" ngay lập tức, gây khó hiểu.
        if (allDrawingsHidden && tool !== 'eraser') allDrawingsHidden = false;
      }
      // Đổi tool huỷ luôn mọi thao tác dở dang (đang kéo 2 điểm đầu, hoặc
      // đang chờ chốt điểm neo thứ 3 của công cụ 3 điểm) để tránh trạng
      // thái kẹt giữa chừng.
      dragStart = null;
      previewDrawing = null;
      pendingThirdPoint = null;
      pendingTouchPlacement = null;
      // FIX DELAY: luôn vẽ lại - kể cả khi quay về "Con trỏ" - để xoá NGAY
      // crosshair còn sót lại từ khung vẽ trước đó.
      redraw();
    }

    /**
     * ĐỢT FIX (chuyên nghiệp hơn): sau khi vẽ xong 1 hình / đặt xong 1 cảnh
     * báo / ghi chú, TỰ ĐỘNG quay về "Con trỏ" - đúng hành vi TradingView
     * (chỉ Tẩy mới ở lại chế độ liên tục). onToolChanged() báo cho ui.js vẽ
     * lại nút đang active trong thanh công cụ.
     */
    function returnToCursorAfterDraw() {
      setTool('cursor');
      if (typeof onToolChanged === 'function') onToolChanged();
    }

    function clearAll() {
      drawings = [];
      redraw();
    }

    function getRect() {
      const rect = container.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }

    function drawHandle(x, y) {
      if (x === null || y === null || x === undefined || y === undefined) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#f2a339';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    /** Điểm mở rộng theo hướng (x1,y1)->(x2,y2) ra xa gấp EXTEND_FACTOR lần
     * - canvas tự cắt phần vẽ ngoài khung nhìn nên không cần tính clip
     * chính xác theo biên, chỉ cần "đủ xa" để luôn phủ hết khung nhìn. */
    function extendPointBeyond(x1, y1, x2, y2, factor) {
      return { x: x1 + (x2 - x1) * factor, y: y1 + (y2 - y1) * factor };
    }

    function drawArrowHead(toX, toY, fromX, fromY, color) {
      const angle = Math.atan2(toY - fromY, toX - fromX);
      const headLen = 11;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6.5), toY - headLen * Math.sin(angle - Math.PI / 6.5));
      ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6.5), toY - headLen * Math.sin(angle + Math.PI / 6.5));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    }

    function redraw() {
      const { width, height } = getRect();
      ctx.clearRect(0, 0, width, height);
      if (!allDrawingsHidden) {
        drawings.forEach((d, idx) => drawShape(d, false, idx));
      }
      if (previewDrawing) drawShape(previewDrawing, true);
      drawCrosshair();
    }

    function toRGBA(baseColor, alpha) {
      let r = 242, g = 163, b = 57;
      if (baseColor && baseColor.startsWith('#') && baseColor.length >= 7) {
        const pr = parseInt(baseColor.slice(1, 3), 16);
        const pg = parseInt(baseColor.slice(3, 5), 16);
        const pb = parseInt(baseColor.slice(5, 7), 16);
        if (!isNaN(pr) && !isNaN(pg) && !isNaN(pb)) { r = pr; g = pg; b = pb; }
      }
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function drawShape(d, isPreview, idx) {
      const isHovered = (idx !== undefined && idx === hoveredDrawingIndex);
      const isSelected = (idx !== undefined && idx === selectedDrawingIndex);

      ctx.save();
      ctx.globalAlpha = d.opacity === undefined ? 1 : d.opacity;

      const baseColor = d.color || '#f2a339';
      const baseWidth = d.width || 1.5;
      ctx.strokeStyle = isPreview ? (baseColor === '#f2a339' ? 'rgba(242, 163, 57, 0.55)' : baseColor + '88') : baseColor;

      if (isHovered || isSelected) {
        ctx.lineWidth = baseWidth + 1;
        ctx.shadowColor = baseColor;
        ctx.shadowBlur = 4;
      } else {
        ctx.lineWidth = baseWidth;
      }

      if (d.type === 'hline') {
        const y = priceToY(d.price);
        if (y === null || y === undefined) { ctx.restore(); return; }
        if (d.dashed !== false) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(getRect().width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = baseColor;
        ctx.font = '10px sans-serif';
        ctx.fillText(formatPrice(d.price), 4, y - 4);
        if (isSelected) drawHandle(getRect().width / 2, y);

      } else if (d.type === 'vline') {
        const x = timeToX(d.time);
        if (x === null || x === undefined) { ctx.restore(); return; }
        const { height } = getRect();
        if (d.dashed !== false) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.setLineDash([]);
        if (isSelected) drawHandle(x, height / 2);

      } else if (d.type === 'hray') {
        const x = timeToX(d.p.time);
        const y = priceToY(d.p.price);
        if ([x, y].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        const { width } = getRect();
        if (d.dashed !== false) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = baseColor;
        ctx.font = '10px sans-serif';
        ctx.fillText(formatPrice(d.p.price), x + 4, y - 4);
        if (isSelected) { drawHandle(x, y); }

      } else if (d.type === 'trendline' || d.type === 'ray' || d.type === 'extendedline') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        let startX = x1, startY = y1, endX = x2, endY = y2;
        if (d.type === 'ray') {
          const ext = extendPointBeyond(x1, y1, x2, y2, EXTEND_FACTOR);
          endX = ext.x; endY = ext.y;
        } else if (d.type === 'extendedline') {
          const extA = extendPointBeyond(x2, y2, x1, y1, EXTEND_FACTOR);
          const extB = extendPointBeyond(x1, y1, x2, y2, EXTEND_FACTOR);
          startX = extA.x; startY = extA.y; endX = extB.x; endY = extB.y;
        }

        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.setLineDash([]);

        if (isSelected) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'arrow') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        drawArrowHead(x2, y2, x1, y1, ctx.strokeStyle);
        if (isSelected) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'rectangle') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);

        ctx.fillStyle = toRGBA(baseColor, 0.12);
        ctx.fillRect(rx, ry, rw, rh);
        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
        if (isSelected) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'circle') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        const rxRad = Math.abs(x2 - x1) / 2, ryRad = Math.abs(y2 - y1) / 2;

        ctx.fillStyle = toRGBA(baseColor, 0.12);
        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rxRad, ryRad, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        if (isSelected) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'triangle') {
        const pts = [d.p1, d.p2, d.p3].map((p) => ({ x: timeToX(p.time), y: priceToY(p.price) }));
        if (pts.some((p) => p.x === null || p.y === null || p.x === undefined || p.y === undefined)) { ctx.restore(); return; }

        ctx.fillStyle = toRGBA(baseColor, 0.12);
        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        if (isSelected) pts.forEach((p) => drawHandle(p.x, p.y));

      } else if (d.type === 'channel') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        const x3 = timeToX(d.p3.time), y3 = priceToY(d.p3.price);
        if ([x1, y1, x2, y2, x3, y3].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        const lineYAt = (x) => (x2 === x1 ? y1 : y1 + ((x - x1) / (x2 - x1)) * (y2 - y1));
        const offsetY = y3 - lineYAt(x3);

        // Đường trục chính
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // Đường song song (qua điểm neo thứ 3)
        ctx.beginPath();
        ctx.moveTo(x1, y1 + offsetY);
        ctx.lineTo(x2, y2 + offsetY);
        ctx.stroke();
        // Dải màu giữa 2 đường
        ctx.fillStyle = toRGBA(baseColor, 0.1);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x2, y2 + offsetY);
        ctx.lineTo(x1, y1 + offsetY);
        ctx.closePath();
        ctx.fill();

        if (isSelected) { drawHandle(x1, y1); drawHandle(x2, y2); drawHandle(x3, y3); }

      } else if (d.type === 'fib') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        const priceStart = d.p1.price;
        const priceEnd = d.p2.price;
        const diff = priceEnd - priceStart;
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];

        let colors = [];
        for (let i = 0; i < levels.length; i++) colors.push(toRGBA(baseColor, 0.05 + (i * 0.015)));

        ctx.strokeStyle = isPreview ? 'rgba(242, 163, 57, 0.4)' : 'rgba(124, 132, 150, 0.6)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        levels.forEach((lvl) => {
          const currentPrice = priceStart + lvl * diff;
          const y = priceToY(currentPrice);
          if (y === null || y === undefined) return;

          ctx.strokeStyle = isPreview ? 'rgba(242, 163, 57, 0.4)' : 'rgba(124, 132, 150, 0.8)';
          ctx.beginPath();
          ctx.moveTo(Math.min(x1, x2), y);
          ctx.lineTo(Math.max(x1, x2), y);
          ctx.stroke();

          ctx.fillStyle = isPreview ? 'rgba(242, 163, 57, 0.6)' : '#7c8496';
          ctx.font = '9px sans-serif';
          ctx.fillText(`Fib ${lvl.toFixed(3)} (${formatPrice(currentPrice)})`, Math.max(x1, x2) + 6, y + 3);
        });

        for (let i = 0; i < levels.length - 1; i++) {
          const yA = priceToY(priceStart + levels[i] * diff);
          const yB = priceToY(priceStart + levels[i + 1] * diff);
          if (yA === null || yB === null) continue;
          ctx.fillStyle = colors[i % colors.length];
          ctx.fillRect(Math.min(x1, x2), Math.min(yA, yB), Math.abs(x2 - x1), Math.abs(yB - yA));
        }
        if (isSelected) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'fibextension') {
        // p1 = đầu con sóng, p2 = cuối con sóng (đo biên độ), p3 = điểm thoái
        // lui - các mức mở rộng được tính TỪ p3, theo biên độ p1->p2.
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        const x3 = timeToX(d.p3.time), y3 = priceToY(d.p3.price);
        if ([x1, y1, x2, y2, x3, y3].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        const diff = d.p2.price - d.p1.price;
        const levels = [0, 0.382, 0.618, 1, 1.272, 1.618, 2.0, 2.618];
        const spanStart = Math.min(x1, x2, x3);
        const spanEnd = Math.max(x1, x2, x3) + Math.abs(x2 - x1) * 0.6 + 30;

        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = isPreview ? 'rgba(242, 163, 57, 0.4)' : 'rgba(124, 132, 150, 0.5)';
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
        ctx.stroke();
        ctx.setLineDash([]);

        levels.forEach((lvl) => {
          const price = d.p3.price + lvl * diff;
          const y = priceToY(price);
          if (y === null || y === undefined) return;
          ctx.strokeStyle = isPreview ? 'rgba(242, 163, 57, 0.4)' : (lvl === 1 ? 'rgba(242, 163, 57, 0.9)' : 'rgba(124, 132, 150, 0.8)');
          ctx.beginPath();
          ctx.moveTo(spanStart, y);
          ctx.lineTo(spanEnd, y);
          ctx.stroke();
          ctx.fillStyle = isPreview ? 'rgba(242, 163, 57, 0.6)' : '#7c8496';
          ctx.font = '9px sans-serif';
          ctx.fillText(`${lvl.toFixed(3)} (${formatPrice(price)})`, spanEnd + 4, y + 3);
        });
        if (isSelected) { drawHandle(x1, y1); drawHandle(x2, y2); drawHandle(x3, y3); }

      } else if (d.type === 'long' || d.type === 'short') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price); // vào lệnh
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price); // dừng lỗ
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        const rr = d.rr || 2;
        const entryPrice = d.p1.price;
        const stopPrice = d.p2.price;
        const risk = d.type === 'long' ? (entryPrice - stopPrice) : (stopPrice - entryPrice);
        const targetPrice = d.type === 'long' ? entryPrice + risk * rr : entryPrice - risk * rr;

        const yEntry = y1;
        const yStop = y2;
        const yTarget = priceToY(targetPrice);

        const rx = Math.min(x1, x2), rw = Math.abs(x2 - x1) || 60;

        ctx.setLineDash([]);
        if (yTarget !== null && yTarget !== undefined) {
          ctx.fillStyle = 'rgba(34, 201, 160, 0.16)';
          ctx.fillRect(rx, Math.min(yEntry, yTarget), rw, Math.abs(yTarget - yEntry));
        }
        ctx.fillStyle = 'rgba(255, 90, 103, 0.16)';
        ctx.fillRect(rx, Math.min(yEntry, yStop), rw, Math.abs(yStop - yEntry));

        // Đường vào lệnh / dừng lỗ / chốt lời
        ctx.strokeStyle = baseColor;
        ctx.beginPath(); ctx.moveTo(rx, yEntry); ctx.lineTo(rx + rw, yEntry); ctx.stroke();
        ctx.strokeStyle = '#ff5a67';
        ctx.beginPath(); ctx.moveTo(rx, yStop); ctx.lineTo(rx + rw, yStop); ctx.stroke();
        if (yTarget !== null && yTarget !== undefined) {
          ctx.strokeStyle = '#22c9a0';
          ctx.beginPath(); ctx.moveTo(rx, yTarget); ctx.lineTo(rx + rw, yTarget); ctx.stroke();
        }

        ctx.font = '10px sans-serif';
        ctx.fillStyle = baseColor;
        ctx.fillText(`${d.type === 'long' ? 'LONG' : 'SHORT'} · Vào ${formatPrice(entryPrice)}`, rx + 4, yEntry - 4);
        ctx.fillStyle = '#ff5a67';
        ctx.fillText(`SL ${formatPrice(stopPrice)}`, rx + 4, yStop + 12);
        if (yTarget !== null && yTarget !== undefined) {
          ctx.fillStyle = '#22c9a0';
          ctx.fillText(`TP ${formatPrice(targetPrice)} (R:R 1:${rr})`, rx + 4, yTarget - 4);
        }
        if (isSelected) { drawHandle(x1, y1); drawHandle(x2, y2); }

      } else if (d.type === 'text') {
        const x = timeToX(d.p.time);
        const y = priceToY(d.p.price);
        if (x === null || y === null) { ctx.restore(); return; }

        const fontSize = 13;
        ctx.font = `500 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textBaseline = 'alphabetic';

        const fillColor = d.color || getThemeTextColor();
        const haloColor = getThemeHaloColor();

        // Viền mảnh cùng màu nền (halo) vẽ TRƯỚC - thay cho hộp nền cũ,
        // giúp chữ luôn đọc rõ dù đè lên nến/lưới bất kỳ màu gì.
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeStyle = haloColor;
        ctx.lineWidth = 3;
        ctx.strokeText(d.text, x, y);

        ctx.fillStyle = fillColor;
        ctx.fillText(d.text, x, y);

        // Chỉ khi ĐANG CHỌN/HOVER mới hiện khung chấm chấm mảnh quanh chữ
        // để biết đang thao tác đúng ghi chú nào - không hiện thường trực.
        if (isSelected || isHovered) {
          const textWidth = ctx.measureText(d.text).width;
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(x - 4, y - fontSize - 2, textWidth + 8, fontSize + 8);
          ctx.setLineDash([]);
        }
        if (isSelected) drawHandle(x, y);
      }
      ctx.restore();
    }

    function drawCrosshair() {
      if (!hoverPoint || currentTool === 'cursor') return;
      const { width, height } = getRect();
      const { x, y, price } = hoverPoint;

      ctx.save();
      ctx.strokeStyle = 'rgba(120, 123, 134, 0.65)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);

      if (touchRawPoint) {
        ctx.strokeStyle = 'rgba(242, 163, 57, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(touchRawPoint.x, touchRawPoint.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(touchRawPoint.x, touchRawPoint.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(242, 163, 57, 0.7)';
        ctx.fill();
      }

      if (price !== null && price !== undefined && !Number.isNaN(price)) {
        const label = formatPrice(price);
        ctx.font = '10px sans-serif';
        const textWidth = ctx.measureText(label).width;
        const boxW = textWidth + 8;
        const boxH = 16;
        const boxY = Math.min(Math.max(y - boxH / 2, 0), height - boxH);

        ctx.fillStyle = '#f2a339';
        ctx.fillRect(width - boxW, boxY, boxW, boxH);
        ctx.fillStyle = '#0a0e14';
        ctx.fillText(label, width - boxW + 4, boxY + 11);
      }

      // Đang chờ chốt điểm neo thứ 3 (Tam giác/Kênh giá/Fib Extension) - gợi
      // ý nhỏ để người dùng biết cần bấm thêm 1 lần nữa.
      if (pendingThirdPoint) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#f2a339';
        ctx.fillText('Chạm/bấm để chốt điểm neo thứ 3', Math.min(x + 10, width - 160), Math.max(y - 12, 12));
      }

      ctx.restore();
    }

    function pointFromEvent(e) {
      const { x, y } = getScreenXY(e);
      const time = xToTime(x);
      const price = yToPrice(y);
      return { time, price };
    }

    function distToSegment(xp, yp, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (dx === 0 && dy === 0) return Math.hypot(xp - x1, yp - y1);
      const t = ((xp - x1) * dx + (yp - y1) * dy) / (dx * dx + dy * dy);
      const clampedT = Math.max(0, Math.min(1, t));
      const projX = x1 + clampedT * dx;
      const projY = y1 + clampedT * dy;
      return Math.hypot(xp - projX, yp - projY);
    }

    function boundsHit(x, y, xs, ys, margin) {
      const rx = Math.min(...xs) - margin, ry = Math.min(...ys) - margin;
      const rw = (Math.max(...xs) - Math.min(...xs)) + margin * 2;
      const rh = (Math.max(...ys) - Math.min(...ys)) + margin * 2;
      return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
    }

    function findDrawingAt(pt) {
      if (allDrawingsHidden) return null;
      const x = timeToX(pt.time);
      const y = priceToY(pt.price);
      if (x === null || y === null) return null;

      for (let i = drawings.length - 1; i >= 0; i--) {
        const d = drawings[i];

        if (d.type === 'hline') {
          const dy = priceToY(d.price);
          if (dy !== null && Math.abs(dy - y) < 10) return { index: i };

        } else if (d.type === 'vline') {
          const dx_ = timeToX(d.time);
          if (dx_ !== null && Math.abs(dx_ - x) < 10) return { index: i };

        } else if (d.type === 'hray') {
          const px = timeToX(d.p.time), py = priceToY(d.p.price);
          if (px !== null && py !== null && Math.abs(py - y) < 10 && x >= px - 10) return { index: i };

        } else if (d.type === 'trendline' || d.type === 'ray' || d.type === 'extendedline' || d.type === 'arrow') {
          const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
          const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
          if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
            let sx = x1, sy = y1, ex = x2, ey = y2;
            if (d.type === 'ray') { const e_ = extendPointBeyond(x1, y1, x2, y2, EXTEND_FACTOR); ex = e_.x; ey = e_.y; }
            if (d.type === 'extendedline') {
              const a = extendPointBeyond(x2, y2, x1, y1, EXTEND_FACTOR);
              const b = extendPointBeyond(x1, y1, x2, y2, EXTEND_FACTOR);
              sx = a.x; sy = a.y; ex = b.x; ey = b.y;
            }
            if (distToSegment(x, y, sx, sy, ex, ey) < 10) return { index: i };
          }

        } else if (d.type === 'rectangle' || d.type === 'circle' || d.type === 'fib' || d.type === 'long' || d.type === 'short') {
          const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
          const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
          if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
            if (boundsHit(x, y, [x1, x2], [y1, y2], 8)) return { index: i };
          }

        } else if (d.type === 'triangle' || d.type === 'channel' || d.type === 'fibextension') {
          const pts = [d.p1, d.p2, d.p3].map((p) => ({ x: timeToX(p.time), y: priceToY(p.price) }));
          if (pts.every((p) => p.x !== null && p.y !== null)) {
            if (boundsHit(x, y, pts.map((p) => p.x), pts.map((p) => p.y), 8)) return { index: i };
          }

        } else if (d.type === 'text') {
          const tx = timeToX(d.p.time), ty = priceToY(d.p.price);
          if (tx !== null && ty !== null) {
            ctx.font = '500 13px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const w = ctx.measureText(d.text).width;
            const margin = 6;
            if (x >= tx - margin && x <= tx + w + margin && y >= ty - 13 - margin && y <= ty + margin) return { index: i };
          }
        }
      }
      return null;
    }

    function hideToolbar() {
      if (toolbarEl) {
        toolbarEl.remove();
        toolbarEl = null;
      }
    }

    /** Tính điểm neo trung tâm (tx,ty theo px) dùng để định vị bảng thuộc
     * tính bên trên hình - tách riêng khỏi phần dựng DOM để có thể gọi lại
     * RẺ (không rebuild toàn bộ nút/input) mỗi khi hình bị kéo di chuyển. */
    function computeToolbarAnchor(d) {
      const rect = container.getBoundingClientRect();
      let tx = rect.width / 2;
      let ty = 100;

      if (d.type === 'hline') {
        const y = priceToY(d.price);
        tx = rect.width / 2; ty = y !== null ? y : 100;
      } else if (d.type === 'vline') {
        const x = timeToX(d.time);
        tx = x !== null ? x : rect.width / 2; ty = 100;
      } else if (d.type === 'hray') {
        const x = timeToX(d.p.time), y = priceToY(d.p.price);
        tx = x !== null ? x : rect.width / 2; ty = y !== null ? y : 100;
      } else if (d.p3) {
        const xs = [d.p1, d.p2, d.p3].map((p) => timeToX(p.time)).filter((v) => v !== null);
        const ys = [d.p1, d.p2, d.p3].map((p) => priceToY(p.price)).filter((v) => v !== null);
        if (xs.length) tx = xs.reduce((a, b) => a + b, 0) / xs.length;
        if (ys.length) ty = Math.min(...ys);
      } else if (d.p1 && d.p2) {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
          tx = (x1 + x2) / 2; ty = Math.min(y1, y2);
        }
      } else if (d.type === 'text') {
        const x = timeToX(d.p.time), y = priceToY(d.p.price);
        tx = x !== null ? x : rect.width / 2; ty = y !== null ? y : 100;
      }
      return { tx, ty, rect };
    }

    function computeToolbarTopLeft(d, estHeight) {
      const { tx, ty, rect } = computeToolbarAnchor(d);
      const toolbarWidth = 232;
      const top = Math.max(10, Math.min(ty - estHeight - 12, rect.height - estHeight - 10));
      const left = Math.max(10, Math.min(tx - toolbarWidth / 2, rect.width - toolbarWidth - 10));
      return { top, left, toolbarWidth };
    }

    /** Gọi RẺ mỗi khung hình khi đang KÉO DI CHUYỂN 1 hình đã vẽ - chỉ cập
     * nhật lại vị trí top/left của bảng thuộc tính đã tồn tại sẵn, KHÔNG
     * dựng lại toàn bộ DOM bên trong (màu/độ dày/ô nhập...) như trước đây.
     * Đây là điểm tối ưu hiệu năng quan trọng nhất của đợt nâng cấp này:
     * trước đây showToolbar(idx) - vốn dựng lại ~15-20 phần tử DOM - bị gọi
     * lại trên MỖI sự kiện pointermove khi kéo hình, gây giật/tốn CPU rõ
     * rệt khi kéo nhiều lần liên tục hoặc trên máy yếu. */
    function repositionToolbarOnly(idx) {
      if (!toolbarEl) return;
      const d = drawings[idx];
      if (!d) return;
      const { top, left } = computeToolbarTopLeft(d, toolbarEl.offsetHeight || 260);
      toolbarEl.style.top = top + 'px';
      toolbarEl.style.left = left + 'px';
    }

    function showToolbar(idx) {
      hideToolbar();
      const d = drawings[idx];
      if (!d) return;

      const { top, left, toolbarWidth } = computeToolbarTopLeft(d, 260);

      toolbarEl = document.createElement('div');
      toolbarEl.className = 'drawing-toolbar';
      toolbarEl.style.position = 'absolute';
      toolbarEl.style.top = top + 'px';
      toolbarEl.style.left = left + 'px';
      toolbarEl.style.width = toolbarWidth + 'px';
      toolbarEl.style.background = 'var(--bg-elevated)';
      toolbarEl.style.border = '1px solid var(--border-color)';
      toolbarEl.style.borderRadius = 'var(--radius-md)';
      toolbarEl.style.padding = '8px';
      toolbarEl.style.display = 'flex';
      toolbarEl.style.flexDirection = 'column';
      toolbarEl.style.gap = '8px';
      toolbarEl.style.boxShadow = 'var(--shadow-md)';
      toolbarEl.style.zIndex = '100';
      toolbarEl.style.fontFamily = 'var(--font)';
      toolbarEl.addEventListener('pointerdown', (e) => e.stopPropagation());

      // ---- Header: tên hình + khoá vị trí + đặt làm mặc định + đóng ----
      const header = document.createElement('div');
      header.className = 'dt-toolbar-header';

      const titleEl = document.createElement('span');
      titleEl.className = 'dt-toolbar-title';
      titleEl.textContent = TOOL_DISPLAY_NAMES[d.type] || d.type;
      header.appendChild(titleEl);

      const headerActions = document.createElement('div');
      headerActions.className = 'dt-toolbar-header-actions';

      if (d.type !== 'text') {
        const lockBtn = document.createElement('button');
lockBtn.type = 'button';
lockBtn.className = 'dt-icon-btn' + (d.locked ? ' active' : '');
setIcon(lockBtn, d.locked ? 'lock' : 'unlock');
lockBtn.title = d.locked ? 'Đã khoá vị trí - bấm để mở khoá (cho phép kéo lại)' : 'Khoá vị trí - không cho kéo di chuyển nữa';
        lockBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          d.locked = !d.locked;
          showToolbar(idx);
        });
        headerActions.appendChild(lockBtn);
      }

      const defaultBtn = document.createElement('button');
defaultBtn.type = 'button';
defaultBtn.className = 'dt-icon-btn';
setIcon(defaultBtn, 'star');
defaultBtn.title = 'Đặt màu & độ dày hiện tại làm mặc định cho MỌI hình vẽ mới';
defaultBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  defaultStyle.color = d.color || defaultStyle.color;
  defaultStyle.width = d.width || defaultStyle.width;
  setIcon(defaultBtn, 'check');
  setTimeout(() => setIcon(defaultBtn, 'star'), 700);
});
      headerActions.appendChild(defaultBtn);

      const closeBtn = document.createElement('button');
closeBtn.type = 'button';
closeBtn.className = 'dt-icon-btn';
setIcon(closeBtn, 'close');
closeBtn.title = 'Đóng bảng thuộc tính';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedDrawingIndex = null;
        hideToolbar();
        redraw();
      });
      headerActions.appendChild(closeBtn);

      header.appendChild(headerActions);
      toolbarEl.appendChild(header);
      toolbarEl.appendChild(Object.assign(document.createElement('div'), { className: 'dt-toolbar-divider' }));

      // ---- Hàng màu: mẫu có sẵn + ô chọn màu tuỳ ý ----
      const colorRow = document.createElement('div');
      colorRow.className = 'dt-color-row';

      PRESET_COLORS.forEach((col) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'dt-color-dot' + ((d.color || '#f2a339') === col ? ' active' : '');
        dot.style.background = col;
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          d.color = col;
          redraw();
          showToolbar(idx);
        });
        colorRow.appendChild(dot);
      });

      const customColor = document.createElement('input');
      customColor.type = 'color';
      customColor.className = 'dt-custom-color';
      customColor.title = 'Chọn màu tuỳ ý';
      customColor.value = /^#[0-9a-fA-F]{6}$/.test(d.color || '') ? d.color : '#f2a339';
      customColor.addEventListener('pointerdown', (e) => e.stopPropagation());
      customColor.addEventListener('input', () => {
        d.color = customColor.value;
        redraw();
      });
      customColor.addEventListener('change', () => showToolbar(idx));
      colorRow.appendChild(customColor);

      toolbarEl.appendChild(colorRow);

      // ---- Hàng độ mờ (opacity) ----
      const opacityRow = document.createElement('div');
      opacityRow.className = 'dt-opacity-row';
      const opLabel = document.createElement('span');
      opLabel.className = 'dt-row-label';
      opLabel.textContent = 'Độ mờ';
      const opValue = document.createElement('span');
      opValue.className = 'dt-opacity-value';
      const currentOpacityPct = Math.round((d.opacity === undefined ? 1 : d.opacity) * 100);
      opValue.textContent = currentOpacityPct + '%';
      const opInput = document.createElement('input');
      opInput.type = 'range';
      opInput.min = '10';
      opInput.max = '100';
      opInput.value = String(currentOpacityPct);
      opInput.className = 'dt-opacity-slider';
      opInput.addEventListener('pointerdown', (e) => e.stopPropagation());
      opInput.addEventListener('input', () => {
        d.opacity = parseInt(opInput.value, 10) / 100;
        opValue.textContent = opInput.value + '%';
        redraw();
      });
      opacityRow.appendChild(opLabel);
      opacityRow.appendChild(opInput);
      opacityRow.appendChild(opValue);
      toolbarEl.appendChild(opacityRow);

      // ---- Hàng độ dày nét: mẫu xem trước dạng thanh (không áp dụng cho ghi chú) ----
      if (d.type !== 'text') {
        const widthRow = document.createElement('div');
        widthRow.className = 'dt-swatch-row';
        [1, 1.5, 2.5].forEach((wVal) => {
          const active = (d.width || 1.5) === wVal;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dt-swatch-btn' + (active ? ' active' : '');
          btn.title = wVal === 1 ? 'Nét mảnh' : wVal === 1.5 ? 'Nét vừa' : 'Nét đậm';
          const bar = document.createElement('span');
          bar.className = 'dt-swatch-bar';
          bar.style.height = (wVal + 0.5) + 'px';
          btn.appendChild(bar);
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            d.width = wVal;
            redraw();
            showToolbar(idx);
          });
          widthRow.appendChild(btn);
        });

        // ---- Kiểu nét (liền/đứt) ghép chung hàng, dạng mẫu xem trước ----
        if (DASHED_STYLE_TOOLS.includes(d.type)) {
          const isDashed = (d.type === 'hline' || d.type === 'vline' || d.type === 'hray') ? d.dashed !== false : !!d.dashed;
          [{ dashed: false, title: 'Nét liền' }, { dashed: true, title: 'Nét đứt' }].forEach((opt) => {
            const active = isDashed === opt.dashed;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dt-swatch-btn' + (active ? ' active' : '');
            btn.title = opt.title;
            const bar = document.createElement('span');
            bar.className = 'dt-swatch-bar' + (opt.dashed ? ' dashed' : '');
            btn.appendChild(bar);
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              d.dashed = opt.dashed;
              redraw();
              showToolbar(idx);
            });
            widthRow.appendChild(btn);
          });
        }
        toolbarEl.appendChild(widthRow);
      }

      // ---- Hàng sửa giá trực tiếp ----
      function makePriceInput(labelText, value, onCommit) {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '6px';

        const label = document.createElement('span');
        label.textContent = labelText;
        label.style.fontSize = '10.5px';
        label.style.color = 'var(--text-secondary)';
        label.style.width = '52px';
        label.style.flexShrink = '0';

        const input = document.createElement('input');
        input.type = 'number';
        input.value = value;
        input.style.flex = '1';
        input.style.minWidth = '0';
        input.style.background = 'var(--bg-main)';
        input.style.border = '1px solid var(--border-color)';
        input.style.borderRadius = 'var(--radius-sm)';
        input.style.color = 'var(--text-primary)';
        input.style.fontFamily = 'var(--font-mono)';
        input.style.fontSize = '11px';
        input.style.padding = '3px 5px';
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') input.blur();
        });
        input.addEventListener('change', () => {
          const v = parseFloat(input.value);
          if (!Number.isNaN(v)) onCommit(v);
        });

        wrap.appendChild(label);
        wrap.appendChild(input);
        return wrap;
      }

      const priceCol = document.createElement('div');
      priceCol.style.display = 'flex';
      priceCol.style.flexDirection = 'column';
      priceCol.style.gap = '4px';

      if (d.type === 'hline') {
        priceCol.appendChild(makePriceInput('Giá', d.price, (v) => { d.price = v; redraw(); }));
      } else if (d.type === 'hray') {
        priceCol.appendChild(makePriceInput('Giá', d.p.price, (v) => { d.p.price = v; redraw(); }));
      } else if (d.type === 'vline') {
        // Đường dọc chỉ neo theo THỜI GIAN - không có ô sửa số, kéo bằng
        // chuột/tay (tool Con trỏ) để di chuyển.
      } else if (d.p3) {
        priceCol.appendChild(makePriceInput('Điểm 1', d.p1.price, (v) => { d.p1.price = v; redraw(); }));
        priceCol.appendChild(makePriceInput('Điểm 2', d.p2.price, (v) => { d.p2.price = v; redraw(); }));
        priceCol.appendChild(makePriceInput('Điểm 3', d.p3.price, (v) => { d.p3.price = v; redraw(); }));
      } else if (d.type === 'long' || d.type === 'short') {
        priceCol.appendChild(makePriceInput('Vào lệnh', d.p1.price, (v) => { d.p1.price = v; redraw(); }));
        priceCol.appendChild(makePriceInput('Dừng lỗ', d.p2.price, (v) => { d.p2.price = v; redraw(); }));
        priceCol.appendChild(makePriceInput('Tỷ lệ R:R', d.rr || 2, (v) => { d.rr = v; redraw(); }));
      } else if (d.p1 && d.p2) {
        priceCol.appendChild(makePriceInput('Điểm 1', d.p1.price, (v) => { d.p1.price = v; redraw(); }));
        priceCol.appendChild(makePriceInput('Điểm 2', d.p2.price, (v) => { d.p2.price = v; redraw(); }));
      } else if (d.type === 'text') {
        const wrap = document.createElement('div');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = d.text;
        input.style.width = '100%';
        input.style.background = 'var(--bg-main)';
        input.style.border = '1px solid var(--border-color)';
        input.style.borderRadius = 'var(--radius-sm)';
        input.style.color = 'var(--text-primary)';
        input.style.fontSize = '11px';
        input.style.padding = '3px 5px';
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => e.stopPropagation());
        input.addEventListener('change', () => {
          if (input.value.trim()) { d.text = input.value.trim(); redraw(); }
        });
        wrap.appendChild(input);
        priceCol.appendChild(wrap);
      }
      toolbarEl.appendChild(priceCol);

      // ---- Xoá hình ----
      const actionRow = document.createElement('div');
      actionRow.style.display = 'flex';
      actionRow.style.justifyContent = 'flex-end';

      const delBtn = document.createElement('button');
delBtn.type = 'button';
delBtn.title = 'Xoá hình';
delBtn.style.display = 'inline-flex';
delBtn.style.alignItems = 'center';
delBtn.style.gap = '4px';
delBtn.innerHTML = Icons.trash.replace('<svg ', '<svg class="icon-svg" ') + '<span>Xoá</span>';
delBtn.style.background = 'transparent';
delBtn.style.border = '1px solid var(--border-color)';
delBtn.style.borderRadius = 'var(--radius-sm)';
delBtn.style.color = 'var(--red)';
delBtn.style.fontSize = '11px';
delBtn.style.cursor = 'pointer';
delBtn.style.padding = '3px 8px';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        drawings.splice(idx, 1);
        selectedDrawingIndex = null;
        hideToolbar();
        redraw();
      });
      actionRow.appendChild(delBtn);
      toolbarEl.appendChild(actionRow);

      container.appendChild(toolbarEl);
    }

    function openTextInputAt(screenXY, pt) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Nhập ghi chú...';
      input.style.position = 'absolute';
      input.style.left = `${screenXY.x}px`;
      input.style.top = `${screenXY.y}px`;
      input.style.background = '#1e222d';
      input.style.color = '#ffffff';
      input.style.border = '1px solid #f2a339';
      input.style.borderRadius = '4px';
      input.style.padding = '4px 8px';
      input.style.fontSize = '12px';
      input.style.zIndex = '9999';

      container.appendChild(input);

      setTimeout(() => { input.focus(); }, 50);

      let submitted = false;
      const submitText = () => {
        if (submitted) return;
        submitted = true;
        const val = input.value.trim();
        if (val) {
          drawings.push({ type: 'text', text: val, p: pt });
          redraw();
        }
        input.remove();
        returnToCursorAfterDraw();
      };

      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') submitText();
        if (ev.key === 'Escape') {
          submitted = true;
          input.remove();
          returnToCursorAfterDraw();
        }
      });

      input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      input.addEventListener('mousedown', (ev) => ev.stopPropagation());
      input.addEventListener('click', (ev) => ev.stopPropagation());

      input.addEventListener('blur', submitText);
    }

    function onPointerDown(e) {
      // Đang chờ chốt điểm neo thứ 3 (Tam giác/Kênh giá/Fib Extension) -
      // cú chạm/click này CHỐT LUÔN điểm neo thứ 3 rồi tạo hình hoàn chỉnh.
      if (pendingThirdPoint) {
        const pt = pointFromEvent(e);
        if (pt.time !== null && pt.time !== undefined && pt.price !== null && pt.price !== undefined) {
          drawings.push({ ...pendingThirdPoint, p3: pt });
          pendingThirdPoint = null;
          previewDrawing = null;
          redraw();
          returnToCursorAfterDraw();
        }
        return;
      }

      const pt = pointFromEvent(e);

      if (currentTool === 'cursor') {
        const match = findDrawingAt(pt);
        if (match !== null) {
          selectedDrawingIndex = match.index;
          showToolbar(match.index);
          // Hình đã khoá (🔒 trong bảng thuộc tính): vẫn chọn được để xem/sửa
          // màu/xoá, nhưng KHÔNG cho kéo di chuyển.
          if (!drawings[match.index].locked) {
            isDraggingShape = true;
            draggedDrawingIndex = match.index;
            draggedDrawingOriginal = JSON.parse(JSON.stringify(drawings[match.index]));
            dragStartPixel = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
          }
          e.stopPropagation();
          e.preventDefault();
        } else {
          selectedDrawingIndex = null;
          hideToolbar();
        }
        redraw();
        return;
      }

      // Eraser tool
      if (currentTool === 'eraser') {
        const match = findDrawingAt(pt);
        if (match !== null && !drawings[match.index].locked) {
          drawings.splice(match.index, 1);
          redraw();
        }
        return;
      }

      // ĐỢT FIX (mobile): công cụ 1 điểm neo ("Đường ngang"/"Đường dọc"/"Tia
      // ngang"/"Cảnh báo giá"/"Ghi chú") trên CẢM ỨNG không commit ngay lúc
      // chạm xuống - giữ tay + kéo để chỉnh đúng vị trí, chỉ commit khi
      // NHẤC TAY (xem onPointerUp). Trên CHUỘT vẫn giữ hành vi cũ (bấm 1
      // phát là đặt luôn).
      if (e.pointerType === 'touch' && (SINGLE_ANCHOR_TOOLS.includes(currentTool) || currentTool === 'alert' || currentTool === 'text')) {
        pendingTouchPlacement = currentTool;
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      // Price alert tool
      if (currentTool === 'alert') {
        if (pt.price === null || pt.price === undefined || Number.isNaN(pt.price)) return;
        if (onAlertRequested) onAlertRequested(pt.price);
        returnToCursorAfterDraw();
        return;
      }

      // Text note tool
      if (currentTool === 'text') {
        if (pt.time === null || pt.time === undefined || pt.price === null || pt.price === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        openTextInputAt(getScreenXY(e), pt);
        return;
      }

      // Công cụ 1 điểm neo trên CHUỘT: đặt ngay lúc bấm xuống
      if (currentTool === 'hline') {
        if (pt.price === null || pt.price === undefined) return;
        drawings.push({ type: 'hline', price: pt.price, color: defaultStyle.color, width: defaultStyle.width, dashed: true });
        redraw();
        returnToCursorAfterDraw();
        return;
      }
      if (currentTool === 'vline') {
        if (pt.time === null || pt.time === undefined) return;
        drawings.push({ type: 'vline', time: pt.time, color: defaultStyle.color, width: defaultStyle.width, dashed: true });
        redraw();
        returnToCursorAfterDraw();
        return;
      }
      if (currentTool === 'hray') {
        if (pt.time === null || pt.time === undefined || pt.price === null || pt.price === undefined) return;
        drawings.push({ type: 'hray', p: { time: pt.time, price: pt.price }, color: defaultStyle.color, width: defaultStyle.width, dashed: true });
        redraw();
        returnToCursorAfterDraw();
        return;
      }

      if (pt.time === null || pt.time === undefined || pt.price === null || pt.price === undefined) return;

      // Mọi công cụ 2 điểm neo (kể cả bước đầu của công cụ 3 điểm neo) bắt
      // đầu bằng thao tác kéo dragStart -> pt, y hệt cơ chế gốc.
      dragStart = pt;
      canvas.setPointerCapture(e.pointerId);
    }

    let moveRafPending = false;
    let latestMoveEvent = null;

    function onPointerMove(e) {
      latestMoveEvent = e;
      if (moveRafPending) return;
      moveRafPending = true;
      requestAnimationFrame(() => {
        moveRafPending = false;
        handlePointerMove(latestMoveEvent);
      });
    }

    function handlePointerMove(e) {
      const { x, y } = getScreenXY(e);
      const pt = pointFromEvent(e);
      hoverPoint = { x, y, price: pt.price };

      if (e.pointerType === 'touch' && currentTool !== 'cursor') {
        const rect = canvas.getBoundingClientRect();
        touchRawPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      } else {
        touchRawPoint = null;
      }

      // Đang chờ chốt điểm neo thứ 3 - preview bám theo con trỏ/ngón tay
      if (pendingThirdPoint) {
        previewDrawing = { ...pendingThirdPoint, p3: pt };
        redraw();
        return;
      }

      // Đang giữ tay để đặt công cụ 1 điểm neo - cập nhật xem trước, chưa commit
      if (pendingTouchPlacement) {
        if (pendingTouchPlacement === 'hline') {
          previewDrawing = { type: 'hline', price: pt.price };
        } else if (pendingTouchPlacement === 'vline') {
          previewDrawing = { type: 'vline', time: pt.time };
        } else if (pendingTouchPlacement === 'hray') {
          previewDrawing = { type: 'hray', p: { time: pt.time, price: pt.price } };
        }
        redraw();
        return;
      }

      if (currentTool === 'cursor') {
        if (isDraggingShape && draggedDrawingOriginal) {
          const dx = e.clientX - dragStartPixel.x;
          const dy = e.clientY - dragStartPixel.y;
          const orig = draggedDrawingOriginal;
          const d = drawings[draggedDrawingIndex];

          if (d) {
            if (d.type === 'hline') {
              const yOrig = priceToY(orig.price);
              if (yOrig !== null && yOrig !== undefined) {
                const newPrice = yToPrice(yOrig + dy);
                if (newPrice !== null && !Number.isNaN(newPrice)) d.price = newPrice;
              }
            } else if (d.type === 'vline') {
              const xOrig = timeToX(orig.time);
              if (xOrig !== null && xOrig !== undefined) {
                const newTime = xToTime(xOrig + dx);
                if (newTime !== null) d.time = newTime;
              }
            } else if (d.type === 'hray') {
              const xOrig = timeToX(orig.p.time), yOrig = priceToY(orig.p.price);
              if (xOrig !== null && yOrig !== null) {
                const t = xToTime(xOrig + dx), p = yToPrice(yOrig + dy);
                if (t !== null && p !== null) d.p = { time: t, price: p };
              }
            } else if (d.type === 'text') {
              const xOrig = timeToX(orig.p.time), yOrig = priceToY(orig.p.price);
              if (xOrig !== null && yOrig !== null) {
                const newX = xOrig + dx, newY = yOrig + dy;
                const t = xToTime(newX), p = yToPrice(newY);
                if (t !== null && p !== null) d.p = { time: t, price: p };
              }
            } else if (d.p3) {
              // Công cụ 3 điểm neo: dịch chuyển cả 3
              const x1o = timeToX(orig.p1.time), y1o = priceToY(orig.p1.price);
              const x2o = timeToX(orig.p2.time), y2o = priceToY(orig.p2.price);
              const x3o = timeToX(orig.p3.time), y3o = priceToY(orig.p3.price);
              if ([x1o, y1o, x2o, y2o, x3o, y3o].every((v) => v !== null && v !== undefined)) {
                const t1 = xToTime(x1o + dx), pr1 = yToPrice(y1o + dy);
                const t2 = xToTime(x2o + dx), pr2 = yToPrice(y2o + dy);
                const t3 = xToTime(x3o + dx), pr3 = yToPrice(y3o + dy);
                if ([t1, pr1, t2, pr2, t3, pr3].every((v) => v !== null && v !== undefined)) {
                  d.p1 = { time: t1, price: pr1 };
                  d.p2 = { time: t2, price: pr2 };
                  d.p3 = { time: t3, price: pr3 };
                }
              }
            } else if (d.p1 && d.p2) {
              // Công cụ 2 điểm neo (trendline/ray/extendedline/rectangle/
              // circle/arrow/fib/long/short)
              const x1Orig = timeToX(orig.p1.time), y1Orig = priceToY(orig.p1.price);
              const x2Orig = timeToX(orig.p2.time), y2Orig = priceToY(orig.p2.price);
              if (x1Orig !== null && y1Orig !== null && x2Orig !== null && y2Orig !== null) {
                const newX1 = x1Orig + dx, newY1 = y1Orig + dy;
                const newX2 = x2Orig + dx, newY2 = y2Orig + dy;
                const t1 = xToTime(newX1), p1 = yToPrice(newY1);
                const t2 = xToTime(newX2), p2 = yToPrice(newY2);
                if (t1 !== null && p1 !== null && t2 !== null && p2 !== null) {
                  d.p1 = { time: t1, price: p1 };
                  d.p2 = { time: t2, price: p2 };
                }
              }
            }
            repositionToolbarOnly(draggedDrawingIndex);
          }
        } else {
          const match = findDrawingAt(pt);
          if (match !== null) {
            hoveredDrawingIndex = match.index;
            canvas.style.pointerEvents = 'auto';
            canvas.style.cursor = 'move';
          } else {
            hoveredDrawingIndex = null;
            canvas.style.pointerEvents = 'none';
            canvas.style.cursor = 'default';
          }
        }
        redraw();
        return;
      }

      if (dragStart && currentTool !== 'alert' && currentTool !== 'text' && currentTool !== 'eraser' &&
          !SINGLE_ANCHOR_TOOLS.includes(currentTool)) {
        if (pt.time === null || pt.time === undefined || pt.price === null || pt.price === undefined) {
          redraw();
          return;
        }
        previewDrawing = { type: currentTool, p1: dragStart, p2: pt };
      }
      redraw();
    }

    function onPointerUp(e) {
      // FIX MOBILE: trên cảm ứng, ngón tay chỉ nhấc lên (pointerup) - xoá
      // crosshair NGAY tại đây, không đợi pointerleave.
      if (e.pointerType === 'touch') {
        hoverPoint = null;
        touchRawPoint = null;
      }

      // Commit công cụ 1 điểm neo đã giữ tay để chỉnh trên cảm ứng
      if (pendingTouchPlacement) {
        const tool = pendingTouchPlacement;
        const pt = pointFromEvent(e);
        pendingTouchPlacement = null;
        previewDrawing = null;

        if (tool === 'hline' && pt.price !== null && pt.price !== undefined && !Number.isNaN(pt.price)) {
          drawings.push({ type: 'hline', price: pt.price, color: defaultStyle.color, width: defaultStyle.width, dashed: true });
          redraw();
          returnToCursorAfterDraw();
        } else if (tool === 'vline' && pt.time !== null && pt.time !== undefined) {
          drawings.push({ type: 'vline', time: pt.time, color: defaultStyle.color, width: defaultStyle.width, dashed: true });
          redraw();
          returnToCursorAfterDraw();
        } else if (tool === 'hray' && pt.time !== null && pt.time !== undefined && pt.price !== null && pt.price !== undefined) {
          drawings.push({ type: 'hray', p: { time: pt.time, price: pt.price }, color: defaultStyle.color, width: defaultStyle.width, dashed: true });
          redraw();
          returnToCursorAfterDraw();
        } else if (tool === 'alert' && pt.price !== null && pt.price !== undefined && !Number.isNaN(pt.price)) {
          if (onAlertRequested) onAlertRequested(pt.price);
          redraw();
          returnToCursorAfterDraw();
        } else if (tool === 'text' && pt.time !== null && pt.time !== undefined && pt.price !== null && pt.price !== undefined) {
          redraw();
          openTextInputAt(getScreenXY(e), pt);
          // returnToCursorAfterDraw() được gọi bên trong openTextInputAt()
        } else {
          redraw();
        }
        return;
      }

      if (currentTool === 'cursor') {
        if (isDraggingShape) {
          canvas.releasePointerCapture(e.pointerId);
          isDraggingShape = false;
          draggedDrawingIndex = null;
          draggedDrawingOriginal = null;
          dragStartPixel = null;
          const pt = pointFromEvent(e);
          const match = findDrawingAt(pt);
          if (match === null) {
            canvas.style.pointerEvents = 'none';
            canvas.style.cursor = 'default';
          }
          redraw();
        }
        return;
      }

      if (currentTool === 'alert' || currentTool === 'text' || currentTool === 'eraser' || !dragStart) {
        redraw();
        return;
      }

      const pt = pointFromEvent(e);
      let shapeCreated = false;
      let needThirdPoint = false;

      if (pt.time !== null && pt.time !== undefined && pt.price !== null && pt.price !== undefined) {
        if (TWO_ANCHOR_TOOLS.includes(currentTool)) {
          const extra = {};
          if (currentTool === 'long' || currentTool === 'short') extra.rr = 2;
          drawings.push({ type: currentTool, p1: dragStart, p2: pt, color: defaultStyle.color, width: defaultStyle.width, dashed: false, ...extra });
          shapeCreated = true;
        } else if (THREE_ANCHOR_TOOLS.includes(currentTool)) {
          pendingThirdPoint = { type: currentTool, p1: dragStart, p2: pt, color: defaultStyle.color, width: defaultStyle.width, dashed: false };
          needThirdPoint = true;
        }
      }

      dragStart = null;
      previewDrawing = null;
      redraw();
      if (shapeCreated) returnToCursorAfterDraw();
      // Nếu needThirdPoint: vẫn giữ nguyên tool hiện tại, chờ cú chạm/click
      // tiếp theo ở onPointerDown để chốt điểm neo thứ 3.
    }

    function onContainerPointerMove(e) {
      if (currentTool !== 'cursor' || isDraggingShape) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = xToTime(x);
      const price = yToPrice(y);

      if (time === null || price === null || Number.isNaN(price)) {
        canvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'default';
        if (hoveredDrawingIndex !== null) {
          hoveredDrawingIndex = null;
          redraw();
        }
        return;
      }

      const match = findDrawingAt({ time, price });
      if (match !== null) {
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'move';
        if (hoveredDrawingIndex !== match.index) {
          hoveredDrawingIndex = match.index;
          redraw();
        }
      } else {
        canvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'default';
        if (hoveredDrawingIndex !== null) {
          hoveredDrawingIndex = null;
          redraw();
        }
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('mousedown', (e) => {
      if (currentTool === 'text') {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', () => {
      dragStart = null;
      previewDrawing = null;
      hoverPoint = null;
      touchRawPoint = null;
      pendingTouchPlacement = null;
      pendingThirdPoint = null;
      isDraggingShape = false;
      draggedDrawingIndex = null;
      draggedDrawingOriginal = null;
      dragStartPixel = null;
      redraw();
    });
    canvas.addEventListener('pointerleave', () => { hoverPoint = null; touchRawPoint = null; redraw(); });
    container.addEventListener('pointermove', onContainerPointerMove);

    /** FIX: đóng toolbar khi bấm vào chỗ TRỐNG trên chart. */
    container.addEventListener('pointerdown', (e) => {
      if (currentTool !== 'cursor') return;
      if (e.target === canvas) return;
      if (selectedDrawingIndex !== null || toolbarEl) {
        selectedDrawingIndex = null;
        hideToolbar();
        redraw();
      }
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => redraw());

    const resizeObs = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        resizeCanvas();
      });
    });
    resizeObs.observe(container);
    resizeCanvas();

    function setAllHidden(v) {
      allDrawingsHidden = !!v;
      if (allDrawingsHidden) {
        selectedDrawingIndex = null;
        hideToolbar();
      }
      redraw();
    }
    function getAllHidden() {
      return allDrawingsHidden;
    }

    return {
      setTool,
      clearAll,
      redraw,
      getTool: () => currentTool,
      isAwaitingThirdPoint: () => !!pendingThirdPoint,
      setAllHidden,
      getAllHidden,
    };
  }

  function formatPrice(v) {
    if (typeof formatPriceLocal === 'function') return formatPriceLocal(v);
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });
  }

  return { create };
})();