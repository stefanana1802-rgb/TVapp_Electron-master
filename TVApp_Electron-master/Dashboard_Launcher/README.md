# Dashboard Launcher

Aplicație (Python sau .exe) care afișează butoane pentru fiecare **Dashboard TV** înregistrat în rețea. Citește lista din repo (un singur fișier JSON de pe web), afișează **punct verde** dacă dashboard-ul răspunde sau **punct roșu** dacă nu; la click deschide dashboard-ul în browser.

## Cum funcționează

1. **Dashboard-urile** (run.bat pe fiecare PC) se înregistrează la pornire în `WORKSPACE/dashboard_sources.json` și fac push în Git.
2. **Launcher-ul** preia acest fișier de pe web (URL raw din repo) și afișează câte un buton per sursă (Source 1, Source 2, …).
3. La **fiecare 15 minute** verifică dacă fiecare URL răspunde și actualizează punctul (verde/roșu).
4. **Click** pe buton → se deschide în browser adresa respectivă (dashboard-ul de pe acel PC).

## Configurare

1. Copiază fișierul de exemplu:
   ```text
   copy config.ini.example config.ini
   ```
2. Deschide `config.ini` și setează **SOURCES_JSON_URL** la adresa raw a fișierului `dashboard_sources.json` din repo:
   - **GitHub:**  
     `https://raw.githubusercontent.com/OWNER/REPO/BRANCH/WORKSPACE/dashboard_sources.json`
   - **GitHub Enterprise:**  
     `https://github-ct.int.automotive-wan.com/OWNER/REPO/raw/BRANCH/WORKSPACE/dashboard_sources.json`
   (Înlocuiește OWNER, REPO, BRANCH cu valorile tale.)

3. Opțional: `CHECK_INTERVAL_MINUTES=15` (intervalul de verificare a URL-urilor).

## Rulare (Python)

```bash
pip install -r requirements.txt
python launcher.py
```

## Construire .exe (PyInstaller)

```bash
pip install pyinstaller
pyinstaller --onefile --name "Dashboard_Launcher" launcher.py
```

Executabilul va fi în `dist/Dashboard_Launcher.exe`. Pune **config.ini** în același folder cu `.exe` și setează acolo `SOURCES_JSON_URL`. Launcher-ul citește config-ul din folderul în care se află exe-ul.

## Dezactivare înregistrare dashboard

Pe un PC unde rulezi Dashboard-ul dar **nu** vrei să apară în lista de surse, în `.env` (din `Dashboard_TVApp`) setează:

```env
REGISTER_DASHBOARD=0
```
