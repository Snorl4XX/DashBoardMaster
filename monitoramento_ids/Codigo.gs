/**
 * JMS / J&T Express — Google Planilhas + Apps Script — v6 (12/11/2026)
 *
 * INSTALAÇÃO: apague o código antigo de Código.gs, cole este arquivo,
 * salve, execute instalarAutomacaoJMS UMA vez pelo editor e aceite
 * TODAS as permissões. Depois use o menu "JMS | Automação".
 *
 * O QUE MUDOU NA v6
 * - Atualização automática a cada 15 minutos. A cada execução o script
 *   confere o agendamento: cria o que faltar, troca o antigo de 10 min e
 *   apaga acionadores de códigos velhos que chamam funções que não existem.
 * - Parava de atualizar: com token recusado, ficava pausado para sempre.
 *   Agora tenta de novo sozinho a cada 60 min (e volta ao normal se der certo).
 * - Página de erro do JMS (502/503, instabilidade) era tratada como token
 *   recusado e pausava tudo. Agora só pula aquela rodada.
 * - B14 mostra a última execução automática, a versão do código e o intervalo.
 *
 * O QUE MUDOU NA v5
 * - IDs faltando: a paginação confiava no "pages" do JMS. Agora pede páginas
 *   (100 linhas, o máximo) até juntar o TOTAL que o JMS informa, mesmo se ele
 *   devolver só 20 por página. Se faltar, faz uma segunda passada. A aba
 *   CONTROLE mostra "JMS informou X, vieram Y".
 * - Tempo de lacre no lugar do deslacre: a detecção da v4 escolhia o campo
 *   com mais horários preenchidos (o lacre). Agora vence o campo com o
 *   horário MAIS TARDE (o deslacre vem depois do lacre), e B7 é reavaliado
 *   a cada consulta enquanto estiver em modo automático.
 * - Menu "Calibrar campo de deslacre": você informa uma tarefa e o horário que
 *   aparece no JMS, e o script fixa o campo exato (B7 ou B8).
 *
 * O QUE MUDOU NA v4
 * - A API da troncal não usa o nome unlockTime. Quando o campo configurado
 *   não existe na resposta, o script procura sozinho o campo de deslacre
 *   (nomes com unseal/unlock/deseal etc. que tragam data e hora), grava o
 *   nome encontrado em B7 e preenche os horários.
 * - Se não encontrar, a aba CONTROLE mostra todos os horários de uma tarefa
 *   para comparar com a tela do JMS.
 *
 * O QUE MUDOU NA v3
 * - Horário correto: DESLACRE. Secundária usa unlockTime ("Horário de
 *   deslacração do veículo"); antes usava unloadStartTime, que é o
 *   "Horário de chegada para descarregamento". Troncal também usa unlockTime.
 * - Consulta SÓ o dia atual (00:00:00 a 23:59:59), sem o dia anterior.
 * - Histórico: os dias anteriores ficam salvos; o dia atual é atualizado
 *   no bloco de baixo e, quando o dia vira, a nova data entra embaixo.
 * - Planilhas da versão anterior são ajustadas sozinhas (os dados com o
 *   horário errado são copiados para uma aba de backup antes de limpar).
 *
 * O QUE MUDOU NA v2
 * - O erro "sem permissão" agora diz QUEM negou: o Google (permissão do
 *   script) ou o JMS (token/cabeçalho), com o código e a mensagem do JMS.
 * - Erros de permissão do Google não são mais disfarçados de "falha de rede".
 * - Token recusado pausa a atualização automática até entrar um token novo
 *   (evita bater no JMS a cada 10 min com token inválido).
 * - Menu "Testar conexão" grava um diagnóstico completo na aba de configuração.
 * - Token pode ser inserido por janela com campo de senha (não fica na célula).
 * - Token colado com "authToken:", aspas ou "Bearer" é limpo automaticamente.
 * - Método da API primária configurável (B9) e cabeçalhos extras (A18:B27).
 *
 * USO CORPORATIVO: utilize apenas com permissão do administrador do JMS.
 */

const JMS_CONFIG = Object.freeze({
  HOST: 'https://gw.jtjms-br.com',
  ABA_CONFIG: 'CONFIGURAÇÃO JMS',
  ABA_PRIMARIA: 'PRIMARIA',
  ABA_SECUNDARIA: 'SECUNDARIA',
  ABA_CONTROLE: 'CONTROLE',
  DESTINO: '30001',
  PAIS: '1',
  STATUS_CONCLUIDO: 4,
  FUSO: 'America/Sao_Paulo',
  PAGINA_TAMANHO: 100,
  MAX_PAGINAS: 100,
  INTERVALO_MIN: 15, // o Apps Script aceita 1, 5, 10, 15 ou 30
  PAUSA_RETENTATIVA_MIN: 60, // token recusado: tenta de novo a cada 60 min
  VERSAO: 'v6',
  ENDPOINTS: {
    primaria: '/transportation/tmsShipment/page',
    secundaria: '/transportation/tmsBranchTrackingDetail/page'
  },
  EXTRAS_LINHA: 18,
  EXTRAS_QTD: 10,
  DIAG_LINHA: 30,
  DIAG_QTD: 14
});

const CEL = Object.freeze({
  TOKEN: 'B3',
  CABECALHO: 'B4',
  PREFIXO: 'B5',
  METODO_SEC: 'B6',
  CAMPO_PRIM: 'B7',
  CAMPO_SEC: 'B8',
  METODO_PRIM: 'B9',
  STATUS: 'B10',
  ULT_TOKEN: 'B11',
  ULT_SYNC: 'B12',
  ULT_ERRO: 'B13',
  ULT_AUTO: 'B14'
});

const CORES = Object.freeze({
  VERMELHO_JT: '#D71920',
  ok: '#D9EAD3',
  erro: '#F4CCCC',
  aguardando: '#FFF2CC'
});

// Colunas das abas de dados. A coluna C tem o mesmo nome da coluna do JMS.
const TITULOS = Object.freeze({
  primaria: ['Data (partida)', 'Número da tarefa', 'Tempo de deslacre',
    'Situação', 'Destino', 'Atualizado em'],
  secundaria: ['Data (partida)', 'Número da tarefa', 'Horário de deslacração do veículo',
    'Situação', 'Destino', 'Atualizado em']
});

// "Horário de deslacração do veículo" no JSON da secundária (conferido no PDF:
// unlockTime 05:17:44 = valor da tela; unloadStartTime 05:19:52 = chegada p/ descarregamento).
const CAMPO_DESLACRE_PADRAO = 'unlockTime';

// Cabeçalhos que não devem ser copiados do navegador.
const CABECALHOS_BLOQUEADOS = [
  'host', 'content-length', 'connection', 'accept-encoding', 'cookie',
  'user-agent', 'origin', 'referer', 'content-type'
];

let cacheHeaders_ = null; // vale só durante uma execução

/* ------------------------------------------------------------------ */
/* MENU E INSTALAÇÃO                                                   */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('JMS | Automação')
    .addItem('Inserir / trocar token', 'abrirDialogoToken')
    .addItem('Atualizar agora', 'atualizarJMS')
    .addItem('Testar conexão (diagnóstico)', 'testarConexaoJMS')
    .addItem('Ver campos da API primária', 'diagnosticarCamposPrimaria')
    .addItem('Calibrar campo de deslacre', 'calibrarCampoDeslacre')
    .addSeparator()
    .addItem('Instalar / reparar acionadores', 'instalarAutomacaoJMS')
    .addToUi();
}

/** Execute uma vez pelo editor. Cria layout, acionadores e pede as permissões. */
function instalarAutomacaoJMS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(JMS_CONFIG.FUSO);
  prepararAbasJMS_(ss);

  PropertiesService.getScriptProperties().setProperty('JMS_PLANILHA_ID', ss.getId());
  const removidos = garantirAcionadores_(ss, true);

  const temToken = !!PropertiesService.getScriptProperties().getProperty('JMS_TOKEN');
  definirEstado_(temToken ? 'INSTALADO - TOKEN JÁ SALVO' : 'INSTALADO - AGUARDANDO TOKEN',
    'Atualização automática a cada ' + JMS_CONFIG.INTERVALO_MIN + ' min instalada.' +
    (removidos.length ? ' Removidos acionadores antigos sem função: ' + removidos.join(', ') + '.' : '') +
    ' Use o menu JMS | Automação > Testar conexão para conferir.', ss, 'aguardando');
  ss.toast('Instalado. Atualização automática a cada ' + JMS_CONFIG.INTERVALO_MIN + ' min.', 'JMS', 8);
}

