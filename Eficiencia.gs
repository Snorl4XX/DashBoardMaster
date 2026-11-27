/**
 * V4.33 (pedido "Desenvolver um dashboard que mostre a eficiência do SP GRU"): Eficiência do SP GRU.
 *
 * V4.36 (pedido "A base da onde ele vai puxar os dados, quero mudar. Quero puxar de dois lugares … São tudo do Feishu, porém é
 * criado pela matriz e só consigo adicionar informação e visualizar. Também quero que salve os dados quando você puxar. Lá é
 * atualizado manualmente."):
 *
 *   Eficiência do dia = a da MATRIZ (planilha "SP GRU 效能监控表", aba "日均效率 Eficiência média diária"). Sem ela (a matriz ainda
 *   não preencheu o dia): a mesma conta da matriz com o volume do JMS — Qtd processada total ÷ (presença de efetivos + temporários).
 *
 * - JMS: Cabine de dados › Análise de entrada e saída de transbordo novo (dataCabinndex/TransitPortNew), pedido
 *   bigdataReport/detail/transit_out_ports_list com os filtros da tela (Regional SPE 370000, SC SP GRU 30001, Pedido mãe e filhos
 *   = Pedido principal → mergeWaybill 1). "Qtd processada total" = transhipmentNum; os outros números da linha vão para a tabela.
 * - Feishu: DUAS PLANILHAS da matriz, lidas com a CONTA do Feishu de quem configurou (Configurações → "Entrar com o Feishu": login
 *   oficial do Feishu; o painel guarda só o token da conta e o renova sozinho). Como a planilha é da matriz, o aplicativo da
 *   empresa (App ID e App Secret) não precisa — nem consegue — ser adicionado a ela: vale o acesso de leitura da conta.
 *   SOMENTE LEITURA: nada é alterado no Feishu.
 *   1. FEISHU_LINK_PRESENCA: presentes e programados de cada dia por categoria (Administrativo, Assistente Operacional,
 *      Operacional, Temporário Total, Diarista Total) — duas colunas por dia (出勤人数 Presentes / 应出勤人数 Programado).
 *   2. FEISHU_LINK_EFICIENCIA ("SP GRU 效能监控表"): aba da eficiência (o resultado da matriz, um bloco por mês) e aba "人员出勤
 *      Presença de colaboradores" (正式工 efetivos / 临时工 temporários de cada dia, uma linha por turno e a linha do total).
 *   As grades são lidas pelas DATAS do cabeçalho (cada data com as colunas dela até a próxima data) e pelos nomes das linhas e das
 *   colunas — não dependem da posição exata das células nem do mês do bloco.
 * - Cada dia lido fica GRAVADO no painel: se a planilha mudar ou apagar o dia depois, o painel continua com o que leu. De hora em
 *   hora o painel confere as planilhas e relê os dias que mudaram ou ganharam números (a matriz atualiza à mão, às vezes dias depois).
 */
/** API aberta do Feishu (open.feishu.cn) ou do Lark (open.larksuite.com), conforme os links das planilhas. */
function efApi_() {
  return /larksuite\.com/i.test(String(getProp_('FEISHU_LINK_PRESENCA', '')) + String(getProp_('FEISHU_LINK_EFICIENCIA', ''))) ?
    'https://open.larksuite.com' : 'https://open.feishu.cn';
}
/** Login do Feishu (accounts.feishu.cn) ou do Lark. */
function efAccounts_() { return efApi_().replace('://open.', '://accounts.'); }
/** Categorias da planilha 1 (nome da linha, em português ou chinês). Ordem importa: "Assistente Operacional" antes de "Operacional". */
const EF_ROLES_ = [
  {key: 'Adm', nome: 'Administrativo', re: /administrativ|职能/},
  {key: 'Assist', nome: 'Assistente Operacional', re: /assistente|操作助理/},
  {key: 'Oper', nome: 'Operacional', re: /operacional|操作员/},
  {key: 'Temp', nome: 'Temporário', re: /temporari|月结/},
  {key: 'Diar', nome: 'Diarista', re: /diarista|日结/}
];
const EF_SHIFTS_ = ['T1', 'T2', 'T3'];
/** Números da linha do JMS (transit_out_ports_list) → nome no painel. */
const EF_JMS_FIELDS_ = {processed: 'transhipmentNum', arrival: 'operateArrivalNum', send: 'operateSendNum', operate: 'operateNum',
  inbound: 'inboundNum', city: 'cityNum', outbound: 'outboundNum', transfer: 'transferNum', other: 'otherNum'};

function efAgentCode_() { return String(getProp_('EF_AGENT_CODE', '') || '370000').trim(); }
function efSiteCode_() { return String(getProp_('EF_SITE_CODE', '') || '30001').trim(); }
/** "Assistente Operacional - Presentes 实到" → "assistente operacional - presentes 实到" (sem acento, minúsculas). */
function efNorm_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// ------------------------------------------------------------------ JMS
/** A linha do dia na tela "Análise de entrada e saída de transbordo novo" (SP GRU), ou null. */
function efJmsDay_(isoDate) {
  const cfg = getIndicatorConfig_('efficiency');
  const payload = {current: 1, size: 20, startTime: isoDate + ' 00:00:00', endTime: isoDate + ' 23:59:59', agentCode: efAgentCode_(),
    countryId: countryId_(), mergeWaybill: 1, scansitecode: efSiteCode_()};
  const recs = recordsOf_(jmsPost_(cfg.summary.endpoint, payload, 2));
  const site = efSiteCode_();
  const day = recs.filter(r => String(r.scantime || '').slice(0, 10) === isoDate && (!r.scansitecode || String(r.scansitecode) === site));
  if (!day.length) return null;
  const out = {};
  Object.keys(EF_JMS_FIELDS_).forEach(k => {
    let any = false, n = 0;
    day.forEach(r => { const v = Number(r[EF_JMS_FIELDS_[k]]); if (r[EF_JMS_FIELDS_[k]] !== null && r[EF_JMS_FIELDS_[k]] !== undefined && isFinite(v)) { any = true; n += v; } });
    out[k] = any ? n : null;
  });
  return out;
}

