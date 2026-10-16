@echo off
chcp 65001 >nul
title J^&T Painel do Sorter
cd /d "%~dp0"
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
echo   O painel do sorter parou. Ele reinicia sozinho em 10 segundos.
echo   Para encerrar de vez, feche esta janela.
timeout /t 10 /nobreak >nul
goto inicio
