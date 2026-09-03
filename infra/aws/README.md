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

Não cria VPC própria — usa a VPC default da conta (já existe, sem custo).

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

## Custos — o que observar

- **EIP**: só é grátis enquanto associado a uma instância *rodando*. Se você
  parar a instância (`stop`) por muito tempo sem motivo, o EIP passa a ser
  cobrado (~US$0,005/h ≈ US$3,60/mês). Se for pausar por bastante tempo,
  rode `terraform destroy` completo em vez de só parar a instância.
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
