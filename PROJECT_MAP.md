# PROJECT_MAP — Data Flow

## Overview

Single-page app. FastAPI backend serves the frontend as static files and exposes a REST API at `/api/*`. The browser talks only to the backend; the backend talks to MongoDB, yfinance, DuckDuckGo, and a local LLM.

```
Browser ──── HTTP/fetch ────▶ FastAPI (backend/main.py)
                                  ├── routes.py   (all logic)
                                  ├── database.py (MongoDB)
                                  ├── search.py   (DuckDuckGo)
                                  └── yfinance    (market data)
```

---

## Startup

`python backend/main.py` → uvicorn starts on `:8000`

1. `database.py` connects to MongoDB Atlas using `MONGO_URI`, sets module-level `db`.
2. `main.py` mounts `frontend/public/static/` at `/static` and registers all routes from `routes.py` under the `/api` prefix.
3. `GET /` → `index.html`, `GET /dashboard` → `dashboard.html`.

---

## Frontend Boot

**Landing page (`index.html` + `app.js`):**
- Detects `#landing-page` element → calls `loadPortfolios()`.
- `loadPortfolios()` → `GET /api/portfolios/list` → renders portfolio list.
- User clicks a portfolio → `localStorage.setItem("currentPortfolioId", name)` → redirects to `/dashboard`.

**Dashboard page (`dashboard.html` + `app.js`):**
- Reads `currentPortfolioId` from `localStorage`. Missing → redirect to `/`.
- Initialises all modals and the chat panel.
- Fires the first data load: `loadSummary()`, `updateTickerTape()`, `loadFearGreed()`.
- Polls `loadSummary()` every 90 s, ticker tape every 5 min, Fear & Greed every 60 min.

---

## Core Data Flow: Portfolio Load

```
loadSummary()
  └─▶ GET /api/portfolios/{id}
        ├── MongoDB: read positions collection
        ├── yfinance: bulk download 2d OHLCV for all tickers (async executor)
        │     └── fallback to average_cost if ticker has no data
        ├── Compute per-position: current_price, market_value, P&L, daily_change%
        ├── Compute totals: invested_value, cash_value, total_balance, daily_change_pct
        ├── _maybe_record_snapshot() → write to {id}_history if market slot changed
        └── Return JSON
  ├── renderHoldings(data)   → builds the positions table
  ├── updateStatusIndicators() → updates header P&L / daily change badges
  ├── loadHeartrate(period)  → GET /api/portfolios/{id}/snapshots?period=1w
  │     └── chart.js: renders Chart.js line chart; optionally overlays benchmark
  ├── loadSectors()          → GET /api/portfolios/{id}/sectors
  │     └── yfinance .info["sector"] per ticker (5-min cache) → donut chart
  └── loadTrades()           → GET /api/portfolios/{id}/trades
        └── {id}_trades collection, last 200 rows
```

**State:** `state.js` holds a single exported object shared by all modules. Key fields:
- `currentPortfolioId` — set from localStorage on boot
- `lastPortfolioData` — cached API response, used for re-renders without a round-trip
- `currentPeriod`, `chartMode` ("value"/"pnl"), `benchmarkEnabled` — chart controls
- `sortKey`, `sortDir` — holdings table sort

---

## Write Paths

### Buy position
```
User fills modal → POST /api/portfolios/{id}/positions {action:"buy"}
  ├── Check cash sufficiency
  ├── _validate_ticker() — yfinance 5d history (1h cache, max 500 entries), new tickers only
  ├── _with_optional_transaction():
  │     ├── upsert position (weighted-average merge if existing)
  │     └── CASH.$inc(-cost)
  └── Response → modal closes → loadSummary() re-fetches
```

### Sell position
```
User fills sell modal → POST /api/portfolios/{id}/positions/{ticker}/sell
  ├── _with_optional_transaction():
  │     ├── reduce/delete position
  │     └── CASH.$inc(+proceeds)
  ├── Insert trade record into {id}_trades (date, ticker, shares, sell_price, realized_pnl)
  └── Response → loadSummary()
```

### Cash deposit / withdraw
```
POST /api/portfolios/{id}/cash/deposit  or  /cash/withdraw
  ├── CASH.$inc(±amount)
  ├── Insert trade record into {id}_trades (type: "deposit"/"withdraw")
  └── Response → loadSummary()
```

### Excel upload (new portfolio)
```
User drops .xlsx on landing page → POST /api/portfolios/upload (multipart)
  ├── _parse_portfolio_upload(): pandas reads sheet, normalises headers
  ├── Inserts positions into new MongoDB collection
  └── Response → loadPortfolios() refreshes list
```

---

## Snapshots (Heartrate Chart Data)

Snapshot writes are **triggered automatically on every GET /portfolios/{id}** — no explicit user action needed.

```
_maybe_record_snapshot(portfolio_id, total, invested, cash)
  ├── Determine market slot: "open" (before 12:45 ET), "midday" (before 16:00), "close" (after)
  ├── Check {id}_history for existing doc with today's date + slot
  └── Upsert if slot not yet recorded today → {id}_history collection

Manual snapshot: POST /api/portfolios/{id}/snapshot
  └── _force_record_snapshot() → always upserts current slot
```

