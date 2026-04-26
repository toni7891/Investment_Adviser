from fastapi import APIRouter, HTTPException, UploadFile, File
from io import BytesIO
import httpx
import json
import time
import pandas as pd
import yfinance as yf
import re

# Import the db instance verified in database.py
try:
    from .database import db
except ImportError:
    from database import db

try:
    from .search import web_search_cached
except ImportError:
    try:
        from search import web_search_cached
    except ImportError as e:
        # ddgs dependency missing — provide stub that logs error
        print(f"[ERROR] Failed to import search module: {e}")
        print("[ERROR] Install with: pip install ddgs>=9.14.0")
        def web_search_cached(query: str, max_results: int = 5) -> str:
            print(f"[WARN] Web search called but ddgs not installed")
            return ""

router = APIRouter()

def _clean_text(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text

def _last_non_empty_value(row):
    values = [_clean_text(value) for value in row.tolist()]
    values = [value for value in values if value != ""]
    return values[-1] if values else ""

def _normalize_header(value):
    text = _clean_text(value).lower()
    return (
        text.replace("-", "_")
        .replace(" ", "_")
        .replace("/", "_")
        .replace(".", "_")
        .strip("_")
    )

def _to_float(value, default=0.0):
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)) or str(value).strip() == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default

def _safe_collection_name(portfolio_name: str) -> str:
    cleaned = "".join(ch if ch not in {".", "$", "\x00"} else "_" for ch in portfolio_name).strip()
    return cleaned or "portfolio"

# Keywords/phrases that suggest a web search is helpful
SEARCH_TRIGGERS = [
    r'\b(current|latest|recent|today|now|this week|this month|202[4-6])\b',
    r'\b(news|update|announcement|report)\b',
    r'\b(price of \w+|stock \w+|market \w+|crypto \w+)\b',
    r'\b(weather|forecast)\b',
    r'\b(who is|what is|where is|how is|when is)\b',
    r'\b(earnings|quarterly|revenue|dividend|split|ipo)\b',
    r'\b(latest|analyst|forecast|search|web|internet)\b',
]

def should_trigger_search(message: str, threshold: int = 1) -> bool:
    """
    Heuristic: return True if message likely needs web search.
    Simple OR-matching across trigger patterns (case-insensitive).
    """
    msg_lower = message.lower()
    matches = sum(1 for pattern in SEARCH_TRIGGERS if re.search(pattern, msg_lower))
    return matches >= threshold

def _format_portfolio_summary(portfolio_id: str, positions: list) -> str:
    """Create a concise text summary of a portfolio for AI context."""
    cash_val = 0.0
    holdings = []

    for pos in positions:
        ticker = pos.get("ticker", "")
        shares = float(pos.get("shares", 0))
        avg_cost = float(pos.get("average_cost", pos.get("avg_cost", 0)))

        if ticker == "CASH":
            cash_val = shares
        else:
            holdings.append(f"{ticker}: {shares:.0f} shares @ ${avg_cost:.2f}")

    # Build summary string
    summary = f"Portfolio '{portfolio_id}':\n"
    summary += f"- Cash: ${cash_val:,.2f}\n"
    summary += f"- Holdings ({len(holdings)} positions):\n"

    if holdings:
        for h in holdings:  # Show ALL positions (no limit)
            summary += f"  - {h}\n"
    else:
        summary += "  (no stock holdings)\n"

    return summary

