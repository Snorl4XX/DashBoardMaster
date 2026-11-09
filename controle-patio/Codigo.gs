function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('Index')
    .setTitle('SP GRU | Controle de Pátio')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function testarConexaoFeishu() {
  const propriedades = PropertiesService.getScriptProperties();

  const appId = propriedades.getProperty('FEISHU_APP_ID');
  const appSecret = propriedades.getProperty('FEISHU_APP_SECRET');

  if (!appId || !appSecret) {
    throw new Error(
      'App ID ou App Secret não configurados nas propriedades.'
    );
  }

  const url =
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';

  const resposta = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      app_id: appId,
      app_secret: appSecret
    }),
    muteHttpExceptions: true
  });

  const dados = JSON.parse(resposta.getContentText());

  if (resposta.getResponseCode() !== 200 || dados.code !== 0) {
    console.error('Falha na autenticação: ' + JSON.stringify({
      http: resposta.getResponseCode(),
      code: dados.code,
      msg: dados.msg
    }));
    throw new Error('Não foi possível autenticar no Feishu.');
  }

  console.log('CONEXÃO COM FEISHU REALIZADA COM SUCESSO!');
  console.log('Token recebido e validado.');
}

function testarLeituraPatio() {
  const props = PropertiesService.getScriptProperties();

  const appId = props.getProperty('FEISHU_APP_ID');
  const appSecret = props.getProperty('FEISHU_APP_SECRET');
  const appToken = props.getProperty('FEISHU_APP_TOKEN');
  const tableId = props.getProperty('FEISHU_TABLE_PATIO');

  if (!appId || !appSecret || !appToken || !tableId) {
    throw new Error('Configuração do Feishu incompleta.');
  }

  // Autenticação
  const authResponse = UrlFetchApp.fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        app_id: appId,
        app_secret: appSecret
      }),
      muteHttpExceptions: true
    }
  );

  const auth = JSON.parse(authResponse.getContentText());

  if (authResponse.getResponseCode() !== 200 ||
      auth.code !== 0 ||
      !auth.tenant_access_token) {
    throw new Error(
      'Falha na autenticação: ' + (auth.msg || 'Erro HTTP')
    );
  }

  // Consulta somente leitura: até 100 registros
  const url =
    'https://open.feishu.cn/open-apis/bitable/v1/apps/' +
    encodeURIComponent(appToken) +
    '/tables/' +
    encodeURIComponent(tableId) +
    '/records?page_size=100';

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + auth.tenant_access_token
    },
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());

  if (response.getResponseCode() !== 200 ||
      result.code !== 0) {
    throw new Error(
      'Erro ao consultar PATIO_VEICULO: ' +
      (result.msg || 'Erro HTTP ' + response.getResponseCode())
    );
  }

  const registros = result.data?.items || [];

  console.log('CONEXÃO COM PATIO_VEICULO: OK');
  console.log('Registros retornados: ' + registros.length);
  console.log(
    'Há mais páginas: ' +
    Boolean(result.data?.has_more)
  );

  if (registros.length > 0) {
    console.log(
      'Campos encontrados: ' +
      Object.keys(registros[0].fields || {}).join(', ')
    );
  }
}

