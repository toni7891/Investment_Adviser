# PROJECT VISION — 4RCH3R Investment Terminal

> **This is the complete target-state description of the project.**
> Use it as a build checklist, interview prep reference, and the source of
> resume bullet points as each section goes live.

---

## 1. Project Name

**4RCH3R Investment Terminal**
Repository: `investment_manager` · GitHub: `github.com/toni7891/investment_manager`

---

## 2. One-Line Description

A production-deployed, multi-user AI investment terminal that tracks live
portfolio performance, surfaces sector-level risk, and answers
portfolio-specific questions through a cloud-hosted LLM with real-time web
search — running on AWS with full observability, alerting, and automated
end-of-day data collection.

---

## 3. Problem It Solves / Use Case

Most retail investors track their holdings in a spreadsheet. Spreadsheets
can't show live prices, can't visualize sector concentration, can't alert
you when a position drops 5% in a day, and they certainly can't answer
"am I over-exposed to semiconductors right now?" in plain English.

4RCH3R replaces the spreadsheet with a browser-based terminal: users log
in, manage multiple portfolios, see every position priced in real time with
P&L and daily change, and interrogate their holdings through an AI
strategist that blends live portfolio data with fresh web search results.
End-of-day snapshots are captured automatically by a scheduled Lambda so
the performance chart never has gaps. Daily summary emails and threshold
alerts keep users informed without needing to open the app.

---

## 4. Full Tech Stack

| Layer | Technology |
|-------|-----------|
| **Language** | Python 3.11 |
| **Backend framework** | FastAPI + Uvicorn (single worker behind Nginx) |
| **Request validation** | Pydantic v2 models |
| **Database** | MongoDB Atlas M0 — synchronous `pymongo`, TLS via `certifi` |
| **Authentication** | JWT (`python-jose`, HS256) + `passlib`/`bcrypt` |
| **Market data** | `yfinance` — bulk price download, ticker validation, benchmark, stock detail |
| **Sentiment widget** | `fear-and-greed` library (CNN Fear & Greed Index) |
| **Web search** | DuckDuckGo (`ddgs`) with 5-minute in-process TTL cache |
| **AI / LLM** | AWS Bedrock — `bedrock-runtime.converse`, model: `anthropic.claude-3-5-haiku-20241022-v1:0` |
| **Content safety** | AWS Bedrock Guardrails — prompt-attack, hate, misconduct filters; denied topic: illegal financial activity |
| **Email / alerting** | AWS SES — threshold alerts + daily EOD portfolio summary |
| **Observability** | AWS CloudWatch Logs via `watchtower`; CloudWatch Alarm on EC2 `StatusCheckFailed` → SNS |
| **Secrets management** | AWS SSM Parameter Store — all secrets loaded at startup, no `.env` on disk in production |
| **Scheduled automation** | AWS Lambda + EventBridge — calls `POST /api/internal/daily-close` every weekday at 4 pm ET |
| **Data processing** | `pandas` + `openpyxl` — Excel portfolio import and export |
| **Frontend** | Vanilla JavaScript ES modules, HTML, CSS (IBM Plex Mono dark theme) |
| **Charts** | Chart.js — NAV heartrate chart, sector donut, benchmark overlay |
| **Containerization** | Docker (`python:3.11-slim`) — Uvicorn + Nginx managed by Supervisor |
| **Infrastructure as Code** | **Terraform** (AWS provider ~5.0) — fully modularized, S3 remote state + DynamoDB locking |
| **CI/CD** | GitHub Actions — lint + test on push to `main`; Docker build + `terraform apply` on tag |
| **Testing** | `pytest` + `mongomock` — 28 smoke tests, no real database required |

---

## 5. Architecture Overview

### High-Level Diagram

