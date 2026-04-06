/**
 * Pornește Vite preview, așteaptă cu wait-on, apoi lansează Electron.
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 5176;
const ROOT = path.join(__dirname, '..');

const vite = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true
});

vite.on('error', (err) => {
  console.error('Vite preview error:', err);
  process.exit(1);
});

console.log('Pornire Vite preview pe portul', PORT, '...');
// Așteptăm 8s ca Vite să asculte, apoi wait-on verifică
setTimeout(() => {
  const waitOn = spawn('npx', ['wait-on', '-t', '60000', '-d', '1000', `http://127.0.0.1:${PORT}/`], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true
  });
  waitOn.on('close', (code) => {
    if (code !== 0) {
      console.error('Serverul nu a răspuns. Închidere Vite.');
      vite.kill();
      process.exit(1);
    }
    console.log('Server gata. Pornire Electron...');
    const electron = spawn('npx', ['electron', '.'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true
    });
    electron.on('close', (c) => {
      vite.kill();
      process.exit(c ?? 0);
    });
    electron.on('error', (err) => {
      console.error('Electron error:', err);
      vite.kill();
      process.exit(1);
    });
  });
}, 8000);
