/**
 * Canteen menu PDF: read local PDFs from WORKSPACE/<team>/canteen_menu/ (path from content.json),
 * convert to images, save to WORKSPACE/<team>/canteen_menu/menu_pdf/.
 * Used at slot times: clear menu_pdf, convert each PDF (by range), save as 001.png, 002.png, ...
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { app } = require('electron');

const PROJECT_ROOT = path.join(__dirname, '..');
/** Path la scriptul Python: din .asar.unpacked cand e packed (altfel Python nu poate rula fisiere din asar). */
function getCanteenPdfScriptPath() {
  if (app.isPackaged && process.resourcesPath) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'scripts', 'canteen_pdf_to_images.py');
    return unpacked;
  }
  return path.join(__dirname, 'scripts', 'canteen_pdf_to_images.py');
}
const DEFAULT_WORKSPACE_DIR = path.join(PROJECT_ROOT, 'WORKSPACE');
const MENU_PDF_SUBFOLDER = 'canteen_menu/menu_pdf';
const CANTEEN_SUBFOLDER = 'canteen_menu';

/** Setat din main când repo e pe D:/E: etc. */
let workspaceDirOverride = null;
function setWorkspaceDir(dir) {
  workspaceDirOverride = dir && typeof dir === 'string' ? path.resolve(dir) : null;
}
function getWorkspaceDir() {
  return workspaceDirOverride || DEFAULT_WORKSPACE_DIR;
}
const IMAGE_EXT = '.png';

/**
 * Parse range string to 1-based page numbers. "all" or "" -> [1..totalPages], "1-3" -> [1,2,3], "1,3,5" -> [1,3,5].
 * @param {string} rangeStr
 * @param {number} totalPages
 * @returns {number[]}
 */
function parseRange(rangeStr, totalPages) {
  const s = (rangeStr || '').trim().toLowerCase();
  if (!s || s === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out = [];
  for (const part of s.split(',')) {
    const t = part.trim();
    if (t.includes('-')) {
      const [a, b] = t.split('-', 2).map((x) => parseInt(x.trim(), 10));
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        const lo = Math.max(1, a);
        const hi = Math.min(totalPages, b);
        for (let p = lo; p <= hi; p++) out.push(p);
      }
    } else {
      const p = parseInt(t, 10);
      if (!Number.isNaN(p) && p >= 1 && p <= totalPages) out.push(p);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Convert a PDF file (by path) to PNG images. Uses pdf-to-img with file path (not data URL).
 * Scale 3 = rezolutie mai mare pentru TV (text clar). Seteaza in .env PDF_RENDER_SCALE=4 daca vrei si mai clar.
 * @param {string} pdfPath - Absolute path to PDF file
 * @param {string} rangeStr - "all", "1-3", "1,3,5", etc.
 * @returns {Promise<{ images: Buffer[] }>}
 */
function getPdfRenderScale() {
  const n = parseInt(process.env.PDF_RENDER_SCALE || '3', 10);
  return Number.isNaN(n) || n < 1 ? 3 : Math.min(5, n);
}
async function pdfPathToImages(pdfPath, rangeStr) {
  const scale = getPdfRenderScale();
  const { pdf } = await import('pdf-to-img');
  const document = await pdf(pdfPath, { scale });
  const totalPages = document.length || 0;
  if (totalPages === 0) return { images: [] };
  const pageNumbers = parseRange(rangeStr || 'all', totalPages);
  const images = [];
  for (const page1Based of pageNumbers) {
    const image = await document.getPage(page1Based);
    if (image) images.push(Buffer.isBuffer(image) ? image : Buffer.from(image));
  }
  return { images };
}

/**
 * Ensure directory exists and is empty (remove existing files only).
 * @param {string} dirPath
 */
async function clearDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile()) await fs.unlink(path.join(dirPath, e.name));
  }
}

/**
 * Try Python + PyMuPDF (fitz) for conversion – same as Dashboard/playlist, best quality.
 * @returns {Promise<{ ok: boolean, count?: number, error?: string }|null>} null if Python not used (fallback to Node).
 */
