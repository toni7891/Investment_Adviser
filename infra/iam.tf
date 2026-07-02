# ── EC2 Instance Role ─────────────────────────────────────────────────────────

resource "aws_iam_role" "ec2" {
  name = "${var.stack_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.stack_name}-instance-profile"
  role = aws_iam_role.ec2.name
}

# Allows SSM Session Manager (SSH alternative, no port 22 needed)
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# SSM Parameter Store — scoped to /investment-manager/* only
resource "aws_iam_role_policy" "ssm_read" {
  name = "SsmParameterRead"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
      ]
      Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/investment-manager/*"
    }]
  })
}

# Bedrock — scoped to the configured model only
resource "aws_iam_role_policy" "bedrock" {
  name = "BedrockInvoke"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ]
      Resource = "arn:aws:bedrock:${var.aws_region}::foundation-model/${var.bedrock_model_id}"
    }]
  })
}

# SES — send-only permission
resource "aws_iam_role_policy" "ses" {
  name = "SesAlerts"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "*"
    }]
  })
}

# CloudWatch Logs — scoped to the app log group only
resource "aws_iam_role_policy" "cloudwatch_logs" {
  name = "CloudWatchLogs"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams",
      ]
      Resource = "arn:aws:logs:${var.aws_region}:*:log-group:/investment-manager/*"
    }]
  })
}

# ── Lambda Execution Role ─────────────────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${var.stack_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Grants CloudWatch Logs write access for Lambda execution logs
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
