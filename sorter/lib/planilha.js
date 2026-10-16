/**
 * PAINEL DO SORTER — planilha .xlsx (abre no Excel, no Google Planilhas e no LibreOffice) feita no próprio navegador, sem
 * biblioteca: um ZIP (sem compressão) com o XML do formato. Usada pelo botão "Baixar planilha".
 *
 * SorterPlanilha.criar([{nome, larguras: [n…], congelar: linhas, linhas: [[célula…]…]}]) → Uint8Array
 * célula: null/'' (vazia) · número · texto · {v: valor, s: 'cab' | 'int' | 'dec' | 'pct' | 'titulo' | 'total' | 'negrito' | 'totalPct'}
 * Números inteiros saem com separador de milhar; 'pct' recebe a fração (0,25 = 25,00%).
 * JavaScript simples (ES5): roda também em navegador antigo.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SorterPlanilha = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Cabeçalho XML montado em partes: o texto "<" + "?" não aparece no arquivo (no Apps Script ele marca o código do modelo).
  var XML = '<' + '?xml version="1.0" encoding="UTF-8" standalone="yes"?' + '>\n';
  // Estilos (índice em cellXfs do styles.xml).
  var ESTILO = {'': 0, cab: 1, int: 2, pct: 3, titulo: 4, total: 5, negrito: 6, dec: 7, totalPct: 8};

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; })
      // Caracteres de controle não são aceitos no XML.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  function coluna(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function celula(v, ref) {
    var s = '', val = v;
    if (v !== null && typeof v === 'object') { s = v.s || ''; val = v.v; }
    if (val === null || val === undefined || val === '') return s ? '<c r="' + ref + '" s="' + ESTILO[s] + '"/>' : '';
    if (typeof val === 'number' && isFinite(val)) {
      var st = s || (Math.round(val) === val ? 'int' : 'dec');
      return '<c r="' + ref + '" s="' + ESTILO[st] + '"><v>' + val + '</v></c>';
    }
    return '<c r="' + ref + '" t="inlineStr"' + (s ? ' s="' + ESTILO[s] + '"' : '') + '><is><t xml:space="preserve">' + esc(val) + '</t></is></c>';
  }
  function aba(a) {
    var linhas = a.linhas || [], larg = a.larguras || [], x = [];
    x.push(XML + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    if (a.congelar) {
      x.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + a.congelar + '" topLeftCell="A' + (a.congelar + 1) +
        '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    }
    if (larg.length) {
      x.push('<cols>' + larg.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>');
    }
    x.push('<sheetData>');
    linhas.forEach(function (l, i) {
      var cs = (l || []).map(function (v, j) { return celula(v, coluna(j) + (i + 1)); }).join('');
      x.push('<row r="' + (i + 1) + '">' + cs + '</row>');
    });
    x.push('</sheetData></worksheet>');
    return x.join('');
  }
  function nomeAba(n, usados) {
    var s = String(n || 'Planilha').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Planilha', b = s, i = 2;
    while (usados[s.toLowerCase()]) { s = b.slice(0, 28) + ' ' + i++; }
    usados[s.toLowerCase()] = 1;
    return s;
  }
  var STYLES = XML +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="14"/><color rgb="FFE60012"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE60012"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top style="thin"><color rgb="FFE60012"/></top><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="3" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="10" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  // ---------- ZIP (sem compressão) ----------
  var CRC = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var out = [], str = unescape(encodeURIComponent(s));
    for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i));
    return new Uint8Array(out);
  }
  function zip(arquivos) {
    var partes = [], central = [], off = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    arquivos.forEach(function (f) {
      var nome = utf8(f.nome), dados = utf8(f.texto), crc = crc32(dados);
      // Data fixa (1980-01-01): o mesmo conteúdo dá o mesmo arquivo.
      var comum = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(dados.length), u32(dados.length), u16(nome.length), u16(0));
      var local = new Uint8Array([0x50, 0x4b, 0x03, 0x04].concat(comum));
      partes.push(local, nome, dados);
      central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02].concat(u16(20), comum, u16(0), u16(0), u16(0), u32(0), u32(off))), nome);
      off += local.length + nome.length + dados.length;
    });
    var tamCentral = central.reduce(function (a, p) { return a + p.length; }, 0);
    var fim = new Uint8Array([0x50, 0x4b, 0x05, 0x06].concat(u16(0), u16(0), u16(arquivos.length), u16(arquivos.length), u32(tamCentral), u32(off), u16(0)));
    var todas = partes.concat(central, [fim]), total = todas.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    todas.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /** Abas → arquivo .xlsx (Uint8Array). */
  function criar(abas) {
    var usados = {}, nomes = abas.map(function (a) { return nomeAba(a.nome, usados); });
    var arqs = [
      {nome: '[Content_Types].xml', texto: XML +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        abas.map(function (a, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
        '</Types>'},
      {nome: '_rels/.rels', texto: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {nome: 'xl/workbook.xml', texto: XML +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        nomes.map(function (n, i) { return '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>'},
      {nome: 'xl/_rels/workbook.xml.rels', texto: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        abas.map(function (a, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (abas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
      {nome: 'xl/styles.xml', texto: STYLES}
    ];
    abas.forEach(function (a, i) { arqs.push({nome: 'xl/worksheets/sheet' + (i + 1) + '.xml', texto: aba(a)}); });
    return zip(arqs);
  }

  return {criar: criar, coluna: coluna, nomeAba: nomeAba};
});
