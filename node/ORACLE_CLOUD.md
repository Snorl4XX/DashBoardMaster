# J&T DashMaster na Oracle Cloud (grátis), com Node.js

O painel fica num servidor da Oracle, ligado 24 h, **sem os limites do Google**:
- não tem os 90 min por dia, as 20 mil consultas por dia nem os 6 min por execução;
- **todos os painéis num link só**, inclusive Recebimento e Expedição (fluxo operacional). Não precisa mais de dois projetos nem de duas contas;
- link **https** para a equipe, que abre de qualquer lugar.

**Tempo:** uns 40 minutos.

**O que precisa:**
- um cartão de crédito, só para a Oracle verificar a conta (o plano "Always Free" não cobra);
- o arquivo **`JT_DASHMASTER_V4_12_1_NODE.zip`**;
- um computador com Windows 10 ou 11 (o PowerShell já tem os comandos `ssh` e `scp`);
- o **AuthToken do JMS**.

---

## 1. Criar a conta na Oracle Cloud
1. Abra https://www.oracle.com/br/cloud/free/ e clique em **Comece gratuitamente**.
2. Preencha os dados e confirme o e-mail.
3. Em **Região inicial (Home Region)**, escolha **Brazil East (Sao Paulo)**. Ela **não pode ser trocada depois**.
4. Cadastre o cartão. A Oracle faz uma verificação e não cobra nada no plano grátis.
5. Espere o e-mail avisando que a conta está pronta (pode levar alguns minutos) e entre em https://cloud.oracle.com.

## 2. Criar o servidor
1. Menu **☰ → Compute → Instances → Create instance**.
2. **Name:** `dashmaster`.
3. Em **Image and shape**, clique em **Edit**:
   - **Image → Change image → Ubuntu → Canonical Ubuntu 24.04 → Select image.**
   - **Shape → Change shape → Ampere → VM.Standard.A1.Flex.** Coloque **2 OCPUs** e **12 GB** de memória e clique em **Select shape**. Tem que aparecer a etiqueta **Always Free-eligible**.
4. Em **Networking**, deixe criar a rede nova, com **sub-rede pública** e **Assign a public IPv4 address** ligado.
5. Em **Add SSH keys**, escolha **Generate a key pair for me** e clique em **Save private key**.
   - Guarde o arquivo `.key` numa pasta, por exemplo `C:\DashMaster\`, e troque o nome para `chave.key`.
   - **Sem esse arquivo você não entra no servidor.** Não mande para ninguém.
6. Deixe o resto como está e clique em **Create**.
7. Em 1 a 2 minutos o servidor fica **Running**. Anote o **Public IP address** (exemplo: `129.151.10.20`).

**Se aparecer "Out of capacity for shape VM.Standard.A1.Flex":** falta vaga na região. Tente outro **Availability domain** (se tiver) ou tente de novo mais tarde, de madrugada costuma ter vaga. **Não** escolha outro shape: pode ser pago.

## 3. Entrar no servidor
Nos comandos abaixo, troque **`IP`** pelo Public IP address do passo 2.

1. Abra o **PowerShell** no seu computador.
2. Proteja a chave (o `ssh` recusa uma chave que outros usuários do Windows podem ler):
   ```
   icacls C:\DashMaster\chave.key /inheritance:r
   icacls C:\DashMaster\chave.key /grant:r "$($env:USERNAME):(R)"
   ```
3. Entre no servidor:
   ```
   ssh -i C:\DashMaster\chave.key ubuntu@IP
   ```
   Na primeira vez ele pergunta se confia no servidor: digite `yes` e tecle Enter.
4. A linha muda para `ubuntu@dashmaster:~$`. Agora o que você digitar roda **no servidor**.

## 4. Mandar o painel para o servidor
1. Abra **outra janela** do PowerShell, no seu computador, e envie o ZIP:
   ```
   scp -i C:\DashMaster\chave.key C:\DashMaster\JT_DASHMASTER_V4_12_1_NODE.zip ubuntu@IP:~/
   ```
2. Na janela do **servidor**, extraia:
   ```
   sudo apt-get update && sudo apt-get install -y unzip
   unzip -o JT_DASHMASTER_V4_12_1_NODE.zip
   ```
   Isso cria a pasta `~/dashmaster`.

## 5. Instalar
Na janela do servidor:
```
cd ~/dashmaster/node
bash instalar-oracle.sh
```
O instalador:
- acerta o fuso de São Paulo;
- instala o Node.js 22;
- cria o serviço que liga o painel sozinho e reinicia se ele parar.

No fim ele pergunta três coisas:
1. **AuthToken do JMS.** Cole com o **botão direito** do mouse e tecle Enter. O token não aparece na tela. Em seguida ele testa a conexão com o JMS.
2. **Data inicial do histórico,** por exemplo `2026-09-01`. Enter usa o dia 1º do mês atual.
3. **Como atualizar:**
   - `1` = agenda: painéis do dia às 6h e 8h, Sem Movimentação a cada 2 h, como ficou no Google;
   - `2` = contínuo: a cada minuto, o dia todo, porque aqui não há cota.

   Nos dois, o botão **Atualizar** atualiza todos os painéis na hora.

Para conferir:
```
node dashmaster.js status
```
Tem que mostrar `AuthToken: cadastrado` e a fila andando.

## 6. Link para a equipe
Na janela do servidor:
```
bash link-publico.sh
```
1. Aparece um link `https://login.tailscale.com/…`. Abra no navegador do seu computador e crie uma conta Tailscale com Google, Microsoft ou e-mail. É grátis.
2. Na primeira vez aparece **outro link, para autorizar o Funnel**. Abra e clique em **Enable**. Se o comando parar com erro, rode `bash link-publico.sh` de novo.
3. Ele pede uma **senha para o painel.** Recomendo pôr uma, porque o painel mostra nomes de operadores. Cada pessoa digita a senha uma vez; o navegador lembra por 30 dias.
4. No fim aparece o link, algo como **`https://dashmaster.tail1234.ts.net`**. Mande esse link para a equipe.

