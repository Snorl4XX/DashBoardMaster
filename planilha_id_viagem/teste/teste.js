/**
 * Teste do Codigo.gs (planilha do ID de viagem: Data pelo Tempo real de chegada) com uma Planilha Google de mentira — tudo
 * fictício (IDs FIC…, placas FIC…).
 * Uso: node planilha_id_viagem/teste/teste.js
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
  console.log('FALHOU ' + nome + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 500) : ''));
}

const FUSOS = {'America/Sao_Paulo': '-03:00', 'Asia/Shanghai': '+08:00'};
function dia(d, tz) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
}

function criarGoogle(o) {
  o = Object.assign({tz: 'America/Sao_Paulo', editor: false}, o || {});
  const g = {logs: [], alertas: [], menus: [], gatilhos: [], escritas: [], travado: false, o};
  class Folha {
    constructor(nome, linhas) {
      this.nome = nome;
      this.cel = linhas.map(l => l.map(v => (typeof v === 'string' && v[0] === '=' ? {v: '', f: v, nf: ''} : {v: v === undefined ? '' : v, f: '', nf: ''})));
    }
    getName() { return this.nome; }
    getLastRow() { for (let r = this.cel.length; r > 0; r--) if ((this.cel[r - 1] || []).some(c => c && (c.f || c.v !== ''))) return r; return 0; }
    getLastColumn() { let m = 0; this.cel.forEach(l => l.forEach((c, j) => { if (c && (c.f || c.v !== '')) m = Math.max(m, j + 1); })); return m; }
    c(r, col) { const L = this.cel[r - 1] = this.cel[r - 1] || []; return L[col - 1] = L[col - 1] || {v: '', f: '', nf: ''}; }
    getRange(r, col, nr, nc) { return new Faixa(this, r, col, nr || 1, nc || 1); }
  }
  class Faixa {
    constructor(f, r, c, nr, nc) { Object.assign(this, {f, r, c, nr, nc}); }
    mapa(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const l = []; for (let j = 0; j < this.nc; j++) l.push(fn(this.f.c(this.r + i, this.c + j))); out.push(l); } return out; }
    getValues() { return this.mapa(x => x.v); }
    getFormulas() { return this.mapa(x => x.f); }
    getNumberFormats() { return this.mapa(x => x.nf); }
    getFormula() { return this.f.c(this.r, this.c).f; }
    setValues(v) {
      if (v.length !== this.nr || v.some(l => l.length !== this.nc)) throw new Error('Tamanho dos dados não confere com o intervalo');
      g.escritas.push({aba: this.f.nome, r: this.r, c: this.c, nr: this.nr, nc: this.nc});
      v.forEach((l, i) => l.forEach((x, j) => {
        const cel = this.f.c(this.r + i, this.c + j);
        if (typeof x === 'string' && x[0] === '=') { cel.f = x; cel.v = ''; } else { cel.f = ''; cel.v = x; }
      }));
      return this;
    }
    setNumberFormats(v) { v.forEach((l, i) => l.forEach((x, j) => { this.f.c(this.r + i, this.c + j).nf = x; })); return this; }
  }
  const planilha = {
    folhas: [],
    getSheets() { return this.folhas.slice(); },
    getSpreadsheetTimeZone() { return o.tz; },
    toast() {}
  };
  const ui = {
    ButtonSet: {OK: 'OK'},
    alert(t, m) { g.alertas.push(m); return 'OK'; },
    createMenu(nome) { const m = {nome, itens: [], addItem(a, b) { m.itens.push([a, b]); return m; }, addSeparator() { return m; }, addToUi() { g.menus.push(m); }}; return m; }
  };
  const gatilho = (fn, tipo) => ({create: () => { g.gatilhos.push({fn, tipo}); }});
  g.ctx = vm.createContext({
    console: {log: m => g.logs.push(String(m)), error: m => g.logs.push(String(m))},
    SpreadsheetApp: {
      getActive: () => planilha, flush: () => {},
      getUi: () => { if (o.editor) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); return ui; }
    },
    Utilities: {
      formatDate: (d, tz, fmt) => { if (fmt !== 'yyyy-MM-dd') throw new Error('formato ' + fmt); return dia(d, tz); },
      parseDate: (s, tz, fmt) => { if (fmt !== 'yyyy-MM-dd' || !FUSOS[tz]) throw new Error('parseDate ' + fmt + ' ' + tz); return new Date(s + 'T00:00:00' + FUSOS[tz]); }
    },
    ScriptApp: {
      newTrigger: fn => ({
        forSpreadsheet: () => ({onOpen: () => gatilho(fn, 'abrir'), onChange: () => gatilho(fn, 'mudar')}),
        timeBased: () => ({everyMinutes: n => gatilho(fn, 'cada' + n)})
      }),
      getProjectTriggers: () => g.gatilhos.map(t => ({getHandlerFunction: () => t.fn, t})),
      deleteTrigger: x => { const i = g.gatilhos.indexOf(x.t); if (i >= 0) g.gatilhos.splice(i, 1); }
    },
    LockService: {getDocumentLock: () => ({tryLock: () => !g.travado, releaseLock: () => {}})}
  });
  vm.runInContext(CODIGO, g.ctx, {filename: 'Codigo.gs'});
  g.aba = (nome, linhas) => { const f = new Folha(nome, linhas); planilha.folhas.push(f); return f; };
  g.col = (f, col, de) => { const out = []; for (let r = de; r <= f.getLastRow(); r++) out.push(f.c(r, col)); return out; };
  return g;
}
const SP = 'America/Sao_Paulo';
const at = s => new Date(s); // horário absoluto (com fuso no texto)

// 1) Linha troncal e secundária com os mesmos nomes de coluna; datas como a planilha e como o JMS exporta.
{
  const g = criarGoogle();
  const tron = g.aba('Linha troncal', [
    ['ID de viagem', 'Nome da viagem', 'Data (partida)', 'Horário de partida', 'Tempo real de chegada', 'Placa'],
    ['DBGXFIC001', 'FIC-GRU-1', at('2026-11-18T12:00:00-03:00'), at('2026-11-18T09:10:00-03:00'), at('2026-11-18T23:50:00-03:00'), 'FIC1001'],
    ['DBGXFIC002', 'FIC-GRU-2', at('2026-11-17T12:00:00-03:00'), at('2026-11-17T22:00:00-03:00'), '2026-11-19 00:20:00', 'FIC1002'],
    ['DBGXFIC003', 'FIC-GRU-3', '17/11/2026', '17/11/2026 20:00', '19/11/2026 07:05', 'FIC1003'],
    ['DBGXFIC004', 'FIC-GRU-4', at('2026-11-19T12:00:00-03:00'), at('2026-11-19T08:00:00-03:00'), '', 'FIC1004'],
    ['DBGXFIC005', 'FIC-GRU-5', '=DATEVALUE(LEFT(D6;10))', '2026-11-18 21:00:00', '2026-11-19 03:00:00', 'FIC1005'],
    ['DBGXFIC006', 'FIC-GRU-6', '=DATEVALUE(LEFT(D7;10))', '2026-11-19 10:00:00', '', 'FIC1006'],
    ['DBGXFIC007', 'FIC-GRU-7', '', '2026-11-19 11:00:00', 46345.75, 'FIC1007']
  ]);
  tron.c(5, 3).nf = 'dd/MM/yyyy HH:mm';
  // Secundária: título em cima, cabeçalho na linha 3 com o nome do JMS em português e chinês.
  const sec = g.aba('Linha secundária', [
    ['Consulta de Viagens Secundárias (fictícia)'], [''],
    ['ID de viagem', 'Data (partida)', 'Tempo real de chegada 实际到达时间', 'PDD de saída'],
    ['SETRFIC01', at('2026-11-17T21:00:00-03:00'), '2026-11-18 23:59:59', 'DC FICTICIO 01-SP'],
    ['SETRFIC02', at('2026-11-18T12:00:00-03:00'), '2026-11-18 14:00:00', 'DC FICTICIO 02-SP']
  ]);
  const resumo = g.aba('Resumo', [['Data', 'Viagens'], ['18/11/2026', 10]]);
  const r = g.ctx.atualizarDataPelaChegadaAgora();
  const t = g.col(tron, 3, 2), d = x => (x.v instanceof Date ? dia(x.v, SP) : x.f || String(x.v));
  check(d(t[0]) === '2026-11-18', 'chegou 18/11 23:50 (no fuso da planilha) → Data 18/11', d(t[0]));
  check(d(t[1]) === '2026-11-19' && d(t[2]) === '2026-11-19', 'texto do JMS ("2026-11-19 00:20:00") e brasileiro ("19/11/2026 07:05") → 19/11', [d(t[1]), d(t[2])]);
  check(dia(t[3].v, SP) === '2026-11-19' && t[3].v.getTime() === at('2026-11-19T12:00:00-03:00').getTime(), 'sem Tempo real de chegada: a Data fica como estava');
  check(d(t[4]) === '2026-11-19' && !t[4].f && t[4].nf === 'dd/MM/yyyy', 'Data com fórmula e chegada: vira a data da chegada, no formato dd/MM/yyyy', t[4]);
  check(t[5].f === '=DATEVALUE(LEFT(D7;10))', 'Data com fórmula e sem chegada: a fórmula continua', t[5]);
  check(d(t[6]) === '2026-11-19', 'chegada como número de data da planilha (46345,75) → 19/11', d(t[6]));
  check(tron.c(2, 5).v instanceof Date && tron.c(3, 5).v === '2026-11-19 00:20:00' && tron.c(2, 4).v instanceof Date && tron.c(2, 1).v === 'DBGXFIC001',
    'só a coluna da Data muda (Tempo real de chegada, partida e ID ficam iguais)');
  const s = g.col(sec, 2, 4);
  check(dia(s[0].v, SP) === '2026-11-18' && dia(s[1].v, SP) === '2026-11-18' && sec.c(1, 1).v === 'Consulta de Viagens Secundárias (fictícia)',
    'secundária: cabeçalho na linha 3 e coluna "Tempo real de chegada 实际到达时间" reconhecidos');
  check(resumo.c(2, 1).v === '18/11/2026' && !g.escritas.some(e => e.aba === 'Resumo'), 'aba sem as duas colunas não é mexida');
  check(/Aba "Linha troncal": 4 data\(s\) trocada\(s\).*2 sem Tempo real de chegada/.test(r) && /Aba "Linha secundária": 1 data/.test(r) && !/Resumo/.test(r) &&
    g.alertas.length === 1, 'aviso com quantas datas mudaram em cada aba (a que já estava certa não conta)', r);
  check(!g.escritas.some(e => e.aba === 'Linha troncal' && e.r <= 2 && e.r + e.nr > 2), 'Data que já estava certa não é regravada', g.escritas);
  // De novo: nada muda e nada é gravado.
  const n = g.escritas.length;
  const r2 = g.ctx.atualizarDataPelaChegadaAgora();
  check(g.escritas.length === n && /0 data\(s\) trocada/.test(r2), 'rodar de novo não grava nada', r2);
  // Linha nova no fim: só ela é gravada.
  tron.cel.push([{v: 'DBGXFIC008', f: '', nf: ''}, {v: '', f: '', nf: ''}, {v: '2026-11-20 01:00:00', f: '', nf: ''}, {v: '', f: '', nf: ''},
    {v: '2026-11-21 02:00:00', f: '', nf: ''}]);
  tron.cel[8][2] = {v: '20/11/2026', f: '', nf: ''};
  tron.cel[8][3] = {v: '2026-11-20 01:00:00', f: '', nf: ''};
  g.ctx.atualizarDataPelaChegadaSozinho();
  const nova = g.escritas.slice(n);
  check(nova.length === 1 && nova[0].aba === 'Linha troncal' && nova[0].r === 9 && nova[0].nr === 1 && dia(tron.c(9, 3).v, SP) === '2026-11-21',
    'linha nova: só ela é gravada (as outras células da coluna não são reescritas)', nova);
}

// 2) Fuso da planilha: o dia sai do fuso dela (planilha em Xangai: 18/11 20:00 UTC = 19/11 04:00).
{
  const g = criarGoogle({tz: 'Asia/Shanghai'});
  const f = g.aba('Troncal', [['Data (partida)', 'Tempo real de chegada'], ['', at('2026-11-18T20:00:00Z')]]);
  g.ctx.atualizarDataPelaChegadaSozinho();
  check(dia(f.c(2, 1).v, 'Asia/Shanghai') === '2026-11-19', 'o dia sai do fuso da planilha', f.c(2, 1).v);
}

// 3) Pelo editor (▶ Executar, sem janelas): instala o menu e a atualização automática, sem "Cannot call SpreadsheetApp.getUi()".
{
  const g = criarGoogle({editor: true});
  g.aba('Linha troncal', [['ID de viagem', 'Data de partida', 'Tempo real de chegada'], ['DBGXFIC1', '', '2026-11-18 10:00:00']]);
  let erro = null, r;
  try { r = g.ctx.instalarDataPelaChegada(); } catch (e) { erro = e.message; }
  const tipos = g.gatilhos.map(t => t.fn + ':' + t.tipo).sort().join();
  check(!erro && tipos === 'aoMudarDataPelaChegada:mudar,atualizarDataPelaChegadaSozinho:cada10,menuDataPelaChegada:abrir',
    'instalarDataPelaChegada pelo editor: menu ao abrir, ao mudar e a cada 10 min', {erro, tipos});
  check(/1 data\(s\) trocada/.test(r) && g.logs.some(l => /Atualização automática ligada/.test(l)) && !g.alertas.length,
    'pelo editor: o resultado sai no Registro de execução', g.logs);
  g.ctx.instalarDataPelaChegada();
  check(g.gatilhos.length === 3, 'instalar de novo não duplica os gatilhos', g.gatilhos.length);
  g.ctx.pararDataPelaChegada();
  check(g.gatilhos.map(t => t.fn).join() === 'menuDataPelaChegada', 'Parar: desliga a atualização automática e o menu continua');
  check(g.ctx.aoMudarDataPelaChegada({changeType: 'FORMAT'}) === null, 'mudança só de formatação não refaz nada');
  let erroMenu = null;
  try { g.ctx.menuDataPelaChegada(); } catch (e) { erroMenu = e.message; }
  check(!erroMenu && /aparece na planilha/.test(g.logs[g.logs.length - 1]), 'menuDataPelaChegada pelo editor: sem erro, explica que o menu é na planilha', erroMenu);
}

// 4) Menu na planilha; nomes de coluna; fórmula no cabeçalho; outra atualização rodando; planilha sem as colunas.
{
  const g = criarGoogle();
  g.ctx.menuDataPelaChegada();
  check(g.menus.length === 1 && g.menus[0].nome === 'ID de viagem' && g.menus[0].itens.map(i => i[1]).join() ===
    'atualizarDataPelaChegadaAgora,pararDataPelaChegada,instalarDataPelaChegada', 'menu "ID de viagem"', g.menus[0]);
  const n = s => g.ctx.normalDC_(s);
  check(['Data (partida)', 'DATA (PARTIDA)', 'Data de partida', 'Data (chegada)', 'Data da chegada'].every(s => /^data(de|da)?(partida|chegada)$/.test(n(s))) &&
    !/^data(de|da)?(partida|chegada)$/.test(n('Data')) && !/^data(de|da)?(partida|chegada)$/.test(n('Horário de partida')),
    'coluna da Data: "Data (partida)" e variações (também depois de trocar o nome para "Data (chegada)")');
  const vazio = g.ctx.atualizarDataPelaChegadaAgora();
  check(/Não achei nenhuma aba/.test(vazio), 'planilha sem as colunas: avisa', vazio);
  const f = g.aba('Troncal', [['={"Data (partida)";ARRAYFORMULA(...)}', 'Tempo real de chegada'], ['', '2026-11-18 10:00:00']]);
  f.c(1, 1).v = 'Data (partida)';
  const rf = g.ctx.atualizarDataPelaChegadaAgora();
  check(/tem uma fórmula que preenche a coluna inteira/.test(rf) && !g.escritas.length, 'cabeçalho com fórmula: avisa e não mexe', rf);
  g.travado = true;
  check(/Outra atualização está rodando/.test(g.ctx.atualizarDataPelaChegadaSozinho()), 'outra atualização rodando: espera');
  check(g.ctx.diaDC_('2026-13-01 10:00', SP) === '' && g.ctx.diaDC_('—', SP) === '' && g.ctx.diaDC_('2026/11/18', SP) === '2026-11-18', 'texto que não é data fica de fora');
}

// 5) Muitas linhas com viagens em trânsito no meio: grava a coluna de uma vez.
{
  const g = criarGoogle();
  const linhas = [['ID de viagem', 'Data (partida)', 'Tempo real de chegada']];
  for (let i = 0; i < 5000; i++) linhas.push(['FIC' + i, '18/11/2026', i % 3 ? '2026-11-19 0' + (i % 10) + ':00:00' : '']);
  const f = g.aba('Troncal', linhas);
  const r = g.ctx.atualizarDataPelaChegadaSozinho();
  const c = g.col(f, 2, 2);
  check(g.escritas.length === 1 && g.escritas[0].nr === 5000 && c.every((x, i) => (i % 3 ? dia(x.v, SP) === '2026-11-19' : x.v === '18/11/2026')),
    '5.000 viagens com trânsito no meio: uma gravação só, certas', {escritas: g.escritas.length, r});
}

console.log('\n' + oks + ' ok, ' + falhas + ' falha(s)');
process.exit(falhas ? 1 : 0);
