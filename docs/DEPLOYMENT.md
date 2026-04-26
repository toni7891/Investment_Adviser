# Deployment Guide

Deploy the Investment Adviser application in production or a staging environment.

---

## Prerequisites

- **Python 3.9+**
- **MongoDB** (local instance or Atlas cluster)
- (Optional) **LM Studio** or **Ollama** for AI chat features

---

## 1. Clone & Install

```bash
git clone <your-repo-url>
cd Investment_Adviser
```

Create and activate a virtual environment:

```bash
# On Windows
python -m venv venv
venv\Scripts\Activate.ps1

# On macOS/Linux
python -m venv venv
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
pip install -r backend/requirements-test.txt  # For running tests
```

---

## 2. Environment Configuration

Create a `.env` file in the project root:

```env
# MongoDB connection
MONGO_URI=mongodb://localhost:27017
DB_NAME=investment_db

# LLM backend (optional)
LLM_BACKEND=lmstudio              # or "ollama"
LM_STUDIO_API_URL=http://localhost:1234/v1/chat/completions
OLLAMA_API_URL=http://localhost:11434/v1/chat/completions
OLLAMA_MODEL=llama3

# AI timeout (seconds)
AI_TIMEOUT=300
```

For MongoDB Atlas:
```env
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
```

---

## 3. Database Setup

The application connects to MongoDB automatically on startup. Collections are created per-portfolio on first use. No initial setup needed beyond ensuring MongoDB is running.

To verify connection:

```bash
# Check MongoDB is listening
mongosh --eval "db.adminCommand('ping')"
```

---

## 4. Start LM Studio (Optional — AI Chat)

If you want the AI Strategist to work:

1. Download [LM Studio](https://lmstudio.ai/)
2. Load a local model (e.g. `qwen3-27b...` or `Llama-3-70B-Instruct`)
3. Start the server: Server → Start Server (port 1234)
4. Verify: `curl http://localhost:1234/v1/models`

Alternatively, use Ollama:

```bash
ollama pull llama3
ollama serve
```

Set `LLM_BACKEND=ollama` in `.env`.

---

## 5. Run the Application

### Development (direct)

```bash
# From project root
python app.py

# Or from backend directory
cd backend
python main.py
```

Server starts at `http://127.0.0.1:8000`.

### Production (Gunicorn + Uvicorn workers)

```bash
# Install gunicorn with uvicorn workers
pip install gunicorn uvicorn

# Run with 4 workers
gunicorn app:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
```

### Using Docker (optional)

```dockerfile
# Dockerfile example
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "app.py"]
```

Build and run:

```bash
docker build -t investment-adviser .
docker run -p 8000:8000 --env-file .env investment-adviser
```

---

## 6. Verify Installation

Open `http://localhost:8000` in your browser. The dashboard should load.

Run the smoke tests:

```bash
python run_tests.py
```

Expected output:
```
tests/smoke/test_smoke.py::test_status_endpoint PASSED
tests/smoke/test_smoke.py::test_root_serves_frontend PASSED
...
10 passed in X.XXs
```

---

## 7. Configure for Production

### Reverse Proxy (Nginx)

```nginx
upstream investment_app {
    server 127.0.0.1:8000;
}

server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://investment_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

### Systemd Service (Linux)

Create `/etc/systemd/system/investment-adviser.service`:

```ini
[Unit]
Description=Investment Adviser
After=network.target mongod.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/investment-adviser
EnvironmentFile=/opt/investment-adviser/.env
ExecStart=/opt/investment-adviser/venv/bin/python app.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable investment-adviser
sudo systemctl start investment-adviser
sudo systemctl status investment-adviser
```

---

## 8. Monitoring & Logs

### Application Logs

Logs are printed to stdout/stderr. With systemd:

```bash
journalctl -u investment-adviser -f
```

### Health Checks

Periodically poll `/status`:

```bash
curl -f http://localhost:8000/status || echo "DOWN"
```

Set up monitoring (Prometheus, Grafana, UptimeRobot) to hit `/status` every 30s.

---

## 9. Security Checklist

- [ ] **MongoDB**: Use strong credentials, enable authentication, restrict network access
- [ ] **TLS**: Terminate SSL at the reverse proxy (Nginx/Traefik)
- [ ] ** firewall**: Only expose ports 80/443; keep 8000 internal
- [ ] **.env**: Never commit `.env` to Git; copy `.env.example` and fill secrets
- [ ] **CORS**: Adjust `allow_origins` in `backend/main.py` for your domain
- [ ] **Rate limiting**: Add middleware if public-facing (e.g. `slowapi`)

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `502 Bad Gateway` from AI chat | LM Studio not running or timed out | Start LM Studio, increase `AI_TIMEOUT` |
| Portfolio prices all NaN | yfinance blocked/rate-limited | Check network; add retry logic |
| Collections not found | Wrong `MONGO_URI` or DB name | Verify URI in `.env` |
| `UnicodeEncodeError` on Windows | Non-ASCII chars in logs | Ensure Python console encoding (UTF-8) or use PowerShell |

---`
