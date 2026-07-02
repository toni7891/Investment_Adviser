output "public_ip" {
  description = "Elastic IP of the EC2 instance — point your domain A record here"
  value       = aws_eip.app.public_ip
}

output "instance_id" {
  description = "EC2 instance ID — used by CD to target SSM Run Command for redeploys"
  value       = aws_instance.app.id
}

output "app_url" {
  description = "HTTP URL of the running app"
  value       = "http://${aws_eip.app.public_ip}"
}

output "ssh_command" {
  description = "SSH into the EC2 instance"
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${aws_eip.app.public_ip}"
}

output "ssm_parameter_path" {
  description = "SSM Parameter Store path prefix used by the app"
  value       = "/investment-manager/"
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group receiving structured app logs"
  value       = aws_cloudwatch_log_group.app.name
}

output "lambda_function_name" {
  description = "Lambda function that triggers EOD snapshots and summary email"
  value       = aws_lambda_function.daily_close.function_name
}

output "sns_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarms and alert subscriptions"
  value       = aws_sns_topic.alerts.arn
}
