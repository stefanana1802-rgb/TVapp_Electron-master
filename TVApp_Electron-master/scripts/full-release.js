/**
 * Full release: build → git add/commit/push → tag → push tag → GitHub release.
 * Versiunea se citește din package.json.
 * Utilizare: npm run release:full   sau   node scripts/full-release.js
 */
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function run(cmd, opts = {}) {
  const opt = { cwd: ROOT, stdio: 'inherit', ...opts };
  execSync(cmd, opt);
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch (e) {
    return null;
  }
}

function getVersion() {
  try {
    const pkg = require(path.join(ROOT, 'package.json'));
    return (pkg.version && pkg.version.trim()) || null;
  } catch (e) {
    return null;
  }
}

function main() {
  const version = getVersion();
  if (!version) {
    console.error('Nu am găsit version în package.json.');
    process.exit(1);
  }

  const tag = `v${version}`;
  console.log('=== Release ' + tag + ' ===\n');

  // 1. Build
  console.log('1. Build Windows (npm run dist:win)...');
  run('npm run dist:win');

  // 2. Git status (informativ)
  console.log('\n2. Git status:');
  run('git status');

  // 3. Git add
  console.log('\n3. Git add -A');
  run('git add -A');

  // Verifică dacă e ceva de commit
  const status = runSilent('git status --porcelain');
  if (!status) {
    console.log('   Nimic de commit (working tree clean).');
  } else {
    // 4. Git commit
    const msg = `Release ${tag}`;
    console.log('\n4. Git commit -m "' + msg + '"');
    run('git commit -m "' + msg + '"');
  }

  // 5. Git push (branch curent)
  const branch = runSilent('git branch --show-current') || 'master';
  console.log('\n5. Git push origin ' + branch);
  run('git push origin ' + branch);

  // 6. Tag (force pe commit curent dacă există deja)
  console.log('\n6. Git tag ' + tag);
  runSilent('git tag -d ' + tag);
  run('git tag ' + tag);

  // 7. Push tag
  console.log('\n7. Git push origin ' + tag);
  run('git push origin ' + tag);

  // 8. GitHub release (upload exe + latest.yml)
  console.log('\n8. GitHub release (npm run release:github)...');
  run('npm run release:github');

  console.log('\n=== Gata: release ' + tag + ' publicat. ===');
}

main();
