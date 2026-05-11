# AWS Deployment Plan — Investment Manager (4RCH3R)

## Overview

Deploy the app to AWS so it's accessible from anywhere, as cheaply as possible. The strategy is a single EC2 t3.micro instance running FastAPI behind Nginx, with MongoDB Atlas staying in the cloud as-is, and Groq (free tier) replacing LM Studio for AI chat.

```
Browser → EC2 Elastic IP → Nginx (port 80/443) → FastAPI (port 8000) → MongoDB Atlas
                                                                       → Groq API (AI chat)
```

**Estimated cost: $0 for year 1 (free tier), ~$8.50/month after.**

---

## Why These Choices

| Component | Choice | Reason |
|-----------|--------|--------|
| Compute | EC2 t3.micro | Free tier 12 months, ~$8.50/mo after. Enough RAM for FastAPI + deps. |
| Database | MongoDB Atlas M0 | Already cloud-hosted, free forever, no migration needed. |
| AI/LLM | Groq API | LM Studio is a desktop app — can't run in the cloud. Groq is free, fast, and OpenAI-compatible so the existing code needs only a small change. |
| AI/LLM (premium alt) | AWS Bedrock | Use Claude 3.5 Haiku or any Bedrock model instead of Groq. Pay-per-token (~$0.80/1M input tokens for Haiku), no rate limits, no third-party dependency, integrates natively with IAM. See Step 15. |
| Reverse proxy | Nginx | Handles the 300s AI chat timeout, file upload size limits, and future SSL. |
| Process manager | systemd | Keeps the app running, auto-restarts on crash, loads `.env` automatically. |
| SSL | Let's Encrypt (Certbot) | Free, auto-renewing. Only needed if you have a domain. |

---

## Code Changes Needed

Three small changes to the codebase before deploying.

### 1. `backend/main.py` — Make CORS configurable

The CORS origins are currently hardcoded to localhost. On EC2, the app will be served from a different IP/domain, so requests from the browser will be blocked.

Replace the hardcoded list with an env-var-driven one:

```python
import os

_raw = os.getenv("CORS_ORIGINS", "")
_cors_origins = (
    [o.strip() for o in _raw.split(",") if o.strip()]
    if _raw.strip()
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
```

In production, set `CORS_ORIGINS=http://<elastic-ip>` (or `https://yourdomain.com`) in `.env`.

### 2. `backend/routes.py` — Groq API key + configurable model name

