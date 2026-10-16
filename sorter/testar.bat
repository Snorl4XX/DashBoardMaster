@echo off
chcp 65001 >nul
title J^&T Painel do Sorter - teste
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo   O Node.js nao esta instalado neste computador. Baixe a versao LTS em https://nodejs.org
  pause
  exit /b 1
)
echo   Lendo o sorter agora...
echo.
node server.js --teste
echo.
pause
