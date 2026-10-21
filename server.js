import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { TradingViewClient, getCandles, getQuote, searchMarkets } from '@mathieuc/tradingview';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const INTERVAL_MAP = {
  '1m': { interval: '1m', range: '5d', secs: 60, multiplier: 0 },
  '5m': { interval: '5m', range: '30d', secs: 300, multiplier: 0 },
  '15m': { interval: '15m', range: '30d', secs: 900, multiplier: 0 },
  '30m': { interval: '30m', range: '30d', secs: 1800, multiplier: 0 },
  '1h': { interval: '60m', range: '60d', secs: 3600, multiplier: 0 },
  '2h': { interval: '60m', range: '60d', secs: 3600, multiplier: 7200 },
  '4h': { interval: '60m', range: '60d', secs: 3600, multiplier: 14400 },
  '12h': { interval: '60m', range: '60d', secs: 3600, multiplier: 43200 },
  '1d': { interval: '1d', range: '1y', secs: 86400, multiplier: 0 },
  '3d': { interval: '1d', range: '2y', secs: 86400, multiplier: 259200 },
  '1w': { interval: '1wk', range: '5y', secs: 604800, multiplier: 0 },
  '1M': { interval: '1mo', range: '10y', secs: 2592000, multiplier: 0 },
};

function aggregateCandles(candles, multiplierInSeconds) {
  if (!multiplierInSeconds || multiplierInSeconds <= 1) return candles;
  const groups = new Map();
  for (const c of candles) {
    const bucket = Math.floor(c.time / multiplierInSeconds) * multiplierInSeconds;
    if (!groups.has(bucket)) {
      groups.set(bucket, {
        time: bucket,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      });
    } else {
      const g = groups.get(bucket);
      g.high = Math.max(g.high, c.high);
      g.low = Math.min(g.low, c.low);
      g.close = c.close;
      g.volume += c.volume;
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.time - b.time);
}

// OANDA timeframe configuration & synthetic aggregation rules
const OANDA_TIMEFRAME_MAP = {
  '1m':  { tf: '1',   multiplier: 0 },
  '5m':  { tf: '5',   multiplier: 0 },
  '15m': { tf: '15',  multiplier: 0 },
  '20m': { tf: '5',   multiplier: 1200, baseSecs: 300 },
  '30m': { tf: '30',  multiplier: 0 },
  '45m': { tf: '45',  multiplier: 0 },
  '1h':  { tf: '60',  multiplier: 0 },
  '2h':  { tf: '120', multiplier: 0 },
  '3h':  { tf: '180', multiplier: 0 },
  '4h':  { tf: '240', multiplier: 0 },
  '6h':  { tf: '60',  multiplier: 21600, baseSecs: 3600 },
  '8h':  { tf: '60',  multiplier: 28800, baseSecs: 3600 },
  '12h': { tf: '60',  multiplier: 43200, baseSecs: 3600 },
  '1d':  { tf: '1D',  multiplier: 0 },
  '2d':  { tf: '1D',  multiplier: 172800, baseSecs: 86400 },
  '3d':  { tf: '1D',  multiplier: 259200, baseSecs: 86400 },
  '1w':  { tf: '1W',  multiplier: 0 },
  '1M':  { tf: '1M',  multiplier: 0 },
};

function normalizeOandaSymbol(raw) {
  if (!raw) return 'OANDA:XAUUSD';
  let sym = String(raw).trim().toUpperCase();
  if (sym === 'XAUUSD' || sym === 'XAU_USD' || sym === 'GOLD') {
    return 'OANDA:XAUUSD';
  }
  if (sym.startsWith('OANDA:')) {
    return sym;
  }
  if (sym.endsWith(':OANDA')) {
    return 'OANDA:' + sym.replace(':OANDA', '');
  }
  if (!sym.includes(':')) {
    return `OANDA:${sym}`;
  }
  return sym;
}

const oandaTickerCache = new Map();
const oandaKlinesCache = new Map();
const inFlightKlines = new Map();
const inFlightTickers = new Map();

let sharedTvClient = null;

function getSharedTvClient() {
  if (!sharedTvClient || sharedTvClient.isClosed) {
    sharedTvClient = new TradingViewClient();
  }
  return sharedTvClient;
}

class AsyncQueue {
  constructor(concurrency = 2) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }
  add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }
  process() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;
    this.running++;
    const { fn, resolve, reject } = this.queue.shift();
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.running--;
        this.process();
      });
  }
}