Groq requires an `Authorization: Bearer <key>` header (LM Studio doesn't). Also, Groq rejects `"*"` as a model name — it must be a real model string.

**Spot A** — add two new env vars near the existing LLM config block (~line 306):
```python
LM_STUDIO_MODEL = os.getenv("LM_STUDIO_MODEL", "*")
GROQ_API_KEY    = os.getenv("GROQ_API_KEY", "")
# Update AI_MODEL to use LM_STUDIO_MODEL instead of hardcoded "*"
```

**Spot B** — inside `call_ai_backend()` (~line 349), inject the auth header when a key is present:
```python
headers = {"Content-Type": "application/json", "Accept": "application/json"}
if GROQ_API_KEY:
    headers["Authorization"] = f"Bearer {GROQ_API_KEY}"
```

### 3. `backend/routes.py` — Bedrock backend (skip if using Groq)

If you choose AWS Bedrock over Groq, the existing OpenAI-compatible `call_ai_backend()` won't work — Bedrock uses the boto3 SDK, not an HTTP endpoint. Add a new backend branch:

**Spot A** — add a new env var and boto3 import near the top of `routes.py`:
```python
import boto3, json as _json
BEDROCK_MODEL   = os.getenv("BEDROCK_MODEL", "anthropic.claude-3-5-haiku-20241022-v1:0")
BEDROCK_REGION  = os.getenv("BEDROCK_REGION", "us-east-1")
```

**Spot B** — inside `call_ai_backend()`, add a new branch before the existing `if LLM_BACKEND == "lmstudio"` check:
```python
if LLM_BACKEND == "bedrock":
    client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
    body = _json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": prompt}],
    })
    response = client.invoke_model(modelId=BEDROCK_MODEL, body=body)
    result = _json.loads(response["body"].read())
    return result["content"][0]["text"]
```

No API key is needed — Bedrock authenticates via the IAM Role you attach to the EC2 instance (see Step 15).

---

### 4. `Dockerfile` (new file) — Optional but future-proof

Not required for the initial EC2 deploy (systemd handles it), but creates a path to ECS/Fargate later.

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y gcc libffi-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y customtkinter CTkTable darkdetect pywinstyles || true

COPY . .

EXPOSE 8000

CMD ["python", "backend/main.py"]
```

> Note: `customtkinter`, `CTkTable`, `darkdetect`, and `pywinstyles` are desktop GUI libraries in `requirements.txt` that aren't used by FastAPI. Removing them saves RAM on the 1 GB t3.micro.

---

## Step-by-Step Deployment

### Step 1 — Create an AWS Account (if you don't have one)

1. Go to [aws.amazon.com](https://aws.amazon.com) and click **Create an AWS Account**
2. Enter your email, choose a root account password, and pick an account name (e.g. `investment-manager`)
3. Enter billing info — a credit card is required, but you won't be charged during the free tier period
4. Choose the **Basic (free) support plan**
5. After signup, go to the **AWS Management Console** at [console.aws.amazon.com](https://console.aws.amazon.com)
6. In the top-right corner, select your preferred **region** (e.g. `us-east-1 N. Virginia` — cheapest and most services available)

> **Tip:** Bookmark the console. You'll be coming back here often.

---

### Step 2 — Launch EC2 Instance

EC2 is AWS's virtual machine service. You'll create one small server (t3.micro) that runs your app.

1. In the AWS Console search bar, type **EC2** and click it
2. Click **Launch Instance** (orange button, top right)
3. Fill in the fields:
   - **Name:** `investment-manager`
   - **AMI (Amazon Machine Image):** Search for `Ubuntu` → select **Ubuntu Server 22.04 LTS (HVM), SSD Volume Type** — make sure it says "Free tier eligible"
   - **Instance type:** `t3.micro` — look for the "Free tier eligible" badge
   - **Key pair (login):** Click **Create new key pair**
     - Name it `investment-manager-key`
     - Type: RSA, format: `.pem`
     - Click **Create key pair** — the `.pem` file downloads automatically. **Save it somewhere safe — you can't download it again.**
   - **Network settings:** Click **Edit** (top right of the section)
     - Leave VPC and subnet as defaults
     - **Firewall (security groups):** Select **Create security group**
     - Check **Allow SSH traffic** — change the source dropdown from `Anywhere` to **My IP** (important: this restricts SSH to only your home IP)
     - Check **Allow HTTP traffic from the internet**
     - Check **Allow HTTPS traffic from the internet**
   - **Storage:** Leave at 8 GB gp3 (free tier allows up to 30 GB)
4. Click **Launch Instance** (bottom right)
5. Click **View all instances** — wait ~1 minute until the Instance State shows **running** and Status Check shows **2/2 checks passed**

---

### Step 3 — Allocate and Attach an Elastic IP

By default, EC2 instances get a new public IP every time they restart. An Elastic IP locks in a permanent IP address for free (as long as it stays attached to a running instance).

1. In the left sidebar, scroll down to **Network & Security → Elastic IPs**
2. Click **Allocate Elastic IP address** → **Allocate**
3. You'll see a new IP (e.g. `54.123.45.67`) — copy it, you'll use it everywhere
4. Select that IP → **Actions → Associate Elastic IP address**
5. Under **Instance**, select your `investment-manager` instance → **Associate**

Your EC2 instance now has a permanent public IP. This is the address you'll use to SSH in, visit the app, and set up DNS.

---

### Step 4 — SSH Into the Server

This is how you connect to your EC2 instance from your Mac terminal.

```bash
# Move your key to a standard location and lock down permissions
mv ~/Downloads/investment-manager-key.pem ~/.ssh/
chmod 400 ~/.ssh/investment-manager-key.pem

# Connect (replace with your actual Elastic IP)
ssh -i ~/.ssh/investment-manager-key.pem ubuntu@<elastic-ip>
```

You should see a welcome message from Ubuntu. You're now inside your EC2 server.

> **Tip:** If you get "Connection timed out", your IP may have changed since you set the security group rule. Go to EC2 → Security Groups → find your group → edit the SSH inbound rule → set source to **My IP** again.

---

### Step 5 — Install Server Dependencies

Run these commands inside your SSH session:

```bash
# Update the package list and upgrade existing packages
sudo apt update && sudo apt upgrade -y

# Install Python 3.11, pip, git, and Nginx
sudo apt install -y python3.11 python3.11-venv python3-pip git nginx

# Verify Python installed correctly
python3.11 --version
# Expected: Python 3.11.x
```

---

### Step 6 — Push Your Code to GitHub (if not already done)

You need a way to get your code onto the server. GitHub is the easiest path.

**On your local machine** (not SSH):

```bash
# From your project directory
cd /Users/tonyverin/Desktop/investment_manager

# Initialize git if needed
git init
git add .
git commit -m "Initial commit"

# Create a repo on github.com, then:
git remote add origin https://github.com/<your-username>/investment-manager.git
git push -u origin main
```

Make sure `.env` is in your `.gitignore` — it contains secrets and must never be committed:

```bash
echo ".env" >> .gitignore
git add .gitignore && git commit -m "Add .gitignore"
git push
```

---

### Step 7 — Clone the App onto EC2

Back in your SSH session:

```bash
# Clone your repo into the ubuntu home directory
git clone https://github.com/<your-username>/investment-manager.git /home/ubuntu/investment_manager
cd /home/ubuntu/investment_manager

# Create a Python virtual environment
python3.11 -m venv venv

# Activate it
source venv/bin/activate

# Install all dependencies
pip install -r requirements.txt

# Remove desktop GUI packages that waste RAM on the server
pip uninstall -y customtkinter CTkTable darkdetect pywinstyles
```

> **What's a venv?** A virtual environment is an isolated Python install just for this project. It means the app's packages won't conflict with system Python packages.

---

### Step 8 — Create the `.env` File on the Server

The `.env` file holds your secrets and config. It must be created directly on the server — never committed to git.

```bash
nano /home/ubuntu/investment_manager/.env
```

Paste in the following (fill in your real values):

```env
MONGO_URI=mongodb+srv://<user>:<password>@flaskapiproject.kjfzyts.mongodb.net/?appName=FlaskApiProject
LLM_BACKEND=lmstudio
LM_STUDIO_API_URL=https://api.groq.com/openai/v1/chat/completions
LM_STUDIO_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
CORS_ORIGINS=http://<elastic-ip>
SSL_VERIFY=true
```

Save and exit: **Ctrl+O → Enter → Ctrl+X**

Lock down the file so only the ubuntu user can read it:

```bash
chmod 600 /home/ubuntu/investment_manager/.env
```

> `LLM_BACKEND=lmstudio` keeps the existing code path — we're just pointing `LM_STUDIO_API_URL` at Groq's endpoint. No code path changes needed, just the env var values.

---

### Step 9 — Allow MongoDB Atlas to Accept Connections from EC2

MongoDB Atlas has an IP whitelist. By default it blocks all connections. You need to add your Elastic IP.

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) → your project → **Network Access** (left sidebar)
2. Click **Add IP Address**
3. Enter your Elastic IP (e.g. `54.123.45.67/32`) — the `/32` means exactly this one IP
4. Add a comment like `EC2 investment-manager`
5. Click **Confirm** — takes ~30 seconds to activate

> **Alternative:** Click **Allow Access from Anywhere** (`0.0.0.0/0`) if you just want it to work immediately and aren't worried about restricting access. Fine for a personal app.

---

### Step 10 — Create a Systemd Service

Systemd is Linux's process manager. It will start your app automatically on boot and restart it if it crashes.

Create the service file:

```bash
sudo nano /etc/systemd/system/investment-manager.service
```

Paste in:

```ini
[Unit]
Description=Investment Manager FastAPI App
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/investment_manager
EnvironmentFile=/home/ubuntu/investment_manager/.env
ExecStart=/home/ubuntu/investment_manager/venv/bin/python backend/main.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Save and exit (**Ctrl+O → Enter → Ctrl+X**), then enable and start it:

```bash
# Tell systemd to pick up the new file
sudo systemctl daemon-reload

# Enable it to start on boot
sudo systemctl enable investment-manager

# Start it now
sudo systemctl start investment-manager

# Check it's running
sudo systemctl status investment-manager
```

You should see `Active: active (running)` in green. If it failed, check the logs:

```bash
sudo journalctl -u investment-manager -n 50
```

---

### Step 11 — Configure Nginx as a Reverse Proxy

Nginx sits in front of FastAPI and handles all incoming HTTP requests. It forwards them to FastAPI on port 8000 (which is not publicly exposed directly).

Create the Nginx config:

```bash
sudo nano /etc/nginx/sites-available/investment-manager
```

Paste in:

```nginx
server {
    listen 80;
    server_name <elastic-ip>;   # replace with your domain later if you get one

    # Must exceed the 300s AI chat timeout — without this, Nginx kills the
    # connection after 60s and the user gets a 504 Gateway Timeout
    proxy_read_timeout 310s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 310s;

    # Allows Excel file uploads up to 20 MB
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it and remove the default site:

```bash
# Create a symlink to enable the site
sudo ln -s /etc/nginx/sites-available/investment-manager /etc/nginx/sites-enabled/

# Remove the default Nginx welcome page
sudo rm /etc/nginx/sites-enabled/default

# Test config for syntax errors
sudo nginx -t
# Expected: nginx: configuration file /etc/nginx/nginx.conf test is successful

# Apply the config
sudo systemctl reload nginx
```

---

### Step 12 — Test the App

Open your browser and visit `http://<elastic-ip>` — you should see the investment manager landing page.

Also test the API from your local terminal:

```bash
# Health check
curl http://<elastic-ip>/status
# Expected: {"status":"online"}

# Portfolio list (confirms MongoDB is connected)
curl http://<elastic-ip>/api/portfolios/list
```

If the UI loads but the API returns errors, check logs:

```bash
sudo journalctl -u investment-manager -f
```

---

### Step 13 — Set Up Groq API for AI Chat

LM Studio is a desktop app and can't run in the cloud. Groq is a free, fast, OpenAI-compatible API that works as a drop-in replacement.

1. Go to [console.groq.com](https://console.groq.com) and sign up (no credit card needed)
2. Click **API Keys → Create API Key** — copy it immediately (only shown once)
3. On the server, edit your `.env`:
   ```bash
   nano /home/ubuntu/investment_manager/.env
   ```
   Update the Groq key:
   ```env
   GROQ_API_KEY=gsk_your_actual_key_here
   ```
4. Restart the app to pick up the new key:
   ```bash
   sudo systemctl restart investment-manager
   ```
5. Test AI chat from the dashboard — first response should come back in 2–5 seconds

**Groq free tier limits:** ~14,400 requests/day on `llama-3.3-70b-versatile` — plenty for personal use.

---

### Step 14 — SSL via Let's Encrypt (Optional, requires a domain)

Skip this step if you're using just the Elastic IP. Come back to it after you have a domain.

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get and install the certificate (replace with your real domain)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot will:
- Verify you own the domain (via HTTP challenge)
- Install the SSL certificate
- Edit the Nginx config to redirect HTTP → HTTPS
- Set up auto-renewal via a systemd timer (certs expire every 90 days)

After SSL is active, update `.env`:

```bash
nano /home/ubuntu/investment_manager/.env
# Change:
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

```bash
sudo systemctl restart investment-manager
```

Test: visit `https://yourdomain.com` — the browser should show a padlock.

---

### Step 15 — AWS Bedrock (Alternative to Groq)

Use this step instead of Step 13 if you want to run the AI chat via AWS Bedrock (e.g. Claude 3.5 Haiku) rather than Groq. Bedrock has no free tier but costs pennies for personal use, has no daily rate limits, and keeps all traffic inside AWS with no third-party API key to manage.

#### 15a — Enable Bedrock Model Access

1. In the AWS Console, search for **Bedrock** and click it
2. In the left sidebar click **Model access → Manage model access**
3. Find **Anthropic → Claude 3.5 Haiku** (or another model you want) and click **Request model access**
4. Accept the EULA — access is usually granted within seconds
5. Copy the **Model ID** shown (e.g. `anthropic.claude-3-5-haiku-20241022-v1:0`) — you'll put this in `.env`

> **Model options and pricing (us-east-1):**
> | Model | Input | Output | Notes |
> |-------|-------|--------|-------|
> | Claude 3.5 Haiku | $0.80/1M tokens | $4/1M tokens | Fast, cheap, best default |
> | Claude 3.5 Sonnet | $3/1M tokens | $15/1M tokens | Smarter, slower |
> | Claude 3 Opus | $15/1M tokens | $75/1M tokens | Most capable, most expensive |
>
> For a personal portfolio app making ~50 chat requests/day at ~2,000 tokens each, Haiku costs **<$0.01/day**.

#### 15b — Create an IAM Role for Bedrock Access

No API key is needed — Bedrock authenticates via the EC2 instance's IAM Role.

1. Go to **IAM → Roles → Create role**
2. Trusted entity type: **AWS service** → Use case: **EC2** → Next
3. Search for and attach the policy **AmazonBedrockFullAccess** (or create a custom policy scoped to just your model — see below)
4. Name the role `investment-manager-ec2` → **Create role**

**Tighter custom policy (optional, recommended):**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-haiku*"
    }
  ]
}
```

5. Attach the role to your EC2 instance: **EC2 → select instance → Actions → Security → Modify IAM Role → select `investment-manager-ec2` → Update IAM Role**

#### 15c — Update `.env` on the Server

```bash
nano /home/ubuntu/investment_manager/.env
```

Change the LLM-related lines to:

```env
LLM_BACKEND=bedrock
BEDROCK_MODEL=anthropic.claude-3-5-haiku-20241022-v1:0
BEDROCK_REGION=us-east-1
```

Remove (or leave blank) `LM_STUDIO_API_URL`, `LM_STUDIO_MODEL`, and `GROQ_API_KEY` — they are unused with the Bedrock backend.

#### 15d — Install boto3 and Restart

boto3 is likely already in your venv (it's a dependency of the AWS CloudWatch and S3 steps), but verify:

```bash
source /home/ubuntu/investment_manager/venv/bin/activate
pip install boto3
sudo systemctl restart investment-manager
```

#### 15e — Test

Open the dashboard and send a chat message. Check logs if it fails:

```bash
sudo journalctl -u investment-manager -n 50
```

Common errors:
- `AccessDeniedException` — the IAM Role isn't attached, or the model isn't enabled in Bedrock model access
- `ValidationException` — the model ID in `.env` doesn't match what Bedrock expects (copy it exactly from the Bedrock console)
- `ResourceNotFoundException` — the model ID is correct but access wasn't granted yet (wait 1–2 minutes after requesting access)

---

## Verification

```bash
# Health check
curl http://<elastic-ip>/status
# Expected: {"status":"online"}

