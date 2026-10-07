#!/bin/sh
# Linux/macOS: inicia o servidor e reinicia sozinho se ele parar.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Instale o Node.js 22.13+ (https://nodejs.org)"; exit 1; }
while true; do
  node server.js
  echo "O servidor parou. Reiniciando em 10 s (Ctrl+C para encerrar)..."
  sleep 10
done
