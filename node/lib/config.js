'use strict';
/**
 * Configuração da versão Node.js (arquivo node/config.json).
 * Na primeira execução o arquivo é criado com os valores padrão abaixo; edite e reinicie o servidor.
 */
const fs = require('fs');
const path = require('path');

const NODE_DIR = path.join(__dirname, '..');

const DEFAULTS = {
  // Porta do painel: http://localhost:3000 neste computador, http://IP-DO-COMPUTADOR:3000 na rede.
  porta: 3000,
  // 0.0.0.0 = aceita acesso pela rede; 127.0.0.1 = só neste computador.
  host: '0.0.0.0',
  // Senha para abrir o painel (vazio = qualquer um com o link abre, como o link do Google hoje).
  senha: '',
  // Senha da tela Configurações (/config). Vazio = a tela só abre neste computador (localhost).
  senhaConfig: '',
  // Onde ficam o banco (SQLite), os arquivos baixados e os relatórios.
  pastaDados: './dados',
  // Onde ficam os arquivos do painel (.gs e .html). Padrão: a pasta acima de node/.
  pastaCodigo: '..',
  // A fila de downloads do JMS roda a cada N segundos (o Google rodava a cada 5 min, com limite diário).
  filaCadaSegundos: 60,
  // Quantas consultas do painel podem rodar ao mesmo tempo (cada uma num processo leve separado).
  trabalhadores: 3,
  // Caminho do Edge/Chrome para gerar PDF. Vazio = procura sozinho.
  navegadorPdf: '',
  // false = não roda a fila sozinho (só para testes/manutenção).
  agendador: true,
  // Link público do painel (ex.: https://computador.nome.ts.net, do Tailscale Funnel). Só para mostrar na janela e em Configurações.
  linkPublico: ''
};

function configPath() {
  return process.env.DASHMASTER_CONFIG ? path.resolve(process.env.DASHMASTER_CONFIG) : path.join(NODE_DIR, 'config.json');
}

function loadConfig(opts) {
  opts = opts || {};
  const file = configPath();
  let user = {};
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    try { user = JSON.parse(text); }
    catch (e) { throw new Error('config.json inválido (' + e.message + '). Corrija o arquivo ou apague-o para recriar.'); }
  } else if (opts.create !== false) {
    try { fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + '\n'); } catch (e) { /* pasta só leitura: usa os padrões */ }
  }
  const cfg = Object.assign({}, DEFAULTS, user);
  if (process.env.DASHMASTER_PORT) cfg.porta = Number(process.env.DASHMASTER_PORT);
  if (process.env.DASHMASTER_DATA) cfg.pastaDados = process.env.DASHMASTER_DATA;
  const base = path.dirname(file);
  cfg.dataDir = path.resolve(base, cfg.pastaDados);
  cfg.codeDir = path.resolve(base, cfg.pastaCodigo);
  cfg.dbFile = path.join(cfg.dataDir, 'dashmaster.db');
  cfg.filesDir = path.join(cfg.dataDir, 'arquivos');
  cfg.porta = Number(cfg.porta) || DEFAULTS.porta;
  cfg.linkPublico = String(cfg.linkPublico || '').trim().replace(/\/+$/, '');
  cfg.filaCadaSegundos = Math.max(15, Number(cfg.filaCadaSegundos) || DEFAULTS.filaCadaSegundos);
  cfg.trabalhadores = Math.max(1, Math.min(8, Number(cfg.trabalhadores) || DEFAULTS.trabalhadores));
  if (process.env.DASHMASTER_SEM_AGENDADOR === '1') cfg.agendador = false;
  // Só para testes: troca o endereço do JMS (ex.: um JMS simulado em http://127.0.0.1:4555).
  cfg.jmsUrl = process.env.DASHMASTER_JMS_URL || cfg.jmsUrl || '';
  fs.mkdirSync(cfg.dataDir, {recursive: true});
  fs.mkdirSync(cfg.filesDir, {recursive: true});
  return cfg;
}

module.exports = {loadConfig, DEFAULTS, NODE_DIR};
