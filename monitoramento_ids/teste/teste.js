/**
 * Teste do Codigo.gs (monitoramento de IDs: abas PRIMARIA e SECUNDARIA) com Google e JMS de mentira — tudo fictício
 * (tarefas DBGXFIC… e SETRFIC…). Uso: node monitoramento_ids/teste/teste.js [arquivo.gs]
 * Sem argumento testa monitoramento_ids/Codigo.gs.
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ARQ = process.argv[2] || path.join(__dirname, '..', 'Codigo.gs');
const CODIGO = fs.readFileSync(ARQ, 'utf8');
let falhas = 0, oks = 0;
function check(ok, nome, extra) {
  if (ok) { oks++; console.log('OK   ' + nome); return; }
  falhas++;
  console.log('FALHOU ' + nome + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 600) : ''));
}

// ---------- JMS de mentira ----------
// Troncal (tmsShipment/page, GET) e secundária (tmsBranchTrackingDetail/page, POST): filtro pela partida planejada,
// PDD de chegada e status, no máximo 20 por página (como a tela), mesmo pedindo 100.
function viagem(no, partida, chegada, deslacre, extra) {
  const lacre = partida.slice(0, 11) + '00:00:00';
  return Object.assign({id: 'id-' + no, shipmentNo: no, plannedDepartureTime: partida, actualDepartureTime: partida, actualArrivalTime: chegada,
    endCode: '30001', endName: 'SP GRU', shipmentState: 4, plateNumber: 'FIC0000'}, extra || {}, {__lacre: lacre, __deslacre: deslacre});
}
const troncal = r => { const o = Object.assign({}, r, {actuallockTime: r.__lacre, actualUnlockTime: r.__deslacre}); delete o.__lacre; delete o.__deslacre; return o; };
const secundaria = r => { const o = Object.assign({}, r, {lockTime: r.__lacre, unlockTime: r.__deslacre, appArrivalTime: r.actualArrivalTime}); delete o.__lacre; delete o.__deslacre; return o; };

function criarJms(dados) {
  const jms = {pedidos: [], dados};
  jms.fetch = (url, op) => {
    const resp = (code, obj) => ({getResponseCode: () => code, getContentText: () => (typeof obj === 'string' ? obj : JSON.stringify(obj))});
    if (url === 'https://gw.jtjms-br.com') return resp(404, '');
    if ((op.headers || {}).authToken !== 'tok-ficticio') return resp(200, {code: 135010037, msg: 'token失效，请重新登录', succ: false, fail: true});
    let p, lista;
    if (/\/tmsShipment\/page\?/.test(url)) {
      if (op.method !== 'get') return resp(405, {});
      p = {};
      url.split('?')[1].split('&').forEach(kv => { const i = kv.indexOf('='); p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
      lista = dados.troncal.map(troncal).filter(t => t.plannedDepartureTime >= p.startDateTime && t.plannedDepartureTime <= p.endDateTime);
      jms.pedidos.push({linha: 'troncal', inicio: p.startDateTime, fim: p.endDateTime});
    } else if (/\/tmsBranchTrackingDetail\/page$/.test(url)) {
      if (op.method !== 'post') return resp(405, {});
      p = JSON.parse(op.payload);
      lista = dados.secundaria.map(secundaria).filter(t => t.plannedDepartureTime >= p.startDepartureTime && t.plannedDepartureTime <= p.endDepartureTime);
      jms.pedidos.push({linha: 'secundaria', inicio: p.startDepartureTime, fim: p.endDepartureTime});
    } else return resp(404, {});
    lista = lista.filter(t => String(t.endCode) === String(p.endCode) && Number(t.shipmentState) === Number(p.shipmentState));
    const sz = Math.min(20, Number(p.size)), cur = Number(p.current);
    return resp(200, {code: 1, msg: 'success', succ: true, fail: false,
      data: {records: lista.slice((cur - 1) * sz, cur * sz), total: lista.length, size: sz, current: cur, pages: Math.ceil(lista.length / sz)}});
  };
  return jms;
}

// ---------- Google de mentira ----------
function criarGoogle(codigo, jms, agora) {
  const g = {agora: Date.parse(agora), props: {}, gatilhos: [], toasts: []};
  const semFim = alvo => new Proxy(alvo, {get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => semFim(t) : undefined))});
  const colNum = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  class Folha {
    constructor(nome) { this.nome = nome; this.cel = []; this.notas = {}; }
    getName() { return this.nome; }
    setName(n) { this.nome = n; return this; }
    getLastRow() { for (let r = this.cel.length; r > 0; r--) if ((this.cel[r - 1] || []).some(v => v !== '' && v !== undefined && v !== null)) return r; return 0; }
    getRange(a, c, nr, nc) {
      if (typeof a === 'string') {
        const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a);
        const r1 = +m[2], c1 = colNum(m[1]), r2 = m[4] ? +m[4] : r1, c2 = m[3] ? colNum(m[3]) : c1;
        return semFim(new Faixa(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1));
      }
      return semFim(new Faixa(this, a, c, nr || 1, nc || 1));
    }
    copyTo(ss) { const f = ss.insertSheet(this.nome + ' (cópia)'); f.cel = this.cel.map(l => (l || []).slice()); return f; }
  }
  class Faixa {
    constructor(f, r, c, nr, nc) { Object.assign(this, {f, r, c, nr, nc}); }
    getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const l = this.f.cel[this.r - 1 + i] || [], x = []; for (let j = 0; j < this.nc; j++) { const v = l[this.c - 1 + j]; x.push(v === undefined || v === null ? '' : v); } o.push(x); } return o; }
    getDisplayValues() { return this.getValues().map(l => l.map(v => String(v))); }
    getValue() { return this.getValues()[0][0]; }
    getDisplayValue() { return String(this.getValue()); }
    setValues(v) {
      if (v.length !== this.nr || v.some(l => l.length !== this.nc)) throw new Error('Tamanho dos dados não confere com o intervalo');
      v.forEach((l, i) => { const L = this.f.cel[this.r - 1 + i] = this.f.cel[this.r - 1 + i] || []; l.forEach((x, j) => { L[this.c - 1 + j] = x; }); });
      return semFim(this);
    }
    setValue(x) { return this.setValues(Array.from({length: this.nr}, () => Array(this.nc).fill(x))); }
    clearContent() { for (let i = 0; i < this.nr; i++) { const L = this.f.cel[this.r - 1 + i]; if (L) for (let j = 0; j < this.nc; j++) L[this.c - 1 + j] = ''; } return semFim(this); }
    getNote() { return this.f.notas[this.r + ',' + this.c] || ''; }
    setNote(n) { this.f.notas[this.r + ',' + this.c] = n; return semFim(this); }
    getA1Notation() { return String.fromCharCode(64 + this.c) + this.r; }
  }
  const planilha = {
    folhas: [],
    getSheetByName(n) { return this.folhas.find(f => f.nome === n) || null; },
    insertSheet(n) { const f = semFim(new Folha(n)); this.folhas.push(f); return f; },
    getId() { return 'planilha-ficticia'; },
    setSpreadsheetTimeZone() {},
    toast(m) { g.toasts.push(m); }
  };
  const loja = o => ({getProperty: k => (k in o ? o[k] : null), setProperty: (k, v) => { o[k] = String(v); }, deleteProperty: k => { delete o[k]; }});
  const formatar = (d, tz, fmt) => {
    const p = {};
    new Intl.DateTimeFormat('en-GB', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'})
      .formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  };
  const Agora = class extends Date { constructor(...a) { if (a.length) super(...a); else super(g.agora); } static now() { return g.agora; } };
  g.ctx = vm.createContext({
    Date: Agora, console: {log: () => {}, error: () => {}},
    SpreadsheetApp: {
      getActiveSpreadsheet: () => planilha, openById: () => planilha, flush: () => {},
      newDataValidation: () => semFim({build: () => ({})}),
      getUi: () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); }
    },
    PropertiesService: {getScriptProperties: () => loja(g.props)},
    ScriptApp: {
      EventType: {CLOCK: 'CLOCK', ON_EDIT: 'ON_EDIT', ON_OPEN: 'ON_OPEN'},
      getProjectTriggers: () => g.gatilhos.map(t => ({getHandlerFunction: () => t.fn, getEventType: () => t.tipo, t})),
      deleteTrigger: x => { const i = g.gatilhos.indexOf(x.t); if (i >= 0) g.gatilhos.splice(i, 1); },
      newTrigger: fn => ({
        forSpreadsheet: () => ({onEdit: () => ({create: () => g.gatilhos.push({fn, tipo: 'ON_EDIT'})}),
          onOpen: () => ({create: () => g.gatilhos.push({fn, tipo: 'ON_OPEN'})})}),
        timeBased: () => ({everyMinutes: n => ({create: () => g.gatilhos.push({fn, tipo: 'CLOCK', min: n})})})
      })
    },
    LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock: () => {}})},
    UrlFetchApp: {
      fetch: (u, o) => { g.fetchs = (g.fetchs || 0) + 1; return jms.fetch(u, o); },
      fetchAll: reqs => { g.fetchAlls = (g.fetchAlls || 0) + 1; return reqs.map(r => jms.fetch(r.url, r)); }
    },
    Utilities: {formatDate: formatar, sleep: () => {}},
    HtmlService: {}
  });
  vm.runInContext(codigo, g.ctx, {filename: 'Codigo.gs'});
  g.planilha = planilha;
  g.aba = n => planilha.getSheetByName(n);
  g.linhas = n => { const f = g.aba(n); return f.getRange(2, 1, Math.max(f.getLastRow() - 1, 1), 6).getValues().filter(l => l[0] !== ''); };
  g.celula = (n, a1) => g.aba(n).getRange(a1).getDisplayValue();
  return g;
}

// ---------- Viagens fictícias (hoje = 19/11/2026, 10h em São Paulo) ----------
function dadosBase() {
  const sec = [
    viagem('SETRFIC01', '2026-11-18 22:30:00', '2026-11-19 00:40:00', '2026-11-19 00:50:00'), // saiu ontem, chegou hoje
    viagem('SETRFIC02', '2026-11-19 07:00:00', '2026-11-19 08:30:00', null),                  // hoje, sem deslacre
    viagem('SETRFIC03', '2026-11-18 10:00:00', '2026-11-18 12:00:00', '2026-11-18 12:10:00'), // ontem
    viagem('SETRFIC04', '2026-11-17 23:00:00', '2026-11-18 01:00:00', '2026-11-18 01:30:00'), // saiu anteontem, chegou ontem
    viagem('SETRFIC05', '2026-11-17 08:00:00', '2026-11-17 10:00:00', '2026-11-17 10:20:00'), // anteontem: fica de fora
    viagem('SETRFIC06', '2026-11-19 06:00:00', '2026-11-19 07:00:00', '2026-11-19 07:05:00', {endCode: '99999'}) // outra base
  ];
  for (let i = 10; i < 40; i++) {
    sec.push(viagem('SETRFIC' + i, '2026-11-19 0' + (i % 8) + ':00:00', '2026-11-19 0' + (i % 8 + 1) + ':' + (i < 20 ? '1' : '2') + '0:00',
      '2026-11-19 0' + (i % 8 + 1) + ':' + (i < 20 ? '1' : '2') + '5:' + String(i).padStart(2, '0')));
  }
  return {
    troncal: [
      viagem('DBGXFIC01', '2026-11-18 18:00:00', '2026-11-19 03:00:00', '2026-11-19 03:20:00'), // saiu ontem, chegou hoje
      viagem('DBGXFIC02', '2026-11-19 01:00:00', '2026-11-19 08:00:00', '2026-11-19 08:10:00'),
      viagem('DBGXFIC03', '2026-11-17 20:00:00', '2026-11-18 22:00:00', '2026-11-18 22:30:00'), // chegou ontem
      viagem('DBGXFIC04', '2026-11-16 10:00:00', '2026-11-18 06:00:00', null),                  // 2 dias de viagem, sem deslacre
      viagem('DBGXFIC05', '2026-11-17 05:00:00', '2026-11-17 15:00:00', '2026-11-17 15:30:00'), // anteontem: fora
      viagem('DBGXFIC06', '2026-11-19 06:00:00', '2026-11-19 09:00:00', null, {shipmentState: 3}) // em trânsito: fora
    ],
    secundaria: sec
  };
}
const TIT_V6 = ['Data (partida)', 'Número da tarefa', 'Tempo de deslacre', 'Situação', 'Destino', 'Atualizado em'];
const TIT_V6_SEC = ['Data (partida)', 'Número da tarefa', 'Horário de deslacração do veículo', 'Situação', 'Destino', 'Atualizado em'];

/** Planilha como a v6 deixou: histórico de 16/11 e 17/11 e os blocos de 18/11 e 19/11 pela partida. */
function planilhaV6(g) {
  const p = g.planilha.insertSheet('PRIMARIA');
  p.getRange(1, 1, 1, 6).setValues([TIT_V6]);
  p.getRange(2, 1, 4, 6).setValues([
    ['16/11/2026', 'DBGXFICANTIGA1', '2026-11-16 09:00:00', 'Deslacrado', 'SP GRU', '16/11/2026 23:50:00'],
    ['17/11/2026', 'DBGXFICANTIGA2', '2026-11-17 09:00:00', 'Deslacrado', 'SP GRU', '17/11/2026 23:50:00'],
    ['18/11/2026', 'DBGXFICV6ONTEM', '2026-11-18 09:00:00', 'Deslacrado', 'SP GRU', '18/11/2026 23:50:00'],
    ['19/11/2026', 'DBGXFICV6HOJE', '2026-11-19 09:00:00', 'Deslacrado', 'SP GRU', '19/11/2026 09:45:00']]);
  const s = g.planilha.insertSheet('SECUNDARIA');
  s.getRange(1, 1, 1, 6).setValues([TIT_V6_SEC]);
  s.getRange(2, 1, 1, 6).setValues([['17/11/2026', 'SETRFICANTIGA', '2026-11-17 09:00:00', 'Deslacrado', 'SP GRU', '17/11/2026 23:50:00']]);
}
function rodar(codigo, agora, dados, antes) {
  const jms = criarJms(dados || dadosBase());
  const g = criarGoogle(codigo, jms, agora);
  if (antes) antes(g);
  g.ctx.instalarAutomacaoJMS();
  g.props.JMS_TOKEN = 'tok-ficticio';
  g.ctx.atualizarJMS();
  g.jms = jms;
  return g;
}
const ids = (linhas, dia) => linhas.filter(l => !dia || l[0] === dia).map(l => l[1]);