Não precisa abrir nenhuma porta na Oracle: o Tailscale sai do servidor para fora.

## 7. Tela Configurações, pelo seu computador
A tela Configurações (AuthToken, propriedades, executar funções) **só abre no próprio servidor**. Pelo link da equipe ela fica bloqueada.

Para abrir do seu computador:
1. Abra um túnel no PowerShell e **deixe a janela aberta**:
   ```
   ssh -i C:\DashMaster\chave.key -L 3000:localhost:3000 ubuntu@IP
   ```
2. No navegador, abra **http://localhost:3000/config**.
3. Para fechar, feche a janela do túnel.

Tudo o que a tela faz também dá para fazer por comando, no servidor, dentro de `~/dashmaster/node`:

| Para… | Comando |
|---|---|
| Trocar o AuthToken vencido | `node dashmaster.js token` |
| Ver a fila e o token | `node dashmaster.js status` |
| Testar o JMS | `node dashmaster.js executar diagnosticarConexaoJms` |
| Conferir os IDs de saída do SC → DC | `node dashmaster.js executar diagnosticarViagensSCDC` |
| Mudar o modo de atualização | `node dashmaster.js propriedade MODO_ATUALIZACAO diario` (ou `continuo`) |
| Ver o que o painel está fazendo | `sudo journalctl -u dashmaster -f` (Ctrl+C sai) |
| Reiniciar o painel | `sudo systemctl restart dashmaster` |

## 8. Desligar o Google
Depois que o painel da Oracle estiver com os dados, desligue a coleta nos projetos do Apps Script: abra cada projeto (o principal e o dos fluxos) e execute **`removeProjectTriggers`**. Assim o JMS não é consultado duas vezes. Os links antigos continuam abrindo, só param de atualizar.

## 9. Atualizar para uma versão nova
1. No seu computador:
   ```
   scp -i C:\DashMaster\chave.key C:\DashMaster\JT_DASHMASTER_<versão>_NODE.zip ubuntu@IP:~/
   ```
2. No servidor:
   ```
   unzip -o JT_DASHMASTER_<versão>_NODE.zip && sudo systemctl restart dashmaster
   ```

Os dados (`node/dados`) e o `config.json` não vêm no ZIP, então continuam como estão.

## 10. Cópia de segurança
De vez em quando, faça uma cópia dos dados:
1. No servidor:
   ```
   tar czf ~/backup-dashmaster.tgz -C ~/dashmaster/node dados config.json
   ```
2. No seu computador:
   ```
   scp -i C:\DashMaster\chave.key ubuntu@IP:~/backup-dashmaster.tgz C:\DashMaster\
   ```

## 11. Cuidados com o plano grátis da Oracle
- **Fique em 2 OCPUs e 12 GB** de servidores Ampere no total. Em 2026 a Oracle reduziu o grátis para esse tamanho e avisou que servidores acima dele podem ser desligados.
- **Servidor "parado" pode ser recolhido.** A Oracle pode recolher um servidor Always Free que passe 7 dias com processador, rede e memória abaixo de 20%, e o painel usa pouco. Para não correr esse risco:
  - depois que tudo funcionar, mude a conta para **Pay As You Go** (☰ → Billing & Cost Management → Upgrade and Manage Payment). Os recursos Always Free continuam grátis; só seria cobrado o que passasse do grátis;
  - crie um aviso de gasto em ☰ → Billing & Cost Management → **Budgets**, por exemplo de R$ 1, para receber um e-mail se algo começar a cobrar.
- **Faça a cópia de segurança** (seção 10).

## 12. Relatório em PDF (opcional)
O relatório em Excel funciona sem nada. Para o PDF, o servidor precisa de um navegador:
1. Instale o Chromium:
   ```
   sudo snap install chromium
   ```
2. No `~/dashmaster/node/config.json`, coloque `"navegadorPdf": "/snap/bin/chromium"`.
3. Reinicie: `sudo systemctl restart dashmaster`.

## 13. Problemas comuns
| Mensagem | O que fazer |
|---|---|
| `Permissions for 'chave.key' are too open` | Rode os dois comandos `icacls` do passo 3 |
| `Connection timed out` no `ssh` | Confira o IP e se o servidor está **Running** na Oracle |
| O link da equipe não abre | No servidor: `sudo systemctl status dashmaster` e `sudo tailscale funnel status` |
| `Out of capacity` ao criar o servidor | Falta vaga na região: tente outro Availability domain ou mais tarde |
| O painel diz que o JMS recusou o AuthToken | `node dashmaster.js token` com o token novo |
| O teste do JMS falha só no servidor da Oracle (no Google funcionava) | Rode `node dashmaster.js executar diagnosticarConexaoJms` e me mande o resultado (sem o token) |
