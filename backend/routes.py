from fastapi import APIRouter, HTTPException, UploadFile, File
from io import BytesIO
import asyncio
import httpx
import logging
import os
import time
from datetime import datetime, date as _date, timedelta
import pandas as pd
import yfinance as yf
import re
from pydantic import BaseModel
try:
    import pytz as _pytz
except ImportError:
    _pytz = None

logger = logging.getLogger(__name__)

try:
    from .database import db, client as _mongo_client
except ImportError:
    from database import db
    try:
        from database import client as _mongo_client
    except ImportError:
        _mongo_client = None

try:
    from .search import web_search_cached, web_search_structured
except ImportError:
    try:
        from search import web_search_cached, web_search_structured
    except ImportError as e:
        logger.error("Failed to import search module: %s", e)
        logger.error("Install with: pip install ddgs>=9.14.0")
        def web_search_cached(query: str, max_results: int = 5) -> str:
            logger.warning("Web search called but ddgs is not installed")
            return ""
        def web_search_structured(query: str, max_results: int = 5) -> list:
            logger.warning("Web search called but ddgs is not installed")
            return []

router = APIRouter()

# ─── Request models (#15) ─────────────────────────────────────────────────────

class PositionRequest(BaseModel):
    ticker: str
    shares: float
    average_cost: float
    action: str = "buy"

class SellRequest(BaseModel):
    shares: float
    sell_price: float

class CashRequest(BaseModel):
    amount: float

class ChatRequest(BaseModel):
    message: str
    portfolio_id: str = ""
    use_web_search: bool = True

class RenameRequest(BaseModel):
    new_name: str

# ─── Transaction helper ────────────────────────────────────────────────────────

def _with_optional_transaction(ops_fn):
    """Run ops_fn(session) inside a MongoDB transaction when available.

    Falls back to ops_fn(None) (no transaction) for standalone instances or
    mongomock (used in tests) that don't support multi-document transactions.
    ops_fn receives the session (or None) and must pass it to every pymongo call.
    Mongomock raises NotImplementedError on the first write; since no writes have
    occurred yet, it's safe to retry without a session.
    """
    if _mongo_client is None:
        ops_fn(None)
        return

    session = None
    try:
        session = _mongo_client.start_session()
        session.start_transaction()
    except Exception as e:
        logger.debug("Transactions not available, proceeding without: %s", e)
        if session:
            try:
                session.end_session()
            except Exception:
                pass
        ops_fn(None)
        return

    session_ended = False
    try:
        ops_fn(session)
        session.commit_transaction()
    except NotImplementedError:
        # mongomock doesn't support session args — raised before any write lands
        try:
            session.abort_transaction()
        except Exception:
            pass
        try:
            session.end_session()
        except Exception:
            pass
        session_ended = True
        logger.debug("Session not supported by this MongoDB instance; retrying without transaction")
        ops_fn(None)
    except Exception:
        try:
            session.abort_transaction()
        except Exception:
            pass
        raise
    finally:
        if not session_ended:
            try:
                session.end_session()
            except Exception:
                pass

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _clean_text(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text

def _last_non_empty_value(row):
    values = [_clean_text(v) for v in row.tolist()]
    values = [v for v in values if v != ""]
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

# ─── Search trigger heuristics ────────────────────────────────────────────────

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
    msg_lower = message.lower()
    matches = sum(1 for pattern in SEARCH_TRIGGERS if re.search(pattern, msg_lower))
    return matches >= threshold

# ─── Portfolio summary for AI context ─────────────────────────────────────────

def _format_portfolio_summary(portfolio_id: str, portfolio_data: dict) -> str:
    """Format a rich portfolio summary with live prices and P&L for AI context."""
    positions     = portfolio_data.get("positions", [])
    cash_val      = portfolio_data.get("cash_value", 0.0)
    total_balance = portfolio_data.get("total_balance", 0.0)
    total_profit  = portfolio_data.get("total_profit", 0.0)
    daily_pct     = portfolio_data.get("daily_change_pct", 0.0)

    profit_sign = "+" if total_profit >= 0 else ""
    daily_sign  = "+" if daily_pct   >= 0 else ""

    summary  = f"Portfolio '{portfolio_id}':\n"
    summary += f"- Total Value:   ${total_balance:,.2f}\n"
    summary += f"- Total P&L:     {profit_sign}${total_profit:,.2f}\n"
    summary += f"- Daily Change:  {daily_sign}{daily_pct:.2f}%\n"
    summary += f"- Cash:          ${cash_val:,.2f}\n"
    summary += f"- Holdings ({len(positions)} positions):\n"

    for pos in positions:
        ticker        = pos.get("ticker", "")
        shares        = float(pos.get("shares", 0))
        avg_cost      = float(pos.get("average_cost", pos.get("avg_cost", 0)))
        current_price = float(pos.get("current_price", avg_cost))
        market_value  = float(pos.get("market_value", shares * current_price))
        pl            = float(pos.get("pl", 0.0))
        daily_chg     = float(pos.get("daily_change", 0.0))
        pl_sign   = "+" if pl       >= 0 else ""
        d_sign    = "+" if daily_chg >= 0 else ""
        summary += (
            f"  - {ticker}: {shares:.4g} sh @ avg ${avg_cost:.2f}"
            f", now ${current_price:.2f}, MV ${market_value:,.2f}"
            f", P&L {pl_sign}${pl:,.2f}, daily {d_sign}{daily_chg:.2f}%\n"
        )

    if not positions:
        summary += "  (no stock holdings)\n"
    return summary

# ─── Excel upload parser ───────────────────────────────────────────────────────

def _parse_portfolio_upload(upload_bytes: bytes):
    df = pd.read_excel(BytesIO(upload_bytes), header=None)
    if df.empty:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    portfolio_name = _last_non_empty_value(df.iloc[0]) or "portfolio"
    if len(portfolio_name) > 60:
        raise HTTPException(status_code=400, detail="Portfolio name too long (max 60 characters)")
    cash_value     = _to_float(_last_non_empty_value(df.iloc[2]), default=0.0)

    header_row_index = 4
    stock_table      = df.iloc[5:].copy()
    stock_documents  = []
    has_valid_header = False

    if not stock_table.empty:
        if header_row_index < len(df):
            header_values     = df.iloc[header_row_index].tolist()
            normalized_header = [_normalize_header(v) for v in header_values]

            def header_contains(keywords: set) -> bool:
                return any(
                    any(kw in col_name for kw in keywords)
                    for col_name in normalized_header
                )

            has_ticker_col  = header_contains({"ticker", "symbol", "stock"})
            has_shares_col  = header_contains({"share", "qty", "quantity", "count"})
            has_cost_col    = header_contains({"cost", "avg", "average", "price"})
            has_valid_header = has_ticker_col and (has_shares_col or has_cost_col)

            if has_valid_header:
                stock_table.columns = normalized_header
                stock_table = stock_table.dropna(axis=1, how="all")
            else:
                stock_table.columns = [f"col_{i}" for i in range(stock_table.shape[1])]
        else:
            stock_table.columns = [f"col_{i}" for i in range(stock_table.shape[1])]

        stock_table.columns = [str(c).lower() for c in stock_table.columns]

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
                ticker       = _clean_text(row.get(header_map.get("ticker", "ticker")) if "ticker" in header_map else "")
                shares       = _to_float(row.get(header_map.get("shares", "shares"), 0), default=0.0)
                average_cost = _to_float(row.get(header_map.get("average_cost", "average_cost"), 0), default=0.0)
            else:
                vals         = row_values[:3]
                ticker       = vals[0] if len(vals) > 0 else ""
                shares       = _to_float(vals[1] if len(vals) > 1 else 0, default=0.0)
                average_cost = _to_float(vals[2] if len(vals) > 2 else 0, default=0.0)

            if not ticker:
                continue
            ticker_upper = ticker.upper()
            if ticker_upper in {"TICKER", "SYMBOL", "TICKER_SYMBOL"}:
                continue

            stock_documents.append({
                "portfolio_name": portfolio_name,
                "ticker":         ticker_upper,
                "shares":         shares,
                "average_cost":   average_cost,
            })

    return portfolio_name, cash_value, stock_documents

# ─── AI backend configuration ─────────────────────────────────────────────────

LLM_BACKEND      = os.getenv("LLM_BACKEND", "lmstudio").lower()
LM_STUDIO_API_URL = os.getenv("LM_STUDIO_API_URL", "http://localhost:1234/v1/chat/completions")
OLLAMA_API_URL   = os.getenv("OLLAMA_API_URL", "http://localhost:11434/v1/chat/completions")
OLLAMA_MODEL     = os.getenv("OLLAMA_MODEL", "llama3")
SSL_VERIFY       = os.getenv("SSL_VERIFY", "true").lower() != "false"

if LLM_BACKEND == "ollama":
    AI_API_URL      = OLLAMA_API_URL
    AI_MODEL        = OLLAMA_MODEL
    AI_BACKEND_NAME = "Ollama"
else:
    AI_API_URL      = LM_STUDIO_API_URL
    AI_MODEL        = "*"
    AI_BACKEND_NAME = "LM Studio"

AI_SYSTEM_PROMPT = """You are a helpful financial assistant with access to the user's portfolio data and/or web search results when provided.

When portfolio context is included:
- Analyze their holdings, allocations, and performance
- Provide specific insights (e.g., diversification, concentration risk, P&L)
- Suggest actionable improvements (rebalancing, profit-taking, tax considerations)
- Answer questions about specific tickers, costs, or potential

When web search results are included:
- You MUST use the provided search results to give current, factual information
- DO NOT rely on your training data for time-sensitive information
- Cite sources explicitly (e.g., "According to CNBC on April 24, 2026...") when referencing web data
- If results are from different dates, prioritize the most recent
- If results conflict, present multiple viewpoints and note the discrepancy

When both are included:
- Blend portfolio analysis with current market context from web results
- Distinguish clearly between personal portfolio facts and general market information

When no context is available:
- Provide general investment education and financial concepts

Keep responses concise, informative, and focused on the user's specific question."""

async def call_ai_backend(user_message: str) -> dict:
    logger.info("Calling AI backend at %s", AI_API_URL)
    try:
        async with httpx.AsyncClient(timeout=300.0, verify=SSL_VERIFY) as client:
            headers = {
                "Content-Type": "application/json",
                "Accept":       "application/json",
            }
            payload = {
                "model":      AI_MODEL,
                "messages": [
                    {"role": "system", "content": AI_SYSTEM_PROMPT},
                    {"role": "user",   "content": user_message},
                ],
                "max_tokens": 4096,
                "stream":     False,
            }
            logger.debug("Sending to %s, message length=%d", AI_BACKEND_NAME, len(user_message))
            response = await client.post(AI_API_URL, headers=headers, json=payload)
            logger.debug("AI response status: %d", response.status_code)

            if response.status_code != 200:
                error_text = response.text[:500] if response.text else "Unknown error"
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"{AI_BACKEND_NAME} API error: {error_text}",
                )

            try:
                return response.json()
            except Exception as e:
                raise HTTPException(
                    status_code=502,
                    detail=f"Invalid JSON from {AI_BACKEND_NAME}: {response.text[:200]}",
                )

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to connect to {AI_BACKEND_NAME} at {AI_API_URL}: {e}",
        )

