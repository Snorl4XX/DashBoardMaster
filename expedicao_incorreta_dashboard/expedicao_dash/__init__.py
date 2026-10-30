"""J&T · Expedição Incorreta (错误发运分析): confere se cada remessa foi carregada na rota certa.

A remessa vem da planilha do usuário (com a rota em que foi carregada); o JMS dá o bloco "3 Segmentos" (Código de primeiro
segmento e Código de dois segmentos) e os "Detalhes da encomenda"; a planilha de rotas das docas diz qual é a rota certa.
Só as remessas na rota ERRADA aparecem no resultado (as certas só entram na contagem).
"""

VERSAO = "2.2"