```
                          ┌──────────────────────────────────────┐
                          │             AWS Cloud                │
                          │                                      │
 Browser ──HTTPS──► Nginx (443)                                  │
                     │    │  EC2 t3.micro  (Amazon Linux 2023)  │
                     │    └──► Uvicorn / FastAPI (8000)         │
                     │              │                            │
                     │    ┌─────────┼───────────────────────┐   │
                     │    │   auth.py · routes.py · search.py│   │
                     │    └─────────┼───────────────────────┘   │
                     │              │                            │
                     │    ┌─────────▼───────────────────────┐   │
                     │    │         AWS Services             │   │
                     │    │  Bedrock (Claude)  CloudWatch   │   │
                     │    │  SES (email)       SSM Secrets  │   │
                     │    └─────────────────────────────────┘   │
                     │                                           │
                     │    ┌─────────────────────────────────┐   │
                     │    │  Lambda · EventBridge (4pm ET)  │   │
                     │    └─────────────────────────────────┘   │
                     └───────────────────────────────────────────┘
                                        │
              ┌─────────────────────────┼──────────────────────┐
              │                         │                       │
       MongoDB Atlas              yfinance API          DuckDuckGo
        (M0 free tier)           (market prices)       (web search)
```

### Request Flow — Standard API Call

```
1. Browser sends JWT in Authorization: Bearer header
2. FastAPI dependency (auth.py: get_current_user) decodes JWT,
   reloads user from MongoDB `users` collection, validates token_version
3. check_portfolio_access() confirms the requesting user owns the portfolio
4. Route handler executes business logic (prices via yfinance, CRUD via pymongo)
5. Response returned as JSON; log line shipped to CloudWatch via watchtower
```

### Request Flow — AI Chat (`POST /api/chat`)

```
1. Auth check (JWT + ownership) + rate limit (10 req/min sliding window)
2. Fetch portfolio with live prices → format as text summary
3. DuckDuckGo search on user message (5-min cache) → top 5 results
4. Build enhanced_prompt = portfolio_summary + web_results + user_question
5. boto3 bedrock-runtime.converse():
     system param    ← financial analyst persona (separate from user turn)
     messages        ← [{ role: "user", content: enhanced_prompt }]
     guardrailConfig ← BEDROCK_GUARDRAIL_ID + version (when configured)
     inferenceConfig ← { maxTokens: 2048 }
   → dispatched via run_in_executor() — does not block the async event loop
6. If stopReason == "guardrail_intervened" → HTTP 400 (clean user message)
7. Return { response, model, backend, portfolio_context_included, web_search_used }
```

### Automated Daily Snapshot Flow

```
EventBridge cron (9pm UTC = 4pm ET, Mon–Fri)
  └─► Lambda: investment-manager-daily-close
        └─► POST /api/internal/daily-close  (X-Internal-Key header)
              ├─ List all portfolios in MongoDB
              ├─ Call get_portfolio() for each → writes market-close
              │    snapshot to {portfolio_id}_history collection
              └─ Send daily P&L summary email via SES
```

---

## 6. Key Technical Features

### Authentication & Authorization
- **JWT (HS256)** with 24-hour expiry; secret loaded from SSM at startup — never on disk
- **Token versioning** — `token_version` integer stored on the user document is embedded
  in the JWT as `tv`; changing a password or username increments it, instantly invalidating
  all outstanding tokens without a blocklist or Redis
- **Forced password reset** — the seeded admin receives a random `secrets.token_urlsafe(16)`
  password; a `force_password_change` flag blocks every route except change-password until cleared
- **RBAC** — `user` role is limited to their own portfolios via `portfolio_metadata` ownership
  checks; `admin` bypasses all ownership checks

### Secrets & Infrastructure Security
- **SSM Parameter Store** — all credentials live at `/investment-manager/*`; the app calls
  `ssm.get_parameters_by_path(WithDecryption=True)` at startup, so no `.env` file is needed
  on the EC2 disk in production
