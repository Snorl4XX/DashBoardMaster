@echo off
chcp 65001 >nul
title Link da Expedicao Incorreta (Tailscale) - /expedicao
set "TS=C:\Program Files\Tailscale\tailscale.exe"
if not exist "%TS%" goto semTs
echo.
echo   O link da Expedicao Incorreta fica num CAMINHO NOVO do link principal deste computador:
echo       https://NOME-DO-COMPUTADOR.xxxx.ts.net/expedicao
echo   Nao troca nem ocupa a porta de nenhum outro painel (DashMaster, Sorter e Lotes continuam como estao).
echo.
"%TS%" funnel --bg --https=443 --set-path=/expedicao http://127.0.0.1:3300/expedicao
if errorlevel 1 goto erro
echo.
echo   Links ligados agora neste computador:
echo   -------------------------------------
"%TS%" funnel status
echo.
echo   Pronto. Link da equipe: o endereco https://....ts.net mostrado acima, com /expedicao no fim.
echo   Ele continua ligado depois de fechar esta janela e de reiniciar o computador.
echo   Para desligar so este link: "%TS%" funnel --https=443 --set-path=/expedicao off
echo.
echo   Usou o link-publico.bat da versao 2.0.1 e ele tirou a porta 8443 do Sorter? Rode de novo o link-publico.bat
echo   do Sorter (C:\dashmaster-sorter\node): ele volta para a 8443.
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
