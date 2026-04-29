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
backend/main.py          FastAPI app, uvicorn entry point, CORS, startup/shutdown, /status, /dashboard routes
  ├── backend/routes.py  All API endpoints (portfolio CRUD, positions, cash, snapshots, market data, AI chat)
  ├── backend/database.py  Synchronous pymongo client; exports `db` (None if connection fails — routes check for this)
  ├── backend/search.py  DuckDuckGo search via ddgs (5-min TTL in-memory cache)
  └── backend/models/model.py  Legacy Pydantic models + portfolio helpers (mostly unused by routes.py)

app.py                   Alternate FastAPI entry (no uvicorn runner; use for uvicorn app:app style)

frontend/public/index.html     Landing page — portfolio list + Excel upload
frontend/public/dashboard.html Dashboard — portfolio detail, positions, chart, AI chat
frontend/public/static/app.js  All frontend JS logic
frontend/public/static/style.css  Dark-theme IBM Plex styling
```

The FastAPI app (backend/main.py) serves `frontend/public/` statically:
- `/` → `index.html`
- `/dashboard` → `dashboard.html`
- `/static/*` → `frontend/public/static/`

## Database

MongoDB database: `investment_app`. Each portfolio is its own collection named by portfolio ID. Position documents:

```json
{ "ticker": "AAPL", "shares": 10, "average_cost": 150.00 }
```

Cash is stored as `{ "ticker": "CASH", "shares": <amount>, "average_cost": 1.0 }`. Collection names are sanitized (`.`, `$`, null bytes → `_`) via `_safe_collection_name()` before every MongoDB call.

Historical snapshots live in a companion collection `{portfolio_id}_history` (excluded from the portfolio list). The `/api/portfolios/list` endpoint filters these out with `"_history" not in c`.

## Key Design Patterns

**Live pricing:** `routes.py` bulk-downloads all tickers via `yf.download()` on every `GET /api/portfolios/{id}`. Falls back to `average_cost` for any ticker with no yfinance data (handles delisted tickers).

**Snapshots (automatic):** Every `GET /api/portfolios/{id}` calls `_maybe_record_snapshot()`, which writes at most one snapshot per market slot per day (`open` before 12:45 ET, `midday` before 16:00 ET, `close` after). Manual snapshots via `POST /api/portfolios/{id}/snapshot` force-upsert the current slot.

**Ticker validation:** `_validate_ticker()` fetches 5-day yfinance history and caches results for 1 hour (max 500 entries). Called only for new buy positions (not edits, not batch uploads).

**Buy vs Edit:** `POST /api/portfolios/{id}/positions` accepts `action: "buy"` (deducts cash, validates ticker for new positions, weighted-average merges) or `action: "edit"` (sets shares/cost directly, no cash impact).

**AI chat (`POST /api/chat`):** Assembles portfolio summary + DuckDuckGo search results (always searched unless `use_web_search: false`) into a prompt, then calls the local LLM synchronously (non-streaming, 300 s timeout). `should_trigger_search()` is no longer the gating check — search always runs when `use_web_search` is true.

**LLM backend:** Controlled by `LLM_BACKEND` env var (`lmstudio` or `ollama`). Both use an OpenAI-compatible `/v1/chat/completions` endpoint. LM Studio uses model `"*"` (any loaded model).

**Market data caches:** Ticker tape (`GET /api/market/ticker-tape`) refreshes every 5 min. Fear & Greed index (`GET /api/market/fear-greed`) refreshes every 1 hour. Both use in-process dicts.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/portfolios/list` | List portfolio names (excludes `_history` collections) |
| GET | `/api/portfolios/{id}` | Portfolio with live prices, P&L, daily change |
| POST | `/api/portfolios/upload` | Upload Excel file to create/replace a portfolio |
| DELETE | `/api/portfolios/{id}` | Drop portfolio collection |
| POST | `/api/portfolios/{id}/positions` | Add/edit a position (buy or edit action) |
| DELETE | `/api/portfolios/{id}/positions/{ticker}` | Remove a position |
| POST | `/api/portfolios/{id}/positions/{ticker}/sell` | Sell shares (credits proceeds to cash) |
| POST | `/api/portfolios/{id}/cash/deposit` | Add cash |
| POST | `/api/portfolios/{id}/cash/withdraw` | Remove cash |
| GET | `/api/portfolios/{id}/snapshots` | Historical snapshots (`period`: 1w/1m/3m/6m/1y) |
| POST | `/api/portfolios/{id}/snapshot` | Force-record snapshot for current slot |
| POST | `/api/portfolios/{id}/snapshots/import` | Import Excel snapshot history |
| GET | `/api/portfolios/{id}/snapshots/export` | Export snapshot history as Excel |
| GET | `/api/market/ticker-tape` | Live prices for SPY, QQQ, BTC, VIX, NVDA, etc. |
| GET | `/api/market/fear-greed` | CNN Fear & Greed index |
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
