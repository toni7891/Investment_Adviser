# Project Summary — 4RCH3R Investment Terminal

> Every claim in this document is grounded in the actual code and
> infrastructure files in this repository. Deployment status is stated
> honestly; see Section 7 for what is live vs. what still needs to be stood up.

---

## 1. Project Name

**4RCH3R Investment Terminal**
Repository: `Investment_Adviser` · GitHub: `github.com/toni7891/Investment_Adviser`

---

## 2. One-Line Description

A full-stack, multi-user portfolio tracker that pulls live market prices,
charts historical performance, and answers portfolio-aware questions through
a pluggable LLM backend (AWS Bedrock / Groq / local LM Studio / Ollama).

---

## 3. Problem It Solves / Use Case

Retail investors typically track holdings in a spreadsheet. Spreadsheets
can't show live prices, can't visualize sector concentration, can't alert
you when a position drops 5% in a day, and they certainly can't answer
"am I over-exposed to tech right now?" in plain English.

4RCH3R replaces the spreadsheet with a browser-based terminal: users log
in, manage multiple portfolios, see every position priced in real time with
P&L and daily change, and interrogate their holdings through an AI
strategist that blends live portfolio data with fresh web search results.

---

## 4. Full Tech Stack

| Layer | Technology (confirmed in code / infra files) |
|-------|----------------------------------------------|
| **Language** | Python 3.11 |
| **Backend framework** | FastAPI + Uvicorn (single worker behind Nginx) |
| **Request validation** | Pydantic v2 models |
| **Database** | MongoDB Atlas — synchronous `pymongo`, TLS via `certifi` |
| **Authentication** | JWT (`python-jose`, HS256) + `passlib`/`bcrypt` |
| **Market data** | `yfinance` — bulk price download, ticker validation, benchmark, stock detail |
| **Sentiment widget** | `fear-and-greed` library (CNN Fear & Greed Index) |
| **Web search** | DuckDuckGo (`ddgs`) with 5-minute in-process TTL cache |
| **AI / LLM** | AWS Bedrock — `bedrock-runtime.converse`, default model: `anthropic.claude-haiku-4-5-20251001-v1:0`; also supports Groq / LM Studio / Ollama via OpenAI-compatible HTTP |
| **Content safety** | AWS Bedrock Guardrails — optional; wired in code via `guardrailConfig` on `converse` |
| **Email / alerting** | AWS SES — `ses.send_email` in `_maybe_send_alert()` and `internal/daily-close` |
| **Observability** | AWS CloudWatch Logs via `watchtower`; CloudWatch Alarm on EC2 health |
| **Secrets management** | AWS SSM Parameter Store — loaded at startup in `backend/main.py`, no `.env` needed in production |
| **Scheduled automation** | AWS Lambda + EventBridge — `POST /api/internal/daily-close` every weekday at 4 pm ET |
| **Data processing** | `pandas` + `openpyxl` — Excel portfolio import and export |
| **Frontend** | Vanilla JavaScript ES modules, HTML, CSS (IBM Plex Mono dark theme) |
| **Charts** | Chart.js — NAV heartrate chart, sector donut, benchmark overlay |
| **Containerization** | Docker (`python:3.11-slim`) — Uvicorn + Nginx managed by Supervisor; `docker-compose.yml`. **Optional/local-only** — EC2 does not run this; see below |
| **Infrastructure as Code** | **Terraform** (AWS provider ~5.0) — fully modularized; S3 remote state + DynamoDB locking |
| **CI/CD** | GitHub Actions — `ci.yml` (lint + test + Docker build/boot smoke check, on every push/PR to `main`) and `cd.yml` (Terraform apply + SSM-based redeploy, fires only on pushed `v*` tags) |
| **Testing** | `pytest` + `mongomock` — 28 smoke tests, no real database required |

---

## 5. Architecture Overview

### Request Flow — Standard API Call

```
Browser
  └─ /api/* ──► FastAPI (backend/main.py)
                  │  startup: SSM secrets → CloudWatch logging
                  │           → seed admin → create Mongo indexes
                  └─ APIRouter (backend/routes.py)
                        ├─ Auth (backend/auth.py): decode JWT, reload user,
                        │    validate token_version + force_password_change
                        ├─ Portfolio CRUD ─► MongoDB (sync pymongo)
                        │    {id}, {id}_history, {id}_trades, portfolio_metadata
                        ├─ Live prices ─► yfinance (cached)
                        ├─ AI chat ─► ddgs web search ─► call_ai_backend()
                        │    └─► AWS Bedrock converse() via run_in_executor
                        │         └─► Guardrail check (if BEDROCK_GUARDRAIL_ID set)
                        ├─ Alerts ─► AWS SES
                        └─ Logs ─► AWS CloudWatch via watchtower
```

