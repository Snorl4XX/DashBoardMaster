@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Instalando o JMS Analisador (precisa de internet so nesta vez)...
where py >nul 2>nul && (set PY=py) || (set PY=python)
%PY% -m pip install --upgrade pip
if errorlevel 1 goto erro
%PY% -m pip install -r requirements.txt
if errorlevel 1 goto erro
echo.
echo Pronto! Agora de dois cliques em iniciar.bat.
pause
exit /b 0
:erro
echo.
echo A instalacao nao terminou. Confira a internet e se o Python 3.10+ esta instalado (marque "Add Python to PATH").
pause
exit /b 1