# Portfolio list (confirms MongoDB connection)
curl http://<elastic-ip>/api/portfolios/list

# Full UI
# Open browser → http://<elastic-ip>

# Watch logs
sudo journalctl -u investment-manager -f
```

---

## Cost Breakdown

| Service | Details | Monthly Cost |
|---------|---------|-------------|
| EC2 t3.micro | Free tier (first 12 months) | $0 |
| EC2 t3.micro | After free tier | ~$8.50 |
| EBS storage (8 GB gp3) | Included in 30 GB free tier | $0 |
| Elastic IP | Free when attached to running instance | $0 |
| Data transfer | First 100 GB/month outbound free | $0 |
| MongoDB Atlas M0 | Free tier, forever | $0 |
| Groq API | Free tier (14,400 req/day) | $0 |
| AWS Bedrock (alt) | Claude 3.5 Haiku, ~50 req/day @ ~2K tokens — no free tier | ~$0.25/mo |
| Let's Encrypt SSL | Free | $0 |
| Domain (optional) | e.g. Cloudflare .dev | ~$10/year |
| **Year 1 total** | | **~$0** |
| **Year 2+ total** | | **~$8.50/mo** |

---

## Connecting a Namecheap Domain

If you buy a domain from Namecheap, here's how to wire it up to your EC2 instance. No Route 53 needed — just DNS changes in Namecheap.

### 1 — Add DNS Records in Namecheap

Go to **Namecheap → Domain List → Manage → Advanced DNS** and add:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A Record | `@` | `<your-elastic-ip>` | Automatic |
| A Record | `www` | `<your-elastic-ip>` | Automatic |

`@` = root domain (`yourdomain.com`), `www` = `www.yourdomain.com`.

### 2 — Wait for DNS Propagation

Takes 5–30 minutes (up to 24h in rare cases). Verify with:

```bash

