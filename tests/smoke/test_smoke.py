"""
Minimal smoke tests for Investment Adviser application.

Purpose: Verify core endpoints are up and basic flows work.
No edge cases — just happy path validation.
Target: ≤ 15 tests total.
"""

import sys
import os

# Add project root to path so 'backend' is importable as top-level package
project_root = os.path.join(os.path.dirname(__file__), '..', '..')
sys.path.insert(0, os.path.abspath(project_root))

from fastapi.testclient import TestClient


def get_test_client():
    """Create a TestClient with database mocked using mongomock."""
    import sys
    import mongomock
    from unittest.mock import MagicMock
    from fastapi.testclient import TestClient

    # Create a fresh in-memory DB for this test
    mock_db = mongomock.MongoClient().investment_app

    # Patch backend.database globals BEFORE any imports that use them
    import backend.database
    backend.database.db = mock_db
    backend.database.client = MagicMock()

    # Now import the app (which will import routes and pick up patched db)
    from backend.main import app

    # Also ensure the routes module (whether top-level 'routes' or 'backend.routes') uses mock_db
    # main.py imports routes after adding backend/ to sys.path, typically as top-level 'routes'
    if 'routes' in sys.modules:
        routes_mod = sys.modules['routes']
        routes_mod.db = mock_db
    # Also patch backend.routes if it exists separately
    try:
        import backend.routes
        backend.routes.db = mock_db
    except ImportError:
        pass

    client = TestClient(app)
    return client, mock_db


def test_status_endpoint():
    """GET /status returns 200 and online status."""
    client, _ = get_test_client()
    response = client.get("/status")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    data = response.json()
    assert data.get("status") == "online", f"Expected status='online', got {data}"


def test_root_serves_frontend():
    """GET / returns index.html."""
    client, _ = get_test_client()
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")


def test_list_portfolios_empty():
    """GET /api/portfolios/list returns empty array when no portfolios."""
    client, mock_db = get_test_client()
    response = client.get("/api/portfolios/list")
    assert response.status_code == 200
    data = response.json()
    assert "portfolios" in data
    assert isinstance(data["portfolios"], list)
    assert len(data["portfolios"]) == 0


def test_get_portfolio_404():
    """GET /api/portfolios/{id} returns 404 for non-existent."""
    client, mock_db = get_test_client()
    response = client.get("/api/portfolios/DOES_NOT_EXIST")
    assert response.status_code == 404


def test_add_position_valid():
    """POST /portfolios/{id}/positions adds a holding with valid ticker."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_TEST"

    # Ensure CASH exists
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 1000.0, "average_cost": 1.0})

    payload = {"ticker": "AAPL", "shares": 5, "average_cost": 170.0}
    response = client.post(f"/api/portfolios/{port_id}/positions", json=payload)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert data["ticker"] == "AAPL"
    assert data["shares"] == 5

    # Verify in DB
    doc = mock_db[port_id].find_one({"ticker": "AAPL"})
    assert doc is not None
    assert doc["shares"] == 5.0


def test_add_position_invalid_ticker_rejected():
    """POST /portfolios/{id}/positions returns 400 for invalid ticker like APPL."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_TEST2"

    # Ensure CASH exists
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 1000.0, "average_cost": 1.0})

    payload = {"ticker": "APPL", "shares": 5, "average_cost": 170.0}
    response = client.post(f"/api/portfolios/{port_id}/positions", json=payload)
    assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"


def test_deposit_cash():
    """POST /portfolios/{id}/cash/deposit increments cash."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_CASH"

    response = client.post(f"/api/portfolios/{port_id}/cash/deposit", json={"amount": 5000.0})
    assert response.status_code == 200
    data = response.json()
    assert data["new_cash"] == 5000.0

    doc = mock_db[port_id].find_one({"ticker": "CASH"})
    assert doc["shares"] == 5000.0


def test_withdraw_cash():
    """POST /portfolios/{id}/cash/withdraw decrements cash."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_WITHDRAW"

    # Setup: deposit initial amount
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 1000.0, "average_cost": 1.0})

    response = client.post(f"/api/portfolios/{port_id}/cash/withdraw", json={"amount": 300.0})
    assert response.status_code == 200
    data = response.json()
    assert data["new_cash"] == 700.0


def test_chat_without_portfolio():
    """POST /api/chat works without portfolio_id."""
    from unittest.mock import patch, AsyncMock, MagicMock

    client, mock_db = get_test_client()

    # Mock AI backend
    with patch('httpx.AsyncClient') as mock_client_class:
        mock_instance = MagicMock()
        async def mock_post(url, json=None, headers=None, timeout=None):
            resp = MagicMock()
            resp.status_code = 200
            resp.headers = {'content-type': 'application/json'}
            resp.json = MagicMock(return_value={
                "choices": [{"message": {"role": "assistant", "content": "Hello"}}]
            })
            return resp
        mock_instance.post = AsyncMock(side_effect=mock_post)
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_instance

        response = client.post("/api/chat", json={"message": "Hello", "use_web_search": False})

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()
    assert "response" in data
    assert data.get("portfolio_context_included") is False


