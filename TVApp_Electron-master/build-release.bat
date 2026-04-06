@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ============================================
echo   AumovioTVApp - Creare versiune release
echo ============================================
echo.

cd /d "%~dp0"

if not exist "version.json" (
  echo [EROARE] Lipsește version.json
  exit /b 1
)
node -e "var v=require('./version.json').version; console.log('Versiune:', v);" 2>nul || echo Versiune: vezi version.json
echo.

:: Generează icon.ico pentru bara de task și fereastră (din public/icon.svg)
echo [1/3] Generare icon (electron/icon.ico)...
call npm run icons 2>nul
if not exist "electron\icon.ico" (
  echo [ATENTIE] Icon negasit. Ruleaza: npm run icons
)
echo.

:: Build Windows release
echo [2/3] Build (npm run dist:win)...
echo.
call npm run dist:win
if errorlevel 1 (
  echo.
  echo [EROARE] Build eșuat.
  exit /b 1
)

echo.
echo [3/3] Build finalizat. Output în folderul release\
echo.
dir /b release\*.exe release\latest.yml 2>nul
echo.

:: Încearcă publicare pe GitHub (dacă gh e instalat)
where gh >nul 2>&1
if errorlevel 1 (
  echo Nu e instalat GitHub CLI (gh). Pentru a publica release-ul pe GitHub:
  echo   1. Instalează: https://cli.github.com/
  echo   2. Rulează: gh auth login
  echo   3. Rulează: npm run release:github
  echo.
  echo Sau creezi release-ul manual pe:
  for /f "delims=" %%u in ('node scripts\get-releases-url.js 2^>nul') do echo   %%u
  echo   și uploadezi fișierele din release\
) else (
  set /p PUBLISH="Public release pe GitHub acum? (y/N): "
  if /i "%PUBLISH%"=="y" (
    echo.
    call npm run release:github
  )
)

echo.
echo Gata. Instalerul și latest.yml sunt în: %CD%\release\
pause
