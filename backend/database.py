from pymongo import MongoClient, errors
from dotenv import load_dotenv
import os
import certifi

cr = certifi.where()
load_dotenv()

mongo_connection_string = os.getenv("MONGO_URI")
if not mongo_connection_string:
    raise ValueError("MONGO_URI is not set in the environment variables.")

client = None
db = None

try:
    # Initialize MongoClient with the URI
    client = MongoClient(
        mongo_connection_string,
        tlsCAFile=cr,
        serverSelectionTimeoutMS=10000  # Increased timeout
    )

    # Test the connection
    client.admin.command('ismaster')
    print("[OK] MongoDB connection established")
except errors.OperationFailure as e:
    print(f"[WARN] MongoDB authentication failed: {e}")
    print("   Continuing without database — some features will be disabled")
except Exception as e:
    print(f"[WARN] MongoDB connection failed: {e}")
    print("   Continuing without database — some features will be disabled")

if client is not None:
    db = client['investment_app']

def get_db():
    return db

def close_connection():
    """Close the MongoDB client connection."""
    global client
    if client is not None:
        client.close()
        print("[OK] MongoDB connection closed")
        client = None

def get_collection(name):
    if db is None:
        raise RuntimeError("Database not available")
    return db[name]

def list_collections():
    """List all collection names in the database (excluding system collections)."""
    if db is None:
        return []
    return [name for name in db.list_collection_names() if not name.startswith('system.')]




