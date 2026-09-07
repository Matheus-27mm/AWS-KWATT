variable "name" { type = string }
variable "core_zip" { type = string }
variable "lake_bucket" { type = string }
variable "lake_bucket_arn" { type = string }
variable "alert_email" { type = string }
variable "whatsapp_token" {
  type      = string
  sensitive = true
}
variable "whatsapp_phone_id" { type = string }
variable "whatsapp_to" { type = string }
variable "whatsapp_template" { type = string }
variable "log_retention_days" { type = number }

# ---------------------------------------------------------------- estado (DynamoDB)

resource "aws_dynamodb_table" "this" {
  name         = var.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"
}

# ---------------------------------------------------------------- filas

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-leituras-dlq"
  message_retention_seconds = 1209600 # 14 dias para investigar
}

resource "aws_sqs_queue" "readings" {
  name = "${var.name}-leituras"
  # Uma mensagem devolvida à fila reaparece depois disto. Precisa caber na carência de 60 s da janela
  # mais o tempo de processamento, senão a leitura volta para uma janela já fechada. 3x o timeout da
  # Lambda (15 s); a AWS sugere 6x, mas aqui o custo de atraso é maior que o de uma duplicata.
  visibility_timeout_seconds = 45
  message_retention_seconds  = 345600
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })
}

# ---------------------------------------------------------------- eventos e notificação

resource "aws_cloudwatch_event_bus" "this" {
  name = var.name
}

resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alertas"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------------------------------------------------------------- Lambda processador

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "processor" {
  name               = "${var.name}-processador"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "processor_logs" {
  role       = aws_iam_role.processor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "processor" {
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
      "dynamodb:TransactWriteItems",
    ]
    resources = [aws_dynamodb_table.this.arn]
  }
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${var.lake_bucket_arn}/leituras/*"]
  }
  statement {
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [aws_sqs_queue.readings.arn]
  }
}

# ---------------------------------------------------------------- outbox transacional -> EventBridge

resource "aws_iam_role" "outbox" {
  name               = "${var.name}-outbox"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "outbox_logs" {
  role       = aws_iam_role.outbox.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "outbox" {
  statement {
    actions = [
      "dynamodb:DescribeStream",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
    ]
    resources = [aws_dynamodb_table.this.stream_arn]
  }
  statement {
    actions   = ["dynamodb:ListStreams"]
    resources = ["*"]
  }
  statement {
    actions   = ["dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.this.arn]
  }
  statement {
    actions   = ["events:PutEvents"]
    resources = [aws_cloudwatch_event_bus.this.arn]
  }
}

resource "aws_iam_role_policy" "outbox" {
  name   = "acesso"
  role   = aws_iam_role.outbox.id
  policy = data.aws_iam_policy_document.outbox.json
}

resource "aws_cloudwatch_log_group" "outbox" {
  name              = "/aws/lambda/${var.name}-outbox"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "outbox" {
  function_name    = "${var.name}-outbox"
  role             = aws_iam_role.outbox.arn
  handler          = "energia.lambdas.outbox.handler"
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  filename         = var.core_zip
  source_code_hash = filebase64sha256(var.core_zip)
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      ENERGIA_TABLE_NAME = aws_dynamodb_table.this.name
      ENERGIA_EVENT_BUS  = aws_cloudwatch_event_bus.this.name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.outbox,
    aws_iam_role_policy_attachment.outbox_logs,
    aws_iam_role_policy.outbox,
  ]
}

resource "aws_lambda_event_source_mapping" "outbox" {
  event_source_arn        = aws_dynamodb_table.this.stream_arn
  function_name           = aws_lambda_function.outbox.arn
  starting_position       = "LATEST"
  batch_size              = 100
  function_response_types = ["ReportBatchItemFailures"]

  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["INSERT", "MODIFY"]
        dynamodb  = { NewImage = { type = { S = ["OutboxEvent"] } } }
      })
    }
  }
}

resource "aws_iam_role_policy" "processor" {
  name   = "acesso"
  role   = aws_iam_role.processor.id
  policy = data.aws_iam_policy_document.processor.json
}

resource "aws_cloudwatch_log_group" "processor" {
  name              = "/aws/lambda/${var.name}-processador"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "processor" {
  function_name    = "${var.name}-processador"
  role             = aws_iam_role.processor.arn
  handler          = "energia.lambdas.processor.handler"
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  filename         = var.core_zip
  source_code_hash = filebase64sha256(var.core_zip)
  timeout          = 15 # um lote de 100 leituras leva ~2 s; 15 s cobre as tentativas em conflito
  memory_size      = 512

  environment {
    variables = {
      ENERGIA_TABLE_NAME  = aws_dynamodb_table.this.name
      ENERGIA_EVENT_BUS   = aws_cloudwatch_event_bus.this.name
      ENERGIA_LAKE_BUCKET = var.lake_bucket
    }
  }

  depends_on = [aws_cloudwatch_log_group.processor, aws_iam_role_policy_attachment.processor_logs]
}

resource "aws_lambda_event_source_mapping" "readings" {
  event_source_arn                   = aws_sqs_queue.readings.arn
  function_name                      = aws_lambda_function.processor.arn
  batch_size                         = 100
  maximum_batching_window_in_seconds = 5
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    # Backpressure explícito: a fila absorve, a Lambda não explode. 2 é o mínimo que o SQS aceita.
    # Mais instâncias só ajudam com muitos medidores; com poucos, só multiplicam conflitos de versão
    # no mesmo item de estado (94 conflitos em 2.160 leituras com 10 instâncias, em 07/09/2026).
    # Subir quando houver dezenas de medidores e a idade da mensagem na fila passar de 30 s.
    maximum_concurrency = 2
  }
}

# ---------------------------------------------------------------- Lambda notificador

resource "aws_iam_role" "notifier" {
  name               = "${var.name}-notificador"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "notifier_logs" {
  role       = aws_iam_role.notifier.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "notifier" {
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
  }
}

resource "aws_iam_role_policy" "notifier" {
  name   = "acesso"
  role   = aws_iam_role.notifier.id
  policy = data.aws_iam_policy_document.notifier.json
}

resource "aws_cloudwatch_log_group" "notifier" {
  name              = "/aws/lambda/${var.name}-notificador"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "notifier" {
  function_name    = "${var.name}-notificador"
  role             = aws_iam_role.notifier.arn
  handler          = "energia.lambdas.notifier.handler"
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  filename         = var.core_zip
  source_code_hash = filebase64sha256(var.core_zip)
  timeout          = 20
  memory_size      = 256

  environment {
    variables = {
      ENERGIA_SNS_TOPIC_ARN     = aws_sns_topic.alerts.arn
      ENERGIA_WHATSAPP_TOKEN    = var.whatsapp_token
      ENERGIA_WHATSAPP_PHONE_ID = var.whatsapp_phone_id
      ENERGIA_WHATSAPP_TO       = var.whatsapp_to
      ENERGIA_WHATSAPP_TEMPLATE = var.whatsapp_template
    }
  }

  depends_on = [aws_cloudwatch_log_group.notifier, aws_iam_role_policy_attachment.notifier_logs]
}

resource "aws_cloudwatch_event_rule" "alerts" {
  name           = "${var.name}-alertas"
  event_bus_name = aws_cloudwatch_event_bus.this.name
  event_pattern = jsonencode({
    source        = ["energia"]
    "detail-type" = ["Alerta"]
  })
}

resource "aws_cloudwatch_event_target" "notifier" {
  rule           = aws_cloudwatch_event_rule.alerts.name
  event_bus_name = aws_cloudwatch_event_bus.this.name
  target_id      = "notificador"
  arn            = aws_lambda_function.notifier.arn
}

resource "aws_lambda_permission" "notifier_events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notifier.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.alerts.arn
}

# ---------------------------------------------------------------- alarme da DLQ

resource "aws_cloudwatch_metric_alarm" "dlq" {
  alarm_name          = "${var.name}-dlq-com-mensagens"
  alarm_description   = "Leituras que falharam 5 vezes. Alguém precisa olhar."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    QueueName = aws_sqs_queue.dlq.name
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_age" {
  alarm_name          = "${var.name}-fila-atrasada"
  alarm_description   = "Leitura mais antiga está há mais de 2 minutos aguardando processamento."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 120
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = { QueueName = aws_sqs_queue.readings.name }
}

resource "aws_cloudwatch_metric_alarm" "processor_errors" {
  alarm_name          = "${var.name}-processador-com-erros"
  alarm_description   = "A Lambda de processamento apresentou erros."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = { FunctionName = aws_lambda_function.processor.function_name }
}

resource "aws_cloudwatch_metric_alarm" "outbox_errors" {
  alarm_name          = "${var.name}-outbox-com-erros"
  alarm_description   = "A publicação de eventos da outbox apresentou erros."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = { FunctionName = aws_lambda_function.outbox.function_name }
}

resource "aws_cloudwatch_metric_alarm" "outbox_iterator_age" {
  alarm_name          = "${var.name}-outbox-atrasada"
  alarm_description   = "A outbox está há mais de 2 minutos sem conseguir avançar no stream."
  namespace           = "AWS/Lambda"
  metric_name         = "IteratorAge"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 120000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = { FunctionName = aws_lambda_function.outbox.function_name }
}

output "table_name" { value = aws_dynamodb_table.this.name }
output "table_arn" { value = aws_dynamodb_table.this.arn }
output "queue_arn" { value = aws_sqs_queue.readings.arn }
output "queue_url" { value = aws_sqs_queue.readings.url }
output "event_bus_name" { value = aws_cloudwatch_event_bus.this.name }
output "event_bus_arn" { value = aws_cloudwatch_event_bus.this.arn }
output "sns_topic_arn" { value = aws_sns_topic.alerts.arn }