### How Bedrock Is Called

`POST /api/chat` is JWT-protected and rate-limited (10 req/min per user).
Each request:

1. Fetches the portfolio with live prices → formats a text summary
2. Runs a DuckDuckGo search on the user's message (5-min cache)
3. Builds `enhanced_prompt = portfolio_summary + web_results + user_question`
4. Calls `boto3.client("bedrock-runtime").converse()` with:
   - `system` param: financial analyst persona (kept separate from user turn
     to avoid triggering the prompt-attack Guardrail filter)
   - `messages`: `[{ role: "user", content: enhanced_prompt }]`
   - `guardrailConfig`: attached when `BEDROCK_GUARDRAIL_ID` is set
   - `inferenceConfig`: `{ maxTokens: 2048 }`
5. The blocking boto3 call runs in `run_in_executor` so it doesn't stall
   the async event loop
6. If `stopReason == "guardrail_intervened"` → HTTP 400 with a clean user message
7. Returns `{ response, model, backend, portfolio_context_included, web_search_used }`

### Automated Daily Snapshot

The `POST /api/internal/daily-close` endpoint (protected by a shared-secret
`X-Internal-Key` header) is designed to be called by a scheduled Lambda.
It lists all portfolios, calls `get_portfolio()` for each (fetching live prices
and recording a market-close NAV snapshot), then sends a daily summary email
via SES.

---

## 6. Key Technical Features

### Authentication & Authorization
- **JWT (HS256)** with 24-hour expiry; secret loaded from SSM at startup
- **Token versioning** — `token_version` integer stored on the user document is
  embedded in the JWT as `tv`; changing a password or username increments it,
  instantly invalidating all outstanding tokens with no blocklist or Redis needed
- **Forced password reset** — seeded admin gets a random `secrets.token_urlsafe(16)`
  password; `force_password_change` flag blocks every route except change-password
- **RBAC** — `user` role limited to their own portfolios via `portfolio_metadata`;
  `admin` bypasses ownership checks

### Secrets Management
- SSM Parameter Store at `/investment-manager/*`; paginated
  `get_parameters_by_path(WithDecryption=True)` at startup — no `.env` on disk
  in production

### IAM Least Privilege (defined in `infra/iam.tf`)
- `ssm:GetParameter*` scoped to `/investment-manager/*` only
- `bedrock:InvokeModel` scoped to the configured model ARN only
- `ses:SendEmail` / `ses:SendRawEmail`
- `logs:PutLogEvents` scoped to `/investment-manager/*` only

### Observability
- `watchtower` CloudWatch handler attached at startup (gated on
  `CLOUDWATCH_LOG_GROUP` env var)
- CloudWatch Alarm on EC2 `StatusCheckFailed` → SNS topic → email
- Every chat request logs `portfolio_id`, `web_search`, message length,
  elapsed time; every Bedrock call logs model ID and region

### Alerting
- `_maybe_send_alert()` — SES email when `|daily_change_pct| > ALERT_THRESHOLD_PCT`;
  deduplicated to one alert per portfolio per calendar day (in-memory)
- `POST /api/internal/daily-close` — sends a daily P&L summary email listing
  every portfolio's closing value and daily change

### Content Safety
- Bedrock Guardrails: High filters for hate/insults/sexual/violence/misconduct/
  prompt-attack; denied topic: illegal financial activity; credit card and bank
  account number redaction
- System prompt moved into `converse`'s `system` parameter (not user turn) to
  prevent it from triggering the prompt-attack filter — a real bug that was
  debugged and fixed (commit `9e4203f`)

### Resilience
- `db = None` on MongoDB connection failure; affected routes return HTTP 503
- yfinance failure → falls back to `average_cost`; delisted tickers don't break loads
- `_with_optional_transaction()` — uses MongoDB session/transaction when available,
  transparently retries without one for standalone Mongo or `mongomock` in tests

### Rate Limiting
- In-memory sliding window on `/api/chat`: 10 requests per 60 seconds per user