dig yourdomain.com
# or
nslookup yourdomain.com
```

### 3 — Update Nginx `server_name`

On EC2, edit `/etc/nginx/sites-available/investment-manager`:

```nginx
server_name yourdomain.com www.yourdomain.com;
```

Then reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4 — Install SSL Certificate

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot edits the Nginx config, installs the cert, and sets up auto-renewal via a systemd timer.

### 5 — Update `.env`

```env
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

```bash
sudo systemctl restart investment-manager
```

After this, the full flow is: **Namecheap DNS → Elastic IP → Nginx (HTTPS) → FastAPI**.

---

## Updating the App

After making code changes locally:

```bash
# On the server
cd /home/ubuntu/investment_manager
git pull
source venv/bin/activate
pip install -r requirements.txt  # only if requirements changed
sudo systemctl restart investment-manager
```

---

## Free-Tier AWS Enhancements

All of the following are free and would add real value to the app. Ordered by ease of implementation.

---

### Amazon SES — Email Alerts
**Free tier:** 3,000 emails/month forever (when sent from EC2)

**What it adds:** Email notifications when your portfolio drops or gains past a threshold, daily portfolio summary emails, trade confirmations. The app currently has no notifications — this is the highest-value addition.

**How to implement:**
1. Go to **AWS Console → SES → Verified Identities → Create Identity**
2. Verify your email address (click the link in the confirmation email)
3. On EC2, install boto3 (already in your venv): `pip install boto3`
4. Add a new route in `backend/routes.py` — `POST /api/notify` — that calls:

