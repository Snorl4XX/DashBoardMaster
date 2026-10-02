/**
 * Simulação local do Apps Script para testes (Node). Reproduz o comportamento
 * que importa: o Sheets converte "AAAA-MM-DD" em Date e texto numérico em número,
 * o google.script.run não aceita Date etc. Não acessa rede nem o JMS real.
 */
const fs = require('fs'), vm = require('vm'), path = require('path'), zlib = require('zlib');

const TZ = 'America/Sao_Paulo';
function fmtDate(d, tz, fmt) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).formatToParts(new Date(d));
  const g = t => parts.find(p => p.type === t).value;
  return fmt.replace('yyyy', g('year')).replace('MM', g('month')).replace('dd', g('day'))
    .replace('HH', g('hour') === '24' ? '00' : g('hour')).replace('mm', g('minute')).replace('ss', g('second'));
}
function sheetCoerce(v) {
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 3, 0, 0)); // meia-noite em São Paulo
    if (/^-?\d{1,15}(\.\d+)?$/.test(v)) return Number(v);
  }
  if (v === null || v === undefined) return '';
  return v;
}

function makeSheetApi(state) {
  function Range(sheet, r, c, nr, nc) {
    this.sheet = sheet; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1;
  }
  const chain = ['setBackground', 'setFontColor', 'setFontWeight', 'setFontSize', 'setWrap', 'setVerticalAlignment',
    'setHorizontalAlignment', 'setNumberFormat', 'setBorder', 'merge'];
  chain.forEach(n => { Range.prototype[n] = function () { return this; }; });
  Range.prototype.getValues = function () {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) vals.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]);
      out.push(vals);
    }
    return out;
  };
  Range.prototype.setValues = function (values) {
    if (values.length !== this.nr || values[0].length !== this.nc) throw new Error('Dimensões de setValues não conferem');
    state.writes++;
    values.forEach((row, i) => {
      const idx = this.r - 1 + i;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      row.forEach((v, j) => { this.sheet.data[idx][this.c - 1 + j] = sheetCoerce(v); });
    });
    return this;
  };
  Range.prototype.setValue = function (v) { const rows = []; for (let i = 0; i < this.nr; i++) rows.push(new Array(this.nc).fill(v)); return this.setValues(rows); };
  function Sheet(name) { this.name = name; this.data = []; this.charts = 0; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.setName = function (n) { this.name = n; return this; };
  Sheet.prototype.getLastRow = function () {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i] && this.data[i].some(v => v !== '' && v !== undefined)) return i + 1;
    return 0;
  };
  Sheet.prototype.getRange = function (a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z])(\d+)(?::([A-Z])(\d+))?$/);
      const col = x => x.charCodeAt(0) - 64;
      return new Range(this, +m[2], col(m[1]), m[4] ? +m[4] - +m[2] + 1 : 1, m[3] ? col(m[3]) - col(m[1]) + 1 : 1);
    }
    return new Range(this, a, b, c, d);
  };
  Sheet.prototype.appendRow = function (row) { state.writes++; this.data.splice(this.getLastRow(), 0, row.map(sheetCoerce)); return this; };
  ['setFrozenRows', 'setHiddenGridlines', 'setColumnWidths', 'setColumnWidth', 'setRowHeight', 'clear', 'setConditionalFormatRules'].forEach(n => {
    Sheet.prototype[n] = function () { return this; };
  });
  Sheet.prototype.insertChart = function () { this.charts++; };
  Sheet.prototype.newChart = function () {
    const b = {}; ['asLineChart', 'asPieChart', 'asBarChart', 'addRange', 'setPosition', 'setOption'].forEach(n => b[n] = () => b);
    b.build = () => ({}); return b;
  };
  function Spreadsheet(id, name) { this.id = id; this.name = name; this.sheets = [new Sheet('Sheet1')]; this.tz = TZ; }
  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets; };
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.find(s => s.name === n) || null; };
  Spreadsheet.prototype.insertSheet = function (n) { const s = new Sheet(n); this.sheets.push(s); return s; };
  Spreadsheet.prototype.getSpreadsheetTimeZone = function () { return this.tz; };
  Spreadsheet.prototype.setSpreadsheetTimeZone = function (tz) { this.tz = tz; };
  return {
    create: name => { const ss = new Spreadsheet('ss' + (++state.seq), name); state.spreadsheets[ss.id] = ss; return ss; },
    openById: id => { if (!state.spreadsheets[id]) throw new Error('planilha inexistente ' + id); return state.spreadsheets[id]; },
    flush: () => {},
    newConditionalFormatRule: () => { const b = {}; ['whenFormulaSatisfied', 'setBackground', 'setRanges'].forEach(n => b[n] = () => b); b.build = () => ({}); return b; },
    BorderStyle: {SOLID: 'SOLID'}
  };
}