// ------------------------------------------------------------------ Feishu: conexão com a conta (login oficial, OAuth)
/** Permissões pedidas no login: ler planilhas, ler o wiki (os links são do wiki) e renovar sozinho (offline_access). */
// V4.36.4: + docx:document:readonly — a tabela EFI GRU (planilha 1) é uma planilha DENTRO de um documento do Feishu.
const EF_ESCOPOS_ = 'sheets:spreadsheet:readonly wiki:wiki:readonly docx:document:readonly offline_access';
/** O aplicativo do Feishu (App ID e App Secret): só para o login — ele não precisa ser adicionado às planilhas. */
function efAppCfg_() {
  const id = String(getProp_('FEISHU_APP_ID', '') || '').trim(), secret = String(getProp_('FEISHU_APP_SECRET', '') || '').trim();
  const faltam = [!id && 'App ID', !secret && 'App Secret'].filter(Boolean);
  if (faltam.length) throw new Error('Planilhas do Feishu não configuradas: falta ' + faltam.join(' e ') + ' do aplicativo (Configurações → Planilhas do Feishu).');
  return {id: id, secret: secret};
}
/** Link de uma planilha → {link, node (wiki), sp (…/sheets/…), sheet (?sheet=…)}. */
function efParseLink_(link) {
  const s = String(link || '').trim();
  const wiki = /\/wiki\/([A-Za-z0-9]+)/.exec(s), sp = /\/sheets\/([A-Za-z0-9]+)/.exec(s), sheet = /[?&#]sheet=([A-Za-z0-9]+)/.exec(s);
  const doc = /\/docx\/([A-Za-z0-9]+)/.exec(s);
  return {link: s, node: wiki ? wiki[1] : '', sp: sp ? sp[1] : '', doc: doc ? doc[1] : '', sheet: sheet ? sheet[1] : ''};
}
/** Os dois links (FEISHU_LINK_PRESENCA e FEISHU_LINK_EFICIENCIA). soft: sem nenhum → null em vez de erro. */
function efLinksCfg_(soft) {
  const pres = String(getProp_('FEISHU_LINK_PRESENCA', '') || '').trim(), efic = String(getProp_('FEISHU_LINK_EFICIENCIA', '') || '').trim();
  if (!pres && !efic) {
    if (soft) return null;
    throw new Error('Planilhas do Feishu não configuradas: falta o link das planilhas (Configurações → Planilhas do Feishu).');
  }
  const out = {pres: pres ? efParseLink_(pres) : null, efic: efic ? efParseLink_(efic) : null};
  [out.pres, out.efic].forEach(p => {
    if (p && !p.node && !p.sp && !p.doc) throw new Error('Link de planilha do Feishu não reconhecido: use o link do wiki (…/wiki/…), da planilha (…/sheets/…) ou do documento (…/docx/…).');
  });
  return out;
}
/** Dica para os códigos de erro mais comuns do Feishu. */
function efFeishuHint_(code, msg) {
  const c = Number(code), m = String(msg || '');
  if ([10003, 10014, 20002, 20005, 99991663].indexOf(c) >= 0 || /app_?secret|app_?id|client|invalid param/i.test(m)) return 'confira o App ID e o App Secret';
  if (/redirect/i.test(m) || c === 20029) return 'o endereço de retorno precisa estar cadastrado no aplicativo (Segurança → URL de redirecionamento)';
  if ([20003, 20004].indexOf(c) >= 0 || /authorization code|code (is )?(expired|invalid|used)/i.test(m)) return 'o login demorou ou já foi usado: clique em "Entrar com o Feishu" de novo';
  if ([20026, 20037, 20064, 20073, 20074, 99991668, 99991677, 99991669].indexOf(c) >= 0 || /refresh|token (is )?(expired|invalid)|invalid_grant/i.test(m)) {
    return 'o acesso da conta venceu: Configurações → Planilhas do Feishu → "Entrar com o Feishu"';
  }
  if ([99991672, 99991679, 20027].indexOf(c) >= 0 || /scope/i.test(m)) {
    return 'o aplicativo precisa das permissões de usuário "sheets:spreadsheet:readonly", "wiki:wiki:readonly", "docx:document:readonly" e "offline_access" (publique uma versão e entre com o Feishu de novo)';
  }
  if ([131006, 91403, 1310213, 1310235].indexOf(c) >= 0 || /permission|forbidden|access denied|no auth/i.test(m)) return 'a sua conta do Feishu precisa conseguir abrir a planilha';
  if ([131005, 91402, 1310211, 1310214, 1310249].indexOf(c) >= 0 || /not ?found|notexist|not exist/i.test(m)) return 'confira o link da planilha';
  return '';
}
function efFeishuFetch_(method, path, body, token) {
  const opts = {method: method, muteHttpExceptions: true, contentType: 'application/json; charset=utf-8', headers: {}};
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (body) opts.payload = JSON.stringify(body);
  let res;
  try { res = UrlFetchApp.fetch(efApi_() + path, opts); }
  catch (e) { throw new Error('Sem acesso ao Feishu (' + String(e && e.message || e).replace(/^Exception:\s*/, '').slice(0, 120) + '). Este computador precisa de internet.'); }
  const j = safeJsonParse_(res.getContentText(), null) || {};
  const code = j.code !== undefined ? Number(j.code) : (res.getResponseCode() === 200 ? 0 : res.getResponseCode());
  if (res.getResponseCode() !== 200 || code !== 0) {
    const msg = String(j.msg || j.error_description || j.error || '');
    const dica = efFeishuHint_(code, msg);
    const err = new Error('O Feishu recusou (código ' + code + (msg ? ': ' + msg.slice(0, 100) : '') + ')' + (dica ? ' — ' + dica : '') + '.');
    err.feishuCode = code;
    throw err;
  }
  return j;
}
/** Endereço do login do Feishu (Configurações → "Entrar com o Feishu"). */
function efLoginUrl_(redirectUri, state) {
  const app = efAppCfg_();
  return efAccounts_() + '/open-apis/authen/v1/authorize?client_id=' + encodeURIComponent(app.id) + '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(redirectUri) + '&scope=' + encodeURIComponent(EF_ESCOPOS_) + '&state=' + encodeURIComponent(state);
}
function efOAuth_(body) {
  const app = efAppCfg_();
  const j = efFeishuFetch_('post', '/open-apis/authen/v2/oauth/token', Object.assign({client_id: app.id, client_secret: app.secret}, body));
  if (!j.access_token) throw new Error('O Feishu não devolveu o acesso da conta.');
  return j;
}
/** Guarda o acesso da conta (o token vale ~2 h; o de renovação troca a cada renovação). */
function efSaveUserToken_(j) {
  setProp_('FEISHU_USER_TOKEN', j.access_token);
  setProp_('FEISHU_USER_EXPIRA', String(Date.now() + Math.max(60, (Number(j.expires_in) || 7200) - 300) * 1000));
  if (j.refresh_token) setProp_('FEISHU_USER_SEGREDO', j.refresh_token);
  if (j.refresh_token_expires_in) setProp_('FEISHU_USER_RENOVAR_ATE', new Date(Date.now() + Number(j.refresh_token_expires_in) * 1000).toISOString());
  setProp_('FEISHU_USER_RENOVADO', new Date().toISOString());
  deleteProp_('FEISHU_USER_ERRO');
}
/** Volta do login do Feishu: troca o código pelo acesso da conta. */
function efConectar_(code, redirectUri) {
  if (!code) throw new Error('O Feishu não devolveu o código do login.');
  const j = efOAuth_({grant_type: 'authorization_code', code: String(code), redirect_uri: String(redirectUri || '')});
  efSaveUserToken_(j);
  setProp_('FEISHU_USER_EM', new Date().toISOString());
  EF_PLAN_ = null;
  const escopos = String(j.scope || '');
  const faltam = escopos ? ['sheets:spreadsheet:readonly', 'wiki:wiki:readonly', 'docx:document:readonly'].filter(s => escopos.split(/\s+/).indexOf(s) < 0) : [];
  if (!j.refresh_token) faltam.push('offline_access');
  return {ok: true, renovavel: !!j.refresh_token, faltamPermissoes: faltam};
}
/** Configurações → "Desconectar": apaga o acesso da conta do Feishu guardado no painel. */
function desconectarFeishu() {
  ['FEISHU_USER_TOKEN', 'FEISHU_USER_EXPIRA', 'FEISHU_USER_SEGREDO', 'FEISHU_USER_RENOVAR_ATE', 'FEISHU_USER_RENOVADO', 'FEISHU_USER_EM', 'FEISHU_USER_ERRO']
    .forEach(k => deleteProp_(k));
  EF_PLAN_ = null;
  return {ok: true, mensagem: 'Conta do Feishu desconectada. Para ler as planilhas de novo: "Entrar com o Feishu".'};
}
/**
 * Acesso da conta (user_access_token) válido: o guardado ou um renovado agora. A renovação troca o token de renovação, então só
 * uma execução renova por vez (trava); quem esperou relê o que a outra gravou.
 */
function efUserToken_() {
  const valido = () => {
    const t = String(getProp_('FEISHU_USER_TOKEN', '') || ''), ate = Number(getProp_('FEISHU_USER_EXPIRA', '0')) || 0;
    return t && ate > Date.now() ? t : '';
  };
  let t = valido();
  if (t) return t;
  invalidateProps_();
  t = valido();
  if (t) return t;
  if (!getProp_('FEISHU_USER_SEGREDO', '')) {
    throw new Error('Conta do Feishu não conectada: Configurações → Planilhas do Feishu → "Entrar com o Feishu".');
  }
  const lock = LockService.getUserLock ? LockService.getUserLock() : LockService.getScriptLock();
  const got = lock.tryLock(30000);
  try {
    invalidateProps_();
    t = valido();
    if (t) return t;
    try { efSaveUserToken_(efOAuth_({grant_type: 'refresh_token', refresh_token: String(getProp_('FEISHU_USER_SEGREDO', ''))})); }
    catch (e) {
      invalidateProps_();
      t = valido();
      if (t) return t;
      if (e && e.feishuCode === undefined) throw e;
      const msg = 'O acesso da conta do Feishu venceu — entre de novo (Configurações → Planilhas do Feishu → "Entrar com o Feishu"). ' +
        String(e && e.message || e).slice(0, 200);
      setProp_('FEISHU_USER_ERRO', msg.slice(0, 300));
      throw new Error(msg);
    }
    return valido() || String(getProp_('FEISHU_USER_TOKEN', ''));
  } finally { if (got) lock.releaseLock(); }
}
/** GET com o acesso da conta; token recusado (vencido antes da hora) → renova uma vez e tenta de novo. */
function efUserGet_(path) {
  try { return efFeishuFetch_('get', path, null, efUserToken_()); }
  catch (e) {
    if ([99991668, 99991677, 99991669].indexOf(Number(e && e.feishuCode)) < 0 || !getProp_('FEISHU_USER_SEGREDO', '')) throw e;
    setProp_('FEISHU_USER_EXPIRA', '0');
    return efFeishuFetch_('get', path, null, efUserToken_());
  }
}

// ------------------------------------------------------------------ Feishu: leitura das planilhas (somente leitura)
/** Token da planilha: o do link (…/sheets/…) ou o do nó do wiki (guardado em FEISHU_NODES). */
/**
 * O que o link abre: {type: 'sheet' | 'docx' | outro, token}. Link do wiki: o nó do wiki (guardado em FEISHU_NODES; valor antigo
 * sem tipo = planilha). V4.36.4: o link da planilha 1 (EFI GRU) é um DOCUMENTO com a planilha dentro.
 */
function efNodeOf_(p) {
  if (p.sp) return {type: 'sheet', token: p.sp};
  if (p.doc) return {type: 'docx', token: p.doc};
  const map = safeJsonParse_(getProp_('FEISHU_NODES', '{}'), {}) || {};
  const v = String(map[p.node] || '');
  if (v) { const m = /^(\w+):(.+)$/.exec(v); return m ? {type: m[1], token: m[2]} : {type: 'sheet', token: v}; }
  const j = efUserGet_('/open-apis/wiki/v2/spaces/get_node?token=' + encodeURIComponent(p.node) + '&obj_type=wiki');
  const node = (j.data && j.data.node) || {};
  if (!node.obj_token) throw new Error('O Feishu não devolveu o conteúdo desse link do wiki.');
  const type = String(node.obj_type || 'sheet');
  map[p.node] = (type === 'sheet' ? '' : type + ':') + node.obj_token;
  setProp_('FEISHU_NODES', JSON.stringify(map));
  return {type: type, token: node.obj_token};
}
function efSpToken_(p) {
  const no = efNodeOf_(p);
  if (no.type !== 'sheet') throw new Error('O link do wiki não é de uma planilha (tipo ' + no.type + '): abra a planilha e copie o link.');
  return no.token;
}
/**
 * V4.36.4: planilhas DENTRO de um documento do Feishu (bloco "planilha" do documento): [{sp, sheetId}]. O token do bloco é
 * "<planilha>_<aba>" e a planilha é lida pela mesma API das planilhas.
 */
function efDocSheets_(doc) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 50; i++) {
    const j = efUserGet_('/open-apis/docx/v1/documents/' + encodeURIComponent(doc) + '/blocks?page_size=500&document_revision_id=-1' +
      (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : ''));
    const d = j.data || {};
    (d.items || []).forEach(b => {
      const tok = String((b && b.sheet && b.sheet.token) || ''), k = tok.lastIndexOf('_');
      if (k > 0) out.push({sp: tok.slice(0, k), sheetId: tok.slice(k + 1)});
    });
    if (!d.has_more || !d.page_token) break;
    pageToken = d.page_token;
  }
  return out;
}
/** Abas da planilha: [{sheet_id, title, hidden, grid_properties: {row_count, column_count}}]. */
function efTabs_(sp) {
  const j = efUserGet_('/open-apis/sheets/v3/spreadsheets/' + encodeURIComponent(sp) + '/sheets/query');
  return ((j.data && j.data.sheets) || []).filter(t => t && t.sheet_id && (!t.resource_type || t.resource_type === 'sheet'));
}
/** 1 → A, 27 → AA. */
function efColName_(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + (x - 1) % 26) + s;
  return s;
}
/**
 * A grade da aba, lida em blocos de 100 colunas: números sem formatação e as DATAS como aparecem na tela (V4.36.1: "01-nov" é
 * lido como a pessoa vê — o ano escondido da célula pode ser de outro ano, de uma planilha copiada). Até 4000 colunas: a planilha
 * de presentes cresce 2 colunas por dia e os dias novos ficam no fim.
 */
