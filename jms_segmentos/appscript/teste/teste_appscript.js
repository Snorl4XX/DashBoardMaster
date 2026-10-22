/**
 * Teste do Codigo.gs (JMS Segmentos no Apps Script) com Google e JMS de mentira — tudo fictício (remessas 777..., códigos XA..XD).
 * Uso: node jms_segmentos/appscript/teste/teste_appscript.js
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'Codigo.gs'), 'utf8');
let falhas = 0, oks = 0;
function check(ok, nome, extra) {
  if (ok) { oks++; console.log('OK   ' + nome); return; }
  falhas++;
  console.log('FALHOU ' + nome + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''));
}

// ---------- JMS falso ----------
const S1 = ['XA', 'XB', 'XC', 'XD'];
function esperado(w) {
  const n = Number(String(w).slice(-6));
  if (n % 50 === 0) return null;            // não existe no JMS
  if (n % 37 === 0) return ['', ''];        // existe, sem código
  return [S1[n % 4], (100 + n % 7) + '-0' + (n % 3)];
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- Google falso ----------
function criarGoogle(o) {
  o = Object.assign({token: 'tok-ficticio-1', rota: 'trackingExpress', falha: 0, redeFalha: 0, seed: 7}, o || {});
  const g = {relogio: 1.7e12, chamadas: 0, gatilhos: [], alertas: [], toasts: [], formatos: [], props: {script: {}, doc: {}}, o, ui: {resposta: 'YES', prompt: ''}};
  const rnd = rng(o.seed);
  let travado = false;

  function resp(code, text) { return {getResponseCode: () => code, getContentText: () => text}; }
  function jms(req) {
    g.chamadas++;
    if (o.quotaApos !== undefined && g.chamadas > o.quotaApos) throw new Error('Service invoked too many times for one day: urlfetch.');
    if (o.aoChamar) o.aoChamar(g.chamadas);
    if (o.expiraApos !== undefined && g.chamadas > o.expiraApos) { o.token = o.tokenNovo; delete o.expiraApos; }
    const h = req.headers || {};
    if (h.AuthToken !== o.token) return resp(200, JSON.stringify({code: 135010037, msg: 'token失效，请重新登录', succ: false, data: null}));
    if (o.rota && h.Routename !== o.rota) return resp(200, JSON.stringify({code: 135010001, msg: '没有权限访问', succ: false}));
    if (rnd() < o.falha) {
      const t = Math.floor(rnd() * 4);
      if (t === 0) return resp(502, '<html>Bad Gateway</html>');
      if (t === 1) return resp(200, JSON.stringify({code: 0, msg: '系统繁忙，请稍后再试', succ: false}));
      if (t === 2) return resp(200, '');
      return resp(200, JSON.stringify({code: 1, msg: 'success', succ: true, data: {}}));
    }
    const w = JSON.parse(req.payload).waybillNo, e = esperado(w);
    if (!e) return resp(200, JSON.stringify({code: 1, msg: '1:Solicitação concluída', succ: true, data: {details: null}}));
    const det = {waybillNo: w, terminalDispatchCode: e[0] ? e[0] + ',' + e[1] + ',900' : null, receiverPostalCode: '00000000'};
    return resp(200, JSON.stringify({code: 1, msg: '1:Solicitação concluída', succ: true, data: {waybillNo: w, details: det}}));
  }

  function semFim(alvo) { // métodos de formatação que o teste não confere: devolvem o próprio objeto
    return new Proxy(alvo, {get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => semFim(t) : undefined))});
  }
  class Folha {
    constructor(nome) { this.nome = nome; this.cel = []; this.maxRows = 1000; this.graficos = []; this.ativa = [1, 1]; }
    getName() { return this.nome; }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(_, n) { this.maxRows += n; }
    getLastRow() { for (let r = this.cel.length; r > 0; r--) if ((this.cel[r - 1] || []).some(v => v !== '' && v !== undefined && v !== null)) return r; return 0; }
    getLastColumn() { let m = 0; this.cel.forEach(l => { for (let c = (l || []).length; c > m; c--) if (l[c - 1] !== '' && l[c - 1] !== undefined) { m = c; break; } }); return m; }
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > this.maxRows) throw new Error('Intervalo fora da planilha: ' + [r, c, nr, nc] + ' (máx. ' + this.maxRows + ' linhas)');
      return semFim(new Faixa(this, r, c, nr, nc));
    }
    clear() { this.cel = []; }
    getFilter() { return null; }
    getActiveCell() { return this.getRange(this.ativa[0], this.ativa[1]); }
    getCharts() { return this.graficos.slice(); }
    removeChart(x) { this.graficos = this.graficos.filter(y => y !== x); }
    insertChart(x) { this.graficos.push(x); }
    newChart() {
      const ch = {opcoes: {}, faixas: []};
      const b = semFim({
        setChartType: t => { ch.tipo = t; return b; }, addRange: f => { ch.faixas.push(f); return b; },
        setOption: (k, v) => { ch.opcoes[k] = v; return b; }, setPosition: (r, c) => { ch.pos = [r, c]; return b; }, build: () => ch
      });
      return b;
    }
    setFrozenRows() {} setColumnWidth() {}
  }
  class Faixa {
    constructor(f, r, c, nr, nc) { Object.assign(this, {f, r, c, nr, nc}); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) { const l = this.f.cel[this.r - 1 + i] || []; const x = []; for (let j = 0; j < this.nc; j++) { const v = l[this.c - 1 + j]; x.push(v === undefined || v === null ? '' : v); } out.push(x); }
      return out;
    }
    setValues(v) {
      if (v.length !== this.nr || v.some(l => l.length !== this.nc)) throw new Error('Tamanho dos dados não confere com o intervalo');
      for (let i = 0; i < this.nr; i++) { const L = this.f.cel[this.r - 1 + i] = this.f.cel[this.r - 1 + i] || []; for (let j = 0; j < this.nc; j++) L[this.c - 1 + j] = v[i][j]; }
      return semFim(this);
    }
    setValue(x) { return this.setValues([[x]]); }
    setNumberFormat(fm) { g.formatos.push({folha: this.f.nome, r: this.r, c: this.c, nr: this.nr, nc: this.nc, fm}); return semFim(this); }
    getColumn() { return this.c; }
  }
  const planilha = {
    folhas: [], ativa: null,
    getActiveSheet() { return this.ativa; }, setActiveSheet(f) { this.ativa = f; return f; },
    getSheetByName(n) { return this.folhas.find(f => f.nome === n) || null; },
    insertSheet(n) { const f = new Folha(n); this.folhas.push(f); return f; },
    toast(m) { g.toasts.push(m); }
  };
  const ui = {
    ButtonSet: {OK: 'OK', YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL'}, Button: {OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL'},
    alert(t, m, b) { g.alertas.push(m === undefined ? t : m); return b === 'YES_NO' ? g.ui.resposta : 'OK'; },
    prompt() { return {getSelectedButton: () => 'OK', getResponseText: () => g.ui.prompt}; },
    createMenu() { const m = {addItem: () => m, addSeparator: () => m, addToUi: () => { g.menu = true; }}; return m; }
  };
  function loja(obj) {
    return {
      getProperty: k => (k in obj ? obj[k] : null), setProperty: (k, v) => { obj[k] = String(v); }, deleteProperty: k => { delete obj[k]; },
      getProperties: () => Object.assign({}, obj)
    };
  }
  g.planilha = planilha;
  g.ctx = vm.createContext({
    console: {log: () => {}},
    SpreadsheetApp: {getActive: () => planilha, getUi: () => ui, flush: () => {}},
    UrlFetchApp: {
      fetchAll: reqs => {
        g.relogio += 1200;
        if (rnd() < o.redeFalha) throw new Error('Address unavailable: https://gw.jtjms-br.com');
        return reqs.map(jms);
      },
      fetch: (url, req) => { g.relogio += 300; return jms(req); }
    },
    Utilities: {sleep: ms => { g.relogio += ms; }, formatDate: () => '22/10/2026 12:00'},
    ScriptApp: {
      newTrigger: fn => { const t = {timeBased: () => t, after: () => t, create: () => { g.gatilhos.push(fn); }}; return t; },
      getProjectTriggers: () => g.gatilhos.map(fn => ({getHandlerFunction: () => fn, fn})),
      deleteTrigger: t => { const i = g.gatilhos.indexOf(t.fn); if (i >= 0) g.gatilhos.splice(i, 1); }
    },
    LockService: {getDocumentLock: () => ({tryLock: () => (travado ? false : (travado = true)), releaseLock: () => { travado = false; }})},
    PropertiesService: {getScriptProperties: () => loja(g.props.script), getDocumentProperties: () => loja(g.props.doc)},
    Charts: {ChartType: {BAR: 'BAR'}}
  });
  vm.runInContext(CODIGO, g.ctx, {filename: 'Codigo.gs'});
  g.ctx.agora_ = () => g.relogio;
  g.aba = nome => planilha.getSheetByName(nome);
  g.novaAba = (nome, linhas) => { const f = planilha.insertSheet(nome); f.cel = linhas.map(l => l.slice()); f.maxRows = Math.max(1000, linhas.length); planilha.ativa = f; return f; };
  /** Dispara os gatilhos de 1 minuto até acabar (como o Google). → execuções e o maior tempo de uma execução */
  g.esperarGatilhos = (max) => {
    let n = 0, maior = 0;
    while (g.gatilhos.length && n < (max || 50)) {
      g.relogio += 60000; n++;
      const ini = g.relogio;
      g.ctx.continuarSozinho();
      maior = Math.max(maior, g.relogio - ini);
    }
    return {n, maior};
  };
  g.resultado = () => { const f = g.aba('Segmentos'); return f.getRange(2, 1, f.getLastRow() - 1, 4).getValues(); };
  g.andamento = () => String(g.aba('Segmentos').getRange(2, 6).getValues()[0][0]);
  return g;
}
function remessa(i) { return '777' + String(i).padStart(12, '0'); }
function conferir(g, lista, nome) {
  const linhas = g.resultado(), porW = {};
  linhas.forEach(l => { porW[l[0]] = l; });
  const errados = [];
  lista.forEach(w => {
    const l = porW[w], e = esperado(w);
    if (!l) errados.push([w, 'faltou']);
    else if (!e) { if (l[3] !== 'Não encontrada no JMS') errados.push(l); }
    else if (!e[0]) { if (l[3] !== 'Sem código no JMS' || l[1] || l[2]) errados.push(l); }
    else if (l[1] !== e[0] || l[2] !== e[1] || l[3] !== 'OK') errados.push(l);
  });
  check(!errados.length && linhas.length === lista.length, nome, {errados: errados.slice(0, 4), qtd: errados.length, linhas: linhas.length});
}