/**
 * Confere os acionadores DESTA conta: um de tempo (atualizarJMS, a cada 15 min)
 * e um de edição (aoEditarTokenJMS). Cria o que faltar, recria se o intervalo
 * mudou e apaga acionadores que chamam funções que não existem mais (sobras de
 * códigos antigos). Retorna os nomes apagados por não existirem.
 */
function garantirAcionadores_(ss, recriar) {
  const removidos = [];
  let temTempo = false;
  let temEdicao = false;
  ScriptApp.getProjectTriggers().forEach(t => {
    const nome = t.getHandlerFunction();
    const nosso = nome === 'atualizarJMS' || nome === 'aoEditarTokenJMS';
    if (!existeFuncao_(nome)) {
      ScriptApp.deleteTrigger(t);
      removidos.push(nome);
      return;
    }
    if (nosso && recriar) {
      ScriptApp.deleteTrigger(t);
      return;
    }
    const tipo = t.getEventType();
    if (nome === 'atualizarJMS' && tipo === ScriptApp.EventType.CLOCK) {
      if (temTempo) ScriptApp.deleteTrigger(t); else temTempo = true; // remove duplicados
    }
    if (nome === 'aoEditarTokenJMS' && tipo === ScriptApp.EventType.ON_EDIT) {
      if (temEdicao) ScriptApp.deleteTrigger(t); else temEdicao = true;
    }
  });
  if (!temEdicao) ScriptApp.newTrigger('aoEditarTokenJMS').forSpreadsheet(ss).onEdit().create();
  if (!temTempo) {
    ScriptApp.newTrigger('atualizarJMS').timeBased().everyMinutes(JMS_CONFIG.INTERVALO_MIN).create();
  }
  PropertiesService.getScriptProperties()
    .setProperty('JMS_INTERVALO_INSTALADO', String(JMS_CONFIG.INTERVALO_MIN));
  return removidos;
}

function existeFuncao_(nome) {
  if (!/^[A-Za-z_$][\w$]*$/.test(String(nome || ''))) return false;
  try {
    return typeof eval(nome) === 'function'; // nome já validado acima
  } catch (e) {
    return false;
  }
}

/** Grava em B14 quando e como foi a última execução, com a versão do código. */
function marcarExecucao_(ss, texto) {
  const cfg = ss.getSheetByName(JMS_CONFIG.ABA_CONFIG);
  if (!cfg) return;
  if (!cfg.getRange('A14').getDisplayValue()) {
    cfg.getRange('A14').setValue('Última execução automática').setFontWeight('bold');
  }
  cfg.getRange(CEL.ULT_AUTO).setValue(agoraJMS_() + ' — ' + texto + ' | código ' +
    JMS_CONFIG.VERSAO + ', a cada ' + JMS_CONFIG.INTERVALO_MIN + ' min');
}

function prepararAbasJMS_(ss) {
  const cfg = ss.getSheetByName(JMS_CONFIG.ABA_CONFIG) ||
    ss.insertSheet(JMS_CONFIG.ABA_CONFIG);
  cfg.setColumnWidth(1, 300);
  cfg.setColumnWidth(2, 520);
  cfg.getRange('A1:B1').merge()
    .setValue('J&T EXPRESS | AUTOMAÇÃO JMS - SP GRU')
    .setBackground(CORES.VERMELHO_JT).setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(13);

  const etiquetas = [
    ['A3', 'AuthToken (prefira o menu Inserir / trocar token)'],
    ['A4', 'Cabeçalho HTTP de autenticação'],
    ['A5', 'Prefixo do token (opcional)'],
    ['A6', 'Método API secundária'],
    ['A7', 'Campo "Tempo de deslacre" (troncal / primária)'],
    ['A8', 'Campo "Horário de deslacração do veículo" (secundária)'],
    ['A9', 'Método API primária'],
    ['A10', 'Status do sistema'],
    ['A11', 'Última troca de token'],
    ['A12', 'Última sincronização concluída'],
    ['A13', 'Último erro (detalhado)'],
    ['A14', 'Última execução automática']
  ];
  etiquetas.forEach(([celula, texto]) =>
    cfg.getRange(celula).setValue(texto).setFontWeight('bold'));

  if (!cfg.getRange(CEL.CABECALHO).getValue()) cfg.getRange(CEL.CABECALHO).setValue('authToken');
  if (!cfg.getRange(CEL.METODO_SEC).getValue()) cfg.getRange(CEL.METODO_SEC).setValue('POST');
  if (!cfg.getRange(CEL.METODO_PRIM).getValue()) cfg.getRange(CEL.METODO_PRIM).setValue('GET');

  const listaMetodo = SpreadsheetApp.newDataValidation()
    .requireValueInList(['POST', 'GET'], true).build();
  cfg.getRange(CEL.METODO_SEC).setDataValidation(listaMetodo);
  cfg.getRange(CEL.METODO_PRIM).setDataValidation(listaMetodo);

  cfg.getRange(CEL.TOKEN).setNumberFormat('@').setBackground(CORES.aguardando)
    .setNote('Opção rápida: cole o token e tecle ENTER; ele é salvo e a célula é limpa. ' +
      'Mais seguro: menu JMS | Automação > Inserir / trocar token (não passa pela célula ' +
      'nem pelo histórico de versões).');
  cfg.getRange(CEL.CABECALHO).setNote('Nome exato do cabeçalho que leva o token. Confira no ' +
    'navegador: F12 > Network > clique na consulta do JMS > Request Headers.');
  cfg.getRange(CEL.PREFIXO).setNote('Deixe vazio para token puro. Use Bearer só se o JMS exigir.');
  cfg.getRange(CEL.CAMPO_PRIM).setNote('Padrão: unlockTime (o mesmo nome que o JMS usa para a ' +
    'deslacração na secundária). Se a aba CONTROLE avisar "campo não encontrado", use o menu ' +
    'Ver campos da API primária e coloque aqui o nome certo.');
  cfg.getRange(CEL.CAMPO_SEC).setNote('unlockTime = "Horário de deslacração do veículo". ' +
    'Não use unloadStartTime: esse é o "Horário de chegada para descarregamento".');
  cfg.getRange(CEL.METODO_PRIM).setNote('Confira no F12 se a consulta tmsShipment/page usa GET ou POST.');

  cfg.getRange('A15:B15').merge()
    .setValue('Não deixe credenciais nas células. Compartilhe esta planilha e o projeto ' +
      'Apps Script apenas com usuários autorizados.')
    .setFontColor('#B91C1C').setWrap(true);
  cfg.setRowHeight(15, 40);

  cfg.getRange('A17:B17')
    .setValues([['Cabeçalhos extras: nome', 'Valor']])
    .setFontWeight('bold').setBackground('#EFEFEF');
  cfg.getRange('A17').setNote('Opcional. Copie do F12 > Request Headers os cabeçalhos que o ' +
    'JMS envia na mesma consulta (ex.: idioma, fuso, rota). Não cole cookie nem o token ' +
    'aqui: o token fica guardado separado.');
  cfg.getRange(JMS_CONFIG.EXTRAS_LINHA, 1, JMS_CONFIG.EXTRAS_QTD, 2)
    .setBackground('#FFFDF3').setNumberFormat('@');

  cfg.getRange(JMS_CONFIG.DIAG_LINHA - 1, 1, 1, 2).merge()
    .setValue('Último diagnóstico (menu JMS | Automação > Testar conexão)')
    .setFontWeight('bold').setBackground('#EFEFEF');

  [['primaria', JMS_CONFIG.ABA_PRIMARIA], ['secundaria', JMS_CONFIG.ABA_SECUNDARIA]].forEach(par => {
    const aba = ss.getSheetByName(par[1]) || ss.insertSheet(par[1]);
    // Aba nova recebe os títulos aqui; aba antiga é ajustada por migrarLayout_.
    if (!aba.getRange('A1').getDisplayValue()) {
      aba.getRange(1, 1, 1, 6).setValues([TITULOS[par[0]]]);
      estilizarCabecalho_(aba, 6);
    }
  });
  const controle = ss.getSheetByName(JMS_CONFIG.ABA_CONTROLE) ||
    ss.insertSheet(JMS_CONFIG.ABA_CONTROLE);
  controle.getRange('A1:D1').setValues([[
    'Linha', 'Quantidade de IDs', 'Última tentativa', 'Status'
  ]]);
  estilizarCabecalho_(controle, 4);
  controle.setColumnWidth(4, 520);
  controle.getRange('A2:A3').setValues([['Troncal (primária)'], ['Secundária']]);
  migrarLayout_(ss);
}