function efGrid_(sp, tab) {
  const gp = tab.grid_properties || {};
  const cols = Math.max(1, Math.min(Number(gp.column_count) || 200, 4000));
  let rows = Math.max(1, Math.min(Number(gp.row_count) || 200, 1000));
  if (rows * cols > 400000) rows = Math.max(60, Math.floor(400000 / cols));
  const grid = [];
  for (let c0 = 1; c0 <= cols; c0 += 100) {
    const c1 = Math.min(cols, c0 + 99), range = tab.sheet_id + '!' + efColName_(c0) + '1:' + efColName_(c1) + rows;
    const j = efUserGet_('/open-apis/sheets/v2/spreadsheets/' + encodeURIComponent(sp) + '/values/' + encodeURIComponent(range) +
      '?valueRenderOption=UnformattedValue&dateTimeRenderOption=FormattedString');
    const vals = (j.data && j.data.valueRange && j.data.valueRange.values) || [];
    vals.forEach((row, r) => {
      if (!Array.isArray(row)) return;
      grid[r] = grid[r] || [];
      row.forEach((v, i) => { if (v !== null && v !== undefined && v !== '') grid[r][c0 - 1 + i] = v; });
    });
  }
  for (let r = 0; r < grid.length; r++) grid[r] = grid[r] || [];
  return grid;
}
/** Texto de uma célula (texto rico, link, opção…). */
function efText_(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(efText_).filter(Boolean).join(' ');
  if (typeof v === 'object') {
    if (v.text !== undefined && v.text !== null) return efText_(v.text);
    if (v.value !== undefined && v.value !== null) return efText_(v.value);
    if (v.name !== undefined && v.name !== null) return efText_(v.name);
    return '';
  }
  return String(v);
}
/** Número de uma célula (número, texto "1.234", fórmula). null = vazio. */
function efNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  if (Array.isArray(v)) { for (const x of v) { const n = efNum_(x); if (n !== null) return n; } return null; }
  if (typeof v === 'object') return efNum_(v.value !== undefined ? v.value : v.text);
  const s = String(v).trim().replace(/\s/g, '');
  if (!s || !/^-?[\d.,]+%?$/.test(s)) return null;
  const pct = /%$/.test(s), t = s.replace('%', '');
  const n = Number(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(',', '.'));
  return isFinite(n) ? (pct ? n / 100 : n) : null;
}
const EF_MESES_ = {jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9,
  out: 10, oct: 10, nov: 11, dez: 12, dec: 12};
