# KEYNOTES — AWS Bedrock Guardrails Presentation

Speaker notes, remarks, and accuracy review for `aws-bedrock-guardrails-presentation.html`.

---

## Slide 01 — TITLE

**What to say:**
> "This is 4RCH3R — a personal investment portfolio tracker I built with FastAPI, MongoDB, and vanilla JS. For this mini-project I integrated it with AWS to solve three real problems: it had no cloud access, no observability, and no automation. I'll walk through each AWS service I used and how they connect."

**Remarks:**
- Strong opening. The animated logo + "DEPLOYED · EC2 US-EAST-1" pulsing dot sets a professional tone.
- EventBridge is missing from the chips row even though it's a core service in the architecture. Add it alongside Lambda.

**Accuracy:** No false claims here.

---

## Slide 02 — THE PROBLEM

**What to say:**
> "Before AWS, the app only ran on my laptop. There were no logs, no alerts, and portfolio snapshots only happened when a user opened a browser tab. Miss a day, lose that chart data forever. I evaluated Heroku, Railway, and Render but chose AWS because it integrates natively with the AI and secrets tooling I needed."

**Remarks:**
- The three problems (no cloud access, no observability, no automation) are well-framed and genuinely accurate to the original codebase.
- The WHY AWS box is persuasive but has one misleading bullet — see below.

**INACCURACY — "$0/year free tier":**
> The slide claims AWS has a "$0/year free tier (vs $7-25/mo immediately)." **This is misleading.** AWS Bedrock is NOT in the free tier — it is pay-per-use from the very first API call. The $0/year claim only holds for EC2 t3.micro in year one, SSM Standard, Lambda, and CloudWatch within free limits. Bedrock costs money immediately. Slide 9 quietly acknowledges ~$0.25/month but Slide 2 implies $0. Fix the bullet to: "EC2 + SSM + Lambda + CloudWatch in free tier — Bedrock pay-per-use at ~$0.25/mo."

---

## Slide 03 — ARCHITECTURE

**What to say:**
> "Here's the full system. On startup, SSM loads all secrets and watchtower hooks into CloudWatch. Every user chat request goes through Nginx on the EC2, hits the FastAPI /api/chat endpoint, calls Bedrock with guardrails applied, and either gets blocked with an HTTP 400 or returns a response. Separately, EventBridge fires at 9pm UTC every weekday, triggers Lambda, which calls an internal endpoint on the FastAPI server to snapshot all portfolios and send the daily email."

**Remarks:**
- The flow diagram is accurate to the actual code.
- Nginx appears in the diagram as a reverse proxy — this is a reasonable deployment assumption, but there is no Nginx config file in this repo. If the reviewer asks you to show it, be ready to explain it's configured on the EC2 instance itself, not in the codebase.
- The BLOCKED / ALLOWED fork is a standout visual. Mention this is handled by checking `stop_reason == "guardrail_intervened"` in the boto3 response.

**Accuracy:** Solid. The IAM Role note at the bottom is correct — no access keys anywhere in the code.

---

## Slide 04 — AWS BEDROCK

**What to say:**
> "I replaced LM Studio with AWS Bedrock because LM Studio is a desktop GUI — it can't run headlessly on a server. Bedrock uses IAM Role auth so there's no API key to manage, and it supports native Guardrails which we'll see next. The model is Claude 3.5 Haiku. Since boto3 is synchronous, I wrap the call in asyncio run_in_executor so it doesn't block the FastAPI event loop."

**Remarks:**
- Model ID, SDK call, and asyncio pattern are all confirmed accurate in `backend/routes.py:370-392`.
- The cost table ($0.80/1M input, $4.00/1M output) matches Haiku pricing.

**INACCURACY — "Bedrock: none" for rate limit:**
> The Bedrock vs Groq comparison table claims Bedrock has no rate limit. **This is false.** Bedrock has service quotas (throttling per second/minute per model). They are high enough that personal use won't hit them, but calling it "none" is technically wrong. Change to "Bedrock: high service quotas (won't hit at personal scale)" or simply remove that row.

