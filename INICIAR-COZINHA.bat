@echo off
rem Abre a tela da COZINHA imprimindo sozinha (sem a janela "Imprimir" a cada pedido).
rem Use no computador que fica ligado na impressora da cozinha.
rem Se o sistema estiver na internet, troque o endereco abaixo (ex.: https://gisa.seudominio.com.br/cozinha).
set ENDERECO=http://localhost:3001/cozinha

title Cozinha - impressao automatica
set NAVEGADOR=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set NAVEGADOR="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAVEGADOR if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set NAVEGADOR="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined NAVEGADOR if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set NAVEGADOR="%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined NAVEGADOR if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set NAVEGADOR="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined NAVEGADOR if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set NAVEGADOR="%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined NAVEGADOR (
  echo  Nao achei o Google Chrome nem o Microsoft Edge neste computador.
  echo  Instale o Chrome em https://www.google.com/chrome e tente de novo.
  pause
  exit /b
)
rem --kiosk-printing: imprime direto na impressora padrao do Windows, sem perguntar.
rem Perfil separado: nao mexe no navegador normal de quem usa o computador.
start "" %NAVEGADOR% --kiosk-printing --app=%ENDERECO% --user-data-dir="%LocalAppData%\MarmitariaCozinha" --no-first-run
