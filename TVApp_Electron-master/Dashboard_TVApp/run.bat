@echo off
cd /d "%~dp0"
if "%~1"=="" goto :run
if "%~1"=="/?" goto :help
if "%~1"=="-h" goto :help
REM Port din linia de comanda: run.bat 8080
set FLASK_PORT=%~1
goto :run
:help
echo Utilizare: run.bat [port]
echo   run.bat        - porneste pe portul 5000 (sau FLASK_PORT din .env)
echo   run.bat 8080  - porneste pe portul 8080
echo Portul poate fi setat si in .env: FLASK_PORT=8080
exit /b 0
:run
if not exist "venv\Scripts\activate.bat" (
  echo Creare venv...
  python -m venv venv
)
call venv\Scripts\activate.bat
python -m pip install --upgrade pip -q
pip install -r requirements.txt -q
python app.py