const EF_MES_RE_ = '(jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[a-z]*\\.?';
/** Dia sem ano ("01-nov", "11月14日") sozinho: o ano de hoje; mais de 60 dias no futuro → o ano anterior. */
function efComAno_(m, d) {
  const hoje = isoToday_(), y = Number(hoje.slice(0, 4));
  const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return iso > addDaysIso_(hoje, 60) ? (y - 1) + iso.slice(4) : iso;
}
/** Partes da data de uma célula do cabeçalho → {y (0 = sem ano), m, d}, ou null (não é data). */
function efCellDateParts_(v) {
  const ok = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && (!y || (y >= 2000 && y <= 2100)) ? {y: y, m: m, d: d} : null);
  if (typeof v === 'number') {
    if (!(v >= 40000 && v < 60000)) return null;
    const s = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString();
    return {y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10)};
  }
  const s = efNorm_(efText_(v));
  if (!s || s.length > 30) return null;
  let m = /^(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return ok(+m[3], +m[2], +m[1]);
  m = new RegExp('^(\\d{1,2})\\s*[-\\/. ]?\\s*(?:de\\s+)?' + EF_MES_RE_ + '(?:\\s*[-\\/. ]\\s*(?:de\\s+)?(\\d{2,4}))?$').exec(s);
  if (m) return ok(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0, EF_MESES_[m[2]], +m[1]);
  m = new RegExp('^' + EF_MES_RE_ + '\\s*[-\\/. ]?\\s*(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?$').exec(s);
  if (m) return ok(m[3] ? +m[3] : 0, EF_MESES_[m[1]], +m[2]);
  m = /^(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/.exec(s);
  if (m) return ok(0, +m[1], +m[2]);
  m = /^(\d{1,2})\s*-\s*(\d{1,2})\s*月$/.exec(s);
  if (m) return ok(0, +m[2], +m[1]);
  return null;
}
/** Data de uma célula sozinha → AAAA-MM-DD, ou '' (não é data). Na grade, o ano das datas sem ano vem da linha inteira. */
function efCellDate_(v) {
  const p = efCellDateParts_(v);
  if (!p) return '';
  return p.y ? p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0') : efComAno_(p.m, p.d);
}
/** Tipo da coluna pelo subtítulo: program, efetivo, temporario, eficiencia, present (ou ''). */
function efSubKind_(s) {
  const t = efNorm_(s);
  if (!t) return '';
  if (/应出勤|programad/.test(t)) return 'program';
  if (/正式工|efetiv/.test(t)) return 'efetivo';
  if (/临时工|tempor/.test(t)) return 'temporario';
  if (/效率|eficien/.test(t)) return 'eficiencia';
  if (/出勤|presen/.test(t)) return 'present';
  return '';
}
function efRoleOf_(label) { const t = efNorm_(label); return t ? EF_ROLES_.filter(r => r.re.test(t))[0] || null : null; }
/** Turno pelo nome da linha: T1/T2/T3, "TI" (com a letra I, como na planilha da matriz), TII, TIII, turno 1, 早班/中班/晚班… */
function efShiftOf_(label) {
  const t = efNorm_(label);
  let m = /(?:^|[^a-z0-9])t\s*([123])(?![0-9])/.exec(t) || /turno\s*([123])/.exec(t) || /^([123])\s*(?:º|o)?\s*(?:turno)?$/.exec(t);
  if (m) return 'T' + m[1];
  m = /(?:^|[^a-z0-9])t\s*(iii|ii|i|l)(?![a-z0-9])/.exec(t);
  if (m) return 'T' + (m[1] === 'l' ? 1 : m[1].length);
  if (/早班|manha/.test(t)) return 'T1';
  if (/中班|tarde/.test(t)) return 'T2';
  if (/晚班|夜班|noite|madrugada/.test(t)) return 'T3';
  return '';
}
function efIsTotal_(label) { return /total|合计|总计|汇总|小计/.test(efNorm_(label)); }
/**
 * Números de uma grade organizada por datas no cabeçalho (uma ou mais colunas por data; blocos de mês um embaixo do outro):
 * [{date, i (linha), pos (coluna dentro da data), label (nome da linha), sub (subtítulo da coluna), kind, value}].
 * V4.36.1: datas sem ano ("01-nov") ganham o ano pela linha inteira (virou de dezembro para janeiro = ano seguinte; o último dia
 * preenchido fica até hoje); uma data repetida ou fora de ordem no cabeçalho não derruba mais a linha toda.
 */
function efGridRecords_(grid) {
  const out = [], avisos = [], nRows = grid.length, hoje = isoToday_(), y0 = Number(hoje.slice(0, 4));
  const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const lo = addDaysIso_(hoje, -365), hi = addDaysIso_(hoje, 60), lim7 = addDaysIso_(hoje, 7);
  const dd = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  const dateRows = {};
  for (let r = 0; r < nRows; r++) {
    const row = grid[r] || [], dc = [];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === undefined || row[c] === null || row[c] === '') continue;
      const p = efCellDateParts_(row[c]);
      if (p) dc.push({c: c, y: p.y, m: p.m, d: p.d});
    }
    if (dc.length < 2) continue;
    // Datas sem ano, na ordem das colunas: o mês/dia volta (dezembro → janeiro) e CONTINUA baixo = ano seguinte. Uma data
    // isolada fora de ordem (erro de digitação) não vira o ano.
    const sem = dc.filter(x => !x.y), ks = sem.map(x => x.m * 100 + x.d);
    let off = 0;
    sem.forEach((x, j) => {
      if (j && ks[j] < ks[j - 1] - 600 && (j + 1 >= sem.length || (ks[j + 1] >= ks[j] && ks[j + 1] < ks[j - 1] - 600))) off++;
      x.off = off;
    });
    // A maioria em ordem crescente (números de uma linha de dados não viram datas; um erro de digitação não derruba a linha).
    const key = x => (x.y || 3000 + x.off) * 10000 + x.m * 100 + x.d;
    let inc = 0;
    for (let k = 1; k < dc.length; k++) if (key(dc[k]) > key(dc[k - 1])) inc++;
    if (inc >= Math.max(1, Math.ceil((dc.length - 1) * 0.7))) dateRows[r] = dc;
  }
  Object.keys(dateRows).map(Number).sort((a, b) => a - b).forEach(r => {
    const dc = dateRows[r], c0 = dc[0].c;
    const spans = dc.map((x, k) => ({k: k, from: x.c, to: k + 1 < dc.length ? dc[k + 1].c - 1 : x.c + (k > 0 ? x.c - dc[k - 1].c : 1) - 1}));
    const textLeft = row => { const t = []; for (let c = 0; c < c0; c++) { const s = efText_(row[c]).trim(); if (s) t.push(s); } return t.join(' '); };
    // Linha logo abaixo das datas: subtítulos (texto) — ou já os números (sem subtítulo).
    const next = grid[r + 1] || [];
    let subTxt = 0, subNum = 0;
    spans.forEach(sp => { for (let c = sp.from; c <= sp.to; c++) { if (efNum_(next[c]) !== null) subNum++; else if (efText_(next[c]).trim()) subTxt++; } });
    const hasSub = subTxt > 0 && subTxt >= subNum;
    const sub = c => hasSub ? efText_(next[c]).trim() : '';
    const raw = [];
    let seen = false;
    for (let dr = r + (hasSub ? 2 : 1); dr < nRows; dr++) {
      if (dateRows[dr]) break;
      const row = grid[dr] || [], label = textLeft(row);
      let any = false;
      spans.forEach(sp => {
        for (let c = sp.from; c <= sp.to; c++) {
          const v = efNum_(row[c]);
          if (v === null) continue;
          any = true;
          const sb = sub(c);
          raw.push({k: sp.k, c: c, i: dr, pos: c - sp.from, label: label, sub: sb, kind: efSubKind_(sb) || efSubKind_(label), value: v});
        }
      });
      if (any) seen = true;
      else if (!label && seen) break;
    }
    // V4.36.3: ano das datas sem ano = o que põe mais datas entre 1 ano atrás e daqui a 60 dias; empate: o último dia
    // preenchido (sem o programado) até hoje (+7 dias). Antes era só pelo último dia preenchido (colunas futuras preenchidas
    // puxavam o ano para trás).
    let base = y0;
    if (dc.some(x => !x.y)) {
      const cheios = {};
      raw.forEach(x => { if (x.kind !== 'program' && x.value) cheios[x.k] = 1; });
      const kc = Object.keys(cheios).map(Number);
      let best = null;
      for (let Y = y0 + 1; Y >= y0 - 6; Y--) {
        const ds = dc.map(x => (x.y ? iso(x.y, x.m, x.d) : iso(Y + x.off, x.m, x.d)));
        const score = ds.filter(d => d >= lo && d <= hi).length, last = kc.reduce((a, k) => (ds[k] > a ? ds[k] : a), '');
        const okLast = !last || last <= lim7 ? 1 : 0;
        if (!best || score > best.score || (score === best.score && okLast > best.okLast)) best = {Y: Y, score: score, okLast: okLast};
      }
      base = best.Y;
    }
    const dates = dc.map(x => (x.y ? iso(x.y, x.m, x.d) : iso(base + x.off, x.m, x.d)));
    // V4.36.3: data digitada errada no cabeçalho (os números iam para o dia errado): com as vizinhas em sequência e o mesmo
    // espaço entre as colunas, vale o dia que a posição dela pede. Fica no aviso do teste das planilhas.
    const n = dates.length, passo = k => dc[k].c - dc[k - 1].c;
    for (let k = 0; k < n; k++) {
      let certo = '';
      if (k > 0 && k < n - 1 && passo(k) === passo(k + 1) && dd(dates[k - 1], dates[k + 1]) === 2 && dd(dates[k - 1], dates[k]) !== 1) certo = addDaysIso_(dates[k - 1], 1);
      else if (k === 0 && n >= 3 && passo(1) === passo(2) && dd(dates[1], dates[2]) === 1 && dd(dates[0], dates[1]) !== 1) certo = addDaysIso_(dates[1], -1);
      else if (k === n - 1 && n >= 3 && passo(n - 1) === passo(n - 2) && dd(dates[n - 3], dates[n - 2]) === 1 && dd(dates[n - 2], dates[n - 1]) !== 1) certo = addDaysIso_(dates[n - 2], 1);
      if (certo) {
        avisos.push('coluna ' + efColName_(dc[k].c + 1) + ' (linha ' + (r + 1) + '): "' + efText_(grid[r][dc[k].c]).slice(0, 20) + '" lido como ' + certo);
        dates[k] = certo;
      }
    }
    // A mesma data duas vezes na linha: vale a primeira.
    const vistas = {};
    dates.forEach((d, k) => {
      if (!vistas[d]) { vistas[d] = 1; return; }
      avisos.push('coluna ' + efColName_(dc[k].c + 1) + ' (linha ' + (r + 1) + '): a data ' + d + ' já apareceu antes na linha — ignorada');
      dates[k] = '';
    });
    raw.forEach(x => { if (dates[x.k]) out.push({date: dates[x.k], c: x.c, i: x.i, pos: x.pos, label: x.label, sub: x.sub, kind: x.kind, value: x.value}); });
  });
  out.avisos = avisos;
  return out;
}
/**
 * Resumo de uma grade para o teste das Configurações (sem nomes: só contagens, datas, colunas e os números das categorias):
 * os últimos dias com as colunas de onde vieram — para conferir com a planilha — e as datas do cabeçalho corrigidas.
 */
function efResumoGrade_(recs) {
  const datas = {}, rot = {}, dia = {};
  recs.forEach(x => {
    datas[x.date] = 1;
    const r = efRoleOf_(x.label);
    if (!r) return;
    rot[r.nome] = 1;
    const kind = x.kind === 'present' || x.kind === 'program' ? x.kind : (x.pos === 0 ? 'present' : x.pos === 1 ? 'program' : '');
    if (!kind) return;
    const d = dia[x.date] = dia[x.date] || {cols: [], v: {}}, col = efColName_(x.c + 1);
    if (d.cols.indexOf(col) < 0) d.cols.push(col);
    if (d.v[r.key + kind] === undefined) d.v[r.key + kind] = x.value;
  });
  const ds = Object.keys(datas).sort(), hoje = isoToday_(), fmt = v => (v === undefined ? '—' : String(v));
  const ultimos = Object.keys(dia).filter(d => d <= hoje && EF_ROLES_.some(r => dia[d].v[r.key + 'present'])).sort().slice(-7).reverse()
    .map(d => d + ' (colunas ' + dia[d].cols.join('-') + '): ' + EF_ROLES_.map(r => r.nome + ' ' + fmt(dia[d].v[r.key + 'present']) + '/' + fmt(dia[d].v[r.key + 'program'])).join(' · '));
  return {datas: ds.length, primeira: ds[0] || '—', ultima: ds[ds.length - 1] || '—', categorias: Object.keys(rot), ultimosDias: ultimos,
    cabecalhoCorrigido: (recs.avisos || []).slice(0, 10)};
}
/**
 * As duas planilhas lidas agora (ficam na memória por 3 min — o resumo e a lista de vários dias leem as mesmas grades):
 * {pres (planilha 1), efic (aba da eficiência), presenca (aba da presença), abas, erros, lastDate, dates}.
 */
