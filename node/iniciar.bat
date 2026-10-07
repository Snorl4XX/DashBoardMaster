@echo off
chcp 65001 >nul
title J^&T DashMaster (Node.js)
cd /d "%~dp0"
rem Se a empresa usa proxy para sair na internet, apague o "rem" das duas linhas abaixo e troque o endereco do proxy:
rem set HTTPS_PROXY=http://proxy.da.empresa:8080
rem set NODE_USE_ENV_PROXY=1
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   O Node.js nao esta instalado neste computador.
  echo   Baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)
:inicio
node server.js
echo.
echo   O servidor parou. Ele reinicia sozinho em 10 segundos.
echo   Para encerrar de vez, feche esta janela.
timeout /t 10 /nobreak >nul
goto inicio