// 1) Como estava (v6): a viagem que sai num dia e chega no outro fica de fora.
{
  const v6 = require('child_process').execSync('git show bcb8100:monitoramento_ids/Codigo.gs', {cwd: path.join(__dirname, '..', '..'), encoding: 'utf8'});
  const g = rodar(v6, '2026-11-19T10:00:00-03:00', null, planilhaV6);
  const p = g.linhas('PRIMARIA'), s = g.linhas('SECUNDARIA');
  check(!ids(p).includes('DBGXFIC01') && !ids(s).includes('SETRFIC01') && ids(p, '19/11/2026').join() === 'DBGXFIC02',
    'v6 (antes): a Data é o dia consultado e a viagem que saiu ontem e chegou hoje não aparece', {p: ids(p), s: ids(s).slice(0, 5)});
}

// 2) v7: Data (chegada) e as viagens de ontem e de hoje pela chegada.
const ATUAL = fs.readFileSync(ARQ, 'utf8');
const g = rodar(ATUAL, '2026-11-19T10:00:00-03:00', null, planilhaV6);
{
  const p = g.linhas('PRIMARIA'), s = g.linhas('SECUNDARIA');
  check(g.celula('PRIMARIA', 'A1') === 'Data (chegada)' && g.celula('SECUNDARIA', 'A1') === 'Data (chegada)' &&
    g.celula('PRIMARIA', 'C1') === 'Tempo de deslacre', 'título da coluna A: "Data (partida)" vira "Data (chegada)" (o resto igual)');
  check(JSON.stringify(p.map(l => [l[0], l[1]])) === JSON.stringify([
    ['16/11/2026', 'DBGXFICANTIGA1'], ['17/11/2026', 'DBGXFICANTIGA2'],
    ['18/11/2026', 'DBGXFIC03'], ['18/11/2026', 'DBGXFIC04'], ['19/11/2026', 'DBGXFIC01'], ['19/11/2026', 'DBGXFIC02']]),
    'troncal: histórico mantido; ontem e hoje refeitos pela chegada (saiu ontem e chegou hoje = hoje; 2 dias de viagem = dia da chegada)',
    p.map(l => [l[0], l[1]]));
  const f01 = p.find(l => l[1] === 'DBGXFIC01'), f04 = p.find(l => l[1] === 'DBGXFIC04');
  check(f01[2] === '2026-11-19 03:20:00' && f01[3] === 'Deslacrado' && f04[2] === '' && f04[3] === 'Aguardando deslacre',
    'troncal: deslacre pelo campo detectado (actualUnlockTime), sem deslacre = Aguardando', [f01, f04]);
  check(!ids(p).some(i => /FIC0[56]/.test(i)), 'troncal: chegou anteontem e em trânsito ficam de fora');
  const hojeS = ids(s, '19/11/2026');
  check(ids(s, '17/11/2026').join() === 'SETRFICANTIGA' && ids(s, '18/11/2026').join() === 'SETRFIC04,SETRFIC03' &&
    hojeS[0] === 'SETRFIC01' && hojeS[hojeS.length - 1] === 'SETRFIC02' && hojeS.length === 32 && !ids(s).some(i => /FIC0[56]/.test(i)),
    'secundária: 32 viagens hoje (todas as páginas de 20), ontem pela chegada, ordem pelo deslacre (sem deslacre no fim)', {ontem: ids(s, '18/11/2026'), n: hojeS.length});
  const tr = g.jms.pedidos.filter(x => x.linha === 'troncal'), se = g.jms.pedidos.filter(x => x.linha === 'secundaria');
  check(tr.length && tr.every(x => x.inicio === '2026-11-16 00:00:00' && x.fim === '2026-11-20 23:59:59') &&
    se.length >= 2 && se.every(x => x.inicio === '2026-11-17 00:00:00' && x.fim === '2026-11-19 23:59:59'),
    'consulta: partidas de 3 dias antes até amanhã (troncal) e de 2 dias antes até hoje (secundária)', {tr: tr[0], se: se[0], n: se.length});
  check(g.celula('CONTROLE', 'B2') === '2' && /^OK - 2 IDs hoje e 2 ontem, pela chegada/.test(g.celula('CONTROLE', 'D2')) &&
    g.celula('CONTROLE', 'B3') === '32' && /^OK - 32 IDs hoje e 2 ontem/.test(g.celula('CONTROLE', 'D3')),
    'aba CONTROLE: IDs de hoje e de ontem de cada linha', [g.celula('CONTROLE', 'D2'), g.celula('CONTROLE', 'D3')]);
  check(g.celula('CONFIGURAÇÃO JMS', 'B10') === 'ATUALIZADO' && /Dias 18\/11\/2026 e 19\/11\/2026 atualizados pela data de chegada/.test(g.celula('CONFIGURAÇÃO JMS', 'B13')),
    'status: ATUALIZADO, dias de ontem e de hoje', g.celula('CONFIGURAÇÃO JMS', 'B13'));
}

