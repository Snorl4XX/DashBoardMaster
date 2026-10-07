@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Link publico do DashMaster (Tailscale Funnel)
set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if not exist "%TS%" (
  echo.
  echo   O Tailscale nao esta instalado neste computador.
  echo   1^) Instale em https://tailscale.com/download/windows
  echo   2^) Entre com sua conta ^(Google, Microsoft ou e-mail^)
  echo   3^) Abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)
set PORTA=3000
if exist config.json for /f "tokens=2 delims=:, " %%a in ('findstr /c:"\"porta\"" config.json') do set PORTA=%%a
echo.
echo   Publicando o painel (porta %PORTA%) na internet com o Tailscale Funnel...
echo.
"%TS%" funnel --bg %PORTA%
if errorlevel 1 (
  echo.
  echo   Nao deu certo ainda. Se apareceu um link acima, abra-o no navegador, autorize o Funnel
  echo   na sua conta do Tailscale e abra este arquivo de novo. Se pedir permissao, clique com o
  echo   botao direito neste arquivo e escolha "Executar como administrador".
  echo.
  pause
  exit /b 1
)
echo.
"%TS%" funnel status
echo.
echo   Pronto. O endereco https://....ts.net acima e o LINK PUBLICO do painel: ele nao muda e
echo   continua valendo depois de reiniciar o computador.
echo   Coloque-o em "linkPublico" no config.json e defina uma "senha" para o painel.
echo   Para tirar do ar:  "%TS%" funnel reset
echo.
pause
