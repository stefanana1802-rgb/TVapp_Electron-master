/**
 * Generează icon.ico și icon.png din public/icon.svg pentru bara de task și Start (Windows).
 * Rulează: npm run icons
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'public', 'icon.svg');
const ELECTRON_DIR = path.join(ROOT, 'electron');
const SIZES = [16, 32, 48, 256];

async function main() {
  let sharp, pngToIco;
  try {
    sharp = require('sharp');
    const pngToIcoModule = require('png-to-ico');
    pngToIco = typeof pngToIcoModule === 'function' ? pngToIcoModule : pngToIcoModule.default;
  } catch (e) {
    console.error('Instalează dependențele: npm install --save-dev sharp png-to-ico');
    process.exit(1);
  }

  if (!fs.existsSync(SVG_PATH)) {
    console.error('Lipsește public/icon.svg');
    process.exit(1);
  }

  const svgBuffer = fs.readFileSync(SVG_PATH);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvapp-icons-'));
  const pngPaths = [];

  try {
    for (const size of SIZES) {
      const outPath = path.join(tmpDir, `icon-${size}.png`);
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(outPath);
      pngPaths.push(outPath);
    }

    const icoBuf = await pngToIco(pngPaths);
    const icoOut = path.join(ELECTRON_DIR, 'icon.ico');
    fs.writeFileSync(icoOut, icoBuf);
    console.log('Scris:', icoOut);

    const png256 = path.join(tmpDir, 'icon-256.png');
    const pngOut = path.join(ELECTRON_DIR, 'icon.png');
    fs.copyFileSync(png256, pngOut);
    console.log('Scris:', pngOut);
  } finally {
    try {
      for (const p of pngPaths) fs.unlinkSync(p);
      fs.rmdirSync(tmpDir);
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
