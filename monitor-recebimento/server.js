#!/usr/bin/env node
'use strict';
/**
 * MONITOR DE RECEBIMENTO | SP GRU — no computador (Node.js), como os painéis do DashMaster.
 *
 * Roda os arquivos do Apps Script SEM MUDAR NADA neles (Recebimento_SP_GRU.gs, Painel.gs e Index.html):
 *   - a coleta do JMS (atualizarRecebimento) roda ao abrir e a cada 15 min, num processo leve separado (lib/coleta.js);
 *   - a planilha "Recebimento JMS" vira o arquivo dados/planilha.json (lib/apps-script.js);
 *   - o painel (Index.html) abre em http://localhost:3600 e pede os dados como no Google (google.script.run).
 * Configurações (AuthToken do JMS, coletar agora, registro): http://localhost:3600/config — só neste computador.
 *
 * Uso: dois cliques no iniciar.bat (ou: node server.js).
 */
// O node:sqlite (só para ler o AuthToken do DashMaster) avisa "experimental" na janela: sem esse aviso.
const emitirAviso = process.emitWarning;
process.emitWarning = function (w) { if (/SQLite/i.test(String((w && w.message) || w))) return; return emitirAviso.apply(process, arguments); };

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const {Worker} = require('worker_threads');
const {loadConfig} = require('./lib/config');
const {carregar, lerJson, gravarJson, ID_PLANILHA} = require('./lib/apps-script');
const {Auth, isLocal, viaTunnel} = require('./lib/auth');
const VERSAO = require('./package.json').version;

/**
 * Erro que impede o Monitor de abrir. Pelo atalho do Windows (node.exe server.js), a janela fecharia na hora, sem dar para
 * ler o motivo: ali ela fica aberta (até o X ou 30 min). Pelo iniciar.bat (RECEBIMENTO_SEM_PAUSA) e fora do Windows, sai na hora.
 */
function parar(msg) {
  console.error('\n  [erro] ' + msg + '\n');
  if (process.platform === 'win32' && process.stdout.isTTY && !process.env.RECEBIMENTO_SEM_PAUSA) {
    console.error('  O Monitor NÃO está no ar. Tire um print desta janela para pedir ajuda.\n  Esta janela fica aberta para você ler: feche no X.');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30 * 60000);
  }
  process.exit(1);
}
if (Number(process.versions.node.split('.')[0]) < 18) {
  parar('O Monitor precisa do Node.js 18 ou mais novo (este é o ' + process.version + '). Baixe a versão LTS em https://nodejs.org');
}

let cfg;
try { cfg = loadConfig(); } catch (e) { parar(e.message); }
const ARQ_JMS = path.join(cfg.pastaDados, 'jms.json');
const ARQ_PROPS = path.join(cfg.pastaDados, 'propriedades.json');
const ARQ_PLANILHA = path.join(cfg.pastaDados, 'planilha.json');

// ------------------------------------------------------------------ registro (janela + dados/recebimento.log)
const REGISTRO = [];
function agoraSp(d) {
  return (d || new Date()).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).replace(',', '');
}
function log(nivel, texto) {
  const linha = agoraSp() + ' [' + nivel + '] ' + String(texto).replace(/\s+$/, '');
  (nivel === 'erro' ? console.error : console.log)(linha);
  REGISTRO.push(linha);
  if (REGISTRO.length > 200) REGISTRO.shift();
  try {
    const arq = path.join(cfg.pastaDados, 'recebimento.log');
    if (fs.existsSync(arq) && fs.statSync(arq).size > 5 * 1024 * 1024) fs.renameSync(arq, arq + '.1');
    fs.appendFileSync(arq, linha + '\n');
  } catch (e) { /* sem disco: só na janela */ }
}