function makeBlob(bytes, type, name) {
  return {
    bytes: Buffer.from(bytes), type: type, name: name,
    getBytes() { return Array.from(this.bytes); }, getDataAsString() { return this.bytes.toString('utf8'); },
    setName(n) { this.name = n; return this; }, getName() { return this.name; },
    setContentType(t) { this.type = t; return this; }, getContentType() { return this.type; },
    copyBlob() { return makeBlob(this.bytes, this.type, this.name); }
  };
}

function createContext(opts) {
  opts = opts || {};
  const state = {seq: 0, spreadsheets: {}, files: {}, folders: {}, props: null, cache: {},
    triggers: [], fetches: [], writes: 0};
  // Alterar S.props direto no teste equivale a editar as Propriedades do script:
  // descarta o cache de propriedades do projeto (como uma nova execução faria).
  state.props = new Proxy(Object.assign({}, opts.props || {}), {
    set(t, k, v) { t[k] = v; if (typeof context !== 'undefined') context.PROPS_CACHE_ = null; return true; },
    deleteProperty(t, k) { delete t[k]; if (typeof context !== 'undefined') context.PROPS_CACHE_ = null; return true; }
  });
  const context = {
    console: opts.quiet ? {log() {}, error() {}, warn() {}} : console,
    Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Intl, encodeURIComponent, Buffer,
    PropertiesService: {getScriptProperties: () => ({
      getProperty: k => (state.props[k] === undefined ? null : state.props[k]),
      getProperties: () => Object.assign({}, state.props),
      setProperty: (k, v) => { state.props[k] = String(v); },
      deleteProperty: k => { delete state.props[k]; }
    })},
    CacheService: {getScriptCache: () => ({
      get: k => (state.cache[k] === undefined ? null : state.cache[k]), put: (k, v) => { state.cache[k] = String(v); },
      remove: k => { delete state.cache[k]; }
    })},
    LockService: {getScriptLock: () => ({tryLock: () => true, waitLock: () => true, releaseLock: () => {}})},
    SpreadsheetApp: makeSheetApi(state),
    DriveApp: {
      createFolder: name => { const id = 'fold' + (++state.seq); state.folders[id] = name; return folderApi(id); },
      getFolderById: id => folderApi(id),
      getFileById: id => {
        const f = state.files[id]; if (!f) throw new Error('arquivo inexistente ' + id);
        return {getBlob: () => f.blob, setTrashed: v => { f.trashed = v; }, getId: () => id, getUrl: () => 'https://drive/' + id};
      }
    },
    Utilities: {
      formatDate: fmtDate, getUuid: () => 'uuid-' + (++state.seq), sleep: () => {},
      newBlob: (data, type, name) => makeBlob(typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data), type, name),
      gzip: blob => makeBlob(zlib.gzipSync(blob.bytes), 'application/x-gzip', blob.name + '.gz'),
      ungzip: blob => makeBlob(zlib.gunzipSync(blob.bytes), 'application/json', blob.name),
      base64Encode: bytes => Buffer.from(bytes).toString('base64')
    },
    UrlFetchApp: {
      fetch: (url, req) => opts.jms(url, req, state),
      fetchAll: reqs => reqs.map(r => opts.jms(r.url, r, state))
    },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.map(h => ({getHandlerFunction: () => h})),
      newTrigger: h => { const b = {timeBased: () => b, everyHours: () => b, everyMinutes: () => b, everyDays: () => b, atHour: () => b,
        create: () => { state.triggers.push(h); }}; return b; },
      deleteTrigger: () => {}, getOAuthToken: () => 'token'
    }
  };
  function folderApi(id) {
    return {getId: () => id, createFile: blob => {
      const fid = 'file' + (++state.seq); state.files[fid] = {blob: blob, name: blob.name, folder: id, trashed: false};
      return {getId: () => fid, getUrl: () => 'https://drive/' + fid};
    }};
  }
  vm.createContext(context);
  const root = path.join(__dirname, '..');
  const files = ['Config', 'Core', 'Utils', 'JmsApi', 'Storage', 'Analytics', 'Report', 'Triggers', 'Code'];
  const code = files.map(f => fs.readFileSync(path.join(root, f + '.gs'), 'utf8')).join('\n;\n');
  vm.runInContext(code, context, {filename: 'projeto.gs'});
  context.__state = state;
  return context;
}