Frontend reads them with `GET /api/portfolios/{id}/snapshots?period=1w|1m|3m|6m|1y|all`.

---

## Market Data (Read-Only, Cached In-Process)

| Endpoint | Source | Cache TTL |
|---|---|---|
| `GET /api/market/ticker-tape` | yfinance bulk download (SPY, QQQ, BTC, VIX, NVDA…) | 5 min |
| `GET /api/market/fear-greed` | `fear_and_greed` library | 60 min |
| `GET /api/market/benchmark?symbol=SPY&period=1w` | yfinance `.history()` | 5 min |
| `GET /api/market/stock-detail/{ticker}` | yfinance `.history()` + `.info` + DuckDuckGo news | 5 min |

All caches are plain module-level dicts (`_TAPE_CACHE`, `_FNG_CACHE`, etc.) — no Redis, resets on process restart.

---

## AI Chat

```
User types message → POST /api/chat {message, portfolio_id, use_web_search}
  ├── GET /api/portfolios/{id}  →  _format_portfolio_summary() (positions + P&L text)
  ├── web_search_cached(message) via DuckDuckGo ddgs  (5-min TTL dict cache)
  ├── Build prompt: portfolio_summary + web_results + user_message
  ├── call_ai_backend(prompt)
  │     └── POST to LM Studio or Ollama /v1/chat/completions (controlled by LLM_BACKEND env)
  │           300 s timeout, synchronous
  └── Return {response, model, backend, portfolio_context_included, web_search_used}
```

---

## Stock Detail Panel

```
User clicks ticker in holdings table → window._openDetailPanel(ticker)
  └── GET /api/market/stock-detail/{ticker}
        ├── yfinance 1M price history → 30-day line chart (Chart.js)
        ├── yfinance fast_info → price, day change, market cap, 52W high/low, volume, P/E
        └── DuckDuckGo web_search_structured() → 5 recent news headlines
```

---

## MongoDB Collections per Portfolio

| Collection | Contents |
|---|---|
| `{id}` | Positions: `{ticker, shares, average_cost}`. CASH stored as `ticker:"CASH", average_cost:1.0`. |
| `{id}_history` | Snapshots: `{date, slot, total_value, invested_value, cash_value}` |
| `{id}_trades` | Trade log: sells, deposits, withdraws with realized P&L |

Collection names are sanitised via `_safe_collection_name()` (`.`, `$`, null → `_`) before every MongoDB call.

---

## Module Dependency Map (Frontend)

```
app.js (entry)
  ├── state.js          ← shared by every module
  ├── ui.js             ← showToast, showConfirm (called by all)
  ├── formatters.js     ← formatCurrency, formatPercent (called by portfolio, chart, modals, detail)
  ├── portfolio.js      ← loadSummary → renderHoldings, loadTrades, updateStatusIndicators
  ├── chart.js          ← loadHeartrate, loadSectors, updateTickerTape, loadFearGreed
  ├── modals.js         ← position/sell/cash/rename modals; all call loadSummary on success
  ├── chat.js           ← initChat, handleSendMessage
  └── detail.js         ← openDetailPanel, _renderDetail; exposed via window._openDetailPanel
```

---

## Backend Core
This is the skeletal structure of the server-side logic:
- **Server Entry:** [[main.py]] — Initialises FastAPI and mounts static files.
- **API Router:** [[routes.py]] — The "brain" containing all endpoint logic.
- **Database Wrapper:** [[database.py]] — Handles MongoDB connections and URI logic.
- **Market Data:** yfinance (third-party library called inside [[routes.py]]) — Fetches stock/ETF pricing.
- **Search Engine:** [[search.py]] — DuckDuckGo integration for news/chat context.

---

## Frontend Modules

The frontend is a modular JavaScript application located in `frontend/public/`. It uses a shared state pattern to keep the UI in sync.

### Core Entry & State
- **Entry Point:** [[app.js]] — Orchestrates module initialization based on the current page.
- **Global State:** [[state.js]] — The single source of truth for portfolio data and UI status.
- **Global Styles:** [[style.css]] — Custom CSS for the dashboard and landing pages.

### HTML Views
- **Landing Page:** [[index.html]] — Portfolio selection and Excel upload interface.
- **Main App:** [[dashboard.html]] — The primary investment tracking dashboard.

### Functional Modules
Located in `static/modules/`, these handle specific UI logic:
- **Data Orchestration:** [[portfolio.js]] — Manages fetching and rendering holdings.
- **Visuals & Charts:** [[chart.js]] — Handles Chart.js logic for "Heartrate" and Ticker tapes.
- **AI Interface:** [[chat.js]] — Manages the connection to the AI chat backend.
- **Stock Analysis:** [[detail.js]] — Logic for the deep-dive ticker panel.
- **User Input:** [[modals.js]] — Buy/Sell/Cash transaction forms.
- **Utilities:** [[formatters.js]] — Currency and percent formatting.
- **Common UI:** [[ui.js]] — Shared components like toasts and confirmations.