var EF_PLAN_ = null;
function efPlanilhas_(force) {
  const L = efLinksCfg_(), sig = (L.pres ? L.pres.link : '') + '|' + (L.efic ? L.efic.link : '');
  if (!force && EF_PLAN_ && EF_PLAN_.sig === sig && EF_PLAN_.ate > Date.now()) return EF_PLAN_.data;
  EF_PLAN_ = null;
  efUserToken_(); // conta não conectada / acesso vencido: um aviso só (não um por planilha)
  // st1 (V4.36.3): situação da planilha 1 — 0 lida com as categorias, 1 sem o link, 2 erro na leitura, 3 sem as linhas das categorias.
  const out = {pres: [], efic: [], presenca: [], abas: {}, erros: [], st1: L.pres ? 2 : 1};
  const msg = e => String(e && e.message || e).replace(/^Error:\s*/, '');
  if (L.pres) {
    try {
      // Planilha comum: as abas (a do link primeiro). V4.36.4: documento com planilhas dentro: cada planilha do documento.
      const no = efNodeOf_(L.pres);
      let ordem = [], nomes = [];
      if (no.type === 'docx' || no.type === 'doc') {
        const blocos = efDocSheets_(no.token);
        if (!blocos.length) throw new Error('o documento do link não tem planilha dentro (a tabela precisa ser uma planilha do Feishu)');
        blocos.slice(0, 8).forEach((b, k) => {
          let tab = null;
          try { tab = efTabs_(b.sp).filter(t => t.sheet_id === b.sheetId)[0] || null; } catch (e) { tab = null; }
          tab = tab || {sheet_id: b.sheetId, title: '', grid_properties: {row_count: 200, column_count: 1500}};
          tab = Object.assign({}, tab, {title: 'planilha ' + (k + 1) + ' do documento' + (tab.title ? ' (' + tab.title + ')' : '')});
          ordem.push({sp: b.sp, tab: tab});
        });
        nomes = ordem.map(x => x.tab.title);
      } else if (no.type === 'sheet') {
        const tabs = efTabs_(no.token), vis = tabs.filter(t => !t.hidden);
        const pedida = L.pres.sheet ? tabs.filter(t => t.sheet_id === L.pres.sheet) : [];
        ordem = pedida.concat(vis.filter(t => pedida.indexOf(t) < 0)).slice(0, 8).map(t => ({sp: no.token, tab: t}));
        nomes = tabs.map(t => t.title || t.sheet_id);
      } else throw new Error('O link do wiki não é de uma planilha nem de um documento com planilha (tipo ' + no.type + ').');
      if (!ordem.length) throw new Error('a planilha não tem abas');
      let achou = null, primeira = null;
      for (let k = 0; k < ordem.length && !achou; k++) {
        const recs = efGridRecords_(efGrid_(ordem[k].sp, ordem[k].tab)), it = {tab: ordem[k].tab, recs: recs};
        if (recs.some(x => efRoleOf_(x.label))) achou = it;
        else if (!primeira) primeira = it;
      }
      const usa = achou || primeira;
      out.pres = achou ? achou.recs : [];
      out.st1 = achou ? 0 : 3;
      out.abas.presentesProgramados = usa.tab.title || usa.tab.sheet_id;
      out.resumo1 = Object.assign({abasDaPlanilha: nomes}, efResumoGrade_(usa.recs));
      if (!achou) {
        out.erros.push('Planilha de presentes e programados: não achei as linhas das categorias (Administrativo, Assistente Operacional, ' +
          'Operacional, Temporário, Diarista) embaixo de uma linha de datas (abas olhadas: ' + ordem.map(x => x.tab.title || x.tab.sheet_id).join(', ') + ')');
      }
    } catch (e) { out.erros.push('Planilha de presentes e programados: ' + msg(e)); }
  }
  if (L.efic) {
    try {
      const sp = efSpToken_(L.efic), tabs = efTabs_(sp), vis = tabs.filter(t => !t.hidden);
      const by = (pref, re) => vis.filter(t => pref.test(efNorm_(t.title)))[0] || vis.filter(t => re.test(efNorm_(t.title)))[0];
      const tEf = by(/日均效率|eficiencia media diaria/, /效率|eficien/) || (L.efic.sheet && tabs.filter(t => t.sheet_id === L.efic.sheet)[0]);
      const tPr = by(/人员出勤|presenca de colab/, /出勤|presenca/);
      if (!tEf && !tPr) throw new Error('não achei as abas "日均效率 Eficiência média diária" e "人员出勤 Presença de colaboradores"');
      if (tEf) { out.efic = efGridRecords_(efGrid_(sp, tEf)); out.abas.eficiencia = tEf.title || tEf.sheet_id; }
      if (tPr && tPr !== tEf) { out.presenca = efGridRecords_(efGrid_(sp, tPr)); out.abas.presenca = tPr.title || tPr.sheet_id; }
      if (!tEf) out.erros.push('Planilha da eficiência: não achei a aba "日均效率 Eficiência média diária"');
      if (!tPr) out.erros.push('Planilha da eficiência: não achei a aba "人员出勤 Presença de colaboradores"');
    } catch (e) { out.erros.push('Planilha da eficiência: ' + msg(e)); }
  }
  if (out.erros.length && !out.pres.length && !out.efic.length && !out.presenca.length) throw new Error(out.erros.join(' · '));
  out.avisosCabecalho = (out.efic.avisos || []).map(a => 'aba da eficiência, ' + a).concat((out.presenca.avisos || []).map(a => 'aba de presença, ' + a));
  // Último dia com números (presença ou eficiência; o programado pode vir antes do dia) — até hoje.
  const hoje = isoToday_(), dias = {};
  out.pres.filter(x => x.kind !== 'program').concat(out.efic, out.presenca).forEach(x => { if (x.date <= hoje && x.value) dias[x.date] = 1; });
  out.dates = Object.keys(dias).sort();
  out.lastDate = out.dates[out.dates.length - 1] || '';
  EF_PLAN_ = {sig: sig, ate: Date.now() + 180000, data: out};
  return out;
}
/** Números de um dia nas planilhas: categorias (planilha 1), eficiência da matriz e presença de efetivos/temporários por turno. */
function efDiaPlanilhas_(date, P) {
  const roles = {};
  EF_ROLES_.forEach(r => { roles[r.key] = {present: null, program: null}; });
  P.pres.filter(x => x.date === date).forEach(x => {
    const r = efRoleOf_(x.label);
    if (!r) return;
    const kind = x.kind === 'present' || x.kind === 'program' ? x.kind : (x.pos === 0 ? 'present' : x.pos === 1 ? 'program' : '');
    if (kind && roles[r.key][kind] === null) roles[r.key][kind] = x.value;
  });
  const ef = P.efic.filter(x => x.date === date && x.value !== null);
  const efPick = ef.filter(x => x.kind === 'eficiencia' && efIsTotal_(x.label))[0] || ef.filter(x => x.kind === 'eficiencia')[0] ||
    ef.filter(x => !x.kind)[0] || null;
  // Presença: uma linha por turno e a do total (pelo nome; sem nome, a última linha que é a soma das outras).
  const byRow = {};
  P.presenca.filter(x => x.date === date).forEach(x => {
    const kind = x.kind === 'efetivo' || x.kind === 'temporario' ? x.kind : (x.pos === 0 ? 'efetivo' : x.pos === 1 ? 'temporario' : '');
    if (!kind) return;
    const row = byRow[x.i] = byRow[x.i] || {i: x.i, label: x.label, efetivo: null, temporario: null};
    if (row[kind] === null) row[kind] = x.value;
  });
  let rows = Object.keys(byRow).map(k => byRow[k]).sort((a, b) => a.i - b.i), total = rows.filter(r => efIsTotal_(r.label))[0] || null;
  let parts = rows.filter(r => r !== total);
  if (!total && parts.length >= 3) {
    const last = parts[parts.length - 1], rest = parts.slice(0, -1), s = k => rest.reduce((a, r) => a + (r[k] || 0), 0);
    if ((last.efetivo || 0) === s('efetivo') && (last.temporario || 0) === s('temporario')) { total = last; parts = rest; }
  }
  if (!total && parts.length === 1) { total = parts[0]; parts = []; }
  // Turno pelo nome; com 3 linhas, as que não têm nome reconhecido ficam com os turnos que faltam, na ordem.
  parts.forEach(p => { p.shift = efShiftOf_(p.label); });
  const usados = parts.map(p => p.shift).filter(Boolean), faltam = EF_SHIFTS_.filter(x => usados.indexOf(x) < 0), sem = parts.filter(p => !p.shift);
  if (parts.length === 3 && usados.length === new Set(usados).size && sem.length === faltam.length) sem.forEach((p, k) => { p.shift = faltam[k]; });
  const soma = k => (parts.some(p => p[k] !== null) ? parts.reduce((a, p) => a + (p[k] || 0), 0) : null);
  return {date: date, roles: roles, efOficial: efPick ? efPick.value : null,
    efetivos: total ? total.efetivo : soma('efetivo'), temporarios: total ? total.temporario : soma('temporario'),
    shifts: parts.filter(p => p.shift), linhasPresenca: rows.map(r => r.label || '(sem nome)'), lastDate: P.lastDate || '', st1: P.st1 || 0};
}
/**
 * V4.36.3: versão da leitura das planilhas. Números das categorias gravados por uma leitura mais antiga (que podia pôr os números
 * de uma coluna no dia errado) são trocados pela leitura atual — também quando a planilha não tem mais o dia.
 */
