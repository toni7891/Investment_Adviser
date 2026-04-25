from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
import sys
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.append(str(current_dir))

try:
    import routes
except ImportError:
    from backend import routes

app = FastAPI()

app.include_router(routes.router, prefix="/api", tags=["api"])
@app.on_event("startup")
def on_startup():
    print("Backend server starting up...")


@app.get("/status", response_model=dict, include_in_schema=True)
async def status():
    return {"status": "online"}

app.add_middleware(
    CORSMiddleware,
    # Allow common local development origins; widen for local testing
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000", "http://127.0.0.1:8000"],
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
app.mount("/static", StaticFiles(directory="frontend/public/static"), name="static")


@app.get("/", include_in_schema=False)
async def serve_index():
    index_path = static_dir / "index.html"
    return FileResponse(str(index_path))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

    