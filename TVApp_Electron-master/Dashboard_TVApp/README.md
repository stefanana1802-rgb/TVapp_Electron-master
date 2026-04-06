# Dashboard TV App

Aplicație Python de administrare pentru **TV App** (Digital Signage). Actualizează directorul **WORKSPACE** (echipe și playlist-uri) în funcție de input. Poate fi rulată ca server web local sau împachetată ca `.exe` cu PyInstaller.

## Cerințe

- Python 3.10+ (recomandat 3.11+)

## Instalare și rulare

### 1. Creare mediu virtual (sandbox)

În directorul `Dashboard_TVApp`:

```powershell
python -m venv venv
.\venv\Scripts\activate
```

### 2. Instalare dependențe

```powershell
pip install -r requirements.txt
```

### 3. Configurare cale WORKSPACE

Copiază fișierul de exemplu și setează calea către directorul WORKSPACE al TV App:

```powershell
copy .env.example .env
```

Editează `.env`:

- Dacă `Dashboard_TVApp` este **în interiorul** proiectului TV_App: `WORKSPACE_PATH=../WORKSPACE`
- Dacă este **alături** de TV_App: `WORKSPACE_PATH=../TV_App/WORKSPACE`
- Sau cale absolută: `WORKSPACE_PATH=D:\Projects\2026\TV_App\WORKSPACE`

### 4. Pornire aplicație

```powershell
python app.py
```

sau, pe Windows, dublu-click pe **run.bat**.

Deschide în browser: **http://127.0.0.1:5000**

### 5. Acces din rețea (dashboard public în LAN)

Implicit, aplicația ascultă pe **0.0.0.0:5000**, deci oricine din aceeași rețea poate deschide dashboard-ul în browser la adresa **http://&lt;IP-PC-unde-rulează&gt;:5000**. La pornire, în consolă se afișează URL-urile (local și pe rețea).

- **Doar local:** în `.env` setează `FLASK_HOST=127.0.0.1`.
- **Port diferit:** în `.env` setează `FLASK_PORT=8080`, sau lansează cu **run.bat 8080** (primul argument = port).
- **Firewall Windows:** dacă nu te poate accesa nimeni din rețea, în „Windows Defender Firewall” adaugă o regulă de tip „Inbound” care permite trafic pe portul 5000 (sau cel setat) pentru aplicația Python / run.bat.

## Funcționalități

- **Echipe**: listare, creare (cu foldere `documents`, `photos`, `videos` și `playlist.json`), ștergere.
- **Playlist**: pentru fiecare echipă – vizualizare și editare slide-uri (tip, src, duration, title, subtitle). Tipuri: `image`, `video`, `web_url`, `pdf`, `pptx`, `word`, `excel`, `vimeo`, `hls`.

Modificările se scriu direct în directorul WORKSPACE; TV App (Electron) citește același WORKSPACE.

## Conversie documente Office (Word, Excel, PowerPoint)

Pentru slide-uri din `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, Dashboard-ul convertește fișierul în PDF, apoi în imagini.

- **Recomandat: LibreOffice** – instalează de la [libreoffice.org/download](https://www.libreoffice.org/download). Aplicația caută automat `soffice.exe` în Program Files și în PATH.
- **Variabilă de mediu (instalare portable):** setează `LIBREOFFICE_PATH` în `.env` la folderul unde ai LibreOffice (sau calea completă la `soffice.exe`), ex.: `LIBREOFFICE_PATH=D:\Portable\LibreOffice\program`.
- **Microsoft Office (Windows):** se poate folosi ca rezervă doar dacă Python și Office au aceeași arhitectură (ambele 32-bit sau ambele 64-bit). În caz contrar apare eroare COM; folosește LibreOffice.
- **Alternativ:** încarcă direct un fișier PDF în folderul documentului.
- **PPTX → PDF (LibreOffice):** pentru `.ppt`/`.pptx` se încearcă mai întâi filtrul **impress_pdf_Export** (calitate, fără pagini de note), apoi fallback la `pdf` generic. Opțional în `.env`: `LIBREOFFICE_IMPRESS_PDF_FILTER=...` (șir complet `--convert-to`).
- **PDF → PNG:** înainte de rasterizare se normalizează rotația paginii (PyMuPDF), ca textul și layout-ul să nu pară „strânse” pe unele PDF-uri.
- **Calitate / proporții PNG:** implicit rasterizare la **192 DPI** (matrice uniformă X=Y, RGB). Poți seta în `.env` lângă Dashboard: `DASHBOARD_PDF_TO_IMAGE_DPI=220` (96–400). Valori mai mari = fișiere mai mari, imagine mai clară.
- **Pe TV:** opțiunea „Fill” din playlist folosește **umplere fără distorsiune** (`object-cover`); dacă vrei tot conținutul vizibil cu bare negre, lasă Fill pe **No** (`object-contain`).

## Construire .exe (PyInstaller)

Pentru a obține un executabil Windows:

```powershell
pip install pyinstaller
pyinstaller --onefile --name "Dashboard_TVApp" --add-data "templates;templates" app.py
```

- `--onefile`: un singur fișier `.exe`
- `--add-data "templates;templates"`: include folderul `templates` în .exe (pe Windows separatorul este `;`)

După build, `.exe` se găsește în `dist/Dashboard_TVApp.exe`.

**Important**: la rularea din .exe, aplicația pornește din folderul în care se află `.exe`. Setează `WORKSPACE_PATH` în `.env` **în același folder** cu `.exe`, sau folosește cale absolută. Alternativ, poți citi calea din config sau din linia de comandă (ex. `Dashboard_TVApp.exe --workspace "D:\...\WORKSPACE"`).

## Structură proiect

```
Dashboard_TVApp/
  app.py              # Aplicația Flask
  requirements.txt
  .env.example
  .env                # (creat de tine) WORKSPACE_PATH=...
  templates/
    dashboard.html    # Pagina de administrare
  venv/               # (creat de tine) mediu virtual Python
```
