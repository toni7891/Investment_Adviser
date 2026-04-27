/p# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Investment Terminal (4RCH3R)** — a full-stack portfolio tracking app with AI-powered investment insights.

Stack: Python FastAPI backend + MongoDB (Atlas) + Vanilla JS frontend + yfinance (live prices) + LM Studio/Ollama (AI chat) + DuckDuckGo (web search).

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run the app (serves on http://127.0.0.1:8000)
python app.py

# Run all tests
python run_tests.py

# Run tests with verbose output
python run_tests.py -vv

# Run tests with coverage report
python run_tests.py --coverage

# Run a specific test file directly
pytest tests/smoke/test_smoke.py -v
```

No build step — pure Python + static JS. No lint config present.

## Architecture

```
app.py (entry point)
  └── backend/main.py       FastAPI app, CORS, startup/shutdown
       ├── backend/routes.py     All 12 API endpoints
       ├── backend/database.py   Async MongoDB via motor
       ├── backend/search.py     DuckDuckGo search (5-min TTL cache)
       └── backend/models/model.py  Pydantic models + portfolio helpers

frontend/public/index.html       Single-page UI
frontend/public/static/app.js    All frontend JS logic (570 lines)
frontend/public/static/style.css Dark-theme styling
```

The FastAPI app serves the frontend statically from `frontend/public/`.

## Database

MongoDB database name: `investment_app`. Each portfolio is its own collection (named by portfolio ID). Documents are stock positions:

```json
{ "ticker": "AAPL", "shares": 10, "average_cost": 150.00, "last_updated": "..." }
```

Cash is stored as a `CASH` ticker with `average_cost = 1.0`. Collection names are sanitized (`.`, `$`, null bytes → `_`) before any MongoDB operation.

## Key Design Patterns

**Live pricing:** `routes.py` calls yfinance in bulk for all tickers in a portfolio on every GET. Falls back to `average_cost` if yfinance returns no data (handles delisted tickers gracefully).

**Ticker validation:** Before inserting any position, the ticker is validated against a 5-day yfinance history fetch. Results are cached for 1 hour.

**AI chat (`POST /api/chat`):** Sends a portfolio summary (top 10 holdings) as system context, optionally injects DuckDuckGo search results when user query matches finance keywords, then streams the response from LM Studio or Ollama. Timeout is 300 s.

**LLM backend:** Controlled by `LLM_BACKEND` env var (`lmstudio` or `ollama`). Both expose an OpenAI-compatible `/v1/chat/completions` endpoint locally.

## Environment Variables

```env
MONGO_URI=<mongodb+srv://...>
LM_STUDIO_API_URL=http://localhost:1234/v1/chat/completions
LLM_BACKEND=lmstudio          # or "ollama"
OLLAMA_API_URL=http://localhost:11434/v1/chat/completions
OLLAMA_MODEL=llama3
```

## Tests

All tests live in `tests/smoke/test_smoke.py` (~60 tests). They mock yfinance, MongoDB (via `mongomock`), and the LLM HTTP client. `run_tests.py` is a thin wrapper around pytest that sets up the right args and coverage config.
