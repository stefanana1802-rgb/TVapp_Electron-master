## Aumovio TV App (Electron + React)

Digital signage application for TV 
Electron drives the main process (Git sync, workspace, PDFs); the renderer is a full‑screen React/Vite/Tailwind slideshow.

---

### 1. Requirements

- **OS**: Windows 10/11 (64‑bit)
- **Runtime**: Node.js LTS, Git on `PATH`
- **For PDF → image (canteen menu, best quality)**:
  - Python 3 (64‑bit, from `python.org`)
  - `pip install pymupdf`
- **Optional (Dashboard only, Office docs → PDF)**:
  - LibreOffice or Microsoft Office

See `docs/PDF-TO-IMAGE-REQUIREMENTS.md` for full PDF conversion details.

---

### 2. Install & Run (development)

From the project root:

```bash
npm install
npm run dev
```



```bash
npm run build
npm start
```

---

### 3. Workspace & Git sync

- The project root is a **Git repo**; `WORKSPACE/` (team content, sections, PDFs, images) lives inside this repo.
- Dashboard pushes changes (JSON + assets) into the repo.
- The TV app:
  - On startup: runs `git pull`; if it fails, shows an error dialog (conflicting local changes, etc.).
  - Every **15 minutes**: `git pull`; if there are changes, sends `playlist-updated` so the renderer reloads content from `WORKSPACE`.

---

### 4. Packaging & auto‑update

- **Build Windows installer**:

```bash
npm run dist:win
```

Output is placed in `release/` (NSIS `.exe` + `latest.yml`).

- **Auto-update**:
  - By default, the app checks **GitHub Releases** for updates (repo defined in `package.json → build.publish`).
  - Every **30 minutes** it compares `version.json` in the repo with the running version; if newer, it downloads the installer and restarts.
  - To use a custom update server, set `UPDATE_FEED_URL=https://your-server/releases` in `.env`.

---

### 5. Release scripts

All commands are defined in `package.json`:

| Command                 | Description                                                |
|-------------------------|------------------------------------------------------------|
| `npm run version:patch` | Bump patch version in `version.json` and `package.json`.   |
| `npm run version:minor` | Bump minor version.                                        |
| `npm run version:major` | Bump major version.                                        |
| `npm run dist:win`      | Build Windows installer into `release/`.                  |
| `npm run release:github`| Publish installer + `latest.yml` to GitHub Releases (uses `gh`). |
| `npm run release`       | `version:patch` → `dist:win` → `release:github`.          |
| `npm run release:full`  | Full flow: build, git commit + tag, push, then `release:github`. |

Typical flow:

```bash
npm run version:patch
npm run release:full
```

