/**
 * PAINEL DO SORTER — o que roda ao clicar no favorito, na página do sorter (http://10.1.166.9/home): confere que é o site
 * do sorter e abre o painel por cima, numa moldura (iframe) da mesma origem. Fechar (botão "Fechar painel" ou Esc)
 * volta para o site. A página inteira do painel entra no lugar do marcador, no fim (gerar-favorito.js).
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
    x.addEventListener('click', fechar);
    document.addEventListener('keydown', esc, true);
    box.appendChild(f);
    box.appendChild(x);
    document.body.appendChild(box);
    raiz.style.overflow = 'hidden';
    f.addEventListener('load', function () { try { f.contentWindow.addEventListener('keydown', esc, true); } catch (e) { /* sem Esc */ } });
    f.srcdoc = __PAINEL_HTML__;
  }
})();
