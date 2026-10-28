/* Configurações: AuthToken, busca no JMS, planilha de rotas e o registro. Tudo por config/api/… (só neste computador). */
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
  function carregar() {
    return fetch('config/api/estado').then(function (r) { return r.json(); }).then(function (e) {
      var t = e.token;
      $('token-fonte').textContent = t.fonte === 'app' ? 'Em uso: o AuthToken colado neste app.' :
        t.fonte === 'dashmaster' ? 'Em uso: o AuthToken do DashMaster deste computador (o mesmo que você cola lá). Se colar um aqui, este app passa a usar o daqui.' :
          'Nenhum AuthToken: cole abaixo (ou cadastre no DashMaster deste computador).';
      $('apagar-token').classList.toggle('hidden', !t.temProprio);
      $('brandCenter').textContent = e.config.nomeBase; $('eyebrowCenter').textContent = e.config.nomeBase; $('appVersion').textContent = 'v' + e.versao;
      if (!$('dia-busca').value) $('dia-busca').value = e.hoje;
      $('dia-busca').max = e.hoje;
      var b = e.busca, br = function (d) { return d ? d.split('-').reverse().join('/') : ''; };
      var diasUlt = b.ultimo ? (b.ultimo.dias && b.ultimo.dias.length ? b.ultimo.dias : [b.ultimo.dia]).filter(Boolean) : [];
      var codigos = function (l) { return l.length ? 'código ' + l.join(', ') : 'sem código'; };
      var nomes = {concluido: 'concluídas', em_transito: 'em trânsito'};
      info('busca-info', [
        ['Situação', b.rodando ? (b.dias && b.dias.length > 1 ? br(b.dia) + ' · ' : '') + b.etapa : b.authVencido ? 'Parado: AuthToken vencido' : b.etapa],
        ['Última busca', b.ultimo ? hora(b.ultimo.quando) + ' · ' + (diasUlt.length ? (diasUlt.length > 1 ? 'dias ' : 'dia ') + diasUlt.map(br).join(', ') : 'só 3 Segmentos') + ' · ' +
          (b.ultimo.ok ? 'ok' : 'falhou') + ' · ' + b.ultimo.msg : '—'],
        ['PDD de saída (fixo)', e.config.nomeBase + ' (código ' + e.config.codigoBase + ')'],
        ['Status no painel', 'Concluído：已完成 (' + codigos(e.status.concluido) + ') e Em Trânsito：在途 (' + codigos(e.status.emTransito) + '). Os outros ficam de fora.'],
        ['Viagens de hoje', e.viagensHoje.map(function (t) {
          var tot = 0, por = {}, outros = [];
          t.status.forEach(function (x) { tot += x.n; if (x.status) por[x.status] = (por[x.status] || 0) + x.n; else outros.push('código ' + (x.estado || 'vazio') + ': ' + x.n); });
          return (t.tipo === 'troncal' ? 'troncal ' : 'secundária ') + tot + (tot ? ' (' + ['concluido', 'em_transito'].map(function (k) { return (por[k] || 0) + ' ' + nomes[k]; })
            .concat(outros.length ? ['fora do painel: ' + outros.join(', ')] : []).join(' · ') + ')' : '');
        }).join(' | ')],
        ['Busca automática', 'hoje a cada ' + e.config.minutos + ' min' + (e.config.minutosDiaAnterior ? ' · ontem a cada ' + e.config.minutosDiaAnterior +
          ' min (guarda o dia anterior completo)' : ' · ontem: desligado')],
        ['3 Segmentos no JMS', e.segmentosHoje && e.segmentosHoje.total ?
          'hoje: ' + fmt(e.segmentosHoje.feitos) + ' de ' + fmt(e.segmentosHoje.total) + ' pacotes conferidos' + (e.segmentosHoje.comErro ? ' · ' + fmt(e.segmentosHoje.comErro) +
          ' com erro (tenta de novo em 30 min)' : '') + ' · ritmo: ' + (e.segmentosHoje.ritmo || '1 remessa a cada ' + e.config.segundosPorRemessa + ' s') +
          (e.segmentosHoje.pelaBase ? ' · ' + fmt(e.segmentosHoje.basesConhecidas) + ' Bases Destino com o código (os outros pacotes delas usam esse código até a consulta)' : '')
          : 'hoje ainda sem pacotes'],
        ['Dias guardados', e.salvos && e.salvos.n ? e.salvos.n + (e.salvos.n === 1 ? ' dia' : ' dias') + ' (de ' + br(e.salvos.de) + ' a ' + br(e.salvos.ate) + ')' : 'nenhum ainda'],
        ['Pacotes da secundária', e.jms.pacotesSecundaria ? 'endereço "' + e.jms.pacotesSecundaria + '/scan/page"' : 'ainda não testado']
      ]);
      if (b.erros && b.erros.length) resultado('busca-erros', ['Viagens com erro na última busca:'].concat(b.erros));
      else $('busca-erros').classList.add('hidden');
      var p = e.planilhas;
      info('plan-info', [
        ['Planilha de rotas', p.rotas ? 'rotas.xlsx · ' + p.rotas.troncal + ' rotas troncais · ' + p.rotas.secundaria + ' secundárias' : 'falta'],
        ['Pasta da planilha', e.config.planilhas]
      ]);
      var g = e.google;
      if (g) {
        $('g-abrir').classList.toggle('hidden', !g.url);
        if (g.url) $('g-abrir').href = g.url;
        $('g-desligar').classList.toggle('hidden', !g.ativo);
        var ue = g.ultimaEscrita;
        info('g-info', [
          ['Situação', !g.ativo ? 'Desligada: o painel usa o banco do computador.' : (g.ok === false ? 'Com problema: ' : '') + g.msg],
          ['Planilha', g.planilha || '—'],
          ['Dias na planilha', g.dias.length ? g.dias.map(br).join(', ') : 'nenhum ainda'],
          ['Última escrita', ue ? hora(ue.quando) + ' · ' + br(ue.dia) + ' · ' + fmt(ue.pacotes) + ' pacotes e ' + fmt(ue.viagens) + ' viagens em ' +
            String(ue.segundos).replace('.', ',') + ' s' : '—'],
          ['Última leitura', g.ultimaLeitura ? hora(g.ultimaLeitura) : '—'],
          ['Esperando', g.pendentes.length ? 'escrever ' + g.pendentes.map(br).join(', ') + ' (no máximo a cada ' + g.googleMinutos + ' min)' : 'nada'],
          ['Aba Segmentos', fmt(g.segmentosAba) + ' remessas com o código'],
          ['Células usadas', fmt(g.celulas) + ' de ' + fmt(g.limite) + ' (' + Math.round(g.celulas / g.limite * 100) + '%) · guarda os últimos ' + g.googleDias + ' dias']
        ]);
      }
      var erros = p.erros.concat(p.rotas ? p.rotas.avisos : []);
      if (erros.length) resultado('plan-res', erros, false);
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
  enviar($('up-rotas'), 'rotas');
  $('g-salvar').addEventListener('click', function () {
    var url = $('g-url').value.trim(), senha = $('g-senha').value;
    if (!url || !senha) { resultado('g-res', 'Cole a URL e a SENHA.', false); return; }
    resultado('g-res', 'Testando a planilha…');
    post('config/api/google', {url: url, senha: senha}).then(function (r) {
      if (r.ok) { $('g-url').value = ''; $('g-senha').value = ''; }
      resultado('g-res', r.linhas || [r.error], r.ok);
      carregar();
    });
  });
  $('g-desligar').addEventListener('click', function () {
    if (!confirm('Desligar a Google Planilha? O painel volta a usar o banco do computador (a planilha não é apagada).')) return;
    post('config/api/google/desligar').then(carregar);
  });
  carregar();
  setInterval(function () { if (document.visibilityState === 'visible') carregar(); }, 5000);
})();
