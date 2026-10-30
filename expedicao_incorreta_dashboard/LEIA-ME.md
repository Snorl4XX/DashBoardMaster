# J&T · Expedição Incorreta (错误发运分析) — painel em Python

Você joga a planilha de remessas (com a rota em que cada uma foi carregada). O app busca no JMS o bloco **3 Segmentos** de cada remessa, compara com a **planilha de rotas** das docas e mostra **só as remessas que foram para a rota errada**: quantidade, porcentagem, gráficos (turno, rota, segmento, dia), tabela e Excel.

Tudo em Python (Streamlit + Plotly), sem JavaScript. Roda no seu computador e abre no navegador em `http://localhost:8503`.

## Abrir (Windows, sem administrador, sem .bat)

1. Extraia o ZIP em `C:\`. Fica a pasta `C:\expedicao_incorreta_dashboard`.
2. Abra o **cmd** e digite:

   ```
   cd /d C:\expedicao_incorreta_dashboard
   py iniciar.py
   ```

   (Se `py` não existir, use `python iniciar.py`.)
3. **Na primeira vez** ele instala sozinho o que falta (Streamlit, pandas, Plotly…). Precisa de internet e leva alguns minutos.
4. O navegador abre em `http://localhost:8503`. **Deixe a janela preta aberta** enquanto usa.

Atalho na Área de Trabalho: botão direito › Novo › Atalho › destino `"C:\caminho\do\python.exe" "C:\expedicao_incorreta_dashboard\iniciar.py"`.

Precisa do Python 3.10 ou mais novo.

**Sem AuthToken?** Ligue o **Modo demonstração** na barra da esquerda. O app usa uma planilha de exemplo e um JMS de mentira (nada vai para o JMS).

## Como usar

**1 · Remessas**
- Arraste a planilha (`.xlsx`, `.xls` ou `.csv`). Por exemplo, a lista de carga da viagem baixada do JMS (Info de carga e descarga).
- O app acha sozinho:
  - a aba com mais remessas;
  - a linha do cabeçalho (mesmo com título em cima);
  - as colunas: remessa, **Próxima parada** (rota carregada), **Tempo de digitalização** (data e hora → turno), ID de viagem.
- Confira em **Colunas da planilha** se precisar.
- **ID de viagem** e **Rota carregada** (opcionais): valem para todas as linhas, quando a planilha é de um caminhão só.

**2 · 3 Segmentos no JMS**
- Cole o **AuthToken** na barra da esquerda (JMS › F12 › Rede › uma consulta › Cabeçalhos › `authtoken`).
- Clique em **Buscar no JMS**. O app consulta 4 remessas ao mesmo tempo. Se o JMS pedir para ir mais devagar, diminui sozinho.
- **Token vencido:** o app para na hora e avisa. Cole um token novo e clique de novo: o que já veio fica guardado.
- O que o JMS respondeu fica guardado por 12 horas (`data\cache_jms.sqlite3`). Rodar a mesma planilha de novo não consulta de novo.

**3 · Resultado**
- **Cartões:**
  - remessas;
  - na rota errada;
  - taxa de erro (erradas ÷ conferidas);
  - turno com mais erros;
  - pendentes.
- **Painel:**
  - erros por turno (T1 06h–14h · T2 14h–22h · T3 22h–06h), com a % de cada;
  - onde foram carregadas (e a taxa de erro de cada rota);
  - **segmentos errados → rota certa** (cor = rota em que foi carregado);
  - erros no dia;
  - erros por hora.
- **Remessas erradas:** a tabela, com filtro por rota carregada, rota certa e turno, e busca. Traz também os **Detalhes da encomenda**: PDD de saída, Município de Origem, SC Origem, Base Destino, Município de Destino e SC Destino.
- **Por rota e segmento:** quantidade e porcentagem de cada rota e de cada segmento.
- **Pendências:** o que não deu para conferir, e por quê.
- **Planilha de rotas:**
  - as regras em uso;
  - como o app entendeu cada nome de rota da sua planilha.