# ─── Ticker validation cache ───────────────────────────────────────────────────

_TICKER_CACHE: dict = {}
_TICKER_CACHE_TTL = 3600   # seconds
_TICKER_CACHE_MAX = 500    # max entries before evicting oldest

def _validate_ticker(ticker: str) -> tuple[bool, str]:
    """Validate ticker against yfinance; results cached for 1 hour (max 500 entries)."""
    now = time.time()

    # Return cached result if still fresh
    if ticker in _TICKER_CACHE:
        ts, is_valid, msg = _TICKER_CACHE[ticker]
        if now - ts < _TICKER_CACHE_TTL:
            return is_valid, msg
        del _TICKER_CACHE[ticker]  # stale — evict

    # Evict oldest entry when at capacity
    if len(_TICKER_CACHE) >= _TICKER_CACHE_MAX:
        oldest = min(_TICKER_CACHE, key=lambda k: _TICKER_CACHE[k][0])
        del _TICKER_CACHE[oldest]

    # Basic format check
    if not re.match(r'^[A-Z0-9]{1,6}(\.[A-Z])?$', ticker):
        result = (False, f"Invalid ticker format: '{ticker}'")
        _TICKER_CACHE[ticker] = (now,) + result
        return result

    try:
        ticker_obj = yf.Ticker(ticker)
        hist = ticker_obj.history(period="5d", prepost=False)
        if hist.empty:
            result = (False, f"Ticker '{ticker}' not found or has no trading data")
        else:
            last_close = hist["Close"].iloc[-1]
            if pd.isna(last_close):
                result = (False, f"Ticker '{ticker}' has no valid price data")
            else:
                result = (True, "")
    except Exception as e:
        result = (False, f"Could not validate ticker '{ticker}': {e}")

    _TICKER_CACHE[ticker] = (now,) + result
    return result

# ─── Daily snapshot helpers (3× per day: open / midday / close) ──────────────

