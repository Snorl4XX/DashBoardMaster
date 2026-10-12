#!/usr/bin/env bash
# J&T DashMaster — link https para a equipe pelo Tailscale Funnel (grátis): endereço fixo, com cadeado, que abre de qualquer
# lugar, sem abrir porta no servidor nem na Oracle. Igual ao node/link-publico.bat do Windows. Passo a passo: ORACLE_CLOUD.md.
#
# Uso (no servidor, dentro da pasta node):   bash link-publico.sh
# Para tirar o link do ar:                    sudo tailscale funnel reset
set -euo pipefail
cd "$(dirname "$0")"
PORT="$(node -p "require('./lib/config').loadConfig().porta")"

say() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }

say "1/3 Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then curl -fsSL https://tailscale.com/install.sh | sh; fi
if ! sudo tailscale status >/dev/null 2>&1; then
  echo "Vai aparecer um link https://login.tailscale.com/… — abra no navegador do seu computador e entre com Google,"
  echo "Microsoft ou e-mail. Depois volte aqui."
  sudo tailscale up --hostname=dashmaster
fi

say "2/3 Funnel (link público para a porta $PORT)"
echo "Na primeira vez, o Tailscale mostra um link para AUTORIZAR o Funnel na sua conta: abra, autorize e, se este"
echo "comando parar com erro, rode 'bash link-publico.sh' de novo."
sudo tailscale funnel --bg "$PORT"
URL="https://$(sudo tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).Self.DNSName||"").replace(/\.$/,"")))')"

say "3/3 Senha do painel"
echo "O link abre de qualquer lugar. O painel mostra nomes de operadores: é recomendável uma senha."
read -r -p "Senha para abrir o painel (Enter = manter a atual / sem senha): " PASS </dev/tty || true
LINK="$URL" PASS="${PASS:-}" node -e '
const fs = require("fs"), f = "config.json";
const c = JSON.parse(fs.readFileSync(f, "utf8"));
c.linkPublico = process.env.LINK;
if (process.env.PASS) c.senha = process.env.PASS;
fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
console.log(c.senha ? "Senha do painel: definida." : "Painel SEM senha: quem tiver o link abre.");'
sudo systemctl restart dashmaster 2>/dev/null || true

say "Link do painel"
echo "    $URL"
echo "Mande esse link para a equipe. A tela Configurações nunca abre por ele (use o túnel SSH: ORACLE_CLOUD.md, seção 6)."
