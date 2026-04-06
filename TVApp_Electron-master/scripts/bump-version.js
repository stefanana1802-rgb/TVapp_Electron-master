/**
 * Mărește versiunea în version.json și package.json.
 * Utilizare: node scripts/bump-version.js [patch|minor|major]
 * Implicit: patch (1.0.0 -> 1.0.1)
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'version.json');
const PACKAGE_FILE = path.join(ROOT, 'package.json');
const type = (process.argv[2] || 'patch').toLowerCase();

function parseVersion(str) {
  const parts = (str || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

function formatVersion(v) {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function bump(v, t) {
  if (t === 'major') return { ...v, major: v.major + 1, minor: 0, patch: 0 };
  if (t === 'minor') return { ...v, minor: v.minor + 1, patch: 0 };
  return { ...v, patch: v.patch + 1 };
}

let current;
try {
  const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));
  current = (data && data.version) ? data.version.trim() : '0.0.0';
} catch (e) {
  current = '0.0.0';
}

if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('Utilizare: node scripts/bump-version.js [patch|minor|major]');
  process.exit(1);
}

const parsed = parseVersion(current);
const next = formatVersion(bump(parsed, type));

fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: next }, null, 2) + '\n', 'utf-8');

const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf-8'));
pkg.version = next;
fs.writeFileSync(PACKAGE_FILE, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

console.log('Versiune: ' + current + ' -> ' + next + ' (' + type + ')');