/**
 * JMS falso: responde como as capturas dos PDFs. Valida o payload de cada rota
 * (ex.: Envio Errado sem isWrong:"Y" devolve TODAS as remessas, como o JMS real).
 * Opções (para simular o JMS real e os problemas vistos em produção):
 *  status       → responde sempre esse HTTP
 *  maxPageSize  → corta a página em silêncio (o JMS entrega no máximo N por página)
 *  rejectAbove  → recusa (código da aplicação) páginas maiores que N
 *  resultWindow → recusa páginas cujo deslocamento passa de N (paginação profunda)
 *  ignoreTime   → ignora a hora da janela (fatias devolveriam o dia inteiro)
 *  keyCase      → 'upper' devolve os campos em MAIÚSCULAS (grafia diferente)
 *  appError     → {code, msg} em toda resposta (ex.: token expirado com HTTP 200)
 *  html         → devolve uma página HTML (redirecionamento para o login)
 *  grow         → {date, perRequest}: o dia continua recebendo registros durante o download
 *  onFetch      → callback(url, body) antes de responder (pode lançar exceção)
 */
const TIME_FIELD = {center_wrong_send_: 'sendTime', center_error_rate_new_: 'transferCenterSendTime', departure_transport_timely_: 'actualDispatchTime',
  inward_transport_timely_rate_: 'dispatchTime'};
