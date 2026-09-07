variable "name" { type = string }
variable "region" { type = string }
variable "account_id" { type = string }
variable "queue_arn" { type = string }
variable "queue_url" { type = string }
variable "log_retention_days" { type = number }

data "aws_iot_endpoint" "data" {
  endpoint_type = "iot:Data-ATS"
}

resource "aws_iot_thing_type" "gateway" {
  name = "${var.name}-gateway"
}

# Política do dispositivo: só conecta com o próprio nome e só publica dentro do tenant gravado
# como atributo da Thing. Um gateway comprometido não consegue falar em nome de outro cliente.
data "aws_iam_policy_document" "device" {
  statement {
    actions   = ["iot:Connect"]
    resources = ["arn:aws:iot:${var.region}:${var.account_id}:client/$${iot:Connection.Thing.ThingName}"]
  }
  statement {
    actions   = ["iot:Publish"]
    resources = ["arn:aws:iot:${var.region}:${var.account_id}:topic/energia/$${iot:Connection.Thing.Attributes[tenant_id]}/*"]
  }
}

resource "aws_iot_policy" "gateway" {
  name   = "${var.name}-gateway"
  policy = data.aws_iam_policy_document.device.json
}

# ---------------------------------------------------------------- regra: tópico -> SQS

data "aws_iam_policy_document" "rules_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["iot.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rules" {
  name               = "${var.name}-iot-rules"
  assume_role_policy = data.aws_iam_policy_document.rules_assume.json
}

resource "aws_cloudwatch_log_group" "rules" {
  name              = "/aws/iot/${var.name}-rules"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "rules" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [var.queue_arn]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.rules.arn}:*"]
  }
}

resource "aws_iam_role_policy" "rules" {
  name   = "acoes"
  role   = aws_iam_role.rules.id
  policy = data.aws_iam_policy_document.rules.json
}

# Uma regra, um destino. A fila alimenta o plano operacional e, pela mesma Lambda, o lake.
# O Firehose saiu do desenho: o plano gratuito da AWS bloqueia Kinesis e Firehose (ver docs/DECISOES.md).
resource "aws_iot_topic_rule" "to_sqs" {
  name        = replace("${var.name}_leituras_sqs", "-", "_")
  description = "Leituras dos medidores para a fila de processamento"
  enabled     = true
  # A identidade vem do tópico autorizado pelo certificado, nunca do JSON do gateway.
  sql         = <<-SQL
    SELECT topic(2) AS tenant_id, topic(3) AS site_id, topic(4) AS meter_id,
           ts, kw, kvar, kwh_total, v, a, pf, hz, seq
    FROM 'energia/+/+/+'
  SQL
  sql_version = "2016-03-23"

  sqs {
    queue_url  = var.queue_url
    role_arn   = aws_iam_role.rules.arn
    use_base64 = false
  }

  error_action {
    cloudwatch_logs {
      log_group_name = aws_cloudwatch_log_group.rules.name
      role_arn       = aws_iam_role.rules.arn
    }
  }

  depends_on = [aws_iam_role_policy.rules]
}

output "endpoint" { value = data.aws_iot_endpoint.data.endpoint_address }
output "policy_name" { value = aws_iot_policy.gateway.name }
output "thing_type_name" { value = aws_iot_thing_type.gateway.name }
