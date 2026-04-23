from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from models import model
from database import get_collection

# 1. Initialize the router
router = APIRouter(
    prefix="/users",     # All routes in this file start with /users
    tags=["Users"]       # Groups these routes together in the Swagger docs
)

class StockCreate(BaseModel):
    ticker: str
    shares: int
    class StockPayload(BaseModel):
        ticker: str

    class PortfolioCreate(BaseModel):
        name: str
        stocks: list[str] = []

@router.get("/")
def get_all_users():
    col = get_collection("portfolios")
    portfolios = list(col.find({}, {"_id": 0}))
    return portfolios

@router.get("/{name}")
def get_port_byname(name: str):
    portfolio = model.getby_name(name)
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio

    @router.post("/{name}/stocks")
    def add_ticker_to_portfolio(name: str, payload: StockPayload):
        """Add a ticker string to the portfolio's `stocks` array. Returns the updated portfolio."""
        updated = model.add_stock_to_portfolio(name, payload.ticker)
        if not updated:
            raise HTTPException(status_code=404, detail="Portfolio not found")
        return updated


    @router.post("/portfolio")
    def create_portfolio(payload: PortfolioCreate):
        """Create a new portfolio document with a name and optional list of tickers."""
        created = model.create_portfolio(payload.name, payload.stocks)
        if not created:
            raise HTTPException(status_code=409, detail="Portfolio already exists")
        return created
# @router.post("/")
# async def addnew(data):

@router.post("/")
def add_stock(stock: StockCreate):
    holdings = get_collection("holdings")
    result = holdings.insert_one(stock.dict())
    return {"inserted_id": str(result.inserted_id)}

# @router.post("/login")
# async def login_user():
#     return {"message": "Logged in"}