/** Consulta de pátio: SOMENTE LEITURA. Não altera nenhum registro do Feishu. */
function buscarVeiculosPatio() {
  const registros = lerRegistrosFeishuPatio_('FEISHU_TABLE_PATIO');
  return registros.map(item => {
    const f = item.fields || {};
    return {
      id: item.record_id,
      placa: textoFeishuPatio_(f['PLACA']),
      tipoVeiculo: textoFeishuPatio_(f['TIPO_VEICULO']),
      motorista: textoFeishuPatio_(f['MOTORISTA']),
      transportadora: textoFeishuPatio_(f['TRANSPORTADORA']),
      fluxo: textoFeishuPatio_(f['FLUXO']),
      status: textoFeishuPatio_(f['STATUS PATIO']),
      doca: textoFeishuPatio_(f['DOCA']) || textoFeishuPatio_(f['CONTROLE_DOCAS']),
      docaIds: idsVinculadosFeishuPatio_(f['CONTROLE_DOCAS']),
      posicaoFIFO: Number(f['POSIÇÃO FIFO'] ?? f['POSICAO FIFO']) || null,
      checkin: f['CHECK_IN'] || null,
      checkout: f['CHECK_OUT'] || null,
      // Só considerar um campo que represente explicitamente o FIM da descarga.
      // CHECK_OUT e HORA_DOCAGEM NÃO equivalem à conclusão da descarga.
      fimDescarga: obterFimDescargaPatio_(f).valor,
      campoFimDescarga: obterFimDescargaPatio_(f).campo,
      horaDocagem: f['HORA_DOCAGEM'] || f['ENTRADA_DOCA'] || null,
      inicioOperacao: f['INICIO_OPERACAO'] || null,
      fimOperacao: f['FIM_OPERACAO'] || null,
      saidaPatio: f['SAIDA_PATIO'] || null,
      prioridade: textoFeishuPatio_(f['PRIORIDADE_PATIO']),
      possuiId: textoFeishuPatio_(f['POSSUI_ID']),
      idViagem: textoFeishuPatio_(f['ID_VIAGEM']),
      destino: textoFeishuPatio_(f['DESTINO']),
      tempoEspera: textoFeishuPatio_(f['TEMPO_ESPERA']),
      tempoOperacao: textoFeishuPatio_(f['TEMPO_OPERACAO']),
      tempoTotalPatio: textoFeishuPatio_(f['TEMPO_TOTAL_PATIO']),
      registradoPor: textoFeishuPatio_(f['REGISTRADO_POR']),
      atualizadoPor: textoFeishuPatio_(f['ATUALIZADO_POR'])
    };
  });
}

/** Lê todas as páginas. Credenciais ficam exclusivamente no Apps Script. */
function lerRegistrosFeishuPatio_(chaveTabela) {
  const p = PropertiesService.getScriptProperties();
  const appToken = p.getProperty('FEISHU_APP_TOKEN');
  const tableId = p.getProperty(chaveTabela);
  if (!appToken || !tableId) throw new Error('Propriedades Feishu incompletas: ' + chaveTabela);
  const token = tokenFeishuPatio_();
  let pageToken = '';
  const registros = [];
  do {
    let url = 'https://open.feishu.cn/open-apis/bitable/v1/apps/' +
      encodeURIComponent(appToken) + '/tables/' + encodeURIComponent(tableId) +
      '/records?page_size=100';
    if (pageToken) url += '&page_token=' + encodeURIComponent(pageToken);
    const response = UrlFetchApp.fetch(url, {
      method: 'get', headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    let result;
    try { result = JSON.parse(response.getContentText()); }
    catch(e) { throw new Error('Resposta inválida do Feishu.'); }
    if (response.getResponseCode() !== 200 || result.code !== 0) {
      throw new Error('Erro ao consultar Feishu: ' + (result.msg || response.getResponseCode()));
    }
    const data = result.data || {};
    registros.push.apply(registros, data.items || []);
    if (data.has_more && !data.page_token) throw new Error('Paginação incompleta no Feishu.');
    pageToken = data.has_more ? data.page_token : '';
  } while (pageToken);
  return registros;
}

function tokenFeishuPatio_() {
  const cache = CacheService.getScriptCache();
  const saved = cache.get('feishu_patio_tenant_token');
  if (saved) return saved;
  const p = PropertiesService.getScriptProperties();
  const appId = p.getProperty('FEISHU_APP_ID');
  const appSecret = p.getProperty('FEISHU_APP_SECRET');
  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET não configurados.');
  const response = UrlFetchApp.fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({app_id:appId, app_secret:appSecret}),
    muteHttpExceptions: true
  });
  const result = JSON.parse(response.getContentText());
  if (response.getResponseCode() !== 200 || result.code !== 0 || !result.tenant_access_token) {
    throw new Error('Falha na autenticação com Feishu: ' + (result.msg || response.getResponseCode()));
  }
  cache.put('feishu_patio_tenant_token', result.tenant_access_token,
    Math.min(6900, Math.max(60, (Number(result.expire) || 7200) - 180)));
  return result.tenant_access_token;
}

