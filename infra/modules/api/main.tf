variable "name" { type = string }
variable "api_zip" { type = string }
variable "table_name" { type = string }
variable "table_arn" { type = string }
variable "event_bus_name" { type = string }
variable "event_bus_arn" { type = string }
variable "admin_api_key" {
  type      = string
  sensitive = true
}
variable "log_retention_days" { type = number }

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${var.name}-api"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "api" {
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
      "dynamodb:TransactWriteItems",
    ]
    resources = [var.table_arn]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "acesso"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.name}-api"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.name}-api"
  role             = aws_iam_role.api.arn
  handler          = "energia.lambdas.api.handler"
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  filename         = var.api_zip
  source_code_hash = filebase64sha256(var.api_zip)
  timeout          = 29 # o API Gateway corta em 30 s
  memory_size      = 512

  environment {
    variables = {
      ENERGIA_REPO          = "dynamodb"
      ENERGIA_TABLE_NAME    = var.table_name
      ENERGIA_EVENT_BUS     = var.event_bus_name
      ENERGIA_ADMIN_API_KEY = var.admin_api_key
    }
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy_attachment.logs]
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 25
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "api_url" { value = aws_apigatewayv2_api.http.api_endpoint }
