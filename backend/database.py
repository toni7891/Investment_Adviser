from pymongo import MongoClient, errors
from dotenv import load_dotenv
import os
import certifi
cr = certifi.where()
load_dotenv()

mongo_connection_string = os.getenv("MONGO_URI")
if not mongo_connection_string:
    raise ValueError("MONGO_URI is not set in the environment variables.")

try:
    # Initialize MongoClient with the URI
    client = MongoClient(mongo_connection_string, tlsCAFile=cr, serverSelectionTimeoutMS=2000)

    # Test the connection to ensure authentication is successful
    client.admin.command('ismaster')

except errors.OperationFailure as e:
    print(f"MongoDB authentication failed: {e}")
    raise

db = client['investment_app']
_db = db
todos_collection = db['portfolios']

def init_db(app):
    global _client, _db
    _client = client
    _db = db

# Retrieve MongoDB URI from environment variables

# Function to get a database instance
def get_db():
    return _db  # Use the properly initialized _db instead of client.investment_app
# Function to close the MongoDB connection
def close_connection():
    client.close()

def get_collection(name):
    return _db[name]

def list_collections():
    """List all collection names in the database (excluding system collections)."""
    return [name for name in _db.list_collection_names() if not name.startswith('system.')]




