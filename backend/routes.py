from fastapi import APIRouter, HTTPException, UploadFile, File
from io import BytesIO
import httpx
import json
import pandas as pd
import yfinance as yf

# Import the db instance verified in database.py
from database import db

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

# AI Chat Configuration for LM Studio
LM_STUDIO_API_URL = "http://localhost:1234/v1/chat/completions"
AI_SYSTEM_PROMPT = "You are a helpful financial assistant. Provide concise, informative responses about investments, market analysis, and portfolio management."

async def call_lm_studio(user_message: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=60.0, verify=False) as client:
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            
            payload = {
                "model": "*",
                "messages": [
                    {"role": "system", "content": AI_SYSTEM_PROMPT},
                    {"role": "user", "content": user_message}
                ],
                "temperature": 0.7,
                "max_tokens": 1024,
            }
            
            response = await client.post(
                LM_STUDIO_API_URL,
                headers=headers,
                json=payload
            )
            
            if not response.status_code == 200:
                error_text = response.text[:500] if response.text else "Unknown error"
                raise HTTPException(
                    status_code=response.status_code, 
                    detail=f"LM Studio API error: {error_text}"
                )
            
            return response.json()
            
    except httpx.TimeoutError:
        raise HTTPException(status_code=504, detail="AI service request timed out.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to connect to LM Studio: {str(e)}")

@router.get("/portfolios")
@router.get("/portfolios/")
async def get_default_portfolio():
    return await get_portfolio("4RCH3R")

@router.get("/portfolios/list")
async def list_portfolio_names():
    collections = db.list_collection_names()
    return {"portfolios": [c for c in collections if not c.startswith("system.")]}

@router.post("/portfolios/upload")
async def upload_portfolio(file: UploadFile = File(...)):
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
# AI Chat Endpoint
# ============================================
@router.post("/chat")
async def ai_chat(request: dict):
    """
    AI Chat endpoint - connects to LM Studio for intelligent responses.
    
    Expected payload:
    {
        "message": "Your question here",
        "context": "Optional portfolio context"  // optional
    }
    """
    try:
        # Extract message from request
        user_message = request.get("message", "").strip()
        
        if not user_message:
            raise HTTPException(status_code=400, detail="Message is required")
        
        # Get optional context to enhance response
        context = request.get("context", "")
        
        # Build enhanced prompt with context if available
        if context:
            enhanced_prompt = f"Context: {context}\n\nQuestion: {user_message}"
        else:
            enhanced_prompt = user_message
        
        print(f"Sending to LM Studio: {enhanced_prompt[:100]}...")
        
        # Call LM Studio API
        result = await call_lm_studio(enhanced_prompt)
        
        # Extract response from AI
        if "choices" not in result or len(result["choices"]) == 0:
            raise HTTPException(status_code=502, detail="Invalid response format from LM Studio")
        
        ai_response = result["choices"][0]["message"]["content"]
        
        # Log token usage if available
        usage = result.get("usage", {})
        if usage:
            print(f"Token usage: input={usage.get('prompt_tokens', 0)}, output={usage.get('completion_tokens', 0)}")
        
        return {
            "response": ai_response,
            "model": result.get("model", "unknown"),
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Chat endpoint error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chat processing error: {str(e)}")