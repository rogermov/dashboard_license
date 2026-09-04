# AccessGuard — contexto para continuar em outra máquina

Dashboard interno (FastAPI + React) que cruza funcionários desligados com
contas ativas em plataformas (DocuSign, Google Workspace, Microsoft 365)
para achar acesso/licença paga sobrando. Dono: Rogério Conceição
(rogerio.conceicao@comporte.com.br), Comporte.

Repo: https://github.com/rogermov/dashboard_license (branch principal de
trabalho até aqui: `create/pageM365`)

## Estado atual (nesta sessão)

1. **Feature de licença real do DocuSign** — PR aberto a partir de
   `feat/docusign-license-real-api`. Resumo: a eSignature API não deixa
   *ler* o tipo de licença (Free/Professional), só gravar. Descobrimos que a
   **Admin API do DocuSign** (`api.docusign.net/Management/v2`, escopos
   `organization_read user_read account_read`, precisa de consentimento
   próprio) expõe isso via um export organizacional
   (`organization_memberships_export`) que cobre as 4 contas de uma vez.
   Isso substituiu um fluxo manual de import de CSV. Também corrigimos bugs
   de paginação/fuso-horário no relatório de envelopes, e banners de erro
   que persistiam depois de sync bem-sucedido.

2. **Deploy na AWS** — PR aberto a partir de `feat/aws-terraform-deploy`.
   Infra em `infra/aws/` (Terraform): 1x EC2 t3.micro (sem ALB/NAT/Fargate —
   nenhum entra no free tier), Elastic IP, backup diário do SQLite pro S3,
   AWS Budgets + SNS pra alerta de custo. **Já está no ar em produção**:
   `http://54.85.24.144`. State do Terraform migrado pro backend S3
   (`s3://accessguard-tfstate-400350496243`, lock via DynamoDB
   `accessguard-tf-lock`) — importante: **a chave SSH da instância vive
   dentro desse state**, então qualquer máquina nova com credencial AWS
   consegue recriá-la localmente rodando só `terraform apply` (não precisa
   copiar o `.pem` de lugar nenhum).

3. **Basic Auth** (feito agora, ainda sem PR/commit) — a app estava 100%
   sem autenticação, exposta no IP público. Adicionamos `auth_basic` no
   nginx (usuário/senha únicos, compartilhados) protegendo tudo (SPA + API).
   A senha fica em `frontend/.htpasswd` (gitignored, nunca vai pro GitHub).
   **Isso é um remendo rápido** — o próximo passo natural é um login de
   verdade (usuário por pessoa, JWT/sessão), ainda não feito.

## Pendências conhecidas

- Mergear os 2 PRs (licença DocuSign, infra AWS) — ainda não commitei/pushei
  a mudança do Basic Auth, fazer isso também.
- Login "de verdade" (multi-usuário) — Basic Auth é só o remendo imediato.
- Validar a app rodando na AWS por alguns dias antes de desligar a VM antiga.
- Achar/consolidar os 31 usuários com possível corte indevido de licença
  Professional identificados na investigação do bug de contagem de
  envelopes (arquivo `possiveis_cortes_indevidos.csv`, ficou num scratchpad
  de sessão anterior — se ainda não tratado, vale re-gerar a lista).

## Como pegar isso numa máquina nova

```bash
git clone https://github.com/rogermov/dashboard_license.git
cd dashboard_license
git checkout create/pageM365   # ou main, dependendo do que já foi mergeado

# instalar terraform + aws cli (sem sudo, se precisar):
# ver infra/aws/README.md

cd infra/aws
# AWS credentials: aws configure (chave da conta de teste)
terraform init          # já aponta pro backend S3, não precisa reconfigurar
terraform apply         # não muda infra real — só recria o accessguard-key.pem local
./deploy.sh              # deploy de rotina (não toca em .env/secrets/banco)
```

`.env`, `secrets/docusign.pem` e `frontend/.htpasswd` **não estão no git**
(de propósito). Eles já existem rodando na instância EC2 de produção — se
precisar deles numa máquina nova antes de reconstituir do zero, dá pra
puxar de lá via SSH (`ssh -i accessguard-key.pem ubuntu@<ip>`, arquivos em
`/opt/accessguard/`).

## Convenções desta sessão (aplicar daqui pra frente)

- Credenciais nunca são coladas no chat — sempre editadas direto no
  servidor/`.env`, ou geradas localmente e mostradas só pra confirmação.
- Mudanças de infraestrutura AWS reais (`terraform apply`) pedem
  confirmação explícita antes de rodar.
- Scripts de deploy usam `tar`+`ssh` (não `rsync` — não estava disponível
  sem privilégio de root no ambiente original).
