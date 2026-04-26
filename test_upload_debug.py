"""
Test upload parser to reproduce bug.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from io import BytesIO
import pandas as pd

# Create a test Excel file matching README spec
data = {
    'A': ['My Portfolio', '', 'Cash', '', 'stock ticker', 'AAPL', 'GOOGL', 'MSFT'],
    'B': ['', '', '10000', '', 'num of shares', '10', '5', '3'],
    'C': ['', '', '', '', 'avg price', '150', '2800', '400'],
}
df = pd.DataFrame(data)
bio = BytesIO()
with pd.ExcelWriter(bio, engine='openpyxl') as w:
    df.to_excel(w, sheet_name='Portfolio', index=False, header=False)
bio.seek(0)

from backend.routes import _parse_portfolio_upload
name, cash, stocks = _parse_portfolio_upload(bio.read())
print(f"Portfolio: {name}")
print(f"Cash: {cash}")
print(f"Stocks: {stocks}")
print(f"Count: {len(stocks)}")
