@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ALVO=%~dp0iniciar.bat"
set "PASTA=%~dp0"
set "ATALHO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\JT DashMaster.lnk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:ATALHO); $s.TargetPath=$env:ALVO; $s.WorkingDirectory=$env:PASTA; $s.WindowStyle=7; $s.Save()"
if errorlevel 1 (
  echo   Nao consegui criar o atalho. Crie manualmente um atalho do iniciar.bat na pasta:
  echo   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
) else (
  echo   Pronto: o DashMaster vai abrir sozinho (minimizado) quando este usuario entrar no Windows.
  echo   Para desfazer, apague o atalho "JT DashMaster" da pasta Inicializar.
)
echo.
pause
