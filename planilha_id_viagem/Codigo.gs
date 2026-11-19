/**
 * J&T · PLANILHA DO ID DE VIAGEM — a coluna "Data (partida)" passa a mostrar a data do "Tempo real de chegada".
 * Apps Script da própria Planilha Google. Vale para todas as abas que têm as duas colunas (a linha troncal e a linha secundária
 * têm os mesmos nomes de coluna). Só a coluna da Data muda; o Tempo real de chegada e as outras colunas ficam como estão.
 *
 * Instalar (uma vez):
 *  1. Na planilha: Extensões → Apps Script.
 *  2. Ao lado de "Arquivos", clique em ➕ → Script, dê o nome DataPelaChegada, apague o que vier escrito, cole este arquivo
 *     inteiro e clique em 💾 Salvar. Não apague os outros arquivos do projeto.
 *  3. Na barra de cima, escolha a função instalarDataPelaChegada e clique em ▶ Executar. Na 1ª vez o Google pede autorização:
 *     Revisar permissões → sua conta → Avançado → Acessar → Permitir. O resultado aparece no Registro de execução.
 *  4. Volte para a planilha e aperte F5: aparece o menu "ID de viagem".
 * Depois disso a Data é refeita sozinha quando alguém mexe na planilha (colar, editar, inserir linhas) e a cada 10 minutos
 * (dados que chegam por outro script ou importação).
 *
 * Regras:
 *  - Data = o dia do Tempo real de chegada (ex.: chegou 18/11/2026 23:50 → 18/11/2026), no fuso da planilha.
 *  - Linha sem Tempo real de chegada (viagem ainda em trânsito) fica como estava.
 *  - Célula da Data com fórmula: na linha com chegada, a fórmula vira a data; nas outras, a fórmula fica.
 *  - O cabeçalho é procurado nas 10 primeiras linhas. A coluna da Data pode se chamar "Data (partida)", "Data de partida",
 *    "Data (chegada)" ou "Data de chegada"; a outra, "Tempo real de chegada" (também com o nome em chinês, 实际到达时间).
 */
var DATA_CHEGADA_ = {
  versao: '1.0.0',
  menu: 'ID de viagem',
  data: /^data(de|da)?(partida|chegada)$/,
  chegada: ['temporealdechegada', '实际到达时间', 'actualarrivaltime'],
  linhasCabecalho: 10,
  minutos: 10,
  formato: 'dd/MM/yyyy'
};

// ---------- Instalação, menu e gatilhos ----------

/** Rode uma vez pelo editor (▶ Executar): cria o menu, a atualização automática e já troca as datas. */
function instalarDataPelaChegada() {
  var ss = SpreadsheetApp.getActive();
  if (!ss) throw new Error('Abra o Apps Script pela planilha: Extensões → Apps Script.');
  apagarGatilhosDC_(['menuDataPelaChegada', 'aoMudarDataPelaChegada', 'atualizarDataPelaChegadaSozinho']);
  ScriptApp.newTrigger('menuDataPelaChegada').forSpreadsheet(ss).onOpen().create();
  ScriptApp.newTrigger('aoMudarDataPelaChegada').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('atualizarDataPelaChegadaSozinho').timeBased().everyMinutes(DATA_CHEGADA_.minutos).create();
  var texto = atualizarDataPelaChegada_().texto + '\nAtualização automática ligada (ao mexer na planilha e a cada ' + DATA_CHEGADA_.minutos +
    ' minutos). Aperte F5 na planilha para ver o menu "' + DATA_CHEGADA_.menu + '".';
  avisoDC_(texto);
  return texto;
}

/** Menu "ID de viagem" (gatilho ao abrir a planilha, criado por instalarDataPelaChegada). */
function menuDataPelaChegada() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (!ui) { console.log('Data pela chegada: o menu "' + DATA_CHEGADA_.menu + '" aparece na planilha (aperte F5 nela).'); return; }
  ui.createMenu(DATA_CHEGADA_.menu)
    .addItem('📅 Data pelo Tempo real de chegada: atualizar agora', 'atualizarDataPelaChegadaAgora')
    .addItem('⏹ Parar a atualização automática', 'pararDataPelaChegada')
    .addItem('▶ Ligar a atualização automática', 'instalarDataPelaChegada')
    .addToUi();
}