function estilizarCabecalho_(aba, n) {
  aba.getRange(1, 1, 1, n).setBackground(CORES.VERMELHO_JT)
    .setFontColor('#FFFFFF').setFontWeight('bold');
  aba.setFrozenRows(1);
  aba.setColumnWidths(1, n, 190);
  aba.setColumnWidth(2, 250);
  aba.setColumnWidth(3, 260);
}

/**
 * Ajusta planilhas da versão anterior, que gravavam o horário errado:
 * - B8 = unloadStartTime (chegada p/ descarregamento) vira unlockTime (deslacre);
 * - B7/B8 vazios recebem unlockTime;
 * - abas de dados com títulos antigos: os dados antigos são copiados para uma
 *   aba de backup, a aba é limpa e recebe os títulos novos.
 */
function migrarLayout_(ss) {
  const cfg = ss.getSheetByName(JMS_CONFIG.ABA_CONFIG);
  if (cfg) {
    if (!valorCelula_(cfg, CEL.CAMPO_PRIM)) cfg.getRange(CEL.CAMPO_PRIM).setValue(CAMPO_DESLACRE_PADRAO);
    const sec = valorCelula_(cfg, CEL.CAMPO_SEC);
    if (!sec || sec === 'unloadStartTime') cfg.getRange(CEL.CAMPO_SEC).setValue(CAMPO_DESLACRE_PADRAO);
  }
  [['primaria', JMS_CONFIG.ABA_PRIMARIA], ['secundaria', JMS_CONFIG.ABA_SECUNDARIA]].forEach(par => {
    const aba = ss.getSheetByName(par[1]);
    if (!aba) return;
    const titulos = TITULOS[par[0]];
    if (aba.getRange(1, 3).getDisplayValue() === titulos[2]) return;
    const ultima = aba.getLastRow();
    if (ultima > 1) {
      const copia = aba.copyTo(ss);
      copia.setName(par[1] + ' backup ' +
        Utilities.formatDate(new Date(), JMS_CONFIG.FUSO, 'dd-MM HH.mm'));
      aba.getRange(2, 1, ultima - 1, 6).clearContent();
    }
    aba.getRange(1, 1, 1, 6).setValues([titulos]);
    estilizarCabecalho_(aba, 6);
  });
}

/* ------------------------------------------------------------------ */
/* ENTRADA DO TOKEN                                                    */
/* ------------------------------------------------------------------ */

const HTML_DIALOGO_TOKEN = [
  '<style>',
  'body{font-family:Arial,sans-serif;font-size:13px;margin:0;padding:14px;color:#222}',
  'input{width:100%;padding:9px;box-sizing:border-box;font-size:13px;border:1px solid #bbb;border-radius:4px}',
  'button{margin-top:12px;background:#D71920;color:#fff;border:0;padding:10px 16px;border-radius:4px;cursor:pointer;font-weight:bold}',
  'button[disabled]{opacity:.6;cursor:wait}',
  '#msg{margin-top:12px;white-space:pre-wrap;line-height:1.4}',
  '</style>',
  '<p>Cole o valor do cabeçalho <b>authToken</b> copiado do JMS ',
  '(F12 &gt; Network &gt; Request Headers). O token não é gravado em nenhuma célula.</p>',
  '<input id="t" type="password" autocomplete="off" placeholder="Cole o token aqui">',
  '<button id="b" onclick="enviar()">Salvar e consultar JMS</button>',
  '<div id="msg"></div>',
  '<script>',
  'function enviar(){',
  ' var t=document.getElementById("t"),b=document.getElementById("b"),m=document.getElementById("msg");',
  ' if(!t.value.trim()){m.textContent="Cole o token antes de salvar.";return;}',
  ' b.disabled=true;m.textContent="Salvando e consultando o JMS. Pode levar até 1 minuto...";',
  ' google.script.run',
  '  .withSuccessHandler(function(r){m.textContent=r;t.value="";b.disabled=false;})',
  '  .withFailureHandler(function(e){m.textContent="Erro: "+(e&&e.message?e.message:e);b.disabled=false;})',
  '  .salvarTokenJMS(t.value);',
  '}',
  '</script>'
].join('\n');

function abrirDialogoToken() {
  const html = HtmlService.createHtmlOutput(HTML_DIALOGO_TOKEN).setWidth(460).setHeight(260);
  SpreadsheetApp.getUi().showModalDialog(html, 'Inserir AuthToken do JMS');
}

/** Chamado pela janela de token. Retorna o status final para exibir na janela. */
function salvarTokenJMS(tokenBruto) {
  const token = limparToken_(tokenBruto);
  if (token.length < 10) {
    throw new Error('Token muito curto. Copie o valor completo do cabeçalho authToken.');
  }
  const ss = planilhaJMS_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Outra atualização está em andamento. Tente de novo em 1 minuto.');
  }
  try {
    registrarToken_(token, ss);
    atualizarDadosJMS_(ss);
  } finally {
    lock.releaseLock();
  }
  const cfg = abaConfig_(ss);
  const status = valorCelula_(cfg, CEL.STATUS);
  const erro = valorCelula_(cfg, CEL.ULT_ERRO);
  return 'Status: ' + status + (erro ? '\n' + erro : '');
}

/**
 * Acionador INSTALÁVEL de edição (não é o onEdit simples, que não pode
 * acessar a internet). Roda com a conta de quem executou a instalação.
 */
function aoEditarTokenJMS(evento) {
  if (!evento || !evento.range) return;
  const faixa = evento.range;
  if (faixa.getSheet().getName() !== JMS_CONFIG.ABA_CONFIG ||
      faixa.getA1Notation() !== CEL.TOKEN) return;

  const token = limparToken_(faixa.getDisplayValue());
  if (!token) return;
  const ss = evento.source;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    definirEstado_('OCUPADO - TENTE NOVAMENTE', 'Outra sincronização está em andamento.', ss, 'aguardando');
    return; // token ainda não foi salvo: a célula fica como está
  }
  try {
    faixa.clearContent(); // não deixa o token visível
    SpreadsheetApp.flush();
    if (token.length < 10) {
      definirEstado_('TOKEN INVÁLIDO', 'O valor colado em B3 é curto demais para ser um token.', ss, 'erro');
      return;
    }
    registrarToken_(token, ss);
    atualizarDadosJMS_(ss);
  } catch (erro) {
    definirEstado_('ERRO DE SINCRONIZAÇÃO', mensagemSegura_(erro), ss, 'erro');
    console.error('JMS: ' + mensagemSegura_(erro));
  } finally {
    lock.releaseLock();
  }
}

function registrarToken_(token, ss) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('JMS_TOKEN', token);
  props.deleteProperty('JMS_TOKEN_STATUS');
  cacheHeaders_ = null;
  abaConfig_(ss).getRange(CEL.ULT_TOKEN).setValue(agoraJMS_());
  definirEstado_('TOKEN SALVO - CONSULTANDO JMS', '', ss, 'aguardando');
}

