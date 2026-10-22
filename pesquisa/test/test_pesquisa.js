#!/usr/bin/env node
'use strict';
/* Testes da Pesquisa no Rastreamento (dados FICTÍCIOS; JMS falso por HTTP). Uso: node test/test_pesquisa.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const http = require('http');
const ROOT = path.join(__dirname, '..');
const {criar, bipes, segmento, TOKEN} = require('./jms_falso');

// O servidor do app lê o endereço do JMS (simulado) ao carregar: definir antes do require.
let jmsPorta = 0;
const R = require('../lib/rastreio');
const P = require('../lib/pesquisa');
const X = require('../lib/planilha');

let passed = 0;
function check(cond, name, extra) { if (!cond) { console.error('FALHOU: ' + name, extra === undefined ? '' : extra); process.exit(1); } passed++; }
const WS = n => Array.from({length: n}, (_, i) => 'FIC' + String(i).padStart(9, '0'));
const PATS = ['A encomenda expressa está [ SP GRU] sendo enviada', 'O expresso chegou [SP GRU] A parada anterior foi'];

/** "Servidor" para os testes da página: fala direto com o JMS falso (como o api/consultar do app). `chamadas` = pedidos por chamada. */
function apiFalsa(porta, token) {
  const local = u => u.replace(/^https:\/\/[^/]+/, 'http://127.0.0.1:' + porta), chamadas = [];
  return {
    chamadas,
    paralelos: [], emVoo: 0, maxEmVoo: 0,
    consultar(pedidos, opcoes) {
      chamadas.push(pedidos.length);
      this.paralelos.push(opcoes && opcoes.paralelo);
      this.emVoo++;
      this.maxEmVoo = Math.max(this.maxEmVoo, this.emVoo);
      const fim = r => { this.emVoo--; return r; };
      // Como o servidor do app: no máximo `paralelo` consultas ao mesmo tempo.
      const um = p => fetch(local(p.url), {method: 'POST', headers: Object.assign({'Content-Type': 'application/json', authtoken: token || TOKEN},
        p.headers || {}), body: JSON.stringify(p.body)}).then(async r => ({status: r.status, text: await r.text()}));
      const out = new Array(pedidos.length), par = Math.max(1, Math.min(100, (opcoes && opcoes.paralelo) || 50));
      let prox = 0;
      const trab = async () => { while (prox < pedidos.length) { const i = prox++; out[i] = await um(pedidos[i]); } };
      return Promise.all(Array.from({length: Math.min(par, pedidos.length)}, trab)).then(() => out).then(fim);
    }
  };
}
function unzip(bytes) {
  const out = {}, b = Buffer.from(bytes);
  let at = 0;
  while (b.readUInt32LE(at) === 0x04034b50) {
    const method = b.readUInt16LE(at + 8), csize = b.readUInt32LE(at + 18), nlen = b.readUInt16LE(at + 26), elen = b.readUInt16LE(at + 28);
    const name = b.slice(at + 30, at + 30 + nlen).toString('utf8'), data = b.slice(at + 30 + nlen + elen, at + 30 + nlen + elen + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    at += 30 + nlen + elen + csize;
  }
  return out;
}
function wellFormed(xml) {
  const stack = [], re = /<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g, body = xml.replace(/^<\?xml[^>]*\?>/, '');
  let m;
  while ((m = re.exec(body))) { if (m[3]) continue; if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]); }
  return !stack.length && !/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(body);
}
function request(porta, method, p, body, headers) {
  return new Promise((ok, ko) => {
    const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const r = http.request({host: '127.0.0.1', port: porta, method, path: p, headers: Object.assign(data ? {'Content-Type': 'application/json'} : {}, headers || {})}, res => {
      const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => ok({status: res.statusCode, headers: res.headers, text: Buffer.concat(ch).toString('utf8')}));
    });
    r.on('error', ko);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // ---------- 1. Regras (rastreio.js) ----------
  const m1 = R.matcher(PATS[0]);
  check(m1('A encomenda expressa está [SP GRU] sendo enviada, para [MT FIC]') && m1('a ENCOMENDA expressa esta [sp gru ]  sendo enviada') &&
    !m1('A encomenda expressa está [PA FIC-SP] sendo enviada, para [SP GRU]'), 'padrão: colchete com espaço, acento e maiúscula não importam; outra base não vale');
  check(R.matcher('está [*] sendo enviada')('A encomenda expressa está [PA FIC] sendo enviada') && R.matcher(' ') === null, 'padrão com * e padrão vazio');
  const d2 = bipes('FIC000000002', 2), h2 = R.hit(d2, R.matcher(PATS[1]));
  check(h2.t === '2026-09-09 14:36:12' && h2.shift === 'T2' && h2.n === 2 && h2.origin === 'SP GRU' && h2.by === 'RECEBEDOR FICTICIO 2' && h2.img && h2.raw === undefined,
    'sempre o PRIMEIRO bipe com o padrão (o JMS manda do mais novo para o mais antigo)', h2);
  const semCampos = R.hit([{scanTime: '2026-09-09 07:00:00', imgType: '', waybillTrackingContent: 'O expresso chegou [SP GRU] A parada anterior foi [], escaneador [FICTICIO X]'}], R.matcher(PATS[1]));
  check(semCampos.origin === 'SP GRU' && semCampos.by === 'FICTICIO X' && semCampos.img === false && semCampos.shift === 'T1', 'origem e escaneador pela descrição; sem imgType = sem imagem');
  check(R.parseWaybills('fic1234 , FIC1234;FIC9999\n\n x  abc').list.join() === 'FIC1234,FIC9999', 'remessas coladas sem repetir');
  const sm = R.summary([{ok: true, p: [null, Object.assign({}, h2, {shift: 'T1', t: '2026-09-09 07:00:00'})]}, {ok: true, p: [null, h2]}, {ok: false, p: [null, null]},
    {ok: true, p: [null, Object.assign({}, h2, {shift: 'T1', t: '2026-09-09 08:00:00'})]}], 1);
  check(sm.total === 4 && sm.yes === 3 && sm.none === 1 && sm.top === 'T1' && sm.topCount === 2 && sm.hours[14] === 1 && sm.scanners[0].value === 3, 'resumo do bloco', sm);
  const kinds = [[200, '{"code":401,"msg":"token失效"}'], [302, ''], [200, '<html>'], [503, ''], [200, '{"code":500,"msg":"máximo 30"}']].map(([s, t]) => {
    try { R.parseJms(s, t); return 'ok'; } catch (e) { return e.kind; }
  });
  check(kinds.join() === 'auth,auth,auth,temp,refused', 'respostas do JMS: token vencido, login, indisponível, recusa', kinds);
  // ---------- 2. Pesquisa (pesquisa.js) com o JMS falso ----------
  const jms = await criar({});
  jmsPorta = jms.porta;
  const api = apiFalsa(jms.porta), lista = WS(120).concat(['NAOEXISTE0001', 'NAOEXISTE0002']);
  const r0 = await P.pesquisar(api, lista, PATS, {espera: 0});
  const kw0 = jms.estado.chamadas.filter(c => c.rota === 'keywordList');
  check(r0.results.length === 122 && !r0.faltam.length && r0.results.filter(x => x.p[0]).length === 80 && r0.results.filter(x => x.p[1]).length === 120 &&
    r0.results.filter(x => !x.ok).length === 2 && kw0.map(c => c.n).join() === '100,22,2,1,1', 'pesquisa: 100 remessas por consulta (as que não voltaram são conferidas de novo, e no fim mais uma vez, uma a uma), tem/não tem por bloco',
    kw0.map(c => c.n));
  check(r0.results[0].w === 'FIC000000000' && r0.results[1].p[0].t === '2026-09-09 15:00:00' && r0.results[2].p[1].t === '2026-09-09 14:36:12', 'na ordem colada, primeiro bipe');
  const limites = async (opts, n) => {
    const j = await criar(opts), lotes = [];
    const r = await P.pesquisar(apiFalsa(j.porta), WS(n || 120), PATS, {espera: 0, onLote: x => lotes.push(x)});
    const c = j.estado.chamadas.filter(x => x.rota === 'keywordList').length;
    await j.fechar();
    return {r, lotes, c};
  };
  const lr = await limites({reject: 30});
  check(lr.r.results.length === 120 && lr.r.results.filter(x => x.p[1]).length === 120 && lr.r.lote === 25 && lr.lotes.join() === '50,25',
    'JMS recusa lotes grandes: limite aprendido e nenhuma remessa perdida', lr.lotes);
  const ls = await limites({silent: 40});
  check(ls.r.results.filter(x => x.p[1]).length === 120 && ls.r.lote === 25, 'JMS devolve vazio acima do limite: a metade que responde vira o limite', ls.lotes);
  const lc = await limites({trunc: 25});
  check(lc.r.results.filter(x => x.p[1]).length === 120 && !lc.r.faltam.length, 'JMS devolve só as primeiras: as outras voltam para a fila');
  const jb = await criar({}), fake = Array.from({length: 300}, (_, i) => 'NAOEXISTE' + String(i).padStart(4, '0')), lotesB = [];
  const rb = await P.pesquisar(apiFalsa(jb.porta), fake, PATS, {espera: 0, onLote: x => lotesB.push(x)});
  const cb = jb.estado.chamadas.filter(x => x.rota === 'keywordList').length;
  await jb.fechar();
  check(rb.results.length === 300 && rb.results.every(x => !x.ok) && cb <= 400 && !lotesB.length, 'remessas coladas erradas: "sem rastreamento", poucas consultas, limite igual', cb);
  const jr = await criar({rota: 'trackingExpress'}), heads = [];
  const rr = await P.pesquisar(apiFalsa(jr.porta), WS(20), PATS, {espera: 0, onHeaders: h => heads.push(h)});
  await jr.fechar();
  check(rr.results.filter(x => x.p[1]).length === 20 && heads[0] && heads[0].routename === 'trackingExpress', 'cabeçalho de rota da tela testado sozinho e guardado', heads);
  const jp = await criar({rota: 'packageTracking'}), headsP = [];
  const rpk = await P.pesquisar(apiFalsa(jp.porta), WS(10), PATS, {espera: 0, onHeaders: h => headsP.push(h)});
  await jp.fechar();
  check(rpk.results.filter(x => x.p[1]).length === 10 && headsP[0].routename === 'packageTracking' && P.ROUTE_VARIANTS.length === 3,
    'as 3 variantes de rota do DashMaster (trackingExpress, waybillTracking, packageTracking)', headsP);
  let eTok = null;
  try { await P.pesquisar(apiFalsa(jms.porta, 'TOKEN-VENCIDO'), WS(10), PATS, {espera: 0}); } catch (e) { eTok = e; }
  check(eTok && eTok.kind === 'auth' && /AuthToken/.test(eTok.message), 'token vencido: a pesquisa para com o aviso', eTok && eTok.message);
  let parou = 0;
  const rp = await P.pesquisar(api, WS(500), PATS, {espera: 0, porChamada: 100, chamadas: 1, parar: () => ++parou > 2});
  check(rp.results.length === 200 && rp.faltam.length === 300 && rp.faltam[0] === 'FIC000000200', 'Parar: o que foi pesquisado fica; o resto pode continuar depois', rp.results.length);
  let eVazio = '';
  try { await P.pesquisar(api, WS(3), ['', ' '], {}); } catch (e) { eVazio = e.message; }
  check(/texto padrão/.test(eVazio), 'sem padrão: aviso');
  // Como a tela do JMS: uma remessa por consulta (antes: "de 4 em 4"). Aprende isso e mantém 6 chamadas ao servidor ao mesmo tempo.
  const j1 = await criar({trunc: 1}), api1 = apiFalsa(j1.porta), lotes1 = [], prog1 = [];
  const r1 = await P.pesquisar(api1, WS(2500), PATS, {espera: 0, onLote: x => lotes1.push(x), onProgresso: f => prog1.push(f)});
  const kw1 = j1.estado.chamadas.filter(c => c.rota === 'keywordList'), od1 = j1.estado.chamadas.filter(c => c.rota === 'getOrderDetail');
  await j1.fechar();
  check(r1.results.filter(x => x.p[1]).length === 2500 && !r1.faltam.length && lotes1.join() === '1' && Math.max(...api1.chamadas) <= 400 &&
    api1.maxEmVoo === 4 && prog1[prog1.length - 1] === 2500 && prog1.every((x, i) => !i || x >= prog1[i - 1]) && kw1.length === 2500 && od1.length === 2500 &&
    r1.consultas === 5000, 'JMS devolve uma remessa por consulta: aprende sozinho; 4 chamadas ao servidor ao mesmo tempo, até 400 consultas cada',
    {chamadas: api1.chamadas.length, max: Math.max(...api1.chamadas), emVoo: api1.maxEmVoo, lotes1});
  // Informação básica: bloco "3 Segmentos" sem o 3º.
  const sg = r1.results.slice(0, 3).map(x => x.seg);
  check(sg[0].s1 === 'XA' && sg[0].s2 === '101-01' && sg[1].s1 === 'XB' && sg[1].s2 === '202-02' && sg[2].s1 === 'XC - SP' && sg[2].s2 === '303-03' &&
    JSON.stringify(sg).indexOf('900') < 0 && JSON.stringify(sg).indexOf('901') < 0 && r1.semSeg === 0,
    'segmentos de cada remessa: Código de primeiro segmento e Código de dois segmentos (o 3º fica de fora)', sg);
  // Já começando com uma remessa por consulta (como a página faz): 1000 por rodada desde a 1ª.
  const j1b = await criar({trunc: 1}), api1b = apiFalsa(j1b.porta), prog1b = [], pars = [];
  const r1b = await P.pesquisar(api1b, WS(2500), PATS, {espera: 0, lote: 1, onProgresso: f => prog1b.push(f), onParalelo: n => pars.push(n)});
  await j1b.fechar();
  check(r1b.results.filter(x => x.p[1]).length === 2500 && api1b.chamadas.length === 13 && api1b.chamadas.every(n => n <= 400) && prog1b.length === 13 &&
    api1b.paralelos[0] === 10 && Math.max(...api1b.paralelos) === 40 && pars.join() === '13,17,22,28,35,40' && r1b.paralelo === 40,
    'começando com 1 por consulta: 200 remessas por chamada; consultas ao mesmo tempo sobem de 10 para 40 enquanto o JMS responde bem',
    {chamadas: api1b.chamadas, paralelos: api1b.paralelos, pars});
  // Cabeçalho de rota exigido, com 6 chamadas ao mesmo tempo: uma testa, as outras esperam o resultado; nada fica como "recusada".
  const jr6 = await criar({rota: 'waybillTracking'}), api6 = apiFalsa(jr6.porta), heads6 = [];
  const r6 = await P.pesquisar(api6, WS(1500), PATS, {espera: 0, lote: 1, onHeaders: h => heads6.push(h)});
  await jr6.fechar();
  check(r6.results.filter(x => x.p[1]).length === 1500 && !r6.results.some(x => x.err) && heads6.length === 1 && heads6[0].routename === 'waybillTracking' && api6.maxEmVoo === 4,
    'cabeçalho de rota com várias chamadas ao mesmo tempo: achado uma vez e usado por todas', {heads6, err: r6.results.filter(x => x.err).length});
  // O JMS não dá conta (consultas demais ao mesmo tempo): responde vazio ou recusa. Nada pode virar "sem rastreamento" calado.
  const ocup = async modo => {
    const j = await criar({ocupado: 30, ocupadoModo: modo, atraso: 15}), a = apiFalsa(j.porta), ps = [];
    const r = await P.pesquisar(a, WS(300), PATS, {espera: 0, lote: 1, paralelo: 40, onParalelo: n => ps.push(n)});
    const oc = j.estado.ocupadas || 0;
    await j.fechar();
    return {r, ps, oc};
  };
  const ov = await ocup('vazio'), orc = await ocup('recusa');
  check(ov.oc > 0 && ov.r.results.filter(x => x.p[1]).length === 300 && !ov.r.results.some(x => x.err || !x.ok) && ov.r.revistas > 0 &&
    ov.r.achadasRevisao === ov.r.revistas && ov.ps.length && ov.ps[ov.ps.length - 1] < 40,
    'JMS sobrecarregado responde VAZIO: a conferência no fim (devagar) acha todas e o ritmo guardado cai',
    {oc: ov.oc, revistas: ov.r.revistas, achadas: ov.r.achadasRevisao, ps: ov.ps, semDados: ov.r.results.filter(x => !x.ok).length});
  check(orc.oc > 0 && orc.r.results.filter(x => x.p[1]).length === 300 && !orc.r.results.some(x => x.err || !x.ok) && orc.ps[0] < 40,
    'JMS sobrecarregado RECUSA ("sistema ocupado"): tenta de novo mais devagar e acha todas', {oc: orc.oc, ps: orc.ps, recusadas: orc.r.recusadas});
  const jrc = await criar({recusa: ['FIC000000007']});
  const rrc = await P.pesquisar(apiFalsa(jrc.porta), WS(20), PATS, {espera: 0, lote: 1});
  await jrc.fechar();
  const smr = R.summary(rrc.results, 1);
  check(rrc.recusadas === 1 && rrc.results[7].err && /bloqueada/.test(rrc.erro) && smr.err === 1 && smr.none === 0 && smr.yes === 19,
    'remessa sempre recusada: conta como "consulta recusada" (com o motivo), não como "sem rastreamento"', {recusadas: rrc.recusadas, erro: rrc.erro, smr});
  // O JMS pede para ir mais devagar (429 ou "muitas consultas"): cai pela metade, espera e tenta de novo; nada se perde.
  let lim = 0;
  const apiLim = {consultar: (ps, op) => api.consultar(ps, op).then(rs2 => rs2.map((r, i) => (lim < 30 && i % 5 === 0 ? (lim++, i % 10 ? {status: 429, text: ''}
    : {status: 200, text: '{"code":500,"msg":"请求过于频繁，请稍后再试","fail":true}'}) : r)))};
  const parsL = [], rl = await P.pesquisar(apiLim, WS(100), PATS, {espera: 0, lote: 1, paralelo: 40, onParalelo: n => parsL.push(n)});
  check(rl.results.filter(x => x.p[1]).length === 100 && !rl.results.some(x => x.err) && parsL[0] === 20 && lim === 30,
    'JMS pede para ir mais devagar: metade das consultas ao mesmo tempo, pausa e nenhuma remessa perdida', parsL);
  const kLim = ['{"code":500,"msg":"请求过于频繁"}', '{"code":0,"msg":"Too many requests"}'].map(t => { try { R.parseJms(200, t); return ''; } catch (e) { return e.kind + (e.limite ? '+limite' : ''); } });
  check(kLim.join() === 'temp+limite,temp+limite', '"muitas consultas" do JMS = passageiro (não é recusa nem token)', kLim);
  check(R.segmentosDe({data: {details: {terminalDispatchCode: 'XA,101-01,'}}}).s2 === '101-01' && R.segmentosDe({data: null}).s1 === '' &&
    R.segmentosDe({data: {terminalDispatchCode: 'XB,202-02,9'}}).s1 === 'XB', 'segmentos: código com o 3º vazio, sem dados ou fora de "details"');
  const js = await criar({semOrder: true});
  const rs = await P.pesquisar(apiFalsa(js.porta), WS(12), PATS, {espera: 0});
  await js.fechar();
  check(rs.results.filter(x => x.p[1]).length === 12 && rs.semSeg === 12 && rs.results.every(x => x.seg === null) && /não permitida/.test(rs.erroSeg),
    'Informação básica recusada: a pesquisa termina e avisa quantas ficaram sem segmentos', rs.erroSeg);
  const rn = await P.pesquisar(api, WS(5), PATS, {espera: 0, segmentos: false});
  check(rn.results.every(x => x.seg === null) && rn.semSeg === 0 && rn.consultas === 1, 'sem a Informação básica quando desligada (só o rastreamento, sem aviso)');
  // Falha passageira numa consulta: volta para a fila, nada se perde.
  let falhou = 0;
  const apiInst = {consultar: ps => api.consultar(ps).then(rs2 => rs2.map((r, i) => (i === 0 && falhou++ < 2 ? {status: 503, text: ''} : r)))};
  const ri = await P.pesquisar(apiInst, WS(150), PATS, {espera: 0});
  check(ri.results.filter(x => x.p[1]).length === 150 && falhou === 3, 'consulta com falha passageira (503) volta para a fila', falhou);

  // ---------- 3. Planilha (planilha.js) ----------
  const rAll = await P.pesquisar(api, WS(30), ['O expresso chegou [SP GRU]', 'chegou [SP GRU] A parada anterior foi []'], {espera: 0});
  const book = X.rastreioBook({patterns: ['O expresso chegou [SP GRU]', 'chegou [SP GRU] A parada anterior foi []'], results: rAll.results,
    summaries: [R.summary(rAll.results, 0), R.summary(rAll.results, 1)], at: new Date(2026, 9, 21, 9, 5)});
  const tem2 = book.sheets[3];
  const nao1 = book.sheets[2];
  check(book.sheets.map(s => s.name).join('|') === 'Resumo|Bloco 1 - Tem|Bloco 1 - Não tem|Bloco 2 - Tem|Bloco 2 - Não tem' && tem2.rows[3][1].v === 'FIC000000000' &&
    tem2.rows[2].length === 12 && /^Código de primeiro segmento/.test(tem2.rows[2][2].v) && /^Código de dois segmentos/.test(tem2.rows[2][3].v) &&
    tem2.rows[3][2].v === 'XA' && tem2.rows[3][3].v === '101-01' && /^Imagem/.test(tem2.rows[2][10].v) && tem2.rows[3][10].v === 'Tem imagem no JMS' &&
    !tem2.images && tem2.filter === 'A3:L3' && nao1.rows[2].length === 5 && /^Código de primeiro segmento/.test(nao1.rows[2][2].v),
    'abas Tem e Não tem: remessa, códigos de segmento, horário, turno, origem, escaneador, tipo, descrição, imagem (texto) e linhas', tem2.rows[2].map(c => c.v));
  const z = unzip(await X.build(book)), names = Object.keys(z);
  const charts = names.filter(n => /^xl\/charts\/chart\d+\.xml$/.test(n));
  check(charts.length === 5 && !names.some(n => /^xl\/media\//.test(n)) && !/<xdr:pic>/.test(names.filter(n => /drawing\d+\.xml$/.test(n)).map(n => z[n].toString()).join('')) &&
    names.filter(n => /\.(xml|rels)$/.test(n)).every(n => wellFormed(z[n].toString())), 'planilha: 5 gráficos do Excel, sem fotos; XML bem formado', charts.length);
  const semFoto = X.rastreioBook({patterns: ['', 'chegou'], results: [{w: 'FIC1', ok: true, p: [null, {t: '2026-09-09 10:00:00', shift: 'T1', img: true, n: 1}]},
    {w: 'FIC2', ok: true, p: [null, {t: '2026-09-09 10:00:00', shift: 'T1', img: false, n: 1}]}], summaries: [R.summary([], 0), R.summary([], 1)]});
  const semSegs = X.rastreioBook({patterns: ['', 'chegou'], results: rAll.results, summaries: [R.summary(rAll.results, 0), R.summary(rAll.results, 1)], segmentos: false});
  check(semSegs.sheets[1].rows[2].length === 10 && semSegs.sheets[1].filter === 'A3:J3' && semSegs.sheets[2].rows[2].length === 3 && /^Tempo/.test(semSegs.sheets[1].rows[2][2].v),
    'pesquisa sem segmentos: planilha sem as colunas de segmento');
  check(semFoto.sheets[1].rows[3][10].v === 'Tem imagem no JMS' && semFoto.sheets[1].rows[4][10].v === 'NÃO TEM IMAGEM!' && semFoto.sheets[1].rows[3][2].v === '',
    'coluna Imagem: "Tem imagem no JMS" ou "NÃO TEM IMAGEM!"; sem segmentos, célula vazia');

  // ---------- 3b. V1.7: só os códigos de segmento ----------
  // Muitas remessas, JMS que responde sem os dados (ou recusa) com consultas demais, remessas que de fato não têm o código e
  // uma que não existe. O app que travava: 25 por chamada, uma de cada vez, parava tudo na 1ª falha e não baixava com 1 sem código.
  const segEsperado = w => R.segmentosDe({data: {details: {terminalDispatchCode: segmento(Number(w.slice(3)))}}});
  for (const modo of ['vazio', 'recusa']) {
    const jSeg = await criar({quantas: 3000, ocupadoOrder: 25, ocupadoModo: modo, atraso: 5, semCodigo: ['FIC000000010', 'FIC000000020']});
    const wsSeg = WS(1500).concat(['NAOEXISTE0001']), progSeg = [];
    const rSeg = await P.pesquisarSegmentos(apiFalsa(jSeg.porta), wsSeg, {espera: 0, onProgresso: a => progSeg.push(a)});
    await jSeg.fechar();
    const certos = rSeg.results.filter(r => r.seg && r.seg.s1 === segEsperado(r.w).s1 && r.seg.s2 === segEsperado(r.w).s2).length;
    check(rSeg.results.length === 1501 && !rSeg.faltam.length && certos === 1498 && rSeg.semCodigo === 2 && rSeg.recusadas === 1 &&
      rSeg.results.filter(r => r.sem).map(r => r.w).join() === 'FIC000000010,FIC000000020' && rSeg.results[1500].err && jSeg.estado.ocupadasOrder > 0 &&
      rSeg.results.map(r => r.w).join() === wsSeg.join() && progSeg.length > 3,
      'só os códigos de segmento: 1.500 remessas com o JMS ocupado (' + modo + ') — todas com o código certo; sem código e inexistente separadas',
      {certos, sem: rSeg.semCodigo, rec: rSeg.recusadas, ocupadas: jSeg.estado.ocupadasOrder, revistas: rSeg.revistas});
  }
  // AuthToken recusado: para (não marca tudo como "sem código") e diz o motivo.
  const jSegT = await criar({token: 'OUTRO-TOKEN'});
  let segAuth = null;
  try { await P.pesquisarSegmentos(apiFalsa(jSegT.porta), WS(30), {espera: 0}); } catch (e) { segAuth = e; }
  await jSegT.fechar();
  check(segAuth && segAuth.kind === 'auth' && /AuthToken/.test(segAuth.message), 'só segmentos: AuthToken recusado para a pesquisa com o motivo', segAuth && segAuth.message);
  // Planilha do modo: Resumo (situação, contagem dos dois códigos, 2 gráficos) + aba Segmentos.
  const rSeg2 = await P.pesquisarSegmentos(api, WS(40).concat(['NAOEXISTE0002']), {espera: 0, revisar: false});
  const bookSeg = X.segmentosBook({results: rSeg2.results, at: new Date(2026, 9, 22, 10, 0)});
  const zSeg = unzip(await X.build(bookSeg)), nSeg = Object.keys(zSeg), abaSeg = bookSeg.sheets[1];
  check(bookSeg.sheets.map(s => s.name).join('|') === 'Resumo|Segmentos' && abaSeg.rows.length === 3 + 41 && abaSeg.rows[3][1].v === 'FIC000000000' &&
    abaSeg.rows[3][2].v === 'XA' && abaSeg.rows[3][3].v === '101-01' && /recusada/.test(abaSeg.rows[43][4].v) && abaSeg.filter === 'A3:E3' &&
    nSeg.filter(n => /^xl\/charts\/chart\d+\.xml$/.test(n)).length === 2 && nSeg.filter(n => /\.(xml|rels)$/.test(n)).every(n => wellFormed(zSeg[n].toString())),
    'planilha dos segmentos: Resumo com 2 gráficos do Excel e aba com remessa, 1º e 2º segmento e situação', abaSeg.rows[2].map(c => c.v));
  // Remessas de uma aba do Excel: textos compartilhados, texto com formatação, número gravado como 8,8E+14 e cabeçalho "Remessa".
  const sx = s => '<si>' + s + '</si>';
  const enc = new TextEncoder(), arqs = [
    {name: '[Content_Types].xml', text: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'},
    {name: 'xl/workbook.xml', text: '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Capa" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Base &amp; remessas" sheetId="2" r:id="rId2"/></sheets></workbook>'},
    {name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="ws" Target="/xl/worksheets/sheet2.xml"/></Relationships>'},
    {name: 'xl/sharedStrings.xml', text: '<sst>' + sx('<t>Data</t>') + sx('<t>Remessa</t>') + sx('<r><t>FIC0000</t></r><r><t xml:space="preserve">00001</t></r>') + sx('<t>Obs &amp; nota</t>') + '</sst>'},
    {name: 'xl/worksheets/sheet1.xml', text: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Relatório</t></is></c></row></sheetData></worksheet>'},
    {name: 'xl/worksheets/sheet2.xml', text: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>3</v></c></row>' +
      '<row r="2"><c r="A2"><v>46316</v></c><c r="B2" t="s"><v>2</v></c></row>' +
      '<row r="3"><c r="A3"><v>46316</v></c><c r="B3"><v>8.88002517578525E+14</v></c><c r="C3"/></row>' +
      '<row r="5"><c r="B5" t="inlineStr"><is><t>FIC000000002</t></is></c></row></sheetData></worksheet>'}
  ].map(f => ({name: f.name, bytes: enc.encode(f.text)}));
  const abasX = await X.lerPlanilha(X.zip(arqs));
  const achX = X.acharColuna(abasX[1].linhas), colX = X.coluna(abasX[1].linhas, achX.col, achX.cab);
  check(abasX.map(a => a.nome).join('|') === 'Capa|Base & remessas' && achX.col === 1 && achX.cab === 0 && colX.join() === 'FIC000000001,888002517578525,FIC000000002' &&
    abasX[1].linhas[0][3] === 'Obs & nota' && abasX[0].linhas[0][0] === 'Relatório',
    'importar de uma aba do Excel: acha a aba e a coluna "Remessa"; número 8,8E+14 vira a remessa inteira', {achX, colX});
  const csvX = X.lerTexto('﻿data;remessa;obs\r\n2026-10-01;"FIC000000003";"a; b"\r\n2026-10-01;FIC000000004;\r\n', 'lista.csv');
  const achC = X.acharColuna(csvX[0].linhas);
  check(achC.col === 1 && X.coluna(csvX[0].linhas, achC.col, achC.cab).join() === 'FIC000000003,FIC000000004' && csvX[0].linhas[1][2] === 'a; b',
    'importar de CSV (separador ;, aspas): coluna das remessas', csvX[0].linhas);
  const semCab = X.acharColuna([['x', 'FIC000000005'], ['y', 'FIC000000006'], ['z', '']]);
  check(semCab.col === 1 && semCab.cab === -1, 'sem cabeçalho: a coluna com mais valores com cara de remessa', semCab);
  let naoXlsx = '';
  try { await X.lerPlanilha(new Uint8Array([1, 2, 3, 4])); } catch (e) { naoXlsx = e.message; }
  check(/não é uma planilha \.xlsx/.test(naoXlsx), 'arquivo que não é .xlsx: diz o que fazer', naoXlsx);

  // ---------- 4. Servidor do app (server.js) ----------
  process.env.PESQUISA_JMS_URL = 'http://127.0.0.1:' + jms.porta;
  const os = require('os'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pesquisa-'));
  process.env.PESQUISA_CONFIG = path.join(tmp, 'config.json');
  fs.writeFileSync(process.env.PESQUISA_CONFIG, JSON.stringify({dashmaster: false}));
  const S = require('../server');
  const cfg = S.loadConfig(), srv = S.createServer(cfg);
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const porta = srv.address().port;
  const api2 = (fn, body, h) => request(porta, 'POST', '/api/' + fn, body, h).then(r => Object.assign(JSON.parse(r.text), {status: r.status}));
  // Token do servidor, como o DashMaster: sem DashMaster, o app pede o token só no computador dele e guarda nele.
  const kwPed = ws => ({url: R.KEYWORD_URL, body: R.keywordPayload(ws)});
  const e0 = await api2('estado', {}), j0 = await api2('consultar', {pedidos: [kwPed(['FIC000000001'])]});
  check(e0.ok && e0.result.fonte === '' && e0.result.local === true && !j0.ok && /Falta o AuthToken/.test(j0.error), 'sem token no servidor: a página avisa (passo 1)', [e0, j0.error]);
  const tRede = await api2('token', {token: TOKEN}, {'X-Forwarded-For': '10.0.0.9'});
  const tOk = await api2('token', {token: ' authtoken: "' + TOKEN + '"\n'}), e1 = await api2('estado', {});
  check(tRede.status === 403 && tOk.ok && e1.result.fonte === 'app' && e1.result.tamanho === TOKEN.length && e1.result.versao === S.VERSAO &&
    JSON.parse(fs.readFileSync(path.join(cfg.dados, 'credenciais.json'), 'utf8')).JMS_AUTHTOKEN === TOKEN,
    'token salvo só pelo computador do app (pela rede: recusado); "authtoken:", aspas e espaços saem');
  const home = await request(porta, 'GET', '/');
  check(home.status === 200 && /window\.__PESQUISA__ = \{"versao":"1\.7\.0","plataforma":"node"\}/.test(home.text) && !/__PESQUISA_BOOT__/.test(home.text) &&
    ['rastreio.js', 'pesquisa.js', 'planilha.js', 'app.js', 'app.css'].every(f => home.text.indexOf(f) >= 0), 'página do app (Node.js)');
  const libs = await Promise.all(['/rastreio.js', '/pesquisa.js', '/planilha.js', '/app.js'].map(f => request(porta, 'GET', f)));
  check(libs.every(r => r.status === 200 && /javascript/.test(r.headers['content-type'])) && libs.every(r => { try { new Function(r.text); return true; } catch (e) { return false; } }),
    'scripts da página entregues e sem erro de sintaxe');
  const antesJ = jms.estado.chamadas.length;
  const pj = await request(porta, 'POST', '/api/consultar', {token: 'TOKEN-DA-PAGINA', pedidos: [Object.assign(kwPed(['FIC000000001']), {headers: {routename: 'trackingExpress', cookie: 'x', authtoken: 'y'}}),
    {url: R.ORDER_URL, body: R.orderPayload('FIC000000001')}]});
  const ch = jms.estado.chamadas[antesJ], pjr = JSON.parse(pj.text).result || [];
  const kwTxt = pjr[0] && pjr[0].text, odTxt = pjr[1] && pjr[1].text, det0 = JSON.parse(kwTxt).data[0].details[0];
  check(pj.status === 200 && JSON.parse(kwTxt).data[0].keyword === 'FIC000000001' && ch.headers.authtoken === TOKEN && ch.headers.routename === 'trackingExpress' && !ch.headers.cookie,
    'api/consultar: consulta o JMS com o token DO SERVIDOR (o que a página mandar é ignorado; extras só os de rota)');
  check(det0.scanTime && det0.waybillTrackingContent && det0.scanNetworkId === undefined && det0.originalScanTypeCode === undefined &&
    R.segmentosDe(JSON.parse(odTxt)).s1 === 'XB' && !/FICTICI|00000000000/.test(odTxt) && odTxt.length < 200,
    'só os campos que a pesquisa usa voltam para a página (nada de nome ou telefone do cliente)', odTxt);
  const muitos = await api2('consultar', {pedidos: Array.from({length: 2501}, () => kwPed(['FIC1']))});
  const outras = ['https://outro.example/x', 'https://gw.jtjms-br.com/operatingplatform/abnormalPieceScanList/pageList', 'https://gw.jtjms-br.com/ficticio/user/updatePassword',
    R.KEYWORD_URL + '?x=1'];
  const recusas = await Promise.all(outras.map(u => api2('consultar', {pedidos: [kwPed(['FIC1']), {url: u, body: {}}]})));
  check(!muitos.ok && /2500/.test(muitos.error) && recusas.every(r => !r.ok && /só consulta o Rastreamento do pacote e a Informação básica/.test(r.error)),
    'com o token do servidor, só o Rastreamento do pacote e a Informação básica (nada que grave ou apague); no máximo 2500 por chamada');
  // 1000 remessas numa chamada: o servidor faz as consultas ao mesmo tempo (quantas a página pedir, até 100).
  jms.estado.maxSimultaneas = 0;
  const t0 = Date.now(), mil = await api2('consultar', {pedidos: WS(1000).map(w => kwPed([w])), opcoes: {paralelo: 80}});
  const maxMil = jms.estado.maxSimultaneas;
  jms.estado.maxSimultaneas = 0;
  await api2('consultar', {pedidos: WS(300).map(w => kwPed([w])), opcoes: {paralelo: 5000}});
  const maxTeto = jms.estado.maxSimultaneas;
  check(mil.ok && mil.result.length === 1000 && mil.result.every((r, i) => JSON.parse(r.text).data[0].keyword === WS(1000)[i]) && maxMil > 25 && maxMil <= 80 && maxTeto <= 100,
    'api/consultar: 1000 consultas numa chamada, na mesma ordem, até 100 ao mesmo tempo', {ms: Date.now() - t0, maxMil, maxTeto});
  // Com o DashMaster neste computador: o MESMO token dele (banco dashmaster.db, tela Configurações), sem colar nada.
  let sqliteOk = true;
  try { require('node:sqlite'); } catch (e) { sqliteOk = false; }
  if (sqliteOk) {
    const {DatabaseSync} = require('node:sqlite'), dbFile = path.join(tmp, 'dm', 'node', 'dados', 'dashmaster.db');
    fs.mkdirSync(path.dirname(dbFile), {recursive: true});
    const db = new DatabaseSync(dbFile);
    db.exec('CREATE TABLE props (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    db.prepare('INSERT INTO props (k, v) VALUES (?, ?), (?, ?)').run('JMS_AUTHTOKEN', TOKEN, 'DB_SPREADSHEET_ID', 'x');
    db.close();
    const cfgDm = Object.assign({}, cfg, {dashmaster: path.join(tmp, 'dm')});
    fs.writeFileSync(path.join(cfg.dados, 'credenciais.json'), JSON.stringify({JMS_AUTHTOKEN: 'TOKEN-VELHO-DO-APP'}));
    const cDm = S.credenciais(cfgDm), rDm = (await S.consultar([kwPed(['FIC000000003'])], cfgDm))[0];
    check(cDm.fonte === 'dashmaster' && cDm.JMS_AUTHTOKEN === TOKEN && rDm.status === 200 && JSON.parse(rDm.text).data[0].keyword === 'FIC000000003',
      'usa o mesmo AuthToken do DashMaster deste computador (o dele vale mais que o salvo no app)', cDm.fonte);
    fs.writeFileSync(path.join(cfg.dados, 'credenciais.json'), JSON.stringify({JMS_AUTHTOKEN: TOKEN}));
  }
  const hc = S.cabecalhos({JMS_AUTH_MODE: 'AUTHTOKEN_COOKIE', JMS_AUTHTOKEN: 'A', JMS_COOKIE: 'C'}), hk = S.cabecalhos({JMS_COOKIE: 'C'});
  check(hc.AuthToken === 'A' && hc.Cookie === 'C' && !hk.AuthToken && hk.Cookie === 'C', 'modos de acesso iguais aos do DashMaster (JMS_AUTH_MODE)');
  const hr1 = S.cabecalhos({JMS_AUTHTOKEN: 'A', JMS_ROUTENAME_TRACKING: 'rotaFicticia'}, {routename: 'trackingExpress'});
  const hr2 = S.cabecalhos({JMS_AUTHTOKEN: 'A', JMS_ROUTE_AUTO_TRACKING: '3'}, {});
  const hr3 = S.cabecalhos({JMS_AUTHTOKEN: 'A', JMS_ROUTENAME_TRACKING: 'NONE', JMS_EXTRA_HEADERS_JSON: '{"X-Ficticio":"1","authtoken":"NAO"}'}, {routename: 'trackingExpress'});
  check(hr1.Routename === 'rotaFicticia' && hr2.Routename === 'packageTracking' && !hr3.Routename && hr3['X-Ficticio'] === '1' && hr3.AuthToken === 'A',
    'propriedades do DashMaster: JMS_ROUTENAME_TRACKING manda, JMS_ROUTE_AUTO_TRACKING aprendido, JMS_EXTRA_HEADERS_JSON', [hr1, hr2, hr3]);
  const csrf = await request(porta, 'POST', '/api/consultar', {pedidos: [kwPed(['FIC1'])]}, {Origin: 'http://outro-site.example'});
  const get = await request(porta, 'GET', '/api/consultar');
  const form = await request(porta, 'POST', '/api/consultar', 'url=x', {'Content-Type': 'application/x-www-form-urlencoded'});
  check(csrf.status === 403 && get.status === 405 && form.status === 415, 'outro site não usa o app (CSRF); só POST com JSON');
  const fotosApi = await request(porta, 'POST', '/api/fotos', {urls: []}), jmsApi = await request(porta, 'POST', '/api/jms', {url: R.KEYWORD_URL, body: {}});
  check(fotosApi.status === 404 && jmsApi.status === 404, 'rotas antigas (fotos, api/jms) saíram');
  // A página inteira pelo servidor do app (api de verdade, em vez da falsa).
  const viaApp = {
    consultar: pedidos => request(porta, 'POST', '/api/consultar', {pedidos}).then(r => { const j = JSON.parse(r.text); if (!j.ok) throw new Error(j.error); return j.result; })
  };
  const rv = await P.pesquisar(viaApp, WS(15), PATS, {espera: 0});
  check(rv.results.filter(x => x.p[1]).length === 15 && rv.results[0].seg.s1 === 'XA' && rv.results[0].seg.s2 === '101-01', 'pesquisa e segmentos pelo servidor do app');
  await new Promise(ok => srv.close(ok));

  // ---------- 5. Versão Apps Script ----------
  const ger = require('../gerar-appscript');
  const files = ger.arquivos();
  const dif = Object.keys(files).filter(f => fs.readFileSync(path.join(ROOT, 'appscript', f), 'utf8') !== files[f]);
  check(!dif.length, 'appscript/ em dia com a página (rode node gerar-appscript.js)', dif);
  check(/<\?!= include\('Estilo'\); \?>/.test(files['Index.html']) && /<\?!= include\('App'\); \?>/.test(files['Index.html']) && /<\?!= boot \?>/.test(files['Index.html']) &&
    ['lib/rastreio.js', 'lib/pesquisa.js', 'lib/planilha.js', 'public/app.js'].every(f => files['App.html'].indexOf(fs.readFileSync(path.join(ROOT, f), 'utf8')) >= 0),
    'Index.html, Estilo.html e App.html gerados da mesma página');
  const props = {}, fetched = [];
  const gctx = {
    JSON, Object, Array, String, Number, Math, Date, Error, RegExp,
    HtmlService: {createTemplateFromFile: n => ({evaluate: () => ({setTitle() { return this; }, addMetaTag() { return this; }, n})}), createHtmlOutputFromFile: n => ({getContent: () => 'conteúdo ' + n})},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => (props[k] === undefined ? null : props[k]), getProperties: () => Object.assign({}, props),
      setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; }})},
    console: {log: () => {}},
    UrlFetchApp: {
      // JMS de mentira: aceita só o token fictício e, se `exigeRota`, só esse Routename. Informação básica com dados de cliente fictícios.
      fetch: (url, req) => {
        fetched.push({url, req});
        const ok = req.headers.AuthToken === TOKEN && (!gctx.exigeRota || req.headers.Routename === gctx.exigeRota);
        const bom = url === R.ORDER_URL ? '{"code":1,"data":{"waybillNo":"FIC1","details":{"terminalDispatchCode":"XA,101-01,900","receiverName":"CLIENTE FICTICIO"}}}'
          : '{"code":1,"data":[{"keyword":"FIC1","details":[{"scanTime":"2026-09-09 10:00:00","scanNetworkId":9,"waybillTrackingContent":"FICTICIO"}]}]}';
        return {getResponseCode: () => 200, getContentText: () => ok ? bom : req.headers.AuthToken === TOKEN ? '{"code":500,"msg":"rota inválida"}' : '{"code":401,"msg":"token失效"}'};
      },
      fetchAll: reqs => { gctx.fetchAlls = (gctx.fetchAlls || 0) + 1; return reqs.map(r => gctx.UrlFetchApp.fetch(r.url, r)); }
    }
  };
  const kwG = (body, headers) => ({url: R.KEYWORD_URL, body: body || {keywordList: ['FIC1']}, headers: headers || {}});
  vm.createContext(gctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'appscript', 'Codigo.gs'), 'utf8'), gctx);
  let gErr = '', gTok = '';
  try { gctx.consultar([kwG()]); } catch (e) { gTok = e.message; }
  const est0 = gctx.estado();
  check(est0.fonte === '' && est0.versao === S.VERSAO && est0.nomes.length === 0 && /Propriedades do script → JMS_AUTHTOKEN/.test(gTok) && !fetched.length &&
    /FALTA O TOKEN[\s\S]*nenhuma propriedade/.test(gctx.testarConexao()), 'Apps Script sem JMS_AUTHTOKEN: avisa onde cadastrar', gTok);
  // Nomes e valores como a pessoa costuma colar: todos valem (o valor nunca volta para a página).
  const apelidos = {'JMS_AUTHTOKEN ': TOKEN, 'AuthToken': 'authtoken: ' + TOKEN, 'jms_authtoken': '"' + TOKEN + '"', 'TOKEN': ' ' + TOKEN + '\n'};
  const lidos = Object.keys(apelidos).map(k => {
    Object.keys(props).forEach(x => { delete props[x]; });
    props[k] = apelidos[k];
    const e = gctx.estado();
    gctx.consultar([kwG()]);
    return e.fonte === 'propriedades' && e.chave === k && e.tamanho === TOKEN.length && JSON.stringify(e).indexOf(TOKEN) < 0 && fetched[fetched.length - 1].req.headers.AuthToken === TOKEN;
  });
  check(lidos.every(Boolean), 'Apps Script: aceita o token com espaço no nome, "AuthToken", minúsculas, "authtoken:", aspas e quebra de linha', lidos);
  Object.keys(props).forEach(x => { delete props[x]; });
  props.OUTRA_COISA = 'x';
  check(gctx.estado().nomes.join() === 'OUTRA_COISA', 'Apps Script sem token: mostra os NOMES das propriedades (para achar nome errado)');
  delete props.OUTRA_COISA;
  fetched.length = 0;
  props.JMS_AUTHTOKEN = TOKEN;
  const gj = gctx.consultar([kwG(null, {routename: 'trackingExpress', authtoken: 'x', cookie: 'y'}), {url: R.ORDER_URL, body: R.orderPayload('FIC1')}]);
  const gr = fetched[0], gdet = JSON.parse(gj[0].text).data[0].details[0];
  check(gctx.estado().fonte === 'propriedades' && gj[0].status === 200 && gr.req.headers.AuthToken === TOKEN && gr.req.headers.Routename === 'trackingExpress' &&
    !gr.req.headers.Cookie && gr.req.method === 'post' && JSON.parse(gr.req.payload).keywordList[0] === 'FIC1' && gr.req.followRedirects === false &&
    gdet.waybillTrackingContent === 'FICTICIO' && gdet.scanNetworkId === undefined && R.segmentosDe(JSON.parse(gj[1].text)).s2 === '101-01' && !/CLIENTE/.test(gj[1].text),
    'Apps Script consultar(): JMS_AUTHTOKEN das Propriedades do script, como o DashMaster; só os campos da pesquisa voltam', gj);
  fetched.length = 0;
  gctx.fetchAlls = 0;
  const g60 = gctx.consultar(Array.from({length: 60}, (_, i) => kwG({keywordList: ['FIC' + i]})));
  const fa60 = gctx.fetchAlls;
  gctx.fetchAlls = 0;
  gctx.consultar(Array.from({length: 60}, () => kwG()), {paralelo: 10});
  const fa10 = gctx.fetchAlls;
  gctx.fetchAlls = 0;
  gctx.consultar(Array.from({length: 250}, () => kwG()), {paralelo: 999});
  check(g60.length === 60 && fa60 === 2 && fa10 === 6 && gctx.fetchAlls === 3 &&
    fetched.slice(0, 60).map(f => JSON.parse(f.req.payload).keywordList[0]).join() === Array.from({length: 60}, (_, i) => 'FIC' + i).join(),
    'Apps Script consultar(): 50 ao mesmo tempo (UrlFetchApp.fetchAll), o que a página pedir até 100, na mesma ordem', [fa60, fa10, gctx.fetchAlls]);
  let gGrava = '', gMuitos = '';
  try { gctx.consultar([kwG(), {url: 'https://outro.example/x', body: {}}]); } catch (e) { gErr = e.message; }
  try { gctx.consultar([{url: 'https://gw.jtjms-br.com/ficticio/user/updatePassword', body: {}}]); } catch (e) { gGrava = e.message; }
  try { gctx.consultar(Array.from({length: 2501}, () => kwG())); } catch (e) { gMuitos = e.message; }
  check(/não permitido/.test(gErr) && /só consulta o Rastreamento do pacote e a Informação básica/.test(gGrava) && /2500/.test(gMuitos) &&
    typeof gctx.fotos === 'undefined' && typeof gctx.modelo === 'undefined' && typeof gctx.jms === 'undefined',
    'Apps Script: só o Rastreamento do pacote e a Informação básica; no máximo 2500 por chamada; funções antigas saíram');
  const tc1 = gctx.testarConexao();
  gctx.exigeRota = 'waybillTracking';
  const tc2 = gctx.testarConexao();
  props.JMS_AUTHTOKEN = 'TOKEN-VENCIDO';
  const tc3 = gctx.testarConexao();
  props.JMS_AUTHTOKEN = TOKEN;
  gctx.exigeRota = '';
  check(/Sem Routename: HTTP 200, código 1 → OK\nOK: o JMS aceitou/.test(tc1) && /Com Routename waybillTracking: HTTP 200, código 1 → OK/.test(tc2) &&
    /código 401: token[\s\S]*O JMS recusou/.test(tc3) && [tc1, tc2, tc3].every(x => x.indexOf(TOKEN) < 0 && x.indexOf('TOKEN-VENCIDO') < 0),
    'testarConexao() no editor: mostra o que o JMS respondeu, testa as rotas do DashMaster e nunca mostra o token', [tc1, tc2, tc3]);
  const fetchOk = gctx.UrlFetchApp.fetch;
  gctx.UrlFetchApp.fetch = () => { throw new Error('Exception: Você não tem permissão para chamar UrlFetchApp.fetch. Permissões necessárias: https://www.googleapis.com/auth/script.external_request'); };
  let gAut = '';
  try { gctx.consultar([kwG()]); } catch (e) { gAut = e.message; }
  gctx.UrlFetchApp.fetch = () => { throw new Error('Address unavailable'); };
  const gRede = gctx.consultar([kwG()])[0];
  gctx.UrlFetchApp.fetch = fetchOk;
  let kRede = '';
  try { R.parseJms(gRede.status, gRede.text); } catch (e) { kRede = e.message; }
  check(/ainda não autorizou[\s\S]*testarConexao/.test(gAut) && /HTTP 0: Falha de rede ao consultar o JMS: Address unavailable/.test(kRede),
    'Apps Script sem autorização do Google: diz o que fazer (não confunde com JMS fora do ar)', [gAut, kRede]);
  props.JMS_COUNTRY_ID = '7';
  gctx.consultar([kwG({keywordList: ['FIC1'], countryId: '1'})]);
  check(JSON.parse(fetched[fetched.length - 1].req.payload).countryId === '7', 'Apps Script: JMS_COUNTRY_ID do DashMaster vale');
  delete props.JMS_COUNTRY_ID;
  // V1.7: só os códigos de segmento pelo Codigo.gs (o mesmo caminho da página publicada no Apps Script).
  const rotaAntes = gctx.exigeRota;
  gctx.exigeRota = null;
  props.JMS_AUTHTOKEN = TOKEN;
  const apiG = {consultar: (ps, op) => Promise.resolve().then(() => gctx.consultar(ps, op))};
  const rG = await P.pesquisarSegmentos(apiG, ['FIC000000001', 'FIC000000002', 'FIC000000003'], {espera: 0});
  gctx.exigeRota = rotaAntes;
  check(rG.results.length === 3 && rG.results.every(r => r.seg && r.seg.s1 === 'XA' && r.seg.s2 === '101-01') && rG.comCodigo === 3,
    'Apps Script: modo "só os códigos de segmento" pelo Codigo.gs (Código de primeiro e de dois segmentos)', rG.results);
  check(gctx.doGet({}).n === 'Index' && /conteúdo App/.test(gctx.include('App')), 'Apps Script doGet() e include()');
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  check((appJs.match(/var VERSAO_PAGINA = '([^']+)'/) || [])[1] === S.VERSAO && gctx.VERSAO === S.VERSAO, 'mesma versão na página, no Codigo.gs e no server.js (a página avisa se misturar)');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'appscript', 'appsscript.json'), 'utf8'));
  check(manifest.oauthScopes.join() === 'https://www.googleapis.com/auth/script.external_request' && manifest.webapp.executeAs === 'USER_DEPLOYING', 'manifesto: só acesso à internet');

  await jms.fechar();
  console.log('OK: ' + passed + ' verificações da Pesquisa no Rastreamento passaram (JMS simulado; dados fictícios).');
})().catch(e => { console.error('FALHOU: ' + (e && e.stack || e)); process.exit(1); });
