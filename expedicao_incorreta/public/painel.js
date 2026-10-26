/* Painel (Rota Troncal ou Rota Secundária): pede os números ao app a cada minuto e desenha cartões, gráficos e a tabela.
 * Os filtros do topo valem para tudo; a situação e a busca valem só para a tabela. Os filtros ficam no endereço da página. */
(function () {
  'use strict';
  var G = window.Graficos, fmt = G.fmt, pct = G.pct;
  var tipo = /secundaria\/?$/.test(location.pathname) ? 'secundaria' : 'troncal';
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var estado = {dia: q.get('dia') || '', turno: q.get('turno') || '', rota: q.get('rota') || '', destino: q.get('destino') || '',
    situacao: q.get('situacao') || '', busca: '', pagina: 1, tamanho: 100, total: 0, carregando: false, hoje: ''};

  document.title = (tipo === 'troncal' ? 'Rota Troncal' : 'Rota Secundária') + ' · Expedição Incorreta';
  $('titulo').textContent = tipo === 'troncal' ? 'Rota Troncal' : 'Rota Secundária';
  $('aba-' + tipo).setAttribute('aria-current', 'page');
  ['troncal', 'secundaria'].forEach(function (t) { $('aba-' + t).href = t + (estado.dia ? '?dia=' + estado.dia : ''); });

  function params(extra) {
    var p = new URLSearchParams({tipo: tipo, dia: estado.dia});
    ['turno', 'rota', 'destino'].forEach(function (k) { if (estado[k]) p.set(k, estado[k]); });
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== '' && extra[k] !== undefined) p.set(k, extra[k]); });
    return p.toString();
  }
  function guardarNoEndereco() {
    var p = new URLSearchParams();
    ['dia', 'turno', 'rota', 'destino', 'situacao'].forEach(function (k) { if (estado[k] && !(k === 'dia' && estado.dia === estado.hoje)) p.set(k, estado[k]); });
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
  }
  function pedir(url, opcoes) {
    return fetch(url, opcoes).then(function (r) {
      if (r.status === 401) { location.reload(); throw new Error('senha'); }
      return r.json();
    });
  }
  function opcoes(sel, lista, atual, todos) {
    var el = $(sel);
    el.textContent = '';
    var o = document.createElement('option'); o.value = ''; o.textContent = todos; el.appendChild(o);
    var itens = lista.slice();
    if (atual && itens.indexOf(atual) < 0) itens.unshift(atual);
    itens.forEach(function (v) { var x = document.createElement('option'); x.value = v; x.textContent = v; el.appendChild(x); });
    el.value = atual || '';
  }
  function texto(id, v) { $(id).textContent = v; }

  // ---------------------------------------------------------------- topo e avisos
  function hora(ms) { return ms ? new Date(ms).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : ''; }
  function mostrarBusca(e) {
    var b = e.busca, ponto = $('ponto');
    estado.hoje = e.hoje;
    texto('base', ' · ' + e.base);
    ponto.className = 'ponto' + (b.rodando ? ' rodando' : b.authVencido || (b.ultimo && !b.ultimo.ok) ? ' parado' : '');
    var t;
    if (b.rodando) t = b.etapa;
    else if (b.ultimo) t = (b.ultimo.ok ? 'Atualizado às ' : 'Última tentativa às ') + hora(b.ultimo.quando) + (b.ultimo.dia !== estado.dia ? ' (' + b.ultimo.dia.split('-').reverse().join('/') + ')' : '') +
      ' · busca a cada ' + e.minutos + ' min';
    else t = 'Esperando a primeira busca no JMS…';
    texto('busca-texto', t);
    $('buscar').disabled = b.rodando;
  }
  function aviso(lista, forte, titulo, corpo) {
    var d = document.createElement('div'); d.className = 'aviso' + (forte ? ' forte' : '');
    var b = document.createElement('b'); b.textContent = titulo;
    d.appendChild(b); d.appendChild(document.createTextNode(corpo));
    lista.appendChild(d);
  }
  function mostrarAvisos(r) {
    var el = $('avisos'), e = r.estado;
    el.textContent = '';
    if (e.busca.authVencido) aviso(el, true, 'AuthToken do JMS vencido.', ' Pegue um novo no JMS e cole em Configurações (no computador do app). Os números abaixo são da última busca que deu certo.');
    else if (e.busca.ultimo && !e.busca.ultimo.ok) aviso(el, true, 'A última busca no JMS falhou:', ' ' + e.busca.ultimo.msg);
    e.planilhas.erros.forEach(function (m) { aviso(el, true, 'Planilha:', ' ' + m); });
    var t = r.totais, p = r.pendencias;
    var ex = function (l) { return l.slice(0, 5).map(function (i) { return i.nome + ' (' + fmt(i.qtd) + ')'; }).join(', '); };
    var pac = function (n) { return fmt(n) + (n === 1 ? ' pacote' : ' pacotes'); };
    if (t.semRegra) aviso(el, false, pac(t.semRegra) + ' de rota fora da planilha de rotas:', ' ' + ex(p.semRegra) + '. Inclua a rota na planilha rotas.xlsx.');
    if (t.semRotinha) aviso(el, false, pac(t.semRotinha) + ' com Base Destino fora da rotinha:', ' ' + ex(p.semRotinha) + '. Inclua a base na rotinha.');
    if (t.semCodigo) aviso(el, false, pac(t.semCodigo) + ' com DESTINO sem código de 1º nível:', ' ' + ex(p.semCodigo) + '. Complete a aba "Códigos 1º nível" da planilha rotas.xlsx.');
    if (!t.pacotes && !e.busca.rodando && r.viagens.total === 0) aviso(el, false, 'Sem dados deste dia ainda.', ' Clique em "Buscar agora" para buscar no JMS.');
  }

  // ---------------------------------------------------------------- cartões e gráficos
  function mostrarResumo(r) {
    var t = r.totais;
    texto('k-errados', fmt(t.errados));
    texto('k-taxa', pct(t.taxa) + ' dos pacotes conferidos');
    texto('k-pacotes', fmt(t.pacotes));
    texto('k-viagens', fmt(r.viagens.total) + ' viagens · ' + fmt(r.viagens.comCarga) + ' com carregamento');
    r.turnos.forEach(function (x) {
      texto('k-' + x.turno, fmt(x.errados));
      texto('k-' + x.turno + 'd', pct(x.participacao) + ' dos erros · ' + fmt(x.pacotes) + ' pacotes');
    });
    var m = r.maisAfetados;
    var um = function (id, item, det) { texto(id, item ? item.nome : '–'); texto(id + '-d', item ? fmt(item.qtd) + ' errados' + (det ? ' · ' + det : '') : 'Nenhum erro'); };
    um('m-segmento', m.segmento); um('m-base', m.baseDestino); um('m-destino', m.destino); um('m-viagem', m.viagem, m.viagem && m.viagem.rota);
    var cores = {T1: 'var(--s1)', T2: 'var(--s2)', T3: 'var(--s3)'};
    G.rosca($('g-turnos'), r.turnos.map(function (x) {
      return {rotulo: x.turno, valor: x.errados, cor: cores[x.turno], detalhe: pct(x.participacao)};
    }), {valor: fmt(t.errados), rotulo: 'errados'});
    G.barras($('g-segmentos'), r.top.segmentos, t.errados);
    G.barras($('g-bases'), r.top.basesDestino, t.errados);
    G.barras($('g-destinos'), r.top.destinos, t.errados);
    G.barras($('g-logins'), r.top.logins, t.errados);
    G.barras($('g-viagens'), r.top.viagens, t.errados);
    G.barras($('g-lotes'), r.top.lotes, t.errados);
    G.barras($('g-rotas'), r.top.rotas, t.errados);
    opcoes('f-rota', r.opcoes.rotas, estado.rota, 'Todas');
    opcoes('f-destino', r.opcoes.destinos, estado.destino, 'Todos');
  }

  // ---------------------------------------------------------------- tabela
  function mostrarTabela(t) {
    estado.total = t.total;
    var cab = $('t-cab'), corpo = $('t-corpo');
    cab.textContent = ''; corpo.textContent = '';
    var tr = document.createElement('tr');
    t.colunas.forEach(function (c) { var th = document.createElement('th'); th.textContent = c[1]; tr.appendChild(th); });
    cab.appendChild(tr);
    t.linhas.forEach(function (l) {
      var r = document.createElement('tr');
      if (l.situacao === 'errado') r.className = 'errado';
      t.colunas.forEach(function (c) {
        var td = document.createElement('td');
        if (c[0] === 'situacaoTexto') {
          var s = document.createElement('span'), i = document.createElement('i');
          s.className = 'selo ' + (l.situacao === 'errado' ? 'errado' : l.situacao === 'certo' ? 'certo' : 'outro');
          i.textContent = l.situacao === 'errado' ? '✕' : l.situacao === 'certo' ? '✓' : '!';
          s.appendChild(i); s.appendChild(document.createTextNode(l[c[0]]));
          td.appendChild(s);
        } else td.textContent = l[c[0]];
        if (c[0] === 'billCode' || c[0] === 'horario') td.className = 'num';
        r.appendChild(td);
      });
      corpo.appendChild(r);
    });
    if (!t.linhas.length) {
      var v = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = t.colunas.length; td.className = 'vazio'; td.textContent = 'Nenhum pacote neste recorte.';
      v.appendChild(td); corpo.appendChild(v);
    }
    var ini = t.total ? (t.pagina - 1) * t.tamanho + 1 : 0, fim = Math.min(t.total, t.pagina * t.tamanho);
    texto('t-info', fmt(ini) + '–' + fmt(fim) + ' de ' + fmt(t.total));
    $('t-ant').disabled = t.pagina <= 1;
    $('t-prox').disabled = fim >= t.total;
  }
  function carregarTabela() {
    return pedir('api/tabela?' + params({situacao: estado.situacao, busca: estado.busca, pagina: estado.pagina, tamanho: estado.tamanho})).then(mostrarTabela);
  }

  // ---------------------------------------------------------------- carregar
  function carregar() {
    if (estado.carregando) return Promise.resolve();
    estado.carregando = true;
    document.querySelector('.pagina').style.opacity = '.7';
    return pedir('api/painel?' + params()).then(function (r) {
      if (!estado.dia) { estado.dia = r.dia; $('f-dia').value = r.dia; }
      mostrarBusca(r.estado); mostrarAvisos(r); mostrarResumo(r);
      guardarNoEndereco();
      return carregarTabela();
    }).catch(function (e) {
      if (String(e && e.message) !== 'senha') texto('busca-texto', 'Sem conexão com o app: ' + e.message);
    }).then(function () {
      estado.carregando = false;
      document.querySelector('.pagina').style.opacity = '';
    });
  }

  // ---------------------------------------------------------------- eventos
  $('f-dia').value = estado.dia;
  $('t-situacao').value = estado.situacao;
  $('f-dia').addEventListener('change', function () { estado.dia = this.value; estado.pagina = 1; carregar(); });
  $('f-turno').value = estado.turno;
  $('f-turno').addEventListener('change', function () { estado.turno = this.value; estado.pagina = 1; carregar(); });
  $('f-rota').addEventListener('change', function () { estado.rota = this.value; estado.pagina = 1; carregar(); });
  $('f-destino').addEventListener('change', function () { estado.destino = this.value; estado.pagina = 1; carregar(); });
  $('limpar').addEventListener('click', function () {
    estado.turno = estado.rota = estado.destino = ''; estado.pagina = 1; $('f-turno').value = ''; carregar();
  });
  $('t-situacao').addEventListener('change', function () { estado.situacao = this.value; estado.pagina = 1; guardarNoEndereco(); carregarTabela(); });
  var espera = null;
  $('t-busca').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(espera);
    espera = setTimeout(function () { estado.busca = v; estado.pagina = 1; carregarTabela(); }, 300);
  });
  $('t-ant').addEventListener('click', function () { if (estado.pagina > 1) { estado.pagina--; carregarTabela(); } });
  $('t-prox').addEventListener('click', function () { estado.pagina++; carregarTabela(); });
  $('excel').addEventListener('click', function () {
    location.href = 'api/excel?' + params({situacao: estado.situacao, busca: estado.busca});
  });
  $('buscar').addEventListener('click', function () {
    $('buscar').disabled = true;
    pedir('api/buscar', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({dia: estado.dia})})
      .then(function (r) { if (r.estado) mostrarBusca(r.estado); if (r.error) alert(r.error); })
      .catch(function () {});
  });

  carregar();
  // Enquanto busca no JMS, confere a cada 5 s; parado, a cada minuto (sem mexer nos filtros nem na página da tabela).
  var ultimaBusca = 0;
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    pedir('api/estado').then(function (e) {
      mostrarBusca(e);
      var fim = e.busca.ultimo ? e.busca.ultimo.quando : 0;
      if (fim !== ultimaBusca || Date.now() - (estado.ultimaCarga || 0) > 60000) {
        ultimaBusca = fim; estado.ultimaCarga = Date.now();
        carregar();
      }
    }).catch(function () {});
  }, 5000);
})();