def _parse_portfolio_upload(upload_bytes: bytes):
    df = pd.read_excel(BytesIO(upload_bytes), header=None)

    if df.empty:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    portfolio_name = _last_non_empty_value(df.iloc[0]) or "portfolio"
    cash_value = _to_float(_last_non_empty_value(df.iloc[2]), default=0.0)

    # Row 4 (index 4) is the expected header row
    header_row_index = 4
    stock_table = df.iloc[5:].copy()  # rows 5+ are data
    stock_documents = []

    if not stock_table.empty:
        # Build column index mapping from header row (if present and valid)
        if header_row_index < len(df):
            header_values = df.iloc[header_row_index].tolist()
            normalized_header = [_normalize_header(v) for v in header_values]

            # Check if header row contains recognizable column names using substring matching
            def header_contains(keywords: set) -> bool:
                return any(
                    any(kw in col_name for kw in keywords)
                    for col_name in normalized_header
                )

            has_ticker_col = header_contains({"ticker", "symbol", "stock"})
            has_shares_col = header_contains({"share", "qty", "quantity", "count"})
            has_cost_col = header_contains({"cost", "avg", "average", "price"})

            # Require ticker plus at least one numeric column to treat as a valid header
            has_valid_header = has_ticker_col and (has_shares_col or has_cost_col)

            if has_valid_header:
                # Use header row as column names
                stock_table.columns = normalized_header
                # Drop any completely empty columns
                stock_table = stock_table.dropna(axis=1, how='all')
                # Rows already start at iloc[5]; header consumed as column names
            else:
                # No useful header — use positional column names
                stock_table.columns = [f"col_{i}" for i in range(stock_table.shape[1])]
        else:
            # Header row out of bounds — fallback to positional
            stock_table.columns = [f"col_{i}" for i in range(stock_table.shape[1])]

        # Normalize all column names to lowercase strings
        stock_table.columns = [str(c).lower() for c in stock_table.columns]

        # Build normalized column index mapping (if header provided)
        header_map = {}
        if has_valid_header:
            for col in stock_table.columns:
                if "ticker" in col or "symbol" in col or "stock" in col:
                    header_map["ticker"] = col
                if "share" in col:
                    header_map["shares"] = col
                if "cost" in col or "avg" in col or "price" in col:
                    header_map["average_cost"] = col

        for _, row in stock_table.iterrows():
            row_values = [_clean_text(v) for v in row.tolist()]
            if all(v == "" for v in row_values):
                continue

            if has_valid_header and header_map:
                ticker = _clean_text(
                    row.get(header_map.get("ticker", "ticker")) if "ticker" in header_map else ""
                )
                shares = _to_float(
                    row.get(header_map.get("shares", "shares"), 0), default=0.0
                )
                average_cost = _to_float(
                    row.get(header_map.get("average_cost", "average_cost"), 0), default=0.0
                )
            else:
                # Positional fallback — first 3 columns
                vals = row_values[:3]
                ticker = vals[0] if len(vals) > 0 else ""
                shares = _to_float(vals[1] if len(vals) > 1 else 0, default=0.0)
                average_cost = _to_float(vals[2] if len(vals) > 2 else 0, default=0.0)

            if not ticker:
                continue

            ticker_upper = ticker.upper()
            if ticker_upper in {"TICKER", "SYMBOL", "TICKER_SYMBOL"}:
                continue

            stock_documents.append(
                {
                    "portfolio_name": portfolio_name,
                    "ticker": ticker_upper,
                    "shares": shares,
                    "average_cost": average_cost,
                }
            )

    return portfolio_name, cash_value, stock_documents

# AI Chat Configuration - supports both LM Studio and Ollama
import os

LLM_BACKEND = os.getenv("LLM_BACKEND", "lmstudio").lower()
LM_STUDIO_API_URL = os.getenv("LM_STUDIO_API_URL", "http://localhost:1234/v1/chat/completions")
OLLAMA_API_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434/v1/chat/completions")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

# Determine active API URL and model based on backend
if LLM_BACKEND == "ollama":
    AI_API_URL = OLLAMA_API_URL
    AI_MODEL = OLLAMA_MODEL
    AI_BACKEND_NAME = "Ollama"
else:
    AI_API_URL = LM_STUDIO_API_URL
    AI_MODEL = "*"
    AI_BACKEND_NAME = "LM Studio"

AI_SYSTEM_PROMPT = """You are a helpful financial assistant with access to the user's portfolio data and/or web search results when provided.

When portfolio context is included:
- Analyze their holdings, allocations, and performance
- Provide specific insights (e.g., diversification, concentration risk, P&L)
- Suggest actionable improvements (rebalancing, profit-taking, tax considerations)
- Answer questions about specific tickers, costs, or potential

When web search results are included:
- You MUST use the provided search results to give current (from April 2026 or later), factual information
- DO NOT rely on your training data for time-sensitive information
- Cite sources explicitly (e.g., "According to CNBC on April 24, 2026...") when referencing web data
- If results are from different dates, prioritize the most recent
- If results conflict, present multiple viewpoints and note the discrepancy
- Acknowledge if information may be time-sensitive or unverified

When both are included:
- Blend portfolio analysis with current market context from web results
- Distinguish clearly between personal portfolio facts and general market information
- Provide recommendations grounded in both the user's specific holdings and current conditions

When no context is available:
- Provide general investment education
- Explain financial concepts
- Offer hypothetical examples

Keep responses concise, informative, and focused on the user's specific question."""