def test_chat_with_portfolio():
    """POST /api/chat with portfolio_id includes context."""
    from unittest.mock import patch, AsyncMock, MagicMock

    client, mock_db = get_test_client()
    port_id = "SMOKE_CHAT"

    # Setup portfolio
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 5000.0, "average_cost": 1.0})
    mock_db[port_id].insert_one({"ticker": "AAPL", "shares": 5, "average_cost": 170.0})

    # Mock AI backend
    with patch('httpx.AsyncClient') as mock_client_class:
        mock_instance = MagicMock()
        async def mock_post(url, json=None, headers=None, timeout=None):
            resp = MagicMock()
            resp.status_code = 200
            resp.headers = {'content-type': 'application/json'}
            resp.json = MagicMock(return_value={
                "choices": [{"message": {"role": "assistant", "content": "You own AAPL"}}]
            })
            return resp
        mock_instance.post = AsyncMock(side_effect=mock_post)
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_instance

        response = client.post("/api/chat", json={
            "message": "What do I own?",
            "portfolio_id": port_id,
            "use_web_search": False
        })

    assert response.status_code == 200
    data = response.json()
    assert data.get("portfolio_context_included") is True


def test_get_portfolio_calculates_metrics():
    """GET /api/portfolios/{id} returns complete metrics."""
    import yfinance as yf
    from unittest.mock import patch

    client, mock_db = get_test_client()
    port_id = "METRICS_TEST"

    # Setup portfolio
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 10000.0, "average_cost": 1.0})
    mock_db[port_id].insert_one({"ticker": "AAPL", "shares": 5, "average_cost": 150.0})

    # Mock yfinance to return valid prices
    import pandas as pd
    from datetime import datetime, timedelta

    dates = pd.date_range(start=datetime(2026, 4, 24), periods=2, freq='D')

    def mock_download(tickers, period="2d", group_by="ticker", progress=False, **kwargs):
        if isinstance(tickers, str):
            tickers = [tickers]
        if "AAPL" in tickers:
            df = pd.DataFrame({
                'Open': [150.0, 155.0],
                'High': [153.0, 158.0],
                'Low': [148.0, 152.0],
                'Close': [150.0, 155.0],
                'Volume': [1000000, 1200000]
            }, index=dates)
            return df
        return pd.DataFrame()

    with patch('yfinance.download', side_effect=mock_download):
        response = client.get(f"/api/portfolios/{port_id}")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()

    # Verify required fields
    assert "invested_value" in data
    assert "cash_value" in data
    assert "total_balance" in data
    assert "total_profit" in data
    assert "daily_change_pct" in data
    assert "positions" in data
    assert isinstance(data["positions"], list)


# ---------------------------------------------------------------------------
# Ticker tape tests
# ---------------------------------------------------------------------------

def _tape_mock_df(tickers, dates):
    """
    Build a MultiIndex DataFrame matching yfinance group_by='ticker' output.
    Columns are (ticker, field) so that df[ticker] returns OHLCV sub-frame.
    """
    import pandas as pd
    fields = ["Open", "High", "Low", "Close", "Volume"]
    col_tuples = [(t, f) for t in tickers for f in fields]
    cols = pd.MultiIndex.from_tuples(col_tuples)
    rows = []
    for i in range(len(dates)):
        row = []
        for t_idx, _ in enumerate(tickers):
            for f in fields:
                row.append(100.0 + t_idx * 2 + i if f == "Close" else 0.0)
        rows.append(row)
    return pd.DataFrame(rows, index=dates, columns=cols)


def _reset_tape_cache():
    """Clear the module-level tape cache so tests start fresh."""
    # The app adds backend/ to sys.path so routes is loaded as top-level 'routes'
    # *and* as 'backend.routes' — patch whichever is present.
    import sys
    for mod_name in ("routes", "backend.routes"):
        mod = sys.modules.get(mod_name)
        if mod and hasattr(mod, "_TAPE_CACHE"):
            mod._TAPE_CACHE["data"] = None
            mod._TAPE_CACHE["ts"]   = 0


