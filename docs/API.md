# API Reference

Investment Adviser REST API. All endpoints are under the FastAPI application running on `http://localhost:8000` by default.

---

## Base URL

```
http://localhost:8000
```

---

## Health & Frontend

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serves the dashboard frontend (HTML) |
| `GET` | `/status` | Returns `{"status": "online"}` — health check |

---

## Portfolio Management

### List All Portfolios

```http
GET /api/portfolios/list
```

Returns an array of all portfolio collection names.

**Response 200:**
```json
{
  "portfolios": ["4RCH3R", "MyIRA", "Trading"]
}
```

---

### Get Portfolio (with Live Data)

```http
GET /api/portfolios/{portfolio_id}
```

Fetches a portfolio, enriches each holding with live market data from Yahoo Finance, and computes P&L and daily change.

**Path Parameters:**
- `portfolio_id` (string): Portfolio collection name (case-insensitive, special chars auto-sanitized)

**Response 200:**
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
      "daily_change": 1.25,
      "daily_change_pct": 0.72,
      "weight": 0.0878
    },
    {
      "ticker": "CASH",
      "shares": 5000.00,
      "average_cost": 1.00,
      "market_value": 5000.00,
      "pl": 0.00,
      "daily_change": 0.00,
      "weight": 0.25
    }
  ],
  "last_updated": "2026-04-26T21:24:00Z"
}
```

**Notes:**
- Invalid/delisted tickers (e.g., "APPL") fall back to `average_cost` as price to avoid crashes.
- Daily change is based on the last 2 trading days' close prices.

---

### Upload Portfolio (Excel)

```http
POST /api/portfolios/upload
Content-Type: multipart/form-data
```

Upload an Excel file to create or update a portfolio.

**Form Data:**
- `file` (binary): `.xlsx` file containing portfolio data

**Excel format:**
| Row | Column A | Column B | Column C |
|-----|----------|----------|----------|
| 0 | `Portfolio Name` | `<name>` | — |
| 2 | `Cash` | `<cash_amount>` | — |
| 4 | `Ticker` | `Shares` | `Avg Cost` |
| 5+ | `AAPL` | `10` | `150.00` |

**Response 200:**
```json
{
  "portfolio_name": "My Portfolio",
  "collection_name": "My_Portfolio",
  "inserted_count": 5
}
```

---

### Add or Update a Position

```http
POST /api/portfolios/{portfolio_id}/positions
Content-Type: application/json
```

Add a new stock holding or update an existing one (weighted-average cost is applied automatically).

**Request Body:**
```json
{
  "ticker": "AMD",
  "shares": 10,
  "average_cost": 150.00
}
```

**Response 200:**
```json
{
  "ticker": "AMD",
  "shares": 10,
  "average_cost": 150.00,
  "market_value": 1550.00,
  "pl": 50.00
}
```

**Errors:**
- `400` if ticker is invalid (not found on major exchange)
- `400` if ticker is "CASH" (use cash endpoints instead)
- `400` if shares ≤ 0

---

### Delete a Position

```http
DELETE /api/portfolios/{portfolio_id}/positions/{ticker}
```

Remove a stock holding from the portfolio.

**Response 200:**
```json
{
  "deleted_count": 1,
  "ticker": "AMD"
}
```

**Errors:**
- `400` if trying to delete the CASH position

---

### Deposit Cash

```http
POST /api/portfolios/{portfolio_id}/cash/deposit
Content-Type: application/json
```

Add cash to the portfolio's balance.

**Request Body:**
```json
{
  "amount": 5000.00
}
```

**Response 200:**
```json
{
  "new_cash": 10000.00,
  "message": "Deposited $5000.00"
}
```

---

### Withdraw Cash

```http
POST /api/portfolios/{portfolio_id}/cash/withdraw
Content-Type: application/json
```

Remove cash from the portfolio's balance.

**Request Body:**
```json
{
  "amount": 2000.00
}
```

**Response 200:**
```json
{
  "new_cash": 3000.00,
  "message": "Withdrew $2000.00"
}
```

**Errors:**
- `400` if amount exceeds available cash
- `404` if no CASH document exists in the portfolio

---

### Delete Portfolio

```http
DELETE /api/portfolios/{portfolio_id}
```

Permanently deletes the portfolio's MongoDB collection.

**Response 200:**
```json
{
  "message": "Portfolio '4RCH3R' deleted successfully"
}
```

**Errors:**
- `404` if portfolio does not exist

---

## AI Chat

### Send Chat Message

```http
POST /api/chat
Content-Type: application/json
```

Send a message to the AI Strategist. Optionally include portfolio context for personalized advice.

**Request Body:**
```json
{
  "message": "Analyze my risk exposure",
  "portfolio_id": "4RCH3R",
  "use_web_search": true
}
```

**Fields:**
- `message` (string, required) — Your question
- `portfolio_id` (string, optional) — Include to attach portfolio summary
- `use_web_search` (boolean, optional, default: `false`) — Enable DuckDuckGo search for current information

**Response 200:**
```json
{
  "response": "Based on your portfolio of AAPL, AMD, and GOOGL, your tech exposure is ~65%. Consider adding a broad-market ETF for diversification.",
  "model": "qwen3.5-27b-claude-4.6-opus-reasoning-distilled-i1",
  "backend": "LM Studio",
  "portfolio_context_included": true,
  "web_search_used": false,
  "search_query": null
}
```

**Errors:**
- `400` if `message` is empty or missing
- `502` if AI backend (LM Studio / Ollama) is unreachable or returns an error

---

## Collection Name Sanitization

Portfolio IDs are sanitized via `_safe_collection_name()` before being used as MongoDB collection names:

- `.` → `_`
- `$` → `_`
- Null bytes (`\x00`) → `_`

Example:
- User input: `"My.Portfolio$2024"`
- Stored as: `"My_Portfolio_2024"`

All endpoints automatically apply this sanitization.

---

## Error Format

Standard error responses:

```json
{
  "detail": "Error description"
}
```

HTTP status codes follow FastAPI conventions:
- `400` — Bad request (validation error, invalid ticker, insufficient funds)
- `404` — Not found (portfolio doesn't exist)
- `502` — AI backend unreachable
- `500` — Server error (unexpected exception)
