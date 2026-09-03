terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Estado remoto em S3, com lock via DynamoDB (evita dois "terraform apply"
  # simultâneos de máquinas diferentes brigando pelo mesmo state). O bucket e
  # a tabela são geridos pelo próprio Terraform (state_backend.tf) — foram
  # criados primeiro com backend local, depois migrados pra cá.
  backend "s3" {
    bucket         = "accessguard-tfstate-400350496243"
    key            = "accessguard/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "accessguard-tf-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Env       = "free-tier-test"
    }
  }
}
