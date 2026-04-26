"""Inspect yfinance download structure for multiple tickers."""
import yfinance as yf
import pandas as pd

tickers = ["AAPL", "GOOGL", "MSFT"]
data = yf.download(tickers, period="5d", progress=False)
print("Type:", type(data))
print("Columns type:", type(data.columns))
print("Columns sample:", list(data.columns)[:10])
print("Empty?", data.empty)
print("Shape:", data.shape)
if isinstance(data.columns, pd.MultiIndex):
    print("Level 0 unique:", data.columns.get_level_values(0).unique().tolist())
    for t in tickers:
        try:
            df_t = data[t]
            print(f"\n{t}: shape={df_t.shape}, empty={df_t.empty}")
            if not df_t.empty:
                print(f"  last close: {df_t['Close'].iloc[-1]}")
        except Exception as e:
            print(f"\n{t}: error - {e}")
