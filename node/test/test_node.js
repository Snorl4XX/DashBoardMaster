'use strict';
/**
 * Teste da versão Node.js com um JMS simulado de verdade (servidor HTTP local, mesmas respostas de tests/mocks.js).
 * Confere que o painel no Node.js dá EXATAMENTE os mesmos números da simulação do Apps Script (tests/test_backend.js),
 * além da página, das Configurações, da senha, dos relatórios e das execuções ao mesmo tempo.
 * Uso: node test/test_node.js   (dentro da pasta node/)
 */
process.env.TZ = 'America/Sao_Paulo';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {spawn} = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const {createContext, fakeJms, makeDay} = require(path.join(ROOT, 'tests', 'mocks.js'));

let passed = 0;
const children = [];
const servers = [];
function cleanup() { children.forEach(c => { try { c.kill(); } catch (e) { /* já saiu */ } }); servers.forEach(s => { try { s.close(); } catch (e) { /* já fechou */ } }); }
function check(cond, name, extra) {
  if (!cond) {
    console.error('FALHOU: ' + name + (extra === undefined ? '' : ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 2000))));
    cleanup();
    process.exit(1);
  }
  passed++;
}

const DATES = ['2026-09-17', '2026-09-18', '2026-09-19'];
const mkDays = () => ({'2026-09-17': makeDay('2026-09-17', 11), '2026-09-18': makeDay('2026-09-18', 23), '2026-09-19': makeDay('2026-09-19', 37)});
const baseProps = {JMS_AUTHTOKEN: 'FAKE', JMS_AUTH_MODE: 'AUTHTOKEN', DATA_START_DATE: '2026-09-17', DETAIL_DAYS_ARRIVAL_FLOW: '120',
  ATUALIZACAO_MIN: '60', COTA_GOOGLE: 'workspace', RECEBIMENTO_MIN_POR_DIA: '0', EXPEDICAO_MIN_POR_DIA: '0'};
const INDICATORS = ['wrong_send', 'sorting_error', 'missing_receipt', 'missing_dispatch', 'sc_sc', 'sc_dc'];

// ------------------------------------------------------------------ utilidades HTTP
function request(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const h = Object.assign({}, headers || {});
    if (data !== null && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const req = http.request({host: '127.0.0.1', port, method, path: p, headers: h}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        if (res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
        resolve({status: res.statusCode, headers: res.headers, text: buf.toString('utf8'), buf});
      });
    });
    req.on('error', reject);
    req.setTimeout(15 * 60000, () => req.destroy(new Error('timeout ' + p)));
    if (data !== null) req.write(data);
    req.end();
  });
}
function freePort() {
  return new Promise(resolve => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function startServer(cfg, env) {
  return new Promise((resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-node-'));
    const file = path.join(tmp, 'config.json');
    fs.writeFileSync(file, JSON.stringify(Object.assign({host: '127.0.0.1', pastaDados: path.join(tmp, 'dados'), pastaCodigo: ROOT, trabalhadores: 2}, cfg)));
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: Object.assign({}, process.env, {DASHMASTER_CONFIG: file, DASHMASTER_SEM_AGENDADOR: '1'}, env || {}), stdio: ['ignore', 'pipe', 'pipe']});
    children.push(child);
    let out = '';
    const onData = d => {
      out += d;
      if (/no ar\./.test(out)) resolve({child, tmp, out: () => out});
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => reject(new Error('servidor saiu (' + code + '):\n' + out)));
    setTimeout(() => reject(new Error('servidor não subiu:\n' + out)), 30000);
  });
}

// JMS falso como servidor HTTP (o Node.js consulta por rede, como o JMS real).
function startFakeJms(port, days, options) {
  const state = {fetches: []};
  const jms = fakeJms(days, options);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const r = jms('https://gw.jtjms-br.com' + req.url, {headers: req.headers, payload: Buffer.concat(chunks).toString('utf8')}, state);
        res.writeHead(r.getResponseCode(), {'Content-Type': 'application/json;charset=UTF-8'});
        res.end(r.getContentText());
      } catch (e) { res.writeHead(500); res.end(String(e && e.message || e)); }
    });
  });
  servers.push(server);
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({server, state})));
}

