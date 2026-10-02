#!/usr/bin/env bash
# Opção 2 (near real-time): checa movimentações de usuários do DocuSign a cada 15 min
# e notifica no Google Chat. Atualiza só os usuários (API leve por conta), sem o export
# pesado de licenças. Como a instância fica off 20h-07h e fins de semana (scheduler),
# isso só roda em horário comercial — exatamente quando os admins mexem.
#
# Instalação (uma vez, no servidor):
#   cp infra/aws/docusign_live_check.sh /opt/accessguard/docusign_live_check.sh && chmod +x ...
#   echo '*/15 * * * * ubuntu /opt/accessguard/docusign_live_check.sh' | sudo tee /etc/cron.d/accessguard-live-check
set -uo pipefail
LOG=/opt/accessguard/live_check.log

# mantém o log pequeno (últimas 500 linhas)
if [ -f "$LOG" ]; then tail -n 500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null || true; fi

echo "[$(date -Is)] -> docusign live-check" >> "$LOG"
docker exec accessguard-api python -c "import urllib.request as u; print(u.urlopen(u.Request('http://localhost:8000/alerts/docusign-live-check', method='POST'), timeout=200).read().decode()[:300])" >> "$LOG" 2>&1 \
  || echo "[$(date -Is)] FALHOU" >> "$LOG"
