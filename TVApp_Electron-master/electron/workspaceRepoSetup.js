/**
 * Setare repo workspace pentru .exe: alege D:\TVAumovio_Repo sau E:\TVAumovio_Repo
 * (primul drive care există), clonează repo-ul din package.json la primul run,
 * apoi git pull folosește acest path.
 */
const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const simpleGit = require('simple-git');

const CANDIDATE_PATHS = ['D:\\TVAumovio_Repo', 'E:\\TVAumovio_Repo'];

function getRepoCloneUrl() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = require(pkgPath);
    if (pkg.repository && typeof pkg.repository.url === 'string' && pkg.repository.url.trim()) {
      let url = pkg.repository.url.trim();
      if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url)) return null;
      if (url.endsWith('.git')) return url;
      return url + (url.includes('.git') ? '' : '.git');
    }
    const pub = pkg.build && pkg.build.publish;
    if (pub && pub.host && pub.owner && pub.repo) {
      const host = pub.host.replace(/\/$/, '');
      return `https://${host}/${pub.owner}/${pub.repo}.git`;
    }
  } catch (e) {
    console.warn('[WorkspaceRepo] getRepoCloneUrl:', e.message);
  }
  return null;
}

/**
 * Returnează primul path din D:\TVAumovio_Repo, E:\TVAumovio_Repo al cărui drive există.
 * Dacă nici D: nici E: nu există, returnează userData/TVAumovio_Repo și usedFallback: true.
 */
async function getPreferredWorkspaceRepoPath() {
  for (const candidate of CANDIDATE_PATHS) {
    const drive = path.parse(candidate).root;
    try {
      await fs.access(drive);
      return { path: candidate, usedFallback: false };
    } catch (_) {
      continue;
    }
  }
  const fallbackPath = path.join(app.getPath('userData'), 'TVAumovio_Repo');
  return { path: fallbackPath, usedFallback: true };
}

/**
 * Verifică dacă un director este un repo Git (are .git).
 */
async function isGitRepo(dirPath) {
  try {
    const stat = await fs.stat(path.join(dirPath, '.git'));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Clonează repo-ul în targetPath. Directorul targetPath este deja creat de ensureWorkspaceRepo.
 */
async function cloneRepo(cloneUrl, targetPath) {
  const git = simpleGit({ maxConcurrentProcesses: 1 });
  return new Promise((resolve, reject) => {
    git.clone(cloneUrl, targetPath, ['--depth', '1'], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Asigură că repo-ul workspace există: alege path (D sau E), clonează dacă nu există .git.
 * @returns {Promise<{ path: string, usedFallback: boolean }>} path și dacă s-a folosit fallback (userData)
 * @throws {Error} la eșec clone cu mesaj pentru utilizator
 */
async function ensureWorkspaceRepo() {
  const { path: repoPath, usedFallback } = await getPreferredWorkspaceRepoPath();
  const cloneUrl = getRepoCloneUrl();

  try {
    await fs.mkdir(repoPath, { recursive: true });
  } catch (e) {
    const msg = `Nu s-a putut crea directorul ${repoPath}: ${e.message}. Verificați permisiunile.`;
    console.warn('[WorkspaceRepo]', msg);
    throw new Error(msg);
  }

  const hasGit = await isGitRepo(repoPath);
  if (!hasGit && cloneUrl) {
    console.log('[WorkspaceRepo] Clone la primul run:', cloneUrl, '->', repoPath);
    try {
      await cloneRepo(cloneUrl, repoPath);
      console.log('[WorkspaceRepo] Clone finalizat.');
    } catch (e) {
      const errMsg = e && (e.message || String(e));
      const msg = `Clone repo eșuat: ${errMsg}. Verificați rețeaua, URL-ul repo-ului și că Git este instalat. Aplicația va folosi WORKSPACE din pachet.`;
      console.error('[WorkspaceRepo]', msg);
      throw new Error(msg);
    }
  } else if (!hasGit && !cloneUrl) {
    console.warn('[WorkspaceRepo] Nu există .git și nici URL în package.json; folosesc path existent.');
  }

  return { path: repoPath, usedFallback };
}

module.exports = {
  ensureWorkspaceRepo,
  getPreferredWorkspaceRepoPath,
  getRepoCloneUrl,
  isGitRepo
};
