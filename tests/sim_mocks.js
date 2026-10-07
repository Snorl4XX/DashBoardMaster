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
    .replace('HH', g('hour') === '24' ? '00' : g('hour')).replace('mm', g('minute')).replace('ss', g('second'))
    .replace(/H/, () => String(Number(g('hour')) % 24)); // 'H' = hora sem zero (hourNow_), como no Apps Script
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
  const files = ['Config', 'Core', 'Utils', 'JmsApi', 'Storage', 'Expedicao', 'Analytics', 'Report', 'Triggers', 'Code'];
  vm.runInContext(files.map(f => fs.readFileSync(path.join(opts.root, f + '.gs'), 'utf8')).join('\n;\n'), context, {filename: 'projeto.gs'});
  context.__state = state;
  return context;
}

/** JMS realista: volumes do SP GRU, limite de tamanho de página e dia corrente crescendo. */
const VOLUME = {ws: 1800, se: 150, mr: 3900, md: 4000, sc: 73000, dc: 200, dm: 152}; // volumes reais do SP GRU (diagnosticoCompleto 24/09/2026; avaria: documento 29/09/2026)
// Recebimento (captura de 01/10/2026): deve chegar 172.842 / chegou 332.990 por dia.
const ARRIVAL = {shouldArriverNum: 172842, noArriverNum: 74190, totalNum: 332990, uploadNoSendNum: 22709, noSendNum: 18632,
  trips: 380, sites: 120, bases: 320, centers: 26, stops: 40, scanners: 140};
/**
 * Expedição (captura de 04/10/2026): 15 rotas, 117.618 remessas enviadas no dia (nomes de rota FICTÍCIOS, volumes da
 * captura). transit = parte que ainda não chegou na próxima parada (no dia de hoje, como na captura; nos dias anteriores
 * cai pela metade a cada dia); não entregue = todas (dias recentes).
 */
const LOTS_PER_DAY = 906; // Fluxo de Lotes: sacas por dia (Total de pacotes construídos, resumo da captura de 04/10)
const SEND = [[2697, 1], [5550, 1], [5424, 1], [5616, 1], [1996, 0.02], [1718, 1], [1048, 0.47], [17717, 0.99], [1592, 1], [804, 1],
  [1096, 1], [15876, 1], [38672, 1], [14080, 0.9999], [3732, 1]].map((x, i) => ({name: 'ROTA ' + String.fromCharCode(65 + i), code: String(80001 + i), n: x[0], transit: x[1]}));
const sendHash = (x, salt) => { let v = (x * 2654435761 + salt * 40503) >>> 0; v ^= v >>> 15; v = Math.imul(v, 2246822519) >>> 0; v ^= v >>> 13; return v; };
/**
 * Registros do Recebimento gerados por conta (sem guardar listas de 500 mil objetos): o registro i
 * tem horário proporcional ao índice, viagem pelo trecho do dia (caminhões chegam ao longo do dia),
 * base de destino concentrada nas primeiras (poucas bases recebem muito) e 3 digitalizadores por viagem.
 */