---

## Slide 05 — BEDROCK GUARDRAILS

**What to say:**
> "Guardrails are configured in the AWS console and applied via an ID and version passed into the converse() call. The filter runs on both the user's input and the model's output, so a bad prompt never even reaches the model. If the guardrail fires, boto3 returns stop_reason 'guardrail_intervened' and I raise an HTTP 400 with a clean user-facing message."

**Remarks:**
- `stop_reason == "guardrail_intervened"` and the HTTP 400 path are confirmed in `backend/routes.py:386-397`.
- The three categories (content filters, denied topics, data redaction) are well organized.
- "All events logged to CloudWatch" — **partially misleading**. The watchtower handler ships all FastAPI logs to CloudWatch, but there is no explicit `logger.warning("Guardrail intervened...")` call in the code. The 400 response will appear in the access log, but a dedicated guardrail log line does not exist. Either add one to the code or soften this claim to "guardrail blocks appear in the FastAPI access log shipped to CloudWatch."

---

## Slide 06 — SSM PARAMETER STORE

**What to say:**
> "Instead of a .env file, all secrets are loaded from SSM Parameter Store at startup. The function runs before any routes load, paginates through all parameters under /investment-manager/, decrypts SecureStrings via KMS, and writes them into os.environ. This means a compromised disk reveals nothing."

**Remarks:**
- The `_load_ssm_secrets()` code block is confirmed accurate — pagination with NextToken is real (`backend/main.py:14-34`).
- SSM parameter count: the table shows 8 parameters, but the CloudWatch log on Slide 8 says "loaded 11 secrets." Fix either slide to be consistent.

**Note on GROQ:** GROQ_API_KEY does not exist in SSM and was never connected. The variable exists in `routes.py` as dead code. It has been removed from the SSM table and the Slide 4 comparison now reads "BEDROCK VS 3RD-PARTY LLM API" rather than naming Groq specifically.

---

## Slide 07 — SES · LAMBDA · EVENTBRIDGE

**What to say:**
> "Three services work together for automation. EventBridge fires a cron at 9pm UTC, which is 4pm ET — US market close. It triggers a Lambda function in Python 3.12, which hits the internal FastAPI endpoint with a shared secret key in the header. The FastAPI endpoint snapshots all portfolios and sends the daily summary email via SES. All of this is serverless and free within the included tiers."

**Remarks:**
- All three services are accurately described. `POST /api/internal/daily-close` with `X-Internal-Key` header is confirmed in `backend/routes.py:773-774`.
- The cron `cron(0 21 ? * MON-FRI *)` math (9pm UTC = 4pm ET) is correct.
- The flow diagram at the bottom (EVENTBRIDGE → LAMBDA → FASTAPI → SES → CLOUDWATCH) is accurate.
- The example subject line `[4RCH3R] MyPortfolio — +6.41% (threshold 5.0%)` matches the code's email format in `backend/routes.py:559`.

**Accuracy:** This is the strongest, most accurate slide in the deck.

---

## Slide 08 — CLOUDWATCH LOGS

**What to say:**
> "Before CloudWatch I had to SSH in and run journalctl to see any logs. Now every logger call is shipped in real time via the watchtower handler. The EC2 StatusCheckFailed alarm means I get an SNS email if the instance goes down — without writing a single line of monitoring code."

**Remarks:**
- watchtower setup confirmed in `backend/main.py:99-102`.
- Log group `/investment-manager/app`, stream `fastapi` — confirmed.
- The mock terminal is well-designed — it shows realistic timestamps and log levels.

**Inconsistency — "loaded 11 secrets":**
> The terminal shows `SSM: loaded 11 secrets from Parameter Store`. Slide 6 only lists 8 parameters in the SSM table. Fix one of the two slides so the numbers match. Count your actual SSM parameters and use the real number.

**Minor note:** The terminal shows `toni7891@gmail.com` as the recipient — your real email is visible. Not a problem for a class/personal presentation, but worth knowing.

---

## Slide 09 — SECURITY & COST

