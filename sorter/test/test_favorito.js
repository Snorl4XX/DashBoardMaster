'use strict';
/**
 * Testes do FAVORITO (painel no próprio navegador, sem servidor) e da PLANILHA (.xlsx do botão "Baixar planilha").
 * O site/navegador.js roda num vm com um "navegador" de mentira (fetch com os cookies da sessão, document.cookie,
 * localStorage) contra o sorter FALSO, e tem que dar os MESMOS números do servidor. Números fictícios.
 * Uso: node test/test_favorito.js   (VERBOSE=1 mostra cada verificação)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const zlib = require('zlib');
const assert = require('assert');
const R = require('../lib/resumo');
const E = require('../lib/estado');
const P = require('../lib/planilha');
const {startFakeSorter} = require('./sorter_falso');
const {criarGas, startFakeGas} = require('./gas_falso');

const ROOT = path.join(__dirname, '..');
let passed = 0;
function check(cond, name, extra) {
  if (!cond) { console.error('FALHOU: ' + name, extra === undefined ? '' : extra); process.exitCode = 1; throw new Error(name); }
  passed++; if (process.env.VERBOSE) console.log('ok: ' + name);
}
// Objetos criados no vm têm outro protótipo: compara pelo conteúdo (JSON).
const igual = (a, b) => { try { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))); return true; } catch (e) { return false; } };
/** Resposta compactada do getDados (Apps Script) → linhas. */
function unpackRes(res) {
  if (!res.pacote) return res;
  const o = Object.assign({}, res);
  o.rows = R.unpack(res.rows); o.prevRows = res.prevRows ? R.unpack(res.prevRows) : null;
  if (res.rowsByDevice) { o.rowsByDevice = {}; Object.keys(res.rowsByDevice).forEach(k => { o.rowsByDevice[k] = R.unpack(res.rowsByDevice[k]); }); }
  return o;
}
/** Lê um .xlsx (ZIP sem compressão ou deflate) → {nome: texto}. */
function unzip(buf) {
  const out = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const metodo = buf.readUInt16LE(i + 8), tam = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), xl = buf.readUInt16LE(i + 28);
    const nome = buf.slice(i + 30, i + 30 + nl).toString('utf8'), ini = i + 30 + nl + xl, dados = buf.slice(ini, ini + tam);
    out[nome] = (metodo === 8 ? zlib.inflateRawSync(dados) : dados).toString('utf8');
    i = ini + tam;
  }
  return out;
}
// Relógios dos "navegadores" (a gravação no Google confere a cada 30 s): o teste chama na hora e desliga no fim.
const RELOGIOS = new Set();
/** Um "navegador" na página do sorter: os scripts do favorito num vm, com fetch, cookies (só para o sorter) e relógios. */
function navegador(base, guardado) {
  const jar = {}, store = new Map(guardado || []), intervalos = [];
  const origem = new URL(base).origin;
  const guardar = res => (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach(c => {
    const m = String(c).match(/^\s*([^=;\s]+)=([^;]*)/);
    if (m) jar[m[1]] = {v: m[2], http: /httponly/i.test(c)};
  });
  const ctx = {
    console, URL, URLSearchParams, Intl, Promise, TextEncoder,
    setTimeout: (fn, ms) => { const t = setTimeout(() => { RELOGIOS.delete(t); fn(); }, ms); RELOGIOS.add(t); return t; },
    clearTimeout: t => { RELOGIOS.delete(t); clearTimeout(t); },
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); RELOGIOS.add(t); intervalos.push({t, fn, ms}); return t; },
    clearInterval: t => { RELOGIOS.delete(t); clearInterval(t); const i = intervalos.findIndex(x => x.t === t); if (i >= 0) intervalos.splice(i, 1); },
    document: {baseURI: base + '/home', get cookie() { return Object.keys(jar).filter(k => !jar[k].http).map(k => k + '=' + jar[k].v).join('; '); }},
    localStorage: {getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)},
    fetch: async (url, opts) => {
      opts = opts || {};
      const href = new URL(url, base + '/home').href, cookies = opts.credentials !== 'omit' && new URL(href).origin === origem;
      const headers = Object.assign({}, opts.headers || {});
      if (cookies) {
        const ck = Object.keys(jar).map(k => k + '=' + jar[k].v).join('; ');
        if (ck) headers.Cookie = ck;
      }
      const res = await fetch(href, {method: opts.method || 'GET', headers, body: opts.body, redirect: 'manual'});
      if (cookies) guardar(res);
      // Segue o redirecionamento como o navegador (GET, com os cookies novos).
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) return ctx.fetch(new URL(loc, href).href, {credentials: opts.credentials});
      return res;
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['lib/resumo.js', 'lib/site.js', 'lib/estado.js', 'lib/ponte.js', 'site/navegador.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, {filename: f}));
  return {fonte: ctx.__SORTER_FONTE__, store, jar, intervalos};
}

