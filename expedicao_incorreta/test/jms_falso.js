'use strict';
/**
 * JMS de mentira para os testes (tudo fictício): viagens troncais e secundárias, registros de carga e descarga e as listas de
 * pacotes, com as mesmas respostas das capturas ({code: 1, data: {records, total, pages}}).
 *   - AuthToken errado → "token失效，请重新登录".
 *   - A troncal só aceita o cabeçalho Routename "tmsShipment" (o app tem de descobrir).
 *   - A secundária recusa "loading/scan/page" e responde em "unloading/scan/page" (como a captura).
 *   - O JMS limita a página a 50 itens, mesmo pedindo mais.
 */
const http = require('http');

const BASE = '30001';
function pac(id, i, baseDestino, proxima, hora, extra) {
  return Object.assign({billCode: '7000' + String(id).replace(/\D/g, '').slice(-4) + String(i).padStart(5, '0'), networkName: 'SP GRU', networkCode: BASE,
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
  t2.push(pac('DKTESTE0002', 120, 'BASE NORTE B-XX', 'YY SUL', d('02:00:00')));
  const s1 = [pac('SRTESTE0001', 0, 'BASE LOCAL A-ZZ', 'BASE LOCAL A-ZZ', d('05:00:00')), pac('SRTESTE0001', 1, 'BASE LOCAL A-ZZ', 'BASE LOCAL A-ZZ', d('05:01:00')),
    pac('SRTESTE0001', 2, 'BASE LOCAL B-ZZ', 'BASE LOCAL A-ZZ', d('05:02:00')), pac('SRTESTE0001', 3, 'BASE NORTE A-XX', 'BASE LOCAL A-ZZ', d('14:30:00'))];
  const s2 = [pac('SRTESTE0002', 0, 'BASE LOCAL B-ZZ', 'ROTA NOVA-ZZ', d('09:00:00'))];
  const viagem = (id, start, endName, endCode) => ({id: 'id' + id, shipmentNo: id, shipmentName: 'GRU-' + endName + '-0600-1', startCode: start,
    startName: start === BASE ? 'SP GRU' : 'OUTRA BASE', endName, endCode, plannedDepartureTime: d('06:00:00'), actualDepartureTime: d('06:05:00'),
    shipmentState: 4, plateNumber: 'TST0A00', carrierName: 'TRANSPORTADORA TESTE'});
  return {
    troncal: {
      viagens: [viagem('DKTESTE0001', BASE, 'XX NORTE', '111'), viagem('DKTESTE0002', BASE, 'YY SUL', '222'),
        viagem('DKOUTRA0003', '99999', 'XX NORTE', '111'), viagem('DKTESTE0004', BASE, 'XX NORTE', '111')],
      pacotes: {DKTESTE0001: t1, DKTESTE0002: t2, DKTESTE0004: []},
      registros: {DKTESTE0004: [{jobCode: 'DKTESTE0004', loadingTypeName: '2', scanNetworkCode: '111', scanNetworkName: 'XX NORTE', scanWaybillNum: 9}]}
    },
    secundaria: {
      viagens: [viagem('SRTESTE0001', BASE, 'BASE LOCAL A-ZZ', '777001'), viagem('SRTESTE0002', BASE, 'ROTA NOVA-ZZ', '777002')],
      pacotes: {SRTESTE0001: s1, SRTESTE0002: s2},
      registros: {}
    }
  };
}

function criar(dia) {
  const estado = {token: 'TOKEN-FICTICIO-DE-TESTE', dados: dados(dia), pedidos: {}, exigeRotaTroncal: 'tmsShipment', recusarLoadingSecundaria: true};
  const conta = k => { estado.pedidos[k] = (estado.pedidos[k] || 0) + 1; };
  const registrosDe = (tipo, id) => {
    const r = estado.dados[tipo].registros[id];
    if (r) return r;
    const n = (estado.dados[tipo].pacotes[id] || []).length;
    const v = estado.dados[tipo].viagens.find(x => x.shipmentNo === id) || {};
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
        const lista = estado.dados.troncal.viagens.filter(v => !q.get('startCode') || v.startCode === q.get('startCode') || v.shipmentNo === 'DKOUTRA0003');
        if (!/^\d{4}-\d{2}-\d{2} 00:00:00$/.test(q.get('startDateTime') || '')) return resp({code: 0, msg: 'data inválida'});
        return resp(pagina(lista, q));
      }
      if (p === '/transportation/tmsBranchTrackingDetail/page' && req.method === 'POST') {
        const b = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
        const lista = estado.dados.secundaria.viagens.filter(v => !b.startCode || v.startCode === b.startCode);
        return resp(pagina(lista, new URLSearchParams({size: b.size, current: b.current})));
      }
      const m = /^\/transportation\/(trackingDeatil|tmsBranchTrackingDetail)\/(loading|unloading)\/scan\/(list|page)$/.exec(p);
      if (m) {
        const tipo = m[1] === 'trackingDeatil' ? 'troncal' : 'secundaria', id = q.get('shipmentNo');
        if (m[3] === 'list') return resp({code: 1, msg: '请求成功', data: registrosDe(tipo, id), succ: true, fail: false});
        if (tipo === 'secundaria' && m[2] === 'loading' && estado.recusarLoadingSecundaria) return resp({code: 404, msg: 'Not Found'}, 404);
        if (tipo === 'troncal' && m[2] !== 'loading') return resp({code: 404, msg: 'Not Found'}, 404);
        const esperado = tipo === 'troncal' || m[2] === 'loading' ? BASE : (estado.dados.secundaria.viagens.find(v => v.shipmentNo === id) || {}).endCode;
        if (q.get('scanNetworkCode') !== esperado) return resp(pagina([], q));
        return resp(pagina(estado.dados[tipo].pacotes[id] || [], q));
      }
      resp({code: 404, msg: 'Not Found'}, 404);
    });
  });
  return {servidor, estado};
}

module.exports = {criar, pac};
