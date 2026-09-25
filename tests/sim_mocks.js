/* Simulação com RELÓGIO VIRTUAL, custo de cada serviço do Apps Script e cotas (usada por simulacao_cotas.js).
   Mesmo modelo de tests/mocks.js, mas com volumes reais do SP GRU. */
const fs = require('fs'), vm = require('vm'), path = require('path'), zlib = require('zlib');
const TZ = 'America/Sao_Paulo';

function makeClock(startIso) {
  const clock = {now: Date.parse(startIso), stats: {urlfetch: 0, driveCreate: 0, driveRead: 0, sheetWrites: 0, propReads: 0}};
  class VDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  clock.Date = VDate;
  clock.tick = ms => { clock.now += ms; };
  return clock;
}

const COST = {fetch: 1500, fetchAllBase: 1500, fetchAllPer: 150, driveCreate: 700, driveRead: 400, openSs: 1000,
  append: 300, setValues: 250, getValuesBase: 100, getValuesPerCell: 0.01, prop: 30, cache: 20};

function fmtDate(d, tz, fmt) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).formatToParts(new Date(+d));
  const g = t => parts.find(p => p.type === t).value;
  return fmt.replace('yyyy', g('year')).replace('MM', g('month')).replace('dd', g('day'))
    .replace('HH', g('hour') === '24' ? '00' : g('hour')).replace('mm', g('minute')).replace('ss', g('second'));
}