// 3) De novo: o mesmo resultado (nada duplicado).
{
  const antes = JSON.stringify(g.linhas('PRIMARIA').map(l => l.slice(0, 5))) + JSON.stringify(g.linhas('SECUNDARIA').map(l => l.slice(0, 5)));
  g.ctx.atualizarJMS({triggerUid: 'gatilho'});
  const depois = JSON.stringify(g.linhas('PRIMARIA').map(l => l.slice(0, 5))) + JSON.stringify(g.linhas('SECUNDARIA').map(l => l.slice(0, 5)));
  check(antes === depois, 'atualização automática de novo: mesmas linhas, nada duplicado');
}

// 4) A aba foi reordenada pela coluna B: o histórico continua e ontem/hoje voltam para o fim.
{
  const f = g.aba('PRIMARIA'), corpo = g.linhas('PRIMARIA').sort((a, b) => (a[1] < b[1] ? 1 : -1));
  f.getRange(2, 1, corpo.length, 6).setValues(corpo);
  g.ctx.atualizarJMS({triggerUid: 'gatilho'});
  const r = ids(g.linhas('PRIMARIA'));
  check(r.length === 6 && r.slice(0, 2).sort().join() === 'DBGXFICANTIGA1,DBGXFICANTIGA2' && r.slice(2).join() === 'DBGXFIC03,DBGXFIC04,DBGXFIC01,DBGXFIC02',
    'aba reordenada: o histórico continua (na ordem que você deixou) e ontem/hoje voltam para o fim', r);
}

