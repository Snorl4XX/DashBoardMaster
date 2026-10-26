'use strict';
/**
 * Planilha de rotas que o app cria na primeira vez (planilhas/rotas.xlsx), a partir das tabelas vermelhas de 24/10:
 * "干线装车码头进行调整" (rota TRONCAL) e "Ajuste das Docas de Carregamento das Rotas Regionais" (rota SECUNDÁRIA).
 * Depois de criada, quem manda é a planilha: quando as docas mudarem, edite planilhas/rotas.xlsx (ou envie em Configurações).
 *
 * Aba "Rotas": uma linha por grupo de códigos. Rota = a Próxima parada do caminhão. 1º Nível = códigos aceitos;
 * 2º Nível (opcional) = só estes segmentos. Duas linhas da mesma rota = qualquer uma vale (ex.: DC TBT-SP, SP antigo e GRU novo).
 * Aba "Códigos 1º nível": cada código → os DESTINOS da rotinha (coluna "Nome de mecanismo final") que ele representa.
 * Código sem destino = "A CONFIRMAR" (os pacotes desse destino aparecem como "Destino sem código", não como erro).
 */
const seg = (pre, nums) => nums.map(n => pre + '-' + String(n).padStart(2, '0'));

const ROTAS = [
  // ---------- TRONCAL (docas 05 a 44) ----------
  ['Troncal', 'GO GYN', 'GO', '', 'Doca 05'],
  ['Troncal', 'SC BNU', 'SC, SC1', '', 'Doca 06'],
  ['Troncal', 'RS NSR', 'RS, RS1', '', 'Doca 07'],
  ['Troncal', 'DC SBN-SP', 'SBN', seg('375', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).join(', '), 'Doca 08 (na tabela: SBN)'],
  ['Troncal', 'CE FOR', 'CE', '', 'Doca 09'],
  ['Troncal', 'RJ SJM', 'RJ, RJ1, VDC, CDG', '', 'Doca 10 · CDG = DC CDG-RJ (código novo)'],
  ['Troncal', 'SE AJU', 'SE, AL', '', 'Doca 15'],
  ['Troncal', 'PR SJS', 'PR, PR1, CAC', '', 'Doca 16'],
  ['Troncal', 'PE JGS', 'PE, BYE', '', 'Doca 17 (na tabela: DC—BYE)'],
  ['Troncal', 'BA FEC', 'BA, SBA, SNS', '', 'Doca 18'],
  ['Troncal', 'MG CGE', 'MG, MG1, CHV', '', 'Doca 19'],
  ['Troncal', 'PA ANA', 'PA', '', 'Doca 20 · movimentação manual de sacas'],
  ['Troncal', 'SP BRE', 'AC, AM, BAU, BVB, JDF, LDB, MIA, MRB, RO, SJP, SOD, SP, SP1, STM, TO, VCP, XAP, BJE, MA, PPB, NAT', '',
    'Docas 21 e 22 · excluir CDG'],
  ['Troncal', 'DC TBT-SP', 'SP', seg('402', [1, 3, 5]).concat('421-00').join(', '), 'Doca 23 (antiga 14) · SP (antigo)'],
  ['Troncal', 'DC TBT-SP', 'GRU', seg('402', [0, 1, 3, 5, 6, 7, 8, 2, 4]).join(', '), 'Doca 23 (antiga 14) · GRU (novo)'],
  ['Troncal', 'DC GRU-SP', 'SP', seg('395', [5, 6, 7]).concat('381-04').join(', '), 'Doca 44 · SP (antigo)'],
  ['Troncal', 'DC GRU-SP', 'GRU', seg('381', [0, 1, 2, 3, 4, 5, 11, 13, 14, 15, 18, 19, 20, 21]).concat('378-04').join(', '),
    'Doca 44 · GRU (novo) · 378-04: data de ativação a definir'],
  ['Troncal', 'MS CGR', 'MS', '', 'Doca 43'],
  ['Troncal', 'MT CGB', 'MT, JPN', '', 'Doca 42'],
  ['Troncal', 'PI THE', 'PI, IMP', '', 'Doca 41 (na tabela: THE)'],
  ['Troncal', 'ES SRR', 'ES', '', 'Doca 40'],
  ['Troncal', 'SP RBP', 'NE, NE1', '', 'Doca 39'],
  ['Troncal', 'DF BSB', 'DF', '', 'Doca 38'],
  // ---------- SECUNDÁRIA (docas 01 a 25) ----------
  ['Secundária', 'DC S-VLANA-SP', 'VLANA', '', 'Doca 01 · reservado'],
  ['Secundária', 'F S-JBO-SP', 'GRU', '404-11', 'Doca 02 · reservado'],
  ['Secundária', 'F S-SAP 02-SP', 'GRU', '404-12', 'Doca 03 · reservado'],
  ['Secundária', 'F S-MGUE 02-SP', 'GRU', '404-08', 'Doca 04'],
  ['Secundária', 'F S-PQBOTU-SP', 'GRU', '404-09', 'Doca 05'],
  ['Secundária', 'F VLMT-SP', 'GRU', '404-10', 'Doca 06'],
  ['Secundária', 'S-MGUE-SP', 'GRU', '404-01', 'Doca 07'],
  ['Secundária', 'DC SSZ-SP', 'GRU', seg('378', [0, 1, 2, 3, 5, 6]).join(', '), 'Docas 08 e 09'],
  ['Secundária', 'S-MGUE 02-SP', 'GRU', '404-13', 'Doca 10 · reservado'],
  ['Secundária', 'DC S-MOO 02-SP', 'SP', ['364-00', '435-00', '350-00', '365-00', '381-12'].concat(seg('430', [1, 5, 7, 8, 9])).join(', '),
    'Doca 11 · SP (antigo)'],
  ['Secundária', 'DC S-MOO 02-SP', 'MOO', seg('430', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).join(', '), 'Doca 12 · MOO (novo, reajustado)'],
  ['Secundária', 'S-PENHA-SP', 'GRU', '404-02', 'Doca 13'],
  ['Secundária', 'F S-PENHA 02-SP', 'GRU', '404-07', 'Doca 14'],
  ['Secundária', 'S-SRAF-SP', 'GRU', '404-00', 'Docas 15 e 16'],
  ['Secundária', 'DC NOD-SP', 'NOD', '', 'Docas 17 e 18 · reservado'],
  ['Secundária', 'S-SAPOP-SP', 'GRU', '404-03', 'Doca 19'],
  ['Secundária', 'F S-MGUE-SP', 'GRU', '404-04', 'Doca 20'],
  ['Secundária', 'F S-PENHA-SP', 'GRU', '404-05', 'Doca 22'],
  ['Secundária', 'F S-PENHA 03-SP', 'GRU', '404-06', 'Doca 24']
];

