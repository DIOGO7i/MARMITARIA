@echo off
cd /d "%~dp0"
title Marmitaria - NAO FECHE ESTA JANELA
echo.
echo  ==========================================
echo   SISTEMA DA MARMITARIA
echo  ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  O Node.js nao foi encontrado.
  echo  Instale em https://nodejs.org e tente de novo.
  pause
  exit /b
)
set /p VERSAO=<VERSION
if not exist node_modules\.instalado-v%VERSAO% (
  echo  Instalando ou atualizando. Pode levar alguns minutos...
  call npm install
  if errorlevel 1 goto erro
  echo ok> node_modules\.instalado-v%VERSAO%
)
if not exist web\dist\.versao-%VERSAO% (
  echo  Preparando as telas...
  call npm run build
  if errorlevel 1 goto erro
  echo ok> web\dist\.versao-%VERSAO%
)
echo.
echo  Tudo pronto! O sistema vai abrir no navegador.
echo  Para usar, DEIXE ESTA JANELA ABERTA. Para desligar, feche-a.
echo.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3001"
call npm start
goto fim
:erro
echo.
echo  Ocorreu um erro. Tire um print desta janela e envie.
:fim
pause
