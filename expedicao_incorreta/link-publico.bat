@echo off
chcp 65001 >nul
title Link da Expedicao Incorreta (Tailscale) - porta 8443
set "TS=C:\Program Files\Tailscale\tailscale.exe"
if not exist "%TS%" goto semTs
echo.
echo   Links do Tailscale ligados agora neste computador:
echo   ------------------------------------------------
"%TS%" funnel status
echo.
"%TS%" funnel status | findstr /C:":8443" >nul
if errorlevel 1 goto ligar
"%TS%" funnel status | findstr /C:"127.0.0.1:3300" >nul
if not errorlevel 1 goto ligar
echo   ATENCAO: a porta 8443 do link ja leva para OUTRO painel (veja acima, por exemplo o Sorter na 3500).
echo   Se trocar, o outro painel sai do link. Para manter os dois, passe o Sorter para o link principal com /sorter
echo   (config.json do Sorter: "portaLink": 443 e "caminho": "/sorter") e rode o link-publico.bat dele.
choice /c SN /m "  Trocar a porta 8443 para a Expedicao Incorreta"
if errorlevel 2 goto fim
:ligar
echo.
echo   Ligando o link da Expedicao Incorreta (8443 -^> http://localhost:3300)...
"%TS%" funnel --bg --https=8443 3300
if errorlevel 1 goto erro
echo.
"%TS%" funnel status
echo.
echo   Pronto. O link da equipe e o endereco https://....ts.net:8443 mostrado acima, com /troncal ou /secundaria no fim.
echo   Ele continua ligado depois de fechar esta janela e de reiniciar o computador.
echo   Para desligar: "%TS%" funnel --https=8443 off
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