function arrivalRecord(date, type, i, n) {
  const h = (x, salt) => { let v = (x * 2654435761 + salt * 40503 + date.length * 97) >>> 0; v ^= v >>> 15; v = Math.imul(v, 2246822519) >>> 0; v ^= v >>> 13; return v; };
  const A = ARRIVAL, sec = Math.floor(i * 86400 / n), two = x => String(x).padStart(2, '0');
  const trip = Math.floor(i * A.trips / n) + (type === 'totalNum' ? 1000 : 0);
  const base = Math.floor(A.bases * Math.pow(h(i, 3) / 4294967296, 2));
  return {billcode: (type === 'totalNum' ? '7' : '8') + date.replace(/-/g, '') + String(i).padStart(7, '0'),
    inputsite: 'SITE ' + (h(trip, 1) % A.sites), sendTime: date + ' ' + two(Math.floor(sec / 3600)) + ':' + two(Math.floor(sec / 60) % 60) + ':' + two(sec % 60),
    nextstation: 'PARADA ' + (h(trip, 2) % A.stops), shipmentNo: 'TRIP' + date.slice(5).replace('-', '') + String(trip).padStart(5, '0'),
    endCenterName: 'DC ' + (base % A.centers), endArrivalSitename: 'BASE ' + base, scanuser: 'DIG ' + ((h(trip, 4) + h(i, 5) % 3) % A.scanners)};
}
function realisticJms(opts) {
  opts = opts || {};
  const cap = opts.maxPageSize || 1000;
  const cache = {};
  const dcIdx = {};
  function dcIndex(date) {
    if (dcIdx[date]) return dcIdx[date];
    const m = {};
    dayList(date, 'dc').forEach(r => { m[r.waybillNo] = r; });
    return (dcIdx[date] = m);
  }
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
      if (kind === 'dm') Object.assign(base, {waybillNo: id, secondTypeName: 'Z' + Math.floor(rnd() * 3), customerName: 'C' + Math.floor(rnd() * 10), goodsName: 'G', productSpecificationName: 'P' + Math.floor(rnd() * 6), adjudicationAmount: Math.floor(rnd() * 20000) / 100});
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
    // Sem Movimentação: foto do momento (sem data), volumes da captura de 04/10 (4 tipos com pedidos parados).
    if (route === 'trajectory_monitor_total' || route === 'trajectory_monitor_detail') {
      const NMV = {'发件扫描': 6251, '问题件扫描': 6180, '中心到件': 2238, '建包扫描': 2258};
      if (route === 'trajectory_monitor_total') {
        return ok(Object.keys(NMV).map(op => ({dutyCode: '30001', dutyName: 'SP GRU', operateType: op, total: NMV[op], day1: NMV[op], day2: 0, day3: 0, day4: 0,
          day5: 0, day6: 0, day7: 0, day10: 0, day14: 0, day30: 0, operateTime: nowIso + ' 08:00:00'})), 4, 1, size);
      }
      const op0 = (body.operateType || [])[0], n = NMV[op0] || 0, sz = Math.min(100, body.size), recs = [];
      for (let i = (cur - 1) * sz; i < Math.min(n, cur * sz); i++) {
        recs.push({billcode: 'NM' + nowIso.replace(/-/g, '') + op0.length + String(i).padStart(6, '0'), packageNumber: 1, pickNetworkName: 'B' + (i % 50),
          scanName: 'SP GRU', operateType: op0 + '/X', operateUser: 'OP' + (i % 40), operateTime: nowIso + ' 0' + (i % 10) + ':00:00',
          overType: 'Exceed ' + (1 + i % 9) + ' days with no track', transfercode: 'ID' + (i % 120), problemName: i % 5 ? null : 'P' + (i % 3), dutyName: 'SP GRU'});
      }
      return ok(recs, n, cur, sz);
    }
    // Avaria: dia estatístico no payload; tabela 1 de no máximo 100 por página; tabela 2 pelas remessas.
    if (route === 'getBreakageRateData' || route === 'detailBreakageRateData') {
      const dd = body.startDate || body.statisticalStartDate;
      const all = dd > nowIso ? [] : dd < nowIso ? dayList(dd, 'dm') : dayList(dd, 'dm').slice(0, Math.floor(VOLUME.dm * nowH / 24));
      // "Pedidos principais/filhos" como na tela: mainSubCode "MAIN" (principal) / "SUB" (filho); outro código = vazio.
      const sub = body.mainSubCode === 'SUB', opt = body.mainSubCode !== undefined;
      const list = !opt ? all : body.mainSubCode === 'MAIN' || sub ? all.filter((r, i) => (i % 8 === 0) === sub) : [];
      const vol = !opt ? 519159 : sub ? 64159 : 455000;
      if (route === 'getBreakageRateData') {
        if (!list.length) return ok([], 0, 1, size);
        return ok([{statisticalDate: dd, networkCode: '30001', operaNumber: vol, breakageTicketNumber: list.length, breakageNumberTotal: list.length,
          breakageRate: Math.round(list.length / vol * 1e8) / 100, breakageRateTotal: Math.round(list.length / vol * 1e8) / 100}], 1, 1, size);
      }
      const sz = Math.min(100, body.size);
      return ok(list.slice((cur - 1) * sz, cur * sz).map(r => { const o = Object.assign({}, r); delete o.hour; delete o._t; return o; }), list.length, cur, sz);
    }
    if (route === 'registrationPage') {
      const ws = String(body.waybillNo || '').split(',').filter(Boolean);
      const regs = ws.map((w, i) => ({waybillNo: w, probleTypeSubjectName: 'Avaria.破损问题件', createByName: 'OP' + (i % 9), createTime: '2026-08-20 ' + String(i % 24).padStart(2, '0') + ':10:00', registrationNetworkName: 'SP GRU'}));
      const sz = Math.min(100, body.size);
      return ok(regs.slice((cur - 1) * sz, cur * sz), regs.length, cur, sz);
    }
    if (route === 'arrivalbyday_total' || route === 'arrivalbyday_detail') {
      const dd = start.slice(0, 10), frac = dd > nowIso ? 0 : dd < nowIso ? 1 : nowH / 24;
      const count = k => Math.floor(ARRIVAL[k] * frac);
      if (route === 'arrivalbyday_total') {
        if (!count('totalNum')) return ok([], 0, 1, size);
        // Como o JMS real: o resumo é diário (consultado por horário, o dia inteiro fica na janela da 00h).
        if (start.slice(11) !== '00:00:00') return ok([], 0, 1, size);
        const c = k => count(k);
        const t = c('totalNum');
        return ok([{shouldArriverNum: c('shouldArriverNum'), noArriverNum: c('noArriverNum'), totalNum: t, uploadNoSendNum: c('uploadNoSendNum'),
          noSendNum: c('noSendNum'), noSignNum: t, deliverNum: t}], 1, 1, size);
      }
      const type = body.detailType, n = Math.floor(ARRIVAL[type] * frac), N = ARRIVAL[type];
      const aSize = Math.min(opts.arrivalCap || cap, body.size); // ARRIVAL_CAP: só o Recebimento limitado (ex.: 100 por página)
      // Fatia de horário → trecho de índices (registro i tem o horário i·86400/N).
      const secOf = x => { const t = x.slice(11).split(':').map(Number); return t[0] * 3600 + t[1] * 60 + t[2]; };
      const lo = Math.ceil(secOf(start) * N / 86400), hi = Math.min(n, Math.ceil((secOf(end) + 1) * N / 86400));
      const total = Math.max(0, hi - lo), out = [];
      for (let i = lo + (cur - 1) * aSize; i < Math.min(hi, lo + cur * aSize); i++) out.push(arrivalRecord(dd, type, i, N));
      return ok(out, total, cur, aSize);
    }
    if (route === 'sendbyday_total' || route === 'sendbyday_detail' || route === 'keywordList') {
      const dd = route === 'keywordList' ? nowIso : start.slice(0, 10), frac = dd > nowIso ? 0 : dd < nowIso ? 1 : nowH / 24;
      const age = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(dd)) / 864e5));
      const tf = r => r.transit >= 1 && age === 0 ? 1 : r.transit * Math.pow(0.5, age);
      const isT = (r, i) => tf(r) >= 1 || (sendHash(i, r.n) % 10000) < tf(r) * 10000;
      const two = x => String(x).padStart(2, '0');
      const timeOf = (r, i) => { const sec = Math.floor(i * 86400 / r.n); return dd + ' ' + two(Math.floor(sec / 3600)) + ':' + two(Math.floor(sec / 60) % 60) + ':' + two(sec % 60); };
      if (route === 'keywordList') {
        const data = (body.keywordList || []).map(w => {
          // V4.1: remessas do SC→DC (fora do prazo) — carregamento na SP GRU com o ID de viagem de SAÍDA; chegada com outro ID.
          const md = String(w).match(/^DC(\d{8})(\d{6})$/);
          if (md) {
            const d = md[1].slice(0, 4) + '-' + md[1].slice(4, 6) + '-' + md[1].slice(6), rec = dcIndex(d)[w];
            if (!rec) return null;
            return {keyword: w, details: [{scanTime: rec.dispatchTime, scanTypeName: 'Encomenda carregada', scanNetworkName: 'SP GRU', nextStopName: rec.sendNextStation,
              code: 1, originalScanTypeCode: 50, remark2: 'SAIDA' + md[1] + 'V' + (Number(md[2]) % 12)},
              {scanTime: rec.arrivalScanTime, scanTypeName: 'Coleta de chegadas', scanNetworkName: 'SP GRU', code: 2, originalScanTypeCode: 90, remark2: rec.arrivalShipmentNo}]};
          }
          const m = String(w).match(/^SF(\d{8})R(\d+)I(\d+)$/);
          if (!m) return null;
          const r = SEND[Number(m[2])], i = Number(m[3]), d8 = m[1], d = d8.slice(0, 4) + '-' + d8.slice(4, 6) + '-' + d8.slice(6);
          const sec = Math.floor(i * 86400 / r.n), t = d + ' ' + two(Math.floor(sec / 3600)) + ':' + two(Math.floor(sec / 60) % 60) + ':' + two(sec % 60);
          return {keyword: w, details: [{scanTime: t, scanTypeName: 'Encomenda carregada', scanNetworkName: 'SP GRU', nextStopName: r.name, code: 1, originalScanTypeCode: 50,
            remark2: 'VIAGEM' + d8 + 'R' + m[2] + 'H' + two(Math.floor(sec / 7200))}, {scanTime: d + ' 00:00:01', scanTypeName: 'Encomenda recebida', scanNetworkName: 'SP GRU', code: 2, remark2: 'CHEGADA'}]};
        }).filter(Boolean);
        return respond({code: 1, msg: 'ok', data: data, succ: true, fail: false});
      }
      if (route === 'sendbyday_total') {
        if (!frac) return ok([], 0, 1, size);
        return ok(SEND.map((r, k) => {
          const n = Math.floor(r.n * frac);
          let t = 0; for (let i = 0; i < n; i++) if (isT(r, i)) t++;
          return {scantime: dd, nextstation: r.name, nextstationcode: r.code, sendcount: n, noarrivalcount: t, nosigncount: n, ROW_ID: k + 1};
        }), SEND.length, 1, size);
      }
      const ri = SEND.findIndex(r => r.code === String(body.nextstation)), r = SEND[ri];
      if (!r) return ok([], 0, 1, size);
      const n = Math.floor(r.n * frac), sz = Math.min(100, body.size);
      const secOf = x => { const t = x.slice(11).split(':').map(Number); return t[0] * 3600 + t[1] * 60 + t[2]; };
      const lo = Math.ceil(secOf(start) * r.n / 86400), hi = Math.min(n, Math.ceil((secOf(end) + 1) * r.n / 86400));
      const ck = dd + '|' + ri + '|' + body.detailType + '|' + lo + '|' + hi;
      let idx = cache[ck];
      if (!idx) {
        idx = [];
        for (let i = lo; i < hi; i++) if (body.detailType === 'sendcount' || body.detailType === 'nosigncount' || isT(r, i)) idx.push(i);
        cache[ck] = idx;
      }
      const out = idx.slice((cur - 1) * sz, cur * sz).map(i => ({billcode: 'SF' + dd.replace(/-/g, '') + 'R' + ri + 'I' + i, inputsite: 'SP GRU', sendTime: timeOf(r, i),
        nextstation: r.name, scanuser: 'OPERADOR ' + (sendHash(i, 7) % 60)}));
      return ok(out, idx.length, cur, sz);
    }
    // Fluxo de Lotes: ~906 sacas por dia (volume do resumo da captura), sacas sintéticas.
    if (route === 'sdploopbagBuildbagCount' || route === 'sdploopbagBuildbagDetail') {
      const dd = start.slice(0, 10), frac = dd > nowIso ? 0 : dd < nowIso ? 1 : nowH / 24, N = Math.floor(LOTS_PER_DAY * frac);
      const two = x => String(x).padStart(2, '0');
      const lot = i => { const sec = Math.floor(i * 86400 / LOTS_PER_DAY), h = sendHash(i, 913);
        return {packageCode: 'LT' + dd.replace(/-/g, '') + String(i).padStart(5, '0'), isLoopPag: h % 100 < 33 ? 'Y' : 'N', portName: h % 10 < 6 ? '出港' : '进港',
          packageQty: 1 + (h >>> 8) % 30, packageName: '普通包', packageSourceName: 'JT', chipNo: null, openSiteName: 'DESTINO ' + (h % 40), proxySiteName: 'SP GRU',
          scanDateTime: dd + ' ' + two(Math.floor(sec / 3600)) + ':' + two(Math.floor(sec / 60) % 60) + ':' + two(sec % 60)}; };
      if (route === 'sdploopbagBuildbagCount') {
        if (!N) return ok([], 0, 1, size);
        let eco = 0, items = 0, ecoItems = 0;
        for (let i = 0; i < N; i++) { const x = lot(i); items += x.packageQty; if (x.isLoopPag === 'Y') { eco++; ecoItems += x.packageQty; } }
        return ok([{queryDate: dd, proxySiteCode: '30001', proxySiteName: 'SP GRU', packageSum: N, loopSum: eco, noloopSum: N - eco, loopRate: (eco / N * 100).toFixed(2) + '%',
          waybillSum: items, loopWaybillSum: ecoItems, loopWaybillRate: (ecoItems / items * 100).toFixed(2) + '%'}], 1, 1, size);
      }
      const sz = Math.min(100, body.size), all = [];
      for (let i = 0; i < N; i++) all.push(i);
      return ok(all.slice((cur - 1) * sz, cur * sz).map(lot), N, cur, sz);
    }
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

module.exports = {makeClock, createSimContext, realisticJms, fmtDate, VOLUME, ARRIVAL, arrivalRecord, SEND};