const EF_PARSER_ = 5;
/** As 10 chaves das categorias (presentes e programados de Administrativo, Assistente Operacional, Operacional, Temporário e Diarista). */
const EF_CAT_KEYS_ = EF_ROLES_.map(r => 'present' + r.key).concat(EF_ROLES_.map(r => 'program' + r.key));
/** Números lidos das planilhas (os que ficam gravados por dia). */
const EF_FEISHU_KEYS_ = ['efOficial', 'presentEfetivos', 'presentTemporarios']
  .concat(EF_SHIFTS_.map(s => 'presentEf' + s), EF_SHIFTS_.map(s => 'presentTp' + s))
  .concat(EF_ROLES_.map(r => 'present' + r.key), EF_ROLES_.map(r => 'program' + r.key));
/** Dia das planilhas → os números de EF_FEISHU_KEYS_ (zero do total = vazio). */
function efPlanMetrics_(day) {
  const m = {};
  EF_FEISHU_KEYS_.forEach(k => { m[k] = null; });
  m.efOficial = day.efOficial > 0 ? Math.round(day.efOficial * 100) / 100 : null;
  m.presentEfetivos = day.efetivos;
  m.presentTemporarios = day.temporarios;
  if (!(m.presentEfetivos > 0) && !(m.presentTemporarios > 0)) { m.presentEfetivos = null; m.presentTemporarios = null; }
  day.shifts.forEach(p => {
    if (EF_SHIFTS_.indexOf(p.shift) < 0) return;
    m['presentEf' + p.shift] = p.efetivo;
    m['presentTp' + p.shift] = p.temporario;
  });
  EF_ROLES_.forEach(r => { m['present' + r.key] = day.roles[r.key].present; m['program' + r.key] = day.roles[r.key].program; });
  m.hcLastDay = day.lastDate ? Number(day.lastDate.replace(/-/g, '')) : null;
  m.efParser = EF_PARSER_;
  // V4.36.4: de onde vieram as categorias — catFonte = versão da leitura da tabela EFI GRU. Sem catFonte, as categorias gravadas
  // são da base do formulário antiga (V4.33) e não valem mais.
  m.catFonte = EF_CAT_KEYS_.some(k => m[k] !== null && m[k] !== undefined) ? EF_PARSER_ : null;
  // V4.36.3: por que faltam as categorias no dia (0 tem; 1 sem o link 1; 2 erro na leitura; 3 sem as linhas; 4 a planilha não tem o dia).
  m.presStatus = day.st1 ? day.st1 : (EF_ROLES_.some(r => day.roles[r.key].present !== null || day.roles[r.key].program !== null) ? 0 : 4);
  return m;
}
/**
 * Dia gravado antes: o número que a planilha não tem mais (apagado ou ainda não preenchido) continua o gravado. Exceção (V4.36.3):
 * as categorias gravadas por uma leitura antiga não ficam quando a planilha de presentes foi lida agora (podiam ser do dia errado).
 */
function efKeep_(m, prev) {
  const out = Object.assign({}, m || {});
  const leu1 = !!m && (Number(m.presStatus) === 0 || Number(m.presStatus) === 4);
  // V4.36.4: categorias gravadas só ficam se vieram da tabela EFI GRU (catFonte) — as da base do formulário antiga (sem catFonte)
  // nunca ficam; as de uma leitura mais antiga da tabela ficam só enquanto a tabela não é lida de novo.
  const fonte = prev ? Number(prev.catFonte) || 0 : 0, guardaCat = fonte > 0 && (fonte === EF_PARSER_ || !leu1);
  let guardou = false;
  EF_FEISHU_KEYS_.forEach(k => {
    if (out[k] !== null && out[k] !== undefined) return;
    const cat = EF_CAT_KEYS_.indexOf(k) >= 0, v = prev && prev[k] !== null && prev[k] !== undefined && (!cat || guardaCat) ? prev[k] : null;
    out[k] = v;
    if (cat && v !== null) guardou = true;
  });
  out.catFonte = EF_CAT_KEYS_.some(k => out[k] !== null && out[k] !== undefined) ? ((m && m.catFonte) || (guardou ? fonte : null) || EF_PARSER_) : null;
  if (!m && prev) { if (prev.hcLastDay) out.hcLastDay = prev.hcLastDay; if (prev.efParser) out.efParser = prev.efParser; }
  return out;
}
/**
 * V4.36.4 (pedido "Será que não está puxando os dados da minha base do formulário? Porque os dados estão iguais"): uma vez — tira
 * dos dias gravados as categorias que vieram da base do formulário antiga (sem catFonte). Só no painel; nada muda no Feishu.
 */
function efLimparCategoriasFormulario_() {
  if (!INDICATORS.efficiency || getProp_('EF_CATEGORIAS_LIMPAS', '') === '1') return 0;
  let n = 0;
  getRates_('efficiency', null, null).forEach(r => {
    const m = r.metrics || {};
    if (Number(m.catFonte) > 0 || !EF_CAT_KEYS_.some(k => m[k] !== null && m[k] !== undefined)) return;
    const hm = Object.assign({}, m);
    EF_CAT_KEYS_.forEach(k => { hm[k] = null; });
    efDerive_(hm);
    hm.catFonte = null;
    hm.feishuFail = m.feishuFail;
    const jms = {};
    Object.keys(EF_JMS_FIELDS_).forEach(k => { jms[k] = m[k] === undefined ? null : m[k]; });
    const s = efSummaryFrom_('efficiency', r.date, jms.processed === null ? null : jms, hm, '');
    if (!s.empty) { upsertRate_(s); n++; }
  });
  setProp_('EF_CATEGORIAS_LIMPAS', '1');
  if (n) logSync_('INFO', 'efficiency', '', 'Eficiência: categorias da base do formulário antiga tiradas de ' + n + ' dia(s) (agora só valem as da tabela EFI GRU).');
  return n;
}
/** Totais do dia a partir dos números gravados: presentes (efetivos + temporários), categorias, turnos e % de presença. */
function efDerive_(m) {
  const sum = keys => (keys.some(k => m[k] !== null && m[k] !== undefined) ? keys.reduce((a, k) => a + (Number(m[k]) || 0), 0) : null);
  m.presentCat = sum(EF_ROLES_.map(r => 'present' + r.key));
  m.program = sum(EF_ROLES_.map(r => 'program' + r.key));
  EF_SHIFTS_.forEach(s => { m['present' + s] = sum(['presentEf' + s, 'presentTp' + s]); m['program' + s] = null; });
  const ef = sum(['presentEfetivos', 'presentTemporarios']);
  m.present = ef > 0 ? ef : (m.presentCat > 0 ? m.presentCat : null);
  m.presentSource = ef > 0 ? 2 : (m.presentCat > 0 ? 1 : 0);
  m.presenceRate = m.presentCat !== null && m.program > 0 ? Math.round(m.presentCat / m.program * 10000) / 100 : null;
  m.headcountRows = EF_FEISHU_KEYS_.filter(k => m[k] !== null && m[k] !== undefined).length;
  m.feishuFail = 0;
  return m;
}
/** Números do Feishu do dia (lidos agora + os gravados antes). Erro de leitura → só os gravados e o aviso. */
function efFeishuDay_(date, prevMetrics) {
  let base = null, erro = '';
  try {
    const P = efPlanilhas_();
    base = efPlanMetrics_(efDiaPlanilhas_(date, P));
    if (P.erros.length) erro = P.erros.join(' · ');
  } catch (e) { erro = String(e && e.message || e); }
  const m = efDerive_(efKeep_(base, prevMetrics));
  let semLink1 = false;
  try { const L = efLinksCfg_(true); semLink1 = !L || !L.pres; } catch (e) { semLink1 = false; }
  m.presStatus = base ? base.presStatus : (semLink1 ? 1 : 2);
  return {m: m, erro: erro};
}

// ------------------------------------------------------------------ resumo e lista do dia
/**
 * Resumo do dia (tarefa SUMMARY): o volume do JMS e os números das planilhas da matriz. Sem o Feishu (não configurado, conta
 * desconectada ou fora do ar): o volume do JMS entra e os números do Feishu ficam os já gravados (aviso no LOG, uma vez por dia).
 */
