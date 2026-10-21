#!/usr/bin/env node
'use strict';
/* Testes da Pesquisa no Rastreamento (dados FICTÍCIOS; JMS falso por HTTP). Uso: node test/test_pesquisa.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const http = require('http');
const ROOT = path.join(__dirname, '..');
const {criar, bipes, fetchCopiado, TOKEN} = require('./jms_falso');

// O servidor do app lê o endereço do JMS (simulado) ao carregar: definir antes do require.
let jmsPorta = 0;
const R = require('../lib/rastreio');
const P = require('../lib/pesquisa');
const X = require('../lib/planilha');

let passed = 0;
function check(cond, name, extra) { if (!cond) { console.error('FALHOU: ' + name, extra === undefined ? '' : extra); process.exit(1); } passed++; }
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnKKKK84/QT//Z', 'base64');
const WS = n => Array.from({length: n}, (_, i) => 'FIC' + String(i).padStart(9, '0'));
const PATS = ['A encomenda expressa está [ SP GRU] sendo enviada', 'O expresso chegou [SP GRU] A parada anterior foi'];

/** "Servidor" para os testes da página: fala direto com o JMS falso (como o api/jms e o api/fotos do app). */
function apiFalsa(porta, token) {
  const local = u => u.replace(/^https:\/\/[^/]+/, 'http://127.0.0.1:' + porta);
  return {
    jms: (url, body, headers) => fetch(local(url), {method: body === null ? 'GET' : 'POST', headers: Object.assign({'Content-Type': 'application/json', authtoken: token || TOKEN},
      headers || {}), body: body === null ? undefined : JSON.stringify(body)}).then(async r => ({status: r.status, text: await r.text()})),
    fotos: urls => Promise.all(urls.map(u => fetch(local(u)).then(async r => r.ok ? {ok: true, b64: Buffer.from(await r.arrayBuffer()).toString('base64')} : {ok: false, error: 'HTTP ' + r.status})))
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
  check(h2.t === '2026-09-09 14:36:12' && h2.shift === 'T2' && h2.n === 2 && h2.origin === 'SP GRU' && h2.by === 'RECEBEDOR FICTICIO 2' && h2.img && h2.raw.scanTime === h2.t,
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
  check(R.findImageUrls({data: {a: 'x', imgs: ['https://f.example/a.png?s=1', 'https://f.example/b']}})[0] === 'https://f.example/a.png?s=1' &&
    R.findImageUrls('https://f.example/1.jpg,https://f.example/2.jpg').length === 2 && R.findImageUrls({b: 'data:image/png;base64,AAAA'})[0] === 'data:image/png;base64,AAAA',
    'links de foto em qualquer resposta');
  check(R.sniffImage(JPEG) === 'jpeg' && R.sniffImage(Buffer.from('<html>')) === '', 'tipo do arquivo pelos primeiros bytes');
  // Ensinar a foto: "Copiar como fetch", cURL e texto simples; token e cookie do texto colado são descartados.
  const cp = fetchCopiado('FIC000000002', h2.t), req = R.parseCopiedRequest(cp);
  check(req.url === 'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/fotoFicticia' && req.method === 'POST' && req.body.billCode === 'FIC000000002' &&
    JSON.stringify(req.headers) === '{"routename":"trackingExpress"}' && JSON.stringify(req).indexOf('NAO-USAR') < 0, 'pedido "Copiar como fetch": token e cookie descartados', req);
  const curl = R.parseCopiedRequest("curl 'https://gw.jtjms-br.com/operatingplatform/x/foto?billCode=FIC000000002&imgType=8' \\\n  -H 'authtoken: NAO-USAR' \\\n  -H 'routename: trackingExpress'");
  check(curl.method === 'GET' && curl.query.billCode === 'FIC000000002' && !curl.body && !curl.headers.authtoken, 'pedido "Copiar como cURL" (GET com parâmetros)', curl);
  const plain = R.parseCopiedRequest('https://gw.jtjms-br.com/operatingplatform/x/foto\n{"waybillNo":"FIC000000002","scanTime":"' + h2.t + '"}');
  check(plain.method === 'POST' && plain.body.waybillNo === 'FIC000000002', 'endereço numa linha e o JSON embaixo');
  let errUrl = '';
  try { R.parseCopiedRequest('fetch("https://outro.example/x", {"method":"POST"})'); } catch (e) { errUrl = e.message; }
  check(/gw\.jtjms-br\.com/.test(errUrl), 'pedido fora do JMS recusado');
  const lt = R.learnTemplate(req, d2);
  check(lt.usados === 3 && lt.linha.scanTime === h2.t && lt.modelo.body.billCode.from === 'billCode' && lt.modelo.body.scanTime.from === 'scanTime' &&
    lt.modelo.body.imgType.from === 'imgType' && lt.modelo.body.imgType.num && lt.modelo.body.countryId.value === '1', 'modelo: remessa, horário e tipo de imagem vêm da linha; o resto fica fixo', lt.modelo);
  const outra = bipes('FIC000000005', 5).filter(d => d.code === 110)[0], br = R.buildRequest(lt.modelo, outra);
  check(br.body.billCode === 'FIC000000005' && br.body.scanTime === outra.scanTime && br.body.imgType === 3 && br.body.countryId === '1' && br.headers.routename === 'trackingExpress',
    'pedido do "Ver imagem" montado para outra linha (outro tipo de imagem)', br);
  const ltq = R.learnTemplate(curl, d2), bq = R.buildRequest(ltq.modelo, outra);
  check(ltq.usados === 2 && bq.body === null && /billCode=FIC000000005&imgType=3$/.test(bq.url), 'modelo GET com parâmetros no endereço', bq.url);
  check(R.waybillsIn(req).join() === 'FIC000000002', 'remessa achada no pedido copiado');

  // ---------- 2. Pesquisa e fotos (pesquisa.js) com o JMS falso ----------
  const jms = await criar({fotos: [JPEG]});
  jmsPorta = jms.porta;
  const api = apiFalsa(jms.porta), lista = WS(120).concat(['NAOEXISTE0001', 'NAOEXISTE0002']);
  const r0 = await P.pesquisar(api, lista, PATS, {espera: 0});
  const kw0 = jms.estado.chamadas.filter(c => c.rota === 'keywordList');
  check(r0.results.length === 122 && !r0.faltam.length && r0.results.filter(x => x.p[0]).length === 80 && r0.results.filter(x => x.p[1]).length === 120 &&
    r0.results.filter(x => !x.ok).length === 2 && kw0.map(c => c.n).join() === '100,22,2', 'pesquisa: 100 remessas por consulta (as que não voltaram são conferidas de novo), tem/não tem por bloco',
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
  check(rb.results.length === 300 && rb.results.every(x => !x.ok) && cb <= 100 && !lotesB.length, 'remessas coladas erradas: "sem rastreamento", poucas consultas, limite igual', cb);
  const jr = await criar({rota: 'trackingExpress'}), heads = [];
  const rr = await P.pesquisar(apiFalsa(jr.porta), WS(20), PATS, {espera: 0, onHeaders: h => heads.push(h)});
  await jr.fechar();
  check(rr.results.filter(x => x.p[1]).length === 20 && heads[0] && heads[0].routename === 'trackingExpress', 'cabeçalho de rota da tela testado sozinho e guardado', heads);
  let eTok = null;
  try { await P.pesquisar(apiFalsa(jms.porta, 'TOKEN-VENCIDO'), WS(10), PATS, {espera: 0}); } catch (e) { eTok = e; }
  check(eTok && eTok.kind === 'auth' && /AuthToken/.test(eTok.message), 'token vencido: a pesquisa para com o aviso', eTok && eTok.message);
  let parou = 0;
  const rp = await P.pesquisar(api, WS(500), PATS, {espera: 0, paralelo: 1, parar: () => ++parou > 2});
  check(rp.results.length === 200 && rp.faltam.length === 300 && rp.faltam[0] === 'FIC000000200', 'Parar: o que foi pesquisado fica; o resto pode continuar depois', rp.results.length);
  let eVazio = '';
  try { await P.pesquisar(api, WS(3), ['', ' '], {}); } catch (e) { eVazio = e.message; }
  check(/texto padrão/.test(eVazio), 'sem padrão: aviso');

  // Fotos sem ensinar: só a do bipe de pacote problemático (Lista registrada de pacote problemático).
  const rProb = await P.pesquisar(api, WS(12), ['', 'problema foi realizada'], {espera: 0});
  const stP = await P.buscarFotos(api, rProb.results, {espera: 0});
  const hp = rProb.results[0].p[1];
  check(stP.total === 3 && stP.comFoto === 3 && hp.url === 'https://pro-ficticio.jtjms-br.com/foto/problema-FIC000000000.jpeg?sig=FICT' && R.sniffImage(hp.foto.bytes) === 'jpeg',
    'foto do bipe de pacote problemático sem precisar ensinar', stP);
  const st0 = await P.buscarFotos(api, r0.results.slice(0, 10), {espera: 0});
  check(st0.semLink === 10 && st0.comFoto === 0 && r0.results[1].p[1].url === '' && !r0.results[1].p[1].foto, 'outras linhas com imagem sem ensinar: ficam sem foto (avisa)', st0);
  // Ensinar e buscar todas.
  const ens = await P.ensinarFoto(api, cp, '', {espera: 0});
  check(ens.modelo && ens.linha.scanTime === h2.t && /^https:\/\/pro-ficticio\.jtjms-br\.com\/foto\/FIC000000002-/.test(ens.url) && Buffer.from(ens.foto, 'base64').equals(JPEG) &&
    JSON.stringify(ens.modelo).indexOf('NAO-USAR') < 0, 'Ensinar a foto: acha a linha pela remessa do pedido, testa e devolve a foto', ens.url);
  let eEns = '';
  try { await P.ensinarFoto(api, cp.replace(/FIC000000002/g, 'FIC999999999'), '', {espera: 0}); } catch (e) { eEns = e.message; }
  check(/não tem rastreamento/.test(eEns), 'Ensinar com remessa sem rastreamento: aviso claro', eEns);
  const rAll = await P.pesquisar(api, WS(30), ['O expresso chegou [SP GRU]', 'chegou [SP GRU] A parada anterior foi []'], {espera: 0});
  const antes = jms.estado.chamadas.filter(c => c.rota === 'fotoFicticia').length, vistos = [];
  const stA = await P.buscarFotos(api, rAll.results, {modelo: ens.modelo, espera: 0, onFoto: h => vistos.push(h)});
  const pedidosFoto = jms.estado.chamadas.filter(c => c.rota === 'fotoFicticia').length - antes;
  check(stA.total === 30 && stA.comFoto === 30 && pedidosFoto === 30 && rAll.results.every(r => r.p[0].foto && r.p[0].foto === r.p[1].foto) && vistos.length === 60,
    'com o modelo: foto de cada linha; a mesma linha nos dois blocos busca uma vez só', {stA, pedidosFoto});
  const miniaturas = [];
  await P.buscarFotos(api, (await P.pesquisar(api, WS(4), ['', 'chegou [SP GRU]'], {espera: 0})).results,
    {modelo: ens.modelo, espera: 0, miniatura: (b, t) => { miniaturas.push(t); return Promise.resolve({bytes: b.slice(0, 10), w: 40, h: 30, mime: 'image/jpeg'}); }});
  check(miniaturas.length === 4 && miniaturas.every(t => t === 'jpeg'), 'cada foto passa pela miniatura da página');

  // ---------- 3. Planilha com as fotos (planilha.js) ----------
  const book = X.rastreioBook({patterns: ['O expresso chegou [SP GRU]', 'chegou [SP GRU] A parada anterior foi []'], results: rAll.results,
    summaries: [R.summary(rAll.results, 0), R.summary(rAll.results, 1)], at: new Date(2026, 9, 21, 9, 5)});
  const tem2 = book.sheets[3];
  check(book.sheets.map(s => s.name).join('|') === 'Resumo|Bloco 1 - Tem|Bloco 1 - Não tem|Bloco 2 - Tem|Bloco 2 - Não tem' && tem2.images.length === 30 &&
    tem2.images[0].row === 4 && tem2.images[0].col === 9 && tem2.rows[3][1].v === 'FIC000000000' && tem2.heights[4] === 96 && tem2.rows[3][9].link,
    'aba Tem: a foto fica na linha da própria remessa (coluna Imagem) e o link ao lado', tem2.images[0]);
  const z = unzip(await X.build(book)), names = Object.keys(z);
  const media = names.filter(n => /^xl\/media\//.test(n));
  check(media.length === 30 && media.every(n => R.sniffImage(z[n]) === 'jpeg') && /<Default Extension="jpeg" ContentType="image\/jpeg"\/>/.test(z['[Content_Types].xml'].toString()),
    'fotos dentro do .xlsx (uma vez cada, mesmo usadas nos dois blocos)', media.length);
  const dr = names.filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n)).map(n => z[n].toString());
  const pics = dr.map(x => (x.match(/<xdr:pic>/g) || []).length);
  const draw2 = dr.filter(x => /<xdr:pic>/.test(x))[0];
  check(pics.filter(n => n === 30).length === 2 && /<xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>8<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>3<\/xdr:row>/.test(draw2) &&
    names.filter(n => /\.(xml|rels)$/.test(n)).every(n => wellFormed(z[n].toString())), 'desenho: cada foto ancorada na célula da remessa; XML bem formado', pics);
  const r4 = names.filter(n => /sheet4\.xml\.rels$/.test(n))[0];
  check(r4 && /drawing/.test(z[r4].toString()) && (z[r4].toString().match(/TargetMode="External"/g) || []).length === 30, 'links "Abrir foto" na aba');
  const semFoto = X.rastreioBook({patterns: ['', 'chegou'], results: [{w: 'FIC1', ok: true, p: [null, {t: '2026-09-09 10:00:00', shift: 'T1', img: true, url: '', n: 1}]},
    {w: 'FIC2', ok: true, p: [null, {t: '2026-09-09 10:00:00', shift: 'T1', img: false, n: 1}]}], summaries: [R.summary([], 0), R.summary([], 1)]});
  check(semFoto.sheets[1].rows[3][8].v === 'Tem imagem no JMS (ensine a foto no app)' && semFoto.sheets[1].rows[4][8].v === 'NÃO TEM IMAGEM!' && !semFoto.sheets[1].images.length,
    'sem foto: "NÃO TEM IMAGEM!" ou o aviso de ensinar');
  check(X.fitBox(360, 270, 160, 116).h === 116 && X.fitBox(270, 360, 160, 116).w === 87, 'foto cabe na célula sem deformar');

  // ---------- 4. Servidor do app (server.js) ----------
  process.env.PESQUISA_JMS_URL = 'http://127.0.0.1:' + jms.porta;
  process.env.PESQUISA_FOTO_URL = 'http://127.0.0.1:' + jms.porta;
  const os = require('os'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pesquisa-'));
  process.env.PESQUISA_CONFIG = path.join(tmp, 'config.json');
  fs.writeFileSync(process.env.PESQUISA_CONFIG, JSON.stringify({dashmaster: false}));
  const S = require('../server');
  const cfg = S.loadConfig(), srv = S.createServer(cfg);
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const porta = srv.address().port;
  const api2 = (fn, body, h) => request(porta, 'POST', '/api/' + fn, body, h).then(r => Object.assign(JSON.parse(r.text), {status: r.status}));
  // Token do servidor, como o DashMaster: sem DashMaster, o app pede o token só no computador dele e guarda nele.
  const e0 = await api2('estado', {}), j0 = await api2('jms', {url: R.KEYWORD_URL, body: R.keywordPayload(['FIC000000001'])});
  check(e0.ok && e0.result.fonte === '' && e0.result.local === true && !j0.ok && /Falta o AuthToken/.test(j0.error), 'sem token no servidor: a página avisa (passo 1)', [e0, j0.error]);
  const tRede = await api2('token', {token: TOKEN}, {'X-Forwarded-For': '10.0.0.9'});
  const tOk = await api2('token', {token: 'authtoken: ' + TOKEN}), e1 = await api2('estado', {});
  check(tRede.status === 403 && tOk.ok && e1.result.fonte === 'app' && JSON.parse(fs.readFileSync(path.join(cfg.dados, 'credenciais.json'), 'utf8')).JMS_AUTHTOKEN === TOKEN,
    'token salvo só pelo computador do app (pela rede: recusado)');
  const home = await request(porta, 'GET', '/');
  check(home.status === 200 && /window\.__PESQUISA__ = \{"versao":"1\.1\.0","plataforma":"node"\}/.test(home.text) && !/__PESQUISA_BOOT__/.test(home.text) &&
    ['rastreio.js', 'pesquisa.js', 'planilha.js', 'app.js', 'app.css'].every(f => home.text.indexOf(f) >= 0), 'página do app (Node.js)');
  const libs = await Promise.all(['/rastreio.js', '/pesquisa.js', '/planilha.js', '/app.js'].map(f => request(porta, 'GET', f)));
  check(libs.every(r => r.status === 200 && /javascript/.test(r.headers['content-type'])) && libs.every(r => { try { new Function(r.text); return true; } catch (e) { return false; } }),
    'scripts da página entregues e sem erro de sintaxe');
  const antesJ = jms.estado.chamadas.length;
  const pj = await request(porta, 'POST', '/api/jms', {url: R.KEYWORD_URL, body: R.keywordPayload(['FIC000000001']), token: 'TOKEN-DA-PAGINA', headers: {routename: 'trackingExpress', cookie: 'x', authtoken: 'y'}});
  const ch = jms.estado.chamadas[antesJ];
  check(pj.status === 200 && JSON.parse(pj.text).ok && JSON.parse(JSON.parse(pj.text).result.text).data[0].keyword === 'FIC000000001' && ch.headers.authtoken === TOKEN &&
    ch.headers.routename === 'trackingExpress' && !ch.headers.cookie, 'api/jms: consulta o JMS com o token DO SERVIDOR (o que a página mandar é ignorado; extras só os de rota)');
  const bad = JSON.parse((await request(porta, 'POST', '/api/jms', {url: 'https://outro.example/x', body: {}})).text);
  check(!bad.ok && /não permitido/.test(bad.error), 'api/jms: só o JMS');
  const ROTAS = {'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/keywordList': true, 'https://gw.jtjms-br.com/operatingplatform/abnormalPieceScanList/pageList': true,
    'https://gw.jtjms-br.com/operatingplatform/podTracking/inner/query/fotoFicticia': true, 'https://gw.jtjms-br.com/ficticio/oss/getSignedUrl?file=a.jpg': true,
    'https://gw.jtjms-br.com/ficticio/waybill/deleteWaybill': false, 'https://gw.jtjms-br.com/ficticio/user/updatePassword': false, 'https://gw.jtjms-br.com/ficticio/order/save': false,
    'https://gw.jtjms-br.com/ficticio/query/list?acao=remove': false, 'https://gw.jtjms-br.com/ficticio/query/list?acao=%72emove': false,
    'https://gw.jtjms-br.com/ficticio/query/list?x=%FF': false, 'https://gw.jtjms-br.com/ficticio/abc': false};
  const rotasErradas = Object.keys(ROTAS).filter(u => S.rotaLeitura(u) !== ROTAS[u]);
  const grava = JSON.parse((await request(porta, 'POST', '/api/jms', {url: 'https://gw.jtjms-br.com/ficticio/waybill/deleteWaybill', body: {}})).text);
  check(!rotasErradas.length && !grava.ok && /só faz consultas/.test(grava.error), 'com o token do servidor, só consultas de leitura no JMS (nada que grave ou apague)', rotasErradas);
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
    const cDm = S.credenciais(cfgDm), rDm = await S.jms({url: R.KEYWORD_URL, body: R.keywordPayload(['FIC000000003'])}, cfgDm);
    check(cDm.fonte === 'dashmaster' && cDm.JMS_AUTHTOKEN === TOKEN && rDm.status === 200 && JSON.parse(rDm.text).data[0].keyword === 'FIC000000003',
      'usa o mesmo AuthToken do DashMaster deste computador (o dele vale mais que o salvo no app)', cDm.fonte);
    fs.writeFileSync(path.join(cfg.dados, 'credenciais.json'), JSON.stringify({JMS_AUTHTOKEN: TOKEN}));
  }
  const hc = S.cabecalhos({JMS_AUTH_MODE: 'AUTHTOKEN_COOKIE', JMS_AUTHTOKEN: 'A', JMS_COOKIE: 'C'}), hk = S.cabecalhos({JMS_COOKIE: 'C'});
  check(hc.AuthToken === 'A' && hc.Cookie === 'C' && !hk.AuthToken && hk.Cookie === 'C', 'modos de acesso iguais aos do DashMaster (JMS_AUTH_MODE)');
  const fo = JSON.parse((await request(porta, 'POST', '/api/fotos', {urls: ['https://pro-ficticio.jtjms-br.com/foto/a.jpeg?sig=1', 'https://outro.example/b.jpg']})).text);
  check(fo.ok && fo.result[0].ok && Buffer.from(fo.result[0].b64, 'base64').equals(JPEG) && !fo.result[1].ok && /fora do JMS/.test(fo.result[1].error), 'api/fotos: baixa só do JMS');
  const mg = JSON.parse((await request(porta, 'POST', '/api/modelo', {acao: 'gravar', valor: JSON.stringify(ens.modelo)})).text);
  const ml = JSON.parse((await request(porta, 'POST', '/api/modelo', {acao: 'ler'})).text);
  const ma = JSON.parse((await request(porta, 'POST', '/api/modelo', {acao: 'apagar'})).text);
  const ml2 = JSON.parse((await request(porta, 'POST', '/api/modelo', {acao: 'ler'})).text);
  check(mg.ok && JSON.parse(ml.result).url === ens.modelo.url && ma.ok && ml2.result === null, 'api/modelo: grava, lê e apaga o "Ver imagem" ensinado');
  const csrf = await request(porta, 'POST', '/api/jms', {url: R.KEYWORD_URL, body: {}}, {Origin: 'http://outro-site.example'});
  const get = await request(porta, 'GET', '/api/jms');
  const form = await request(porta, 'POST', '/api/jms', 'url=x', {'Content-Type': 'application/x-www-form-urlencoded'});
  check(csrf.status === 403 && get.status === 405 && form.status === 415, 'outro site não usa o app (CSRF); só POST com JSON');
  // A página inteira pelo servidor do app (api de verdade, em vez da falsa).
  const viaApp = {
    jms: (url, body, headers) => request(porta, 'POST', '/api/jms', {url, body, headers}).then(r => { const j = JSON.parse(r.text); if (!j.ok) throw new Error(j.error); return j.result; }),
    fotos: urls => request(porta, 'POST', '/api/fotos', {urls}).then(r => JSON.parse(r.text).result)
  };
  const rv = await P.pesquisar(viaApp, WS(15), PATS, {espera: 0});
  const sv = await P.buscarFotos(viaApp, rv.results, {modelo: ens.modelo, espera: 0});
  check(rv.results.filter(x => x.p[1]).length === 15 && sv.comFoto === 15, 'pesquisa e fotos pelo servidor do app', sv);
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
    Utilities: {base64Encode: b => Buffer.from(b).toString('base64')},
    UrlFetchApp: {
      fetch: (url, req) => { fetched.push({url, req}); return {getResponseCode: () => 200, getContentText: () => '{"code":1,"data":[]}'}; },
      fetchAll: reqs => reqs.map(r => { fetched.push({url: r.url, req: r}); return /venceu/.test(r.url) ? {getResponseCode: () => 403} : {getResponseCode: () => 200, getBlob: () => ({getBytes: () => Array.from(JPEG)})}; })
    }
  };
  vm.createContext(gctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'appscript', 'Codigo.gs'), 'utf8'), gctx);
  let gErr = '', gTok = '';
  try { gctx.jms(R.KEYWORD_URL, {}, {}); } catch (e) { gTok = e.message; }
  check(gctx.estado().fonte === '' && /Propriedades do script → JMS_AUTHTOKEN/.test(gTok) && !fetched.length, 'Apps Script sem JMS_AUTHTOKEN: avisa onde cadastrar', gTok);
  props.JMS_AUTHTOKEN = TOKEN;
  const gj = gctx.jms(R.KEYWORD_URL, {keywordList: ['FIC1']}, {routename: 'trackingExpress', authtoken: 'x', cookie: 'y'});
  const gr = fetched[0];
  check(gctx.estado().fonte === 'propriedades' && gj.status === 200 && gr.req.headers.AuthToken === TOKEN && gr.req.headers.Routename === 'trackingExpress' &&
    !gr.req.headers.Cookie && gr.req.method === 'post' && JSON.parse(gr.req.payload).keywordList[0] === 'FIC1' && gr.req.followRedirects === false,
    'Apps Script jms(): consulta o JMS com o JMS_AUTHTOKEN das Propriedades do script, como o DashMaster');
  let gGrava = '';
  try { gctx.jms('https://outro.example/x', {}, {}); } catch (e) { gErr = e.message; }
  try { gctx.jms('https://gw.jtjms-br.com/ficticio/user/updatePassword', {}, {}); } catch (e) { gGrava = e.message; }
  check(/não permitido/.test(gErr) && /só faz consultas/.test(gGrava) && /OK: o JMS aceitou/.test(gctx.testarConexao()), 'Apps Script: só consultas de leitura no JMS; testarConexao() no editor');
  const gf = gctx.fotos(['https://pro-ficticio.jtjms-br.com/foto/a.jpeg', 'https://outro.example/b.jpg', 'https://pro-ficticio.jtjms-br.com/foto/venceu.jpeg']);
  check(gf[0].ok && Buffer.from(gf[0].b64, 'base64').equals(JPEG) && !gf[1].ok && /fora do JMS/.test(gf[1].error) && !gf[2].ok && /venceu/.test(gf[2].error),
    'Apps Script fotos(): baixa só do JMS; link vencido avisa');
  gctx.modelo('gravar', JSON.stringify(ens.modelo));
  check(JSON.parse(gctx.modelo('ler')).url === ens.modelo.url && gctx.modelo('apagar') === null && gctx.modelo('ler') === null, 'Apps Script modelo(): grava, lê e apaga');
  check(gctx.doGet({}).n === 'Index' && /conteúdo App/.test(gctx.include('App')), 'Apps Script doGet() e include()');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'appscript', 'appsscript.json'), 'utf8'));
  check(manifest.oauthScopes.join() === 'https://www.googleapis.com/auth/script.external_request' && manifest.webapp.executeAs === 'USER_DEPLOYING', 'manifesto: só acesso à internet');

  await jms.fechar();
  console.log('OK: ' + passed + ' verificações da Pesquisa no Rastreamento passaram (JMS simulado; dados fictícios).');
})().catch(e => { console.error('FALHOU: ' + (e && e.stack || e)); process.exit(1); });
