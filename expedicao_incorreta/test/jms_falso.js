'use strict';
/**
 * JMS de mentira para os testes (tudo fictício): viagens troncais e secundárias, registros de carga e descarga e as listas de
 * pacotes, com as mesmas respostas das capturas ({code: 1, data: {records, total, pages}}).
 *   - Viagens com Status (shipmentState) 4 = Concluído, 3 = Em Trânsito, 1 = carregando e 5 = cancelada.
 *   - O dia principal tem várias viagens; os outros dias, uma viagem troncal concluída com 2 pacotes.
 *   - Informação básica (getOrderDetail): o "3 Segmentos" vem da Base Destino do pacote (SEGMENTOS_FALSOS); base sem
 *     código → terminalDispatchCode null.
 *   - AuthToken errado → "token失效，请重新登录".
 *   - A troncal só aceita o cabeçalho Routename "tmsShipment" (o app tem de descobrir).
 *   - A secundária recusa "loading/scan/page" e responde em "unloading/scan/page" (como a captura).
 *   - O JMS limita a página a 50 itens, mesmo pedindo mais.
 */
const http = require('http');

const BASE = '30001';
/** Base Destino → "3 Segmentos" e centro de destino que o JMS de mentira devolve. */
const SEGMENTOS_FALSOS = {
  'BASE NORTE A-XX': ['NO,901-00,100', 'XX NORTE'], 'BASE NORTE B-XX': ['NO,901-01,101', 'XX NORTE'], 'BASE SUL A-YY': ['SU,902-00,200', 'YY SUL'],
  'BASE LOCAL A-ZZ': ['LOC,903-01,300', 'ZZ LOCAL'], 'BASE LOCAL B-ZZ': ['LOC,903-02,301', 'ZZ LOCAL'], 'BASE SEMCOD-WW': ['WW,904-00,400', 'WW SEMCOD'],
  'BASE FORA-XX': [null, '']
};
function pac(id, i, baseDestino, proxima, hora, extra) {
  // Remessa única por viagem (como no JMS): troncal começa com 7000, secundária com 7090.
  return Object.assign({billCode: '70' + (id[0] === 'S' ? '9' : '0') + '0' + String(id).replace(/\D/g, '').slice(-4) + String(i).padStart(5, '0'), networkName: 'SP GRU', networkCode: BASE,
    nextStation: proxima, packageCode: 'LT-' + id.slice(-2) + '-' + (i % 3), scanTime: hora, scanType: '1', scanUser: 'OPERADOR ' + (i % 2 ? 'UM' : 'DOIS'),
    total: '0', destsite: baseDestino, destsiteCity: 'Cidade Teste', deliveryOutNetworkCode: null, outNetworkCode: null}, extra || {});
}