// 5) Virou o dia (20/11 00:30): o dia 18 fica salvo; o 19 é refeito e ganha a viagem que chegou às 23:30 e foi concluída
//    depois da meia-noite.
{
  g.agora = Date.parse('2026-11-20T00:30:00-03:00');
  g.jms.dados.troncal.push(viagem('DBGXFIC07', '2026-11-19 15:00:00', '2026-11-19 23:30:00', '2026-11-20 00:05:00'));
  g.ctx.atualizarJMS({triggerUid: 'gatilho'});
  const p = g.linhas('PRIMARIA');
  check(ids(p, '18/11/2026').join() === 'DBGXFIC03,DBGXFIC04' && ids(p, '19/11/2026').join() === 'DBGXFIC01,DBGXFIC02,DBGXFIC07' &&
    !ids(p, '20/11/2026').length && ids(p).slice(0, 2).sort().join() === 'DBGXFICANTIGA1,DBGXFICANTIGA2',
    'dia virou: 18/11 salvo; 19/11 refeito com a viagem que chegou 23:30 e foi concluída depois da meia-noite', p.map(l => [l[0], l[1]]));
  const tr = g.jms.pedidos.filter(x => x.linha === 'troncal').pop();
  // v8: a DBGXFIC04 (chegou 18/11) ainda está "Aguardando deslacre": a consulta começa 2 dias antes dela (16/11).
  check(tr.inicio === '2026-11-16 00:00:00' && tr.fim === '2026-11-21 23:59:59', 'consulta acompanha o dia novo (e vai até a pendente de 18/11)', tr);
}