```python
import boto3

ses = boto3.client("ses", region_name="us-east-1")
ses.send_email(
    Source="you@yourdomain.com",
    Destination={"ToAddresses": ["you@yourdomain.com"]},
    Message={
        "Subject": {"Data": "Portfolio Alert"},
        "Body": {"Text": {"Data": "Your portfolio changed by X%"}},
    },
)
```

5. Trigger this from the frontend after a position update, or from a Lambda on a schedule (see below)

**Effort:** ~1–2 hours

---

### CloudWatch — Logs & Uptime Alerts
**Free tier:** 5 GB log ingestion/month, 10 alarms, 3 dashboards — all free forever

**What it adds:** Ship FastAPI logs from EC2 to CloudWatch so you can see errors and response times from the AWS console. Set an alarm that emails you if the app goes down. Right now if the app crashes at 3am, you won't know until you check manually.

**How to implement:**

1. Install the CloudWatch agent on EC2:
```bash
sudo apt install -y amazon-cloudwatch-agent
```

2. Create an IAM Role for EC2 with the `CloudWatchAgentServerPolicy` managed policy and attach it to your instance (EC2 → Actions → Security → Modify IAM Role)

3. Create the agent config:
```bash
sudo nano /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
```
```json
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/syslog",
            "log_group_name": "investment-manager",
            "log_stream_name": "syslog"
          }
        ]
      }
    }
  }
}
```

