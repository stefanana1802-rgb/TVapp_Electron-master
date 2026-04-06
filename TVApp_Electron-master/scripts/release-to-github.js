/**
 * Creează un release pe GitHub și uploadează AumovioTVApp Setup.exe + latest.yml.
 * Rulează după: npm run dist:win
 * Necesită: GitHub CLI (gh) instalat și autentificat, sau faci release-ul manual.
 *   Instalare gh: https://cli.github.com/
 *   Autentificare: gh auth login
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');
const VERSION_FILE = path.join(ROOT, 'version.json');

/** Citește owner/repo/host din package.json build.publish. */
function getGitHubRepo() {
  try {
    const pkg = require(path.join(ROOT, 'package.json'));
    const pub = pkg.build && pkg.build.publish;
    if (pub && pub.owner && pub.repo) {
      const host = pub.host || 'github.com';
      return { owner: pub.owner, repo: pub.repo, host };
    }
    const repo = pkg.repository && (pkg.repository.url || pkg.repository);
    const url = typeof repo === 'string' ? repo : (repo && repo.url);
    if (url && /github\.com[/:]([^/]+)\/([^/.]+)/.test(url)) {
      const [, owner, repoName] = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      return { owner, repo: repoName.replace(/\.git$/, ''), host: 'github.com' };
    }
  } catch (e) {}
  return { owner: 'patrutioan211', repo: 'TVApp_Electron', host: 'github.com' };
}

function getVersion() {
  try {
    const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));
    return (data && data.version) ? data.version.trim() : null;
  } catch (e) {
    return null;
  }
}

function findExe(version) {
  if (!fs.existsSync(RELEASE_DIR)) return null;
  const files = fs.readdirSync(RELEASE_DIR);
  const setupExes = files.filter((f) => f.endsWith('.exe') && f.includes('Setup'));
  // Preferă .exe care conține versiunea curentă (ex. 1.0.2)
  if (version) {
    const match = setupExes.find((f) => f.includes(version));
    if (match) return path.join(RELEASE_DIR, match);
  }
  // Fallback: ultimul alfabetic (ex. 1.0.2 după 1.0.0)
  setupExes.sort();
  const exe = setupExes.pop();
  return exe ? path.join(RELEASE_DIR, exe) : null;
}

function main() {
  const version = getVersion();
  if (!version) {
    console.error('Nu am găsit version în version.json.');
    process.exit(1);
  }
  const exePath = findExe(version);
  const ymlPath = path.join(RELEASE_DIR, 'latest.yml');
  if (!exePath || !fs.existsSync(exePath)) {
    console.error('Rulează mai întâi: npm run dist:win');
    process.exit(1);
  }
  if (!fs.existsSync(ymlPath)) {
    console.error('Lipsește release/latest.yml. Rulează: npm run dist:win');
    process.exit(1);
  }

  const tag = `v${version}`;
  const exeName = path.basename(exePath);
  const { owner, repo, host } = getGitHubRepo();
  const releasesUrl = `https://${host}/${owner}/${repo}/releases`;
  const releasesNewUrl = `${releasesUrl}/new`;

  // Pentru GitHub Enterprise: gh folosește GH_HOST
  const env = { ...process.env };
  if (host && host !== 'github.com') env.GH_HOST = host;

  // Încearcă gh (GitHub CLI)
  try {
    execSync('gh --version', { stdio: 'ignore', env });
  } catch (e) {
    console.log('GitHub CLI (gh) nu e instalat sau nu e în PATH.');
    console.log('');
    console.log('Opțiunea 1 – Instalează gh: https://cli.github.com/ apoi rulează din nou: npm run release:github');
    console.log('');
    console.log('Opțiunea 2 – Release manual pe GitHub:');
    console.log('  1. Deschide: ' + releasesNewUrl);
    console.log('  2. Tag: ' + tag + ' (sau alege "Choose existing tag" dacă tag-ul există)');
    console.log('  3. Title: Release ' + tag);
    console.log('  4. Upload fișiere:');
    console.log('     - ' + exeName);
    console.log('     - latest.yml');
    console.log('  5. Publish release');
    console.log('');
    console.log('Fișiere în release/:', exeName, ', latest.yml');
    process.exit(0);
  }

  // Verifică dacă release-ul există deja
  try {
    execSync(`gh release view ${tag}`, { stdio: 'ignore', env });
    console.log('Release-ul ' + tag + ' există deja. Pentru re-upload șterge release-ul pe GitHub sau folosește un tag nou.');
    process.exit(0);
  } catch (_) {}

  // Push tag pe remote dacă există doar local (gh release create cere tag-ul pe remote)
  try {
    execSync(`git push origin ${tag}`, { cwd: ROOT, stdio: 'ignore' });
  } catch (e) {
    const msg = (e.message || '').toLowerCase();
    if (msg.includes('rejected') || msg.includes('failed')) {
      console.error('Tag-ul ' + tag + ' nu s-a putut pusha. Rulează manual: git push origin ' + tag);
      process.exit(1);
    }
    // "already up-to-date" sau tag deja pe remote – continuăm
  }

  console.log('Creare release ' + tag + ' și upload ' + exeName + ', latest.yml ... (host: ' + host + ')');
  try {
    execSync(
      `gh release create ${tag} "${exePath}" "${ymlPath}" --title "Release ${tag}" --notes "Release ${tag}. Installer and latest.yml for auto-update."`,
      { cwd: ROOT, stdio: 'inherit', env }
    );
    console.log('Release publicat: ' + releasesUrl + '/tag/' + tag);
  } catch (e) {
    console.error('Eroare la gh release create:', e.message);
    process.exit(1);
  }
}

main();