_SLOT_ORDER = {"open": 0, "midday": 1, "close": 2, "eod": 2}

def _current_market_slot() -> str:
    """Return 'open', 'midday', or 'close' based on current US Eastern time."""
    try:
        if _pytz:
            et = _pytz.timezone("America/New_York")
            now_et = datetime.now(et)
        else:
            import datetime as _dt
            now_et = _dt.datetime.utcnow()  # rough fallback
        mins = now_et.hour * 60 + now_et.minute
        if mins < 12 * 60 + 45:
            return "open"
        if mins < 16 * 60:
            return "midday"
        return "close"
    except Exception:
        return "close"

def _snapshot_doc(portfolio_id: str, total_balance: float, invested_value: float,
                  cash_value: float, slot: str) -> dict:
    return {
        "date":           _date.today().isoformat(),
        "slot":           slot,
        "total_value":    round(total_balance, 2),
        "invested_value": round(invested_value, 2),
        "cash_value":     round(cash_value, 2),
        "timestamp":      datetime.utcnow().isoformat() + "Z",
    }

def _maybe_record_snapshot(portfolio_id: str, total_balance: float, invested_value: float, cash_value: float):
    """Insert a snapshot for the current slot only if one doesn't already exist."""
    if db is None:
        return
    try:
        slot      = _current_market_slot()
        today_str = _date.today().isoformat()
        hist_col  = db[_safe_collection_name(portfolio_id) + "_history"]
        if not hist_col.find_one({"date": today_str, "slot": slot}):
            hist_col.insert_one(_snapshot_doc(portfolio_id, total_balance, invested_value, cash_value, slot))
    except Exception as exc:
        logger.warning("Snapshot write failed: %s", exc)

def _force_record_snapshot(portfolio_id: str, total_balance: float, invested_value: float,
                            cash_value: float) -> dict:
    """Always upsert a snapshot for the current slot today (manual button)."""
    slot      = _current_market_slot()
    today_str = _date.today().isoformat()
    doc       = _snapshot_doc(portfolio_id, total_balance, invested_value, cash_value, slot)
    if db is not None:
        hist_col = db[_safe_collection_name(portfolio_id) + "_history"]
        hist_col.update_one({"date": today_str, "slot": slot}, {"$set": doc}, upsert=True)
    return doc

# ─── Market data caches ───────────────────────────────────────────────────────

_TAPE_SYMBOLS = [
    ("SPY",      "SPY"),
    ("QQQ",      "QQQ"),
    ("BTC-USD",  "BTC/USD"),
    ("^VIX",     "VIX"),
    ("NVDA",     "NVDA"),
    ("TSLA",     "TSLA"),
    ("AAPL",     "AAPL"),
    ("GC=F",     "GOLD"),
    ("EURUSD=X", "EUR/USD"),
    ("AMZN",     "AMZN"),
    ("MSFT",     "MSFT"),
    ("META",     "META"),
]
_TAPE_CACHE: dict = {"data": None, "ts": 0.0}
_TAPE_TTL   = 300   # 5 minutes

_FNG_CACHE: dict = {"data": None, "ts": 0.0}
_FNG_TTL    = 3600  # 1 hour

# ─── Portfolio routes ──────────────────────────────────────────────────────────

@router.get("/portfolios")
@router.get("/portfolios/")
async def get_default_portfolio():
    return await get_portfolio("4RCH3R")

# @router.get("/portfolios/list")
# async def list_portfolio_names():
#     if db is None:
#         return {"portfolios": [], "warning": "Database disconnected"}
#     collections = db.list_collection_names()
#     return {"portfolios": [c for c in collections if not c.startswith("system.")]}


@router.get("/portfolios/list")
async def list_portfolio_names():
    if db is None:
        return {"portfolios": [], "warning": "Database disconnected"}
    
    collections = db.list_collection_names()
    
    filtered_portfolios = [
        c for c in collections
        if not c.startswith("system.") and not c.endswith("_history") and not c.endswith("_trades")
    ]
    
    return {"portfolios": filtered_portfolios}