/** Remove rótulos, aspas, quebras de linha e "Bearer" que vêm junto na cópia. */
function limparToken_(bruto) {
  let t = String(bruto || '').replace(/[\r\n\t]/g, '').trim();
  t = t.replace(/^-H\s*/i, '').trim();
  t = t.replace(/^['"]+|['"]+$/g, '').trim();
  t = t.replace(/^(auth-?token|authorization)\s*:\s*/i, '').trim();
  t = t.replace(/^['"]+|['"]+$/g, '').trim();
  t = t.replace(/^bearer\s+/i, '').trim();
  return t;
}

/* ------------------------------------------------------------------ */
/* ATUALIZAÇÃO                                                         */
/* ------------------------------------------------------------------ */

/** Menu "Atualizar agora" e acionador de 15 em 15 minutos. */
function atualizarJMS(evento) {
  const automatico = !!(evento && evento.triggerUid);
  const ss = planilhaJMS_();
  const props = PropertiesService.getScriptProperties();

  // Conserta o agendamento (ex.: muda de 10 para 15 min, remove acionadores velhos).
  try {
    garantirAcionadores_(ss,
      props.getProperty('JMS_INTERVALO_INSTALADO') !== String(JMS_CONFIG.INTERVALO_MIN));
  } catch (e) {
    console.error('JMS: não foi possível conferir os acionadores: ' + mensagemSegura_(e));
  }

  // Token recusado: o automático não insiste a cada 15 min, mas tenta de novo a cada 60 min.
  if (automatico && props.getProperty('JMS_TOKEN_STATUS') === 'RECUSADO') {
    const desde = Number(props.getProperty('JMS_TOKEN_RECUSADO_EM') || 0);
    const espera = JMS_CONFIG.PAUSA_RETENTATIVA_MIN * 60000;
    if (Date.now() - desde < espera) {
      marcarExecucao_(ss, 'PAUSADA: token recusado pelo JMS. Insira um token novo ' +
        '(nova tentativa sozinha às ' +
        Utilities.formatDate(new Date(desde + espera), JMS_CONFIG.FUSO, 'HH:mm') + ')');
      return;
    }
  }
  marcarExecucao_(ss, automatico ? 'automática' : 'manual (Atualizar agora)');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('JMS: consulta ignorada, já há atualização em andamento.');
    return;
  }
  try {
    atualizarDadosJMS_(ss);
  } catch (erro) {
    definirEstado_('ERRO DE SINCRONIZAÇÃO', mensagemSegura_(erro), ss, 'erro');
    console.error('JMS: ' + mensagemSegura_(erro));
  } finally {
    lock.releaseLock();
  }
  if (!automatico) {
    const cfg = abaConfig_(ss);
    ss.toast(valorCelula_(cfg, CEL.ULT_ERRO) || 'Consulta concluída.',
      valorCelula_(cfg, CEL.STATUS), 10);
  }
}

function planilhaJMS_() {
  const id = PropertiesService.getScriptProperties().getProperty('JMS_PLANILHA_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Planilha não vinculada: execute instalarAutomacaoJMS.');
  return ss;
}

function atualizarDadosJMS_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('JMS_TOKEN')) {
    definirEstado_('AGUARDANDO TOKEN', 'Use o menu JMS | Automação > Inserir / trocar token.', ss, 'aguardando');
    return;
  }
  definirEstado_('CONSULTANDO JMS', '', ss, 'aguardando');
  migrarLayout_(ss);
  const cfg = abaConfig_(ss);
  const primCampo = valorCelula_(cfg, CEL.CAMPO_PRIM) || CAMPO_DESLACRE_PADRAO;
  const secCampo = valorCelula_(cfg, CEL.CAMPO_SEC) || CAMPO_DESLACRE_PADRAO;
  const dia = diaAtualJMS_(); // só o dia atual
  const linhasJMS = [
    {nome: JMS_CONFIG.ABA_PRIMARIA, tipo: 'primaria', campo: primCampo, linha: 2,
      rotulo: 'Troncal', celula: CEL.CAMPO_PRIM},
    {nome: JMS_CONFIG.ABA_SECUNDARIA, tipo: 'secundaria', campo: secCampo, linha: 3,
      rotulo: 'Secundária', celula: CEL.CAMPO_SEC}
  ];

  const erros = [];
  const avisos = [];
  let bloqueio = null; // erro que impede consultar a próxima linha
  for (const item of linhasJMS) {
    if (bloqueio) {
      atualizarControle_(ss, item.linha, null, 'NÃO CONSULTADA: ' + rotuloTipo_(bloqueio));
      continue;
    }
    try {
      const busca = buscarTodasPaginas_(item.tipo, dia.api, ss);
      const registros = busca.registros;
      const celCampo = cfg.getRange(item.celula);
      const nota = String(celCampo.getNote() || '');
      const calibrado = nota.indexOf('Calibrado') === 0;
      // Troncal no padrão ou campo escolhido automaticamente: reavalia a cada consulta.
      const modoAuto = !calibrado && (nota.indexOf('Detectado automaticamente') === 0 ||
        (item.tipo === 'primaria' && item.campo === CAMPO_DESLACRE_PADRAO));
      let campo = item.campo;
      let detectado = false;

      // Ordem de prioridade: calibrado pela tela > digitado à mão > detecção automática.
      if (registros.length && !calibrado &&
          (modoAuto || !registros.some(r => temCampo_(r, campo)))) {
        const candidato = detectarCampoDeslacre_(registros);
        if (candidato && candidato !== campo) {
          celCampo.setValue(candidato).setNote('Detectado automaticamente em ' + agoraJMS_() +
            ': entre os campos de lacre/deslacre, é o que tem o horário mais tarde (o deslacre ' +
            'vem depois do lacre). Para fixar pela tela do JMS, use o menu Calibrar campo de deslacre.');
          campo = candidato;
          detectado = true;
        }
      }

      const resultado = formatarRegistros_(registros, campo, dia.exibir);
      gravarRegistros_(ss.getSheetByName(item.nome), resultado.linhas, dia.exibir);

      const qtd = resultado.linhas.length + ' IDs' + (busca.total !== null
        ? ' (JMS informou ' + busca.total + ', vieram ' + registros.length + ')' : '');
      if (busca.total !== null && registros.length < busca.total) {
        avisos.push(item.rotulo + ': o JMS informou ' + busca.total + ' e vieram ' + registros.length);
        atualizarControle_(ss, item.linha, resultado.linhas.length, 'ATENÇÃO: faltaram registros. ' +
          qtd + '. Rode Atualizar agora de novo; se continuar, me avise.');
      } else if (resultado.linhas.length && !resultado.campoEncontrado) {
        avisos.push(item.rotulo + ': nenhum campo de deslacre encontrado na resposta do JMS');
        atualizarControle_(ss, item.linha, resultado.linhas.length,
          'ATENÇÃO: nenhum campo de deslacre na resposta do JMS. Use o menu Calibrar campo de ' +
          'deslacre. Horários que o JMS envia — ' + resumoHorarios_(registros) + '.');
      } else {
        atualizarControle_(ss, item.linha, resultado.linhas.length, 'OK - ' + qtd +
          ' | campo de deslacre: ' + campo + (detectado ? ' (detectado agora)' : ''));
      }
    } catch (erro) {
      erros.push(erro);
      atualizarControle_(ss, item.linha, null, 'ERRO: ' + mensagemSegura_(erro));
      console.error(item.nome + ': ' + mensagemSegura_(erro));
      if (['AUTH', 'GOOGLE_PERM', 'SEM_TOKEN', 'CONFIG'].indexOf(erro.tipoJMS) >= 0) {
        bloqueio = erro;
      }
      // Dados anteriores desta linha são mantidos quando a consulta falha.
    }
  }

  if (!erros.length) {
    props.deleteProperty('JMS_TOKEN_STATUS'); // token funcionou: sai da pausa
    cfg.getRange(CEL.ULT_SYNC).setValue(agoraJMS_());
    if (avisos.length) {
      definirEstado_('ATUALIZADO COM AVISO', avisos.join(' | ') + '. Veja a aba CONTROLE.', ss, 'aguardando');
    } else {
      definirEstado_('ATUALIZADO', 'Dia ' + dia.exibir + ' atualizado. Dias anteriores ficam salvos acima.', ss, 'ok');
    }
    return;
  }
  const auth = erros.filter(e => e.tipoJMS === 'AUTH')[0];
  const google = erros.filter(e => e.tipoJMS === 'GOOGLE_PERM')[0];
  if (google) {
    definirEstado_('SEM PERMISSÃO DO GOOGLE', mensagemSegura_(google), ss, 'erro');
  } else if (auth) {
    props.setProperty('JMS_TOKEN_STATUS', 'RECUSADO');
    props.setProperty('JMS_TOKEN_RECUSADO_EM', String(Date.now()));
    definirEstado_('ACESSO NEGADO PELO JMS', mensagemSegura_(auth) +
      ' | O que fazer: insira um token novo; se continuar, rode Testar conexão. ' +
      'Enquanto isso, a atualização automática tenta de novo a cada ' +
      JMS_CONFIG.PAUSA_RETENTATIVA_MIN + ' min.', ss, 'erro');
  } else {
    if (erros.length < linhasJMS.length) props.deleteProperty('JMS_TOKEN_STATUS'); // uma linha funcionou
    definirEstado_('ATUALIZAÇÃO PARCIAL / ERRO',
      erros.map(e => mensagemSegura_(e)).join(' | '), ss, 'erro');
  }
}

/* ------------------------------------------------------------------ */
/* CONSULTA AO JMS                                                     */
/* ------------------------------------------------------------------ */

function configuracaoHttp_(ss) {
  if (cacheHeaders_) return cacheHeaders_;
  const token = PropertiesService.getScriptProperties().getProperty('JMS_TOKEN');
  if (!token) throw erroJMS_('SEM_TOKEN', 'AuthToken ausente. Use o menu Inserir / trocar token.');
  const cfg = abaConfig_(ss);
  const nome = valorCelula_(cfg, CEL.CABECALHO) || 'authToken';
  if (!/^[A-Za-z0-9-]+$/.test(nome)) {
    throw erroJMS_('CONFIG', 'Nome do cabeçalho inválido em B4: use só letras, números e hífen.');
  }
  let prefixo = valorCelula_(cfg, CEL.PREFIXO);
  if (/^bearer$/i.test(prefixo)) prefixo = 'Bearer ';

  const headers = {Accept: 'application/json, text/plain, */*'};
  const extras = cfg.getRange(JMS_CONFIG.EXTRAS_LINHA, 1, JMS_CONFIG.EXTRAS_QTD, 2).getDisplayValues();
  extras.forEach(par => {
    const n = String(par[0] || '').trim().replace(/:$/, '');
    const v = String(par[1] || '').trim();
    if (!n || !v) return;
    if (!/^[A-Za-z0-9-]+$/.test(n)) {
      throw erroJMS_('CONFIG', 'Cabeçalho extra inválido na coluna A (linhas 18 a 27): ' + n);
    }
    const minusculo = n.toLowerCase();
    if (CABECALHOS_BLOQUEADOS.indexOf(minusculo) >= 0 || minusculo.indexOf('sec-') === 0) return;
    if (minusculo === nome.toLowerCase()) return; // o token vem da propriedade salva
    headers[n] = v;
  });
  headers[nome] = prefixo ? prefixo + token : token;
  cacheHeaders_ = headers;
  return headers;
}

/**
 * Busca TODAS as páginas de um dia. Não confia no "pages" do JMS: a tela usa
 * 20 linhas por página e o máximo é 100, e o JMS pode entregar menos linhas
 * do que foi pedido. Por isso segue pedindo páginas até juntar o "total"
 * informado (ou até vir uma página vazia). Se ainda faltar registro (a lista
 * mudou durante a consulta), faz uma segunda passada e junta sem duplicar.
 * Retorna {registros, total}.
 */
function buscarTodasPaginas_(tipo, dia, ss) {
  const porChave = new Map();
  let total = null;
  for (let passada = 1; passada <= 2; passada++) {
    let recebidos = 0;
    let pagina = 1;
    for (; pagina <= JMS_CONFIG.MAX_PAGINAS; pagina++) {
      const resposta = consultarPagina_(tipo, dia, pagina, ss);
      const recs = resposta.records || [];
      if (resposta.total !== undefined && resposta.total !== null &&
          Number.isFinite(Number(resposta.total)) && Number(resposta.total) >= 0) {
        total = Number(resposta.total);
      }
      recs.forEach((r, i) => {
        const id = r && (r.id || r.shipmentNo);
        porChave.set(id ? String(id) : 'sem-id-' + passada + '-' + pagina + '-' + i, r);
      });
      recebidos += recs.length;
      if (!recs.length) break;
      if (total !== null && recebidos >= total) break;
    }
    if (pagina > JMS_CONFIG.MAX_PAGINAS) {
      throw erroJMS_('VOLUME', 'Paginação interrompida: mais de ' + JMS_CONFIG.MAX_PAGINAS + ' páginas.');
    }
    if (total === null || porChave.size >= total) break;
  }
  return {registros: Array.from(porChave.values()), total: total};
}

function consultarPagina_(tipo, dia, pagina, ss, tamanho) {
  const cfg = abaConfig_(ss);
  const inicio = dia + ' 00:00:00';
  const fim = dia + ' 23:59:59';
  const base = {current: pagina, size: tamanho || JMS_CONFIG.PAGINA_TAMANHO};

  const celMetodo = tipo === 'primaria' ? CEL.METODO_PRIM : CEL.METODO_SEC;
  const metodo = (valorCelula_(cfg, celMetodo) || (tipo === 'primaria' ? 'GET' : 'POST')).toLowerCase();
  if (metodo !== 'get' && metodo !== 'post') {
    throw erroJMS_('CONFIG', 'Método inválido em ' + celMetodo + ': use GET ou POST.');
  }

  let parametros;
  if (tipo === 'primaria') {
    parametros = Object.assign(base, {
      shipmentState: JMS_CONFIG.STATUS_CONCLUIDO,
      endCode: JMS_CONFIG.DESTINO,
      startDateTime: inicio,
      endDateTime: fim,
      searchType: 'manage'
    });
  } else {
    parametros = Object.assign(base, {
      countryId: JMS_CONFIG.PAIS,
      shipmentState: JMS_CONFIG.STATUS_CONCLUIDO,
      endCode: JMS_CONFIG.DESTINO,
      startDepartureTime: inicio,
      endDepartureTime: fim
    });
  }

  let url = JMS_CONFIG.HOST + JMS_CONFIG.ENDPOINTS[tipo];
  const options = {
    method: metodo,
    headers: configuracaoHttp_(ss),
    muteHttpExceptions: true,
    followRedirects: false
  };
  if (metodo === 'get') {
    url += '?' + Object.keys(parametros).map(k =>
      encodeURIComponent(k) + '=' + encodeURIComponent(parametros[k])).join('&');
  } else {
    options.contentType = 'application/json;charset=UTF-8';
    options.payload = JSON.stringify(parametros);
  }
  return interpretarResposta_(executarFetch_(url, options), tipo, metodo);
}

/** Faz a chamada HTTP. Não esconde erro de permissão do Google atrás de "falha de rede". */
function executarFetch_(url, options) {
  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    let resposta;
    try {
      resposta = UrlFetchApp.fetch(url, options);
    } catch (erro) {
      const msg = String((erro && erro.message) || erro);
      if (/permiss|autoriza|authoriz|permission|scope/i.test(msg)) {
        throw erroJMS_('GOOGLE_PERM', 'O GOOGLE negou ao script o acesso à internet (' + msg +
          '). Abra Extensões > Apps Script, execute instalarAutomacaoJMS e aceite TODAS as ' +
          'permissões. Em conta corporativa, o administrador do Google pode ter bloqueado.');
      }
      ultimoErro = msg;
      if (tentativa < 3) {
        Utilities.sleep(1000 * tentativa);
        continue;
      }
      throw erroJMS_('REDE', 'O servidor do Google não conseguiu chegar ao JMS: ' + msg +
        '. Se persistir, o JMS pode estar bloqueando acessos de fora da rede da empresa.');
    }
    const http = resposta.getResponseCode();
    if ([429, 500, 502, 503, 504].indexOf(http) >= 0 && tentativa < 3) {
      Utilities.sleep(1500 * tentativa);
      continue;
    }
    return resposta;
  }
  throw erroJMS_('REDE', 'Tentativas de consulta esgotadas. ' + ultimoErro);
}

