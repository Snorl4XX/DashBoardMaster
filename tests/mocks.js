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
    .replace('HH', g('hour') === '24' ? '00' : g('hour')).replace('mm', g('minute')).replace('ss', g('second'))
    .replace(/H/, () => String(Number(g('hour')) % 24)); // 'H' = hora sem zero (hourNow_), como no Apps Script
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
  const files = ['Config', 'Core', 'Utils', 'JmsApi', 'Storage', 'Expedicao', 'Analytics', 'Report', 'Triggers', 'Code'];
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
    // Sem Movimentação: foto do momento — o JMS não recebe data; serve a foto do último dia com "nm" (options.noMoveDate muda).
    if (route === 'trajectory_monitor_total' || route === 'trajectory_monitor_detail') return noMoveRoute(route, body, dayData, options, ok, respond, size);
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
    // Códigos como na tela (captura de 03/10: mainSubCode "MAIN" = Pedido principal; "SUB" = secundário, simulado).
    // options.unknownCodeIgnored: código desconhecido devolve Todos (em vez de vazio).
    const dmKind = b => {
      if (options.ignoreMainSub || b.mainSubCode === undefined || b.mainSubCode === null || b.mainSubCode === '') return null;
      const codes = options.orderKindCodes || {main: 'MAIN', sub: 'SUB'};
      return b.mainSubCode === codes.main ? 'main' : b.mainSubCode === codes.sub ? 'sub' : options.unknownCodeIgnored ? null : 'none';
    };
    // options.plainChildren: o JMS mostra os pedidos filhos sem o sufixo "-001" (número próprio).
    const dmList = dd => dd.dm.map(r => {
      // options.suffixOnMain: o contrário do comum — as remessas com sufixo "-001" são as do principal (o painel não pode
      // decidir pelo sufixo; vale a "Qtd processada" de cada opção, como na tela).
      const child = /-\d{3}$/.test(r.waybillNo) !== !!options.suffixOnMain;
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
        // "Pedidos principais/filhos": mainSubCode (principal "MAIN" como na tela, filho "SUB"; options.orderKindCodes troca).
        // Filho = remessa com sufixo "-001"; o volume (operaNumber) também muda com a opção. Código desconhecido = vazio.
        let list = dmList(d), base = d.dmBase;
        const kind = dmKind(body);
        if (kind === 'none') return ok([], 0, 1, body.size);
        if (kind) {
          const subBase = Math.round(d.dmBase * 0.12);
          list = list.filter(r => r._child === (kind === 'sub'));
          // options.optionNoVolume: como na tela do JMS em 01/10 — com a opção escolhida, "Qtd processada" 0 e taxa 0.
          // options.optionBases: "Qtd processada" de cada opção (ex.: a tela de 01/10 — principal 498.429, secundário 65.847).
          base = options.optionNoVolume ? 0 : options.optionBases ? options.optionBases[kind] : kind === 'sub' ? subBase : d.dmBase - subBase;
        }
        const rate = base ? Math.round(list.length / base * 1e6 * 100) / 100 : 0;
        // Com a opção, a coluna "Taxa…" (breakageRate) usa o volume de Todos; a 总破损率 (breakageRateTotal), o da opção.
        const rateOther = kind ? Math.round(list.length / d.dmBase * 1e6 * 100) / 100 : rate;
        // options.dmRateSwap: o contrário (tela de 06/10: com "Pedido principal", o breakageRateTotal vem com a Qtd de Todos).
        let rTot = options.dmRateSwap ? rateOther : rate, rOne = options.dmRateSwap ? rate : rateOther;
        // options.dmRateOverride: com a opção, campos de taxa que não são a conta da linha (o painel usa o do JMS, sem calcular).
        if (kind && options.dmRateOverride) { rTot = options.dmRateOverride.total; rOne = options.dmRateOverride.one; }
        return ok([{id: '97308731485720' + date.slice(8), serialNum: '1', statisticalDate: date, agentAreaCode: '370000', agentAreaName: 'SPE',
          networkCode: '30001', networkName: 'SP GRU', operaNumber: base, breakageTicketNumber: list.length, breakageRate: rOne,
          breakageAmount: list.reduce((a, r) => a + r.adjudicationAmount, 0), breakageNumberTotal: list.length, breakageRateTotal: rTot,
          monthBreakageRate: 180.46, pickUpDayTotal: null, mainSubCode: body.mainSubCode === undefined ? null : body.mainSubCode}], 1, 1, body.size);
      }
      case 'detailBreakageRateData': {
        if (!d || !d.dm) return ok([], 0, 1, body.size);
        const sz = Math.min(100, body.size); // a tela do JMS mostra no máximo 100 linhas por página
        // options.detailIgnoresOrderKind: a lista do detalhe devolve Todos mesmo com a opção.
        const kind = options.detailIgnoresOrderKind ? null : dmKind(body);
        if (kind === 'none') return ok([], 0, 1, body.size);
        const list = dmList(d).filter(r => !kind || r._child === (kind === 'sub'));
        return ok(list.slice((body.current - 1) * sz, body.current * sz).map(r => { const o = Object.assign({}, r); delete o._child; return o; }), list.length, body.current, sz);
      }
      case 'arrivalbyday_total': {
        if (!d || !d.af) return ok([], 0, 1, body.size);
        const a = d.af;
        // Como o JMS real (V3.21): o resumo é DIÁRIO — consultado por horário, devolve o dia inteiro na janela que
        // começa à 00h e nada nas outras (os turnos não podem vir daqui).
        if (!(start === full.start && end === full.end) && start.slice(11) !== '00:00:00') return ok([], 0, 1, body.size);
        return ok([{sendTime: date, proxyAreaCode: '370000', proxyAreaName: 'SPE', nextstation: 'SP GRU', nextstationcode: '30001',
          shouldArriverNum: a.should.length, noArriverNum: a.noArriverNum, totalNum: a.total.length, uploadNoSendNum: a.prev.length,
          noSendNum: a.noSend.length, noSignNum: a.total.length, deliverNum: a.total.length, PAGEHELPER_ROW_ID: 1, ROW_ID: 1}], 1, 1, body.size);
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
        // options.detailDailyFor: essas listas também são diárias (dia inteiro na janela da 00h, nada nas outras).
        const daily = (options.detailDailyFor || []).indexOf(body.detailType) >= 0 && !(start === full.start && end === full.end);
        const list = daily ? (start.slice(11) === '00:00:00' ? lists[body.detailType] : []) : inWindowBy(lists[body.detailType] || [], 'sendTime');
        const sz = Math.min(options.maxPageSize || 1000, body.size);
        return ok(list.slice((body.current - 1) * sz, body.current * sz).map((r, i) => Object.assign({PAGEHELPER_ROW_ID: i + 1}, r)), list.length, body.current, sz);
      }
      // ----- Expedição: fluxo operacional (formato das capturas do documento; rotas e remessas fictícias) -----
      case 'sendbyday_total': {
        if (!d || !d.sf) return ok([], 0, 1, body.size);
        if (body.scansitecode !== '30001') return ok([], 0, 1, body.size);
        // Como o JMS real: o resumo é do dia inteiro (sem janela por horário).
        const recs = d.sf.routes.map((r, i) => ({scantime: date, proxyAreaCode: '370000', proxyAreaName: 'SPE', inputsite: 'SP GRU', scansitecode: '30001',
          nextstation: r.name, nextstationcode: r.code, sendcount: r.sent.length, noarrivalcount: r.sent.filter(x => x.transit).length,
          nosigncount: r.sent.filter(x => x.undelivered).length, PAGEHELPER_ROW_ID: i + 1, ROW_ID: i + 1}));
        const sz = body.size;
        return ok(recs.slice((body.current - 1) * sz, body.current * sz), recs.length, body.current, sz);
      }
      case 'sendbyday_detail': {
        if (!d || !d.sf) return ok([], 0, 1, body.size);
        const sz = Math.min(options.sendMaxPage || 100, body.size); // "O LIMITE É 100 LINHAS"
        // Sem nextstation o JMS devolveria as remessas de TODAS as rotas (payload sem filtro).
        const routes = body.nextstation ? d.sf.routes.filter(r => r.code === String(body.nextstation)) : d.sf.routes;
        let list = [];
        routes.forEach(r => r.sent.forEach(x => list.push(x)));
        if (body.detailType === 'noarrivalcount') list = list.filter(x => x.transit);
        else if (body.detailType === 'nosigncount') list = list.filter(x => x.undelivered);
        else if (body.detailType !== 'sendcount') return respond(200, {code: 500, msg: 'detailType inválido', fail: true});
        // options.sendIgnoresTime: devolve o dia inteiro em qualquer horário; options.sendDailyAt00: só na janela da 00h.
        const whole = start === full.start && end === full.end;
        if (options.sendDailyAt00 && !whole) list = start.slice(11) === '00:00:00' ? list : [];
        else if (!options.sendIgnoresTime && !whole) list = list.filter(x => x.sendTime >= start && x.sendTime <= end);
        const recs = list.slice((body.current - 1) * sz, body.current * sz).map((x, i) => ({billcode: x.billcode, inputsite: 'SP GRU', sendTime: x.sendTime,
          nextstation: x.route, scanuser: x.scanuser, PAGEHELPER_ROW_ID: (body.current - 1) * sz + i + 1, ROW_ID: (body.current - 1) * sz + i + 1}));
        return ok(recs, list.length, body.current, sz);
      }
      case 'keywordList': {
        if (!Array.isArray(body.keywordList) || body.trackingTypeEnum !== 'WAYBILL') return respond(200, {code: 500, msg: 'parâmetro inválido', fail: true});
        state.tripCalls = (state.tripCalls || 0) + 1;
        // options.tripLimit: o JMS só devolve as primeiras N remessas da consulta; options.tripReject: recusa acima de N.
        if (options.tripReject && body.keywordList.length > options.tripReject) return respond(200, {code: 500, msg: '单次查询最多' + options.tripReject + '条', fail: true});
        const kws = options.tripLimit ? body.keywordList.slice(0, options.tripLimit) : body.keywordList;
        const all = {};
        Object.keys(dayData).forEach(k => ((dayData[k].sf || {}).routes || []).forEach(r => r.sent.forEach(x => { all[x.billcode] = x; })));
        const data = kws.filter(w => all[w]).map(w => {
          const x = all[w], det = [];
          // Bipes como na tela: recebido na base (com o ID da viagem de CHEGADA), carregado na base para a rota (ID que vale).
          det.push({billCode: w, waybillNo: w, scanTime: x.sendTime.slice(0, 11) + '00:00:01', scanTypeName: 'Encomenda recebida', scanNetworkName: 'SP GRU',
            scanNetworkId: 2826, nextStopName: 'PA FICTICIO-SP', remark2: 'CHEGADA' + x.billcode.slice(-3), code: 2, originalScanTypeCode: 90});
          if (x.trip !== null) det.push({billCode: w, waybillNo: w, scanTime: x.sendTime, scanTypeName: 'Encomenda carregada', scanNetworkName: 'SP GRU',
            scanNetworkId: 2826, nextStopName: x.route, remark2: x.trip, code: 1, originalScanTypeCode: 50});
          // Carregamento anterior em outra base (não é o nosso): não pode ser escolhido.
          det.push({billCode: w, waybillNo: w, scanTime: x.sendTime.slice(0, 11) + '00:00:00', scanTypeName: 'Encomenda carregada', scanNetworkName: 'PA FICTICIO-SP',
            scanNetworkId: 1732, nextStopName: 'SP GRU', remark2: 'OUTRA' + x.billcode.slice(-3), code: 1, originalScanTypeCode: 50});
          return {keyword: w, details: det.reverse(), codes: null};
        });
        return respond(200, {code: 1, msg: '1:Solicitação concluída', data: data, succ: true, fail: false});
      }
      // ----- Fluxo de Lotes (formato das capturas; sacas e destinos fictícios) -----
      case 'sdploopbagBuildbagCount': {
        if (!d || !d.lt || body.totalType !== 'center' || body.queryType !== 'days') return ok([], 0, 1, body.size);
        if (!(start === full.start && end === full.end)) return ok([], 0, 1, body.size);
        const L = d.lt, eco = L.filter(b => b.isLoopPag === 'Y'), sumQ = l => l.reduce((a, b) => a + b.packageQty, 0);
        const pct = (a, b) => (b ? (a / b * 100).toFixed(2) : '0.00') + '%';
        const rec = {queryDate: date, startTime: full.start, endTime: full.end, proxyAreaCode: '370000', proxyAreaName: 'SPE', proxySiteCode: '30001',
          proxySiteName: 'SP GRU', portName: '全部', packageName: '全部', packageSourceName: '全部', packageSum: L.length, loopSum: eco.length,
          noloopSum: L.length - eco.length, loopRate: pct(eco.length, L.length), waybillSum: sumQ(L), loopWaybillSum: sumQ(eco),
          loopWaybillRate: pct(sumQ(eco), sumQ(L)), end: 'end', PAGEHELPER_ROW_ID: 1, ROW_ID: 1};
        // options.lotOtherSite: o JMS manda também a linha de outra base (o painel usa só a nossa).
        const recs = options.lotOtherSite ? [Object.assign({}, rec, {proxySiteCode: '99999', proxySiteName: 'OUTRA BASE', packageSum: 5000, loopSum: 1})].concat([rec]) : [rec];
        return ok(recs, recs.length, 1, body.size);
      }
      case 'sdploopbagBuildbagDetail': {
        if (!d || !d.lt) return ok([], 0, 1, body.size);
        const sz = Math.min(100, body.size); // "PODENDO CHEGAR ATÉ 100 LINHAS"
        // Sem a base no payload, o JMS devolveria as sacas de todas as bases (payload sem filtro).
        let list = body.proxySiteCode === '30001' ? d.lt : d.lt.concat(d.lt.map(b => Object.assign({}, b, {packageCode: b.packageCode + 'X', proxySiteName: 'OUTRA BASE FICTICIA'})));
        if (body.detailType === 'loopSum') list = list.filter(b => b.isLoopPag === 'Y');
        else if (body.detailType === 'noloopSum') list = list.filter(b => b.isLoopPag === 'N');
        else if (body.detailType !== 'packageSum') return respond(200, {code: 500, msg: 'detailType inválido', fail: true});
        if (!(start === full.start && end === full.end)) list = list.filter(b => b.scanDateTime >= start && b.scanDateTime <= end);
        const recs = list.slice((body.current - 1) * sz, body.current * sz).map((b, i) => Object.assign({queryDate: date, proxyAreaName: 'SPE', proxySiteName: 'SP GRU',
          proxySiteType: '中心'}, b, {arriveTime: null, openTime: null, end: 'end', PAGEHELPER_ROW_ID: (body.current - 1) * sz + i + 1, ROW_ID: (body.current - 1) * sz + i + 1}));
        return ok(recs, list.length, body.current, sz);
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
  const logins = ['OPERADOR FICTICIO 01', 'OPERADORA FICTÍCIA GONÇALO 02', 'OPERADOR FICTICIO 03', 'OPERADORA FICTICIA 04', 'OPERADOR FICTICIO 05'];
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
  return Object.assign(day, makeDamage(date, (seed || 7) * 31 + 5), makeArrival(date, (seed || 7) * 17 + 3), makeSend(date, (seed || 7) * 13 + 1),
    makeLots(date, (seed || 7) * 19 + 2), makeNoMove(date, (seed || 7) * 23 + 4));
}

/** Tipos de bipe da tela "Monitoramento de movimentação em tempo real (novo)" (código → nome na lista). */
const NM_TYPES = [['发件扫描', 'Bipe de expedição'], ['问题件扫描', 'Bipe de pacote problemático'], ['中心到件', 'Chegadas ao centro'],
  ['建包扫描', 'Encomenda inserida em lote'], ['留仓件入仓', 'Entrada no galpão de pacote não expedido'], ['拆包扫描', 'Encomenda retirada do lote']];
/** Coluna "dias sem movimentação" do resumo para um Aging (1–7, 10, 14, 30; 8–9 caem em 7). */
function nmDayKey(n) { return n >= 30 ? 'day30' : n >= 14 ? 'day14' : n >= 10 ? 'day10' : n >= 7 ? 'day7' : 'day' + Math.max(1, n); }
/**
 * Sem Movimentação: pedidos parados no formato da lista "Total de pedidos sem movimentação" (trajectory_monitor_detail).
 * Remessas, operadores, IDs, bases e clientes FICTÍCIOS. Os dois últimos tipos ficam vazios, como na captura.
 */
function makeNoMove(date, seed, scale) {
  let s = seed || 5;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const two = x => String(x).padStart(2, '0');
  const n = Math.round((300 + Math.floor(rnd() * 80)) * (scale || 1)), tag = date.replace(/-/g, '').slice(2), nm = [];
  const ages = [1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 10, 14, 30];
  const problems = [null, null, null, null, 'Erro.de.triagem.错分', 'Encomenda.expedida.mas.não.chegou.有发未到件', 'Envio.errado.错发'];
  for (let i = 0; i < n; i++) {
    const t = NM_TYPES[Math.floor(rnd() * 4)], age = pick(ages);
    const day = new Date(Date.parse(date + 'T12:00:00Z') - (age + 1) * 86400000).toISOString().slice(0, 10);
    nm.push({billcode: '7770' + tag + String(i).padStart(6, '0'), packageNumber: 1, stationName: rnd() < 0.15 ? 'ESTACAO FICTICIA ' + two(1 + Math.floor(rnd() * 9)) : null,
      pickAgentName: pick(['SPS', 'SPE', 'MG', 'RJ']), pickNetworkCode: String(310000 + Math.floor(rnd() * 40)),
      pickNetworkName: pick(['PA FICTICIA-SP', 'F ALFA-SP', 'PA BETA-SP', 'F GAMA-MG', 'PA DELTA-RJ', 'F EPSILON-SP']),
      scanAgentName: 'SPE', scanCode: '30001', scanName: 'SP GRU', operateType: t[0] + '/' + t[1],
      operateUser: pick(['Operador Ficticio 01', 'Operador Ficticio 02', 'Operador Ficticio 03', 'Operador Ficticio 04']),
      operateTime: day + ' ' + two(Math.floor(rnd() * 24)) + ':' + two(Math.floor(rnd() * 60)) + ':' + two(Math.floor(rnd() * 60)),
      nextStation: null, overType: 'Exceed ' + age + (age === 1 ? ' day' : ' days') + ' with no track',
      abbreviation: pick(['CLIENTE ALFA', 'CLIENTE BETA', 'LOJA FICTICIA']), expressTypeName: 'EZ', orderSourceName: pick(['ORIGEM A', 'ORIGEM B', 'APIJMS']),
      transfercode: pick(['XXGX' + tag + '00001', 'XXGX' + tag + '00002', 'YYTR' + tag + '00003', null]), problemName: pick(problems),
      dutyName: 'SP GRU', dutyAgentName: 'SPE', senderProvinceName: 'SP', dispatchFinanceName: pick(['SPE', 'MG', 'PR']),
      receiverProvinceName: pick(['SP', 'MG', 'PR']), dispatchNetworkName: pick(['DC FICTICIO-SP', 'F ZETA-MG', 'PA ETA-PR']), _age: age});
  }
  return {nm: nm};
}
/** Linha da tabela do JMS de um tipo de bipe (Tempo real ou Histórico de um dia). */
function nmRow(code, l, extra) {
  const rec = Object.assign({scanAgentName: 'SPE', scanAgentCode: '370000', dutyCode: '30001', dutyName: 'SP GRU', modleType: 'modern', operateType: code,
    total: l.length, halfwayCount: l.length * 7, day1: 0, day2: 0, day3: 0, day4: 0, day5: 0, day6: 0, day7: 0, day10: 0, day14: 0, day30: 0,
    operateTime: l.map(r => r.operateTime).sort().pop()}, extra || {});
  l.forEach(r => { rec[nmDayKey(r._age)]++; });
  rec.dayRate14 = (rec.day14 / l.length * 100).toFixed(2) + '%'; rec.dayRate30 = (rec.day30 / l.length * 100).toFixed(2) + '%';
  return rec;
}
/**
 * Resumo (uma linha por tipo, como a tabela da tela) e lista (um tipo por vez) da foto do momento.
 * V3.32 — Histórico (modleType "history", startDate/endDate como na captura): uma linha por dia (dateTime) e tipo, com
 * números diferentes do tempo real (90% dos pedidos do dia); a lista do Histórico segue as mesmas datas.
 * options.histDetailIgnored: a lista ignora o Histórico (devolve a do tempo real) — o painel tem de recusar.
 */
function noMoveRoute(route, body, dayData, options, ok, respond, size) {
  const days = Object.keys(dayData).filter(k => dayData[k] && dayData[k].nm).sort();
  const nm = (dayData[options.noMoveDate || days[days.length - 1]] || {}).nm || [];
  const clean = r => { const o = Object.assign({}, r); delete o._age; return o; };
  const hist = body.modleType === 'history';
  const d0 = String(body.startDate || '').slice(0, 10), d1 = String(body.endDate || '').slice(0, 10);
  const histOf = d => ((dayData[d] || {}).nm || []).filter((r, i) => i % 10 !== 3);
  if (hist && (!/^\d{4}-\d{2}-\d{2} 00:00:00$/.test(String(body.startDate)) || !/^\d{4}-\d{2}-\d{2} 23:59:59$/.test(String(body.endDate)))) {
    return respond(200, {code: 500, msg: '参数错误', fail: true});
  }
  if (route === 'trajectory_monitor_total') {
    if (body.groupType !== 'center' || !Array.isArray(body.operateType) || body.scanCode !== '30001') return ok([], 0, 1, body.size);
    const recs = [];
    if (hist) {
      days.filter(d => d >= d0 && d <= d1).reverse().forEach(d => NM_TYPES.forEach(([code]) => {
        if (body.operateType.indexOf(code) < 0) return;
        const l = histOf(d).filter(r => r.operateType.split('/')[0] === code);
        if (l.length) recs.push(nmRow(code, l, {dateTime: d, modleType: 'history'}));
      }));
      const sz = body.size || 20, page = recs.slice((body.current - 1) * sz, body.current * sz);
      return ok(page.map((r, i) => Object.assign(r, {PAGEHELPER_ROW_ID: (body.current - 1) * sz + i + 1, ROW_ID: (body.current - 1) * sz + i + 1})), recs.length, body.current, sz);
    }
    NM_TYPES.forEach(([code]) => {
      if (body.operateType.indexOf(code) < 0) return;
      const l = nm.filter(r => r.operateType.split('/')[0] === code);
      if (!l.length) return; // tipo sem pedido parado: a tabela do JMS não mostra a linha
      recs.push(nmRow(code, l));
    });
    return ok(recs.map((r, i) => Object.assign(r, {PAGEHELPER_ROW_ID: i + 1, ROW_ID: i + 1})), recs.length, 1, body.size);
  }
  if (body.queryType !== 2 || !Array.isArray(body.operateType) || body.operateType.length !== 1) return respond(200, {code: 500, msg: '参数错误', fail: true});
  // Sem a Unidade responsável no payload, o JMS devolveria os pedidos de todas as bases (payload sem filtro).
  const src = hist && !options.histDetailIgnored ? histOf(d0) : nm;
  let list = src.filter(r => r.operateType.split('/')[0] === body.operateType[0]);
  if (body.dutyCode !== '30001') list = list.concat(list.map(r => Object.assign({}, r, {billcode: r.billcode + 'X', dutyName: 'OUTRA BASE FICTICIA'})));
  const sz = Math.min(100, size);
  const recs = list.slice((body.current - 1) * sz, body.current * sz).map((r, i) => Object.assign(clean(r), {PAGEHELPER_ROW_ID: (body.current - 1) * sz + i + 1, ROW_ID: (body.current - 1) * sz + i + 1}));
  return ok(recs, list.length, body.current, sz);
}

/**
 * Fluxo de Lotes: sacas criadas no dia no formato da lista "Total de pacotes construídos" (número da saca, tipo de entrada e saída
 * 出港/进港, saca ecológica com chip, itens na embalagem, tempo de ensacamento, destino). Números de saca e destinos FICTÍCIOS.
 */
function makeLots(date, seed, scale) {
  let s = seed || 9;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const n = Math.round((150 + Math.floor(rnd() * 60)) * (scale || 1));
  const dests = ['DC FICTICIO-AL', 'RT ALFA', 'RT BETA', 'F FICTICIA-SP', 'DC FICTICIO-AM', 'RT GAMA'];
  const tag = date.replace(/-/g, '').slice(2), lt = [];
  const two = x => String(x).padStart(2, '0');
  for (let i = 0; i < n; i++) {
    const eco = rnd() < 0.34, h = Math.floor(rnd() * 24);
    lt.push({portName: rnd() < 0.6 ? '出港' : '进港', packageName: '普通包', packageSourceName: 'JT', packageCode: 'BR9' + tag + String(i).padStart(5, '0'),
      chipNo: eco ? '9' + tag + String(i).padStart(7, '0') : null, packageQty: 1 + Math.floor(rnd() * 50),
      scanDateTime: date + ' ' + two(h) + ':' + two(Math.floor(rnd() * 60)) + ':' + two(Math.floor(rnd() * 60)), openSiteName: dests[Math.floor(rnd() * dests.length)],
      isLoopPag: eco ? 'Y' : 'N'});
  }
  return {lt: lt};
}

/**
 * Expedição: fluxo operacional. Rotas FICTÍCIAS (próxima parada e código), remessas sintéticas e operadores fictícios.
 * Cada remessa: horário de expedição, rota, login, ID de viagem (null = sem bipe de carregamento na base; '' = sem número)
 * e as marcas das listas (não chegou na próxima parada / não entregue). As rotas cobrem os casos da tela: todas as remessas
 * sem chegar (lista igual ao total), nenhuma, parte; e uma rota concentrada na madrugada (T3).
 */
function makeSend(date, seed, scale) {
  let s = seed || 5;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const k = scale || 1;
  const ops = ['OPERADOR EXPEDICAO 01', 'OPERADOR EXPEDICAO 02', 'OPERADOR EXPEDICAO 03', 'OPERADOR EXPEDICAO 04', 'OPERADOR EXPEDICAO 05'];
  const tag = date.replace(/-/g, '').slice(2);
  const defs = [
    {name: 'RT ALFA', code: '90101', n: 640, transit: 1, undelivered: 1, night: true},
    {name: 'RT BETA', code: '90102', n: 410, transit: 0.4, undelivered: 1},
    {name: 'RT GAMA', code: '90103', n: 260, transit: 0, undelivered: 0.7},
    {name: 'DC FICTICIO-SP', code: '90104', n: 150, transit: 0.02, undelivered: 1},
    {name: 'RT DELTA', code: '90105', n: 90, transit: 1, undelivered: 1}
  ];
  const clock = night => {
    const h = night ? Math.floor(rnd() * 6) : Math.floor(rnd() * 24);
    return date + ' ' + String(h).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0');
  };
  let seq = 0;
  const routes = defs.map((d, ri) => {
    const n = Math.round(d.n * k * (0.85 + rnd() * 0.3)), sent = [];
    for (let i = 0; i < n; i++) {
      const time = clock(d.night && rnd() < 0.9);
      const u = rnd();
      const trip = u < 0.03 ? null : u < 0.05 ? '' : 'VIAGEM' + tag + ri + (Number(time.slice(11, 13)) < 12 ? 'A' : 'B');
      sent.push({billcode: '7770' + tag + String(++seq).padStart(6, '0') + (i % 11 === 3 ? '-001' : ''), sendTime: time, route: d.name, scanuser: ops[Math.floor(rnd() * ops.length)],
        trip: trip, transit: rnd() < d.transit, undelivered: false});
    }
    // Quem não chegou também não foi entregue; os demais conforme a rota.
    sent.forEach(x => { x.undelivered = x.transit || rnd() < d.undelivered; });
    return {name: d.name, code: d.code, sent: sent};
  });
  return {sf: {routes: routes}};
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
  const trips = ['SRTR00000000001', 'SETR00000000002', 'SRTR00000000003', null];
  const scanners = ['Equipamento FICTICIO 01', 'Equipamento FICTICIO 02', 'Temporário FICTICIO 01'];
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

module.exports = {createContext: createContext, fakeJms: fakeJms, makeDay: makeDay, makeDamage: makeDamage, makeArrival: makeArrival, makeSend: makeSend, makeLots: makeLots, makeNoMove: makeNoMove, sheetCoerce: sheetCoerce, bigWrongSend: bigWrongSend};