@router.post("/portfolios/upload")
async def upload_portfolio(file: UploadFile = File(...)):
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable — cannot upload portfolio")
    try:
        upload_bytes = await file.read()
        portfolio_name, cash_value, stock_documents = _parse_portfolio_upload(upload_bytes)
        collection_name    = _safe_collection_name(portfolio_name)
        if collection_name in db.list_collection_names():
            raise HTTPException(
                status_code=409,
                detail=f"Portfolio '{portfolio_name}' already exists. Delete it first or choose a different name.",
            )
        portfolio_collection = db[collection_name]
        portfolio_collection.drop()

        if stock_documents:
            tickers_to_validate = [doc["ticker"] for doc in stock_documents]
            logger.info("Validating tickers for upload: %s", tickers_to_validate)
            try:
                def _validate_upload():
                    return yf.download(tickers_to_validate, period="5d", progress=False)

                loop = asyncio.get_running_loop()
                validation_data = await loop.run_in_executor(None, _validate_upload)
                valid_tickers   = set()
                if isinstance(validation_data.columns, pd.MultiIndex):
                    for ticker in tickers_to_validate:
                        try:
                            ticker_df = validation_data.xs(ticker, axis=1, level=1)
                            if not ticker_df.empty and not pd.isna(ticker_df["Close"].iloc[-1]):
                                valid_tickers.add(ticker)
                        except Exception:
                            pass
                else:
                    if not validation_data.empty and not pd.isna(validation_data["Close"].iloc[-1]):
                        valid_tickers.add(tickers_to_validate[0])

                invalid = [doc["ticker"] for doc in stock_documents if doc["ticker"] not in valid_tickers]
                stock_documents = [doc for doc in stock_documents if doc["ticker"] in valid_tickers]
                if invalid:
                    logger.warning("Skipped invalid tickers during upload: %s", invalid)
            except Exception as e:
                logger.error("Ticker validation failed during upload: %s", e)

        documents_to_insert = [
            {
                "portfolio_name": portfolio_name,
                "ticker":         "CASH",
                "shares":         cash_value,
                "average_cost":   1.0,
            }
        ]
        documents_to_insert.extend(stock_documents)
        if documents_to_insert:
            portfolio_collection.insert_many(documents_to_insert)

        return {
            "message":         "Portfolio uploaded successfully",
            "portfolio_name":  portfolio_name,
            "collection_name": collection_name,
            "inserted_count":  len(documents_to_insert),
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
        positions_col  = db[collection_name]
        user_positions = list(positions_col.find({}, {"_id": 0}))

        invested_val               = 0
        cash_val                   = 0
        total_cost_basis           = 0
        total_previous_close_value = 0
        holdings_list              = []

        tickers       = []
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
            def _download_prices():
                return yf.download(tickers, period="2d", group_by="ticker", progress=False)

            try:
                loop = asyncio.get_running_loop()
                data = await loop.run_in_executor(None, _download_prices)
                for t in tickers:
                    try:
                        ticker_df = data if len(tickers) == 1 else data[t]
                        if not ticker_df.empty and len(ticker_df) >= 1:
                            curr = ticker_df["Close"].iloc[-1]
                            prev = ticker_df["Close"].iloc[-2] if len(ticker_df) > 1 else curr
                            if pd.isna(curr) or pd.isna(prev):
                                logger.warning("No valid price data for %s (delisted?), using avg_cost", t)
                                market_data[t] = {"current": None, "previous": None}
                            else:
                                market_data[t] = {"current": float(curr), "previous": float(prev)}
                        else:
                            logger.warning("No data rows for %s", t)
                            market_data[t] = {"current": None, "previous": None}
                    except KeyError:
                        logger.warning("Ticker %s not found in downloaded data", t)
                        market_data[t] = {"current": None, "previous": None}
                    except Exception as e:
                        logger.warning("Error processing %s: %s", t, e)
                        market_data[t] = {"current": None, "previous": None}
            except Exception as e:
                logger.error("Bulk yfinance download failed: %s", e)

        for t, pos in ticker_to_pos.items():
            shares    = float(pos.get("shares", 0))
            avg_cost  = float(pos.get("average_cost", pos.get("avg_cost", 0)))
            m_data    = market_data.get(t, {"current": None, "previous": None})

            current_price  = m_data["current"]  if m_data["current"]  is not None else avg_cost
            previous_close = m_data["previous"] if m_data["previous"] is not None else avg_cost
            current_price  = float(current_price)  if not pd.isna(current_price)  else avg_cost
            previous_close = float(previous_close) if not pd.isna(previous_close) else avg_cost

            market_value = shares * current_price
            cost_basis   = shares * avg_cost

            invested_val               += market_value
            total_cost_basis           += cost_basis
            total_previous_close_value += shares * previous_close

            pos.update({
                "current_price": float(round(current_price, 2)),
                "market_value":  float(round(market_value, 2)),
                "pl":            float(round(market_value - cost_basis, 2)),
                "daily_change":  float(round(((current_price - previous_close) / previous_close * 100), 2)) if previous_close > 0 else 0.0,
                "average_cost":  float(avg_cost),
            })
            holdings_list.append(pos)

        combined_current  = invested_val + cash_val
        total_profit      = combined_current - (total_cost_basis + cash_val)
        combined_prev     = total_previous_close_value + cash_val
        daily_change_pct  = ((combined_current - combined_prev) / combined_prev * 100) if combined_prev > 0 else 0

        _maybe_record_snapshot(portfolio_id, combined_current, invested_val, cash_val)

        return {
            "invested_value":   float(round(invested_val, 2)),
            "cash_value":       float(round(cash_val, 2)),
            "total_balance":    float(round(combined_current, 2)),
            "total_profit":     float(round(total_profit, 2)),
            "daily_change_pct": float(round(daily_change_pct, 2)),
            "positions":        holdings_list,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Portfolio management ──────────────────────────────────────────────────────

@router.delete("/portfolios/{portfolio_id}")
async def delete_portfolio(portfolio_id: str):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    collection_name = _safe_collection_name(portfolio_id)
    if collection_name not in db.list_collection_names():
        raise HTTPException(status_code=404, detail=f"Portfolio '{portfolio_id}' not found")
    db[collection_name].drop()
    db[collection_name + "_history"].drop()
    db[collection_name + "_trades"].drop()
    return {"message": f"Portfolio '{portfolio_id}' deleted successfully"}

# ─── Portfolio rename (#9) ───────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/rename")
async def rename_portfolio(portfolio_id: str, request: RenameRequest):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    new_name = request.new_name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required")

    old_col = _safe_collection_name(portfolio_id)
    new_col = _safe_collection_name(new_name)

    if old_col == new_col:
        raise HTTPException(status_code=400, detail="New name is the same as the current name")
    all_cols = db.list_collection_names()
    if old_col not in all_cols:
        raise HTTPException(status_code=404, detail=f"Portfolio '{portfolio_id}' not found")
    if new_col in all_cols:
        raise HTTPException(status_code=400, detail=f"Portfolio '{new_name}' already exists")

    def _copy_and_drop(src: str, dst: str):
        docs = list(db[src].find({}))
        if docs:
            for d in docs:
                d.pop("_id", None)
            db[dst].insert_many(docs)
        db[src].drop()

    _copy_and_drop(old_col, new_col)
    _copy_and_drop(old_col + "_history", new_col + "_history")
    _copy_and_drop(old_col + "_trades",  new_col + "_trades")

    return {"message": f"Portfolio renamed to '{new_name}'", "new_id": new_name}

# ─── Position management ───────────────────────────────────────────────────────

@router.delete("/portfolios/{portfolio_id}/positions/{ticker}")
async def remove_position(portfolio_id: str, ticker: str):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    ticker_upper = ticker.strip().upper()
    if ticker_upper == "CASH":
        raise HTTPException(status_code=400, detail="Cannot delete CASH position")
    collection = db[_safe_collection_name(portfolio_id)]
    result     = collection.delete_one({"ticker": ticker_upper})
    return {"message": "Position removed", "ticker": ticker_upper, "deleted_count": result.deleted_count}

@router.post("/portfolios/{portfolio_id}/positions")
async def add_position(portfolio_id: str, request: PositionRequest):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")

    ticker   = request.ticker.strip().upper()
    shares   = request.shares
    avg_cost = request.average_cost
    action   = request.action

    if not ticker or ticker == "CASH":
        raise HTTPException(status_code=400, detail="Invalid ticker")
    if shares <= 0:
        raise HTTPException(status_code=400, detail="Shares must be a positive number")
    if avg_cost < 0:
        raise HTTPException(status_code=400, detail="Average cost must be non-negative")

    collection = db[_safe_collection_name(portfolio_id)]
    existing   = collection.find_one({"ticker": ticker})

    if action == "buy":
        # Check cash sufficiency before anything else
        total_cost = shares * avg_cost
        cash_doc     = collection.find_one({"ticker": "CASH"})
        current_cash = float(cash_doc.get("shares", 0)) if cash_doc else 0.0
        if current_cash < total_cost:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient cash. Need ${total_cost:,.2f} but only ${current_cash:,.2f} available."
            )

        # Validate ticker only for brand-new positions
        if not existing:
            loop = asyncio.get_running_loop()
            is_valid, error_msg = await loop.run_in_executor(None, _validate_ticker, ticker)
            if not is_valid:
                raise HTTPException(status_code=400, detail=error_msg)

        # Merge position + deduct cash atomically
        old_shares   = float(existing.get("shares", 0))   if existing else 0.0
        old_avg_cost = float(existing.get("average_cost", existing.get("avg_cost", 0))) if existing else 0.0

        def _do_buy(session):
            kw = {"session": session} if session is not None else {}
            if existing:
                new_total = old_shares + shares
                new_avg   = (old_shares * old_avg_cost + shares * avg_cost) / new_total
                collection.update_one(
                    {"ticker": ticker},
                    {"$set": {"shares": new_total, "average_cost": new_avg}},
                    **kw,
                )
            else:
                collection.insert_one(
                    {"ticker": ticker, "shares": shares, "average_cost": avg_cost},
                    **kw,
                )
            collection.update_one(
                {"ticker": "CASH"},
                {"$inc": {"shares": -total_cost}, "$set": {"ticker": "CASH", "average_cost": 1.0}},
                upsert=True,
                **kw,
            )

        _with_optional_transaction(_do_buy)
    else:
        # Edit mode: correct position data without touching cash
        if not existing:
            loop = asyncio.get_running_loop()
            is_valid, error_msg = await loop.run_in_executor(None, _validate_ticker, ticker)
            if not is_valid:
                raise HTTPException(status_code=400, detail=error_msg)
        collection.update_one(
            {"ticker": ticker},
            {"$set": {"ticker": ticker, "shares": float(shares), "average_cost": float(avg_cost)}},
            upsert=True,
        )

    return {"ticker": ticker, "shares": shares, "average_cost": avg_cost, "message": "Position saved"}


@router.post("/portfolios/{portfolio_id}/positions/{ticker}/sell")
async def sell_position(portfolio_id: str, ticker: str, request: SellRequest):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")

    ticker_upper = ticker.strip().upper()
    shares_val   = request.shares
    price_val    = request.sell_price

    if shares_val <= 0:
        raise HTTPException(status_code=400, detail="Shares must be positive")
    if price_val <= 0:
        raise HTTPException(status_code=400, detail="Sell price must be a positive number")

    collection = db[_safe_collection_name(portfolio_id)]
    existing   = collection.find_one({"ticker": ticker_upper})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Position '{ticker_upper}' not found")

    current_shares = float(existing.get("shares", 0))
    if shares_val > current_shares + 0.0001:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot sell {shares_val:.4g} shares — only {current_shares:.4g} held."
        )

    proceeds = shares_val * price_val

    def _do_sell(session):
        kw = {"session": session} if session is not None else {}
        if abs(shares_val - current_shares) < 0.0001:
            collection.delete_one({"ticker": ticker_upper}, **kw)
        else:
            collection.update_one(
                {"ticker": ticker_upper},
                {"$set": {"shares": round(current_shares - shares_val, 10)}},
                **kw,
            )
        collection.update_one(
            {"ticker": "CASH"},
            {"$inc": {"shares": proceeds}, "$set": {"ticker": "CASH", "average_cost": 1.0}},
            upsert=True,
            **kw,
        )

    _with_optional_transaction(_do_sell)

    # Write realized trade record (#10)
    avg_cost_sold = float(existing.get("average_cost", existing.get("avg_cost", 0)))
    realized_pnl  = round((price_val - avg_cost_sold) * shares_val, 2)
    trade_doc = {
        "date":         _date.today().isoformat(),
        "ticker":       ticker_upper,
        "shares":       shares_val,
        "sell_price":   price_val,
        "avg_cost":     avg_cost_sold,
        "proceeds":     round(proceeds, 2),
        "realized_pnl": realized_pnl,
        "timestamp":    datetime.utcnow().isoformat() + "Z",
    }
    try:
        db[_safe_collection_name(portfolio_id) + "_trades"].insert_one(trade_doc)
    except Exception as exc:
        logger.warning("Failed to write trade record: %s", exc)

    return {
        "message":          f"Sold {shares_val} shares of {ticker_upper} @ ${price_val:.2f}",
        "proceeds":         round(proceeds, 2),
        "ticker":           ticker_upper,
        "remaining_shares": max(0.0, round(current_shares - shares_val, 10)) if abs(shares_val - current_shares) >= 0.0001 else 0.0,
    }

