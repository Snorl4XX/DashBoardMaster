'use strict';
/**
 * Testes do Painel do Sorter (separado do DashMaster): soma e agrupamentos, leitura do sorter (sessão e troca de
 * dispositivo), filtros (sorter A/B/todos, balança, turno, horário) e o servidor por HTTP, contra um sorter FALSO
 * (números fictícios). Uso: node test/test_sorter.js   (VERBOSE=1 mostra cada verificação)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const zlib = require('zlib');
const {spawn} = require('child_process');
const R = require('../lib/resumo');
const S = require('../lib/sorter');
const {BALANCAS, makeDay, sumSiteRows, startFakeSorter} = require('./sorter_falso');

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
function runTeste(env) {
  // Assíncrono: o sorter falso roda neste mesmo processo e precisa responder enquanto o --teste espera.
  return new Promise(resolve => {
    const ch = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--teste'], {env, stdio: ['ignore', 'pipe', 'pipe']});
    let so = '', se = '';
    ch.stdout.on('data', x => { so += x; }); ch.stderr.on('data', x => { se += x; });
    ch.on('exit', code => resolve({status: code, stdout: so, stderr: se}));
  });
}
const sumOf = (raw, k) => raw.reduce((a, r) => a + r[k], 0);
const days = (a, b) => { const o = []; for (let d = a; d <= b; d = S_add(d, 1)) o.push(d); return o; };
function S_add(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

(async function main() {
  const t0 = Date.now();
  const TODAY = '2026-10-15', NOW = TODAY + ' 15:30:00';
  const raw = makeDay(TODAY, {uptoHour: 15});
  const rows = raw.map(S.normalizeRow);

  // ---------- 1. Leitura de uma linha e endereço da consulta ----------
  check(rows.length === 24 && rows[4].date === TODAY && rows[4].time === '04:00' && rows[4].hour === 4 && rows[4].total === raw[4].sorter_sorttotal &&
    rows[4].valid === raw[4].sorter_validtotal && rows[4].chuteBlock === raw[4].sorter_chuteblocktotal && rows[4].noInfo === raw[4].sorter_noinfototal &&
    rows[4].noPlan === raw[4].sorter_noplantotal && rows[4].noRead === raw[4].noread && rows[4].ps.PS01 === raw[4].ps01_sorttotal &&
    Object.keys(rows[4].ps).join() === 'PS01,PS02,PS03', 'linha do sorter → campos do painel (Sort/Valid total, No Sort Code, motivos, Layer)', rows[4]);
  check(S.normalizeRow({timearea: 'x'}) === null && S.normalizeRow({timearea: '2026-10-15 07:00:00~2026-10-15 07:59:59'}).total === 0, 'linha sem horário é ignorada; campo ausente = 0');
  check(S.urlFor('http://10.1.166.9', TODAY, TODAY, 1) === 'http://10.1.166.9/statis/summary.data?page=1&limit=1000&start=2026-10-15%2000%3A00%3A00&end=2026-10-15%2023%3A59%3A59&group=60&inductionno=0&layerno=0' &&
    /&group=0&inductionno=7&layerno=0$/.test(S.urlFor('http://10.1.166.9', TODAY, TODAY, 2, {group: 0, inductionno: 7})),
    'endereço igual ao da tela do sorter (time group by, Induction No., By Layer)');

  // ---------- 2. Soma e agrupamentos (os mesmos da página) ----------
  const s = R.summarize(rows, {});
  check(s.total === sumOf(raw, 'sorter_sorttotal') && s.valid === sumOf(raw, 'sorter_validtotal') && s.abnormal === sumOf(raw, 'sorter_abnormaltotal') &&
    s.noInfo === sumOf(raw, 'sorter_noinfototal') && s.reasons.chuteBlock === sumOf(raw, 'sorter_chuteblocktotal') && s.ps.PS01 + s.ps.PS02 + s.ps.PS03 === s.total,
    'totais, motivos e andares iguais à resposta');
  check(R.REASONS.reduce((a, k) => a + s.reasons[k], 0) === s.abnormal && s.total - s.valid === s.abnormal, 'anormais = Sort − Valid = soma dos motivos');
  check(R.SHIFTS.reduce((a, k) => a + s.byShift[k].total, 0) === s.total && s.byShift.T3.total === raw.filter((r, h) => h >= 22 || h < 6).reduce((a, r) => a + r.sorter_sorttotal, 0) &&
    s.byShift.T1.total === raw.slice(6, 14).reduce((a, r) => a + r.sorter_sorttotal, 0) && s.byShift.T2.noInfo === raw.slice(14, 22).reduce((a, r) => a + r.sorter_noinfototal, 0),
    'turnos pela hora: T1 06–14h, T2 14–22h, T3 22–06h');
  check(R.summarize(rows, {uptoHour: 9}).total === raw.slice(0, 10).reduce((a, r) => a + r.sorter_sorttotal, 0) && s.byHour[16].total === 0 &&
    s.peak.total === Math.max.apply(null, raw.map(r => r.sorter_sorttotal)) && s.hoursActive === raw.filter(r => r.sorter_sorttotal > 0).length,
    'até uma hora (comparação), horas futuras zeradas, pico e horas ativas');
  // Filtros de turno e horário.
  const fT1 = R.filterRows(rows, {turnos: ['T1']}), fT3 = R.filterRows(rows, {turnos: ['T3']});
  const fH = R.filterRows(rows, {horaIni: 8, horaFim: 10}), fWrap = R.filterRows(rows, {horaIni: 22, horaFim: 5});
  check(fT1.length === 8 && fT1[0].hour === 6 && fT3.length === 8 && R.sumRows(fT1).total === s.byShift.T1.total && fH.map(r => r.hour).join() === '8,9,10' &&
    fWrap.map(r => r.hour).join() === '0,1,2,3,4,5,22,23' && R.filterRows(rows, {turnos: ['T1'], horaIni: 12, horaFim: 15}).map(r => r.hour).join() === '12,13' &&
    R.filterRows(rows, {}).length === 24, 'filtro de turno e horário (00h–23:59:59; 22h→05h passa da meia-noite)');
  // Todos juntos.
  const rowsA = makeDay(TODAY, {device: 'A', uptoHour: 15}).map(S.normalizeRow);
  const merged = R.mergeRows([rows, rowsA]);
  check(merged.length === 24 && merged[7].total === rows[7].total + rowsA[7].total && merged[7].ps.PS02 === rows[7].ps.PS02 + rowsA[7].ps.PS02 &&
    R.sumRows(merged).noInfo === s.noInfo + R.sumRows(rowsA).noInfo && R.mergeRows([rows, []]).length === 24, 'todos juntos: soma A + B na mesma data e hora');
  // Periodicidade: semana ISO, mês, trimestre.
  check(R.isoWeek('2027-01-03') === '2026-W53' && R.isoWeek('2024-12-30') === '2025-W01' && R.isoWeek('2026-10-15') === '2026-W42' &&
    R.periodKey('2026-10-15', 'month') === '2026-10' && R.periodKey('2026-10-15', 'quarter') === '2026-Q4' && R.periodKey('2026-03-31', 'quarter') === '2026-Q1' &&
    R.periodKey('2026-10-15', 'day') === '2026-10-15', 'chaves do período: dia, semana ISO, mês, trimestre');
  const many = [];
  days('2026-09-21', '2026-10-04').forEach(d => makeDay(d).forEach(r => many.push(S.normalizeRow(r))));
  const wk = R.byPeriod(many, 'week'), mo = R.byPeriod(many, 'month'), dy = R.byPeriod(many, 'day');
  check(dy.length === 14 && wk.length === 2 && wk[0].key === '2026-W39' && wk[0].from === '2026-09-21' && wk[0].to === '2026-09-27' && wk[1].to === '2026-10-04' &&
    mo.length === 2 && mo[0].key === '2026-09' && mo[1].from === '2026-10-01' && wk[0].total + wk[1].total === R.sumRows(many).total &&
    mo[0].total === dy.slice(0, 10).reduce((a, g) => a + g.total, 0), 'diário / semanal / mensal: blocos, datas e somas');
  // Tempo (time group by).
  const t1 = R.byTime(rows, 1), t3 = R.byTime(rows, 3), t0g = R.byTime(rows, 0), t24 = R.byTime(many, 24);
  check(t1.length === 24 && t1[5].key === TODAY + ' 05' && t3.length === 8 && t3[2].hour === 6 && t3[2].hours === 3 &&
    t3[2].total === rows[6].total + rows[7].total + rows[8].total && t0g.length === 1 && t0g[0].total === s.total && t0g[0].hours === 0 &&
    t24.length === 14 && t24[0].total === dy[0].total && R.byTime(rows, 6).map(g => g.hour).join() === '0,6,12,18', 'tempo: sem agrupamento, 1 h, 3 h, 6 h, 1 dia');

  // ---------- 3. Configuração ----------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sorter-test-'));
  const cfgNew = path.join(tmp, 'novo.json');
  const env0 = process.env.SORTER_CONFIG;
  process.env.SORTER_CONFIG = cfgNew;
  const srvMod = require('../server.js');
  const c0 = srvMod.loadConfig();
  check(fs.existsSync(cfgNew) && c0.porta === 3100 && c0.sorterUrl === 'http://10.1.166.9' && c0.atualizarSegundos === 3600 && c0.balancas === 'auto' &&
    c0.sorters.map(x => x.id).join() === 'B,A' && srvMod.pronto(c0.sorters[0]) && !srvMod.pronto(c0.sorters[1]) && c0.sorters[1].url === 'http://10.1.166.9',
    'config.json criado com o padrão (porta 3100, 1 hora, Sorter B pronto, Sorter A falta a troca)', c0);
  const bads = [{sorterUrl: 'javascript:alert(1)'}, {sorters: [{id: 'B'}, {id: 'B'}]}, {sorters: [{id: 'a b'}]}, {sorters: [{id: 'A', sorterUrl: 'ftp://x'}]}];
  const msgs = bads.map(b => { fs.writeFileSync(cfgNew, JSON.stringify(b)); try { srvMod.loadConfig(); return ''; } catch (e) { return e.message; } });
  check(/sorterUrl/.test(msgs[0]) && /mesmo "id"/.test(msgs[1]) && /id/.test(msgs[2]) && /sorterUrl/.test(msgs[3]), 'configuração inválida é recusada com mensagem clara', msgs);
  fs.writeFileSync(cfgNew, JSON.stringify({porta: 3100, host: '0.0.0.0', sorterUrl: 'http://10.1.166.9', nome: 'Sorter B', nomeZh: '分拣机 B套',
    atualizarSegundos: 60, cacheSegundos: 45, maxDias: 31}));
  const cV1 = srvMod.loadConfig(), gravado = JSON.parse(fs.readFileSync(cfgNew, 'utf8'));
  check(cV1.atualizarSegundos === 3600 && cV1.maxDias === 92 && cV1.cacheSegundos === 120 && cV1.sorters.map(x => x.id).join() === 'B,A' &&
    Array.isArray(gravado.sorters) && gravado.atualizarSegundos === 3600 && gravado.nome === undefined, 'config.json da V1 passa sozinho para a V2 (1 hora, 92 dias, sorters A e B)', gravado);
  fs.writeFileSync(cfgNew, '{x');
  let badJson = ''; try { srvMod.loadConfig(); } catch (e) { badJson = e.message; }
  check(/JSON válido/.test(badJson), 'config.json quebrado: mensagem clara', badJson);

  // ---------- 4. Sessão e troca de dispositivo (sorter falso) ----------
  const fake = await startFakeSorter({today: TODAY, nowHour: 15, maxPage: 100, delayMs: 20});
  const devA = {id: 'A', nome: 'Sorter A', troca: {pagina: '/home', metodo: 'POST', caminho: '/device/switch', corpo: 'device=A'}};
  const sA = new S.Sessao(fake.url, devA);
  await Promise.all([sA.garantir(), sA.garantir(), sA.garantir()]);
  const gotA = await S.fetchRange(fake.url, TODAY, TODAY, {sessao: sA});
  check(fake.trocas.length === 1 && fake.trocas[0].okToken && fake.trocas[0].body === 'device=A' && sA.cookies.laravel_session &&
    gotA.length === 24 && R.sumRows(gotA).total === R.sumRows(rowsA).total && fake.calls[fake.calls.length - 1].device === 'A',
    'troca para o Sorter A: abre a sessão, manda X-XSRF-TOKEN do próprio cookie do site (uma troca só) e lê o A', fake.trocas);
  await sA.garantir();
  check(fake.trocas.length === 1, 'troca não se repete antes de 10 min');
  const sCk = new S.Sessao(fake.url, {id: 'A', troca: {cookie: {device: 'A'}}});
  await sCk.garantir();
  const gotCk = await S.fetchRange(fake.url, TODAY, TODAY, {sessao: sCk});
  const gotB = await S.fetchRange(fake.url, TODAY, TODAY, {});
  check(R.sumRows(gotCk).total === R.sumRows(rowsA).total && R.sumRows(gotB).total === s.total && R.sumRows(gotB).total !== R.sumRows(rowsA).total,
    'troca por cookie; sem troca = o dispositivo padrão do site (B)');
  let bad419 = '';
  try { await new S.Sessao(fake.url, {id: 'A', nome: 'Sorter A', troca: {metodo: 'GET', caminho: '/device/switch'}}).garantir(); } catch (e) { bad419 = e.message; }
  check(/recusou a troca para o Sorter A \(HTTP 419/.test(bad419), 'troca recusada pelo site: mensagem clara', bad419);
  const b3 = await S.fetchRange(fake.url, TODAY, TODAY, {inductionno: 3}), g0 = await S.fetchRange(fake.url, '2026-10-10', TODAY, {group: 0});
  const all6 = []; days('2026-10-10', TODAY).forEach(d => makeDay(d, d === TODAY ? {uptoHour: 15} : {}).forEach(r => all6.push(r)));
  check(R.sumRows(b3).total === sumOf(makeDay(TODAY, {balanca: 3, uptoHour: 15}), 'sorter_sorttotal') && R.sumRows(b3).total < s.total &&
    g0.length === 1 && g0[0].total === sumOf(all6, 'sorter_sorttotal') && g0[0].date === '2026-10-10', 'balança (inductionno) e "no group by" (uma linha)');

  // ---------- 5. Estado do servidor: filtros A / B / todos, balança, turno, horário ----------
  process.env.SORTER_AGORA = NOW;
  const cfgFile = path.join(tmp, 'config.json');
  const sorters = [{id: 'B', nome: 'Sorter B', nomeZh: '分拣机 B套', padrao: true}, {id: 'A', nome: 'Sorter A', nomeZh: '分拣机 A套', troca: devA.troca}];
  fs.writeFileSync(cfgFile, JSON.stringify({sorterUrl: fake.url + '/', cacheSegundos: 45, maxBalancas: 10, sorters}));
  process.env.SORTER_CONFIG = cfgFile;
  const cfg = srvMod.loadConfig();
  const st = srvMod.criarEstado(cfg);
  const totB = s.total, totA = R.sumRows(rowsA).total;
  let n0 = fake.calls.length;
  const dB = await st.dados({de: TODAY, ate: TODAY, sorter: 'B'});
  const balB = makeDay(TODAY, {balanca: 0, uptoHour: 15});
  check(dB.ok && dB.sorter === 'B' && dB.from === TODAY && dB.now === NOW && dB.prevFrom === '2026-10-14' && dB.rows.length === 24 && dB.prevRows.length === 24 &&
    R.sumRows(dB.rows).total === totB && !dB.rowsByDevice && dB.devices.length === 1 && dB.devices[0].ok && dB.cached === false,
    'Sorter B hoje: linhas, dia anterior e status do dispositivo', {err: dB.error});
  check(dB.balancas.map(b => b.id).join() === BALANCAS.B.map(n => 'B:' + n).join() && dB.devices[0].balancas.join() === BALANCAS.B.join() &&
    dB.balancas.reduce((a, b) => a + b.total, 0) === totB && dB.balancas.reduce((a, b) => a + b.noInfo, 0) === sumOf(balB, 'sorter_noinfototal') &&
    dB.balancas[2].total === sumOf(makeDay(TODAY, {balanca: 3, uptoHour: 15}), 'sorter_sorttotal'),
    'balanças descobertas sozinhas (só as com produção) e o total de cada uma (Sort total, No Sort Code)', dB.balancas);
  const discCalls = fake.calls.slice(n0).filter(c => /group=0/.test(c.url));
  check(discCalls.length === 11 && discCalls.every(c => /start=2026-10-09/.test(c.url)), 'descoberta: uma consulta "no group by" por balança nos últimos 7 dias', discCalls.length);
  const dA = await st.dados({de: TODAY, ate: TODAY, sorter: 'A'});
  check(dA.ok && dA.sorter === 'A' && R.sumRows(dA.rows).total === totA && dA.balancas.map(b => b.id).join() === BALANCAS.A.map(n => 'A:' + n).join() &&
    fake.trocas.filter(t => t.okToken && t.method === 'POST').length === 2, 'Sorter A pelo servidor (sessão própria com a troca)', {err: dA.error});
  const dT = await st.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  check(dT.ok && dT.sorter === 'todos' && R.sumRows(dT.rows).total === totA + totB && dT.rows[9].total === rows[9].total + rowsA[9].total &&
    Object.keys(dT.rowsByDevice).sort().join() === 'A,B' && R.sumRows(dT.rowsByDevice.A).total === totA && dT.balancas.length === BALANCAS.A.length + BALANCAS.B.length &&
    R.sumRows(dT.prevRows).total === R.sumRows(dB.prevRows).total + R.sumRows(dA.prevRows).total, 'Todos juntos: soma A + B, separado por sorter e balanças dos dois');
  const dBal = await st.dados({de: TODAY, ate: TODAY, sorter: 'todos', balanca: 'B:3'});
  check(dBal.ok && dBal.balanca === 'B:3' && R.sumRows(dBal.rows).total === dB.balancas[2].total && dBal.devices.find(x => x.id === 'A').fora &&
    !dBal.rowsByDevice.A && dBal.balancas.every(b => b.device === 'B'), 'balança escolhida: só as linhas dela (o outro sorter fica de fora)');
  const dTurno = await st.dados({de: TODAY, ate: TODAY, sorter: 'B', turnos: 'T1'});
  const dHora = await st.dados({de: TODAY, ate: TODAY, sorter: 'B', hIni: '22', hFim: '5'});
  const b1rows = makeDay(TODAY, {balanca: 1, uptoHour: 15});
  check(dTurno.rows.length === 24 && dTurno.balancas[0].total === b1rows.slice(6, 14).reduce((a, r) => a + r.sorter_sorttotal, 0) &&
    dHora.balancas[0].total === b1rows.filter((r, h) => h >= 22 || h <= 5).reduce((a, r) => a + r.sorter_sorttotal, 0) && !dTurno.devices[0].balancaSemFiltro,
    'turno e horário aplicados ao total de cada balança (as linhas por hora vêm inteiras para a página filtrar)');
  // Cache, Atualizar e várias telas ao mesmo tempo.
  n0 = fake.calls.length;
  const dB2 = await st.dados({de: TODAY, ate: TODAY, sorter: 'B'});
  const n1 = fake.calls.length;
  const dB3 = await st.dados({de: TODAY, ate: TODAY, sorter: 'B', forcar: true});
  check(dB2.cached && n1 === n0 && !dB3.cached && fake.calls.length - n1 === 1 + BALANCAS.B.length, 'cache: outra tela não consulta de novo; Atualizar consulta hoje (o anterior e a descoberta seguem guardados)',
    {n0, n1, n2: fake.calls.length});
  n0 = fake.calls.length;
  const sete = await Promise.all([1, 2, 3, 4, 5].map(() => st.dados({de: '2026-10-09', ate: TODAY, sorter: 'B'})));
  check(sete.every(x => x.ok && x.rows.length === 168) && new Set(sete[0].rows.map(r => r.date + r.time)).size === 168 && sete[0].prevFrom === '2026-10-02' &&
    fake.calls.length - n0 === 2 + 2 + BALANCAS.B.length * 2, '5 telas pedindo 7 dias ao mesmo tempo: uma consulta de cada (páginas de 100)', fake.calls.length - n0);
  // Datas e período longo.
  const fut = await st.dados({de: '2026-10-14', ate: '2026-12-01', sorter: 'B'});
  const inval = await st.dados({de: 'xx', ate: '2026-13-45', sorter: 'B'});
  n0 = fake.calls.length;
  const longo = await st.dados({de: '2026-06-01', ate: TODAY, sorter: 'B', turnos: 'T2'});
  const longCalls = fake.calls.slice(n0);
  check(fut.to === TODAY && inval.from === TODAY && inval.to === TODAY && longo.from === '2026-07-16' && longo.rows.length === 92 * 24 &&
    longo.devices[0].balancaSemFiltro === true && longCalls.filter(c => /inductionno=[1-9]/.test(c.url)).every(c => /group=0/.test(c.url)) &&
    longo.balancas.reduce((a, b) => a + b.total, 0) === R.sumRows(longo.rows).total, 'período até hoje, no máximo 92 dias; acima de 31 dias, balanças com uma linha cada (sem turno)',
    [fut.to, inval.from, longo.from, longo.devices[0]]);

  // Sorter A sem a troca configurada.
  fs.writeFileSync(cfgFile, JSON.stringify({sorterUrl: fake.url, maxBalancas: 10, balancas: [1, 2, 3]}));
  const stP = srvMod.criarEstado(srvMod.loadConfig());
  const pA = await stP.dados({de: TODAY, ate: TODAY, sorter: 'A'}), pT = await stP.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  check(!pA.ok && pA.devices[0].pendente && /Falta configurar como trocar para o Sorter A/.test(pA.error) && pT.ok && R.sumRows(pT.rows).total === totB &&
    pT.devices.find(x => x.id === 'A').pendente && pT.balancas.map(b => b.id).join() === 'B:1,B:2,B:3', 'Sorter A sem troca: aviso claro; Todos juntos segue com o B; lista de balanças do config.json');
  // Site que ignora o filtro de balança.
  fs.writeFileSync(cfgFile, JSON.stringify({sorterUrl: fake.url, maxBalancas: 4}));
  const stI = srvMod.criarEstado(srvMod.loadConfig());
  fake.mode = 'semBalanca';
  const ign = await stI.dados({de: TODAY, ate: TODAY, sorter: 'B'});
  fake.mode = '';
  check(ign.ok && /não separou por balança/.test(ign.devices[0].balancaErro) && ign.balancas.length === 0, 'site que ignora a balança: aviso (sem números errados)', ign.devices[0]);
  // Erros: recusa, página de login, sorter fora do ar.
  fake.mode = 'code';
  const eCode = await stI.dados({de: TODAY, ate: TODAY, sorter: 'B', forcar: true});
  fake.mode = 'html';
  const eHtml = await stI.dados({de: TODAY, ate: TODAY, sorter: 'B', forcar: true});
  fake.mode = '';
  check(!eCode.ok && /recusou/.test(eCode.error) && !eHtml.ok && /JSON/.test(eHtml.error), 'recusa e página de login: mensagem clara', [eCode.error, eHtml.error]);
  delete process.env.SORTER_AGORA;
  if (env0 === undefined) delete process.env.SORTER_CONFIG; else process.env.SORTER_CONFIG = env0;

  // ---------- 6. Servidor por HTTP ----------
  const port = await freePort();
  fs.writeFileSync(cfgFile, JSON.stringify({porta: port, host: '127.0.0.1', sorterUrl: fake.url, maxBalancas: 10, atualizarSegundos: 3600, sorters}));
  const env = Object.assign({}, process.env, {SORTER_CONFIG: cfgFile, SORTER_AGORA: NOW});
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 50 && !/Abra no navegador/.test(out); i++) await new Promise(r => setTimeout(r, 100));
    check(/Abra no navegador/.test(out) && out.indexOf('http://localhost:' + port) >= 0 && /Sorter B, Sorter A/.test(out), 'servidor no ar e mostra o endereço', out);
    const saude = await json(port, '/saude');
    check(saude.ok && saude.versao === srvMod.VERSAO && saude.agora.date === TODAY && saude.sorters.every(x => x.pronto), '/saude', saude);
    const page = await get(port, '/', {'Accept-Encoding': 'gzip'});
    const html = zlib.gunzipSync(page.buf).toString('utf8');
    const boot = JSON.parse(html.match(/window\.__SORTER__ = (\{.*?\});<\/script>/)[1]);
    check(page.status === 200 && page.headers['content-encoding'] === 'gzip' && html.indexOf('__SORTER_BOOT__') < 0 && boot.hoje === TODAY && boot.atualizarSegundos === 3600 &&
      boot.sorters.map(x => x.id + (x.pronto ? '+' : '-')).join() === 'B+,A+' && /src="resumo\.js"/.test(html) && /src="app\.js"/.test(html) &&
      ['fSorter', 'fBalanca', 'fTurno', 'fHoraIni', 'fHoraFim', 'fPer', 'fTempo'].every(id => html.indexOf('id="' + id + '"') >= 0), 'página com a configuração, os 7 filtros e os scripts');
    const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    // google.script.run aparece só para o projeto Apps Script do PRÓPRIO sorter (getDados/pedirAtualizacao).
    check(!/Client\.html|getDashboardData|getAppBootstrap|JTCore|INDICATORS/.test(html + appJs) && /api\/dados\?/.test(appJs) &&
      /\.getDados\(q\)/.test(appJs) && /\.pedirAtualizacao\(\)/.test(appJs), 'página não chama nada do DashMaster');
    const js = await get(port, '/app.js'), css = await get(port, '/app.css'), rs = await get(port, '/resumo.js');
    check(js.status === 200 && /javascript/.test(js.headers['content-type']) && css.status === 200 && /css/.test(css.headers['content-type']) &&
      rs.status === 200 && /SorterResumo/.test(rs.text), 'arquivos da página (app.js, app.css, resumo.js)');
    const api = await json(port, '/api/dados?de=' + TODAY + '&ate=' + TODAY + '&sorter=todos&balanca=&turnos=T1&hIni=6&hFim=9');
    check(api.ok && api.sorter === 'todos' && R.sumRows(api.rows).total === totA + totB && api.balancas.length === BALANCAS.A.length + BALANCAS.B.length &&
      api.balancas.find(b => b.id === 'B:1').total === b1rows.slice(6, 10).reduce((a, r) => a + r.sorter_sorttotal, 0), '/api/dados com os filtros (todos, turno, horário)');
    check((await get(port, '/nada')).status === 404 && (await get(port, '/api/dados', {}, 'POST')).status === 405, '404 e só GET');
  } finally {
    child.kill();
  }
  await new Promise(r => fake.server.close(r));
  // Sorter fora do ar: mensagem rápida.
  fs.writeFileSync(cfgFile, JSON.stringify({sorterUrl: fake.url, maxBalancas: 3}));
  process.env.SORTER_CONFIG = cfgFile;
  const tDown = Date.now();
  const eDown = await srvMod.criarEstado(srvMod.loadConfig()).dados({sorter: 'B'});
  check(!eDown.ok && /rede da base/.test(eDown.error) && eDown.error.indexOf(fake.url) >= 0 && Date.now() - tDown < 10000, 'sorter fora do ar: mensagem clara e rápida', eDown.error);
  if (env0 === undefined) delete process.env.SORTER_CONFIG; else process.env.SORTER_CONFIG = env0;

  // ---------- 7. node server.js --teste (testar.bat) ----------
  const fake2 = await startFakeSorter({today: TODAY, nowHour: 15});
  fs.writeFileSync(cfgFile, JSON.stringify({sorterUrl: fake2.url, maxBalancas: 10}));
  const tst = await runTeste(env);
  check(tst.status === 0 && new RegExp('Total ' + totB + ' · válidos ' + s.valid + ' · No Sort Code ' + s.noInfo + ' · anormais ' + s.abnormal).test(tst.stdout) &&
    /Andares: PS01 \d+ · PS02 \d+ · PS03 \d+/.test(tst.stdout) && new RegExp('Balanças: ' + BALANCAS.B.join(', ')).test(tst.stdout) &&
    /Sorter A[\s\S]*falta configurar a troca/.test(tst.stdout), 'testar.bat (node server.js --teste) mostra os totais, as balanças e o que falta configurar', tst.stdout + tst.stderr);
  fake2.server.close();
  fs.rmSync(tmp, {recursive: true, force: true});
  console.log('OK: ' + passed + ' verificações do Painel do Sorter passaram (' + Math.round((Date.now() - t0) / 1000) + ' s; sorter simulado por HTTP).');
})().catch(e => { if (!process.exitCode) console.error(e); process.exit(1); });
