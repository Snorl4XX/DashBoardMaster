#!/usr/bin/env node
'use strict';
/**
 * Gera o pacote do Monitor: MONITOR_RECEBIMENTO_V<versão>.zip, com a pasta "monitor-recebimento/" (sem os testes, a pasta
 * dados e o config.json de quem gerou). Separado dos pacotes do DashMaster.
 * Uso: node gerar-zip.js [pasta de saída]   (padrão: dist/ dentro desta pasta)
 */
const fs = require('fs');
const path = require('path');
const {zip} = require('../node/lib/report');
const {version} = require('./package.json');

const ARQUIVOS = ['Recebimento_SP_GRU.gs', 'Painel.gs', 'Index.html', 'server.js', 'package.json', 'LEIA-ME.txt',
  'iniciar.bat', 'iniciar-com-windows.bat', 'link-publico.bat',
  'lib/apps-script.js', 'lib/auth.js', 'lib/banco.js', 'lib/coleta.js', 'lib/config.js', 'lib/fetch-worker.js', 'lib/link.js', 'lib/quieto.js',
  'lib/syncfetch.js'];

function gerar(saida) {
  const faltando = fs.readdirSync(path.join(__dirname, 'lib')).map(f => 'lib/' + f).filter(f => ARQUIVOS.indexOf(f) < 0);
  if (faltando.length) throw new Error('Arquivo fora da lista do pacote: ' + faltando.join(', ') + ' (inclua em ARQUIVOS).');
  const pasta = path.resolve(saida || path.join(__dirname, 'dist'));
  fs.mkdirSync(pasta, {recursive: true});
  const destino = path.join(pasta, 'MONITOR_RECEBIMENTO_V' + version.split('.').slice(0, version.endsWith('.0') ? 2 : 3).join('_') + '.zip');
  fs.writeFileSync(destino, zip(ARQUIVOS.map(f => ({name: 'monitor-recebimento/' + f, data: fs.readFileSync(path.join(__dirname, f))}))));
  return destino;
}

if (require.main === module) console.log(gerar(process.argv[2]));
module.exports = {gerar, ARQUIVOS};
