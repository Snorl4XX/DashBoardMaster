@echo off
chcp 65001 >nul
title J^&T Painel do Sorter - descobrir a troca de sorter
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo   O Node.js nao esta instalado neste computador. Baixe a versao LTS em https://nodejs.org
  pause
  exit /b 1
)
echo   Procurando na pagina do sorter como trocar entre o Sorter A e o Sorter B...
echo.
node server.js --descobrir
echo.
echo   Se nao achou, mande o arquivo descoberta.txt desta pasta (ele nao tem token nem cookie).
pause
