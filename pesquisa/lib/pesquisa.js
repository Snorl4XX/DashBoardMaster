/**
 * J&T · PESQUISA NO RASTREAMENTO — a pesquisa em si, na página (o servidor só consulta o JMS com o token dele).
 *
 * `api` (o servidor, Apps Script ou Node.js):
 *   api.consultar(pedidos, {paralelo}) → Promise<[{status, text}]>, na mesma ordem. pedidos = [{url, body, headers}]: Rastreamento
 *     do pacote (keywordList) e Informação básica (getOrderDetail). O servidor põe o AuthToken, faz `paralelo` consultas AO MESMO
 *     TEMPO e devolve só os campos que a pesquisa usa.
 *
 * buscarBipes: o JMS responde UMA remessa por consulta ao Rastreamento, e cada remessa ainda tem a Informação básica (segmentos):
 * são 2 consultas por remessa. Para não esperar, a página mantém 4 chamadas ao servidor ao mesmo tempo, cada uma com 200
 * remessas (até 400 consultas), e cada chamada faz de 10 a 40 consultas ao JMS ao mesmo tempo. Quando uma chamada volta, a
 * próxima sai na hora (não espera as outras) — no Apps Script, cada pacote do fetchAll espera a consulta mais lenta dele, então
 * pacotes menores em várias chamadas andam bem mais rápido que um pacote grande.
 *   - Só as primeiras vieram (a tela do JMS consulta uma remessa por vez): o resto volta em grupos desse tamanho e o limite é
 *     aprendido.
 *   - Recusa com várias remessas: o limite cai pela metade (aprendido) e o grupo volta em duas metades.
 *   - Vazio maior que todas as consultas que já responderam: o grupo volta em duas metades (pode ser o limite); se a metade
 *     responder, o limite era esse. Vazio do tamanho das que responderam (ou pequeno): as remessas não existem no JMS.
 *   - Recusa na 1ª vez: testa uma vez os cabeçalhos de rota do DashMaster antes de concluir que é o tamanho.
 *   - Falha passageira (rede, 429, 5xx, tempo do Google): a consulta volta para a fila (até 5 vezes).
 *   - Ritmo: cada chamada começa com 10 consultas ao mesmo tempo e sobe até 40 enquanto o JMS responde sem falhas. Se o JMS pedir
 *     para ir mais devagar (ou recusar/falhar muito), cai pela metade e a chamada espera um pouco.
 *   - Uma remessa sozinha recusada (o JMS sobrecarregado): de novo, até 3 vezes, antes de marcar "consulta recusada".
 *   - Conferência no fim: as remessas que voltaram vazias ou recusadas são consultadas de novo, devagar (o JMS sobrecarregado às
 *     vezes responde vazio). Se muitas aparecerem nessa conferência, o ritmo guardado cai pela metade.
 */
