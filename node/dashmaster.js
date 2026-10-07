#!/usr/bin/env node
'use strict';
/**
 * Comandos de manutenção sem navegador (útil num servidor sem tela). O servidor pode continuar aberto.
 *   node dashmaster.js token                      → pede o AuthToken do JMS (não aparece na tela) e salva
 *   node dashmaster.js executar <função> [args]   → igual ao ▶ Executar do Apps Script (ex.: diagnosticarConexaoJms)
 *   node dashmaster.js propriedade <CHAVE> [valor] → mostra ou altera uma propriedade ("--remover" apaga)
 *   node dashmaster.js status                     → fila e credencial
 */
process.env.TZ = 'America/Sao_Paulo';
require('./lib/quiet');
const readline = require('readline');
const {loadConfig} = require('./lib/config');
const {GasRuntime} = require('./lib/gas');

const SECRET = /TOKEN|COOKIE|AUTHORIZATION|SENHA|SECRET|PASSWORD/i;

function usage() {
  console.log('Uso:\n  node dashmaster.js token\n  node dashmaster.js executar <função> [parâmetros…]\n' +
    '  node dashmaster.js propriedade <CHAVE> [valor | --remover]\n  node dashmaster.js status');
  process.exit(1);
}

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout, terminal: true});
    let asked = false;
    rl._writeToOutput = s => { if (!asked) { process.stdout.write(s); asked = true; } else if (/\r|\n/.test(s)) process.stdout.write('\n'); else process.stdout.write('*'); };
    rl.question(question, answer => { rl.close(); resolve(String(answer || '').trim()); });
  });
}

function parseArg(a) {
  try { return JSON.parse(a); } catch (e) { return a; }
}

(async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();
  const cfg = loadConfig();
  const rt = new GasRuntime(cfg);
  rt.bootstrap();
  const props = rt.props();
  if (cmd === 'token') {
    const tok = rest[0] || await askHidden('Cole o AuthToken do JMS e tecle Enter: ');
    if (!tok) { console.log('Nada salvo.'); process.exit(1); }
    props.setProperty('JMS_AUTHTOKEN', tok);
    console.log('AuthToken salvo (' + tok.length + ' caracteres). Testando a conexão…');
    const out = rt.run('diagnosticarConexaoJms', [], {echo: (lvl, line) => console.log(line)});
    if (!out.logs.length) console.log(JSON.stringify(out.result, null, 2));
  } else if (cmd === 'executar') {
    const fn = rest[0];
    if (!fn) usage();
    const t = Date.now();
    const out = rt.run(fn, rest.slice(1).map(parseArg), {echo: (lvl, line) => (lvl === 'error' ? console.error : console.log)(line)});
    if (out.result !== undefined && !(out.result && out.result.texto && out.logs.length)) console.log(JSON.stringify(out.result, null, 2));
    console.log('(' + ((Date.now() - t) / 1000).toFixed(1) + ' s, ' + out.fetches + ' consultas externas)');
  } else if (cmd === 'propriedade') {
    const k = rest[0];
    if (!k) usage();
    if (rest[1] === '--remover') { props.deleteProperty(k); console.log('Removida: ' + k); }
    else if (rest.length > 1) { props.setProperty(k, rest.slice(1).join(' ')); console.log('Salva: ' + k); }
    else { const v = props.getProperty(k); console.log(v === null ? '(não existe)' : SECRET.test(k) ? '•••••• (' + v.length + ' caracteres)' : v); }
  } else if (cmd === 'status') {
    const st = rt.run('getSyncStatus', []).result;
    console.log('Painel ' + (String(rt.source).match(/VERSION:\s*'([^']+)'/) || [])[1] + ' · banco ' + cfg.dbFile);
    console.log('AuthToken: ' + (props.getProperty('JMS_AUTHTOKEN') ? 'cadastrado' : 'NÃO cadastrado'));
    console.log('Fila: ' + JSON.stringify(st));
  } else usage();
  rt.close();
  process.exit(0);
})().catch(e => { console.error('Erro: ' + (e && e.message || e)); process.exit(1); });
