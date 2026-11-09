'use strict';
/**
 * Dados do Feishu (FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_APP_TOKEN e as 3 tabelas) em dados/feishu.json,
 * só com leitura para o dono do arquivo. O App Secret nunca aparece na tela, no registro nem no link.
 * Veio da versão 1.x (dados/propriedades.json)? Na primeira leitura o arquivo é renomeado para feishu.json.
 */
const fs = require('fs');
const path = require('path');

const CHAVES = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_APP_TOKEN', 'FEISHU_TABLE_PATIO', 'FEISHU_TABLE_DOCAS', 'FEISHU_TABLE_EXPEDICAO'];
const SECRETAS = ['FEISHU_APP_SECRET'];

const arquivo = pastaDados => path.join(pastaDados, 'feishu.json');

function migrar(pastaDados) {
  const antigo = path.join(pastaDados, 'propriedades.json');
  if (fs.existsSync(arquivo(pastaDados)) || !fs.existsSync(antigo)) return;
  try { fs.renameSync(antigo, arquivo(pastaDados)); fs.chmodSync(arquivo(pastaDados), 0o600); } catch (e) { /* fica o antigo */ }
}

function ler(pastaDados) {
  migrar(pastaDados);
  try {
    const o = JSON.parse(fs.readFileSync(arquivo(pastaDados), 'utf8').replace(/^﻿/, ''));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (e) { return {}; }
}

function gravar(pastaDados, obj) {
  fs.mkdirSync(pastaDados, {recursive: true});
  const destino = arquivo(pastaDados), tmp = destino + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', {mode: 0o600});
  fs.renameSync(tmp, destino);
  try { fs.chmodSync(destino, 0o600); } catch (e) { /* Windows */ }
}

/** Junta os valores novos (vazios são ignorados: mantém o atual). Devolve as chaves que mudaram. */
function atualizar(pastaDados, novos) {
  const atual = ler(pastaDados), mudou = [];
  Object.keys(novos || {}).forEach(k => {
    const v = String(novos[k] === undefined || novos[k] === null ? '' : novos[k]).trim();
    if (v && atual[k] !== v) { atual[k] = v; mudou.push(k); }
  });
  if (mudou.length) gravar(pastaDados, atual);
  return mudou;
}

const faltando = pastaDados => { const p = ler(pastaDados); return CHAVES.filter(k => !String(p[k] || '').trim()); };

module.exports = {CHAVES, SECRETAS, ler, gravar, atualizar, faltando, arquivo};
