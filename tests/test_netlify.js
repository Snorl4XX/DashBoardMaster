'use strict';
/**
 * Painel no Netlify: Api.gs (o que a página do Netlify pede ao Apps Script) e a página gerada por tools/gerar_paineis.js.
 * Uso: node tests/test_netlify.js
 */
process.env.TZ = 'America/Sao_Paulo';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {createContext, fakeJms, makeDay} = require('./mocks.js');
const {buildNetlify} = require('../tools/gerar_paineis.js');

const ROOT = path.join(__dirname, '..');
let passed = 0;
function check(cond, name, extra) {
  if (!cond) {
    console.error('FALHOU: ' + name + (extra === undefined ? '' : ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 1500))));
    process.exit(1);
  }
  passed++;
}

// ---------- 1. Api.gs no Apps Script (simulado), com dados baixados do JMS falso ----------
const props = {JMS_AUTHTOKEN: 'FAKE', JMS_AUTH_MODE: 'AUTHTOKEN', DATA_START_DATE: '2026-09-17', ATUALIZACAO_MIN: '60', COTA_GOOGLE: 'workspace',
  MODO_ATUALIZACAO: 'continuo'};
const days = {'2026-09-17': makeDay('2026-09-17', 11), '2026-09-18': makeDay('2026-09-18', 23), '2026-09-19': makeDay('2026-09-19', 37)};
const ctx = createContext({props, jms: fakeJms(days), quiet: true});
ctx.ContentService = {MimeType: {JSON: 'application/json'}, createTextOutput: t => ({text: t, mime: '', setMimeType(m) { this.mime = m; return this; }})};
vm.runInContext(fs.readFileSync(path.join(ROOT, 'Api.gs'), 'utf8'), ctx, {filename: 'Api.gs'});
ctx.startFullHistory();
for (let i = 0; i < 8 && ctx.pendingJobs_().length; i++) ctx.processSyncQueue({budgetMs: 600000});
const post = body => {
  const out = ctx.doPost({postData: {contents: typeof body === 'string' ? body : JSON.stringify(body), type: 'text/plain'}});
  check(out.mime === 'application/json', 'resposta em JSON');
  return JSON.parse(out.text);
};

const boot = post({fn: 'getAppBootstrap', args: []});
check(boot.ok && boot.result && typeof boot.result === 'object', 'getAppBootstrap pelo doPost', boot);
const dash = post({fn: 'getDashboardData', args: ['wrong_send', {from: '2026-09-17', to: '2026-09-19'}]});
const direct = JSON.parse(JSON.stringify(ctx.getDashboardData('wrong_send', {from: '2026-09-17', to: '2026-09-19'})));
check(dash.ok && JSON.stringify(dash.result.rates) === JSON.stringify(direct.rates) && dash.result.rates.length === 3,
  'getDashboardData pelo doPost = o mesmo do google.script.run', {ok: dash.ok, n: dash.result && dash.result.rates.length});

const calls = new Set((fs.readFileSync(path.join(ROOT, 'Client.html'), 'utf8').match(/call\('([A-Za-z0-9]+)'/g) || []).map(s => s.slice(6, -1)));
const allowed = new Set(vm.runInContext('FUNCOES_DA_PAGINA_', ctx));
check(calls.size > 5 && calls.size === allowed.size && Array.from(calls).every(f => allowed.has(f)),
  'Api.gs libera exatamente as funções que a página chama', {pagina: Array.from(calls), api: Array.from(allowed)});
for (const fn of ['setupProject', 'getRates_', 'doPost', 'removeProjectTriggers', 'constructor', '__proto__']) {
  const r = post({fn, args: []});
  check(!r.ok && /não permitida/.test(r.error), 'função fora da página bloqueada: ' + fn, r);
}
check(/inválido/.test(post('nada de json').error), 'pedido que não é JSON');
check(!post({fn: 'getDashboardData', args: ['indicador_que_nao_existe', {}]}).ok, 'erro do painel volta como {ok:false}');

// Senha (Propriedade do script SENHA_PAINEL)
ctx.__state.props.SENHA_PAINEL = 'senha-teste';
const sem = post({fn: 'getAppBootstrap', args: []});
check(!sem.ok && sem.senha === true && /Digite a senha/.test(sem.error), 'com SENHA_PAINEL: sem senha pede a senha', sem);
const errada = post({fn: 'getAppBootstrap', args: [], senha: 'outra'});
check(!errada.ok && errada.senha === true && /incorreta/.test(errada.error), 'senha errada recusada');
check(post({fn: 'getAppBootstrap', args: [], senha: 'senha-teste'}).ok, 'senha certa responde');
delete ctx.__state.props.SENHA_PAINEL;

// ---------- 2. Página do Netlify gerada pelo tools/gerar_paineis.js ----------
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-netlify-'));
const site = buildNetlify(out);
check(fs.existsSync(site.zip) && site.files.length === 5, 'ZIP do Netlify gerado', site.files);
const index = fs.readFileSync(path.join(site.dir, 'index.html'), 'utf8');
const fluxos = fs.readFileSync(path.join(site.dir, 'fluxos.html'), 'utf8');
check(!/<\?!?=/.test(index) && /data-painel="principal"/.test(index) && /data-painel="fluxos"/.test(fluxos), 'páginas montadas, sem marcas do Apps Script');
check(index.indexOf('<meta charset="UTF-8">') < 400 && /<title>J&amp;T/.test(index) && /name="viewport"/.test(index), 'charset no começo, título e viewport');
check(index.indexOf('window.JTCore=(') > 0 && index.indexOf('window.__BOOT__ = (function') > 0, 'núcleo e boot da página no lugar do doGet');
const scripts = (index.match(/<script(?![^>]*\bsrc=)(?![^>]*application\/json)[^>]*>[\s\S]*?<\/script>/g) || [])
  .map(t => t.replace(/^<script[^>]*>|<\/script>$/g, ''));
const broken = scripts.filter(js => { try { new Function(js); return false; } catch (e) { return true; } });
check(scripts.length >= 4 && !broken.length, 'todos os scripts da página compilam', broken.map(s => s.slice(0, 80)));
const bootFn = index.match(/window\.__BOOT__ = (\(function [\s\S]*?\}\)\(\));<\/script>/);
const bootOf = search => vm.runInNewContext(bootFn[1], {location: {search}, URLSearchParams});
check(JSON.stringify(bootOf('?ind=sc_dc&lang=zh&view=results')) === JSON.stringify({lang: 'zh', indicator: 'sc_dc', view: 'results'}) &&
  bootOf('?ind=nao_existe').indicator === '', 'boot pelo endereço igual ao doGet (indicador, idioma, visão)');
const txt = fs.readFileSync(path.join(site.dir, 'link-apps-script.txt'), 'utf8');
check(/\r\nprincipal = \r\n/.test(txt) && /\r\nfluxos = \r\n/.test(txt), 'link-apps-script.txt pronto para colar o /exec (Bloco de Notas)');
check(fs.readFileSync(path.join(site.dir, 'Api.gs'), 'utf8') === fs.readFileSync(path.join(ROOT, 'Api.gs'), 'utf8'), 'Api.gs junto na pasta');
fs.rmSync(out, {recursive: true, force: true});

console.log('OK: ' + passed + ' verificações do painel no Netlify passaram.');
