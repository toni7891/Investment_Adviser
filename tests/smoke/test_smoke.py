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
    """Create a TestClient with database mocked."""
    import mongomock
    from unittest.mock import patch, MagicMock
    from backend.main import app

    mock_db = mongomock.MongoClient().investment_app

    with patch('backend.database.db', mock_db), \
         patch('backend.database.client', MagicMock()):
        # Reload routes to pick up patched db
        import importlib
        import backend.routes as routes_mod
        importlib.reload(routes_mod)

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