4. Start the agent:
```bash
sudo systemctl start amazon-cloudwatch-agent
sudo systemctl enable amazon-cloudwatch-agent
```

5. In the AWS Console → **CloudWatch → Alarms → Create Alarm** — alert on EC2 `StatusCheckFailed` metric to get emailed when the instance goes down.

**Effort:** ~30 minutes

---

### S3 — Excel Upload Backups
**Free tier:** 5 GB storage, 20,000 GET + 2,000 PUT requests/month for 12 months

**What it adds:** Permanently store every uploaded Excel portfolio file. Right now uploads are parsed in memory and discarded — if someone uploads a portfolio and the server restarts mid-process, the file is gone. S3 gives you a permanent audit trail and lets you re-process files later.

**How to implement:**

1. Go to **AWS Console → S3 → Create Bucket** — name it something like `investment-manager-uploads`, pick the same region as your EC2, leave all other defaults

2. Add `AWS_S3_BUCKET` to your `.env`:
```env
AWS_S3_BUCKET=investment-manager-uploads
AWS_REGION=us-east-1
```

3. In `backend/routes.py`, after parsing the uploaded Excel file in `POST /api/portfolios/upload`, add:
```python
import boto3, uuid

s3 = boto3.client("s3")
s3.upload_fileobj(
    file.file,
    os.getenv("AWS_S3_BUCKET"),
    f"uploads/{uuid.uuid4()}_{file.filename}"
)
```

4. Attach an IAM Role to your EC2 instance with `s3:PutObject` permission on that bucket — no access keys needed.

**Effort:** ~1 hour

---

### Lambda + EventBridge — Automatic Daily Snapshots
**Free tier:** 1 million Lambda invocations/month forever

**What it adds:** Run a scheduled Lambda every weekday at market close (4pm ET) that triggers a snapshot for all portfolios — even if nobody opens the app that day. Right now snapshots only record when someone visits the dashboard, so if you don't log in on a day, that day's closing value is lost from your chart history.

**How to implement:**

1. Go to **AWS Console → Lambda → Create Function**
   - Runtime: Python 3.11
   - Name: `investment-manager-snapshot`

2. Paste in the function code:
```python
import urllib.request, json, os

def handler(event, context):
    base_url = os.environ["APP_URL"]  # e.g. https://yourdomain.com

    # Get all portfolios
    with urllib.request.urlopen(f"{base_url}/api/portfolios/list") as r:
        portfolios = json.loads(r.read())

    # Force a snapshot for each one
    for p in portfolios:
        req = urllib.request.Request(
            f"{base_url}/api/portfolios/{p['id']}/snapshot",
            method="POST"
        )
        urllib.request.urlopen(req)

    return {"statusCode": 200, "body": f"Snapshotted {len(portfolios)} portfolios"}
```

3. Add environment variable `APP_URL=https://yourdomain.com` to the Lambda config

4. Go to **EventBridge → Rules → Create Rule**
   - Schedule: `cron(0 21 ? * MON-FRI *)` — 9pm UTC = 4pm ET (adjust for DST)
   - Target: your Lambda function

**Effort:** ~2 hours

---

### SNS — Push / SMS Alerts
**Free tier:** 1 million notifications/month, first 1,000 SMS free

**What it adds:** SMS or push notifications for portfolio alerts ("Down 5% today"). Pairs well with SES and the Lambda above — Lambda checks portfolio value at close, SNS fires the alert to your phone.

**How to implement:**

1. Go to **AWS Console → SNS → Topics → Create Topic** (Standard type)
2. Create a **Subscription** — Protocol: Email or SMS, enter your address/number
3. Confirm the subscription (click link in email or reply to SMS)
4. In your Lambda or a new route, publish an alert:
```python
import boto3

sns = boto3.client("sns", region_name="us-east-1")
sns.publish(
    TopicArn="arn:aws:sns:us-east-1:123456789:investment-alerts",
    Subject="Portfolio Alert",
    Message="Your portfolio dropped 5% today. Current value: $12,450"
)
```

**Effort:** ~1 hour (if SES is already set up)

---

### SSM Parameter Store — Secure Secrets Management
**Free tier:** Free for standard parameters (up to 10,000) forever

**What it adds:** Move your secrets (`MONGO_URI`, `GROQ_API_KEY`) out of the `.env` file on disk and into AWS's encrypted secret store. If your EC2 instance is ever compromised, the attacker gets the server but not the credentials. Parameters are fetched at app startup, not stored in any file.

**How to implement:**

1. Go to **AWS Console → Systems Manager → Parameter Store → Create Parameter**
   - Name: `/investment-manager/MONGO_URI`
   - Type: **SecureString** (encrypts with KMS)
   - Value: your MongoDB URI
   - Repeat for `GROQ_API_KEY` and any other secrets

