/**
 * J&T · PESQUISA NO RASTREAMENTO — a pesquisa em si, na página (o servidor só repassa ao JMS e baixa as fotos).
 *
 * `api` (o servidor, Apps Script ou Node.js):
 *   api.jms(url, body, headers) → Promise<{status, text}>   (body null = GET; o servidor põe o AuthToken)
 *   api.fotos(urls)             → Promise<[{ok, b64, error}]> (baixa as fotos; a página não pode, por causa do navegador)
 *
 * buscarBipes: as remessas vão ao Rastreamento do pacote (keywordList) várias por consulta, algumas consultas de cada vez.
 *   - Recusa com várias remessas: o limite cai pela metade (aprendido) e o grupo volta em duas metades.
 *   - Vazio maior que todas as consultas que já responderam: o grupo volta em duas metades (pode ser o limite); se a metade
 *     responder, o limite era esse. Vazio do tamanho das que responderam (ou pequeno): as remessas não existem no JMS.
 *   - Só as primeiras vieram: as outras voltam para a fila.
 *   - Recusa na 1ª vez: testa uma vez os cabeçalhos de rota da tela (Routename) antes de concluir que é o tamanho.
 * buscarFotos: para cada linha encontrada com "Ver imagem", o link da foto (pelo modelo ensinado ou, no bipe de pacote
 *   problemático, pela "Lista registrada de pacote problemático"), depois a foto baixada e reduzida (miniatura).
 */