- **IAM least privilege** — EC2 role is scoped to exactly:
  - `ssm:GetParameter*` on `/investment-manager/*` only
  - `bedrock:InvokeModel` on the configured model ARN only
  - `ses:SendEmail` / `ses:SendRawEmail`
  - `logs:PutLogEvents` on `/investment-manager/*` only
- **Terraform remote state** — state stored in a versioned, encrypted, public-access-blocked
  S3 bucket; concurrent apply protection via DynamoDB state locking

### Observability
- **CloudWatch Logs** — `watchtower` handler attached to the root Python logger at startup
  (gated on `CLOUDWATCH_LOG_GROUP` from SSM); every `logger.info/warning/error` call ships
  to `/investment-manager/app → fastapi` stream
- **CloudWatch Alarm** — `StatusCheckFailed` metric on the EC2 instance triggers an SNS
  email notification when the instance goes down; `treat_missing_data = "breaching"` means
  a terminated instance is treated as failing
- **Structured logs** — every chat request logs `portfolio_id`, `web_search`, message length,
  and elapsed time; every Bedrock call logs model ID and region

### Alerting
- **Threshold alert** — `_maybe_send_alert()` sends an SES email when
  `|daily_change_pct| > ALERT_THRESHOLD_PCT` (configurable via SSM); deduplicated in
  memory to one alert per portfolio per calendar day
- **Daily EOD summary** — Lambda triggers `POST /api/internal/daily-close` at 4 pm ET
  each weekday; the endpoint snapshots all portfolios and emails a one-line P&L summary

### Content Safety
- **Bedrock Guardrails** — filters set to High for hate/insults/sexual/violence/misconduct/
  prompt-attack; denied topic: "Illegal financial activity"; sensitive-data redaction for
  credit card and bank account numbers
- **System prompt isolation** — system prompt passed in the dedicated `system` parameter
  of `converse` (not in the user turn), preventing the prompt-attack filter from flagging
  the app's own instructions — a real bug that was debugged and fixed
- **Clean error surface** — `guardrail_intervened` stop reason is caught and returns HTTP 400;
  `chat.js` shows "That message was blocked by the content policy" rather than a raw SDK error

### Resilience & Degradation
- **DB-optional startup** — `database.py` catches all MongoDB connection failures and sets
  `db = None`; every affected route returns HTTP 503 gracefully rather than crashing
- **yfinance fallback** — if a ticker returns no price data (delisted, network block),
  `average_cost` is used as the current price so the portfolio still loads
- **Transaction fallback** — `_with_optional_transaction()` uses a MongoDB session/transaction
  on Atlas and transparently falls back to no-session on standalone Mongo or mongomock in tests

### Performance & Caching

| Data | Cache TTL |
|------|-----------|
| Ticker validation (yfinance) | 1 hour |
| Sector allocation | 1 hour |
| Fear & Greed Index | 1 hour |
| Stock detail panel | 5 minutes |
| Benchmark price series | 5 minutes |
| Ticker tape (12 symbols) | 5 minutes |
| Web search results | 5 minutes |

### Cost Controls
- EC2 `t3.micro` — free tier for 12 months, ~$8.50/month after
- MongoDB Atlas M0 — free forever
- Bedrock defaults to Claude 3.5 Haiku — cheapest Anthropic model at ~$0.80/1M input tokens
- Lambda, EventBridge, CloudWatch, SES, SSM — all within free-tier limits at this usage scale
- **Estimated Year 1 cost: $0 · Year 2+: ~$8.50/month**

---

## 7. Deployment

**Live at:** `https://tonyverin.dev`

### Infrastructure (Terraform)

Fully defined in `infra/` and applied with `terraform apply`. File layout:

