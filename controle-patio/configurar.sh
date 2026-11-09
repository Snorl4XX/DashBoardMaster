#!/usr/bin/env bash
# Controle de Pátio — grava os dados do Feishu no servidor (os mesmos das Propriedades do script do Apps Script:
# Configurações do projeto > Propriedades do script). Ficam em dados/propriedades.json, que só o seu usuário lê.
# O App Secret não aparece na tela enquanto você cola. Enter vazio = mantém o valor que já está gravado.
#
# Uso (no servidor, dentro da pasta controle-patio):   bash configurar.sh
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "Cole cada valor e tecle Enter (copie do Apps Script: Configurações do projeto > Propriedades do script)."
echo "Enter vazio mantém o valor que já está gravado."
echo
pergunta() {
  local chave="$1" extra="" valor=""
  [ "$(node patio.js tem "$chave")" = "sim" ] && extra=" [Enter = manter]"
  read -r -p "$chave$extra: " valor </dev/tty || true
  printf '%s' "$valor"
}
APP_ID="$(pergunta FEISHU_APP_ID)"
EXTRA=""; [ "$(node patio.js tem FEISHU_APP_SECRET)" = "sim" ] && EXTRA=" [Enter = manter]"
read -r -s -p "FEISHU_APP_SECRET (não aparece na tela)$EXTRA: " APP_SECRET </dev/tty || true
echo
APP_TOKEN="$(pergunta FEISHU_APP_TOKEN)"
T_PATIO="$(pergunta FEISHU_TABLE_PATIO)"
T_DOCAS="$(pergunta FEISHU_TABLE_DOCAS)"
T_EXPED="$(pergunta FEISHU_TABLE_EXPEDICAO)"

PATIO_SET_FEISHU_APP_ID="$APP_ID" PATIO_SET_FEISHU_APP_SECRET="$APP_SECRET" PATIO_SET_FEISHU_APP_TOKEN="$APP_TOKEN" \
PATIO_SET_FEISHU_TABLE_PATIO="$T_PATIO" PATIO_SET_FEISHU_TABLE_DOCAS="$T_DOCAS" PATIO_SET_FEISHU_TABLE_EXPEDICAO="$T_EXPED" \
  node patio.js gravar
unset APP_SECRET

echo
echo "Testando o Feishu com esses dados..."
if node patio.js testar; then
  echo
  echo "Pronto. O painel já usa os dados novos (não precisa reiniciar)."
else
  echo
  echo "O teste deu erro. Confira os valores e rode de novo: bash configurar.sh"
fi
