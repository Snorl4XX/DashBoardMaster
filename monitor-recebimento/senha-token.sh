#!/usr/bin/env bash
# Monitor de Recebimento — página para a equipe trocar o AuthToken pelo link (https://…/token).
# Quem abre a página só troca o AuthToken e vê se a coleta está funcionando: não entra no servidor, não vê o token salvo e
# não mexe em mais nada. O token novo só é salvo se o JMS aceitar. Por padrão a página fica SEM senha.
#
# Uso (no servidor, dentro da pasta monitor-recebimento):
#   bash senha-token.sh            define uma senha para a página (Enter vazio = sem senha)
#   bash senha-token.sh desligar   desliga a página
set -euo pipefail
cd "$(dirname "$0")"

ATIVA=true
S1=""
if [ "${1:-}" = "desligar" ]; then
  ATIVA=false
else
  read -rsp "Senha da página /token (mínimo 8 caracteres; Enter vazio = SEM senha): " S1 </dev/tty || S1=""
  echo
  if [ -n "$S1" ]; then
    read -rsp "Repita a senha: " S2 </dev/tty || S2=""
    echo
    [ "$S1" = "$S2" ] || { echo "As duas senhas não são iguais. Nada mudou."; exit 1; }
    [ "${#S1}" -ge 8 ] || { echo "A senha precisa ter pelo menos 8 caracteres. Nada mudou."; exit 1; }
  fi
fi
SENHA="$S1" ATIVA="$ATIVA" node -e '
const fs = require("fs"), f = "config.json";
const c = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")) : {};
c.trocaTokenPeloLink = process.env.ATIVA === "true";
c.senhaToken = process.env.SENHA || "";
fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");'
unset S1 S2
sudo systemctl restart monitor-recebimento 2>/dev/null || echo "(Reinicie o Monitor para a mudança valer.)"

LINK="$(node -p "String(require('./lib/config').loadConfig().linkPublico || '')")"
echo
if [ "$ATIVA" = "false" ]; then
  echo "Pronto: a página de trocar o AuthToken está DESLIGADA. Para ligar de novo: bash senha-token.sh"
else
  if [ "$(node -p "String(require('./lib/config').loadConfig().senhaToken || '').length >= 8")" = "true" ]; then
    echo "Pronto: a página de trocar o AuthToken está LIGADA, COM senha."
  else
    echo "Pronto: a página de trocar o AuthToken está LIGADA, SEM senha (o token só é salvo se o JMS aceitar)."
  fi
  echo "Link para a equipe:"
  echo "    ${LINK:-https://SEU-LINK}/token"
fi
