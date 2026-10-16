#!/usr/bin/env node
'use strict';
/**
 * Monta os arquivos do projeto Apps Script do sorter (pasta appscript/) a partir da MESMA página do painel local:
 *   Resumo.gs   = lib/resumo.js (soma e agrupamentos; a página recebe o mesmo código por resumoSource_)
 *   Index.html  = public/index.html com os <?!= … ?> do Apps Script
 *   Estilo.html = public/app.css  ·  App.html = public/app.js
 * O Codigo.gs e o appsscript.json são escritos à mão (ficam em appscript/).
 * Uso: node gerar-appscript.js            → grava em appscript/
 *      node gerar-appscript.js --conferir → só confere se appscript/ está igual (testes)
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'appscript');
const ler = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const AVISO = 'Gerado por gerar-appscript.js a partir de ';

function trocar(html, de, para) {
  if (html.indexOf(de) < 0) throw new Error('public/index.html mudou: não achei ' + de);
  return html.replace(de, para);
}
function arquivos() {
  let index = ler('public/index.html');
  index = trocar(index, '<link rel="stylesheet" href="app.css">', "<?!= include('Estilo'); ?>");
  index = trocar(index, '<script>window.__SORTER__ = __SORTER_BOOT__;</script>', '<script>window.__SORTER__ = <?!= boot ?>;</script>');
  index = trocar(index, '<script src="resumo.js"></script>', '<script><?!= resumoSource_(); ?></script>');
  index = trocar(index, '<script src="app.js"></script>', "<?!= include('App'); ?>");
  if (/<\?(?!!= (include\('(Estilo|App)'\);|boot|resumoSource_\(\);) \?>)/.test(index)) throw new Error('Index.html com <? inesperado.');
  return {
    'Resumo.gs': '/* ' + AVISO + 'lib/resumo.js: não edite aqui. */\n' + ler('lib/resumo.js'),
    'Index.html': index.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- ' + AVISO + 'public/index.html: não edite aqui. -->'),
    'Estilo.html': '<!-- ' + AVISO + 'public/app.css: não edite aqui. -->\n<style>\n' + ler('public/app.css') + '</style>\n',
    'App.html': '<!-- ' + AVISO + 'public/app.js: não edite aqui. -->\n<script>\n' + ler('public/app.js') + '</script>\n'
  };
}

if (require.main === module) {
  const files = arquivos();
  if (process.argv.indexOf('--conferir') > 0) {
    const dif = Object.keys(files).filter(f => !fs.existsSync(path.join(DIR, f)) || fs.readFileSync(path.join(DIR, f), 'utf8') !== files[f]);
    if (dif.length) { console.error('appscript/ desatualizado: ' + dif.join(', ') + ' (rode node gerar-appscript.js)'); process.exit(1); }
    console.log('appscript/ em dia.');
  } else {
    fs.mkdirSync(DIR, {recursive: true});
    Object.keys(files).forEach(f => fs.writeFileSync(path.join(DIR, f), files[f]));
    console.log('Gravados em appscript/: ' + Object.keys(files).join(', ') + ' (mais Codigo.gs e appsscript.json, escritos à mão).');
  }
}
module.exports = {arquivos};