**What to say:**
> "Every IAM permission is scoped to the minimum required ARN — no wildcards on Bedrock or SSM. The internal endpoint uses a shared secret key rather than exposing it publicly. SSH is locked to a single IP. For cost, EC2 is the only real line item after free tier at $8.50/month. Bedrock at personal use is under $0.25/month. Total with domain: under $10/month."

**Remarks:**
- IAM permissions table is accurate and matches what the code actually calls.
- `ses:SendEmail` scope `*` is correctly flagged as "SES default" — SES doesn't support ARN-scoped send permissions easily, so this is an honest acknowledgment.
- All six security principles are genuine and confirmed in code.
- "CloudWatch billing alarm at $5/month" — good practical tip, include it in your speaking notes.

**Accuracy:** Solid. One of the best slides for technical credibility.

---

## Slide 10 — SUMMARY

**What to say:**
> "The three main takeaways: SSM is the right place for secrets — not .env files. IAM roles eliminate credentials entirely. And Guardrails block at infrastructure level so I don't need any application-level content filtering code. The hardest part was SSM pagination — the API only returns 10 params by default and silently drops the rest. That was a real bug I had to hunt down."

**Remarks:**
- "WHAT WAS DIFFICULT" is the most credible section of the whole deck — the SSM pagination bug is confirmed by the git commit `Fix SSM pagination — load all parameters beyond the default 10-result limit`.
- "IMPROVE IN PRODUCTION" suggestions are realistic and well-chosen. ECS/Fargate, WAF, RDS — all legit next steps.
- "SES production access — currently sandbox" is an honest, correct admission.

**Accuracy:** No false claims.

---

## Overall Improvements

| # | Issue | Status | Fix |
|---|-------|--------|-----|
| 1 | **Groq not actually removed** — GROQ_API_KEY still used as fallback | ✅ Fixed | SSM note now reads: "GROQ_API_KEY is retained as a local-dev fallback — production runs Bedrock via LLM_BACKEND=bedrock" |
| 2 | **Bedrock is not in the free tier** — Slide 2 implied $0/year | ✅ Fixed | Bullet now reads: "EC2 + SSM + Lambda + CloudWatch in free tier — Bedrock ~$0.25/mo pay-per-use" |
| 3 | **"Bedrock: none" for rate limit** — Bedrock has service quotas | ✅ Fixed | Changed to "Bedrock: high service quotas" |
| 4 | **SSM param count mismatch** — Slide 6 showed 8, log said 11 | ✅ Fixed | Added LLM_BACKEND, BEDROCK_REGION, BEDROCK_MODEL to the params table (total: 11) |
| 5 | **Guardrail CloudWatch claim** — no explicit logger.warning in code | ✅ Fixed | Changed to "Blocks logged via FastAPI watchtower" |
| 6 | **EventBridge missing from Slide 1 chips** — it's a featured service | Open | Add `<span class="chip chip-amber">EventBridge</span>` to the chips row |
| 7 | **Nginx not in the repo** — shown in Slide 3 architecture | Open | Be prepared to explain it's on the EC2 instance, not in the project codebase |

---

## Confirmed Accurate Claims

These are all verified against the actual code:

- `boto3.client("bedrock-runtime").converse()` — routes.py:371,384
- `asyncio.get_event_loop().run_in_executor(None, _invoke_bedrock)` — routes.py:392
- `stop_reason == "guardrail_intervened"` raises HTTP 400 — routes.py:386-397
- `POST /api/internal/daily-close` with `X-Internal-Key` header — routes.py:773-774
- `_load_ssm_secrets()` with NextToken pagination loop — main.py:14-34
- watchtower CloudWatchLogHandler attached at startup — main.py:99-102
- GROQ_API_KEY, BEDROCK_GUARDRAIL_ID, INTERNAL_API_KEY all in env — routes.py:324-337
- `tonyverin.dev` domain referenced in email bodies — routes.py:559,811
- Model ID `anthropic.claude-3-5-haiku-20241022-v1:0` — routes.py:325
