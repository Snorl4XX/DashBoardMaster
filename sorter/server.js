#!/usr/bin/env node
'use strict';
/**
 * J&T · PAINEL DO SORTER (separado do DashMaster)
 * ------------------------------------------------------------
 * Produção do sorter da base (巴西GRU分拣机 — tela "summary statistics of sorter operation"): Sorter A, B ou os dois
 * juntos, por balança (Induction No.), turno e horário. O sorter fica na rede interna (ex.: http://10.1.166.9): este
 * servidor roda num computador DENTRO da rede da base e abre o painel para os outros computadores e TVs da mesma rede
 * (http://IP-DESTE-COMPUTADOR:3100).
 *
 * Node.js 18 ou mais novo, sem instalar pacotes. Configuração: config.json (criado na primeira vez, ao lado deste arquivo).
 *
 * Uso:   node server.js            → painel no ar (e, com "appsScriptUrl" no config.json, a ponte para o Apps Script)
 *        node server.js --teste    → lê cada sorter uma vez, mostra os totais de hoje e as balanças (e manda uma vez
 *                                    para o Apps Script, se configurado), e sai
 *        node server.js --descobrir → procura na página /home como trocar de sorter (com o _token da sessão), testa,
 *                                    grava no config.json e escreve o relatório descoberta.txt
 *
 * Nada é gravado: cada consulta vai ao sorter, que guarda o histórico. As respostas ficam guardadas por alguns minutos
 * (cacheSegundos) para várias telas abertas não repetirem a mesma consulta.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const {fetchRange, Sessao} = require('./lib/sorter');
const {descobrirTroca} = require('./lib/troca');
const R = require('./lib/resumo');
const {criarEstado: criarEstadoBase} = require('./lib/estado');
const {criarPonte} = require('./lib/ponte');

const VERSAO = '2.5.0';
const TZ = 'America/Sao_Paulo';
const PUBLIC = path.join(__dirname, 'public');
const DEFAULTS = {
  porta: 3100,                       // 3100: não briga com o DashMaster (3000) se os dois rodarem no mesmo computador
  host: '0.0.0.0',                   // 0.0.0.0 = abre para a rede da base; 127.0.0.1 = só neste computador
  sorterUrl: 'http://10.1.166.9/home', // a página do monitor do sorter (a mesma que abre no navegador)
  atualizarSegundos: 3600,           // a tela com hoje consulta de novo a cada N segundos (pedido: a cada 1 hora)
  cacheSegundos: 120,                // resposta de hoje guardada por N segundos (várias telas, uma consulta)
  maxDias: 92,                       // período máximo (um trimestre)
  balancas: 'auto',                  // "auto" (descobre as balanças com produção) ou a lista: [1, 2, 3…] ou {"A": […], "B": […]}
  maxBalancas: 40,                   // "auto": testa as balanças de 1 até este número
  // Sorters do site ("switch device" → Cross-belt GRU-A / GRU-B). padrao = o que o site mostra sem trocar.
  // troca: "auto" = o painel descobre sozinho na página /home como trocar (com o _token da sessão) e grava aqui o que
  // achou; ou o pedido à mão: {metodo, caminho, corpo} (o _token do corpo é trocado pelo da sessão, sempre).
  sorters: [
    {id: 'B', nome: 'Sorter B', nomeZh: '分拣机 B套', padrao: true, troca: 'auto'},
    {id: 'A', nome: 'Sorter A', nomeZh: '分拣机 A套', troca: 'auto'}
  ],
  // Painel no Apps Script (opcional): a ponte manda os números para o App da Web. Os dois vêm da função configurar()
  // no editor do Apps Script (URL do App da Web, terminando em /exec, e a chave).
  appsScriptUrl: '',
  chavePonte: '',
  enviarMinutos: 60,                 // a ponte lê o sorter e manda a cada N minutos (e quando alguém aperta Atualizar)
  diasHistorico: 184,                // na primeira vez, manda os últimos N dias (dois trimestres)
  verificarSegundos: 30              // a cada N segundos a ponte confere se alguém apertou Atualizar no painel
};

// ------------------------------------------------------------------ configuração
function configPath() {
  const i = process.argv.indexOf('--config');
  return i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : process.env.SORTER_CONFIG || path.join(__dirname, 'config.json');
}
const URL_RE = /^https?:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?(\/[^\s?#]*)?$/i;
function loadConfig() {
  const file = configPath();
  let raw = {};
  if (fs.existsSync(file)) {
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new Error('O arquivo ' + file + ' não é um JSON válido: ' + e.message); }
  } else {
    fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + '\n');
    console.log('config.json criado com o padrão (sorter em ' + DEFAULTS.sorterUrl + ').');
  }
  // config.json da V1 (um sorter só, sem "sorters"): passa para a V2 com o padrão novo (1 hora, 92 dias) e grava.
  if (raw && typeof raw === 'object' && !raw.sorters && raw.nome !== undefined) {
    const v1 = raw, novo = Object.assign({}, raw);
    delete novo.nome; delete novo.nomeZh;
    // Os padrões da V1 (60 s, 45 s, 31 dias) dão lugar aos da V2; valores mudados à mão ficam.
    [['atualizarSegundos', 60], ['cacheSegundos', 45], ['maxDias', 31]].forEach(p => { if (Number(novo[p[0]]) === p[1]) delete novo[p[0]]; });
    raw = Object.assign({}, DEFAULTS, novo);
    raw.sorters = DEFAULTS.sorters.map(x => Object.assign({}, x));
    if (v1.nome) { raw.sorters[0].nome = String(v1.nome); raw.sorters[0].nomeZh = String(v1.nomeZh || v1.nome); }
    try { fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n'); console.log('config.json da versão anterior atualizado para a ' + VERSAO + '.'); }
    catch (e) { console.log('Não consegui gravar o config.json atualizado (' + e.message + '); seguindo com o padrão novo.'); }
  }
  // Campos novos (ex.: os do Apps Script) entram no arquivo com o padrão, para ficarem à mão na hora de editar.
  if (fs.existsSync(file) && raw && typeof raw === 'object' && Object.keys(DEFAULTS).some(k => !(k in raw))) {
    const completo = {};
    Object.keys(DEFAULTS).forEach(k => { completo[k] = k in raw ? raw[k] : DEFAULTS[k]; });
    Object.keys(raw).forEach(k => { if (!(k in completo)) completo[k] = raw[k]; });
    raw = completo;
    try { fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n'); } catch (e) { /* só leitura: segue com o padrão */ }
  }
  const c = Object.assign({}, DEFAULTS, raw);
  c.arquivo = file;
  const u = separarUrl(c.sorterUrl);
  if (!u) throw new Error('"sorterUrl" inválido no config.json: use, por exemplo, "http://10.1.166.9/home".');
  c.sorterUrl = u.base; c.pagina = u.pagina;
  c.porta = Number(c.porta) || DEFAULTS.porta;
  c.atualizarSegundos = Math.max(30, Number(c.atualizarSegundos) || DEFAULTS.atualizarSegundos);
  c.cacheSegundos = Math.max(0, Number(c.cacheSegundos) || 0);
  c.maxDias = Math.min(186, Math.max(1, Number(c.maxDias) || DEFAULTS.maxDias));
  c.maxBalancas = Math.min(200, Math.max(1, Number(c.maxBalancas) || DEFAULTS.maxBalancas));
  const list = Array.isArray(c.sorters) && c.sorters.length ? c.sorters : DEFAULTS.sorters;
  c.sorters = list.map((s, i) => {
    const id = String(s && s.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,12}$/.test(id)) throw new Error('"sorters[' + i + '].id" inválido no config.json (use letras/números, ex.: "A").');
    const su = s.sorterUrl ? separarUrl(s.sorterUrl) : {base: c.sorterUrl, pagina: c.pagina};
    if (!su) throw new Error('"sorters[' + i + '].sorterUrl" inválido no config.json.');
    // troca: objeto = o pedido à mão; false = nunca trocar; vazio/null/"auto" = descobrir na página.
    const troca = s.troca && typeof s.troca === 'object' ? s.troca : s.troca === false || s.troca === 'nao' ? null : 'auto';
    return {id, nome: String(s.nome || 'Sorter ' + id), nomeZh: String(s.nomeZh || s.nome || '分拣机 ' + id), url: su.base, pagina: su.pagina,
      padrao: !!s.padrao, troca, rotulo: s.rotulo ? String(s.rotulo) : '', proprioUrl: !!s.sorterUrl};
  });
  if (new Set(c.sorters.map(s => s.id)).size !== c.sorters.length) throw new Error('Há dois sorters com o mesmo "id" no config.json.');
  c.appsScriptUrl = String(c.appsScriptUrl || '').trim();
  c.chavePonte = String(c.chavePonte || '').trim();
  if (c.appsScriptUrl && !/^https?:\/\/[^\s?#]+\/exec$/.test(c.appsScriptUrl)) {
    throw new Error('"appsScriptUrl" inválido no config.json: use a URL do App da Web, que termina em /exec.');
  }
  if (c.appsScriptUrl && c.chavePonte.length < 16) throw new Error('"chavePonte" vazia ou curta no config.json: copie a chave que a função configurar() mostra no Apps Script.');
  c.enviarMinutos = Math.min(720, Math.max(5, Number(c.enviarMinutos) || DEFAULTS.enviarMinutos));
  c.diasHistorico = Math.min(400, Math.max(1, Number(c.diasHistorico) || DEFAULTS.diasHistorico));
  c.verificarSegundos = Math.min(600, Math.max(10, Number(c.verificarSegundos) || DEFAULTS.verificarSegundos));
  return c;
}
/**
 * "http://10.1.166.9/home" → {base: "http://10.1.166.9", pagina: "/home"}: as consultas (statis/summary.data) ficam na
 * raiz do site; a página é a que o painel abre para pegar a sessão e o _token (como o navegador).
 */