/** Lê a resposta e devolve data { records, total, pages } ou um erro explicando QUEM recusou. */
function interpretarResposta_(resposta, tipo, metodo) {
  const http = resposta.getResponseCode();
  const texto = String(resposta.getContentText() || '');
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch (e) {
    json = null;
  }
  const msgJms = json ? String(json.msg || json.message || json.errorMsg || json.error || '').trim() : '';
  const codJms = json && json.code !== undefined && json.code !== null ? String(json.code) : '';
  const detalhe = 'HTTP ' + http + ' (' + String(metodo || '').toUpperCase() + ')' +
    (codJms ? ' | código JMS ' + codJms : '') +
    (msgJms ? ' | mensagem do JMS: "' + msgJms.slice(0, 160) + '"' : '');
  const linha = tipo === 'primaria' ? 'Primária' : 'Secundária';

  if ([301, 302, 303, 307, 308].indexOf(http) >= 0) {
    throw erroJMS_('AUTH', linha + ': o JMS redirecionou para a tela de login, ou seja, não aceitou ' +
      'a sessão. ' + detalhe);
  }
  if (http === 401 || http === 403) {
    throw erroJMS_('AUTH', linha + ': o JMS negou o acesso (token vencido, cabeçalho errado ou ' +
      'acesso de fora da rede bloqueado). ' + detalhe);
  }
  if (http === 404 || http === 405) {
    throw erroJMS_('HTTP', linha + ': endereço ou método não aceito pelo JMS. Confira GET/POST ' +
      '(B6/B9). ' + detalhe);
  }
  if (!json) {
    const html = /<html|<!doctype/i.test(texto);
    // Só a página HTML com HTTP 200 é tela de login. Página de erro (502, 503...) é
    // instabilidade do JMS: não pausa a atualização, a próxima rodada tenta de novo.
    if (html && http === 200) {
      throw erroJMS_('AUTH', linha + ': o JMS respondeu uma página HTML (normalmente a tela ' +
        'de login). ' + detalhe);
    }
    throw erroJMS_('HTTP', linha + ': o JMS respondeu ' +
      (html ? 'uma página de erro' : 'algo que não é JSON') +
      ' (instabilidade). A próxima atualização tenta de novo. ' + detalhe);
  }
  if (http !== 200) {
    throw erroJMS_('HTTP', linha + ': resposta inesperada. ' + detalhe);
  }
  const sucesso = Number(json.code) === 1 && json.fail !== true && json.succ !== false;
  if (!sucesso) {
    const pareceAcesso = /token|login|permiss|autoriz|acesso|expir|unauthor|forbidden|权限|登录|过期/i.test(msgJms) ||
      codJms === '401' || codJms === '403';
    throw erroJMS_(pareceAcesso ? 'AUTH' : 'JMS', linha + ': o JMS recusou a consulta. ' + detalhe);
  }
  if (!json.data || !Array.isArray(json.data.records)) {
    throw erroJMS_('FORMATO', linha + ': o JSON veio sem a lista data.records. ' + detalhe);
  }
  return json.data;
}

