# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Investment Terminal (4RCH3R)** — a full-stack portfolio tracking app with AI-powered investment insights.

Stack: Python FastAPI backend + MongoDB (Atlas, synchronous pymongo) + Vanilla JS frontend + yfinance (live prices) + LM Studio/Ollama (AI chat) + DuckDuckGo (web search).

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run the app (serves on http://0.0.0.0:8000)
python backend/main.py

# Run all tests
python run_tests.py

# Run tests with verbose output
python run_tests.py -vv

# Run tests with coverage report
python run_tests.py --coverage

# Stop at first failure with full output
python run_tests.py --xvs

# Run a specific test file directly
pytest tests/smoke/test_smoke.py -v
```

No build step — pure Python + static JS. No lint config present.

## Architecture

```
backend/main.py              FastAPI app, uvicorn entry point, CORS, startup/shutdown, /status, /dashboard routes
  ├── backend/routes.py      All API endpoints (portfolio CRUD, positions, cash, snapshots, market data, AI chat)
  ├── backend/database.py    Synchronous pymongo client; exports `db` (None if connection fails — routes check for this)
  ├── backend/search.py      DuckDuckGo search via ddgs (5-min TTL in-memory cache)
  └── backend/models/model.py  Legacy Pydantic models + portfolio helpers (mostly unused by routes.py)

app.py                       Alternate FastAPI entry (no uvicorn runner; use for uvicorn app:app style)

frontend/public/index.html       Landing page — portfolio list + Excel upload
frontend/public/dashboard.html   Dashboard — portfolio detail, positions, chart, AI chat
frontend/public/static/style.css Dark-theme IBM Plex styling
frontend/public/static/app.js    Main JS entry point — wires DOM events, imports all modules

frontend/public/static/modules/
  ├── state.js        Shared mutable state object (currentPortfolioId, currentPeriod, chartMode, benchmarkEnabled, charts, etc.)
  ├── chart.js        Heartrate chart, sector donut, ticker tape animation, Fear & Greed widget
  ├── portfolio.js    Fetches portfolio data and renders the holdings table
  ├── modals.js       Position (buy/edit), sell, cash deposit/withdraw, and rename modals
  ├── chat.js         AI chat panel logic
  ├── detail.js       Stock detail slide-in panel (1M price chart, stats, news)
  ├── ui.js           Shared UI utilities (toasts, panel toggles, etc.)
  └── formatters.js   formatCurrency / formatPercent helpers
```

The FastAPI app (backend/main.py) serves `frontend/public/` statically:
- `/` → `index.html`
- `/dashboard` → `dashboard.html`
- `/static/*` → `frontend/public/static/`

## Database

MongoDB database: `investment_app`. Each portfolio has three companion collections:

| Collection | Purpose |
|------------|---------|
| `{portfolio_id}` | Positions — `{ ticker, shares, average_cost }` |
| `{portfolio_id}_history` | Snapshot history (heartrate chart data) |
| `{portfolio_id}_trades` | Trade log — sell, deposit, withdraw events with realized P&L |

Cash is stored as `{ "ticker": "CASH", "shares": <amount>, "average_cost": 1.0 }`. Collection names are sanitized (`.`, `$`, null bytes → `_`) via `_safe_collection_name()` before every MongoDB call.

`/api/portfolios/list` filters companion collections by excluding names containing `_history` or `_trades`.

## Key Design Patterns

**Live pricing:** `routes.py` bulk-downloads all tickers via `yf.download()` on every `GET /api/portfolios/{id}`. Falls back to `average_cost` for any ticker with no yfinance data (handles delisted tickers).

**Snapshots (automatic):** Every `GET /api/portfolios/{id}` calls `_maybe_record_snapshot()`, which writes at most one snapshot per market slot per day (`open` before 12:45 ET, `midday` before 16:00 ET, `close` after). Manual snapshots via `POST /api/portfolios/{id}/snapshot` force-upsert the current slot.

**Ticker validation:** `_validate_ticker()` fetches 5-day yfinance history and caches results for 1 hour (max 500 entries). Called only for new buy positions (not edits, not batch uploads).

**Buy vs Edit:** `POST /api/portfolios/{id}/positions` accepts `action: "buy"` (deducts cash, validates ticker for new positions, weighted-average merges) or `action: "edit"` (sets shares/cost directly, no cash impact).

**Transactions:** Buy, sell, cash deposit/withdraw are wrapped in `_with_optional_transaction()`, which runs inside a MongoDB session when available and falls back to no-transaction for standalone instances or mongomock (used in tests).

**Trade log:** Every sell, deposit, and withdraw writes a document to `{portfolio_id}_trades`. `GET /api/portfolios/{id}/trades` returns the last 200 trades sorted descending and their total realized P&L.

**Portfolio rename:** `POST /api/portfolios/{id}/rename` copies all three collections (`{id}`, `{id}_history`, `{id}_trades`) to new names then drops the originals.

**Sector allocation:** `GET /api/portfolios/{id}/sectors` groups positions by `yf.Ticker(ticker).info["sector"]` and returns each sector's total value and percentage of the portfolio.

**Benchmark overlay:** `GET /api/market/benchmark?symbol=SPY&period=1w` returns daily closing prices for any symbol over the requested period (validated against a strict regex). Results are cached 5 min per symbol+period pair. The frontend scales SPY to the portfolio's starting value so both lines share the same y-axis.

**Stock detail panel:** Clicking any ticker opens a slide-in panel (`detail.js`). `GET /api/market/stock-detail/{ticker}` returns 1-month daily close prices, key stats (current price, day change, market cap, 52W high/low, volume, P/E), and recent news. Cached 5 min per ticker.

**Heartrate chart modes:** The chart has a VALUE / P&L toggle (`state.chartMode`). In P&L mode, each data point is rendered as `value − period_start_value`, so the chart shows cumulative gain/loss from the beginning of the selected period. The benchmark overlay also shifts to P&L terms in this mode.

**AI chat (`POST /api/chat`):** Assembles portfolio summary + DuckDuckGo search results (always searched unless `use_web_search: false`) into a prompt, then calls the local LLM synchronously (non-streaming, 300 s timeout). `should_trigger_search()` is no longer the gating check — search always runs when `use_web_search` is true.

**LLM backend:** Controlled by `LLM_BACKEND` env var (`lmstudio` or `ollama`). Both use an OpenAI-compatible `/v1/chat/completions` endpoint. LM Studio uses model `"*"` (any loaded model).

**Market data caches:** Ticker tape (`GET /api/market/ticker-tape`) refreshes every 5 min. Fear & Greed index (`GET /api/market/fear-greed`) refreshes every 1 hour. Both use in-process dicts.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/portfolios/list` | List portfolio names (excludes `_history` and `_trades` collections) |
| GET | `/api/portfolios/{id}` | Portfolio with live prices, P&L, daily change |
| POST | `/api/portfolios/upload` | Upload Excel file to create/replace a portfolio |
| DELETE | `/api/portfolios/{id}` | Drop portfolio and all companion collections |
| POST | `/api/portfolios/{id}/rename` | Rename portfolio (copies all 3 collections, drops originals) |
| POST | `/api/portfolios/{id}/positions` | Add/edit a position (buy or edit action) |
| DELETE | `/api/portfolios/{id}/positions/{ticker}` | Remove a position |
| POST | `/api/portfolios/{id}/positions/{ticker}/sell` | Sell shares (credits proceeds to cash, logs trade) |
| GET | `/api/portfolios/{id}/positions/export` | Export current positions as Excel |
| POST | `/api/portfolios/{id}/cash/deposit` | Add cash (logs trade) |
| POST | `/api/portfolios/{id}/cash/withdraw` | Remove cash (logs trade) |
| GET | `/api/portfolios/{id}/snapshots` | Historical snapshots (`period`: 1w/1m/3m/6m/1y/all) |
| POST | `/api/portfolios/{id}/snapshot` | Force-record snapshot for current slot |
| POST | `/api/portfolios/{id}/snapshots/import` | Import Excel snapshot history |
| GET | `/api/portfolios/{id}/snapshots/export` | Export snapshot history as Excel |
| GET | `/api/portfolios/{id}/trades` | Trade log (last 200 entries, total realized P&L) |
| GET | `/api/portfolios/{id}/sectors` | Sector allocation breakdown |
| GET | `/api/market/ticker-tape` | Live prices for SPY, QQQ, BTC, VIX, NVDA, etc. |
| GET | `/api/market/fear-greed` | CNN Fear & Greed index |
| GET | `/api/market/benchmark` | Daily closes for a benchmark symbol (`symbol`, `period` params) |
| GET | `/api/market/stock-detail/{ticker}` | 1M price history, key stats, and recent news for a ticker |
| POST | `/api/chat` | AI chat with portfolio context and web search |
| GET | `/status` | Health check |

## Environment Variables

```env
MONGO_URI=<mongodb+srv://...>
LM_STUDIO_API_URL=http://localhost:1234/v1/chat/completions
LLM_BACKEND=lmstudio          # or "ollama"
OLLAMA_API_URL=http://localhost:11434/v1/chat/completions
OLLAMA_MODEL=llama3
SSL_VERIFY=true               # set to "false" to skip TLS verification for local LLM
```

## Tests

All tests live in `tests/smoke/test_smoke.py`. They mock MongoDB via `mongomock` and patch `backend.database.db` before importing the app. `run_tests.py` is a thin pytest wrapper. The test helper `get_test_client()` must patch both `backend.routes.db` and `routes.db` (the module may be imported under either name depending on sys.path).

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)

## Context Navigation
1. ALWAYS query the knowledge graph first
2. Only read raw files if i say so
3. Use garphify-out/wiki/index.md