def test_ticker_tape_returns_correct_shape():
    """GET /api/market/ticker-tape returns items list with required fields."""
    import pandas as pd
    from datetime import datetime, timedelta
    from unittest.mock import patch

    client, _ = get_test_client()
    _reset_tape_cache()

    dates = pd.DatetimeIndex([
        datetime.today() - timedelta(days=1),
        datetime.today(),
    ])

    def mock_download(tickers, **kwargs):
        if isinstance(tickers, str):
            tickers = [tickers]
        return _tape_mock_df(tickers, dates)

    with patch("yfinance.download", side_effect=mock_download):
        response = client.get("/api/market/ticker-tape")

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    body = response.json()

    assert "items" in body, "Response must have 'items' key"
    assert "updated_at" in body, "Response must have 'updated_at' key"
    assert isinstance(body["items"], list), "'items' must be a list"
    assert len(body["items"]) > 0, "Tape must contain at least one item"

    required_fields = {"symbol", "display", "price", "change_pct", "direction"}
    for item in body["items"]:
        missing = required_fields - item.keys()
        assert not missing, f"Item missing fields {missing}: {item}"
        assert item["direction"] in ("up", "down", "flat"), \
            f"direction must be up/down/flat, got {item['direction']!r}"
        assert isinstance(item["price"], (int, float)), "price must be numeric"
        assert isinstance(item["change_pct"], (int, float)), "change_pct must be numeric"


def test_ticker_tape_is_cached():
    """Second call within TTL returns same data without hitting yfinance again."""
    import pandas as pd
    from datetime import datetime, timedelta
    from unittest.mock import patch

    client, _ = get_test_client()
    _reset_tape_cache()

    dates = pd.DatetimeIndex([
        datetime.today() - timedelta(days=1),
        datetime.today(),
    ])

    call_count = {"n": 0}

    def mock_download(tickers, **kwargs):
        call_count["n"] += 1
        if isinstance(tickers, str):
            tickers = [tickers]
        return _tape_mock_df(tickers, dates)

    with patch("yfinance.download", side_effect=mock_download):
        r1 = client.get("/api/market/ticker-tape")
        r2 = client.get("/api/market/ticker-tape")  # should hit cache

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert call_count["n"] == 1, \
        f"yfinance.download called {call_count['n']} times — cache not working"
    assert r1.json()["updated_at"] == r2.json()["updated_at"], \
        "updated_at should be identical on cached response"


# ---------------------------------------------------------------------------
# New endpoint tests (#17)
# ---------------------------------------------------------------------------

def test_withdraw_insufficient_cash():
    """POST /portfolios/{id}/cash/withdraw returns 400 when balance is too low."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_WITHDRAW_INSUFF"
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 100.0, "average_cost": 1.0})

    response = client.post(f"/api/portfolios/{port_id}/cash/withdraw", json={"amount": 500.0})
    assert response.status_code == 400
    assert "Insufficient" in response.json()["detail"]


def test_buy_insufficient_cash():
    """POST /portfolios/{id}/positions returns 400 when not enough cash to buy."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_BUY_INSUFF"
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 10.0, "average_cost": 1.0})
    # 5 shares at $170 = $850 cost, only $10 available
    response = client.post(
        f"/api/portfolios/{port_id}/positions",
        json={"ticker": "AAPL", "shares": 5, "average_cost": 170.0}
    )
    assert response.status_code == 400
    assert "Insufficient cash" in response.json()["detail"]


def test_sell_position_happy_path():
    """POST /portfolios/{id}/positions/{ticker}/sell credits cash and records trade."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_SELL_HAPPY"
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 0.0, "average_cost": 1.0})
    mock_db[port_id].insert_one({"ticker": "AAPL", "shares": 10.0, "average_cost": 150.0})

    response = client.post(
        f"/api/portfolios/{port_id}/positions/AAPL/sell",
        json={"shares": 5, "sell_price": 180.0}
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data = response.json()
    assert data["proceeds"] == 900.0        # 5 × $180
    assert data["remaining_shares"] == 5.0

    # Cash credited
    cash_doc = mock_db[port_id].find_one({"ticker": "CASH"})
    assert cash_doc["shares"] == 900.0

    # Trade record written with correct realized P&L
    trade = mock_db[port_id + "_trades"].find_one({"ticker": "AAPL"})
    assert trade is not None
    assert trade["realized_pnl"] == round((180.0 - 150.0) * 5, 2)  # $150.00


def test_sell_position_insufficient_shares():
    """POST /portfolios/{id}/positions/{ticker}/sell returns 400 for oversell."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_SELL_INSUFF"
    mock_db[port_id].insert_one({"ticker": "AAPL", "shares": 3.0, "average_cost": 150.0})

    response = client.post(
        f"/api/portfolios/{port_id}/positions/AAPL/sell",
        json={"shares": 10, "sell_price": 180.0}
    )
    assert response.status_code == 400
    assert "Cannot sell" in response.json()["detail"]