// 1) Respostas do JMS (iguais às do PDF: data.details.terminalDispatchCode "MT,956-00,565" → MT e 956-00; o 3º fica fora).
{
  const g = createUnit();
  function createUnit() { return criarGoogle(); }
  const cl = (s, t) => g.ctx.classificar_({status: s, text: typeof t === 'string' ? t : JSON.stringify(t)});
  const ok = cl(200, {code: 1, msg: '1:Solicitação concluída', succ: true, data: {waybillNo: '1', details: {terminalDispatchCode: 'MT,956-00,565'}}});
  check(ok.tipo === 'ok' && ok.s1 === 'MT' && ok.s2 === '956-00', 'lê os 2 códigos e deixa o 3º de fora', ok);
  check(cl(200, {code: 1, succ: true, data: {details: {terminalDispatchCode: null}}}).tipo === 'semcodigo', 'remessa sem código');
  check(cl(200, {code: 1, succ: true, data: {details: null}}).tipo === 'vazio' && cl(200, {code: 1, succ: true, data: {}}).tipo === 'vazio', 'sem Informação básica = vazio');
  check(cl(200, {code: 0, msg: '系统繁忙', succ: false}).tipo === 'passageira' && cl(502, '<html>').tipo === 'passageira' && cl(200, '').tipo === 'passageira',
    'JMS ocupado/recusa/vazio = tentar de novo');
  check(cl(200, {code: 135010037, msg: 'token失效，请重新登录', succ: false}).tipo === 'auth' && cl(401, '').tipo === 'auth' && cl(200, '<html>login').tipo === 'auth',
    'token recusado = parar');
  check(g.ctx.limparToken_(' authToken: "abc-123-xyz-ficticio"\n') === 'abc-123-xyz-ficticio', 'limpa o AuthToken colado');
}

