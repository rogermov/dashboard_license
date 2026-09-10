# Role da instância EC2, com permissão mínima: só consegue ler/gravar no bucket
# de backup do próprio AccessGuard. Nada de S3 geral, nada de outros serviços.

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "${var.project_name}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

data "aws_iam_policy_document" "backup_access" {
  statement {
    sid       = "ListBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn]
  }
  statement {
    sid       = "ReadWriteObjects"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }
}

resource "aws_iam_role_policy" "backup_access" {
  name   = "${var.project_name}-s3-backup-access"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.backup_access.json
}

# Permite só publicar no tópico de alertas já existente (o mesmo do orçamento)
# — usado pelo fail2ban pra avisar por e-mail quando bane um IP por brute-force
# no login. Nenhuma outra permissão de SNS (não lista, não assina, não cria).
data "aws_iam_policy_document" "sns_publish" {
  statement {
    sid       = "PublishBanAlerts"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.budget_alerts.arn]
  }
}

resource "aws_iam_role_policy" "sns_publish" {
  name   = "${var.project_name}-sns-publish-alerts"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.sns_publish.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2.name
}
