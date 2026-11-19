#!/usr/bin/env node
'use strict';
/**
 * J&T · EXPEDIÇÃO INCORRETA (app separado do DashMaster)
 * -------------------------------------------------------
 * Confere se os pacotes carregados num caminhão pertencem à rota dele (ex.: pacote do RJ dentro do caminhão para SP BRE).
 *   - 3.0 (página principal, /conferir): a pessoa cola as remessas do ID (ou envia a planilha) e escolhe a rota; o app consulta o
 *     "3 Segmentos" de cada remessa na Gestão de pedido JMS de remessa (1.000 por consulta) e mostra cartões, gráficos, a tabela e a
 *     planilha só com os erros (lib/conferencia.js). Não busca viagens no JMS.
 * Busca por viagem (anterior), nos painéis Rota Troncal e Rota Secundária:
 *   - 2.1: pesquisa de rota. Busca no JMS (lib/coletor.js, lib/jms.js) só as viagens da rota pesquisada no período (PDD de
 *     saída = a nossa base, fixo; Status Concluído ou Em Trânsito) → Bipe de carregamento da base → lista de pacotes →
 *     "3 Segmentos" só desses pacotes. A rota pesquisada atualiza sozinha (hoje, a cada "minutos") por "horasPesquisa" horas;
 *     sem rota pesquisada, nada vai ao JMS. Os dias ficam guardados no banco.
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
const {Jms, lerModeloGestao} = require('./lib/jms');
const {Regras, lerRotas, TIPOS, norm, tokens} = require('./lib/regras');
const {Coletor, hojeSp, somaDias, diasEntre} = require('./lib/coletor');
const {STATUS, codigosStatus, statusDe} = require('./lib/status');
const {Painel} = require('./lib/painel');
const {escreverXlsx} = require('./lib/xlsx');
const {Conferencias, lerRemessas, MAX_REMESSAS} = require('./lib/conferencia');

const VERSAO = require('./package.json').version;
const DEFAULTS = {
  porta: 3300,            // 3300: não briga com o DashMaster (3000), o sorter (3100) nem a pesquisa (3200)
  host: '0.0.0.0',        // 0.0.0.0 = abre para a rede; 127.0.0.1 = só neste computador
  senha: '',              // senha para abrir os painéis (vazio = sem senha)
  codigoBase: '30001',    // a nossa base (os caminhões que SAEM daqui)
  nomeBase: 'SP GRU',
  minutos: 15,            // de quanto em quanto tempo busca no JMS (dia de hoje) · 2.0: 15 (pedido)
  status: {concluido: [4], emTransito: [3]}, // códigos do Status no JMS: Concluído：已完成 e Em Trânsito：在途
  fonteSegmentos: 'gestao', // 2.0: "3 Segmentos" pela Gestão de pedido JMS de remessa (várias por consulta); 'rastreio' = só o Rastreamento
  remessasPorConsulta: 1000, // Gestão de pedido: remessas em cada consulta · 2.3: 1.000, o limite do JMS (pedido)
  segundosEntreLotes: 2,    // Gestão de pedido: pausa entre uma consulta e a próxima
  consultasSegmentos: 3,   // "3 Segmentos" de cada pacote no JMS (Rastreamento do pacote): quantas consultas ao mesmo tempo
  consultasPorSegundo: 5,  // viagens e bipes: no máximo tantas consultas ao JMS por segundo, somando todas
  segundosPorRemessa: 30,  // "3 Segmentos" (Rastreamento do pacote): uma remessa por vez; espera a resposta e pausa tantos segundos
  tamanhoPagina: 100,     // pacotes por consulta ao JMS
  tamanhoPaginaViagens: 50,
  consultasAoMesmoTempo: 4,
  viagemGrande: 3000,     // viagem com mais pacotes que isto…
  minutosViagemGrande: 30, // …busca a lista de novo no máximo a cada 30 min
  dashmaster: '',         // pasta do DashMaster para usar o mesmo AuthToken (vazio = procura em C:\dashmaster; "nao" = não usar)
  linkPublico: '',        // link do Tailscale (só para aparecer na janela e em Configurações)
  caminho: '/expedicao',  // 2.0.2: caminho no link principal do Tailscale (https://NOME.ts.net/expedicao), sem ocupar porta de outro painel
  horasPesquisa: 12       // 2.1: a rota pesquisada continua atualizando sozinha (hoje, a cada "minutos") por tantas horas depois da pesquisa
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
  delete c.minutosDiaAnterior; // até a 1.8 buscava ontem de novo; agora a busca é só hoje
  ['porta', 'minutos', 'tamanhoPagina', 'tamanhoPaginaViagens', 'consultasAoMesmoTempo', 'viagemGrande', 'minutosViagemGrande', 'consultasSegmentos',
    'consultasPorSegundo', 'horasPesquisa'].forEach(k => {
    c[k] = Number(c[k]) > 0 ? Number(c[k]) : DEFAULTS[k];
  });
  if (process.env.EXPEDICAO_PORTA) c.porta = Number(process.env.EXPEDICAO_PORTA);
  c.codigoBase = String(c.codigoBase).trim(); c.nomeBase = String(c.nomeBase).trim();
  c.minutos = Math.max(2, c.minutos);
  // Padrões antigos gravados no config.json: 2.0 (pedido "atualiza a cada 15 minutos") minutos 10 → 15; 2.3 (pedido "pesquisar
  // em 1000, o JMS só permite esse limite") remessasPorConsulta 100 → 1000.
  const novo = {}, versao = Number(bruto.versaoConfig) || 0;
  if (Number(bruto.minutos) === 10 && !versao) c.minutos = novo.minutos = 15;
  if (Number(bruto.remessasPorConsulta) === 100 && versao < 3) bruto.remessasPorConsulta = novo.remessasPorConsulta = 1000;
  if (Object.keys(novo).length) {
    try { fs.writeFileSync(arq, JSON.stringify(Object.assign({}, bruto, novo, {versaoConfig: 3}), null, 2) + '\n'); } catch (e) { /* só leitura */ }
  }
  c.fonteSegmentos = String(c.fonteSegmentos || 'gestao').toLowerCase() === 'rastreio' ? 'rastreio' : 'gestao';
  c.remessasPorConsulta = Number(bruto.remessasPorConsulta) > 0 ? Math.min(1000, Math.floor(Number(bruto.remessasPorConsulta))) : DEFAULTS.remessasPorConsulta;
  c.segundosEntreLotes = bruto.segundosEntreLotes !== undefined && bruto.segundosEntreLotes !== '' && Number(bruto.segundosEntreLotes) >= 0
    ? Number(bruto.segundosEntreLotes) : DEFAULTS.segundosEntreLotes;
  c.consultasSegmentos = Math.min(50, c.consultasSegmentos);
  c.segundosPorRemessa = bruto.segundosPorRemessa !== undefined && bruto.segundosPorRemessa !== '' && Number(bruto.segundosPorRemessa) >= 0
    ? Number(bruto.segundosPorRemessa) : DEFAULTS.segundosPorRemessa;
  // "/expedicao", "expedicao", "/expedicao/" → "/expedicao"; só letras, números, - e _ ("" = sem caminho).
  const cam = String(c.caminho === undefined || c.caminho === null ? DEFAULTS.caminho : c.caminho).trim().replace(/^\/+|\/+$/g, '');
  c.caminho = /^[A-Za-z0-9_-]+$/.test(cam) ? '/' + cam : '';
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
let banco, regras, jms, coletor, painel, conferencias;
try {
  banco = new Banco(path.join(cfg.dados, 'expedicao.db'));
  regras = new Regras(cfg.planilhas);
  jms = new Jms({base: process.env.EXPEDICAO_JMS_URL, credenciais, props: banco, log, tempoMs: 60000, porSegundo: cfg.consultasPorSegundo,
    segundosPorRemessa: cfg.segundosPorRemessa});
  // 2.3: limite por consulta aprendido com os lotes antigos (até 500) volta a ser descoberto com os de 1.000 (uma vez).
  if (banco.get('GESTAO_TAMANHO_23') !== '1') { banco.set('GESTAO_TAMANHO', null); banco.set('GESTAO_TAMANHO_23', '1'); }
  painel = new Painel(banco, regras, cfg.statusCodigos);
  coletor = new Coletor({banco, jms, cfg, log, regras, aoMudar: (tipo, dia) => painel.invalidar(tipo, dia)});
  conferencias = new Conferencias({banco, jms, regras, cfg, log});
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
async function lerJson(req, limite) {
  const b = (await lerCorpo(req, limite || 1024 * 1024)).toString('utf8');
  try { return b ? JSON.parse(b) : {}; } catch (e) { throw Object.assign(new Error('Pedido inválido.'), {status: 400}); }
}
function filtros(u) {
  const g = k => String(u.searchParams.get(k) || '').slice(0, 120);
  return {status: STATUS[g('status')] ? g('status') : '', turno: g('turno'), rota: g('rota'), destino: g('destino'), codigo: g('codigo'),
    login: g('login'), situacao: g('situacao'), viagem: g('viagem'), busca: g('busca'), pesquisa: g('pesquisa')};
}
// ------------------------------------------------------------------ 2.1: pesquisa de rota
/** Rota da planilha de rotas pelo nome digitado (igual; senão a parecida, ex.: "BRE" → "SP BRE"). → nome da planilha | '' */
function acharRota(texto) {
  const n = norm(String(texto || '').slice(0, 120));
  if (!n || !regras.rotas) return '';
  const todas = [];
  TIPOS.forEach(t => regras.rotas.regras[t].forEach(r => todas.push(r)));
  const igual = todas.find(r => r.rotaNorm === n);
  if (igual) return igual.rota;
  // Parecida só quando não há dúvida (uma rota só com todas as palavras digitadas).
  const tk = tokens(n), achadas = new Set(todas.filter(r => tk.every(t => r.tokens.indexOf(t) >= 0)).map(r => r.rotaNorm));
  return achadas.size === 1 ? todas.find(r => achadas.has(r.rotaNorm)).rota : '';
}
/** Rotas da planilha (troncal e secundária), para a lista da pesquisa. */
function rotasDaPlanilha() {
  if (!regras.rotas) return [];
  const m = new Map();
  TIPOS.forEach(t => regras.rotas.regras[t].forEach(r => { if (!m.has(r.rotaNorm)) m.set(r.rotaNorm, r.rota); }));
  return Array.from(m.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
/**
 * 2.2.1 (pedido "o destino tem que seguir a tabela da nossa rota"): os destinos de cada tabela (troncal e secundária) na ordem
 * da planilha de rotas, com a doca da observação ("Doca 19", "Docas 21 e 22"). → [{rota, tipo, doca}]
 */
function tabelaDeRotas() {
  if (!regras.rotas) return [];
  const out = [];
  TIPOS.forEach(t => regras.rotas.regras[t].forEach(r => {
    const m = /Docas?\s+\d+(?:\s*(?:e|,|a)\s*\d+)*/i.exec(r.obs || '');
    out.push({rota: r.rota, tipo: t, doca: m ? m[0].replace(/\s+/g, ' ') : ''});
  }));
  return out;
}
/** 2.2: em qual tabela está cada rota ({nome: ['troncal', 'secundaria']}), para a lista de destinos ao digitar. */
function tiposDasRotas() {
  const out = {};
  if (!regras.rotas) return out;
  const nome = new Map();
  TIPOS.forEach(t => regras.rotas.regras[t].forEach(r => {
    if (!nome.has(r.rotaNorm)) nome.set(r.rotaNorm, r.rota);
    const n = nome.get(r.rotaNorm);
    (out[n] = out[n] || []).indexOf(t) < 0 && out[n].push(t);
  }));
  return out;
}
/** Rotas pesquisadas nas últimas "horasPesquisa" horas (a busca automática atualiza só elas, no dia de hoje). → [nome] */
function rotasAcompanhadas() {
  let o = {};
  try { o = JSON.parse(banco.get('ROTAS_PESQUISADAS') || '{}') || {}; } catch (e) { o = {}; }
  const limite = Date.now() - cfg.horasPesquisa * 3600000;
  return Object.keys(o).filter(k => o[k] >= limite && acharRota(k)).sort((a, b) => o[b] - o[a]).slice(0, 20);
}
function acompanharRota(rota) {
  let o = {};
  try { o = JSON.parse(banco.get('ROTAS_PESQUISADAS') || '{}') || {}; } catch (e) { o = {}; }
  o[rota] = Date.now();
  const limite = Date.now() - cfg.horasPesquisa * 3600000;
  Object.keys(o).forEach(k => { if (o[k] < limite) delete o[k]; });
  banco.set('ROTAS_PESQUISADAS', JSON.stringify(o));
}
/**
 * Pesquisa de rota: busca no JMS as viagens dessa rota no período (e no período anterior, para comparar, até 7 dias), os pacotes
 * delas e o "3 Segmentos" só desses pacotes. Os dias mais novos primeiro. → resposta para o painel
 */
function pesquisarRota(b) {
  const rota = acharRota(b.rota);
  if (!rota) return {status: 400, corpo: {ok: false, error: String(b.rota || '').trim() ? 'A rota "' + String(b.rota).trim().slice(0, 60) +
    '" não está na planilha de rotas. Escolha uma da lista.' : 'Digite a rota que você quer pesquisar.'}};
  const {de, ate} = periodo(b.de, b.ate, b.dia), dias = diasEntre(de, ate).reverse(), n = dias.length;
  const anteriores = n <= 7 ? diasEntre(somaDias(de, -n), somaDias(de, -1)).reverse() : [];
  acompanharRota(rota);
  log('info', 'Pesquisa da rota ' + rota + ': ' + (n === 1 ? de : de + ' a ' + ate) + (anteriores.length ? ' (e ' + anteriores.length +
    (anteriores.length === 1 ? ' dia anterior' : ' dias anteriores') + ' para comparar)' : '') + '.');
  coletor.coletar(dias.concat(anteriores), {rotas: [rota], forcar: !!b.forcar}).catch(() => {});
  return {status: 200, corpo: {ok: true, rota, de, ate, dias, anteriores, estado: estadoPublico()}};
}
// ------------------------------------------------------------------ 3.0: conferência de remessas
/** Tabela da rota (troncal ou secundária): a 1ª da planilha de rotas que tem a rota. */
function tipoDaRota(rota) { return (tiposDasRotas()[rota] || ['troncal'])[0]; }
/** Nova conferência: remessas coladas ou planilha (base64) + rota. → resposta para a página */
function novaConferencia(b) {
  const rota = acharRota(b.rota);
  if (!rota) return {status: 400, corpo: {ok: false, campo: 'rota', error: String(b.rota || '').trim() ? 'A rota "' + String(b.rota).trim().slice(0, 60) +
    '" não está na planilha de rotas. Escolha uma da lista.' : 'Escolha a rota do caminhão.'}};
  let lido;
  try {
    lido = lerRemessas({texto: typeof b.texto === 'string' ? b.texto : '', arquivo: b.arquivo ? Buffer.from(String(b.arquivo), 'base64') : null, viagem: b.viagem});
  } catch (e) { return {status: 400, corpo: {ok: false, campo: 'remessas', error: 'Não consegui ler a planilha: ' + (e && e.message || e)}}; }
  if (!lido.itens.length) {
    return {status: 400, corpo: {ok: false, campo: 'remessas', error: lido.cientificas ? lido.cientificas + ' remessas vieram como 8,88E+14 (o Excel cortou os números). ' +
      'Formate a coluna como Texto ou copie e cole as remessas.' : 'Nenhuma remessa encontrada. Cole as remessas do ID (uma por linha) ou envie a planilha.'}};
  }
  if (lido.itens.length > MAX_REMESSAS) {
    return {status: 400, corpo: {ok: false, campo: 'remessas', error: 'São ' + lido.itens.length + ' remessas: o máximo numa conferência é ' + MAX_REMESSAS + '. Divida em partes.'}};
  }
  const nome = String(b.nomeArquivo || '').replace(/[\u0000-\u001f]/g, '').slice(0, 80);
  const id = conferencias.criar({rota, tipo: tipoDaRota(rota), viagem: b.viagem, lido, origem: b.arquivo ? 'Planilha ' + (nome || 'enviada') : 'Remessas coladas'});
  return {status: 200, corpo: {ok: true, id, rota, total: lido.itens.length, repetidas: lido.repetidas, ignoradas: lido.ignoradas + lido.cientificas, colunas: lido.colunas}};
}
function idConferencia(u) { return Number(u.searchParams.get('id')) || banco.ultimaConferencia(); }
/** Nome de arquivo seguro: "F S-PENHA 03-SP" → "F_S-PENHA_03-SP". */
const nomeArq = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

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
  return {versao: VERSAO, base: cfg.nomeBase, codigoBase: cfg.codigoBase, minutos: cfg.minutos,
    hoje: hojeSp(), maxDias: MAX_DIAS, horasPesquisa: cfg.horasPesquisa, acompanhadas: rotasAcompanhadas(),
    busca: {rodando: e.rodando, etapa: e.etapa, dia: e.dia, dias: e.dias, inicio: e.inicio, fim: e.fim, ultimo: e.ultimo, authVencido: e.authVencido,
      errosViagens: e.erros.length, avisoSegmentos: e.avisoSegmentos, segundosPorRemessa: cfg.segundosPorRemessa, pesquisa: e.pesquisa,
      porConsulta: cfg.fonteSegmentos === 'gestao' ? Number(banco.get('GESTAO_TAMANHO')) || cfg.remessasPorConsulta : 0,
      fila: coletor.fila.length},
    planilhas: {erros: r.erros, rotas: !!r.rotas}};
}

// ------------------------------------------------------------------ rotas HTTP
async function tratar(req, res) {
  let u = new URL(req.url, 'http://x');
  // 2.0.2: o link do Tailscale fica num caminho do link principal (https://NOME.ts.net/expedicao → http://127.0.0.1:3300/expedicao).
  // O app atende com e sem o caminho; a página usa endereços relativos, que continuam dentro dele.
  if (cfg.caminho) {
    if (u.pathname === cfg.caminho) return enviar(res, 301, '', 'text/plain', {Location: cfg.caminho + '/' + u.search});
    if (u.pathname.indexOf(cfg.caminho + '/') === 0) u = new URL(u.pathname.slice(cfg.caminho.length) + u.search, 'http://x');
  }
  const p = u.pathname;
  regras.atualizar();

  if (p === '/estilo.css' || p === '/painel.js' || p === '/config.js' || p === '/graficos.js' || p === '/conferir.js') return arquivo(res, p.slice(1));
  if (p === '/entrar' && req.method === 'POST') {
    const corpo = (await lerCorpo(req, 4096)).toString('utf8'), senha = new URLSearchParams(corpo).get('senha') || '';
    if (cfg.senha && senha === cfg.senha) {
      return enviar(res, 303, '', 'text/plain', {Location: './conferir', 'Set-Cookie': 'exp_sessao=' + marcaSenha() + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'});
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
  if (p === '/') return enviar(res, 302, '', 'text/plain', {Location: './conferir'});
  if (p === '/conferir') return arquivo(res, 'conferir.html');
  if (p === '/troncal' || p === '/secundaria') return arquivo(res, 'painel.html');
  // 3.0: conferência das remessas coladas (ou da planilha) contra a rota.
  if (p === '/api/conferir' && req.method === 'POST') {
    const r = novaConferencia(await lerJson(req, 40 * 1024 * 1024));
    return json(res, r.status, r.corpo);
  }
  if (p === '/api/conferir/repetir' && req.method === 'POST') {
    const b = await lerJson(req), id = Number(b.id) || 0;
    if (!banco.conferencia(id)) return json(res, 404, {ok: false, error: 'Conferência não encontrada.'});
    conferencias.iniciar(id);
    return json(res, 200, {ok: true, id, andamento: conferencias.estado(id)});
  }
  if (p === '/api/conferencia') {
    const id = idConferencia(u), r = id ? conferencias.resumo(id) : null;
    return json(res, 200, {ok: true, app: {versao: VERSAO, base: cfg.nomeBase, porConsulta: Number(banco.get('GESTAO_TAMANHO')) || cfg.remessasPorConsulta,
      token: !!credenciais().fonte}, conferencia: r, recentes: conferencias.lista(12)});
  }
  if (p === '/api/conferencia/estado') {
    const id = idConferencia(u);
    return json(res, 200, {ok: true, andamento: id ? conferencias.estado(id) : null});
  }
  if (p === '/api/conferencia/tabela') {
    const g = k => String(u.searchParams.get(k) || '').slice(0, 120), t = conferencias.tabela(idConferencia(u), {situacao: g('situacao'), busca: g('busca')},
      g('pagina'), g('tamanho'), g('ordem'), g('direcao'));
    return t ? json(res, 200, t) : json(res, 404, {ok: false, error: 'Conferência não encontrada.'});
  }
  if (p === '/api/conferencia/erros.xlsx') {
    const id = idConferencia(u), c = banco.conferencia(id), aba = id ? conferencias.planilhaErros(id) : null;
    if (!aba) return enviar(res, 404, 'Conferência não encontrada.');
    const nome = 'erros_' + nomeArq(c.rota) + (c.viagem ? '_' + nomeArq(c.viagem) : '') + '_' + hojeSp(new Date(c.em)) + '.xlsx';
    return enviar(res, 200, escreverXlsx([aba]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {'Content-Disposition': 'attachment; filename="' + nome + '"'});
  }
  if (p === '/api/estado') return json(res, 200, estadoPublico());
  if (p === '/api/painel') {
    const {de, ate} = periodoDe(u), f = filtros(u);
    f.pesquisa = f.pesquisa ? acharRota(f.pesquisa) || f.pesquisa : '';
    const extra = {estado: estadoPublico(), pesquisa: f.pesquisa, rotasPesquisa: rotasDaPlanilha(), rotasTipos: tiposDasRotas(), rotasTabela: tabelaDeRotas(),
      menu: {troncal: painel.errados('troncal', de, ate, f.status, f.pesquisa), secundaria: painel.errados('secundaria', de, ate, f.status, f.pesquisa)}};
    if (f.pesquisa) extra.viagensPorTipo = {troncal: painel.viagensDaRota('troncal', de, ate, f.pesquisa), secundaria: painel.viagensDaRota('secundaria', de, ate, f.pesquisa)};
    return json(res, 200, Object.assign(painel.resumo(tipoDe(u), de, ate, f), extra));
  }
  if (p === '/api/rotas') return json(res, 200, {rotas: rotasDaPlanilha(), tipos: tiposDasRotas(), tabela: tabelaDeRotas(), acompanhadas: rotasAcompanhadas()});
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
  if ((p === '/api/pesquisar' || p === '/api/buscar') && req.method === 'POST') {
    // 2.1: Pesquisar (e Atualizar) = busca no JMS só a rota pesquisada, no período do painel.
    const r = pesquisarRota(await lerJson(req));
    return json(res, r.status, r.corpo);
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
      planilhas: r, busca: coletor.estado, registro: ULTIMAS.slice(-60), hoje: hojeSp(), salvos: banco.diasSalvos(), acompanhadas: rotasAcompanhadas(),
      rotasPesquisa: rotasDaPlanilha(),
      segmentosHoje: Object.assign(banco.contarSegmentos(hojeSp()), {semCodigo: banco.semCodigoDia(hojeSp()), erros: banco.errosSegmentos(hojeSp())}),
      status: {concluido: Array.from(cfg.statusCodigos.concluido), emTransito: Array.from(cfg.statusCodigos.em_transito)},
      viagensHoje: TIPOS.map(t => ({tipo: t, status: banco.statusDia(t, hojeSp()).map(x => ({estado: x.estado, n: x.n, status: statusDe(x.estado, cfg.statusCodigos)}))})),
      jms: {gestao: {fonte: cfg.fonteSegmentos, pedido: banco.get('GESTAO_VARIANTE') || '', porConsulta: Number(banco.get('GESTAO_TAMANHO')) || cfg.remessasPorConsulta,
          modelo: resumoModelo(jms.modeloGestao()), separador: banco.get('GESTAO_MODELO_SEP') || '',
          reservaAte: coletor.gestaoFora && coletor.gestaoFora > Date.now() ? coletor.gestaoFora : 0},
        pacotesSecundaria: banco.get('PACOTES_SECUNDARIA') || '', routeTroncal: banco.get('ROUTE_AUTO_TRONCAL') || '',
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
  // 3.0.1: o pedido da tela da Gestão de pedido (Payload do F12), usado como modelo nas consultas.
  if (p === '/config/api/gestao-modelo') {
    const b = await lerJson(req, 256 * 1024);
    let m;
    try { m = lerModeloGestao(b.texto); } catch (e) { return json(res, 400, {ok: false, error: e.message}); }
    banco.set('GESTAO_MODELO', JSON.stringify(m)); banco.set('GESTAO_MODELO_SEP', null); banco.set('GESTAO_TAMANHO', null);
    coletor.gestaoFora = 0;
    const r = resumoModelo(m), linhas = ['Pedido guardado: remessas no campo "' + r.campo + '" (' + (r.lista ? 'lista' : 'texto') + ')' +
      (r.pagina ? ', página em "' + r.pagina + '"' : '') + (r.tamanho ? ', tamanho em "' + r.tamanho + '"' : '') +
      (r.datas.length ? ', datas ' + r.datas.join(' e ') + ' (o app leva o período para hoje)' : '') + '.'];
    log('info', 'Gestão de pedido: pedido da tela guardado (' + linhas[0] + ')');
    // Teste: a remessa do pedido copiado e, para conferir o separador, mais uma guardada.
    const outra = banco.umaRemessa(), ws = [m.exemplo].concat(outra && outra !== m.exemplo ? [outra] : []);
    let ok = false;
    try {
      jms.novaRodada();
      const t = await jms.segmentosLote(ws), sg = t.achados.get(m.exemplo);
      ok = !!sg;
      linhas.push(sg ? 'Teste: o JMS devolveu a remessa ' + m.exemplo + ' com o 3 Segmentos ' + ([sg.s1, sg.s2, sg.s3].filter(Boolean).join(',') || '(vazio)') +
        (sg.ultimaOperacao ? ' · última operação ' + sg.ultimaOperacao : '') + '. Pronto: clique em Conferir de novo na conferência.'
        : 'Teste: o JMS respondeu, mas sem a remessa ' + m.exemplo + '. Confira se o período do pedido inclui a data dela.');
    } catch (e) { linhas.push('Teste: ' + (e && e.message || e)); }
    return json(res, 200, {ok, linhas});
  }
  if (p === '/config/api/gestao-modelo/apagar') {
    banco.set('GESTAO_MODELO', null); banco.set('GESTAO_MODELO_SEP', null);
    log('info', 'Gestão de pedido: pedido da tela apagado (o app volta a procurar o formato sozinho).');
    return json(res, 200, {ok: true});
  }
  if (p === '/config/api/testar-segmentos') {
    // Uma remessa (a digitada ou a mais recente guardada) no Rastreamento do pacote: o que o JMS responde.
    const b = await lerJson(req), digitada = String(b.remessa || '').trim().toUpperCase();
    if (digitada && !/^[A-Z0-9-]{6,40}$/.test(digitada)) return json(res, 400, {ok: false, error: 'Remessa inválida.'});
    const remessa = digitada || banco.umaRemessa();
    if (!remessa) return json(res, 200, {ok: false, linhas: ['Ainda não há pacotes guardados: digite uma remessa.']});
    const d = await jms.diagnostico(remessa);
    const linhas = ['Remessa ' + d.remessa + ' · Routename: ' + d.routename];
    if (d.erro) linhas.push(d.erro);
    else {
      linhas.push('HTTP ' + d.http + ' · ' + d.resposta + (d.conteudo ? ' (' + d.conteudo + ')' : ''));
      if (d.pagina !== undefined) linhas.push('Página: "' + (d.pagina || '(sem texto)') + '"');
      if (d.resposta === 'dados (JSON)') {
        linhas.push('JMS: código ' + (d.code || '—') + (d.msg ? ' · ' + d.msg : ''));
        linhas.push('Informação básica: ' + (d.informacaoBasica ? 'sim' : 'não (resposta vazia)') + ' · 3 Segmentos: ' + (d.terminalDispatchCode || '(vazio)'));
      }
    }
    let ok = !d.erro && d.resposta === 'dados (JSON)' && !!d.terminalDispatchCode;
    // 2.0: a mesma remessa na Gestão de pedido JMS de remessa (a fonte principal do 3 Segmentos).
    if (cfg.fonteSegmentos !== 'rastreio') {
      try {
        const g = await jms.segmentosLote([remessa]), sg = g.achados.get(remessa);
        linhas.unshift('Gestão de pedido JMS de remessa: ' + (sg ? '3 Segmentos ' + [sg.s1, sg.s2, sg.s3].filter(Boolean).join(',') +
          ' (pedido ' + (banco.get('GESTAO_VARIANTE') || '?') + ')' : 'o JMS respondeu, mas sem esta remessa'), 'Rastreamento do pacote (reserva):');
        ok = ok || !!sg;
      } catch (e) { linhas.unshift('Gestão de pedido JMS de remessa: ' + String(e && e.message || e), 'Rastreamento do pacote (reserva):'); }
    }
    log(ok ? 'info' : 'aviso', 'Teste do 3 Segmentos: ' + linhas.join(' | '));
    return json(res, 200, {ok, linhas});
  }
  if (p === '/config/api/buscar') {
    const b = await lerJson(req), dia = /^\d{4}-\d{2}-\d{2}$/.test(String(b.dia || '')) ? b.dia : hojeSp();
    if (dia > hojeSp()) return json(res, 400, {ok: false, error: 'Esse dia ainda não chegou.'});
    if (coletor.estado.rodando) return json(res, 200, {ok: false, error: 'Já está buscando. Espere terminar.'});
    // 2.1: com a rota, só ela; vazio = todas as rotas do dia (pedido na mão).
    const rota = String(b.rota || '').trim() ? acharRota(b.rota) : '';
    if (String(b.rota || '').trim() && !rota) return json(res, 400, {ok: false, error: 'A rota "' + String(b.rota).trim().slice(0, 60) + '" não está na planilha de rotas.'});
    coletor.coletar(dia, {forcar: !!b.forcar, rotas: rota ? [rota] : []}).catch(() => {});
    return json(res, 200, {ok: true, rota});
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

/** O que a tela Configurações mostra do pedido da tela guardado (sem o corpo inteiro). */
function resumoModelo(m) { return m ? {campo: m.campo, lista: m.lista, pagina: m.pagina, tamanho: m.tamanho, datas: m.datas, exemplo: m.exemplo} : null; }

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
  log('info', '  Conferir remessas (cole as remessas do ID e escolha a rota): http://localhost:' + cfg.porta + '/conferir');
  const r = regras.resumo();
  r.erros.forEach(m => log('aviso', m));
  if (r.rotas) log('info', 'Planilha de rotas: ' + r.rotas.troncal + ' rotas troncais e ' + r.rotas.secundaria + ' secundárias.');
  if (!credenciais().fonte) log('aviso', 'Falta o AuthToken do JMS: abra Configurações (ou cadastre no DashMaster deste computador).');
  conferencias.retomar(); // conferência que o app fechou no meio continua
  if (process.env.EXPEDICAO_SEM_AGENDADOR === '1') return;
  log('info', 'Busca por viagem (anterior): só a rota pesquisada nos painéis Rota Troncal e Rota Secundária. Cada rota pesquisada continua atualizando ' +
    'sozinha (dia de hoje, a cada ' + cfg.minutos + ' min) por ' + cfg.horasPesquisa + ' h. Deixe esta janela aberta.');
  const ac = rotasAcompanhadas();
  if (ac.length) log('info', 'Rotas acompanhadas agora: ' + ac.join(', ') + '.');
  // Com AuthToken vencido tenta do mesmo jeito (uma consulta): volta sozinho quando o token for trocado aqui ou no DashMaster.
  // 2.1: nada de todas as rotas: só as pesquisadas nas últimas "horasPesquisa" horas (sem nenhuma, não consulta o JMS).
  const rodar = () => {
    const rotas = rotasAcompanhadas();
    if (credenciais().fonte && rotas.length && !coletor.estado.rodando) coletor.coletar([hojeSp()], {rotas}).catch(() => {});
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