// 6) Viagem sem Tempo real de chegada: fica no dia da partida (como na v6).
{
  const dados = dadosBase();
  dados.secundaria.push(viagem('SETRFIC99', '2026-11-19 05:00:00', null, '2026-11-19 06:00:00'));
  const g2 = rodar(ATUAL, '2026-11-19T10:00:00-03:00', dados);
  const l = g2.linhas('SECUNDARIA').find(x => x[1] === 'SETRFIC99');
  check(l && l[0] === '19/11/2026', 'sem Tempo real de chegada: fica no dia da partida', l);
  check(g2.celula('PRIMARIA', 'A1') === 'Data (chegada)', 'planilha nova: abas já com "Data (chegada)"');
}

// 7) Pedido do usuário: chegou hoje às 10:00 e só foi deslacrado às 22:00 → o status passa de "Aguardando deslacre" para
//    "Deslacrado" na atualização seguinte (o JMS registrou o deslacre).
{
  const dados = {troncal: [viagem('DBGXFIC24', '2026-11-24 04:00:00', '2026-11-24 10:00:00', null)],
    secundaria: [viagem('SETRFIC24', '2026-11-24 08:00:00', '2026-11-24 10:00:00', null)]};
  const g7 = rodar(ATUAL, '2026-11-24T10:05:00-03:00', dados);
  const t0 = g7.linhas('PRIMARIA').find(l => l[1] === 'DBGXFIC24'), s0 = g7.linhas('SECUNDARIA').find(l => l[1] === 'SETRFIC24');
  check(t0 && t0[3] === 'Aguardando deslacre' && s0 && s0[3] === 'Aguardando deslacre', '10:05: chegou e ainda não foi deslacrado', [t0, s0]);
  g7.jms.dados.troncal[0].__deslacre = '2026-11-24 22:00:00';
  g7.jms.dados.secundaria[0].__deslacre = '2026-11-24 22:00:00';
  g7.agora = Date.parse('2026-11-24T22:05:00-03:00');
  g7.ctx.atualizarJMS({triggerUid: 'gatilho'});
  const t1 = g7.linhas('PRIMARIA').find(l => l[1] === 'DBGXFIC24'), s1 = g7.linhas('SECUNDARIA').find(l => l[1] === 'SETRFIC24');
  check(t1[2] === '2026-11-24 22:00:00' && t1[3] === 'Deslacrado' && s1[2] === '2026-11-24 22:00:00' && s1[3] === 'Deslacrado' &&
    /^24\/11\/2026 22:05/.test(t1[5]), '22:05: o JMS deslacrou às 22:00 → "Deslacrado" com o horário (troncal e secundária)', [t1, s1]);
  // Deslacre só no dia seguinte (01:30 do dia 25): o dia 24 continua sendo atualizado.
  g7.jms.dados.troncal.push(viagem('DBGXFIC25', '2026-11-24 12:00:00', '2026-11-24 20:00:00', null));
  g7.ctx.atualizarJMS({triggerUid: 'gatilho'});
  g7.jms.dados.troncal[1].__deslacre = '2026-11-25 01:30:00';
  g7.agora = Date.parse('2026-11-25T01:35:00-03:00');
  g7.ctx.atualizarJMS({triggerUid: 'gatilho'});
  const t2 = g7.linhas('PRIMARIA').find(l => l[1] === 'DBGXFIC25');
  check(t2 && t2[0] === '24/11/2026' && t2[3] === 'Deslacrado' && t2[2] === '2026-11-25 01:30:00', 'deslacre depois da meia-noite: a linha do dia 24 é atualizada', t2);
}

