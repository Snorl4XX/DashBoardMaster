'use strict';
/**
 * Leitura do Feishu (Bitable) em Node.js — SOMENTE LEITURA, nada é alterado no Feishu.
 *   buscarVeiculosPatio()          tabela PATIO_VEICULO      (FEISHU_TABLE_PATIO)
 *   buscarDocasFeishu()            tabela CONTROLE_DOCAS     (FEISHU_TABLE_DOCAS)
 *   buscarProgramacaoExpedicao()   tabela PROGRAMACAO_EXPEDICAO (FEISHU_TABLE_EXPEDICAO)
 *   testar(log) / diagnosticar(log)  conferência pelo terminal (node patio.js testar | diagnosticar)
 * As regras dos campos são as do painel original (texto dos campos, vínculos de doca, fim da descarga sem usar o
 * CHECK_OUT). O token do Feishu fica na memória até perto de vencer; se o Feishu recusar antes, pega outro sozinho.
 */
const credenciais = require('./credenciais');

const TOKEN_RECUSADO = [99991661, 99991663, 99991664, 99991668, 99991671];
const TABELAS = [['PATIO_VEICULO', 'FEISHU_TABLE_PATIO'], ['CONTROLE_DOCAS', 'FEISHU_TABLE_DOCAS'], ['PROGRAMACAO_EXPEDICAO', 'FEISHU_TABLE_EXPEDICAO']];

/** Texto de um campo do Bitable (texto rico, opção, pessoa, vínculo…). Vínculos não viram nome (IDs internos). */
function texto(valor) {
  if (valor === null || valor === undefined) return '';
  if (Array.isArray(valor)) return valor.map(texto).filter(Boolean).join(', ');
  if (typeof valor === 'object') {
    if (valor.text !== null && valor.text !== undefined) return texto(valor.text);
    if (valor.name !== null && valor.name !== undefined) return texto(valor.name);
    if (valor.label !== null && valor.label !== undefined) return texto(valor.label);
    if (valor.value !== null && valor.value !== undefined) return texto(valor.value);
    return '';
  }
  return String(valor);
}

/** IDs dos registros vinculados (campo de vínculo do Bitable). */
function idsVinculados(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor.flatMap(idsVinculados);
  if (typeof valor === 'object') {
    if (valor.link_record_ids) return idsVinculados(valor.link_record_ids);
    if (valor.record_ids) return idsVinculados(valor.record_ids);
    if (valor.record_id) return [String(valor.record_id)];
    if (valor.id && /^rec/i.test(String(valor.id))) return [String(valor.id)];
    return [];
  }
  return /^rec/i.test(String(valor)) ? [String(valor)] : [];
}

/**
 * Data/hora de um campo, em milissegundos, seja qual for o tipo no Feishu: data (número), texto ("08/11/2026 14:30",
 * "2026-11-08 14:30"), fórmula ou consulta ({type, value: [...]}). Sem fuso no texto = horário de São Paulo (UTC-3).
 * Antes ia o valor cru para a tela, e um campo que não fosse do tipo data aparecia vazio ("—").
 */
function instante(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? (v < 1e11 ? v * 1000 : v) : null;
  if (Array.isArray(v)) { for (const x of v) { const t = instante(x); if (t !== null) return t; } return null; }
  if (typeof v === 'object') return 'value' in v ? instante(v.value) : 'text' in v ? instante(v.text) : null;
  const s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) return instante(Number(s));
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0) + 3, +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0) + 3, +(m[5] || 0), +(m[6] || 0));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Número de um campo (número, texto "1.234" / "12,5", fórmula ou consulta). */
function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) { for (const x of v) { const n = numero(x); if (n !== null) return n; } return null; }
  if (typeof v === 'object') return 'value' in v ? numero(v.value) : 'text' in v ? numero(v.text) : null;
  let s = String(v).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return s && Number.isFinite(n) ? n : null;
}

/** Fim da descarga: só um campo que diga isso explicitamente. CHECK_OUT e HORA_DOCAGEM não contam. */
const CAMPOS_FIM = ['FIM_DESCARGA', 'FIM DESCARGA', 'DATA_FIM_DESCARGA', 'HORA_FIM_DESCARGA', 'HORARIO_FIM_DESCARGA',
  'FIM_DESCARREGAMENTO', 'DESCARGA_FINALIZADA_EM', 'CONCLUSAO_DESCARGA', 'CONCLUSÃO DESCARGA',
  'FIM_OPERACAO', 'FIM OPERAÇÃO', 'HORA_FIM_OPERACAO', 'DATA_FIM_OPERACAO'];
