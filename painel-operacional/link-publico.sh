#!/usr/bin/env bash
# Painel Operacional — link https único para a equipe pelo Tailscale Funnel (grátis), no servidor Linux da nuvem.
# Fica na porta 443 → https://NOME.ts.net (sem número no fim). Os links antigos do Monitor (:8443) e do Controle de Pátio
# (:10000) continuam funcionando; para tirar do ar, veja o fim deste arquivo.
#
# Uso (no servidor, dentro da pasta painel-operacional):   bash link-publico.sh
set -euo pipefail
cd "$(dirname "$0")"
SERVICE=painel-operacional
PORT="$(node -p "require('./lib/config').loadConfig().porta")"

say() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }

say "1/3 Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then curl -fsSL https://tailscale.com/install.sh | sh; fi
if ! sudo tailscale status >/dev/null 2>&1; then
  echo "Vai aparecer um link https://login.tailscale.com/… — abra no navegador do seu computador e entre com Google,"
  echo "Microsoft ou e-mail. Depois volte aqui."
  sudo tailscale up --hostname=dashmaster
fi

say "2/3 Funnel (Painel Operacional na porta $PORT → link na porta 443)"
echo "Se o Tailscale mostrar um link para AUTORIZAR o Funnel, abra, autorize e rode 'bash link-publico.sh' de novo."
sudo tailscale funnel --bg --https=443 "http://127.0.0.1:$PORT"
HOST="$(sudo tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).Self.DNSName||"").replace(/\.$/,"")))')"
URL="https://$HOST"

say "3/3 Guardando o link"
LINK="$URL" node -e '
const fs = require("fs"), f = "config.json", c = JSON.parse(fs.readFileSync(f, "utf8"));
c.linkPublico = process.env.LINK; fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");'
sudo systemctl restart "$SERVICE" 2>/dev/null || true

say "Link único do Painel Operacional"
echo "    $URL"
echo
echo "    Monitor de Recebimento:  $URL/#recebimento"
echo "    Controle de Pátio:       $URL/#patio"
echo
echo "Mande o primeiro link para a equipe: o menu tem os dois painéis."
echo "Os links antigos continuam funcionando. Para tirar do ar:"
echo "    sudo tailscale funnel --https=8443 off     (Monitor de Recebimento)"
echo "    sudo tailscale funnel --https=10000 off    (Controle de Pátio)"
echo "Para tirar do ar o link único: sudo tailscale funnel --https=443 off"
