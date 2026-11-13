/* Configurações: AuthToken, busca no JMS, tabela de rotas do SC, endereços e o registro. Tudo por config/api/… (só no computador do app). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Number(n || 0).toLocaleString('pt-BR'); };
  var hora = function (ms) { return ms ? new Date(ms).toLocaleString('pt-BR') : '—'; };
  var br = function (d) { return d ? d.split('-').reverse().join('/') : ''; };
  function post(url, corpo, tipo) {
    return fetch(url, {method: 'POST', headers: {'Content-Type': tipo || 'application/json'}, body: tipo ? corpo : JSON.stringify(corpo || {})})
      .then(function (r) { return r.json(); });
  }
  function resultado(id, linhas, ok) {
    var el = $(id);
    el.classList.remove('hidden');
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
  function tabelaRotas(t) {
    var corpo = $('rotas-tab').querySelector('tbody');
    corpo.textContent = '';
    if (!t.ok) return;
    [['troncal', 'Principal'], ['secundaria', 'Secundária']].forEach(function (l) {
      t[l[0]].forEach(function (r) {
        var tr = document.createElement('tr');
        [l[1], r.rota, r.doca, r.esteira, r.codigos, r.obs].forEach(function (v) { var td = document.createElement('td'); td.textContent = v || ''; tr.appendChild(td); });
        corpo.appendChild(tr);
      });
    });
  }
  function carregar() {
    return fetch('config/api/estado').then(function (r) { return r.json(); }).then(function (e) {
      var t = e.token, c = e.config, b = e.busca;
      Array.prototype.forEach.call(document.querySelectorAll('.js-base'), function (el) { el.textContent = c.nomeBase; });
      $('appVersion').textContent = 'v' + e.versao;
      $('token-fonte').textContent = t.fonte === 'app' ? 'Em uso: o AuthToken colado neste app.' :
        t.fonte === 'dashmaster' ? 'Em uso: o AuthToken do DashMaster deste computador (o mesmo que você cola lá). Se colar um aqui, este app passa a usar o daqui.' :
          'Nenhum AuthToken: cole abaixo (ou cadastre no DashMaster deste computador).';
      $('apagar-token').classList.toggle('hidden', !t.temProprio);
      info('busca-info', [
        ['Situação', b.rodando ? b.etapa : b.authVencido ? 'Parado: AuthToken vencido' : b.etapa],
        ['Última busca', b.ultimo ? hora(b.ultimo.quando) + ' · dia ' + br(b.ultimo.dia) + ' · ' + (b.ultimo.ok ? 'ok' : 'falhou') + ' · ' + b.ultimo.msg : '—'],
        ['Base de saída', c.nomeBase + ' (código ' + c.codigoBase + ')'],
        ['Viagens', 'Consulta de Viagens (linha principal) e Consulta de Viagens Secundárias, partida planejada hoje, status Concluído：已完成 e Em Trânsito：在途. ' +
          'Rota do caminhão = Unidade de destino.'],
        ['Remessas', 'Digitalização de carregamento do ' + c.nomeBase + ' de cada viagem (100 por página). Turno pelo Tempo de digitalização (T1 06h–14h, T2 14h–22h, T3 22h–06h).'],
        ['3 Segmentos', 'Gestão de pedido JMS de remessa, ' + fmt(c.remessasPorConsulta) + ' remessas por consulta' + (e.jms.gestaoPagina ? ' (o JMS devolve até ' + fmt(e.jms.gestaoPagina) + ' por página)' : '') + '.'],
        ['Busca automática', 'a cada ' + c.minutos + ' min (só o dia de hoje). Viagem concluída já baixada não é baixada de novo.'],
        ['Andamento', fmt(b.viagens) + ' viagens · ' + fmt(b.baixadas) + ' baixadas · ' + fmt(b.remessasBaixadas) + ' remessas baixadas · ' + fmt(b.consultadas) +
          ' consultadas na Gestão · ' + fmt(b.pendentes) + ' aguardando o 3 Segmentos'],
        ['Dias guardados', c.diasGuardados + ' dias']
      ]);
      if (b.erros && b.erros.length) resultado('busca-res', ['Viagens com falha na última busca:'].concat(b.erros), false);
      else $('busca-res').classList.add('hidden');
      $('buscar').disabled = !!b.rodando;
      var tab = e.tabela;
      info('rotas-info', tab.ok ? [
        ['Formato', tab.formato],
        ['Linha principal', tab.troncal.length + ' rotas'],
        ['Linha secundária', tab.secundaria.length + ' rotas']
      ] : [['Erro', tab.erro]]);
      tabelaRotas(tab);
      info('end-info', e.enderecos.map(function (x, i) { return [i ? 'Na rede' : 'Neste computador', x]; }).concat([
        ['Senha do painel', c.senha ? 'definida (config.json)' : 'sem senha (defina "senha" no config.json para pedir senha a quem abre de fora)']
      ]));
      $('registro').textContent = (e.registro || []).slice().reverse().join('\n') || '—';
      return e;
    });
  }
  $('salvar-token').addEventListener('click', function () {
    var v = $('token').value.trim();
    if (!v) { resultado('token-res', 'Cole o valor do AuthToken.', false); return; }
    resultado('token-res', 'Salvando e testando…');
    post('config/api/token', {authtoken: v}).then(function (r) {
      $('token').value = '';
      resultado('token-res', r.error || r.linhas || 'Salvo.', r.ok);
      carregar();
    }).catch(function (e) { resultado('token-res', e.message, false); });
  });
  $('testar').addEventListener('click', function () {
    resultado('token-res', 'Testando…');
    post('config/api/testar').then(function (r) { resultado('token-res', r.linhas, r.ok); carregar(); }).catch(function (e) { resultado('token-res', e.message, false); });
  });
  $('apagar-token').addEventListener('click', function () {
    post('config/api/token/apagar').then(function () { resultado('token-res', 'Apagado. O app usa o AuthToken do DashMaster, se houver.', true); carregar(); });
  });
  $('buscar').addEventListener('click', function () {
    $('buscar').disabled = true;
    post('config/api/atualizar').then(function (r) {
      if (!r.ok) resultado('busca-res', r.error, false);
      setTimeout(carregar, 800);
    });
  });
  $('up-rotas').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    resultado('rotas-res', 'Enviando ' + f.name + '…');
    f.arrayBuffer().then(function (buf) { return post('config/api/rotas', buf, 'application/octet-stream'); }).then(function (r) {
      resultado('rotas-res', r.ok ? 'Tabela trocada: ' + r.tabela.troncal.length + ' rotas da linha principal e ' + r.tabela.secundaria.length +
        ' da secundária. O dia foi conferido de novo.' : r.error, r.ok);
      $('up-rotas').value = '';
      carregar();
    }).catch(function (e) { resultado('rotas-res', e.message, false); });
  });
  carregar();
  setInterval(function () { if (document.visibilityState === 'visible') carregar().catch(function () {}); }, 5000);
})();
