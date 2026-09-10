FROM node:18-alpine AS builder
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV CI=false
COPY package.json .
RUN npm install
COPY . .
RUN npm run build
FROM nginx:alpine
# A imagem base deixa /var/log/nginx/{access,error}.log como symlink pro
# stdout/stderr do container (bom pra `docker logs`, mas invisível pra
# ferramentas externas como o fail2ban). Removendo os symlinks, o nginx
# cria arquivos de verdade no lugar — daí um bind mount no docker-compose
# consegue expor isso pro host.
RUN rm -f /var/log/nginx/access.log /var/log/nginx/error.log
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
