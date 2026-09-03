#!/bin/bash
# Bootstrap da instância — roda uma única vez, no primeiro boot (cloud-init).
# Não sobe a aplicação em si: só deixa o servidor pronto (Docker, firewall,
# hardening básico de SSH). O deploy do código é feito depois pelo deploy.sh
# (rsync + docker compose), rodado de fora.
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades awscli

# ── Docker Engine + Compose plugin (repositório oficial) ──────────────────
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

usermod -aG docker ubuntu
systemctl enable --now docker

# ── Firewall (defesa em profundidade — o Security Group já filtra, isso é redundância local) ──
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── SSH só por chave — nunca senha (importante porque o SG está liberado para 0.0.0.0/0) ──
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# ── fail2ban contra brute-force de SSH ──
systemctl enable --now fail2ban

# ── Atualizações de segurança automáticas ──
systemctl enable --now unattended-upgrades

# ── Diretório onde o deploy.sh vai colocar o código ──
mkdir -p /opt/${project_name}/data
chown -R ubuntu:ubuntu /opt/${project_name}

# ── Backup diário do SQLite para S3 (o deploy.sh copia este script real; aqui só o cron) ──
cat > /etc/cron.d/${project_name}-backup <<'CRON'
0 6 * * * ubuntu /opt/${project_name}/backup_to_s3.sh >> /var/log/${project_name}-backup.log 2>&1
CRON

echo "Bootstrap concluído." > /var/log/${project_name}-bootstrap-done.log
