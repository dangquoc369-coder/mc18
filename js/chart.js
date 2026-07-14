const ChartModule = (function () {
  const ENTRY_TO_HIGHER_TF = {
    '2h': '3d',
    '1h': '1d',
    '30m': '12h',
    '15m': '4h',
    '5m': '2h',
  };

  function getHigherTimeframeFor(entryTimeframe) {
    return ENTRY_TO_HIGHER_TF[entryTimeframe] || null;
  }

  // ===== Bảng màu chart theo theme (đợt fix này) =====
  // Lightweight Charts vẽ bằng canvas nên không đọc được biến CSS - màu ở
  // đây phải khớp thủ công với :root / :root[data-theme="light"] trong
  // css/style.css (--bg-main, --text-primary, grid, border...).
  const CHART_THEME = {
    dark: {
      background: '#0c0d14',
      text: '#d1d4dc',
      grid: '#161720',
      border: '#202127',
    },
    light: {
      background: '#ffffff',
      text: '#131722',
      grid: '#eef1f8',
      border: '#e2e5ed',
    },
  };

  function create(paneId) {
    let chart = null;
    let containerRef = null;
    let candleSeries = null;
    let volumeSeries = null;
    let resizeObserver = null;
    let volumeVisible = true;

    let ema21Series = null;
    let ema200Series = null;
    let sma50Series = null;
    let bbUpperSeries = null;
    let bbMiddleSeries = null;
    let bbLowerSeries = null;
    let rsiSeries = null;
    let emaRsiSeries = null;
    let wmaRsiSeries = null;
    let macdLineSeries = null;
    let macdSignalSeries = null;
    let macdHistSeries = null;

    let currentCandles = [];

    let loadingOlder = false;
    let noMoreOlder = false;

    let higherTFCandles = [];
    let slCandles = null;

    let alertPriceLines = [];

    let recomputeRafId = null;
    let needIndicatorRecompute = false;

    const indicatorConfig = {
      ema21: { label: 'EMA', color: '#f5c518', period: 21, enabled: false },
      ema200: { label: 'EMA', color: '#ff5f5f', period: 200, enabled: false },
      sma50: { label: 'SMA', color: '#2962ff', period: 50, enabled: false },
      bbUpper: { label: 'BB Upper', color: '#26a69a', period: 20, enabled: false },
      bbMiddle: { label: 'BB Middle', color: '#787b86', period: 20, enabled: false },
      bbLower: { label: 'BB Lower', color: '#ef5350', period: 20, enabled: false },
      rsi: { label: 'RSI', color: '#7e57c2', period: 14, enabled: false },
      emaRsi: { label: 'EMA(RSI)', color: '#26a69a', period: 9, enabled: false },
      wmaRsi: { label: 'WMA(RSI)', color: '#ef5350', period: 45, enabled: false },
      macdLine: { label: 'MACD Line', color: '#2962ff', period: 12, enabled: false },
      macdSignal: { label: 'MACD Signal', color: '#ff9800', period: 9, enabled: false },
      macdHist: { label: 'MACD Hist', color: '#26a69a', period: 26, enabled: false }
    };

    const breakout = BreakoutModule.create(paneId);

    breakout.setOnNewSignal((direction, time) => {
      EventBus.emit('pane:newSignal', { paneId, direction, time });
    });

    let drawing = null;

    function runBreakout() {
      breakout.run({
        entryCandles: currentCandles,
        higherTFCandles,
        slCandles: slCandles || undefined,
      });
    }

    function scheduleRecompute(needIndicators) {
      if (needIndicators) needIndicatorRecompute = true;
      if (recomputeRafId !== null) return;
      recomputeRafId = requestAnimationFrame(() => {
        recomputeRafId = null;
        if (needIndicatorRecompute) {
          needIndicatorRecompute = false;
          renderIndicators(currentCandles);
        }
        runBreakout();
      });
    }

    function handleKlineUpdate({ paneId: sourcePaneId, candle }) {
      if (sourcePaneId !== paneId) return;
      Store.upsertPaneCandle(paneId, candle);

      candleSeries.update({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });

      volumeSeries.update({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      });

      const lastIndex = currentCandles.length - 1;
      if (lastIndex >= 0 && currentCandles[lastIndex].time === candle.time) {
        currentCandles[lastIndex] = candle;
      } else {
        currentCandles.push(candle);
      }
      scheduleRecompute(true);
    }

    /**
     * Áp màu chart (nền/lưới/chữ/viền trục) theo theme hiện tại - gọi lúc
     * khởi tạo VÀ mỗi khi ThemeModule phát ra 'theme:changed'.
     */
    function applyChartTheme(theme) {
      if (!chart) return;
      const c = CHART_THEME[theme] || CHART_THEME.dark;
      chart.applyOptions({
        layout: {
          background: { type: 'solid', color: c.background },
          textColor: c.text,
          panes: { separatorColor: c.border },
        },
        grid: {
          vertLines: { color: c.grid },
          horzLines: { color: c.grid },
        },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
      });
    }

    function handleThemeChanged({ theme }) {
      applyChartTheme(theme);
    }

    function initChart(container) {
      containerRef = container;

      const rect = container.getBoundingClientRect();
      const initialWidth = container.clientWidth || rect.width || 400;
      const initialHeight = container.clientHeight || rect.height || 300;

      const initialTheme = (typeof ThemeModule !== 'undefined' && ThemeModule.getTheme()) || 'dark';
      const initialColors = CHART_THEME[initialTheme] || CHART_THEME.dark;

      chart = LightweightCharts.createChart(container, {
        autoSize: false,
        width: initialWidth,
        height: initialHeight,
        layout: {
          background: { type: 'solid', color: initialColors.background },
          textColor: initialColors.text,
          panes: { separatorColor: initialColors.border },
        },
        grid: {
          vertLines: { color: initialColors.grid },
          horzLines: { color: initialColors.grid },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: initialColors.border },
        timeScale: { borderColor: initialColors.border, timeVisible: true, secondsVisible: false },
      });

      candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });
      candleSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.3 },
      });

      breakout.init(chart, candleSeries);

      volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

       ema21Series = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#f5c518', lineWidth: 1, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false },
        0
      );
      ema200Series = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#ff5f5f', lineWidth: 1, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false },
        0
      );
      sma50Series = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#2962ff', lineWidth: 1, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false },
        0
      );
      bbUpperSeries = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#26a69a', lineWidth: 1, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false },
        0
      );
      bbMiddleSeries = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#787b86', lineWidth: 1, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false },
        0
      );
      bbLowerSeries = chart.addSeries(
        LightweightCharts.LineSeries,
        { color: '#ef5350', lineWidth: 1, title: '', priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false },
        0
      );

      updatePaneStretchFactors();

      setupResize(container);

      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return;
        if (range.from < 15 && !loadingOlder && !noMoreOlder) {
          EventBus.emit('pane:needMoreHistory', { paneId });
        }
      });

      EventBus.on('kline:update', handleKlineUpdate);
      EventBus.on('alerts:changed', renderAlertLines);
      EventBus.on('theme:changed', handleThemeChanged);

      drawing = DrawingModule.create(paneId, chart, candleSeries, container, {
        onAlertRequested: (price) => {
          const pane = Store.getPane(paneId);
          if (!pane) return;
          AlertsModule.addPriceAlert(pane.symbol, price);
        },
      });

      return chart;
    }

    function setupResize(container) {
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver((entries) => {
        requestAnimationFrame(() => {
          if (!entries || !entries.length) return;
          const { width, height } = entries[0].contentRect;
          if (width > 0 && height > 0) chart.resize(width, height);
        });
      });
      resizeObserver.observe(container);
    }

    function resize() {
      if (!chart || !containerRef) return;
      const { clientWidth, clientHeight } = containerRef;
      if (clientWidth > 0 && clientHeight > 0) {
        chart.resize(clientWidth, clientHeight);
      }
    }

    function renderIndicators(candles) {
      if (!candles || candles.length === 0) return;
      const closes = candles.map((c) => c.close);

      const ema21 = IndicatorModule.calcEMA(closes, indicatorConfig.ema21.period);
      const ema200 = IndicatorModule.calcEMA(closes, indicatorConfig.ema200.period);
      if (ema21Series) ema21Series.setData(IndicatorModule.toSeriesData(candles, ema21));
      if (ema200Series) ema200Series.setData(IndicatorModule.toSeriesData(candles, ema200));

      const sma50 = IndicatorModule.calcSMA(closes, indicatorConfig.sma50.period);
      if (sma50Series) sma50Series.setData(IndicatorModule.toSeriesData(candles, sma50));

      const bb = IndicatorModule.calcBB(closes, indicatorConfig.bbMiddle.period, 2);
      if (bbMiddleSeries) bbMiddleSeries.setData(IndicatorModule.toSeriesData(candles, bb.middle));
      if (bbUpperSeries) bbUpperSeries.setData(IndicatorModule.toSeriesData(candles, bb.upper));
      if (bbLowerSeries) bbLowerSeries.setData(IndicatorModule.toSeriesData(candles, bb.lower));

      const rsi = IndicatorModule.calcRSI(candles, indicatorConfig.rsi.period);
      const emaOfRsi = IndicatorModule.calcEMA(rsi, indicatorConfig.emaRsi.period);
      const wmaOfRsi = IndicatorModule.calcWMA(rsi, indicatorConfig.wmaRsi.period);
      if (rsiSeries) rsiSeries.setData(IndicatorModule.toSeriesData(candles, rsi));
      if (emaRsiSeries) emaRsiSeries.setData(IndicatorModule.toSeriesData(candles, emaOfRsi));
      if (wmaRsiSeries) wmaRsiSeries.setData(IndicatorModule.toSeriesData(candles, wmaOfRsi));

      const macd = IndicatorModule.calcMACD(
        closes,
        indicatorConfig.macdLine.period,
        indicatorConfig.macdHist.period,
        indicatorConfig.macdSignal.period
      );
      if (macdLineSeries) macdLineSeries.setData(IndicatorModule.toSeriesData(candles, macd.macd));
      if (macdSignalSeries) macdSignalSeries.setData(IndicatorModule.toSeriesData(candles, macd.signal));
      
      if (macdHistSeries) {
        const histData = candles.map((c, i) => {
          const val = macd.hist[i];
          if (val === null || val === undefined) return null;
          return {
            time: c.time,
            value: val,
            color: val >= 0 ? 'rgba(38, 166, 154, 0.6)' : 'rgba(239, 83, 80, 0.6)'
          };
        }).filter(d => d !== null);
        macdHistSeries.setData(histData);
      }
    }

    function seriesForKey(key) {
      return {
        ema21: ema21Series,
        ema200: ema200Series,
        sma50: sma50Series,
        bbMiddle: bbMiddleSeries,
        bbUpper: bbUpperSeries,
        bbLower: bbLowerSeries,
        rsi: rsiSeries,
        emaRsi: emaRsiSeries,
        wmaRsi: wmaRsiSeries,
        macdLine: macdLineSeries,
        macdSignal: macdSignalSeries,
        macdHist: macdHistSeries
      }[key];
    }

    function updatePaneStretchFactors() {
      if (!chart) return;
      try {
        const panes = chart.panes();
        if (!panes || panes.length === 0) return;

        const pane1Active = !!(rsiSeries || emaRsiSeries || wmaRsiSeries);
        const pane2Active = !!(macdLineSeries || macdSignalSeries || macdHistSeries);

        let f0 = 1.0;
        let f1 = 0.0;
        let f2 = 0.0;

        if (pane1Active && pane2Active) {
          f0 = 0.6;
          f1 = 0.2;
          f2 = 0.2;
        } else if (pane1Active) {
          f0 = 0.75;
          f1 = 0.25;
          f2 = 0.0;
        } else if (pane2Active) {
          f0 = 0.75;
          f1 = 0.0;
          f2 = 0.25;
        } else {
          f0 = 1.0;
          f1 = 0.0;
          f2 = 0.0;
        }

        if (panes[0] && typeof panes[0].setStretchFactor === 'function') panes[0].setStretchFactor(f0);
        if (panes[1] && typeof panes[1].setStretchFactor === 'function') panes[1].setStretchFactor(f1);
        if (panes[2] && typeof panes[2].setStretchFactor === 'function') panes[2].setStretchFactor(f2);
      } catch (err) {
        console.warn(`[${paneId}] Không thể cập nhật tỉ lệ pane:`, err);
      }
    }

    function setIndicatorVisible(key, visible) {
      const cfg = indicatorConfig[key];
      if (!cfg) return;
      cfg.enabled = visible;

      if (visible) {
        let series = seriesForKey(key);
        if (!series) {
          const fixedRSIRangeProvider = (original) => {
            const originalInfo = original();
            return {
              priceRange: { minValue: 36, maxValue: 84 },
              margins: originalInfo ? originalInfo.margins : undefined,
            };
          };

          if (key === 'rsi') {
            rsiSeries = chart.addSeries(LightweightCharts.LineSeries, {
              color: '#7e57c2',
              lineWidth: 1.5,
              title: '',
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
              autoscaleInfoProvider: fixedRSIRangeProvider,
            }, 1);
            const RSI_REFERENCE_LEVELS = [50, 40, 60, 30, 70];
            RSI_REFERENCE_LEVELS.forEach((level) => {
              rsiSeries.createPriceLine({
                price: level,
                color: level === 50 ? '#5d6274' : '#595e6d',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dotted,
                axisLabelVisible: true,
                title: '',
              });
            });
          } else if (key === 'emaRsi') {
            emaRsiSeries = chart.addSeries(LightweightCharts.LineSeries, {
              color: '#26a69a',
              lineWidth: 1.5,
              title: '',
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
              autoscaleInfoProvider: fixedRSIRangeProvider,
            }, 1);
          } else if (key === 'wmaRsi') {
            wmaRsiSeries = chart.addSeries(LightweightCharts.LineSeries, {
              color: '#ef5350',
              lineWidth: 1.5,
              title: '',
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
              autoscaleInfoProvider: fixedRSIRangeProvider,
            }, 1);
          } else if (key === 'macdLine') {
            macdLineSeries = chart.addSeries(LightweightCharts.LineSeries, {
              color: '#2962ff',
              lineWidth: 1.5,
              title: '',
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            }, 2);
          } else if (key === 'macdSignal') {
            macdSignalSeries = chart.addSeries(LightweightCharts.LineSeries, {
              color: '#ff9800',
              lineWidth: 1.5,
              title: '',
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            }, 2);
          } else if (key === 'macdHist') {
            macdHistSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
              color: '#26a69a',
              title: '',
              priceLineVisible: false,
              lastValueVisible: false,
            }, 2);
          } else {
            const s = seriesForKey(key);
            if (s) s.applyOptions({ visible: true });
          }
        } else {
          series.applyOptions({ visible: true });
        }
      } else {
        const series = seriesForKey(key);
        if (series) {
          if (['rsi', 'emaRsi', 'wmaRsi', 'macdLine', 'macdSignal', 'macdHist'].includes(key)) {
            chart.removeSeries(series);
            if (key === 'rsi') rsiSeries = null;
            else if (key === 'emaRsi') emaRsiSeries = null;
            else if (key === 'wmaRsi') wmaRsiSeries = null;
            else if (key === 'macdLine') macdLineSeries = null;
            else if (key === 'macdSignal') macdSignalSeries = null;
            else if (key === 'macdHist') macdHistSeries = null;
          } else {
            series.applyOptions({ visible: false });
          }
        }
      }

      scheduleRecompute(true);
      updatePaneStretchFactors();
    }

    function setIndicatorPeriod(key, period) {
      const cfg = indicatorConfig[key];
      if (!cfg || !period || period <= 0) return;
      cfg.period = period;
      renderIndicators(currentCandles);
    }

    function getIndicatorConfig() {
      return JSON.parse(JSON.stringify(indicatorConfig));
    }

    function setVolumeVisible(visible) {
      volumeVisible = visible;
      if (volumeSeries) volumeSeries.applyOptions({ visible });
    }

    function getVolumeVisible() {
      return volumeVisible;
    }

    function setHigherTFCandles(candles) {
      higherTFCandles = candles ? candles.slice() : [];
      runBreakout();
    }

    function upsertHigherTFCandle(candle) {
      const idx = higherTFCandles.findIndex((c) => c.time === candle.time);
      if (idx >= 0) higherTFCandles[idx] = candle;
      else higherTFCandles.push(candle);
      scheduleRecompute(false);
    }

    function getHigherTFCandles() {
      return higherTFCandles.slice();
    }

    function setSLCandles(candles) {
      slCandles = candles ? candles.slice() : null;
      runBreakout();
    }

    function upsertSLCandle(candle) {
      if (!slCandles) slCandles = [];
      const idx = slCandles.findIndex((c) => c.time === candle.time);
      if (idx >= 0) slCandles[idx] = candle;
      else slCandles.push(candle);
      scheduleRecompute(false);
    }

    function configureBreakout(options) {
      breakout.configure(options || {});
      runBreakout();
    }

    function getBreakoutConfig() {
      return breakout.getConfig();
    }

    function clearAlertLines() {
      alertPriceLines.forEach((line) => {
        try {
          candleSeries.removePriceLine(line);
        } catch (err) {
          // Series có thể đã bị huỷ (destroy) - bỏ qua an toàn.
        }
      });
      alertPriceLines = [];
    }

    function renderAlertLines() {
      clearAlertLines();
      const pane = Store.getPane(paneId);
      if (!pane || !candleSeries) return;

      AlertsModule.getAlertsForSymbol(pane.symbol).forEach((a) => {
        const line = candleSeries.createPriceLine({
          price: a.price,
          color: '#f5c518',
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: '🔔 Cảnh báo',
        });
        alertPriceLines.push(line);
      });
    }

    function loadInitialData(candles) {
      currentCandles = candles.slice();

      candleSeries.setData(
        candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
      );
      volumeSeries.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
        }))
      );

      renderIndicators(currentCandles);
      runBreakout();
      renderAlertLines();
    }

    function clearData() {
      if (candleSeries) candleSeries.setData([]);
      if (volumeSeries) volumeSeries.setData([]);
      if (ema21Series) ema21Series.setData([]);
      if (ema200Series) ema200Series.setData([]);
      if (sma50Series) sma50Series.setData([]);
      if (bbUpperSeries) bbUpperSeries.setData([]);
      if (bbMiddleSeries) bbMiddleSeries.setData([]);
      if (bbLowerSeries) bbLowerSeries.setData([]);
      if (rsiSeries) rsiSeries.setData([]);
      if (emaRsiSeries) emaRsiSeries.setData([]);
      if (wmaRsiSeries) wmaRsiSeries.setData([]);
      if (macdLineSeries) macdLineSeries.setData([]);
      if (macdSignalSeries) macdSignalSeries.setData([]);
      if (macdHistSeries) macdHistSeries.setData([]);
      currentCandles = [];
      higherTFCandles = [];
      slCandles = null;
      resetHistoryFlags();
      runBreakout();
    }

    function isLoadingOlder() {
      return loadingOlder;
    }

    function setLoadingOlder(v) {
      loadingOlder = !!v;
    }

    function isNoMoreOlder() {
      return noMoreOlder;
    }

    function setNoMoreOlder(v) {
      noMoreOlder = !!v;
    }

    function resetHistoryFlags() {
      loadingOlder = false;
      noMoreOlder = false;
    }

    function prependCandles(olderCandles) {
      if (!olderCandles || olderCandles.length === 0) return;

      const firstExistingTime = currentCandles.length ? currentCandles[0].time : Infinity;
      const filtered = olderCandles
        .filter((c) => c.time < firstExistingTime)
        .sort((a, b) => a.time - b.time);

      if (filtered.length === 0) return;

      currentCandles = filtered.concat(currentCandles);

      const timeScale = chart.timeScale();
      const beforeRange = timeScale.getVisibleLogicalRange();

      candleSeries.setData(
        currentCandles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
      );
      volumeSeries.setData(
        currentCandles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
        }))
      );

      renderIndicators(currentCandles);
      runBreakout();

      if (beforeRange) {
        const addedCount = filtered.length;
        timeScale.setVisibleLogicalRange({
          from: beforeRange.from + addedCount,
          to: beforeRange.to + addedCount,
        });
      }
    }

    function destroy() {
      EventBus.off('kline:update', handleKlineUpdate);
      EventBus.off('alerts:changed', renderAlertLines);
      EventBus.off('theme:changed', handleThemeChanged);
      if (resizeObserver) resizeObserver.disconnect();
      if (recomputeRafId !== null) {
        cancelAnimationFrame(recomputeRafId);
        recomputeRafId = null;
      }
      if (chart) chart.remove();
      chart = null;
    }

    return {
      initChart,
      loadInitialData,
      clearData,
      destroy,
      resize,
      setIndicatorVisible,
      setIndicatorPeriod,
      getIndicatorConfig,
      setVolumeVisible,
      getVolumeVisible,
      setHigherTFCandles,
      upsertHigherTFCandle,
      getHigherTFCandles,
      setSLCandles,
      upsertSLCandle,
      configureBreakout,
      getBreakoutConfig,
      isLoadingOlder,
      setLoadingOlder,
      isNoMoreOlder,
      setNoMoreOlder,
      prependCandles,
      getCandles: () => currentCandles.slice(),
      getBreakout: () => breakout,
      getDrawing: () => drawing,
    };
  }

  return { create, getHigherTimeframeFor, ENTRY_TO_HIGHER_TF };
})();