function erroJMS_(tipo, mensagem) {
  const e = new Error(mensagem);
  e.tipoJMS = tipo;
  return e;
}

function rotuloTipo_(erro) {
  const mapa = {
    AUTH: 'acesso negado pelo JMS',
    GOOGLE_PERM: 'sem permissão do Google',
    SEM_TOKEN: 'sem token',
    CONFIG: 'configuração inválida'
  };
  return mapa[erro.tipoJMS] || 'erro anterior';
}

/* ------------------------------------------------------------------ */
/* GRAVAÇÃO                                                            */
/* ------------------------------------------------------------------ */

/**
 * Uma linha por tarefa: [Data, Número da tarefa, horário de deslacre, Situação, Destino, Atualizado em].
 * Ordena pelo horário de deslacre (como a tela do JMS); sem deslacre vão para o fim.
 */
function formatarRegistros_(registros, campo, diaExibir) {
  const unicos = new Map();
  const hora = agoraJMS_();
  let campoEncontrado = false;
  for (const bruto of registros) {
    const reg = bruto || {};
    const id = String(reg.shipmentNo || '').trim();
    if (!id) continue;
    if (temCampo_(reg, campo)) campoEncontrado = true;
    const v = valorCampo_(reg, campo);
    const valor = v !== undefined && v !== null ? String(v).trim() : '';
    const situacao = valor ? 'Deslacrado' : 'Aguardando deslacre';
    const destino = String(reg.endName || reg.endCode || JMS_CONFIG.DESTINO);
    const linha = [diaExibir, id, valor, situacao, destino, hora];
    const anterior = unicos.get(id);
    if (!anterior || (!anterior[2] && valor)) unicos.set(id, linha);
  }
  const linhas = Array.from(unicos.values()).sort((a, b) => {
    if (a[2] && !b[2]) return -1;
    if (!a[2] && b[2]) return 1;
    return a[2].localeCompare(b[2]) || a[1].localeCompare(b[1]);
  });
  if (!campoEncontrado) {
    linhas.forEach(l => { l[3] = 'Campo "' + campo + '" não encontrado'; });
  }
  return {linhas: linhas, campoEncontrado: campoEncontrado};
}

/**
 * Mantém salvos os dias anteriores e substitui só o bloco do dia atual,
 * que fica sempre embaixo. Quando o dia vira, a nova data entra logo abaixo.
 */
function gravarRegistros_(aba, linhas, diaExibir) {
  if (!aba) throw erroJMS_('CONFIG', 'Aba de dados não encontrada: execute instalarAutomacaoJMS.');
  const ultima = aba.getLastRow();
  let inicioHoje = Math.max(ultima, 1) + 1; // primeira linha do bloco do dia atual

  if (ultima > 1) {
    const colunaA = aba.getRange(2, 1, ultima - 1, 1).getDisplayValues().map(l => l[0]);
    const primeira = colunaA.indexOf(diaExibir);
    if (primeira >= 0) {
      const blocoNoFim = colunaA.slice(primeira).every(v => v === diaExibir);
      if (blocoNoFim) {
        inicioHoje = primeira + 2;
      } else {
        // A aba foi reordenada: tira as linhas do dia atual de onde estiverem
        // e regrava o histórico em ordem, sem perder nenhum dia anterior.
        const todas = aba.getRange(2, 1, ultima - 1, 6).getDisplayValues();
        const historico = todas.filter(l => l[0] !== diaExibir);
        aba.getRange(2, 1, ultima - 1, 6).clearContent();
        if (historico.length) {
          aba.getRange(2, 1, historico.length, 6).setNumberFormat('@').setValues(historico);
        }
        inicioHoje = historico.length + 2;
      }
    }
  }

  const sobra = aba.getLastRow() - inicioHoje + 1;
  if (sobra > 0) aba.getRange(inicioHoje, 1, sobra, 6).clearContent();
  if (!linhas.length) return;
  const intervalo = aba.getRange(inicioHoje, 1, linhas.length, 6);
  intervalo.setNumberFormat('@');
  intervalo.setValues(linhas);
}

function atualizarControle_(ss, linha, quantidade, status) {
  const aba = ss.getSheetByName(JMS_CONFIG.ABA_CONTROLE);
  if (!aba) return;
  if (quantidade !== null) aba.getRange(linha, 2).setValue(quantidade);
  aba.getRange(linha, 3, 1, 2).setValues([[agoraJMS_(), status]]);
  const cor = status.indexOf('OK') === 0 ? CORES.ok
    : (status.indexOf('ATENÇÃO') === 0 ? CORES.aguardando : CORES.erro);
  aba.getRange(linha, 4).setBackground(cor);
}

function definirEstado_(estado, detalhe, ss, nivel) {
  const aba = ss.getSheetByName(JMS_CONFIG.ABA_CONFIG);
  if (!aba) return;
  aba.getRange(CEL.STATUS).setValue(estado)
    .setBackground(CORES[nivel] || '#FFFFFF').setFontWeight('bold');
  aba.getRange(CEL.ULT_ERRO).setValue(detalhe || '').setWrap(true);
}

/* ------------------------------------------------------------------ */
/* DIAGNÓSTICO                                                         */
/* ------------------------------------------------------------------ */