/** IDs de campos vinculados do Bitable, sem expor os IDs como nomes. */
function idsVinculadosFeishuPatio_(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor.flatMap(idsVinculadosFeishuPatio_);
  if (typeof valor === 'object') {
    if (valor.link_record_ids) return idsVinculadosFeishuPatio_(valor.link_record_ids);
    if (valor.record_ids) return idsVinculadosFeishuPatio_(valor.record_ids);
    if (valor.record_id) return [String(valor.record_id)];
    if (valor.id && /^rec/i.test(String(valor.id))) return [String(valor.id)];
    return [];
  }
  return /^rec/i.test(String(valor)) ? [String(valor)] : [];
}

/** Não usa check-out como prova de descarga. */
function obterFimDescargaPatio_(f) {
  const candidatos = [
    'FIM_DESCARGA', 'FIM DESCARGA', 'DATA_FIM_DESCARGA',
    'HORA_FIM_DESCARGA', 'HORARIO_FIM_DESCARGA',
    'FIM_DESCARREGAMENTO', 'DESCARGA_FINALIZADA_EM',
    'CONCLUSAO_DESCARGA', 'CONCLUSÃO DESCARGA',
    'FIM_OPERACAO', 'FIM OPERAÇÃO', 'HORA_FIM_OPERACAO',
    'DATA_FIM_OPERACAO'
  ];
  for (const campo of candidatos) {
    if (Object.prototype.hasOwnProperty.call(f,campo) && f[campo] != null && f[campo] !== '') {
      return {valor:f[campo],campo};
    }
  }
  return {valor:null,campo:''};
}

/** Diagnóstico SOMENTE LEITURA: verifica campos reais antes de usar contagem por turno. */
function diagnosticarDescargasPatio_SCGRU() {
  const registros = lerRegistrosFeishuPatio_('FEISHU_TABLE_PATIO');
  const campos = [...new Set(registros.flatMap(r => Object.keys(r.fields || {})))].sort();
  const status = {};
  let comConclusao = 0;
  registros.forEach(r => {
    const f = r.fields || {};
    const s = textoFeishuPatio_(f['STATUS PATIO']) || '(vazio)';
    status[s] = (status[s] || 0) + 1;
    if (obterFimDescargaPatio_(f).valor != null) comConclusao++;
  });
  Logger.log('Registros consultados: ' + registros.length);
  Logger.log('Status PATIO: ' + JSON.stringify(status));
  Logger.log('Registros com horário de conclusão: ' + comConclusao);
  Logger.log('Campos disponíveis: ' + campos.join(' | '));
  Logger.log('Campo TIPO_VEICULO presente: ' + campos.includes('TIPO_VEICULO'));
  console.log('Nenhum registro foi alterado.');
}

function textoFeishuPatio_(valor) {
  if (valor == null) return '';
  if (Array.isArray(valor)) return valor.map(textoFeishuPatio_).filter(Boolean).join(', ');
  if (typeof valor === 'object') {
    if (valor.text != null) return textoFeishuPatio_(valor.text);
    if (valor.name != null) return textoFeishuPatio_(valor.name);
    if (valor.label != null) return textoFeishuPatio_(valor.label);
    if (valor.value != null) return textoFeishuPatio_(valor.value);
    if (valor.link_record_ids) return ''; // Não mostrar IDs internos como nomes de docas
    return '';
  }
  return String(valor);
}

