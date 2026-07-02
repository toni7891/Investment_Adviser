terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  # Populated at init time via: terraform init -backend-config=backend.hcl
  # Run infra/bootstrap first to create the bucket and table.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "investment-manager"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