(function (root, factory) {
  var api = factory(root.Rastreio || (typeof require === 'function' ? require('./rastreio.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pesquisa = api;
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  var ROUTE_VARIANTS = [{routename: 'trackingExpress'}, {routename: 'waybillTracking'}];
  function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /** Uma consulta ao JMS pelo servidor, com 1 nova tentativa em falha passageira. Erros com `kind` (rastreio.js → parseJms). */
  function chamada(api, estado) {
    return function chamar(url, body, headers) {
      var h = Object.assign({}, estado.headers || {}, headers || {});
      var tentar = function (n) {
        return Promise.resolve().then(function () { return api.jms(url, body, h); }).then(function (r) {
          return R.parseJms(r && r.status, r && r.text);
        }, function (e) {
          var err = new Error('Falha ao falar com o servidor: ' + String(e && e.message || e).slice(0, 200));
          err.kind = /AuthToken|token/i.test(String(e && e.message || '')) ? 'auth' : 'temp';
          throw err;
        }).catch(function (e) {
          if (e.kind === 'temp' && n < 1) return wait(estado.espera === undefined ? 1500 : estado.espera).then(function () { return tentar(n + 1); });
          throw e;
        });
      };
      return tentar(0);
    };
  }

  /**
   * Bipes de cada remessa. o: {lote (limite atual), paralelo, minProbe, pais, headers, onLote(n, motivo), onHeaders(h),
   * onProgresso(feitas, total), parar()}. → {map: remessa → bipes ([] = sem rastreamento; null = recusada), erro, lote, headers}
   * Remessas fora do map: a pesquisa parou antes (parar()).
   */
  function buscarBipes(api, list, o) {
    o = o || {};
    var estado = {headers: o.headers || null, espera: o.espera}, chamar = chamada(api, estado);
    var lote = Math.max(1, Math.floor(o.lote || 100)), paralelo = Math.max(1, o.paralelo || 4), minProbe = o.minProbe || 8;
    var map = {}, fila = [], provado = 0, erro = '', testouRota = !!o.headers;
    for (var i = 0; i < list.length; i += lote) fila.push({list: list.slice(i, i + lote)});
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
    var consultar = function (g) {
      return chamar(R.KEYWORD_URL, R.keywordPayload(g.list, o.pais)).catch(function (e) {
        if (e.kind === 'auth' || e.kind === 'refused') {
          if (testouRota) throw e;
          // Uma vez: os cabeçalhos de rota da tela. O que funcionar fica para as próximas consultas.
          testouRota = true;
          var v = 0;
          var proxima = function () {
            if (v >= ROUTE_VARIANTS.length) throw e;
            var h = ROUTE_VARIANTS[v++];
            return chamar(R.KEYWORD_URL, R.keywordPayload(g.list, o.pais), h).then(function (json) {
              estado.headers = h;
              if (o.onHeaders) o.onHeaders(h);
              return json;
            }, function (e2) { if (e2.kind === 'temp') throw e2; return proxima(); });
          };
          return proxima();
        }
        throw e;
      });
    };
    var trata = function (g) {
      return consultar(g).then(function (json) {
        var got = {};
        R.recordsOf(json).forEach(function (item) {
          var kw = String(item && (item.keyword || item.waybillNo || item.billCode) || '').trim().toUpperCase();
          if (kw) got[kw] = Array.isArray(item.details) ? item.details : [];
        });
        var n = g.list.length, comDados = g.list.filter(function (w) { return got[w] && got[w].length; }).length;
        if (!comDados) {
          if (n >= minProbe && n > provado) { metades(g, true); return; }
          g.list.forEach(function (w) { map[w] = got[w] || []; });
          return;
        }
        provado = Math.max(provado, n);
        // A metade respondeu e o grupo inteiro tinha voltado vazio: o JMS aceita no máximo esse tanto por consulta.
        if (g.vazio && n < lote) aprender(n, 'consulta com ' + (n * 2) + ' remessas voltou vazia e com ' + n + ' respondeu');
        var volta = g.list.filter(function (w) { return got[w] === undefined; });
        g.list.forEach(function (w) { if (got[w] !== undefined) map[w] = got[w]; });
        if (volta.length) fila.push({list: volta});
      }, function (e) {
        if (e.kind === 'auth') throw e;
        erro = e.message;
        if (g.list.length > 1) { aprender(Math.ceil(g.list.length / 2), 'o JMS recusou ' + g.list.length + ' remessas numa consulta'); metades(g, false); }
        else map[g.list[0]] = null;
      });
    };
    var feitas = function () { return Object.keys(map).length; };
    var rodada = function () {
      if (!fila.length || (o.parar && o.parar())) return Promise.resolve();
      var grupos = fila.splice(0, paralelo);
      return Promise.all(grupos.map(trata)).then(function () {
        if (o.onProgresso) o.onProgresso(feitas(), list.length);
        return rodada();
      });
    };
    return rodada().then(function () { return {map: map, erro: erro, lote: lote, headers: estado.headers}; });
  }

  /**
   * Pesquisa completa: bipes + primeiro bipe de cada padrão. → {results: [{w, ok, err, p: [hit|null, hit|null]}], faltam, erro, lote}
   * (results na ordem colada; `faltam` = remessas não pesquisadas porque a pesquisa foi parada).
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
        var r = {w: w, ok: !!(d && d.length), p: match.map(function (m) { return m && d ? R.hit(d, m) : null; })};
        if (d === null) r.err = true;
        results.push(r);
      });
      return {results: results, faltam: faltam, erro: b.erro, lote: b.lote, headers: b.headers};
    });
  }

  function b64ToBytes(b64) {
    if (typeof atob === 'function') {
      var s = atob(b64), out = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function dataUrlBytes(u) { var i = u.indexOf(','); return b64ToBytes(u.slice(i + 1)); }

  /**
   * Fotos das linhas encontradas com "Ver imagem". o: {modelo (o "Ver imagem" ensinado ou null), pais, headers, paralelo,
   * miniatura(bytes, tipo) → Promise<{bytes, w, h, mime, url?}|null>, onFoto(h), onProgresso(feitas, total), parar()}.
   * Em cada hit: h.url (link da foto), h.foto ({bytes, w, h, mime}) ou h.fotoErro. Linhas iguais (mesma remessa, horário e
   * código) dividem a mesma foto. → Promise<{total, comFoto, semLink, erros}>
   */
  function buscarFotos(api, results, o) {
    o = o || {};
    var estado = {headers: o.headers || null, espera: o.espera}, chamar = chamada(api, estado), paralelo = Math.max(1, o.paralelo || 4);
    var grupos = {}, ordem = [];
    (results || []).forEach(function (r) {
      (r.p || []).forEach(function (h) {
        if (!h || !h.img) return;
        var k = r.w + '|' + h.t + '|' + h.code;
        if (!grupos[k]) { grupos[k] = {w: r.w, hits: []}; ordem.push(k); }
        grupos[k].hits.push(h);
      });
    });
    var stats = {total: ordem.length, comFoto: 0, semLink: 0, erros: 0}, feitas = 0, problemas = {};
    var registrosProblema = function (w) {
      if (!problemas[w]) problemas[w] = chamar(R.PROBLEM_URL, R.problemPayload(w, o.pais)).then(R.recordsOf, function (e) { if (e.kind === 'auth') throw e; return []; });
      return problemas[w];
    };
    var linkDe = function (g) {
      var h = g.hits[0];
      var pelo = o.modelo ? (function () {
        var req = R.buildRequest(o.modelo, h.raw || {});
        return chamar(req.url, req.body, req.headers).then(function (json) { return R.findImageUrls(json)[0] || ''; },
          function (e) { if (e.kind === 'auth') throw e; return ''; });
      })() : Promise.resolve('');
      return pelo.then(function (url) {
        if (url || !R.isProblem(h)) return url;
        return registrosProblema(g.w).then(function (recs) { return R.nearestImage(recs, h.t); });
      });
    };
    var trata = function (lista) {
      return Promise.all(lista.map(function (k) { return linkDe(grupos[k]).then(function (url) { return {k: k, url: url}; }); })).then(function (links) {
        var baixar = links.filter(function (x) { return x.url && !/^data:/i.test(x.url); });
        var pedido = baixar.length ? Promise.resolve(api.fotos(baixar.map(function (x) { return x.url; }))).catch(function (e) {
          return baixar.map(function () { return {ok: false, error: String(e && e.message || e)}; });
        }) : Promise.resolve([]);
        return pedido.then(function (fotos) {
          var porUrl = {};
          baixar.forEach(function (x, i) { porUrl[x.k] = fotos[i] || {ok: false, error: 'sem resposta'}; });
          return Promise.all(links.map(function (x) {
            var hits = grupos[x.k].hits;
            hits.forEach(function (h) { h.url = /^data:/i.test(x.url) ? '' : x.url; });
            if (!x.url) { stats.semLink++; return null; }
            var bytes = null;
            if (/^data:/i.test(x.url)) bytes = dataUrlBytes(x.url);
            else if (porUrl[x.k].ok && porUrl[x.k].b64) bytes = b64ToBytes(porUrl[x.k].b64);
            if (!bytes || !R.sniffImage(bytes)) {
              stats.erros++;
              hits.forEach(function (h) { h.fotoErro = porUrl[x.k] && porUrl[x.k].error || 'arquivo sem imagem'; });
              return null;
            }
            var tipo = R.sniffImage(bytes);
            return Promise.resolve(o.miniatura ? o.miniatura(bytes, tipo) : {bytes: bytes, w: 0, h: 0, mime: 'image/' + tipo}).then(function (m) {
              if (!m) { stats.erros++; hits.forEach(function (h) { h.fotoErro = 'não abriu a imagem'; }); return; }
              stats.comFoto++;
              hits.forEach(function (h) { h.foto = m; if (o.onFoto) o.onFoto(h); });
            });
          }));
        });
      }).then(function () {
        feitas += lista.length;
        if (o.onProgresso) o.onProgresso(feitas, ordem.length);
      });
    };
    var i = 0, LOTE = 8;
    var rodada = function () {
      if (i >= ordem.length || (o.parar && o.parar())) return Promise.resolve(stats);
      var vez = [];
      for (var p = 0; p < paralelo && i < ordem.length; p++) { vez.push(ordem.slice(i, i + LOTE)); i += LOTE; }
      return Promise.all(vez.map(trata)).then(rodada);
    };
    return rodada();
  }

  /**
   * "Ensinar a foto": o pedido copiado do "Ver imagem" + (opcional) a remessa da linha clicada. Acha a linha, monta o modelo e
   * testa nessa linha. → Promise<{modelo, linha, url, foto (b64), usados}>
   */
  function ensinarFoto(api, texto, remessa, o) {
    o = o || {};
    var chamar = chamada(api, {headers: o.headers || null, espera: o.espera});
    var req = R.parseCopiedRequest(texto);
    var ws = remessa ? [String(remessa).trim().toUpperCase()] : R.waybillsIn(req);
    if (!ws.length) return Promise.reject(new Error('Não achei a remessa no pedido copiado. Digite a remessa da linha em que você clicou.'));
    return chamar(R.KEYWORD_URL, R.keywordPayload(ws.slice(0, 10), o.pais)).then(function (json) {
      var details = [];
      R.recordsOf(json).forEach(function (it) { if (it && Array.isArray(it.details)) details = details.concat(it.details); });
      if (!details.length) throw new Error('O JMS não tem rastreamento para ' + ws.slice(0, 3).join(', ') + '. Confira a remessa da linha clicada.');
      var l = R.learnTemplate(req, details);
      if (!l.modelo) throw new Error('O pedido colado não tem nenhum dado da linha (remessa, horário…). Copie o pedido que aparece ao clicar em "Ver imagem".');
      var teste = R.buildRequest(l.modelo, l.linha);
      return chamar(teste.url, teste.body, teste.headers).then(function (resp) {
        var url = R.findImageUrls(resp)[0] || '';
        if (!url) throw new Error('O pedido funcionou, mas a resposta não tem link de foto. Confira se copiou o pedido do "Ver imagem".');
        if (/^data:/i.test(url)) return {modelo: l.modelo, linha: l.linha, url: '', foto: url.slice(url.indexOf(',') + 1), usados: l.usados};
        return Promise.resolve(api.fotos([url])).then(function (f) {
          if (!f || !f[0] || !f[0].ok) throw new Error('Achei o link da foto, mas não consegui baixar: ' + (f && f[0] && f[0].error || 'sem resposta'));
          return {modelo: l.modelo, linha: l.linha, url: url, foto: f[0].b64, usados: l.usados};
        });
      });
    });
  }

  return {buscarBipes: buscarBipes, pesquisar: pesquisar, buscarFotos: buscarFotos, ensinarFoto: ensinarFoto, b64ToBytes: b64ToBytes};
});