function dados(dia) {
  const d = h => dia + ' ' + h;
  const t1 = [];
  for (let i = 0; i < 3; i++) t1.push(pac('DKTESTE0001', i, 'BASE NORTE A-XX', 'XX NORTE', d('07:1' + i + ':00')));
  t1.push(pac('DKTESTE0001', 3, 'BASE SUL A-YY', 'XX NORTE', d('15:00:00'), {packageCode: 'LT-ERRO'}));
  t1.push(pac('DKTESTE0001', 4, 'BASE SUL A-YY', 'XX NORTE', d('15:30:00'), {packageCode: 'LT-ERRO'}));
  t1.push(pac('DKTESTE0001', 5, 'BASE SEMCOD-WW', 'XX NORTE', d('23:00:00')));
  t1.push(pac('DKTESTE0001', 6, 'BASE FORA-XX', 'XX NORTE', d('23:10:00')));
  const t2 = [];
  for (let i = 0; i < 120; i++) t2.push(pac('DKTESTE0002', i, 'BASE SUL A-YY', 'YY SUL', d('10:' + String(i % 60).padStart(2, '0') + ':00')));
  t2.push(pac('DKTESTE0002', 120, 'BASE NORTE B-XX', 'YY SUL', d('02:00:00'), {packageCode: null})); // fora de saca: VOLUMOSO
  const s1 = [pac('SRTESTE0001', 0, 'BASE LOCAL A-ZZ', 'BASE LOCAL A-ZZ', d('05:00:00')), pac('SRTESTE0001', 1, 'BASE LOCAL A-ZZ', 'BASE LOCAL A-ZZ', d('05:01:00')),
    pac('SRTESTE0001', 2, 'BASE LOCAL B-ZZ', 'BASE LOCAL A-ZZ', d('05:02:00')), pac('SRTESTE0001', 3, 'BASE NORTE A-XX', 'BASE LOCAL A-ZZ', d('14:30:00'))];
  const s2 = [pac('SRTESTE0002', 0, 'BASE LOCAL B-ZZ', 'ROTA NOVA-ZZ', d('09:00:00'))];
  const t6 = [pac('DKTESTE0006', 0, 'BASE SUL A-YY', 'YY SUL', d('08:00:00')), pac('DKTESTE0006', 1, 'BASE SUL A-YY', 'YY SUL', d('08:01:00'))];
  // Carregando (status 1) e cancelada (status 5): têm pacotes errados, mas não entram no painel nem são consultadas.
  const t5 = [pac('DKTESTE0005', 0, 'BASE SUL A-YY', 'XX NORTE', d('09:00:00'))];
  const s3 = [pac('SRTESTE0003', 0, 'BASE NORTE A-XX', 'BASE LOCAL A-ZZ', d('09:00:00'))];
  return {
    troncal: {
      viagens: [viagem(dia, 'DKTESTE0001', BASE, 'XX NORTE', '111', 3), viagem(dia, 'DKTESTE0002', BASE, 'YY SUL', '222', 3),
        viagem(dia, 'DKOUTRA0003', '99999', 'XX NORTE', '111', 4), viagem(dia, 'DKTESTE0004', BASE, 'XX NORTE', '111', 4),
        viagem(dia, 'DKTESTE0005', BASE, 'XX NORTE', '111', 1), viagem(dia, 'DKTESTE0006', BASE, 'YY SUL', '222', 4)],
      pacotes: {DKTESTE0001: t1, DKTESTE0002: t2, DKTESTE0004: [], DKTESTE0005: t5, DKTESTE0006: t6},
      registros: {DKTESTE0004: [{jobCode: 'DKTESTE0004', loadingTypeName: '2', scanNetworkCode: '111', scanNetworkName: 'XX NORTE', scanWaybillNum: 9}]}
    },
    secundaria: {
      viagens: [viagem(dia, 'SRTESTE0001', BASE, 'BASE LOCAL A-ZZ', '777001', 4), viagem(dia, 'SRTESTE0002', BASE, 'ROTA NOVA-ZZ', '777002', 4),
        viagem(dia, 'SRTESTE0003', BASE, 'BASE LOCAL A-ZZ', '777001', 5)],
      pacotes: {SRTESTE0001: s1, SRTESTE0002: s2, SRTESTE0003: s3},
      registros: {}
    }
  };
}
function viagem(dia, id, start, endName, endCode, status) {
  return {id: 'id' + id, shipmentNo: id, shipmentName: 'GRU-' + endName + '-0600-1', startCode: start, startName: start === BASE ? 'SP GRU' : 'OUTRA BASE',
    endName, endCode, plannedDepartureTime: dia + ' 06:00:00', actualDepartureTime: dia + ' 06:05:00',
    actualArrivalTime: status === 4 ? dia + ' 12:00:00' : null, shipmentState: status, plateNumber: 'TST0A00', carrierName: 'TRANSPORTADORA TESTE'};
}
/** Outro dia: uma viagem troncal concluída (1 pacote certo e 1 errado). */
function outroDia(dia) {
  const id = 'DK' + dia.replace(/-/g, '');
  return {
    troncal: {viagens: [viagem(dia, id, BASE, 'XX NORTE', '111', 4)],
      pacotes: {[id]: [pac(id, 0, 'BASE NORTE A-XX', 'XX NORTE', dia + ' 07:00:00'), pac(id, 1, 'BASE SUL A-YY', 'XX NORTE', dia + ' 07:05:00')]}, registros: {}},
    secundaria: {viagens: [], pacotes: {}, registros: {}}
  };
}

