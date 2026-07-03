#!/bin/sh
set -eu

CERT_DIR=/etc/nginx/certs
mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_DIR/server.crt" ]; then
  TLS_IP="${TLS_IP:-127.0.0.1}"
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -subj "/CN=vks" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${TLS_IP}"
fi
