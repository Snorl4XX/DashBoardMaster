#!/usr/bin/env node
'use strict';
/**
 * Gera o pacote do Painel do Sorter: JT_SORTER_B_V<versão>.zip, com a pasta "sorter/" (sem os testes e sem o config.json,
 * que é criado na primeira vez). Separado do pacote do DashMaster.
 * Uso: node gerar-zip.js [pasta de saída]   (padrão: dist/ dentro desta pasta)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {VERSAO} = require('./server.js');

const FILES = ['server.js', 'lib/resumo.js', 'lib/sorter.js', 'public/index.html', 'public/app.js', 'public/app.css',
  'iniciar.bat', 'iniciar-com-windows.bat', 'testar.bat', 'LEIA_SORTER.md'];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** ZIP (deflate) com data fixa (1980-01-01): o mesmo conteúdo gera o mesmo arquivo. */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  entries.forEach(e => {
    const name = Buffer.from(e.name, 'utf8'), data = e.data, comp = zlib.deflateRawSync(data, {level: 9}), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + comp.length;
  });
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

const outDir = path.resolve(process.argv[2] || path.join(__dirname, 'dist'));
fs.mkdirSync(outDir, {recursive: true});
const entries = FILES.map(f => {
  let data = fs.readFileSync(path.join(__dirname, f));
  // .bat com fim de linha do Windows (CRLF): o cmd lê os rótulos (goto) sem erro.
  if (/\.bat$/.test(f)) data = Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
  return {name: 'sorter/' + f, data};
});
const tag = 'V' + VERSAO.split('.').slice(0, 2).join('_');
const file = path.join(outDir, 'JT_SORTER_B_' + tag + '.zip');
fs.writeFileSync(file, zip(entries));
console.log(file + ' (' + entries.length + ' arquivos)');
