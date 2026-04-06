# Cerințe complete: PDF → imagini (meniu cantină)

Aplicația convertește PDF-urile meniului cantină în PNG în două moduri:
1. **Python + PyMuPDF** (prioritar, calitate bună) – folosit dacă e instalat
2. **Node (pdf-to-img)** (rezervă) – folosit dacă Python/PyMuPDF nu e disponibil

---

## 1. Python + PyMuPDF (recomandat)

### Ce trebuie instalat

| Componentă | Versiune / notă |
|------------|------------------|
| **Python** | 3.9, 3.10, 3.11, 3.12 sau 3.13 (64-bit) |
| **PyMuPDF** | `pip install pymupdf` |
| **Microsoft Visual C++ Redistributable** | Necesar pe Windows dacă apar erori DLL |

### Pași pe Windows

1. **Instalare Python**
   - Descarcă de la: https://www.python.org/downloads/
   - Alege **Windows installer (64-bit)**.
   - La instalare bifează:
     - **"Add python.exe to PATH"**
     - **"Install py launcher for all users"** (opțional, dar util)
   - **Important:** instalează Python de pe python.org. Nu folosi Chocolatey – pentru Python instalat cu Chocolatey nu există wheel-uri PyMuPDF.

2. **Instalare PyMuPDF**
   - Deschide **CMD** sau **PowerShell** și rulează:
     ```bash
     pip install pymupdf
     ```
   - Sau, dacă ai mai multe versiuni de Python:
     ```bash
     py -3 -m pip install pymupdf
     ```

3. **Verificare**
   - Rulează:
     ```bash
     py -3 -c "import fitz; print('PyMuPDF OK')"
     ```
   - Dacă vezi `PyMuPDF OK`, e instalat corect.

### Erori frecvente și soluții

- **`ImportError: DLL load failed while importing _extra`** sau **`MSVCP140.dll` missing**  
  → Instalează **Microsoft Visual C++ Redistributable** (64-bit):  
  https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist  
  (link direct: **VC_redist.x64.exe**)

- **`ImportError: dynamic module does not define module export function (PyInit__extra)`**  
  → Instalează cea mai nouă versiune **VC_redist.x64.exe** (vezi linkul de mai sus).

- **`ModuleNotFoundError: No module named 'frontend'`** sau comportament ciudat la `import fitz`  
  → Ai instalat pachetul greșit **fitz** (vechi, de pe PyPI). Corect:
  ```bash
  pip uninstall fitz
  pip install --force-reinstall pymupdf
  ```
  Scriptul aplicației folosește `import fitz` (numele vechi pentru PyMuPDF); trebuie să fie instalat **pymupdf**, nu pachetul **fitz**.

- **Python nu e găsit din aplicație**  
  → Pe Windows aplicația apelează `py -3` (Python Launcher). Fie instalezi Python cu opțiunea „py launcher”, fie pui în PATH un `python.exe` / `python3` care funcționează.

### Ce face aplicația

- La build, scriptul `electron/scripts/canteen_pdf_to_images.py` este scos din arhiva ASAR (`asarUnpack`) ca să poată fi rulat de Python și din versiunea instalată (.exe).
- Când rulează conversia, mai întâi încearcă Python + acest script; dacă reușește, folosește rezultatul (calitate bună). Dacă nu (Python lipsă, PyMuPDF lipsă, eroare), trece la varianta Node.

---

## 2. Varianta Node (pdf-to-img) – fără Python

Dacă **nu** instalezi Python/PyMuPDF, aplicația folosește automat pachetul Node **pdf-to-img** (deja inclus în proiect).

- **Nu mai trebuie să instalezi nimic** pentru această variantă.
- Calitatea poate fi inferioară variantei Python/PyMuPDF; aplicația folosește deja un factor de scalare mai mare (implicit 3, configurabil prin `PDF_RENDER_SCALE` în `.env`) pentru a reduce neclaritatea.

---

## 3. Setare opțională: rezoluție mai mare

În fișierul **.env** din rădăcina repo-ului (ex. pe D:) poți seta:

```env
# 3 = implicit (recomandat), 4 = foarte clar (fișiere mai mari)
PDF_RENDER_SCALE=3
```

Valori permise: 1–5. Mărește rezoluția la care se generează imaginile din PDF (atât pentru Python, cât și pentru Node).

---

## Rezumat rapid

| Ce vrei | Ce instalezi |
|--------|----------------|
| **Calitate bună (recomandat)** | Python 3 (64-bit, de pe python.org) + `pip install pymupdf` + eventual **VC_redist.x64.exe** dacă apar erori DLL |
| **Fără Python** | Nimic – se folosește varianta Node (calitate mai limitată) |
| **Imagine și mai clară** | În .env: `PDF_RENDER_SCALE=4` (sau 5) |
