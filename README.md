# AccessGuard 🛡️

Dashboard para gestão de acessos de usuários desligados.

## Stack
- **Backend**: Python + FastAPI + SQLite
- **Frontend**: React + Recharts + Tailwind-free CSS
- **Deploy**: Docker Compose

---

## ⚡ Como rodar no Debian

### 1. Instalar Docker (se não tiver)
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Instalar Docker Compose
```bash
sudo apt-get install -y docker-compose-plugin
# ou
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 3. Clonar/copiar o projeto e subir
```bash
cd /opt
# copie a pasta accessguard aqui
cd accessguard
docker compose up -d --build
```

### 4. Acessar
```
http://SEU_IP_DA_VM:3000
```

---

## 📖 Como usar

### Importar desligados do RH
1. Vá em **Importar**
2. Cole o link da Google Sheets do RH (deve estar pública/compartilhada com visualização)
3. Clique em **Importar**

> A coluna de e-mail é detectada automaticamente. Colunas de nome, departamento e data de desligamento também são detectadas se existirem.

### Importar CSV de cada plataforma
1. Vá em **Importar**
2. Exporte o CSV de usuários de cada plataforma (365, DocuSign, Jira, etc.)
3. Arraste o arquivo na dropzone correspondente

> Cada importação **substitui** os dados anteriores daquela plataforma.

### Ver resultados
- **Dashboard**: visão geral, gráficos de exposição, lista de risco
- **Usuários**: tabela filtrável com todos os desligados e seus acessos ativos

---

## 🔌 API (opcional)
```
GET  /stats                          → estatísticas gerais
GET  /users/risk?search=&platform=   → desligados com acesso ativo
GET  /users/terminated?search=       → todos os desligados
POST /import/terminated/gsheet       → importar RH via Google Sheets (form: url)
POST /import/platform/csv            → importar CSV de plataforma (form: platform, file)
DELETE /data/reset                   → limpar banco
```

---

## Estrutura do projeto
```
accessguard/
├── backend/
│   ├── main.py          # API FastAPI
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/       # Dashboard, Import, Users
│   │   ├── components/  # Sidebar
│   │   └── hooks/       # api.js
│   ├── nginx.conf
│   └── Dockerfile
└── docker-compose.yml
```
