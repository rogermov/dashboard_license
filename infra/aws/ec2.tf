data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.chosen.id
  vpc_security_group_ids = [aws_security_group.app.id]
  key_name               = aws_key_pair.app.key_name
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  associate_public_ip_address = true

  # Exige IMDSv2 (evita exploração de metadata via SSRF na aplicação).
  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    project_name = var.project_name
  })
  user_data_replace_on_change = true

  tags = {
    Name = "${var.project_name}-server"
  }

  # data.aws_ami.ubuntu usa most_recent = true — sem isso, todo "terraform
  # plan" recalcula a AMI mais nova do momento e, como a AMI é imutável na
  # instância, isso força recriar o servidor inteiro (perde dado, troca IP
  # até o EIP reassociar) só por causa de um patch novo da Canonical, sem
  # nenhuma mudança real pretendida. Pra atualizar a AMI de propósito algum
  # dia, faça isso deliberadamente (removendo o ignore_changes por uma
  # rodada, com backup/migração planejados) — nunca como efeito colateral.
  lifecycle {
    ignore_changes = [ami]
  }
}
