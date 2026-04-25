from pydantic import BaseModel

class PortfolioSummary(BaseModel):
    invested_value: float
    cash_value: float
    total_balance: float

def getby_name(name: str):
    from backend.database import get_collection
    collection = get_collection("portfolios")
    portfolio = collection.find_one({"name": name}, {"_id": 0})
    return portfolio


def add_stock_to_portfolio(name: str, ticker: str):
    """Add `ticker` to the named portfolio's `stocks` array.
    Returns the updated portfolio (without `_id`) or None if not found.
    """
    from backend.database import get_collection
    collection = get_collection("portfolios")
    result = collection.update_one({"name": name}, {"$addToSet": {"stocks": ticker}})
    if result.matched_count == 0:
        return None
    updated = collection.find_one({"name": name}, {"_id": 0})
    return updated


def create_portfolio(name: str, stocks: list[str] | None = None):
    """Create a portfolio document with given `name` and `stocks` list.
    Returns the inserted document (without `_id`) or None if a portfolio with the same name exists.
    """
    from backend.database import get_collection
    collection = get_collection("portfolios")
    if collection.find_one({"name": name}):
        return None
    doc = {"name": name, "stocks": stocks or []}
    collection.insert_one(doc)
    inserted = collection.find_one({"name": name}, {"_id": 0})
    return inserted


# ============================================
# New Portfolio Structure (Dynamic Collections)
# ============================================

def fetch_portfolio(portfolio_id: str):
    """Fetch all holdings from a portfolio's dedicated collection.
    Each portfolio has its own collection named after the portfolio.
    """
    from backend.database import get_collection
    collection = get_collection(portfolio_id)
    holdings = list(collection.find({}, {"_id": 0}))

    # Ensure all holdings have consistent schema
    corrected_holdings = []
    for holding in holdings:
        # Ensure all required fields exist with default values if missing
        corrected_holding = holding.copy()

        # Ensure required fields exist
        if "ticker" not in corrected_holding:
            corrected_holding["ticker"] = ""
        if "shares" not in corrected_holding:
            corrected_holding["shares"] = 0.0
        if "average_cost" not in corrected_holding:
            corrected_holding["average_cost"] = 0.0
        if "last_updated" not in corrected_holding:
            corrected_holding["last_updated"] = "1970-01-01T00:00:00Z"

        corrected_holdings.append(corrected_holding)

    return corrected_holdings


def add_ticker_to_portfolio(portfolio_id: str, ticker: str, shares: float, average_cost: float):
    """Add a ticker to the portfolio's collection.
    Creates a new document or updates existing one.
    """
    from backend.database import get_collection
    collection = get_collection(portfolio_id)
    
    # Check if ticker already exists
    existing = collection.find_one({"ticker": ticker})
    
    if existing:
        # Update existing position (weighted average)
        total_shares = existing["shares"] + shares
        total_cost = (existing["shares"] * existing["average_cost"]) + (shares * average_cost)
        new_avg_cost = total_cost / total_shares
        
        collection.update_one(
            {"ticker": ticker},
            {
                "$set": {
                    "shares": total_shares,
                    "average_cost": new_avg_cost,
                    "last_updated": "2026-04-24T00:00:00Z"
                }
            }
        )
    else:
        # Insert new ticker
        collection.insert_one({
            "ticker": ticker,
            "shares": shares,
            "average_cost": average_cost,
            "last_updated": "2026-04-24T00:00:00Z"
        })
    
    return collection.find_one({"ticker": ticker}, {"_id": 0})


def remove_ticker_from_portfolio(portfolio_id: str, ticker: str):
    """Remove a ticker from the portfolio's collection."""
    from database import get_collection
    collection = get_collection(portfolio_id)
    result = collection.delete_one({"ticker": ticker})
    return result.deleted_count > 0


def ensure_cash_document(portfolio_id: str, cash_amount: float | None = None):
    """Ensure the portfolio collection contains a `CASH` document.

    If `cash_amount` is provided, set `shares` to that value. If not,
    preserve existing `shares` if present, otherwise set to 0.0.
    Always set `average_cost` to 1.0 and update `last_updated` to now.
    Returns the upserted/updated document (without _id).
    """
    from datetime import datetime

    from database import get_collection
    collection = get_collection(portfolio_id)
    existing = collection.find_one({"ticker": "CASH"})

    now_iso = datetime.utcnow().isoformat() + "Z"

    if existing:
        new_shares = existing.get("shares", 0.0) if cash_amount is None else float(cash_amount)
        collection.update_one(
            {"ticker": "CASH"},
            {
                "$set": {
                    "shares": new_shares,
                    "average_cost": 1.0,
                    "last_updated": now_iso
                }
            }
        )
    else:
        new_shares = 0.0 if cash_amount is None else float(cash_amount)
        collection.insert_one({
            "ticker": "CASH",
            "shares": new_shares,
            "average_cost": 1.0,
            "last_updated": now_iso
        })

    return collection.find_one({"ticker": "CASH"}, {"_id": 0})
    