"""J&T · Expedição Incorreta (versão Python): pacotes no caminhão errado, rota troncal e secundária.

Só a biblioteca padrão do Python (sem pip install). Peças:
  xlsx          planilhas .xlsx (ler a rotas.xlsx, escrever o Excel do painel)
  rotas_padrao  a planilha de rotas de 24/10 (criada na primeira vez)
  status        códigos de Status do JMS (Concluído：已完成 e Em Trânsito：在途)
  regras        conferência certo/errado pela planilha de rotas
  jms           consultas ao JMS (ritmo, cabeçalho Routename, erros)
  banco         SQLite local (dados/expedicao.db)
  coletor       busca no JMS dia a dia + 3 Segmentos
  painel        números do painel (cartões, gráficos, tabela, Excel)
  servidor      HTTP: painéis, API e Configurações
"""

VERSAO = "1.7.0-py"