(function (root, factory) {
  var api = factory(root.Rastreio || (typeof require === 'function' ? require('./rastreio.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pesquisa = api;
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  // As mesmas variantes do DashMaster para o Rastreamento do pacote (JmsApi.gs, rota TRACKING).
  var ROUTE_VARIANTS = [{routename: 'trackingExpress'}, {routename: 'waybillTracking'}, {routename: 'packageTracking'}];
  var POR_CHAMADA = 200, CHAMADAS = 4, TENTATIVAS = 5, RECUSAS = 3, PARALELO = 10, PARALELO_MAX = 40, PARALELO_MIN = 3, REVISAO = {chamadas: 2, paralelo: 10};
  function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /** Erro da chamada ao servidor (não do JMS): sem token, sem autorização ou arquivo antigo param a pesquisa. */
  function erroServidor(e) {
    var m = String(e && e.message || e), err = new Error(m.slice(0, 400));
    err.kind = /AuthToken|autoriz|não permitido|antigo/i.test(m) ? 'auth' : 'server';
    return err;
  }
  /** Uma chamada ao servidor com várias consultas; 1 nova tentativa se a chamada inteira falhar por um motivo passageiro. */
  function consultar(api, pedidos, espera, paralelo) {
    var vez = function (n) {
      return Promise.resolve().then(function () { return api.consultar(pedidos, {paralelo: paralelo || PARALELO}); }).then(function (resps) {
        if (!Array.isArray(resps) || resps.length !== pedidos.length) throw new Error('Resposta incompleta do servidor do app.');
        return resps;
      }).catch(function (e) {
        var err = erroServidor(e);
        if (err.kind === 'server' && n < 1) return wait(espera === undefined ? 2000 : espera).then(function () { return vez(n + 1); });
        throw err;
      });
    };
    return vez(0);
  }
  function ler(r) { return R.parseJms(r && r.status, r && r.text); }

  /**
   * Bipes e segmentos de cada remessa. o: {lote (remessas por consulta, aprendido), porChamada (200), chamadas (6 ao mesmo tempo),
   * minProbe, pais, headers, segmentos (false = sem a Informação básica), paralelo (consultas ao JMS ao mesmo tempo em cada chamada,
   * ajustado sozinho), espera, onLote(n, motivo), onHeaders(h), onParalelo(n), onProgresso(feitas, total), parar()}.
   * → {map: remessa → bipes ([] = sem rastreamento; null = recusada), segs: remessa → {s1, s2} | null, erro, lote, headers,
   *    paralelo, consultas (quantas consultas ao JMS)}
   * Remessas fora do map: a pesquisa parou antes (parar()).
   */
  function buscarBipes(api, list, o) {
    o = o || {};
    var estado = {headers: o.headers || null, paralelo: Math.max(PARALELO_MIN, Math.min(PARALELO_MAX, Math.floor(o.paralelo || PARALELO)))};
    var lote = Math.max(1, Math.floor(o.lote || 100)), porChamada = Math.max(1, o.porChamada || POR_CHAMADA), minProbe = o.minProbe || 8;
    var nChamadas = Math.max(1, Math.floor(o.chamadas || CHAMADAS));
    var map = {}, segs = {}, segFila = [], segTent = {}, fila = [], provado = 0, erro = '', erroSeg = '', testouRota = !!o.headers;
    var sondando = false, consultas = 0, revisando = false;
    var comSeg = o.segmentos !== false;
    for (var i = 0; i < list.length; i += lote) fila.push({list: list.slice(i, i + lote)});
    if (comSeg) segFila = list.slice();
    var metades = function (g, vazio) {
      var h = Math.ceil(g.list.length / 2);
      fila.push({list: g.list.slice(0, h), vazio: vazio}, {list: g.list.slice(h), vazio: vazio});
    };
    var aprender = function (n, motivo) {
      n = Math.max(1, Math.floor(n));
      if (n >= lote) return;
      lote = n;
      if (o.onLote) o.onLote(n, motivo);
      fila.splice(0).forEach(function (g) { for (var j = 0; j < g.list.length; j += lote) fila.push({list: g.list.slice(j, j + lote), vazio: g.vazio}); });
    };
    var pedido = function (g) { return {url: R.KEYWORD_URL, body: R.keywordPayload(g.list, o.pais), headers: estado.headers || {}}; };

    /** Resposta boa de um grupo. Devolve quantas remessas vieram quando foram só as primeiras (0 = não). */
    var aceitar = function (g, json, rodada) {
      var got = {};
      R.recordsOf(json).forEach(function (item) {
        var kw = String(item && (item.keyword || item.waybillNo || item.billCode) || '').trim().toUpperCase();
        if (kw) got[kw] = Array.isArray(item.details) ? item.details : [];
      });
      var n = g.list.length, comDados = g.list.filter(function (w) { return got[w] && got[w].length; }).length;
      var nGot = g.list.filter(function (w) { return got[w] !== undefined; }).length;
      if (!comDados) {
        if (n >= minProbe && n > provado) { metades(g, true); return; }
        g.list.forEach(function (w) { map[w] = got[w] || []; });
        return;
      }
      provado = Math.max(provado, nGot);
      // A metade respondeu e o grupo inteiro tinha voltado vazio: o JMS aceita no máximo esse tanto por consulta.
      if (g.vazio && n < lote) aprender(n, 'consulta com ' + (n * 2) + ' remessas voltou vazia e com ' + n + ' respondeu');
      var volta = g.list.filter(function (w) { return got[w] === undefined; });
      g.list.forEach(function (w) { if (got[w] !== undefined) map[w] = got[w]; });
      if (!volta.length) { rodada.completo = Math.max(rodada.completo, n); return; }
      // Só as primeiras vieram: o resto volta em grupos desse tamanho.
      var prefixo = g.list.slice(0, nGot).every(function (w) { return got[w] !== undefined; });
      if (prefixo) {
        rodada.prefixos.push(nGot);
        for (var j = 0; j < volta.length; j += nGot) fila.push({list: volta.slice(j, j + nGot)});
      } else fila.push({list: volta});
    };
    var recusar = function (g, e) {
      erro = e.message;
      if (g.list.length > 1) { aprender(Math.ceil(g.list.length / 2), 'o JMS recusou ' + g.list.length + ' remessas numa consulta'); metades(g, false); }
      else map[g.list[0]] = null;
    };
    /** Uma vez: os cabeçalhos de rota do DashMaster, um de cada vez, com um grupo recusado. → o cabeçalho que funcionou ou null. */
    var testarRotas = function (g) {
      testouRota = true;
      sondando = true;
      var v = 0;
      var proxima = function () {
        if (v >= ROUTE_VARIANTS.length) return null;
        var h = ROUTE_VARIANTS[v++];
        return consultar(api, [{url: R.KEYWORD_URL, body: R.keywordPayload(g.list, o.pais), headers: h}], o.espera, 1).then(function (r) {
          var json;
          try { json = ler(r[0]); } catch (e) { return e.kind === 'temp' ? null : proxima(); }
          estado.headers = h;
          if (o.onHeaders) o.onHeaders(h);
          return {h: h, json: json};
        });
      };
      return Promise.resolve(proxima()).then(function (r) { sondando = false; return r; }, function (e) { sondando = false; throw e; });
    };

    var feitas = function () { return Object.keys(map).length; };
    /** Uma chamada ao servidor com até `porChamada` remessas (rastreamento + Informação básica). null = nada para mandar. */
    var chamada = function () {
      var grupos = [], n = 0;
      while (fila.length && n < porChamada) { var g = fila.shift(); g.h = estado.headers; grupos.push(g); n += g.list.length; }
      // Informação básica: das remessas desta chamada (ou do que falta, quando o rastreamento já acabou).
      var segList = [];
      if (comSeg) {
        var nesta = {};
        grupos.forEach(function (x) { x.list.forEach(function (w) { nesta[w] = 1; }); });
        segFila = segFila.filter(function (w) { if ((nesta[w] || !grupos.length) && segList.length < porChamada) { segList.push(w); return false; } return true; });
      }
      if (!grupos.length && !segList.length) return null;
      var pedidos = grupos.map(pedido).concat(segList.map(function (w) { return {url: R.ORDER_URL, body: R.orderPayload(w, o.pais), headers: estado.headers || {}}; }));
      var passageiras = 0, devagar = false;
      // Falha passageira ou recusa: sinal de que o JMS não está dando conta (o ritmo cai).
      var anota = function (e) { if (e.kind === 'temp' || e.kind === 'refused') passageiras++; if (e.limite) devagar = true; };
      consultas += pedidos.length;
      return consultar(api, pedidos, o.espera, estado.paralelo).then(function (resps) {
        var info = {completo: 0, prefixos: []}, recusados = [], auth = null;
        grupos.forEach(function (g, i) {
          var json;
          try { json = ler(resps[i]); }
          catch (e) {
            anota(e);
            if (e.kind === 'temp') {
              erro = e.message;
              g.tent = (g.tent || 0) + 1;
              if (g.tent < TENTATIVAS) fila.push(g); else g.list.forEach(function (w) { map[w] = null; });
              return;
            }
            // Recusada com o cabeçalho antigo, mas outra chamada já achou o cabeçalho certo: de novo, com ele.
            if (g.h !== estado.headers) { fila.push(g); return; }
            if (e.kind === 'auth') auth = auth || e;
            recusados.push({g: g, e: e});
            return;
          }
          aceitar(g, json, info);
        });
        // A Informação básica recusada não para a pesquisa: a remessa fica sem os segmentos (e a tela avisa).
        segList.forEach(function (w, i) {
          try { segs[w] = R.segmentosDe(ler(resps[grupos.length + i])); }
          catch (e) {
            anota(e);
            segTent[w] = (segTent[w] || 0) + 1;
            if (e.kind === 'temp' && segTent[w] < TENTATIVAS) segFila.push(w);
            else { segs[w] = null; erroSeg = e.message; }
          }
        });
        // O JMS devolve só as primeiras remessas de cada consulta (e nenhuma consulta maior veio inteira): esse é o limite.
        if (info.prefixos.length) {
          var k = Math.max.apply(null, info.prefixos);
          if (info.completo <= k) aprender(k, 'o JMS devolve no máximo ' + k + ' remessa(s) por consulta');
        }
        // Ritmo: mais consultas ao mesmo tempo enquanto o JMS aguenta; menos (e uma pausa) quando reclama.
        var antes = estado.paralelo, pausa = 0;
        // Poucas falhas soltas (ex.: uma remessa que o JMS sempre recusa) não derrubam o ritmo.
        if (devagar || (passageiras >= 5 && passageiras > pedidos.length * 0.05)) { estado.paralelo = Math.max(PARALELO_MIN, Math.floor(antes / 2)); pausa = o.espera === undefined ? 3000 : o.espera; }
        else if (!passageiras && !revisando) estado.paralelo = Math.min(PARALELO_MAX, Math.ceil(antes * 1.25));
        if (estado.paralelo !== antes && o.onParalelo) o.onParalelo(estado.paralelo);
        var segue = pausa ? wait(pausa) : Promise.resolve();
        if (!recusados.length) return segue;
        // Outra chamada está testando os cabeçalhos de rota: estas voltam para a fila e saem de novo com o resultado.
        if (sondando) { recusados.forEach(function (x) { fila.push(x.g); }); return segue; }
        var depois = function () {
          if (auth) throw auth;
          recusados.forEach(function (x) {
            // Uma remessa só, recusada: pode ser o JMS sobrecarregado — de novo, antes de desistir dela.
            if (x.g.list.length === 1 && (x.g.rec = (x.g.rec || 0) + 1) < RECUSAS) { erro = x.e.message; fila.push(x.g); return; }
            recusar(x.g, x.e);
          });
        };
        if (testouRota) return segue.then(depois);
        return segue.then(function () { return testarRotas(recusados[0].g); }).then(function (ok) {
          if (!ok) return depois();
          // O cabeçalho resolveu: a 1ª já respondeu; as outras voltam para a fila com ele.
          aceitar(recusados[0].g, ok.json, info);
          recusados.slice(1).forEach(function (x) { fila.unshift(x.g); });
        });
      });
    };
    // Até `limite` chamadas ao mesmo tempo: quando uma volta, a próxima sai na hora.
    var rodar = function (limite) {
      return new Promise(function (ok, ko) {
        var ativas = 0, falhou = false;
        var puxar = function () {
          if (falhou) return;
          while (ativas < limite && !(o.parar && o.parar())) {
            var p = chamada();
            if (!p) break;
            ativas++;
            p.then(function () {
              ativas--;
              if (o.onProgresso) o.onProgresso(feitas(), list.length);
              puxar();
            }, function (e) { falhou = true; ko(e); });
          }
          if (!ativas) ok();
        };
        puxar();
      });
    };
    var revistas = 0, achadasRevisao = 0;
    return rodar(nChamadas).then(function () {
      if ((o.parar && o.parar()) || o.revisar === false) return;
      // Conferência: vazias ou recusadas voltam, devagar. O JMS sobrecarregado às vezes responde vazio.
      var rever = list.filter(function (w) { return map[w] === null || (map[w] && !map[w].length); });
      if (!rever.length) return;
      revistas = rever.length;
      rever.forEach(function (w) { delete map[w]; if (comSeg && !segs[w]) { delete segs[w]; segFila.push(w); } });
      fila = rever.map(function (w) { return {list: [w]}; });
      var ritmo = estado.paralelo;
      estado.paralelo = Math.min(ritmo, REVISAO.paralelo);
      revisando = true; // na conferência o ritmo não sobe
      return rodar(REVISAO.chamadas).then(function () {
        revisando = false;
        achadasRevisao = rever.filter(function (w) { return map[w] && map[w].length; }).length;
        // Muitas apareceram só na conferência: o ritmo estava rápido demais para o JMS.
        estado.paralelo = achadasRevisao > rever.length * 0.2 ? Math.max(PARALELO_MIN, Math.floor(ritmo / 2)) : ritmo;
        if (estado.paralelo !== ritmo && o.onParalelo) o.onParalelo(estado.paralelo);
      });
    }).then(function () {
      return {map: map, segs: segs, erro: erro, erroSeg: erroSeg, lote: lote, headers: estado.headers, paralelo: estado.paralelo, consultas: consultas,
        revistas: revistas, achadasRevisao: achadasRevisao};
    });
  }

  /**
   * Pesquisa completa: bipes + primeiro bipe de cada padrão + segmentos. → {results: [{w, ok, err, seg, p: [hit|null, hit|null]}],
   * faltam, erro, erroSeg, semSeg (com rastreamento e sem os segmentos), lote} (results na ordem colada; `faltam` = remessas não
   * pesquisadas porque a pesquisa foi parada).
   */
  function pesquisar(api, list, padroes, o) {
    var match = (padroes || []).slice(0, 2).map(function (p) { return R.matcher(p); });
    if (!list.length) return Promise.reject(new Error('Cole pelo menos uma remessa.'));
    if (!match.some(Boolean)) return Promise.reject(new Error('Digite o texto padrão de pelo menos um bloco.'));
    return buscarBipes(api, list, o).then(function (b) {
      var results = [], faltam = [];
      list.forEach(function (w) {
        var d = b.map[w];
        if (d === undefined) { faltam.push(w); return; }
        var r = {w: w, ok: !!(d && d.length), seg: b.segs[w] || null, p: match.map(function (m) { return m && d ? R.hit(d, m) : null; })};
        if (d === null) r.err = true;
        results.push(r);
      });
      return {results: results, faltam: faltam, erro: b.erro, erroSeg: b.erroSeg, consultas: b.consultas, revistas: b.revistas, achadasRevisao: b.achadasRevisao,
        recusadas: results.filter(function (r) { return r.err; }).length,
        semSeg: o && o.segmentos === false ? 0 : results.filter(function (r) { return r.ok && !r.seg; }).length, lote: b.lote, headers: b.headers, paralelo: b.paralelo};
    });
  }

  /**
   * V1.7 — só os códigos de segmento (Informação básica, getOrderDetail): uma consulta por remessa, com o mesmo motor da pesquisa
   * (várias chamadas ao mesmo tempo, ritmo que se ajusta, falha passageira volta para a fila, recusa tentada de novo). Nenhuma
   * falha para a pesquisa inteira (só o AuthToken recusado). No fim, as que vieram sem código ou recusadas são conferidas de novo,
   * devagar: o JMS ocupado às vezes responde sem os dados.
   * o: {porChamada, chamadas, paralelo, pais, headers, espera, revisar (false = sem conferência), onParalelo(n), onProgresso(feitas,
   * total), parar()}.
   * → {segs: remessa → {s1, s2} (com código) | {s1: '', s2: '', sem: true} (o JMS respondeu sem código) | null (recusada), erro,
   *    consultas, revistas, achadasRevisao, paralelo}. Remessas fora de segs: a pesquisa parou antes.
   */
  function buscarSegmentos(api, list, o) {
    o = o || {};
    var estado = {paralelo: Math.max(PARALELO_MIN, Math.min(PARALELO_MAX, Math.floor(o.paralelo || PARALELO)))};
    var porChamada = Math.max(1, o.porChamada || POR_CHAMADA), nChamadas = Math.max(1, Math.floor(o.chamadas || CHAMADAS));
    var segs = {}, fila = list.slice(), tent = {}, rec = {}, erro = '', consultas = 0, revisando = false;
    var pedido = function (w) { return {url: R.ORDER_URL, body: R.orderPayload(w, o.pais), headers: o.headers || {}}; };
    var feitas = function () { return Object.keys(segs).length; };
    var chamada = function () {
      var lote = fila.splice(0, porChamada);
      if (!lote.length) return null;
      var passageiras = 0, devagar = false, auth = null;
      consultas += lote.length;
      return consultar(api, lote.map(pedido), o.espera, estado.paralelo).then(function (resps) {
        lote.forEach(function (w, i) {
          var json;
          try { json = ler(resps[i]); }
          catch (e) {
            if (e.kind === 'auth') { auth = auth || e; fila.push(w); return; }
            if (e.kind === 'temp' || e.kind === 'refused') passageiras++;
            if (e.limite) devagar = true;
            erro = e.message;
            // Falha passageira: de novo (até TENTATIVAS); recusa: de novo (até RECUSAS) — o JMS sobrecarregado também recusa.
            if (e.kind === 'temp' ? (tent[w] = (tent[w] || 0) + 1) < TENTATIVAS : (rec[w] = (rec[w] || 0) + 1) < RECUSAS) fila.push(w);
            else segs[w] = null;
            return;
          }
          var s = R.segmentosDe(json);
          segs[w] = s.s1 || s.s2 ? s : {s1: '', s2: '', sem: true};
        });
        if (auth) throw auth;
        var antes = estado.paralelo, pausa = 0;
        if (devagar || (passageiras >= 5 && passageiras > lote.length * 0.05)) { estado.paralelo = Math.max(PARALELO_MIN, Math.floor(antes / 2)); pausa = o.espera === undefined ? 3000 : o.espera; }
        else if (!passageiras && !revisando) estado.paralelo = Math.min(PARALELO_MAX, Math.ceil(antes * 1.25));
        if (estado.paralelo !== antes && o.onParalelo) o.onParalelo(estado.paralelo);
        return pausa ? wait(pausa) : null;
      });
    };
    var rodar = function (limite) {
      return new Promise(function (ok, ko) {
        var ativas = 0, falhou = false;
        var puxar = function () {
          if (falhou) return;
          while (ativas < limite && !(o.parar && o.parar())) {
            var p = chamada();
            if (!p) break;
            ativas++;
            p.then(function () { ativas--; if (o.onProgresso) o.onProgresso(feitas(), list.length); puxar(); }, function (e) { falhou = true; ko(e); });
          }
          if (!ativas) ok();
        };
        puxar();
      });
    };
    var revistas = 0, achadasRevisao = 0;
    return rodar(nChamadas).then(function () {
      if ((o.parar && o.parar()) || o.revisar === false) return;
      // Conferência: sem código ou recusadas voltam, devagar.
      var rever = list.filter(function (w) { return segs[w] === null || (segs[w] && segs[w].sem); });
      if (!rever.length) return;
      revistas = rever.length;
      rever.forEach(function (w) { delete segs[w]; tent[w] = 0; rec[w] = 0; });
      fila = rever.slice();
      var ritmo = estado.paralelo;
      estado.paralelo = Math.min(ritmo, REVISAO.paralelo);
      revisando = true;
      return rodar(REVISAO.chamadas).then(function () {
        revisando = false;
        achadasRevisao = rever.filter(function (w) { return segs[w] && !segs[w].sem; }).length;
        estado.paralelo = achadasRevisao > rever.length * 0.2 ? Math.max(PARALELO_MIN, Math.floor(ritmo / 2)) : ritmo;
        if (estado.paralelo !== ritmo && o.onParalelo) o.onParalelo(estado.paralelo);
      });
    }).then(function () {
      return {segs: segs, erro: erro, consultas: consultas, revistas: revistas, achadasRevisao: achadasRevisao, paralelo: estado.paralelo};
    });
  }
  /**
   * Pesquisa só dos códigos de segmento. → {results: [{w, seg: {s1, s2} | null, sem (o JMS não tem o código), err (recusada)}], faltam,
   * erro, consultas, revistas, achadasRevisao, comCodigo, semCodigo, recusadas, paralelo} (results na ordem colada).
   */
  function pesquisarSegmentos(api, list, o) {
    if (!list.length) return Promise.reject(new Error('Cole pelo menos uma remessa.'));
    return buscarSegmentos(api, list, o).then(function (b) {
      var results = [], faltam = [];
      list.forEach(function (w) {
        var s = b.segs[w];
        if (s === undefined) { faltam.push(w); return; }
        results.push(s === null ? {w: w, seg: null, err: true} : s.sem ? {w: w, seg: null, sem: true} : {w: w, seg: {s1: s.s1, s2: s.s2}});
      });
      return {results: results, faltam: faltam, erro: b.erro, consultas: b.consultas, revistas: b.revistas, achadasRevisao: b.achadasRevisao, paralelo: b.paralelo,
        comCodigo: results.filter(function (r) { return r.seg; }).length, semCodigo: results.filter(function (r) { return r.sem; }).length,
        recusadas: results.filter(function (r) { return r.err; }).length};
    });
  }

  return {buscarBipes: buscarBipes, pesquisar: pesquisar, buscarSegmentos: buscarSegmentos, pesquisarSegmentos: pesquisarSegmentos, ROUTE_VARIANTS: ROUTE_VARIANTS,
    POR_CHAMADA: POR_CHAMADA, CHAMADAS: CHAMADAS, PARALELO: PARALELO, PARALELO_MAX: PARALELO_MAX};
});
