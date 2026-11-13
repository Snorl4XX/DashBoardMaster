#!/usr/bin/env node
'use strict';
/**
 * Gera o pacote do app: ROTA_CERTA_V<versão>.zip, com a pasta "rota_certa/" (sem os testes, o banco, o config.json e as
 * planilhas de quem gerou: a tabela de rotas é criada na primeira vez com a do SC). Separado do pacote do DashMaster.
 * Uso: node gerar-zip.js [pasta de saída]   (padrão: dist/ dentro desta pasta)
 */
const fs = require('fs');
const path = require('path');
const {zip} = require('./lib/xlsx');
const {version} = require('./package.json');

const ARQUIVOS = ['server.js', 'package.json', 'LEIA-ME.txt', 'iniciar.bat', 'link-publico.bat',
  'lib/coletor.js', 'lib/db.js', 'lib/jms.js', 'lib/painel.js', 'lib/quieto.js', 'lib/rotas.js', 'lib/rotas_padrao.js', 'lib/status.js', 'lib/xlsx.js',
  'public/index.html', 'public/app.js', 'public/graficos.js', 'public/config.html', 'public/config.js', 'public/entrar.html', 'public/estilo.css'];

function gerar(saida) {
  const lib = fs.readdirSync(path.join(__dirname, 'lib')).map(f => 'lib/' + f), pub = fs.readdirSync(path.join(__dirname, 'public')).map(f => 'public/' + f);
  const faltando = lib.concat(pub).filter(f => ARQUIVOS.indexOf(f) < 0);
  if (faltando.length) throw new Error('Arquivo fora da lista do pacote: ' + faltando.join(', ') + ' (inclua em ARQUIVOS).');
  const pasta = path.resolve(saida || path.join(__dirname, 'dist'));
  fs.mkdirSync(pasta, {recursive: true});
  const destino = path.join(pasta, 'ROTA_CERTA_V' + version.split('.').slice(0, version.endsWith('.0') ? 2 : 3).join('_') + '.zip');
  fs.writeFileSync(destino, zip(ARQUIVOS.map(f => ({name: 'rota_certa/' + f, data: fs.readFileSync(path.join(__dirname, f))}))));
  return destino;
}

if (require.main === module) console.log(gerar(process.argv[2]));
module.exports = {gerar, ARQUIVOS};
