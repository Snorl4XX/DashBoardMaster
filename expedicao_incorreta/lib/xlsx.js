'use strict';
/**
 * Planilhas .xlsx sem instalar nada: lê (rotinhas.xlsx, rotas.xlsx) e escreve (rotas.xlsx de exemplo, Excel da tabela).
 * Um .xlsx é um ZIP com XML dentro. Aqui só o que estas planilhas usam: texto, números, várias abas, cabeçalho em negrito.
 */
const zlib = require('zlib');

// ------------------------------------------------------------------ ZIP
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** ZIP (deflate) com data fixa (1980-01-01): o mesmo conteúdo gera o mesmo arquivo. entries = [{name, data: Buffer|string}]. */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  entries.forEach(e => {
    const name = Buffer.from(e.name, 'utf8'), data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const comp = zlib.deflateRawSync(data, {level: 9}), crc = crc32(data);
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
    offset += local.length + name.length + comp.length;
  });
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

/** Arquivos de um ZIP pelo diretório central (aceita "data descriptor", que o Excel e o WPS usam). → {nome: Buffer} */
function unzip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Arquivo vazio ou que não é .xlsx.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('Este arquivo não é um .xlsx (salve a planilha como "Pasta de Trabalho do Excel").');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('.xlsx danificado (diretório do ZIP).');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), localAt = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const raw = buf.slice(start, start + size);
    if (!/\/$/.test(name)) out[name] = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ------------------------------------------------------------------ XML
function decode(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) =>
    e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" :
      String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
    // Caracteres de controle quebram o XML do Excel.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
/** Texto de <si> ou <is>: junta os pedaços <t> (texto com formatação vem em vários <r><t>). */
function textOf(xml) {
  let s = '';
  xml.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g, (m, t) => { s += t === undefined ? '' : t; return m; });
  return decode(s);
}
/** "AB" → 27 (coluna 1 = A). */
function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

// ------------------------------------------------------------------ leitura
/**
 * Abas do .xlsx → [{nome, linhas: [[valor, …], …]}]. Valores: texto ou número; célula vazia = ''. Linhas vazias no fim saem.
 * Aguenta a rotinha real (40 MB de XML, com 245 mil linhas só de formatação).
 */
function lerXlsx(buf) {
  const files = unzip(buf);
  const wb = files['xl/workbook.xml'];
  if (!wb) throw new Error('Este arquivo não é uma planilha do Excel (.xlsx).');
  const rels = {};
  String(files['xl/_rels/workbook.xml.rels'] || '').replace(/<Relationship\b([^>]*)\/?>/g, (m, a) => {
    const id = /\bId="([^"]+)"/.exec(a), target = /\bTarget="([^"]+)"/.exec(a);
    if (id && target) rels[id[1]] = target[1];
    return m;
  });
  const shared = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) String(ss).replace(/<si>([\s\S]*?)<\/si>|<si\/>/g, (m, inner) => { shared.push(inner === undefined ? '' : textOf(inner)); return m; });
  const sheets = [];
  String(wb).replace(/<sheet\b([^>]*)\/?>/g, (m, a) => {
    const nome = /\bname="([^"]*)"/.exec(a), rid = /\br:id="([^"]+)"/.exec(a) || /\bid="([^"]+)"/.exec(a);
    let target = rid && rels[rid[1]] ? rels[rid[1]] : '';
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    sheets.push({nome: nome ? decode(nome[1]) : 'Planilha', arquivo: target ? 'xl/' + target : ''});
    return m;
  });
  return sheets.map((s, i) => {
    const xml = files[s.arquivo] || files['xl/worksheets/sheet' + (i + 1) + '.xml'];
    return {nome: s.nome, linhas: xml ? lerAba(xml.toString('utf8'), shared) : []};
  });
}
function lerAba(xml, shared) {
  const linhas = [];
  const a = xml.indexOf('<sheetData'), b = xml.lastIndexOf('</sheetData>');
  const data = a >= 0 && b > a ? xml.slice(a, b) : '';
  // Só as células com conteúdo (<c …>…</c>); as vazias (<c …/>) ficam de fora. Busca simples (indexOf), sem expressão
  // que volte atrás: a rotinha tem 1,4 milhão de células vazias.
  let pos = 0;
  for (;;) {
    const i = data.indexOf('<c ', pos);
    if (i < 0) break;
    const j = data.indexOf('>', i);
    if (j < 0) break;
    if (data.charCodeAt(j - 1) === 47 /* "/" */) { pos = j + 1; continue; }
    const k = data.indexOf('</c>', j);
    if (k < 0) break;
    const attrs = data.slice(i + 3, j), inner = data.slice(j + 1, k);
    pos = k + 4;
    const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (!ref) continue;
    const t = /\bt="([^"]+)"/.exec(attrs), type = t ? t[1] : 'n';
    let val;
    if (type === 'inlineStr') val = textOf(inner);
    else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!v) continue;
      val = type === 's' ? (shared[Number(v[1])] === undefined ? '' : shared[Number(v[1])]) : type === 'n' ? Number(v[1]) : decode(v[1]);
      if (type === 'b') val = v[1] === '1' ? 'VERDADEIRO' : 'FALSO';
    }
    if (val === '' || (typeof val === 'number' && !isFinite(val))) continue;
    const row = Number(ref[2]) - 1, col = colNum(ref[1]) - 1;
    while (linhas.length <= row) linhas.push([]);
    const r = linhas[row];
    while (r.length < col) r.push('');
    r[col] = val;
  }
  while (linhas.length && !linhas[linhas.length - 1].some(v => v !== '')) linhas.pop();
  return linhas;
}

// ------------------------------------------------------------------ escrita
/**
 * abas = [{nome, linhas: [[…]], larguras: [n…]}]. A 1ª linha de cada aba sai em negrito (cabeçalho) e fica fixa no topo.
 * Texto vai como inlineStr (sem sharedStrings); números como número.
 */
function escreverXlsx(abas) {
  const sheetXml = aba => {
    const cols = (aba.larguras || []).map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('');
    const rows = (aba.linhas || []).map((linha, r) => '<row r="' + (r + 1) + '">' + linha.map((v, c) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = colName(c + 1) + (r + 1), s = r === 0 ? ' s="1"' : '';
      return typeof v === 'number' && isFinite(v) ? '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>'
        : '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    }).join('') + '</row>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + rows + '</sheetData></worksheet>';
  };
  const n = abas.length;
  const files = [
    {name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      abas.map((a, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '</Types>'},
    {name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      abas.map((a, i) => '<sheet name="' + esc(String(a.nome).slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'},
    {name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      abas.map((a, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE60012"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>'}
  ].concat(abas.map((a, i) => ({name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(a)})));
  return zip(files);
}

module.exports = {zip, unzip, lerXlsx, escreverXlsx, crc32};