async def call_ai_backend(user_message: str) -> dict:
    try:
        print(f"[DEBUG] Calling AI backend at {AI_API_URL}")
        # Increased to 300s (5 minutes) for slow reasoning models
        async with httpx.AsyncClient(timeout=300.0, verify=False) as client:
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            
            # Build payload compatible with both LM Studio and Ollama
            # LM Studio accepts "*" for auto model selection; Ollama requires a specific model name
            payload = {
                "model": AI_MODEL,
                "messages": [
                    {"role": "system", "content": AI_SYSTEM_PROMPT},
                    {"role": "user", "content": user_message}
                ],
                "max_tokens": 4096,  # Increased for detailed analysis (was 1024)
                "stream": False,  # Explicitly disable streaming — we want complete response
            }
            
            print(f"[DEBUG] Sending payload: model={AI_MODEL}, message_len={len(user_message)}")
            
            response = await client.post(
                AI_API_URL,
                headers=headers,
                json=payload
            )
            
            print(f"[DEBUG] Response status: {response.status_code}")
            print(f"[DEBUG] Response headers: {dict(response.headers)}")
            print(f"[DEBUG] Response text (first 500 chars): {response.text[:500]}")
            
            if response.status_code != 200:
                error_text = response.text[:500] if response.text else "Unknown error"
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"{AI_BACKEND_NAME} API error: {error_text}"
                )
            
            try:
                result = response.json()
                print(f"[DEBUG] Successfully parsed JSON, keys: {list(result.keys())}")
                return result
            except Exception as e:
                print(f"[DEBUG] JSON parse failed: {e}")
                raise HTTPException(status_code=502, detail=f"Invalid JSON from {AI_BACKEND_NAME}: {response.text[:200]}")
            
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Failed to connect to {AI_BACKEND_NAME} at {AI_API_URL}: {str(e)}")

@router.get("/portfolios")
@router.get("/portfolios/")
async def get_default_portfolio():
    return await get_portfolio("4RCH3R")

@router.get("/portfolios/list")
async def list_portfolio_names():
    if db is None:
        return {"portfolios": [], "warning": "Database disconnected"}
    collections = db.list_collection_names()
    return {"portfolios": [c for c in collections if not c.startswith("system.")]}

