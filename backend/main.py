# Ref: [[routes.py]] [[database.py]] [[search.py]] [[PROJECT_MAP.md]]
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from datetime import datetime, timezone
import os
import sys
import logging
import secrets
import warnings

def _load_ssm_secrets():
    try:
        import boto3
        ssm    = boto3.client("ssm", region_name=os.getenv("BEDROCK_REGION", "us-east-1"))
        kwargs = {"Path": "/investment-manager/", "WithDecryption": True, "MaxResults": 10}
        total  = 0
        while True:
            resp = ssm.get_parameters_by_path(**kwargs)
            for p in resp["Parameters"]:
                key = p["Name"].split("/")[-1]
                os.environ.setdefault(key, p["Value"])
                total += 1
            next_token = resp.get("NextToken")
            if not next_token:
                break
            kwargs["NextToken"] = next_token
        print(f"[SSM] Loaded {total} secrets from SSM Parameter Store", flush=True)
    except Exception as e:
        print(f"[SSM] Load skipped: {e}", flush=True)

_load_ssm_secrets()

logger = logging.getLogger(__name__)

# Suppress ResourceWarning about unclosed SQLite databases from third-party libraries
# These are harmless and come from dependencies we don't control
warnings.filterwarnings("ignore", category=ResourceWarning, message="unclosed database*")

current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.append(str(current_dir))

try:
    import routes
except ImportError:
    from backend import routes

app = FastAPI()

app.include_router(routes.router, prefix="/api", tags=["api"])

def _seed_admin():
    try:
        from database import db
        from auth import hash_password
        if db is None:
            return
        if db["users"].find_one({"role": "admin"}):
            return
        initial_password = secrets.token_urlsafe(16)
        db["users"].insert_one({
            "username":              "admin",
            "password_hash":         hash_password(initial_password),
            "role":                  "admin",
            "force_password_change": True,
            "token_version":         0,
            "created_at":            datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        })
        print(f"\n{'='*60}")
        print("  Admin account created.")
        print("  Username: admin")
        print(f"  Password: {initial_password}")
        print("  Change this password on first login.")
        print(f"{'='*60}\n")
    except Exception as e:
        logger.error("Admin seed failed: %s", e)


def _ensure_indexes():
    try:
        from database import db
        if db is None:
            return
        db["users"].create_index("username", unique=True)
        db["portfolio_metadata"].create_index("portfolio_id", unique=True)
        db["portfolio_metadata"].create_index("owner_username")
    except Exception as e:
        logger.warning("Index creation skipped (may already exist): %s", e)


def _setup_cloudwatch_logging():
    log_group = os.getenv("CLOUDWATCH_LOG_GROUP")
    if not log_group:
        return
    try:
        import watchtower
        import boto3 as _boto3
        cw_client = _boto3.client("logs", region_name=os.getenv("BEDROCK_REGION", "us-east-1"))
        handler = watchtower.CloudWatchLogHandler(
            log_group=log_group,
            stream_name="fastapi",
            boto3_client=cw_client,
        )
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        logging.getLogger().addHandler(handler)
        logger.info("CloudWatch logging enabled → %s", log_group)
    except Exception as e:
        logger.warning("CloudWatch logging setup failed: %s", e)


@app.on_event("startup")
def on_startup():
    logger.info("Backend server starting up...")
    _setup_cloudwatch_logging()
    _seed_admin()
    _ensure_indexes()

@app.on_event("shutdown")
def on_shutdown():
    """Close all database connections cleanly on shutdown."""
    # Close MongoDB connection if available
    try:
        from database import close_connection
        close_connection()
    except Exception as e:
        logger.error("Error during shutdown cleanup: %s", e)


@app.get("/status", response_model=dict, include_in_schema=True)
async def status():
    return {"status": "online"}

_cors_raw = os.getenv("CORS_ORIGINS", "")
_cors_origins = (
    [o.strip() for o in _cors_raw.split(",") if o.strip()]
    if _cors_raw.strip()
    else [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# Serve frontend static files from the `frontend/public` directory at /static
# Resolve path relative to the project root (two levels up from this file)
project_root = Path(__file__).resolve().parent.parent
static_dir = project_root / "frontend" / "public"
if not static_dir.exists():
    # Fall back to a sibling path if run from repo root
    static_dir = Path.cwd() / "frontend" / "public"
    
# This line tells FastAPI where to find your files
app.mount("/static", StaticFiles(directory=str(static_dir / "static")), name="static")


@app.get("/", include_in_schema=False)
async def serve_landing():
    return FileResponse(str(static_dir / "landing.html"))

@app.get("/app", include_in_schema=False)
async def serve_index():
    return FileResponse(str(static_dir / "index.html"))

@app.get("/dashboard", include_in_schema=False)
async def serve_dashboard():
    dashboard_path = static_dir / "dashboard.html"
    return FileResponse(str(dashboard_path))

@app.get("/login", include_in_schema=False)
async def serve_login():
    login_path = static_dir / "login.html"
    return FileResponse(str(login_path))

if __name__ == "__main__":
    import uvicorn
    # Timeout configuration for long-running AI requests (5 minutes)
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        timeout_keep_alive=300,  # Keep connections alive for 5 minutes
        log_level="info"
    )

    