// 8) Pendente de dias anteriores (até 5 dias): atualizada na própria linha; o resto do histórico não muda.
{
  const dados = {troncal: [
    viagem('DBGXFIC21', '2026-11-20 20:00:00', '2026-11-21 06:00:00', '2026-11-23 23:00:00'), // deslacre 2 dias depois
    viagem('DBGXFIC17', '2026-11-16 20:00:00', '2026-11-17 06:00:00', '2026-11-23 20:00:00'), // pendente há mais de 5 dias
    viagem('DBGXFIC24', '2026-11-24 01:00:00', '2026-11-24 07:00:00', '2026-11-24 07:30:00')], secundaria: []};
  const g8 = rodar(ATUAL, '2026-11-24T10:00:00-03:00', dados, gg => {
    const p = gg.planilha.insertSheet('PRIMARIA');
    p.getRange(1, 1, 1, 6).setValues([['Data (chegada)', 'Número da tarefa', 'Tempo de deslacre', 'Situação', 'Destino', 'Atualizado em']]);
    p.getRange(2, 1, 4, 6).setValues([
      ['17/11/2026', 'DBGXFIC17', '', 'Aguardando deslacre', 'SP GRU', '17/11/2026 23:55:00'],
      ['21/11/2026', 'DBGXFICOK', '2026-11-21 05:00:00', 'Deslacrado', 'SP GRU', '21/11/2026 23:55:00'],
      ['21/11/2026', 'DBGXFIC21', '', 'Aguardando deslacre', 'SP GRU', '21/11/2026 23:55:00'],
      ['22/11/2026', 'DBGXFIC22', '2026-11-22 09:00:00', 'Deslacrado', 'SP GRU', '22/11/2026 23:55:00']]);
  });
  const p = g8.linhas('PRIMARIA');
  check(JSON.stringify(p[2].slice(0, 4)) === JSON.stringify(['21/11/2026', 'DBGXFIC21', '2026-11-23 23:00:00', 'Deslacrado']) && /^24\/11\/2026 10:00/.test(p[2][5]),
    'pendente do dia 21 (deslacre só no dia 23): atualizada na própria linha', p[2]);
  check(p[0][3] === 'Aguardando deslacre' && p[0][5] === '17/11/2026 23:55:00' && p[1][5] === '21/11/2026 23:55:00' && p[3][1] === 'DBGXFIC22' &&
    ids(p, '24/11/2026').join() === 'DBGXFIC24', 'mais de 5 dias e linhas já deslacradas não mudam; hoje continua embaixo', p.map(l => [l[0], l[1], l[3]]));
  const tr = g8.jms.pedidos.filter(x => x.linha === 'troncal');
  check(tr.length && tr.every(x => x.inicio === '2026-11-19 00:00:00'), 'consulta vai até a partida da pendente (dia 21 − 2 dias), não até a de 17/11', tr[0]);
  check(/dias anteriores: 1 deslacre\(s\) atualizado\(s\), 0 ainda aguardando/.test(g8.celula('CONTROLE', 'D2')), 'aba CONTROLE conta os pendentes atualizados',
    g8.celula('CONTROLE', 'D2'));
}

