/* Configurações: AuthToken, busca no JMS, planilhas (rotinha e rotas) e o registro. Tudo por config/api/… (só neste computador). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Number(n || 0).toLocaleString('pt-BR'); };
  function hora(ms) { return ms ? new Date(ms).toLocaleString('pt-BR') : '—'; }
  function post(url, corpo, tipo) {
    return fetch(url, {method: 'POST', headers: {'Content-Type': tipo || 'application/json'}, body: tipo ? corpo : JSON.stringify(corpo || {})})
      .then(function (r) { return r.json(); });
  }
  function resultado(id, linhas, ok) {
    var el = $(id);
    el.classList.remove('oculto');
    el.textContent = (ok === false ? '✕ ' : ok ? '✓ ' : '') + [].concat(linhas).join('\n');
  }
  function info(id, pares) {
    var dl = $(id);
    dl.textContent = '';
    pares.forEach(function (p) {
      var dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = p[0]; dd.textContent = p[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
  }
  function chips(titulo, lista, explica) {
    var box = document.createElement('div'); box.className = 'secao';
    var h = document.createElement('p'); h.className = 'sub'; h.textContent = titulo + ' (' + lista.length + '): ' + explica;
    var l = document.createElement('div'); l.className = 'lista-chips';
    lista.forEach(function (x) { var s = document.createElement('span'); s.textContent = x; l.appendChild(s); });
    box.appendChild(h); box.appendChild(l);
    return box;
  }

  function carregar() {
    return fetch('config/api/estado').then(function (r) { return r.json(); }).then(function (e) {
      var t = e.token;
      $('token-fonte').textContent = t.fonte === 'app' ? 'Em uso: o AuthToken colado neste app.' :
        t.fonte === 'dashmaster' ? 'Em uso: o AuthToken do DashMaster deste computador (o mesmo que você cola lá). Se colar um aqui, este app passa a usar o daqui.' :
          'Nenhum AuthToken: cole abaixo (ou cadastre no DashMaster deste computador).';
      $('apagar-token').classList.toggle('oculto', !t.temProprio);
      if (!$('dia-busca').value) $('dia-busca').value = e.hoje;
      var b = e.busca;
      info('busca-info', [
        ['Situação', b.rodando ? b.etapa : b.authVencido ? 'Parado: AuthToken vencido' : b.etapa],
        ['Última busca', b.ultimo ? hora(b.ultimo.quando) + ' · dia ' + b.ultimo.dia.split('-').reverse().join('/') + ' · ' + (b.ultimo.ok ? 'ok' : 'falhou') + ' · ' + b.ultimo.msg : '—'],
        ['Base', e.config.nomeBase + ' (código ' + e.config.codigoBase + ')'],
        ['Busca automática', 'a cada ' + e.config.minutos + ' min (dia de hoje)'],
        ['Pacotes da secundária', e.jms.pacotesSecundaria ? 'endereço "' + e.jms.pacotesSecundaria + '/scan/page"' : 'ainda não testado']
      ]);
      if (b.erros && b.erros.length) resultado('busca-erros', ['Viagens com erro na última busca:'].concat(b.erros));
      else $('busca-erros').classList.add('oculto');
      var p = e.planilhas;
      info('plan-info', [
        ['Rotinha', p.rotinha ? p.arquivoRotinha + ' · ' + fmt(p.rotinha.bases) + ' bases · ' + fmt(p.rotinha.destinos) + ' destinos' +
          (p.rotinha.repetidas ? ' · ' + p.rotinha.repetidas + ' bases repetidas (vale a 1ª, como o PROCV)' : '') : 'falta'],
        ['Planilha de rotas', p.rotas ? 'rotas.xlsx · ' + p.rotas.troncal + ' rotas troncais · ' + p.rotas.secundaria + ' secundárias' : 'falta'],
        ['Pasta das planilhas', e.config.planilhas]
      ]);
      var erros = p.erros.concat(p.rotas ? p.rotas.avisos : []);
      if (erros.length) resultado('plan-res', erros, false);
      var pend = $('pendentes');
      pend.textContent = '';
      if (p.rotas && p.rotas.codigosSemDestino.length) pend.appendChild(chips('Códigos de 1º nível sem DESTINO', p.rotas.codigosSemDestino,
        'na aba "Códigos 1º nível" da planilha rotas.xlsx, escreva os DESTINOS (Nome de mecanismo final da rotinha) de cada código.'));
      if (p.rotas && p.rotas.destinosSemCodigo.length) pend.appendChild(chips('DESTINOS da rotinha sem código', p.rotas.destinosSemCodigo,
        'os pacotes desses destinos aparecem como "Destino sem código" (não contam como erro) até entrarem num código.'));
      info('end-info', e.enderecos.map(function (a, i) { return [i === 0 ? 'Neste computador' : /ts\.net|https:/.test(a) ? 'Link público' : 'Na rede', a]; }));
      $('registro').textContent = e.registro.slice().reverse().join('\n');
    });
  }

  $('salvar-token').addEventListener('click', function () {
    var v = $('token').value.trim();
    if (!v) { resultado('token-res', 'Cole o AuthToken primeiro.', false); return; }
    resultado('token-res', 'Testando…');
    post('config/api/token', {authtoken: v}).then(function (r) {
      if (r.ok !== false || r.linhas) { $('token').value = ''; }
      resultado('token-res', r.linhas || [r.error], r.ok);
      carregar();
    });
  });
  $('testar').addEventListener('click', function () {
    resultado('token-res', 'Testando…');
    post('config/api/testar').then(function (r) { resultado('token-res', r.linhas, r.ok); });
  });
  $('apagar-token').addEventListener('click', function () { post('config/api/token/apagar').then(carregar); });
  function buscar(forcar) {
    post('config/api/buscar', {dia: $('dia-busca').value, forcar: forcar}).then(function (r) {
      if (!r.ok) alert(r.error);
      carregar();
    });
  }
  $('buscar').addEventListener('click', function () { buscar(false); });
  $('buscar-tudo').addEventListener('click', function () { buscar(true); });
  function enviar(input, nome) {
    input.addEventListener('change', function () {
      var f = input.files[0];
      if (!f) return;
      resultado('plan-res', 'Conferindo ' + f.name + '…');
      f.arrayBuffer().then(function (buf) { return post('config/api/planilha?nome=' + nome, buf, 'application/octet-stream'); })
        .then(function (r) { resultado('plan-res', r.ok ? 'Planilha trocada. O painel já usa a nova.' : r.error, r.ok); input.value = ''; carregar(); });
    });
  }
  enviar($('up-rotinha'), 'rotinha');
  enviar($('up-rotas'), 'rotas');
  carregar();
  setInterval(function () { if (document.visibilityState === 'visible') carregar(); }, 5000);
})();
