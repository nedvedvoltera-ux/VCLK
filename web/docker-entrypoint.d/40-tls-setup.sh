#!/bin/sh
set -eu

CERT_DIR=/etc/nginx/certs
CUSTOM_CERT_DIR=/etc/nginx/certs/custom
mkdir -p "$CERT_DIR"

PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-_}"
HTTPS_PUBLIC_PORT="${HTTPS_PUBLIC_PORT:-8443}"

if [ -f "$CUSTOM_CERT_DIR/fullchain.pem" ] && [ -f "$CUSTOM_CERT_DIR/privkey.pem" ]; then
  cp "$CUSTOM_CERT_DIR/fullchain.pem" "$CERT_DIR/server.crt"
  cp "$CUSTOM_CERT_DIR/privkey.pem" "$CERT_DIR/server.key"
elif [ -f "$CUSTOM_CERT_DIR/server.crt" ] && [ -f "$CUSTOM_CERT_DIR/server.key" ]; then
  cp "$CUSTOM_CERT_DIR/server.crt" "$CERT_DIR/server.crt"
  cp "$CUSTOM_CERT_DIR/server.key" "$CERT_DIR/server.key"
elif [ ! -f "$CERT_DIR/server.crt" ]; then
  TLS_IP="${TLS_IP:-127.0.0.1}"
  SAN_DNS="DNS:localhost,IP:127.0.0.1,IP:${TLS_IP}"
  if [ "$PUBLIC_HOSTNAME" != "_" ]; then
    SAN_DNS="${SAN_DNS},DNS:${PUBLIC_HOSTNAME}"
  fi
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -subj "/CN=${PUBLIC_HOSTNAME}" \
    -addext "subjectAltName=${SAN_DNS}"
fi

if [ "$HTTPS_PUBLIC_PORT" = "443" ]; then
  REDIRECT_TARGET='https://$host$request_uri'
else
  REDIRECT_TARGET="https://\$host:${HTTPS_PUBLIC_PORT}\$request_uri"
fi

cat > /etc/nginx/conf.d/default.conf <<EOF
server {
  listen 80;
  server_name ${PUBLIC_HOSTNAME};
  return 301 ${REDIRECT_TARGET};
}

server {
  listen 443 ssl;
  server_name ${PUBLIC_HOSTNAME};

  ssl_certificate /etc/nginx/certs/server.crt;
  ssl_certificate_key /etc/nginx/certs/server.key;

  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files \$uri \$uri/ /index.html;
  }

  location /health {
    proxy_pass http://server:3101;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
  }

  location /token {
    proxy_pass http://server:3101;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
  }

  location /recording {
    proxy_pass http://server:3101;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
  }

  location /recordings {
    proxy_pass http://server:3101;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
  }

  location /avatar {
    proxy_pass http://server:3101;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
  }

  location /livekit/ {
    proxy_pass http://livekit:7888/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_read_timeout 86400;
  }
}
EOF
