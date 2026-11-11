@echo off
chcp 65001 >nul
title Link da Expedicao Incorreta (Tailscale) - porta 10000
set "TS=C:\Program Files\Tailscale\tailscale.exe"
if not exist "%TS%" goto semTs
echo.
echo   O link da Expedicao Incorreta fica na porta 10000 (no lugar do painel de Lotes):
echo       https://NOME-DO-COMPUTADOR.xxxx.ts.net:10000
echo   DashMaster (443) e Sorter (8443) continuam como estao.
echo.
rem Desliga o link /expedicao da versao 2.0.2, se estiver ligado (sem erro se nao estiver).
"%TS%" funnel --https=443 --set-path=/expedicao off >nul 2>nul
"%TS%" funnel --bg --https=10000 3300
if errorlevel 1 goto erro
echo.
echo   Links ligados agora neste computador:
echo   -------------------------------------
"%TS%" funnel status
echo.
echo   Pronto. Link da equipe: https://....ts.net:10000 (o endereco mostrado acima), com /troncal ou /secundaria no fim.
echo   Ele continua ligado depois de fechar esta janela e de reiniciar o computador.
echo   O painel de Lotes continua funcionando neste computador (http://localhost:3400), sem o link publico.
goto fim
:erro
echo.
echo   O Tailscale nao ligou o link (mensagem acima). Confira se o Tailscale esta aberto e conectado (icone perto do relogio).
goto fim
:semTs
echo.
echo   O Tailscale nao esta instalado em "C:\Program Files\Tailscale". Instale em https://tailscale.com/download e entre na conta.
:fim
echo.
pause
