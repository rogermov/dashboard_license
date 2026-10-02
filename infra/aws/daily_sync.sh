#!/usr/bin/env bash
# Sync diário das 3 integrações (DocuSign, Microsoft 365, Google).
# Roda às 05h (cron), antes do backup das 06h, para o painel e os alertas de
# limite de licença ficarem sempre frescos.
#
# Chama o backend por DENTRO do container (porta 8000, sem passar pelo nginx) —
# então não precisa de senha. Cada integração tenta até 3 vezes (retry) porque
# chamadas externas (ex.: Google Apps Script com milhares de usuários) às vezes
# dão timeout transitório.
#
# Instalação (feita uma vez, no servidor):
#   cp infra/aws/daily_sync.sh /opt/accessguard/daily_sync.sh && chmod +x ...
#   echo '0 5 * * * ubuntu /opt/accessguard/daily_sync.sh' | sudo tee /etc/cron.d/accessguard-sync
set -uo pipefail
LOG=/opt/accessguard/sync.log

run() {
  local name="$1" endpoint="$2" attempt
  for attempt in 1 2 3; do
    echo "[$(date -Is)] -> $name (tentativa $attempt)" >> "$LOG"
    if docker exec accessguard-api python -c "import urllib.request as u; print(u.urlopen(u.Request('http://localhost:8000/$endpoint', method='POST'), timeout=240).read().decode()[:300])" >> "$LOG" 2>&1; then
      return 0
    fi
    echo "[$(date -Is)] falhou (tentativa $attempt) — aguardando 15s" >> "$LOG"
    sleep 15
  done
  echo "[$(date -Is)] FALHOU definitivo: $endpoint" >> "$LOG"
}

run "DocuSign"       "docusign/sync"
run "Microsoft 365"  "microsoft365/sync"
run "Google"         "google/sync"
# Depois de atualizar os dados, checa limites e notifica no Google Chat se preciso
# (só envia se GOOGLE_CHAT_WEBHOOK_URL estiver configurado no .env).
run "Alerta de licencas" "alerts/license-check"
echo "[$(date -Is)] sync diário concluído" >> "$LOG"