2. Attach an IAM Role to your EC2 with `ssm:GetParametersByPath` permission on `/investment-manager/*`

3. In `backend/main.py`, fetch secrets at startup before the app loads:
```python
import boto3

def load_secrets_from_ssm():
    ssm = boto3.client("ssm", region_name="us-east-1")
    params = ssm.get_parameters_by_path(
        Path="/investment-manager/",
        WithDecryption=True
    )
    for p in params["Parameters"]:
        key = p["Name"].split("/")[-1]   # e.g. MONGO_URI
        os.environ[key] = p["Value"]

load_secrets_from_ssm()
```

4. Remove the `EnvironmentFile` line from the systemd service and delete the `.env` file from the server

**Effort:** ~1 hour

---

### Recommended Order to Implement

| Priority | Service | Why |
|----------|---------|-----|
| 1 | CloudWatch | Know immediately when the app goes down |
| 2 | SES | Daily portfolio summary email is genuinely useful |
| 3 | SSM Parameter Store | Security hardening, easy to do |
| 4 | Lambda + EventBridge | Fix the missing-snapshot problem for days you don't log in |
| 5 | S3 | Nice-to-have audit trail for uploads |
| 6 | SNS | Add after SES is working, reuses the same alert logic |

---

## Step 16 — CloudWatch Logs (Python handler)

Ships FastAPI log records directly to CloudWatch via the `watchtower` library. No CloudWatch agent required — works through the same IAM Role already attached to EC2.

**What you get:** Every `logger.info/warning/error` call in the app appears in CloudWatch Logs → Log Groups → `/investment-manager/app` → `fastapi` stream. Browse errors from the AWS console without SSH.

### 16a — IAM Role: add Logs permissions

Go to **IAM → Roles → `investment-manager-ec2` → Add permissions → Attach policies**.
Search for and attach **`CloudWatchLogsFullAccess`**.

Or add this inline policy for minimal scope:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
    "Resource": "arn:aws:logs:us-east-1:*:log-group:/investment-manager/*"
  }]
}
```

### 16b — SSM Parameter

Go to **Systems Manager → Parameter Store → Create Parameter**:

| Field | Value |
|-------|-------|
| Name | `/investment-manager/CLOUDWATCH_LOG_GROUP` |
| Type | String |
| Value | `/investment-manager/app` |

### 16c — Install watchtower and restart

```bash
source /home/ubuntu/investment_manager/venv/bin/activate
pip install "watchtower>=3.0.0"
sudo systemctl restart investment-manager
```

### 16d — Verify

1. AWS Console → **CloudWatch → Log Groups** → look for `/investment-manager/app`
2. Click it → click the `fastapi` stream → you should see startup log lines
3. Make a chat request or load a portfolio — new log entries appear within seconds

### 16e — Optional: Uptime alarm

1. AWS Console → **CloudWatch → Alarms → Create Alarm**
2. Metric: **EC2 → Per-Instance Metrics → StatusCheckFailed**
3. Threshold: `>= 1` for 1 data point
4. Action: **Send notification to SNS topic** → create a topic → subscribe your email
5. You'll get an email if the instance goes down

---

## Step 17 — SES Portfolio Alerts

Sends an email when a portfolio's daily change exceeds a configurable percentage threshold. Fires at most once per portfolio per day (cooldown enforced in memory). Works via the same IAM Role — no API key needed.

**What you get:** An email like `[4RCH3R] Portfolio alert: MyPortfolio — up 6.41% today (threshold: 5.0%)` when the market moves sharply.

### 17a — Verify your email in SES

1. AWS Console → **SES → Verified Identities → Create Identity**
2. Select **Email address** → enter `toni7891@gmail.com`
3. Click **Create Identity** → check your inbox → click the confirmation link

> **Note:** New SES accounts are in **sandbox mode** — you can only send to verified addresses. For a personal app (sending to yourself) this is fine as-is. To send to anyone, go to **SES → Account dashboard → Request production access**.

### 17b — IAM Role: add SES permission

Go to **IAM → Roles → `investment-manager-ec2` → Add permissions → Create inline policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ses:SendEmail", "ses:SendRawEmail"],
    "Resource": "*"
  }]
}
```

### 17c — SSM Parameters

Add three new parameters in **Systems Manager → Parameter Store**:

| Name | Type | Value |
|------|------|-------|
| `/investment-manager/ALERT_ENABLED` | String | `true` |
| `/investment-manager/ALERT_EMAIL` | String | `toni7891@gmail.com` |
| `/investment-manager/ALERT_THRESHOLD_PCT` | String | `5.0` |

`ALERT_THRESHOLD_PCT` is the absolute daily change % that triggers the alert (e.g. `5.0` fires on ±5% days). Lower it to `1.0` for more sensitive alerts.

### 17d — Restart to pick up new parameters

