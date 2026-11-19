#!/usr/bin/env bash
# Monitor de Recebimento — instalação num servidor Linux da nuvem (Oracle Cloud "Always Free", Ubuntu 22.04/24.04), no
# mesmo servidor do DashMaster ou sozinho. Passo a passo: LEIA-ME.txt (Na nuvem) e node/ORACLE_CLOUD.md do DashMaster.
#
# Uso (no servidor, dentro da pasta monitor-recebimento):   bash instalar-nuvem.sh
#
# O que faz (pode rodar de novo quantas vezes quiser — não apaga dados):
#   1. fuso horário de São Paulo;
#   2. Node.js 22 (NodeSource), se não houver um 22.13+;
#   3. config.json: Monitor só no próprio servidor (127.0.0.1:3600) e link na porta 8443 (no servidor da nuvem a 443 é do
#      painel principal e a 10000 do Lotes; o Sorter fica na base);
#   4. serviço do sistema "monitor-recebimento" (liga sozinho com o servidor e reinicia se parar).
set -euo pipefail
cd "$(dirname "$0")"
APP="$(pwd)"
USER_NAME="$(id -un)"
SERVICE=monitor-recebimento

say() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }

[ -f "$APP/Recebimento_SP_GRU.gs" ] || { echo "Não achei os arquivos do Monitor (Recebimento_SP_GRU.gs) em $APP. Extraia o ZIP inteiro e rode este arquivo de dentro da pasta monitor-recebimento."; exit 1; }
command -v apt-get >/dev/null 2>&1 || { echo "Este instalador é para Ubuntu/Debian (apt-get)."; exit 1; }
[ "$USER_NAME" != "root" ] || { echo "Rode como o usuário normal do servidor (ex.: ubuntu), não como root."; exit 1; }

say "1/4 Fuso horário de São Paulo"
sudo timedatectl set-timezone America/Sao_Paulo || echo "(não deu para trocar o fuso; o Monitor usa São Paulo de qualquer jeito)"

say "2/4 Node.js 22"
node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! node_ok; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node_ok || { echo "Não foi possível instalar o Node.js 22.13+. Veja https://nodejs.org"; exit 1; }
echo "Node.js $(node -v)"

say "3/4 Configuração (config.json)"
if [ ! -f config.json ]; then
  node -e "const {PADRAO}=require('./lib/config');require('fs').writeFileSync('config.json',JSON.stringify(Object.assign({},PADRAO,{host:'127.0.0.1',portaLink:8443,caminho:''}),null,2)+'\n')"
  echo "config.json criado: Monitor em 127.0.0.1:3600, link na porta 8443."
else
  echo "config.json já existe: mantido."
fi
PORT="$(node -p "require('./lib/config').loadConfig().porta")"

say "4/4 Serviço do sistema ($SERVICE)"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=J&T Monitor de Recebimento SP GRU (Node.js)
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
printf 'Esperando o Monitor responder'
for i in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:$PORT/saude" >/dev/null 2>&1; then echo ' — no ar.'; break; fi
  printf '.'; sleep 2
  if [ "$i" = 45 ]; then echo; echo "O Monitor não respondeu. Veja o motivo com: sudo journalctl -u $SERVICE -n 50"; exit 1; fi
done

say "Pronto"
if [ -f "$APP/../dashmaster/node/dados/dashmaster.db" ]; then
  echo "AuthToken do JMS: o Monitor usa o mesmo do DashMaster deste servidor (pasta ~/dashmaster)."
  echo "Quando ele vencer, troque só no DashMaster: cd ~/dashmaster/node && node dashmaster.js token"
else
  echo "AuthToken do JMS: falta. Abra a tela Configurações pelo túnel SSH (LEIA-ME.txt, Na nuvem) e cole o AuthToken."
fi
cat <<FIM

Próximo passo — link para a equipe (https, abre de qualquer lugar):
    bash link-publico.sh

Comandos úteis:
    sudo systemctl restart $SERVICE        reiniciar o Monitor
    sudo journalctl -u $SERVICE -f         ver o que o Monitor está fazendo (Ctrl+C sai)
FIM
