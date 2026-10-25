@echo off
chcp 65001 >nul
cd /d "%~dp0"
title JMS Analisador - deixe esta janela aberta
where py >nul 2>nul && (set PY=py) || (set PY=python)
%PY% iniciar.py