# ─── Cash management ──────────────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/cash/deposit")
async def deposit_cash(portfolio_id: str, request: CashRequest):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    amount_val = request.amount
    if amount_val <= 0:
        raise HTTPException(status_code=400, detail="Amount must be a positive number")

    collection = db[_safe_collection_name(portfolio_id)]
    collection.update_one(
        {"ticker": "CASH"},
        {"$inc": {"shares": amount_val}, "$set": {"ticker": "CASH", "average_cost": 1.0}},
        upsert=True,
    )
    cash_doc = collection.find_one({"ticker": "CASH"})
    new_cash  = float(cash_doc.get("shares", 0)) if cash_doc else amount_val
    try:
        db[_safe_collection_name(portfolio_id) + "_trades"].insert_one({
            "date":      _date.today().isoformat(),
            "ticker":    "CASH",
            "type":      "deposit",
            "amount":    amount_val,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        })
    except Exception as exc:
        logger.warning("Failed to write cash deposit record: %s", exc)
    return {"message": "Cash deposited", "portfolio_id": portfolio_id, "new_cash": new_cash, "amount": amount_val}

@router.post("/portfolios/{portfolio_id}/cash/withdraw")
async def withdraw_cash(portfolio_id: str, request: CashRequest):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    amount_val = request.amount
    if amount_val <= 0:
        raise HTTPException(status_code=400, detail="Amount must be a positive number")

    collection = db[_safe_collection_name(portfolio_id)]
    cash_doc   = collection.find_one({"ticker": "CASH"})
    if not cash_doc:
        raise HTTPException(status_code=404, detail="No CASH position found — deposit first")
    current_cash = float(cash_doc.get("shares", 0))
    if current_cash < amount_val:
        raise HTTPException(status_code=400, detail=f"Insufficient cash. Available: ${current_cash:,.2f}")

    collection.update_one({"ticker": "CASH"}, {"$inc": {"shares": -amount_val}})
    updated_doc = collection.find_one({"ticker": "CASH"})
    new_cash    = float(updated_doc.get("shares", 0)) if updated_doc else 0
    try:
        db[_safe_collection_name(portfolio_id) + "_trades"].insert_one({
            "date":      _date.today().isoformat(),
            "ticker":    "CASH",
            "type":      "withdraw",
            "amount":    amount_val,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        })
    except Exception as exc:
        logger.warning("Failed to write cash withdrawal record: %s", exc)
    return {"message": "Cash withdrawn", "portfolio_id": portfolio_id, "new_cash": new_cash, "amount": amount_val}