(async function main() {
  const t0 = Date.now();
  const agora = E.agoraSP(), TODAY = agora.date, HORA = Number(agora.time.slice(0, 2));

  // ---------- 1. Planilha (.xlsx) ----------
  const xl = Buffer.from(P.criar([
    {nome: 'Resumo', larguras: [30, 14], congelar: 1, linhas: [[{v: 'Indicador', s: 'cab'}, {v: 'Quantidade', s: 'cab'}], ['Sort total', 263284], ['% No Sort Code', {v: 0.0019, s: 'pct'}],
      ['分拣机 <A&B> "x"', 1.5], [], [{v: 'Total', s: 'total'}, {v: 999, s: 'total'}]]},
    {nome: 'Por tempo: [1 hora]', linhas: [['a']]}, {nome: 'Por tempo: [1 hora]', linhas: [['b']]}
  ]));
  const z = unzip(xl);
  const nomes = Object.keys(z);
  check(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet3.xml']
    .every(n => nomes.indexOf(n) >= 0) && nomes.every(n => /^<\?xml/.test(z[n])), 'planilha: as partes do .xlsx (Excel / Google Planilhas / LibreOffice)', nomes);
  const s1 = z['xl/worksheets/sheet1.xml'];
  check(/<c r="B2" s="2"><v>263284<\/v><\/c>/.test(s1) && /<c r="B3" s="3"><v>0.0019<\/v>/.test(s1) && s1.indexOf('分拣机 &lt;A&amp;B&gt; &quot;x&quot;') > 0 &&
    /<c r="B4" s="7"><v>1.5<\/v>/.test(s1) && /<pane ySplit="1"/.test(s1) && /<row r="5"><\/row>/.test(s1) && /<c r="A6" t="inlineStr" s="5">/.test(s1),
    'planilha: números com milhar, %, decimais, texto com acentos e símbolos, linha congelada, total em negrito');
  check(/name="Por tempo   1 hora "/.test(z['xl/workbook.xml']) && /name="Por tempo   1 hora  2"/.test(z['xl/workbook.xml']) && P.coluna(0) === 'A' && P.coluna(27) === 'AB',
    'planilha: nome de aba sem caracteres proibidos e sem repetir', z['xl/workbook.xml']);
  const xl2 = Buffer.from(P.criar([{nome: 'x', linhas: [['a']]}]));
  check(igual(xl2, Buffer.from(P.criar([{nome: 'x', linhas: [['a']]}]))), 'planilha: o mesmo conteúdo dá o mesmo arquivo');
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8'), idx = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  check(/id="excelBtn"/.test(idx) && /src="planilha\.js"/.test(idx) && /SorterPlanilha\.criar\(abasPlanilha\(x\)\)/.test(appJs) &&
    ['shResumo', 'shTempo', 'shEvo', 'shBal', 'shHoras'].every(k => appJs.indexOf("t('" + k + "')") > 0), 'botão "Baixar planilha" com as 5 abas (Resumo, Por tempo, Evolução, Balanças, Dados por hora)');

  // ---------- 2. O favorito montado ----------
  const G = require('../gerar-favorito.js'), m = G.montar();
  let sintaxe = '';
  try { new Function(m.codigo); } catch (e) { sintaxe = e.message; }
  check(!sintaxe && /^javascript:/.test(m.url) && m.url.length < 1.5 * 1024 * 1024 && decodeURIComponent(m.url.slice(11)).indexOf(m.codigo) === 0,
    'favorito: um código só, válido, dentro do limite do navegador para favoritos', {sintaxe, kb: Math.round(m.url.length / 1024)});
  check(['function SorterResumoFactory_', 'root.SorterSite', 'root.SorterEstado', '__SORTER_FONTE__', 'root.SorterPlanilha', 'root.SorterPonte', 'site: true', 'id="excelBtn"', 'id="saveBtn"']
    .every(x => m.html.indexOf(x) > 0) && !/src="(resumo|planilha|app)\.js"|href="app\.css"|__SORTER_BOOT__/.test(m.html),
    'favorito: a página do painel vai inteira dentro (sem arquivos de fora, só gráficos e fonte da internet)');
  const inst = G.paginaInstalar(m, true);
  check(/^<!DOCTYPE html>/.test(inst) && inst.indexOf('href="javascript:') > 0 && inst.indexOf('__FAVORITO') < 0 && /Ctrl\+Shift\+O/.test(inst),
    'instalar-favorito.html: arrastar para a barra ou copiar e colar no gerenciador de favoritos');

  // ---------- 3. navegador.js: o painel lendo o site com a sessão do navegador ----------
  process.env.SORTER_CONFIG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sorter-fav-')), 'config.json');
  const fake = await startFakeSorter({today: TODAY, nowHour: HORA});
  fs.writeFileSync(process.env.SORTER_CONFIG, JSON.stringify({sorterUrl: fake.url + '/home', maxBalancas: 10}));
  const srv = require('../server.js');
  const local = srv.criarEstado(srv.loadConfig());
  const nav = navegador(fake.url);
  const sorters0 = nav.fonte.sorters().map(s => s.id + (s.pronto ? '+' : '-')).join();
  const dT = await nav.fonte.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  const lT = await local.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  const campos = r => ({ok: r.ok, from: r.from, to: r.to, prevFrom: r.prevFrom, rows: r.rows, prevRows: r.prevRows, rowsByDevice: r.rowsByDevice, balancas: r.balancas,
    devices: r.devices.map(d => [d.id, d.ok, !!d.pendente])});
  check(sorters0 === 'B+,A+' && dT.ok && igual(campos(dT), campos(lT)) && R.sumRows(dT.rowsByDevice.A).total !== R.sumRows(dT.rowsByDevice.B).total,
    'favorito: Todos juntos com os MESMOS números do servidor (A e B, período anterior, balanças)', !igual(campos(dT), campos(lT)) && Object.keys(campos(dT)).filter(k => !igual(campos(dT)[k], campos(lT)[k])));
  const minhas = Object.keys(fake.sessions).filter(k => nav.jar.laravel_session && nav.jar.laravel_session.v === k);
  const salvo = JSON.parse(nav.store.get('jt_sorter_favorito_troca'));
  const reais = fake.trocas.filter(t => t.path === '/home/switchDevice');
  check(minhas.length === 1 && fake.sessions[minhas[0]].device === 'B' && salvo.inicial === 'B' && salvo.troca.A.corpo === 'device_id=3' &&
    reais.length && reais.every(t => t.tokenNoCorpo), 'favorito: troca A/B com o _token da sessão, guardada no navegador; no fim o site volta para o sorter que estava', {salvo, sess: fake.sessions[minhas[0]]});
  const q2 = [{de: TODAY, ate: TODAY, sorter: 'A', balanca: 'A:3'}, {de: E.addDays(TODAY, -6), ate: TODAY, sorter: 'B', turnos: 'T1'},
    {de: E.addDays(TODAY, -3), ate: TODAY, sorter: 'todos', hIni: '22', hFim: '5'}];
  for (const q of q2) {
    const a = await nav.fonte.dados(q), b = await local.dados(q);
    check(igual(campos(a), campos(b)), 'favorito = servidor: ' + JSON.stringify(q));
  }
  // Outra aba com a troca já guardada neste navegador: usa direto, sem descobrir de novo.
  const navB = navegador(fake.url, nav.store);
  const trocas0 = fake.trocas.length;
  const dA = await navB.fonte.dados({de: TODAY, ate: TODAY, sorter: 'A'});
  await new Promise(r => setTimeout(r, 200));   // a volta para o sorter de antes (B) roda logo depois
  // Descobrir de novo testaria A e B várias vezes; com a troca guardada: só "para o A" e "de volta para o B".
  const semDescobrir = fake.trocas.length - trocas0 === 2;
  check(dA.ok && igual(dA.rows, (await local.dados({de: TODAY, ate: TODAY, sorter: 'A'})).rows) && /guardada neste navegador/.test(navB.fonte.relatorio()[0]) && semDescobrir,
    'favorito numa aba nova: usa a troca guardada (sem descobrir de novo) e lê o Sorter A certo', navB.fonte.relatorio());
  // Atualizar: força a leitura de novo (sem cache).
  const nCalls = fake.calls.length;
  await nav.fonte.dados({de: TODAY, ate: TODAY, sorter: 'B', forcar: '1'});
  check(fake.calls.length > nCalls, 'Atualizar no favorito lê o sorter de novo');
  // Página sem a troca: B funciona, A fica pendente com o relatório para mandar.
  fake.pagina = 'nada';
  const nav3 = navegador(fake.url);
  const dN = await nav3.fonte.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  const rel = nav3.fonte.relatorio().join('\n');
  check(dN.ok && dN.devices.find(d => d.id === 'A').pendente && /Ensinar a troca/.test(dN.devices.find(d => d.id === 'A').error) &&
    !/config\.json|descobrir\.bat/.test(dN.devices.find(d => d.id === 'A').error) && nav3.fonte.sorters().map(s => s.id + (s.pronto ? '+' : '-')).join() === 'B+,A-' &&
    /_token \(CSRF\) na página: sim/.test(rel) && Object.values(fake.sessions).every(s => rel.indexOf(s.csrf) < 0),
    'favorito numa página sem a troca: B lido, A com aviso e o relatório (sem token nem cookie)', dN.devices);
  fake.pagina = 'ajax';
  const pr = await nav3.fonte.procurarTroca();
  check(pr.ok && nav3.fonte.sorters().every(s => s.pronto), '"Procurar a troca de novo" acha quando a página passa a ter a troca');

  // ---------- 4. Sorter A com a troca "ensinada" no site (quando o painel não acha sozinho) ----------
  fake.pagina = 'externo';
  fs.writeFileSync(process.env.SORTER_CONFIG, JSON.stringify({sorterUrl: fake.url + '/home', maxBalancas: 10,
    sorters: [{id: 'B', padrao: true, troca: false}, {id: 'A', troca: {metodo: 'POST', caminho: '/api/equip/select', corpo: 'cod=3'}}]}));
  const localE = srv.criarEstado(srv.loadConfig());
  const navE = navegador(fake.url);
  const dE = await navE.fonte.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  const errE = (dE.devices.find(d => d.id === 'A') || {}).error || '';
  check(dE.ok && /Ensinar a troca/.test(errE) && /Cross-belt GRU-A/.test(errE) && R.sumRows(dE.rows).total === R.sumRows((await localE.dados({de: TODAY, ate: TODAY, sorter: 'B'})).rows).total,
    'troca num arquivo à parte (o painel não acha): B lido; A pede "Ensinar a troca" (escolher Cross-belt GRU-A no site)', errE);
  // O que o favorito guarda ao ver o clique em Cross-belt GRU-A no site (o _token vira {token}).
  const ensinado = {A: {metodo: 'POST', caminho: '/api/equip/select', corpo: '_token={token}&cod=3'}, quando: '2026-10-17T12:00:00Z'};
  const navT = navegador(fake.url, [['jt_sorter_aprendido', JSON.stringify(ensinado)]]);
  fake.trocas = [];
  const dT2 = await navT.fonte.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  const lA = await localE.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  const guardou = JSON.parse(navT.store.get('jt_sorter_favorito_troca') || '{}');
  check(dT2.ok && igual(campos(dT2), campos(lA)) && !navT.store.has('jt_sorter_aprendido') && guardou.troca && guardou.troca.A.caminho === '/api/equip/select' &&
    /✓ Troca ensinada no site para o Sorter A/.test(navT.fonte.relatorio().join('\n')) && fake.trocas.length && fake.trocas.every(t => t.tokenNoCorpo) &&
    navT.fonte.sorters().every(x => x.pronto), 'troca ensinada: testada (os números mudam), guardada e usada — Sorter A igual ao servidor, com o _token da sessão',
    {rel: navT.fonte.relatorio(), devs: dT2.devices});
  const navT2 = navegador(fake.url, navT.store);
  const dT3 = await navT2.fonte.dados({de: TODAY, ate: TODAY, sorter: 'A'});
  check(dT3.ok && igual(dT3.rows, lA.rowsByDevice.A), 'troca ensinada continua guardada ao abrir o favorito de novo');
  const navR = navegador(fake.url, [['jt_sorter_aprendido', JSON.stringify({A: {metodo: 'POST', caminho: '/home/setLang', corpo: '_token={token}&lang=zh'}})]]);
  const dR = await navR.fonte.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  check(dR.ok && dR.devices.find(d => d.id === 'A').pendente && /✗ Troca ensinada/.test(navR.fonte.relatorio().join('\n')) && !navR.store.has('jt_sorter_favorito_troca'),
    'troca ensinada que não muda os números é recusada (o A continua pedindo para ensinar)', navR.fonte.relatorio());
  // O sorter padrão (B) é lido numa sessão nova: ler só o B não troca nada na sessão do navegador.
  const navB2 = navegador(fake.url, navT.store), tB = fake.trocas.length;
  const dB2 = await navB2.fonte.dados({de: TODAY, ate: TODAY, sorter: 'B'});
  check(dB2.ok && fake.trocas.length === tB && !navB2.jar.laravel_session, 'Sorter B lido sem trocar nada e sem usar a sessão do navegador');
  fake.pagina = 'ajax';

  // ---------- 5. "Gravar no Google": o favorito manda os dias para o Apps Script (planilha) ----------
  const g = criarGas({agora: TODAY + ' ' + agora.time});
  const cf = g.chamar('configurar'), gas = await startFakeGas(g);
  const navG = navegador(fake.url), vistos = [];
  navG.fonte.gravar.ouvir(e => vistos.push(e));
  const e0 = navG.fonte.gravar.estado();
  check(e0.disponivel && !e0.ligado && !navG.intervalos.length, 'gravar: começa desligado (nada vai para o Google sem o link e a chave)', e0);
  const recusa = async (url, chave) => { try { await navG.fonte.gravar.salvar(url, chave); return ''; } catch (e) { return e.message; } };
  const rUrl = await recusa('https://script.google.com/macros/s/abc/edit', cf.chave), rChave = await recusa(gas.url, 'curta');
  check(/termina em \/exec/.test(rUrl) && /letras e números/.test(rChave) && !navG.store.has('jt_sorter_gravar') && gas.posts === 0,
    'gravar: link que não é do App da Web e chave errada são recusados antes de mandar', {rUrl, rChave});
  const e1 = await navG.fonte.gravar.salvar(gas.url, cf.chave);
  const linhasG = g.aba().rows.slice(1), hojeG = linhasG.find(r => r[0] === TODAY && r[1] === 'B');
  const dG = await navG.fonte.dados({de: TODAY, ate: TODAY, sorter: 'todos'});
  const infoG = JSON.parse(g.props.INFO);
  check(e1.ligado && e1.url === gas.url && e1.ultimo && e1.ultimo.dias === linhasG.length && e1.ultimo.dias > 92 && !e1.ultimo.erros.length &&
    linhasG.some(r => r[1] === 'A') && hojeG && hojeG[4] === R.sumRows(dG.rowsByDevice.B).total && /^favorito /.test(infoG.versaoPonte) &&
    infoG.sorters.every(x => x.pronto) && JSON.parse(navG.store.get('jt_sorter_gravar')).chave === cf.chave,
    'gravar: salvar manda o histórico dos dois sorters na hora (um dia por linha na planilha) e guarda o link e a chave neste navegador',
    {dias: e1.ultimo, linhas: linhasG.length, versao: infoG.versaoPonte});
  check(vistos.some(x => x.rodando && x.motivo === 'ligado agora') && !vistos[vistos.length - 1].rodando && navG.intervalos.length === 1 && navG.intervalos[0].ms === 30000,
    'gravar: a tela vê "gravando…" e o fim; depois o favorito confere o Google a cada 30 s', vistos.map(x => x.motivo + (x.rodando ? '…' : '')));
  const gT = unpackRes(g.chamar('getDados', {de: TODAY, ate: TODAY, sorter: 'todos'}));
  check(gT.ok && igual(gT.rows, dG.rows) && igual(gT.rowsByDevice, dG.rowsByDevice) && gT.ponte.ligada,
    'gravar: o link do Apps Script mostra os mesmos números do favorito (de qualquer lugar)');
  const semanaG = unpackRes(g.chamar('getDados', {de: E.addDays(TODAY, -30), ate: E.addDays(TODAY, -1), sorter: 'B'}));
  const semanaL = await navG.fonte.dados({de: E.addDays(TODAY, -30), ate: E.addDays(TODAY, -1), sorter: 'B'});
  check(semanaG.ok && R.sumRows(semanaG.rows).total > 0 && igual(semanaG.rows, semanaL.rows), 'gravar: dias passados também ficam guardados (30 dias = favorito)');

  // Botão Atualizar no link do Google: o pedido fica no Apps Script; o favorito aberto confere e manda na hora.
  const conferir = () => navG.intervalos[0].fn();
  await conferir();
  const postsG = gas.posts;
  const pedG = g.chamar('pedirAtualizacao');
  g.agora = TODAY + ' ' + E.agoraSP().time;
  await conferir();
  const depoisG = g.chamar('getDados', {de: TODAY, ate: TODAY, sorter: 'B', desde: E.addDays(TODAY, -1) + ' 23:59:59'});
  const e2 = navG.fonte.gravar.estado();
  check(pedG.ok && pedG.ligada && gas.posts > postsG && /Atualizar/.test(e2.motivo) && e2.ultimo.dias >= 2 && e2.ultimo.dias < e1.ultimo.dias && depoisG.ok,
    'gravar: "Atualizar" no link do Google → o favorito aberto lê o sorter e manda só hoje (o histórico já está lá)', {motivo: e2.motivo, dias: e2.ultimo.dias});

  // Abrir o favorito de novo: a gravação volta sozinha (sem pedir o link e a chave de novo).
  const navG2 = navegador(fake.url, navG.store);
  const e3 = navG2.fonte.gravar.estado();
  const rVazia = await navG2.fonte.gravar.salvar(gas.url, '');
  check(e3.ligado && e3.url === gas.url && rVazia.ligado && rVazia.ultimo && JSON.parse(navG2.store.get('jt_sorter_gravar')).chave === cf.chave,
    'gravar: abrir o favorito de novo continua gravando; chave em branco mantém a guardada');
  navG2.fonte.gravar.desligar();

  // Chave que não é a do configurar(): o Apps Script recusa e a tela mostra o motivo.
  const navW = navegador(fake.url);
  let rW = '';
  try { await navW.fonte.gravar.salvar(gas.url, 'X'.repeat(40)); } catch (e) { rW = e.message; }
  check(/chave da ponte inválida/.test(rW) && /chave da ponte inválida/.test(navW.fonte.gravar.estado().erro), 'gravar: chave que o Apps Script não conhece → aviso claro', rW);
  navW.fonte.gravar.desligar();

  const e4 = navG.fonte.gravar.desligar();
  check(!e4.ligado && !navG.store.has('jt_sorter_gravar') && !navG.intervalos.length, 'gravar: Desligar para de mandar e apaga o link e a chave deste navegador');
  gas.server.close();
  RELOGIOS.forEach(t => clearTimeout(t));

  fake.server.close();
  console.log('OK: ' + passed + ' verificações do favorito e da planilha passaram (' + Math.round((Date.now() - t0) / 1000) + ' s; sorter simulado por HTTP).');
})().catch(e => { if (!process.exitCode) console.error(e); process.exit(1); });