// 2) Muitas remessas: 12.000 numa aba com título, cabeçalho "Nº da Remessa" na linha 2, números, repetidas e lixo.
//    JMS exige Routename e falha 20% das vezes (502, "系统繁忙", vazio, sem dados).
const N = 12000, LISTA = [];
for (let i = 1; i <= N; i++) LISTA.push(remessa(i));
{
  const g = criarGoogle({falha: 0.2, redeFalha: 0.02});
  g.ctx.onOpen();
  check(g.menu, 'menu JMS Segmentos aparece');
  g.ui.prompt = 'authToken: tok-ficticio-1';
  g.ctx.colocarToken();
  check(g.props.script.JMS_AUTHTOKEN === 'tok-ficticio-1' && !g.alertas.join(' ').includes('tok-ficticio'), 'guarda o AuthToken sem mostrar');
  const linhas = [['Base de remessas fictícias'], ['Data', 'Cliente', 'Nº da Remessa']];
  LISTA.forEach((w, i) => linhas.push(['2026-10-22', 'Cliente', i % 2 ? Number(w) : w]));
  LISTA.slice(0, 30).forEach(w => linhas.push(['', '', w]));
  linhas.push(['', '', 'texto qualquer'], ['', '', '']);
  const base = g.novaAba('Base', linhas);
  check(g.ctx.lerRemessas_(base).lista.length === N && g.ctx.lerRemessas_(base).titulo === 'Nº da Remessa', 'acha a coluna "Nº da Remessa" e lê 12.000 (sem repetidas e sem lixo)');
  const t = g.ctx.testarConexao();
  check(/Routename trackingExpress: OK/.test(t) && /Código de primeiro segmento: XB/.test(t) && !t.includes('tok-ficticio') && g.props.doc.SEG_ROTA === 'trackingExpress',
    'testar conexão: acha o Routename, mostra os 2 códigos e não mostra o token', t);
  delete g.props.doc.SEG_ROTA; // a pesquisa também descobre sozinha
  const ini = g.relogio;
  const r1 = g.ctx.pesquisar();
  check(g.relogio - ini < 300000 && r1.parada === 'tempo' && g.gatilhos.length === 1, '1ª execução para antes dos 6 min e agenda a continuação', {s: (g.relogio - ini) / 1000, r1});
  check(/Continua sozinha em 1 minuto/.test(g.andamento()), 'andamento na aba Segmentos', g.andamento());
  const ex = g.esperarGatilhos();
  check(ex.maior < 300000 && !g.gatilhos.length, 'continua sozinha até acabar (' + (ex.n + 1) + ' execuções, nenhuma passa de 5 min)', ex);
  conferir(g, LISTA, '12.000 remessas com JMS falhando 20%: todas com os 2 códigos certos, "Não encontrada" só nas que não existem');
  console.log('     consultas ao JMS: ' + g.chamadas + ' para ' + N + ' remessas');
  check(g.props.doc.SEG_ROTA === 'trackingExpress', 'descobriu o Routename sozinha');
  check(/^Pronto/.test(g.andamento()), 'andamento: Pronto', g.andamento());
  check(g.formatos.some(f => f.folha === 'Segmentos' && f.r === 1 && f.c === 1 && f.nc === 3 && f.nr === N + 1 && f.fm === '@'), 'remessa e códigos gravados como texto');
  const rs = g.aba('Resumo Segmentos'), t1 = rs.getRange(5, 1, 4, 2).getValues(), t2 = rs.getRange(5, 5, 21, 2).getValues();
  const comCodigo = LISTA.filter(w => esperado(w) && esperado(w)[0]).length;
  check(t1.reduce((a, l) => a + l[1], 0) === comCodigo && t1.every(l => S1.includes(l[0])), 'Resumo: tabela do 1º código soma as remessas com código', t1);
  check(t2.reduce((a, l) => a + l[1], 0) === comCodigo && t2.every(l => /^\d{3}-0\d$/.test(l[0])), 'Resumo: tabela do 2º código', t2.slice(0, 3));
  check(rs.graficos.length === 2 && rs.graficos[1].opcoes.title.includes('15') && rs.graficos.every(c => c.tipo === 'BAR' && c.opcoes.colors[0] === '#E31E24'),
    'Resumo: 2 gráficos de barras', rs.graficos.map(c => c.opcoes.title));
  check(!String(rs.getRange(2, 1).getValues()[0][0]).includes('900'), 'o 3º código (900) não aparece');
}

