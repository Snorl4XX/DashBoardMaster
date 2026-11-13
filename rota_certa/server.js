#!/usr/bin/env node
'use strict';
/**
 * J&T · ROTA CERTA (app separado do DashMaster)
 * ---------------------------------------------
 * Painel em tempo real das remessas carregadas na rota errada (pedido "verificar se a remessa, com os segmentos dela, pertence à
 * rota mencionada"). Hoje, a cada "minutos" minutos (lib/coletor.js):
 *   viagens do dia que saem da base (linha principal e secundária, Concluído e Em Trânsito) → rota do caminhão = Unidade de destino
 *   → remessas do Bipe de carregamento da base → 3 Segmentos na Gestão de pedido (1.000 por consulta) → chave (SP, SBN, MOO, GRU:
 *   as duas primeiras informações; as outras iniciais: a primeira) → tabela de rotas do SC (lib/rotas.js) → certa ou errada.
 * Painel (public/): cartões, gráficos, a tabela e a planilha SÓ com os erros. Configurações: AuthToken e tabela de rotas.
 *
 * Node.js 22.13 ou mais novo, sem instalar pacotes. Configuração: config.json (criado na primeira vez, ao lado deste arquivo).
 * Páginas: http://localhost:3800 (painel) e http://localhost:3800/config (só neste computador).
 */
process.env.TZ = 'America/Sao_Paulo';

function pararComErro(msg) {
  console.error('[erro] ' + msg);
  if (process.platform === 'win32' && process.stdout.isTTY && !process.env.ROTA_SEM_PAUSA) {
    console.error('\nO painel NÃO está no ar. Tire um print desta janela para pedir ajuda (sem o AuthToken).\nEsta janela fica aberta para você ler: feche no X.');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30 * 60000);
  }
  process.exit(1);
}
const [MAIOR, MENOR] = process.versions.node.split('.').map(Number);
if (MAIOR < 22 || (MAIOR === 22 && MENOR < 13)) pararComErro('Este app precisa do Node.js 22.13 ou mais novo (você tem ' + process.version + ').');

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {Banco} = require('./lib/db');
const {Jms} = require('./lib/jms');
const {Rotas, lerRotas} = require('./lib/rotas');
const {abasPadrao} = require('./lib/rotas_padrao');
const {Coletor, hojeSp, somaDias} = require('./lib/coletor');
const {Painel} = require('./lib/painel');
const {codigosStatus} = require('./lib/status');
const {escreverXlsx} = require('./lib/xlsx');

const VERSAO = require('./package.json').version;
const DEFAULTS = {
  porta: 3800,              // livre: DashMaster 3000, Sorter 3100/3500, pesquisa 3200, Expedição Incorreta 3300, Lotes 3400, Monitor 3600, Pátio 3700
  host: '0.0.0.0',          // 0.0.0.0 = abre para a rede; 127.0.0.1 = só neste computador
  senha: '',                // senha para abrir o painel de fora deste computador (vazio = sem senha)
  codigoBase: '30001',      // a nossa base: os caminhões que SAEM daqui
  nomeBase: 'SP GRU',
  minutos: 30,              // de quanto em quanto tempo busca no JMS (o dia de hoje) · pedido: a cada 30 minutos
  status: {concluido: [4], emTransito: [3]}, // Status da tarefa no JMS: Concluído：已完成 e Em Trânsito：在途
  remessasPorConsulta: 1000, // Gestão de pedido: remessas em cada consulta (o limite da tela)
  segundosEntreConsultas: 1, // Gestão de pedido: pausa entre uma consulta e a próxima
  consultasPorSegundo: 4,   // no máximo tantas consultas ao JMS por segundo, somando todas
  consultasAoMesmoTempo: 3, // viagens baixadas ao mesmo tempo
  diasGuardados: 7,         // dias que ficam no banco (o painel abre em hoje)
  dashmaster: '',           // pasta do DashMaster para usar o mesmo AuthToken (vazio = procura em C:\dashmaster; "nao" = não usar)
  linkPublico: '',          // link do Tailscale (só para aparecer na janela e em Configurações)
  caminho: '/rota-certa'    // o app também responde em https://NOME.ts.net/rota-certa (link principal do Tailscale)
};
const MAX_CORPO = 25 * 1024 * 1024;