@router.post("/portfolios/upload")
async def upload_portfolio(file: UploadFile = File(...)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable — cannot upload portfolio")
    try:
        upload_bytes = await file.read()
        portfolio_name, cash_value, stock_documents = _parse_portfolio_upload(upload_bytes)
        collection_name = _safe_collection_name(portfolio_name)
        portfolio_collection = db[collection_name]
        portfolio_collection.drop()

        # Validate all stock tickers before inserting
        if stock_documents:
            tickers_to_validate = [doc["ticker"] for doc in stock_documents]
            print(f"[UPLOAD] Validating tickers: {tickers_to_validate}")

            # Batch validate using yfinance (efficient single call)
            try:
                validation_data = yf.download(tickers_to_validate, period="5d", progress=False)
                valid_tickers = set()

                if isinstance(validation_data.columns, pd.MultiIndex):
                    # MultiIndex: columns are (field, ticker). Extract per-ticker subframe.
                    for ticker in tickers_to_validate:
                        try:
                            ticker_df = validation_data.xs(ticker, axis=1, level=1)
                            if not ticker_df.empty and not pd.isna(ticker_df["Close"].iloc[-1]):
                                valid_tickers.add(ticker)
                        except Exception:
                            pass
                else:
                    # Single-ticker case
                    if not validation_data.empty and not pd.isna(validation_data["Close"].iloc[-1]):
                        valid_tickers.add(tickers_to_validate[0])

                # Filter out invalid tickers
                invalid_tickers = [doc for doc in stock_documents if doc["ticker"] not in valid_tickers]
                stock_documents = [doc for doc in stock_documents if doc["ticker"] in valid_tickers]

                if invalid_tickers:
                    invalid_names = [doc["ticker"] for doc in invalid_tickers]
                    print(f"[UPLOAD] Warning: Skipped invalid tickers: {invalid_names}")

            except Exception as e:
                print(f"[UPLOAD] Ticker validation failed: {e}")
                # Proceed anyway — individual ticker validation will catch at add_position time

        documents_to_insert = [
            {
                "portfolio_name": portfolio_name,
                "ticker": "CASH",
                "shares": cash_value,
                "average_cost": 1.0,
            }
        ]
        documents_to_insert.extend(stock_documents)

        if documents_to_insert:
            portfolio_collection.insert_many(documents_to_insert)

        return {
            "message": "Portfolio uploaded successfully",
            "portfolio_name": portfolio_name,
            "collection_name": collection_name,
            "inserted_count": len(documents_to_insert),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to upload: {exc}")

@router.get("/portfolios/{portfolio_id}")
async def get_portfolio(portfolio_id: str):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")

    collection_name = _safe_collection_name(portfolio_id)
    if collection_name not in db.list_collection_names():
        raise HTTPException(status_code=404, detail=f"Portfolio '{portfolio_id}' not found")

    try:
        positions_col = db[collection_name]
        user_positions = list(positions_col.find({}, {"_id": 0}))

        invested_val = 0
        cash_val = 0
        total_cost_basis = 0
        total_previous_close_value = 0
        holdings_list = []

        tickers = []
        ticker_to_pos = {}
        for pos in user_positions:
            t = pos.get("ticker")
            if t == "CASH":
                cash_val += float(pos.get("shares", 0))
            elif t:
                tickers.append(t)
                ticker_to_pos[t] = pos

        market_data = {}
        if tickers:
            try:
                data = yf.download(tickers, period="2d", group_by="ticker", progress=False)
                for t in tickers:
                    try:
                        ticker_df = data if len(tickers) == 1 else data[t]
                        if not ticker_df.empty and len(ticker_df) >= 1:
                            curr = ticker_df["Close"].iloc[-1]
                            prev = ticker_df["Close"].iloc[-2] if len(ticker_df) > 1 else curr

                            # Check for NaN (delisted or no data)
                            if pd.isna(curr) or pd.isna(prev):
                                print(f"[WARN] Price data missing for {t} (delisted or no trades), using avg_cost")
                                market_data[t] = {"current": None, "previous": None}
                            else:
                                market_data[t] = {"current": float(curr), "previous": float(prev)}
                        else:
                            print(f"[WARN] No data rows for {t}")
                            market_data[t] = {"current": None, "previous": None}
                    except KeyError:
                        print(f"[WARN] Ticker {t} not found in downloaded data")
                        market_data[t] = {"current": None, "previous": None}
                    except Exception as e:
                        print(f"[WARN] Error processing {t}: {e}")
                        market_data[t] = {"current": None, "previous": None}
            except Exception as e:
                print(f"[ERROR] Bulk yfinance download failed: {e}")

        for t, pos in ticker_to_pos.items():
            shares = float(pos.get("shares", 0))
            avg_cost = float(pos.get("average_cost", pos.get("avg_cost", 0)))
            m_data = market_data.get(t, {"current": None, "previous": None})

            # Use market price if available and valid, otherwise fall back to avg_cost
            current_price = m_data["current"] if m_data["current"] is not None else avg_cost
            previous_close = m_data["previous"] if m_data["previous"] is not None else avg_cost

            # Ensure we have valid floats
            current_price = float(current_price) if not pd.isna(current_price) else avg_cost
            previous_close = float(previous_close) if not pd.isna(previous_close) else avg_cost

            market_value = shares * current_price
            cost_basis = shares * avg_cost

            invested_val += market_value
            total_cost_basis += cost_basis
            total_previous_close_value += shares * previous_close

            pos.update({
                "current_price": float(round(current_price, 2)),
                "market_value": float(round(market_value, 2)),
                "pl": float(round(market_value - cost_basis, 2)),
                "daily_change": float(round(((current_price - previous_close) / previous_close * 100), 2)) if previous_close > 0 else 0.0,
                "average_cost": float(avg_cost)
            })
            holdings_list.append(pos)

        combined_current = invested_val + cash_val
        total_profit = combined_current - (total_cost_basis + cash_val)
        combined_prev = total_previous_close_value + cash_val
        daily_change_pct = ((combined_current - combined_prev) / combined_prev * 100) if combined_prev > 0 else 0

        return {
            "invested_value": float(round(invested_val, 2)),
            "cash_value": float(round(cash_val, 2)),
            "total_balance": float(round(combined_current, 2)),
            "total_profit": float(round(total_profit, 2)),
            "daily_change_pct": float(round(daily_change_pct, 2)),
            "positions": holdings_list,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# Portfolio Management
# ============================================

@router.delete("/portfolios/{portfolio_id}")
async def delete_portfolio(portfolio_id: str):
    """Delete an entire portfolio collection."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    
    collection_name = _safe_collection_name(portfolio_id)
    if collection_name not in db.list_collection_names():
        raise HTTPException(status_code=404, detail=f"Portfolio '{portfolio_id}' not found")
    
    # Drop the entire collection
    db[collection_name].drop()
    
    return {"message": f"Portfolio '{portfolio_id}' deleted successfully"}


# ============================================
# Position Management Endpoints
# ============================================

@router.delete("/portfolios/{portfolio_id}/positions/{ticker}")
async def remove_position(portfolio_id: str, ticker: str):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    
    ticker_upper = ticker.strip().upper()
    if ticker_upper == "CASH":
        raise HTTPException(status_code=400, detail="Cannot delete CASH position")
    
    collection = db[_safe_collection_name(portfolio_id)]
    result = collection.delete_one({"ticker": ticker_upper})
    
    return {
        "message": "Position removed",
        "ticker": ticker_upper,
        "deleted_count": result.deleted_count
    }

# Simple in-memory cache: ticker -> (is_valid, error_msg, timestamp)
_TICKER_CACHE = {}
_TICKER_CACHE_TTL = 3600  # 1 hour

def _validate_ticker(ticker: str) -> tuple[bool, str]:
    """
    Validate that a ticker symbol exists and has recent price data.
    Results are cached for 1 hour to rate-limit yfinance calls.

    Returns:
        (is_valid, error_message)
    """
    import yfinance as yf

    # Check cache first
    now = time.time()
    if ticker in _TICKER_CACHE:
        ts, is_valid, msg = _TICKER_CACHE[ticker]
        if now - ts < _TICKER_CACHE_TTL:
            return is_valid, msg

    # Basic format check: 1-6 uppercase alphanumeric, may include . for mutual funds (BRK.A)
    import re as _re
    if not _re.match(r'^[A-Z0-9]{1,6}(\.[A-Z])?$', ticker):
        result = (False, f"Invalid ticker format: '{ticker}'")
        _TICKER_CACHE[ticker] = (now,) + result
        return result

    try:
        # Quick check: fetch 1 day of history (lightweight)
        ticker_obj = yf.Ticker(ticker)
        hist = ticker_obj.history(period="5d", prepost=False)

        if hist.empty:
            result = (False, f"Ticker '{ticker}' not found or has no trading data")
        else:
            # Check the most recent close is not NaN
            last_close = hist["Close"].iloc[-1]
            if pd.isna(last_close):
                result = (False, f"Ticker '{ticker}' has no valid price data")
            else:
                result = (True, "")

        _TICKER_CACHE[ticker] = (now,) + result
        return result

    except Exception as e:
        result = (False, f"Could not validate ticker '{ticker}': {str(e)}")
        _TICKER_CACHE[ticker] = (now,) + result
        return result


@router.post("/portfolios/{portfolio_id}/positions")
async def add_position(portfolio_id: str, request: dict):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")

    ticker = request.get("ticker", "").strip().upper()
    shares = request.get("shares")
    avg_cost = request.get("average_cost")

    if not ticker or ticker == "CASH":
        raise HTTPException(status_code=400, detail="Invalid ticker")
    if shares is None or shares <= 0:
        raise HTTPException(status_code=400, detail="Shares must be a positive number")
    if avg_cost is None or avg_cost < 0:
        raise HTTPException(status_code=400, detail="Average cost required and must be non-negative")

    # Validate ticker exists via yfinance
    is_valid, error_msg = _validate_ticker(ticker)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    collection = db[_safe_collection_name(portfolio_id)]
    
    # Upsert: replace or insert
    collection.update_one(
        {"ticker": ticker},
        {"$set": {
            "ticker": ticker,
            "shares": float(shares),
            "average_cost": float(avg_cost),
        }},
        upsert=True
    )
    
    return {
        "ticker": ticker,
        "shares": shares,
        "average_cost": avg_cost,
        "message": "Position added/updated"
    }

# ============================================
# Cash Management Endpoints
# ============================================

@router.post("/portfolios/{portfolio_id}/cash/deposit")
async def deposit_cash(portfolio_id: str, request: dict):
    """Add cash to the portfolio's CASH position."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    
    amount = request.get("amount")
    if amount is None:
        raise HTTPException(status_code=400, detail="Amount is required")
    try:
        amount_val = float(amount)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Amount must be a number")
    
    if amount_val <= 0:
        raise HTTPException(status_code=400, detail="Amount must be a positive number")
    
    collection = db[_safe_collection_name(portfolio_id)]
    
    # Atomic increment to avoid race conditions
    # Use $inc to safely add cash even if document doesn't exist yet (upsert)
    result = collection.update_one(
        {"ticker": "CASH"},
        {"$inc": {"shares": amount_val}, "$set": {"ticker": "CASH", "average_cost": 1.0}},
        upsert=True
    )
    
    # Fetch the new cash value
    cash_doc = collection.find_one({"ticker": "CASH"})
    new_cash = float(cash_doc.get("shares", 0)) if cash_doc else amount_val
    
    return {"message": "Cash deposited", "portfolio_id": portfolio_id, "new_cash": new_cash, "amount": amount_val}


@router.post("/portfolios/{portfolio_id}/cash/withdraw")
async def withdraw_cash(portfolio_id: str, request: dict):
    """Remove cash from the portfolio's CASH position."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    
    amount = request.get("amount")
    if amount is None:
        raise HTTPException(status_code=400, detail="Amount is required")
    try:
        amount_val = float(amount)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Amount must be a number")
    
    if amount_val <= 0:
        raise HTTPException(status_code=400, detail="Amount must be a positive number")
    
    collection = db[_safe_collection_name(portfolio_id)]
    
    # Check current cash balance first
    cash_doc = collection.find_one({"ticker": "CASH"})
    if not cash_doc:
        raise HTTPException(status_code=404, detail="No CASH position found — deposit first")
    
    current_cash = float(cash_doc.get("shares", 0))
    if current_cash < amount_val:
        raise HTTPException(status_code=400, detail=f"Insufficient cash. Available: ${current_cash:,.2f}")
    
    # Atomic decrement
    result = collection.update_one(
        {"ticker": "CASH"},
        {"$inc": {"shares": -amount_val}}
    )
    
    # Fetch updated cash
    updated_doc = collection.find_one({"ticker": "CASH"})
    new_cash = float(updated_doc.get("shares", 0)) if updated_doc else 0
    
    return {"message": "Cash withdrawn", "portfolio_id": portfolio_id, "new_cash": new_cash, "amount": amount_val}


# ============================================
# AI Chat Endpoint
# ============================================
@router.post("/chat")
async def ai_chat(request: dict):
    """
    AI Chat endpoint — connects to LM Studio with optional portfolio context and web search.

    Expected payload:
    {
        "message": "Your question here",
        "portfolio_id": "portfolio_name",  # optional
        "use_web_search": true             # optional, defaults to true
    }
    """
    start_time = time.time()
    print(f"[CHAT] Received request at {time.strftime('%H:%M:%S')}")
    print(f"[CHAT] Request keys: {list(request.keys()) if isinstance(request, dict) else type(request)}")
    try:
        user_message = request.get("message", "").strip()
        portfolio_id = request.get("portfolio_id", "").strip()
        use_web_search = request.get("use_web_search", True)
        print(f"[CHAT] message_len={len(user_message)}, portfolio_id='{portfolio_id}', use_web_search={use_web_search}")

        if not user_message:
            raise HTTPException(status_code=400, detail="Message is required")

        # --- Fetch portfolio context if portfolio_id provided ---
        portfolio_context = ""
        if portfolio_id:
            if db is None:
                portfolio_context = "(Note: Portfolio data unavailable — database disconnected)"
            else:
                try:
                    positions_col = db[_safe_collection_name(portfolio_id)]
                    user_positions = list(positions_col.find({}, {"_id": 0}))
                    if user_positions:
                        portfolio_context = _format_portfolio_summary(portfolio_id, user_positions)
                except Exception as e:
                    print(f"Warning: Could not fetch portfolio '{portfolio_id}': {e}")
                    portfolio_context = f"(Note: Portfolio '{portfolio_id}' data could not be loaded)"

        # --- Fetch web search results if enabled ---
        web_search_results = ""
        web_search_used = False
        print(f"[WEB] use_web_search={use_web_search}, message='{user_message[:50]}...'")
        if use_web_search:
            try:
                print(f"[WEB] Performing web search (user enabled)...")
                web_search_results = web_search_cached(user_message, max_results=5)
                web_search_used = bool(web_search_results)
                print(f"[WEB] Results length: {len(web_search_results)} chars")
                if web_search_results:
                    print(f"[WEB] Preview: {web_search_results[:150]}...")
                else:
                    print(f"[WEB] No results found")
            except Exception as e:
                print(f"[WEB] Error during search: {e}")
                import traceback
                traceback.print_exc()
        else:
            print(f"[WEB] Web search disabled by user (toggle unchecked)")

        # --- Build final prompt with both portfolio + web context ---
        context_parts = []
        if portfolio_context:
            context_parts.append(portfolio_context)
        if web_search_results:
            context_parts.append(f"Web Search Results:\n{web_search_results}")

        if context_parts:
            enhanced_prompt = "\n\n".join(context_parts) + f"\n\nUser question: {user_message}"
        else:
            enhanced_prompt = user_message

        print(f"Sending to {AI_BACKEND_NAME} (context length: {len(enhanced_prompt)} chars)...")

        # Call the selected AI backend (LM Studio or Ollama)
        print(f"[CHAT] Calling AI backend...")
        result = await call_ai_backend(enhanced_prompt)
        print(f"[CHAT] AI backend returned. Result type: {type(result)}")

        # DEBUG: Full response inspection
        print(f"[DEBUG] Raw result type: {type(result)}")
        if isinstance(result, dict):
            print(f"[DEBUG] Result keys: {list(result.keys())}")
            choices = result.get("choices")
            print(f"[DEBUG] choices type: {type(choices)}, value: {choices}")
            if choices and isinstance(choices, list) and len(choices) > 0:
                print(f"[DEBUG] First choice: type={type(choices[0])}, keys={list(choices[0].keys()) if isinstance(choices[0], dict) else 'N/A'}")
        else:
            print(f"[DEBUG] Raw result (first 500): {str(result)[:500]}")
            raise HTTPException(status_code=502, detail=f"Non-dict response from {AI_BACKEND_NAME}")

        # Validate response structure — OpenAI chat completion format
        choices = result.get("choices")
        if not choices or not isinstance(choices, list) or len(choices) == 0:
            print(f"[DEBUG] VALIDATION FAILED: choices invalid. Got: {choices}")
            raise HTTPException(status_code=502, detail=f"Empty or missing 'choices' in response from {AI_BACKEND_NAME}")
        
        first_choice = choices[0]
        if not isinstance(first_choice, dict):
            raise HTTPException(status_code=502, detail=f"Invalid choice format from {AI_BACKEND_NAME}: expected dict, got {type(first_choice)}")
        
        # Get message object — OpenAI chat completions use 'message', completions use 'text'
        message_obj = first_choice.get("message") or first_choice
        if not isinstance(message_obj, dict):
            # Legacy 'text' field in choice directly
            ai_response = first_choice.get("text", "")
        else:
            ai_response = message_obj.get("content", "")
        
        if not ai_response or not isinstance(ai_response, str):
            raise HTTPException(status_code=502, detail=f"No valid text content in response from {AI_BACKEND_NAME}")
        
        # DEBUG — show what we're returning
        print(f"[DEBUG] About to return: response_len={len(ai_response)}, portfolio_context_included={bool(portfolio_context)}, web_search_used={web_search_used}")
        
        return_dict = {
            "response": ai_response,
            "model": result.get("model", "unknown"),
            "backend": AI_BACKEND_NAME,
            "portfolio_context_included": bool(portfolio_context),
            "web_search_used": web_search_used,
        }
        print(f"[DEBUG] Returning dict keys: {list(return_dict.keys())}")
        elapsed = time.time() - start_time
        print(f"[CHAT] Completed in {elapsed:.2f}s")
        return return_dict

    except HTTPException:
        raise
    except Exception as e:
        print(f"Chat endpoint error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chat processing error: {str(e)}")