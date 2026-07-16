FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.ssl.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-tls-setup.sh /docker-entrypoint.d/40-tls-setup.sh
RUN chmod +x /docker-entrypoint.d/40-tls-setup.sh

EXPOSE 80 443
