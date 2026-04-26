from fastapi import APIRouter, HTTPException, UploadFile, File
from io import BytesIO
import httpx
import json
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
    from search import web_search_cached

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
    summary += f"• Cash: ${cash_val:,.2f}\n"
    summary += f"• Holdings ({len(holdings)} positions):\n"

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

    stock_table = df.iloc[5:].copy()
    stock_documents = []

    if not stock_table.empty:
        first_row = stock_table.iloc[0].tolist()
        normalized_first_row = [_normalize_header(value) for value in first_row]

        header_candidates = {"ticker", "symbol", "shares", "average_cost", "avg_cost", "averagecost"}
        has_header_row = any(value in header_candidates for value in normalized_first_row)

        if has_header_row:
            stock_table = stock_table.iloc[1:].copy()
            stock_table.columns = normalized_first_row
        else:
            stock_table.columns = [f"col_{index}" for index in range(stock_table.shape[1])]

        for _, row in stock_table.iterrows():
            row_values = [_clean_text(value) for value in row.tolist()]
            row_values = [value for value in row_values if value != ""]
            if not row_values:
                continue

            if has_header_row:
                ticker = _clean_text(
                    row.get("ticker")
                    or row.get("symbol")
                    or row.get("stock")
                    or row.get("col_0")
                )
                shares = _to_float(row.get("shares", row.get("col_1", 0)), default=0.0)
                average_cost = _to_float(
                    row.get("average_cost", row.get("avg_cost", row.get("col_2", 0))),
                    default=0.0,
                )
            else:
                ticker = _clean_text(row.iloc[0] if len(row) > 0 else "")
                shares = _to_float(row.iloc[1] if len(row) > 1 else 0, default=0.0)
                average_cost = _to_float(row.iloc[2] if len(row) > 2 else 0, default=0.0)

            if not ticker:
                continue

            ticker_upper = ticker.upper()
            if ticker_upper in {"TICKER", "SYMBOL"}:
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
- Use the provided search results to give current (from april of 2026 or later), factual information
- Cite sources (e.g., "According to recent reports...") when referencing web data
- Acknowledge if information may be time-sensitive or unverified
- Prioritize recent and authoritative results when multiple sources conflict

When both are included:
- Blend portfolio analysis with current market context from web results
- Distinguish between personal portfolio facts and general market information
- Provide recommendations grounded in both the user's specific holdings and current conditions

When no context is available:
- Provide general investment education
- Explain financial concepts
- Offer hypothetical examples

Keep responses concise, informative, and focused on the user's specific question."""

async def call_ai_backend(user_message: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=60.0, verify=False) as client:
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
                "max_tokens": 1024,
            }
            
            response = await client.post(
                AI_API_URL,
                headers=headers,
                json=payload
            )
            
            if response.status_code != 200:
                error_text = response.text[:500] if response.text else "Unknown error"
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"{AI_BACKEND_NAME} API error: {error_text}"
                )
            
            return response.json()
            
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
    try:
        positions_col = db[portfolio_id]
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
                        if not ticker_df.empty:
                            curr = ticker_df["Close"].iloc[-1]
                            prev = ticker_df["Close"].iloc[-2] if len(ticker_df) > 1 else curr
                            market_data[t] = {"current": curr, "previous": prev}
                    except:
                        pass
            except Exception as e:
                print(f"Bulk download failed: {e}")

        for t, pos in ticker_to_pos.items():
            shares = float(pos.get("shares", 0))
            avg_cost = float(pos.get("average_cost", pos.get("avg_cost", 0)))
            m_data = market_data.get(t, {"current": avg_cost, "previous": avg_cost})
            current_price = m_data["current"]
            previous_close = m_data["previous"]
            market_value = shares * current_price
            cost_basis = shares * avg_cost

            invested_val += market_value
            total_cost_basis += cost_basis
            total_previous_close_value += shares * previous_close

            pos.update({
                "current_price": round(current_price, 2),
                "market_value": round(market_value, 2),
                "pl": round(market_value - cost_basis, 2),
                "daily_change": round(((current_price - previous_close) / previous_close * 100), 2) if previous_close > 0 else 0,
                "average_cost": avg_cost
            })
            holdings_list.append(pos)

        combined_current = invested_val + cash_val
        total_profit = combined_current - (total_cost_basis + cash_val)
        combined_prev = total_previous_close_value + cash_val
        daily_change_pct = ((combined_current - combined_prev) / combined_prev * 100) if combined_prev > 0 else 0

        return {
            "invested_value": round(invested_val, 2),
            "cash_value": round(cash_val, 2),
            "total_balance": round(combined_current, 2),
            "total_profit": round(total_profit, 2),
            "daily_change_pct": round(daily_change_pct, 2),
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
    try:
        user_message = request.get("message", "").strip()
        portfolio_id = request.get("portfolio_id", "").strip()
        use_web_search = request.get("use_web_search", True)  # default True per user pref

        if not user_message:
            raise HTTPException(status_code=400, detail="Message is required")

        # --- Fetch portfolio context if portfolio_id provided ---
        portfolio_context = ""
        if portfolio_id:
            if db is None:
                portfolio_context = "(Note: Portfolio data unavailable — database disconnected)"
            else:
                try:
                    positions_col = db[portfolio_id]
                    user_positions = list(positions_col.find({}, {"_id": 0}))
                    if user_positions:
                        portfolio_context = _format_portfolio_summary(portfolio_id, user_positions)
                except Exception as e:
                    print(f"Warning: Could not fetch portfolio '{portfolio_id}': {e}")
                    portfolio_context = f"(Note: Portfolio '{portfolio_id}' data could not be loaded)"

        # --- Fetch web search results if enabled and triggered ---
        web_search_results = ""
        web_search_used = False
        if use_web_search and should_trigger_search(user_message):
            try:
                web_search_results = web_search_cached(user_message, max_results=5)
                web_search_used = bool(web_search_results)
            except Exception as e:
                print(f"Web search skipped (error): {e}")

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
        result = await call_ai_backend(enhanced_prompt)

        if "choices" not in result or len(result["choices"]) == 0:
            raise HTTPException(status_code=502, detail=f"Invalid response format from {AI_BACKEND_NAME}")

        ai_response = result["choices"][0]["message"]["content"]

        return {
            "response": ai_response,
            "model": result.get("model", "unknown"),
            "backend": AI_BACKEND_NAME,
            "portfolio_context_included": bool(portfolio_context),
            "web_search_used": web_search_used,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Chat endpoint error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chat processing error: {str(e)}")