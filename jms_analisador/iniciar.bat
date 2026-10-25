@echo off
chcp 65001 >nul
cd /d "%~dp0"
title JMS Analisador - deixe esta janela aberta
where py >nul 2>nul && (set PY=py) || (set PY=python)
echo Abrindo o JMS Analisador em http://localhost:8501 ...
echo Para fechar o app, feche esta janela.
%PY% -m streamlit run app.py
if errorlevel 1 (echo. & echo Nao abriu. Rode instalar.bat primeiro. & pause)