// ------------------------------------------------------------------ configuração
function arquivoConfig() { return process.env.ROTA_CONFIG ? path.resolve(process.env.ROTA_CONFIG) : path.join(__dirname, 'config.json'); }
function lerConfig() {
  const arq = arquivoConfig();
  let bruto = {};
  if (fs.existsSync(arq)) {
    try { bruto = JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { throw new Error('config.json inválido (' + e.message + '). Corrija o arquivo ou apague-o para recriar.'); }
  } else fs.writeFileSync(arq, JSON.stringify(DEFAULTS, null, 2) + '\n');
  const c = Object.assign({}, DEFAULTS, bruto);
  ['porta', 'minutos', 'consultasPorSegundo', 'consultasAoMesmoTempo', 'diasGuardados'].forEach(k => { c[k] = Number(c[k]) > 0 ? Number(c[k]) : DEFAULTS[k]; });
  if (process.env.ROTA_PORTA) c.porta = Number(process.env.ROTA_PORTA);
  c.minutos = Math.max(2, c.minutos);
  c.remessasPorConsulta = Math.max(1, Math.min(1000, Math.floor(Number(c.remessasPorConsulta) || 1000)));
  c.segundosEntreConsultas = Number(c.segundosEntreConsultas) >= 0 ? Number(c.segundosEntreConsultas) : DEFAULTS.segundosEntreConsultas;
  c.codigoBase = String(c.codigoBase).trim(); c.nomeBase = String(c.nomeBase).trim();
  const cam = String(c.caminho === undefined || c.caminho === null ? '' : c.caminho).trim().replace(/^\/+|\/+$/g, '');
  c.caminho = /^[A-Za-z0-9_-]+$/.test(cam) ? '/' + cam : '';
  c.statusCodigos = codigosStatus(c.status);
  const pasta = path.dirname(arq);
  c.dados = path.resolve(pasta, c.pastaDados || 'dados');
  c.planilhas = path.resolve(pasta, c.pastaPlanilhas || 'planilhas');
  return c;
}
let cfg;
try { cfg = lerConfig(); } catch (e) { pararComErro('Não consegui iniciar: ' + e.message); }

// ------------------------------------------------------------------ registro (janela + dados/rota_certa.log)
const ULTIMAS = [];
function log(nivel, texto) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const linha = hojeSp(d) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' [' + nivel + '] ' + String(texto).replace(/\s+$/, '');
  (nivel === 'erro' ? console.error : console.log)(linha);
  ULTIMAS.push(linha);
  if (ULTIMAS.length > 200) ULTIMAS.shift();
  try {
    const arq = path.join(cfg.dados, 'rota_certa.log');
    if (fs.existsSync(arq) && fs.statSync(arq).size > 5 * 1024 * 1024) fs.renameSync(arq, arq + '.1');
    fs.appendFileSync(arq, linha + '\n');
  } catch (e) { /* sem disco: só na janela */ }
}

