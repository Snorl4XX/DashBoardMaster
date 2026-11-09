#!/usr/bin/env bash
# Controle de Pátio (Node.js) — instalação num servidor Linux da nuvem (Oracle Cloud "Always Free", Ubuntu 22.04/24.04).
# Pode ficar no mesmo servidor do Monitor de Recebimento (é leve: só consulta o Feishu quando alguém abre o painel).
#
# Uso (no servidor, dentro da pasta controle-patio):   bash instalar-nuvem.sh
#
# O que faz (pode rodar de novo quantas vezes quiser — não apaga nada):
#   1. fuso horário de São Paulo;
#   2. Node.js 22 (NodeSource), se não houver um 20+;
#   3. config.json: painel só no próprio servidor (127.0.0.1:3700) e link na porta 10000 (8443 = Monitor);
#   4. dados do Feishu (App ID, App Secret, token da base e as 3 tabelas), se ainda não estiverem gravados, e o teste;
#   5. serviço do sistema "controle-patio" (liga sozinho com o servidor e reinicia se parar).
set -euo pipefail
cd "$(dirname "$0")"
APP="$(pwd)"
USER_NAME="$(id -un)"
SERVICE=controle-patio

say() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }

[ -f "$APP/lib/feishu.js" ] || { echo "Não achei os arquivos do painel (lib/feishu.js) em $APP. Extraia o ZIP inteiro e rode este arquivo de dentro da pasta controle-patio."; exit 1; }
command -v apt-get >/dev/null 2>&1 || { echo "Este instalador é para Ubuntu/Debian (apt-get)."; exit 1; }
[ "$USER_NAME" != "root" ] || { echo "Rode como o usuário normal do servidor (ex.: ubuntu), não como root."; exit 1; }

say "1/5 Fuso horário de São Paulo"
sudo timedatectl set-timezone America/Sao_Paulo || echo "(não deu para trocar o fuso; o painel usa São Paulo de qualquer jeito)"

say "2/5 Node.js"
node_ok() { command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)'; }
if ! node_ok; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node_ok || { echo "Não foi possível instalar o Node.js. Veja https://nodejs.org"; exit 1; }
echo "Node.js $(node -v)"

say "3/5 Configuração (config.json)"
if [ ! -f config.json ]; then
  node -e "const {PADRAO}=require('./lib/config');require('fs').writeFileSync('config.json',JSON.stringify(Object.assign({},PADRAO,{host:'127.0.0.1'}),null,2)+'\n')"
  echo "config.json criado: painel em 127.0.0.1:3700, link na porta 10000."
else
  echo "config.json já existe: mantido."
fi
PORT="$(node -p "require('./lib/config').loadConfig().porta")"

say "4/5 Dados do Feishu"
STATUS="$(node patio.js status)"
if grep -q FALTA <<<"$STATUS"; then
  bash configurar.sh
else
  echo "Dados do Feishu já gravados (para trocar: bash configurar.sh). Testando..."
  node patio.js testar || echo "O teste deu erro: confira os dados com bash configurar.sh"
fi

say "5/5 Serviço do sistema ($SERVICE)"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=J&T Controle de Patio SP GRU (Node.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP
Environment=TZ=America/Sao_Paulo
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE >/dev/null 2>&1
sudo systemctl restart $SERVICE
printf 'Esperando o painel responder'
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/saude" >/dev/null 2>&1; then echo ' — no ar.'; break; fi
  printf '.'; sleep 2
  if [ "$i" = 30 ]; then echo; echo "O painel não respondeu. Veja o motivo com: sudo journalctl -u $SERVICE -n 50"; exit 1; fi
done

say "Pronto"
cat <<FIM
O Controle de Pátio está rodando neste servidor e liga sozinho quando ele reinicia.

Próximo passo — link para a equipe (https, abre de qualquer lugar):
    bash link-publico.sh

Comandos úteis (nesta pasta):
    node patio.js status                    dados do Feishu cadastrados
    node patio.js testar                    testar o Feishu
    bash configurar.sh                      trocar os dados do Feishu
    sudo systemctl restart $SERVICE         reiniciar o painel
    sudo journalctl -u $SERVICE -f          ver o que o painel está fazendo (Ctrl+C sai)
FIM
