#!/usr/bin/env node
'use strict';
/**
 * Comandos do Controle de Pátio no terminal do servidor (pasta controle-patio):
 *   node patio.js configurar    pede os 6 dados do Feishu (o App Secret não aparece na tela) e testa (configurar.sh / .bat)
 *   node patio.js status        dados do Feishu cadastrados (o App Secret nunca aparece) e o link
 *   node patio.js testar        roda os testes do seu Codigo.gs: testarConexaoFeishu, testarTabelasFeishu e testarLeituraPatio
 *   node patio.js diagnosticar  roda diagnosticarDescargasPatio_SCGRU (somente leitura)
 *   node patio.js pronto        sai com 0 se os 6 dados do Feishu estão gravados (usado pelo iniciar.bat)
 *   node patio.js tem CHAVE     escreve "sim" se a chave já tem valor
 *   node patio.js gravar        grava as variáveis PATIO_SET_<CHAVE> (vazias = mantém o valor atual)
 */
const fs = require('fs');
const {loadConfig} = require('./lib/config');
const propriedades = require('./lib/propriedades');

/**
 * Pergunta no terminal (Windows, Linux e pelo SSH do Cloud Shell). oculto = não mostra o que é digitado/colado.
 * Sem terminal (entrada por arquivo ou pipe), lê uma linha por pergunta.
 */
let linhasSemTerminal = null;
function perguntar(texto, oculto) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    if (!linhasSemTerminal) { try { linhasSemTerminal = fs.readFileSync(0, 'utf8').split(/\r?\n/); } catch (e) { linhasSemTerminal = []; } }
    process.stdout.write(texto + '\n');
    return Promise.resolve(String(linhasSemTerminal.shift() || '').trim());
  }
  return new Promise(resolve => {
    process.stdout.write(texto);
    let valor = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const tecla = pedaco => {
      for (const c of pedaco) {
        if (c === '\r' || c === '\n') {
          stdin.removeListener('data', tecla);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(valor.trim());
          return;
        }
        if (c === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') {
          if (valor) { valor = valor.slice(0, -1); if (!oculto) process.stdout.write('\b \b'); }
          continue;
        }
        if (c >= ' ') { valor += c; if (!oculto) process.stdout.write(c); }
      }
    };
    stdin.on('data', tecla);
  });
}

async function configurar(cfg) {
  console.log('');
  console.log('Dados do Feishu: copie do Apps Script (engrenagem Configurações do projeto > Propriedades do script).');
  console.log('Cole cada valor e tecle Enter. Enter vazio = mantém o que já está gravado.');
  console.log('');
  const atual = propriedades.ler(cfg.pastaDados), novos = {};
  for (const k of propriedades.CHAVES) {
    const oculto = propriedades.SECRETAS.indexOf(k) >= 0;
    const tem = String(atual[k] || '').trim() ? ' [Enter = manter]' : '';
    novos[k] = await perguntar(k + (oculto ? ' (não aparece na tela)' : '') + tem + ': ', oculto);
  }
  const mudou = propriedades.atualizar(cfg.pastaDados, novos);
  console.log('');
  console.log(mudou.length ? 'Gravado: ' + mudou.join(', ') + '.' : 'Nada mudou.');
  const falta = propriedades.faltando(cfg.pastaDados);
  if (falta.length) { console.log('Ainda falta: ' + falta.join(', ') + '. Rode de novo para completar.'); return 1; }
  console.log('');
  console.log('Testando o Feishu com esses dados...');
  const ok = rodar(['testarConexaoFeishu', 'testarTabelasFeishu', 'testarLeituraPatio']);
  console.log(ok ? '\nTudo certo com o Feishu. O painel já usa os dados novos (não precisa reiniciar).'
    : '\nAlgum teste deu erro: confira os valores e rode a configuração de novo.');
  return ok ? 0 : 1;
}

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

async function main(argv) {
  const cmd = argv[0] || 'status';
  const cfg = loadConfig();
  if (cmd === 'configurar') return configurar(cfg);
  if (cmd === 'pronto') return propriedades.faltando(cfg.pastaDados).length ? 1 : 0;
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
    if (falta.length) { console.log('Faltam os dados do Feishu: ' + falta.join(', ') + '. Rode: bash configurar.sh (no Windows: configurar.bat)'); return 1; }
    const ok = rodar(['testarConexaoFeishu', 'testarTabelasFeishu', 'testarLeituraPatio']);
    console.log(ok ? '\nTudo certo com o Feishu.' : '\nAlgum teste deu erro: confira os dados com bash configurar.sh (no Windows: configurar.bat).');
    return ok ? 0 : 1;
  }
  if (cmd === 'diagnosticar') return rodar(['diagnosticarDescargasPatio_SCGRU']) ? 0 : 1;
  console.log('Comandos: configurar | status | testar | diagnosticar');
  return 1;
}

if (require.main === module) main(process.argv.slice(2)).then(c => { process.exitCode = c; }, e => { console.error(e); process.exitCode = 1; });
module.exports = {main};
