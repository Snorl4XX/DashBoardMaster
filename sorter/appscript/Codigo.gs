/**
 * J&T · PAINEL DO SORTER — versão Apps Script (projeto SEPARADO do DashMaster: não use no mesmo projeto).
 *
 * O Apps Script roda nos servidores do Google e NÃO enxerga a rede interna da base (o sorter fica em 10.1.166.9).
 * Por isso os números chegam pela PONTE: o programa do sorter (server.js) roda num computador da base, lê o sorter e
 * manda para este App da Web (doPost). Aqui eles ficam numa planilha (aba Sorter_Dados, um dia por linha e por sorter)
 * e a página mostra o painel para qualquer pessoa com o link, de qualquer lugar.
 *
 * Instalação (uma vez):
 *   1. Arquivos: Codigo.gs, Resumo.gs, Index.html, Estilo.html, App.html e o appsscript.json (manifesto).
 *   2. Execute configurar() no editor (▶ Executar) e autorize: cria a planilha e mostra a CHAVE da ponte no registro.
 *   3. Implantar → Nova implantação → App da Web · Executar como: Eu · Quem pode acessar: Qualquer pessoa.
 *   4. No computador da base, no config.json do sorter: "appsScriptUrl" = URL do App da Web (termina em /exec) e
 *      "chavePonte" = a chave do passo 2. Abra o iniciar.bat.
 *
 * Quem abre o link vê o painel; só a ponte (com a chave) grava dados.
 */
var VERSAO = '2.4.0';
var TZ = 'America/Sao_Paulo';
var MAX_DIAS = 92;                 // maior período na tela (um trimestre)
var GUARDAR_DIAS = 400;            // dias guardados na planilha (os mais antigos saem sozinhos)
var ABA = 'Sorter_Dados';
var CELULA = 45000;                // caracteres por célula (o limite do Planilhas é 50.000)
var COL_DADOS = 9;                 // coluna I em diante: os números do dia, compactados
var PONTE_LIGADA_SEG = 180;        // ponte "ligada" se conversou nos últimos 3 minutos
var LER_SEGUNDOS = 300;            // a página relê a planilha a cada 5 minutos (os números chegam pela ponte)
var SORTERS_PADRAO = [
  {id: 'B', nome: 'Sorter B', nomeZh: '分拣机 B套', pronto: true},
  {id: 'A', nome: 'Sorter A', nomeZh: '分拣机 A套', pronto: false}
];

// ------------------------------------------------------------------ App da Web
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.acao) return json_(api_(p.acao, p));
  var view = HtmlService.createTemplateFromFile('Index');
  view.boot = JSON.stringify(boot_(p)).replace(/</g, '\\u003c');
  return view.evaluate()
    .setTitle('J&T · Sorter')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** A ponte da base manda os números aqui (POST com {chave, acao: "dados", dias: […], sorters: […]}). */
function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ok: false, error: 'O corpo do pedido não é JSON.'}); }
  return json_(api_(body.acao, body));
}