/** Menu: troca as datas agora e mostra quantas mudaram em cada aba. */
function atualizarDataPelaChegadaAgora() {
  var texto = atualizarDataPelaChegada_().texto;
  avisoDC_(texto);
  return texto;
}

/** Gatilho ao mexer na planilha (colar, editar, inserir linhas). Mudança só de formatação não refaz nada. */
function aoMudarDataPelaChegada(e) {
  if (e && e.changeType === 'FORMAT') return null;
  return atualizarDataPelaChegada_().texto;
}

/** Gatilho de 10 em 10 minutos: pega os dados que chegaram por outro script ou importação. */
function atualizarDataPelaChegadaSozinho() { return atualizarDataPelaChegada_().texto; }

/** Menu ⏹: desliga a atualização automática (o menu continua; ▶ Ligar volta a atualizar sozinho). */
function pararDataPelaChegada() {
  apagarGatilhosDC_(['aoMudarDataPelaChegada', 'atualizarDataPelaChegadaSozinho']);
  var texto = 'Atualização automática desligada. A Data só muda pelo menu "' + DATA_CHEGADA_.menu + '" → Atualizar agora.';
  avisoDC_(texto);
  return texto;
}

function apagarGatilhosDC_(nomes) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (nomes.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

/** Mensagem no Registro de execução e, com a planilha aberta pelo menu, numa janela (pelo editor não há janelas). */
function avisoDC_(texto) {
  console.log('Data pela chegada: ' + texto);
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (ui) ui.alert('Data pelo Tempo real de chegada', texto, ui.ButtonSet.OK);
}

// ---------- A troca das datas ----------

/** Todas as abas com as duas colunas. → {abas: [{aba, linhas, trocadas, sem, erro}], texto} */
function atualizarDataPelaChegada_() {
  var ss = SpreadsheetApp.getActive(), tz = ss.getSpreadsheetTimeZone() || 'America/Sao_Paulo';
  var trava = LockService.getDocumentLock();
  if (!trava.tryLock(20000)) return {abas: [], texto: 'Outra atualização está rodando agora; tente de novo em alguns segundos.'};
  var abas = [];
  try {
    ss.getSheets().forEach(function (sh) { var r = atualizarAbaDC_(sh, tz); if (r) abas.push(r); });
    SpreadsheetApp.flush();
  } finally { trava.releaseLock(); }
  if (!abas.length) {
    return {abas: abas, texto: 'Não achei nenhuma aba com as colunas "Data (partida)" e "Tempo real de chegada" (o cabeçalho é procurado nas ' +
      DATA_CHEGADA_.linhasCabecalho + ' primeiras linhas). Confira os nomes das colunas.'};
  }
  var texto = abas.map(function (r) {
    if (r.erro) return 'Aba "' + r.aba + '": ' + r.erro;
    return 'Aba "' + r.aba + '": ' + fmtDC_(r.trocadas) + ' data(s) trocada(s) pelo Tempo real de chegada' +
      (r.sem ? ', ' + fmtDC_(r.sem) + ' sem Tempo real de chegada (ficaram como estavam)' : '') + '.';
  }).join('\n');
  return {abas: abas, texto: texto};
}

/** Uma aba. → null (sem as duas colunas) ou {aba, linhas, trocadas, sem, erro}. Grava só se alguma data mudou. */
function atualizarAbaDC_(sh, tz) {
  var cab = cabecalhoDC_(sh);
  if (!cab) return null;
  var nome = sh.getName(), n = sh.getLastRow() - cab.linha;
  if (sh.getRange(cab.linha, cab.colData).getFormula()) {
    return {aba: nome, linhas: 0, trocadas: 0, sem: 0, erro: 'o cabeçalho da coluna Data tem uma fórmula que preenche a coluna inteira; ' +
      'troque a fórmula para usar a coluna Tempo real de chegada (nada foi alterado nesta aba).'};
  }
  if (n < 1) return {aba: nome, linhas: 0, trocadas: 0, sem: 0};
  var faixa = sh.getRange(cab.linha + 1, cab.colData, n, 1);
  var datas = faixa.getValues(), formulas = faixa.getFormulas(), formatos = faixa.getNumberFormats();
  var chegadas = sh.getRange(cab.linha + 1, cab.colChegada, n, 1).getValues();
  var saida = [], mudou = [], sem = 0;
  for (var i = 0; i < n; i++) {
    var atual = datas[i][0], formula = formulas[i][0], dia = diaDC_(chegadas[i][0], tz);
    saida.push([formula || atual]); // o que não muda volta como estava (a fórmula também)
    if (!dia) {
      if (!(vazioDC_(chegadas[i][0]) && vazioDC_(atual) && !formula)) sem++; // linha vazia não conta
      continue;
    }
    if (!formula && ehDataDC_(atual) && diaDC_(atual, tz) === dia) continue;
    saida[i] = [Utilities.parseDate(dia, tz, 'yyyy-MM-dd')];
    formatos[i][0] = DATA_CHEGADA_.formato;
    mudou.push(i);
  }
  gravarDC_(sh, cab, faixa, saida, formatos, mudou);
  return {aba: nome, linhas: n, trocadas: mudou.length, sem: sem};
}

/**
 * Grava só os trechos de linhas seguidas que mudaram (as outras células da coluna não são reescritas). Muitos trechos
 * separados (1ª vez, com viagens em trânsito no meio): a coluna inteira de uma vez.
 */
function gravarDC_(sh, cab, faixa, saida, formatos, mudou) {
  if (!mudou.length) return;
  var trechos = [];
  mudou.forEach(function (i) {
    var t = trechos[trechos.length - 1];
    if (t && t[1] === i - 1) t[1] = i; else trechos.push([i, i]);
  });
  if (trechos.length > 200) {
    faixa.setValues(saida);
    faixa.setNumberFormats(formatos);
    return;
  }
  trechos.forEach(function (t) {
    var r = sh.getRange(cab.linha + 1 + t[0], cab.colData, t[1] - t[0] + 1, 1);
    r.setValues(saida.slice(t[0], t[1] + 1));
    r.setNumberFormats(formatos.slice(t[0], t[1] + 1));
  });
}

/** Cabeçalho: a 1ª linha (até a 10ª) com as duas colunas. → {linha, colData, colChegada} (contando de 1) ou null. */
function cabecalhoDC_(sh) {
  var ultCol = sh.getLastColumn(), n = Math.min(DATA_CHEGADA_.linhasCabecalho, sh.getLastRow());
  if (ultCol < 1 || n < 1) return null;
  var topo = sh.getRange(1, 1, n, ultCol).getValues();
  for (var i = 0; i < topo.length; i++) {
    var colData = -1, colChegada = -1;
    for (var j = 0; j < topo[i].length; j++) {
      var h = normalDC_(topo[i][j]);
      if (!h) continue;
      if (colData < 0 && DATA_CHEGADA_.data.test(h)) colData = j;
      else if (colChegada < 0 && DATA_CHEGADA_.chegada.some(function (c) { return h.indexOf(c) >= 0; })) colChegada = j;
    }
    if (colData >= 0 && colChegada >= 0) return {linha: i + 1, colData: colData + 1, colChegada: colChegada + 1};
  }
  return null;
}

/** Nome da coluna sem acentos, maiúsculas, espaços e pontuação: "Data (partida)" → "datapartida". */
function normalDC_(v) {
  return String(v === null || v === undefined ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[\s()\[\]{}.,;:\-_\/\\|'"`´^~*+?!@#$%&=<>（）：，]/g, '');
}

/**
 * O dia ("AAAA-MM-DD") de um horário da planilha: data/hora da própria planilha (no fuso dela), texto do JMS ("2026-11-18
 * 23:50:00"), texto brasileiro ("18/11/2026 23:50") ou número de data da planilha. '' quando não dá para ler.
 */
function diaDC_(v, tz) {
  if (ehDataDC_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'number') {
    if (!(v > 20000 && v < 80000)) return '';
    var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return d.getUTCFullYear() + '-' + doisDC_(d.getUTCMonth() + 1) + '-' + doisDC_(d.getUTCDate());
  }
  var s = String(v === null || v === undefined ? '' : v).trim(), m, a, me, di;
  if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:$|[ T])/.exec(s))) { a = +m[1]; me = +m[2]; di = +m[3]; }
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|[ T,])/.exec(s))) { a = +m[3]; me = +m[2]; di = +m[1]; }
  else return '';
  if (me < 1 || me > 12 || di < 1 || di > 31) return '';
  return a + '-' + doisDC_(me) + '-' + doisDC_(di);
}
function ehDataDC_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function doisDC_(n) { return (n < 10 ? '0' : '') + n; }
function vazioDC_(v) { return v === null || v === undefined || String(v).trim() === ''; }
function fmtDC_(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
