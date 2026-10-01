# Elastic IP fixo (IP público que não muda entre reinicializações).
#
# ATENÇÃO — regra atualizada (desde fev/2024): a AWS cobra por TODO endereço
# IPv4 público (~US$0,005/h ≈ US$3,60/mês), inclusive quando o EIP está
# associado a uma instância rodando. O que existe é uma FRANQUIA de 750h/mês
# de IPv4 público enquanto anexado a uma EC2 em execução — que cobre este
# único EIP durante o período gratuito. Quando a instância está DESLIGADA
# (ex.: pelo scheduler em scheduler.tf), o EIP fica ocioso e essas horas não
# entram na franquia, passando a descontar do crédito.
#
# Se for pausar o projeto por muito tempo, prefira `terraform destroy`
# completo em vez de só parar a instância.

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = {
    Name = "${var.project_name}-eip"
  }
}
