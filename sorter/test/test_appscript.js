'use strict';
/**
 * Testes da versão Apps Script do Painel do Sorter: a ponte (lib/ponte.js) lê o sorter FALSO e manda para um Apps Script
 * FALSO (os mesmos Codigo.gs e Resumo.gs, num vm), e o getDados do Apps Script tem que devolver os MESMOS números do
 * painel local (/api/dados). Números fictícios. Uso: node test/test_appscript.js   (VERBOSE=1 mostra cada verificação)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const assert = require('assert');
const {spawn} = require('child_process');
const R = require('../lib/resumo');
const {criarPonte} = require('../lib/ponte');
const {BALANCAS, startFakeSorter} = require('./sorter_falso');
const {criarGas, startFakeGas} = require('./gas_falso');

const ROOT = path.join(__dirname, '..');
let passed = 0;
function check(cond, name, extra) {
  if (!cond) { console.error('FALHOU: ' + name, extra === undefined ? '' : extra); process.exitCode = 1; throw new Error(name); }
  passed++; if (process.env.VERBOSE) console.log('ok: ' + name);
}
function igual(a, b) { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } }
function semAlgunsCampos(res) {
  // O que tem que bater entre o painel local e o Apps Script (o resto é de cada um: cache, hora da leitura, ponte).
  const bal = {};
  (res.balancas || []).forEach(b => { bal[b.id] = [b.total, b.valid, b.abnormal, b.noInfo]; });
  return {ok: res.ok, from: res.from, to: res.to, prevFrom: res.prevFrom, prevTo: res.prevTo, sorter: res.sorter, balanca: res.balanca,
    rows: res.rows, prevRows: res.prevRows, rowsByDevice: res.rowsByDevice || null, bal,
    devices: (res.devices || []).map(d => [d.id, !!d.ok, !!d.pendente, !!d.fora])};
}
function unpackRes(res) {
  if (!res.pacote) return res;
  const o = Object.assign({}, res);
  o.rows = R.unpack(res.rows); o.prevRows = res.prevRows ? R.unpack(res.prevRows) : null;
  if (res.rowsByDevice) { o.rowsByDevice = {}; Object.keys(res.rowsByDevice).forEach(k => { o.rowsByDevice[k] = R.unpack(res.rowsByDevice[k]); }); }
  return o;
}

(async function main() {
  const t0 = Date.now();
  const TODAY = '2026-10-15', NOW = TODAY + ' 15:30:00';
  process.env.SORTER_AGORA = NOW;

  // ---------- 1. Arquivos do projeto Apps Script ----------
  const gen = require('../gerar-appscript.js').arquivos();
  const dif = Object.keys(gen).filter(f => fs.readFileSync(path.join(ROOT, 'appscript', f), 'utf8') !== gen[f]);
  check(!dif.length, 'appscript/ igual à página do painel local (node gerar-appscript.js)', dif);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'appscript', 'appsscript.json'), 'utf8'));
  check(manifest.runtimeVersion === 'V8' && manifest.timeZone === 'America/Sao_Paulo' && manifest.webapp.access === 'ANYONE_ANONYMOUS' &&
    manifest.webapp.executeAs === 'USER_DEPLOYING' && manifest.oauthScopes.join() === 'https://www.googleapis.com/auth/spreadsheets',
    'appsscript.json: V8, São Paulo, App da Web para qualquer pessoa (a ponte entra sem login), só a permissão da planilha');
  const codigo = fs.readFileSync(path.join(ROOT, 'appscript', 'Codigo.gs'), 'utf8');
  check(!/UrlFetchApp|10\.1\.166/.test(codigo.replace(/^\s*\*.*$/gm, '')), 'Codigo.gs não tenta ler o sorter (o Google não enxerga a rede da base)');
  const g = criarGas({agora: NOW});
  const semConfig = g.chamar('api_', 'estado', {chave: 'x'});
  const cf = g.chamar('configurar'), cf2 = g.chamar('configurar');
  check(!semConfig.ok && /configurar\(\)/.test(semConfig.error) && cf.chave.length === 40 && cf2.chave === cf.chave && g.aba() &&
    g.aba().rows[0][0] === 'Data' && g.logs.some(l => l.indexOf(cf.chave) >= 0), 'configurar(): cria a planilha e a chave (a mesma ao rodar de novo)', cf);
  const w = {};
  vm.runInNewContext(g.chamar('resumoSource_'), {window: w});
  check(typeof w.SorterResumo.unpack === 'function' && w.SorterResumo.isoWeek('2027-01-03') === '2026-W53', 'a página recebe o mesmo Resumo do servidor (resumoSource_)');
  const page = g.ctx.doGet({parameter: {sorter: 'todos', lang: 'zh', x: '<script>', tv: '1'}});
  const boot = JSON.parse(page.s.match(/window\.__SORTER__ = (\{.*?\});<\/script>/)[1]);
  check(page.kind === 'html' && page.title === 'J&T · Sorter' && page.metas.viewport && !/<\?/.test(page.s) && boot.gas === true &&
    igual(boot.params, {sorter: 'todos', lang: 'zh', tv: '1'}) && boot.lerSegundos === 300 && boot.hoje === TODAY &&
    page.s.indexOf('function SorterResumoFactory_') > 0 && page.s.indexOf('google.script.run') > 0 && page.s.indexOf('.kpi-grid') > 0,
    'doGet: página com estilo, script, Resumo e a configuração (link filtrado)');

  // ---------- 2. Ponte → Apps Script (histórico e hoje) ----------
  const fake = await startFakeSorter({today: TODAY, nowHour: 15, maxPage: 500});
  const gas = await startFakeGas(g);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sorter-gas-'));
  const cfgFile = path.join(tmp, 'config.json');
  const troca = {pagina: '/home', metodo: 'POST', caminho: '/device/switch', corpo: 'device=A'};
  const sorters = [{id: 'B', nome: 'Sorter B', nomeZh: '分拣机 B套', padrao: true}, {id: 'A', nome: 'Sorter A', nomeZh: '分拣机 A套', troca}];
  fs.writeFileSync(cfgFile, JSON.stringify({sorterUrl: fake.url, maxBalancas: 10, sorters, appsScriptUrl: gas.url, chavePonte: cf.chave, diasHistorico: 40}));
  process.env.SORTER_CONFIG = cfgFile;
  const srv = require('../server.js');
  const cfg = srv.loadConfig();
  const gravado = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  check(cfg.appsScriptUrl === gas.url && cfg.enviarMinutos === 60 && cfg.diasHistorico === 40 && gravado.enviarMinutos === 60 && 'verificarSegundos' in gravado,
    'config.json: campos do Apps Script (e os que faltavam entram no arquivo com o padrão)');
  const estado = srv.criarEstado(cfg);
  const deps = {agora: srv.agora, addDays: srv.addDays, daysBetween: srv.daysBetween, pronto: srv.pronto, versao: srv.VERSAO, log: () => {}, loteBytes: 300000};
  const ponte = criarPonte(cfg, estado, deps);
  const r1 = await ponte.enviar({force: true});
  const sh = g.aba(), linhas = sh.rows.slice(1);
  const hojeB = linhas.find(r => r[0] === TODAY && r[1] === 'B');
  const dB = await estado.dados({de: TODAY, ate: TODAY, sorter: 'B'});
  check(r1.dias === 80 && r1.porSorter.B === 40 && r1.porSorter.A === 40 && linhas.length === 80 && gas.posts >= 2 &&
    hojeB && hojeB[2] === NOW && hojeB[4] === R.sumRows(dB.rows).total && hojeB[6] === R.sumRows(dB.rows).noInfo && hojeB[7] === BALANCAS.B.length &&
    String(hojeB[8]).indexOf('gz:') === 0, 'primeira vez: 40 dias de cada sorter, em lotes, um dia por linha (com os totais legíveis)', {dias: r1.dias, posts: gas.posts, linha: hojeB && hojeB.slice(0, 8)});
  check(typeof linhas[0][0] === 'string' && typeof linhas[0][2] === 'string' && typeof linhas[0][3] === 'string', 'data e "recebido em" ficam como texto na planilha (sem virar data)');
  const info = JSON.parse(g.props.INFO);
  check(info.sorters.map(s => s.id + (s.pronto ? '+' : '-')).join() === 'B+,A+' && info.enviarMinutos === 60 && info.versaoPonte === srv.VERSAO &&
    info.sorters[0].balancas.join() === BALANCAS.B.join(), 'status dos sorters guardado (pronto, balanças, versão da ponte)');
  const posts1 = gas.posts;
  const r2 = await ponte.enviar({});
  check(r2.dias === 2 && gas.posts === posts1 + 1 && g.aba().rows.length === 81, 'depois: só hoje de cada sorter (dias fechados não vão de novo)', r2);

  // ---------- 3. getDados (Apps Script) = /api/dados (painel local) ----------
  const consultas = [
    {de: TODAY, ate: TODAY, sorter: 'B'},
    {de: TODAY, ate: TODAY, sorter: 'A'},
    {de: TODAY, ate: TODAY, sorter: 'todos'},
    {de: '2026-10-09', ate: TODAY, sorter: 'todos', balanca: 'B:3'},
    {de: '2026-10-09', ate: TODAY, sorter: 'B', turnos: 'T1'},
    {de: '2026-10-01', ate: '2026-10-10', sorter: 'todos', hIni: '22', hFim: '5'},
    {de: '2026-09-25', ate: '2026-10-05', sorter: 'A', balanca: 'A:5', turnos: 'T3'}
  ];
  for (const q of consultas) {
    const local = await estado.dados(q), apps = unpackRes(g.chamar('getDados', q));
    const a = semAlgunsCampos(local), b = semAlgunsCampos(apps);
    check(igual(a, b), 'getDados igual ao painel local: ' + JSON.stringify(q), !igual(a, b) && Object.keys(a).filter(k => !igual(a[k], b[k])));
  }
  const ap = g.chamar('getDados', {de: TODAY, ate: TODAY, sorter: 'todos'});
  const tamanho = JSON.stringify(ap).length, tamanhoLocal = JSON.stringify(await estado.dados({de: TODAY, ate: TODAY, sorter: 'todos'})).length;
  check(ap.pacote && Array.isArray(ap.rows.d) && ap.fetchedAt === NOW && ap.ponte.ligada && tamanho < tamanhoLocal / 2,
    'resposta compactada para a página (menos da metade do tamanho)', {tamanho, tamanhoLocal});
  const longo = g.chamar('getDados', {de: '2026-08-01', ate: TODAY, sorter: 'B'});
  check(longo.ok && longo.from === '2026-08-01' && longo.prevRows === null && /faltam 36 dia\(s\)/.test(longo.devices[0].aviso),
    'período maior que o histórico: aviso dos dias que faltam, sem comparação errada', longo.devices[0]);
  // Leituras seguintes: o dia vem do cache (a planilha só é lida para o que mudou).
  let lidas = 0;
  const orig = sh.getRange;
  sh.getRange = function (r, c, nr, nc) { if (c === 9) lidas++; return orig.call(this, r, c, nr, nc); };
  g.chamar('getDados', {de: '2026-10-09', ate: TODAY, sorter: 'todos'});
  sh.getRange = orig;
  check(lidas === 0, 'dias já lidos vêm do cache (6 h; muda quando a ponte manda o dia de novo)', lidas);

  // ---------- 4. Botão Atualizar: pedido → ponte → planilha ----------
  g.agora = TODAY + ' 15:40:00';
  await ponte.rodar('teste');
  g.agora = TODAY + ' 15:41:00';
  const ped = g.chamar('pedirAtualizacao');
  const antes = g.chamar('getDados', {de: TODAY, ate: TODAY, sorter: 'B', desde: ped.em});
  g.agora = TODAY + ' 15:41:20';
  await ponte.verificar();
  const depois = g.chamar('getDados', {de: TODAY, ate: TODAY, sorter: 'B', desde: ped.em});
  const postsAntes = gas.posts;
  await ponte.verificar();
  check(ped.ok && ped.ligada && ped.em === TODAY + ' 15:41:00' && !antes.novo && depois.novo && depois.dadosEm === TODAY + ' 15:41:20' && gas.posts === postsAntes,
    'Atualizar: a página deixa o pedido, a ponte lê o sorter na hora e o painel vê o dado novo (uma vez só)', {antes: antes.novo, depois: depois.dadosEm});
  g.agora = TODAY + ' 15:50:00';
  const off = g.chamar('pedirAtualizacao'), offDados = g.chamar('getDados', {de: TODAY, ate: TODAY, sorter: 'B'});
  check(!off.ligada && off.vista === TODAY + ' 15:41:20' && !offDados.ponte.ligada && offDados.ok, 'ponte desligada há mais de 3 min: o painel avisa e mostra o que já chegou');
  g.agora = TODAY + ' 15:41:30';

  // ---------- 5. Planilha: células grandes, troca de linha, dias antigos, data convertida ----------
  let x = 7;
  const rnd = () => { x = (x * 48271) % 2147483647; return x; };
  const grande = {date: '2026-10-14', device: 'B', t: R.pack(makeRows('2026-10-14', rnd)), b: {}};
  for (let n = 1; n <= 60; n++) grande.b[n] = R.pack(makeRows('2026-10-14', rnd));
  const rg = g.chamar('api_', 'dados', {chave: cf.chave, dias: [grande], sorters: info.sorters, enviarMinutos: 60});
  const lg = g.aba().rows.find(r => r[0] === '2026-10-14' && r[1] === 'B');
  const dGrande = unpackRes(g.chamar('getDados', {de: '2026-10-14', ate: '2026-10-14', sorter: 'B', balanca: 'B:60'}));
  check(rg.ok && lg.slice(8).filter(Boolean).length >= 2 && igual(dGrande.rows, R.unpack(grande.b[60])), 'dia maior que uma célula: dividido em várias colunas e lido de volta igual',
    lg.slice(8).map(v => String(v).length));
  // O mesmo dia de novo, pequeno: as partes velhas ficam vazias.
  const dB14 = await estado.dados({de: '2026-10-14', ate: '2026-10-14', sorter: 'B'});
  g.chamar('api_', 'dados', {chave: cf.chave, dias: [{date: '2026-10-14', device: 'B', t: R.pack(dB14.rows), b: {}}], sorters: info.sorters});
  const lg2 = g.aba().rows.find(r => r[0] === '2026-10-14' && r[1] === 'B');
  const g14 = unpackRes(g.chamar('getDados', {de: '2026-10-14', ate: '2026-10-14', sorter: 'B'}));
  check(lg2.slice(9).every(v => v === '') && igual(g14.rows, dB14.rows), 'dia reenviado menor (no mesmo segundo): sobra das partes antigas limpa e o cache não serve a versão velha',
    lg2.slice(8).map(v => String(v).length));
  const velho = {date: '2025-08-01', device: 'B', t: R.pack(makeRows('2025-08-01', rnd)), b: {}};
  g.chamar('api_', 'dados', {chave: cf.chave, dias: [velho], sorters: info.sorters});
  check(!g.aba().rows.some(r => r[0] === '2025-08-01'), 'dias com mais de 400 dias saem da planilha');
  const linhaA = g.aba().rows.findIndex(r => r[0] === '2026-10-10' && r[1] === 'A');
  g.aba().rows[linhaA][0] = new g.CDate(Date.parse('2026-10-10T00:00:00-03:00'));   // alguém mexeu e a célula virou data
  g.aba().rows[linhaA][2] = new g.CDate(Date.parse('2026-10-15T15:30:00-03:00'));
  const conv = unpackRes(g.chamar('getDados', {de: '2026-10-10', ate: '2026-10-10', sorter: 'A'}));
  check(conv.ok && conv.rows.length === 24 && conv.rows[0].date === '2026-10-10', 'célula de data convertida pelo Planilhas ainda é lida');

  // ---------- 6. Sorter A sem troca, chave errada, implantação sem acesso anônimo ----------
  fs.writeFileSync(cfgFile, JSON.stringify({sorterUrl: fake.url, maxBalancas: 10, appsScriptUrl: gas.url, chavePonte: cf.chave, diasHistorico: 3}));
  const cfgP = srv.loadConfig(), ponteP = criarPonte(cfgP, srv.criarEstado(cfgP), deps);
  await ponteP.enviar({});
  const pA = g.chamar('getDados', {de: TODAY, ate: TODAY, sorter: 'A'}), pT = unpackRes(g.chamar('getDados', {de: TODAY, ate: TODAY, sorter: 'todos'}));
  const bootP = JSON.parse(g.ctx.doGet({parameter: {}}).s.match(/window\.__SORTER__ = (\{.*?\});<\/script>/)[1]);
  check(!pA.ok && pA.devices[0].pendente && /Falta configurar como trocar para o Sorter A/.test(pA.error) && pT.ok &&
    R.sumRows(pT.rows).total === R.sumRows(dB.rows).total && bootP.sorters.map(s => s.id + (s.pronto ? '+' : '-')).join() === 'B+,A-',
    'Sorter A sem troca na ponte: aviso no painel; Todos juntos com o B; a página já abre com o A marcado');
  const errada = criarPonte(Object.assign({}, cfg, {chavePonte: 'x'.repeat(40)}), estado, deps);
  let e1 = ''; try { await errada.enviar({}); } catch (e) { e1 = e.message; }
  gas.modo = 'login';
  let e2 = ''; try { await ponte.enviar({}); } catch (e) { e2 = e.message; }
  gas.modo = '';
  const naoAnda = criarPonte(Object.assign({}, cfg, {appsScriptUrl: 'http://127.0.0.1:9/macros/s/X/exec'}), estado, deps);
  let e3 = ''; try { await naoAnda.enviar({}); } catch (e) { e3 = e.message; }
  check(/chave da ponte inválida/.test(e1) && /Qualquer pessoa/.test(e2) && /internet/.test(e3), 'chave errada, implantação sem acesso anônimo e sem internet: mensagem clara', [e1, e2, e3]);
  const msgs = [{appsScriptUrl: 'https://script.google.com/macros/s/abc/edit', chavePonte: cf.chave}, {appsScriptUrl: gas.url, chavePonte: 'curta'}]
    .map(c => { fs.writeFileSync(cfgFile, JSON.stringify(c)); try { srv.loadConfig(); return ''; } catch (e) { return e.message; } });
  check(/termina em \/exec/.test(msgs[0]) && /chavePonte/.test(msgs[1]), 'config.json: URL que não é do App da Web e chave vazia são recusadas', msgs);
  check(ponte.blocos(['2026-01-01', '2026-01-02', '2026-01-05']).length === 2 && ponte.blocos(Array.from({length: 40}, (v, i) => srv.addDays('2026-01-01', i))).length === 2,
    'dias que faltam em blocos seguidos de até 31 dias');
  const ph = new Date(ponte.proximoHorario(60));
  check(ph.getMinutes() === 1 && ph > new Date() && ph - new Date() <= 61 * 60000, 'envio programado no minuto 1 de cada hora (a hora anterior já fechou)', ph);

  // ---------- 7. testar.bat com o Apps Script ----------
  fs.writeFileSync(cfgFile, JSON.stringify({sorterUrl: fake.url, maxBalancas: 10, sorters, appsScriptUrl: gas.url, chavePonte: cf.chave, diasHistorico: 2}));
  const tst = await new Promise(resolve => {
    const ch = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--teste'], {env: Object.assign({}, process.env), stdio: ['ignore', 'pipe', 'pipe']});
    let so = '';
    ch.stdout.on('data', d => { so += d; }); ch.stderr.on('data', d => { so += d; });
    ch.on('exit', code => resolve({code, so}));
  });
  check(tst.code === 0 && /— Apps Script/.test(tst.so) && /OK: \d+ dia\(s\) enviados · planilha: https:\/\/docs\.google\.com/.test(tst.so), 'testar.bat manda uma vez para o Apps Script e mostra a planilha', tst.so);

  fake.server.close(); gas.server.close();
  fs.rmSync(tmp, {recursive: true, force: true});
  console.log('OK: ' + passed + ' verificações da versão Apps Script passaram (' + Math.round((Date.now() - t0) / 1000) + ' s; sorter e Apps Script simulados).');
})().catch(e => { if (!process.exitCode) console.error(e); process.exit(1); });

/** 24 linhas com números aleatórios (não comprimem bem: testam o limite da célula). */
function makeRows(date, rnd) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    const r = {date, time: (h < 10 ? '0' : '') + h + ':00', hour: h, ps: {PS01: rnd() % 99999, PS02: rnd() % 99999, PS03: rnd() % 99999}};
    R.NUMS.forEach(f => { r[f] = rnd() % 999999; });
    out.push(r);
  }
  return out;
}