function criar(dia) {
  const estado = {token: 'TOKEN-FICTICIO-DE-TESTE', dados: dados(dia), outros: {}, pedidos: {}, registrosPedidos: {}, diasPedidos: [],
    segmentosPedidos: {}, recusarSegmentos: false, exigeRotaTroncal: 'tmsShipment', recusarLoadingSecundaria: true};
  /** O pacote (de qualquer dia já pedido) com esta remessa. */
  const pacoteDe = w => {
    for (const dd of [estado.dados].concat(Object.values(estado.outros))) {
      for (const tipo of ['troncal', 'secundaria']) for (const lista of Object.values(dd[tipo].pacotes)) { const x = lista.find(p => p.billCode === w); if (x) return x; }
    }
    return null;
  };
  const doDia = d => d === dia ? estado.dados : (estado.outros[d] = estado.outros[d] || outroDia(d));
  // Viagem de qualquer dia já pedido (os registros e pacotes vêm só pelo ID).
  const daViagem = (tipo, id) => [estado.dados].concat(Object.values(estado.outros)).find(x => x[tipo].viagens.some(v => v.shipmentNo === id)) || estado.dados;
  const conta = k => { estado.pedidos[k] = (estado.pedidos[k] || 0) + 1; };
  const registrosDe = (tipo, id) => {
    estado.registrosPedidos[id] = (estado.registrosPedidos[id] || 0) + 1;
    const dd = daViagem(tipo, id), r = dd[tipo].registros[id];
    if (r) return r;
    const n = (dd[tipo].pacotes[id] || []).length;
    const v = dd[tipo].viagens.find(x => x.shipmentNo === id) || {};
    return [{jobCode: id, loadingTypeName: '1', scanNetworkCode: BASE, scanNetworkName: 'SP GRU', scanWaybillNum: n, scanWaybillSingleNum: n},
      {jobCode: id, loadingTypeName: '2', scanNetworkCode: v.endCode, scanNetworkName: v.endName, scanWaybillNum: n}];
  };
  const pagina = (lista, q) => {
    const size = Math.min(50, Number(q.get('size')) || 20), current = Number(q.get('current')) || 1;
    return {code: 1, msg: '请求成功', data: {records: lista.slice((current - 1) * size, current * size), total: lista.length, size, current,
      pages: Math.ceil(lista.length / size)}, succ: true, fail: false};
  };
  const servidor = http.createServer((req, res) => {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), q = u.searchParams, p = u.pathname;
      const resp = (obj, st) => { res.writeHead(st || 200, {'Content-Type': 'application/json;charset=UTF-8'}); res.end(JSON.stringify(obj)); };
      conta(p);
      if (req.headers.authtoken !== estado.token) return resp({code: 135010036, msg: 'token失效，请重新登录', succ: false, fail: true});
      if (/^\/transportation\/(tmsShipment|trackingDeatil)\//.test(p) && estado.exigeRotaTroncal && req.headers.routename !== estado.exigeRotaTroncal) {
        return resp({code: 10403, msg: 'Sem permissão para este menu', succ: false, fail: true});
      }
      if (p === '/transportation/tmsShipment/page') {
        if (!/^\d{4}-\d{2}-\d{2} 00:00:00$/.test(q.get('startDateTime') || '')) return resp({code: 0, msg: 'data inválida'});
        const d = q.get('startDateTime').slice(0, 10);
        if (Number(q.get('current')) === 1) estado.diasPedidos.push(d);
        const lista = doDia(d).troncal.viagens.filter(v => !q.get('startCode') || v.startCode === q.get('startCode') || v.shipmentNo === 'DKOUTRA0003');
        return resp(pagina(lista, q));
      }
      if (p === '/transportation/tmsBranchTrackingDetail/page' && req.method === 'POST') {
        const b = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
        const lista = doDia(String(b.startDepartureTime || '').slice(0, 10)).secundaria.viagens.filter(v => !b.startCode || v.startCode === b.startCode);
        return resp(pagina(lista, new URLSearchParams({size: b.size, current: b.current})));
      }
      if (p === '/operatingplatform/order/getOrderDetail' && req.method === 'POST') {
        const w = String(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}').waybillNo || '');
        estado.segmentosPedidos[w] = (estado.segmentosPedidos[w] || 0) + 1;
        if (estado.recusarSegmentos) return resp({code: 135010099, msg: 'Sem permissão para Rastreamento do pacote', succ: false, fail: true});
        const x = pacoteDe(w), sg = x && SEGMENTOS_FALSOS[x.destsite] || [null, ''];
        return resp({code: 1, msg: '1:Solicitação concluída', succ: true, fail: false,
          data: {waybillNo: w, details: {waybillNo: w, terminalDispatchCode: sg[0], destinationDistributeName: sg[1], receiverCityName: 'Cidade Teste'}}});
      }
      const m = /^\/transportation\/(trackingDeatil|tmsBranchTrackingDetail)\/(loading|unloading)\/scan\/(list|page)$/.exec(p);
      if (m) {
        const tipo = m[1] === 'trackingDeatil' ? 'troncal' : 'secundaria', id = q.get('shipmentNo');
        if (m[3] === 'list') return resp({code: 1, msg: '请求成功', data: registrosDe(tipo, id), succ: true, fail: false});
        if (tipo === 'secundaria' && m[2] === 'loading' && estado.recusarLoadingSecundaria) return resp({code: 404, msg: 'Not Found'}, 404);
        if (tipo === 'troncal' && m[2] !== 'loading') return resp({code: 404, msg: 'Not Found'}, 404);
        const dd = daViagem(tipo, id);
        const esperado = tipo === 'troncal' || m[2] === 'loading' ? BASE : (dd.secundaria.viagens.find(v => v.shipmentNo === id) || {}).endCode;
        if (q.get('scanNetworkCode') !== esperado) return resp(pagina([], q));
        return resp(pagina(dd[tipo].pacotes[id] || [], q));
      }
      resp({code: 404, msg: 'Not Found'}, 404);
    });
  });
  return {servidor, estado};
}

module.exports = {criar, pac, SEGMENTOS_FALSOS};