---

## Logic Dependencies

### Backend

| Importer | Depends On | What it uses |
|---|---|---|
| [[main.py]] | [[routes.py]] | `router` (registered under `/api` prefix) |
| [[routes.py]] | [[database.py]] | `db`, `client` (MongoDB handle) |
| [[routes.py]] | [[search.py]] | `web_search_cached`, `web_search_structured` |

```
[[main.py]] -> [[routes.py]]
[[routes.py]] -> [[database.py]]
[[routes.py]] -> [[search.py]]
```

### Frontend Modules

| Importer | Depends On | What it uses |
|---|---|---|
| [[app.js]] | [[state.js]] | `state` |
| [[app.js]] | [[ui.js]] | `showToast`, `showConfirm` |
| [[app.js]] | [[portfolio.js]] | `loadSummary`, `loadPortfolios`, `updateStatusIndicators`, `exportPositions`, `loadTrades` |
| [[app.js]] | [[chart.js]] | `loadHeartrate`, `loadSectors`, `updateTickerTape`, `loadFearGreed` |
| [[app.js]] | [[chat.js]] | `initChat` |
| [[app.js]] | [[detail.js]] | `openDetailPanel`, `closeDetailPanel` |
| [[app.js]] | [[modals.js]] | all modal open/close/init functions |
| [[portfolio.js]] | [[state.js]] | `state` |
| [[portfolio.js]] | [[formatters.js]] | `formatCurrency`, `formatPercent`, `setSignedStatus` |
| [[portfolio.js]] | [[ui.js]] | `showToast`, `showConfirm` |
| [[portfolio.js]] | [[chart.js]] | `loadHeartrate`, `loadSectors` |
| [[portfolio.js]] | [[modals.js]] | `openPositionModal`, `openSellModal` |
| [[chart.js]] | [[state.js]] | `state` |
| [[chart.js]] | [[formatters.js]] | `formatCurrency` |
| [[modals.js]] | [[state.js]] | `state` |
| [[modals.js]] | [[formatters.js]] | `formatCurrency` |
| [[modals.js]] | [[ui.js]] | `showToast`, `setFieldError`, `clearFieldErrors` |
| [[modals.js]] | [[portfolio.js]] | `loadSummary` |
| [[chat.js]] | [[state.js]] | `state` |
| [[chat.js]] | [[ui.js]] | `showToast` |
| [[detail.js]] | [[formatters.js]] | `formatCurrency`, `formatPercent` |

```
[[app.js]] -> [[state.js]]
[[app.js]] -> [[ui.js]]
[[app.js]] -> [[portfolio.js]]
[[app.js]] -> [[chart.js]]
[[app.js]] -> [[chat.js]]
[[app.js]] -> [[detail.js]]
[[app.js]] -> [[modals.js]]
[[portfolio.js]] -> [[state.js]]
[[portfolio.js]] -> [[formatters.js]]
[[portfolio.js]] -> [[ui.js]]
[[portfolio.js]] -> [[chart.js]]
[[portfolio.js]] -> [[modals.js]]
[[chart.js]] -> [[state.js]]
[[chart.js]] -> [[formatters.js]]
[[modals.js]] -> [[state.js]]
[[modals.js]] -> [[formatters.js]]
[[modals.js]] -> [[ui.js]]
[[modals.js]] -> [[portfolio.js]]
[[chat.js]] -> [[state.js]]
[[chat.js]] -> [[ui.js]]
[[detail.js]] -> [[formatters.js]]
```

### Frontend → Backend API calls

```
[[portfolio.js]] -> GET /api/portfolios/{id}         (loadSummary)
[[portfolio.js]] -> GET /api/portfolios/{id}/trades  (loadTrades)
[[portfolio.js]] -> GET /api/portfolios/list         (loadPortfolios)
[[chart.js]]     -> GET /api/portfolios/{id}/snapshots (loadHeartrate)
[[chart.js]]     -> GET /api/portfolios/{id}/sectors   (loadSectors)
[[chart.js]]     -> GET /api/market/ticker-tape        (updateTickerTape)
[[chart.js]]     -> GET /api/market/fear-greed         (loadFearGreed)
[[chart.js]]     -> GET /api/market/benchmark          (benchmark overlay)
[[modals.js]]    -> POST /api/portfolios/{id}/positions (buy/edit)
[[modals.js]]    -> POST /api/portfolios/{id}/positions/{ticker}/sell
[[modals.js]]    -> POST /api/portfolios/{id}/cash/deposit
[[modals.js]]    -> POST /api/portfolios/{id}/cash/withdraw
[[modals.js]]    -> POST /api/portfolios/{id}/rename
[[chat.js]]      -> POST /api/chat
[[detail.js]]    -> GET /api/market/stock-detail/{ticker}
[[app.js]]       -> POST /api/portfolios/{id}/snapshot
[[app.js]]       -> GET/POST /api/portfolios/{id}/snapshots/export|import
```