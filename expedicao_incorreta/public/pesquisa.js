/* Pesquisa no Rastreamento: esta tela só manda o pedido e mostra o andamento e o resultado. Quem consulta o JMS é o Python do app
 * (expedicao/pesquisa.py), pelas rotas api/pesquisa/… */
(function () {
  'use strict';
  var G = window.Graficos, esc = G.esc, fmtInt = G.fmtInt, fmtPct = G.fmtPct;
  var $ = function (id) { return document.getElementById(id); };
  var st = {id: '', aba: 'todas', busca: '', pagina: 1, tamanho: 100, estado: '', resumoId: '', imp: null, ultimaCarga: 0};
  var ICO = {
    box: '<path d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8"/>', check: '<path d="M5 12l5 5L20 7"/>',
    shift: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', login: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    seg: '<path d="M4 6h16M4 12h10M4 18h6"/>', alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4m0 3v.5"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICO[k] + '</svg>'; };
  function pedir(url, opcoes) {
    return fetch(url, opcoes).then(function (r) {
      if (r.status === 401) { location.reload(); throw new Error('senha'); }
      return r.json();
    });
  }
  function post(url, corpo, tipo) {
    return pedir(url, {method: 'POST', headers: {'Content-Type': tipo || 'application/json'}, body: tipo ? corpo : JSON.stringify(corpo || {})});
  }
  function aviso(texto, ruim) {
    $('alerts').innerHTML = texto ? '<div class="alert' + (ruim ? '' : ' warn') + '">' + svg('alert') + '<div><span>' + esc(texto) + '</span></div></div>' : '';
  }

  // ---------------------------------------------------------------- remessas
  function contar() {
    var vistos = {}, n = 0, dup = 0;
    $('remessas').value.split(/[\s,;]+/).forEach(function (x) {
      var w = x.trim().toUpperCase();
      if (!/^[A-Z0-9-]{4,40}$/.test(w)) return;
      if (vistos[w]) { dup++; return; }
      vistos[w] = 1; n++;
    });
    $('contagem').textContent = fmtInt(n) + (n === 1 ? ' remessa' : ' remessas') + (dup ? ' (' + fmtInt(dup) + ' repetidas)' : '');
  }
  $('remessas').addEventListener('input', contar);
  $('limpar').addEventListener('click', function () { $('remessas').value = ''; contar(); });
  $('semSegmento').addEventListener('click', function () {
    pedir('api/pesquisa/sem-segmento').then(function (r) {
      $('remessas').value = r.remessas.join('\n');
      contar();
      document.querySelector('input[name=modo][value=segmentos]').checked = true;
      modo();
      aviso(r.remessas.length ? fmtInt(r.remessas.length) + ' remessas dos caminhões de hoje sem o código de segmento. Clique em Pesquisar no JMS: o que vier ' +
        'entra também no painel da Expedição.' : 'Nenhuma remessa de hoje sem o código de segmento.');
    });
  });
  $('arquivo').addEventListener('change', function () {
    var f = this.files[0], input = this;
    if (!f) return;
    aviso('Lendo ' + f.name + '…');
    f.arrayBuffer().then(function (buf) { return post('api/pesquisa/importar?nome=' + encodeURIComponent(f.name), buf, 'application/octet-stream'); })
      .then(function (r) {
        input.value = '';
        if (!r.ok) { aviso(r.error, true); return; }
        st.imp = r;
        $('imp-aba').innerHTML = r.abas.map(function (a, i) { return '<option value="' + i + '">' + esc(a.nome) + '</option>'; }).join('');
        $('imp-aba').value = String(r.sugerida);
        colunas();
        $('importar').classList.remove('hidden');
        aviso('Confira a aba e a coluna das remessas e clique em Usar estas remessas.');
      });
  });
  function colunas() {
    var a = st.imp.abas[Number($('imp-aba').value)];
    $('imp-col').innerHTML = a.colunas.map(function (c) {
      return '<option value="' + c.i + '">' + esc(c.titulo) + ' · ' + fmtInt(c.quantas) + ' remessas</option>';
    }).join('');
    $('imp-col').value = String(a.sugerida);
  }
  $('imp-aba').addEventListener('change', colunas);
  $('imp-usar').addEventListener('click', function () {
    var a = st.imp.abas[Number($('imp-aba').value)], c = a.colunas[Number($('imp-col').value)];
    $('remessas').value = c.remessas.join('\n');
    $('importar').classList.add('hidden');
    contar();
    aviso('');
  });

  // ---------------------------------------------------------------- modo e botões
  function modoAtual() { return document.querySelector('input[name=modo]:checked').value; }
  function modo() {
    $('blocos').classList.toggle('hidden', modoAtual() === 'segmentos');
    Array.prototype.forEach.call(document.querySelectorAll('.pq-modos .chip'), function (c) { c.classList.toggle('active', c.querySelector('input').checked); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name=modo]'), function (r) { r.addEventListener('change', modo); });
  modo();
  $('pesquisar').addEventListener('click', function () {
    $('pesquisar').disabled = true;
    post('api/pesquisa/iniciar', {remessas: $('remessas').value, modo: modoAtual(), padroes: [$('padrao1').value, $('padrao2').value],
      segmentos: $('comSeg').checked}).then(function (r) {
      $('pesquisar').disabled = false;
      if (!r.ok) { aviso(r.error, true); return; }
      aviso(fmtInt(r.remessas) + ' remessas na pesquisa' + (r.repetidas ? ' (' + fmtInt(r.repetidas) + ' repetidas ficaram de fora)' : '') +
        (r.invalidas ? ' · ' + fmtInt(r.invalidas) + ' textos não parecem remessa' : '') + '.');
      abrir(r.id);
      estado();
    });
  });
  $('parar').addEventListener('click', function () { post('api/pesquisa/parar').then(estado); });
  $('continuar').addEventListener('click', function () {
    post('api/pesquisa/continuar', {id: st.id}).then(function (r) { if (!r.ok) aviso(r.error, true); estado(); });
  });
  $('recusadas').addEventListener('click', function () {
    post('api/pesquisa/recusadas', {id: st.id}).then(function (r) {
      if (!r.ok) { aviso(r.error, true); return; }
      abrir(r.id); estado();
    });
  });
  $('historico').addEventListener('change', function () { if (this.value) abrir(this.value); });
  $('excelBtn').addEventListener('click', function () { if (st.id) location.href = 'api/pesquisa/excel?id=' + encodeURIComponent(st.id); });

  // ---------------------------------------------------------------- andamento
  function quando(ms) { return new Date(ms).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}); }
  function mostrarAndamento(a) {
    var rodando = a && a.estado === 'rodando';
    $('andamento').classList.toggle('hidden', !a);
    $('progress').classList.toggle('on', !!rodando);
    $('parar').classList.toggle('hidden', !rodando);
    $('pesquisar').classList.toggle('hidden', !!rodando);
    $('continuar').classList.toggle('hidden', !(a && (a.estado === 'parada' || a.estado === 'erro') && a.id === st.id));
    if (!a) return;
    var pct = a.total ? a.feitas / a.total * 100 : 0;
    $('barra').style.width = pct.toFixed(1) + '%';
    $('andamentoTexto').textContent = fmtInt(a.feitas) + ' de ' + fmtInt(a.total) + ' remessas (' + fmtPct(pct, 0) + ') · ' + a.mensagem +
      (a.porSegundo ? ' · ' + String(a.porSegundo).replace('.', ',') + ' consultas por segundo' : '') +
      (a.falta ? ' · falta cerca de ' + (a.falta > 90 ? Math.round(a.falta / 60) + ' min' : a.falta + ' s') : '') +
      (a.revistas ? ' · conferência: ' + fmtInt(a.revistas) + ' de novo, ' + fmtInt(a.achadasRevisao) + ' apareceram' : '');
    if (a.estado === 'erro') aviso(a.mensagem, true);
  }
  function estado() {
    return pedir('api/pesquisa/estado').then(function (e) {
      var a = e.atual;
      $('historico').innerHTML = '<option value="">Pesquisas anteriores…</option>' + e.lista.map(function (x) {
        return '<option value="' + esc(x.id) + '">' + quando(x.criada) + ' · ' + fmtInt(x.total) + ' remessas · ' +
          (x.modo === 'segmentos' ? 'só segmentos' : 'texto') + (x.estado !== 'pronta' ? ' · ' + x.estado : '') + (x.origem ? ' · ' + esc(x.origem) : '') + '</option>';
      }).join('');
      if (!st.id && e.lista.length) abrir(e.lista[0].id);
      var mostrar = a && a.id === st.id ? a : null;
      mostrarAndamento(mostrar || (a && a.estado === 'rodando' ? a : null));
      if (mostrar) {
        var mudou = mostrar.estado !== st.estado;
        st.estado = mostrar.estado;
        // Rodando: o resultado parcial a cada 5 s; terminou: na hora.
        if (mudou || (mostrar.estado === 'rodando' && Date.now() - st.ultimaCarga > 5000)) carregar(mudou);
      }
      clearTimeout(st.relogio);
      st.relogio = setTimeout(estado, a && a.estado === 'rodando' ? 1500 : 10000);
    }).catch(function () { clearTimeout(st.relogio); st.relogio = setTimeout(estado, 5000); });
  }

  // ---------------------------------------------------------------- resultado
  function abrir(id) {
    st.id = id; st.pagina = 1; st.aba = 'todas'; st.busca = ''; $('busca').value = ''; st.resumoId = ''; st.estado = '';
    $('historico').value = id;
    carregar(true);
  }
  function abas(r) {
    var a = r.andamento, op = [['todas', 'Todas']];
    if (a.modo === 'texto') {
      r.blocos.forEach(function (b, k) {
        if (b) op.push(['b' + (k + 1) + 'tem', 'Bloco ' + (k + 1) + ' · tem (' + fmtInt(b.tem) + ')'], ['b' + (k + 1) + 'nao', 'Bloco ' + (k + 1) + ' · não tem (' + fmtInt(b.naoTem) + ')']);
      });
      op.push(['semRastreio', 'Sem rastreamento (' + fmtInt(r.semRastreio) + ')'], ['recusadas', 'Consulta recusada (' + fmtInt(r.recusadas) + ')']);
    } else if (r.seg) {
      op.push(['com', 'Com código (' + fmtInt(r.seg.com) + ')'], ['sem', 'Sem código no JMS (' + fmtInt(r.seg.sem) + ')'], ['recusadas', 'Consulta recusada (' + fmtInt(r.seg.recusadas) + ')']);
    }
    $('aba').innerHTML = op.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('');
    $('aba').value = st.aba;
  }
  function kpi(cls, rotulo, valor, sub) {
    return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + rotulo + '</span><div class="kpi-value">' + valor + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
  }
  function cartoes(r) {
    var a = r.andamento, h = kpi('', svg('box') + 'Remessas pesquisadas', fmtInt(r.pesquisadas), 'de ' + fmtInt(a.total) + ' · ' + fmtInt(a.consultas) + ' consultas ao JMS');
    if (a.modo === 'texto') {
      r.blocos.forEach(function (b, k) {
        if (!b) return;
        h += kpi('', svg('check') + 'Bloco ' + (k + 1) + ' · tem o texto', fmtInt(b.tem), '<b>' + fmtPct(b.pct || 0, 1) + '</b> · não tem: <b>' + fmtInt(b.naoTem) + '</b>' +
          (b.maisTurno ? '<br>Turno que mais ocorreu: <b>' + b.maisTurno + '</b> (' + fmtInt(b.maisTurnoQtd) + ')' : ''));
      });
      h += kpi(r.semRastreio ? 'bad' : '', svg('alert') + 'Sem rastreamento no JMS', fmtInt(r.semRastreio), 'o JMS não tem bipes dessas remessas');
      h += kpi(r.recusadas ? 'bad' : '', svg('alert') + 'Consulta recusada pelo JMS', fmtInt(r.recusadas), r.recusadas ? 'use "Tentar de novo as recusadas"' : 'nenhuma');
    }
    if (r.seg) {
      h += kpi('', svg('seg') + 'Com os códigos de segmento', fmtInt(r.seg.com), 'sem código no JMS: <b>' + fmtInt(r.seg.sem) + '</b> · recusada: <b>' + fmtInt(r.seg.recusadas) + '</b>');
    }
    $('kpiGrid').innerHTML = h;
    $('recusadas').classList.toggle('hidden', !((r.recusadas || 0) + (r.seg ? r.seg.recusadas : 0)) || a.estado === 'rodando');
  }
  function graficos(r) {
    var grid = $('chartsGrid'), a = r.andamento;
    grid.innerHTML = '';
    var colunas = function (key, titulo, sub, itens, rotulo) {
      var total = itens.reduce(function (s, i) { return s + i.qtd; }, 0);
      G.cartao(grid, {key: key, icone: ICO.seg, titulo: titulo, tipo: 'colunas', sub: sub, total: total, distintos: itens.length, itens: itens.slice(0, 20),
        rotulo: rotulo, vazio: '<b>Nada para mostrar</b>nesta pesquisa.', unidade: 'remessas'});
    };
    if (a.modo === 'texto') {
      r.blocos.forEach(function (b, k) {
        if (!b) return;
        var n = k + 1, txt = a.padroes[k];
        colunas('b' + n + 'tem', {pt: 'Bloco ' + n + ': tem × não tem', zh: '有 / 没有'}, '"' + txt + '"',
          [{nome: 'Tem', qtd: b.tem}, {nome: 'Não tem', qtd: b.naoTem - b.semRastreio - b.recusadas}, {nome: 'Sem rastreamento', qtd: b.semRastreio},
            {nome: 'Recusada', qtd: b.recusadas}].filter(function (i) { return i.qtd; }), {pt: 'Situação', um: 'situação', zh: '状态'});
        G.cartao(grid, {key: 'b' + n + 'turnos', icone: ICO.shift, titulo: {pt: 'Bloco ' + n + ': turnos do primeiro bipe', zh: '班次'}, tipo: 'rosca',
          sub: 'T1 06h–14h · T2 14h–22h · T3 22h–06h', itens: ['T1', 'T2', 'T3'].map(function (t) { return {nome: t, qtd: b.turnos[t]}; }), total: b.tem,
          distintos: 3, rotulo: {pt: 'Turno', um: 'turno', zh: '班次'}, vazio: '<b>Nenhuma remessa</b>com o texto.',
          unidade: 'remessas', unidadeCurta: 'remessas', totalTexto: 'Remessas com o texto'});
        colunas('b' + n + 'horas', {pt: 'Bloco ' + n + ': por hora', zh: '小时'}, 'Hora do primeiro bipe com o texto',
          b.horas.map(function (q, hh) { return {nome: (hh < 10 ? '0' : '') + hh + 'h', qtd: q}; }).filter(function (i) { return i.qtd; }), {pt: 'Hora', um: 'hora', zh: '小时'});
        colunas('b' + n + 'por', {pt: 'Bloco ' + n + ': quem mais escaneou', zh: '扫描人'}, 'Top 20 de ' + fmtInt(b.escaneadores.length),
          b.escaneadores, {pt: 'Escaneado por', um: 'escaneador', zh: '扫描人'});
      });
    }
    if (r.seg) {
      colunas('s1', {pt: 'Código de primeiro segmento', zh: '一段码'}, 'Top 20 de ' + fmtInt(r.seg.s1.length) + ' códigos', r.seg.s1, {pt: '1º segmento', um: '1º segmento', zh: '一段码'});
      colunas('s2', {pt: 'Código de dois segmentos', zh: '二段码'}, 'Top 20 de ' + fmtInt(r.seg.s2.length) + ' códigos', r.seg.s2, {pt: '2º segmento', um: '2º segmento', zh: '二段码'});
    }
  }
  function tabela(r) {
    var tab = $('dataTable');
    tab.querySelector('thead').innerHTML = '<tr>' + r.colunas.map(function (c) { return '<th>' + esc(c[1]) + '<small>' + esc(c[2]) + '</small></th>'; }).join('') + '</tr>';
    tab.querySelector('tbody').innerHTML = r.linhas.map(function (l) {
      return '<tr>' + r.colunas.map(function (c) {
        var v = l[c[0]] === undefined ? '' : String(l[c[0]]);
        var cls = /NÃO TEM IMAGEM|recusada|Sem rastreamento|Sem código/.test(v) ? ' class="pq-ruim"' : '';
        return '<td' + cls + ' title="' + esc(v) + '">' + esc(v.length > 90 ? v.slice(0, 88) + '…' : v) + '</td>';
      }).join('') + '</tr>';
    }).join('') || '<tr class="empty-row"><td colspan="' + r.colunas.length + '">Nenhuma remessa aqui.</td></tr>';
    $('tableCount').textContent = fmtInt(r.total) + (r.total === 1 ? ' remessa' : ' remessas');
    var paginas = Math.max(1, Math.ceil(r.total / r.tamanho)), p = r.pagina, hp = '', prev = 0;
    hp += '<button type="button" data-p="' + (p - 1) + '"' + (p <= 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>';
    for (var i = 1; i <= paginas; i++) {
      if (!(i === 1 || i === paginas || Math.abs(i - p) <= 1)) continue;
      if (i - prev > 1) hp += '<span>…</span>';
      hp += '<button type="button" data-p="' + i + '"' + (i === p ? ' class="active" aria-current="page"' : '') + '>' + i + '</button>';
      prev = i;
    }
    hp += '<button type="button" data-p="' + (p + 1) + '"' + (p >= paginas ? ' disabled' : '') + ' aria-label="Próxima página">›</button>';
    $('pager').innerHTML = hp;
    Array.prototype.forEach.call($('pager').querySelectorAll('button[data-p]'), function (b) {
      b.addEventListener('click', function () { st.pagina = Number(b.getAttribute('data-p')); carregar(false); });
    });
    $('planilhaNota').textContent = r.planilha ? 'Também na Google Planilha, aba "' + r.planilha + '".' : '';
  }
  function carregar(tudo) {
    if (!st.id) return;
    st.ultimaCarga = Date.now();
    var q = 'id=' + encodeURIComponent(st.id) + '&aba=' + st.aba + '&busca=' + encodeURIComponent(st.busca) + '&pagina=' + st.pagina + '&tamanho=' + st.tamanho;
    return pedir('api/pesquisa/resultado?' + q).then(function (r) {
      if (r.ok === false) return;
      $('resultado').classList.remove('hidden');
      $('excelBtn').disabled = !r.resumo.pesquisadas;
      st.estado = r.resumo.andamento.estado;
      if (r.resumo.andamento.estado !== 'rodando') mostrarAndamento(r.resumo.andamento);
      abas(r.resumo);
      cartoes(r.resumo);
      if (tudo || st.resumoId !== st.id || r.resumo.andamento.estado === 'rodando') { graficos(r.resumo); st.resumoId = st.id; }
      tabela(r);
    });
  }
  $('aba').addEventListener('change', function () { st.aba = this.value; st.pagina = 1; carregar(false); });
  var espera = null;
  $('busca').addEventListener('input', function () {
    var v = this.value;
    clearTimeout(espera);
    espera = setTimeout(function () { st.busca = v; st.pagina = 1; carregar(false); }, 300);
  });
  $('copiar').addEventListener('click', function () {
    pedir('api/pesquisa/remessas?id=' + encodeURIComponent(st.id) + '&aba=' + st.aba + '&busca=' + encodeURIComponent(st.busca)).then(function (r) {
      var t = r.remessas.join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () {
        aviso(fmtInt(r.remessas.length) + ' remessas copiadas: cole no JMS.');
      }, function () { window.prompt('Copie as remessas:', t); });
    });
  });

  // ---------------------------------------------------------------- tema, menu e começo
  function tema() {
    var b = $('themeBtn'), dark = document.documentElement.getAttribute('data-theme') === 'dark';
    b.setAttribute('aria-pressed', String(dark));
    b.title = dark ? 'Tema claro' : 'Tema escuro'; b.setAttribute('aria-label', b.title);
  }
  $('themeBtn').addEventListener('click', function () {
    var dark = document.documentElement.getAttribute('data-theme') !== 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('jt_theme', dark ? 'dark' : 'light'); } catch (e) { /* só nesta visita */ }
    tema(); G.cores(); carregar(true);
  });
  tema();
  function menu(abrir) { $('sidebar').classList.toggle('open', abrir); $('scrim').hidden = !abrir; $('menuBtn').setAttribute('aria-expanded', String(abrir)); }
  $('menuBtn').addEventListener('click', function () { menu(!$('sidebar').classList.contains('open')); });
  $('scrim').addEventListener('click', function () { menu(false); });
  pedir('api/estado').then(function (e) {
    $('brandCenter').textContent = e.base; $('eyebrowCenter').textContent = e.base; $('appVersion').textContent = 'v' + e.versao;
  }).catch(function () {});
  contar();
  (window.__chartLibs || Promise.resolve(false)).then(function () { G.cores(); estado(); });
})();
