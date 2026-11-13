@echo off
chcp 65001 >nul
title Rota Certa SP GRU (Node.js) - porta 3800
cd /d "%~dp0"
rem Se a empresa usa proxy para sair na internet, apague o "rem" das duas linhas abaixo e troque o endereco do proxy:
rem set HTTPS_PROXY=http://proxy.da.empresa:8080
rem set NODE_USE_ENV_PROXY=1
rem Node.js: o node.exe desta pasta, o instalado no Windows (o mesmo do DashMaster) ou C:\dashmaster\node\node.exe.
set "NODE="
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
if not defined NODE for /f "delims=" %%p in ('where node 2^>nul') do if not defined NODE set "NODE=%%p"
if not defined NODE if exist "C:\dashmaster\node\node.exe" set "NODE=C:\dashmaster\node\node.exe"
if not defined NODE goto semNode
echo.
echo   Node.js: %NODE%
rem Erro ao abrir: a janela continua aberta por este arquivo (ele reinicia o servidor), sem a pausa do server.js.
set ROTA_SEM_PAUSA=1
:inicio
"%NODE%" server.js
echo.
echo   O app parou (o motivo esta logo acima). Ele reinicia sozinho em 10 segundos.
echo   Para encerrar de vez, feche esta janela.
timeout /t 10 /nobreak >nul
goto inicio

:semNode
echo.
echo   O Node.js nao foi encontrado neste computador.
echo   O DashMaster usa o Node.js instalado no Windows: se ele abre neste computador, abra este arquivo pelo mesmo usuario.
echo   Sem Node.js: baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
echo   Sem administrador: copie um node.exe (22.13 ou mais novo) para esta pasta.
echo.
pause
exit /b 1
