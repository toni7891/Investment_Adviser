variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (e.g. prod, staging)"
  type        = string
  default     = "prod"
}

variable "stack_name" {
  description = "Name prefix applied to all resources"
  type        = string
  default     = "investment-manager"
}

# ── Compute ───────────────────────────────────────────────────────────────────

variable "key_pair_name" {
  description = "EC2 key pair name for SSH access"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type (t3.micro is free-tier eligible)"
  type        = string
  default     = "t3.micro"

  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium"], var.instance_type)
    error_message = "Must be t3.micro, t3.small, or t3.medium."
  }
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to SSH. Restrict to your IP in production (e.g. 1.2.3.4/32)."
  type        = string
  default     = "0.0.0.0/0"
}

# ── Secrets ───────────────────────────────────────────────────────────────────

variable "mongo_uri" {
  description = "MongoDB Atlas connection string (mongodb+srv://...)"
  type        = string
  sensitive   = true
}

variable "jwt_secret_key" {
  description = "Secret key for signing JWTs — generate with: python -c \"import secrets; print(secrets.token_hex(32))\""
  type        = string
  sensitive   = true
}

variable "internal_api_key" {
  description = "Shared secret for POST /api/internal/daily-close (called by Lambda)"
  type        = string
  sensitive   = true
}

# ── Application config ────────────────────────────────────────────────────────

variable "cors_origins" {
  description = "Comma-separated allowed CORS origins (e.g. https://tonyverin.dev). Leave blank for localhost only."
  type        = string
  default     = ""
}

variable "llm_backend" {
  description = "AI backend: bedrock | groq | lmstudio | ollama"
  type        = string
  default     = "bedrock"

  validation {
    condition     = contains(["bedrock", "groq", "lmstudio", "ollama"], var.llm_backend)
    error_message = "Must be one of: bedrock, groq, lmstudio, ollama."
  }
}

variable "bedrock_model_id" {
  description = "Bedrock model ID"
  type        = string
  default     = "anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "bedrock_guardrail_id" {
  description = "Bedrock Guardrail ID — leave blank to disable content filtering"
  type        = string
  default     = ""
}

variable "bedrock_guardrail_version" {
  description = "Bedrock Guardrail version"
  type        = string
  default     = "DRAFT"
}

variable "groq_api_key" {
  description = "Groq API key — only needed when llm_backend=groq"
  type        = string
  sensitive   = true
  default     = ""
}

# ── Deployment ────────────────────────────────────────────────────────────────

variable "git_repo_url" {
  description = "HTTPS URL of the GitHub repo to clone on the EC2 instance. Leave blank to deploy manually."
  type        = string
  default     = ""
}

variable "git_branch" {
  description = "Git branch to check out on EC2"
  type        = string
  default     = "main"
}

variable "enable_ssl" {
  description = "Provision a Let's Encrypt SSL certificate via Certbot (requires domain_name)"
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Domain name for the SSL certificate (required when enable_ssl=true)"
  type        = string
  default     = ""
}

variable "admin_email" {
  description = "Email address for Let's Encrypt certificate (required when enable_ssl=true)"
  type        = string
  default     = ""
}

variable "app_url" {
  description = "Public URL of the app used by the Lambda (e.g. https://tonyverin.dev). Defaults to http://<elastic-ip> if blank."
  type        = string
  default     = ""
}

# ── Alerting ──────────────────────────────────────────────────────────────────

variable "alert_enabled" {
  description = "Enable SES portfolio alerts and daily summary emails"
  type        = bool
  default     = false
}

variable "alert_email" {
  description = "Email address for portfolio alerts and daily summaries (must be verified in SES)"
  type        = string
  default     = ""
}

variable "alert_threshold_pct" {
  description = "Absolute daily change % that triggers a threshold alert (e.g. 5.0)"
  type        = string
  default     = "5.0"
}

# ── Observability ─────────────────────────────────────────────────────────────

variable "cloudwatch_log_group" {
  description = "CloudWatch log group name for application logs"
  type        = string
  default     = "/investment-manager/app"
}