# ─── Portfolio heartrate (snapshots) ──────────────────────────────────────────

@router.get("/portfolios/{portfolio_id}/snapshots/export")
async def export_snapshots(portfolio_id: str):
    from fastapi.responses import StreamingResponse
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")

    hist_col  = db[_safe_collection_name(portfolio_id) + "_history"]
    raw       = list(hist_col.find({}, {"_id": 0}).sort("date", 1))
    raw.sort(key=lambda s: (s.get("date", ""), _SLOT_ORDER.get(s.get("slot", "close"), 2)))
    if not raw:
        raise HTTPException(status_code=404, detail="No historical data found for this portfolio")

    df   = pd.DataFrame(raw)
    keep = [c for c in ["date", "slot", "total_value", "invested_value", "cash_value"] if c in df.columns]
    df   = df[keep].rename(columns={
        "date": "Date", "slot": "Slot",
        "total_value": "Total Value ($)",
        "invested_value": "Invested Value ($)",
        "cash_value": "Cash Value ($)",
    })

    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Portfolio History", index=False)
    output.seek(0)

    safe_name = _safe_collection_name(portfolio_id)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_history.xlsx"'},
    )


@router.get("/portfolios/{portfolio_id}/snapshots")
async def get_snapshots(portfolio_id: str, period: str = "1w"):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")

    today    = _date.today()
    period_map = {
        "1w": timedelta(weeks=1),
        "1m": timedelta(days=30),
        "3m": timedelta(days=90),
        "6m": timedelta(days=180),
        "1y": timedelta(days=365),
    }

    hist_col = db[_safe_collection_name(portfolio_id) + "_history"]
    query    = {}
    if period in period_map:
        query["date"] = {"$gte": (today - period_map[period]).isoformat()}

    raw       = list(hist_col.find(query, {"_id": 0}))
    snapshots = sorted(raw, key=lambda s: (s.get("date", ""), _SLOT_ORDER.get(s.get("slot", "close"), 2)))

    pct_change = 0.0
    if len(snapshots) >= 2:
        first_val  = snapshots[0].get("total_value", 0) or 0
        last_val   = snapshots[-1].get("total_value", 0) or 0
        pct_change = round(((last_val - first_val) / first_val * 100) if first_val else 0, 2)

    return {"snapshots": snapshots, "period": period, "pct_change": pct_change}


@router.post("/portfolios/{portfolio_id}/snapshot")
async def take_manual_snapshot(portfolio_id: str):
    """Force-record a snapshot for the current slot, replacing any existing one today."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    collection_name = _safe_collection_name(portfolio_id)
    if collection_name not in db.list_collection_names():
        raise HTTPException(status_code=404, detail=f"Portfolio '{portfolio_id}' not found")
    # Reuse get_portfolio to obtain live values (it also calls _maybe_record_snapshot,
    # but we then force-overwrite with _force_record_snapshot)
    portfolio_data = await get_portfolio(portfolio_id)
    doc = _force_record_snapshot(
        portfolio_id,
        portfolio_data["total_balance"],
        portfolio_data["invested_value"],
        portfolio_data["cash_value"],
    )
    return {"message": f"Snapshot recorded (slot: {doc['slot']})", "snapshot": doc}


@router.post("/portfolios/{portfolio_id}/snapshots/import")
async def import_snapshots(portfolio_id: str, file: UploadFile = File(...)):
    """Import historical snapshots from an Excel file.
    Expected columns (by name or position): date, total_value, invested_value, cash_value.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    if not (file.filename or "").lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx / .xls files are accepted")

    try:
        raw_bytes = await file.read()
        df = pd.read_excel(BytesIO(raw_bytes), header=0)
        df.columns = [str(c).strip().lower() for c in df.columns]

        # Map columns by name, then fall back to position
        col_list = list(df.columns)
        def _find_col(keywords, pos):
            for c in col_list:
                if any(kw in c for kw in keywords):
                    return c
            return col_list[pos] if len(col_list) > pos else None

        date_col     = _find_col(["date"], 0)
        total_col    = _find_col(["total"], 1)
        invested_col = _find_col(["invest"], 2)
        cash_col     = _find_col(["cash"], 3)

        if not date_col:
            raise HTTPException(status_code=400, detail="Cannot find a date column")

        hist_col = db[_safe_collection_name(portfolio_id) + "_history"]
        inserted, errors = 0, []

        for _, row in df.iterrows():
            try:
                raw_date = str(row[date_col]).strip()
                # Normalise to YYYY-MM-DD
                raw_date = re.sub(r"[/\\]", "-", raw_date)[:10]
                if not raw_date or raw_date.lower() == "nan":
                    continue

                doc = {
                    "date":           raw_date,
                    "slot":           "eod",
                    "total_value":    _to_float(row.get(total_col)    if total_col    else 0),
                    "invested_value": _to_float(row.get(invested_col) if invested_col else 0),
                    "cash_value":     _to_float(row.get(cash_col)     if cash_col     else 0),
                    "timestamp":      datetime.utcnow().isoformat() + "Z",
                }
                hist_col.update_one({"date": raw_date, "slot": "eod"}, {"$set": doc}, upsert=True)
                inserted += 1
            except Exception as row_err:
                errors.append(str(row_err))

        return {"message": f"Imported {inserted} snapshot(s)", "inserted": inserted,
                "errors": errors[:10]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Import failed: {exc}")


# ─── Positions export (#14) ───────────────────────────────────────────────────

@router.get("/portfolios/{portfolio_id}/positions/export")
async def export_positions(portfolio_id: str):
    from fastapi.responses import StreamingResponse
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")

    portfolio_data = await get_portfolio(portfolio_id)
    positions      = portfolio_data.get("positions", [])
    cash_val       = portfolio_data.get("cash_value", 0.0)

    rows = [
        {
            "Ticker":           p["ticker"],
            "Shares":           p["shares"],
            "Avg Cost ($)":     round(p.get("average_cost", 0), 2),
            "Current Price ($)": round(p.get("current_price", p.get("average_cost", 0)), 2),
            "Market Value ($)": round(p.get("market_value", 0), 2),
            "P&L ($)":          round(p.get("pl", 0), 2),
            "Daily Change (%)": round(p.get("daily_change", 0), 2),
        }
        for p in positions
    ]
    rows.append({
        "Ticker": "CASH", "Shares": round(cash_val, 2),
        "Avg Cost ($)": 1.0, "Current Price ($)": 1.0,
        "Market Value ($)": round(cash_val, 2), "P&L ($)": 0.0, "Daily Change (%)": 0.0,
    })

    df     = pd.DataFrame(rows)
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Positions", index=False)
    output.seek(0)

    safe_name = _safe_collection_name(portfolio_id)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_positions.xlsx"'},
    )


