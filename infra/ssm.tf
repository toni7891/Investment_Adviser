# All secrets and config are stored here and loaded at app startup via
# ssm.get_parameters_by_path("/investment-manager/", WithDecryption=True).
# The EC2 disk never holds a .env file in production.

resource "aws_ssm_parameter" "mongo_uri" {
  name        = "/investment-manager/MONGO_URI"
  type        = "SecureString"
  value       = var.mongo_uri
  description = "MongoDB Atlas connection string"
}

resource "aws_ssm_parameter" "jwt_secret_key" {
  name        = "/investment-manager/JWT_SECRET_KEY"
  type        = "SecureString"
  value       = var.jwt_secret_key
  description = "JWT signing secret"
}

resource "aws_ssm_parameter" "internal_api_key" {
  name        = "/investment-manager/INTERNAL_API_KEY"
  type        = "SecureString"
  value       = var.internal_api_key
  description = "Shared secret for the Lambda → /api/internal/daily-close endpoint"
}

resource "aws_ssm_parameter" "llm_backend" {
  name  = "/investment-manager/LLM_BACKEND"
  type  = "String"
  value = var.llm_backend
}

resource "aws_ssm_parameter" "bedrock_model" {
  name  = "/investment-manager/BEDROCK_MODEL"
  type  = "String"
  value = var.bedrock_model_id
}

resource "aws_ssm_parameter" "bedrock_region" {
  name  = "/investment-manager/BEDROCK_REGION"
  type  = "String"
  value = var.aws_region
}

resource "aws_ssm_parameter" "cors_origins" {
  name  = "/investment-manager/CORS_ORIGINS"
  type  = "String"
  value = var.cors_origins
}

resource "aws_ssm_parameter" "cloudwatch_log_group" {
  name  = "/investment-manager/CLOUDWATCH_LOG_GROUP"
  type  = "String"
  value = var.cloudwatch_log_group
}

resource "aws_ssm_parameter" "alert_enabled" {
  name  = "/investment-manager/ALERT_ENABLED"
  type  = "String"
  value = var.alert_enabled ? "true" : "false"
}

resource "aws_ssm_parameter" "alert_threshold_pct" {
  name  = "/investment-manager/ALERT_THRESHOLD_PCT"
  type  = "String"
  value = var.alert_threshold_pct
}

resource "aws_ssm_parameter" "alert_email" {
  count = var.alert_email != "" ? 1 : 0
  name  = "/investment-manager/ALERT_EMAIL"
  type  = "String"
  value = var.alert_email
}

resource "aws_ssm_parameter" "bedrock_guardrail_id" {
  count       = var.bedrock_guardrail_id != "" ? 1 : 0
  name        = "/investment-manager/BEDROCK_GUARDRAIL_ID"
  type        = "SecureString"
  value       = var.bedrock_guardrail_id
  description = "Bedrock Guardrail identifier"
}

resource "aws_ssm_parameter" "bedrock_guardrail_version" {
  count = var.bedrock_guardrail_id != "" ? 1 : 0
  name  = "/investment-manager/BEDROCK_GUARDRAIL_VERSION"
  type  = "String"
  value = var.bedrock_guardrail_version
}

resource "aws_ssm_parameter" "groq_api_key" {
  count = var.groq_api_key != "" ? 1 : 0
  name  = "/investment-manager/GROQ_API_KEY"
  type  = "SecureString"
  value = var.groq_api_key
}
