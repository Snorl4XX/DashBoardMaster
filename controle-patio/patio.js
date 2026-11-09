#!/usr/bin/env node
'use strict';
/**
 * Comandos do Controle de Pátio no terminal do servidor (pasta controle-patio):
 *   node patio.js status        dados do Feishu cadastrados (o App Secret nunca aparece) e o link
 *   node patio.js testar        roda os testes do seu Codigo.gs: testarConexaoFeishu, testarTabelasFeishu e testarLeituraPatio
 *   node patio.js diagnosticar  roda diagnosticarDescargasPatio_SCGRU (somente leitura)
 * Usados pelo configurar.sh:
 *   node patio.js tem CHAVE     escreve "sim" se a chave já tem valor
 *   node patio.js gravar        grava as variáveis PATIO_SET_<CHAVE> (vazias = mantém o valor atual)
 */
const {loadConfig} = require('./lib/config');
const propriedades = require('./lib/propriedades');

function rodar(funcoes) {
  const {carregar} = require('./lib/apps-script');
  const {fetchAllSync, sleepSync} = require('./lib/syncfetch');
  const cfg = loadConfig();
  const ctx = carregar({pastaApp: cfg.pastaApp, pastaDados: cfg.pastaDados, feishuUrl: cfg.feishuUrl, fetchAllSync, sleepSync,
    log: (nivel, texto) => console.log((nivel === 'erro' ? '  [erro] ' : '  ') + texto)});
  let ok = true;
  funcoes.forEach(fn => {
    console.log('\n== ' + fn);
    try { ctx[fn](); } catch (e) { ok = false; console.log('  [erro] ' + ((e && e.message) || e)); }
  });
  return ok;
}

function main(argv) {
  const cmd = argv[0] || 'status';
  const cfg = loadConfig();
  if (cmd === 'tem') {
    console.log(String(propriedades.ler(cfg.pastaDados)[argv[1]] || '').trim() ? 'sim' : 'nao');
    return 0;
  }
  if (cmd === 'gravar') {
    const novos = {};
    propriedades.CHAVES.forEach(k => { if (process.env['PATIO_SET_' + k]) novos[k] = process.env['PATIO_SET_' + k]; });
    const mudou = propriedades.atualizar(cfg.pastaDados, novos);
    console.log(mudou.length ? 'Gravado: ' + mudou.join(', ') + '.' : 'Nada mudou.');
    const falta = propriedades.faltando(cfg.pastaDados);
    if (falta.length) console.log('Ainda falta: ' + falta.join(', ') + '.');
    return 0;
  }
  if (cmd === 'status') {
    const p = propriedades.ler(cfg.pastaDados);
    console.log('Dados do Feishu (' + propriedades.arquivo(cfg.pastaDados) + '):');
    propriedades.CHAVES.forEach(k => {
      const v = String(p[k] || '').trim();
      console.log('  ' + k.padEnd(24) + (!v ? 'FALTA' : propriedades.SECRETAS.indexOf(k) >= 0 ? 'cadastrado (não aparece)' : v));
    });
    console.log('Painel: http://localhost:' + cfg.porta + '  ·  Link: ' + (cfg.linkPublico || '(rode bash link-publico.sh)') +
      '  ·  Senha: ' + (cfg.senha ? 'sim' : 'não'));
    return 0;
  }
  if (cmd === 'testar') {
    const falta = propriedades.faltando(cfg.pastaDados);
    if (falta.length) { console.log('Faltam os dados do Feishu: ' + falta.join(', ') + '. Rode: bash configurar.sh'); return 1; }
    const ok = rodar(['testarConexaoFeishu', 'testarTabelasFeishu', 'testarLeituraPatio']);
    console.log(ok ? '\nTudo certo com o Feishu.' : '\nAlgum teste deu erro: confira os dados com bash configurar.sh.');
    return ok ? 0 : 1;
  }
  if (cmd === 'diagnosticar') return rodar(['diagnosticarDescargasPatio_SCGRU']) ? 0 : 1;
  console.log('Comandos: status | testar | diagnosticar');
  return 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = {main};
