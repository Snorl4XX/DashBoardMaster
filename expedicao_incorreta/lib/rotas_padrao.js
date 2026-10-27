'use strict';
/**
 * Planilha de rotas que o app cria na primeira vez (planilhas/rotas.xlsx), a partir das tabelas vermelhas de 24/10:
 * "干线装车码头进行调整" (rota TRONCAL) e "Ajuste das Docas de Carregamento das Rotas Regionais" (rota SECUNDÁRIA).
 * Depois de criada, quem manda é a planilha: quando as docas mudarem, edite planilhas/rotas.xlsx (ou envie em Configurações).
 *
 * Aba "Rotas": uma linha por grupo de códigos. Rota = a Próxima parada do caminhão. 1º Nível = códigos aceitos;
 * 2º Nível (opcional) = só estes segmentos. Duas linhas da mesma rota = qualquer uma vale (ex.: DC TBT-SP, SP antigo e GRU novo).
 * Os códigos são comparados com o bloco "3 Segmentos" de cada remessa no JMS (Código de primeiro e de dois segmentos).
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

const CAB_ROTAS = ['Tipo', 'Rota (Próxima parada)', '1º Nível (códigos)', '2º Nível (segmentos, opcional)', 'Observação'];

/** Abas da planilha de rotas padrão, prontas para lib/xlsx.js → escreverXlsx. */
function abasPadrao() {
  return [
    {nome: 'Rotas', linhas: [CAB_ROTAS].concat(ROTAS), larguras: [12, 22, 48, 60, 50]}
  ];
}

module.exports = {abasPadrao, CAB_ROTAS};
