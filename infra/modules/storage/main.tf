variable "name" { type = string }
variable "account_id" { type = string }
variable "region" { type = string }
variable "log_retention_days" { type = number }

# ---------------------------------------------------------------- lake (S3)

resource "aws_s3_bucket" "lake" {
  bucket = "${var.name}-lake-${var.account_id}"
}

resource "aws_s3_bucket_public_access_block" "lake" {
  bucket                  = aws_s3_bucket.lake.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lake" {
  bucket = aws_s3_bucket.lake.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "lake" {
  bucket = aws_s3_bucket.lake.id

  rule {
    id     = "camadas-de-custo"
    status = "Enabled"
    filter {
      prefix = "leituras/"
    }
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 365
      storage_class = "GLACIER_IR"
    }
  }
}

resource "aws_s3_bucket" "athena" {
  bucket = "${var.name}-athena-${var.account_id}"
}

resource "aws_s3_bucket_public_access_block" "athena" {
  bucket                  = aws_s3_bucket.athena.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "athena" {
  bucket = aws_s3_bucket.athena.id
  rule {
    id     = "resultados-expiram"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
  }
}

# ---------------------------------------------------------------- catálogo (Glue)

resource "aws_glue_catalog_database" "this" {
  name = replace(var.name, "-", "_")
}

# A Lambda processadora grava JSON Lines gzip por lote (ver src/energia/adapters/lake.py).
# Partições por projeção: o Athena descobre tenant/site/dia pelo caminho, sem MSCK REPAIR nem crawler.
resource "aws_glue_catalog_table" "leituras" {
  name          = "leituras"
  database_name = aws_glue_catalog_database.this.name
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    classification                = "json"
    "projection.enabled"          = "true"
    "projection.tenant_id.type"   = "injected"
    "projection.site_id.type"     = "injected"
    "projection.dt.type"          = "date"
    "projection.dt.range"         = "2026-01-01,NOW"
    "projection.dt.format"        = "yyyy-MM-dd"
    "projection.dt.interval"      = "1"
    "projection.dt.interval.unit" = "DAYS"
    "storage.location.template"   = "s3://${aws_s3_bucket.lake.bucket}/leituras/tenant_id=$${tenant_id}/site_id=$${site_id}/dt=$${dt}/"
  }

  partition_keys {
    name = "tenant_id"
    type = "string"
  }
  partition_keys {
    name = "site_id"
    type = "string"
  }
  partition_keys {
    name = "dt"
    type = "string"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.lake.bucket}/leituras/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      name                  = "json"
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "true"
      }
    }

    columns {
      name = "meter_id"
      type = "string"
    }
    columns {
      name = "ts"
      type = "string"
    }
    columns {
      name = "kw"
      type = "double"
    }
    columns {
      name = "kvar"
      type = "double"
    }
    columns {
      name = "kwh_total"
      type = "double"
    }
    columns {
      name = "v"
      type = "double"
    }
    columns {
      name = "a"
      type = "double"
    }
    columns {
      name = "pf"
      type = "double"
    }
    columns {
      name = "hz"
      type = "double"
    }
    columns {
      name = "seq"
      type = "bigint"
    }
  }
}

# ---------------------------------------------------------------- Athena

resource "aws_athena_workgroup" "this" {
  name          = var.name
  force_destroy = true

  configuration {
    enforce_workgroup_configuration = true
    bytes_scanned_cutoff_per_query  = 1073741824 # 1 GB por consulta: trava contra SELECT * sem partição

    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena.bucket}/resultados/"
    }
  }
}

output "lake_bucket" { value = aws_s3_bucket.lake.bucket }
output "lake_bucket_arn" { value = aws_s3_bucket.lake.arn }
output "glue_database" { value = aws_glue_catalog_database.this.name }
output "athena_workgroup" { value = aws_athena_workgroup.this.name }