function separarUrl(v) {
  const t = String(v || '').trim();
  if (!URL_RE.test(t)) return null;
  const u = new URL(t), cam = u.pathname.replace(/\/+$/, '');
  return {base: u.origin, pagina: cam && !/statis|summary/i.test(cam) ? cam : '/home'};
}
/** Sorter pronto: é o padrão do site, tem a troca (configurada ou a descobrir) ou um endereço próprio. */
function pronto(dev) { return !!(dev.padrao || dev.troca || dev.proprioUrl); }

// ------------------------------------------------------------------ datas (São Paulo)
const FMT = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});
/** Agora em São Paulo: {date: "AAAA-MM-DD", time: "HH:mm:ss"}. SORTER_AGORA (só para os testes) fixa o relógio. */
function agora() {
  const fixo = process.env.SORTER_AGORA;
  if (fixo && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fixo)) return {date: fixo.slice(0, 10), time: fixo.slice(11)};
  const p = {};
  FMT.formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  return {date: p.year + '-' + p.month + '-' + p.day, time: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute + ':' + p.second};
}
const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }

// ------------------------------------------------------------------ consultas ao sorter
/** No máximo 4 consultas ao mesmo tempo no sorter (é o servidor da máquina: não pode ser sobrecarregado). */
let ativos = 0;
const fila = [];
function limitar(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      ativos++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { ativos--; const next = fila.shift(); if (next) next(); });
    };
    if (ativos < 4) run(); else fila.push(run);
  });
}