/** Testa cada etapa e grava o resultado em CONFIGURAÇÃO JMS!A30:B43. */
function testarConexaoJMS() {
  const ss = planilhaJMS_();
  const cfg = abaConfig_(ss);
  const props = PropertiesService.getScriptProperties();
  const linhas = [];
  const add = (k, v) => linhas.push([k, v]);
  let conclusao = '';

  add('Executado em', agoraJMS_());
  const token = props.getProperty('JMS_TOKEN');
  add('Token salvo', token
    ? 'Sim, ' + token.length + ' caracteres, termina em ...' + token.slice(-4)
    : 'NÃO - use Inserir / trocar token');
  add('Situação do token', props.getProperty('JMS_TOKEN_STATUS') === 'RECUSADO'
    ? 'Recusado na última consulta' : 'Sem recusa registrada');

  let headers = null;
  try {
    headers = configuracaoHttp_(ss);
    add('Cabeçalhos enviados (nomes)', Object.keys(headers).join(', '));
  } catch (e) {
    add('Cabeçalhos', 'ERRO: ' + mensagemSegura_(e));
    conclusao = 'Corrija a configuração indicada acima.';
  }

  try {
    const r = UrlFetchApp.fetch(JMS_CONFIG.HOST, {method: 'get', muteHttpExceptions: true, followRedirects: false});
    add('Google alcança o servidor do JMS', 'Sim (HTTP ' + r.getResponseCode() + ' no endereço raiz)');
  } catch (e) {
    const msg = mensagemSegura_(e);
    add('Google alcança o servidor do JMS', 'NÃO: ' + msg);
    conclusao = /permiss|autoriza|authoriz|permission|scope/i.test(msg)
      ? 'PERMISSÃO DO GOOGLE: execute instalarAutomacaoJMS pelo editor e aceite todas as permissões.'
      : 'REDE: o Google não chega ao JMS. Provável bloqueio de rede; precisa de liberação da TI.';
  }

  if (headers && !conclusao) {
    const dia = diaAtualJMS_().api;
    ['primaria', 'secundaria'].forEach(tipo => {
      const nome = tipo === 'primaria' ? 'Consulta troncal' : 'Consulta secundária';
      try {
        const data = consultarPagina_(tipo, dia, 1, ss, 1);
        const total = data.total !== undefined ? data.total : data.records.length;
        const campo = valorCelula_(cfg, tipo === 'primaria' ? CEL.CAMPO_PRIM : CEL.CAMPO_SEC) ||
          CAMPO_DESLACRE_PADRAO;
        let infoCampo = '';
        if (data.records.length) {
          if (temCampo_(data.records[0], campo)) {
            infoCampo = ' | campo de deslacre "' + campo + '" encontrado';
          } else {
            const det = detectarCampoDeslacre_(data.records);
            infoCampo = det
              ? ' | "' + campo + '" não existe; campo de deslacre detectado: "' + det +
                '" (será usado na próxima atualização)'
              : ' | ATENÇÃO: nenhum campo de deslacre na resposta. ' + resumoHorarios_(data.records);
          }
        }
        add(nome, 'OK - total informado pelo JMS hoje: ' + total + infoCampo);
      } catch (e) {
        add(nome, '[' + (e.tipoJMS || 'ERRO') + '] ' + mensagemSegura_(e));
        if (!conclusao) {
          if (e.tipoJMS === 'AUTH') {
            conclusao = 'PERMISSÃO DO JMS: 1) faça login no JMS e insira um token novo; ' +
              '2) confira B4 e os cabeçalhos extras com o F12; 3) se um token recém-copiado ' +
              'também for negado, o JMS não aceita chamadas vindas dos servidores do Google: ' +
              'peça à TI uma integração autorizada.';
          } else if (e.tipoJMS === 'GOOGLE_PERM') {
            conclusao = 'PERMISSÃO DO GOOGLE: execute instalarAutomacaoJMS e aceite todas as permissões.';
          } else {
            conclusao = 'Veja a mensagem da consulta acima e confira GET/POST (B6/B9).';
          }
        }
      }
    });
  }
  add('Conclusão', conclusao || 'Conexão OK. Se a planilha não atualiza, rode Instalar / reparar acionadores.');

  const area = cfg.getRange(JMS_CONFIG.DIAG_LINHA, 1, JMS_CONFIG.DIAG_QTD, 2);
  area.clearContent().setBackground(null);
  cfg.getRange(JMS_CONFIG.DIAG_LINHA, 1, linhas.length, 2).setValues(linhas).setWrap(true);
  cfg.getRange(JMS_CONFIG.DIAG_LINHA + linhas.length - 1, 1, 1, 2)
    .setBackground(conclusao ? CORES.erro : CORES.ok).setFontWeight('bold');
  ss.toast('Diagnóstico gravado em CONFIGURAÇÃO JMS, linha ' + JMS_CONFIG.DIAG_LINHA + '.', 'JMS', 8);
}

/** Lista só os NOMES dos campos do JSON da primária; não grava IDs nem tokens. */
function diagnosticarCamposPrimaria() {
  const ss = planilhaJMS_();
  const ui = SpreadsheetApp.getUi();
  let pagina = null;
  try {
    // Só para LER os nomes dos campos: tenta hoje e, se vazio, ontem. Nada é gravado.
    for (const dia of [dataJMS_(0, 'yyyy-MM-dd'), dataJMS_(-1, 'yyyy-MM-dd')]) {
      pagina = consultarPagina_('primaria', dia, 1, ss);
      if (pagina.records.length) break;
    }
  } catch (e) {
    ui.alert('Não foi possível consultar a primária:\n\n' + mensagemSegura_(e));
    return;
  }
  if (!pagina || !pagina.records.length) {
    ui.alert('Não há registros hoje nem ontem para identificar os campos.');
    return;
  }
  const nomes = chavesRegistro_(pagina.records[0]).sort();
  const lacre = nomes.filter(n => /lock|seal|lacr/i.test(n));
  const detectado = detectarCampoDeslacre_(pagina.records);
  abaConfig_(ss).getRange(CEL.CAMPO_PRIM).setNote('Campos disponíveis na resposta: ' + nomes.join(', '));
  ui.alert(
    'Campo de deslacre detectado: ' + (detectado || 'NENHUM') + '\n' +
    'Campos com lock/seal/lacre no nome: ' + (lacre.length ? lacre.join(', ') : 'nenhum') + '\n\n' +
    'Horários da primeira tarefa (compare com a tela do JMS):\n' + resumoHorarios_(pagina.records) +
    '\n\nA lista completa de campos está na nota da célula B7 de CONFIGURAÇÃO JMS.');
}

/**
 * Calibração pela tela do JMS: você informa uma tarefa e o horário de deslacre
 * que aparece no JMS; o script acha o campo da API com esse mesmo horário e
 * fixa em B7 (troncal) ou B8 (secundária). A detecção automática não troca mais.
 */
