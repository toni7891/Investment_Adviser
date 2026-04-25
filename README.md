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

The AI requires LM Studio running locally with an OpenAI-compatible API server:

1. Download [LM Studio](https://lmstudio.ai/)
2. Load a local model (Llama 3, Mistral, etc.)
3. Start the server (usually at `http://localhost:1234`)
4. The backend is configured to use that endpoint by default

**Configurable in `backend/routes.py`:**
```python
LM_STUDIO_API_URL = "http://localhost:1234/v1/chat/completions"
```

---

## 🚀 Features

- **Live Market Tracking:** Integrated with `yfinance` for real-time price updates and bulk-fetch optimization.
- **Dynamic Portfolio Metrics:** Automatic calculation of Total Balance, Invested Value, Cash, Total Profit, and Daily Change (%).
- **Interactive Visuals:** Responsive dashboard featuring color-coded performance indicators for instant visual feedback.
- **Multi-Portfolio Support:** Ability to switch between different asset collections stored in MongoDB.
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

---
*Developed by [toni7891](https://github.com/toni7891)*