// ------------------------------------------------------------------ AuthToken: o deste app ou o do DashMaster
function limparToken(v) {
  let s = String(v || '').trim();
  if (/^\{/.test(s)) { try { const o = JSON.parse(s); s = String(o.authToken || o.authtoken || o.AuthToken || o.token || ''); } catch (e) { /* texto */ } }
  return s.replace(/^["'`]+|["'`]+$/g, '').replace(/^(auth-?token|token)\s*[:=]\s*/i, '').replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
}
const CHAVES_DM = ['JMS_AUTHTOKEN', 'JMS_COOKIE', 'JMS_AUTHORIZATION', 'JMS_LANG', 'JMS_LANGTYPE', 'JMS_TIMEZONE', 'JMS_COUNTRY_ID'];
function bancosDashmaster() {
  const d = String(cfg.dashmaster || '').trim();
  if (/^(nao|não|false|0)$/i.test(d)) return [];
  const out = [];
  if (d) out.push(path.resolve(d, /\.db$/i.test(d) ? '' : 'node/dados/dashmaster.db'));
  out.push(path.join(__dirname, '..', 'dashmaster', 'node', 'dados', 'dashmaster.db'));
  if (process.platform === 'win32') out.push('C:\\dashmaster\\node\\dados\\dashmaster.db', 'C:\\Users\\Public\\dashmaster\\node\\dados\\dashmaster.db');
  return out;
}
let cacheDm = {em: 0, props: null};
function credenciaisDashmaster() {
  if (Date.now() - cacheDm.em < 15000) return cacheDm.props;
  let props = null;
  for (const f of bancosDashmaster()) {
    if (!f || !fs.existsSync(f)) continue;
    try {
      const {DatabaseSync} = require('node:sqlite');
      let db;
      try { db = new DatabaseSync(f, {readOnly: true}); } catch (e) { db = new DatabaseSync(f); }
      try {
        const o = {};
        db.prepare('SELECT k, v FROM props WHERE k IN (' + CHAVES_DM.map(() => '?').join(',') + ')').all(...CHAVES_DM).forEach(r => { o[r.k] = String(r.v || ''); });
        if (o.JMS_AUTHTOKEN) o.JMS_AUTHTOKEN = limparToken(o.JMS_AUTHTOKEN);
        if (o.JMS_AUTHTOKEN || o.JMS_COOKIE) { props = o; break; }
      } finally { db.close(); }
    } catch (e) { /* banco ocupado: tenta o próximo */ }
  }
  cacheDm = {em: Date.now(), props};
  return props;
}
function credenciais() {
  const proprio = banco.get('JMS_AUTHTOKEN');
  if (proprio) return {JMS_AUTHTOKEN: proprio, fonte: 'app'};
  const dm = credenciaisDashmaster();
  return dm ? Object.assign({fonte: 'dashmaster'}, dm) : {fonte: ''};
}

// ------------------------------------------------------------------ peças
let banco, rotas, jms, coletor, painel;
try {
  banco = new Banco(path.join(cfg.dados, 'rota_certa.db'));
  rotas = new Rotas(cfg.planilhas, abasPadrao);
  jms = new Jms({base: process.env.ROTA_JMS_URL, credenciais, props: banco, log, porSegundo: cfg.consultasPorSegundo});
  painel = new Painel(banco, cfg);
  coletor = new Coletor({banco, jms, rotas, cfg, log, aoMudar: () => painel.mudou()});
  painel.rotaDe = v => coletor.rotaDe(v);
} catch (e) { pararComErro('Não consegui iniciar: ' + (e && e.stack || e)); }

// ------------------------------------------------------------------ acesso
function viaTunel(req) {
  return Object.keys(req.headers).some(h => /^(x-forwarded-|x-real-ip$|forwarded$|via$|true-client-ip$|cf-|tailscale-|x-ngrok|ngrok-)/.test(h));
}
function local(req) {
  if (viaTunel(req)) return false;
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') return false;
  return /^(127\.|::1$|::ffff:127\.)/.test(String(req.socket.remoteAddress || ''));
}
function segredo() {
  let s = banco.get('SEGREDO_SESSAO');
  if (!s) { s = crypto.randomBytes(24).toString('hex'); banco.set('SEGREDO_SESSAO', s); }
  return s;
}
function marcaSenha() { return crypto.createHmac('sha256', segredo()).update(String(cfg.senha)).digest('hex').slice(0, 40); }
function cookies(req) {
  const o = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function liberado(req) { return !cfg.senha || local(req) || cookies(req).rc_sessao === marcaSenha(); }

// ------------------------------------------------------------------ respostas
const TIPOS_ARQ = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8'};
const SEGURANCA = {'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN'};
function enviar(res, status, corpo, tipo, extra) {
  res.writeHead(status, Object.assign({'Content-Type': tipo || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}, SEGURANCA, extra || {}));
  res.end(corpo);
}
function json(res, status, obj) { enviar(res, status, JSON.stringify(obj), 'application/json; charset=utf-8'); }
function arquivo(res, nome) {
  const f = path.join(__dirname, 'public', nome);
  fs.readFile(f, (err, data) => err ? enviar(res, 404, 'Não encontrado.') : enviar(res, 200, data, TIPOS_ARQ[path.extname(f)] || 'application/octet-stream'));
}
function lerCorpo(req, limite) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let n = 0;
    req.on('data', c => { n += c.length; if (n > (limite || MAX_CORPO)) { reject(Object.assign(new Error('Arquivo grande demais.'), {status: 413})); req.destroy(); } else partes.push(c); });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}
async function lerJson(req) {
  const b = (await lerCorpo(req, 1024 * 1024)).toString('utf8');
  try { return b ? JSON.parse(b) : {}; } catch (e) { throw Object.assign(new Error('Pedido inválido.'), {status: 400}); }
}
/** Dia pedido (hoje por padrão; só os dias guardados). */
function diaDe(u) {
  const d = String(u.searchParams.get('dia') || ''), hoje = hojeSp();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= hoje && d >= somaDias(hoje, -(cfg.diasGuardados - 1)) ? d : hoje;
}
/** Filtros (pedido): 1º segmento, 2º segmento, turno e doca/esteira ("D:<doca>" ou "E:<esteira>"); a linha fica para uso interno. */
function filtros(u) {
  const g = k => String(u.searchParams.get(k) || '').slice(0, 120).trim();
  return {seg1: g('seg1').toUpperCase(), seg2: g('seg2').toUpperCase(), turno: /^T[123]$/.test(g('turno')) ? g('turno') : '',
    local: /^[DE]:/.test(g('local')) ? g('local') : '', linha: ['troncal', 'secundaria'].indexOf(g('linha')) >= 0 ? g('linha') : ''};
}
/** Situação para o topo do painel (sem nada de credencial). */
function estadoPublico() {
  const e = coletor.estado;
  return {versao: VERSAO, base: cfg.nomeBase, minutos: cfg.minutos, hoje: hojeSp(), diasGuardados: cfg.diasGuardados, token: !!credenciais().fonte,
    busca: {rodando: e.rodando, etapa: e.etapa, inicio: e.inicio, ultimo: e.ultimo, authVencido: e.authVencido, pausaAte: e.pausaAte > Date.now() ? e.pausaAte : 0,
      pendentes: e.pendentes, erros: e.erros.length},
    tabela: rotas.regras ? {ok: true, troncal: rotas.regras.troncal.length, secundaria: rotas.regras.secundaria.length} : {ok: false, erro: rotas.erro}};
}
const nomeArq = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// ------------------------------------------------------------------ rotas HTTP
async function tratar(req, res) {
  let u = new URL(req.url, 'http://x');
  if (cfg.caminho) {
    if (u.pathname === cfg.caminho) return enviar(res, 301, '', 'text/plain', {Location: cfg.caminho + '/' + u.search});
    if (u.pathname.indexOf(cfg.caminho + '/') === 0) u = new URL(u.pathname.slice(cfg.caminho.length) + u.search, 'http://x');
  }
  const p = u.pathname;
  if (['/estilo.css', '/graficos.js', '/app.js', '/config.js'].indexOf(p) >= 0) return arquivo(res, p.slice(1));
  if (p === '/entrar' && req.method === 'POST') {
    const senha = new URLSearchParams((await lerCorpo(req, 4096)).toString('utf8')).get('senha') || '';
    if (cfg.senha && senha === cfg.senha) {
      return enviar(res, 303, '', 'text/plain', {Location: './', 'Set-Cookie': 'rc_sessao=' + marcaSenha() + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'});
    }
    return arquivo(res, 'entrar.html');
  }
  if (p === '/config' || p.startsWith('/config/')) {
    if (!local(req)) return enviar(res, 403, 'A tela Configurações só abre no computador do app (http://localhost:' + cfg.porta + '/config).');
    return tratarConfig(req, res, u);
  }
  if (!liberado(req)) {
    if (p.startsWith('/api/')) return json(res, 401, {ok: false, senha: true, error: 'Digite a senha do painel.'});
    return arquivo(res, 'entrar.html');
  }
  if (p === '/' || p === '/index.html') return arquivo(res, 'index.html');
  if (p === '/api/estado') return json(res, 200, estadoPublico());
  if (p === '/api/painel') {
    rotas.atualizar();
    const dia = diaDe(u);
    return json(res, 200, Object.assign(painel.resumo(dia, filtros(u)), {estado: estadoPublico(), dias: banco.dias().map(x => x.dia)}));
  }
  if (p === '/api/tabela') {
    const g = k => String(u.searchParams.get(k) || '').slice(0, 120);
    return json(res, 200, painel.tabela(diaDe(u), filtros(u), g('busca'), g('pagina'), g('tamanho'), g('ordem'), g('direcao')));
  }
  if (p === '/api/erros.xlsx') {
    const dia = diaDe(u), f = filtros(u);
    const nome = 'remessas_rota_errada_' + dia + [f.seg1, f.seg2, f.turno, f.local.slice(2)].filter(Boolean).map(x => '_' + nomeArq(x)).join('') + '.xlsx';
    return enviar(res, 200, escreverXlsx([painel.planilhaErros(dia, f)]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      {'Content-Disposition': 'attachment; filename="' + nome + '"'});
  }
  if (p === '/api/atualizar' && req.method === 'POST') {
    if (!coletor.estado.rodando) coletor.coletar().catch(() => {});
    return json(res, 200, {ok: true, estado: estadoPublico()});
  }
  return enviar(res, 404, 'Não encontrado.');
}

async function tratarConfig(req, res, u) {
  const p = u.pathname;
  if (p === '/config') return arquivo(res, 'config.html');
  if (p === '/config/api/estado') {
    rotas.atualizar();
    const c = credenciais();
    return json(res, 200, {versao: VERSAO, config: Object.assign({}, cfg, {senha: cfg.senha ? 'definida' : '', statusCodigos: undefined}), enderecos: enderecos(),
      token: {fonte: c.fonte, temProprio: !!banco.get('JMS_AUTHTOKEN'), dashmaster: !!credenciaisDashmaster()}, busca: coletor.estado, registro: ULTIMAS.slice(-80),
      tabela: rotas.resumo(), hoje: hojeSp(), jms: {gestaoPagina: Number(banco.get('GESTAO_PAGINA')) || 0, remessasSecundaria: banco.get('REMESSAS_SECUNDARIA') || ''}});
  }
  if (p === '/config/api/rotas.xlsx') {
    if (!fs.existsSync(rotas.arquivo())) return enviar(res, 404, 'Sem tabela de rotas.');
    return enviar(res, 200, fs.readFileSync(rotas.arquivo()), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {'Content-Disposition': 'attachment; filename="rotas.xlsx"'});
  }
  if (req.method !== 'POST') return enviar(res, 405, 'Use POST.');
  if (p === '/config/api/token') {
    const b = await lerJson(req), t = limparToken(b.authtoken);
    if (!t || t.length > 4000) return json(res, 400, {ok: false, error: 'Cole só o valor do AuthToken.'});
    banco.set('JMS_AUTHTOKEN', t);
    coletor.estado.authVencido = false;
    log('info', 'AuthToken do JMS salvo neste app.');
    return json(res, 200, Object.assign({ok: true}, await testar()));
  }
  if (p === '/config/api/token/apagar') {
    banco.set('JMS_AUTHTOKEN', null);
    log('info', 'AuthToken deste app apagado (usa o do DashMaster, se houver).');
    return json(res, 200, {ok: true});
  }
  if (p === '/config/api/testar') return json(res, 200, await testar());
  if (p === '/config/api/rotas') {
    const buf = await lerCorpo(req);
    let r;
    try { r = lerRotas(buf); } catch (e) { return json(res, 400, {ok: false, error: 'Não usei o arquivo: ' + e.message}); }
    fs.writeFileSync(rotas.arquivo(), buf);
    rotas.atualizar(true);
    coletor.reconferir(hojeSp());
    log('info', 'Tabela de rotas trocada (' + r.formato + ': ' + r.regras.troncal.length + ' rotas da linha principal e ' + r.regras.secundaria.length + ' da secundária). O dia foi conferido de novo.');
    return json(res, 200, {ok: true, tabela: rotas.resumo()});
  }
  if (p === '/config/api/atualizar') {
    if (coletor.estado.rodando) return json(res, 200, {ok: false, error: 'Já está buscando. Espere terminar.'});
    coletor.estado.pausaAte = 0;
    coletor.coletar().catch(() => {});
    return json(res, 200, {ok: true});
  }
  return enviar(res, 404, 'Não encontrado.');
}

/** Teste rápido: uma página de viagens de cada linha e, se houver, uma remessa guardada na Gestão de pedido. */
async function testar() {
  const out = {ok: true, linhas: []}, nomes = {troncal: 'Linha principal', secundaria: 'Linha secundária'};
  jms.novaRodada();
  for (const linha of ['troncal', 'secundaria']) {
    try {
      const r = await jms.viagens(linha, hojeSp(), cfg.codigoBase, 1, 10);
      out.linhas.push(nomes[linha] + ': ok, o JMS respondeu (' + r.total + ' viagens hoje saindo de ' + cfg.nomeBase + ', em todos os status).');
    } catch (e) {
      out.ok = false;
      out.linhas.push(nomes[linha] + ': ' + e.message);
      if (e.auth) { coletor.estado.authVencido = true; return out; }
    }
  }
  const w = banco.uma('SELECT remessa FROM remessas ORDER BY horario DESC LIMIT 1');
  if (w) {
    try {
      const g = await jms.gestao([w.remessa]), s = g.achados.get(w.remessa);
      out.linhas.push('Gestão de pedido: ' + (s ? 'ok, a remessa ' + w.remessa + ' tem o 3 Segmentos ' + (s.codigo || '(vazio)') : 'o JMS respondeu, mas sem a remessa ' + w.remessa) + '.');
    } catch (e) { out.ok = false; out.linhas.push('Gestão de pedido: ' + e.message); }
  }
  return out;
}
function enderecos() {
  const lista = ['http://localhost:' + cfg.porta];
  if (cfg.host === '0.0.0.0' || cfg.host === '::') {
    Object.values(os.networkInterfaces()).forEach(l => (l || []).forEach(a => { if (a.family === 'IPv4' && !a.internal) lista.push('http://' + a.address + ':' + cfg.porta); }));
  }
  if (cfg.linkPublico) lista.push(String(cfg.linkPublico).replace(/\/+$/, ''));
  return lista;
}

// ------------------------------------------------------------------ servidor e agenda
const servidor = http.createServer((req, res) => {
  tratar(req, res).catch(e => {
    const st = e && e.status || 500;
    if (st === 500) log('erro', req.method + ' ' + req.url + ': ' + (e && e.stack || e));
    if (!res.headersSent) json(res, st, {ok: false, error: String(e && e.message || e)});
    else res.end();
  });
});
servidor.on('error', e => pararComErro(e.code === 'EADDRINUSE'
  ? 'A porta ' + cfg.porta + ' já está em uso: o app já está aberto em outra janela? Feche-a ou troque "porta" no config.json.'
  : 'Servidor: ' + (e && e.stack || e)));
servidor.listen(cfg.porta, cfg.host, () => {
  log('info', 'J&T Rota Certa ' + VERSAO + ' no ar (base ' + cfg.nomeBase + ').');
  enderecos().forEach(a => log('info', '  Painel: ' + a));
  log('info', '  Configurações (AuthToken e tabela de rotas): http://localhost:' + cfg.porta + '/config');
  if (rotas.regras) log('info', 'Tabela de rotas: ' + rotas.regras.troncal.length + ' rotas da linha principal e ' + rotas.regras.secundaria.length + ' da secundária.');
  else log('aviso', rotas.erro);
  if (!credenciais().fonte) log('aviso', 'Falta o AuthToken do JMS: abra Configurações (ou cadastre no DashMaster deste computador).');
  if (process.env.ROTA_SEM_AGENDADOR === '1') return;
  log('info', 'Busca no JMS: hoje, a cada ' + cfg.minutos + ' min (viagens, remessas e 3 Segmentos). Deixe esta janela aberta.');
  const rodar = () => { if (credenciais().fonte && !coletor.estado.rodando) coletor.coletar().catch(() => {}); };
  setTimeout(rodar, 3000);
  setInterval(rodar, cfg.minutos * 60000);
});

function encerrar() { log('info', 'Encerrando…'); servidor.close(); banco.fechar(); process.exit(0); }
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
process.on('uncaughtException', e => log('erro', 'Erro inesperado: ' + (e && e.stack || e)));
process.on('unhandledRejection', e => log('erro', 'Erro inesperado: ' + (e && e.stack || e)));

module.exports = {VERSAO, servidor};
