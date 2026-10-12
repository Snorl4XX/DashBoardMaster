#!/usr/bin/env bash
# J&T DashMaster — instalação num servidor Linux da nuvem (Oracle Cloud "Always Free", Ubuntu 22.04/24.04; ARM Ampere A1 ou
# AMD). Serve também para outra VPS com Ubuntu/Debian. Passo a passo completo: node/ORACLE_CLOUD.md.
#
# Uso (no servidor, dentro da pasta node do ZIP):   bash instalar-oracle.sh
#
# O que faz (pode rodar de novo quantas vezes quiser — não apaga dados):
#   1. fuso horário de São Paulo;
#   2. Node.js 22 (NodeSource), se não houver um 22.13+;
#   3. config.json com o painel só no próprio servidor (o link para a equipe passa pelo Tailscale: link-publico.sh);
#   4. serviço do sistema "dashmaster" (liga sozinho com o servidor e reinicia se parar);
#   5. AuthToken do JMS, data inicial, modo de atualização e o histórico na fila (só o que ainda faltar).
set -euo pipefail
cd "$(dirname "$0")"
NODE_DIR="$(pwd)"
APP_DIR="$(dirname "$NODE_DIR")"
USER_NAME="$(id -un)"
SERVICE=dashmaster

say() { printf '\n\033[1;31m==> %s\033[0m\n' "$*"; }
ask() { local q="$1" def="${2:-}" a; read -r -p "$q" a </dev/tty || true; printf '%s' "${a:-$def}"; }

[ -f "$APP_DIR/Config.gs" ] || { echo "Não achei os arquivos do painel (Config.gs) em $APP_DIR. Extraia o ZIP inteiro e rode este arquivo de dentro da pasta node."; exit 1; }
command -v apt-get >/dev/null 2>&1 || { echo "Este instalador é para Ubuntu/Debian (apt-get)."; exit 1; }
[ "$USER_NAME" != "root" ] || { echo "Rode como o usuário normal do servidor (ex.: ubuntu), não como root."; exit 1; }

say "1/5 Fuso horário de São Paulo"
sudo timedatectl set-timezone America/Sao_Paulo || echo "(não deu para trocar o fuso; o painel usa São Paulo de qualquer jeito)"

say "2/5 Node.js 22"
node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; }
if ! node_ok; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node_ok || { echo "Não foi possível instalar o Node.js 22.13+. Veja https://nodejs.org"; exit 1; }
echo "Node.js $(node -v)"

say "3/5 Configuração (config.json)"
if [ ! -f config.json ]; then
  # Só no próprio servidor (127.0.0.1): ninguém acessa pela internet direto. A equipe usa o link https do Tailscale
  # (link-publico.sh); a tela Configurações abre pelo túnel SSH (passo a passo, seção 6).
  node -e "const {DEFAULTS}=require('./lib/config');require('fs').writeFileSync('config.json',JSON.stringify(Object.assign({},DEFAULTS,{host:'127.0.0.1'}),null,2)+'\n')"
  echo "config.json criado (painel em 127.0.0.1:3000)."
else
  echo "config.json já existe: mantido."
fi
PORT="$(node -p "require('./lib/config').loadConfig().porta")"

say "4/5 Serviço do sistema ($SERVICE)"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<EOF
[Unit]
Description=J&T DashMaster (Node.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$NODE_DIR
Environment=TZ=America/Sao_Paulo
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE >/dev/null 2>&1
sudo systemctl restart $SERVICE
printf 'Esperando o painel responder'
for i in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:$PORT/saude" >/dev/null 2>&1; then echo ' — no ar.'; break; fi
  printf '.'; sleep 2
  if [ "$i" = 45 ]; then echo; echo "O painel não respondeu. Veja o motivo com: sudo journalctl -u $SERVICE -n 50"; exit 1; fi
done

say "5/5 JMS: AuthToken, data inicial, modo de atualização e histórico"
if node dashmaster.js status | grep -q 'AuthToken: cadastrado'; then
  echo "AuthToken já cadastrado. (Para trocar: node dashmaster.js token)"
else
  echo "Cole o AuthToken do JMS (não aparece na tela). Ele é testado em seguida."
  node dashmaster.js token </dev/tty || echo "(teste da conexão com erro: confira o token e rode de novo: node dashmaster.js token)"
fi

START="$(node dashmaster.js propriedade DATA_START_DATE)"
if [ "$START" = "(não existe)" ]; then
  DEF="$(date +%Y-%m-01)"
  START="$(ask "Data inicial do histórico (AAAA-MM-DD) [$DEF]: " "$DEF")"
  node dashmaster.js propriedade DATA_START_DATE "$START"
else
  echo "Data inicial: $START"
fi

MODE="$(node dashmaster.js propriedade MODO_ATUALIZACAO)"
echo
echo "Como o painel atualiza sozinho (o botão Atualizar funciona nos dois):"
echo "  1 = agenda: painéis do dia às 6h e 8h, Sem Movimentação a cada 2 h (como no Google)"
echo "  2 = contínuo: a cada minuto, o dia todo (aqui não há cota)"
# Na 1ª instalação o padrão é a agenda (o pedido feito para o Google); depois, vale a escolha anterior.
CUR=1
if [ -f dados/.modo-escolhido ] && [ "$MODE" != "diario" ]; then CUR=2; fi
CH="$(ask "Escolha 1 ou 2 [$CUR]: " "$CUR")"
if [ "$CH" = "2" ]; then node dashmaster.js propriedade MODO_ATUALIZACAO continuo; else node dashmaster.js propriedade MODO_ATUALIZACAO diario; fi
touch dados/.modo-escolhido

if node dashmaster.js status | grep -q 'AuthToken: cadastrado'; then
  if [ ! -f dados/.historico-enfileirado ]; then
    node dashmaster.js executar startFullHistory >/dev/null && touch dados/.historico-enfileirado && echo "Histórico desde $START na fila: o painel baixa sozinho."
  else
    echo "Histórico já enfileirado antes (para refazer: node dashmaster.js executar startFullHistory)."
  fi
fi
sudo systemctl restart $SERVICE

say "Pronto"
cat <<EOF
O painel está rodando neste servidor e liga sozinho quando ele reinicia.

Próximo passo — link para a equipe (https, abre de qualquer lugar):
    bash link-publico.sh

Comandos úteis (nesta pasta):
    node dashmaster.js status                          fila e AuthToken
    node dashmaster.js token                           trocar o AuthToken vencido
    node dashmaster.js executar diagnosticarConexaoJms testar o JMS
    sudo systemctl restart $SERVICE                    reiniciar o painel
    sudo journalctl -u $SERVICE -f                     ver o que o painel está fazendo (Ctrl+C sai)
EOF