# ─── Trade history (#10) ──────────────────────────────────────────────────────

@router.get("/portfolios/{portfolio_id}/trades")
async def get_trades(portfolio_id: str):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")
    trades_col = db[_safe_collection_name(portfolio_id) + "_trades"]
    trades     = list(trades_col.find({}, {"_id": 0}).sort("timestamp", -1).limit(200))
    total_realized = sum(t.get("realized_pnl", 0) for t in trades)
    return {"trades": trades, "total_realized_pnl": round(total_realized, 2)}


# ─── Sector allocation (#8) ───────────────────────────────────────────────────

_SECTOR_CACHE: dict = {}
_SECTOR_TTL   = 3600  # 1 hour

@router.get("/portfolios/{portfolio_id}/sectors")
async def get_sector_allocation(portfolio_id: str):
    if db is None:
        raise HTTPException(status_code=503, detail="Database disconnected")

    portfolio_data = await get_portfolio(portfolio_id)
    positions      = portfolio_data.get("positions", [])
    cash_val       = portfolio_data.get("cash_value", 0.0)
    total_value    = portfolio_data.get("total_balance", 0.0)

    if not positions:
        return {
            "sectors": [{"sector": "Cash", "value": round(cash_val, 2), "pct": 100.0}],
            "total_value": round(total_value, 2),
        }

    now       = time.time()
    tickers   = [p["ticker"] for p in positions]
    to_fetch  = [t for t in tickers if t not in _SECTOR_CACHE or now - _SECTOR_CACHE[t][0] >= _SECTOR_TTL]
    cached    = {t: _SECTOR_CACHE[t][1] for t in tickers if t in _SECTOR_CACHE and now - _SECTOR_CACHE[t][0] < _SECTOR_TTL}

    if to_fetch:
        def _fetch_sectors():
            result = {}
            for t in to_fetch:
                try:
                    info = yf.Ticker(t).info
                    result[t] = info.get("sector") or "Unknown"
                except Exception:
                    result[t] = "Unknown"
            return result

        loop    = asyncio.get_running_loop()
        fetched = await loop.run_in_executor(None, _fetch_sectors)
        for t, sector in fetched.items():
            _SECTOR_CACHE[t] = (now, sector)
            cached[t] = sector

    sector_values: dict = {}
    for pos in positions:
        sector = cached.get(pos["ticker"], "Unknown")
        sector_values[sector] = sector_values.get(sector, 0.0) + float(pos.get("market_value", 0))
    if cash_val > 0:
        sector_values["Cash"] = sector_values.get("Cash", 0.0) + cash_val

    sector_list = sorted(
        [
            {"sector": s, "value": round(v, 2), "pct": round(v / total_value * 100, 2) if total_value > 0 else 0.0}
            for s, v in sector_values.items()
        ],
        key=lambda x: -x["value"],
    )
    return {"sectors": sector_list, "total_value": round(total_value, 2)}


# ─── Market data ───────────────────────────────────────────────────────────────

@router.get("/market/ticker-tape")
async def get_ticker_tape():
    """Return current prices for the dashboard ticker tape (5-min cache)."""
    now = time.time()
    if _TAPE_CACHE["data"] and now - _TAPE_CACHE["ts"] < _TAPE_TTL:
        return _TAPE_CACHE["data"]

    def _fetch():
        tickers = [s[0] for s in _TAPE_SYMBOLS]
        try:
            data = yf.download(tickers, period="2d", group_by="ticker", progress=False)
        except Exception as e:
            logger.error("Ticker tape bulk download failed: %s", e)
            return []

        results = []
        for yf_sym, display in _TAPE_SYMBOLS:
            try:
                df = data if len(tickers) == 1 else data[yf_sym]
                if df.empty or len(df) < 1:
                    continue
                curr = float(df["Close"].iloc[-1])
                prev = float(df["Close"].iloc[-2]) if len(df) >= 2 else curr
                if pd.isna(curr):
                    continue
                pct = ((curr - prev) / prev * 100) if (prev and not pd.isna(prev)) else 0.0
                results.append({
                    "symbol":     yf_sym,
                    "display":    display,
                    "price":      round(curr, 4 if ("USD" in yf_sym or yf_sym.startswith("EUR")) else 2),
                    "change_pct": round(pct, 2),
                    "direction":  "up" if pct > 0.005 else ("down" if pct < -0.005 else "flat"),
                })
            except Exception as e:
                logger.warning("Tape item error %s: %s", yf_sym, e)
        return results

    loop  = asyncio.get_running_loop()
    items = await loop.run_in_executor(None, _fetch)
    result = {"items": items, "updated_at": datetime.utcnow().isoformat() + "Z"}
    _TAPE_CACHE["data"] = result
    _TAPE_CACHE["ts"]   = now
    return result


@router.get("/market/fear-greed")
async def get_fear_greed():
    """Return CNN Fear & Greed Index (1-hour cache) via fear-and-greed library."""
    now = time.time()
    if _FNG_CACHE["data"] and now - _FNG_CACHE["ts"] < _FNG_TTL:
        return _FNG_CACHE["data"]

    def _fetch():
        import fear_and_greed
        return fear_and_greed.get()

    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, _fetch)
        result = {
            "score":            round(float(data.value), 1),
            "rating":           data.description,
            "previous_close":   None,
            "previous_1_week":  None,
            "previous_1_month": None,
            "previous_1_year":  None,
            "timestamp":        data.last_update.isoformat() if data.last_update else "",
        }
        _FNG_CACHE["data"] = result
        _FNG_CACHE["ts"]   = now
        return result
    except Exception as exc:
        logger.warning("Fear & Greed fetch failed: %s", exc)
        if _FNG_CACHE["data"]:
            return _FNG_CACHE["data"]
        raise HTTPException(status_code=502, detail=f"Fear & Greed index unavailable: {exc}")

# ─── Benchmark data ────────────────────────────────────────────────────────────

_BENCHMARK_PERIOD_MAP = {
    "1w": "5d", "1m": "1mo", "3m": "3mo",
    "6m": "6mo", "1y": "1y", "all": "5y",
}
_BENCHMARK_CACHE: dict = {}
_BENCHMARK_TTL  = 300  # 5 minutes

