'use strict';
/**
 * Configuração do Monitor de Recebimento (arquivo config.json, ao lado do server.js).
 * Na primeira vez o arquivo é criado com os valores abaixo. Mudou? Feche a janela preta e abra o iniciar.bat de novo.
 */
const fs = require('fs');
const path = require('path');

const PASTA_APP = path.join(__dirname, '..');

const PADRAO = {
  // Porta do painel: http://localhost:3600 neste computador (3000 = DashMaster, 3400 = Lotes, 3500 = Sorter).
  porta: 3600,
  // 0.0.0.0 = aceita acesso pela rede; 127.0.0.1 = só neste computador.
  host: '0.0.0.0',
  // Senha para abrir o painel (vazio = qualquer um com o link abre).
  senha: '',
  // Senha da página de trocar o AuthToken pelo link (https://…/token), para a equipe. Mínimo 8 caracteres; vazio = desligada.
  // Defina no servidor com: bash senha-token.sh
  senhaToken: '',
  // A coleta do JMS roda ao abrir e depois a cada N minutos (no Apps Script era a cada 15 min).
  coletaMinutos: 15,
  // Link público (Tailscale Funnel): porta 443 com o caminho /recebimento → https://NOME.ts.net/recebimento
  // (o mesmo link do painel principal, com /recebimento no fim). Só para mostrar na janela.
  linkPublico: '',
  portaLink: 443,
  caminho: '/recebimento',
  // Pasta do DashMaster para usar o mesmo AuthToken (vazio = procura em C:\dashmaster; "nao" = não usar).
  dashmaster: ''
};

function arquivoConfig() {
  return process.env.RECEBIMENTO_CONFIG ? path.resolve(process.env.RECEBIMENTO_CONFIG) : path.join(PASTA_APP, 'config.json');
}

function loadConfig() {
  const arq = arquivoConfig();
  let user = {};
  if (fs.existsSync(arq)) {
    try { user = JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, '')) || {}; }
    catch (e) { throw new Error('config.json inválido (' + e.message + '). Corrija o arquivo ou apague-o para criar de novo.'); }
  } else {
    try { fs.writeFileSync(arq, JSON.stringify(PADRAO, null, 2) + '\n'); } catch (e) { /* pasta só leitura: usa os padrões */ }
  }
  const cfg = Object.assign({}, PADRAO, user);
  if (process.env.RECEBIMENTO_PORTA) cfg.porta = Number(process.env.RECEBIMENTO_PORTA);
  cfg.porta = Number(cfg.porta) || PADRAO.porta;
  cfg.portaLink = Number(cfg.portaLink) || 443;
  cfg.coletaMinutos = Math.max(5, Number(cfg.coletaMinutos) || PADRAO.coletaMinutos);
  // "/recebimento", "recebimento", "/recebimento/" → "/recebimento"; só letras, números, - e _.
  const cam = String(cfg.caminho || '').trim().replace(/^\/+|\/+$/g, '');
  cfg.caminho = /^[A-Za-z0-9_-]+$/.test(cam) ? '/' + cam : '';
  cfg.linkPublico = String(cfg.linkPublico || '').trim().replace(/\/+$/, '');
  cfg.pastaApp = PASTA_APP;
  cfg.pastaDados = path.resolve(process.env.RECEBIMENTO_DADOS || path.join(PASTA_APP, 'dados'));
  cfg.dataDir = cfg.pastaDados; // lib/auth.js (senha do painel)
  // Só para testes: troca o endereço do JMS (ex.: um JMS de mentira em http://127.0.0.1:4555).
  cfg.jmsUrl = process.env.RECEBIMENTO_JMS_URL || '';
  fs.mkdirSync(cfg.pastaDados, {recursive: true});
  return cfg;
}

module.exports = {loadConfig, PADRAO};
