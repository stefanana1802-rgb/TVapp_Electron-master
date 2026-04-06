@echo off
cd /d "%~dp0"
if not exist "venv\Scripts\activate.bat" (
  echo Creare venv...
  python -m venv venv
)
call venv\Scripts\activate.bat
pip install -r requirements.txt -q
if not exist "config.ini" (
  echo Config.ini lipsa. Copiez config.ini.example -> config.ini
  copy config.ini.example config.ini
  echo Editeaza config.ini si seteaza SOURCES_JSON_URL la adresa raw a dashboard_sources.json din repo.
)
python launcher.py
