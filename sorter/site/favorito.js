/**
 * PAINEL DO SORTER — o que roda ao clicar no favorito, na página do sorter (http://10.1.166.9/home): confere que é o site
 * do sorter e abre o painel por cima, numa moldura (iframe) da mesma origem. Fechar (botão "Fechar painel" ou Esc)
 * volta para o site. A página inteira do painel entra no lugar do marcador, no fim (gerar-favorito.js).
 *
 * "Ensinar a troca" (quando o painel não acha sozinho como trocar de sorter): o painel fecha e o favorito OBSERVA o
 * site — quando a pessoa clica em Cross-belt GRU-A (ou GRU-B), guarda o pedido que o site fez (endereço, método e
 * campos; o _token vira {token}, nunca o valor) no armazenamento deste site. Ao abrir o favorito de novo, o painel testa
 * esse pedido e passa a usá-lo.
 */
(function () {
  'use strict';
  var ID = '__jtSorterPainel';
  var aberto = document.getElementById(ID);
  if (aberto) { aberto.style.display = 'block'; return; }
  var fim = new Date(), ini = new Date(fim.getTime() - 86400000);
  var dia = function (d) { return d.toISOString().slice(0, 10); };
  var teste = '/statis/summary.data?page=1&limit=1&start=' + encodeURIComponent(dia(ini) + ' 00:00:00') + '&end=' +
    encodeURIComponent(dia(fim) + ' 23:59:59') + '&group=0&inductionno=0&layerno=0';
  window.__jtSorterEnsinar = function () { aprender(); };
  fetch(teste, {credentials: 'same-origin', cache: 'no-store'}).then(function (r) { return r.json(); }).then(function (j) {
    if (!j || Number(j.code) !== 1) throw new Error('code');
    abrir();
  }).catch(function () {
    alert('Painel do Sorter: abra a página do sorter (http://10.1.166.9/home) neste navegador e clique no favorito de novo.\n\n' +
      'Esta página (' + location.host + ') não é o site do sorter.');
  });

  function abrir() {
    var raiz = document.documentElement, overflow = raiz.style.overflow;
    var box = document.createElement('div');
    box.id = ID;
    box.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:#0E0F13;margin:0;padding:0;border:0;display:block');
    var f = document.createElement('iframe');
    f.setAttribute('title', 'Painel do Sorter');
    f.setAttribute('style', 'border:0;width:100%;height:100%;display:block;background:#0E0F13');
    var x = document.createElement('button');
    x.type = 'button';
    x.textContent = '✕ Fechar painel';
    x.title = 'Volta para o site do sorter (Esc)';
    x.setAttribute('style', 'position:absolute;left:16px;bottom:16px;z-index:2;font:700 13px Arial,sans-serif;color:#fff;background:#E60012;' +
      'border:0;border-radius:999px;padding:10px 16px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35)');
    var fechar = function () {
      box.parentNode && box.parentNode.removeChild(box);
      raiz.style.overflow = overflow;
      document.removeEventListener('keydown', esc, true);
    };
    var esc = function (e) { if (e.key === 'Escape') fechar(); };
    window.__jtSorterEnsinar = function () { fechar(); aprender(); };
    x.addEventListener('click', fechar);
    document.addEventListener('keydown', esc, true);
    box.appendChild(f);
    box.appendChild(x);
    document.body.appendChild(box);
    raiz.style.overflow = 'hidden';
    f.addEventListener('load', function () { try { f.contentWindow.addEventListener('keydown', esc, true); } catch (e) { /* sem Esc */ } });
    f.srcdoc = __PAINEL_HTML__;
  }

  // ---------- Ensinar a troca: observa a escolha de Cross-belt GRU-A / GRU-B no site ----------
  function aprender() {
    var CHAVE = 'jt_sorter_aprendido', alvo = '', ate = 0;
    var ROT = [['A', /GRU[-_\s]?A(?![A-Za-z0-9])/i], ['B', /GRU[-_\s]?B(?![A-Za-z0-9])/i]];
    var faixa = document.createElement('div');
    faixa.id = '__jtSorterAprender';
    faixa.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:2147483647;background:#E60012;color:#fff;font:600 15px/1.4 Arial,sans-serif;' +
      'padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;box-shadow:0 4px 14px rgba(0,0,0,.3)');
    var msg = document.createElement('span');
    msg.textContent = 'Painel do Sorter · Ensinando a troca: no site, clique em "switch device" e escolha Cross-belt GRU-A. Depois clique no favorito de novo.';
    var cancelar = document.createElement('button');
    cancelar.type = 'button';
    cancelar.textContent = 'Cancelar';
    cancelar.setAttribute('style', 'margin-left:auto;font:700 13px Arial,sans-serif;background:#fff;color:#E60012;border:0;border-radius:999px;padding:7px 14px;cursor:pointer');
    cancelar.addEventListener('click', function () { faixa.parentNode && faixa.parentNode.removeChild(faixa); alvo = ''; });
    faixa.appendChild(msg); faixa.appendChild(cancelar);
    document.body.appendChild(faixa);
    var ativo = function () { return !!faixa.parentNode; };

    /** Qual sorter a pessoa escolheu: o texto do que foi clicado (ou de quem o contém). */
    function qual(el) {
      for (var i = 0; el && i < 5; i++, el = el.parentElement) {
        var tx = String(el.innerText || el.textContent || el.value || '');
        if (tx.length > 300) continue;
        for (var k = 0; k < ROT.length; k++) if (ROT[k][1].test(tx)) return ROT[k][0];
      }
      return '';
    }
    function caminho(url, win) {
      try {
        var u = new URL(String(url), win.location.href);
        if (u.origin !== location.origin) return null;
        return u.pathname + u.search;
      } catch (e) { return null; }
    }
    function corpoDe(b) {
      if (b === undefined || b === null || b === '') return undefined;
      var t = '';
      try {
        if (typeof b === 'string') t = b;
        else if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) t = b.toString();
        else if (typeof FormData !== 'undefined' && b instanceof FormData) t = new URLSearchParams(b).toString();
        else return undefined;
      } catch (e) { return undefined; }
      if (/^\s*\{/.test(t)) {
        try { var o = JSON.parse(t); if ('_token' in o) o._token = '{token}'; return o; } catch (e) { /* segue como texto */ }
      }
      return t.replace(/(^|&)_token=[^&]*/, '$1_token={token}');
    }
    /** Guarda o primeiro pedido ao site depois da escolha (não as consultas da tabela nem arquivos). */
    function registrar(metodo, url, corpo, win) {
      if (!ativo() || !alvo || Date.now() > ate) return;
      var c = caminho(url, win || window);
      if (!c || /statis\/summary|\.(js|css|png|jpe?g|gif|svg|ico|woff2?)(\?|$)/i.test(c)) return;
      var m = String(metodo || 'GET').toUpperCase();
      if (m === 'GET' && /^\/(home)?\/?(\?.*)?$/.test(c)) return;
      var salvo = {};
      try { salvo = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) { salvo = {}; }
      salvo[alvo] = {metodo: m, caminho: c, corpo: corpoDe(corpo)};
      salvo.quando = new Date().toISOString();
      try { localStorage.setItem(CHAVE, JSON.stringify(salvo)); } catch (e) { /* sem armazenamento */ }
      msg.textContent = 'Painel do Sorter · Aprendi a troca para o GRU-' + alvo + ' ✓ Clique no favorito de novo (se a página recarregar, clique depois que ela abrir).';
      alvo = '';
    }
    function observar(win) {
      try {
        if (!win || win.__jtSorterObservando) return;
        win.__jtSorterObservando = true;
        var X = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
        if (X) {
          var abrirX = X.open, enviar = X.send;
          X.open = function (m, u) { this.__jt = [m, u]; return abrirX.apply(this, arguments); };
          X.send = function (b) { try { if (this.__jt) registrar(this.__jt[0], this.__jt[1], b, win); } catch (e) { /* segue */ } return enviar.apply(this, arguments); };
        }
        if (win.fetch) {
          var f0 = win.fetch;
          win.fetch = function (u, o) {
            try { registrar((o && o.method) || (u && u.method) || 'GET', typeof u === 'string' ? u : u && u.url, o && o.body, win); } catch (e) { /* segue */ }
            return f0.apply(this, arguments);
          };
        }
        var d = win.document;
        d.addEventListener('click', function (e) {
          if (!ativo() || faixa.contains(e.target)) return;
          var q = qual(e.target);
          if (q) { alvo = q; ate = Date.now() + 60000; }
          var a = e.target.closest ? e.target.closest('a[href]') : null;
          if (a && q && !/^(javascript:|#)/i.test(a.getAttribute('href'))) registrar('GET', a.href, null, win);
        }, true);
        d.addEventListener('change', function (e) {
          var el = e.target, q = '';
          if (el && el.tagName === 'SELECT') q = qual(el.options[el.selectedIndex]);
          else if (el && el.labels && el.labels[0]) q = qual(el.labels[0]);
          if (!q && el) q = qual(el.parentElement);
          if (q) { alvo = q; ate = Date.now() + 60000; }
        }, true);
        d.addEventListener('submit', function (e) {
          var fm = e.target;
          if (!alvo) { var sel = fm.querySelector('option:checked, input:checked'); alvo = sel ? qual(sel.tagName === 'OPTION' ? sel : sel.parentElement) : ''; ate = Date.now() + 60000; }
          var dados = '';
          try { dados = new URLSearchParams(new FormData(fm)).toString(); } catch (er) { dados = ''; }
          var m = (fm.getAttribute('method') || 'GET').toUpperCase(), acao = fm.getAttribute('action') || win.location.href;
          if (m === 'GET') registrar('GET', acao + (dados ? (acao.indexOf('?') >= 0 ? '&' : '?') + dados : ''), null, win);
          else registrar(m, acao, dados, win);
        }, true);
        // Janelas dentro do site (layer.open com iframe): observa também.
        var ver = function () { Array.prototype.forEach.call(d.querySelectorAll('iframe'), function (fr) {
          try { observar(fr.contentWindow); fr.addEventListener('load', function () { try { fr.contentWindow.__jtSorterObservando = false; observar(fr.contentWindow); } catch (e2) { /* outra origem */ } }); } catch (e1) { /* outra origem */ }
        }); };
        ver();
        if (win.MutationObserver) new win.MutationObserver(ver).observe(d.documentElement, {childList: true, subtree: true});
      } catch (e) { /* janela de outra origem */ }
    }
    observar(window);
  }
})();