```
infra/
  bootstrap/          # Run once: creates S3 state bucket + DynamoDB lock table
    main.tf
    outputs.tf
  lambda_src/
    daily_close.py    # Lambda function source (zipped by Terraform at apply time)
  templates/
    userdata.sh.tpl   # EC2 bootstrap script (templatefile — variables injected at plan)
  versions.tf         # Terraform + provider requirements; S3 backend block
  variables.tf        # All input variables with types, defaults, and validation
  main.tf             # VPC, subnet, IGW, route table, security group, EC2, EIP
  iam.tf              # EC2 role + Lambda role, all inline least-privilege policies
  ssm.tf              # Every SSM parameter the app reads at startup
  lambda.tf           # Lambda function, EventBridge rule + target, invoke permission
  cloudwatch.tf       # Log group, SNS topic + email subscription, EC2 health alarm
  outputs.tf          # public_ip, app_url, ssh_command, log_group, lambda_name
  backend.hcl.example # Copy → backend.hcl (gitignored), fill in bucket name
```

**Workflow to deploy from scratch:**

```bash
# 1 — Bootstrap (one-time)
cd infra/bootstrap
terraform init && terraform apply
# Copy the printed backend_hcl output into infra/backend.hcl

# 2 — Deploy the full stack
cd ..
terraform init -backend-config=backend.hcl
terraform apply -var-file=prod.tfvars
```

Key resources provisioned:

| Resource | Detail |
|---------|--------|
| VPC | 10.0.0.0/16, single public subnet |
| Internet Gateway + Route Table | Full internet egress |
| Security Group | Inbound: 443/80 (world), 22 (configurable CIDR) |
| EC2 Instance | Amazon Linux 2023, `t3.micro`, 20 GB gp3 |
| Elastic IP | Static public IP |
| IAM Role + Instance Profile | Scoped least-privilege (SSM, Bedrock, SES, CloudWatch) |
| SSM Parameters | All secrets/config at `/investment-manager/*` |
| Lambda Function | `investment-manager-daily-close`, Python 3.12, 60s timeout |
| EventBridge Rule | `cron(0 21 ? * MON-FRI *)` → Lambda |
| CloudWatch Log Group | `/investment-manager/app`, 30-day retention |
| SNS Topic | Alert sink for CloudWatch Alarm + email subscription |
| CloudWatch Alarm | EC2 `StatusCheckFailed` → SNS notification |
| S3 Bucket (bootstrap) | Versioned, AES-256 encrypted, all public access blocked |
| DynamoDB Table (bootstrap) | `PAY_PER_REQUEST`, prevents concurrent `terraform apply` |

### Process Management (on EC2)

Docker (`python:3.11-slim`) running Uvicorn + Nginx under Supervisor:
- Supervisor keeps both processes alive, restarts on crash
- Nginx reverse-proxies 80/443 → Uvicorn port 8000
- `proxy_read_timeout 310s` — accommodates the 300s Bedrock chat timeout
- Let's Encrypt SSL via Certbot (auto-renewed by cron, triggered by `enable_ssl=true`)

### CI/CD (GitHub Actions)

```
.github/workflows/
  ci.yml    # On push to main: ruff lint → pytest (mongomock) → docker build
  cd.yml    # On tag v*:       build → push ECR → terraform apply → restart
```

---

## 8. Notable Challenges Solved

**Bedrock Guardrail false positives**
Attaching a Guardrail initially caused the prompt-attack filter to fire on the
app's own system prompt because it was injected as the first message in the user
turn — exactly the pattern the filter is designed to catch. Fix: move the system
prompt into the dedicated `system` parameter of `converse`, which Bedrock treats
as trusted context and does not evaluate against Guardrails.

**Blocking boto3 in an async FastAPI app**
`bedrock-runtime.converse` is a synchronous boto3 call. Calling it directly in
an `async def` route blocks Uvicorn's event loop thread for the full inference
duration (30–60 seconds), making the app unresponsive to all other requests.
Solution: wrap in `asyncio.get_event_loop().run_in_executor(None, fn)` to offload
to a thread-pool worker. Nginx and Uvicorn timeouts were extended to 310s to
prevent upstream gateway timeouts on slow model responses.

