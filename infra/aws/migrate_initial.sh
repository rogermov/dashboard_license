#!/usr/bin/env bash
# Uso ÚNICO: primeira ida à instância nova. Copia código + .env + secrets/ +
# o banco atual (exportado do container local) e sobe os containers.
# Depois disso, use ./deploy.sh para atualizações de código (não mexe no banco).
#
# Usa tar+ssh em vez de rsync (não depende de ter rsync instalado).
set -euo pipefail
cd "$(dirname "$0")"
PROJECT_ROOT="$(cd ../.. && pwd)"

IP=$(terraform output -raw public_ip)
KEY=$(terraform output -raw private_key_path)
BUCKET=$(terraform output -raw s3_backup_bucket)
REGION=$(terraform output -raw aws_region)
SSH_OPTS="-i $KEY -o StrictHostKeyChecking=accept-new"

echo "==> Exportando banco atual do container local (accessguard-api)..."
mkdir -p /tmp/accessguard_migrate
if docker cp accessguard-api:/data/accessguard.db /tmp/accessguard_migrate/accessguard.db 2>/dev/null; then
  echo "    OK: $(du -h /tmp/accessguard_migrate/accessguard.db | cut -f1)"
else
  echo "    aviso: não consegui copiar o banco do container local. Seguindo sem ele (sobe zerado)."
fi

echo "==> Aguardando o bootstrap (cloud-init) da instância terminar..."
ssh $SSH_OPTS ubuntu@"$IP" 'cloud-init status --wait' || true

echo "==> Enviando código + .env + secrets/ para $IP (tar via ssh)..."
tar czf - -C "$PROJECT_ROOT" \
  --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
  --exclude='infra' --exclude='data' --exclude='*.pyc' --exclude='accessguard.tar.gz' \
  . | ssh $SSH_OPTS ubuntu@"$IP" 'mkdir -p /opt/accessguard && tar xzf - -C /opt/accessguard'

if [ -f /tmp/accessguard_migrate/accessguard.db ]; then
  echo "==> Enviando banco de dados..."
  ssh $SSH_OPTS ubuntu@"$IP" 'mkdir -p /opt/accessguard/data'
  scp $SSH_OPTS /tmp/accessguard_migrate/accessguard.db ubuntu@"$IP":/opt/accessguard/data/accessguard.db
fi

echo "==> Enviando script de backup para S3..."
sed -e "s/__BUCKET__/$BUCKET/" -e "s/__REGION__/$REGION/" backup_to_s3.sh.tpl > /tmp/backup_to_s3.sh
scp $SSH_OPTS /tmp/backup_to_s3.sh ubuntu@"$IP":/opt/accessguard/backup_to_s3.sh
ssh $SSH_OPTS ubuntu@"$IP" 'chmod +x /opt/accessguard/backup_to_s3.sh'

echo "==> Subindo os containers (build)..."
ssh $SSH_OPTS ubuntu@"$IP" 'cd /opt/accessguard && docker compose -f docker-compose.aws.yml up -d --build'

echo
echo "Pronto! http://$IP"
echo "SSH: ssh -i $KEY ubuntu@$IP"