### Caching

| Data | TTL |
|------|-----|
| Ticker validation | 1 hour |
| Sector allocation | 1 hour |
| Fear & Greed Index | 1 hour |
| Stock detail | 5 minutes |
| Benchmark prices | 5 minutes |
| Ticker tape | 5 minutes |
| Web search results | 5 minutes |

### Cost Controls
- Default Bedrock model: Claude Haiku 4.5 (cheapest current Anthropic model on Bedrock)
- EC2 `t3.micro` default in Terraform variables (free-tier eligible)
- Lambda, EventBridge, CloudWatch, SES, SSM all within free-tier limits

---

## 7. Deployment Status

**Honest status: the infrastructure is fully written but not yet verified live.**

### What exists and is real right now

| Artifact | Status |
|---------|--------|
| FastAPI backend (~30 endpoints), JWT auth | Complete, 28/28 smoke tests passing |
| Vanilla JS frontend | Complete |
| Docker + `docker-compose.yml` | Complete, build-and-boot verified locally — **optional path, not what EC2 runs** (see below) |
| `infra/` — full Terraform project | **Complete and in the repo** |
| Bedrock, SES, CloudWatch, SSM code | Written and wired in `routes.py` / `main.py`; Bedrock model ID was pointed at a retired model — fixed to the current active one |
| Lambda endpoint (`/api/internal/daily-close`) | Written in `routes.py` |
| Lambda function source (`infra/lambda_src/daily_close.py`) | Written |
| `.github/workflows/ci.yml` | Lint (ruff) + smoke tests + Docker build/boot check, on every push/PR to `main` |
| `.github/workflows/cd.yml` | Terraform apply + SSM-based redeploy — **only fires on pushed `v*` tags**, dormant otherwise |

### Deploy path: bare-metal EC2, not Docker

`infra/templates/userdata.sh.tpl` installs Python 3.11 + nginx directly on the
Amazon Linux 2023 host and runs the app via systemd
(`investment-manager.service`) — it never installs Docker or pulls an image.
The `Dockerfile` / `docker-compose.yml` / `docker/` files are a separate,
working, optional path for running the app in a container locally (or on any
other host); they are not wired into the Terraform EC2 provisioning.

Because `userdata.sh` only runs once at first boot, a plain `terraform apply`
after an app-code change won't update an already-running instance.
`cd.yml`'s `redeploy` job handles this via `aws ssm send-command`
(`git pull` + `systemctl restart`) — the EC2 role already has
`AmazonSSMManagedInstanceCore`, so no SSH or open port is needed for this.

### What still needs to be done to go live

| Step | Effort |
|------|--------|
| Run `cd infra/bootstrap && terraform apply` | ~5 min |
| Copy the bootstrap output into `infra/backend.hcl`, run `terraform init -backend-config=backend.hcl && terraform apply` | ~15 min |
| Point `tonyverin.dev` DNS at the Elastic IP output — **can't happen before this**, the EIP doesn't exist until the first apply | ~5 min + propagation |
| Create a deploy IAM user/role (`ssm:SendCommand`, `ssm:GetCommandInvocation`, plus whatever `terraform apply` needs) for `cd.yml`, separate from the app's own least-privilege EC2 role | ~10 min |
| Add GitHub Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `TF_STATE_BUCKET`, `TF_STATE_DYNAMODB_TABLE`, `TF_VAR_KEY_PAIR_NAME`, `TF_VAR_MONGO_URI`, `TF_VAR_JWT_SECRET_KEY`, `TF_VAR_INTERNAL_API_KEY` (see `cd.yml` header comment for the full/optional list) | ~10 min |

Nothing above has been run yet, by design — this pass focused on making the
code, tests, and pipelines correct and ready, not on provisioning anything.
The `infra/` Terraform project provisions VPC, EC2, Elastic IP, IAM, SSM
parameters, Lambda, EventBridge, CloudWatch log group + alarm, and SNS.
Going live is `terraform apply` + the GitHub Secrets above away.

### Terraform structure