**Token invalidation without a session store**
Standard JWTs can't be revoked before expiry. Rather than introducing Redis or a
DB blocklist, a `token_version` integer is stored on the user document and
embedded in the JWT as `tv`. Password or username changes increment the DB value;
every `get_current_user` call compares the live DB value against the JWT claim.
One DB write invalidates every outstanding token for that user with zero extra
infrastructure.

**Transactions that degrade cleanly in tests**
Buy/sell/cash operations need to be atomic across the positions and trades
collections. Production MongoDB Atlas supports multi-document transactions, but
`mongomock` (the test database) raises `NotImplementedError` at session creation.
The `_with_optional_transaction()` wrapper catches this before any writes occur
and retries the same operation without a session — giving real atomicity in
production and transparent single-document writes in tests, without separate code
paths.

**Single chat endpoint across four LLM backends**
Bedrock uses the boto3 `converse` shape (structured content blocks, system as a
separate param); Groq/LM Studio/Ollama use OpenAI-compatible HTTP JSON with
different auth headers. Both paths normalize to a single
`{ choices: [{ message: { content } }] }` response shape so the rest of the
handler and the entire frontend are backend-agnostic. Switching LLMs is a
one-line SSM parameter change, not a code change.

**Terraform remote state for a solo project**
Even on a solo project, `terraform apply` from a laptop with local state creates
a blast-radius risk if state is lost or corrupted. The `bootstrap/` sub-directory
creates a versioned, encrypted S3 bucket with `prevent_destroy = true` and a
DynamoDB table for concurrent-apply locking — standard team-scale best practice
applied from the start.

---

## 9. Resume-Ready Bullet Points

- **Architected and deployed** a multi-user AI investment terminal on AWS using
  **Terraform** (VPC, EC2, Elastic IP, IAM least-privilege, SSM Parameter Store,
  Lambda, EventBridge, CloudWatch, SNS — S3 remote state with DynamoDB locking),
  serving a FastAPI backend behind Nginx with JWT auth, token-version-based
  session invalidation, and RBAC across 30 REST endpoints backed by MongoDB Atlas.

- **Integrated AWS Bedrock** (Claude 3.5 Haiku via `converse` API) for
  portfolio-aware AI chat — combining live holdings data with DuckDuckGo web
  search into a structured prompt; attached **Bedrock Guardrails** (prompt-attack,
  hate, and misconduct filters) and debugged a system-prompt false-positive by
  moving it into the dedicated `system` parameter of `converse`.

- **Built full cloud observability and automated data collection**: structured
  log shipping to CloudWatch Logs via `watchtower`, SES threshold alerts and daily
  EOD portfolio summary emails, and a scheduled Lambda (EventBridge cron) that
  records market-close NAV snapshots for all portfolios nightly — with a
  CloudWatch Alarm on EC2 `StatusCheckFailed` for uptime monitoring.

- **Wrote infrastructure as code end-to-end in Terraform**: modular file layout
  (`main.tf`, `iam.tf`, `ssm.tf`, `lambda.tf`, `cloudwatch.tf`), a one-time
  bootstrap stack for encrypted S3 state + DynamoDB locking, a GitHub Actions
  CI/CD pipeline (lint → test → Docker build → `terraform apply` on tag), and an
  EC2 `templatefile` userdata script with optional Let's Encrypt SSL provisioning.

---

## Appendix — Project Scale

| Metric | Value |
|--------|-------|
| Git commits | 65 |
| Development timeline | April – May 2026 |
| Backend (routes.py) | ~1,914 lines · 30 endpoints |
| Frontend | ~1,705 lines · 8 ES modules |
| Terraform resources | ~35 across 5 modules + bootstrap |
| Smoke tests | 28 (mongomock, no real DB) |
| AWS services | Bedrock, Bedrock Guardrails, SES, CloudWatch, SNS, SSM, IAM, EC2, Lambda, EventBridge, S3, DynamoDB |
| Estimated monthly cost (Year 2+) | ~$8.50 (EC2 t3.micro; all other services within free tier) |
