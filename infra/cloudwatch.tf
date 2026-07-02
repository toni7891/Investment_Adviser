# ── Log Group ─────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "app" {
  name              = var.cloudwatch_log_group
  retention_in_days = 30
  tags              = { Name = "${var.stack_name}-logs" }
}

# ── SNS Topic (alarm + alert email sink) ─────────────────────────────────────

resource "aws_sns_topic" "alerts" {
  name = "${var.stack_name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ── EC2 Health Alarm ──────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "ec2_health" {
  alarm_name          = "${var.stack_name}-instance-health"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  alarm_description   = "Fires when the EC2 instance fails a status check — app may be down"
  treat_missing_data  = "breaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  dimensions = {
    InstanceId = aws_instance.app.id
  }
}
