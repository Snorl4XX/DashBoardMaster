@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul && (set PY=py) || (set PY=python)
rem O iniciar.py instala o que falta e abre o app; este .bat so chama ele.
%PY% iniciar.py
