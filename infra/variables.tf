variable "project" {
  type    = string
  default = "energia"
}

variable "env" {
  type    = string
  default = "dev"
}

variable "region" {
  type        = string
  default     = "sa-east-1"
  description = "São Paulo mantém os dados no Brasil. us-east-1 é ~30% mais barato; nesta escala a diferença é de centavos."
}

variable "alert_email" {
  type        = string
  description = "Recebe o alarme de orçamento, o alarme da DLQ e os alertas de energia por SNS."
}

variable "budget_usd" {
  type    = number
  default = 20
}

variable "admin_api_key" {
  type        = string
  sensitive   = true
  description = "Chave do cabeçalho X-Admin-Key para criar clientes na API. Gere algo longo e aleatório."
}

variable "whatsapp_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "whatsapp_phone_id" {
  type    = string
  default = ""
}

variable "whatsapp_to" {
  type    = string
  default = ""
}

variable "whatsapp_template" {
  type    = string
  default = "alerta_energia"
}

variable "cors_origins" {
  type        = string
  default     = "http://localhost:3000,http://127.0.0.1:3000"
  description = "Origens do painel autorizadas a chamar a API, separadas por vírgula. Acrescente a URL publicada do painel."
}

variable "build_dir" {
  type        = string
  default     = "../build"
  description = "Onde scripts/build_lambdas.py deixa core.zip e api.zip, relativo a infra/."
}

variable "log_retention_days" {
  type    = number
  default = 14
}
