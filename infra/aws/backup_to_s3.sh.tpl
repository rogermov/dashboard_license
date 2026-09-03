#!/usr/bin/env bash
# Roda diariamente via cron (instalado pelo user_data.sh.tpl). Faz uma cópia
# do SQLite pro S3. Usa a role IAM da instância — não tem credencial aqui.
set -euo pipefail

BUCKET="__BUCKET__"
REGION="__REGION__"
DATE=$(date +%F_%H%M)

if [ -f /opt/accessguard/data/accessguard.db ]; then
  aws s3 cp /opt/accessguard/data/accessguard.db \
    "s3://${BUCKET}/backups/accessguard_${DATE}.db" \
    --region "${REGION}"
  echo "[$(date -Is)] backup ok: accessguard_${DATE}.db"
else
  echo "[$(date -Is)] aviso: /opt/accessguard/data/accessguard.db não encontrado, nada pra fazer backup."
fi
