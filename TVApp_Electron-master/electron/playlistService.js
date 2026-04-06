const fs = require('fs').promises;
const path = require('path');
const simpleGit = require('simple-git');

// Git repo = rădăcina proiectului (WORKSPACE e aici) sau path clone (D:/E:/TVAumovio_Repo)
let CONTENT_DIR = path.join(__dirname, '..');

// 15 min – git pull; view-ul se actualizează doar când a venit alt commit
const SYNC_INTERVAL_MS = 15 * 60 * 1000;

let git = null;
let lastSyncAt = 0;
let contentDirExists = false;

function setContentDir(dir) {
  if (dir && typeof dir === 'string') {
    CONTENT_DIR = path.resolve(dir);
    git = null;
    contentDirExists = false;
  }
}

// Lazily determine if content dir exists and is a git repo
async function ensureGit() {
  if (git) return git;

  try {
    const stat = await fs.stat(CONTENT_DIR);
    contentDirExists = stat.isDirectory();
  } catch {
    contentDirExists = false;
  }

  if (!contentDirExists) {
    console.warn('Content directory does not exist at', CONTENT_DIR);
    return null;
  }

  git = simpleGit({
    baseDir: CONTENT_DIR,
    maxConcurrentProcesses: 1
  });

  return git;
}

async function doGitSyncDetailed() {
  const gitClient = await ensureGit();
  if (!gitClient) {
    // No content directory or not a git repo yet; nothing to sync
    return { hadChanges: false, ok: false, errorMessage: null, noRepo: true };
  }
  try {
    await gitClient.fetch();
    const result = await gitClient.pull();
    lastSyncAt = Date.now();
    const summary = result && result.summary;
    console.log('Git pull result:', typeof summary === 'string' ? summary : summary);
    // Modificări: summary string "Already up to date" sau obiect cu changes === 0
    let noChanges = false;
    if (typeof summary === 'string') {
      noChanges = /already up to date/i.test(summary);
    } else if (summary && typeof summary === 'object') {
      noChanges = (summary.changes || 0) === 0 && (summary.insertions || 0) === 0 && (summary.deletions || 0) === 0;
    }
    return { hadChanges: !noChanges, ok: true, errorMessage: null, noRepo: false };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error('Git sync error:', msg);
    return { hadChanges: false, ok: false, errorMessage: msg, noRepo: false };
  }
}

async function doGitSync() {
  const result = await doGitSyncDetailed();
  return result.hadChanges;
}

/**
 * Push la Git cu fișierele date (cale relativă la CONTENT_DIR / rădăcina repo).
 * Folosit de Restaurant of the Day după ce scrie content.json + restaurant_history.json.
 * @param {string[]} relativePaths - ex: ['WORKSPACE/SAM/canteen_menu/content.json', 'WORKSPACE/SAM/canteen_menu/restaurant_history.json']
 * @returns {Promise<boolean>} true dacă push-ul a reușit
 */
async function doGitPush(relativePaths) {
  try {
    const gitClient = await ensureGit();
    if (!gitClient || !Array.isArray(relativePaths) || relativePaths.length === 0) return false;
    await gitClient.add(relativePaths);
    await gitClient.commit('Restaurant of the day update');
    await gitClient.push();
    console.log('Git push OK:', relativePaths.length, 'files');
    return true;
  } catch (err) {
    console.error('Git push error:', err.message);
    return false;
  }
}

let gitSyncIntervalId = null;
/**
 * La 15 min: pull (verificare). Apelează onUpdate() doar dacă au fost modificări (altfel doar verifică).
 * Idempotent: dacă e deja pornit, se oprește intervalul vechi și se creează unul nou (evită duplicate la relansare).
 */
function initGitSync(onUpdate) {
  if (gitSyncIntervalId != null) {
    clearInterval(gitSyncIntervalId);
    gitSyncIntervalId = null;
  }
  const pullThenRefresh = async () => {
    const hadChanges = await doGitSync();
    if (hadChanges && typeof onUpdate === 'function') onUpdate();
  };
  gitSyncIntervalId = setInterval(pullThenRefresh, SYNC_INTERVAL_MS);
}

function getGitSyncStatus() {
  return { lastSyncAt, intervalMs: SYNC_INTERVAL_MS };
}

module.exports = {
  setContentDir,
  initGitSync,
  doGitSync,
  doGitSyncDetailed,
  doGitPush,
  getGitSyncStatus
};