/** Auxiliar dos arquivos HTML: <?!= include('Estilo') ?> dentro do Index.html. */
function include(name) {
  if (!name) throw new Error('include() é usado pelo Index.html. Para ver o painel, abra o link do App da Web.');
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
/** O mesmo código de soma do servidor vai para a página (o Resumo.gs). */
function resumoSource_() {
  return 'window.SorterResumo=(' + SorterResumoFactory_.toString() + ')();';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function api_(acao, p) {
  try {
    var chave = PropertiesService.getScriptProperties().getProperty('CHAVE_PONTE');
    if (!chave) return {ok: false, error: 'O Apps Script ainda não foi configurado: execute configurar() no editor'};
    if (String(p.chave || '') !== chave) return {ok: false, error: 'chave da ponte inválida: copie a "chavePonte" que configurar() mostra para o config.json'};
    marcarPonte_();
    if (acao === 'estado') return estadoPonte_();
    if (acao === 'pedido') return {ok: true, pedido: CacheService.getScriptCache().get('pedido') || '', agora: agora_()};
    if (acao === 'dados') return receber_(p);
    return {ok: false, error: 'ação desconhecida: ' + acao};
  } catch (err) {
    return {ok: false, error: String((err && err.message) || err)};
  }
}

// ------------------------------------------------------------------ configuração (executar no editor)
/**
 * Execute uma vez no editor (▶ Executar): cria a planilha e a chave da ponte e mostra as duas no registro.
 * Rodar de novo não troca a chave (para trocar: apague CHAVE_PONTE em Configurações do projeto → Propriedades do script).
 */
function configurar() {
  var props = PropertiesService.getScriptProperties();
  var ss = planilha_(true);
  aba_(ss);
  var chave = props.getProperty('CHAVE_PONTE');
  if (!chave) {
    chave = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
    props.setProperty('CHAVE_PONTE', chave);
  }
  Logger.log('Planilha dos dados: ' + ss.getUrl());
  Logger.log('Chave da ponte (cole em "chavePonte" no config.json do computador da base): ' + chave);
  Logger.log('Agora: Implantar → Nova implantação → App da Web · Executar como: Eu · Quem pode acessar: Qualquer pessoa. ' +
    'Copie a URL do App da Web (termina em /exec) para "appsScriptUrl" no config.json.');
  return {planilha: ss.getUrl(), chave: chave};
}

/** Mostra no registro o que chegou da ponte (para conferir a instalação). */
function diagnosticar() {
  var info = info_(), p = ponte_(info), sh = aba_(planilha_(true)), idx = indice_(sh);
  Logger.log('Ponte: ' + (p.vista ? (p.ligada ? 'ligada' : 'DESLIGADA') + ' (última conversa ' + p.vista + ')' : 'nunca conversou') +
    (info.versaoPonte ? ' · versão ' + info.versaoPonte : ''));
  (info.sorters || []).forEach(function (s) {
    var dias = Object.keys(idx).filter(function (k) { return k.split('|')[1] === s.id; }).map(function (k) { return k.split('|')[0]; }).sort();
    Logger.log(s.nome + ': ' + (!s.pronto ? 'falta configurar a troca na ponte' : dias.length + ' dia(s) na planilha' +
      (dias.length ? ' (' + dias[0] + ' a ' + dias[dias.length - 1] + ')' : '')) + (s.erro ? ' · ERRO: ' + s.erro : '') +
      (s.balancaErro ? ' · balanças: ' + s.balancaErro : ''));
  });
  return {ponte: p, sorters: info.sorters || []};
}

// ------------------------------------------------------------------ planilha
function planilha_(criar) {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { if (!criar) throw new Error('Não consegui abrir a planilha dos dados (' + e.message + ').'); }
  }
  var ativa = null;
  try { ativa = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ativa = null; }
  if (!ativa && !criar) throw new Error('A planilha dos dados ainda não existe: execute configurar() no editor do Apps Script.');
  var ss = ativa || SpreadsheetApp.create('J&T · Sorter (dados da ponte)');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}
function aba_(ss) {
  var sh = ss.getSheetByName(ABA);
  if (sh) return sh;
  sh = ss.insertSheet(ABA);
  var head = ['Data', 'Sorter', 'Recebido em', 'Versão', 'Sort total', 'Valid total', 'No Sort Code', 'Balanças', 'Dados (compactados)'];
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}
function txt_(v, fmt) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, fmt);
  return String(v === null || v === undefined ? '' : v);
}
/** "data|sorter" → {row, at, ver} de cada linha da aba (ver = assinatura do conteúdo, para o cache). */
function indice_(sh) {
  var last = sh.getLastRow(), out = {};
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 4).getValues().forEach(function (v, i) {
    var d = txt_(v[0], 'yyyy-MM-dd'), dev = txt_(v[1], '');
    if (d && dev) out[d + '|' + dev] = {row: i + 2, at: txt_(v[2], 'yyyy-MM-dd HH:mm:ss'), ver: txt_(v[3], '')};
  });
  return out;
}
function assinatura_(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '.' + s.length.toString(36);
}
function comprimir_(s) {
  return 'gz:' + Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(s, 'application/json')).getBytes());
}
function descomprimir_(s) {
  if (String(s).indexOf('gz:') !== 0) return String(s);
  return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(String(s).slice(3)), 'application/x-gzip', 'd.gz')).getDataAsString();
}

