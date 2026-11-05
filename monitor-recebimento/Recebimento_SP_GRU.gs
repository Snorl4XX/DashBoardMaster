// Apps Script vinculado a uma planilha. Execute instalarRecebimento15min.
const RECEBIMENTO = {
  host: 'https://gw.jtjms-br.com',
  timezone: 'America/Sao_Paulo',
  size: 20,
  detalhesPorRodada: 20,
  fields: ['shipmentNo','line','shipmentState','startName','endCode','plateNumber',
    'scanMainWaybillNum','plannedDepartureTime','actualDepartureTime','plannedArrivalTime',
    'turnoPrevisto','dataOperacional','actualArrivalTime','unlockTime','unloadStartTime','updateTime','jmsDetailId',
    'unloadEndTime','ultimoBipe','bipeDescargaRegistrado','detalheDisponivel','detalheSituacao','situacaoBipagem','detalheConsultadoEm']
};

function instalarRecebimento15min() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!sheet) throw new Error('Abra o Apps Script por Extensões em uma planilha.');
  PropertiesService.getScriptProperties().setProperty('RECEBIMENTO_SHEET_ID', sheet.getId());
  atualizarRecebimento();
  const antigos = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'atualizarRecebimento');
  ScriptApp.newTrigger('atualizarRecebimento').timeBased().everyMinutes(15).create();
  antigos.forEach(t => ScriptApp.deleteTrigger(t));
}

