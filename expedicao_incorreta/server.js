#!/usr/bin/env node
'use strict';
/**
 * J&T · EXPEDIÇÃO INCORRETA (app separado do DashMaster)
 * -------------------------------------------------------
 * Confere, quase em tempo real, se os pacotes bipados no carregamento de cada caminhão que SAI da base pertencem à rota do
 * caminhão (ex.: pacote do RJ dentro do caminhão para SP BRE). Dois painéis: Rota Troncal e Rota Secundária.
 *   - Busca no JMS (lib/coletor.js, lib/jms.js): viagens do dia (PDD de saída = a nossa base, fixo; Status Concluído ou
 *     Em Trânsito) → Bipe de carregamento da base → lista de pacotes. Hoje a cada "minutos"; ontem a cada "minutosDiaAnterior"
 *     (o dia anterior fica guardado completo). Os dias ficam no banco: o painel abre qualquer período já buscado.
 *   - Confere (lib/regras.js), só pelo JMS: "3 Segmentos" de cada remessa (Rastreamento do pacote) → planilha de rotas.
 *   - Painel (public/): período (data inicial e final), filtros Status e Base Destino (bases da tabela de rotas), erro do dia
 *     por turno comparado com o dia anterior, mais ofensores, gráficos e a tabela com tudo (turno e destino correto); Excel.
 *
 * Node.js 22.13 ou mais novo, sem instalar pacotes. Configuração: config.json (criado na primeira vez, ao lado deste arquivo).
 * Uso: node server.js — no Windows, por um atalho: "C:\dashmaster\node\node.exe" "C:\expedicao_incorreta\server.js"
 * Páginas: http://localhost:3300 (painéis) e http://localhost:3300/config (só neste computador).
 */
process.env.TZ = 'America/Sao_Paulo';

