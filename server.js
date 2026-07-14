import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

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

// Serve static files from the root directory
app.use(express.static(__dirname));

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

// SPA fallback or unmatched route fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
