# O frontend é buildado LOCALMENTE (vite) e aqui o nginx só SERVE o estático.
# Motivo: o t3.micro (1GB RAM) não aguenta rodar o `vite build` dentro do Docker
# — a build consome toda a RAM, entra em thrashing de swap e trava o servidor.
# Buildar localmente leva ~5s; o deploy vira só copiar os arquivos (rápido e
# sem sobrecarregar a instância). O deploy.sh roda `npm run build` antes de enviar.
#
# Requer a pasta ./build (resultado do `npm run build`). Se ela não existir,
# rode `npm ci && npm run build` em frontend/ antes de buildar esta imagem.
FROM nginx:alpine
COPY build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
