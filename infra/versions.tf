terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  # Estado local no começo. Quando houver mais de uma máquina fazendo apply, mover para S3:
  # backend "s3" { bucket = "...-tfstate" key = "energia/dev.tfstate" region = "sa-east-1" use_lockfile = true }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}