// 3) Token vence no meio: para, avisa e guarda o que veio; AuthToken novo + ⏩ Continuar termina.
{
  const lista = LISTA.slice(0, 3000);
  const g = criarGoogle({falha: 0.05, expiraApos: 900, tokenNovo: 'tok-ficticio-2'});
  g.props.script.JMS_AUTHTOKEN = 'tok-ficticio-1';
  g.novaAba('Base', [['Remessa']].concat(lista.map(w => [w])));
  const r = g.ctx.pesquisar();
  const c = g.ctx.contar_(g.resultado());
  check(r.parada === 'auth' && !g.gatilhos.length && c.fila > 0 && c.ok > 500 && /recusou o AuthToken/.test(g.andamento()), 'token vencido: para, avisa e guarda o que já veio', {r, c, a: g.andamento()});
  g.ui.prompt = 'tok-ficticio-2';
  g.ctx.colocarToken();
  const r2 = g.ctx.continuar();
  g.esperarGatilhos();
  conferir(g, lista, 'depois do AuthToken novo, ⏩ Continuar completa tudo');
  check(r2 && r2.parada !== 'auth', 'continuar com token novo', r2);
}

// 4) ⏹ Parar no meio; ⏩ Continuar termina. Cota do Google acabou: para e avisa.
{
  const lista = LISTA.slice(0, 4000);
  const g = criarGoogle({falha: 0.05});
  g.props.script.JMS_AUTHTOKEN = 'tok-ficticio-1';
  g.props.doc.SEG_ROTA = 'trackingExpress';
  g.o.aoChamar = n => { if (n === 1500) g.ctx.parar(); };
  g.novaAba('Base', [['Remessa']].concat(lista.map(w => [w])));
  const r = g.ctx.pesquisar();
  check(r.parada === 'parado' && !g.gatilhos.length && /Parada por você/.test(g.andamento()), '⏹ Parar: para e não agenda', r);
  g.o.aoChamar = null;
  g.o.quotaApos = g.chamadas + 700;
  const rq = g.ctx.continuar();
  check(rq.parada === 'cota' && !g.gatilhos.length && /cota de consultas do Google/.test(g.andamento()), 'cota do Google acabou: para e avisa', rq);
  delete g.o.quotaApos;
  g.ctx.continuar();
  g.esperarGatilhos();
  conferir(g, lista, 'depois de parar e da cota, ⏩ Continuar completa tudo');
}

