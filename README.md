# 4RCH3R | Investment Portfolio Dashboard

A real-time investment tracking application built with **FastAPI**, **MongoDB**, and **React/TypeScript**. This dashboard aggregates financial data from MongoDB and enriches it with live market data via Yahoo Finance to provide an interactive overview of your net worth, profit/loss, and daily performance.

---

## 🤖 AI Strategy & Chat

The built-in AI Strategist connects to a local LLM (LM Studio) and can provide **portfolio-aware** insights when you have a portfolio selected.

### How It Works

1. **With portfolio selected:** The backend automatically fetches your holdings from MongoDB and includes a concise summary in the AI prompt. The AI can analyze your specific positions, diversification, P&L, and give personalized advice.
2. **Without portfolio:** The AI provides general investment education and answers hypothetical questions.

### Portfolio Context Format

When you ask a question while a portfolio is active, the AI receives:
```
Portfolio '4RCH3R':
• Cash: $10,000.00
• Holdings (5 positions):
  - AAPL: 10 shares @ $150.00
  - AMZN: 11 shares @ $111.00
  - NVDA: 12 shares @ $222.00
  - AMD: 13 shares @ $333.00

User question: Should I rebalance?
```

This context is limited to your top 10 holdings to stay within token limits.

### Using the AI Chat

**Frontend:** Simply type your question in the AI Strategist panel on the dashboard. If a portfolio is selected, the context is sent automatically.

**API example:**
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Analyze my risk exposure", "portfolio_id":"4RCH3R"}'
```

**Payload:**
```json
{
  "message": "Your question here",
  "portfolio_id": "PortfolioName"  // optional — omit for general advice
}
```

### LM Studio Setup

The AI requires a local LLM running with an OpenAI-compatible API server. You can use either **LM Studio** or **Ollama**:

#### Using LM Studio:

1. Download [LM Studio](https://lmstudio.ai/)
2. Load a local model (Llama 3, Mistral, etc.)
3. Start the server (usually at `http://localhost:1234`)
4. The backend defaults to using that endpoint

#### Using Ollama:

1. Install [Ollama](https://ollama.ai/)
2. Pull a model: `ollama pull llama3`
3. Start Ollama (it runs on `http://localhost:11434` by default)
4. Set `LLM_BACKEND=ollama` in your `.env` file

**Configurable in `backend/routes.py`:**
```python
# For LM Studio (default)
LM_STUDIO_API_URL = "http://localhost:1234/v1/chat/completions"

# For Ollama
# LLM_BACKEND = "ollama"
# OLLAMA_API_URL = "http://localhost:11434/v1/chat/completions"
# OLLAMA_MODEL = "llama3"
```

Set these as environment variables in your `.env` file:
```env
LLM_BACKEND=lmstudio              # or "ollama"
LM_STUDIO_API_URL=http://localhost:1234/v1/chat/completions
OLLAMA_API_URL=http://localhost:11434/v1/chat/completions
OLLAMA_MODEL=llama3
```

---

## 🔍 Web Search (Experimental)

The AI can optionally include real-time information from DuckDuckGo when you enable the "Include web search" checkbox in the chat panel (enabled by default).

### Usage

Enable the checkbox before sending your question. If your question likely needs current information, a web search runs automatically and results are included in the AI's context.

**API:**
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Current price of TSLA", "use_web_search": true}'
```

The `use_web_search` field defaults to `true` if omitted.

**Response includes a usage flag:**
```json
{
  "response": "NVDA is currently trading around $140...",
  "model": "llama-3-...",
  "backend": "LM Studio",
  "portfolio_context_included": false,
  "web_search_used": true
}
```

### How it works

1. When `use_web_search` is enabled, the backend checks if your question likely needs current data using keyword triggers (e.g., "current", "latest", "news", "price", "forecast", "analyst").
2. If triggered, a DuckDuckGo search runs (up to 5 results).
3. Results are formatted and included in the prompt sent to the LLM.
4. The AI is instructed to cite sources when referencing web data.

### Limitations

- DuckDuckGo is unauthenticated and may rate-limit frequent queries.
- Not suitable for high-volume or commercial use cases.
- Results are summaries and may be incomplete or outdated.
- The AI may occasionally misinterpret snippets; treat financial advice as educational.

### Future improvements

Consider upgrading to Tavily or Brave Search APIs for higher reliability, richer financial data, and dedicated finance indexing.

---

## 🚀 Features

- **Live Market Tracking:** Integrated with `yfinance` for real-time price updates and bulk-fetch optimization.
- **Dynamic Portfolio Metrics:** Automatic calculation of Total Balance, Invested Value, Cash, Total Profit, and Daily Change (%).
- **Interactive Visuals:** Responsive dashboard featuring color-coded performance indicators for instant visual feedback.
- **Multi-Portfolio Support:** Ability to switch between different asset collections stored in MongoDB.
- **Portfolio Management:** Create, edit, and delete portfolios directly from the dashboard.
- **AI Strategist Panel:** Built-in integration with LM Studio for portfolio analysis and AI-powered insights.
- **Excel Upload Support:** Upload portfolio data via Excel template with intelligent parsing.

## 🛠️ Tech Stack

- **Backend:** Python, FastAPI, Uvicorn
- **Database:** MongoDB (via PyMongo/Motor)
- **Data Source:** yfinance (Yahoo Finance API)
- **Frontend:** Vanilla JavaScript, HTML/CSS
- **AI Integration:** LM Studio (local LLM)
- **Tools:** Python-dotenv, Pandas, Openpyxl, Certifi

## 📂 Project Structure

```text
investment_manager/
├── backend/
│   ├── main.py            # FastAPI application & server config
│   ├── routes.py          # API endpoints (portfolios, metrics, AI chat)
│   ├── database.py        # MongoDB connection management
│   └── models/
│       └── model.py       # Data models & DB helper functions
├── frontend/
│   ├── public/
│   │   ├── index.html     # Main dashboard UI
│   │   ├── dashboard.html
│   │   └── static/        # CSS, JS, and assets
│   └── src/               # React components (if present)
├── app.py                 # Minimal FastAPI wrapper for deployment
├── requirements.txt       # Python dependencies
├── .env                   # Environment variables (MONGO_URI)
└── README.md             # This file
```

## ⚙️ Setup & Installation

### 1. Prerequisites
- Python 3.9+
- MongoDB (Local instance or Atlas cluster)

### 2. Environment Configuration
Create a `.env` file in the project root (or `backend/`):

```env
MONGO_URI=mongodb://localhost:27017
DB_NAME=investment_db
```

For MongoDB Atlas:
```env
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
```

### 3. Install Dependencies
```bash
cd backend
pip install -r ../requirements.txt
```

### 4. Run the Application
```bash
# From the project root (uses app.py)
python app.py

# Or directly from backend
cd backend
python main.py
```
The server starts at `http://127.0.0.1:8000`. Navigate to the dashboard.

### 5. (Optional) Start LM Studio for AI Chat
- Download [LM Studio](https://lmstudio.ai/)
- Load a local model (e.g. Llama 3, Mistral)
- Ensure the API server is running at `http://localhost:1234`

## 📊 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Serves the frontend dashboard |
| `GET` | `/status` | Backend health check |
| `GET` | `/api/portfolios` | Returns default portfolio (`4RCH3R`) |
| `GET` | `/api/portfolios/list` | Lists all available portfolio collections |
| `GET` | `/api/portfolios/{portfolio_id}` | Fetch metrics & live pricing for a portfolio |
| `POST` | `/api/portfolios/upload` | Upload Excel file to create/update portfolio |
| `POST` | `/api/chat` | AI chat — include `portfolio_id` for portfolio-aware advice |
| `POST` | `/api/portfolios/{portfolio_id}/positions` | Add or update a stock position |
| `DELETE` | `/api/portfolios/{portfolio_id}/positions/{ticker}` | Remove a stock position |
| `POST` | `/api/portfolios/{portfolio_id}/cash/deposit` | Deposit cash into portfolio |
| `POST` | `/api/portfolios/{portfolio_id}/cash/withdraw` | Withdraw cash from portfolio |

### Portfolio Response Schema

```json
{
  "invested_value": 15000.00,
  "cash_value": 5000.00,
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

## 📁 Frontend Overview

- **index.html** — Main entry point; loads React app from `frontend/public/`
- **dashboard.html** — Alternative dashboard view
- **static/** — Bundled JavaScript, CSS, and images (built by React)
- **src/** — React/TypeScript source components (PortfolioPage, charts, etc.)

To modify the UI, edit the React components in `frontend/src/` and rebuild.

## 📋 Excel Template Format

Portfolios can be uploaded via an Excel file. The expected format:

| Row | Column A | Column B | Column C |
| :--- | :--- | :--- | :--- |
| `0` | `portfolio name:` | `<Portfolio Name>` | *(blank)* |
| `1` | *(blank)* | *(blank)* | *(blank)* |
| `2` | `cash` | `<cash_amount>` | *(blank)* |
| `3` | *(blank)* | *(blank)* | *(blank)* |
| `4` | `stock ticker` | `num of shares` | `avg price` |
| `5+` | `<TICKER>` | `<shares>` | `<average_cost>` |

**Notes:**
- Header row (row 4) column names are case-insensitive (`stock ticker`, `num of shares`, `avg price`).
- Ticker symbols are converted to uppercase automatically.
- Cash row must use `cash` as the label.
- Any number of stock rows can follow the header.

Example template: [`investment_tamplate.xlsx`](investment_tamplate.xlsx) in the project root.

To use: POST the `.xlsx` file to `/api/portfolios/upload` via the dashboard UI or API client.

## 🎯 Adding & Removing Positions

The dashboard allows you to add, edit, or remove individual stock positions without re-uploading the entire Excel file.

### UI Actions

- **Add Stock** — Click the `+ Add Stock` button above the holdings table to open a modal. Enter ticker, shares, and average cost.
- **Edit Position** — Click the ✏️ icon on any row to modify shares or average cost (ticker cannot be changed).
- **Remove Position** — Click the 🗑️ icon on any row to delete that holding (except CASH, which is protected).

After any change, the portfolio metrics (total balance, P&L, etc.) refresh automatically.

### API

**Add or update a position:**
```bash
curl -X POST http://localhost:8000/api/portfolios/4RCH3R/positions \
  -H "Content-Type: application/json" \
  -d '{"ticker":"AAPL","shares":25,"average_cost":175.50}'
```

**Remove a position:**
```bash
curl -X DELETE http://localhost:8000/api/portfolios/4RCH3R/positions/AAPL
```

**Notes:**
- `CASH` cannot be added, edited, or deleted via these endpoints (cash is managed by Excel upload or future deposit/withdraw endpoints).
- The POST endpoint is an **upsert**: if the ticker exists, it replaces `shares` and `average_cost`; if not, it creates a new position.
 - Average cost is set manually — the API does not automatically recalculate when you add shares; you must compute the weighted average yourself.

## 💰 Cash Management

You can deposit or withdraw cash directly from the dashboard using the **Deposit Cash** and **Withdraw Cash** buttons. These operations modify the special `CASH` position in your portfolio.

### UI Actions

- **Deposit Cash** — Click the green "💰 Deposit Cash" button to add funds.
- **Withdraw Cash** — Click the orange "💸 Withdraw Cash" button to remove funds (cannot exceed available balance).

### API

**Deposit cash:**
```bash
curl -X POST http://localhost:8000/api/portfolios/4RCH3R/cash/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": 5000}'
```

**Withdraw cash:**
```bash
curl -X POST http://localhost:8000/api/portfolios/4RCH3R/cash/withdraw \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'
```

**Notes:**
- Amount must be a positive number.
- Withdrawals fail if insufficient cash is available.
- The `CASH` position has `average_cost: 1.0` (not used in calculations).
- Cash balance is included in total portfolio value.

### Delete Portfolio

**From the Landing Page**, hover over a portfolio card and click the trash icon that appears in the top-right corner. Confirm the deletion in the dialog. The portfolio and all its positions are permanently removed.

**API:**
```bash
curl -X DELETE http://localhost:8000/api/portfolios/PORTFOLIO_NAME
```

## 🗄️ Database Schema

Each portfolio is stored as a separate MongoDB collection named after the portfolio ID (e.g., `4RCH3R`). Documents contain:

```json
{
  "ticker": "AAPL",
  "shares": 10,
  "average_cost": 150.00,
  "last_updated": "2026-04-24T00:00:00Z"
}
```

A special `CASH` ticker represents uninvested cash.

## 🛡️ License
MIT License — feel free to use and modify.


## 🧪 Testing

The project includes **minimal smoke tests** (happy path only) that verify core endpoints are operational. No edge cases are covered — these are quick health checks.

### Running Tests

```bash
# Run all smoke tests (default)
python run_tests.py

# Verbose output
python run_tests.py -vv

# With coverage report
python run_tests.py --coverage

# Run tests directly with pytest
pytest tests/smoke -v
```

### Test Coverage

Smoke tests cover:
- `/status` health check
- `/` frontend serving
- `/api/portfolios/list` (empty)
- `/api/portfolios/{id}` (404 case)
- `POST /api/portfolios/{id}/positions` (valid and invalid ticker)
- `POST /api/portfolios/{id}/cash/deposit`
- `POST /api/portfolios/{id}/cash/withdraw`
- `POST /api/chat` (with and without portfolio context)
- `GET /api/portfolios/{id}` metric calculations

Test files live in `tests/smoke/`.

---
*Developed by [toni7891](https://github.com/toni7891)*
