@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul && (set PY=py) || (set PY=python)
rem Exemplo: pesquisar_cmd.bat --remessas remessas.txt --texto "A encomenda expressa esta [SP GRU] sendo enviada" --segmentos
%PY% jms_cli.py %*
pause
