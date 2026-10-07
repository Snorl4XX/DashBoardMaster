# J&T DashMaster em Node.js: o mesmo painel, sem o limite do Google

Esta pasta roda o **mesmo painel** (os mesmos arquivos `.gs` e `.html`) num computador da base, sem o Google Apps Script.

**O que muda:**
- **Sem cota diária.** Acabam os 90 min/dia de gatilhos, as 20 mil consultas/dia e os 6 min por execução.
- **Coleta contínua.** A fila do JMS roda a cada 1 minuto, o dia inteiro.
- **O painel fica igual:** cartões, gráficos, Maomao, tema escuro, PT-BR/中文, relatórios.
- **Mais rápido.** Cada consulta do painel responde em milissegundos, em vez de segundos.
- **Os dados ficam no computador,** na pasta `node/dados`. Nada vai para o Google.

O único limite que sobra é o do próprio JMS (100 linhas por página).

---

## 1. O que precisa

- **Um computador que fique ligado**, de preferência 24 h. Windows 10/11 serve; Linux e Mac também.
- **Node.js 22.13 ou mais novo.** Baixe a versão **LTS** em https://nodejs.org e instale com as opções padrão.
- **Para o relatório em PDF:** Microsoft Edge ou Google Chrome. O Edge já vem no Windows. O relatório em Excel funciona sem nada.

## 2. Instalar (Windows)

1. Extraia o ZIP numa pasta fixa, por exemplo `C:\DashMaster`.
   - Os arquivos `.gs` e `.html` ficam na pasta principal.
   - A pasta `node` fica dentro dela.
2. Abra a pasta `node` e dê **dois cliques em `iniciar.bat`**.
   - Uma janela preta abre e mostra os endereços do painel.
   - **Deixe essa janela aberta**: fechar a janela desliga o painel.
3. Se o Windows perguntar sobre o **Firewall**, permita em **Redes privadas**. Assim os outros computadores e celulares da rede conseguem abrir o painel.
4. **Neste computador**, abra **http://localhost:3000/config** (tela Configurações) e:
   1. cole o **AuthToken do JMS** e clique em **Salvar e testar a conexão**;
   2. escolha a **Data inicial** (primeiro dia que o painel deve baixar) e clique em **Salvar data**;
   3. clique em **Baixar histórico**. A fila baixa tudo sozinha, sem limite diário.
5. Abra o painel:
   - **neste computador:** http://localhost:3000
   - **outros computadores e celulares na mesma rede:** `http://IP-DESTE-COMPUTADOR:3000`. O endereço aparece na janela preta e na tela Configurações.

### Abrir sozinho quando o Windows ligar

1. Dê dois cliques em **`iniciar-com-windows.bat`**. Ele cria um atalho na pasta Inicializar do Windows: quando esse usuário entrar no Windows, o painel abre minimizado.
2. Em **Configurações do Windows → Sistema → Energia**, deixe **"Suspender" em "Nunca"**. Computador suspenso não coleta.

Para rodar mesmo **sem ninguém entrar no Windows**, use o **Agendador de Tarefas**:
1. Crie uma tarefa **"Ao iniciar o computador"**.
2. Em **Ação**, coloque o `iniciar.bat`.
3. Marque **"Executar estando o usuário conectado ou não"**.

## 3. Uso no dia a dia

| O que fazer | Onde |
|---|---|
| **AuthToken venceu** (o painel avisa que o JMS não aceita o token) | Gere um novo no JMS → **Configurações → AuthToken do JMS** → Salvar. A fila recomeça sozinha. |
| Ver se a fila está andando | Configurações → **Situação** (ou a janela preta) |
| Rodar um diagnóstico (`diagnosticarConexaoJms`, `diagnosticarAvaria`…) | Configurações → **Executar função**: igual ao ▶ Executar do Apps Script |
| Mudar uma propriedade (ex.: `JMS_PARALLEL`) | Configurações → **Propriedades**: as mesmas "Propriedades do script" do Apps Script |
| Relatório PDF / Excel | Botão **Baixar relatório** do painel, como antes |