/** Erro que impede abrir. Pelo atalho do Windows a janela fecharia na hora: ali ela fica aberta (até o X ou 30 min). */
function pararComErro(msg) {
  console.error('[erro] ' + msg);
  if (process.platform === 'win32' && process.stdout.isTTY && !process.env.EXPEDICAO_SEM_PAUSA) {
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
const {Regras, lerRotas, TIPOS} = require('./lib/regras');
const {Coletor, hojeSp, somaDias, diasEntre, diasDaAgenda} = require('./lib/coletor');
const {STATUS, codigosStatus, statusDe} = require('./lib/status');
const {Painel} = require('./lib/painel');
const {escreverXlsx} = require('./lib/xlsx');

const VERSAO = require('./package.json').version;
const DEFAULTS = {
  porta: 3300,            // 3300: não briga com o DashMaster (3000), o sorter (3100) nem a pesquisa (3200)
  host: '0.0.0.0',        // 0.0.0.0 = abre para a rede; 127.0.0.1 = só neste computador
  senha: '',              // senha para abrir os painéis (vazio = sem senha)
  codigoBase: '30001',    // a nossa base (os caminhões que SAEM daqui)
  nomeBase: 'SP GRU',
  minutos: 10,            // de quanto em quanto tempo busca no JMS (dia de hoje)
  minutosDiaAnterior: 60, // de quanto em quanto tempo busca ontem de novo, para guardar o dia anterior completo (0 = não busca)
  status: {concluido: [4], emTransito: [3]}, // códigos do Status no JMS: Concluído：已完成 e Em Trânsito：在途
  consultasSegmentos: 3,   // "3 Segmentos" de cada pacote no JMS (Rastreamento do pacote): quantas consultas ao mesmo tempo
  consultasPorSegundo: 5,  // viagens e bipes: no máximo tantas consultas ao JMS por segundo, somando todas
  segundosPorRemessa: 30,  // "3 Segmentos" (Rastreamento do pacote): 1 remessa a cada tantos segundos (mais rápido o JMS bloqueia)
  tamanhoPagina: 100,     // pacotes por consulta ao JMS
  tamanhoPaginaViagens: 50,
  consultasAoMesmoTempo: 4,
  viagemGrande: 3000,     // viagem com mais pacotes que isto…
  minutosViagemGrande: 30, // …busca a lista de novo no máximo a cada 30 min
  dashmaster: '',         // pasta do DashMaster para usar o mesmo AuthToken (vazio = procura em C:\dashmaster; "nao" = não usar)
  linkPublico: ''         // link do Tailscale (só para aparecer na janela e em Configurações)
};
const MAX_CORPO = 25 * 1024 * 1024;
const MAX_DIAS = 31; // período máximo do painel

// ------------------------------------------------------------------ configuração
function arquivoConfig() { return process.env.EXPEDICAO_CONFIG ? path.resolve(process.env.EXPEDICAO_CONFIG) : path.join(__dirname, 'config.json'); }
function lerConfig() {
  const arq = arquivoConfig();
  let bruto = {};
  if (fs.existsSync(arq)) {
    try { bruto = JSON.parse(fs.readFileSync(arq, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { throw new Error('config.json inválido (' + e.message + '). Corrija o arquivo ou apague-o para recriar.'); }
  } else fs.writeFileSync(arq, JSON.stringify(DEFAULTS, null, 2) + '\n');
  const c = Object.assign({}, DEFAULTS, bruto);
  ['porta', 'minutos', 'tamanhoPagina', 'tamanhoPaginaViagens', 'consultasAoMesmoTempo', 'viagemGrande', 'minutosViagemGrande', 'consultasSegmentos',
    'consultasPorSegundo'].forEach(k => {
    c[k] = Number(c[k]) > 0 ? Number(c[k]) : DEFAULTS[k];
  });
  if (process.env.EXPEDICAO_PORTA) c.porta = Number(process.env.EXPEDICAO_PORTA);
  c.codigoBase = String(c.codigoBase).trim(); c.nomeBase = String(c.nomeBase).trim();
  c.minutos = Math.max(2, c.minutos);
  c.consultasSegmentos = Math.min(50, c.consultasSegmentos);
  c.segundosPorRemessa = bruto.segundosPorRemessa !== undefined && bruto.segundosPorRemessa !== '' && Number(bruto.segundosPorRemessa) >= 0
    ? Number(bruto.segundosPorRemessa) : DEFAULTS.segundosPorRemessa;
  c.minutosDiaAnterior = Number(c.minutosDiaAnterior) > 0 ? Math.max(c.minutos, Number(c.minutosDiaAnterior)) : 0;
  c.statusCodigos = codigosStatus(c.status);
  if (!c.statusCodigos.concluido.size && !c.statusCodigos.em_transito.size) throw new Error('"status" do config.json sem nenhum código.');
  const pasta = path.dirname(arq);
  c.dados = path.resolve(pasta, c.pastaDados || 'dados');
  c.planilhas = path.resolve(pasta, c.pastaPlanilhas || 'planilhas');
  return c;
}

let cfg;
try { cfg = lerConfig(); } catch (e) { pararComErro('Não consegui iniciar: ' + e.message); }

// ------------------------------------------------------------------ registro (janela + dados/expedicao.log)
const ULTIMAS = [];
function log(nivel, texto) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const linha = hojeSp(d) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' [' + nivel + '] ' + String(texto).replace(/\s+$/, '');
  (nivel === 'erro' ? console.error : console.log)(linha);
  ULTIMAS.push(linha);
  if (ULTIMAS.length > 200) ULTIMAS.shift();
  try {
    const arq = path.join(cfg.dados, 'expedicao.log');
    if (fs.existsSync(arq) && fs.statSync(arq).size > 5 * 1024 * 1024) fs.renameSync(arq, arq + '.1');
    fs.appendFileSync(arq, linha + '\n');
  } catch (e) { /* sem disco: só na janela */ }
}

// ------------------------------------------------------------------ AuthToken: o deste app ou o do DashMaster
/** O valor do AuthToken como a pessoa colou: tira "authtoken:", aspas, espaços e quebras de linha. */
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
  if (process.env.EXPEDICAO_DASHMASTER_DB) out.push(process.env.EXPEDICAO_DASHMASTER_DB);
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
/** Credenciais em uso: o AuthToken colado neste app; sem ele, o do DashMaster deste computador. */
function credenciais() {
  const proprio = banco.get('JMS_AUTHTOKEN');
  if (proprio) return {JMS_AUTHTOKEN: proprio, fonte: 'app'};
  const dm = credenciaisDashmaster();
  return dm ? Object.assign({fonte: 'dashmaster'}, dm) : {fonte: ''};
}

// ------------------------------------------------------------------ peças
let banco, regras, jms, coletor, painel;
try {
  banco = new Banco(path.join(cfg.dados, 'expedicao.db'));
  regras = new Regras(cfg.planilhas);
  jms = new Jms({base: process.env.EXPEDICAO_JMS_URL, credenciais, props: banco, log, tempoMs: 60000, porSegundo: cfg.consultasPorSegundo,
    segundosPorRemessa: cfg.segundosPorRemessa});
  painel = new Painel(banco, regras, cfg.statusCodigos);
  coletor = new Coletor({banco, jms, cfg, log, aoMudar: (tipo, dia) => painel.invalidar(tipo, dia)});
} catch (e) { pararComErro('Não consegui iniciar: ' + (e && e.stack || e)); }

// ------------------------------------------------------------------ acesso
/** Pedido que veio por túnel/proxy (Tailscale Funnel, Cloudflare…): não é "deste computador". */
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
function liberado(req) { return !cfg.senha || local(req) || cookies(req).exp_sessao === marcaSenha(); }

// ------------------------------------------------------------------ respostas
const TIPOS_ARQ = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml'};
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
function filtros(u) {
  const g = k => String(u.searchParams.get(k) || '').slice(0, 120);
  return {status: STATUS[g('status')] ? g('status') : '', turno: g('turno'), rota: g('rota'), destino: g('destino'), codigo: g('codigo'),
    login: g('login'), situacao: g('situacao'), viagem: g('viagem'), busca: g('busca')};
}
/** Período pedido: de/ate (ou dia). Até hoje, no máximo MAX_DIAS dias. → {de, ate} */
function periodo(de, ate, dia) {
  const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '';
  const hoje = hojeSp();
  let a = ok(de) || ok(dia) || hoje, b = ok(ate) || ok(dia) || a;
  if (a > b) [a, b] = [b, a];
  if (b > hoje) b = hoje;
  if (a > b) a = b;
  if (diasEntre(a, b).length > MAX_DIAS) a = somaDias(b, -(MAX_DIAS - 1));
  return {de: a, ate: b};
}
function periodoDe(u) { return periodo(u.searchParams.get('de'), u.searchParams.get('ate'), u.searchParams.get('dia')); }
function tipoDe(u) { const t = String(u.searchParams.get('tipo') || ''); return TIPOS.indexOf(t) >= 0 ? t : 'troncal'; }
/** Situação para o topo do painel (sem nada de credencial). */
function estadoPublico() {
  const e = coletor.estado, r = regras.resumo();
  return {versao: VERSAO, base: cfg.nomeBase, codigoBase: cfg.codigoBase, minutos: cfg.minutos, minutosDiaAnterior: cfg.minutosDiaAnterior,
    hoje: hojeSp(), maxDias: MAX_DIAS,
    busca: {rodando: e.rodando, etapa: e.etapa, dia: e.dia, dias: e.dias, inicio: e.inicio, fim: e.fim, ultimo: e.ultimo, authVencido: e.authVencido,
      errosViagens: e.erros.length, avisoSegmentos: e.avisoSegmentos, segundosPorRemessa: cfg.segundosPorRemessa},
    planilhas: {erros: r.erros, rotas: !!r.rotas}};
}

// ------------------------------------------------------------------ rotas HTTP
async function tratar(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  regras.atualizar();

  if (p === '/estilo.css' || p === '/painel.js' || p === '/config.js' || p === '/graficos.js') return arquivo(res, p.slice(1));
  if (p === '/entrar' && req.method === 'POST') {
    const corpo = (await lerCorpo(req, 4096)).toString('utf8'), senha = new URLSearchParams(corpo).get('senha') || '';
    if (cfg.senha && senha === cfg.senha) {
      return enviar(res, 303, '', 'text/plain', {Location: './troncal', 'Set-Cookie': 'exp_sessao=' + marcaSenha() + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'});
    }
    return arquivo(res, 'entrar.html');
  }

  // Configurações: só neste computador.
  if (p === '/config' || p.startsWith('/config/')) {
    if (!local(req)) return enviar(res, 403, 'A tela Configurações só abre no computador do app (http://localhost:' + cfg.porta + '/config).');
    return tratarConfig(req, res, u);
  }
  if (!liberado(req)) {
    if (p.startsWith('/api/')) return json(res, 401, {ok: false, senha: true, error: 'Digite a senha do painel.'});
    return arquivo(res, 'entrar.html');
  }
  if (p === '/' ) return enviar(res, 302, '', 'text/plain', {Location: './troncal'});
  if (p === '/troncal' || p === '/secundaria') return arquivo(res, 'painel.html');
  if (p === '/api/estado') return json(res, 200, estadoPublico());
  if (p === '/api/painel') {
    const {de, ate} = periodoDe(u), f = filtros(u);
    return json(res, 200, Object.assign(painel.resumo(tipoDe(u), de, ate, f), {estado: estadoPublico(),
      menu: {troncal: painel.errados('troncal', de, ate, f.status), secundaria: painel.errados('secundaria', de, ate, f.status)}}));
  }
  if (p === '/api/tabela') {
    const {de, ate} = periodoDe(u);
    return json(res, 200, painel.tabela(tipoDe(u), de, ate, filtros(u), u.searchParams.get('pagina'), u.searchParams.get('tamanho'),
      u.searchParams.get('ordem'), u.searchParams.get('direcao')));
  }
  if (p === '/api/excel') {
    const tipo = tipoDe(u), {de, ate} = periodoDe(u), linhas = painel.planilha(tipo, de, ate, filtros(u));
    const nome = 'expedicao_' + (tipo === 'troncal' ? 'troncal' : 'secundaria') + '_' + de + (ate !== de ? '_a_' + ate : '') + '.xlsx';
    return enviar(res, 200, escreverXlsx([{nome: tipo === 'troncal' ? 'Rota troncal' : 'Rota secundária', linhas,
      larguras: [7, 22, 20, 26, 18, 30, 18, 18, 18, 18, 20, 20, 12, 14, 10, 20, 30, 20]}]),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {'Content-Disposition': 'attachment; filename="' + nome + '"'});
  }
  if (p === '/api/buscar' && req.method === 'POST') {
    // Hoje e ontem sempre; os outros dias do período só se ainda não foram buscados ou têm pacote sem o "3 Segmentos".
    const b = await lerJson(req), {de, ate} = periodo(b.de, b.ate, b.dia), ontem = somaDias(hojeSp(), -1), buscados = banco.buscados(de, ate);
    const dias = diasEntre(de, ate).filter(d => d >= ontem || !buscados.has(d));
    // Pacotes sem o "3 Segmentos" no período: a busca consulta (do dia mais novo para o mais antigo).
    const segmentos = diasEntre(de, ate).some(d => { const c = banco.contarSegmentos(d); return c.total > c.feitos; });
    if (dias.length || segmentos) coletor.coletar(dias).catch(() => {});
    return json(res, 200, {ok: true, dias, segmentos, estado: estadoPublico()});
  }
  return enviar(res, 404, 'Não encontrado.');
}

async function tratarConfig(req, res, u) {
  const p = u.pathname;
  if (p === '/config') return arquivo(res, 'config.html');
  if (p === '/config/api/estado') {
    const c = credenciais(), r = regras.resumo();
    return json(res, 200, {versao: VERSAO, config: Object.assign({}, cfg, {senha: cfg.senha ? 'definida' : '', statusCodigos: undefined}), enderecos: enderecos(),
      token: {fonte: c.fonte, temProprio: !!banco.get('JMS_AUTHTOKEN'), dashmaster: !!credenciaisDashmaster()},
      planilhas: r, busca: coletor.estado, registro: ULTIMAS.slice(-60), hoje: hojeSp(), salvos: banco.diasSalvos(),
      segmentosHoje: banco.contarSegmentos(hojeSp()),
      status: {concluido: Array.from(cfg.statusCodigos.concluido), emTransito: Array.from(cfg.statusCodigos.em_transito)},
      viagensHoje: TIPOS.map(t => ({tipo: t, status: banco.statusDia(t, hojeSp()).map(x => ({estado: x.estado, n: x.n, status: statusDe(x.estado, cfg.statusCodigos)}))})),
      jms: {pacotesSecundaria: banco.get('PACOTES_SECUNDARIA') || '', routeTroncal: banco.get('ROUTE_AUTO_TRONCAL') || '',
        routeSecundaria: banco.get('ROUTE_AUTO_SECUNDARIA') || ''}});
  }
  if (req.method !== 'POST' && p !== '/config/api/rotas.xlsx') return enviar(res, 405, 'Use POST.');
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
  if (p === '/config/api/buscar') {
    const b = await lerJson(req), dia = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dia || '')) ? b.dia : hojeSp();
    if (dia > hojeSp()) return json(res, 400, {ok: false, error: 'Esse dia ainda não chegou.'});
    if (coletor.estado.rodando) return json(res, 200, {ok: false, error: 'Já está buscando. Espere terminar.'});
    coletor.coletar(dia, {forcar: !!b.forcar}).catch(() => {});
    return json(res, 200, {ok: true});
  }
  if (p === '/config/api/planilha') {
    const nome = u.searchParams.get('nome'), buf = await lerCorpo(req);
    try {
      if (nome === 'rotas') { lerRotas(buf); fs.writeFileSync(regras.arquivoRotas(), buf); }
      else return json(res, 400, {ok: false, error: 'Planilha desconhecida.'});
    } catch (e) { return json(res, 400, {ok: false, error: 'Não usei o arquivo: ' + e.message}); }
    regras.atualizar(true);
    painel.invalidar();
    log('info', 'Planilha de rotas trocada pela tela Configurações.');
    return json(res, 200, {ok: true, planilhas: regras.resumo()});
  }
  if (p === '/config/api/rotas.xlsx') {
    return enviar(res, 200, fs.readFileSync(regras.arquivoRotas()), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      {'Content-Disposition': 'attachment; filename="rotas.xlsx"'});
  }
  return enviar(res, 404, 'Não encontrado.');
}

/** Teste rápido: uma página de viagens de cada rota. */
async function testar() {
  const out = {ok: true, linhas: []};
  for (const tipo of TIPOS) {
    try {
      const r = await jms.viagens(tipo, hojeSp(), cfg.codigoBase, 1, 5);
      out.linhas.push((tipo === 'troncal' ? 'Rota troncal' : 'Rota secundária') + ': ok, o JMS respondeu (' + r.total + ' viagens hoje na consulta de ' + cfg.nomeBase + ').');
    } catch (e) {
      out.ok = false;
      out.linhas.push((tipo === 'troncal' ? 'Rota troncal' : 'Rota secundária') + ': ' + e.message);
      if (e.auth) { coletor.estado.authVencido = true; break; }
    }
  }
  return out;
}
function enderecos() {
  const lista = ['http://localhost:' + cfg.porta];
  if (cfg.host === '0.0.0.0' || cfg.host === '::') {
    Object.values(os.networkInterfaces()).forEach(l => (l || []).forEach(a => {
      if (a.family === 'IPv4' && !a.internal) lista.push('http://' + a.address + ':' + cfg.porta);
    }));
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
  log('info', 'J&T Expedição Incorreta ' + VERSAO + ' no ar (base ' + cfg.nomeBase + ').');
  enderecos().forEach(a => log('info', '  Painéis: ' + a));
  log('info', '  Configurações (AuthToken e planilhas): http://localhost:' + cfg.porta + '/config');
  const r = regras.resumo();
  r.erros.forEach(m => log('aviso', m));
  if (r.rotas) log('info', 'Planilha de rotas: ' + r.rotas.troncal + ' rotas troncais e ' + r.rotas.secundaria + ' secundárias.');
  if (!credenciais().fonte) log('aviso', 'Falta o AuthToken do JMS: abra Configurações (ou cadastre no DashMaster deste computador).');
  if (process.env.EXPEDICAO_SEM_AGENDADOR === '1') return;
  log('info', 'Busca no JMS: hoje a cada ' + cfg.minutos + ' min' + (cfg.minutosDiaAnterior ? '; ontem a cada ' + cfg.minutosDiaAnterior +
    ' min (guarda o dia anterior completo)' : '') + '. Deixe esta janela aberta.');
  // Com AuthToken vencido tenta do mesmo jeito (uma consulta): volta sozinho quando o token for trocado aqui ou no DashMaster.
  const agenda = {ontem: '', ontemEm: 0};
  const rodar = () => {
    if (!credenciais().fonte || coletor.estado.rodando) return;
    const dias = diasDaAgenda(agenda, Date.now(), cfg.minutosDiaAnterior);
    coletor.coletar(dias).then(u => { if (u.ok && dias.length > 1) Object.assign(agenda, {ontem: dias[0], ontemEm: Date.now()}); }).catch(() => {});
  };
  setTimeout(rodar, 3000);
  setInterval(rodar, cfg.minutos * 60000);
});

function encerrar() { log('info', 'Encerrando…'); servidor.close(); banco.fechar(); process.exit(0); }
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
process.on('uncaughtException', e => log('erro', 'Erro inesperado: ' + (e && e.stack || e)));
process.on('unhandledRejection', e => log('erro', 'Erro inesperado: ' + (e && e.stack || e)));

module.exports = {VERSAO, servidor};
