#!/usr/bin/env bash
# Configura o fail2ban (já instalado pelo user_data.sh.tpl, hoje só protege
# SSH) para também vigiar tentativas de senha errada no Basic Auth do
# AccessGuard: 15 tentativas erradas em 10 minutos -> bane o IP por 24h no
# firewall (iptables) + publica um alerta no SNS (mesmo tópico do orçamento).
#
# Idempotente: pode rodar de novo a qualquer momento (ex: depois de recriar
# a instância) que só sobrescreve os mesmos arquivos.
set -euo pipefail

SNS_TOPIC_ARN="__SNS_TOPIC_ARN__"
AWS_REGION="__AWS_REGION__"

sudo tee /etc/fail2ban/action.d/accessguard-sns.conf > /dev/null <<EOF
[Definition]
actionban = /usr/bin/aws sns publish --region ${AWS_REGION} --topic-arn "${SNS_TOPIC_ARN}" --subject "AccessGuard: IP banido (brute-force)" --message "O IP <ip> foi banido por 24h apos tentativas de login malsucedidas no AccessGuard." >> /var/log/accessguard-fail2ban-sns.log 2>&1
actionunban =
EOF

sudo tee /etc/fail2ban/jail.d/accessguard-nginx.conf > /dev/null <<'EOF'
[accessguard-authbasic]
enabled  = true
port     = http,https
filter   = nginx-http-auth
logpath  = /opt/accessguard/logs/nginx/error.log
maxretry = 15
findtime = 600
bantime  = 86400
# O tráfego pra portas publicadas do Docker (80/443) passa pela chain
# DOCKER-USER (FORWARD), não pela INPUT -- por isso o banaction precisa
# mirar nela explicitamente, senão a regra de ban nunca é consultada.
action   = iptables-multiport[name=accessguard-authbasic, port="http,https", protocol=tcp, chain=DOCKER-USER]
           accessguard-sns
EOF

sudo systemctl restart fail2ban
sleep 2
echo "=== jails ativas ==="
sudo fail2ban-client status
echo "=== detalhe da jail nova ==="
sudo fail2ban-client status accessguard-authbasic
