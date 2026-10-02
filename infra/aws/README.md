# AccessGuard na AWS (Free Tier / conta de teste de 6 meses)

Infraestrutura como código (Terraform) para rodar o AccessGuard numa EC2
`t3.micro`, exatamente como já roda hoje via Docker Compose — só que numa
conta AWS nova, dentro do período gratuito.

## Por que essa arquitetura e não Lambda/RDS/ALB?

O app é leve (backend FastAPI + SQLite de ~34MB + frontend estático) e de
baixo tráfego (uso interno). Uma única EC2 pequena cobre tudo com folga e,
mais importante, **evita os serviços que normalmente furam o free tier**:

- **NAT Gateway**: cobra por hora + por GB, não é free tier. Não usamos —
  a instância fica direto na subnet pública.
- **Application Load Balancer**: cobra por hora (~US$16-20/mês), não é free
  tier. Não usamos — TLS seria terminado direto na instância (nginx).
- **Fargate**: não tem free tier. Não usamos.
- **RDS**: teria free tier (750h db.t3.micro), mas o banco é SQLite de 34MB —
  trocar de banco só pra isso seria complexidade sem ganho.

Resultado: só EC2 + EBS + S3 (backup) + SNS (alerta de custo). Mesmo que a
conta não seja 100% "free tier clássico", uma t3.micro rodando 24/7 custa
uns **US$7-8/mês** — os US$200 de crédito da promoção de 6 meses cobrem isso
com folga enorme.

## O que o Terraform cria

| Recurso | Para quê |
|---|---|
| 1x EC2 `t3.micro` (Ubuntu 22.04) | Roda os containers (Docker Compose) |
| 1x Elastic IP | IP público fixo (não muda se reiniciar a instância) |
| 1x Security Group | 22 (SSH), 80 (HTTP), 443 (reservado p/ TLS futuro) |
| 1x par de chaves SSH | Gerado pelo Terraform, salvo local como `.pem` |
| 1x Role/Instance Profile IAM | Só permissão de gravar no bucket de backup |
| 1x bucket S3 privado | Backup diário do SQLite |
| 2x AWS Budgets + 1x SNS topic | Alerta por e-mail se o gasto passar de US$1 / 50% / 80% / 100% do teto |
| 2x EventBridge Scheduler + 1x Role IAM | Liga/desliga a instância em horário útil p/ economizar crédito (opcional) |

Não cria VPC própria — usa a VPC default da conta (já existe, sem custo).

## Liga/desliga automático (economia de crédito)

Como o app é de uso interno, ele não precisa ficar ligado 24/7. Por padrão a
instância é **ligada às 07h e desligada às 20h, de segunda a sexta** (horário
de Brasília), e fica desligada nos fins de semana. Isso corta ~130h/semana de
computação EC2 — a parte mais cara — fazendo o crédito de 6 meses durar bem
mais.

Configurável em `terraform.tfvars`:

```hcl
enable_instance_scheduler = true                       # false = roda 24/7
scheduler_timezone        = "America/Sao_Paulo"
scheduler_start_cron      = "cron(0 7 ? * MON-FRI *)"  # liga 07h seg-sex
scheduler_stop_cron       = "cron(0 20 ? * MON-FRI *)" # desliga 20h seg-sex
```

Usa EventBridge Scheduler chamando direto a API do EC2 (sem Lambda, sem custo
para 2 disparos/dia). Para ligar/desligar manualmente fora do horário, basta
usar o Console/AWS CLI (`aws ec2 start-instances` / `stop-instances`) — o
agendamento volta a agir no próximo horário.

> Detalhe de custo: com a instância desligada, o Elastic IP ocioso passa a
> descontar ~US$0,005/h do crédito (fora da franquia de IPv4, que só vale com
> a instância rodando). Mesmo assim compensa, pois você deixa de pagar a
> computação, que é o item mais caro.

## Pré-requisitos (na sua máquina, não aqui no chat)

```bash
# Terraform >= 1.5
# https://developer.hashicorp.com/terraform/install

# AWS CLI (opcional, útil para debug)
# https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

# Configure as credenciais da conta NOVA (a de teste), NUNCA cole aqui no chat:
aws configure --profile accessguard-test
# ou exporte:
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1
```

> Por segurança, gere um usuário IAM próprio para isso (não use a root da
> conta) com permissão de administrador só nessa conta de teste, e nunca
> compartilhe as chaves por chat/e-mail.

## Passo a passo

```bash
cd infra/aws

# 1. Configure suas variáveis
cp terraform.tfvars.example terraform.tfvars
# edite terraform.tfvars e confirme seu e-mail de alerta

# 2. Baixa os providers
terraform init

# 3. Revisa o que vai ser criado (não aplica nada ainda)
terraform plan

# 4. Aplica de fato
terraform apply
# confirme com "yes"
```

No fim, o Terraform mostra algo como:

```
app_url = "http://54.xxx.xxx.xxx"
ssh_command = "ssh -i accessguard-key.pem ubuntu@54.xxx.xxx.xxx"
private_key_path = "./accessguard-key.pem"
s3_backup_bucket = "accessguard-backups-a1b2c3d4"
```

**Confirme o e-mail do SNS** — a AWS manda um "Confirm subscription" pro
e-mail que você colocou em `alert_email`; sem clicar nele os alertas de
orçamento não chegam.

### 5. Migração inicial (código + banco atual + .env + secrets/)

