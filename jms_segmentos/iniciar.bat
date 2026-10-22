@echo off
chcp 65001 >nul
cd /d "%~dp0"
set JMS_SEGMENTOS_ALLOWED_ORIGINS=https://jms-segmentos.caikeoliveiradealenc.chatgpt.site
start "JMS Segmentos - servidor" cmd /k "py -m uvicorn app:app --host 127.0.0.1 --port 8765 --log-level warning"
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:8765
