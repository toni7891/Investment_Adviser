# Manual Verification Checklist

Use this checklist to manually verify all bug fixes and features are working correctly.

---

## Prerequisites

1. MongoDB running locally (or connection string configured in `.env`)
2. Backend server running: `python app.py`
3. Frontend accessible at `http://localhost:8000`
4. (Optional) LM Studio running for AI chat at `http://localhost:1234`

---

## ✅ Bug Fixes Verification

### 1. AI Chat Receives Portfolio Context

**Steps:**
1. Create or upload a portfolio with at least 1 stock position (e.g., AAPL) and some cash.
2. Open browser DevTools → Network tab.
3. In the AI chat panel, select the portfolio from dropdown.
4. Type: "What stocks do I own?" and send.
5. Inspect the POST to `/api/chat` — verify request body includes:
   ```json
   {"message": "...", "portfolio_id": "4RCH3R", "use_web_search": false}
   ```
6. Verify the AI response references your actual holdings (e.g., mentions AAPL).

**Expected:** Response mentions real tickers from your portfolio. No generic "I have no portfolio data" replies.

---

### 2. Web Search Feature Working

**Steps:**
1. Enable "Include web search" toggle in the chat panel.
2. Ask a current-events question requiring fresh data (e.g., "What is NVIDIA's stock price today?" or "Latest news on Apple").
3. In backend logs, look for `[WEB]` prefix lines indicating search ran.
4. Verify the AI response cites recent information and source snippets.

**Expected:** Search results retrieved and referenced by AI. No errors about missing `ddgs` package.

---

### 3. Invalid Tickers Are Rejected

**Steps:**
- **Via Add Position UI:**
  1. Click "+ Add Stock"
  2. Enter `APPL` (typo of AAPL) — the correct ticker is AAPL.
  3. Submit.
  4. Verify a red toast notification appears: "Invalid ticker symbol: APPL is not a valid stock ticker."
  5. Confirm APPL did NOT appear in the holdings table.

- **Via Excel Upload:**
  1. Create an Excel file with an invalid ticker (e.g., `ZZZZZ`).
  2. Upload via the UI.
  3. Verify error toast appears; portfolio remains unchanged.

**Expected:** Invalid tickers rejected at 400 with clear error. No crash. Portfolio totals unaffected.

---

### 4. Invalid Tickers Don't Crash Portfolio Metrics

**Steps:**
1. Manually insert a position with an invalid ticker directly into MongoDB (or via a past buggy upload):
   ```json
   { "ticker": "BADTICKER", "shares": 10, "average_cost": 100 }
   ```
2. Refresh the dashboard.
3. Observe the backend logs for any `NaN` or traceback.
4. Verify the position renders (using `average_cost` as price since market data unavailable).
5. Verify portfolio totals (total balance, invested value) are finite numbers (not NaN or Infinity).

**Expected:** Dashboard loads successfully. No errors in console or network tab. NaN does not propagate to totals.

---

### 5. Holdings Table Sorting (Highest Growth First)

**Steps:**
1. Load a portfolio with mixed performers (e.g., AAPL up 5%, TSLA down 3%, cash 0%).
2. Verify the holdings table rows are sorted by `daily_change` descending.
3. The "Highest Growth" card value should correspond to the top row's ticker.

**Expected:** Top performer appears first in table; "Highest Growth" metric matches top row ticker.

---

### 6. Edit/Delete Button Styling

**Steps:**
1. Hover over any position row in the holdings table.
2. Verify the Edit (pencil icon, blue border) and Delete (trash icon, red border) buttons are visible.
3. Click Edit — modal opens with pre-filled values.
4. Click Delete — confirmation modal appears.
5. Verify both buttons have a subtle lift effect on hover.

**Expected:** Buttons styled with SVG icons, colored borders, and hover animations.

---

## ✅ Core Features Verification

### 7. Portfolio List & Switch

**Steps:**
1. Create 2 portfolios via Excel upload (e.g., "IRA" and "Trading").
2. Open portfolio dropdown — verify both names appear.
3. Switch between them — holdings and metrics update accordingly.

**Expected:** Dropdown shows all portfolios; switching updates view without page reload.

---

### 8. Add/Edit/Delete Positions

**Steps:**
1. Add a new position (e.g., "NVDA", 10 shares, $500 avg cost).
2. Verify table updates immediately with correct market value and P&L.
3. Edit the NVDA row — change shares to 20, save.
4. Verify position reflects new shares and recalculated P&L.
5. Delete a different position (e.g., AMD).
6. Verify row disappears and totals refresh.

**Expected:** All CRUD operations work; totals stay consistent.

---

### 9. Cash Deposit/Withdraw

**Steps:**
1. Click "Deposit Cash" — enter $1000.
2. Verify cash balance increases by $1000.
3. Click "Withdraw Cash" — enter $500.
4. Verify cash balance decreases by $500.
5. Try withdrawing more than available — expect error toast.

**Expected:** Deposit/withdraw succeed or fail appropriately. CASH position updates.

---

### 10. Excel Upload

**Steps:**
1. Download the template (if available) or create a new Excel file.
2. Fill with valid data:
   - Portfolio Name: `TEST_UPLOAD`
   - Cash: $10000
   - 3 stock rows (ticker, shares, avg cost)
3. Upload via UI.
4. Verify new portfolio appears in dropdown.
5. Open it — verify all holdings and cash match the spreadsheet.

**Expected:** Upload successful; portfolio data matches exactly.

---

## ✅ Performance & Stability

### 11. No 502 Errors on AI Chat (with portfolio)

**Steps:**
1. With LM Studio running, ask a portfolio question requiring longer analysis.
2. Wait for response — should complete within ~1–2 minutes (model dependent).
3. Verify no 502 error appears.

**Expected:** Long-running AI requests complete successfully.

---

### 12. No Unicode/Encoding Errors on Windows

**Steps:**
1. Run backend with `python app.py` in PowerShell/Command Prompt.
2. Perform portfolio operations.
3. Observe console output — no `UnicodeEncodeError` or `charmap codec` errors.

**Expected:** Clean logs, no encoding crashes.

---

## ✅ Smoke Test Pass

**Steps:**

```bash
python run_tests.py
```

**Expected:**
- All 10 smoke tests pass.
- No failures or errors.

---

## ✅ Quick curl Validation

```bash
# Health check
curl http://localhost:8000/status | jq

# List portfolios (empty initially)
curl http://localhost:8000/api/portfolios/list | jq

# Create portfolio with sample Excel (requires a file)
curl -X POST http://localhost:8000/api/portfolios/upload \
  -F "file=@/path/to/sample.xlsx" -v

# Deposit cash
curl -X POST http://localhost:8000/api/portfolios/TEST/cash/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": 5000}'
```

All should return appropriate status codes (200/201) and JSON bodies.

---

## Sign-off

| Check | Verified By | Date |
|-------|-------------|------|
| AI chat portfolio context fix | | |
| Web search fix | | |
| Invalid ticker rejection | | |
| Invalid ticker crash prevention | | |
| Holdings sorting | | |
| Edit/Delete button design | | |
| Smoke tests pass | | |
| API docs accurate | | |
| Deployment docs accurate | | |
