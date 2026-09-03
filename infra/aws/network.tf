# Usa a VPC default da conta (já existe em toda conta AWS nova, sem custo).
# Não criamos VPC/NAT Gateway próprios de propósito: NAT Gateway tem custo por
# hora + por GB e NÃO entra no free tier — é a causa mais comum de fatura
# "grátis" vir com cobrança. A instância fica numa subnet pública, com IP
# público direto, sem precisar de NAT.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Pega a primeira subnet default disponível na região.
data "aws_subnet" "chosen" {
  id = tolist(data.aws_subnets.default.ids)[0]
}