function addDay(iso, n) { return new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function fakeJms(dayData, options) {
  options = options || {};
  return function (url, req, state) {
    state.fetches.push({url: url, headers: req.headers, payload: JSON.parse(req.payload)});
    const body = JSON.parse(req.payload);
    const route = url.split('/').pop();
    if (options.onFetch) options.onFetch(url, body);
    // intercept(rota, cabeçalhos, corpo) → [httpStatus, resposta] para simular recusas específicas do JMS.
    if (options.intercept) { const x = options.intercept(route, req.headers || {}, body); if (x) return {getResponseCode: () => x[0], getContentText: () => JSON.stringify(x[1])}; }
    const respond = (code, obj) => ({getResponseCode: () => code, getContentText: () => typeof obj === 'string' ? obj : JSON.stringify(obj)});
    if (options.status) return respond(options.status, {});
    if (options.html) return respond(200, '<!DOCTYPE html><html><head><title>JMS Login</title></head><body>login</body></html>');
    if (options.appError) return respond(200, {code: options.appError.code, msg: options.appError.msg, data: null, fail: true, succ: false});
    const isDetail = /detail|_verification$|detailed$/.test(route) && !/total/.test(route);
    const size = options.maxPageSize ? Math.min(options.maxPageSize, body.size) : body.size;
    if (isDetail && options.rejectAbove && body.size > options.rejectAbove) return respond(200, {code: 500, msg: 'size参数超出限制', fail: true});
    if (isDetail && options.resultWindow && (body.current - 1) * size >= options.resultWindow) return respond(200, {code: 500, msg: 'Result window is too large', fail: true});
    const ok = (records, total, current, sz) => respond(200, {code: 1, msg: '请求成功', data: {records: records, total: total,
      size: sz, current: current, pages: Math.ceil(total / sz) || 0, other: null, heads: null}, fail: false, succ: true});
    const start = String(body.startTime || body.startTime1 || ''), end = String(body.endTime || body.endTime1 || '');
    const op = /departure_transport|inward_transport/.test(route);
    // Dia a que a janela pertence (janela 14h: antes das 14h é do dia anterior). Avaria: dia estatístico.
    const date = body.statisticalStartDate || (route === 'getBreakageRateData' ? body.startDate : null) ||
      (op && start.slice(11) < '14:00:00' ? addDay(start.slice(0, 10), -1) : start.slice(0, 10));
    const d = dayData[date];
    if (d && options.grow && options.grow.date === date && isDetail) {
      for (let i = 0; i < options.grow.perRequest; i++) d.ws.push({billcode: 'LIVE' + d.ws.length, sendTime: date + ' 23:30:00', scanUser: 'X', dateTime: date});
    }
    const full = op ? {start: date + ' 14:00:00', end: addDay(date, 1) + ' 13:59:59'} : {start: date + ' 00:00:00', end: date + ' 23:59:59'};
    const tf = Object.keys(TIME_FIELD).filter(k => route.indexOf(k) === 0).map(k => TIME_FIELD[k])[0] ||
      (/missscan/.test(route) ? (body.detailType === 'billcodeArrive' ? 'loadPackageTime' : 'unloadArriveTime') : null);
    const inWindow = list => {
      if (options.ignoreTime || !tf || (start === full.start && end === full.end)) return list;
      // Posição do registro na linha do tempo da janela do dia (registros do simulado ficam no próprio dia).
      const pos = r => { const t = String(r[tf] || '').slice(11); return (op && t < '14:00:00' ? addDay(date, 1) : date) + ' ' + t; };
      return list.filter(r => { const p = pos(r); return p >= start && p <= end; });
    };
    // Janela de horário num campo informado (Recebimento: sendTime), como o JMS faz com startTime/endTime.
    // Avaria: opção de "Pedidos principais/filhos" pedida (main/sub), 'none' = código que o JMS não conhece, null = Todos.
    const dmKind = b => {
      if (options.ignoreMainSub || b.mainSubCode === undefined || b.mainSubCode === null || b.mainSubCode === '') return null;
      const codes = options.orderKindCodes || {main: 1, sub: 2};
      return b.mainSubCode === codes.main ? 'main' : b.mainSubCode === codes.sub ? 'sub' : 'none';
    };
    // options.plainChildren: o JMS mostra os pedidos filhos sem o sufixo "-001" (número próprio).
    const dmList = dd => dd.dm.map(r => {
      const child = /-\d{3}$/.test(r.waybillNo);
      return Object.assign({}, r, {_child: child, waybillNo: options.plainChildren && child ? r.waybillNo.replace('-', '') : r.waybillNo});
    });
    const inWindowBy = (list, field) => (options.ignoreTime || (start === full.start && end === full.end)) ? list
      : list.filter(r => { const t = String(r[field] || ''); return t >= start && t <= end; });
    const shape = r => {
      if (options.keyCase !== 'upper') return r;
      const o = {}; Object.keys(r).forEach(k => { o[k.toUpperCase()] = r[k]; }); return o;
    };
    const page = (list, b) => { const l = inWindow(list); return ok(l.slice((b.current - 1) * size, b.current * size).map(shape), l.length, b.current, size); };
    switch (route) {
      case 'center_wrong_send_total':
        if (!d) return ok([], 0, 1, body.size);
        return ok([{dateTime: date, errorCount: d.ws.length, errorRate: d.wsRate, totalCount: 590067, transferCenterCode: '30001'}], 1, 1, body.size);
      case 'center_wrong_send_detail': {
        if (!d) return ok([], 0, 1, body.size);
        const list = body.isWrong === 'Y' ? d.ws : d.ws.concat(new Array(5000).fill(0).map((_, i) => ({billcode: 'ALL' + i, sendTime: date + ' 10:00:00'})));
        return page(list, body);
      }
      case 'center_error_rate_new_total':
        if (!d) return ok([], 0, 1, body.size);
        if (body.timeType !== 'sign') return ok([{sendCount: 1}], 1, 1, body.size);
        return respond(200, {code: 1, data: {records: [{sendCount: 27796, wrongType11Count: 615, wrongRate1: '2.21%', wrongType12Count: d.se.length,
          wrongRate2: d.seRate, startTime: date + ' 00:00:00', dateType: 'day', timeType: 'sign'}], total: 1, size: 1, current: 1, pages: 0}, fail: false, succ: true});
      case 'center_error_rate_new_detail':
        if (!d || body.detailType !== 'wrongType12Count') return ok([], 0, 1, body.size);
        return page(d.se, body);
      case 'center_missscan_next_total':
        if (!d) return ok([], 0, 1, body.size);
        return ok([{countTime: date, sumBillcode: 618360, billcodeArrive: d.mr.length, percentArrive: d.mrRate, billcodeOut: d.md.length, percentOut: d.mdRate}], 1, 1, body.size);
      case 'center_missscan_next_detail':
        if (!d) return ok([], 0, 1, body.size);
        return page(body.detailType === 'billcodeArrive' ? d.mr : d.md, body);
      case 'departure_transport_timely_total_verification':
        if (!d) return ok([], 0, 1, body.size);
        return ok([{sendDate: date, sendNum: 114837, timelyNum: 65105, unrouteNum: 15277, untimelyNum: d.sc.length, timeRate: d.scRate}], 1, 1, body.size);
      case 'departure_transport_timely_rate_verification':
        if (!d) return ok([], 0, 1, body.size);
        return page(d.sc, body);
      case 'inward_transport_timely_rate_total':
        if (!d) return ok([], 0, 1, body.size);
        return ok([{scanTime: date, totalNum: 2698, inTimelyNum: 2698 - d.dc.length, inTimelyRate: d.dcRate, noTimelyNum: d.dc.length}], 1, 1, body.size);
      case 'inward_transport_timely_rate_detailed':
        if (!d) return ok([], 0, 1, body.size);
        return page(d.dc, body);
      // ----- Avaria (formato das respostas do documento do usuário) -----
      case 'getBreakageRateData': {
        if (!d || !d.dm) return ok([], 0, 1, body.size);
        // "Pedidos principais/filhos": mainSubCode (códigos simulados: principal 1, filho 2; options.orderKindCodes troca).
        // Filho = remessa com sufixo "-001"; o volume (operaNumber) também muda com a opção. Código desconhecido = vazio.
        let list = dmList(d), base = d.dmBase;
        const kind = dmKind(body);
        if (kind === 'none') return ok([], 0, 1, body.size);
        if (kind) {
          const subBase = Math.round(d.dmBase * 0.12);
          list = list.filter(r => r._child === (kind === 'sub'));
          // options.optionNoVolume: como na tela do JMS em 01/10 — com a opção escolhida, "Qtd processada" 0 e taxa 0.
          base = options.optionNoVolume ? 0 : kind === 'sub' ? subBase : d.dmBase - subBase;
        }
        const rate = base ? Math.round(list.length / base * 1e6 * 100) / 100 : 0;
        return ok([{id: '97308731485720' + date.slice(8), serialNum: '1', statisticalDate: date, agentAreaCode: '370000', agentAreaName: 'SPE',
          networkCode: '30001', networkName: 'SP GRU', operaNumber: base, breakageTicketNumber: list.length, breakageRate: rate,
          breakageAmount: list.reduce((a, r) => a + r.adjudicationAmount, 0), breakageNumberTotal: list.length, breakageRateTotal: rate,
          monthBreakageRate: 180.46, pickUpDayTotal: null, mainSubCode: body.mainSubCode === undefined ? null : body.mainSubCode}], 1, 1, body.size);
      }
      case 'detailBreakageRateData': {
        if (!d || !d.dm) return ok([], 0, 1, body.size);
        const sz = Math.min(100, body.size); // a tela do JMS mostra no máximo 100 linhas por página
        const kind = dmKind(body);
        if (kind === 'none') return ok([], 0, 1, body.size);
        const list = dmList(d).filter(r => !kind || r._child === (kind === 'sub'));
        return ok(list.slice((body.current - 1) * sz, body.current * sz).map(r => { const o = Object.assign({}, r); delete o._child; return o; }), list.length, body.current, sz);
      }
      case 'arrivalbyday_total': {
        if (!d || !d.af) return ok([], 0, 1, body.size);
        const a = d.af;
        // Janela de horário (turnos pelo resumo, V3.19): conta só os registros do horário. options.summaryIgnoresTime:
        // o JMS devolve o dia inteiro em qualquer horário (o recurso tem de desligar sozinho).
        const fullDay = options.summaryIgnoresTime || (start === full.start && end === full.end);
        const win = l => fullDay ? l : l.filter(r => { const t = String(r.sendTime || ''); return t >= start && t <= end; });
        const sh = win(a.should), tt = win(a.total);
        const noArr = fullDay ? a.noArriverNum : Math.round(sh.length * a.noArriverNum / Math.max(1, a.should.length));
        return ok([{sendTime: date, proxyAreaCode: '370000', proxyAreaName: 'SPE', nextstation: 'SP GRU', nextstationcode: '30001',
          shouldArriverNum: sh.length, noArriverNum: noArr, totalNum: tt.length, uploadNoSendNum: win(a.prev).length,
          noSendNum: win(a.noSend).length, noSignNum: tt.length, deliverNum: tt.length, PAGEHELPER_ROW_ID: 1, ROW_ID: 1}], 1, 1, body.size);
      }
      case 'arrivalbyday_detail':
      case 'arrivalbyday_detailed':
      case 'arrivalbyday_details': {
        // options.arrivalDetailRoute: o endereço real do detalhe (os outros respondem 404).
        if (route !== (options.arrivalDetailRoute || 'arrivalbyday_detail')) return respond(404, {});
        if (!d || !d.af) return ok([], 0, 1, body.size);
        // options.arrivalNoSmallLists: o JMS recusa os detailType das listas pequenas (testa a lista opcional).
        if (options.arrivalNoSmallLists && (body.detailType === 'uploadNoSendNum' || body.detailType === 'noSendNum')) return ok([], 0, 1, body.size);
        const lists = {totalNum: d.af.total, shouldArriverNum: d.af.should, uploadNoSendNum: d.af.prev, noSendNum: d.af.noSend};
        const list = inWindowBy(lists[body.detailType] || [], 'sendTime');
        const sz = Math.min(options.maxPageSize || 1000, body.size);
        return ok(list.slice((body.current - 1) * sz, body.current * sz).map((r, i) => Object.assign({PAGEHELPER_ROW_ID: i + 1}, r)), list.length, body.current, sz);
      }
      case 'registrationPage': {
        const want = {};
        String(body.waybillNo || '').split(',').forEach(w => { want[w.trim()] = 1; }); // como o JMS: remessa exata (com ou sem "-001")
        const all = [];
        Object.keys(dayData).forEach(k => (dayData[k].dmReg || []).forEach(r => { if (want[r.waybillNo]) all.push(r); }));
        const sz = Math.min(100, body.size);
        return ok(all.slice((body.current - 1) * sz, body.current * sz), all.length, body.current, sz);
      }
    }
    return respond(404, {});
  };
}

/** Dia de Envio Errado com N remessas (volume real de SC→SC / dias grandes). */
function bigWrongSend(date, n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const h = Math.floor(i * 24 / n);
    list.push({dateTime: date, billcode: 'BIG' + date.replace(/-/g, '') + String(i).padStart(6, '0'), sendTime: date + ' ' + String(h).padStart(2, '0') + ':' +
      String(i % 60).padStart(2, '0') + ':00', scanUser: 'OP' + (i % 37), orderFirstCode: 'SP', orderThirdCode: 'SP,977-00,000', nextstation: 'ST' + (i % 11),
      packageNo: 'BR' + (i % 90), orderSourceName: 'C' + (i % 7), shouldNextstation: 'ST' + (i % 13)});
  }
  return list;
}

