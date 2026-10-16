'use strict';
/**
 * Testes do Painel do Sorter (separado do DashMaster): soma dos números, leitura do sorter e o servidor por HTTP, contra
 * um sorter FALSO (números fictícios). Uso: node test/test_sorter.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const {spawn} = require('child_process');
const R = require('../lib/resumo');
const S = require('../lib/sorter');
const {makeDay, startFakeSorter} = require('./sorter_falso');

const ROOT = path.join(__dirname, '..');
let passed = 0;
function check(cond, name, extra) {
  if (!cond) { console.error('FALHOU: ' + name, extra === undefined ? '' : extra); process.exitCode = 1; throw new Error(name); }
  passed++; if (process.env.VERBOSE) console.log('ok: ' + name);
}
function get(port, p, headers, method) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, path: p, method: method || 'GET', headers: headers || {}}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks), text: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
    req.end();
  });
}
const json = async (port, p) => JSON.parse((await get(port, p)).text);
function freePort() { return new Promise(r => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }

(async function main() {
  const t0 = Date.now();
  const TODAY = '2026-10-15', NOW = TODAY + ' 15:30:00';
  const raw = makeDay(TODAY, {uptoHour: 15});
  const rows = raw.map(S.normalizeRow);

  // ---------- 1. Leitura de uma linha e endereço da consulta ----------
  check(rows.length === 24 && rows[4].date === TODAY && rows[4].time === '04:00' && rows[4].hour === 4 && rows[4].total === raw[4].sorter_sorttotal &&
    rows[4].chuteBlock === raw[4].sorter_chuteblocktotal && rows[4].noInfo === raw[4].sorter_noinfototal && rows[4].ps.PS01 === raw[4].ps01_sorttotal &&
    Object.keys(rows[4].ps).join() === 'PS01,PS02,PS03', 'linha do sorter → campos do painel (hora, total, motivos, PS)', rows[4]);
  check(S.normalizeRow({timearea: 'x'}) === null && S.normalizeRow({timearea: '2026-10-15 07:00:00~2026-10-15 07:59:59'}).total === 0, 'linha sem horário é ignorada; campo ausente = 0');
  check(S.urlFor('http://10.1.166.9', TODAY, TODAY, 1) === 'http://10.1.166.9/statis/summary.data?page=1&limit=1000&start=2026-10-15%2000%3A00%3A00&end=2026-10-15%2023%3A59%3A59&group=60&inductionno=0&layerno=0',
    'endereço igual ao da tela do sorter (dia inteiro, uma linha por hora, todas as entradas e andares)');

  // ---------- 2. Soma (a mesma da página) ----------
  const s = R.summarize(rows, {});
  const tot = k => raw.reduce((a, r) => a + r[k], 0);
  check(s.total === tot('sorter_sorttotal') && s.valid === tot('sorter_validtotal') && s.abnormal === tot('sorter_abnormaltotal') &&
    s.reasons.chuteBlock === tot('sorter_chuteblocktotal') && s.reasons.intercept === tot('intercept') && s.ps.PS01 + s.ps.PS02 + s.ps.PS03 === s.total,
    'totais, motivos e PS iguais à resposta');
  check(R.REASONS.reduce((a, k) => a + s.reasons[k], 0) === s.abnormal && s.total - s.valid === s.abnormal, 'anormais = total − válidos = soma dos motivos');
  check(R.SHIFTS.reduce((a, k) => a + s.byShift[k].total, 0) === s.total && s.byShift.T3.total === raw.filter((r, h) => h >= 22 || h < 6).reduce((a, r) => a + r.sorter_sorttotal, 0) &&
    s.byShift.T1.total === raw.slice(6, 14).reduce((a, r) => a + r.sorter_sorttotal, 0), 'turnos pela hora: T1 06–13h, T2 14–21h, T3 22–05h');
  check(R.summarize(rows, {uptoHour: 9}).total === raw.slice(0, 10).reduce((a, r) => a + r.sorter_sorttotal, 0) && s.byHour[16].total === 0 &&
    s.peak.total === Math.max.apply(null, raw.map(r => r.sorter_sorttotal)) && s.hoursActive === raw.filter(r => r.sorter_sorttotal > 0).length,
    'até uma hora (comparação), horas futuras zeradas, hora de pico e horas ativas');
  const two = R.summarize(rows.concat(makeDay('2026-10-14').map(S.normalizeRow)), {});
  check(two.byDay.length === 2 && two.byDay[0].date === '2026-10-14' && two.byDay[1].total === s.total, 'por dia, em ordem');

  // ---------- 3. Configuração ----------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sorter-test-'));
  const cfgNew = path.join(tmp, 'novo.json');
  const env0 = process.env.SORTER_CONFIG;
  process.env.SORTER_CONFIG = cfgNew;
  const srvMod = require('../server.js');
  const c0 = srvMod.loadConfig();
  check(fs.existsSync(cfgNew) && c0.porta === 3100 && c0.sorterUrl === 'http://10.1.166.9' && c0.nome === 'Sorter B', 'config.json criado com o padrão (porta 3100, sorter 10.1.166.9)', c0);
  fs.writeFileSync(cfgNew, JSON.stringify({sorterUrl: 'javascript:alert(1)'}));
  let bad = '';
  try { srvMod.loadConfig(); } catch (e) { bad = e.message; }
  check(/sorterUrl/.test(bad), 'endereço do sorter inválido é recusado', bad);
  if (env0 === undefined) delete process.env.SORTER_CONFIG; else process.env.SORTER_CONFIG = env0;

  // ---------- 4. Servidor por HTTP contra o sorter falso ----------
  const fake = await startFakeSorter({today: TODAY, nowHour: 15, maxPage: 100, delayMs: 150});
  const port = await freePort(), cfgFile = path.join(tmp, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({porta: port, host: '127.0.0.1', sorterUrl: fake.url + '/', nome: 'Sorter B', cacheSegundos: 45, atualizarSegundos: 60}));
  const env = Object.assign({}, process.env, {SORTER_CONFIG: cfgFile, SORTER_AGORA: NOW});
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 50 && !/Abra no navegador/.test(out); i++) await new Promise(r => setTimeout(r, 100));
    check(/Abra no navegador/.test(out) && out.indexOf('http://localhost:' + port) >= 0, 'servidor no ar e mostra o endereço', out);
    const saude = await json(port, '/saude');
    check(saude.ok && saude.versao === srvMod.VERSAO && saude.sorterUrl === fake.url && saude.agora.date === TODAY, '/saude', saude);

    const page = await get(port, '/', {'Accept-Encoding': 'gzip'});
    const html = require('zlib').gunzipSync(page.buf).toString('utf8');
    check(page.status === 200 && page.headers['content-encoding'] === 'gzip' && /window\.__SORTER__ = \{"nome":"Sorter B"/.test(html) && html.indexOf('__SORTER_BOOT__') < 0 &&
      /"hoje":"2026-10-15"/.test(html) && /src="resumo\.js"/.test(html) && /src="app\.js"/.test(html), 'página com a configuração (nome, hoje) e os scripts');
    check(!/google\.script|Client\.html|getDashboardData|getAppBootstrap|\.gs['"]/.test(html + fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8')), 'página não chama nada do DashMaster');
    const js = await get(port, '/app.js'), css = await get(port, '/app.css'), rs = await get(port, '/resumo.js');
    check(js.status === 200 && /javascript/.test(js.headers['content-type']) && css.status === 200 && /css/.test(css.headers['content-type']) &&
      rs.status === 200 && /SorterResumo/.test(rs.text), 'arquivos da página (app.js, app.css, resumo.js)');

    // Hoje: 24 linhas, dia anterior para comparar, endereço da consulta.
    const n0 = fake.calls.length;
    const d = await json(port, '/api/dados?de=' + TODAY + '&ate=' + TODAY);
    const sd = R.summarize(d.rows, {});
    check(d.ok && d.from === TODAY && d.to === TODAY && d.today === TODAY && d.now === NOW && d.prevFrom === '2026-10-14' && d.prevTo === '2026-10-14' &&
      d.rows.length === 24 && d.prevRows.length === 24 && sd.total === s.total && sd.abnormal === s.abnormal && d.cached === false,
      'hoje: linhas do sorter, totais e o dia anterior', {ok: d.ok, err: d.error, n: d.rows && d.rows.length});
    check(fake.calls.length === n0 + 2 && fake.calls[n0].indexOf('/statis/summary.data?page=1&limit=1000&start=2026-10-15%2000%3A00%3A00&end=2026-10-15%2023%3A59%3A59&group=60&inductionno=0&layerno=0') === 0,
      'servidor consulta o sorter com o endereço da tela', fake.calls.slice(n0));
    // Cache e Atualizar.
    const n1 = fake.calls.length;
    const d2 = await json(port, '/api/dados?de=' + TODAY + '&ate=' + TODAY);
    const n2 = fake.calls.length;
    const d3 = await json(port, '/api/dados?de=' + TODAY + '&ate=' + TODAY + '&forcar=1');
    check(d2.cached === true && n2 === n1 && d3.cached === false && fake.calls.length === n1 + 1, 'cache: outra tela não consulta de novo; Atualizar consulta o dia (o anterior segue do cache)',
      {n1, n2, n3: fake.calls.length});
    // Várias telas ao mesmo tempo, período novo de 7 dias (168 linhas, páginas de 100): uma consulta só.
    const n3 = fake.calls.length;
    const seven = await Promise.all([1, 2, 3, 4, 5].map(() => json(port, '/api/dados?de=2026-10-09&ate=' + TODAY)));
    check(seven.every(x => x.ok && x.rows.length === 168) && new Set(seven[0].rows.map(r => r.date + r.time)).size === 168 && fake.calls.length === n3 + 4 &&
      seven[0].prevFrom === '2026-10-02' && seven[0].prevTo === '2026-10-08', '5 telas pedindo 7 dias ao mesmo tempo: uma consulta (2 páginas + 2 do período anterior)', fake.calls.length - n3);
    // Datas: até hoje, no máximo 31 dias, data inválida = hoje.
    const fut = await json(port, '/api/dados?de=2026-10-14&ate=2026-12-01');
    const long = await json(port, '/api/dados?de=2026-08-01&ate=' + TODAY);
    const inval = await json(port, '/api/dados?de=xx&ate=2026-13-45');
    check(fut.to === TODAY && long.from === '2026-09-15' && long.rows.length === 31 * 24 && inval.from === TODAY && inval.to === TODAY,
      'período até hoje, no máximo 31 dias; data inválida vira hoje', [fut.to, long.from, inval.from]);
    // Erros: recusa, página de login, sorter fora do ar (mensagem rápida).
    fake.mode = 'code';
    const eCode = await json(port, '/api/dados?de=' + TODAY + '&ate=' + TODAY + '&forcar=1');
    fake.mode = 'html';
    const eHtml = await json(port, '/api/dados?de=' + TODAY + '&ate=' + TODAY + '&forcar=1');
    fake.mode = '';
    await new Promise(r => fake.server.close(r));
    const tDown = Date.now();
    const eDown = await json(port, '/api/dados?de=' + TODAY + '&ate=' + TODAY + '&forcar=1');
    check(!eCode.ok && /recusou/.test(eCode.error) && !eHtml.ok && /JSON/.test(eHtml.error) && !eDown.ok && /rede da base/.test(eDown.error) &&
      eDown.error.indexOf(fake.url) >= 0 && Date.now() - tDown < 10000, 'recusa, página de login e sorter fora do ar: mensagem clara', [eCode.error, eHtml.error, eDown.error]);
    check((await get(port, '/nada')).status === 404 && (await get(port, '/api/dados', {}, 'POST')).status === 405, '404 e só GET');
  } finally {
    child.kill();
  }

  // ---------- 5. node server.js --teste ----------
  const fake2 = await startFakeSorter({today: TODAY, nowHour: 15});
  fs.writeFileSync(cfgFile, JSON.stringify({porta: port, host: '127.0.0.1', sorterUrl: fake2.url}));
  // Assíncrono: o sorter falso roda neste mesmo processo e precisa responder enquanto o --teste espera.
  const tst = await new Promise(resolve => {
    const ch = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--teste'], {env, stdio: ['ignore', 'pipe', 'pipe']});
    let so = '', se = '';
    ch.stdout.on('data', x => { so += x; }); ch.stderr.on('data', x => { se += x; });
    ch.on('exit', code => resolve({status: code, stdout: so, stderr: se}));
  });
  check(tst.status === 0 && new RegExp('Total ' + s.total + ' · válidos ' + s.valid + ' · anormais ' + s.abnormal).test(tst.stdout) && /PS: PS01 \d+ · PS02 \d+ · PS03 \d+/.test(tst.stdout),
    'testar.bat (node server.js --teste) mostra os totais de hoje', tst.stdout + tst.stderr);
  fake2.server.close();
  fs.rmSync(tmp, {recursive: true, force: true});
  console.log('OK: ' + passed + ' verificações do Painel do Sorter passaram (' + Math.round((Date.now() - t0) / 1000) + ' s; sorter simulado por HTTP).');
})().catch(e => { if (!process.exitCode) console.error(e); process.exit(1); });
