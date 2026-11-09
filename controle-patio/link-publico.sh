#!/usr/bin/env bash
# Controle de Pátio — link https para a equipe pelo Tailscale Funnel (grátis), no servidor Linux da nuvem.
# Padrão: porta 10000 → https://NOME.ts.net:10000 (no servidor do Monitor, a 8443 é dele).
# Com "caminho" no config.json (ex.: "/patio"), fica na porta do link com o caminho no fim.
#
# Uso (no servidor, dentro da pasta controle-patio):   bash link-publico.sh
set -euo pipefail
cd "$(dirname "$0")"
SERVICE=controle-patio
read -r PORT PORTALINK CAMINHO < <(node -e "const c=require('./lib/config').loadConfig();console.log(c.porta,c.portaLink,c.caminho||'-')")
[ "$CAMINHO" = "-" ] && CAMINHO=""

say() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }

say "1/3 Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then curl -fsSL https://tailscale.com/install.sh | sh; fi
if ! sudo tailscale status >/dev/null 2>&1; then
  echo "Vai aparecer um link https://login.tailscale.com/… — abra no navegador do seu computador e entre com Google,"
  echo "Microsoft ou e-mail. Depois volte aqui."
  sudo tailscale up --hostname=dashmaster
fi

say "2/3 Funnel (painel na porta $PORT → link na porta $PORTALINK${CAMINHO:+, caminho $CAMINHO})"
echo "Na primeira vez, o Tailscale mostra um link para AUTORIZAR o Funnel na sua conta: abra, autorize e, se este"
echo "comando parar com erro, rode 'bash link-publico.sh' de novo."
if [ -n "$CAMINHO" ]; then
  sudo tailscale funnel --bg --https="$PORTALINK" --set-path="$CAMINHO" "http://127.0.0.1:$PORT$CAMINHO"
elif [ "$PORTALINK" = "443" ]; then
  sudo tailscale funnel --bg "$PORT"
else
  sudo tailscale funnel --bg --https="$PORTALINK" "$PORT"
fi
HOST="$(sudo tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).Self.DNSName||"").replace(/\.$/,"")))')"
URL="https://$HOST$([ "$PORTALINK" = "443" ] || printf ':%s' "$PORTALINK")$CAMINHO"

say "3/3 Senha do painel"
echo "O link abre de qualquer lugar. O painel mostra placas e nomes de motoristas: é recomendável uma senha."
read -r -p "Senha para abrir o painel (Enter = manter a atual / sem senha): " PASS </dev/tty || true
LINK="$URL" PASS="${PASS:-}" node -e '
const fs = require("fs"), f = "config.json";
const c = JSON.parse(fs.readFileSync(f, "utf8"));
c.linkPublico = process.env.LINK;
if (process.env.PASS) c.senha = process.env.PASS;
fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
console.log(c.senha ? "Senha do painel: definida." : "Painel SEM senha: quem tiver o link abre.");'
sudo systemctl restart "$SERVICE" 2>/dev/null || true

say "Link do Controle de Pátio"
echo "    $URL"
echo "Mande esse link para a equipe."
echo "Para tirar do ar só este link: sudo tailscale funnel --https=$PORTALINK ${CAMINHO:+--set-path=$CAMINHO }off"