def test_rename_portfolio():
    """POST /portfolios/{id}/rename renames portfolio and preserves all positions."""
    client, mock_db = get_test_client()
    old_id = "SMOKE_RENAME_OLD"
    new_id = "SMOKE_RENAME_NEW"
    mock_db[old_id].insert_one({"ticker": "CASH", "shares": 500.0, "average_cost": 1.0})
    mock_db[old_id].insert_one({"ticker": "AAPL", "shares": 5.0, "average_cost": 170.0})

    response = client.post(f"/api/portfolios/{old_id}/rename", json={"new_name": new_id})
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    assert response.json()["new_id"] == new_id

    # Data moved to new collection; old collection empty
    assert mock_db[new_id].count_documents({}) == 2
    assert mock_db[old_id].count_documents({}) == 0


def test_rename_portfolio_same_name():
    """POST /portfolios/{id}/rename returns 400 when the name is unchanged."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_RENAME_SAME"
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 100.0, "average_cost": 1.0})

    response = client.post(f"/api/portfolios/{port_id}/rename", json={"new_name": port_id})
    assert response.status_code == 400


def test_rename_portfolio_not_found():
    """POST /portfolios/{id}/rename returns 404 for a missing portfolio."""
    client, mock_db = get_test_client()
    response = client.post(
        "/api/portfolios/DOES_NOT_EXIST_XYZ/rename",
        json={"new_name": "SOMETHING_NEW"}
    )
    assert response.status_code == 404


def test_get_trades_empty():
    """GET /portfolios/{id}/trades returns empty list and zero P&L when no trades exist."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_TRADES_EMPTY"
    response = client.get(f"/api/portfolios/{port_id}/trades")
    assert response.status_code == 200
    data = response.json()
    assert data["trades"] == []
    assert data["total_realized_pnl"] == 0.0


def test_deposit_zero_amount():
    """POST /portfolios/{id}/cash/deposit returns 400 for zero amount."""
    client, _ = get_test_client()
    response = client.post("/api/portfolios/TEST_ZERO_DEP/cash/deposit", json={"amount": 0})
    assert response.status_code == 400


def test_deposit_negative_amount():
    """POST /portfolios/{id}/cash/deposit returns 400 for negative amount."""
    client, _ = get_test_client()
    response = client.post("/api/portfolios/TEST_NEG_DEP/cash/deposit", json={"amount": -100.0})
    assert response.status_code == 400


def test_withdraw_zero_amount():
    """POST /portfolios/{id}/cash/withdraw returns 400 for zero amount."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_WITHDRAW_ZERO"
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 100.0, "average_cost": 1.0})
    response = client.post(f"/api/portfolios/{port_id}/cash/withdraw", json={"amount": 0})
    assert response.status_code == 400


def test_withdraw_all_cash():
    """POST /portfolios/{id}/cash/withdraw can withdraw the full balance, leaving zero."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_WITHDRAW_ALL"
    mock_db[port_id].insert_one({"ticker": "CASH", "shares": 500.0, "average_cost": 1.0})
    response = client.post(f"/api/portfolios/{port_id}/cash/withdraw", json={"amount": 500.0})
    assert response.status_code == 200
    assert response.json()["new_cash"] == 0.0


def test_sell_at_zero_price_rejected():
    """POST /portfolios/{id}/positions/{ticker}/sell returns 400 for $0 sell price."""
    client, mock_db = get_test_client()
    port_id = "SMOKE_SELL_ZERO"
    mock_db[port_id].insert_one({"ticker": "AAPL", "shares": 5.0, "average_cost": 150.0})
    response = client.post(
        f"/api/portfolios/{port_id}/positions/AAPL/sell",
        json={"shares": 5, "sell_price": 0.0},
    )
    assert response.status_code == 400


def test_upload_duplicate_portfolio_rejected():
    """POST /portfolios/upload returns 409 when a portfolio with the same name already exists."""
    import io
    import pandas as pd

    client, mock_db = get_test_client()
    mock_db["DupPortfolio"].insert_one({"ticker": "CASH", "shares": 100.0, "average_cost": 1.0})

    df = pd.DataFrame([["DupPortfolio"], [""], [1000], [""], ["Ticker", "Shares", "Average Cost"]])
    output = io.BytesIO()
    df.to_excel(output, index=False, header=False)
    output.seek(0)

    response = client.post(
        "/api/portfolios/upload",
        files={"file": ("dup.xlsx", output, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_list_portfolios_filters_history_and_trades():
    """GET /api/portfolios/list excludes _history and _trades companion collections."""
    client, mock_db = get_test_client()
    mock_db["FILTER_TEST"].insert_one({"ticker": "CASH", "shares": 100.0})
    mock_db["FILTER_TEST_history"].insert_one({"date": "2026-01-01"})
    mock_db["FILTER_TEST_trades"].insert_one({"ticker": "AAPL"})

    response = client.get("/api/portfolios/list")
    assert response.status_code == 200
    portfolios = response.json()["portfolios"]
    assert "FILTER_TEST" in portfolios
    assert "FILTER_TEST_history" not in portfolios
    assert "FILTER_TEST_trades" not in portfolios