const tvQueue = new AsyncQueue(2);

// Fallback to Yahoo Gold (GC=F) when TradingView rate-limits or is temporarily unreachable
async function fetchYahooGoldFallback(interval, limit) {
  try {
    const mapping = INTERVAL_MAP[interval] || INTERVAL_MAP['15m'];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${mapping.interval}&range=${mapping.range}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return [];
    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];
    let candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (opens[i] === null || closes[i] === null || Number.isNaN(opens[i])) continue;
      candles.push({
        time: timestamps[i],
        open: Number(opens[i]),
        high: Number(highs[i] ?? opens[i]),
        low: Number(lows[i] ?? closes[i]),
        close: Number(closes[i]),
        volume: Number(volumes[i] ?? 0),
      });
    }
    if (mapping.multiplier > 0) {
      candles = aggregateCandles(candles, mapping.multiplier);
    }
    return candles.slice(-limit);
  } catch (e) {
    return [];
  }
}

async function fetchYahooGoldTickerFallback() {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=5d`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta || {};
    const price = meta.regularMarketPrice || 0;
    const prevClose = meta.chartPreviousClose || price;
    const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
    return {
      lastPrice: price,
      changePercent,
      bid: price,
      ask: price,
      high: price,
      low: price,
      open: price,
      volume: 0,
    };
  } catch (e) {
    return null;
  }
}

// Serve static files from the root directory
app.use(express.static(__dirname));

// ===================== OANDA API PROXY ENDPOINTS =====================

// OANDA Klines/Candles Proxy
app.get('/api/oanda/klines', async (req, res) => {
  const { symbol, interval, limit, endTime } = req.query;
  const oandaSymbol = normalizeOandaSymbol(symbol);
  const itv = interval || '15m';
  const reqLimit = Math.min(1000, Math.max(5, parseInt(limit || '300', 10)));
  const cfg = OANDA_TIMEFRAME_MAP[itv] || OANDA_TIMEFRAME_MAP['15m'];

  const cacheKey = `${oandaSymbol}_${itv}_${reqLimit}_${endTime || ''}`;
  const now = Date.now();
  const cached = oandaKlinesCache.get(cacheKey);
  const ttl = endTime ? 60000 : 4000;
  if (cached && now - cached.ts < ttl) {
    return res.json(cached.data);
  }

  // Deduplicate identical in-flight requests
  if (inFlightKlines.has(cacheKey)) {
    try {
      const data = await inFlightKlines.get(cacheKey);
      return res.json(data);
    } catch {
      // Fall through to retry
    }
  }

  const fetchPromise = (async () => {
    try {
      const fetchCount = cfg.multiplier > 0
        ? Math.min(1000, Math.ceil(reqLimit * (cfg.multiplier / cfg.baseSecs)))
        : reqLimit;

      const query = {
        symbol: oandaSymbol,
        timeframe: cfg.tf,
        count: fetchCount,
        client: getSharedTvClient(),
      };
      if (endTime) {
        query.to = Math.floor(Number(endTime) / 1000);
      }

      const raw = await tvQueue.add(() => getCandles(query));
      let candles = (raw || []).map((k) => ({
        time: Math.floor(k.time),
        open: Number(k.open),
        high: Number(k.high),
        low: Number(k.low),
        close: Number(k.close),
        volume: Number(k.volume || 0),
      }));

      if (cfg.multiplier > 0) {
        candles = aggregateCandles(candles, cfg.multiplier);
      }

      if (candles.length > reqLimit) {
        candles = candles.slice(candles.length - reqLimit);
      }

      oandaKlinesCache.set(cacheKey, { data: candles, ts: Date.now() });
      return candles;
    } catch (err) {
      console.warn(`OANDA klines warning (${oandaSymbol} ${itv}):`, err.message);
      if (err.message && (err.message.includes('429') || err.message.includes('closed'))) {
        try { sharedTvClient?.close(); } catch {}
        sharedTvClient = null;
      }
      if (cached) return cached.data;

      // Automatic fallback for Gold
      if (oandaSymbol.includes('XAUUSD')) {
        const fallback = await fetchYahooGoldFallback(itv, reqLimit);
        if (fallback.length > 0) {
          oandaKlinesCache.set(cacheKey, { data: fallback, ts: Date.now() });
          return fallback;
        }
      }
      return [];
    } finally {
      inFlightKlines.delete(cacheKey);
    }
  })();

  inFlightKlines.set(cacheKey, fetchPromise);
  const result = await fetchPromise;
  res.json(result);
});

// OANDA Live Ticker Proxy
app.get('/api/oanda/ticker', async (req, res) => {
  const { symbol } = req.query;
  const oandaSymbol = normalizeOandaSymbol(symbol);
  const now = Date.now();
  const cached = oandaTickerCache.get(oandaSymbol);
  if (cached && now - cached.ts < 2500) {
    return res.json(cached.data);
  }

  // Deduplicate identical in-flight requests
  if (inFlightTickers.has(oandaSymbol)) {
    try {
      const data = await inFlightTickers.get(oandaSymbol);
      return res.json(data);
    } catch {
      // Fall through to retry
    }
  }

  const fetchPromise = (async () => {
    try {
      const q = await tvQueue.add(() => getQuote({ symbol: oandaSymbol, client: getSharedTvClient() }));
      const lastPrice = Number(q.lp || q.bid || 0);
      const prevClose = Number(q.prev_close_price || lastPrice);
      const changePercent = typeof q.chp === 'number'
        ? q.chp
        : (prevClose ? ((lastPrice - prevClose) / prevClose) * 100 : 0);

      const data = {
        lastPrice,
        changePercent,
        bid: Number(q.bid || lastPrice),
        ask: Number(q.ask || lastPrice),
        high: Number(q.high_price || lastPrice),
        low: Number(q.low_price || lastPrice),
        open: Number(q.open_price || lastPrice),
        volume: Number(q.volume || 0),
      };

      oandaTickerCache.set(oandaSymbol, { data, ts: Date.now() });
      return data;
    } catch (err) {
      console.warn(`OANDA ticker warning (${oandaSymbol}):`, err.message);
      if (err.message && (err.message.includes('429') || err.message.includes('closed'))) {
        try { sharedTvClient?.close(); } catch {}
        sharedTvClient = null;
      }
      if (cached) return cached.data;

      if (oandaSymbol.includes('XAUUSD')) {
        const fallback = await fetchYahooGoldTickerFallback();
        if (fallback) {
          oandaTickerCache.set(oandaSymbol, { data: fallback, ts: Date.now() });
          return fallback;
        }
      }
      return { lastPrice: 0, changePercent: 0, bid: 0, ask: 0, high: 0, low: 0, open: 0, volume: 0 };
    } finally {
      inFlightTickers.delete(oandaSymbol);
    }
  })();

  inFlightTickers.set(oandaSymbol, fetchPromise);
  const result = await fetchPromise;
  res.json(result);
});

// OANDA Search Proxy
app.get('/api/oanda/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);
  try {
    const raw = await searchMarkets(query);
    const oandaItems = (raw || []).filter(
      (item) => item.exchange === 'OANDA' || (item.id && item.id.startsWith('OANDA:'))
    );
    const qUpper = query.trim().toUpperCase();
    if (['XAU', 'GOLD', 'XAUUSD'].some((k) => qUpper.includes(k))) {
      const hasGold = oandaItems.some((i) => i.id === 'OANDA:XAUUSD' || i.symbol === 'XAUUSD');
      if (!hasGold) {
        oandaItems.unshift({
          id: 'OANDA:XAUUSD',
          exchange: 'OANDA',
          symbol: 'XAUUSD',
          description: 'Gold (OANDA CFD)',
          type: 'commodity',
          currency: 'USD',
        });
      }
    }
    res.json(oandaItems.slice(0, 15));
  } catch (err) {
    console.error('OANDA search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Yahoo Finance Klines/Chart Proxy
app.get('/api/yahoo/klines', async (req, res) => {
  const { symbol, interval, endTime } = req.query;
  if (!symbol || !interval) {
    return res.status(400).json({ error: 'Missing symbol or interval' });
  }

  const mapping = INTERVAL_MAP[interval] || INTERVAL_MAP['1d'];
  let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?`;

  if (endTime) {
    const p2 = Math.floor(Number(endTime) / 1000);
    // Estimate window size to fetch enough candles
    const windowSecs = 1000 * (mapping.multiplier || mapping.secs);
    const p1 = p2 - windowSecs;
    url += `period1=${p1}&period2=${p2}&interval=${mapping.interval}`;
  } else {
    url += `interval=${mapping.interval}&range=${mapping.range}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Yahoo status ${response.status}`);
    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result) return res.json([]);

    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    let candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (opens[i] === null || closes[i] === null || Number.isNaN(opens[i]) || Number.isNaN(closes[i])) continue;
      candles.push({
        time: timestamps[i],
        open: Number(opens[i]),
        high: Number(highs[i] ?? opens[i]),
        low: Number(lows[i] ?? closes[i]),
        close: Number(closes[i]),
        volume: Number(volumes[i] ?? 0),
      });
    }

    // Apply custom multi-hour or multi-day aggregation if needed
    if (mapping.multiplier > 0) {
      candles = aggregateCandles(candles, mapping.multiplier);
    }

    res.json(candles);
  } catch (err) {
    console.error('Klines proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Yahoo Finance Live Ticker Proxy
app.get('/api/yahoo/ticker', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Yahoo status ${response.status}`);
    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('No result');
    
    const meta = result.meta || {};
    const price = meta.regularMarketPrice || 0;
    const prevClose = meta.chartPreviousClose || price;
    const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
    
    res.json({
      lastPrice: price,
      changePercent: changePercent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Yahoo Finance Autocomplete Search Proxy
app.get('/api/yahoo/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=15&newsCount=0`;
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Yahoo search status ${response.status}`);
    const data = await response.json();
    const quotes = data.quotes || [];
    
    const results = quotes
      .filter(q => q.symbol)
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange || '',
        type: q.quoteType || ''
      }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trades API handler (with local store fallback)
const WORKER_URL = 'https://dq-tracker-push.quocngyendanght.workers.dev';
const localTradesStore = new Map(); // deviceId -> Array of trades

app.get('/api/trades', async (req, res) => {
  const deviceId = req.query.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

  try {
    const response = await fetch(`${WORKER_URL}/api/trades?deviceId=${encodeURIComponent(deviceId)}`);
    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.trades)) {
        localTradesStore.set(deviceId, data.trades);
        return res.json(data);
      }
    }
  } catch (err) {
    // Ignore worker failure
  }

  const trades = localTradesStore.get(deviceId) || [];
  return res.json({ trades });
});

app.post('/api/trades', async (req, res) => {
  const { deviceId, trades } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

  let existing = localTradesStore.get(deviceId) || [];
  if (Array.isArray(trades) && trades.length > 0) {
    const map = new Map();
    existing.forEach(t => map.set(t.ticket, t));
    trades.forEach(t => map.set(t.ticket, t));
    existing = Array.from(map.values()).sort((a, b) => new Date(b.closeTime) - new Date(a.closeTime));
    localTradesStore.set(deviceId, existing);
  }

  // Attempt async sync to worker
  fetch(`${WORKER_URL}/api/trades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, trades })
  }).catch(() => {});

  return res.json({ ok: true, count: existing.length, trades: existing });
});

app.delete('/api/trades', async (req, res) => {
  const deviceId = req.body?.deviceId || req.query.deviceId;
  const ticket = req.body?.ticket || req.query.ticket;
  if (deviceId) {
    if (ticket) {
      const existing = localTradesStore.get(deviceId) || [];
      const updated = existing.filter(t => String(t.ticket) !== String(ticket));
      localTradesStore.set(deviceId, updated);
    } else {
      localTradesStore.delete(deviceId);
    }
  }
  fetch(`${WORKER_URL}/api/trades`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, ticket })
  }).catch(() => {});
  return res.json({ ok: true });
});

// SPA fallback or unmatched route fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
