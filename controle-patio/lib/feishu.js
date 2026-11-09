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

/** Fim da descarga: só um campo que diga isso explicitamente. CHECK_OUT e HORA_DOCAGEM não contam. */
const CAMPOS_FIM = ['FIM_DESCARGA', 'FIM DESCARGA', 'DATA_FIM_DESCARGA', 'HORA_FIM_DESCARGA', 'HORARIO_FIM_DESCARGA',
  'FIM_DESCARREGAMENTO', 'DESCARGA_FINALIZADA_EM', 'CONCLUSAO_DESCARGA', 'CONCLUSÃO DESCARGA',
  'FIM_OPERACAO', 'FIM OPERAÇÃO', 'HORA_FIM_OPERACAO', 'DATA_FIM_OPERACAO'];
function fimDescarga(f) {
  for (const campo of CAMPOS_FIM) {
    if (Object.prototype.hasOwnProperty.call(f, campo) && f[campo] !== null && f[campo] !== undefined && f[campo] !== '') return {valor: f[campo], campo};
  }
  return {valor: null, campo: ''};
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
        posicaoFIFO: Number(f['POSIÇÃO FIFO'] ?? f['POSICAO FIFO']) || null,
        checkin: f['CHECK_IN'] || null,
        checkout: f['CHECK_OUT'] || null,
        fimDescarga: fim.valor,
        campoFimDescarga: fim.campo,
        horaDocagem: f['HORA_DOCAGEM'] || f['ENTRADA_DOCA'] || null,
        inicioOperacao: f['INICIO_OPERACAO'] || null,
        fimOperacao: f['FIM_OPERACAO'] || null,
        saidaPatio: f['SAIDA_PATIO'] || null,
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
        saida: f['SAIDA_PROGRAMADA'] || null,
        placaCavalo: texto(f['PLACA CAVALO']),
        placaCarreta: texto(f['PLACA CARRETA / EIXO']),
        motorista: texto(f['MOTORISTA']),
        transportadora: texto(f['TRANSPORTADORA']),
        pacotes: Number(f['PACOTES EXPEDIDOS']) || 0,
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

  /** Campos e status da tabela do pátio (todas as páginas), para conferir antes de contar por turno. */
  async function diagnosticar(log) {
    const {items} = await registros('FEISHU_TABLE_PATIO');
    const campos = [...new Set(items.flatMap(r => Object.keys(r.fields || {})))].sort();
    const status = {};
    let comConclusao = 0;
    items.forEach(r => {
      const f = r.fields || {}, s = texto(f['STATUS PATIO']) || '(vazio)';
      status[s] = (status[s] || 0) + 1;
      if (fimDescarga(f).valor !== null) comConclusao++;
    });
    log('Registros consultados: ' + items.length);
    log('Status PATIO: ' + JSON.stringify(status));
    log('Registros com horário de conclusão: ' + comConclusao);
    log('Campos disponíveis: ' + campos.join(' | '));
    log('Campo TIPO_VEICULO presente: ' + campos.includes('TIPO_VEICULO'));
    log('Nenhum registro foi alterado.');
  }

  return {buscarVeiculosPatio, buscarDocasFeishu, buscarProgramacaoExpedicao, testar, diagnosticar};
}

module.exports = {criarFeishu, texto, idsVinculados, fimDescarga};