function atualizarRecebimento() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  const props = PropertiesService.getScriptProperties();
  try {
    const headers = JSON.parse(props.getProperty('JMS_HEADERS_JSON') || '{}');
    if (!headers || Array.isArray(headers) || typeof headers !== 'object' || !Object.keys(headers).length) {
      throw new Error('Configure JMS_HEADERS_JSON nas propriedades do script.');
    }
    const sheetId = props.getProperty('RECEBIMENTO_SHEET_ID');
    if (!sheetId) throw new Error('Execute instalarRecebimento15min pela planilha.');
    const now = new Date();
    const date = offset => Utilities.formatDate(new Date(now.getTime() + offset * 86400000), RECEBIMENTO.timezone, 'yyyy-MM-dd');
    // As APIs filtram pela saída. A escala de recebimento usa a chegada programada.
    const primeiroDia = new Date(date(0).slice(0,7) + '-01T12:00:00Z');
    primeiroDia.setUTCDate(0);
    const hoje = date(0);
    const reconciliar = props.getProperty('RECEBIMENTO_ULTIMA_REVISAO') !== hoje;
    const inicioMes = primeiroDia.toISOString().slice(0,10);
    const start = (reconciliar ? inicioMes : date(-2)) + ' 00:00:00';
    const end = date(1) + ' 23:59:59';
    const spreadsheet = SpreadsheetApp.openById(sheetId);
    const tab = spreadsheet.getSheetByName('Recebimento JMS') || spreadsheet.insertSheet('Recebimento JMS');
    const records = new Map(lerViagensRecebimento_(tab)
      .filter(row => Number(row.shipmentState) === 3 || [row.actualArrivalTime,row.plannedArrivalTime,row.unloadStartTime,row.actualDepartureTime,row.plannedDepartureTime]
        .some(time => typeof time === 'string' && time.slice(0,10) >= inicioMes))
      .map(row => [row.line + ':' + row.shipmentNo,row]));
    const novos = new Map();
    for (const line of ['trunk', 'branch']) {
      for (const state of [3, 4]) {
        const query = line === 'trunk'
          ? {shipmentState:state,endCode:30001,startDateTime:start,endDateTime:end,searchType:'manage'}
          : {shipmentState:state,endCode:'30001',countryId:'1',startFinancialCenterCode:'370000',
             startDepartureTime:start,endDepartureTime:end};
        const path = line === 'trunk' ? '/transportation/tmsShipment/page' : '/transportation/tmsBranchTrackingDetail/page';
        coletarPaginasRecebimento_(path, line, query, headers, novos);
      }
    }
    for (const [key,row] of novos) {
      const anterior = records.get(key);
      if (anterior && (Number(anterior.shipmentState) > row.shipmentState ||
          (Number(anterior.shipmentState) === row.shipmentState && anterior.updateTime && row.updateTime && anterior.updateTime > row.updateTime))) continue;
      const atual = {...anterior,...row};
      for (const field of ['actualArrivalTime','unlockTime','unloadStartTime','unloadEndTime','jmsDetailId']) {
        if (!atual[field] && anterior?.[field]) atual[field] = anterior[field];
      }
      records.set(key,atual);
    }
    const lote = Array.from(records.values()).filter(row => {
      const fimConfirmado = Number(row.shipmentState) === 4 && row.actualArrivalTime && row.unlockTime &&
        row.unloadStartTime && row.unloadEndTime && row.ultimoBipe;
      const recente = [row.actualArrivalTime,row.plannedArrivalTime,row.unloadStartTime]
        .some(time => typeof time === 'string' && time.slice(0,10) >= inicioMes);
      const consultado = Date.parse(row.detalheConsultadoEm || '');
      return !fimConfirmado && (recente || Number(row.shipmentState) === 3) &&
        (!Number.isFinite(consultado) || now.getTime()-consultado >= (row.detalheDisponivel ? 30 : 15)*60000);
    }).sort((a,b) => String(a.detalheConsultadoEm || '').localeCompare(String(b.detalheConsultadoEm || '')))
      .slice(0,RECEBIMENTO.detalhesPorRodada);
    coletarDetalhesRecebimento_(lote,headers,now);
    const values = [RECEBIMENTO.fields, ...Array.from(records.values(), row =>
      RECEBIMENTO.fields.map(field => celulaRecebimento_(row[field])))];
    const height = Math.max(values.length, tab.getLastRow());
    while (values.length < height) values.push(RECEBIMENTO.fields.map(() => ''));
    if (height > tab.getMaxRows()) tab.insertRowsAfter(tab.getMaxRows(), height - tab.getMaxRows());
    if (RECEBIMENTO.fields.length > tab.getMaxColumns()) tab.insertColumnsAfter(tab.getMaxColumns(), RECEBIMENTO.fields.length-tab.getMaxColumns());
    tab.getRange(1, 1, height, RECEBIMENTO.fields.length).setValues(values);
    tab.setFrozenRows(1);
    props.setProperty('RECEBIMENTO_ULTIMO_SUCESSO', new Date().toISOString());
    if (reconciliar) props.setProperty('RECEBIMENTO_ULTIMA_REVISAO',hoje);
    props.deleteProperty('RECEBIMENTO_FALHA');
    console.log('Coleta completa. Viagens únicas: ' + records.size + '. Detalhes consultados: ' + lote.length);
  } catch (error) {
    props.setProperty('RECEBIMENTO_FALHA',cotaRecebimento_(error)?'cota':'coleta');
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function coletarPaginasRecebimento_(path, line, query, headers, records) {
  let previousSignature;
  for (let current = 1; current <= 500; current++) {
    const params = {current, size: RECEBIMENTO.size, ...query};
    const options = {headers, muteHttpExceptions:true, followRedirects:false};
    let url = RECEBIMENTO.host + path;
    if (line === 'trunk') {
      url += '?' + Object.entries(params).map(([k,v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    } else {
      Object.assign(options, {method:'post',contentType:'application/json',payload:JSON.stringify(params)});
    }
    const response = UrlFetchApp.fetch(url, options);
    const label = line + '/' + query.shipmentState + ', página ' + current;
    if (response.getResponseCode() !== 200) throw new Error(label + ' HTTP ' + response.getResponseCode());
    let body;
    try {body = JSON.parse(response.getContentText());}
    catch (error) {throw new Error(label + ' retornou conteúdo diferente de JSON. Confira a sessão JMS.');}
    const payload = body.data ?? body.result ?? body;
    const rows = Array.isArray(payload) ? payload : payload.records ?? payload.rows ?? payload.list;
    if (!Array.isArray(rows)) throw new Error(label + ' sem lista de viagens. Confira sessão e formato do retorno.');
    if (!rows.length) return;
    const signature = rows.map(row => row.shipmentNo || row.id).join('|');
    if (signature === previousSignature) throw new Error(label + ' repetiu a página anterior.');
    previousSignature = signature;
    for (const row of rows) {
      const state = Number(row.shipmentState);
      if (!row.shipmentNo || String(row.endCode) !== '30001' || ![3, 4].includes(state)) continue;
      const key = line + ':' + row.shipmentNo;
      const currentRow = records.get(key);
      if (currentRow && (currentRow.shipmentState > state ||
          (currentRow.shipmentState === state && (currentRow.updateTime || '') > (row.updateTime || '')))) continue;
      records.set(key, {...row, ...turnoRecebimento_(row.plannedArrivalTime), line,
        jmsDetailId:typeof row.id === 'string' ? 'jms:' + row.id : '', shipmentState:state, unlockTime:row.unlockTime ?? row.actualUnlockTime});
    }
    const pages = Number(payload.pages ?? payload.totalPages);
    const total = Number(payload.total);
    if ((pages > 0 && current >= pages) ||
        (Number.isFinite(total) && total > 0 && current * RECEBIMENTO.size >= total) ||
        (!(pages > 0 || total > 0) && rows.length < RECEBIMENTO.size)) return;
  }
  throw new Error('Limite de paginação atingido para ' + line + '/' + query.shipmentState + '.');
}

function turnoRecebimento_(arrival) {
  if (typeof arrival !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(arrival)) return {};
  const hour = Number(arrival.slice(11,13));
  const date = new Date(arrival.slice(0,10) + 'T12:00:00Z');
  if (hour > 23 || !Number.isFinite(date.getTime())) return {};
  if (hour >= 22) date.setUTCDate(date.getUTCDate() + 1);
  return {turnoPrevisto:hour < 6 || hour >= 22 ? 'T3' : hour < 14 ? 'T1' : 'T2',
    dataOperacional:date.toISOString().slice(0,10)};
}

function celulaRecebimento_(value) {
  if (value == null) return '';
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function cotaRecebimento_(error) {
  return /quota|too many times|muitas vezes/i.test(String(error));
}