function createSimContext(opts) {
  const clock = opts.clock, VDate = clock.Date, st = clock.stats;
  function sheetCoerce(v) {
    if (typeof v === 'string') {
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return new VDate(Date.UTC(+m[1], +m[2] - 1, +m[3], 3, 0, 0));
      if (/^-?\d{1,15}(\.\d+)?$/.test(v)) return Number(v);
    }
    if (v === null || v === undefined) return '';
    return v;
  }
  const state = {seq: 0, spreadsheets: {}, files: {}, props: Object.assign({}, opts.props || {}), cache: {}, triggers: []};
  function Range(sheet, r, c, nr, nc) { this.sheet = sheet; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1; }
  ['setBackground', 'setFontColor', 'setFontWeight', 'setFontSize', 'setWrap', 'setVerticalAlignment', 'setHorizontalAlignment',
    'setNumberFormat', 'setBorder', 'merge'].forEach(n => { Range.prototype[n] = function () { return this; }; });
  Range.prototype.getValues = function () {
    clock.tick(COST.getValuesBase + COST.getValuesPerCell * this.nr * this.nc);
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = this.sheet.data[this.r - 1 + i] || []; const v = []; for (let j = 0; j < this.nc; j++) v.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]); out.push(v); }
    return out;
  };
  Range.prototype.setValues = function (values) {
    clock.tick(COST.setValues + values.length * values[0].length * 0.02); st.sheetWrites++;
    values.forEach((row, i) => { const idx = this.r - 1 + i; while (this.sheet.data.length <= idx) this.sheet.data.push([]); row.forEach((v, j) => { this.sheet.data[idx][this.c - 1 + j] = sheetCoerce(v); }); });
    return this;
  };
  Range.prototype.setValue = function (v) { return this.setValues([[v]]); };
  function Sheet(name) { this.name = name; this.data = []; }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.setName = function (n) { this.name = n; return this; };
  Sheet.prototype.getLastRow = function () { for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i] && this.data[i].some(v => v !== '' && v !== undefined)) return i + 1; return 0; };
  Sheet.prototype.getLastColumn = function () { return this.data.reduce((m, r) => Math.max(m, (r || []).length), 0); };
  Sheet.prototype.getRange = function (a, b, c, d) { return new Range(this, a, b, c, d); };
  Sheet.prototype.appendRow = function (row) { clock.tick(COST.append); st.sheetWrites++; this.data.splice(this.getLastRow(), 0, row.map(sheetCoerce)); return this; };
  ['setFrozenRows', 'setHiddenGridlines', 'setColumnWidths', 'setColumnWidth', 'setRowHeight', 'clear'].forEach(n => { Sheet.prototype[n] = function () { return this; }; });
  function Spreadsheet(id) { this.id = id; this.sheets = [new Sheet('Sheet1')]; }
  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getUrl = function () { return 'https://docs/' + this.id; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets; };
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.find(s => s.name === n) || null; };
  Spreadsheet.prototype.insertSheet = function (n) { const s = new Sheet(n); this.sheets.push(s); return s; };
  Spreadsheet.prototype.getSpreadsheetTimeZone = function () { return TZ; };
  Spreadsheet.prototype.setSpreadsheetTimeZone = function () {};
  function blob(bytes, type, name) {
    return {bytes: Buffer.from(bytes), type, name, getBytes() { return Array.from(this.bytes); }, getDataAsString() { return this.bytes.toString('utf8'); },
      setName(n) { this.name = n; return this; }, getName() { return this.name; }, setContentType(t) { this.type = t; return this; }, copyBlob() { return blob(this.bytes, this.type, this.name); }};
  }
  function folderApi(id) {
    return {getId: () => id, createFile: b => { clock.tick(COST.driveCreate); st.driveCreate++; const fid = 'file' + (++state.seq); state.files[fid] = {blob: b}; return {getId: () => fid, getUrl: () => 'u' + fid}; }};
  }
  function fetchOne(url, req) { st.urlfetch++; st.urlfetchDay = (st.urlfetchDay || 0) + 1; if (opts.urlfetchQuota && st.urlfetchDay > opts.urlfetchQuota) throw new Error('Service invoked too many times for one day: urlfetch.'); return opts.jms(url, req, clock); }
  const context = {
    console: {log() {}, error() {}, warn() {}},
    Date: VDate, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Intl, encodeURIComponent, Buffer,
    PropertiesService: {getScriptProperties: () => ({
      getProperty: k => { clock.tick(COST.prop); st.propReads++; return state.props[k] === undefined ? null : state.props[k]; },
      getProperties: () => { clock.tick(COST.prop); st.propReads++; return Object.assign({}, state.props); },
      setProperty: (k, v) => { clock.tick(COST.prop); state.props[k] = String(v); },
      deleteProperty: k => { clock.tick(COST.prop); delete state.props[k]; }
    })},
    CacheService: {getScriptCache: () => ({get: k => { clock.tick(COST.cache); return state.cache[k] === undefined ? null : state.cache[k]; },
      put: (k, v) => { clock.tick(COST.cache); state.cache[k] = String(v); }, remove: k => { delete state.cache[k]; }})},
    LockService: {getScriptLock: () => ({tryLock: () => true, waitLock: () => true, releaseLock: () => {}, hasLock: () => true})},
    SpreadsheetApp: {create: () => { const ss = new Spreadsheet('ss' + (++state.seq)); state.spreadsheets[ss.id] = ss; return ss; },
      openById: id => { clock.tick(COST.openSs); return state.spreadsheets[id]; }, flush: () => {}},
    DriveApp: {createFolder: () => folderApi('fold' + (++state.seq)), getFolderById: id => folderApi(id),
      getFileById: id => ({getBlob: () => { clock.tick(COST.driveRead); st.driveRead++; return state.files[id].blob; }, setTrashed: () => {}, getId: () => id})},
    Utilities: {formatDate: fmtDate, getUuid: () => 'uuid-' + (++state.seq), sleep: ms => clock.tick(ms),
      newBlob: (d, t, n) => blob(typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d), t, n),
      gzip: b => blob(zlib.gzipSync(b.bytes), 'application/x-gzip', b.name + '.gz'), ungzip: b => blob(zlib.gunzipSync(b.bytes), 'application/json', b.name),
      base64Encode: b => Buffer.from(b).toString('base64')},
    UrlFetchApp: {
      fetch: (url, req) => { clock.tick(COST.fetch); return fetchOne(url, req); },
      fetchAll: reqs => { clock.tick(COST.fetchAllBase + COST.fetchAllPer * reqs.length); return reqs.map(r => fetchOne(r.url, r)); }
    },
    ScriptApp: {getProjectTriggers: () => state.triggers.map(h => ({getHandlerFunction: () => h})),
      newTrigger: h => { const b = {timeBased: () => b, everyHours: () => b, everyMinutes: () => b, everyDays: () => b, atHour: () => b, create: () => { state.triggers.push(h); }}; return b; },
      deleteTrigger: () => {}, getOAuthToken: () => 't'}
  };
  vm.createContext(context);
  const files = ['Config', 'Core', 'Utils', 'JmsApi', 'Storage', 'Analytics', 'Report', 'Triggers', 'Code'];
  vm.runInContext(files.map(f => fs.readFileSync(path.join(opts.root, f + '.gs'), 'utf8')).join('\n;\n'), context, {filename: 'projeto.gs'});
  context.__state = state;
  return context;
}