function criarEstado(cfg) {
  const sessoes = new Map();
  const sessao = dev => { if (!sessoes.has(dev.id)) sessoes.set(dev.id, new Sessao(dev.url, dev, undefined, dev.pagina)); return sessoes.get(dev.id); };

  // ---------- troca de sorter descoberta na página ----------
  let trocaP = null, trocaRes = null, trocaEm = 0;
  const grupoTroca = () => cfg.sorters.filter(d => !d.proprioUrl);
  const precisaDescobrir = () => grupoTroca().length > 1 && grupoTroca().some(d => d.troca === 'auto');
  /**
   * Descobre como trocar de sorter na página (uma vez; de novo em 30 min se falhou) e grava no config.json o que achou.
   * opts: {force, log}. Volta {ok, como, erro, global, relatorio}.
   */
  function prepararTrocas(opts) {
    opts = opts || {};
    if (!precisaDescobrir()) return Promise.resolve(trocaRes || {ok: true, relatorio: []});
    if (trocaP) return trocaP;
    if (trocaRes && !opts.force && Date.now() - trocaEm < 30 * 60 * 1000) return Promise.resolve(trocaRes);
    const grupo = grupoTroca();
    trocaP = descobrirTroca(cfg.sorterUrl, grupo, {pagina: cfg.pagina, hoje: agora().date, addDays, log: opts.log})
      .catch(e => ({ok: false, erro: e.message, relatorio: []}))
      .then(r => {
        if (r.ok) {
          const n = agora();
          grupo.forEach(d => {
            if (d.troca !== 'auto') return;
            d.troca = Object.assign({}, r.troca[d.id], {pagina: cfg.pagina, descoberta: n.date + ' ' + n.time.slice(0, 5), como: r.como});
            const s = sessoes.get(d.id);
            if (s) s.trocadoEm = 0;
          });
          salvarTrocas(cfg, grupo);
          base.limparCache();
        }
        trocaRes = r; trocaEm = Date.now(); trocaP = null;
        return r;
      });
    return trocaP;
  }
  /** Sorter que precisa trocar e a troca não foi achada: não lê (leria o outro sorter com o nome errado). */
  function erroTroca(dev) {
    if (dev.troca !== 'auto' || dev.padrao || dev.proprioUrl || grupoTroca().length < 2) return null;
    const r = trocaRes || {};
    const e = new Error(r.global ? r.erro : 'Não achei sozinho como trocar para o ' + dev.nome + ' na página ' + cfg.sorterUrl + cfg.pagina +
      (r.erro ? ' (' + r.erro + ')' : '') + '. Rode o descobrir.bat no computador da base e mande o arquivo descoberta.txt (ele não tem token nem cookie).');
    e.pendente = true;
    return e;
  }

  const base = criarEstadoBase(cfg, {
    agora, pronto, prepararTrocas, erroTroca,
    ler: async (dev, from, to, ind, group) => {
      const s = sessao(dev);
      await s.garantir();
      return limitar(() => fetchRange(dev.url, from, to, {sessao: s, inductionno: ind, group}));
    },
    textos: {semTroca: ' (config.json → sorters → troca)', semBalanca: ': coloque a lista de balanças em "balancas" no config.json', iguais: ' (rode o descobrir.bat)'}
  });
  return {dados: base.dados, linhas: base.linhas, balancasDe: base.balancasDe, prepararTrocas, erroTroca, statusTroca: () => trocaRes};
}

