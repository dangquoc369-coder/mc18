/**
 * drawing.js
 * Bộ công cụ vẽ nâng cao kiểu TradingView cho MỖI pane, độc lập với nhau:
 *   - Con trỏ (mặc định, không vẽ gì)
 *   - Đường ngang (Horizontal Line)
 *   - Đường xu hướng (Trend Line)
 *   - Hình chữ nhật (Rectangle)
 *   - Thoái lui Fibonacci (Fibonacci Retracement) - vẽ dải màu
 *   - Chữ / Ghi chú (Text annotation) - đặt ghi chú lên chart
 *   - Tẩy / Xoá từng hình (Eraser) - click vào hình để xoá
 *   - Xoá tất cả
 */

const DrawingModule = (function () {
  function create(paneId, chart, candleSeries, container, options = {}) {
    const { onAlertRequested, onToolChanged } = options;

    let currentTool = 'cursor'; // cursor | hline | trendline | rectangle | fib | text | eraser | alert
    let drawings = [];
    let dragStart = null;
    let previewDrawing = null;
    let hoverPoint = null; // { x, y, price } - vị trí con trỏ hiện tại

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

    function setTool(tool) {
      currentTool = tool;
      const isInteractive = tool !== 'cursor';
      canvas.style.pointerEvents = isInteractive ? 'auto' : 'none';
      canvas.style.cursor = isInteractive ? 'crosshair' : 'default';
      if (isInteractive) {
        selectedDrawingIndex = null;
        hideToolbar();
        redraw();
      }
    }
    /**
     * ĐỢT FIX (chuyên nghiệp hơn): sau khi vẽ xong 1 hình / đặt xong 1 cảnh
     * báo / ghi chú, TỰ ĐỘNG quay về "Con trỏ" - đúng hành vi TradingView
     * (chỉ Tẩy mới ở lại chế độ liên tục vì bản chất là xoá nhiều hình liên
     * tiếp). onToolChanged() báo cho ui.js vẽ lại nút đang active trong
     * thanh công cụ, vì lần đổi tool này đến từ BÊN TRONG drawing.js chứ
     * không phải do người dùng bấm nút (renderSharedDrawGroup() cũ chỉ tự
     * gọi khi click nút).
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

    function redraw() {
      const { width, height } = getRect();
      ctx.clearRect(0, 0, width, height);
      drawings.forEach((d, idx) => drawShape(d, false, idx));
      if (previewDrawing) drawShape(previewDrawing, true);
      drawCrosshair();
    }

    function drawShape(d, isPreview, idx) {
      const isHovered = (idx !== undefined && idx === hoveredDrawingIndex);
      const isSelected = (idx !== undefined && idx === selectedDrawingIndex);

      ctx.save();

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

        if (isSelected) {
          drawHandle(getRect().width / 2, y);
        }
      } else if (d.type === 'trendline') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        if (isSelected) {
          drawHandle(x1, y1);
          drawHandle(x2, y2);
        }
      } else if (d.type === 'rectangle') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }
        const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);

        let fillStyle = 'rgba(242, 163, 57, 0.10)';
        if (baseColor.startsWith('#')) {
          const r = parseInt(baseColor.slice(1, 3), 16);
          const g = parseInt(baseColor.slice(3, 5), 16);
          const b = parseInt(baseColor.slice(5, 7), 16);
          if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
            fillStyle = `rgba(${r}, ${g}, ${b}, 0.12)`;
          }
        }
        ctx.fillStyle = fillStyle;
        ctx.fillRect(rx, ry, rw, rh);
        if (d.dashed) ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);

        if (isSelected) {
          drawHandle(x1, y1);
          drawHandle(x2, y2);
        }
      } else if (d.type === 'fib') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if ([x1, y1, x2, y2].some((v) => v === null || v === undefined)) { ctx.restore(); return; }

        const priceStart = d.p1.price;
        const priceEnd = d.p2.price;
        const diff = priceEnd - priceStart;
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];

        let colors = [];
        let r = 242, g = 163, b = 57;
        if (baseColor.startsWith('#')) {
          const pr = parseInt(baseColor.slice(1, 3), 16);
          const pg = parseInt(baseColor.slice(3, 5), 16);
          const pb = parseInt(baseColor.slice(5, 7), 16);
          if (!isNaN(pr) && !isNaN(pg) && !isNaN(pb)) {
            r = pr; g = pg; b = pb;
          }
        }
        for (let i = 0; i < levels.length; i++) {
          const alpha = 0.05 + (i * 0.015);
          colors.push(`rgba(${r}, ${g}, ${b}, ${alpha})`);
        }

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

        if (isSelected) {
          drawHandle(x1, y1);
          drawHandle(x2, y2);
        }
      } else if (d.type === 'text') {
        const x = timeToX(d.p.time);
        const y = priceToY(d.p.price);
        if (x === null || y === null) { ctx.restore(); return; }

        ctx.font = '12px sans-serif';
        const paddingH = 8;
        const paddingV = 5;
        const textWidth = ctx.measureText(d.text).width;
        const boxW = textWidth + paddingH * 2;
        const boxH = 14 + paddingV * 2;

        ctx.fillStyle = 'rgba(16, 20, 28, 0.9)';
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = (isHovered || isSelected) ? 2 : 1;
        ctx.fillRect(x, y - 10 - paddingV, boxW, boxH);
        ctx.strokeRect(x, y - 10 - paddingV, boxW, boxH);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(d.text, x + paddingH, y + paddingV + 1);

        if (isSelected) {
          drawHandle(x, y);
        }
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

      ctx.restore();
    }

    function pointFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
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

    function findDrawingAt(pt) {
      const x = timeToX(pt.time);
      const y = priceToY(pt.price);
      if (x === null || y === null) return null;

      for (let i = drawings.length - 1; i >= 0; i--) {
        const d = drawings[i];
        if (d.type === 'hline') {
          const dy = priceToY(d.price);
          if (dy !== null && Math.abs(dy - y) < 10) return { index: i };
        } else if (d.type === 'trendline') {
          const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
          const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
          if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
            if (distToSegment(x, y, x1, y1, x2, y2) < 10) return { index: i };
          }
        } else if (d.type === 'rectangle') {
          const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
          const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
          if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
            const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
            const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
            if (x >= rx - 5 && x <= rx + rw + 5 && y >= ry - 5 && y <= ry + rh + 5) {
              return { index: i };
            }
          }
        } else if (d.type === 'fib') {
          const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
          const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
          if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
            const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
            const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
            if (x >= rx - 10 && x <= rx + rw + 10 && y >= ry - 10 && y <= ry + rh + 10) {
              return { index: i };
            }
          }
        } else if (d.type === 'text') {
          const tx = timeToX(d.p.time), ty = priceToY(d.p.price);
          if (tx !== null && ty !== null) {
            ctx.font = '12px sans-serif';
            const w = ctx.measureText(d.text).width;
            if (x >= tx - 8 && x <= tx + w + 8 && y >= ty - 18 && y <= ty + 8) {
              return { index: i };
            }
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

    function showToolbar(idx) {
      hideToolbar();
      const d = drawings[idx];
      if (!d) return;

      const rect = container.getBoundingClientRect();
      let tx = 0;
      let ty = 0;

      if (d.type === 'hline') {
        const y = priceToY(d.price);
        tx = rect.width / 2;
        ty = y !== null ? y : 100;
      } else if (d.type === 'trendline' || d.type === 'rectangle' || d.type === 'fib') {
        const x1 = timeToX(d.p1.time), y1 = priceToY(d.p1.price);
        const x2 = timeToX(d.p2.time), y2 = priceToY(d.p2.price);
        if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
          tx = (x1 + x2) / 2;
          ty = Math.min(y1, y2);
        } else {
          tx = rect.width / 2;
          ty = 100;
        }
      } else if (d.type === 'text') {
        const x = timeToX(d.p.time), y = priceToY(d.p.price);
        tx = x !== null ? x : rect.width / 2;
        ty = y !== null ? y : 100;
      }

      const toolbarWidth = 220;
      const estHeight = 150; // ước lượng để tránh tràn mép - toolbar tự co nếu thấp hơn
      const top = Math.max(10, Math.min(ty - estHeight - 12, rect.height - estHeight - 10));
      const left = Math.max(10, Math.min(tx - toolbarWidth / 2, rect.width - toolbarWidth - 10));

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

      // ---- Hàng màu ----
      const colorRow = document.createElement('div');
      colorRow.style.display = 'flex';
      colorRow.style.alignItems = 'center';
      colorRow.style.gap = '6px';

      const colors = ['#f2a339', '#22c9a0', '#ff5a67', '#ff9800', '#d1a53d', '#7e57c2', '#ffffff'];
      colors.forEach((col) => {
        const dot = document.createElement('div');
        dot.style.width = '14px';
        dot.style.height = '14px';
        dot.style.borderRadius = '50%';
        dot.style.background = col;
        dot.style.cursor = 'pointer';
        dot.style.flexShrink = '0';
        dot.style.border = (d.color || '#f2a339') === col ? '2px solid var(--text-primary)' : '1px solid rgba(255,255,255,0.2)';
        dot.style.transition = 'transform 0.15s ease';
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          d.color = col;
          redraw();
          showToolbar(idx);
        });
        dot.addEventListener('mouseenter', () => dot.style.transform = 'scale(1.2)');
        dot.addEventListener('mouseleave', () => dot.style.transform = 'scale(1)');
        colorRow.appendChild(dot);
      });
      toolbarEl.appendChild(colorRow);

      // ---- Hàng độ dày nét (không áp dụng cho ghi chú) ----
      if (d.type !== 'text') {
        const widthRow = document.createElement('div');
        widthRow.style.display = 'flex';
        widthRow.style.gap = '4px';
        [{ label: 'Mảnh', val: 1 }, { label: 'Vừa', val: 1.5 }, { label: 'Đậm', val: 2.5 }].forEach((w) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = w.label;
          const active = (d.width || 1.5) === w.val;
          btn.style.flex = '1';
          btn.style.padding = '3px 0';
          btn.style.fontSize = '10.5px';
          btn.style.border = '1px solid var(--border-color)';
          btn.style.borderRadius = 'var(--radius-sm)';
          btn.style.cursor = 'pointer';
          btn.style.background = active ? 'var(--accent-blue-soft)' : 'transparent';
          btn.style.color = active ? 'var(--accent-blue)' : 'var(--text-secondary)';
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            d.width = w.val;
            redraw();
            showToolbar(idx);
          });
          widthRow.appendChild(btn);
        });
        toolbarEl.appendChild(widthRow);
      }

      // ---- Hàng kiểu nét: liền/đứt (fib có quy ước riêng nên bỏ qua) ----
      if (d.type === 'hline' || d.type === 'trendline' || d.type === 'rectangle') {
        const styleRow = document.createElement('div');
        styleRow.style.display = 'flex';
        const isDashed = d.type === 'hline' ? d.dashed !== false : !!d.dashed;
        const styleBtn = document.createElement('button');
        styleBtn.type = 'button';
        styleBtn.textContent = isDashed ? '┄ Nét đứt' : '─ Nét liền';
        styleBtn.style.flex = '1';
        styleBtn.style.padding = '3px 0';
        styleBtn.style.fontSize = '10.5px';
        styleBtn.style.border = '1px solid var(--border-color)';
        styleBtn.style.borderRadius = 'var(--radius-sm)';
        styleBtn.style.cursor = 'pointer';
        styleBtn.style.background = 'transparent';
        styleBtn.style.color = 'var(--text-primary)';
        styleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          d.dashed = d.type === 'hline' ? (d.dashed === false ? true : false) : !d.dashed;
          redraw();
          showToolbar(idx);
        });
        styleRow.appendChild(styleBtn);
        toolbarEl.appendChild(styleRow);
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
        label.style.width = '42px';
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
      } else if (d.type === 'trendline' || d.type === 'rectangle' || d.type === 'fib') {
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
      delBtn.innerHTML = '🗑 Xoá';
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

    function onPointerDown(e) {
      const pt = pointFromEvent(e);

      if (currentTool === 'cursor') {
        const match = findDrawingAt(pt);
        if (match !== null) {
          selectedDrawingIndex = match.index;
          isDraggingShape = true;
          draggedDrawingIndex = match.index;
          draggedDrawingOriginal = JSON.parse(JSON.stringify(drawings[match.index]));
          dragStartPixel = { x: e.clientX, y: e.clientY };
          canvas.setPointerCapture(e.pointerId);
          showToolbar(match.index);
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
        if (match !== null) {
          drawings.splice(match.index, 1);
          redraw();
        }
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
        
        // Prevent default browser behavior (which steals focus from our newly created input)
        e.preventDefault();
        e.stopPropagation();

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Custom Overlay Text Input inside container (highly visual + safe)
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Nhập ghi chú...';
        input.style.position = 'absolute';
        input.style.left = `${x}px`;
        input.style.top = `${y}px`;
        input.style.background = '#1e222d';
        input.style.color = '#ffffff';
        input.style.border = '1px solid #2962ff';
        input.style.borderRadius = '4px';
        input.style.padding = '4px 8px';
        input.style.fontSize = '12px';
        input.style.zIndex = '9999';

        container.appendChild(input);
        
        // Delay focus slightly to ensure browser registers it and doesn't override it immediately
        setTimeout(() => {
          input.focus();
        }, 50);

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
        
        // Prevent events inside the input from bubbling up to the canvas/container
        input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        input.addEventListener('mousedown', (ev) => ev.stopPropagation());
        input.addEventListener('click', (ev) => ev.stopPropagation());
        
        input.addEventListener('blur', submitText);
        return;
      }

      if (pt.time === null || pt.time === undefined || pt.price === null || pt.price === undefined) return;

      if (currentTool === 'hline') {
        drawings.push({ type: 'hline', price: pt.price, width: 1.5, dashed: true });
        redraw();
        returnToCursorAfterDraw();
        return;
      }

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
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pt = pointFromEvent(e);
      hoverPoint = { x, y, price: pt.price };

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
                const yNew = yOrig + dy;
                const newPrice = yToPrice(yNew);
                if (newPrice !== null && !Number.isNaN(newPrice)) {
                  d.price = newPrice;
                }
              }
            } else if (d.type === 'trendline' || d.type === 'rectangle' || d.type === 'fib') {
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
            } else if (d.type === 'text') {
              const xOrig = timeToX(orig.p.time), yOrig = priceToY(orig.p.price);
              if (xOrig !== null && yOrig !== null) {
                const newX = xOrig + dx, newY = yOrig + dy;
                const t = xToTime(newX), p = yToPrice(newY);
                if (t !== null && p !== null) {
                  d.p = { time: t, price: p };
                }
              }
            }
            showToolbar(draggedDrawingIndex);
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

      if (dragStart && currentTool !== 'alert' && currentTool !== 'text' && currentTool !== 'eraser') {
        if (pt.time === null || pt.time === undefined || pt.price === null || pt.price === undefined) {
          redraw();
          return;
        }
        previewDrawing = { type: currentTool, p1: dragStart, p2: pt };
      }
      redraw();
    }

    function onPointerUp(e) {
      // FIX MOBILE: trên cảm ứng, không có "pointerleave" tức thời như
      // chuột - ngón tay chỉ nhấc lên (pointerup), còn pointerleave được
      // trình duyệt tự tổng hợp SAU ĐÓ với độ trễ không cố định, khiến
      // crosshair (đường chấm + nhãn giá) bị "đứng hình" 1 lúc rồi mới
      // biến mất. Xoá hoverPoint NGAY tại đây cho pointerType 'touch' -
      // không đợi pointerleave nữa.
      if (e.pointerType === 'touch') {
        hoverPoint = null;
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
      if (
        pt.time !== null && pt.time !== undefined &&
        pt.price !== null && pt.price !== undefined &&
        (currentTool === 'trendline' || currentTool === 'rectangle' || currentTool === 'fib')
      ) {
        drawings.push({ type: currentTool, p1: dragStart, p2: pt, width: 1.5, dashed: false });
        shapeCreated = true;
      }
      dragStart = null;
      previewDrawing = null;
      redraw();
      if (shapeCreated) returnToCursorAfterDraw();
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
    canvas.addEventListener('pointercancel', () => { dragStart = null; previewDrawing = null; hoverPoint = null; isDraggingShape = false; draggedDrawingIndex = null; draggedDrawingOriginal = null; dragStartPixel = null; redraw(); });
    canvas.addEventListener('pointerleave', () => { hoverPoint = null; redraw(); });
    container.addEventListener('pointermove', onContainerPointerMove);

    /**
     * FIX: đóng toolbar khi bấm vào chỗ TRỐNG trên chart.
     * Khi không hover trúng hình nào, canvas.style.pointerEvents = 'none'
     * (để không chặn pan/zoom/crosshair của chart bên dưới) - nghĩa là click
     * vào vùng trống KHÔNG hề tới được canvas.addEventListener('pointerdown',
     * onPointerDown) ở trên, nó lọt thẳng xuống chart. Bắt sự kiện này ở
     * mức container (cha chung của canvas vẽ + chart) để phát hiện đúng
     * trường hợp "click lọt qua canvas xuống chart" và tự đóng toolbar +
     * bỏ chọn hình, y hệt hành vi TradingView.
     */
    container.addEventListener('pointerdown', (e) => {
      if (currentTool !== 'cursor') return;
      // Click này đã được canvas.addEventListener('pointerdown', onPointerDown)
      // xử lý riêng rồi (trường hợp đang hover trúng 1 hình) - bỏ qua để
      // tránh xử lý 2 lần.
      if (e.target === canvas) return;
      // Click bên trong toolbar đã tự stopPropagation() nên không lọt tới
      // đây - còn lại chắc chắn là click lọt xuống chart ở vùng trống.
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

    return { setTool, clearAll, redraw, getTool: () => currentTool };
  }

  function formatPrice(v) {
    if (typeof formatPriceLocal === 'function') return formatPriceLocal(v);
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });
  }

  return { create };
})();
