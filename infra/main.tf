data "aws_caller_identity" "current" {}

locals {
  name       = "${var.project}-${var.env}"
  account_id = data.aws_caller_identity.current.account_id
  tags = {
    Project   = var.project
    Env       = var.env
    ManagedBy = "terraform"
  }
}

# Primeiro recurso de qualquer conta: o alarme de orçamento.
module "budget" {
  source     = "./modules/budget"
  name       = local.name
  amount_usd = var.budget_usd
  email      = var.alert_email
}

# Plano analítico: S3 (JSON Lines por lote) -> Glue -> Athena.
module "storage" {
  source             = "./modules/storage"
  name               = local.name
  account_id         = local.account_id
  region             = var.region
  log_retention_days = var.log_retention_days
}

# Plano operacional: SQS -> Lambda -> DynamoDB -> EventBridge -> notificador.
# A mesma Lambda grava o lote bruto no lake.
module "processing" {
  source             = "./modules/processing"
  name               = local.name
  core_zip           = "${path.root}/${var.build_dir}/core.zip"
  lake_bucket        = module.storage.lake_bucket
  lake_bucket_arn    = module.storage.lake_bucket_arn
  alert_email        = var.alert_email
  whatsapp_token     = var.whatsapp_token
  whatsapp_phone_id  = var.whatsapp_phone_id
  whatsapp_to        = var.whatsapp_to
  whatsapp_template  = var.whatsapp_template
  log_retention_days = var.log_retention_days
}

# Borda: IoT Core com a regra que entrega na fila.
module "iot" {
  source             = "./modules/iot"
  name               = local.name
  region             = var.region
  account_id         = local.account_id
  queue_arn          = module.processing.queue_arn
  queue_url          = module.processing.queue_url
  log_retention_days = var.log_retention_days
}

# API FastAPI atrás do API Gateway HTTP.
module "api" {
  source             = "./modules/api"
  name               = local.name
  api_zip            = "${path.root}/${var.build_dir}/api.zip"
  table_name         = module.processing.table_name
  table_arn          = module.processing.table_arn
  event_bus_name     = module.processing.event_bus_name
  event_bus_arn      = module.processing.event_bus_arn
  admin_api_key      = var.admin_api_key
  cors_origins       = var.cors_origins
  log_retention_days = var.log_retention_days
}
