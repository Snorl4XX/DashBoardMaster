/**
 * Painel no Netlify (página fora do Google, sem instalar nada no computador). Arquivo a mais, a partir da V4.15.
 *
 * A página do painel fica num site do Netlify e pede os dados a este projeto pelo link do App da Web (o mesmo /exec do
 * painel), como fazia o google.script.run. A busca do JMS continua aqui no Apps Script, com os mesmos gatilhos.
 *   - A página manda {fn, args, senha} em texto puro (assim o navegador não faz a pré-verificação de CORS, que o Apps Script
 *     não responde) e recebe {ok: true, result} ou {ok: false, error}.
 *   - Só as funções que a página chama (FUNCOES_DA_PAGINA_, as mesmas call('…') do Client.html).
 *   - Senha (opcional, recomendada): Propriedade do script SENHA_PAINEL. Com ela, a página pede a senha uma vez e só responde
 *     com a senha certa. Sem ela, quem tiver o link do Netlify abre o painel (como o link do Google).
 * Para funcionar, a implantação do App da Web precisa estar com "Quem pode acessar: Qualquer pessoa".
 */
const FUNCOES_DA_PAGINA_ = ['getAppBootstrap', 'getDashboardData', 'getResultsData', 'getUpdateStamp', 'refreshNow', 'refreshAllNow',
  'refreshAllDetailsNow', 'refreshOrderKindsNow', 'refreshSnapshotList', 'completeTriagemNow', 'fetchNoMoveHistory',
  'fetchNoMoveHistoryList', 'generateReport'];

function doPost(e) {
  return ContentService.createTextOutput(JSON.stringify(apiDaPagina_(e && e.postData ? e.postData.contents : '')))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Pedido da página → {ok, result} | {ok: false, error, senha?}. Nunca lança erro (a página sempre recebe JSON). */
function apiDaPagina_(texto) {
  let pedido;
  try { pedido = JSON.parse(String(texto || '{}')); }
  catch (e) { return {ok: false, error: 'Pedido inválido (não é JSON).'}; }
  const fn = String(pedido && pedido.fn || '');
  const senha = String(getProp_('SENHA_PAINEL', '') || '');
  if (senha && String(pedido.senha || '') !== senha) {
    return {ok: false, senha: true, error: pedido.senha ? 'Senha incorreta.' : 'Digite a senha do painel.'};
  }
  if (FUNCOES_DA_PAGINA_.indexOf(fn) < 0 || typeof globalThis[fn] !== 'function') return {ok: false, error: 'Função não permitida: ' + fn};
  try {
    const result = globalThis[fn].apply(null, Array.isArray(pedido.args) ? pedido.args : []);
    // Como o google.script.run: resultado sem valor vira null (a página trata).
    return {ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result))};
  } catch (e) {
    return {ok: false, error: String(e && e.message || e)};
  }
}
