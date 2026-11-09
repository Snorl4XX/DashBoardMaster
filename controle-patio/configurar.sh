#!/usr/bin/env bash
# Controle de Pátio — grava os dados do Feishu no servidor (App ID e App Secret do app no open.feishu.cn, token da base e
# os IDs das 3 tabelas) e testa. Ficam em dados/feishu.json, que só o seu usuário lê.
# O App Secret não aparece na tela enquanto você cola. Enter vazio = mantém o valor que já está gravado.
#
# Uso (no servidor, dentro da pasta controle-patio):   bash configurar.sh
set -uo pipefail
cd "$(dirname "$0")"
node patio.js configurar </dev/tty