```
infra/
  bootstrap/          # One-time: S3 state bucket + DynamoDB lock table
  lambda_src/         # Lambda Python source (zipped by Terraform at apply)
  templates/          # EC2 userdata templatefile
  versions.tf         # Provider requirements + S3 backend block
  variables.tf        # All inputs with types, defaults, validation
  main.tf             # VPC, subnet, IGW, route table, SG, EC2, EIP
  iam.tf              # EC2 + Lambda roles, all least-privilege inline policies
  ssm.tf              # Every SSM parameter the app reads at startup
  lambda.tf           # Lambda function, EventBridge rule + target, permissions
  cloudwatch.tf       # Log group, SNS topic, EC2 health alarm
  outputs.tf          # public_ip, app_url, ssh_command, log_group, lambda_name
  backend.hcl.example # Template for the gitignored backend.hcl
```

---

## 8. Notable Challenges Solved

**Bedrock Guardrail false positives**
The prompt-attack filter was firing on the app's own system prompt because it
was injected into the user turn — exactly the pattern the filter catches. Fix:
move the system prompt into the dedicated `system` parameter of `converse`,
which Bedrock treats as trusted context (commit `9e4203f`).

**Blocking boto3 in an async app**
`bedrock-runtime.converse` is synchronous. Calling it in an `async def` route
blocks Uvicorn's event loop for the full inference duration. Dispatched via
`run_in_executor`; Nginx and Uvicorn timeouts extended to 310s.

**Token invalidation without a session store**
A `token_version` integer on the user document is embedded as `tv` in the JWT.
Password/username change increments the DB value; every auth check compares them.
One DB write invalidates every outstanding token for a user — no Redis or
blocklist required.

**Transactions that degrade cleanly in tests**
`_with_optional_transaction()` catches `NotImplementedError` from `mongomock`
before any writes occur and retries without a session — real atomicity on Atlas,
clean writes in tests, without separate code paths.

**Single endpoint across four LLM backends**
Bedrock uses boto3 `converse` (structured content blocks); Groq/LM Studio/Ollama
use OpenAI-compatible HTTP with different auth. Both normalize to
`{ choices: [{ message: { content } }] }` — frontend and handler are
backend-agnostic. Switching LLMs is a one-line SSM parameter change.

**Terraform remote state from day one**
Even as a solo project, local Terraform state is a single point of failure.
The `infra/bootstrap/` sub-directory creates a versioned, AES-256-encrypted
S3 bucket with `prevent_destroy = true` and a DynamoDB table for concurrent-apply
locking — standard team-scale practice applied from the start.

---

## 9. Resume-Ready Bullet Points

- **Built a full-stack, multi-user investment terminal** (FastAPI + MongoDB +
  vanilla-JS frontend) with JWT auth, bcrypt hashing, role-based access control,
  and token-version-based session invalidation across 30 REST endpoints — with
  graceful degradation when the database or market data upstream is unavailable.

- **Integrated AWS Bedrock** (Claude 3.5 Haiku via `converse` API) for
  portfolio-aware AI chat, combining live holdings data with DuckDuckGo web
  search into a structured prompt; attached **Bedrock Guardrails** (prompt-attack,
  hate, misconduct filters) and debugged a system-prompt false-positive by moving
  it into the dedicated `system` parameter.

- **Wired full cloud observability and alerting** in code: structured log
  shipping to CloudWatch via `watchtower`, SES threshold alerts and daily EOD
  summary emails, a scheduled Lambda endpoint for automatic market-close
  snapshots, and a CloudWatch Alarm on EC2 `StatusCheckFailed` → SNS.

- **Wrote infrastructure as code in Terraform**: modular layout (`main.tf`,
  `iam.tf`, `ssm.tf`, `lambda.tf`, `cloudwatch.tf`), a bootstrap stack for
  S3 remote state with DynamoDB locking, all IAM policies scoped to least
  privilege, and an EC2 `templatefile` userdata script with optional Let's
  Encrypt SSL provisioning.

---

## Appendix — Repo Facts

| Metric | Value |
|--------|-------|
| Git commits | 65 |
| Development timeline | April – May 2026 |
| Backend (`routes.py`) | ~1,914 lines · ~30 endpoints |
| Frontend | ~1,705 lines · 8 ES modules |
| Terraform resources | ~35 across 5 files + bootstrap |
| Smoke tests | 28 (`mongomock`, no real DB) |
| AWS services (in code + IaC) | Bedrock, Bedrock Guardrails, SES, CloudWatch, SNS, SSM, IAM, EC2, Lambda, EventBridge, S3, DynamoDB |
| Estimated monthly cost (Year 2+) | ~$8.50 (EC2 t3.micro; everything else within free tier) |
