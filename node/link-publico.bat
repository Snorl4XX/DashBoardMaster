@echo off
rem JT DashMaster - link publico do painel pelo Tailscale Funnel (gratis, endereco https fixo).
rem V4.17.1: a janela NUNCA fecha sozinha. Cada problema mostra o que fazer e espera uma tecla (antes, um erro do Tailscale
rem podia fechar a janela antes de dar para ler). Sem "chcp 65001": no Windows 7/8 ele fazia o .bat parar no meio.
cd /d "%~dp0"
title Link publico do DashMaster (Tailscale Funnel)
echo.
echo   ===== Link publico do DashMaster (Tailscale) =====
echo.

rem ---------- 1. Tailscale instalado? ----------
set "TS="
if exist "%ProgramFiles%\Tailscale\tailscale.exe" set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not defined TS if exist "%ProgramFiles(x86)%\Tailscale\tailscale.exe" set "TS=%ProgramFiles(x86)%\Tailscale\tailscale.exe"
if not defined TS for /f "delims=" %%p in ('where tailscale 2^>nul') do if not defined TS set "TS=%%p"
if not defined TS goto semTailscale
echo   [1/4] Tailscale encontrado: %TS%

rem ---------- 2. Porta do painel (config.json) ----------
set PORTA=3000
if exist config.json for /f "tokens=2 delims=:, " %%a in ('findstr /c:"\"porta\"" config.json') do set PORTA=%%a
echo   [2/4] Porta do painel: %PORTA%
netstat -an | findstr /r /c:":%PORTA% .*LISTENING" >nul
if errorlevel 1 (
  echo         AVISO: o painel nao esta aberto agora. Abra o atalho DashMaster depois - o link so mostra o painel com ele aberto.
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
echo   [4/4] Publicando o painel na internet (Funnel)...
echo         Na primeira vez aparece um link para AUTORIZAR o Funnel: abra, clique em Enable e espere aqui.
echo.
"%TS%" funnel --bg %PORTA%
if errorlevel 1 goto funnelErro
echo.
"%TS%" funnel status
echo.
echo   PRONTO. O endereco https://....ts.net acima e o LINK PUBLICO do painel.
echo   Ele nao muda e continua valendo depois de reiniciar o computador (nao precisa deixar esta janela aberta).
echo   Coloque-o em "linkPublico" no config.json e defina uma "senha" para o painel.
echo   Para tirar do ar: "%TS%" funnel reset
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
echo   Pressione qualquer tecla para fechar.
pause >nul
