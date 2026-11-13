@echo off
chcp 65001 >nul
title Link do Rota Certa (Tailscale) - https://...ts.net/rota-certa
set "TS=C:\Program Files\Tailscale\tailscale.exe"
if not exist "%TS%" goto semTs
echo.
echo   O link do Rota Certa fica no mesmo endereco do DashMaster, com /rota-certa no fim:
echo       https://NOME-DO-COMPUTADOR.xxxx.ts.net/rota-certa
echo   DashMaster (443), Sorter (8443) e o link da porta 10000 continuam como estao.
echo.
"%TS%" funnel --bg --https=443 --set-path=/rota-certa http://127.0.0.1:3800/rota-certa
if errorlevel 1 goto erro
echo.
echo   Links ligados agora neste computador:
echo   -------------------------------------
"%TS%" funnel status
echo.
echo   Pronto. Link da equipe: https://....ts.net/rota-certa (o endereco mostrado acima).
echo   Ele continua ligado depois de fechar esta janela e de reiniciar o computador.
echo   Para desligar so este link: "%TS%" funnel --https=443 --set-path=/rota-certa off
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