function calibrarCampoDeslacre() {
  const ui = SpreadsheetApp.getUi();
  const ss = planilhaJMS_();
  const perguntar = texto => {
    const r = ui.prompt('Calibrar campo de deslacre', texto, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton() === ui.Button.OK ? String(r.getResponseText() || '').trim() : null;
  };
  const linha = perguntar('Qual linha? Digite T para troncal (Tempo de deslacre) ou S para ' +
    'secundária (Horário de deslacração do veículo).');
  if (linha === null) return;
  const tipo = /^s/i.test(linha) ? 'secundaria' : 'primaria';
  const tarefa = perguntar('Número da tarefa, copiado do JMS (ex.: DBGX26111100140):');
  if (!tarefa) return;
  const horario = perguntar('Horário de deslacre dessa tarefa, igual aparece na tela do JMS ' +
    '(ex.: 2026-11-12 04:12:25):');
  if (!horario) return;
  const alvo = horario.replace('T', ' ').replace(/\s+/g, ' ').trim();
  if (!REGEX_DATAHORA.test(alvo)) {
    ui.alert('Horário em formato inválido. Use aaaa-mm-dd hh:mm:ss, como aparece no JMS.');
    return;
  }

  // Só para LER os campos da tarefa: procura hoje e ontem. Nada é gravado nas abas de dados.
  let reg = null;
  try {
    for (const dia of [dataJMS_(0, 'yyyy-MM-dd'), dataJMS_(-1, 'yyyy-MM-dd')]) {
      reg = buscarTodasPaginas_(tipo, dia, ss).registros.filter(r =>
        String((r && r.shipmentNo) || '').trim().toUpperCase() === tarefa.toUpperCase())[0] || null;
      if (reg) break;
    }
  } catch (e) {
    ui.alert('Não foi possível consultar o JMS:\n\n' + mensagemSegura_(e));
    return;
  }
  if (!reg) {
    ui.alert('A tarefa ' + tarefa + ' não apareceu nas viagens concluídas de hoje nem de ontem.');
    return;
  }

  const campos = chavesRegistro_(reg).filter(k => {
    const v = valorCampo_(reg, k);
    return typeof v === 'string' && v.replace('T', ' ').indexOf(alvo) === 0;
  });
  if (!campos.length) {
    ui.alert('Nenhum campo da API tem o horário ' + alvo + ' para essa tarefa.\n\n' +
      'Horários que o JMS envia — ' + resumoHorarios_([reg]));
    return;
  }
  campos.sort((a, b) =>
    ((REGEX_LACRE_GERAL.test(b) ? 1 : 0) - (REGEX_LACRE_GERAL.test(a) ? 1 : 0)) || a.localeCompare(b));
  const escolhido = campos[0];
  const celula = tipo === 'primaria' ? CEL.CAMPO_PRIM : CEL.CAMPO_SEC;
  abaConfig_(ss).getRange(celula).setValue(escolhido).setNote('Calibrado em ' + agoraJMS_() +
    ' com a tarefa ' + tarefa + ' = ' + alvo + '. A detecção automática não troca este campo.');
  ui.alert('Campo de deslacre da ' + (tipo === 'primaria' ? 'troncal' : 'secundária') + ': ' +
    escolhido + (campos.length > 1 ? '\n(Outros campos com o mesmo horário: ' +
    campos.slice(1).join(', ') + ')' : '') + '\n\nAgora use JMS | Automação > Atualizar agora.');
}

/* ------------------------------------------------------------------ */
/* UTILITÁRIOS                                                         */
/* ------------------------------------------------------------------ */

function abaConfig_(ss) {
  const aba = ss.getSheetByName(JMS_CONFIG.ABA_CONFIG);
  if (!aba) throw erroJMS_('CONFIG', 'Aba CONFIGURAÇÃO JMS não encontrada: execute instalarAutomacaoJMS.');
  return aba;
}

function valorCelula_(aba, a1) {
  return String(aba.getRange(a1).getDisplayValue() || '').trim();
}

/* ------------------------------------------------------------------ */
/* CAMPO DE DESLACRE                                                   */
/* ------------------------------------------------------------------ */

// Nomes que indicam deslacre (abrir o lacre): unsealTime, unlockTime, desealTime, removeSealTime...
const REGEX_DESLACRE = /(un|de)[-_]?(seal|lock)|deslacr|seal[-_]?remov|remov[-_]?seal|open[-_]?seal|seal[-_]?open|unblock|deblock|解封|拆封/i;
// Nomes que não são horário (quem fez, código, status...).
const REGEX_NAO_HORARIO = /(by|user|name|code|id|ids|network|site|person|oper|operator|staff|status|state|type|flag|num|no|count|cnt|remark|desc|url|img|photo|pic)$/i;
const REGEX_DATAHORA = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

/** Lê um campo, aceitando um nível de objeto ("pai.filho"). */
function valorCampo_(reg, caminho) {
  return String(caminho).split('.').reduce((o, k) =>
    (o !== null && typeof o === 'object') ? o[k] : undefined, reg);
}

function temCampo_(reg, caminho) {
  let o = reg;
  for (const k of String(caminho).split('.')) {
    if (o === null || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, k)) return false;
    o = o[k];
  }
  return true;
}

/** Nomes dos campos de um registro, incluindo um nível de objeto interno. */
function chavesRegistro_(reg) {
  const out = [];
  Object.keys(reg || {}).forEach(k => {
    const v = reg[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.keys(v).forEach(k2 => out.push(k + '.' + k2));
    } else {
      out.push(k);
    }
  });
  return out;
}

// Qualquer campo de lacre OU deslacre (seal, lock, lacre). Não pega "clock" nem "block".
const REGEX_LACRE_GERAL = /seal|(^|[^cb])lock|unblock|deblock|lacr|解封|施封|铅封/i;

/**
 * Procura o campo de DESLACRE entre os campos de lacre/deslacre que trazem
 * data e hora. O deslacre acontece DEPOIS do lacre, então vence o campo com o
 * horário mais tarde nas viagens que têm os dois horários.
 * (A v4 escolhia o campo com mais horários preenchidos, e por isso pegava o
 * Tempo de lacre, que está sempre preenchido.)
 * Sem viagens com os dois horários, aceita só nome com cara de deslacre.
 */
function detectarCampoDeslacre_(registros) {
  const amostra = (registros || []).slice(0, 300);
  const info = {};
  amostra.forEach(reg => {
    chavesRegistro_(reg).forEach(k => {
      const ultimo = k.split('.').pop();
      if (!REGEX_LACRE_GERAL.test(ultimo) || REGEX_NAO_HORARIO.test(ultimo)) return;
      const i = info[k] || (info[k] = {horarios: 0, invalido: false, vitorias: 0});
      const v = valorCampo_(reg, k);
      if (v === null || v === undefined || v === '') return;
      if (typeof v === 'string' && REGEX_DATAHORA.test(v)) i.horarios++;
      else i.invalido = true;
    });
  });
  const candidatos = Object.keys(info).filter(k => !info[k].invalido);
  if (!candidatos.length) return '';
  const pareceDeslacre = k => REGEX_DESLACRE.test(k.split('.').pop());

  // Nas viagens com 2 ou mais horários de lacre/deslacre, o mais tarde é o deslacre.
  let comparacoes = 0;
  amostra.forEach(reg => {
    const valores = candidatos
      .map(k => ({k: k, v: valorCampo_(reg, k)}))
      .filter(x => typeof x.v === 'string' && REGEX_DATAHORA.test(x.v));
    if (valores.length < 2) return;
    comparacoes++;
    valores.sort((a, b) => b.v.localeCompare(a.v));
    if (valores[0].v !== valores[1].v) info[valores[0].k].vitorias++;
  });
  if (comparacoes) {
    const ordem = candidatos.slice().sort((a, b) =>
      (info[b].vitorias - info[a].vitorias) ||
      ((pareceDeslacre(b) ? 1 : 0) - (pareceDeslacre(a) ? 1 : 0)) ||
      a.localeCompare(b));
    if (info[ordem[0]].vitorias > 0) return ordem[0];
  }
  const porNome = candidatos.filter(pareceDeslacre).sort((a, b) =>
    (info[b].horarios - info[a].horarios) || a.localeCompare(b));
  return porNome[0] || '';
}

/** "Tarefa X: campo=data hora, ..." com todos os horários de uma tarefa, para comparar com a tela. */
function resumoHorarios_(registros) {
  const lista = registros || [];
  const reg = lista.filter(r => r && r.shipmentNo)[0] || lista[0] || {};
  const pares = chavesRegistro_(reg)
    .filter(k => { const v = valorCampo_(reg, k); return typeof v === 'string' && REGEX_DATAHORA.test(v); })
    .map(k => k + '=' + valorCampo_(reg, k));
  return 'Tarefa ' + (reg.shipmentNo || '?') + ': ' +
    (pares.length ? pares.slice(0, 25).join(', ') : 'nenhum campo de data/hora');
}

function mensagemSegura_(erro) {
  let msg = String((erro && erro.message) || erro || 'Erro não identificado');
  const token = PropertiesService.getScriptProperties().getProperty('JMS_TOKEN');
  if (token && token.length >= 8) msg = msg.split(token).join('[TOKEN OCULTO]');
  return msg.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [OCULTO]').slice(0, 450);
}

function agoraJMS_() {
  return Utilities.formatDate(new Date(), JMS_CONFIG.FUSO, 'dd/MM/yyyy HH:mm:ss');
}

function dataJMS_(deslocamentoDias, formato) {
  return Utilities.formatDate(new Date(Date.now() + deslocamentoDias * 86400000),
    JMS_CONFIG.FUSO, formato);
}

/** Só o dia atual (horário de São Paulo): api para a consulta, exibir para a planilha. */
function diaAtualJMS_() {
  return {api: dataJMS_(0, 'yyyy-MM-dd'), exibir: dataJMS_(0, 'dd/MM/yyyy')};
}