Isso só roda **uma vez**, pra levar tudo que já está rodando hoje (incluindo
o banco com os dados atuais) pro servidor novo:

```bash
./migrate_initial.sh
```

O script:
1. Exporta o `accessguard.db` do container que está rodando localmente.
2. Espera o bootstrap da instância nova terminar (Docker, firewall, etc.).
3. Envia código + `.env` + `secrets/docusign.pem` + o banco via `tar` (compactado) por SSH — não depende de ter `rsync` instalado.
4. Sobe os containers com `docker compose -f docker-compose.aws.yml up -d --build`.
5. Envia e ativa o script de backup diário pro S3.

> Nota: como usamos `tar` em vez de `rsync`, não existe um "--delete"
> automático — se você remover um arquivo localmente, ele não é removido no
> servidor sozinho. Raramente importa no dia a dia; se acontecer, apague
> manualmente via SSH.

Depois disso, acesse `http://<IP-mostrado-no-output>` — deve ser o mesmo
dashboard, com os mesmos dados de hoje.

### 6. Atualizações de código depois (rotina)

```bash
./deploy.sh
```

Isso manda só o código atualizado (não toca em `.env`, `secrets/` nem no
banco no servidor) e reinicia os containers. Se precisar mudar `.env` ou
credenciais no servidor novo, **edite direto lá via SSH** (mesmo princípio
de segurança de antes — segredo não passa pelo chat):

```bash
ssh -i accessguard-key.pem ubuntu@<IP>
cd /opt/accessguard && nano .env
docker compose -f docker-compose.aws.yml up -d --build
```

## Backups

Backup diário automático (cron às 06:00) do `accessguard.db` pro bucket S3,
usando a role IAM da instância (sem credencial gravada no servidor). Retenção
de 60 dias (depois disso o S3 apaga sozinho — configurado no Terraform).

Pra restaurar um backup:
```bash
aws s3 cp s3://<bucket>/backups/accessguard_2026-09-01_0600.db /tmp/restore.db
scp -i accessguard-key.pem /tmp/restore.db ubuntu@<IP>:/opt/accessguard/data/accessguard.db
ssh -i accessguard-key.pem ubuntu@<IP> 'cd /opt/accessguard && docker compose -f docker-compose.aws.yml restart backend'
```

## Automações (cron) — ATENÇÃO ao horário vs scheduler

A instância fica ligada só **07h–20h BRT, seg–sex** (scheduler). O SO está em **UTC**,
então essa janela é **10h–23h UTC**. Qualquer cron **fora** dessa janela **nunca roda**
(a máquina está desligada). Os horários abaixo já respeitam isso:

| Cron (`/etc/cron.d/`) | Horário (UTC) | BRT | O quê |
|---|---|---|---|
| `accessguard-sync` | `30 10 * * 1-5` | 07:30 | Sync completo (DocuSign+M365+Google) + alertas de licença (`daily_sync.sh`) |
| `accessguard-live-check` | `*/15 10-22 * * 1-5` | a cada 15 min | Movimentações de usuários DocuSign → Google Chat (`docusign_live_check.sh`) |
| `accessguard-backup` | `30 22 * * 1-5` | 19:30 | Backup do SQLite pro S3 (`backup_to_s3.sh`) |

> O usuário `ubuntu` **não escreve em `/var/log`** — logs vão para `/opt/accessguard/*.log`.
> O `sync` e o `live-check` são instalados **após o deploy** (os scripts ficam em
> `/opt/accessguard`); o `backup` é instalado pelo `user_data` no primeiro boot.

## Custos — o que observar

- **EIP / IPv4**: desde fev/2024 a AWS cobra por todo IP público (~US$0,005/h ≈
  US$3,60/mês). Há uma franquia de 750h/mês **enquanto o IP está anexado a uma
  instância rodando**, que cobre este EIP no período gratuito. Com a instância
  desligada (fim de semana / fora do horário do scheduler) essas horas ociosas
  não entram na franquia e descontam do crédito. Se for pausar o projeto por
  muito tempo, rode `terraform destroy` completo em vez de só parar a instância.
- **EC2 parada não é "grátis por padrão"**: parar (`stop`) não cobra
  computação, mas o EBS anexado continua cobrando (poucos centavos/mês pra
  16GB). Não é motivo de alarme, só pra você entender a fatura.
- Os dois `aws_budgets_budget` (US$1 "canário" e US$10 "teto") te avisam por
  e-mail antes de qualquer coisa virar surpresa.

## Segurança (dado que você escolheu SSH aberto a 0.0.0.0/0)

- Login por senha está **desabilitado** (`PasswordAuthentication no`) — só
  entra com a chave `.pem` gerada.
- `fail2ban` ativo, banindo IPs com tentativas de força bruta.
- Atualizações de segurança automáticas (`unattended-upgrades`).
- IMDSv2 obrigatório (mitiga SSRF pegando credenciais da instância).
- A porta 8000 (backend) **não é exposta** publicamente — só a 80, via nginx,
  que faz proxy interno pro backend dentro da rede Docker.
- Trate `accessguard-key.pem` como segredo: não commite, não mande por chat.

## Destruir tudo (fim do teste / trocar de conta)

```bash
terraform destroy
```

Isso remove EC2, EIP, Security Group, bucket S3 (**e os backups nele** —
baixe o que precisar antes) e as roles IAM. Não afeta em nada sua VM atual.