// ------------------------------------------------------------------ AuthToken: o deste app ou o do DashMaster
/** O valor do AuthToken como a pessoa colou: tira "authtoken:", aspas, espaços e quebras de linha. */
function limparToken(v) {
  return String(v || '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/^(auth-?token|token)\s*[:=]\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
}
/** Cabeçalhos do JMS como o DashMaster manda. */
function cabecalhosDe(token, extra) {
  extra = extra || {};
  return {Accept: 'application/json, text/plain, */*', Lang: extra.JMS_LANG || 'PT', Langtype: extra.JMS_LANGTYPE || 'PT',
    Timezone: extra.JMS_TIMEZONE || 'GMT-0300', AuthToken: token};
}
const PROIBIDOS = /^(host|connection|content-length|keep-alive|transfer-encoding|upgrade|accept-encoding|te|trailer|expect|proxy-.*)$/i;
/** O que a pessoa colou: o AuthToken sozinho ou o JMS_HEADERS_JSON do Apps Script ({"authToken": "...", ...}). */
function interpretarToken(texto) {
  const s = String(texto || '').trim();
  if (!s) throw new Error('Cole o AuthToken do JMS.');
  if (s.charAt(0) !== '{') {
    const tok = limparToken(s);
    if (!/^[\x21-\x7e]{8,}$/.test(tok)) throw new Error('Isso não parece um AuthToken. Copie só o valor (sem espaços).');
    return cabecalhosDe(tok);
  }
  let o;
  try { o = JSON.parse(s); } catch (e) { throw new Error('O texto começa com { mas não é um JSON válido (' + e.message + ').'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('O JSON precisa ser um objeto: {"authToken": "..."}.');
  const cab = {};
  Object.keys(o).forEach(k => {
    const nome = k.trim(), v = o[k];
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(nome) || PROIBIDOS.test(nome) || v === null || v === undefined || typeof v === 'object') return;
    cab[nome] = String(v).replace(/[\r\n]+/g, ' ').trim();
  });
  if (!Object.keys(cab).some(k => /^(authtoken|cookie|authorization)$/i.test(k) && cab[k])) throw new Error('O JSON não tem o authToken.');
  return cab;
}

function bancosDashmaster() {
  const d = String(cfg.dashmaster || '').trim();
  if (/^(nao|não|false|0)$/i.test(d)) return [];
  if (process.env.RECEBIMENTO_DASHMASTER_DB) return [process.env.RECEBIMENTO_DASHMASTER_DB];
  const out = [];
  if (d) out.push(/\.db$/i.test(d) ? path.resolve(d) : path.resolve(d, 'node', 'dados', 'dashmaster.db'));
  ['dashmaster', 'dashmaster-lotes'].forEach(n => out.push(path.join(cfg.pastaApp, '..', n, 'node', 'dados', 'dashmaster.db')));
  if (process.platform === 'win32') out.push('C:\\dashmaster\\node\\dados\\dashmaster.db', 'C:\\Users\\Public\\dashmaster\\node\\dados\\dashmaster.db');
  return out.filter((f, i) => out.indexOf(f) === i);
}
let cacheDm = {em: 0, props: null};
/** AuthToken do DashMaster deste computador (tabela props do banco dele), lido a cada 15 s no máximo. */
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
        const chaves = ['JMS_AUTHTOKEN', 'JMS_LANG', 'JMS_LANGTYPE', 'JMS_TIMEZONE'];
        db.prepare('SELECT k, v FROM props WHERE k IN (?, ?, ?, ?)').all(...chaves).forEach(r => { o[r.k] = String(r.v || ''); });
        o.JMS_AUTHTOKEN = limparToken(o.JMS_AUTHTOKEN);
        if (o.JMS_AUTHTOKEN) { o.arquivo = f; props = o; break; }
      } finally { db.close(); }
    } catch (e) { /* banco ocupado ou Node sem node:sqlite: tenta o próximo */ }
  }
  cacheDm = {em: Date.now(), props};
  return props;
}
/** Cabeçalhos em uso: os colados neste app; sem eles, o AuthToken do DashMaster deste computador. */
function cabecalhosEmUso() {
  const proprio = lerJson(ARQ_JMS, null);
  if (proprio && proprio.cabecalhos && Object.keys(proprio.cabecalhos).length) return {fonte: 'app', cabecalhos: proprio.cabecalhos, salvoEm: proprio.salvoEm || ''};
  const dm = credenciaisDashmaster();
  if (dm) return {fonte: 'dashmaster', cabecalhos: cabecalhosDe(dm.JMS_AUTHTOKEN, dm), arquivo: dm.arquivo};
  return {fonte: '', cabecalhos: null};
}