function testarTabelasFeishu() {
  const props = PropertiesService.getScriptProperties();

  const appId = props.getProperty('FEISHU_APP_ID');
  const appSecret = props.getProperty('FEISHU_APP_SECRET');
  const appToken = props.getProperty('FEISHU_APP_TOKEN');

  if (!appId || !appSecret || !appToken) {
    throw new Error('Configuração do Feishu incompleta.');
  }

  // Autenticação
  const authResponse = UrlFetchApp.fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        app_id: appId,
        app_secret: appSecret
      }),
      muteHttpExceptions: true
    }
  );

  const auth = JSON.parse(authResponse.getContentText());

  if (authResponse.getResponseCode() !== 200 ||
      auth.code !== 0 ||
      !auth.tenant_access_token) {
    throw new Error(
      'Erro na autenticação: ' + (auth.msg || 'HTTP')
    );
  }

  const tabelas = [
    {
      nome: 'CONTROLE_DOCAS',
      id: props.getProperty('FEISHU_TABLE_DOCAS')
    },
    {
      nome: 'PROGRAMACAO_EXPEDICAO',
      id: props.getProperty('FEISHU_TABLE_EXPEDICAO')
    }
  ];

  tabelas.forEach(tabela => {
    if (!tabela.id) {
      console.log(
        'ERRO: ID não configurado para ' + tabela.nome
      );
      return;
    }

    const url =
      'https://open.feishu.cn/open-apis/bitable/v1/apps/' +
      encodeURIComponent(appToken) +
      '/tables/' +
      encodeURIComponent(tabela.id) +
      '/records?page_size=100';

    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + auth.tenant_access_token
      },
      muteHttpExceptions: true
    });

    const resultado = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 ||
        resultado.code !== 0) {
      console.log(
        'ERRO ' + tabela.nome + ': ' +
        (resultado.msg || 'HTTP ' + response.getResponseCode())
      );
      return;
    }

    const registros = resultado.data?.items || [];

    console.log('-----------------------------');
    console.log('TABELA: ' + tabela.nome);
    console.log('CONEXÃO: OK');
    console.log('REGISTROS NA PRIMEIRA PÁGINA: ' + registros.length);
    console.log(
      'EXISTEM MAIS PÁGINAS: ' +
      Boolean(resultado.data?.has_more)
    );

    if (registros.length > 0) {
      console.log(
        'CAMPOS: ' +
        Object.keys(registros[0].fields || {}).join(', ')
      );
    }
  });
}

function buscarDocasFeishu() {
  const registros = lerRegistrosFeishuPatio_('FEISHU_TABLE_DOCAS');
  const docas = registros.map(item => {
    const f = item.fields || {};
    return {
      id: item.record_id,
      doca: textoFeishuPatio_(f['DOCA']),
      status: textoFeishuPatio_(f['STATUS_DOCA']),
      veiculo: textoFeishuPatio_(f['VEICULO_VINCULADO']),
      veiculoIds: idsVinculadosFeishuPatio_(f['VEICULO_VINCULADO'])
    };
  });
  const norm = v => String(v || '').trim().normalize('NFD')
    .replace(/[̀-ͯ]/g,'').replace(/^[^A-Za-z0-9]+/,'').toUpperCase();
  const livres = docas.filter(d => norm(d.status) === 'LIVRE').length;
  const ocupadas = docas.filter(d => norm(d.status) === 'OCUPADA').length;
  return {total:docas.length, livres:livres, ocupadas:ocupadas,
    naoClassificadas:docas.length-livres-ocupadas, docas:docas};
}

function buscarProgramacaoExpedicao() {
  const registros = lerRegistrosFeishuPatio_('FEISHU_TABLE_EXPEDICAO');
  return registros.map(item => {
    const f = item.fields || {};
    return {
      id: item.record_id,
      viagem: textoFeishuPatio_(f['ID_VIAGEM']),
      tipo: textoFeishuPatio_(f['TIPO_EXPEDICAO']),
      destino: textoFeishuPatio_(f['DESTINO']),
      status: textoFeishuPatio_(f['STATUS']),
      saida: f['SAIDA_PROGRAMADA'] || null,
      placaCavalo: textoFeishuPatio_(f['PLACA CAVALO']),
      placaCarreta: textoFeishuPatio_(f['PLACA CARRETA / EIXO']),
      motorista: textoFeishuPatio_(f['MOTORISTA']),
      transportadora: textoFeishuPatio_(f['TRANSPORTADORA']),
      pacotes: Number(f['PACOTES EXPEDIDOS']) || 0,
      lacre: textoFeishuPatio_(f['LACRE'])
    };
  });
}
