@echo off
rem abrir-config.bat - abre a sua config do widget no Bloco de Notas.
rem Feche o widget antes de editar: ele le a config quando abre.
set "CONFIG=%APPDATA%\meu-widget\config.json"
if not exist "%CONFIG%" (
  echo A config ainda nao existe: abra o widget uma vez primeiro.
  pause
  exit /b
)
start "" notepad "%CONFIG%"
