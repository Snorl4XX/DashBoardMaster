'use strict';
/**
 * Configuração do Painel Operacional (arquivo config.json, ao lado do server.js).
 * Na primeira vez o arquivo é criado com os valores abaixo. Mudou? Reinicie: sudo systemctl restart painel-operacional
 */
const fs = require('fs');
const path = require('path');

const PASTA_APP = path.join(__dirname, '..');

const PADRAO = {
  // Porta deste painel no servidor (3600 = Monitor de Recebimento, 3700 = Controle de Pátio).
  porta: 3800,
  // 127.0.0.1 = só no próprio servidor (o link passa pelo Tailscale).
  host: '127.0.0.1',
  // Onde os dois painéis rodam no mesmo servidor. Cada um precisa do "caminho" igual no config.json dele
  // (Monitor: "/recebimento"; Controle de Pátio: "/patio") — o instalar-nuvem.sh deste painel já acerta isso.
  recebimento: 'http://127.0.0.1:3600',
  patio: 'http://127.0.0.1:3700',
  // Link público (Tailscale Funnel na porta 443: https://NOME.ts.net). Só para mostrar na janela.
  linkPublico: ''
};

function arquivoConfig() {
  return process.env.OPERACIONAL_CONFIG ? path.resolve(process.env.OPERACIONAL_CONFIG) : path.join(PASTA_APP, 'config.json');
}

function alvo(v, padrao) {
  const s = String(v || '').trim().replace(/\/+$/, '');
  return /^http:\/\/[A-Za-z0-9.\-]+:\d+$/.test(s) ? s : padrao;
}

function loadConfig() {
  const arq = arquivoConfig();
  let user = {};
  if (fs.existsSync(arq)) {
    try { user = JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^﻿/, '')) || {}; }
    catch (e) { throw new Error('config.json inválido (' + e.message + '). Corrija o arquivo ou apague-o para criar de novo.'); }
  } else {
    try { fs.writeFileSync(arq, JSON.stringify(PADRAO, null, 2) + '\n'); } catch (e) { /* pasta só leitura: usa os padrões */ }
  }
  const cfg = Object.assign({}, PADRAO, user);
  if (process.env.OPERACIONAL_PORTA) cfg.porta = Number(process.env.OPERACIONAL_PORTA);
  cfg.porta = Number(cfg.porta) || PADRAO.porta;
  cfg.recebimento = alvo(process.env.OPERACIONAL_RECEBIMENTO || cfg.recebimento, PADRAO.recebimento);
  cfg.patio = alvo(process.env.OPERACIONAL_PATIO || cfg.patio, PADRAO.patio);
  cfg.linkPublico = String(cfg.linkPublico || '').trim().replace(/\/+$/, '');
  cfg.pastaApp = PASTA_APP;
  return cfg;
}

module.exports = {loadConfig, PADRAO};
