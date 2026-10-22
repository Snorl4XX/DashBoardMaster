@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Instalando dependencias do app JMS Segmentos...
py -m pip install --upgrade pip
if errorlevel 1 goto erro
py -m pip install -r requirements.txt
if errorlevel 1 goto erro
py -m playwright install chromium
if errorlevel 1 goto erro
echo.
echo Instalacao concluida. Agora execute iniciar.bat.
pause
exit /b 0
:erro
echo.
echo A instalacao nao foi concluida. Confira a conexao e se o Python esta instalado.
pause
exit /b 1