// ------------------------------------------------------------------ planilha local e painel
// O Apps Script guardava o ID da planilha (instalarRecebimento15min). Aqui a planilha é a local.
(function () {
  const p = lerJson(ARQ_PROPS, {});
  if (p.RECEBIMENTO_SHEET_ID !== ID_PLANILHA) { p.RECEBIMENTO_SHEET_ID = ID_PLANILHA; gravarJson(ARQ_PROPS, p); }
})();
let painel;
try {
  painel = carregar({pastaCodigo: cfg.pastaApp, pastaDados: cfg.pastaDados, cabecalhosJms: () => null, fetchAllSync: null, log});
} catch (e) { parar('Não consegui carregar os arquivos .gs: ' + ((e && e.stack) || e)); }
function viagensNaPlanilha() {
  const aba = lerJson(ARQ_PLANILHA, {})['Recebimento JMS'];
  return aba && Array.isArray(aba.linhas) ? Math.max(0, aba.linhas.length - 1) : 0;
}

// ------------------------------------------------------------------ coleta do JMS (a cada N minutos)
const coleta = {rodando: false, desde: 0, proxima: 0, ultima: null, timer: null};
function dica(erro) {
  if (/HTTP 40[13]|diferente de JSON|sem lista de viagens/i.test(erro)) {
    return 'O AuthToken do JMS pode ter vencido: pegue um novo no JMS e cole em Configurações (ou no DashMaster deste computador).';
  }
  if (/Falha de rede|Tempo esgotado/i.test(erro)) return 'Sem acesso ao JMS: confira a internet (e a VPN, se a empresa usar).';
  return '';
}
function agendar() {
  clearTimeout(coleta.timer);
  const ms = cfg.coletaMinutos * 60000;
  coleta.proxima = Date.now() + ms;
  coleta.timer = setTimeout(() => coletar('a cada ' + cfg.coletaMinutos + ' min'), ms);
}
function terminar(r) {
  coleta.rodando = false;
  coleta.ultima = Object.assign({quando: Date.now(), segundos: Math.round((Date.now() - coleta.desde) / 1000)}, r);
  if (r.ok) log('info', 'Coleta do JMS terminou em ' + coleta.ultima.segundos + ' s. Viagens na planilha: ' + viagensNaPlanilha() + '.');
  else log('erro', 'A coleta do JMS falhou: ' + r.erro + (r.dica ? ' → ' + r.dica : ''));
  agendar();
}
/** Roda atualizarRecebimento() num processo separado. Devolve false se já está rodando. */
function coletar(motivo) {
  if (coleta.rodando) return false;
  coleta.rodando = true;
  coleta.desde = Date.now();
  clearTimeout(coleta.timer);
  const uso = cabecalhosEmUso();
  if (!uso.cabecalhos) {
    terminar({ok: false, erro: 'Falta o AuthToken do JMS.', dica: 'Abra http://localhost:' + cfg.porta + '/config e cole o AuthToken.'});
    return true;
  }
  log('info', 'Coleta do JMS começou (' + motivo + '; AuthToken ' + (uso.fonte === 'app' ? 'deste app' : 'do DashMaster') + ').');
  let fim = null;
  const w = new Worker(path.join(__dirname, 'lib', 'coleta.js'), {
    workerData: {pastaCodigo: cfg.pastaApp, pastaDados: cfg.pastaDados, jmsUrl: cfg.jmsUrl, cabecalhos: JSON.stringify(uso.cabecalhos)}
  });
  const limite = setTimeout(() => { fim = {ok: false, erro: 'A coleta passou de 20 minutos e foi interrompida.'}; w.terminate(); }, 20 * 60000);
  w.on('message', m => {
    if (m.tipo === 'log') log(m.nivel, m.texto);
    else if (m.tipo === 'fim' && !fim) { fim = m.ok ? {ok: true} : {ok: false, erro: m.erro, dica: dica(m.erro)}; w.terminate(); }
  });
  w.on('error', e => { if (!fim) fim = {ok: false, erro: String((e && e.message) || e)}; });
  w.on('exit', () => { clearTimeout(limite); terminar(fim || {ok: false, erro: 'A coleta parou sem responder.'}); });
  return true;
}

// ------------------------------------------------------------------ HTTP
const auth = new Auth(cfg);
const ESCOPO = 'painel_recebimento';

