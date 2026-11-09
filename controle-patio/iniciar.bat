@echo off
chcp 65001 >nul
title Controle de Patio SP GRU (Node.js)
cd /d "%~dp0"
rem Se a empresa usa proxy para sair na internet, apague o "rem" das duas linhas abaixo e troque o endereco do proxy:
rem set HTTPS_PROXY=http://proxy.da.empresa:8080
rem set NODE_USE_ENV_PROXY=1
rem Node.js: o node.exe desta pasta, o instalado no Windows ou o node.exe do DashMaster (C:\dashmaster\node).
set "NODE="
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
if not defined NODE for /f "delims=" %%p in ('where node 2^>nul') do if not defined NODE set "NODE=%%p"
if not defined NODE if exist "C:\dashmaster\node\node.exe" set "NODE=C:\dashmaster\node\node.exe"
if not defined NODE goto semNode
rem Primeira vez: pede os dados do Feishu (os das Propriedades do script do Apps Script).
"%NODE%" patio.js pronto
if errorlevel 1 (
  echo.
  echo   Falta cadastrar os dados do Feishu. Vamos fazer isso agora.
  "%NODE%" patio.js configurar
)
:inicio
"%NODE%" server.js
echo.
echo   O servidor parou. Ele reinicia sozinho em 10 segundos.
echo   Para encerrar de vez, feche esta janela.
timeout /t 10 /nobreak >nul
goto inicio

:semNode
echo.
echo   O Node.js nao foi encontrado neste computador.
echo   Baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
echo   Sem administrador: copie o node.exe do DashMaster (C:\dashmaster\node) para esta pasta.
echo.
pause
exit /b 1