/** Gera detalhes determinísticos parecidos com os reais para uma data. */
function makeDay(date, seed) {
  let s = seed || 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const time = () => date + ' ' + String(Math.floor(rnd() * 24)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0') + ':07';
  const logins = ['GIOVANNA FERREIRA DOS SANTOS', 'LEDA MARIA GONÇALVES', 'NATALIA COTA FIORINO', 'ROBERT DE PAULA FERREIRA', 'ANA PAULA LIMA'];
  const segs = ['GO,795-00,002', 'CHV,A111-00,005', 'MIA,303-01,024', 'PE,639-00,578', 'BAU 484-00,200', 'MS,850-00,240', 'SP,977-00,000'];
  const stations = ['BA FEC', 'SP BRE', 'MG CGE', 'DF BSB', 'RJ SJM', 'PE JGS'];
  const clients = ['SHEIN', 'TikTok', 'sheinDIR', 'Kwai', 'DAFITI', 'intelipost'];
  const ws = [], se = [], mr = [], md = [], sc = [], dc = [];
  const n = k => Math.floor(k * (0.8 + rnd() * 0.4));
  for (let i = 0; i < n(237); i++) ws.push({dateTime: date, orderSourceName: pick(clients), billcode: '8880' + date.replace(/-/g, '') + String(i).padStart(5, '0'),
    orderThirdCode: pick(segs), orderFirstCode: pick(segs).split(/[ ,]/)[0], packageNo: rnd() < 0.15 ? null : 'BR104' + Math.floor(rnd() * 90 + 10),
    sendTime: time(), scanUser: pick(logins), shouldNextstation: '主:' + pick(stations), nextstation: pick(stations), wrongType: pick(['上环节建包异常', '一段码异常', '人为因素'])});
  if (ws.length > 3) ws.push(Object.assign({}, ws[0])); // remessa duplicada (deve ser deduplicada)
  for (let i = 0; i < n(143); i++) se.push({billcode: '9998' + date.replace(/-/g, '') + i, dt: date, orderFirstCode: pick(['SP', 'GRU', 'MG']),
    packageNo: 'BR1043' + Math.floor(rnd() * 20), scanuser: pick(logins), baggingNetworkName: pick(['SP GRU', 'SP BRE', 'DC GRU-SP']),
    transferCenterNextName: pick(['DC GRU-SP', 'F ITQ-SP', 'DC BAU-SP']), transferCenterSendTime: time(), orderSourceName: pick(clients),
    wrongType: pick(['交叉带/翻板机错用包牌|Uso incorreto da etiqueta do pacote no cross-belt/sorter', '末端人为错分一错扫|Erro humano de triagem Last Mile — bipe incorreto'])});
  for (let i = 0; i < n(312); i++) mr.push({billcode: '7770' + date.replace(/-/g, '') + i, threeSegmentCode: pick(segs), loadPackageTime: time(),
    nextStop: pick(stations), loadPackageEmp: pick(logins), customerName: pick(clients), nextStationScanTime: time()});
  for (let i = 0; i < n(265); i++) md.push({billcode: '6660' + date.replace(/-/g, '') + i, threeSegmentCode: pick(segs), unloadArriveTime: time(),
    unloadPackageEmp: pick(logins), customerName: pick(clients), arriveOrder: 'SETR226' + Math.floor(rnd() * 30), nextStop: pick(stations)});
  for (let i = 0; i < n(420); i++) sc.push({sendDate: date, SCANTIME: time(), billCode: '5550' + date.replace(/-/g, '') + i, untimelycause: pick(['Fora do prazo', 'Sem rota cadastrada']),
    arrivalScanTime: time(), actualDispatchTime: time(), nextStation: pick(stations), sendShipmentNo: 'JBGX2609' + Math.floor(rnd() * 12),
    packageCode: 'BR1044' + Math.floor(rnd() * 40), startTime: date + ' ' + pick(['10:00', '14:00', '19:30', '23:00']) + ':00', orderSourceName: pick(clients), lastName: 'PA AEROGRU-SP'});
  for (let i = 0; i < n(180); i++) dc.push({scanTime: date, waybillNo: '4440' + date.replace(/-/g, '') + i, arrivalShipmentName: pick(['D107-GRU-2210-99', 'D201-BRE-0800-01', null]),
    lastCenterName: 'GRU-SP', arrivalShipmentNo: 'SETR2260' + Math.floor(rnd() * 15), arrivalScanTime: time(), dispatchTime: time(), sendNextStation: 'DC GRU-SP', isTimely: 'Fora do prazo'});
  const pct = v => v.toFixed(2) + '%';
  const day = {ws: ws, wsRate: pct(0.2 + rnd() * 1.1), se: se, seRate: pct(0.3 + rnd() * 0.6), mr: mr, mrRate: pct(0.5 + rnd() * 0.8),
    md: md, mdRate: pct(0.4 + rnd() * 0.9), sc: sc, scRate: pct(88 + rnd() * 9), dc: dc, dcRate: pct(89 + rnd() * 8)};
  return Object.assign(day, makeDamage(date, (seed || 7) * 31 + 5), makeArrival(date, (seed || 7) * 17 + 3));
}

/**
 * Avarias do dia estatístico no formato do Relatório de Taxa de Avaria (tabela 1) e os registros da
 * Consulta de Pacote Problemático (tabela 2). Operadores fictícios; campos iguais aos do JMS.
 */
function makeDamage(date, seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const types = ['Prod. interno extraviado embal.avariada 内件遗失外包装破损', 'Embalagem e produto interno avariados 内件破损外包装破损'];
  // Nomes fictícios (nada de cliente real nos testes).
  const clients = ['CLIENTE ALFA COMERCIO LTDA', 'CLIENTE BETA LOGISTICA LTDA', 'CLIENTE GAMA MARKETPLACE LTDA', 'CLIENTE DELTA INTERMEDIACAO LTDA', 'CLIENTE EPSILON TECNOLOGIA LTDA'];
  const specs = ['Itens Pessoal', 'Outros', 'Alimentos', 'Roupa', 'Produto Eletronico', 'Liquído'];
  const ops = ['OPERADOR AVARIA 01', 'OPERADOR AVARIA 02', 'OPERADOR AVARIA 03', 'OPERADOR AVARIA 04'];
  const prev = n => addDay(date, -n);
  const clock = () => String(Math.floor(rnd() * 24)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0');
  const dm = [], dmReg = [];
  const n = 120 + Math.floor(rnd() * 60);
  for (let i = 0; i < n; i++) {
    // ~1 em 4 é pedido filho (volume de uma remessa com vários volumes: "…-001", "…-002").
    const wb = (i % 3 ? '9998821' : '8880026') + date.replace(/-/g, '').slice(2) + String(i).padStart(3, '0') + (i % 4 === 1 ? '-00' + (1 + i % 3) : '');
    dm.push({id: 'D' + date + i, serialNum: String(i + 1), workOrderNum: 'ZC' + date.replace(/-/g, '') + String(i).padStart(6, '0'), waybillNo: wb,
      firstTypeCode: '003', firstTypeName: 'AVARIA 破损', secondTypeCode: 'Z41d', secondTypeName: pick(types),
      adjudicationAmount: Math.round(rnd() * 15000) / 100, declareTime: prev(5) + ' 02:0' + (i % 10) + ':00', closingTime: date + ' 02:05:02',
      responsibilityNetworkCode: '30001', responsibilityNetworkName: 'SP GRU', customerName: pick(clients), goodsName: 'Produto ' + (i % 17),
      productSpecificationName: pick(specs), orderTypeStr: 'arbitrate'});
    // Local da avaria (principal → secundário), como na tela do JMS.
    const loc = pick([['Recebimento', 'Transporte(Caminhão)'], ['Recebimento', 'Transporte(Caminhão)'], ['Recebimento', 'Operação(colaborador)'],
      ['Triagem', 'Esteira/Bancada'], ['Triagem', 'Operação(colaborador)'], ['Expedição', 'Carregamento']]);
    dm[dm.length - 1].damageLocationFirstName = loc[0];
    dm[dm.length - 1].damageLocationSecondName = loc[1];
    const u = rnd();
    if (u < 0.08) continue; // sem registro na tabela 2
    const regDay = prev(1 + Math.floor(rnd() * 6));
    const own = u < 0.9;
    // Registro de outro assunto ("Pedidos salvados") mais antigo: não pode ser escolhido.
    if (u > 0.5 && u < 0.6) dmReg.push({waybillNo: wb, code: 'PPCX' + i, probleTypeSubjectId: '815', probleTypeSubjectName: 'Pedidos.salvados.作废件',
      secondLevelTypeName: 'Descarte.total.全部弃置件', createByName: 'OUTRO REGISTRO', createTime: prev(9) + ' 01:00:00', registrationNetworkName: 'SP GRU'});
    dmReg.push({waybillNo: wb, code: 'PPC' + i, probleTypeSubjectId: '727', probleTypeSubjectName: 'Avaria.破损问题件',
      secondLevelTypeName: 'Produto.interno.extraviado.e.embalagem.avariada.外包装破损,内件遗失', createByName: pick(ops),
      createTime: regDay + ' ' + clock(), registrationNetworkName: own ? 'SP GRU' : 'PA SHEIN-GRU-SP'});
  }
  return {dm: dm, dmBase: 450000 + Math.floor(rnd() * 150000), dmReg: dmReg};
}

/**
 * Recebimento: fluxo operacional (Monitoramento de tipagem de recebimento). Duas listas por dia, no formato da
 * captura: "Deve chegar" (shouldArriverNum) e "Chegou" (totalNum), com DC/base de destino, viagem, estação,
 * última parada e digitalizador. Volumes reduzidos (o real é ~170 mil + ~330 mil por dia); remessas fictícias.
 */
function makeArrival(date, seed, scale) {
  let s = seed || 11;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const k = scale || 1;
  const time = () => date + ' ' + String(Math.floor(rnd() * 24)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0');
  const centers = ['BA FEC', 'SP BRE', 'MG CGE', 'PE JGS', 'SC FEC 01', 'CE FOR', 'MS CGR', 'DF BSB'];
  const bases = {'BA FEC': ['F JUA-BA', 'ITAP-BA'], 'SP BRE': ['F TPA-SP', 'SOD 02-SP'], 'MG CGE': ['PDE-MG', 'F NSR-MG'], 'PE JGS': ['PLT-PE', 'CPV 02-PB'],
    'SC FEC 01': ['CANA -BA', 'PER -BA'], 'CE FOR': ['TAU-CE'], 'MS CGR': ['F CGR 02-MS'], 'DF BSB': ['F SBN-DF']};
  const stations = ['PA AEROGRU-SP', 'PA SHEIN-GRU-SP', 'PA MELI-GRU 02-SP', 'GRU-SP', 'F S-VLGUI 02-SP'];
  const trips = ['SRTR22605739071', 'SETR22605829951', 'SRTR22605737431', null];
  const scanners = ['Equipamento SP GRU 009', 'Equipamento SP GRU 006', 'Temporário SP GRU 01'];
  const should = [], total = [];
  const nS = Math.round((500 + Math.floor(rnd() * 200)) * k), nT = Math.round((1000 + Math.floor(rnd() * 300)) * k);
  const tag = date.replace(/-/g, '').slice(2);
  for (let i = 0; i < nS; i++) {
    const c = pick(centers);
    should.push({billcode: '8880027' + tag + String(i).padStart(6, '0') + (i % 9 === 4 ? '-002' : ''), inputsite: pick(stations), sendTime: time(),
      nextstation: 'SP GRU', shipmentNo: pick(trips), endCenterName: i % 97 === 5 ? null : c, endArrivalSitename: i % 97 === 5 ? null : pick(bases[c])});
  }
  for (let i = 0; i < nT; i++) {
    const c = pick(centers);
    total.push({billcode: '9998827' + tag + String(i).padStart(6, '0'), inputsite: 'SP GRU', sendTime: time(), nextstation: rnd() < 0.2 ? 'PA SHEIN-GRU-SP' : null,
      scanuser: pick(scanners), shipmentNo: pick(trips), endCenterName: c, endArrivalSitename: pick(bases[c])});
  }
  // Listas pequenas (V3.17): remessas do "Chegou" sem bipe de expedição na etapa anterior / nesta base.
  const prev = total.filter((r, i) => i % 15 === 3).map(r => Object.assign({}, r));
  const noSend = total.filter((r, i) => i % 18 === 7).map(r => Object.assign({}, r));
  return {af: {should: should, total: total, prev: prev, noSend: noSend, noArriverNum: Math.round(nS * 0.43),
    uploadNoSendNum: prev.length, noSendNum: noSend.length}};
}

module.exports = {createContext: createContext, fakeJms: fakeJms, makeDay: makeDay, makeDamage: makeDamage, makeArrival: makeArrival, sheetCoerce: sheetCoerce, bigWrongSend: bigWrongSend};