function efficiencySummary_(indicatorKey, isoDate) {
  const jms = efJmsDay_(isoDate), prev = getRateDay_(indicatorKey, isoDate);
  const fd = efFeishuDay_(isoDate, prev && prev.metrics);
  if (fd.erro && getProp_('EF_AVISO_FEISHU', '') !== isoToday_()) {
    setProp_('EF_AVISO_FEISHU', isoToday_());
    logSync_('WARN', indicatorKey, isoDate, 'Eficiência: planilhas do Feishu não lidas — ' + fd.erro.slice(0, 300));
  }
  return efSummaryFrom_(indicatorKey, isoDate, jms, fd.m, fd.erro);
}
function efSummaryFrom_(indicatorKey, isoDate, jms, hm, feishuErro) {
  const has = !!(hm && (hm.present > 0 || hm.efOficial > 0));
  if (!jms && !has) return {indicator: indicatorKey, date: isoDate, empty: true};
  const raw = Object.assign({date: isoDate, source: 'JMS+FEISHU'}, jms || {}, hm || {});
  Object.keys(EF_JMS_FIELDS_).forEach(k => { if (raw[k] === undefined) raw[k] = null; });
  // A mesma conta da matriz (volume ÷ presença de efetivos + temporários), com o volume do JMS: vale quando a matriz não tem o dia.
  raw.efCalc = raw.processed !== null && raw.processed !== undefined && hm && hm.present > 0 ? Math.round(raw.processed / hm.present * 100) / 100 : null;
  raw.efficiency = raw.efOficial > 0 ? raw.efOficial : raw.efCalc;
  raw.efSource = raw.efOficial > 0 ? 1 : (raw.efCalc !== null ? 2 : 0);
  if (feishuErro) { raw.feishuErro = String(feishuErro).slice(0, 200); raw.feishuFail = 1; }
  // A "taxa" do dia não aparece neste painel (cartões próprios): a eficiência, ou 0 enquanto falta.
  return {indicator: indicatorKey, date: isoDate, rate: raw.efficiency === null ? 0 : raw.efficiency,
    errorCount: hm && hm.present > 0 ? hm.present : 0, totalCount: raw.processed === null ? 0 : raw.processed, empty: false, raw: raw};
}
/**
 * Lista do dia (tarefa DETAIL_INIT), a partir dos números gravados do dia: Presentes / Programados por categoria (planilha 1) e
 * Efetivos / Temporários por turno (aba de presença) — para os gráficos e as tabelas. Também regrava o resumo.
 */
/** Linhas da lista de um dia a partir dos números do dia (os mesmos dos cartões). Devolve quantas linhas. */
function efRowsFromMetrics_(date, m, addRow) {
  let n = 0;
  const add = (column, shift, role, v) => { v = Number(v); if (!(v > 0)) return; addRow({date: date, column: column, shift: shift, role: role, qty: v}); n++; };
  EF_ROLES_.forEach(r => { add('Presentes', 'N/A', r.nome, m['present' + r.key]); add('Programados', 'N/A', r.nome, m['program' + r.key]); });
  const porTurno = EF_SHIFTS_.some(s => m['presentEf' + s] > 0 || m['presentTp' + s] > 0);
  if (porTurno) EF_SHIFTS_.forEach(s => { add('Efetivos', s, '', m['presentEf' + s]); add('Temporários', s, '', m['presentTp' + s]); });
  else { add('Efetivos', 'N/A', '', m.presentEfetivos); add('Temporários', 'N/A', '', m.presentTemporarios); }
  return n;
}
/**
 * V4.36.3 (pedido "o T1 aparece no cartão, porém não aparece no gráfico de coluna e tabelas"): a lista do período (gráficos,
 * tabelas e relatórios) é montada na hora dos números gravados de cada dia — os mesmos dos cartões. Não depende mais do arquivo
 * do dia (que podia ficar atrás do cartão até a fila refazer). Mesmo retorno do scanArchive_.
 */
function efArchiveFromRates_(indicator, from, to, sink) {
  const cfg = getIndicatorConfig_(indicator), loaded = [], empty = [], com = {};
  getRates_(indicator, from, to).forEach(r => {
    const acc = GroupAccumulator_(cfg);
    if (efRowsFromMetrics_(r.date, r.metrics || {}, row => acc.addRow(row))) { sink.addEncoded(acc.build()); loaded.push(r.date); com[r.date] = 1; }
  });
  dateRangeIso_(from, to).forEach(d => { if (!com[d]) empty.push(d); });
  return {loadedDates: loaded.sort(), partialDates: [], staleDates: [], notDownloaded: [], notLoaded: [], emptyDates: empty.sort(), readFiles: 0,
    fullyLoaded: true};
}
function runEfficiencyDetailJob_(job, deadline, cfg, st) {
  const ind = job.indicator, date = job.date, prev = getRateDay_(ind, date), pm = prev && prev.metrics || null;
  const fd = efFeishuDay_(date, pm), m = fd.m, acc = GroupAccumulator_(cfg);
  const rowsIn = efRowsFromMetrics_(date, m, row => acc.addRow(row));
  const ds = acc.build();
  saveDayDataset_(ind, date, ds, 1, acc.total());
  groupedShiftAgg_(ind, date, ds);
  const jms = {};
  Object.keys(EF_JMS_FIELDS_).forEach(k => { jms[k] = pm ? pm[k] : null; });
  const summary = efSummaryFrom_(ind, date, jms.processed === null || jms.processed === undefined ? null : jms, m, fd.erro);
  if (!summary.empty) upsertRate_(summary);
  updateDayStatus_(ind, date, {detailsStatus: 'COMPLETE', expectedPages: 1, savedPages: 1, expectedRecords: acc.total(), savedRows: rowsIn, error: ''});
  return 'done';
}
/**
 * De hora em hora (syncHourly) e no teste das Configurações: lê as planilhas e põe na fila os dias que mudaram ou ganharam
 * números desde a última leitura (a matriz preenche à mão, às vezes dias depois). Devolve quantos dias entraram na fila.
 */
function efQueueSheetChanges_(force) {
  if (!INDICATORS.efficiency) return 0;
  try { efLimparCategoriasFormulario_(); } catch (e) { logSync_('WARN', 'efficiency', '', 'Eficiência: limpeza das categorias antigas não concluída: ' + e); }
  if (!efLinksCfg_(true)) return 0;
  if (!getProp_('FEISHU_USER_SEGREDO', '') && !getProp_('FEISHU_USER_TOKEN', '')) return 0;
  // V4.36.2: uma vez — as listas dos dias gravados antes (sem o T1 "TI" e sem as categorias) são refeitas com os números gravados.
  let refeitas = 0;
  if (getProp_('EF_LISTAS_REFEITAS', '') !== '4.36.2') {
    const ini = String(getProp_('DATA_START_DATE', '') || '') || addDaysIso_(isoToday_(), -400);
    const dias = getRates_('efficiency', ini, isoToday_()).map(r => r.date);
    if (dias.length) refeitas = enqueueJobs_(dias.map(d => ['DETAIL_INIT', 'efficiency', d, 1]), {reset: true}) || 0;
    setProp_('EF_LISTAS_REFEITAS', '4.36.2');
    if (dias.length) logSync_('INFO', 'efficiency', '', 'Eficiência: ' + dias.length + ' lista(s) de dia refeitas (turnos e categorias das planilhas da matriz).');
  }
  const agora = Date.now();
  if (!force && agora - (Number(getProp_('EF_CONFERENCIA_AT', '0')) || 0) < 50 * 60000) return 0;
  setProp_('EF_CONFERENCIA_AT', String(agora));
  let P;
  try { P = efPlanilhas_(true); }
  catch (e) {
    if (getProp_('EF_AVISO_FEISHU', '') !== isoToday_()) {
      setProp_('EF_AVISO_FEISHU', isoToday_());
      logSync_('WARN', 'efficiency', '', 'Eficiência: conferência das planilhas do Feishu não feita — ' + String(e && e.message || e).slice(0, 300));
    }
    return 0;
  }
  const hoje = isoToday_(), inicio = String(getProp_('DATA_START_DATE', '') || ''), limite = addDaysIso_(hoje, -400);
  const from = inicio > limite ? inicio : limite;
  const todos = {};
  P.pres.concat(P.efic, P.presenca).forEach(x => { if (x.date >= from && x.date <= hoje) todos[x.date] = 1; });
  // V4.36.3: e os dias gravados por uma leitura antiga com categorias (podiam estar no dia errado), se a planilha 1 foi lida.
  const CAT = EF_ROLES_.map(r => 'present' + r.key).concat(EF_ROLES_.map(r => 'program' + r.key)), nz = v => (v === undefined ? null : v);
  if (P.st1 === 0) getRates_('efficiency', from, hoje).forEach(r => {
    if (r.metrics && Number(r.metrics.catFonte) !== EF_PARSER_ && CAT.some(k => nz(r.metrics[k]) !== null)) todos[r.date] = 1;
  });
  const mudou = Object.keys(todos).sort().filter(d => {
    const base = efPlanMetrics_(efDiaPlanilhas_(d, P)), prev = getRateDay_('efficiency', d), pm = prev && prev.metrics;
    if (!pm) return base.efOficial > 0 || base.presentEfetivos > 0 || base.presentTemporarios > 0 || EF_ROLES_.some(r => base['present' + r.key] > 0);
    if (P.st1 === 0 && Number(pm.catFonte) !== EF_PARSER_ && CAT.some(k => nz(base[k]) !== nz(pm[k]))) return true;
    return EF_FEISHU_KEYS_.some(k => base[k] !== null && base[k] !== undefined && base[k] !== pm[k]);
  });
  // V4.36.5 (pedido "não está aparecendo" — só o último dia tinha as categorias): o dia que já tem o volume do JMS gravado recebe os
  // números das planilhas NA HORA (sem esperar a fila nem consultar o JMS de novo); só o dia novo vai para a fila (precisa do JMS).
  const novos = [];
  let atualizados = 0;
  mudou.forEach(d => {
    const prev = getRateDay_('efficiency', d), pm = prev && prev.metrics;
    if (!pm) { novos.push(d); return; }
    try { if (efAplicarPlanilhasDia_(d, P, pm)) atualizados++; else novos.push(d); }
    catch (e) { novos.push(d); }
  });
  if (novos.length) enqueueJobs_(novos.map(d => ['SUMMARY', 'efficiency', d, 0]), {reset: true});
  EF_ULTIMA_CONF_ = {atualizados: atualizados, fila: novos.length};
  if (mudou.length) {
    logSync_('INFO', 'efficiency', '', 'Eficiência: ' + mudou.length + ' dia(s) com números novos ou mudados nas planilhas do Feishu — ' +
      atualizados + ' atualizado(s) na hora' + (novos.length ? ', ' + novos.length + ' na fila (dia novo: precisa do volume do JMS)' : '') + '.');
  }
  return mudou.length;
}
var EF_ULTIMA_CONF_ = {atualizados: 0, fila: 0};
/** V4.36.5: grava no dia os números das planilhas (lidas agora) com o volume do JMS já gravado — sem consultar o JMS. */
function efAplicarPlanilhasDia_(date, P, pm) {
  const base = efPlanMetrics_(efDiaPlanilhas_(date, P)), m = efDerive_(efKeep_(base, pm));
  m.presStatus = base.presStatus;
  const jms = {};
  Object.keys(EF_JMS_FIELDS_).forEach(k => { jms[k] = pm[k] === undefined ? null : pm[k]; });
  const s = efSummaryFrom_('efficiency', date, jms.processed === null ? null : jms, m, P.erros.length ? P.erros.join(' · ') : '');
  if (s.empty) return false;
  upsertRate_(s);
  return true;
}