- **Baixar Excel** (português e mandarim). Abas:
  - Painel (cartões e gráficos);
  - Erradas;
  - Por rota;
  - Por segmento;
  - Turno e dia;
  - Pendências;
  - Regras.

  **As remessas certas não aparecem**: só entram nas contagens.

## Como o app confere

| Rota | Vale | Exemplo |
|---|---|---|
| **Troncal** (干线) | Só o **Código de primeiro segmento** (a sigla). | AC → SP BRE |
| **Secundária** (支线) | O **par** 1º + 2º segmento. | GRU 404-05 → F S-PENHA-SP |
| **DC TBT-SP, DC GRU-SP e SBN** | Estão na tabela troncal, mas seguem a secundária: o **par**. | GRU 402-00 → DC TBT-SP |
| Linha sem 2º Nível (VLANA, NOD) | O 1º segmento. | VLANA → DC S-VLANA-SP |

- Primeiro o app procura o par exato (1º + 2º). Se nenhuma linha tem o par, vale o 1º segmento sozinho. Assim, SP 435-00 vai para a DC S-MOO 02-SP, e um SP qualquer vai para a SP BRE.
- **Remessa ERRADA:** a rota em que foi carregada (Próxima parada) é diferente da rota certa.
- **Nome da rota no JMS × na planilha:**
  - **"PI THE"** = THE e **"DC SBN-SP"** = SBN: o JMS põe o tipo da unidade e a UF a mais.
  - Espaços e traços não contam.
  - **Um nome que não está na planilha não é adivinhado:** vira pendência "Rota carregada fora da planilha". Por exemplo, "F S-PENHA 04-SP" não vira F S-PENHA-SP.

**Pendente** nunca conta como certa nem como errada:

| Pendência | O que fazer |
|---|---|
| Falta buscar o código no JMS | Passo 2. |
| O JMS não tem o código de segmento / Remessa não encontrada | Conferir no JMS. |
| A consulta ao JMS falhou | Buscar de novo (veja o motivo). |
| Segmento / Código fora da planilha de rotas | A planilha de rotas não tem esse código: atualize-a. |
| Rota carregada fora da planilha de rotas | Confira o nome da rota na sua planilha. |
| Sem a rota carregada | Escolha a coluna Próxima parada ou digite a rota. |

## Planilha de rotas

- O app usa, nesta ordem:
  1. a que você enviar na barra da esquerda;
  2. a que você salvou com **Usar esta planilha sempre** (`data\planilha_de_rotas.xlsx`);
  3. `data\ajuste_rotas_docas_24_outubro.xlsx`;
  4. a tabela de 24/10 embutida no app.
- **Formato:** as tabelas vermelhas das docas, como estão:
  - o app acha o cabeçalho ("Rota de Carregamento Após o Ajuste", "1º Nível", "2º Nível", "Novo número da doca", "Observações");
  - entende células mescladas, "（Antigo）/（Novo）", "430—01、05、07" e "DC—BYE";
  - troncal ou secundária: pelo nome da aba ou pelo título (支线 / Regionais = secundária).
- **Docas mudaram?** Edite a planilha, envie e clique em **Usar esta planilha sempre**. A aba **Planilha de rotas** do resultado mostra as regras como o app entendeu.

## O que vem do JMS

- **Consulta:** `POST https://gw.jtjms-br.com/operatingplatform/order/getOrderDetail`, com `{"waybillNo": "<remessa>", "countryId": "1"}`. É a mesma da tela **Rastreamento do pacote › Informação básica**.
- **Cabeçalhos:** os mesmos que o navegador manda (`Routename: trackingExpress`, `Routernamelist`, `Lang`…) e o AuthToken.
- **Campos usados:**

  | Campo do JMS | Vira |
  |---|---|
  | `terminalDispatchCode` | 1º segmento, 2º segmento e 3 Segmentos |
  | `realPickNetworkName` | PDD de saída |
  | `senderCityName` | Município de Origem |
  | `initDistributeName` | SC Origem |
  | `dispatchNetworkName` | Base Destino |
  | `receiverCityName` | Município de Destino |
  | `destinationDistributeName` | SC Destino |