/** Grava os dias que a ponte mandou (um dia por linha e por sorter; o mesmo dia de novo substitui a linha). */
function receber_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var agora = agora_(), ss = planilha_(true), sh = aba_(ss), idx = indice_(sh), n = 0;
    (p.dias || []).forEach(function (d) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date)) || !/^[A-Za-z0-9_-]{1,12}$/.test(String(d.device)) || !d.t || !d.t.d) return;
      var blob = comprimir_(JSON.stringify({t: d.t, b: d.b || {}})), partes = [];
      for (var i = 0; i < blob.length; i += CELULA) partes.push(blob.slice(i, i + CELULA));
      var tot = SorterResumo.sumRows(SorterResumo.unpack(d.t));
      var row = [d.date, d.device, agora, assinatura_(blob), tot.total, tot.valid, tot.noInfo, Object.keys(d.b || {}).length].concat(partes);
      var k = d.date + '|' + d.device, r = idx[k] ? idx[k].row : sh.getLastRow() + 1;
      // Linha inteira até a última coluna usada: partes antigas que sobrariam ficam vazias.
      var largura = Math.max(row.length, sh.getLastColumn());
      while (row.length < largura) row.push('');
      if (largura > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), largura - sh.getMaxColumns());
      sh.getRange(r, 1, 1, 4).setNumberFormat('@');
      sh.getRange(r, 1, 1, largura).setValues([row]);
      idx[k] = {row: r, at: agora, ver: row[3]};
      n++;
    });
    var info = info_();
    info.sorters = (p.sorters || info.sorters || []).map(function (s) {
      return {id: String(s.id), nome: String(s.nome || s.id), nomeZh: String(s.nomeZh || s.nome || s.id), pronto: !!s.pronto,
        erro: s.erro ? String(s.erro).slice(0, 300) : '', balancaErro: s.balancaErro ? String(s.balancaErro).slice(0, 300) : '',
        balancas: (s.balancas || []).map(Number).slice(0, 200)};
    });
    info.enviarMinutos = Number(p.enviarMinutos) || info.enviarMinutos || 60;
    info.versaoPonte = String(p.versao || '');
    info.recebidoEm = agora;
    PropertiesService.getScriptProperties().setProperty('INFO', JSON.stringify(info));
    limpar_(sh, idx, agora.slice(0, 10));
    return {ok: true, recebidos: n, planilha: ss.getUrl(), agora: agora};
  } finally {
    lock.releaseLock();
  }
}
/** Tira da planilha os dias mais antigos que GUARDAR_DIAS (de baixo para cima, para não mudar as linhas de cima). */
function limpar_(sh, idx, hoje) {
  var corte = addDays_(hoje, -GUARDAR_DIAS), velhas = [];
  Object.keys(idx).forEach(function (k) { if (k.split('|')[0] < corte) velhas.push(idx[k].row); });
  if (!velhas.length) return;
  velhas.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}
function estadoPonte_() {
  var idx = indice_(aba_(planilha_(true))), dias = {};
  Object.keys(idx).forEach(function (k) {
    var p = k.split('|');
    (dias[p[1]] = dias[p[1]] || {})[p[0]] = idx[k].at;
  });
  return {ok: true, dias: dias, pedido: CacheService.getScriptCache().get('pedido') || '', agora: agora_(), planilha: planilha_(true).getUrl()};
}

