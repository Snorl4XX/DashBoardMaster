/* Gráficos do painel sem biblioteca: barras horizontais (uma série, uma cor) e rosca dos turnos (SVG).
 * Os nomes vêm do JMS: entram sempre por textContent. Cada barra/fatia mostra o valor na dica (mouse ou teclado). */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var fmt = function (n) { return Number(n || 0).toLocaleString('pt-BR'); };
  var pct = function (n) { return Number(n || 0).toLocaleString('pt-BR', {maximumFractionDigits: 1}) + '%'; };

  var dica = null;
  function mostrarDica(alvo, valor, rotulo, ev) {
    dica = dica || document.getElementById('dica');
    if (!dica) return;
    dica.textContent = '';
    var b = document.createElement('b'); b.textContent = valor;
    var s = document.createElement('span'); s.textContent = rotulo;
    dica.appendChild(b); dica.appendChild(s);
    dica.classList.remove('oculto');
    var r = alvo.getBoundingClientRect();
    var x = ev && ev.clientX ? ev.clientX + 14 : r.right + 8, y = ev && ev.clientY ? ev.clientY + 14 : r.top;
    var w = dica.offsetWidth, h = dica.offsetHeight;
    dica.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    dica.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
  }
  function esconderDica() { if (dica) dica.classList.add('oculto'); }
  function comDica(el, valor, rotulo) {
    el.tabIndex = 0;
    el.setAttribute('aria-label', rotulo + ': ' + valor);
    el.addEventListener('mousemove', function (ev) { mostrarDica(el, valor, rotulo, ev); });
    el.addEventListener('mouseleave', esconderDica);
    el.addEventListener('focus', function () { mostrarDica(el, valor, rotulo); });
    el.addEventListener('blur', esconderDica);
  }

  /** itens = [{nome, qtd, rota?}]; total = base da porcentagem na dica (opcional). */
  function barras(el, itens, total, vazio) {
    el.textContent = '';
    if (!itens || !itens.length) {
      var v = document.createElement('div'); v.className = 'vazio'; v.textContent = vazio || 'Nenhum pacote errado neste recorte.';
      el.appendChild(v); return;
    }
    var max = itens.reduce(function (m, i) { return Math.max(m, i.qtd); }, 0) || 1;
    var caixa = document.createElement('div'); caixa.className = 'barras';
    itens.forEach(function (i) {
      var linha = document.createElement('div'); linha.className = 'barra-linha';
      var nome = document.createElement('div'); nome.className = 'barra-nome';
      nome.textContent = i.rota ? i.nome + ' · ' + i.rota : i.nome;
      var trilho = document.createElement('div'); trilho.className = 'barra-trilho';
      var cheia = document.createElement('div'); cheia.className = 'barra-cheia';
      // Largura em % do trilho, guardando espaço para o número na ponta.
      cheia.style.width = 'calc((100% - 64px) * ' + (i.qtd / max).toFixed(4) + ')';
      var valor = document.createElement('span'); valor.className = 'barra-valor'; valor.textContent = fmt(i.qtd);
      trilho.appendChild(cheia); trilho.appendChild(valor);
      linha.appendChild(nome); linha.appendChild(trilho);
      comDica(linha, fmt(i.qtd) + ' errados' + (total ? ' · ' + pct(i.qtd / total * 100) : ''), nome.textContent);
      caixa.appendChild(linha);
    });
    el.appendChild(caixa);
  }

  /** fatias = [{rotulo, valor, cor (var CSS), detalhe}]; centro = {valor, rotulo}. */
  function rosca(el, fatias, centro) {
    el.textContent = '';
    var total = fatias.reduce(function (s, f) { return s + f.valor; }, 0);
    var caixa = document.createElement('div'); caixa.className = 'rosca';
    var svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Turnos: ' + fatias.map(function (f) { return f.rotulo + ' ' + f.valor; }).join(', '));
    var R = 46, C = 2 * Math.PI * R, GAP = total > 0 && fatias.filter(function (f) { return f.valor > 0; }).length > 1 ? 1.5 : 0;
    var trilho = document.createElementNS(NS, 'circle');
    trilho.setAttribute('cx', 60); trilho.setAttribute('cy', 60); trilho.setAttribute('r', R); trilho.setAttribute('fill', 'none');
    trilho.setAttribute('stroke', 'var(--grade)'); trilho.setAttribute('stroke-width', 16);
    svg.appendChild(trilho);
    var ini = 0;
    fatias.forEach(function (f) {
      if (!total || !f.valor) return;
      var tam = f.valor / total * C;
      var arco = document.createElementNS(NS, 'circle');
      arco.setAttribute('class', 'arco');
      arco.setAttribute('cx', 60); arco.setAttribute('cy', 60); arco.setAttribute('r', R); arco.setAttribute('fill', 'none');
      arco.setAttribute('stroke', f.cor); arco.setAttribute('stroke-width', 16);
      arco.setAttribute('stroke-dasharray', Math.max(0.01, tam - GAP) + ' ' + (C - Math.max(0.01, tam - GAP)));
      arco.setAttribute('stroke-dashoffset', String(-ini));
      arco.setAttribute('transform', 'rotate(-90 60 60)');
      comDica(arco, fmt(f.valor) + ' errados · ' + pct(f.valor / total * 100), f.rotulo);
      svg.appendChild(arco);
      ini += tam;
    });
    var t1 = document.createElementNS(NS, 'text');
    t1.setAttribute('x', 60); t1.setAttribute('y', 60); t1.setAttribute('text-anchor', 'middle'); t1.setAttribute('font-size', 22);
    t1.setAttribute('font-weight', 700); t1.setAttribute('fill', 'var(--tinta)'); t1.textContent = centro.valor;
    var t2 = document.createElementNS(NS, 'text');
    t2.setAttribute('x', 60); t2.setAttribute('y', 76); t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('font-size', 9);
    t2.setAttribute('fill', 'var(--tinta-2)'); t2.textContent = centro.rotulo;
    svg.appendChild(t1); svg.appendChild(t2);
    var leg = document.createElement('div'); leg.className = 'legenda';
    fatias.forEach(function (f) {
      var l = document.createElement('div');
      var ch = document.createElement('span'); ch.className = 'chave'; ch.style.background = f.cor;
      var nome = document.createElement('span'); nome.textContent = f.rotulo;
      var val = document.createElement('b'); val.textContent = fmt(f.valor);
      var det = document.createElement('span'); det.style.color = 'var(--tinta-2)'; det.textContent = f.detalhe || '';
      l.appendChild(ch); l.appendChild(nome); l.appendChild(val); l.appendChild(det);
      leg.appendChild(l);
    });
    caixa.appendChild(svg); caixa.appendChild(leg);
    el.appendChild(caixa);
  }

  window.Graficos = {barras: barras, rosca: rosca, fmt: fmt, pct: pct};
})();