- **Nome, telefone, endereço e CPF** de remetente e destinatário **não são lidos nem guardados**.
- **O AuthToken fica só na sessão aberta do app.** Não é gravado em arquivo nenhum, nem no Excel.

## O que estava errado na versão anterior (e foi corrigido)

1. **A aba "Rotas Regionais" (secundária) era lida com as colunas da troncal.**
   - O app procurava "regional" no nome da aba, e "Regionais" não contém "regional".
   - Resultado: rotas chamadas "GRU", "SP" e "MOO", e códigos como "404-05" virando 1º segmento.
   - Na prática, o exemplo do documento (GRU 404-05 carregada na SP BRE) saía "Pendente" em vez de **errada**. E uma remessa certa (SP 435-00 na DC S-MOO 02-SP) saía **errada** ("esperada SP BRE").
2. **Nomes de rota diferentes entre o JMS e a tabela** ("PI THE" × "THE", "DC SBN-SP" × "SBN") viravam erro falso.
3. **Rota digitada errado** ("SP BREE") marcava todas as remessas como erradas. Agora vira pendência com o nome.
4. **"DC—BYE"** ficava "DC-BYE": o código BYE do JMS não era reconhecido.
5. **Remessa só com o 1º segmento** (troncal) ficava pendente, mesmo podendo ser conferida.
6. **Token vencido:**
   - o JMS responde HTTP 200 com "登录失效";
   - o app antigo não percebia e consultava o lote inteiro;
   - agora para na hora.
7. **Faltavam os cabeçalhos da tela do JMS** (`Routename`, `Routernamelist`, `Lang`): o JMS pode recusar sem eles.
8. **Faltavam os "Detalhes da encomenda"** pedidos no documento (PDD de saída, Municípios, SC Origem/Destino, Base Destino).
9. **CSV não abria:** o app aceitava `.csv`, mas lia como Excel e dava erro.
10. **Remessa como número** (célula numérica ou `.xls`) virava "888002560356352.0" e a consulta falhava.
11. **A coluna "Tempo de digitalização" (lista de carga do JMS) não era reconhecida:** sem turno e sem dia nos gráficos.
12. **Trocar as colunas não mudava o resultado** até clicar em "Analisar rotas" (a análise antiga ficava presa na sessão). Agora o resultado acompanha na hora.
13. **Planilhas grandes:** o cache consultava todas as remessas de uma vez no SQLite e podia dar "too many SQL variables". Agora vai em partes.
14. **Excel:**
    - a taxa de erro era texto ("12.50%") e não ordenava: agora é número com formato %;
    - não tinha a % de cada rota e de cada segmento;
    - não mostrava as regras usadas.

## Abrir de outro computador da rede

Defina uma senha e abra para a rede (cmd):

```
set DASHBOARD_PASSWORD=uma-senha-forte
py -m streamlit run app.py --server.address 0.0.0.0 --server.port 8503
```

Acesse `http://IP-deste-computador:8503`. Não abra a porta no roteador para a internet.

## Arquivos

| Arquivo | O que é |
|---|---|
| `iniciar.py` | Abre o app (instala o que falta na primeira vez). |
| `app.py` | A tela (Streamlit). |
| `expedicao_dash/rotas.py` | Lê a planilha de rotas e diz a rota certa de cada código; tabela de 24/10 embutida. |
| `expedicao_dash/planilha.py` | Lê a planilha de remessas e acha as colunas. |
| `expedicao_dash/jms.py` | Consulta no JMS (cabeçalhos, token vencido, várias ao mesmo tempo) e o JMS de mentira. |
| `expedicao_dash/cache.py` | Respostas do JMS guardadas no computador. |
| `expedicao_dash/analise.py` | Certo / errado / pendente e os totais. |
| `expedicao_dash/relatorio.py` | O Excel. |
| `expedicao_dash/demo.py` | Planilha de exemplo do modo demonstração. |
| `data/` | Planilha de rotas e cache (ficam só no seu computador). |
| `tests/` | Testes: `py -m pytest tests` |