// ------------------------------------------------------------------ ponte: status e pedido do botão Atualizar
function info_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('INFO') || '{}'); } catch (e) { return {}; }
}
function marcarPonte_() { CacheService.getScriptCache().put('ponteVista', agora_(), 21600); }
function ponte_(info) {
  var vista = CacheService.getScriptCache().get('ponteVista') || info.recebidoEm || '';
  return {vista: vista, ligada: !!vista && segundos_(vista, agora_()) <= PONTE_LIGADA_SEG, enviarMinutos: info.enviarMinutos || 60};
}
/** Botão Atualizar: deixa um pedido para a ponte (ela confere a cada 30 s e lê o sorter na hora). */
function pedirAtualizacao() {
  var em = agora_();
  CacheService.getScriptCache().put('pedido', em, 600);
  var p = ponte_(info_());
  return {ok: true, em: em, ligada: p.ligada, vista: p.vista};
}

// ------------------------------------------------------------------ dados da tela
function boot_(p) {
  var info = info_(), lista = info.sorters && info.sorters.length ? info.sorters : SORTERS_PADRAO, par = {};
  ['sorter', 'de', 'ate', 'per', 'tempo', 'lang', 'tv'].forEach(function (k) {
    if (p[k] !== undefined && /^[\w-]{1,12}$/.test(String(p[k]))) par[k] = String(p[k]);
  });
  return {versao: VERSAO, gas: true, atualizarSegundos: (info.enviarMinutos || 60) * 60, lerSegundos: LER_SEGUNDOS, maxDias: MAX_DIAS,
    hoje: agora_().slice(0, 10), params: par,
    sorters: lista.map(function (s) { return {id: s.id, nome: s.nome, nomeZh: s.nomeZh, pronto: !!s.pronto}; })};
}

/** Lê os dias [from, to] dos sorters `devs`: {sorter: {data: {t, b, at}}} (com cache de 6 h pela versão do dia). */
function lerDias_(sh, idx, from, to, devs) {
  var list = Object.keys(idx).filter(function (k) {
    var p = k.split('|');
    return p[0] >= from && p[0] <= to && devs.indexOf(p[1]) >= 0;
  }).map(function (k) { return {k: k, row: idx[k].row, at: idx[k].at, ver: idx[k].ver || idx[k].at}; });
  var cache = CacheService.getScriptCache(), keys = list.map(function (x) { return 'd|' + x.k + '|' + x.ver; });
  var hit = keys.length ? cache.getAll(keys) : {}, out = {}, novos = {};
  var faltam = list.filter(function (x, i) { return !hit[keys[i]]; }).sort(function (a, b) { return a.row - b.row; });
  // Linhas próximas numa leitura só (A e B se alternam na planilha).
  var blocos = [];
  faltam.forEach(function (x) {
    var b = blocos[blocos.length - 1];
    if (b && x.row - b.fim <= 3) { b.fim = x.row; b.itens.push(x); } else blocos.push({ini: x.row, fim: x.row, itens: [x]});
  });
  var larg = Math.max(1, sh.getLastColumn() - COL_DADOS + 1);
  blocos.forEach(function (b) {
    var vals = sh.getRange(b.ini, COL_DADOS, b.fim - b.ini + 1, larg).getValues();
    b.itens.forEach(function (x) {
      var s = vals[x.row - b.ini].join('');
      hit['d|' + x.k + '|' + x.ver] = s;
      if (s.length < 95000) novos['d|' + x.k + '|' + x.ver] = s;
    });
  });
  if (Object.keys(novos).length) { try { cache.putAll(novos, 21600); } catch (e) { /* cache cheio: só não guarda */ } }
  list.forEach(function (x, i) {
    var s = hit[keys[i]];
    if (!s) return;
    var p = x.k.split('|'), obj;
    try { obj = JSON.parse(descomprimir_(s)); } catch (e) { return; }
    obj.at = x.at;
    (out[p[1]] = out[p[1]] || {})[p[0]] = obj;
  });
  return out;
}
/** Linhas de um dia: o total do sorter ou de uma balança (balança parada no dia: as horas zeradas). */
function serie_(dia, ind) {
  var R = SorterResumo, t = R.unpack(dia.t);
  if (ind === null) return t;
  if (dia.b && dia.b[ind]) return R.unpack(dia.b[ind]);
  return t.map(function (r) {
    var z = {date: r.date, time: r.time, hour: r.hour, ps: {}};
    R.NUMS.forEach(function (f) { z[f] = 0; });
    Object.keys(r.ps).forEach(function (k) { z.ps[k] = 0; });
    return z;
  });
}

