output "state_bucket" {
  description = "S3 bucket name for Terraform remote state"
  value       = aws_s3_bucket.tfstate.bucket
}

output "lock_table" {
  description = "DynamoDB table name for state locking"
  value       = aws_dynamodb_table.tfstate_lock.name
}

output "backend_hcl" {
  description = "Paste this into infra/backend.hcl then run: terraform init -backend-config=backend.hcl"
  value       = <<-EOT

    bucket         = "${aws_s3_bucket.tfstate.bucket}"
    key            = "investment-manager/terraform.tfstate"
    region         = "${var.aws_region}"
    dynamodb_table = "${aws_dynamodb_table.tfstate_lock.name}"
    encrypt        = true

  EOT
}
