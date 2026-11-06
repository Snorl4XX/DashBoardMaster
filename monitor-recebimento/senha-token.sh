#!/usr/bin/env bash
# Monitor de Recebimento — senha da página para a equipe trocar o AuthToken pelo link (https://…/token).
# Quem tem essa senha só troca o AuthToken e vê se a coleta está funcionando: não entra no servidor, não vê o token salvo
# e não mexe em mais nada. Mande para a equipe o link com /token no fim e esta senha (não a senha do servidor).
#
# Uso (no servidor, dentro da pasta monitor-recebimento):   bash senha-token.sh
# Enter vazio na senha = desliga a página.
set -euo pipefail
cd "$(dirname "$0")"

read -rsp "Senha nova da página /token (mínimo 8 caracteres; Enter vazio = desligar a página): " S1 </dev/tty || S1=""
echo
if [ -n "$S1" ]; then
  read -rsp "Repita a senha: " S2 </dev/tty || S2=""
  echo
  [ "$S1" = "$S2" ] || { echo "As duas senhas não são iguais. Nada mudou."; exit 1; }
  [ "${#S1}" -ge 8 ] || { echo "A senha precisa ter pelo menos 8 caracteres. Nada mudou."; exit 1; }
fi
SENHA="$S1" node -e '
const fs = require("fs"), f = "config.json";
const c = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")) : {};
c.senhaToken = process.env.SENHA || "";
fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");'
unset S1 S2
sudo systemctl restart monitor-recebimento 2>/dev/null || echo "(Reinicie o Monitor para a mudança valer.)"

LINK="$(node -p "String(require('./lib/config').loadConfig().linkPublico || '')")"
if [ "$(node -p "String(require('./lib/config').loadConfig().senhaToken || '').length >= 8")" = "true" ]; then
  echo
  echo "Pronto: a página de trocar o AuthToken está LIGADA."
  echo "Mande para a equipe o link abaixo e a senha que você acabou de digitar:"
  echo "    ${LINK:-https://SEU-LINK}/token"
else
  echo
  echo "Pronto: a página de trocar o AuthToken está DESLIGADA."
fi