@router.get("/market/benchmark")
async def get_benchmark(symbol: str = "SPY", period: str = "1w"):
    """Return daily closing prices for a benchmark symbol over the requested period."""
    symbol = symbol.upper().strip()
    if not re.match(r'^[A-Z0-9\-\^=\.]{1,12}$', symbol):
        raise HTTPException(status_code=400, detail=f"Invalid symbol: {symbol}")

    cache_key = f"{symbol}:{period}"
    now = time.time()
    if cache_key in _BENCHMARK_CACHE:
        ts, cached = _BENCHMARK_CACHE[cache_key]
        if now - ts < _BENCHMARK_TTL:
            return cached

    yf_period = _BENCHMARK_PERIOD_MAP.get(period, "5d")

    def _fetch():
        hist = yf.Ticker(symbol).history(period=yf_period)
        if hist.empty:
            return []
        return [
            {"date": ts.strftime("%Y-%m-%d"), "close": float(round(row["Close"], 4))}
            for ts, row in hist.iterrows()
            if not pd.isna(row["Close"])
        ]

    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, _fetch)
        if not data:
            raise HTTPException(status_code=404, detail=f"No price data for {symbol}")
        result = {"symbol": symbol, "period": period, "data": data}
        _BENCHMARK_CACHE[cache_key] = (now, result)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Benchmark fetch failed: {exc}")

# ─── Stock detail panel ───────────────────────────────────────────────────────

_STOCK_DETAIL_CACHE: dict = {}
_STOCK_DETAIL_TTL = 300  # 5 minutes

@router.get("/market/stock-detail/{ticker}")
async def get_stock_detail(ticker: str):
    """Return 1M price history, key stats, and latest news for a single ticker."""
    ticker = ticker.upper().strip()
    if not re.match(r'^[A-Z0-9\-\^=\.]{1,12}$', ticker):
        raise HTTPException(status_code=400, detail=f"Invalid ticker: {ticker}")

    now = time.time()
    if ticker in _STOCK_DETAIL_CACHE:
        ts, cached = _STOCK_DETAIL_CACHE[ticker]
        if now - ts < _STOCK_DETAIL_TTL:
            return cached

    def _fetch():
        result = {"ticker": ticker, "prices": [], "stats": {}, "news": []}
        try:
            t = yf.Ticker(ticker)
            hist = t.history(period="1mo")
            if not hist.empty:
                result["prices"] = [
                    {"date": idx.strftime("%Y-%m-%d"), "close": round(float(row["Close"]), 2)}
                    for idx, row in hist.iterrows()
                    if not pd.isna(row["Close"])
                ]
            fi = t.fast_info
            result["stats"] = {
                "current_price":  round(float(getattr(fi, "last_price",   None) or 0), 2),
                "day_change_pct": round(float(getattr(fi, "regular_market_change_percent", None) or 0), 2),
                "market_cap":     int(getattr(fi, "market_cap", None) or 0),
                "week_52_high":   round(float(getattr(fi, "year_high",  None) or 0), 2),
                "week_52_low":    round(float(getattr(fi, "year_low",   None) or 0), 2),
                "volume":         int(getattr(fi, "last_volume", None) or 0),
            }
        except Exception as exc:
            logger.warning("stock-detail yfinance error for %s: %s", ticker, exc)

        try:
            result["news"] = web_search_structured(f"{ticker} stock news", max_results=5)
        except Exception as exc:
            logger.warning("stock-detail news error for %s: %s", ticker, exc)

        return result

    try:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, _fetch)
        _STOCK_DETAIL_CACHE[ticker] = (now, data)
        return data
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Stock detail fetch failed: {exc}")

# ─── AI chat ──────────────────────────────────────────────────────────────────

@router.post("/chat")
async def ai_chat(request: ChatRequest):
    start_time = time.time()
    try:
        user_message   = request.message.strip()
        portfolio_id   = request.portfolio_id.strip()
        use_web_search = request.use_web_search

        if not user_message:
            raise HTTPException(status_code=400, detail="Message is required")

        logger.info("Chat request: portfolio='%s', web_search=%s, msg_len=%d",
                    portfolio_id, use_web_search, len(user_message))

        # Fetch portfolio context with live prices
        portfolio_context = ""
        if portfolio_id:
            if db is None:
                portfolio_context = "(Note: Portfolio data unavailable — database disconnected)"
            else:
                try:
                    portfolio_data    = await get_portfolio(portfolio_id)
                    portfolio_context = _format_portfolio_summary(portfolio_id, portfolio_data)
                except HTTPException:
                    portfolio_context = f"(Note: Portfolio '{portfolio_id}' not found)"
                except Exception as e:
                    logger.warning("Could not fetch portfolio '%s': %s", portfolio_id, e)
                    portfolio_context = f"(Note: Portfolio '{portfolio_id}' data could not be loaded)"

        # Fetch web search results
        web_search_results = ""
        web_search_used    = False
        if use_web_search:
            try:
                web_search_results = web_search_cached(user_message, max_results=5)
                web_search_used    = bool(web_search_results)
                logger.info("Web search returned %d chars", len(web_search_results))
            except Exception as e:
                logger.warning("Web search failed: %s", e)

        # Build prompt
        context_parts = []
        if portfolio_context:
            context_parts.append(portfolio_context)
        if web_search_results:
            context_parts.append(f"Web Search Results:\n{web_search_results}")

        enhanced_prompt = (
            "\n\n".join(context_parts) + f"\n\nUser question: {user_message}"
            if context_parts else user_message
        )

        result = await call_ai_backend(enhanced_prompt)

        if not isinstance(result, dict):
            raise HTTPException(status_code=502, detail=f"Non-dict response from {AI_BACKEND_NAME}")

        choices = result.get("choices")
        if not choices or not isinstance(choices, list) or len(choices) == 0:
            raise HTTPException(status_code=502, detail=f"Empty 'choices' in response from {AI_BACKEND_NAME}")

        first_choice = choices[0]
        if not isinstance(first_choice, dict):
            raise HTTPException(status_code=502, detail=f"Invalid choice format from {AI_BACKEND_NAME}")

        message_obj = first_choice.get("message") or first_choice
        ai_response = (
            message_obj.get("content", "")
            if isinstance(message_obj, dict)
            else first_choice.get("text", "")
        )

        if not ai_response or not isinstance(ai_response, str):
            raise HTTPException(status_code=502, detail=f"No valid content in response from {AI_BACKEND_NAME}")

        elapsed = time.time() - start_time
        logger.info("Chat completed in %.2fs", elapsed)

        return {
            "response":                  ai_response,
            "model":                     result.get("model", "unknown"),
            "backend":                   AI_BACKEND_NAME,
            "portfolio_context_included": bool(portfolio_context),
            "web_search_used":           web_search_used,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unhandled error in /chat endpoint")
        raise HTTPException(status_code=500, detail=f"Chat processing error: {e}")