// ------------------------------------------------------------------ Configurações
/** Situação da conexão (cartão "Planilhas do Feishu" nas Configurações). Nunca mostra tokens nem o App Secret. */
function statusPlanilhasFeishu() {
  const tem = k => !!String(getProp_(k, '') || '').trim();
  return {app: tem('FEISHU_APP_ID') && tem('FEISHU_APP_SECRET'), linkPresenca: tem('FEISHU_LINK_PRESENCA'), linkEficiencia: tem('FEISHU_LINK_EFICIENCIA'),
    conectado: tem('FEISHU_USER_SEGREDO') || (tem('FEISHU_USER_TOKEN') && Number(getProp_('FEISHU_USER_EXPIRA', '0')) > Date.now()),
    renovavel: tem('FEISHU_USER_SEGREDO'), conectadoEm: getProp_('FEISHU_USER_EM', ''), renovadoEm: getProp_('FEISHU_USER_RENOVADO', ''),
    renovarAte: getProp_('FEISHU_USER_RENOVAR_ATE', ''), erro: getProp_('FEISHU_USER_ERRO', ''),
    conferidoEm: Number(getProp_('EF_CONFERENCIA_AT', '0')) ? new Date(Number(getProp_('EF_CONFERENCIA_AT', '0'))).toISOString() : ''};
}
/**
 * Configurações → "Testar as planilhas" (ou Executar função): lê as duas planilhas e mostra o que achou — as abas, as
 * categorias, as linhas da presença e os últimos dias. Nunca mostra tokens, o App Secret nem nomes de pessoas. Põe na fila os
 * dias com números novos ou mudados (para entrarem no painel).
 */
function testarPlanilhasFeishu() {
  if (!INDICATORS.efficiency) return {ok: false, erro: 'As planilhas do Feishu são do painel Eficiência do SP GRU.'};
  try {
    efAppCfg_();
    efLinksCfg_();
    const P = efPlanilhas_(true), hoje = isoToday_();
    const fmt = v => (v === null || v === undefined ? '—' : String(Math.round(v * 100) / 100));
    const ultimos = P.dates.filter(d => d <= hoje).slice(-5).reverse().map(d => {
      const day = efDiaPlanilhas_(d, P), m = efDerive_(efPlanMetrics_(day));
      return d + ': eficiência da matriz ' + fmt(m.efOficial) + ' · presença ' + fmt(m.presentEfetivos) + ' efetivos + ' + fmt(m.presentTemporarios) +
        ' temporários' + (day.shifts.length ? ' (' + day.shifts.map(p => p.shift + ' ' + fmt(p.efetivo) + '+' + fmt(p.temporario)).join(' · ') + ')' : '') +
        ' · planilha 1: ' + fmt(m.presentCat) + ' presentes de ' + fmt(m.program) + ' programados';
    });
    const rotulos = {};
    P.presenca.forEach(x => { rotulos[x.label || '(sem nome)'] = 1; });
    const filaN = efQueueSheetChanges_(true);
    return {ok: true, abas: P.abas, planilha1: P.resumo1 || '—',
      categorias: EF_ROLES_.map(r => r.nome + ': ' + (P.pres.some(x => efRoleOf_(x.label) === r) ? '✓' : '✗ não achei a linha')),
      linhasDaPresenca: Object.keys(rotulos).slice(0, 12), diasComNumeros: P.dates.length,
      primeiroDia: P.dates[0] || '—', ultimoDia: P.lastDate || '—', ultimosDias: ultimos,
      aviso: P.erros.join(' · '), cabecalhoCorrigidoPlanilha2: (P.avisosCabecalho || []).slice(0, 10),
      diasNaFila: !filaN ? 'Nenhum dia novo ou mudado.' :
        (EF_ULTIMA_CONF_.atualizados ? EF_ULTIMA_CONF_.atualizados + ' dia(s) atualizado(s) agora com as planilhas (clique em Atualizar no painel)' : '') +
        (EF_ULTIMA_CONF_.atualizados && EF_ULTIMA_CONF_.fila ? '; ' : '') +
        (EF_ULTIMA_CONF_.fila ? EF_ULTIMA_CONF_.fila + ' dia(s) novo(s) na fila para entrar no painel (precisam do volume do JMS)' : '') + '.'};
  } catch (e) {
    return {ok: false, erro: String(e && e.message || e)};
  }
}
/** Nome antigo (V4.33), mantido para quem tem o atalho: o mesmo teste das planilhas. */
function testarBaseFeishu() { return testarPlanilhasFeishu(); }
/** Diagnóstico de um dia (Executar função): o volume do JMS, os números das planilhas e a eficiência que vale. */
function diagnosticarEficiencia(date) {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : addDaysIso_(isoToday_(), -1);
  const out = {dia: d, conta: 'Eficiência da matriz (planilha 效能监控表); sem ela: Qtd processada total (JMS) ÷ presença (efetivos + temporários)'};
  try { out.jms = efJmsDay_(d) || 'sem linha do JMS neste dia'; } catch (e) { out.jmsErro = String(e && e.message || e); }
  try {
    const P = efPlanilhas_(true), day = efDiaPlanilhas_(d, P), m = efDerive_(efPlanMetrics_(day));
    out.planilhas = {eficienciaDaMatriz: m.efOficial, efetivos: m.presentEfetivos, temporarios: m.presentTemporarios,
      turnos: day.shifts.map(p => p.shift + ': ' + p.efetivo + ' efetivos + ' + p.temporario + ' temporários'),
      linhasDaPresenca: day.linhasPresenca, presentesCategorias: m.presentCat, programados: m.program, presenca: m.presenceRate};
    if (P.erros.length) out.avisos = P.erros;
  } catch (e) { out.feishuErro = String(e && e.message || e); }
  const prev = getRateDay_('efficiency', d);
  if (prev && prev.metrics) out.gravado = {eficiencia: prev.metrics.efficiency, origem: prev.metrics.efSource === 1 ? 'matriz' : prev.metrics.efSource === 2 ? 'calculada' : '—'};
  const proc = out.jms && out.jms.processed, pl = out.planilhas || {}, pres = (pl.efetivos || 0) + (pl.temporarios || 0);
  out.eficiencia = pl.eficienciaDaMatriz > 0 ? pl.eficienciaDaMatriz + ' (da matriz)' :
    proc !== undefined && proc !== null && pres > 0 ? Math.round(proc / pres * 100) / 100 + ' (calculada com o volume do JMS)' :
    'sem conta (falta ' + (pres > 0 ? 'o JMS' : 'a presença nas planilhas') + ')';
  return out;
}
