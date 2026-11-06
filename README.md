# TradingPro

**Kỷ Luật = Lợi Nhuận** · *Discipline = Profit*

[🇻🇳 Tiếng Việt](#-tiếng-việt) · [🇬🇧 English](#-english)

---

# 🇻🇳 Tiếng Việt

TradingPro là ứng dụng web xem biểu đồ giá đa khung thời gian, chạy trên trình duyệt (hỗ trợ cài như PWA trên iPad/điện thoại). Ứng dụng tập trung vào kỷ luật giao dịch: xem nhiều biểu đồ cùng lúc, vẽ phân tích, đặt cảnh báo giá, nhắc việc và thống kê nhật ký lệnh.

> ⚠️ **Lưu ý:** Ứng dụng chỉ phục vụ theo dõi và học tập, **không phải lời khuyên đầu tư**. Giao dịch có rủi ro mất vốn.

## Tính năng chính

### Biểu đồ
- **Bố cục 1 / 2 / 3 / 4 ô**, mỗi ô có symbol và khung thời gian độc lập; kéo thanh chia để đổi tỉ lệ. Màn dọc tối đa 3 ô.
- Dựng bằng [Lightweight Charts](https://github.com/tradingview/lightweight-charts) v5, râu nến dày theo mức zoom, đếm ngược đóng nến.
- **Nguồn dữ liệu:** Binance Spot, Binance Futures (hậu tố `_PERP`) và **OANDA XAUUSD** (qua Cloudflare Worker).
- **Khung thời gian:** 1m, 3m, 5m, 10m, 15m, 20m, 30m, 45m, 1H, 2H, 3H, 4H, 6H, 8H, 12H, 1D, 2D, 3D, W, M. Các khung không có sẵn trên sàn (10m, 20m, 45m, 3H, 2D...) được **gộp từ nến nhỏ hơn**.
- Thanh khung giờ nhanh tự thêm khung khi còn chỗ, theo **thứ tự ưu tiên do bạn sắp xếp**.
- Tự tải thêm lịch sử khi kéo biểu đồ về bên trái.
- **Watchlist** cục bộ, thêm bằng ngôi sao ở ô tìm kiếm.
- Giao diện **sáng / tối**, tối ưu cho iPad và điện thoại (màn ngang gộp thanh công cụ thành một hàng).

### Chỉ báo
- Nhóm **EMA** (tối đa 10 đường, tuỳ chỉnh chu kỳ, màu, độ dày, nguồn giá), SMA, Bollinger Bands.
- **RSI** kèm EMA(RSI), WMA(RSI), bảng giá theo mức RSI và đường hỗ trợ/kháng cự tự động.
- **MACD**, **Ichimoku** (có mây Kumo), **Volume**.
- **Breakout BUY/SELL**: tín hiệu đột phá theo khung cao hơn, có thông báo khi xuất hiện tín hiệu mới.

### Công cụ vẽ
- Đường xu hướng, tia, đường mở rộng, đường ngang / dọc, tia ngang.
- **Fibonacci** thoái lui và mở rộng.
- Hình chữ nhật, tròn, tam giác, kênh giá song song.
- **Lệnh Long / Short** (tự tính TP theo R:R), chữ, mũi tên.
- **Nam châm** hít vào O/H/L/C, **nhớ style theo từng công cụ**, ẩn/hiện và xoá hàng loạt.
- Hình vẽ lưu cục bộ **theo từng symbol**.

### Công cụ kỷ luật
- **Cảnh báo giá** kèm Web Push (hoạt động cả khi đã tắt app).
- **Công việc / nhắc việc** có lặp lại (hằng ngày, tuần, tháng).
- **Định lượng**: nhật ký lệnh, thống kê hiệu suất, mô phỏng Monte Carlo và gợi ý quản trị rủi ro.
- **Tài khoản nhẹ** (tên + PIN) để vài người dùng chung mà không lẫn dữ liệu cảnh báo.
- Sao lưu / khôi phục dữ liệu cục bộ (nút **Dữ liệu** ở chân sidebar).

## Kiến trúc

```
Trình duyệt (frontend tĩnh, JS thuần)
 ├── Binance REST + WebSocket ─────────────► dữ liệu crypto realtime
 └── Cloudflare Worker (backend)
      ├── /api/oanda/*  ◄── TradingView WebSocket ► XAUUSD (OANDA)
      ├── /api/alerts, /api/signals, /api/tasks ► KV
      ├── /api/subscribe ► Web Push (VAPID)
      └── Cron ► kiểm tra cảnh báo, tín hiệu, nhắc việc
```

- **Frontend:** HTML / CSS / JavaScript thuần, không cần build. Các module giao tiếp qua `EventBus`.
- **Backend:** một Cloudflare Worker (`dq-tracker-push`) dùng KV để lưu cảnh báo, tín hiệu, công việc, hồ sơ và đăng ký push.
- **Local-first:** cấu hình giao diện (layout, symbol, chỉ báo, hình vẽ, watchlist, theme) lưu ngay trên thiết bị; chỉ cảnh báo, tín hiệu và nhắc việc mới lên server vì cần đẩy thông báo khi tắt app.
- Dữ liệu OANDA hiện được lấy bằng **poll** (mặc định 1 giây cho ô đang chọn, 3 giây cho ô khác), không phải streaming thật.

## Cấu trúc thư mục

```
├── index.html
├── manifest.json
├── icons/
├── css/
│   ├── style.css
│   ├── topbar-landscape.css
│   └── draw-flyout.css
└── js/
    ├── utils.js, icons.js, icons-ui.js      # tiện ích, EventBus, icon
    ├── local-store.js, storage.js           # lưu trữ cục bộ + state trung tâm
    ├── api.js, websocket.js                 # dữ liệu REST / realtime
    ├── indicator.js, chart.js, breakout.js  # chỉ báo, biểu đồ, tín hiệu
    ├── drawing.js                           # công cụ vẽ
    ├── ui.js, layout.js, watchlist.js       # giao diện
    ├── alerts.js, notifications.js, push-sync.js, login.js
    ├── tasks.js, analytics.js
    ├── countdown.js, countdown-badge.js
    ├── timeframe-fit.js, topbar-fit.js
    └── app.js                               # điểm khởi động

worker/
└── src/index.js                             # Cloudflare Worker
```

## Cài đặt

### 1. Frontend

Chỉ cần phục vụ thư mục tĩnh bằng HTTPS (Cloudflare Pages, GitHub Pages, Netlify...). Chạy thử cục bộ:

```bash
npx serve .
```

Mở `js/api.js` và đổi địa chỉ Worker của bạn:

```js
const WORKER_FALLBACK_URL = 'https://<ten-worker-cua-ban>.workers.dev';
```

> Web Push và PWA yêu cầu **HTTPS** (trừ `localhost`).

### 2. Backend (Cloudflare Worker)

Yêu cầu: tài khoản Cloudflare và [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

```bash
cd worker
npm install @block65/webcrypto-web-push

# Tạo KV namespace, rồi gắn với binding TRACKER_KV trong wrangler.toml
npx wrangler kv namespace create TRACKER_KV

# Tạo cặp khoá VAPID (một lần), ví dụ:
npx web-push generate-vapid-keys

# Khai báo secret
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT          # ví dụ: mailto:ban@example.com
npx wrangler secret put COINGECKO_API_KEY      # tuỳ chọn, tránh bị giới hạn 429

npx wrangler deploy
```

Ví dụ `wrangler.toml` (chỉnh theo tài khoản của bạn):

```toml
name = "dq-tracker-push"
main = "src/index.js"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "TRACKER_KV"
id = "<id-kv-cua-ban>"

[triggers]
crons = ["* * * * *"]   # kiểm tra cảnh báo / tín hiệu / nhắc việc mỗi phút
```

Cron chạy mỗi phút; mã còn tự kiểm tra thêm lần hai sau 30 giây trong cùng lượt.

## Sử dụng nhanh

1. Gõ tên cặp vào ô tìm kiếm ở sidebar, bấm vào kết quả để áp dụng cho **ô đang chọn**; bấm ⭐ để thêm vào watchlist.
2. Chọn khung giờ ở thanh phía trên; bấm biểu tượng thanh trượt cạnh ô chọn khung để sắp xếp thứ tự ưu tiên.
3. Bật chỉ báo từ phần chú giải ở góc trên mỗi ô.
4. Chọn công cụ vẽ ở thanh "Vẽ"; bấm mũi tên ▾ để mở bảng đầy đủ.
5. Bật chuông để đặt cảnh báo giá, cho phép thông báo khi trình duyệt hỏi.

## Giới hạn đã biết

- Dữ liệu OANDA/XAUUSD lấy qua giao thức WebSocket **không chính thức** của TradingView, có thể thay đổi hoặc bị giới hạn bất cứ lúc nào, và việc sử dụng có thể không phù hợp điều khoản của họ. Hãy tự cân nhắc trước khi dùng cho mục đích khác ngoài cá nhân.
- Gói Cloudflare Workers Free giới hạn số request mỗi ngày; poll nhanh trên nhiều thiết bị cùng lúc có thể vượt hạn mức.
- Tài khoản tên + PIN chỉ là cơ chế nhẹ để tách dữ liệu, **không phải hệ thống bảo mật đầy đủ**. Không dùng cho thông tin nhạy cảm.
- Cảnh báo giá phía server dùng giá từ CoinGecko, chỉ hỗ trợ các cặp crypto đã được ánh xạ sẵn trong Worker.

## Giấy phép

Chưa khai báo. Hãy thêm file `LICENSE` phù hợp với dự án của bạn.

---

# 🇬🇧 English

TradingPro is a browser-based multi-timeframe charting app (installable as a PWA on iPad and phones). It is built around trading discipline: watch several charts at once, draw your analysis, set price alerts and reminders, and review your trade journal statistics.

> ⚠️ **Disclaimer:** This app is for monitoring and learning only and is **not financial advice**. Trading involves risk of loss.

## Features

### Charts
- **1 / 2 / 3 / 4-pane layouts**, each pane with its own symbol and timeframe; drag splitters to resize. Portrait mode allows up to 3 panes.
- Built on [Lightweight Charts](https://github.com/tradingview/lightweight-charts) v5, with zoom-proportional candle wicks and a candle-close countdown.
- **Data sources:** Binance Spot, Binance Futures (`_PERP` suffix) and **OANDA XAUUSD** (through a Cloudflare Worker).
- **Timeframes:** 1m, 3m, 5m, 10m, 15m, 20m, 30m, 45m, 1H, 2H, 3H, 4H, 6H, 8H, 12H, 1D, 2D, 3D, W, M. Timeframes not offered natively by the exchange (10m, 20m, 45m, 3H, 2D...) are **aggregated from smaller candles**.
- The quick-timeframe bar adds more buttons whenever there is spare room, following **a priority order you define**.
- Older history loads automatically as you scroll left.
- Local **watchlist**, added via the star in the search results.
- **Light / dark** themes, tuned for iPad and phones (landscape merges the toolbars into a single row).

### Indicators
- **EMA** group (up to 10 lines with custom period, color, width and price source), SMA, Bollinger Bands.
- **RSI** with EMA(RSI), WMA(RSI), a price ladder for RSI levels and automatic support/resistance lines.
- **MACD**, **Ichimoku** (with Kumo cloud), **Volume**.
- **Breakout BUY/SELL**: breakout signals relative to a higher timeframe, with notifications on new signals.

### Drawing tools
- Trend line, ray, extended line, horizontal / vertical lines, horizontal ray.
- **Fibonacci** retracement and extension.
- Rectangle, circle, triangle, parallel channel.
- **Long / Short position** (auto TP from R:R), text, arrow.
- **Magnet** snapping to O/H/L/C, **per-tool remembered style**, hide/show and clear all.
- Drawings are stored locally **per symbol**.

### Discipline tools
- **Price alerts** with Web Push (works even when the app is closed).
- **Tasks / reminders** with repeats (daily, weekly, monthly).
- **Analytics ("Định lượng")**: trade journal, performance stats, Monte Carlo simulation and risk-management hints.
- **Lightweight accounts** (name + PIN) so a few people can share the app without mixing alert data.
- Local data backup / restore (the **Data** button at the bottom of the sidebar).

## Architecture

```
Browser (static frontend, vanilla JS)
 ├── Binance REST + WebSocket ─────────────► realtime crypto data
 └── Cloudflare Worker (backend)
      ├── /api/oanda/*  ◄── TradingView WebSocket ► XAUUSD (OANDA)
      ├── /api/alerts, /api/signals, /api/tasks ► KV
      ├── /api/subscribe ► Web Push (VAPID)
      └── Cron ► checks alerts, signals and reminders
```

- **Frontend:** plain HTML / CSS / JavaScript, no build step. Modules communicate through an `EventBus`.
- **Backend:** a single Cloudflare Worker (`dq-tracker-push`) using KV to store alerts, signals, tasks, profiles and push subscriptions.
- **Local-first:** UI settings (layout, symbols, indicators, drawings, watchlist, theme) are stored on the device; only alerts, signals and reminders go to the server because pushes must work when the app is closed.
- OANDA data is currently fetched by **polling** (1 s for the active pane by default, 3 s for the others), not true streaming.

## Project structure

```
├── index.html
├── manifest.json
├── icons/
├── css/
│   ├── style.css
│   ├── topbar-landscape.css
│   └── draw-flyout.css
└── js/
    ├── utils.js, icons.js, icons-ui.js      # helpers, EventBus, icons
    ├── local-store.js, storage.js           # local persistence + central state
    ├── api.js, websocket.js                 # REST / realtime data
    ├── indicator.js, chart.js, breakout.js  # indicators, chart, signals
    ├── drawing.js                           # drawing tools
    ├── ui.js, layout.js, watchlist.js       # UI
    ├── alerts.js, notifications.js, push-sync.js, login.js
    ├── tasks.js, analytics.js
    ├── countdown.js, countdown-badge.js
    ├── timeframe-fit.js, topbar-fit.js
    └── app.js                               # entry point

worker/
└── src/index.js                             # Cloudflare Worker
```

## Setup

### 1. Frontend

Serve the static folder over HTTPS (Cloudflare Pages, GitHub Pages, Netlify...). To try it locally:

```bash
npx serve .
```

Open `js/api.js` and set your own Worker URL:

```js
const WORKER_FALLBACK_URL = 'https://<your-worker-name>.workers.dev';
```

> Web Push and PWA installation require **HTTPS** (except on `localhost`).

### 2. Backend (Cloudflare Worker)

Requirements: a Cloudflare account and [Wrangler](https://developers.cloudflare.com/workers/wrangler/).

```bash
cd worker
npm install @block65/webcrypto-web-push

# Create a KV namespace and bind it as TRACKER_KV in wrangler.toml
npx wrangler kv namespace create TRACKER_KV

# Generate a VAPID key pair (once), for example:
npx web-push generate-vapid-keys

# Set secrets
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT          # e.g. mailto:you@example.com
npx wrangler secret put COINGECKO_API_KEY      # optional, avoids 429 rate limits

npx wrangler deploy
```

Example `wrangler.toml` (adjust to your account):

```toml
name = "dq-tracker-push"
main = "src/index.js"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "TRACKER_KV"
id = "<your-kv-id>"

[triggers]
crons = ["* * * * *"]   # check alerts / signals / reminders every minute
```

The cron runs every minute; the code also performs a second alert check 30 seconds later within the same run.

## Quick start

1. Type a pair into the sidebar search box and click a result to apply it to the **active pane**; click ⭐ to add it to your watchlist.
2. Pick a timeframe in the top bar; use the sliders icon next to the timeframe select to reorder priorities.
3. Toggle indicators from the legend at the top-left of each pane.
4. Choose a drawing tool in the "Vẽ" (Draw) bar; click the ▾ arrow to open the full tool panel.
5. Use the bell to set price alerts, and allow notifications when the browser asks.

## Known limitations

- OANDA/XAUUSD data comes through TradingView's **unofficial** WebSocket protocol. It may change or be rate-limited at any time, and using it may conflict with their terms. Consider this before using the app beyond personal use.
- The Cloudflare Workers Free plan has a daily request limit; fast polling on several devices at once can exceed it.
- Name + PIN accounts are a lightweight way to separate data, **not a full security system**. Do not store sensitive information.
- Server-side price alerts use CoinGecko prices and only support crypto pairs already mapped inside the Worker.

## License

Not specified yet. Add a `LICENSE` file that fits your project.