/** JMS realista: volumes do SP GRU, limite de tamanho de página e dia corrente crescendo. */
const VOLUME = {ws: 1600, se: 300, mr: 3000, md: 3000, sc: 34000, dc: 1400};
function realisticJms(opts) {
  opts = opts || {};
  const cap = opts.maxPageSize || 1000;
  const cache = {};
  function dayList(date, kind) {
    const k = date + kind;
    if (cache[k]) return cache[k];
    const n = VOLUME[kind], out = new Array(n);
    let s = 1 + date.split('-').join('') % 9973 + kind.charCodeAt(0);
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const two = x => String(x).padStart(2, '0');
    for (let i = 0; i < n; i++) {
      const h = Math.floor(rnd() * 24), t = date + ' ' + two(h) + ':' + two(Math.floor(rnd() * 60)) + ':00';
      const id = kind.toUpperCase() + date.replace(/-/g, '') + String(i).padStart(6, '0');
      const base = {hour: h, _t: t};
      if (kind === 'ws') Object.assign(base, {billcode: id, dateTime: date, sendTime: t, scanUser: 'OP' + Math.floor(rnd() * 40), orderFirstCode: 'SP', orderThirdCode: 'SP,977-00,000', nextstation: 'ST' + Math.floor(rnd() * 20), packageNo: 'BR' + Math.floor(rnd() * 300), orderSourceName: 'C' + Math.floor(rnd() * 10), shouldNextstation: 'ST' + Math.floor(rnd() * 20)});
      if (kind === 'se') Object.assign(base, {billcode: id, dt: date, transferCenterSendTime: t, scanuser: 'OP' + Math.floor(rnd() * 40), orderFirstCode: 'SP', transferCenterNextName: 'DC' + Math.floor(rnd() * 9), packageNo: 'BR' + Math.floor(rnd() * 200), baggingNetworkName: 'NB' + Math.floor(rnd() * 5), wrongType: 'T' + Math.floor(rnd() * 3)});
      if (kind === 'mr') Object.assign(base, {billcode: id, loadPackageTime: t, loadPackageEmp: 'OP' + Math.floor(rnd() * 40), threeSegmentCode: 'GO,795-00,002', nextStop: 'ST' + Math.floor(rnd() * 20), customerName: 'C' + Math.floor(rnd() * 10)});
      if (kind === 'md') Object.assign(base, {billcode: id, unloadArriveTime: t, unloadPackageEmp: 'OP' + Math.floor(rnd() * 40), threeSegmentCode: 'MG,1-00,1', arriveOrder: 'SETR' + Math.floor(rnd() * 60), nextStop: 'ST' + Math.floor(rnd() * 20), customerName: 'C' + Math.floor(rnd() * 10)});
      if (kind === 'sc') Object.assign(base, {billCode: id, sendDate: date, actualDispatchTime: t, arrivalScanTime: t, nextStation: 'ST' + Math.floor(rnd() * 20), sendShipmentNo: 'JB' + Math.floor(rnd() * 120), packageCode: 'BR' + Math.floor(rnd() * 900), untimelycause: 'Fora do prazo', startTime: date + ' 10:00:00', lastName: 'PA'});
      if (kind === 'dc') Object.assign(base, {waybillNo: id, scanTime: date, dispatchTime: t, arrivalScanTime: t, sendNextStation: 'DC', arrivalShipmentNo: 'SETR' + Math.floor(rnd() * 30), arrivalShipmentName: 'R' + Math.floor(rnd() * 8), isTimely: 'Fora do prazo'});
      out[i] = base;
    }
    out.sort((a, b) => a.hour - b.hour);
    return (cache[k] = out);
  }
  return function (url, req, clock) {
    const body = JSON.parse(req.payload), route = url.split('/').pop();
    const start = String(body.startTime || body.startTime1 || ''), end = String(body.endTime || body.endTime1 || '');
    const op = /departure_transport|inward_transport/.test(route);
    const addDay = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    const date = op && start.slice(11) < '14:00:00' ? addDay(start.slice(0, 10), -1) : start.slice(0, 10);
    const full = op ? {start: date + ' 14:00:00', end: addDay(date, 1) + ' 13:59:59'} : {start: date + ' 00:00:00', end: date + ' 23:59:59'};
    const inWin = list => (start === full.start && end === full.end) ? list : list.filter(r => {
      const t = r._t.slice(11), p = (op && t < '14:00:00' ? addDay(date, 1) : date) + ' ' + t; return p >= start && p <= end; });
    const nowIso = fmtDate(clock.now, TZ, 'yyyy-MM-dd'), nowH = Number(fmtDate(clock.now, TZ, 'HH')) + Number(fmtDate(clock.now, TZ, 'mm')) / 60;
    const visible = list => date > nowIso ? [] : date < nowIso ? list : list.slice(0, Math.floor(list.length * nowH / 24));
    const respond = obj => ({getResponseCode: () => 200, getContentText: () => JSON.stringify(obj)});
    const ok = (records, total, current, size) => respond({code: 1, msg: 'ok', fail: false, succ: true, data: {records, total, size, current, pages: Math.ceil(total / size) || 0}});
    const size = Math.min(cap, body.size), cur = body.current;
    const page = l0 => { const list = inWin(l0); return ok(list.slice((cur - 1) * size, cur * size).map(r => { const o = Object.assign({}, r); delete o.hour; delete o._t; return o; }), list.length, cur, size); };
    const kindOf = {center_wrong_send_: 'ws', center_error_rate_new_: 'se', inward_transport_timely_rate_: 'dc', departure_transport_timely_: 'sc'};
    if (/center_missscan_next_total/.test(route)) {
      const mr = visible(dayList(date, 'mr')).length, md = visible(dayList(date, 'md')).length;
      if (!mr && !md) return ok([], 0, 1, size);
      return ok([{countTime: date, sumBillcode: 618360, billcodeArrive: mr, percentArrive: (mr / 6183.6).toFixed(2) + '%', billcodeOut: md, percentOut: (md / 6183.6).toFixed(2) + '%'}], 1, 1, size);
    }
    if (/center_missscan_next_detail/.test(route)) return page(visible(dayList(date, body.detailType === 'billcodeArrive' ? 'mr' : 'md')));
    const key = Object.keys(kindOf).find(p => route.indexOf(p) === 0);
    if (!key) return {getResponseCode: () => 404, getContentText: () => '{}'};
    const kind = kindOf[key], list = visible(dayList(date, kind)), n = list.length;
    if (/total/.test(route)) {
      if (!n) return ok([], 0, 1, size);
      if (kind === 'ws') return ok([{dateTime: date, errorCount: n, errorRate: (n / 5900.67).toFixed(2) + '%', totalCount: 590067}], 1, 1, size);
      if (kind === 'se') return ok([{sendCount: 27796, wrongType12Count: n, wrongRate2: (n / 277.96).toFixed(2) + '%'}], 1, 1, size);
      if (kind === 'sc') return ok([{sendDate: date, sendNum: 114837, untimelyNum: n, timeRate: (100 - n / 1148.37).toFixed(2) + '%'}], 1, 1, size);
      if (kind === 'dc') return ok([{scanTime: date, totalNum: 2698, noTimelyNum: n, inTimelyRate: (100 - n / 26.98).toFixed(2) + '%'}], 1, 1, size);
    }
    return page(list);
  };
}

module.exports = {makeClock, createSimContext, realisticJms, fmtDate, VOLUME};
