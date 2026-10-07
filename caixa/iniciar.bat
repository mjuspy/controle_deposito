@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias, aguarde...
  call npm install
)
call npm start
pause
