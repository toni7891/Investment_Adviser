# Zip the Lambda source file at plan/apply time
data "archive_file" "daily_close" {
  type        = "zip"
  source_file = "${path.module}/lambda_src/daily_close.py"
  output_path = "${path.module}/.terraform/lambda/daily_close.zip"
}

# ── Lambda Function ───────────────────────────────────────────────────────────

resource "aws_lambda_function" "daily_close" {
  function_name    = "${var.stack_name}-daily-close"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.12"
  handler          = "daily_close.handler"
  filename         = data.archive_file.daily_close.output_path
  source_code_hash = data.archive_file.daily_close.output_base64sha256
  timeout          = 60

  environment {
    variables = {
      APP_URL          = var.app_url != "" ? var.app_url : "http://${aws_eip.app.public_ip}"
      INTERNAL_API_KEY = var.internal_api_key
    }
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_basic]

  tags = { Name = "${var.stack_name}-daily-close" }
}

# ── EventBridge Schedule ──────────────────────────────────────────────────────

resource "aws_cloudwatch_event_rule" "daily_close" {
  name                = "${var.stack_name}-market-close"
  description         = "Trigger daily portfolio EOD snapshot at 4pm ET (Mon–Fri)"
  schedule_expression = "cron(0 21 ? * MON-FRI *)"
}

resource "aws_cloudwatch_event_target" "daily_close" {
  rule      = aws_cloudwatch_event_rule.daily_close.name
  target_id = "InvokeDailyCloseLambda"
  arn       = aws_lambda_function.daily_close.arn
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.daily_close.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_close.arn
}