```bash
sudo systemctl restart investment-manager
```

The app reads SSM parameters at startup, so new parameters take effect after a restart.

### 17e — Test

To trigger a test alert without waiting for a big market move:

1. Temporarily set `/investment-manager/ALERT_THRESHOLD_PCT` to `0.01` in SSM
2. Restart the app
3. Open the dashboard and load any portfolio — the GET request fires the alert check
4. Check your inbox within ~30 seconds
5. Set the threshold back to your real value and restart again

```bash
# Confirm the alert fired in app logs:
sudo journalctl -u investment-manager -n 30 | grep -i "ses\|alert"
```

---

## Step 18 — Lambda + EventBridge: Automatic Daily Snapshots

**Problem it solves:** Snapshots only record when someone visits the dashboard. If you don't open the app on a given day, that day's closing value is missing from your chart history.

**Solution:** A Lambda function fires every weekday at 4 pm ET via EventBridge, calls the app's internal snapshot endpoint for every portfolio, and records the market-close value automatically — whether or not anyone logged in.

### 18a — New internal endpoint (code change)

Add a new route to `backend/routes.py` — `POST /api/internal/daily-close` — protected by a shared secret (`X-Internal-Key` header) rather than JWT, so Lambda can call it without a user session. The endpoint:
1. Lists all portfolios in the DB
2. Calls `get_portfolio()` for each one (fetches live prices + records a snapshot)
3. Sends the daily summary email via SES (see Step 19)

Add these env vars via SSM:

| SSM Parameter | Type | Value |
|---|---|---|
| `/investment-manager/INTERNAL_API_KEY` | SecureString | any random 32-char string (`openssl rand -hex 16`) |

### 18b — Lambda function

1. AWS Console → **Lambda → Create Function**
   - Name: `investment-manager-daily-close`
   - Runtime: Python 3.12
   - Architecture: x86_64

2. Paste this function code:
```python
import urllib.request, os, json

def handler(event, context):
    url = os.environ["APP_URL"] + "/api/internal/daily-close"
    key = os.environ["INTERNAL_API_KEY"]
    req = urllib.request.Request(
        url, method="POST",
        headers={"X-Internal-Key": key, "Content-Length": "0"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.loads(r.read())
    print(f"Snapshotted {body['snapshotted']} portfolios")
    return {"statusCode": 200, "body": body}
```

3. Add environment variables to the Lambda config:
   - `APP_URL` = `https://tonyverin.dev`
   - `INTERNAL_API_KEY` = the same value you put in SSM

4. Set **Timeout** to `60` seconds (Configuration → General configuration)

### 18c — EventBridge schedule

1. AWS Console → **EventBridge → Rules → Create Rule**
   - Name: `investment-manager-market-close`
   - Rule type: **Schedule**
   - Schedule: `cron(0 21 ? * MON-FRI *)` — 9 pm UTC = 4 pm ET (adjust +1h during DST: `cron(0 20 ? * MON-FRI *)`)
2. Target: select your `investment-manager-daily-close` Lambda
3. Click **Create**

### 18d — Verify

Check Lambda execution logs after the first scheduled run:
- AWS Console → **Lambda → investment-manager-daily-close → Monitor → View CloudWatch logs**
- Or trigger it manually: **Test → Create test event → { } → Test**

---

## Step 19 — SES Daily Portfolio Summary Email

**What you get:** An email every weekday at market close listing every portfolio's current value and daily change — like a one-glance end-of-day report.

Example email:
```
Subject: [4RCH3R] Daily Summary — 2026-05-11

Daily Portfolio Summary
==============================

  MyPortfolio:   $24,310.50 (+1.83%)
  Crypto:        $8,140.00  (-0.42%)

https://tonyverin.dev/app
```

### 19a — How it works

The daily summary is sent by the same `POST /api/internal/daily-close` endpoint from Step 18, at the end of the snapshot loop. It reuses the existing SES setup (Step 17) and the same `ALERT_EMAIL` SSM parameter — no extra AWS configuration needed beyond Step 17 and 18.

**Prerequisite:** Steps 17 (SES verified identity + IAM) and 18 (Lambda + endpoint) must be complete first.

### 19b — SSM parameters needed (already set in Step 17)

| Parameter | Purpose |
|---|---|
| `ALERT_ENABLED` = `true` | Gates both threshold alerts and the daily summary |
| `ALERT_EMAIL` = `toni7891@gmail.com` | Where the summary is sent |

No new parameters required — the summary email is automatically included in the Step 18 endpoint once `ALERT_ENABLED` is `true`.

### 19c — Disable threshold alerts but keep daily summary (optional)

If you want the daily summary but find the real-time threshold alerts (Step 17) noisy, set `ALERT_THRESHOLD_PCT` to `100.0` in SSM — it will never trigger on normal market moves, but the daily summary at close still sends.
