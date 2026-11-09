@echo off
chcp 65001 >nul
title Controle de Patio - dados do Feishu
cd /d "%~dp0"
rem Node.js: o node.exe desta pasta, o instalado no Windows ou o node.exe do DashMaster (C:\dashmaster\node).
set "NODE="
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
if not defined NODE for /f "delims=" %%p in ('where node 2^>nul') do if not defined NODE set "NODE=%%p"
if not defined NODE if exist "C:\dashmaster\node\node.exe" set "NODE=C:\dashmaster\node\node.exe"
if not defined NODE goto semNode
"%NODE%" patio.js configurar
echo.
pause
exit /b 0

:semNode
echo.
echo   O Node.js nao foi encontrado neste computador.
echo   Baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
echo   Sem administrador: copie o node.exe do DashMaster (C:\dashmaster\node) para esta pasta.
echo.
pause
exit /b 1
