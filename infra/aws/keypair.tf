# Gera um par de chaves SSH novo, só para essa instância. A chave privada é
# salva localmente (fora do state seria o ideal, mas para uma conta de teste
# isso é aceitável — trate o .pem gerado como segredo, não versione no git).

resource "tls_private_key" "ssh" {
  algorithm = "ED25519"
}

resource "aws_key_pair" "app" {
  key_name   = "${var.project_name}-key"
  public_key = tls_private_key.ssh.public_key_openssh
}

resource "local_sensitive_file" "private_key" {
  filename        = "${path.module}/${var.project_name}-key.pem"
  content         = tls_private_key.ssh.private_key_openssh
  file_permission = "0600"
}
