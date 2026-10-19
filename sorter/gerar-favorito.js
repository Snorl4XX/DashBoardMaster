#!/usr/bin/env node
'use strict';
/**
 * Monta o FAVORITO do Painel do Sorter: um favorito do navegador que, clicado na página do sorter
 * (http://10.1.166.9/home), abre o painel inteiro por cima do site e lê os números direto — sem servidor e sem outro
 * computador. O favorito leva tudo dentro (a mesma página do painel local + site/navegador.js); só os gráficos (Chart.js)
 * e a fonte vêm da internet, como no painel local.
 *
 * Uso: node gerar-favorito.js [pasta]   → instalar-favorito.html (a página para pôr o favorito) e painel-sorter.js
 *      require('./gerar-favorito').montar() → {html, codigo, url}
 */
const fs = require('fs');
const path = require('path');
const ler = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

function inline(js, nome) {
  if (/<\/script/i.test(js)) throw new Error(nome + ' tem "</script" (quebraria a página do favorito).');
  return '<script>\n' + js + '\n</script>';
}
function trocar(s, de, para) {
  if (s.indexOf(de) < 0) throw new Error('public/index.html mudou: não achei ' + de);
  return s.replace(de, () => para);
}
/** A página do painel com tudo dentro, para a moldura do favorito. */
function paginaPainel() {
  const {VERSAO} = require('./server.js');
  let h = ler('public/index.html');
  h = trocar(h, '<link rel="stylesheet" href="app.css">', '<style>\n' + ler('public/app.css') + '\n</style>');
  const boot = 'window.__SORTER__ = {versao: ' + JSON.stringify(VERSAO) + ', site: true, atualizarSegundos: 3600, maxDias: 92, ' +
    'hoje: SorterEstado.agoraSP().date, sorters: window.__SORTER_FONTE__.sorters()};';
  h = trocar(h, '<script>window.__SORTER__ = __SORTER_BOOT__;</script>\n  <script src="resumo.js"></script>\n  <script src="planilha.js"></script>\n  <script src="app.js"></script>',
    [inline(ler('lib/resumo.js'), 'resumo.js'), inline(ler('lib/site.js'), 'site.js'), inline(ler('lib/estado.js'), 'estado.js'),
      inline(ler('lib/ponte.js'), 'ponte.js'), inline(ler('site/navegador.js'), 'navegador.js'), inline(boot, 'boot'), inline(ler('lib/planilha.js'), 'planilha.js'),
      inline(ler('public/app.js'), 'app.js')].join('\n'));
  if (/__SORTER_BOOT__|src="(resumo|planilha|app)\.js"/.test(h)) throw new Error('Sobrou referência a arquivo na página do favorito.');
  return h;
}
function montar() {
  const html = paginaPainel();
  const codigo = ler('site/favorito.js').replace('f.srcdoc = __PAINEL_HTML__;', () => 'f.srcdoc = ' + JSON.stringify(html).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';');
  // encodeURIComponent: as quebras de linha e os acentos sobrevivem ao colar no endereço do favorito.
  const url = 'javascript:' + encodeURIComponent(codigo + '\nvoid 0;');
  return {html, codigo, url};
}
/** A página para instalar o favorito (arrastar para a barra ou copiar). */
function paginaInstalar(m, arquivo) {
  const {VERSAO} = require('./server.js');
  // Como arquivo (abrir com dois cliques): com o cabeçalho de página; como página publicada: o miolo.
  return (arquivo ? '<!DOCTYPE html>\n<html lang="pt-BR">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' : '') + ler('site/instalar.html').replace('__VERSAO__', VERSAO).replace('__FAVORITO_URL__', () => m.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;'))
    .replace('__FAVORITO_JSON__', () => JSON.stringify(m.url).replace(/</g, '\\u003c'));
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(__dirname, 'dist'));
  fs.mkdirSync(out, {recursive: true});
  const m = montar();
  fs.writeFileSync(path.join(out, 'instalar-favorito.html'), paginaInstalar(m, true));
  fs.writeFileSync(path.join(out, 'painel-sorter.js'), m.codigo);
  console.log('Favorito: ' + Math.round(m.url.length / 1024) + ' KB · ' + path.join(out, 'instalar-favorito.html'));
}
module.exports = {montar, paginaPainel, paginaInstalar};
