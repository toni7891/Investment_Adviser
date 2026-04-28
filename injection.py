import pandas as pd
from pymongo import MongoClient
import sys
import certifi

cr = certifi.where()
def inject_portfolio_data(file_path):
    # 1. Connection Settings
    # Change the connection string if your MongoDB is hosted (e.g., MongoDB Atlas)
    MONGO_URI = "mongodb+srv://toni7891:tony2004@flaskapiproject.kjfzyts.mongodb.net/?appName=FlaskApiProject"
    DB_NAME = "investment_app"
    COLLECTION_NAME = "4RCH3R_history"

    try:
        # 2. Load the Excel file
        print(f"Reading {file_path}...")
        df = pd.read_excel(file_path)

        # Basic validation: Check if required columns exist
        required_cols = ["date", "total_value", "invested_value", "cash_value"]
        if not all(col in df.columns for col in required_cols):
            print(f"Error: Excel must contain headers: {required_cols}")
            return

        # 3. Convert DataFrame to List of Dicts (JSON format)
        # We ensure dates are strings to match your FastAPI isoformat() logic
        df['date'] = df['date'].astype(str)
        data_to_inject = df.to_dict(orient='records')

        # 4. Connect and Insert
        client = MongoClient(MONGO_URI, tlsCAFile=cr, serverSelectionTimeoutMS=10000)
        db = client[DB_NAME]
        collection = db[COLLECTION_NAME]

        # Optional: Clear existing history before fresh injection
        # collection.delete_many({}) 

        result = collection.insert_many(data_to_inject)
        
        print("--- Success ---")
        print(f"Inserted {len(result.inserted_ids)} snapshots into '{COLLECTION_NAME}'")
        client.close()

    except FileNotFoundError:
        print("Error: The file '4RCH3R_history.xlsx' was not found.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    # Ensure you have the file in the same directory
    inject_portfolio_data("4RCH3R_history.xlsx")