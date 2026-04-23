from database import get_collection


def getby_name(name: str):
    collection = get_collection("portfolios")
    portfolio = collection.find_one({"name": name}, {"_id": 0})
    return portfolio


def add_stock_to_portfolio(name: str, ticker: str):
    """Add `ticker` to the named portfolio's `stocks` array.
    Returns the updated portfolio (without `_id`) or None if not found.
    """
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
    collection = get_collection("portfolios")
    if collection.find_one({"name": name}):
        return None
    doc = {"name": name, "stocks": stocks or []}
    collection.insert_one(doc)
    inserted = collection.find_one({"name": name}, {"_id": 0})
    return inserted