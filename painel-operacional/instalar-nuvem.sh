#!/usr/bin/env bash
# Painel Operacional (Node.js) — o Monitor de Recebimento e o Controle de Pátio num link só, no servidor Linux da nuvem
# (Oracle Cloud "Always Free", Ubuntu 22.04/24.04), o mesmo servidor onde os dois já rodam.
#
# Uso (no servidor, dentro da pasta painel-operacional):   bash instalar-nuvem.sh
#
# O que faz (pode rodar de novo quantas vezes quiser — não apaga nada):
#   1. Node.js (usa o que já está instalado para os painéis);
#   2. config.json: Painel Operacional só no próprio servidor (127.0.0.1:3800);
#   3. acerta o "caminho" dos dois painéis (Monitor: /recebimento; Controle de Pátio: /patio) e reinicia os dois — os links
#      antigos deles (:8443 e :10000) continuam funcionando;
#   4. serviço do sistema "painel-operacional" (liga sozinho com o servidor e reinicia se parar).
set -euo pipefail
cd "$(dirname "$0")"
APP="$(pwd)"
USER_NAME="$(id -un)"
SERVICE=painel-operacional

say() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }

[ -f "$APP/server.js" ] && [ -f "$APP/lib/config.js" ] || { echo "Não achei os arquivos do painel em $APP. Extraia o ZIP inteiro e rode este arquivo de dentro da pasta painel-operacional."; exit 1; }
command -v apt-get >/dev/null 2>&1 || { echo "Este instalador é para Ubuntu/Debian (apt-get)."; exit 1; }
[ "$USER_NAME" != "root" ] || { echo "Rode como o usuário normal do servidor (ex.: ubuntu), não como root."; exit 1; }

say "1/4 Node.js"
node_ok() { command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0])>=20?0:1)'; }
if ! node_ok; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node_ok || { echo "Não foi possível instalar o Node.js. Veja https://nodejs.org"; exit 1; }
echo "Node.js $(node -v)"

say "2/4 Configuração (config.json)"
if [ ! -f config.json ]; then
  node -e "const {PADRAO}=require('./lib/config');require('fs').writeFileSync('config.json',JSON.stringify(PADRAO,null,2)+'\n')"
  echo "config.json criado: Painel Operacional em 127.0.0.1:3800."
else
  echo "config.json já existe: mantido."
fi

say "3/4 Os dois painéis (Monitor de Recebimento e Controle de Pátio)"
# Pasta de cada painel: ao lado desta pasta ou na pasta do usuário (onde os ZIPs foram extraídos).
acha() { for d in "$(dirname "$APP")/$1" "$HOME/$1"; do [ -f "$d/server.js" ] && { (cd "$d" && pwd); return 0; }; done; return 1; }
# acerta <pasta> <caminho> <serviço> <chave no config.json deste painel>
acerta() {
  local DIR="$1" CAM="$2" SVC="$3" CHAVE="$4"
  if [ ! -f "$DIR/config.json" ]; then echo "  $DIR sem config.json: rode o instalar-nuvem.sh dele primeiro."; return 1; fi
  local MUDOU PORTA
  read -r MUDOU PORTA < <(CAM="$CAM" node -e '
    const fs = require("fs"), f = process.argv[1] + "/config.json";
    const c = JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
    const mudou = c.caminho !== process.env.CAM;
    if (mudou) { c.caminho = process.env.CAM; fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n"); }
    console.log(mudou ? "sim" : "nao", Number(c.porta) || 0);' "$DIR")
  [ "$PORTA" != "0" ] || PORTA="$( [ "$CHAVE" = recebimento ] && echo 3600 || echo 3700 )"
  CHAVE="$CHAVE" ALVO="http://127.0.0.1:$PORTA" node -e '
    const fs = require("fs"), c = JSON.parse(fs.readFileSync("config.json", "utf8"));
    c[process.env.CHAVE] = process.env.ALVO; fs.writeFileSync("config.json", JSON.stringify(c, null, 2) + "\n");'
  if [ "$MUDOU" = sim ]; then
    echo "  $SVC: caminho $CAM gravado; reiniciando o serviço..."
    sudo systemctl restart "$SVC" 2>/dev/null || echo "  (não deu para reiniciar $SVC: reinicie com sudo systemctl restart $SVC)"
  else
    echo "  $SVC: caminho $CAM já estava certo (porta $PORTA)."
  fi
}
FALTA=0
if REC="$(acha monitor-recebimento)"; then acerta "$REC" /recebimento monitor-recebimento recebimento || FALTA=1
else echo "  Não achei a pasta monitor-recebimento (nem ao lado desta pasta, nem em $HOME)."; FALTA=1; fi
if PAT="$(acha controle-patio)"; then acerta "$PAT" /patio controle-patio patio || FALTA=1
else echo "  Não achei a pasta controle-patio (nem ao lado desta pasta, nem em $HOME)."; FALTA=1; fi
PORT="$(node -p "require('./lib/config').loadConfig().porta")"

say "4/4 Serviço do sistema ($SERVICE)"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=J&T Painel Operacional SP GRU (Monitor de Recebimento + Controle de Patio)
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
sleep 3
curl -fsS "http://127.0.0.1:$PORT/saude" | node -e '
let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
  const j = JSON.parse(s);
  console.log("  Monitor de Recebimento: " + (j.recebimento.ok ? "no ar" : "FORA DO AR (sudo systemctl restart monitor-recebimento)"));
  console.log("  Controle de Pátio:      " + (j.patio.ok ? "no ar" : "FORA DO AR (sudo systemctl restart controle-patio)"));
});'

say "Pronto"
[ "$FALTA" = 0 ] || echo "ATENÇÃO: falta acertar um dos painéis (veja as mensagens acima)."
cat <<FIM
O Painel Operacional está rodando neste servidor e liga sozinho quando ele reinicia.

Próximo passo — o link único para a equipe (https, abre de qualquer lugar):
    bash link-publico.sh

Comandos úteis:
    sudo systemctl restart $SERVICE          reiniciar o Painel Operacional
    sudo journalctl -u $SERVICE -f           ver o que ele está fazendo (Ctrl+C sai)
FIM