function enviar(req, res, codigo, corpo, tipo, extra) {
  let dados = Buffer.isBuffer(corpo) ? corpo : Buffer.from(String(corpo));
  const cab = Object.assign({'Content-Type': tipo || 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'}, extra || {});
  if (dados.length > 2048 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    dados = zlib.gzipSync(dados, {level: 6});
    cab['Content-Encoding'] = 'gzip';
    cab.Vary = 'Accept-Encoding';
  }
  cab['Content-Length'] = dados.length;
  res.writeHead(codigo, cab);
  res.end(req.method === 'HEAD' ? undefined : dados);
}
const json = (req, res, codigo, obj) => enviar(req, res, codigo, JSON.stringify(obj), 'application/json; charset=utf-8');
const html = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

function lerCorpo(req, limite) {
  return new Promise((ok, falha) => {
    const partes = [];
    let tam = 0;
    req.on('data', c => { tam += c.length; if (tam > limite) { falha(new Error('Pedido grande demais.')); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });
}

/** O painel do Apps Script, com o google.script.run trocado por uma chamada a este servidor. */
function paginaPainel(base) {
  const ponte = '<script>/* Monitor no computador: google.script.run chama o servidor deste app (api/run). */\n(function(){' +
    'var api=' + JSON.stringify(base + '/api/run') + ';' +
    'function chamar(nome,args,ok,falha){fetch(api,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({fn:nome,args:args})}).then(function(r){return r.json().catch(function(){return {ok:false,error:"HTTP "+r.status}})})' +
    '.then(function(j){if(j&&j.ok){if(ok)ok(j.result)}else if(falha){falha(new Error((j&&j.error)||"Falha"))}})' +
    '.catch(function(e){if(falha)falha(e)})}' +
    'function run(ok,falha){return new Proxy({},{get:function(_,k){' +
    'if(k==="withSuccessHandler")return function(f){return run(f,falha)};' +
    'if(k==="withFailureHandler")return function(f){return run(ok,f)};' +
    'if(k==="withUserObject")return function(){return run(ok,falha)};' +
    'return function(){chamar(k,Array.prototype.slice.call(arguments),ok,falha)}}})}' +
    'window.google={script:{run:run()}};})();</script>';
  const pagina = fs.readFileSync(path.join(cfg.pastaApp, 'Index.html'), 'utf8');
  const i = pagina.indexOf('</title>');
  return i >= 0 ? pagina.slice(0, i + 8) + ponte + pagina.slice(i + 8) : ponte + pagina;
}

function paginaEntrar(erro) {
  return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Monitor de Recebimento | Entrar</title><style>' + CSS + '</style><body><main class="caixa"><h1>Monitor de Recebimento</h1>' +
    '<form method="post" action="entrar"><label>Senha<input type="password" name="senha" autofocus required></label>' +
    (erro ? '<p class="erro">' + html(erro) + '</p>' : '') + '<button>Entrar</button></form></main></body></html>';
}

const CSS = ':root{color-scheme:light dark;--fundo:#f4f5f7;--cartao:#fff;--texto:#1d2330;--suave:#5d6677;--linha:#dfe3ea;--cor:#c8232b;--ok:#1d7a46;--erro:#b3261e}' +
  '@media (prefers-color-scheme:dark){:root{--fundo:#12151b;--cartao:#1b2029;--texto:#e8ebf1;--suave:#9aa3b2;--linha:#2c3340;--ok:#4cc38a;--erro:#ff8a80}}' +
  '*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--texto);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
  '.caixa{max-width:820px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 10px}' +
  '.sub{color:var(--suave);margin:0 0 18px}.cartao{background:var(--cartao);border:1px solid var(--linha);border-radius:10px;padding:16px;margin:0 0 14px}' +
  'textarea,input{width:100%;font:inherit;color:inherit;background:transparent;border:1px solid var(--linha);border-radius:8px;padding:8px;margin:6px 0 10px}' +
  'textarea{min-height:76px;font-family:ui-monospace,Consolas,monospace;font-size:13px}' +
  'button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:8px 14px;background:var(--cor);color:#fff;cursor:pointer;margin:0 8px 8px 0}' +
  'button.claro{background:transparent;color:var(--texto);border:1px solid var(--linha)}button:disabled{opacity:.5;cursor:default}' +
  '.ok{color:var(--ok);font-weight:600}.erro{color:var(--erro);font-weight:600}.suave{color:var(--suave)}' +
  'pre{white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,Consolas,monospace;max-height:340px;overflow:auto;margin:0}' +
  'a{color:inherit}ol{margin:6px 0 0;padding-left:20px}';

function paginaConfig() {
  return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Monitor de Recebimento | Configurações</title><style>' + CSS + '</style><body><main class="caixa">' +
    '<h1>Monitor de Recebimento · Configurações</h1><p class="sub">Esta tela só abre neste computador. Versão ' + html(VERSAO) + '.</p>' +
    '<section class="cartao"><h2>Coleta do JMS</h2><div id="coleta" class="suave">Carregando…</div>' +
    '<p><button id="coletar">Coletar agora</button><a href="./">Abrir o painel</a></p></section>' +
    '<section class="cartao"><h2>AuthToken do JMS</h2><div id="token" class="suave">…</div>' +
    '<textarea id="texto" placeholder="Cole aqui o AuthToken do JMS (ou o JMS_HEADERS_JSON que estava nas Propriedades do script)"></textarea>' +
    '<button id="salvar">Salvar e coletar</button><button id="apagar" class="claro">Apagar o AuthToken deste app</button>' +
    '<div id="msg"></div>' +
    '<p class="suave">Como pegar o AuthToken: abra o JMS no navegador e entre. Aperte F12, aba Rede (Network), clique em qualquer ' +
    'consulta da lista e procure <b>authToken</b> em Cabeçalhos (Headers). Copie só o valor. Se o DashMaster está neste ' +
    'computador, nem precisa: o Monitor usa o mesmo AuthToken dele.</p></section>' +
    '<section class="cartao"><h2>Links</h2><div id="links" class="suave">…</div></section>' +
    '<section class="cartao"><h2>Registro</h2><pre id="registro"></pre></section></main><script>' + JS_CONFIG + '</script></body></html>';
}

const JS_CONFIG = `
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const hora=ms=>ms?new Date(ms).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
async function api(nome,corpo){
  const r=await fetch('config/'+nome,{method:corpo?'POST':'GET',headers:{'Content-Type':'application/json','X-Recebimento':'1'},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({ok:false,erro:'HTTP '+r.status}));
  if(!j.ok)throw new Error(j.erro||'Falha');
  return j;
}
async function atualizar(){
  try{
    const e=await api('estado');
    const c=e.coleta,u=c.ultima;
    let t='';
    if(c.rodando)t+='<p><b>Coletando agora…</b> (desde '+hora(c.desde)+')</p>';
    if(u)t+=u.ok?'<p class="ok">Última coleta OK: '+hora(u.quando)+' ('+u.segundos+' s)</p>'
      :'<p class="erro">Última coleta falhou ('+hora(u.quando)+'): '+esc(u.erro)+'</p>'+(u.dica?'<p>'+esc(u.dica)+'</p>':'');
    t+='<p>Viagens na planilha: <b>'+e.viagens+'</b>'+(e.ultimoSucesso?' · dados do painel de '+hora(Date.parse(e.ultimoSucesso)):'')+
      (c.proxima&&!c.rodando?' · próxima coleta: '+hora(c.proxima):'')+'</p>';
    $('coleta').innerHTML=t;
    $('coletar').disabled=c.rodando;
    const k=e.token;
    $('token').innerHTML=k.fonte==='app'?'<p class="ok">Em uso: AuthToken deste app (salvo em '+hora(Date.parse(k.salvoEm))+').</p>'
      :k.fonte==='dashmaster'?'<p class="ok">Em uso: o AuthToken do DashMaster deste computador.</p>'
      :'<p class="erro">Falta o AuthToken: cole abaixo e clique em Salvar e coletar.</p>';
    $('apagar').hidden=k.fonte!=='app';
    $('links').innerHTML=e.links.map(l=>'<div>'+esc(l[0])+': <a href="'+esc(l[1])+'" target="_blank" rel="noopener">'+esc(l[1])+'</a></div>').join('');
    $('registro').textContent=e.registro.slice().reverse().join('\\n');
  }catch(err){$('coleta').innerHTML='<p class="erro">'+esc(err.message)+'</p>'}
}
$('coletar').onclick=async()=>{try{await api('coletar',{});}catch(err){alert(err.message)}atualizar()};
$('salvar').onclick=async()=>{
  $('msg').innerHTML='';
  try{await api('token',{texto:$('texto').value});$('texto').value='';$('msg').innerHTML='<p class="ok">Salvo. A coleta começou.</p>'}
  catch(err){$('msg').innerHTML='<p class="erro">'+esc(err.message)+'</p>'}
  atualizar();
};
$('apagar').onclick=async()=>{if(!confirm('Apagar o AuthToken deste app?'))return;try{await api('apagar-token',{})}catch(err){alert(err.message)}atualizar()};
atualizar();setInterval(atualizar,5000);
`;

function ipsDaRede() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach(l => (l || []).forEach(a => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }));
  return out;
}

async function tratar(req, res) {
  let url = new URL(req.url, 'http://localhost');
  // Link público com caminho (https://NOME.ts.net/recebimento): o Tailscale repassa com o caminho ou sem ele; os dois funcionam.
  let base = '';
  if (cfg.caminho) {
    if (url.pathname === cfg.caminho) { res.writeHead(301, {Location: cfg.caminho + '/' + url.search}); res.end(); return; }
    if (url.pathname.indexOf(cfg.caminho + '/') === 0) {
      url = new URL(url.pathname.slice(cfg.caminho.length) + url.search, 'http://localhost');
      base = cfg.caminho;
    } else if (viaTunnel(req)) base = cfg.caminho;
  }
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const seguro = viaTunnel(req);
  const liberado = auth.valid(req, ESCOPO, cfg.senha);

  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (p === '/saude') {
    json(req, res, 200, {ok: true, versao: VERSAO, coletando: coleta.rodando, ultimaColeta: coleta.ultima && {ok: coleta.ultima.ok, quando: coleta.ultima.quando}});
    return;
  }
  if (p === '/entrar') {
    if (req.method !== 'POST') { enviar(req, res, 200, paginaEntrar('')); return; }
    const ip = req.socket.remoteAddress || '';
    if (!auth.allowAttempt(ip)) { enviar(req, res, 429, paginaEntrar('Muitas tentativas. Espere 1 minuto.')); return; }
    const senha = new URLSearchParams(await lerCorpo(req, 4096)).get('senha') || '';
    if (!auth.check(cfg.senha, senha)) { enviar(req, res, 401, paginaEntrar('Senha errada.')); return; }
    res.writeHead(303, {Location: base + '/', 'Set-Cookie': auth.cookie(ESCOPO, cfg.senha, 24 * 30, seguro)});
    res.end();
    return;
  }
  if (p === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!liberado) { enviar(req, res, 200, paginaEntrar('')); return; }
    enviar(req, res, 200, paginaPainel(base));
    return;
  }
  if (p === '/api/run' && req.method === 'POST') {
    if (!liberado) { json(req, res, 401, {ok: false, error: 'Entre com a senha do painel (recarregue a página).'}); return; }
    let pedido;
    try { pedido = JSON.parse(await lerCorpo(req, 65536) || '{}'); } catch (e) { json(req, res, 400, {ok: false, error: 'Pedido inválido.'}); return; }
    // Só a função que o painel usa. A coleta (atualizarRecebimento) roda pelo agendamento ou em Configurações.
    if (pedido.fn !== 'dadosPainelRecebimento') { json(req, res, 403, {ok: false, error: 'Função não permitida: ' + String(pedido.fn).slice(0, 60)}); return; }
    try {
      const resultado = painel.dadosPainelRecebimento();
      enviar(req, res, 200, JSON.stringify({ok: true, result: resultado}), 'application/json; charset=utf-8');
    } catch (e) {
      json(req, res, 200, {ok: false, error: String((e && e.message) || e)});
    }
    return;
  }
  if (p === '/config' || p.indexOf('/config/') === 0) {
    if (!isLocal(req)) {
      enviar(req, res, 403, '<!doctype html><meta charset="utf-8"><title>Configurações</title><style>' + CSS + '</style><main class="caixa"><h1>Configurações</h1>' +
        '<p>Esta tela só abre no computador do Monitor: <b>http://localhost:' + cfg.porta + '/config</b></p></main>');
      return;
    }
    if (p === '/config') {
      if (url.pathname !== '/config') { res.writeHead(301, {Location: base + '/config'}); res.end(); return; }
      enviar(req, res, 200, paginaConfig());
      return;
    }
    // Ações: só com o cabeçalho X-Recebimento (outro site aberto no navegador não consegue mandar).
    if (req.headers['x-recebimento'] !== '1') { json(req, res, 403, {ok: false, erro: 'Pedido sem o cabeçalho da tela Configurações.'}); return; }
    const acao = p.slice('/config/'.length);
    if (acao === 'estado' && req.method === 'GET') {
      const uso = cabecalhosEmUso();
      const props = lerJson(ARQ_PROPS, {});
      const links = [['Painel neste computador', 'http://localhost:' + cfg.porta + '/']]
        .concat(ipsDaRede().map(ip => ['Painel na rede', 'http://' + ip + ':' + cfg.porta + '/']));
      if (cfg.linkPublico) links.push(['Link público', cfg.linkPublico]);
      json(req, res, 200, {ok: true, versao: VERSAO, viagens: viagensNaPlanilha(), ultimoSucesso: props.RECEBIMENTO_ULTIMO_SUCESSO || '',
        falha: props.RECEBIMENTO_FALHA || '', token: {fonte: uso.fonte, salvoEm: uso.salvoEm || ''},
        coleta: {rodando: coleta.rodando, desde: coleta.desde, proxima: coleta.proxima, ultima: coleta.ultima}, links, registro: REGISTRO.slice(-60)});
      return;
    }
    if (req.method !== 'POST') { json(req, res, 405, {ok: false, erro: 'Use POST.'}); return; }
    let corpo;
    try { corpo = JSON.parse(await lerCorpo(req, 65536) || '{}'); } catch (e) { json(req, res, 400, {ok: false, erro: 'Pedido inválido.'}); return; }
    if (acao === 'token') {
      let cab;
      try { cab = interpretarToken(corpo.texto); } catch (e) { json(req, res, 200, {ok: false, erro: e.message}); return; }
      gravarJson(ARQ_JMS, {cabecalhos: cab, salvoEm: new Date().toISOString()}, 0o600);
      log('info', 'AuthToken do JMS salvo em Configurações.');
      coletar('AuthToken novo');
      json(req, res, 200, {ok: true});
      return;
    }
    if (acao === 'apagar-token') {
      try { fs.unlinkSync(ARQ_JMS); } catch (e) { /* já não existia */ }
      log('info', 'AuthToken deste app apagado (usa o do DashMaster, se houver).');
      json(req, res, 200, {ok: true});
      return;
    }
    if (acao === 'coletar') {
      const comecou = coletar('botão Coletar agora');
      json(req, res, 200, {ok: true, comecou});
      return;
    }
    json(req, res, 404, {ok: false, erro: 'Ação desconhecida.'});
    return;
  }
  enviar(req, res, 404, 'Página não encontrada.', 'text/plain; charset=utf-8');
}

const servidor = http.createServer((req, res) => {
  tratar(req, res).catch(e => {
    log('erro', 'Pedido ' + req.method + ' ' + String(req.url).split('?')[0] + ': ' + ((e && e.message) || e));
    if (!res.headersSent) json(req, res, 500, {ok: false, error: 'Erro no servidor do Monitor.'});
    else res.end();
  });
});
servidor.on('error', e => {
  if (e && e.code === 'EADDRINUSE') {
    parar('A porta ' + cfg.porta + ' já está em uso: o Monitor de Recebimento já está aberto em outra janela ' +
      '(ou outro programa usa essa porta: troque "porta" no config.json).');
  }
  parar('O Monitor NÃO está no ar: ' + ((e && e.message) || e));
});
servidor.listen(cfg.porta, cfg.host, () => {
  const L = ['', '  ===== Monitor de Recebimento | SP GRU (v' + VERSAO + ') =====', '',
    '  Painel:          http://localhost:' + cfg.porta,
    '  Configurações:   http://localhost:' + cfg.porta + '/config   (AuthToken do JMS, coletar agora)'];
  ipsDaRede().forEach(ip => L.push('  Na rede:         http://' + ip + ':' + cfg.porta));
  L.push('  Link público:    ' + (cfg.linkPublico || 'dois cliques no link-publico.bat (https://NOME.ts.net' + cfg.caminho + ')'));
  L.push('', '  Deixe esta janela aberta (pode minimizar). A coleta do JMS roda agora e a cada ' + cfg.coletaMinutos + ' min.', '');
  console.log(L.join('\n'));
  setTimeout(() => coletar('ao abrir'), 500);
});
process.on('SIGINT', () => process.exit(0));
