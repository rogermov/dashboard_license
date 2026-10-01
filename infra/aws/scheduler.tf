# Liga/desliga a instância automaticamente para economizar crédito.
#
# Como o app é de uso interno, não precisa rodar 24/7. Aqui a instância é
# ligada de manhã e desligada à noite, apenas em dias úteis — nos fins de
# semana fica desligada o tempo todo. Isso corta ~130h/semana de computação
# EC2, fazendo o crédito de 6 meses durar bem mais.
#
# Usamos o EventBridge Scheduler com "universal target" chamando direto a API
# do EC2 (ec2:StartInstances / ec2:StopInstances). Não há Lambda no meio:
# EventBridge Scheduler não tem custo dentro do free tier para esse volume
# (2 disparos/dia), então o scheduler em si é grátis.
#
# Tudo é controlado por variáveis (ver variables.tf):
#   - enable_instance_scheduler: liga/desliga esse automatismo por completo.
#   - scheduler_timezone / *_cron: horários (padrão: seg-sex, 07h liga / 20h desliga, BRT).
#
# OBS sobre custo com a instância parada: parar (stop) zera o custo de
# computação, mas o EBS continua cobrando poucos centavos/mês e o Elastic IP
# ocioso passa a custar ~US$0,005/h (só não é coberto pela franquia de IPv4
# enquanto a instância está desligada). Ainda assim compensa: você deixa de
# pagar a computação, que é a parte cara — e tudo isso ainda sai do crédito.

locals {
  scheduler_count = var.enable_instance_scheduler ? 1 : 0
}

# Role que o EventBridge Scheduler assume para poder ligar/desligar a instância.
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count              = local.scheduler_count
  name               = "${var.project_name}-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

# Permissão mínima: só start/stop, e só nessa instância específica.
data "aws_iam_policy_document" "scheduler_ec2" {
  statement {
    sid       = "StartStopThisInstance"
    actions   = ["ec2:StartInstances", "ec2:StopInstances"]
    resources = [aws_instance.app.arn]
  }
}

resource "aws_iam_role_policy" "scheduler_ec2" {
  count  = local.scheduler_count
  name   = "${var.project_name}-scheduler-ec2"
  role   = aws_iam_role.scheduler[0].id
  policy = data.aws_iam_policy_document.scheduler_ec2.json
}

# Desliga a instância (padrão: 20h, seg-sex, horário de Brasília).
resource "aws_scheduler_schedule" "stop" {
  count = local.scheduler_count
  name  = "${var.project_name}-stop"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.scheduler_stop_cron
  schedule_expression_timezone = var.scheduler_timezone

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.scheduler[0].arn
    input = jsonencode({
      InstanceIds = [aws_instance.app.id]
    })
  }
}

# Liga a instância (padrão: 07h, seg-sex, horário de Brasília).
resource "aws_scheduler_schedule" "start" {
  count = local.scheduler_count
  name  = "${var.project_name}-start"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.scheduler_start_cron
  schedule_expression_timezone = var.scheduler_timezone

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:startInstances"
    role_arn = aws_iam_role.scheduler[0].arn
    input = jsonencode({
      InstanceIds = [aws_instance.app.id]
    })
  }
}