// 5) Sem cabeçalho: usa a coluna da célula selecionada. Na aba Segmentos: avisa. Sem token: avisa.
{
  const g = criarGoogle();
  const f = g.novaAba('Colado', LISTA.slice(0, 50).map(w => ['x', w]));
  f.ativa = [3, 2];
  const lido = g.ctx.lerRemessas_(f);
  check(lido.lista.length === 50 && lido.titulo === 'coluna B', 'sem cabeçalho: coluna da célula selecionada', lido.titulo);
  g.ctx.pesquisar();
  check(/Falta o AuthToken/.test(g.alertas.pop()), 'sem AuthToken: avisa');
  g.props.script.AuthToken = '"tok-ficticio-1"';
  check(g.ctx.token_() === 'tok-ficticio-1', 'aceita a propriedade com outro nome (AuthToken)');
  g.ui.resposta = 'NO';
  check(g.ctx.pesquisar() === null && !g.aba('Segmentos'), 'clicou "Não": nada acontece');
  g.ui.resposta = 'YES';
  g.ctx.pesquisar();
  g.planilha.ativa = g.aba('Segmentos');
  g.ctx.pesquisar();
  check(/Abra a aba que tem as remessas/.test(g.alertas.pop()), 'na aba Segmentos: pede a aba das remessas');
  conferir(g, LISTA.slice(0, 50), '50 remessas sem cabeçalho');
}

console.log('\n' + oks + ' ok, ' + falhas + ' falha(s)');
process.exit(falhas ? 1 : 0);
