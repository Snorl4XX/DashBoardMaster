// Adicione este arquivo ao projeto Apps Script que já coleta as viagens.
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Monitor de Recebimento | SP GRU');
}

function dadosPainelRecebimento() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('RECEBIMENTO_SHEET_ID');
  const stamp = props.getProperty('RECEBIMENTO_ULTIMO_SUCESSO');
  if (!id || !stamp) throw new Error('A coleta JMS ainda não foi configurada.');
  const tab = SpreadsheetApp.openById(id).getSheetByName('Recebimento JMS');
  if (!tab) throw new Error('Aba Recebimento JMS ausente.');
  const [headers, ...rows] = tab.getDataRange().getValues();
  return {records:lerViagensRecebimento_(tab),updated:stamp,
    falhaColeta:props.getProperty('RECEBIMENTO_FALHA')};
}

function lerViagensRecebimento_(tab) {
  const [headers,...rows] = tab.getDataRange().getValues();
  const indices = RECEBIMENTO.fields.map(field => headers.indexOf(field));
  return rows.filter(row => row[indices[0]]).map(row => Object.fromEntries(
    RECEBIMENTO.fields.map((field,index) => {
      const value = row[indices[index]];
      return [field,value instanceof Date
        ? Utilities.formatDate(value,RECEBIMENTO.timezone,'yyyy-MM-dd HH:mm:ss')
        : value == null || value === '' ? null : value];
    })
  ));
}

function coletarDetalhesRecebimento_(lote,headers,agora) {
  const opcoes = {method:'get',headers,muteHttpExceptions:true,followRedirects:false};
  const comDetalhe = lote.filter(row => urlDetalheViagem_(row));
  const oficiais = buscarDetalhesJms_(comDetalhe.map(row => ({url:urlDetalheViagem_(row),...opcoes})));
  const respostas = buscarDetalhesJms_(lote.map(row => ({url:urlBipagemRecebimento_(row),...opcoes})));
  lote.forEach((row,index) => {
    const detalhe = scansDescargaGru_(respostas[index],row.shipmentNo);
    const oficial = paradaOficialGru_(oficiais[comDetalhe.indexOf(row)],row.shipmentNo);
    row.actualArrivalTime = horarioVirada_(oficial?.actualArrivalTime) || row.actualArrivalTime;
    row.unlockTime = horarioVirada_(oficial?.unlockTime) || row.unlockTime;
    row.unloadStartTime = horarioVirada_(oficial?.unloadStartTime) || row.unloadStartTime || detalhe.inicio;
    row.unloadEndTime = horarioVirada_(oficial?.unloadEndTime) || row.unloadEndTime;
    row.ultimoBipe = detalhe.ultimoBipe || row.ultimoBipe;
    row.bipeDescargaRegistrado = detalhe.bipeRegistrado || Boolean(row.bipeDescargaRegistrado);
    row.detalheDisponivel = Boolean(oficial) || detalhe.disponivel;
    row.detalheSituacao = oficial ? 'verificado' : detalhe.situacao;
    row.situacaoBipagem = detalhe.situacao;
    row.detalheConsultadoEm = agora.toISOString();
  });
}

function horarioVirada_(value) {
  if (typeof value !== 'string') return '';
  const time = value.trim().replace('T',' ').replace(/\.\d+$/,'');
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time) ? time : '';
}

function scansDescargaGru_(response, viagem) {
  const vazio = {inicio:'',ultimoBipe:'',disponivel:false,bipeRegistrado:false,situacao:'respostaInvalida'};
  if (!response) return {...vazio,situacao:'semResposta'};
  const status = response.getResponseCode();
  if (status !== 200) return {...vazio,situacao:'HTTP '+status};
  try {
    const body = JSON.parse(response.getContentText());
    if (body.fail || Number(body.code) !== 1 || !Array.isArray(body.data)) return vazio;
    const descarga = body.data.filter(item => item && String(item.jobCode) === String(viagem) &&
      String(item.scanNetworkCode) === '30001' && String(item.loadingTypeName) === '2');
    if (!descarga.length) return {...vazio,situacao:'semRegistroGru'};
    const inicios = descarga.map(item => horarioVirada_(item.scanStartTime)).filter(Boolean).sort();
    const ultimos = descarga.map(item => horarioVirada_(item.scanEndTime)).filter(Boolean).sort();
    return {inicio:inicios[0] || '',ultimoBipe:ultimos.pop() || '',disponivel:true,situacao:'verificado',bipeRegistrado:descarga.some(item =>
      [item.scanWaybillNum,item.scanWaybillSingleNum,item.scanPackageNum,item.onlyUnloadCount].some(count=>Number(count)>0))};
  } catch (error) {
    return vazio;
  }
}

function urlBipagemRecebimento_(row) {
  const rota = row.line === 'branch' ? 'tmsBranchTrackingDetail' : 'trackingDeatil';
  return 'https://gw.jtjms-br.com/transportation/' + rota + '/loading/scan/list?shipmentNo=' +
    encodeURIComponent(row.shipmentNo);
}

function buscarDetalhesJms_(requisicoes) {
  if (!requisicoes.length) return [];
  try {
    return UrlFetchApp.fetchAll(requisicoes);
  } catch (error) {
    if (cotaRecebimento_(error)) throw error;
    return requisicoes.map(({url,...options}) => {
      try { return UrlFetchApp.fetch(url,options); }
      catch (error) { if (cotaRecebimento_(error)) throw error; return null; }
    });
  }
}

function urlDetalheViagem_(row) {
  if (row.line === 'trunk') {
    return 'https://gw.jtjms-br.com/transportation/tmsShipment/traceDetail?shipmentNo=' + encodeURIComponent(row.shipmentNo);
  }
  if (row.line !== 'branch' || !/^jms:\d+$/.test(row.jmsDetailId || '')) return '';
  return 'https://gw.jtjms-br.com/transportation/tmsnewBranchShipment/detail?id=' + row.jmsDetailId.slice(4);
}

function paradaOficialGru_(response,viagem) {
  if (!response || response.getResponseCode() !== 200) return null;
  try {
    const body = JSON.parse(response.getContentText());
    if (body.fail || body.succ === false || (body.code != null && Number(body.code) !== 1)) return null;
    const pilha = [body.data ?? body];
    const paradas = [];
    while (pilha.length) {
      const item = pilha.pop();
      if (!item || typeof item !== 'object') continue;
      if (String(item.shipmentNo) === String(viagem) &&
          String(item.networkCode) === '30001' && String(item.handlingType) === '2') {
        paradas.push(item);
      }
      pilha.push(...Object.values(item));
    }
    return paradas.sort((a,b)=>
      Number(Boolean(horarioVirada_(b.unloadEndTime))) - Number(Boolean(horarioVirada_(a.unloadEndTime))) ||
      Number(Boolean(horarioVirada_(b.unloadStartTime))) - Number(Boolean(horarioVirada_(a.unloadStartTime))) ||
      Number(b.sortNum || 0) - Number(a.sortNum || 0)
    )[0] || null;
  } catch (error) {
    return null;
  }
}