function fimDescarga(f) {
  for (const campo of CAMPOS_FIM) {
    const t = Object.prototype.hasOwnProperty.call(f, campo) ? instante(f[campo]) : null;
    if (t !== null) return {valor: t, campo};
  }
  return {valor: null, campo: ''};
}

/** Campos que o painel usa (diagnosticar confere se existem e o formato). */
const USADOS = {
  PATIO_VEICULO: ['PLACA', 'TIPO_VEICULO', 'MOTORISTA', 'TRANSPORTADORA', 'FLUXO', 'STATUS PATIO', 'DOCA', 'CONTROLE_DOCAS', 'CHECK_IN',
    'CHECK_OUT', 'HORA_DOCAGEM', 'FIM_DESCARGA', 'FIM_OPERACAO', 'PRIORIDADE_PATIO', 'ID_VIAGEM', 'DESTINO'],
  CONTROLE_DOCAS: ['DOCA', 'STATUS_DOCA', 'VEICULO_VINCULADO'],
  PROGRAMACAO_EXPEDICAO: ['ID_VIAGEM', 'TIPO_EXPEDICAO', 'DESTINO', 'STATUS', 'SAIDA_PROGRAMADA', 'PLACA CAVALO', 'PLACA CARRETA / EIXO',
    'MOTORISTA', 'TRANSPORTADORA', 'PACOTES EXPEDIDOS', 'LACRE']
};
const CATEGORIAS = {PATIO_VEICULO: ['FLUXO', 'STATUS PATIO', 'TIPO_VEICULO'], CONTROLE_DOCAS: ['STATUS_DOCA'], PROGRAMACAO_EXPEDICAO: ['TIPO_EXPEDICAO', 'STATUS']};
const DATAS = ['CHECK_IN', 'CHECK_OUT', 'HORA_DOCAGEM', 'FIM_DESCARGA', 'FIM_OPERACAO', 'SAIDA_PROGRAMADA'];
/** Formato de um valor do Feishu, sem mostrar o conteúdo. */
function formato(v) {
  if (typeof v === 'number') return v > 1e11 ? 'data/número' : 'número';
  if (typeof v === 'string') return 'texto';
  if (Array.isArray(v)) {
    const x = v[0];
    if (x && typeof x === 'object') return x.text !== undefined ? 'texto' : x.name !== undefined ? 'pessoa/opção' : 'lista';
    return 'lista de opções';
  }
  if (v && typeof v === 'object') return v.link_record_ids || v.record_ids ? 'vínculo' : v.value !== undefined ? 'fórmula/consulta' : 'objeto';
  return typeof v;
}

const semAcento = v => String(v || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[^A-Za-z0-9]+/, '').toUpperCase();

