'use strict';
/**
 * JMS de mentira para os testes: as consultas que o Recebimento_SP_GRU.gs e o Painel.gs fazem, com viagens fictícias.
 *   GET  /transportation/tmsShipment/page                   (troncal, 2 páginas no estado 4)
 *   POST /transportation/tmsBranchTrackingDetail/page       (secundária)
 *   GET  /transportation/tmsShipment/traceDetail            (paradas da troncal)
 *   GET  /transportation/tmsnewBranchShipment/detail        (paradas da secundária)
 *   GET  /transportation/{trackingDeatil|tmsBranchTrackingDetail}/loading/scan/list (bipes de descarga)
 * AuthToken errado → {code: 135010030, data: null}, como o JMS com a sessão vencida.
 */
const http = require('http');

function hojeSp() {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
}

function criar() {
  const dia = hojeSp();
  const h = hm => dia + ' ' + hm + ':00';
  const troncal3 = [
    {shipmentNo: 'TESTE-T1', shipmentState: 3, endCode: 30001, startName: '=Base Teste A', plateNumber: 'AAA0A00', scanMainWaybillNum: 10,
      plannedDepartureTime: h('10:00'), actualDepartureTime: h('10:05'), plannedArrivalTime: h('15:00'), updateTime: h('11:00'), id: 'nao-numerico'},
    {shipmentNo: 'TESTE-T9', shipmentState: 3, endCode: 30002, startName: 'Base Teste Z', plannedArrivalTime: h('15:00'), updateTime: h('11:00')}
  ];
  const troncal4 = Array.from({length: 25}, (_, i) => ({shipmentNo: 'TESTE-T' + (100 + i), shipmentState: 4, endCode: 30001,
    startName: 'Base Teste B', plateNumber: 'BBB0B' + String(i).padStart(2, '0'), plannedArrivalTime: h('08:00'), actualArrivalTime: h('08:10'),
    updateTime: h('09:00')}));
  const secundaria3 = [{shipmentNo: 'TESTE-B1', shipmentState: 3, endCode: '30001', startName: 'Base Teste C', plateNumber: 'CCC0C00',
    plannedArrivalTime: h('23:00'), updateTime: h('12:00'), id: '123'}];
  const secundaria4 = [{shipmentNo: 'TESTE-B2', shipmentState: 4, endCode: '30001', startName: 'Base Teste D', plateNumber: 'DDD0D00',
    plannedArrivalTime: h('05:30'), actualArrivalTime: h('05:40'), updateTime: h('06:00'), id: '456'}];

  const estado = {token: 'tok-teste-12345', pedidos: [], dia};
  const pagina = (lista, atual, tam) => ({code: 1, data: {records: lista.slice((atual - 1) * tam, atual * tam), total: lista.length,
    pages: Math.max(1, Math.ceil(lista.length / tam)), current: atual, size: tam}});

  const servidor = http.createServer((req, res) => {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const corpo = Buffer.concat(partes).toString('utf8');
      estado.pedidos.push({metodo: req.method, caminho: url.pathname, query: Object.fromEntries(url.searchParams), corpo, cabecalhos: req.headers});
      const responder = obj => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(obj)); };
      if (req.headers.authtoken !== estado.token) { responder({code: 135010030, msg: 'token inválido (teste)', data: null}); return; }
      const p = url.pathname, q = url.searchParams;
      if (p === '/transportation/tmsShipment/page' && req.method === 'GET') {
        const lista = q.get('shipmentState') === '3' ? troncal3 : troncal4;
        responder(pagina(lista, Number(q.get('current')), Number(q.get('size'))));
        return;
      }
      if (p === '/transportation/tmsBranchTrackingDetail/page' && req.method === 'POST') {
        const b = JSON.parse(corpo || '{}');
        responder(pagina(Number(b.shipmentState) === 3 ? secundaria3 : secundaria4, Number(b.current), Number(b.size)));
        return;
      }
      if (p === '/transportation/tmsShipment/traceDetail') {
        const v = q.get('shipmentNo');
        responder(v === 'TESTE-T1'
          ? {code: 1, data: {shipmentNo: v, paradas: [
            {shipmentNo: v, networkCode: '30002', handlingType: '2', actualArrivalTime: h('13:00')},
            {shipmentNo: v, networkCode: '30001', handlingType: '2', actualArrivalTime: h('14:50'), unlockTime: h('14:55'), unloadStartTime: h('15:00'), sortNum: 2}]}}
          : {code: 1, data: {shipmentNo: v, paradas: []}});
        return;
      }
      if (p === '/transportation/tmsnewBranchShipment/detail') {
        const id = q.get('id');
        responder(id === '123'
          ? {code: 1, data: {stops: [{shipmentNo: 'TESTE-B1', networkCode: '30001', handlingType: '2', actualArrivalTime: h('22:40'),
            unloadStartTime: h('22:50'), unloadEndTime: h('23:20'), sortNum: 1}]}}
          : {code: 1, data: {stops: []}});
        return;
      }
      if (/^\/transportation\/(trackingDeatil|tmsBranchTrackingDetail)\/loading\/scan\/list$/.test(p)) {
        const v = q.get('shipmentNo');
        responder(v === 'TESTE-T1'
          ? {code: 1, data: [{jobCode: v, scanNetworkCode: '30001', loadingTypeName: '2', scanStartTime: h('15:01'), scanEndTime: h('15:30'), scanWaybillNum: 8}]}
          : v === 'TESTE-B1'
            ? {code: 1, data: [{jobCode: v, scanNetworkCode: '30001', loadingTypeName: '2', scanStartTime: h('22:51'), scanEndTime: h('23:19'), scanPackageNum: 3}]}
            : {code: 1, data: []});
        return;
      }
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end('{"code":404}');
    });
  });
  return {servidor, estado};
}

module.exports = {criar, hojeSp};
