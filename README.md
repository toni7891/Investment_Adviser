<div align="center">

![4RCH3R Investment Terminal](https://placehold.co/900x200/0d1117/00d4ff?text=4RCH3R+%C2%B7+Investment+Terminal&font=montserrat)

# 📈 4RCH3R · Investment Terminal

### A full-stack, AI-powered portfolio tracker with live prices, sector analysis, and an on-device or cloud LLM strategist

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-latest-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-Bedrock%20%7C%20SES%20%7C%20CloudWatch-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white)
![yfinance](https://img.shields.io/badge/yfinance-market--data-8A2BE2?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-F59E0B?style=for-the-badge)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-10B981?style=for-the-badge)

</div>

---

## 📖 Table of Contents

- [Tech Stack](#-tech-stack)
- [Key Features](#-key-features)
- [Getting Started](#-getting-started)
- [Usage](#-usage)
- [Architecture](#-architecture)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🛠 Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Language | Python 3.11+ | Async-first with `asyncio` |
| Framework | FastAPI | Pydantic v2 request models |
| ASGI Server | Uvicorn | Serves static frontend too |
| Database | MongoDB (pymongo) | Atlas or local; sync driver |
| Market Data | yfinance | Bulk download + 1-hr validation cache |
| AI Backend | AWS Bedrock (default) / Groq / LM Studio / Ollama | Selectable via `LLM_BACKEND` env var |
| Content Safety | AWS Bedrock Guardrails | Optional; blocks off-topic / harmful AI responses |
| Web Search | DuckDuckGo (ddgs) | 5-min TTL in-process cache |
| Authentication | JWT (python-jose + passlib/bcrypt) | Role-based: `user` / `admin` |
| Alerting | AWS SES | Email alert when daily portfolio change exceeds threshold |
| Logging | CloudWatch (watchtower) | Structured log shipping to AWS |
| Frontend | Vanilla JS ES modules | IBM Plex Mono dark-theme UI |
| Data Processing | pandas + openpyxl | Excel upload & export |
| Testing | pytest + mongomock | Smoke tests, no real DB needed |

---

## ✨ Key Features

- **Live Price Tracking** — Bulk-fetches all portfolio tickers via `yfinance` on every load; gracefully falls back to average cost for delisted or unavailable symbols.
- **Multi-Portfolio Management** — Each portfolio lives in its own MongoDB collection; create, rename, or delete portfolios without touching others.
- **User Authentication** — JWT-based signup/login with bcrypt password hashing, role-based access control (`user` / `admin`), forced password reset flow, and token versioning to invalidate sessions on credential change.
- **AI Strategist Chat** — Portfolio-aware Q&A via your choice of AWS Bedrock (Claude Haiku 4.5 by default), Groq, LM Studio, or Ollama — plus optional DuckDuckGo web search for live context, all without sending your data to an uncontrolled third party.
- **AWS Bedrock Guardrails** — Optionally attach a Bedrock Guardrail to the AI chat endpoint to block off-topic, harmful, or sensitive responses before they reach the user.
- **Portfolio Alerts via SES** — Receive an email when any portfolio's daily change exceeds a configurable threshold (`ALERT_THRESHOLD_PCT`). A daily end-of-day summary email is also dispatched by the Lambda cron endpoint.
- **CloudWatch Logging** — All server-side events are shipped to AWS CloudWatch via `watchtower` for centralized observability.
- **Sector Allocation Donut Chart** — Groups holdings by GICS sector via `yf.Ticker.info`, renders a Chart.js doughnut with a colour-coded legend, and caches sector data for 1 hour.
- **Portfolio Heartrate Chart** — Plots historical NAV snapshots (up to 3× daily: open / midday / close) over configurable periods (1 W → 1 Y), with an optional SPY benchmark overlay and VALUE / P&L toggle.
- **Realized Gains & Trade History** — Every sell writes a trade record (`_trades` collection) with ticker, shares, sell price, average cost, proceeds, and realized P&L; totals surfaced in a dedicated trade history panel.
- **Excel Import & Export** — Upload a portfolio via `.xlsx` template; export current positions or full snapshot history back to Excel in one click.
- **Cash Management** — Deposit and withdraw cash with balance validation; buying a position atomically deducts cash and validates the ticker against yfinance before inserting.
- **Automatic Snapshots** — Portfolio NAV is snapshotted at most once per market slot per day automatically; manual force-snapshot available via UI or API.
- **Fear & Greed Index + Ticker Tape** — Live CNN Fear & Greed score (1-hr cache) and a scrolling ticker tape of 12 key symbols (5-min cache) always visible on the dashboard.

---

## 🚀 Getting Started

### Prerequisites

- [Python 3.11+](https://www.python.org/downloads/) (code uses `X | None` syntax — 3.10+ required at minimum)
- [MongoDB Atlas](https://www.mongodb.com/atlas) account (or a local `mongod` instance)
- *(Optional)* [LM Studio](https://lmstudio.ai/) or [Ollama](https://ollama.ai/) for local AI chat
- *(Optional)* AWS account with Bedrock, SES, and CloudWatch access for cloud deployment features

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/toni7891/Investment_Adviser.git
cd Investment_Adviser
```

2. **Create and activate a virtual environment**

```bash
# macOS / Linux
python -m venv .venv
source .venv/bin/activate

# Windows
python -m venv .venv
.venv\Scripts\activate
```

3. **Install dependencies**

```bash
pip install -r requirements.txt
```

4. **Configure environment variables**

Create a `.env` file in the project root:

```env
# ── Database ──────────────────────────────────────────────────────────────────
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority

# ── Authentication ────────────────────────────────────────────────────────────
JWT_SECRET_KEY=<long-random-secret>      # used to sign JWT tokens; process raises on startup if unset

# ── AI backend — pick one ─────────────────────────────────────────────────────
LLM_BACKEND=lmstudio                     # lmstudio | ollama | bedrock | groq
LM_STUDIO_API_URL=http://localhost:1234/v1/chat/completions

# LLM_BACKEND=ollama
# OLLAMA_API_URL=http://localhost:11434/v1/chat/completions
# OLLAMA_MODEL=llama3

# LLM_BACKEND=bedrock
# BEDROCK_MODEL=anthropic.claude-haiku-4-5-20251001-v1:0
# BEDROCK_REGION=us-east-1
# BEDROCK_GUARDRAIL_ID=<guardrail-id>       # optional
# BEDROCK_GUARDRAIL_VERSION=DRAFT           # optional

# LLM_BACKEND=groq
# GROQ_API_KEY=<groq-api-key>

# ── AWS SES alerts ────────────────────────────────────────────────────────────
ALERT_ENABLED=false
ALERT_EMAIL=you@example.com
ALERT_THRESHOLD_PCT=5.0                  # alert when |daily change| > this %

# ── Internal / Lambda ────────────────────────────────────────────────────────
INTERNAL_API_KEY=<secret>                # key for POST /api/internal/daily-close

# ── Misc ──────────────────────────────────────────────────────────────────────
SSL_VERIFY=true                          # set to "false" to skip TLS for local LLM
```

> ⚠️ **Never commit `.env` to version control** — it contains credentials.

<details>
<summary>🔧 <strong>Troubleshooting common setup issues</strong></summary>

| Problem | Fix |
|---------|-----|
| `ModuleNotFoundError: backend` | Run from the project root, not from inside `backend/` |
| `ServerSelectionTimeoutError` | Check your `MONGO_URI`; ensure your IP is whitelisted in Atlas |
| `ConnectionRefusedError` on AI chat | Start LM Studio or Ollama and confirm the API server is running |
| `pip install` fails on `openpyxl` | Upgrade pip: `pip install --upgrade pip` then retry |
| yfinance returns empty data | Your network may be blocking Yahoo Finance; try a VPN |
| Bedrock `AccessDeniedException` | Ensure your IAM role has `bedrock:InvokeModel` permission for the chosen model |
| SES `MessageRejected` | Verify sender and recipient addresses in SES (sandbox accounts require verified identities) |

</details>

#### Run the App

```bash
python backend/main.py
```

The server starts at **http://0.0.0.0:8000**. Open `http://localhost:8000` in your browser.

#### Run Tests

```bash
# Run all smoke tests
python run_tests.py

# Verbose output
python run_tests.py -vv

# With coverage report
python run_tests.py --coverage

# Stop at first failure with full output
python run_tests.py --xvs
```

---

## 💡 Usage

All API endpoints are served under `http://localhost:8000/api` and return `application/json`.

### Endpoints Overview

#### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/auth/signup` | — | Register a new user; returns JWT |
| `POST` | `/api/auth/login` | — | Login; returns JWT + role |
| `GET` | `/api/auth/me` | JWT | Get current user info |
| `PATCH` | `/api/auth/change-password` | JWT | Change password (invalidates existing tokens) |
| `PATCH` | `/api/auth/change-username` | JWT | Change username (invalidates existing tokens) |

#### Portfolio

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/portfolios/list` | JWT | List all portfolios for current user |
| `GET` | `/api/portfolios/{id}` | JWT | Portfolio with live prices & P&L |
| `POST` | `/api/portfolios/upload` | JWT | Upload Excel file to create/replace portfolio |
| `DELETE` | `/api/portfolios/{id}` | JWT | Delete portfolio and all companion collections |
| `POST` | `/api/portfolios/{id}/rename` | JWT | Rename portfolio (moves data, drops old) |
| `POST` | `/api/portfolios/{id}/positions` | JWT | Buy or edit a position |
| `DELETE` | `/api/portfolios/{id}/positions/{ticker}` | JWT | Remove a position |
| `POST` | `/api/portfolios/{id}/positions/{ticker}/sell` | JWT | Sell shares (credits proceeds to cash) |
| `GET` | `/api/portfolios/{id}/positions/export` | JWT | Export positions to Excel |
| `POST` | `/api/portfolios/{id}/cash/deposit` | JWT | Add cash |
| `POST` | `/api/portfolios/{id}/cash/withdraw` | JWT | Remove cash (validates balance) |
| `GET` | `/api/portfolios/{id}/snapshots` | JWT | Historical snapshots (`period`: 1w/1m/3m/6m/1y/all) |
| `POST` | `/api/portfolios/{id}/snapshot` | JWT | Force-record snapshot for current slot |
| `POST` | `/api/portfolios/{id}/snapshots/import` | JWT | Import Excel snapshot history |
| `GET` | `/api/portfolios/{id}/snapshots/export` | JWT | Export snapshot history as Excel |
| `GET` | `/api/portfolios/{id}/trades` | JWT | Trade history + total realized P&L |
| `GET` | `/api/portfolios/{id}/sectors` | JWT | Sector allocation breakdown |

#### Market Data & AI

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/market/ticker-tape` | — | Live prices for SPY, QQQ, BTC, VIX, etc. |
| `GET` | `/api/market/fear-greed` | — | CNN Fear & Greed index (1-hr cache) |
| `GET` | `/api/market/benchmark` | — | Benchmark price series (`symbol`, `period` params) |
| `GET` | `/api/market/stock-detail/{ticker}` | — | 1M price history, key stats, and news |
| `POST` | `/api/chat` | JWT | AI chat with portfolio context + web search |

#### Admin & Internal

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/portfolios` | JWT (admin) | List all portfolios across all users |
| `POST` | `/api/internal/daily-close` | `X-Internal-Key` header | Record EOD snapshots + send daily summary email (called by Lambda) |
| `GET` | `/status` | — | Health check |

---

### POST /api/auth/login

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "s3cr3tpass"}'
```

**Response 200:**
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "username": "alice",
  "role": "user",
  "force_password_change": false
}
```

---

### GET /api/portfolios/{id}

```bash
curl http://localhost:8000/api/portfolios/MY_PORTFOLIO \
  -H "Authorization: Bearer <token>"
```

**Response 200:**
```json
{
  "invested_value": 15432.10,
  "cash_value": 4567.90,
  "total_balance": 20000.00,
  "total_profit": 1200.50,
  "daily_change_pct": 0.45,
  "positions": [
    {
      "ticker": "AAPL",
      "shares": 10,
      "average_cost": 150.00,
      "current_price": 175.50,
      "market_value": 1755.00,
      "pl": 255.00,
      "daily_change": 1.25
    }
  ]
}
```

---

### POST /api/portfolios/{id}/positions

```bash
curl -X POST http://localhost:8000/api/portfolios/MY_PORTFOLIO/positions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"ticker": "NVDA", "shares": 5, "average_cost": 800.00, "action": "buy"}'
```

**Response 200:**
```json
{ "ticker": "NVDA", "shares": 5, "average_cost": 800.0, "message": "Position saved" }
```

---

### POST /api/portfolios/{id}/positions/{ticker}/sell

```bash
curl -X POST http://localhost:8000/api/portfolios/MY_PORTFOLIO/positions/NVDA/sell \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"shares": 2, "sell_price": 950.00}'
```

**Response 200:**
```json
{
  "message": "Sold 2 shares of NVDA @ $950.00",
  "proceeds": 1900.00,
  "ticker": "NVDA",
  "remaining_shares": 3.0
}
```

---

### POST /api/chat

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Am I over-concentrated in tech?", "portfolio_id": "MY_PORTFOLIO", "use_web_search": true}'
```

**Response 200:**
```json
{
  "response": "Based on your holdings, 72% of your portfolio is in technology...",
  "model": "anthropic.claude-haiku-4-5-20251001-v1:0",
  "backend": "AWS Bedrock",
  "portfolio_context_included": true,
  "web_search_used": true
}
```

---

### Error Responses

All errors follow a consistent shape:

```json
{ "detail": "Human-readable error message here" }
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request — invalid input, insufficient cash, oversell, same-name rename |
| `401` | Unauthorized — missing or invalid JWT, or wrong password |
| `403` | Forbidden — insufficient role, or invalid internal API key |
| `404` | Resource not found — portfolio or ticker doesn't exist |
| `409` | Conflict — username already taken |
| `503` | Database unavailable |
| `502` | AI backend or market data upstream error |

---

## 🏗 Architecture

### Folder Structure

```text
📁 investment_manager/
├── 📁 backend/
│   ├── 📄 main.py          # FastAPI app, uvicorn entry, CORS, static file serving
│   ├── 📄 routes.py        # All API endpoints; Pydantic request models
│   ├── 📄 auth.py          # JWT creation/validation; role & ownership checks
│   ├── 📄 database.py      # Synchronous pymongo client (None if disconnected)
│   ├── 📄 search.py        # DuckDuckGo search with 5-min TTL cache
│   └── 📁 models/
│       └── 📄 model.py     # Legacy Pydantic models & portfolio helpers
├── 📁 frontend/
│   └── 📁 public/
│       ├── 📄 landing.html     # Served at `/` — marketing page
│       ├── 📄 index.html       # Served at `/app` — portfolio list + Excel upload
│       ├── 📄 login.html       # Served at `/login`
│       ├── 📄 dashboard.html   # Dashboard — positions, charts, AI chat
│       └── 📁 static/
│           ├── 📄 app.js        # ES module entry point (page detection & wiring)
│           ├── 📄 style.css     # Dark-theme IBM Plex Mono styling
│           └── 📁 modules/
│               ├── 📄 state.js      # Shared mutable app state
│               ├── 📄 portfolio.js  # Holdings renderer, loadSummary, loadTrades
│               ├── 📄 chart.js      # Heartrate, sector donut, ticker tape, F&G
│               ├── 📄 modals.js     # Buy / sell / cash / rename modals
│               ├── 📄 chat.js       # AI chat UI
│               ├── 📄 detail.js     # Stock detail slide-in panel
│               ├── 📄 formatters.js # Currency & percent formatting
│               └── 📄 ui.js         # Toast notifications, confirm dialog
├── 📁 tests/
│   └── 📁 smoke/
│       └── 📄 test_smoke.py  # Smoke tests (mongomock — no real DB needed)
├── 📁 infra/             # Terraform: VPC, EC2, IAM, SSM, Lambda, CloudWatch, SNS
├── 📁 .github/workflows/ # ci.yml (lint+test+docker), cd.yml (deploy on v* tags)
├── 📄 Dockerfile, docker-compose.yml, docker/  # Optional local container path
├── 📄 app.py            # Alternate FastAPI entry (uvicorn app:app style)
├── 📄 run_tests.py      # Thin pytest wrapper with convenience flags
├── 📄 requirements.txt  # Python dependencies
└── 📄 .env              # Environment variables (never committed)
```

See [`PROJECT_SUMMARY.md`](PROJECT_SUMMARY.md) for the current, honest deployment
status — what's provisioned vs. what still needs `terraform apply`.

### Request Flow

```
Browser
  │
  ├─ Static assets ──────────────────────────────→ frontend/public/ (served by Uvicorn)
  │
  └─ API call → FastAPI (main.py)
                    │
                    └─ APIRouter (routes.py)
                          │
                          ├─ Auth check ─────→ JWT validation (auth.py)
                          │                        └─ users collection (MongoDB)
                          │
                          ├─ Portfolio CRUD ──→ MongoDB (database.py)
                          │                        ├─ {portfolio_id}           positions
                          │                        ├─ {portfolio_id}_history   snapshots
                          │                        └─ {portfolio_id}_trades    realized trades
                          │
                          ├─ Live prices ────→ yfinance (bulk download, 1-hr validation cache)
                          │
                          ├─ Market data ────→ yfinance (ticker tape + benchmark, 5-min cache)
                          │                    fear_and_greed library (1-hr cache)
                          │
                          ├─ AI chat ────────→ DuckDuckGo (ddgs, 5-min cache)
                          │                    └─→ LM Studio / Ollama / Groq / AWS Bedrock
                          │                              └─ Bedrock Guardrails (optional)
                          │                              └─→ JSON response → Browser
                          │
                          ├─ Alerts ─────────→ AWS SES (daily change threshold)
                          │
                          ├─ Logging ────────→ AWS CloudWatch (watchtower)
                          │
                          └─ Lambda cron ────→ POST /internal/daily-close
                                                  └─ EOD snapshots + SES daily summary
```

---

## 🤝 Contributing

<details>
<summary>📋 <strong>Code Style Guidelines</strong></summary>

- **Naming** — `snake_case` for all Python identifiers; `camelCase` for JavaScript; `SCREAMING_SNAKE` for module-level constants.
- **Function scope** — Each function should do one thing. Route handlers orchestrate; helpers execute. Keep handlers under ~50 lines; extract logic into named helpers.
- **Error handling** — Use `HTTPException` with a string `detail` at API boundaries. Never expose raw exception messages from internal libraries directly to the client.
- **Type hints** — All Python function signatures must include parameter and return type hints. `X | None` (PEP 604) is used throughout — requires Python 3.10+.
- **No raw `dict` request bodies** — Use Pydantic `BaseModel` subclasses for every `POST`/`PUT` endpoint; keep custom validation logic in the route handler (not as `Field` validators) to preserve string `detail` error messages.
- **Caching pattern** — Module-level `dict` cache with `{"data": None, "ts": 0.0}` shape and a TTL constant. Always check `now - cache["ts"] < TTL` before fetching.
- **Auth** — All portfolio endpoints require `Depends(get_current_user)`. Admin-only endpoints use `Depends(get_current_admin)`. Never bypass ownership checks via `check_portfolio_access()`.
- **Tests** — Every new endpoint needs at least one happy-path smoke test and one error-case test in `tests/smoke/test_smoke.py`. Use `mongomock` — do not touch a real database in tests.
- **No comments for the obvious** — Only comment the *why*, not the *what*. A well-named function needs no docstring explaining what it returns.

</details>

---

## 🛡️ License

MIT License — see [LICENSE](LICENSE) for full text. Free to use, modify, and distribute.

---

<div align="center">

Made with ☕, `yfinance`, and an unhealthy obsession with terminal aesthetics.

⭐ **If this project helped you, consider giving it a star!** ⭐

Built with 💻 by [toni7891](https://github.com/toni7891)

</div>