/**
 * Dados da tela (google.script.run.getDados): o mesmo formato do /api/dados do painel local, com as linhas compactadas
 * (pacote: true). q: {de, ate, sorter ("B" | "A" | "todos"), balanca ("" | "B:3"), turnos ("T1,T2"), hIni, hFim, desde}.
 */
function getDados(q) {
  q = q || {};
  var R = SorterResumo, n = agora_(), today = n.slice(0, 10);
  var a = iso_(q.de) ? q.de : today, b = iso_(q.ate) ? q.ate : a;
  if (b > today) b = today;
  if (a > b) a = b;
  if (dias_(a, b) + 1 > MAX_DIAS) a = addDays_(b, -(MAX_DIAS - 1));
  var len = dias_(a, b) + 1, prevTo = addDays_(a, -1), prevFrom = addDays_(a, -len);
  var info = info_(), lista = info.sorters && info.sorters.length ? info.sorters : SORTERS_PADRAO;
  var todos = q.sorter === 'todos';
  var achado = lista.filter(function (d) { return d.id === q.sorter; })[0];
  var sel = todos ? lista : [achado || lista.filter(function (d) { return d.pronto; })[0] || lista[0]];
  var bm = String(q.balanca || '').match(/^([A-Za-z0-9_-]+):(\d+)$/), bal = bm ? {dev: bm[1], num: Number(bm[2])} : null;
  var turnos = String(q.turnos || '').split(',').filter(function (t) { return R.SHIFTS.indexOf(t) >= 0; });
  var hi = /^\d{1,2}$/.test(String(q.hIni)) ? Math.min(23, Number(q.hIni)) : null;
  var hf = /^\d{1,2}$/.test(String(q.hFim)) ? Math.min(23, Number(q.hFim)) : 23;
  var filtro = {turnos: turnos, horaIni: hi, horaFim: hf};
  var out = {ok: false, pacote: true, from: a, to: b, prevFrom: prevFrom, prevTo: prevTo, today: today, now: n,
    sorter: todos ? 'todos' : sel[0].id, balanca: bal ? bal.dev + ':' + bal.num : '', ponte: ponte_(info)};

  var store = {};
  try {
    var sh = aba_(planilha_(false));
    store = lerDias_(sh, indice_(sh), prevFrom, b, sel.map(function (d) { return d.id; }));
  } catch (e) {
    out.devices = sel.map(function (d) { return {id: d.id, nome: d.nome, nomeZh: d.nomeZh, ok: false, error: e.message}; });
    out.error = e.message;
    return out;
  }

  var per = sel.map(function (d) {
    var inf = {id: d.id, nome: d.nome, nomeZh: d.nomeZh, ok: false};
    if (!d.pronto) {
      inf.pendente = true;
      inf.error = d.erro || 'Falta configurar como trocar para o ' + d.nome + ' (rode o descobrir.bat no computador da base).';
      return {info: inf};
    }
    if (bal && bal.dev !== d.id) { inf.ok = true; inf.fora = true; return {info: inf, rows: [], prevRows: [], balancas: null}; }
    var dias = store[d.id] || {}, ind = bal ? String(bal.num) : null, rows = [], faltam = 0, at = '';
    for (var x = a; x <= b; x = addDays_(x, 1)) {
      var dia = dias[x];
      if (!dia) { faltam++; continue; }
      rows = rows.concat(serie_(dia, ind));
      if (dia.at > at) at = dia.at;
    }
    if (!at) {
      inf.error = d.erro ? 'Última leitura da ponte com erro: ' + d.erro
        : 'A ponte da base ainda não mandou dados do ' + d.nome + ' para este período.';
      return {info: inf};
    }
    inf.ok = true; inf.fetchedAt = at; inf.cached = true;
    var avisos = [];
    if (faltam) avisos.push('faltam ' + faltam + ' dia(s) deste período na planilha');
    if (d.erro) avisos.push('última leitura da ponte com erro: ' + d.erro);
    if (avisos.length) inf.aviso = avisos.join(' · ');
    var prevRows = [];
    for (var y = prevFrom; y <= prevTo && prevRows; y = addDays_(y, 1)) prevRows = dias[y] ? prevRows.concat(serie_(dias[y], ind)) : null;
    // Balanças: as que produziram no período, com o filtro de turno e horário.
    var nums = {};
    Object.keys(dias).forEach(function (dt) { if (dt >= a && dt <= b) Object.keys(dias[dt].b || {}).forEach(function (k) { nums[k] = 1; }); });
    var lista2 = Object.keys(nums).map(Number).sort(function (p1, p2) { return p1 - p2; });
    inf.balancas = lista2;
    if (d.balancaErro) inf.balancaErro = d.balancaErro;
    var balancas = lista2.map(function (num) {
      var rs = [];
      Object.keys(dias).forEach(function (dt) { if (dt >= a && dt <= b && dias[dt].b && dias[dt].b[num]) rs = rs.concat(R.unpack(dias[dt].b[num])); });
      var f = R.sumRows(R.filterRows(rs, filtro));
      return {id: d.id + ':' + num, device: d.id, num: num, total: f.total, valid: f.valid, abnormal: f.abnormal, noInfo: f.noInfo};
    });
    return {info: inf, rows: rows, prevRows: prevRows, balancas: balancas};
  });

  var ok = per.filter(function (x) { return x.info.ok; });
  out.devices = per.map(function (x) { return x.info; });
  out.ok = ok.length > 0;
  if (!out.ok) { out.error = per.map(function (x) { return x.info.nome + ': ' + x.info.error; }).join(' · '); return out; }
  out.rows = R.pack(R.mergeRows(ok.map(function (x) { return x.rows; })));
  out.prevRows = ok.every(function (x) { return x.prevRows; }) ? R.pack(R.mergeRows(ok.map(function (x) { return x.prevRows; }))) : null;
  if (todos) {
    out.rowsByDevice = {};
    ok.filter(function (x) { return !x.info.fora; }).forEach(function (x) { out.rowsByDevice[x.info.id] = R.pack(x.rows); });
  }
  out.balancas = [].concat.apply([], ok.map(function (x) { return x.balancas || []; }));
  var ats = ok.map(function (x) { return x.info.fetchedAt; }).filter(Boolean).sort();
  out.fetchedAt = ats[0] || null;
  out.dadosEm = ats[ats.length - 1] || null;
  out.novo = !!(q.desde && out.dadosEm && out.dadosEm > q.desde);   // a ponte leu DEPOIS do pedido
  out.cached = true;
  return out;
}

// ------------------------------------------------------------------ datas (São Paulo)
function agora_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function iso_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
function addDays_(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dias_(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
function segundos_(a, b) { return (Date.parse(b.replace(' ', 'T') + 'Z') - Date.parse(a.replace(' ', 'T') + 'Z')) / 1000; }
