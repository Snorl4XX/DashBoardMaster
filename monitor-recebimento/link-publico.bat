@echo off
rem Monitor de Recebimento - link publico pelo Tailscale Funnel (o mesmo do DashMaster), com /recebimento no fim:
rem https://NOME.ts.net/recebimento. A janela NUNCA fecha sozinha: cada problema mostra o que fazer.
if /i not "%~1"=="--na-janela" (
  cmd /k call "%~f0" --na-janela
  exit /b
)
cd /d "%~dp0"
title Link publico do Monitor de Recebimento (Tailscale Funnel)
echo.
echo   ===== Link publico do Monitor de Recebimento (Tailscale) =====
echo.

rem ---------- 1. Tailscale instalado? ----------
set "TS="
if exist "%ProgramFiles%\Tailscale\tailscale.exe" set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not defined TS if exist "%ProgramFiles(x86)%\Tailscale\tailscale.exe" set "TS=%ProgramFiles(x86)%\Tailscale\tailscale.exe"
if not defined TS for /f "delims=" %%p in ('where tailscale 2^>nul') do if not defined TS set "TS=%%p"
if not defined TS goto semTailscale
echo   [1/4] Tailscale encontrado: %TS%

rem ---------- 2. Porta do painel, porta do link e caminho (config.json; padrao 3600, 443 e /recebimento) ----------
set PORTA=3600
set PORTALINK=443
set "CAMINHO=/recebimento"
where node >nul 2>nul
if errorlevel 1 goto semNode
for /f "tokens=1-3" %%a in ('node "%~dp0lib\link.js" config 2^>nul') do (
  set "PORTA=%%a"
  set "PORTALINK=%%b"
  set "CAMINHO=%%c"
)
if "%CAMINHO%"=="-" set "CAMINHO="
echo   [2/4] Porta do painel: %PORTA% - porta do link: %PORTALINK% - caminho: %CAMINHO%
netstat -an | findstr /r /c:":%PORTA% .*LISTENING" >nul
if errorlevel 1 (
  echo         AVISO: o Monitor nao esta aberto agora. Abra o iniciar.bat depois - o link so mostra o painel com ele aberto.
)

rem ---------- 3. Tailscale ligado e com a conta? ----------
"%TS%" status >nul 2>nul
if not errorlevel 1 goto conectado
echo   [3/4] O Tailscale esta desligado ou sem conta. Tentando ligar...
echo         Se aparecer um link https://login.tailscale.com/... abra no navegador e entre com a sua conta.
echo.
"%TS%" up
if errorlevel 1 goto semConta
"%TS%" status >nul 2>nul
if errorlevel 1 goto semConta
:conectado
echo   [3/4] Tailscale ligado.

rem ---------- 4. Funnel ----------
rem O endereco ja leva para OUTRO painel deste computador? Avisa e pergunta antes de trocar.
node "%~dp0lib\link.js" livre "%TS%" %PORTALINK% %PORTA% %CAMINHO%
if errorlevel 2 goto ocupado
goto funnelPublicar
:ocupado
echo.
choice /c SN /n /m "  Trocar mesmo assim? S = sim, N = nao: "
if errorlevel 2 goto fim
:funnelPublicar
echo   [4/4] Publicando o Monitor na internet (Funnel)...
echo         Na primeira vez aparece um link para AUTORIZAR o Funnel: abra, clique em Enable e espere aqui.
echo.
if defined CAMINHO goto funnelCaminho
if "%PORTALINK%"=="443" goto funnel443
"%TS%" funnel --bg --https=%PORTALINK% %PORTA%
goto funnelFeito
:funnelCaminho
"%TS%" funnel --bg --https=%PORTALINK% --set-path=%CAMINHO% http://127.0.0.1:%PORTA%%CAMINHO%
goto funnelFeito
:funnel443
"%TS%" funnel --bg %PORTA%
:funnelFeito
if errorlevel 1 goto funnelErro
node "%~dp0lib\link.js" limpar "%TS%" %PORTALINK% %PORTA% %CAMINHO%
echo.
"%TS%" funnel status
echo.
echo   PRONTO. O link do Monitor e o endereco https://....ts.net acima com %CAMINHO% no fim.
echo   O painel principal do DashMaster continua no mesmo endereco, sem o %CAMINHO%.
echo   O link nao muda e continua valendo depois de reiniciar o computador (nao precisa deixar esta janela aberta).
echo   Se quiser, coloque-o em "linkPublico" no config.json e defina uma "senha" para o painel.
if defined CAMINHO echo   Para tirar do ar so este link: "%TS%" funnel --https=%PORTALINK% --set-path=%CAMINHO% off
if not defined CAMINHO echo   Para tirar do ar so este link: "%TS%" funnel --https=%PORTALINK% off
goto fim

:semNode
echo   O Node.js nao esta instalado neste computador.
echo   Baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
goto fim

:semTailscale
echo   O Tailscale nao esta instalado neste computador.
echo     1. Instale em https://tailscale.com/download/windows
echo     2. Entre com a sua conta - Google, Microsoft ou e-mail.
echo     3. Abra este arquivo de novo.
goto fim

:semConta
echo.
echo   O Tailscale nao conectou. Faca assim:
echo     1. Menu Iniciar - digite Tailscale - abra.
echo        Ele NAO abre janela: aparece um icone perto do relogio - clique na setinha ^^ ao lado do relogio.
echo     2. Clique no icone do Tailscale - Log in - entre com a sua conta no navegador.
echo     3. Abra este arquivo de novo.
echo   Se a mensagem acima falar em "Access denied" ou "permissao": clique com o botao direito neste arquivo
echo   e escolha "Executar como administrador".
goto fim

:funnelErro
echo.
echo   O Funnel nao foi ligado. Veja a mensagem acima:
echo     - Se apareceu um link: abra no navegador, autorize o Funnel - Enable - e abra este arquivo de novo.
echo     - "Access denied" ou "permissao": botao direito neste arquivo - Executar como administrador.
echo     - "Funnel not available" ou "HTTPS": no site do Tailscale - DNS - ligue MagicDNS e HTTPS Certificates.
echo   Se nao resolver, tire um print desta janela e mande.
goto fim

:fim
echo.
echo   Pode fechar esta janela (X) depois de ler.
exit /b 0
