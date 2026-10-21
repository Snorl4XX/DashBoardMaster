'use strict';
/**
 * JMS FALSO para os testes da Pesquisa (dados FICTÍCIOS: remessas FIC…, operadores fictícios).
 * Responde como as capturas do Rastreamento do pacote:
 *   POST /operatingplatform/podTracking/inner/query/keywordList   {keywordList, trackingTypeEnum: 'WAYBILL', countryId}
 *   POST /operatingplatform/order/getOrderDetail                  {waybillNo, countryId} — Informação básica (data.details), com o
 *        código de três segmentos (terminalDispatchCode) e dados de cliente FICTÍCIOS (que o app não pode devolver à página)
 * Opções: reject (recusa acima de N remessas), silent (vazio acima de N), trunc (só as N primeiras — trunc: 1 = como a tela do
 *   JMS, uma remessa por consulta), token (AuthToken aceito), rota (Routename exigido no keywordList), semOrder (Informação básica
 *   recusada), atraso (ms).
 */
const http = require('http');

const TOKEN = 'TOKEN-FICTICIO';
function hh(n) { return String(n).padStart(2, '0'); }
function bipes(w, i) {
  const d = [];
  d.push({billCode: w, waybillNo: w, scanTime: '2026-09-09 ' + hh((i * 7) % 24) + ':36:12', scanTypeName: 'Encomenda recebida', scanNetworkName: 'SP GRU', scanNetworkId: 2826,
    scanByName: 'RECEBEDOR FICTICIO ' + (i % 6), code: 2, originalScanTypeCode: 90, imgType: 8,
    waybillTrackingContent: 'O expresso chegou [SP GRU] A parada anterior foi [], escaneador [RECEBEDOR FICTICIO ' + (i % 6) + '], o número do pedido []'});
  d.push({billCode: w, waybillNo: w, scanTime: '2026-09-10 ' + hh((i * 5) % 24) + ':10:00', scanTypeName: 'Encomenda recebida', scanNetworkName: 'SP GRU', scanNetworkId: 2826,
    scanByName: 'SEGUNDO FICTICIO', code: 2, originalScanTypeCode: 90, imgType: 8,
    waybillTrackingContent: 'O expresso chegou [SP GRU] A parada anterior foi [MT FIC], escaneador [SEGUNDO FICTICIO], o número do pedido []'});
  if (i % 3) d.push({billCode: w, waybillNo: w, scanTime: '2026-09-09 ' + hh(14 + (i % 9)) + ':00:00', scanTypeName: 'Encomenda carregada', scanNetworkName: 'SP GRU',
    scanNetworkId: 2826, scanByName: 'CARREGADOR FICTICIO ' + (i % 4), code: 1, originalScanTypeCode: 50, nextStopName: 'MT FIC',
    waybillTrackingContent: 'A encomenda expressa está [SP GRU] sendo enviada, para [MT FIC], escaneador [CARREGADOR FICTICIO ' + (i % 4) + '], o número do pedido [FICT00' + (i % 9) + '], número do voo []'});
  if (i % 5 === 0) d.push({billCode: w, waybillNo: w, scanTime: '2026-09-11 09:07:38', scanTypeName: 'bipe de pacote problemático', scanNetworkName: 'SP GRU', scanNetworkId: 2826,
    scanByName: 'PROBLEMA FICTICIO', code: 110, imgType: 3,
    waybillTrackingContent: '[SP GRU] A verificação do problema foi realizada, o escaneador é [FIC01-PROBLEMA FICTICIO], a causa do problema [Erro.de.triagem]'});
  return d.sort((a, b) => (a.scanTime < b.scanTime ? 1 : -1));
}
/** Código de três segmentos fictício da remessa i ("XA,101-01,900": 1º segmento, dois segmentos e o 3º). */
function segmento(i) { return ['XA,101-01,900', 'XB,202-02,', 'XC - SP,303-03,901'][i % 3]; }
function remessas(n) { const out = {}; for (let i = 0; i < n; i++) out['FIC' + String(i).padStart(9, '0')] = i; return out; }

function criar(opts) {
  opts = opts || {};
  const conhecidas = remessas(opts.quantas || 3000), estado = {chamadas: []};
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), rota = url.pathname;
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { /* GET */ }
      estado.chamadas.push({rota: rota.split('/').pop(), n: (body.keywordList || []).length, headers: req.headers, body});
      const json = (o, code) => setTimeout(() => { res.writeHead(code || 200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(o)); }, opts.atraso || 0);
      if ((req.headers.authtoken || '') !== (opts.token || TOKEN)) { json({code: 401, msg: 'token失效，请重新登录', fail: true}); return; }
      if (/keywordList$/.test(rota)) {
        const kws = body.keywordList || [];
        if (body.trackingTypeEnum !== 'WAYBILL') { json({code: 500, msg: 'parâmetro inválido', fail: true}); return; }
        if (opts.rota && req.headers.routename !== opts.rota) { json({code: 500, msg: 'rota inválida', fail: true}); return; }
        if (opts.reject && kws.length > opts.reject) { json({code: 500, msg: 'máximo ' + opts.reject, fail: true}); return; }
        if (opts.silent && kws.length > opts.silent) { json({code: 1, msg: 'ok', succ: true, data: []}); return; }
        const take = opts.trunc ? kws.slice(0, opts.trunc) : kws;
        json({code: 1, msg: '1:Solicitação concluída', succ: true, fail: false,
          data: take.filter(w => conhecidas[w] !== undefined).map(w => ({keyword: w, details: bipes(w, conhecidas[w]), codes: null}))});
        return;
      }
      if (/order\/getOrderDetail$/.test(rota)) {
        if (opts.semOrder) { json({code: 500, msg: 'consulta não permitida', fail: true}); return; }
        if (conhecidas[body.waybillNo] === undefined) { json({code: 500, msg: 'pedido não encontrado', fail: true}); return; }
        json({code: 1, msg: '1:Solicitação concluída', succ: true, fail: false, data: {waybillNo: body.waybillNo, details: {id: 'FIC-ID', waybillId: body.waybillNo,
          terminalDispatchCode: segmento(conhecidas[body.waybillNo]), receiverName: 'CLIENTE FICTICIO', receiverMobile: '00000000000', senderName: 'LOJA FICTICIA'}}});
        return;
      }
      json({code: 404, msg: 'rota desconhecida', fail: true}, 404);
    });
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({server, porta: server.address().port, estado, fechar: () => new Promise(f => server.close(f))})));
}

module.exports = {criar, bipes, remessas, segmento, TOKEN};