// Campos que mudam com o relógio (hora da consulta, gravação): fora da comparação.
const VOLATILE = /^(stampT|generatedAt|updatedAt|lastUpdated|lastUpdate|fetchedAt|consultedAt|ts|stamp|stamps|stampTs|now|nowTs|serverTime|ms|elapsedMs|ageMin|listAgeMin|createdAt|savedAt|at|lastSync|lastSyncTs|syncedAt|checkedAt|queriedAt|refreshedAt)$/;
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach(k => { if (!VOLATILE.test(k)) o[k] = normalize(v[k]); });
    return o;
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return '<hora>';
  return v;
}
function firstDiff(a, b, p) {
  p = p || '';
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
    for (const k of keys) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  }
  return p + ': ' + JSON.stringify(a).slice(0, 300) + ' ≠ ' + JSON.stringify(b).slice(0, 300);
}

(async function main() {
  const t0 = Date.now();
  // ---------- 1. Referência: simulação do Apps Script (a mesma dos 450+ testes de tests/test_backend.js) ----------
  const ref = createContext({props: Object.assign({}, baseProps), jms: fakeJms(mkDays()), quiet: true});
  ref.startFullHistory();
  let guard = 0;
  do { ref.processSyncQueue({budgetMs: 600000}); guard++; } while (guard < 8 && ref.pendingJobs_().length);
  check(ref.pendingJobs_().filter(j => j.date <= '2026-09-19').length === 0, 'referência: fila processada');

  // ---------- 2. Servidor Node.js + JMS simulado por HTTP ----------
  const jport = await freePort(), port = await freePort();
  const fake = await startFakeJms(jport, mkDays());
  const srv = await startServer({porta: port, navegadorPdf: process.env.DASHMASTER_TEST_BROWSER || ''}, {DASHMASTER_JMS_URL: 'http://127.0.0.1:' + jport});
  const api = async (fn, args) => {
    const r = await request(port, 'POST', '/api/run', {fn, args: args || []});
    const j = JSON.parse(r.text);
    if (!j.ok) throw new Error(fn + ': ' + j.error);
    return j.result;
  };
  const admin = async (name, body) => {
    const r = await request(port, body === undefined ? 'GET' : 'POST', '/config/api/' + name, body);
    const j = JSON.parse(r.text);
    if (!j.ok) throw new Error(name + ': ' + j.error);
    return j;
  };

  const saude = JSON.parse((await request(port, 'GET', '/saude')).text);
  check(saude.ok && /^\d+\.\d+\.\d+$/.test(saude.versao), 'servidor no ar (/saude)', saude);

  // Propriedades pela tela Configurações (equivale às Propriedades do script).
  for (const k of Object.keys(baseProps)) if (k !== 'JMS_AUTHTOKEN') await admin('propriedade', {k, v: baseProps[k]});
  await admin('credenciais', {authToken: 'FAKE'});
  const est = await admin('estado');
  check(est.token === true && est.dataInicial === '2026-09-17', 'credencial e data inicial salvas', {token: est.token, d: est.dataInicial});
  check(est.props.every(p => p.k !== 'JMS_AUTHTOKEN' || /••/.test(p.v)), 'AuthToken nunca aparece na tela');
  check(est.funcoes.some(f => f.nome === 'diagnosticarConexaoJms') && est.funcoes.every(f => !/_$/.test(f.nome)), 'lista de funções públicas');
  const bad = await request(port, 'POST', '/config/api/propriedade', {k: 'DB_SPREADSHEET_ID', v: 'x'});
  check(bad.status === 400, 'propriedade interna protegida');

  const conn = await admin('executar', {fn: 'diagnosticarConexaoJms', args: []});
  check(conn.ok && conn.logs.length > 0, 'diagnosticarConexaoJms roda pela tela', conn.logs.slice(0, 3));

  const hist = await admin('executar', {fn: 'startFullHistory', args: []});
  check(hist.result && hist.result.ok && hist.result.days >= 3, 'histórico enfileirado', hist.result);
  let pending = 1;
  for (guard = 0; guard < 10 && pending > 0; guard++) {
    await admin('executar', {fn: 'processSyncQueue', args: [{budgetMs: 600000}]});
    const st = await api('getAppBootstrap', []);
    pending = st && st.sync ? Number(st.sync.PENDING || 0) : 0;
  }
  check(pending === 0, 'fila do Node.js processada até o fim', pending);
  check(fake.state.fetches.length > 50, 'Node.js consultou o JMS simulado pela rede', fake.state.fetches.length);
  check(fake.state.fetches.every(f => f.headers.authtoken === 'FAKE'), 'AuthToken enviado ao JMS em toda consulta');

  // ---------- 3. Mesmos números da simulação do Apps Script ----------
  for (const ind of INDICATORS) {
    for (const params of [{from: '2026-09-17', to: '2026-09-19'}, {from: '2026-09-19', to: '2026-09-19'}]) {
      const a = normalize(JSON.parse(JSON.stringify(ref.getDashboardData(ind, params))));
      const b = normalize(await api('getDashboardData', [ind, params]));
      const d = firstDiff(a, b, ind);
      check(!d, 'painel igual ao do Apps Script: ' + ind + ' ' + params.from + '→' + params.to, d);
    }
  }
  const ra = normalize(JSON.parse(JSON.stringify(ref.getResultsData({from: '2026-09-17', to: '2026-09-19'}))));
  const rb = normalize(await api('getResultsData', [{from: '2026-09-17', to: '2026-09-19'}]));
  check(!firstDiff(ra, rb, 'resultados'), 'Resultados iguais ao do Apps Script', firstDiff(ra, rb, 'resultados'));
  const ws = await api('getDashboardData', ['wrong_send', {from: '2026-09-19', to: '2026-09-19'}]);
  check(ws.rates.some(r => r.date === '2026-09-19' && r.rate !== null) && ws.meta.archive.fullyLoaded && ws.meta.archive.readFiles === 1, 'Envio Errado de 19/09 completo no Node.js', ws.meta.archive);

  // ---------- 4. Página do painel ----------
  const page = await request(port, 'GET', '/?ind=wrong_send', undefined, {'Accept-Encoding': 'gzip'});
  check(page.status === 200 && page.headers['content-encoding'] === 'gzip', 'página com compressão');
  check(/__PLATAFORMA__/.test(page.text) && !/<\?!?=/.test(page.text) && /window\.__BOOT__ = \{/.test(page.text), 'página montada (sem marcas do Apps Script)');
  check(/<title>J&amp;T Express/.test(page.text) && /name="viewport"/.test(page.text), 'título e viewport');
  check(!/Propriedades do script|editor do Apps Script|abrir o Apps Script|Google Drive|Abrir no Drive/.test(page.text), 'textos apontam para Configurações e para este servidor, não para o Google');

  // ---------- 5. Segurança das chamadas ----------
  const deny = await request(port, 'POST', '/api/run', {fn: 'setupProject', args: []});
  check(deny.status === 403, 'função fora da página bloqueada', deny.text);
  const priv = await request(port, 'POST', '/api/run', {fn: 'getRates_', args: []});
  check(priv.status === 403, 'função interna (_) bloqueada');
  const csrf = await request(port, 'POST', '/api/run', {fn: 'getAppBootstrap', args: []}, {Origin: 'http://outro-site.example'});
  check(csrf.status === 403, 'outro site não chama o painel (CSRF)');
  const form = await request(port, 'POST', '/api/run', 'fn=getAppBootstrap', {'Content-Type': 'application/x-www-form-urlencoded'});
  check(form.status === 415, 'só JSON');
  const slash = await request(port, 'GET', '/config/');
  check(slash.status === 301 && slash.headers.location === '/config', '/config/ redireciona para /config');
  const remote = await request(port, 'GET', '/config', undefined, {'X-Forwarded-For': '10.0.0.9'});
  check(remote.status === 403 && /só abre/.test(remote.text), 'Configurações bloqueadas fora do computador do servidor');
  const remoteApi = await request(port, 'GET', '/config/api/estado', undefined, {'X-Forwarded-For': '10.0.0.9'});
  check(remoteApi.status === 401, 'API das Configurações bloqueada de fora');
  // Link público (Tailscale Funnel / Cloudflare / ngrok): o túnel roda no próprio computador e repassa para o localhost.
  for (const h of [{Host: 'painel.exemplo.ts.net'}, {'Tailscale-Funnel-Request': '?1'}, {'Cf-Connecting-Ip': '203.0.113.7'},
    {'X-Forwarded-Proto': 'https'}, {Forwarded: 'for=203.0.113.7'}, {'Ngrok-Skip-Browser-Warning': '1'}]) {
    const r = await request(port, 'GET', '/config/api/estado', undefined, h);
    check(r.status === 401, 'Configurações não abrem pelo link público: ' + JSON.stringify(h), r.status);
  }
  const viaLink = await request(port, 'GET', '/', undefined, {'Tailscale-Funnel-Request': '?1', Host: 'painel.exemplo.ts.net', 'X-Forwarded-Proto': 'https'});
  check(viaLink.status === 200 && /__PLATAFORMA__/.test(viaLink.text), 'painel abre pelo link público');
  const linkApi = await request(port, 'POST', '/api/run', {fn: 'getAppBootstrap', args: []},
    {Host: 'painel.exemplo.ts.net', Origin: 'https://painel.exemplo.ts.net', 'X-Forwarded-Proto': 'https'});
  check(linkApi.status === 200 && JSON.parse(linkApi.text).ok, 'chamadas do painel funcionam pelo link público (mesma origem)');
  const rewritten = await request(port, 'POST', '/api/run', {fn: 'getAppBootstrap', args: []},
    {'X-Forwarded-Host': 'painel.exemplo.ts.net', Origin: 'https://painel.exemplo.ts.net', 'X-Forwarded-Proto': 'https'});
  check(rewritten.status === 200, 'link público com Host trocado pelo túnel (X-Forwarded-Host) funciona', rewritten.status);
  const forged = await request(port, 'POST', '/api/run', {fn: 'getAppBootstrap', args: []},
    {'X-Forwarded-Host': 'painel.exemplo.ts.net', Origin: 'https://outro-site.example', 'X-Forwarded-Proto': 'https'});
  check(forged.status === 403, 'outro site continua bloqueado pelo link público');
  check(est.senhaPainel === false && est.linkPublico === '', 'Situação mostra senha e link público');

  // ---------- 6. Várias consultas ao mesmo tempo (a fila não trava a página) ----------
  const t1 = Date.now();
  const many = await Promise.all([
    admin('executar', {fn: 'processSyncQueue', args: [{force: true, budgetMs: 30000}]}),
    api('getDashboardData', ['sorting_error', {from: '2026-09-17', to: '2026-09-19'}]),
    api('getDashboardData', ['sc_sc', {from: '2026-09-18', to: '2026-09-18'}]),
    api('getUpdateStamp', ['']),
    api('getAppBootstrap', [])
  ]);
  check(many.every(Boolean), 'consultas simultâneas respondem', Date.now() - t1);

  // ---------- 7. Relatórios (Excel sem Google; PDF pelo navegador do computador) ----------
  const xl = await api('generateReport', ['wrong_send', {from: '2026-09-17', to: '2026-09-19'}, 'xlsx']);
  const xbuf = Buffer.from(xl.base64 || '', 'base64');
  check(xl.ok && /\.xlsx$/.test(xl.fileName) && xbuf.slice(0, 2).toString() === 'PK', 'relatório Excel gerado', xl.fileName);
  check(xbuf.includes(Buffer.from('xl/worksheets/sheet3.xml')) && xbuf.includes(Buffer.from('xl/styles.xml')), 'Excel com 3 abas e estilos');
  if (process.env.DASHMASTER_TEST_OUT) fs.writeFileSync(path.join(process.env.DASHMASTER_TEST_OUT, xl.fileName), xbuf);
  const dl = await request(port, 'GET', xl.driveUrl.replace(/^https?:\/\/[^/]+/, ''));
  check(dl.status === 200 && dl.buf.slice(0, 2).toString() === 'PK' && /attachment/.test(dl.headers['content-disposition']), 'Excel salvo e baixável em /arquivo', xl.driveUrl);
  const pdfBrowser = process.env.DASHMASTER_TEST_BROWSER || '';
  if (pdfBrowser) {
    const pdf = await api('generateReport', ['wrong_send', {from: '2026-09-17', to: '2026-09-19'}, 'pdf']);
    // Acima de 3 MB o Report.gs não manda o arquivo direto: só o link (aqui, /arquivo/…).
    const pbuf = pdf.base64 ? Buffer.from(pdf.base64, 'base64') : (await request(port, 'GET', pdf.driveUrl.replace(/^https?:\/\/[^/]+/, ''))).buf;
    console.log('PDF: ' + Math.round(pbuf.length / 1024) + ' KB (' + (pdf.base64 ? 'direto' : 'pelo link') + ')');
    if (process.env.DASHMASTER_TEST_OUT) fs.writeFileSync(path.join(process.env.DASHMASTER_TEST_OUT, pdf.fileName), pbuf);
    check(pdf.ok && pbuf.slice(0, 4).toString() === '%PDF', 'relatório PDF gerado pelo navegador', {ok: pdf.ok, file: pdf.fileName, len: pbuf.length, head: pbuf.slice(0, 8).toString()});
  } else {
    console.log('(PDF não testado: defina DASHMASTER_TEST_BROWSER com o caminho do Chrome/Edge)');
  }

  // ---------- 8. Token vencido: a fila pausa e a mensagem aponta para Configurações ----------
  fake.server.close();
  const jport2 = await freePort();
  await startFakeJms(jport2, mkDays(), {appError: {code: 401, msg: 'token expired'}});
  // (o servidor continua apontando para o JMS antigo: cai em "falha de rede", sem travar)
  const net = await api('refreshNow', ['wrong_send', '2026-09-19', '2026-09-19']).then(r => r, e => ({erro: e.message}));
  check(net && (net.erro || net.ok === false || net.ok === true), 'JMS fora do ar não derruba o servidor', net);

  // ---------- 9. Senha do painel ----------
  const port2 = await freePort();
  const srv2 = await startServer({porta: port2, senha: 'segredo-teste'});
  const noAuth = await request(port2, 'GET', '/');
  check(noAuth.status === 303 && /^\/entrar/.test(noAuth.headers.location), 'painel com senha pede login');
  const apiNoAuth = await request(port2, 'POST', '/api/run', {fn: 'getAppBootstrap', args: []});
  check(apiNoAuth.status === 401, 'API exige login');
  const wrong = await request(port2, 'POST', '/entrar', 'senha=errada&volta=%2F', {'Content-Type': 'application/x-www-form-urlencoded'});
  check(wrong.status === 401 && /Senha incorreta/.test(wrong.text), 'senha errada recusada');
  const right = await request(port2, 'POST', '/entrar', 'senha=segredo-teste&volta=%2F%3Find%3Dsc_sc', {'Content-Type': 'application/x-www-form-urlencoded'});
  const cookie = String(right.headers['set-cookie'] || '').split(';')[0];
  check(right.status === 303 && right.headers.location === '/?ind=sc_sc' && /^jt_painel=/.test(cookie), 'senha certa entra e volta para a página pedida');
  const authed = await request(port2, 'POST', '/api/run', {fn: 'getAppBootstrap', args: []}, {Cookie: cookie});
  check(authed.status === 200 && JSON.parse(authed.text).ok, 'API com login funciona');
  const evil = await request(port2, 'POST', '/entrar', 'senha=segredo-teste&volta=%2F%2Fevil.example', {'Content-Type': 'application/x-www-form-urlencoded'});
  check(evil.headers.location === '/', 'não redireciona para outro site depois do login');
  srv2.child.kill();

  srv.child.kill();
  cleanup();
  console.log('OK: ' + passed + ' verificações da versão Node.js passaram (' + Math.round((Date.now() - t0) / 1000) + ' s; JMS simulado por HTTP).');
  process.exit(0);
})().catch(e => { console.error('FALHOU: ' + (e && e.stack || e)); cleanup(); process.exit(1); });
