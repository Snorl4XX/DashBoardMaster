'use strict';
/**
 * Relatórios sem Google: a planilha temporária que o Report.gs monta (na memória) vira
 *  - Excel (.xlsx): gerado aqui mesmo, com os valores, formatos de número, cores, negrito, mesclas e larguras;
 *  - PDF: a planilha vira uma página HTML (tabelas + gráficos desenhados) e o Edge/Chrome do computador imprime em PDF.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {spawnSync} = require('child_process');

const TZ = 'America/Sao_Paulo';

// ------------------------------------------------------------------ utilidades
function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function xmlEsc(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function htmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function argb(c) {
  let h = String(c || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? 'FF' + h.toUpperCase() : null;
}
function localParts(d) {
  const p = new Intl.DateTimeFormat('en-US', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).formatToParts(d);
  const g = t => Number(p.find(x => x.type === t).value);
  return {y: g('year'), m: g('month'), d: g('day'), H: g('hour') % 24, M: g('minute'), S: g('second')};
}
/** Data → número de série do Excel (horário de São Paulo, como a planilha do Google). */
function excelSerial(d) {
  const p = localParts(d);
  return (Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Usado do intervalo: última linha/coluna com conteúdo, estilo ou mescla. */
function usedSize(sh) {
  let rows = sh.getLastRow(), cols = 0;
  sh.data.forEach(row => { if (row) for (let j = row.length - 1; j >= 0; j--) if (row[j] !== '' && row[j] !== undefined) { cols = Math.max(cols, j + 1); break; } });
  sh.merges.forEach(m => { rows = Math.max(rows, m.r + m.nr - 1); cols = Math.max(cols, m.c + m.nc - 1); });
  return {rows, cols};
}
function styleAt(sh, r, c) {
  const st = Object.assign({}, sh.styles.get(r + ':' + c) || {});
  if (!st.bg) {
    sh.banding.forEach(b => b.ranges.forEach(x => {
      if (r >= x.r && r < x.r + x.nr && c >= x.c && c < x.c + x.nc && r % 2 === 0) st.bg = b.bg;
    }));
  }
  return st;
}

// ------------------------------------------------------------------ ZIP (para o .xlsx)
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  files.forEach(f => {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data, {level: 6});
    const crc = zlib.crc32(data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    locals.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38); c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += h.length + name.length + comp.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat(locals.concat([cd, end]));
}

// ------------------------------------------------------------------ Excel
function toXlsx(ss) {
  const sheets = ss.getSheets();
  const numFmts = new Map(), fonts = new Map(), fills = new Map(), xfs = new Map();
  const fontList = ['<font><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>'];
  fonts.set('0|10|', 0);
  const fillList = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const xfList = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  xfs.set('', 0);
  const fmtId = code => {
    if (!code) return 0;
    if (code === '@') return 49;
    if (!numFmts.has(code)) numFmts.set(code, 164 + numFmts.size);
    return numFmts.get(code);
  };
  const fontId = st => {
    const key = (st.bold ? 1 : 0) + '|' + (st.size || 10) + '|' + (argb(st.color) || '');
    if (!fonts.has(key)) {
      fonts.set(key, fontList.length);
      fontList.push('<font>' + (st.bold ? '<b/>' : '') + '<sz val="' + (st.size || 10) + '"/><color rgb="' + (argb(st.color) || 'FF000000') + '"/><name val="Arial"/></font>');
    }
    return fonts.get(key);
  };
  const fillId = st => {
    const c = argb(st.bg);
    if (!c) return 0;
    if (!fills.has(c)) { fills.set(c, fillList.length); fillList.push('<fill><patternFill patternType="solid"><fgColor rgb="' + c + '"/><bgColor indexed="64"/></patternFill></fill>'); }
    return fills.get(c);
  };
  const xfId = (st, isDateVal) => {
    const fmt = st.numberFormat || (isDateVal ? 'dd/mm/yyyy' : '');
    const key = JSON.stringify([fmt, st.bold, st.size, st.color, st.bg, st.wrap, st.halign, st.valign, st.border]);
    if (key === JSON.stringify(['', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined])) return 0;
    if (!xfs.has(key)) {
      const nf = fmtId(fmt), fo = fontId(st), fi = fillId(st), bo = st.border ? 1 : 0;
      const al = (st.halign || st.valign || st.wrap) ? '<alignment' + (st.halign ? ' horizontal="' + ({left: 'left', center: 'center', right: 'right'}[st.halign] || 'general') + '"' : '') +
        (st.valign ? ' vertical="' + ({top: 'top', middle: 'center', bottom: 'bottom'}[st.valign] || 'bottom') + '"' : '') + (st.wrap ? ' wrapText="1"' : '') + '/>' : '';
      xfs.set(key, xfList.length);
      xfList.push('<xf numFmtId="' + nf + '" fontId="' + fo + '" fillId="' + fi + '" borderId="' + bo + '" xfId="0"' +
        (nf ? ' applyNumberFormat="1"' : '') + (fo ? ' applyFont="1"' : '') + (fi ? ' applyFill="1"' : '') + (bo ? ' applyBorder="1"' : '') +
        (al ? ' applyAlignment="1">' + al + '</xf>' : '/>'));
    }
    return xfs.get(key);
  };

  const used = new Set();
  const sheetXml = sheets.map(sh => {
    const size = usedSize(sh);
    const rowsXml = [];
    for (let r = 1; r <= size.rows; r++) {
      const cells = [];
      for (let c = 1; c <= Math.max(size.cols, 1); c++) {
        const v = sh.data[r - 1] ? sh.data[r - 1][c - 1] : undefined;
        const st = styleAt(sh, r, c);
        const hasStyle = Object.keys(st).length > 0;
        if ((v === '' || v === undefined || v === null) && !hasStyle) continue;
        const ref = colName(c) + r;
        const s = xfId(st, isDate(v));
        const sAttr = s ? ' s="' + s + '"' : '';
        if (v === '' || v === undefined || v === null) cells.push('<c r="' + ref + '"' + sAttr + '/>');
        else if (typeof v === 'number' && isFinite(v)) cells.push('<c r="' + ref + '"' + sAttr + '><v>' + v + '</v></c>');
        else if (typeof v === 'boolean') cells.push('<c r="' + ref + '"' + sAttr + ' t="b"><v>' + (v ? 1 : 0) + '</v></c>');
        else if (isDate(v)) cells.push('<c r="' + ref + '"' + sAttr + '><v>' + excelSerial(v) + '</v></c>');
        else cells.push('<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>');
      }
      const ht = sh.rowHeights[r];
      if (cells.length || ht) rowsXml.push('<row r="' + r + '"' + (ht ? ' ht="' + (ht * 0.75).toFixed(1) + '" customHeight="1"' : '') + '>' + cells.join('') + '</row>');
    }
    const widths = Object.keys(sh.colWidths).map(Number).sort((a, b) => a - b);
    const cols = widths.length ? '<cols>' + widths.map(c => '<col min="' + c + '" max="' + c + '" width="' + (sh.colWidths[c] / 7).toFixed(2) + '" customWidth="1"/>').join('') + '</cols>' : '';
    const pane = sh.frozenRows ? '<pane ySplit="' + sh.frozenRows + '" topLeftCell="A' + (sh.frozenRows + 1) + '" activePane="bottomLeft" state="frozen"/>' : '';
    const views = '<sheetViews><sheetView workbookViewId="0"' + (sh.gridlines ? '' : ' showGridLines="0"') + '>' + pane + '</sheetView></sheetViews>';
    const merges = sh.merges.length ? '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(m => '<mergeCell ref="' + colName(m.c) + m.r + ':' + colName(m.c + m.nc - 1) + (m.r + m.nr - 1) + '"/>').join('') + '</mergeCells>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      views + '<sheetFormatPr defaultRowHeight="15"/>' + cols + '<sheetData>' + rowsXml.join('') + '</sheetData>' + merges +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>';
  });
  const names = sheets.map(sh => {
    let n = String(sh.getName()).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || 'Planilha';
    let k = 2;
    while (used.has(n.toLowerCase())) n = n.slice(0, 28) + ' ' + (k++);
    used.add(n.toLowerCase());
    return n;
  });
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (numFmts.size ? '<numFmts count="' + numFmts.size + '">' + Array.from(numFmts.entries()).map(([code, id]) => '<numFmt numFmtId="' + id + '" formatCode="' + xmlEsc(code) + '"/>').join('') + '</numFmts>' : '') +
    '<fonts count="' + fontList.length + '">' + fontList.join('') + '</fonts>' +
    '<fills count="' + fillList.length + '">' + fillList.join('') + '</fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + xfList.length + '">' + xfList.join('') + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const files = [
    {name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
    {name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((n, i) => '<sheet name="' + xmlEsc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'},
    {name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name: 'xl/styles.xml', data: styles}
  ].concat(sheetXml.map((x, i) => ({name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: x})));
  return zip(files);
}

// ------------------------------------------------------------------ texto das células (PDF), formato brasileiro
function fmtNumber(v, decimals, group) {
  const s = Math.abs(v).toFixed(decimals);
  let [int, dec] = s.split('.');
  if (group) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '-' : '') + int + (dec ? ',' + dec : '');
}
function cellText(v, fmt) {
  if (v === '' || v === undefined || v === null) return '';
  if (isDate(v)) { const p = localParts(v); return String(p.d).padStart(2, '0') + '/' + String(p.m).padStart(2, '0') + '/' + p.y; }
  if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
  if (typeof v !== 'number') return String(v);
  if (fmt && fmt !== '@') {
    const sections = fmt.split(';');
    let sec = sections[0], val = v;
    if (v < 0 && sections[1]) { sec = sections[1]; val = Math.abs(v); } else if (v === 0 && sections[2]) sec = sections[2];
    const pct = /%/.test(sec);
    const decM = sec.replace(/"[^"]*"/g, '').match(/0\.(0+)/);
    const dec = decM ? decM[1].length : 0;
    const lit = (sec.match(/"([^"]*)"/) || [])[1] || '';
    const plus = /^\+/.test(sec) && val > 0 ? '+' : /^-/.test(sec) ? '-' : '';
    return plus + fmtNumber(pct ? val * 100 : val, dec, !pct) + (pct ? '%' : '') + (lit ? ' ' + lit.trim() : '');
  }
  if (Number.isInteger(v)) return fmtNumber(v, 0, true);
  return fmtNumber(v, Math.min(4, Math.max(0, (String(v).split('.')[1] || '').length)), true).replace(/,?0+$/, m => (m.indexOf(',') >= 0 ? '' : m));
}

// ------------------------------------------------------------------ gráficos (SVG) para o PDF
function svgChart(ch) {
  const W = Number(ch.options.width) || 640, H = Number(ch.options.height) || 300;
  const colors = ch.options.colors || ['#E60012', '#8A8F98', '#F59E0B', '#2563EB'];
  const title = ch.options.title ? '<text x="' + W / 2 + '" y="20" text-anchor="middle" font-size="14" font-weight="700" fill="#1f2937">' + htmlEsc(ch.options.title) + '</text>' : '';
  const vals = ch.values || [];
  const head = vals[0] || [];
  const rows = vals.slice(1).filter(r => r && r[0] !== '' && r[0] !== undefined);
  const num = x => (typeof x === 'number' && isFinite(x) ? x : Number(x) || 0);
  const label = x => (isDate(x) ? cellText(x) : String(x)).split('\n')[0];
  let body = '';
  if (ch.type === 'pie') {
    const total = rows.reduce((s, r) => s + num(r[1]), 0) || 1;
    const cx = W * 0.32, cy = H / 2 + 10, R = Math.min(W * 0.28, H / 2 - 30), r0 = R * (Number(ch.options.pieHole) || 0);
    let a = -Math.PI / 2;
    rows.forEach((r, i) => {
      const frac = num(r[1]) / total, b = a + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
      const p = (ang, rad) => (cx + rad * Math.cos(ang)).toFixed(1) + ' ' + (cy + rad * Math.sin(ang)).toFixed(1);
      if (frac >= 0.9999) body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + colors[i % colors.length] + '"/>';
      else if (frac > 0) body += '<path d="M' + p(a, R) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p(b, R) + ' L' + p(b, r0) + ' A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + p(a, r0) + 'Z" fill="' + colors[i % colors.length] + '"/>';
      body += '<rect x="' + (W * 0.66) + '" y="' + (60 + i * 24) + '" width="12" height="12" rx="2" fill="' + colors[i % colors.length] + '"/>' +
        '<text x="' + (W * 0.66 + 18) + '" y="' + (71 + i * 24) + '" font-size="12" fill="#374151">' + htmlEsc(label(r[0])) + ' · ' + fmtNumber(frac * 100, 1) + '%</text>';
      a = b;
    });
    if (r0) body += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r0 + '" fill="#fff"/>';
  } else if (ch.type === 'bar') {
    const max = Math.max(1, ...rows.map(r => num(r[1])));
    const left = Math.min(220, W * 0.36), top = 34, bh = Math.max(8, Math.min(22, (H - top - 10) / Math.max(1, rows.length) - 4));
    rows.slice(0, Math.floor((H - top - 10) / (bh + 4))).forEach((r, i) => {
      const y = top + i * (bh + 4), w = (W - left - 60) * num(r[1]) / max;
      body += '<text x="' + (left - 6) + '" y="' + (y + bh * 0.72) + '" font-size="11" text-anchor="end" fill="#374151">' + htmlEsc(label(r[0]).slice(0, 34)) + '</text>' +
        '<rect x="' + left + '" y="' + y + '" width="' + Math.max(1, w).toFixed(1) + '" height="' + bh + '" rx="3" fill="' + colors[0] + '"/>' +
        '<text x="' + (left + w + 5).toFixed(1) + '" y="' + (y + bh * 0.72) + '" font-size="11" fill="#111827">' + fmtNumber(num(r[1]), 0, true) + '</text>';
    });
  } else {
    const series = head.slice(1).map((h, k) => ({name: String(h).split('\n')[0], data: rows.map(r => (r[k + 1] === '' ? null : num(r[k + 1])))}));
    const all = [].concat(...series.map(s => s.data)).filter(x => x !== null);
    let min = Math.min(...all), max = Math.max(...all);
    if (!all.length) { min = 0; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1; min -= pad; max += pad;
    const L = 62, T = 34, Rr = W - 34, B = H - 46;
    const axis = v => (ch.numberFormat ? cellText(v, ch.numberFormat) : fmtNumber(v, Math.abs(max - min) < 5 ? 2 : 0, true));
    const x = i => L + (rows.length <= 1 ? (Rr - L) / 2 : (Rr - L) * i / (rows.length - 1));
    const y = v => B - (B - T) * (v - min) / (max - min);
    for (let g = 0; g <= 4; g++) {
      const v = min + (max - min) * g / 4;
      body += '<line x1="' + L + '" x2="' + Rr + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="#e5e7eb"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" font-size="10" text-anchor="end" fill="#6b7280">' + htmlEsc(axis(v)) + '</text>';
    }
    const step = Math.max(1, Math.ceil(rows.length / 10));
    rows.forEach((r, i) => { if (i % step === 0) body += '<text x="' + x(i).toFixed(1) + '" y="' + (B + 16) + '" font-size="10" text-anchor="middle" fill="#6b7280">' + htmlEsc(label(r[0]).slice(0, 12)) + '</text>'; });
    series.forEach((s, k) => {
      const pts = s.data.map((v, i) => (v === null ? null : x(i).toFixed(1) + ',' + y(v).toFixed(1))).filter(Boolean);
      body += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + colors[k % colors.length] + '" stroke-width="2.4"' + (k ? ' stroke-dasharray="6 4"' : '') + '/>';
      if (!k) pts.forEach(p => { const [px, py] = p.split(','); body += '<circle cx="' + px + '" cy="' + py + '" r="3.2" fill="' + colors[0] + '"/>'; });
      body += '<rect x="' + (L + k * 150) + '" y="' + (H - 16) + '" width="12" height="3" fill="' + colors[k % colors.length] + '"/><text x="' + (L + k * 150 + 18) + '" y="' + (H - 11) + '" font-size="11" fill="#374151">' + htmlEsc(s.name) + '</text>';
    });
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Arial, sans-serif">' +
    '<rect width="100%" height="100%" fill="#fff" rx="8"/>' + title + body + '</svg>';
}

// ------------------------------------------------------------------ PDF
function toHtml(ss) {
  const parts = ss.getSheets().map((sh, idx) => {
    const size = usedSize(sh);
    if (!size.rows) return '';
    const covered = new Set(), span = new Map();
    const blocked = (r, c) => covered.has(r + ':' + c) || span.has(r + ':' + c) ||
      (sh.data[r - 1] && sh.data[r - 1][c - 1] !== '' && sh.data[r - 1][c - 1] !== undefined);
    sh.merges.forEach(m => {
      span.set(m.r + ':' + m.c, m);
      for (let i = 0; i < m.nr; i++) for (let j = 0; j < m.nc; j++) if (i || j) covered.add((m.r + i) + ':' + (m.c + j));
    });
    // Gráficos no lugar onde o relatório os pôs (ao lado das tabelas), ocupando as células vazias da área.
    const placed = [];
    let cols = size.cols, rows = size.rows;
    sh.charts.forEach(ch => {
      const H = Number(ch.options.height) || 300, W = Number(ch.options.width) || 640;
      const colW = c => sh.colWidths[c] || 100;
      let nc = 0, acc = 0;
      while (acc < W * 0.9 && nc < 12) { acc += colW(ch.col + nc); nc++; }
      let nr = Math.max(4, Math.ceil(H / 19));
      for (let i = 0; i < nr; i++) {
        for (let j = 0; j < nc; j++) if (blocked(ch.row + i, ch.col + j)) { nr = i; break; }
      }
      if (nr < 4) { placed.push({ch, loose: true}); return; }
      const m = {r: ch.row, c: ch.col, nr, nc, chart: ch};
      span.set(m.r + ':' + m.c, m);
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (i || j) covered.add((m.r + i) + ':' + (m.c + j));
      cols = Math.max(cols, ch.col + nc - 1);
      rows = Math.max(rows, ch.row + nr - 1);
    });
    let total = 0;
    for (let c = 1; c <= cols; c++) total += sh.colWidths[c] || 100;
    let html = '<table><colgroup>';
    for (let c = 1; c <= cols; c++) html += '<col style="width:' + ((sh.colWidths[c] || 100) / total * 100).toFixed(3) + '%">';
    html += '</colgroup>';
    for (let r = 1; r <= rows; r++) {
      const ht = sh.rowHeights[r];
      html += '<tr' + (ht ? ' style="height:' + Math.round(ht * 0.8) + 'px"' : '') + '>';
      for (let c = 1; c <= cols; c++) {
        if (covered.has(r + ':' + c)) continue;
        const m = span.get(r + ':' + c);
        const spanAttr = m ? (m.nr > 1 ? ' rowspan="' + m.nr + '"' : '') + (m.nc > 1 ? ' colspan="' + m.nc + '"' : '') : '';
        if (m && m.chart) { html += '<td class="chart-cell"' + spanAttr + '><div class="chart">' + svgChart(m.chart) + '</div></td>'; continue; }
        const st = styleAt(sh, r, c);
        const v = sh.data[r - 1] ? sh.data[r - 1][c - 1] : '';
        const css = [];
        if (st.bg) css.push('background:' + st.bg);
        if (st.color) css.push('color:' + st.color);
        if (st.bold) css.push('font-weight:700');
        if (st.size) css.push('font-size:' + Math.round(st.size * 0.9) + 'pt');
        if (st.halign) css.push('text-align:' + st.halign);
        else if (typeof v === 'number') css.push('text-align:right');
        if (st.valign) css.push('vertical-align:' + st.valign);
        if (st.border) css.push('border:1px solid #d9d9d9');
        const text = htmlEsc(cellText(v, st.numberFormat)).replace(/\n/g, '<br>');
        html += '<td' + spanAttr + (css.length ? ' style="' + css.join(';') + '"' : '') + '>' + text + '</td>';
      }
      html += '</tr>';
    }
    html += '</table>';
    const loose = placed.filter(x => x.loose);
    const charts = loose.length ? '<div class="charts">' + loose.map(x => '<div class="chart">' + svgChart(x.ch) + '</div>').join('') + '</div>' : '';
    return '<section' + (idx ? ' class="page"' : '') + '>' + html + charts + '</section>';
  });
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>' + htmlEsc(ss.getName()) + '</title><style>' +
    '@page{size:A4 landscape;margin:9mm}body{font-family:Arial,"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;font-size:8pt;color:#111;margin:0}' +
    'table{border-collapse:collapse;table-layout:fixed;width:100%}td{padding:2px 4px;vertical-align:bottom;overflow:hidden;word-wrap:break-word;line-height:1.25}' +
    'tr{page-break-inside:avoid}.page{break-before:page}.charts{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;page-break-inside:avoid}' +
    'td.chart-cell{vertical-align:top;padding:4px 0 0 10px}.chart{border:1px solid #e5e7eb;border-radius:8px;page-break-inside:avoid;overflow:hidden}' +
    '.chart svg{display:block;width:100%;height:auto}' +
    '</style></head><body>' + parts.join('') + '</body></html>';
}

let browserCache;
function findBrowser(cfg) {
  if (cfg && cfg.navegadorPdf) return fs.existsSync(cfg.navegadorPdf) ? cfg.navegadorPdf : null;
  if (browserCache !== undefined) return browserCache;
  const env = process.env;
  const list = [];
  if (process.platform === 'win32') {
    [env['PROGRAMFILES(X86)'], env.PROGRAMFILES, env.LOCALAPPDATA].filter(Boolean).forEach(base => {
      list.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      list.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    });
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable'].forEach(n => {
      (env.PATH || '').split(':').forEach(dir => list.push(path.join(dir, n)));
    });
  }
  browserCache = list.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
  return browserCache;
}

function toPdf(ss, cfg) {
  const exe = findBrowser(cfg);
  if (!exe) {
    throw new Error('Para gerar PDF, este computador precisa do Microsoft Edge ou do Google Chrome (ou informe "navegadorPdf" no config.json). O relatório em Excel funciona sem isso.');
  }
  const tmp = fs.mkdtempSync(path.join((cfg && cfg.dataDir) || os.tmpdir(), 'pdf-'));
  try {
    const htmlFile = path.join(tmp, 'relatorio.html'), pdfFile = path.join(tmp, 'relatorio.pdf');
    fs.writeFileSync(htmlFile, toHtml(ss));
    const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--user-data-dir=' + path.join(tmp, 'perfil'), '--no-pdf-header-footer', '--print-to-pdf-no-header', '--print-to-pdf=' + pdfFile,
      'file://' + (process.platform === 'win32' ? '/' : '') + htmlFile.replace(/\\/g, '/')];
    if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
    const r = spawnSync(exe, args, {timeout: 120000, windowsHide: true, stdio: 'ignore'});
    if (!fs.existsSync(pdfFile) || fs.statSync(pdfFile).size < 100) {
      throw new Error('O navegador não conseguiu gerar o PDF (' + (r.error ? r.error.message : 'código ' + r.status) + '). Use o relatório em Excel.');
    }
    return fs.readFileSync(pdfFile);
  } finally {
    try { fs.rmSync(tmp, {recursive: true, force: true}); } catch (e) { /* arquivo preso: fica para depois */ }
  }
}

module.exports = {toXlsx, toPdf, toHtml, cellText, findBrowser, zip};
