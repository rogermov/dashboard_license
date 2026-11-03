variable "aws_region" {
  description = "Região AWS onde tudo será criado."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefixo usado no nome dos recursos."
  type        = string
  default     = "accessguard"
}

variable "instance_type" {
  description = "Tipo da instância EC2. t3.micro é elegível a free tier e sobra pra essa aplicação (backend leve + SQLite de 34MB)."
  type        = string
  default     = "t3.micro"
}

variable "root_volume_size" {
  description = "Tamanho (GB) do disco raiz. Free tier clássico cobre até 30GB; aqui usamos bem menos que isso."
  type        = number
  default     = 16
}

variable "ssh_cidrs" {
  description = "IPs liberados para a porta 22 (SSH), em /32. Obrigatório e fora do git: defina em terraform.tfvars. Se o IP mudar, ajuste lá (ou no Security Group pelo console) — o painel (porta 80) não depende disso."
  type        = list(string)

  validation {
    condition     = length(var.ssh_cidrs) > 0 && !contains(var.ssh_cidrs, "0.0.0.0/0")
    error_message = "Informe ao menos um IP e não use 0.0.0.0/0."
  }
}

variable "alert_email" {
  description = "E-mail que vai receber os alertas de orçamento (AWS Budgets). Obrigatório — sem isso o alarme de custo não tem para onde avisar."
  type        = string
}

variable "budget_limit_usd" {
  description = "Teto mensal (em USD) usado como referência para os alertas de orçamento. Não bloqueia gastos, só avisa — é só um watchdog."
  type        = number
  default     = 10
}

variable "enable_instance_scheduler" {
  description = "Se true, cria o agendamento que liga/desliga a EC2 automaticamente (economiza crédito fora do horário de uso). Coloque false para deixar a instância rodando 24/7."
  type        = bool
  default     = true
}

variable "scheduler_timezone" {
  description = "Fuso horário usado nos horários de liga/desliga (formato IANA). Padrão: horário de Brasília."
  type        = string
  default     = "America/Sao_Paulo"
}

variable "scheduler_start_cron" {
  description = "Quando LIGAR a instância (cron do EventBridge Scheduler). Padrão: 07h, seg-sex."
  type        = string
  default     = "cron(0 7 ? * MON-FRI *)"
}

variable "scheduler_stop_cron" {
  description = "Quando DESLIGAR a instância (cron do EventBridge Scheduler). Padrão: 20h, seg-sex."
  type        = string
  default     = "cron(0 20 ? * MON-FRI *)"
}