/** opcoes: {pastaDados, baseUrl (só para testes; padrão https://open.feishu.cn)} */
function criarFeishu(opcoes) {
  const base = String(opcoes.baseUrl || 'https://open.feishu.cn').replace(/\/+$/, '');
  let token = null;        // {valor, ate, app}
  let pedindoToken = null; // várias consultas ao mesmo tempo esperam o mesmo token

  async function pedir(url, init) {
    let r;
    try { r = await fetch(url, Object.assign({signal: AbortSignal.timeout(60000)}, init)); }
    catch (e) {
      const causa = e && e.name === 'TimeoutError' ? 'o Feishu demorou mais de 1 min' : (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e;
      throw new Error('Sem acesso ao Feishu (' + causa + '). Confira a internet do servidor.');
    }
    const corpo = await r.text();
    let j;
    try { j = JSON.parse(corpo); } catch (e) { throw new Error('Resposta inválida do Feishu (HTTP ' + r.status + ').'); }
    return {status: r.status, j: j || {}};
  }

  async function novoToken() {
    const p = credenciais.ler(opcoes.pastaDados);
    if (!p.FEISHU_APP_ID || !p.FEISHU_APP_SECRET) throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET não configurados.');
    const {status, j} = await pedir(base + '/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: {'Content-Type': 'application/json; charset=utf-8'},
      body: JSON.stringify({app_id: p.FEISHU_APP_ID, app_secret: p.FEISHU_APP_SECRET})
    });
    if (status !== 200 || j.code !== 0 || !j.tenant_access_token) throw new Error('Falha na autenticação com Feishu: ' + (j.msg || status));
    const seg = Math.min(6900, Math.max(60, (Number(j.expire) || 7200) - 180));
    token = {valor: j.tenant_access_token, ate: Date.now() + seg * 1000, app: p.FEISHU_APP_ID + '|' + p.FEISHU_APP_SECRET.length + '|' + p.FEISHU_APP_SECRET.slice(-4)};
    return token.valor;
  }
  /** Token guardado (o mesmo para as 3 tabelas). Trocou o App ID/Secret em configurar? Pega outro na hora. */
  function tokenAtual(forcar) {
    const p = credenciais.ler(opcoes.pastaDados);
    const app = String(p.FEISHU_APP_ID || '') + '|' + String(p.FEISHU_APP_SECRET || '').length + '|' + String(p.FEISHU_APP_SECRET || '').slice(-4);
    if (!forcar && token && token.app === app && token.ate > Date.now()) return Promise.resolve(token.valor);
    if (!pedindoToken) pedindoToken = novoToken().finally(() => { pedindoToken = null; });
    return pedindoToken;
  }

  /** Todos os registros de uma tabela (páginas de 100), ou só a 1ª página (umaPagina). */
  async function registros(chaveTabela, umaPagina) {
    const p = credenciais.ler(opcoes.pastaDados);
    const appToken = p.FEISHU_APP_TOKEN, tableId = p[chaveTabela];
    if (!appToken || !tableId) throw new Error('Dados do Feishu incompletos: ' + (!appToken ? 'FEISHU_APP_TOKEN' : chaveTabela));
    const lista = [];
    let pageToken = '', deNovo = false;
    for (;;) {
      let url = base + '/open-apis/bitable/v1/apps/' + encodeURIComponent(appToken) + '/tables/' + encodeURIComponent(tableId) + '/records?page_size=100';
      if (pageToken) url += '&page_token=' + encodeURIComponent(pageToken);
      const {status, j} = await pedir(url, {headers: {Authorization: 'Bearer ' + await tokenAtual()}});
      if (TOKEN_RECUSADO.indexOf(j.code) >= 0 && !deNovo) { deNovo = true; token = null; continue; }
      if (status !== 200 || j.code !== 0) throw new Error('Erro ao consultar Feishu: ' + (j.msg || status));
      const d = j.data || {};
      lista.push(...(d.items || []));
      if (umaPagina) return {items: lista, maisPaginas: !!d.has_more};
      if (!d.has_more) return {items: lista, maisPaginas: false};
      if (!d.page_token) throw new Error('Paginação incompleta no Feishu.');
      pageToken = d.page_token;
      deNovo = false;
    }
  }

  async function buscarVeiculosPatio() {
    const {items} = await registros('FEISHU_TABLE_PATIO');
    return items.map(item => {
      const f = item.fields || {}, fim = fimDescarga(f);
      return {
        id: item.record_id,
        placa: texto(f['PLACA']),
        tipoVeiculo: texto(f['TIPO_VEICULO']),
        motorista: texto(f['MOTORISTA']),
        transportadora: texto(f['TRANSPORTADORA']),
        fluxo: texto(f['FLUXO']),
        status: texto(f['STATUS PATIO']),
        doca: texto(f['DOCA']) || texto(f['CONTROLE_DOCAS']),
        docaIds: idsVinculados(f['CONTROLE_DOCAS']),
        posicaoFIFO: numero(f['POSIÇÃO FIFO'] ?? f['POSICAO FIFO']) || null,
        checkin: instante(f['CHECK_IN']),
        checkout: instante(f['CHECK_OUT']),
        fimDescarga: fim.valor,
        campoFimDescarga: fim.campo,
        horaDocagem: instante(f['HORA_DOCAGEM']) ?? instante(f['ENTRADA_DOCA']),
        inicioOperacao: instante(f['INICIO_OPERACAO']),
        fimOperacao: instante(f['FIM_OPERACAO']),
        saidaPatio: instante(f['SAIDA_PATIO']),
        prioridade: texto(f['PRIORIDADE_PATIO']),
        possuiId: texto(f['POSSUI_ID']),
        idViagem: texto(f['ID_VIAGEM']),
        destino: texto(f['DESTINO']),
        tempoEspera: texto(f['TEMPO_ESPERA']),
        tempoOperacao: texto(f['TEMPO_OPERACAO']),
        tempoTotalPatio: texto(f['TEMPO_TOTAL_PATIO']),
        registradoPor: texto(f['REGISTRADO_POR']),
        atualizadoPor: texto(f['ATUALIZADO_POR'])
      };
    });
  }

  async function buscarDocasFeishu() {
    const {items} = await registros('FEISHU_TABLE_DOCAS');
    const docas = items.map(item => {
      const f = item.fields || {};
      return {id: item.record_id, doca: texto(f['DOCA']), status: texto(f['STATUS_DOCA']), veiculo: texto(f['VEICULO_VINCULADO']),
        veiculoIds: idsVinculados(f['VEICULO_VINCULADO'])};
    });
    const livres = docas.filter(d => semAcento(d.status) === 'LIVRE').length;
    const ocupadas = docas.filter(d => semAcento(d.status) === 'OCUPADA').length;
    return {total: docas.length, livres, ocupadas, naoClassificadas: docas.length - livres - ocupadas, docas};
  }

  async function buscarProgramacaoExpedicao() {
    const {items} = await registros('FEISHU_TABLE_EXPEDICAO');
    return items.map(item => {
      const f = item.fields || {};
      return {
        id: item.record_id,
        viagem: texto(f['ID_VIAGEM']),
        tipo: texto(f['TIPO_EXPEDICAO']),
        destino: texto(f['DESTINO']),
        status: texto(f['STATUS']),
        saida: instante(f['SAIDA_PROGRAMADA']),
        placaCavalo: texto(f['PLACA CAVALO']),
        placaCarreta: texto(f['PLACA CARRETA / EIXO']),
        motorista: texto(f['MOTORISTA']),
        transportadora: texto(f['TRANSPORTADORA']),
        pacotes: numero(f['PACOTES EXPEDIDOS']) || 0,
        lacre: texto(f['LACRE'])
      };
    });
  }

  /** Conexão + 1ª página de cada tabela (nomes dos campos, nunca os valores). Devolve true se tudo deu certo. */
  async function testar(log) {
    await tokenAtual(true);
    log('CONEXÃO COM FEISHU REALIZADA COM SUCESSO!');
    log('Token recebido e validado.');
    let ok = true;
    for (const [nome, chave] of TABELAS) {
      log('-----------------------------');
      log('TABELA: ' + nome);
      try {
        const r = await registros(chave, true);
        log('CONEXÃO: OK');
        log('REGISTROS NA PRIMEIRA PÁGINA: ' + r.items.length);
        log('EXISTEM MAIS PÁGINAS: ' + r.maisPaginas);
        if (r.items.length) log('CAMPOS: ' + Object.keys(r.items[0].fields || {}).join(', '));
      } catch (e) { ok = false; log('ERRO ' + nome + ': ' + ((e && e.message) || e)); }
    }
    return ok;
  }

  /**
   * Conferência dos campos que o painel usa, nas 3 tabelas (todas as páginas): se o campo existe, em quantos registros
   * tem valor e o formato. Datas: se dá para ler como data. Categorias (fluxo, status, tipos): os valores e quantos.
   * Nunca mostra placas, motoristas nem outros dados das pessoas.
   */
  async function diagnosticar(log) {
    const fmt = n => n.toLocaleString('pt-BR');
    for (const [nome, chave] of TABELAS) {
      const {items} = await registros(chave);
      log('=============================');
      log('TABELA ' + nome + ': ' + fmt(items.length) + ' registros');
      const existentes = new Set(items.flatMap(r => Object.keys(r.fields || {})));
      for (const campo of USADOS[nome]) {
        if (!existentes.has(campo)) { log('  ' + campo + ': NÃO EXISTE na tabela'); continue; }
        const valores = items.map(r => (r.fields || {})[campo]).filter(v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
        let linha = '  ' + campo + ': ' + fmt(valores.length) + ' com valor · ' + (valores.length ? formato(valores[0]) : '-');
        if (DATAS.indexOf(campo) >= 0 && valores.length) {
          const lidas = valores.filter(v => instante(v) !== null).length;
          linha += lidas === valores.length ? ' · data OK' : ' · ' + fmt(valores.length - lidas) + ' NÃO dá para ler como data';
        }
        log(linha);
      }
      for (const campo of CATEGORIAS[nome] || []) {
        if (!existentes.has(campo)) continue;
        const cont = {};
        items.forEach(r => { const t = texto((r.fields || {})[campo]) || '(vazio)'; cont[t] = (cont[t] || 0) + 1; });
        log('  Valores de ' + campo + ': ' + Object.keys(cont).sort((a, b) => cont[b] - cont[a] || a.localeCompare(b, 'pt-BR')).slice(0, 15).map(k => k + ' (' + fmt(cont[k]) + ')').join(' · '));
      }
      if (nome === 'PATIO_VEICULO') {
        log('  Registros com horário de conclusão: ' + items.filter(r => fimDescarga(r.fields || {}).valor !== null).length);
        log('  Outros campos da tabela: ' + [...existentes].filter(c => USADOS[nome].indexOf(c) < 0).sort().join(' | '));
      }
    }
    log('Nenhum registro foi alterado.');
  }

  return {buscarVeiculosPatio, buscarDocasFeishu, buscarProgramacaoExpedicao, testar, diagnosticar};
}

module.exports = {criarFeishu, texto, idsVinculados, fimDescarga, instante, numero};