// 9) Acionadores: a v8 troca o de 15 min por 5 min e cria o de abertura; abrir a planilha atualiza (no máximo a cada 2 min).
{
  const g9 = rodar(ATUAL, '2026-11-24T10:00:00-03:00', {troncal: [], secundaria: []});
  g9.props.JMS_INTERVALO_INSTALADO = '15';
  g9.gatilhos.forEach(t => { if (t.tipo === 'CLOCK') t.min = 15; });
  g9.ctx.atualizarJMS({triggerUid: 'gatilho'});
  const tipos = g9.gatilhos.map(t => t.fn + ':' + t.tipo + (t.min ? ':' + t.min : '')).sort().join();
  check(tipos === 'aoAbrirPlanilhaJMS:ON_OPEN,aoEditarTokenJMS:ON_EDIT,atualizarJMS:CLOCK:5', 'acionadores: 5 em 5 min, ao editar o token e ao abrir', tipos);
  check(/levou \d+ s \| código v8, a cada 5 min$/.test(g9.celula('CONFIGURAÇÃO JMS', 'B14')), 'B14: última execução com quanto levou', g9.celula('CONFIGURAÇÃO JMS', 'B14'));
  const n = g9.jms.pedidos.length;
  g9.agora += 60000;
  g9.ctx.aoAbrirPlanilhaJMS({triggerUid: 'abrir'});
  check(g9.jms.pedidos.length === n, 'abrir 1 min depois da última consulta: não consulta de novo');
  g9.agora += 3 * 60000;
  g9.ctx.aoAbrirPlanilhaJMS({triggerUid: 'abrir'});
  check(g9.jms.pedidos.length > n, 'abrir 3 min depois: atualiza na hora');
}

// 10) Muitas páginas (o JMS manda 20 por vez): a 1ª sozinha e as outras ao mesmo tempo; nenhuma viagem falta.
{
  const sec = [];
  for (let i = 0; i < 150; i++) sec.push(viagem('SETRFICP' + String(i).padStart(3, '0'), '2026-11-24 0' + (i % 9) + ':00:00', '2026-11-24 09:30:00', '2026-11-24 09:40:00'));
  const g10 = rodar(ATUAL, '2026-11-24T10:00:00-03:00', {troncal: [], secundaria: sec});
  const se = g10.jms.pedidos.filter(x => x.linha === 'secundaria').length;
  check(ids(g10.linhas('SECUNDARIA'), '24/11/2026').length === 150 && se === 8 && g10.fetchAlls >= 1,
    '150 viagens em 8 páginas de 20: todas na planilha, páginas 2 a 8 de uma vez', {n: ids(g10.linhas('SECUNDARIA')).length, se, fetchAlls: g10.fetchAlls});
}

console.log('\n' + oks + ' ok, ' + falhas + ' falha(s)');
process.exit(falhas ? 1 : 0);