/** Grava no config.json a troca descoberta (o painel não precisa descobrir de novo ao reabrir). */
function salvarTrocas(cfg, grupo) {
  if (!cfg.arquivo || !fs.existsSync(cfg.arquivo)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(cfg.arquivo, 'utf8'));
    if (!Array.isArray(raw.sorters)) return;
    let mudou = false;
    raw.sorters.forEach(s => {
      const d = grupo.find(x => x.id === String(s.id));
      if (d && d.troca && typeof d.troca === 'object' && d.troca.descoberta && (!s.troca || s.troca === 'auto')) { s.troca = d.troca; mudou = true; }
    });
    if (mudou) fs.writeFileSync(cfg.arquivo, JSON.stringify(raw, null, 2) + '\n');
  } catch (e) { console.log('Não consegui gravar a troca descoberta no config.json (' + e.message + ').'); }
}

/** Ponte para o painel do Apps Script, com o mesmo estado (sessões e cache) do painel local. */
function ponteDe(cfg, estado) {
  return criarPonte(cfg, estado, {agora, addDays, daysBetween, pronto, versao: VERSAO});
}

// ------------------------------------------------------------------ servidor HTTP
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'};
const STATIC = {'/app.js': path.join(PUBLIC, 'app.js'), '/app.css': path.join(PUBLIC, 'app.css'), '/resumo.js': path.join(__dirname, 'lib', 'resumo.js'),
  '/planilha.js': path.join(__dirname, 'lib', 'planilha.js')};
