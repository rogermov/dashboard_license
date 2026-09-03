# Elastic IP fixo — importante para o Free Tier: um EIP só é gratuito
# ENQUANTO estiver associado a uma instância em execução. Se você parar a
# instância (stop) sem liberar o EIP, ele passa a ser cobrado (~US$0,005/h).
# Se for pausar por muito tempo, rode `terraform destroy -target=aws_eip.app`
# ou solte o EIP manualmente antes de parar a instância.

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = {
    Name = "${var.project_name}-eip"
  }
}
