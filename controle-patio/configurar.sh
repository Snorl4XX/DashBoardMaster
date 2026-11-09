#!/usr/bin/env bash
# Controle de Pátio — grava os dados do Feishu no servidor (os mesmos das Propriedades do script do Apps Script:
# Configurações do projeto > Propriedades do script) e testa. Ficam em dados/propriedades.json, que só o seu usuário lê.
# O App Secret não aparece na tela enquanto você cola. Enter vazio = mantém o valor que já está gravado.
#
# Uso (no servidor, dentro da pasta controle-patio):   bash configurar.sh
set -uo pipefail
cd "$(dirname "$0")"
node patio.js configurar </dev/tty
