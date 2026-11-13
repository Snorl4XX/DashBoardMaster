'use strict';
/**
 * Tabela de rotas que o app cria na primeira vez (planilhas/rotas.xlsx): a tabela do SC de 24/10 (ajuste_de_rotas_docas.xlsx,
 * abas "Rotas de Linha" = troncal e "Rotas Regionais" = secundária), como veio, com a doca e a esteira (Linha de desvio do DWS).
 * Depois de criada, quem manda é a planilha: quando as docas mudarem, envie a tabela nova em Configurações (do jeito que o SC
 * manda) ou edite planilhas/rotas.xlsx.
 */
const CAB = ['Tipo', 'Rota', '1º Nível (códigos)', '2º Nível (segmentos)', 'Doca', 'Esteira (DWS)', 'Observação'];
const ROTAS = [
  ["Troncal", "GO GYN", "GO", "", "05", "7", ""],
  ["Troncal", "SC BNU", "SC, SC1", "", "06", "7", ""],
  ["Troncal", "RS NSR", "RS, RS1", "", "07", "7", ""],
  ["Troncal", "SBN", "SBN", "375-00, 375-01, 375-02, 375-03, 375-04, 375-05, 375-06, 375-07, 375-08, 375-09, 375-10", "08", "7", ""],
  ["Troncal", "CE FOR", "CE", "", "09", "7", ""],
  ["Troncal", "RJ SJM", "RJ, RJ1, VDC, CDG", "", "10", "7", "Adicionar novo código inicial: CDG(DC CDG-RJ)"],
  ["Troncal", "SE AJU", "SE, AL", "", "15", "4", ""],
  ["Troncal", "PR SJS", "PR, PR1, CAC", "", "16", "4", ""],
  ["Troncal", "PE JGS", "PE, BYE", "", "17", "4", ""],
  ["Troncal", "BA FEC", "BA, SBA, SNS", "", "18", "4", ""],
  ["Troncal", "MG CGE", "MG, MG1, CHV", "", "19", "4", ""],
  ["Troncal", "PA ANA", "PA", "", "20", "4", "Movimentação Manual de Sacas"],
  ["Troncal", "SP BRE", "AC, AM, BAU, BVB, JDF, LDB, MIA, MRB, RO, SJP, SOD, SP, SP1, STM, TO, VCP, XAP, BJE, MA, PPB, NAT", "", "21, 22", "2", "Excluir CDG"],
  ["Troncal", "DC TBT-SP", "SP", "402-01, 402-03, 402-05, 421-00", "23", "2", "Transferido da doca nº 14 para a doca nº 23."],
  ["Troncal", "DC TBT-SP", "GRU", "402-00, 402-01, 402-03, 402-05, 402-06, 402-07, 402-08, 402-02, 402-04", "23", "2", "Transferido da doca nº 14 para a doca nº 23."],
  ["Troncal", "DC GRU-SP", "SP", "395-05, 395-06, 395-07, 381-04", "44", "3", "378-04 — Data de ativação a definir."],
  ["Troncal", "DC GRU-SP", "GRU", "381-00, 381-01, 381-02, 381-03, 381-04, 381-05, 381-11, 381-13, 381-14, 381-15, 381-18, 381-19, 381-20, 381-21, 378-04", "44", "3", "378-04 — Data de ativação a definir."],
  ["Troncal", "MS CGR", "MS", "", "43", "3", ""],
  ["Troncal", "MT CGB", "MT, JPN", "", "42", "3", ""],
  ["Troncal", "THE", "PI, IMP", "", "41", "3", ""],
  ["Troncal", "ES SRR", "ES", "", "40", "3", ""],
  ["Troncal", "SP RBP", "NE, NE1", "", "39", "3", ""],
  ["Troncal", "DF BSB", "DF", "", "38", "3", ""],
  ["Secundária", "DC S-VLANA-SP", "VLANA", "", "01", "6", "Reservado"],
  ["Secundária", "F S-JBO-SP", "GRU", "404-11", "02", "6", "Reservado"],
  ["Secundária", "F S-SAP 02-SP", "GRU", "404-12", "03", "6", "Reservado"],
  ["Secundária", "F S-MGUE 02-SP", "GRU", "404-08", "04", "6", "Com coluna de sustentação"],
  ["Secundária", "F S-PQBOTU-SP", "GRU", "404-09", "05", "6", ""],
  ["Secundária", "F VLMT-SP", "GRU", "404-10", "06", "6", ""],
  ["Secundária", "S-MGUE-SP", "GRU", "404-01", "07", "6", ""],
  ["Secundária", "DC SSZ-SP", "GRU", "378-00, 378-01, 378-02, 378-03, 378-05, 378-06", "08, 09", "6", "Com coluna de sustentação"],
  ["Secundária", "S-MGUE 02-SP", "GRU", "404-13", "10", "6", "Reservado"],
  ["Secundária", "DC S-MOO 02-SP", "SP", "364-00, 435-00, 350-00, 365-00, 381-12, 430-01, 430-05, 430-07, 430-08, 430-09", "11, 12", "5", "Reajustado"],
  ["Secundária", "DC S-MOO 02-SP", "MOO", "430-00, 430-01, 430-02, 430-03, 430-04, 430-05, 430-06, 430-07, 430-08, 430-09", "11, 12", "5", "Reajustado"],
  ["Secundária", "S-PENHA-SP", "GRU", "404-02", "13", "5", ""],
  ["Secundária", "F S-PENHA 02-SP", "GRU", "404-07", "14", "5", "Com coluna de sustentação"],
  ["Secundária", "S-SRAF-SP", "GRU", "404-00", "15", "5", ""],
  ["Secundária", "DC NOD-SP", "NOD", "", "17", "5", "Reservado"],
  ["Secundária", "S-SAPOP-SP", "GRU", "404-03", "19", "5", ""],
  ["Secundária", "F S-MGUE-SP", "GRU", "404-04", "20", "5", "Com coluna de sustentação"],
  ["Secundária", "F S-PENHA-SP", "GRU", "404-05", "22", "5", ""],
  ["Secundária", "F S-PENHA 03-SP", "GRU", "404-06", "24", "5", ""]
];
/** Abas da tabela padrão, prontas para lib/xlsx.js → escreverXlsx. */
function abasPadrao() { return [{nome: 'Rotas', linhas: [CAB].concat(ROTAS), larguras: [12, 20, 60, 70, 10, 12, 50]}]; }

module.exports = {abasPadrao, ROTAS};