async function runCanteenMenuRefreshWithPython(team, validItems, log) {
  const logger = log || (() => {});
  const scriptPath = getCanteenPdfScriptPath();
  try {
    await fs.access(scriptPath);
  } catch {
    return null;
  }
  const WORKSPACE_DIR = getWorkspaceDir();
  const itemsJson = JSON.stringify(validItems.map((it) => ({ path: it.path.trim().replace(/^[/\\]+/, '').replace(/\.\./g, ''), range: (it.range != null && String(it.range).trim()) || 'all' })));
  const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';
  const pythonArgs = process.platform === 'win32' ? ['-3', scriptPath] : [scriptPath];
  const scale = getPdfRenderScale();
  const args = [...pythonArgs, '--workspace', WORKSPACE_DIR, '--team', team, '--items', itemsJson, '--scale', String(scale)];
  return new Promise((resolve) => {
    const py = spawn(pythonCmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d) => { stdout += d.toString(); });
    py.stderr.on('data', (d) => { stderr += d.toString(); });
    py.on('error', () => resolve(null));
    py.on('close', (code) => {
      if (code !== 0) {
        logger('[CanteenPdf] Python fitz: ' + (stderr.trim() || 'exit ' + code));
        resolve(null);
        return;
      }
      const m = stdout.trim().match(/^OK\s+(\d+)$/);
      if (m) {
        const count = parseInt(m[1], 10);
        logger('[CanteenPdf] Python fitz: ' + count + ' imagini generate.');
        resolve({ ok: true, count });
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Run canteen menu refresh: clear menu_pdf, convert PDFs to PNGs (Python/fitz first, then Node pdf-to-img).
 * @param {string} team
 * @param {Array<{ path: string, range?: string }>} items - Each item: path (relative to canteen_menu/), range ("all", "1-3", etc.)
 * @param {Function} [log] - Optional (msg) => {} for console
 * @returns {Promise<{ ok: boolean, count?: number, error?: string }>}
 */
async function runCanteenMenuRefresh(team, items, log) {
  const logger = log || (() => {});
  if (!team || !items || !Array.isArray(items)) {
    logger('[CanteenPdf] Eroare: lipseste echipa sau lista de PDF-uri.');
    return { ok: false, error: 'Missing team or items' };
  }
  const validItems = items.filter(
    (it) => it && typeof it.path === 'string' && it.path.trim()
  );
  if (validItems.length === 0) {
    logger('[CanteenPdf] Eroare: nici un path PDF valid in items.');
    return { ok: false, error: 'No PDF paths. Încarcă PDF-uri din dashboard sau setează locația pentru descărcare automată.' };
  }

  const WORKSPACE_DIR = getWorkspaceDir();
  const teamDir = path.join(WORKSPACE_DIR, team);
  const canteenDir = path.join(teamDir, CANTEEN_SUBFOLDER);
  const outDir = path.join(teamDir, MENU_PDF_SUBFOLDER);
  logger('[CanteenPdf] Conversie ' + validItems.length + ' PDF(uri): ' + validItems.map((it) => it.path).join(', ') + ' -> ' + MENU_PDF_SUBFOLDER);

  try {
    await clearDir(outDir);
  } catch (e) {
    logger('[CanteenPdf] Eroare golire folder menu_pdf: ' + (e.message || e));
    return { ok: false, error: 'Failed to clear menu folder: ' + (e.message || e) };
  }

  const pythonResult = await runCanteenMenuRefreshWithPython(team, validItems, log);
  if (pythonResult) {
    return pythonResult;
  }

  let globalIndex = 0;
  for (let i = 0; i < validItems.length; i++) {
    const item = validItems[i];
    const relPath = item.path.trim().replace(/^[/\\]+/, '').replace(/\.\./g, '');
    const pdfPath = path.join(canteenDir, relPath);
    const range = (item.range != null && String(item.range).trim()) || 'all';

    try {
      await fs.access(pdfPath);
    } catch (e) {
      logger('[CanteenPdf] Eroare: fisier PDF negasit: ' + relPath + ' - ' + (e.message || e));
      return { ok: false, error: 'PDF not found: ' + relPath + ' – ' + (e.message || e) };
    }
    const stat = await fs.stat(pdfPath).catch(() => null);
    logger('[CanteenPdf]   PDF ' + (i + 1) + ': ' + relPath + (stat ? ' (' + (stat.size / 1024).toFixed(1) + ' KB)' : '') + ', range: ' + range + ' (pdf-to-img)');

    let images;
    try {
      const result = await pdfPathToImages(pdfPath, range);
      images = result.images || [];
      logger('[CanteenPdf]   PDF ' + (i + 1) + ': ' + images.length + ' pagini convertite.');
    } catch (e) {
      logger('[CanteenPdf] Eroare conversie PDF: ' + relPath + ' - ' + (e.message || e));
      return { ok: false, error: 'PDF conversion failed: ' + relPath + ' – ' + (e.message || e) };
    }

    for (const img of images) {
      globalIndex += 1;
      const name = String(globalIndex).padStart(3, '0') + IMAGE_EXT;
      await fs.writeFile(path.join(outDir, name), img);
    }
  }

  logger('[CanteenPdf] Total imagini generate: ' + globalIndex);
  return { ok: true, count: globalIndex };
}

module.exports = {
  runCanteenMenuRefresh,
  setWorkspaceDir,
  MENU_PDF_SUBFOLDER
};
