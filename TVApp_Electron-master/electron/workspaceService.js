const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

// WORKSPACE la rădăcina proiectului (același repo) sau la repo clone (D:/E:/TVAumovio_Repo)
const PROJECT_ROOT = path.join(__dirname, '..');
let workspaceRepoRoot = null;
let WORKSPACE_DIR = path.join(PROJECT_ROOT, 'WORKSPACE');

function setWorkspaceRepoRoot(root) {
  if (root && typeof root === 'string') {
    workspaceRepoRoot = path.resolve(root);
    WORKSPACE_DIR = path.join(workspaceRepoRoot, 'WORKSPACE');
  }
}

function getWorkspaceRepoRoot() {
  return workspaceRepoRoot;
}

const SECTION_IDS = [
  'announcements', 'canteen_menu', 'anniversary', 'uptime_services',
  'info_section', 'projects_info', 'stretching', 'meeting_rooms', 'traffic'
];

// Persistență echipă selectată (userData – nu se resetează la update)
const TEAM_CONFIG_PATH = path.join(app.getPath('userData'), 'signage-team.json');

/** Redenumiri folder WORKSPACE: vechi → nou (migrare fără re-selectare manuală). */
const TEAM_FOLDER_ALIASES = { BSW: 'SAM' };

async function dirExists(dir) {
  try {
    const s = await fs.stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p) {
  try {
    const s = await fs.stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

function teamPlaylistPath(teamName) {
  return path.join(WORKSPACE_DIR, teamName, 'playlist.json');
}

/**
 * Dacă echipa salvată e un nume vechi (ex. BSW) dar conținutul e la noul nume (SAM), actualizează config.
 * Acoperă: folder vechi șters; folder vechi gol fără playlist; playlist doar la noul nume după git pull/redenumire.
 */
async function migrateSelectedTeamIfNeeded(team) {
  if (!team) return null;
  const replacement = TEAM_FOLDER_ALIASES[team];
  if (!replacement) return team;
  const oldDir = path.join(WORKSPACE_DIR, team);
  const newDir = path.join(WORKSPACE_DIR, replacement);
  const oldPl = teamPlaylistPath(team);
  const newPl = teamPlaylistPath(replacement);
  const hasOldPlaylist = await fileExists(oldPl);
  const hasNewPlaylist = await fileExists(newPl);

  if (hasNewPlaylist && !hasOldPlaylist) {
    await writeTeamConfig(replacement);
    console.log(
      `[workspace] Echipă selectată migrată: ${team} → ${replacement} (playlist.json există doar la noul nume de folder)`
    );
    return replacement;
  }
  if ((await dirExists(newDir)) && !(await dirExists(oldDir))) {
    await writeTeamConfig(replacement);
    console.log(`[workspace] Echipă selectată migrată: ${team} → ${replacement} (folder vechi lipsește în WORKSPACE)`);
    return replacement;
  }
  return team;
}

async function readTeamConfig() {
  try {
    const raw = await fs.readFile(TEAM_CONFIG_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return data.team || null;
  } catch {
    return null;
  }
}

async function writeTeamConfig(team) {
  await fs.mkdir(path.dirname(TEAM_CONFIG_PATH), { recursive: true });
  await fs.writeFile(TEAM_CONFIG_PATH, JSON.stringify({ team: team || null }, null, 2), 'utf-8');
}

/**
 * Listează echipele = subdirectoare din WORKSPACE
 */
async function getTeams() {
  try {
    const stat = await fs.stat(WORKSPACE_DIR);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  const entries = await fs.readdir(WORKSPACE_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function getSelectedTeam() {
  const stored = await readTeamConfig();
  return migrateSelectedTeamIfNeeded(stored);
}

async function setSelectedTeam(team) {
  await writeTeamConfig(team);
  return true;
}

function getWorkspaceDir() {
  return WORKSPACE_DIR;
}

/**
 * Citește playlist-ul din WORKSPACE/<team>/playlist.json.
 * Căile din slides (src) relative la directorul echipei sunt transformate în workspace://./...
 */
async function getPlaylistForTeam(team) {
  if (!team) {
    return { slides: [], error: 'No team selected' };
  }
  const teamDir = path.join(WORKSPACE_DIR, team);
  const playlistPath = path.join(teamDir, 'playlist.json');
  try {
    const raw = await fs.readFile(playlistPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.slides)) {
      return { slides: [], error: 'playlist.json must contain a "slides" array' };
    }
    // Only show slides that are enabled (enabled !== false)
    const enabledSlides = data.slides.filter((s) => s.enabled !== false);
    // Resolve relative paths to workspace:// URL so renderer can load them
    const baseUrl = 'workspace://./';
    const slides = enabledSlides.map((s) => {
      const slide = { ...s };
      if (slide.src && !slide.src.startsWith('http://') && !slide.src.startsWith('https://') && !slide.src.startsWith('workspace://')) {
        slide.src = baseUrl + slide.src.replace(/\\/g, '/');
      }
      return slide;
    });
    return { ...data, slides };
  } catch (err) {
    console.error('Failed to read playlist for team', team, err.message);
    return { slides: [], error: err.message };
  }
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif']);

/**
 * Listează imaginile dintr-un folder din workspace (pentru PPT/Word/Excel afișate ca imagini).
 * relativePath = calea relativă la echipă, ex: "documents/Prez_export" (poate veni cu workspace://./)
 * Returnează array de URL-uri workspace pentru fiecare imagine, sortate.
 */
async function getWorkspaceFolderImages(relativePath) {
  const team = await getSelectedTeam();
  if (!team) return [];
  let decoded = (relativePath || '').replace(/^workspace:\/\/\.?\//, '').replace(/\\/g, '/').replace(/\.\./g, '');
  decoded = decodeURIComponent(decoded).replace(/\/+$/, '');
  const teamDir = path.join(WORKSPACE_DIR, team);
  const dirPath = path.resolve(teamDir, decoded);
  const relative = path.relative(teamDir, dirPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
      .map((e) => path.join(decoded, e.name).replace(/\\/g, '/'))
      .sort();
    return files.map((f) => 'workspace://./' + f);
  } catch {
    return [];
  }
}

/**
 * Calea absolută către un fișier din workspace (pentru protocol handler).
 * subpath = e.g. "photos/1.jpg"
 */
async function getWorkspaceFilePath(subpath) {
  const team = await getSelectedTeam();
  if (!team) return null;
  const decoded = decodeURIComponent(subpath).replace(/\\/g, '/').replace(/\.\./g, '');
  const teamDir = path.join(WORKSPACE_DIR, team);
  const fullPath = path.resolve(teamDir, decoded);
  const relative = path.relative(teamDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return fullPath;
}

async function createTeam(teamName) {
  const name = (teamName || '').trim().replace(/[<>:"/\\|?*]/g, '');
  if (!name) return { ok: false, error: 'Invalid name' };
  const teamDir = path.join(WORKSPACE_DIR, name);
  try {
    await fs.mkdir(teamDir, { recursive: true });
    await fs.writeFile(path.join(teamDir, 'playlist.json'), JSON.stringify({ slides: [] }, null, 2), 'utf-8');
    await fs.mkdir(path.join(teamDir, 'documents'), { recursive: true });
    await fs.mkdir(path.join(teamDir, 'photos'), { recursive: true });
    await fs.mkdir(path.join(teamDir, 'videos'), { recursive: true });
    for (const sub of SECTION_IDS) {
      await fs.mkdir(path.join(teamDir, sub), { recursive: true });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function deleteTeam(teamName) {
  const teamDir = path.join(WORKSPACE_DIR, teamName);
  try {
    await fs.rm(teamDir, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function savePlaylist(teamName, playlistData) {
  const teamDir = path.join(WORKSPACE_DIR, teamName);
  const playlistPath = path.join(teamDir, 'playlist.json');
  try {
    await fs.writeFile(playlistPath, JSON.stringify(playlistData, null, 2), 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Creează directoarele de secțiuni pentru echipă dacă lipsesc (migrare echipe vechi).
 */
async function ensureSectionDirs(teamName) {
  if (!teamName) return;
  const teamDir = path.join(WORKSPACE_DIR, teamName);
  try {
    await fs.mkdir(teamDir, { recursive: true });
    for (const sub of SECTION_IDS) {
      await fs.mkdir(path.join(teamDir, sub), { recursive: true });
    }
  } catch (err) {
    console.error('ensureSectionDirs', teamName, err.message);
  }
}

/**
 * Citește conținutul secțiunii (content.json) pentru o echipă.
 * Returnează obiectul JSON sau null dacă nu există.
 */
async function getSectionContent(teamName, sectionId) {
  if (!teamName || !sectionId || !SECTION_IDS.includes(sectionId)) return null;
  const contentPath = path.join(WORKSPACE_DIR, teamName, sectionId, 'content.json');
  try {
    const raw = await fs.readFile(contentPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Scrie conținutul secțiunii (content.json) pentru o echipă.
 */
async function writeSectionContent(teamName, sectionId, data) {
  if (!teamName || !sectionId || !SECTION_IDS.includes(sectionId)) return false;
  const contentPath = path.join(WORKSPACE_DIR, teamName, sectionId, 'content.json');
  try {
    await fs.mkdir(path.dirname(contentPath), { recursive: true });
    await fs.writeFile(contentPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Returnează toate secțiunile pentru echipa selectată (sau teamName).
 * Creează directoarele de secțiuni dacă lipsesc.
 */
async function getAllSectionsContent(teamName) {
  const team = teamName || (await getSelectedTeam());
  if (!team) return {};
  await ensureSectionDirs(team);
  const out = {};
  for (const id of SECTION_IDS) {
    out[id] = await getSectionContent(team, id);
  }
  return out;
}

module.exports = {
  setWorkspaceRepoRoot,
  getWorkspaceRepoRoot,
  getWorkspaceDir,
  getTeams,
  getSelectedTeam,
  setSelectedTeam,
  getPlaylistForTeam,
  getWorkspaceFilePath,
  getWorkspaceFolderImages,
  createTeam,
  deleteTeam,
  savePlaylist,
  getSectionContent,
  writeSectionContent,
  getAllSectionsContent
};
