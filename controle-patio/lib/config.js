'use strict';
/**
 * Configuração do Controle de Pátio (arquivo config.json, ao lado do server.js).
 * Na primeira vez o arquivo é criado com os valores abaixo. Mudou? Reinicie: sudo systemctl restart controle-patio
 */
const fs = require('fs');
const path = require('path');

const PASTA_APP = path.join(__dirname, '..');

const PADRAO = {
  // Porta do painel neste computador/servidor (3000 = DashMaster, 3400 = Lotes, 3500 = Sorter, 3600 = Monitor).
  porta: 3700,
  // 0.0.0.0 = aceita acesso pela rede; 127.0.0.1 = só neste servidor (na nuvem, o link passa pelo Tailscale).
  host: '0.0.0.0',
  // Senha para abrir o painel (vazio = qualquer um com o link abre).
  senha: '',
  // As consultas ao Feishu são reaproveitadas por N segundos: com várias pessoas abertas, o Feishu é consultado
  // no máximo uma vez a cada N segundos por tabela (o painel se atualiza a cada 60 s).
  cacheSegundos: 30,
  // Link público (Tailscale Funnel).
  //   Servidor da Oracle: porta 10000 → https://NOME.ts.net:10000 (8443 = Monitor de Recebimento).
  //   Notebook com Windows: as portas 443, 8443 e 10000 já são do principal, do Sorter e do Lotes → o link fica na 443 com
  //   /patio no fim (https://NOTEBOOK.ts.net/patio), como o Monitor (/recebimento).
  linkPublico: '',
  portaLink: process.platform === 'win32' ? 443 : 10000,
  caminho: process.platform === 'win32' ? '/patio' : ''
};

function arquivoConfig() {
  return process.env.PATIO_CONFIG ? path.resolve(process.env.PATIO_CONFIG) : path.join(PASTA_APP, 'config.json');
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
  if (process.env.PATIO_PORTA) cfg.porta = Number(process.env.PATIO_PORTA);
  cfg.porta = Number(cfg.porta) || PADRAO.porta;
  cfg.portaLink = Number(cfg.portaLink) || PADRAO.portaLink;
  cfg.cacheSegundos = Math.min(600, Math.max(5, Number(cfg.cacheSegundos) || PADRAO.cacheSegundos));
  // "/patio", "patio", "/patio/" → "/patio"; só letras, números, - e _.
  const cam = String(cfg.caminho || '').trim().replace(/^\/+|\/+$/g, '');
  cfg.caminho = /^[A-Za-z0-9_-]+$/.test(cam) ? '/' + cam : '';
  cfg.linkPublico = String(cfg.linkPublico || '').trim().replace(/\/+$/, '');
  cfg.pastaApp = PASTA_APP;
  cfg.pastaDados = path.resolve(process.env.PATIO_DADOS || path.join(PASTA_APP, 'dados'));
  cfg.dataDir = cfg.pastaDados; // lib/auth.js (senha do painel)
  // Só para testes: troca o endereço do Feishu (ex.: um Feishu de mentira em http://127.0.0.1:4566).
  cfg.feishuUrl = process.env.PATIO_FEISHU_URL || '';
  fs.mkdirSync(cfg.pastaDados, {recursive: true});
  return cfg;
}

module.exports = {loadConfig, PADRAO};
