#!/usr/bin/env bash
# Uso rotineiro: manda código atualizado e reinicia os containers.
# NÃO toca em .env, secrets/ ou data/ no servidor — isso é gerenciado
# diretamente lá (edite via SSH), não por aqui.
#
# Usa tar+ssh em vez de rsync (não depende de ter rsync instalado). Como não
# há um "--delete" real, arquivos REMOVIDOS localmente não são removidos no
# servidor automaticamente — se isso acontecer, rode uma limpeza manual via
# SSH (rm) ou reaplique com ./migrate_initial.sh.
set -euo pipefail
cd "$(dirname "$0")"
PROJECT_ROOT="$(cd ../.. && pwd)"

IP=$(terraform output -raw public_ip)
KEY=$(terraform output -raw private_key_path)
SSH_OPTS="-i $KEY -o StrictHostKeyChecking=accept-new"

echo "==> Enviando código atualizado para $IP (sem tocar em .env/secrets/data)..."
tar czf - -C "$PROJECT_ROOT" \
  --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
  --exclude='infra' --exclude='data' --exclude='.env' --exclude='secrets' \
  --exclude='*.pyc' --exclude='accessguard.tar.gz' \
  . | ssh $SSH_OPTS ubuntu@"$IP" 'mkdir -p /opt/accessguard && tar xzf - -C /opt/accessguard'

echo "==> Rebuild e reinício dos containers..."
ssh $SSH_OPTS ubuntu@"$IP" 'cd /opt/accessguard && docker compose -f docker-compose.aws.yml up -d --build'

echo "Deploy concluído: http://$IP"