function send(req, res, status, body, type, extra) {
  const headers = Object.assign({'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'}, extra || {});
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  if (buf.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { buf = zlib.gzipSync(buf); headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
function sendJson(req, res, status, obj) { send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8', {'Cache-Control': 'no-store'}); }
/** Pronto agora: com a troca a descobrir que já falhou, o sorter aparece como "falta configurar". */
function prontoAgora(dev, estado) {
  const st = estado && estado.statusTroca();
  return pronto(dev) && !(st && !st.ok && estado.erroTroca(dev));
}
function pagina(cfg, estado) {
  const boot = JSON.stringify({versao: VERSAO, atualizarSegundos: cfg.atualizarSegundos, maxDias: cfg.maxDias, hoje: agora().date,
    sorters: cfg.sorters.map(s => ({id: s.id, nome: s.nome, nomeZh: s.nomeZh, pronto: prontoAgora(s, estado)}))}).replace(/</g, '\\u003c');
  return fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('__SORTER_BOOT__', boot);
}

function criarServidor(cfg, estado) {
  estado = estado || criarEstado(cfg);
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { send(req, res, 405, 'Use GET.', null, {Allow: 'GET, HEAD'}); return; }
      const u = new URL(req.url, 'http://localhost');
      const p = u.pathname;
      if (p === '/' || p === '/index.html') { send(req, res, 200, pagina(cfg, estado), TYPES['.html']); return; }
      if (STATIC[p]) { send(req, res, 200, fs.readFileSync(STATIC[p]), TYPES[path.extname(STATIC[p])]); return; }
      if (p === '/api/dados') {
        const g = k => u.searchParams.get(k);
        sendJson(req, res, 200, await estado.dados({de: g('de'), ate: g('ate'), sorter: g('sorter'), balanca: g('balanca'),
          turnos: g('turnos'), hIni: g('hIni'), hFim: g('hFim'), forcar: g('forcar') === '1'}));
        return;
      }
      if (p === '/saude') {
        const st = estado.statusTroca();
        sendJson(req, res, 200, {ok: true, versao: VERSAO, sorterUrl: cfg.sorterUrl, pagina: cfg.pagina, agora: agora(),
          troca: st ? {ok: !!st.ok, como: st.como || '', erro: st.erro || ''} : null,
          sorters: cfg.sorters.map(s => ({id: s.id, nome: s.nome, pronto: prontoAgora(s, estado),
            troca: s.troca && typeof s.troca === 'object' ? (s.troca.como || s.troca.metodo + ' ' + s.troca.caminho) : s.troca || ''}))});
        return;
      }
      send(req, res, 404, 'Não encontrado.');
    } catch (e) {
      console.error('[erro] ' + req.method + ' ' + req.url + ': ' + (e && e.stack || e));
      if (!res.headersSent) sendJson(req, res, 500, {ok: false, error: String(e && e.message || e)});
    }
  });
}

function enderecos(cfg) {
  const out = ['http://localhost:' + cfg.porta];
  if (cfg.host === '0.0.0.0' || cfg.host === '::') {
    Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) out.push('http://' + i.address + ':' + cfg.porta);
    }));
  }
  return out;
}

/** Uma linha sobre a troca de sorter (descoberta, à mão ou não achada). */
function linhaTroca(cfg, st) {
  const man = cfg.sorters.filter(d => d.troca && typeof d.troca === 'object');
  if (st && st.ok && st.como) return 'Troca de sorter: achada na página ' + cfg.pagina + ' (' + st.como + ') e gravada no config.json.';
  if (st && !st.ok) return 'Troca de sorter: NÃO achada (' + st.erro + ') Rode o descobrir.bat e mande o descoberta.txt.';
  if (man.length) return 'Troca de sorter: ' + man.map(d => d.id + ' = ' + (d.troca.como || (d.troca.metodo || 'POST') + ' ' + d.troca.caminho)).join(' · ');
  return '';
}

/** --teste: lê hoje em cada sorter e mostra os totais e as balanças (para conferir a instalação). */
async function teste(cfg) {
  const estado = criarEstado(cfg);
  let erros = 0;
  const lt = linhaTroca(cfg, await estado.prepararTrocas());
  if (lt) console.log(lt);
  for (const dev of cfg.sorters) {
    console.log('— ' + dev.nome + ' (' + dev.url + ')');
    if (!pronto(dev)) { console.log('   falta configurar a troca (config.json → sorters → troca): rode o descobrir.bat.'); continue; }
    const d = await estado.dados({sorter: dev.id, forcar: true});
    const info = d.devices[0];
    if (!d.ok && info.pendente) { console.log('   ' + info.error); continue; }
    if (!d.ok) { console.log('   ERRO: ' + info.error); erros++; continue; }
    const s = R.summarize(d.rows, {});
    console.log('   ' + d.from + ' · ' + d.rows.length + ' linhas · consultado ' + d.fetchedAt);
    console.log('   Total ' + s.total + ' · válidos ' + s.valid + ' · No Sort Code ' + s.noInfo + ' · anormais ' + s.abnormal);
    console.log('   Turnos: ' + R.SHIFTS.map(x => x + ' ' + s.byShift[x].total).join(' · '));
    console.log('   Andares: ' + Object.keys(s.ps).sort().map(k => k + ' ' + s.ps[k]).join(' · '));
    console.log('   Balanças: ' + (info.balancaErro ? 'ERRO: ' + info.balancaErro : (info.balancas || []).join(', ') || 'nenhuma com produção nos últimos 7 dias'));
  }
  if (cfg.appsScriptUrl) {
    console.log('— Apps Script (' + cfg.appsScriptUrl + ')');
    try {
      const r = await ponteDe(cfg, estado).enviar({force: true});
      console.log('   OK: ' + r.dias + ' dia(s) enviados' + (r.planilha ? ' · planilha: ' + r.planilha : ''));
      r.sorters.filter(x => x.erro).forEach(x => { console.log('   ERRO no ' + x.nome + ': ' + x.erro); erros++; });
    } catch (e) { console.log('   ERRO: ' + e.message); erros++; }
  }
  return erros ? 1 : 0;
}