/**
 * Código de 1º nível → destinos ("Nome de mecanismo final" da rotinha). Os códigos que a tabela usa e que não dá para ligar
 * com certeza a um destino da rotinha ficam vazios, com uma sugestão na observação, para quem conhece confirmar.
 */
const CODIGOS = [
  ['GO', 'GO GYN', ''], ['SC', 'SC BNU', ''], ['SC1', '', 'A CONFIRMAR · sugestão: DC CCM-SC'],
  ['RS', 'RS NSR', ''], ['RS1', '', 'A CONFIRMAR · sugestão: DC CPO-RS, DC CXJ01, DC NHG-RS, DC PEL-RS, DC PFB-RS, DC RIA-RS'],
  ['SBN', 'DC SBN-SP', ''], ['CE', 'CE FOR', ''],
  ['RJ', 'RJ SJM', ''], ['RJ1', '', 'A CONFIRMAR · sugestão: DC SQR-RJ'], ['VDC', 'BA VDC', ''], ['CDG', 'DC CDG-RJ', ''],
  ['SE', 'SE AJU', ''], ['AL', 'DC MCZ-AL', ''],
  ['PR', 'PR SJS', ''], ['PR1', '', 'A CONFIRMAR · sugestão: DC GPB-PR, DC MGF-PR, DC PGZ-PR'], ['CAC', 'DC CAC-PR', ''],
  ['PE', 'PE JGS', ''], ['BYE', 'DC BYE-PB', ''],
  ['BA', 'BA FEC', ''], ['SBA', 'BA SBA', ''], ['SNS', 'DC SNS-PE, PE SNS', ''],
  ['MG', 'MG CGE', ''], ['MG1', '', 'A CONFIRMAR · sugestão: DC CUV 001, DC GVR 001, DC MTC-MG, DC QDF 001, DC TFL 001, DC VAG 001, DC NSR 001-MG, F DC UBE-MG'],
  ['CHV', 'MG CHV, DC CHV-MG', ''],
  ['PA', 'PA ANA', ''],
  ['AC', 'AC RBR', ''], ['AM', 'AM MAO, DC MAO-AM', ''], ['BAU', 'DC BAU-SP', ''], ['BVB', '', 'A CONFIRMAR'],
  ['JDF', 'DC JDF-MG', ''], ['LDB', 'DC LDB-PR', ''], ['MIA', '', 'A CONFIRMAR'], ['MRB', 'PA MRB', ''], ['RO', 'RO PVH', ''],
  ['SJP', 'DC SJP-SP', ''], ['SOD', '', 'A CONFIRMAR'], ['SP', 'SP BRE', ''], ['SP1', '', 'A CONFIRMAR · sugestão: SN RAO'],
  ['STM', 'PA STM', ''], ['TO', 'TO PMW', ''], ['VCP', '', 'A CONFIRMAR'], ['XAP', 'DC XAP-SC', ''], ['BJE', 'DC BJE-PI', ''],
  ['MA', 'MA SLZ', ''], ['PPB', '', 'A CONFIRMAR · sugestão: DC PPY-MG'], ['NAT', 'DC NAT-RN', ''],
  ['MS', 'MS CGR', ''], ['MT', 'MT CGB', ''], ['JPN', 'DC JPN-RO', ''], ['PI', 'PI THE', ''], ['IMP', 'DC IMP-MA', ''],
  ['ES', 'ES SRR', ''], ['NE', '', 'A CONFIRMAR · sugestão: SP RBP'], ['NE1', '', 'A CONFIRMAR'], ['DF', 'DF BSB', ''],
  ['GRU', 'SP GRU, DC GRU-SP, DC SSZ-SP', 'Bases de Guarulhos (rota secundária e DC TBT/DC GRU)'],
  ['MOO', 'DC S-MOO 02-SP', ''], ['VLANA', '', 'A CONFIRMAR'], ['NOD', '', 'A CONFIRMAR']
];

const CAB_ROTAS = ['Tipo', 'Rota (Próxima parada)', '1º Nível (códigos)', '2º Nível (segmentos, opcional)', 'Observação'];
const CAB_CODIGOS = ['Código 1º nível', 'Destinos (Nome de mecanismo final da rotinha)', 'Observação'];

/** Abas da planilha de rotas padrão, prontas para lib/xlsx.js → escreverXlsx. */
function abasPadrao() {
  return [
    {nome: 'Rotas', linhas: [CAB_ROTAS].concat(ROTAS), larguras: [12, 22, 48, 60, 50]},
    {nome: 'Códigos 1º nível', linhas: [CAB_CODIGOS].concat(CODIGOS), larguras: [16, 60, 70]}
  ];
}

module.exports = {abasPadrao, CAB_ROTAS, CAB_CODIGOS};
