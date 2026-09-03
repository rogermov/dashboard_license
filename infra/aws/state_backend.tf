# Bucket + tabela de lock para o próprio terraform.tfstate. Custo real: ~US$0,00
# (arquivo de poucas dezenas de KB, poucas leituras/gravações por mês — muito
# abaixo de qualquer limite, com ou sem free tier).
#
# Bootstrap em 2 passos (padrão comum pra isso, evita referência circular):
#   1) `terraform apply` com esses recursos ainda usando o backend local.
#   2) Depois, o backend "s3" em main.tf aponta pra cá e rodamos
#      `terraform init -migrate-state` pra mover o state pra dentro do bucket.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# PAY_PER_REQUEST = zero custo fixo, cobra só por request de lock (irrisório
# no nosso uso — poucos terraform apply/plan por mês).
resource "aws_dynamodb_table" "tf_lock" {
  name         = "${var.project_name}-tf-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "tfstate_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}

output "tf_lock_table" {
  value = aws_dynamodb_table.tf_lock.name
}