/**
 * --descobrir (descobrir.bat): procura na página do sorter como trocar de A para B, testa e mostra tudo — sem valores de
 * token ou cookie. Grava o relatório em descoberta.txt (para mandar) e, se achou, a troca no config.json.
 */
async function descobrir(cfg) {
  const estado = criarEstado(cfg);
  cfg.sorters.forEach(d => { if (!d.proprioUrl) d.troca = 'auto'; });
  console.log('J&T · Painel do Sorter v' + VERSAO + ' — descobrindo a troca de sorter em ' + cfg.sorterUrl + cfg.pagina);
  const r = await estado.prepararTrocas({force: true, log: l => console.log(l)});
  const fim = r.ok ? 'RESULTADO: troca achada (' + r.como + ') e gravada no config.json. Abra o iniciar.bat de novo.'
    : 'RESULTADO: não achei a troca (' + (r.erro || 'sem detalhe') + '). Mande o arquivo descoberta.txt.';
  console.log(fim);
  const txt = ['J&T · Painel do Sorter v' + VERSAO + ' · ' + agora().date + ' ' + agora().time, ''].concat(r.relatorio || [], ['', fim]).join('\r\n');
  const arq = path.join(path.dirname(cfg.arquivo || path.join(__dirname, 'config.json')), 'descoberta.txt');
  try { fs.writeFileSync(arq, txt + '\r\n'); console.log('Relatório: ' + arq + ' (sem token e sem cookie: pode mandar).'); }
  catch (e) { console.log('Não consegui gravar ' + arq + ': ' + e.message); }
  return r.ok ? 0 : 1;
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) { console.error('Este painel precisa do Node.js 18 ou mais novo (instalado: ' + process.version + '). Baixe em https://nodejs.org'); process.exit(1); }
  let cfg;
  try { cfg = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }
  if (process.argv.indexOf('--teste') > 0) { process.exit(await teste(cfg)); }
  if (process.argv.indexOf('--descobrir') > 0) { process.exit(await descobrir(cfg)); }
  const estado = criarEstado(cfg);
  const server = criarServidor(cfg, estado);
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error('A porta ' + cfg.porta + ' já está em uso: o painel do sorter já está aberto em outra janela, ou troque "porta" no config.json.');
    else console.error('Não foi possível abrir o servidor: ' + e.message);
    process.exit(1);
  });
  server.listen(cfg.porta, cfg.host, () => {
    console.log('J&T · Painel do Sorter v' + VERSAO + ' — lendo ' + cfg.sorterUrl + ' (' + cfg.sorters.map(s => s.nome + (pronto(s) ? '' : ' [falta configurar a troca]')).join(', ') + ')');
    console.log('Abra no navegador:');
    enderecos(cfg).forEach(a => console.log('   ' + a));
    if (cfg.appsScriptUrl) {
      console.log('Ponte para o Apps Script ligada: manda os números a cada ' + cfg.enviarMinutos + ' min e quando alguém aperta Atualizar no painel.');
      ponteDe(cfg, estado).iniciar();
    }
    console.log('Deixe esta janela aberta. Para desligar, feche a janela (ou Ctrl+C).');
    estado.prepararTrocas().then(st => { const lt = linhaTroca(cfg, st); if (lt) console.log(lt); });
  });
}

if (require.main === module) main();
module.exports = {criarEstado, criarServidor, ponteDe, loadConfig, agora, addDays, daysBetween, pronto, VERSAO, DEFAULTS};