A tela Configurações **só abre no próprio computador do servidor** (http://localhost:3000/config). Para abrir de outro lugar, defina `senhaConfig` no `config.json` (veja a seção 4).

Os mesmos comandos também funcionam sem navegador. Abra o Prompt na pasta `node` e use:

```
node dashmaster.js token                           (pede o AuthToken e testa)
node dashmaster.js executar diagnosticarConexaoJms
node dashmaster.js propriedade DATA_START_DATE 2026-09-01
node dashmaster.js status
```

## 4. Configuração (`node/config.json`)

O arquivo é criado na primeira vez que o servidor abre. Edite-o com o Bloco de Notas e reinicie o servidor (feche a janela e abra o `iniciar.bat` de novo).

| Campo | Padrão | Para que serve |
|---|---|---|
| `porta` | `3000` | Porta do endereço do painel |
| `host` | `0.0.0.0` | `0.0.0.0` aceita acesso pela rede; `127.0.0.1` só deste computador |
| `senha` | vazio | Senha para abrir o painel. Vazio = qualquer um com o link abre (como o link do Google) |
| `senhaConfig` | vazio | Senha da tela Configurações. Vazio = ela só abre neste computador |
| `pastaDados` | `./dados` | Onde ficam o banco e os arquivos baixados |
| `filaCadaSegundos` | `60` | De quanto em quanto tempo a fila do JMS roda |
| `trabalhadores` | `3` | Quantas consultas do painel rodam ao mesmo tempo |
| `navegadorPdf` | vazio | Caminho do Edge/Chrome para o PDF. Vazio = procura sozinho |
| `linkPublico` | vazio | O link público do painel (seção 5), para aparecer na janela e em Configurações |

Para abrir o painel de fora da base, veja a seção 5 (link público).

## 5. Link público (como o link do Google)

Sozinho, o servidor só abre na rede da base. Para ter um **link `https://` que abre de qualquer lugar** (casa, 4G, outra base), use o **Tailscale Funnel**:
- É grátis.
- O link é **fixo** e continua valendo depois de reiniciar o computador.
- O cadeado (https) é automático.
- Não precisa comprar domínio nem mexer no roteador.

1. Instale o Tailscale neste computador: https://tailscale.com/download/windows.
2. Entre com uma conta Google, Microsoft ou e-mail.
3. Dê dois cliques em **`link-publico.bat`** (pasta `node`).
   - Na primeira vez, ele mostra um link para **autorizar o Funnel** na sua conta. Abra o link, autorize e rode o `link-publico.bat` de novo.
   - Se pedir permissão, clique com o botão direito no arquivo → **Executar como administrador**.
4. O `link-publico.bat` mostra o endereço, algo como **`https://nome-do-computador.nome-da-conta.ts.net`**. Esse é o link público do painel.
5. No `config.json`, coloque esse endereço em `"linkPublico"` e escolha uma **`"senha"`**. Depois reinicie o servidor.
   - O link aparece na janela e em Configurações.
   - Quem abrir o painel de fora vai precisar da senha.

Para tirar o link do ar, rode no Prompt: `"C:\Program Files\Tailscale\tailscale.exe" funnel reset`.

**Segurança:**
- A tela **Configurações nunca abre pelo link público**, mesmo sem `senhaConfig`. O servidor reconhece pedidos vindos de túnel, e a tela só abre no próprio computador (ou com `senhaConfig`).
- Sem `senha`, o painel fica aberto para quem tiver o link, como era o link do Google. A janela do servidor avisa quando isso acontece.
- **Não** abra a porta direto no roteador.

**Outras opções:**
- **Cloudflare Tunnel:** link fixo, mas precisa de conta e de um domínio próprio. Sem domínio, o link `trycloudflare.com` muda toda vez que reinicia e serve só para teste.
- **Hospedar numa VPS:** um servidor na nuvem, pago por mês.


## 6. Atualizar para uma versão nova do painel

1. Feche a janela do servidor.
2. Substitua **todos os arquivos do ZIP novo** (os `.gs`, os `.html` e a pasta `node`), **menos a pasta `node/dados` e o arquivo `node/config.json`**.
3. Abra o `iniciar.bat` de novo.

Se você trocar só os `.gs`/`.html`, o servidor recarrega sozinho em poucos segundos.

**Cópia de segurança:** copie a pasta `node/dados` (com o servidor fechado). Ela guarda tudo: banco, listas baixadas, relatórios e a configuração das Propriedades.

## 7. Diferenças em relação ao Google

- **Os dados do Google não vêm junto.** O painel baixa de novo do JMS a partir da **Data inicial**, sem limite, então isso é rápido.
- **O relatório Excel sai sem os gráficos.** Ele tem os dados, as cores e os formatos. O PDF tem os gráficos.
- **O PDF precisa do Edge ou do Chrome** no computador.
- **O computador precisa ficar ligado.** Desligado, a fila para; ao religar, ela continua de onde parou.

## 8. Problemas comuns

| Mensagem | O que fazer |
|---|---|
| "precisa do Node.js 22.13 ou mais novo" | Instale a versão LTS de https://nodejs.org |
| "A porta 3000 já está em uso" | O servidor já está aberto em outra janela. Feche-a ou troque `porta` no `config.json` |
| Outro computador não abre o painel | Firewall do Windows: permita o Node.js em redes privadas. Confira o IP na janela preta |
| "Sessão do JMS expirada…" | Novo AuthToken em Configurações |
| "Falha de rede ao consultar o JMS" (e o JMS abre no navegador) | A empresa usa proxy: no `iniciar.bat`, tire o `rem` das linhas `set HTTPS_PROXY=…` e `set NODE_USE_ENV_PROXY=1` e coloque o endereço do proxy |
| PDF não sai | Use o Excel ou informe `navegadorPdf` com o caminho do `msedge.exe` |

Se a página ficar em branco, abra a janela preta: o erro aparece lá e também em `node/dados/servidor.log`.

## 9. Para a TI (como funciona)

- **Mesmo código do Apps Script.** O servidor (`server.js`) carrega os mesmos arquivos do Apps Script. Cada chamada roda num ambiente novo do Node (`vm`), como uma execução do Apps Script.
- **Serviços do Google trocados por versões locais:**

  | Serviço do Google | Versão local |
  |---|---|
  | `SpreadsheetApp` | SQLite embutido no Node (`node:sqlite`). Cada aba é uma tabela, uma linha por linha da aba |
  | `DriveApp` | `dados/arquivos` |
  | `UrlFetchApp` | `fetch` do Node, síncrono via `worker_threads` + `Atomics.wait` |
  | `PropertiesService`, `CacheService` e `LockService` | SQLite |
  | `HtmlService` | Monta o `Index.html` |
  | Gatilhos | Agendador interno: fila a cada `filaCadaSegundos`, `syncHourly` de hora em hora, `auditYesterday` às 7h |

- **Execução em processos leves.** As consultas da página rodam em `trabalhadores` processos leves (`worker_threads`). A fila do JMS tem um processo só para ela, então nada trava a página. Uma execução que passa do tempo é encerrada, e os bloqueios dela são liberados.
- **Segurança:**
  - O AuthToken fica só no servidor e nunca vai para o navegador.
  - A página só pode chamar as funções que o `Client.html` usa. Pedidos de outros sites são recusados (Origin/CSRF).
  - As senhas são opcionais, com cookie assinado.
- **Testes:**
  - `node node/test/test_node.js` sobe um JMS simulado por HTTP e confere que o painel no Node.js dá **exatamente os mesmos números** da simulação do Apps Script em seis indicadores. Também testa a página, a segurança, a senha e os relatórios.
  - Para testar também o PDF, defina `DASHMASTER_TEST_BROWSER` com o caminho do Chrome.
  - `node tests/test_backend.js` continua testando o código do painel.
- **Não precisa de `npm install`:** só módulos nativos do Node.js.
