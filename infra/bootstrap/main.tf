# One-time bootstrap: creates the S3 bucket and DynamoDB table that the main
# Terraform stack uses as its remote backend.
#
# Run this ONCE before anything else:
#   cd infra/bootstrap
#   terraform init
#   terraform apply
#
# Copy the output of `backend_hcl` into infra/backend.hcl, then:
#   cd ..
#   terraform init -backend-config=backend.hcl
#
# This bootstrap stack uses local state (do not delete the .tfstate file).

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "stack_name" {
  description = "Prefix for state resource names"
  type        = string
  default     = "investment-manager"
}

data "aws_caller_identity" "current" {}

# ── S3 State Bucket ───────────────────────────────────────────────────────────

resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.stack_name}-tfstate-${data.aws_caller_identity.current.account_id}"

  # Prevent accidental destruction of state
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── DynamoDB State Lock Table ─────────────────────────────────────────────────

resource "aws_dynamodb_table" "tfstate_lock" {
  name         = "${var.stack_name}-tfstate-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
