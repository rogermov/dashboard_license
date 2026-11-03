# Role da instância EC2, com permissão mínima: ler/gravar no bucket de backup do
# próprio AccessGuard + Session Manager (SSM). Nada de S3 geral.

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

# Session Manager: terminal pelo console AWS de qualquer lugar, sem chave .pem e
# sem abrir a porta 22 (o agente já vem instalado na AMI do Ubuntu).
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2.name
}
