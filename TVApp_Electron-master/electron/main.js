const { app, BrowserWindow, BrowserView, ipcMain, protocol, net, webFrameMain, dialog } = require('electron');

// Suprimă warning-ul "Bad value, for custom key AAPL:Keywords" (metadate macOS, inofensiv pe Windows)
const origEmit = process.emit;
process.emit = function (name, data, ...args) {
  if (name === 'warning' && data && typeof data.message === 'string' && data.message.includes('AAPL:Keywords')) {
    return false;
  }
  return origEmit.apply(this, [name, data, ...args]);
};

// Aplicat înainte de orice
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// GPU activat (reduce CPU). Pe RDP/VM dacă apar erori, pune în .env: DISABLE_GPU=1
if (process.env.DISABLE_GPU === '1') {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-direct-composition');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { Readable } = require('stream');
const { session } = require('electron');

const POWERBI_PARTITION = 'persist:powerbi';
const WEB_ACTION_PARTITION = 'persist:webaction';
const { initGitSync, doGitSync, doGitSyncDetailed, getGitSyncStatus, setContentDir } = require('./playlistService');
const workspaceService = require('./workspaceService');
const canteenMenuPdfService = require('./canteenMenuPdfService');
const canteenMenuDownloadService = require('./canteenMenuDownloadService');
const trafficService = require('./trafficService');
const hardwareTempsService = require('./hardwareTempsService');
const authService = require('./authService');
const msalAuthService = require('./msalAuthService');
const { autoUpdater } = require('electron-updater');
const isDev = process.env.USE_DEV_SERVER === '1';
const UPDATE_FEED_URL = process.env.UPDATE_FEED_URL || '';
// GitHub repo pentru update – citit din package.json build.publish (schimbă acolo dacă muți repo-ul)
function getGitHubUpdateRepo() {
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    const pub = pkg.build && pkg.build.publish;
    if (pub && pub.provider === 'github' && pub.owner && pub.repo) {
      return { owner: pub.owner, repo: pub.repo };
    }
  } catch (e) {}
  return { owner: 'patrutioan211', repo: 'TVApp_Electron' };
}
const GITHUB_UPDATE_REPO = getGitHubUpdateRepo();
const DIST_PATH = path.resolve(__dirname, '..', 'dist');

app.setName('AumovioTVApp');

// Scheme-uri înregistrate și în dev ca workspace:// să funcționeze (inclusiv video)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, supportFetchAPI: true } },
  { scheme: 'workspace', privileges: { standard: true, supportFetchAPI: true, stream: true } },
  { scheme: 'tvapp', privileges: { standard: true, supportFetchAPI: true } }
]);

let mainWindow = null;
let msalAuthWindow = null;
let powerBiBrowserView = null;
let powerBiCustomBounds = false;
let powerBiCurrentUrl = null;
let powerBiScrollTimeouts = [];
let powerBiLoginRetryTimeouts = [];
let powerBiScrollOptions = null;
let webLiveScrollTimeouts = [];
let webLiveScrollFrame = null;
let webActionBrowserView = null;
let webActionCustomBounds = false;
let webActionCurrentUrl = null;
let webActionLastZoomFactor = 1;

function webActionDevLog() {
  if (isDev || !app.isPackaged) {
    var parts = ['[WebAction]'];
    for (var i = 0; i < arguments.length; i++) parts.push(arguments[i]);
    console.log.apply(console, parts);
  }
}

function getBaseUrl() {
  return isDev ? 'http://localhost:5174' : 'app://./index.html';
}

let adminWindowRef = null;
function createAdminWindow() {
  if (adminWindowRef && !adminWindowRef.isDestroyed()) {
    adminWindowRef.focus();
    return;
  }
  const url = getBaseUrl() + '#/admin';
  const adminIconPath = getAppIconPath();
  adminWindowRef = new BrowserWindow({
    width: 1000,
    height: 700,
    autoHideMenuBar: true,
    ...(adminIconPath && { icon: adminIconPath }),
    title: 'AumovioTVApp',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  adminWindowRef.on('closed', () => { adminWindowRef = null; });
  adminWindowRef.loadURL(url);
}

function getAppIconPath() {
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? [
        path.join(__dirname, 'icon.ico'),
        path.join(__dirname, 'icons', 'icon.ico'),
        path.join(__dirname, '..', 'public', 'icon.ico'),
        path.join(__dirname, 'icon.png'),
        path.join(__dirname, '..', 'public', 'icon.png')
      ]
    : [
        path.join(__dirname, 'icon.png'),
        path.join(__dirname, 'icons', 'icon.png'),
        path.join(__dirname, '..', 'public', 'icon.png')
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function createWindow(loadUrl) {
  const iconPath = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    frame: false,
    backgroundColor: '#f5f5f5',
    autoHideMenuBar: true,
    ...(iconPath && { icon: iconPath }),
    title: 'AumovioTVApp',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  // Log în consolă erorile de încărcare (inclusiv iframe-uri, ex. Power BI)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[Load failed]', {
      errorCode,
      errorDescription,
      url: validatedURL,
      isMainFrame
    });
  });
  // Pagini încărcate în iframe (ex. Flightboard lastx.php) care fac window.open / target=_blank nu mai deschid filă/fereastră nouă în slideshow.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Electron 35+: level poate fi număr (3 = error) sau string 'error'. Include iframe-uri (ex. wpp Flightboard).
  mainWindow.webContents.on('console-message', (details) => {
    const { level, message, lineNumber, sourceId } = details;
    const isError = level === 3 || level === 'error';
    if (!isError) return;
    const src = String(sourceId || '');
    const isWppCmo = /asf42\.cmo\.aws\.automotive\.cloud\/wpp\//i.test(src);
    if (isWppCmo && process.env.QUIET_WPP_CONSOLE === '1') return;
    const tag = isWppCmo ? '[wpp iframe — nu e cod TVApp] ' : '';
    console.error(tag + '[Renderer error]', message, src, lineNumber != null ? lineNumber : '');
  });

  const stripPowerBiHeaders = (details, callback) => {
    const url = (details.url || '').toLowerCase();
    const isPowerBiOrMs = /powerbi|microsoftonline|msauth|analysis\.windows\.net|aumovio\.com/.test(url);
    if (!isPowerBiOrMs) {
      callback({ cancel: false, responseHeaders: details.responseHeaders || {} });
      return;
    }
    const h = { ...(details.responseHeaders || {}) };
    Object.keys(h).forEach((k) => {
      const l = k.toLowerCase();
      if (l === 'x-frame-options' || l === 'content-security-policy' || l === 'frame-options' || l.includes('frame-ancestors')) delete h[k];
    });
    callback({ cancel: false, responseHeaders: h });
  };

  mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, stripPowerBiHeaders);
  session.fromPartition(POWERBI_PARTITION).webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, stripPowerBiHeaders);
  session.fromPartition(WEB_ACTION_PARTITION).webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, stripPowerBiHeaders);

  // Auto-click "Accept all" / "Accept" în dialoguri cookie – Shadow DOM, MutationObserver, toate iframe-urile
  const cookieAcceptAllScript = `
    (function() {
      var done = false;
      var getText = function(el) {
        if (!el) return '';
        var t = (el.textContent || el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().toLowerCase();
        return t.replace(/\\s+/g, ' ');
      };
      var acceptPhrases = ['accept all', 'acceptă toate', 'accepta toate', 'allow all', 'accept all cookies', 'allow all cookies', 'accept cookies', 'accept', 'allow', 'agree', 'ok', 'da', 'înteles', 'acceptă', 'accepta', 'consent'];
      var rejectPhrases = ['reject', 'refuz', 'settings', 'setări', 'customize', 'personalize', 'only necessary', 'necessary only'];
      function isAccept(text) {
        if (!text || text.length < 2) return false;
        if (rejectPhrases.some(function(r) { return text.indexOf(r) !== -1; })) return false;
        if (acceptPhrases.some(function(p) { return text.indexOf(p) !== -1; })) return true;
        if ((text.indexOf('accept') !== -1 || text.indexOf('allow') !== -1) && text.indexOf('all') !== -1) return true;
        return false;
      }
      function isVisible(el) {
        try {
          if (!el || !el.getBoundingClientRect) return false;
          var r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          if (r.top >= (window.innerHeight + 50)) return false;
          if (r.bottom <= -50) return false;
          return true;
        } catch (e) { return false; }
      }
      function collectClickables(root, out) {
        try {
          var sel = 'button, a[href], [role="button"], input[type="submit"], input[type="button"], [onclick], [data-action], [class*="accept"], [class*="allow"], [id*="accept"], [id*="cookie"]';
          var list = root.querySelectorAll(sel);
          for (var i = 0; i < list.length; i++) out.push(list[i]);
          var all = root.querySelectorAll('*');
          for (var j = 0; j < all.length; j++) {
            var node = all[j];
            if (node.shadowRoot) {
              collectClickables(node.shadowRoot, out);
            }
          }
        } catch (e) {}
      }
      function tryAccept() {
        if (done) return true;
        var candidates = [];
        collectClickables(document, candidates);
        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i];
          if (!isVisible(el)) continue;
          var text = getText(el);
          if (!isAccept(text)) continue;
          try {
            el.click();
            done = true;
            return true;
          } catch (e) {}
        }
        return false;
      }
      function run() {
        if (done) return;
        tryAccept();
      }
      setTimeout(run, 1000);
      setTimeout(run, 2500);
      setTimeout(run, 5000);
      setTimeout(run, 8000);
      setTimeout(run, 12000);
      if (document.body) {
        var mo = new MutationObserver(function() {
          if (done) return;
          setTimeout(run, 100);
        });
        mo.observe(document.body, { childList: true, subtree: true });
      }
      if (document.readyState !== 'complete') {
        window.addEventListener('load', function() { setTimeout(run, 500); });
      }
    })();
  `;
  mainWindow.webContents.on('did-frame-navigate', (event, url, httpResponseCode, httpStatusText, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isMainFrame) return;
    try {
      const u = (url || '').toLowerCase();
      if (u.startsWith('http://localhost') || u.startsWith('app://') || u.startsWith('workspace://') || u === 'about:blank') return;
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      if (frame) frame.executeJavaScript(cookieAcceptAllScript, true).catch(() => {});
    } catch (e) {}
  });

  mainWindow.loadURL(loadUrl);

  mainWindow.on('resize', () => {
    if (powerBiBrowserView && mainWindow && !mainWindow.isDestroyed()) {
      if (!powerBiCustomBounds) powerBiBrowserView.setBounds(mainWindow.getContentBounds());
      else mainWindow.webContents.send('powerbi-request-bounds');
    }
    if (webActionBrowserView && mainWindow && !mainWindow.isDestroyed()) {
      if (!webActionCustomBounds) webActionBrowserView.setBounds(mainWindow.getContentBounds());
      else mainWindow.webContents.send('web-action-request-bounds');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    powerBiBrowserView = null;
    webActionBrowserView = null;
    webActionCurrentUrl = null;
    webActionCustomBounds = false;
    powerBiCurrentUrl = null;
    powerBiScrollTimeouts.forEach((t) => clearTimeout(t));
    powerBiScrollTimeouts.length = 0;
    powerBiLoginRetryTimeouts.forEach((t) => clearTimeout(t));
    powerBiLoginRetryTimeouts.length = 0;
    powerBiScrollOptions = null;
  });
}

app.whenReady().then(async () => {
  if (!isDev) {
    protocol.handle('app', (request) => {
      let p = request.url.slice('app://'.length).replace(/#.*$/, '').replace(/^\/+/, '').replace(/^\.\/?/, '') || 'index.html';
      const filePath = path.resolve(DIST_PATH, p);
      if (!filePath.startsWith(DIST_PATH)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(filePath).href);
    });
  }

  // Protocol workspace:// – fișiere din WORKSPACE/<echipa selectată> (cu Content-Type + Range pentru video)
  const MIME_BY_EXT = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
    '.pdf': 'application/pdf'
  };
  // Protocol tvapp:// – redirect MSAL (Azure AD); permite iframe-urilor din aceeași sesiune să aibă cookie-uri
  protocol.handle('tvapp', async (request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const htmlSuccess = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Conectat</title></head><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#eee;"><p>Cont Microsoft conectat. Poți închide această fereastră.</p></body></html>';
    const htmlError = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Eroare</title></head><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1a1a2e;color:#e88;"><p>Autentificare eșuată. Închide fereastra și încearcă din nou.</p></body></html>';
    if ((url.hostname === 'auth' || url.pathname === '/' || url.pathname === '') && code) {
      try {
        await msalAuthService.acquireTokenByCode(code);
        if (mainWindow) mainWindow.webContents.send('msal-session-update', { loggedIn: true });
      } catch (err) {
        console.warn('[MSAL] acquireTokenByCode failed:', err.message);
      }
      if (msalAuthWindow && !msalAuthWindow.isDestroyed()) {
        msalAuthWindow.close();
        msalAuthWindow = null;
      }
      return new Response(htmlSuccess, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response(htmlError, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });

  protocol.handle('workspace', async (request) => {
    const raw = request.url.slice('workspace://'.length).replace(/^\/+/, '').replace(/^\.\/?/, '').replace(/#.*$/, '');
    const decoded = decodeURIComponent(raw);
    const filePath = await workspaceService.getWorkspaceFilePath(decoded);
    if (!filePath) return new Response('Not found', { status: 404 });
    try {
      await fsPromises.access(filePath);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
    const stat = await fsPromises.stat(filePath);
    const size = stat.size;
    const rangeHeader = request.headers.get('range');
    if (rangeHeader && ext in MIME_BY_EXT && contentType.startsWith('video/')) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        let start = parseInt(match[1], 10) || 0;
        let end = match[2] ? parseInt(match[2], 10) : size - 1;
        if (end >= size) end = size - 1;
        if (start > end) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        }
        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(filePath, { start, end });
        const webStream = Readable.toWeb(stream);
        return new Response(webStream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes'
          }
        });
      }
    }
    const stream = fs.createReadStream(filePath);
    const webStream = Readable.toWeb(stream);
    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes'
      }
    });
  });

  function openMainAndStart(repoPath, usedFallback) {
    if (repoPath) {
      const envPath = path.join(repoPath, '.env');
      if (fs.existsSync(envPath)) {
        try {
          require('dotenv').config({ path: envPath, override: true });
          console.log('[WorkspaceRepo] .env incarcat din repo:', envPath);
        } catch (e) {
          console.warn('[WorkspaceRepo] Eroare la incarcarea .env din repo:', (e && e.message) || e);
        }
      } else {
        console.log('[WorkspaceRepo] .env nu exista in repo (' + envPath + '), se folosesc variabilele curente.');
      }
      workspaceService.setWorkspaceRepoRoot(repoPath);
      setContentDir(repoPath);
      canteenMenuPdfService.setWorkspaceDir(workspaceService.getWorkspaceDir());
      console.log('[WorkspaceRepo] Folosesc repo:', repoPath);
      if (usedFallback) {
        dialog.showMessageBox({
          type: 'warning',
          title: 'Workspace – path rezervă',
          message: 'Nu s-a găsit nici drive-ul D: nici E:. Workspace folosește path rezervă:',
          detail: repoPath + '\n\nPentru sync cu repo pe D: sau E:, creați drive-ul și reporniți aplicația.'
        }).catch(() => {});
      }
    }
    createWindow(getBaseUrl());
    doGitSyncDetailed().then(function (result) {
      if (result && result.hadChanges && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('playlist-updated');
      }
      if (result && result.ok === false && !result.noRepo) {
        const msg = 'Nu s-au putut aduce ultimele modificări din repository (git pull a eșuat).\n\nCel mai des motiv: există fișiere modificate local în workspace care blochează pull-ul.\n\nDeschide Dashboard-ul sau un client Git și rezolvă conflictele / comite sau revino la versiunea din remote, apoi repornește aplicația.';
        dialog.showMessageBox({
          type: 'error',
          title: 'Workspace – eroare sincronizare',
          message: 'Eroare la sincronizarea conținutului (git pull).',
          detail: (result.errorMessage ? (result.errorMessage + '\n\n') : '') + msg,
          buttons: ['OK']
        }).catch(function () {});
      }
    }).catch(function () {});
    setTimeout(() => runAutoMsalLogin(), 1500);
    initGitSync(() => {
      if (mainWindow) mainWindow.webContents.send('playlist-updated');
    });
  }

  if (isDev) {
    openMainAndStart(null, false);
    startAppAfterSetup();
  } else {
    let setupWindow = null;
    let pendingRepoPath = null;
    let pendingUsedFallback = false;
    let pendingShowError = null;

    const iconPath = getAppIconPath();
    setupWindow = new BrowserWindow({
      width: 480,
      height: 320,
      resizable: false,
      autoHideMenuBar: true,
      ...(iconPath && { icon: iconPath }),
      title: 'Pregătire workspace – Aumovio TV',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    setupWindow.loadFile(path.join(__dirname, 'setupWindow.html'));

    function closeSetupAndOpenMain(showErrorDialog) {
      if (setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.close();
        setupWindow = null;
      }
      if (showErrorDialog) {
        dialog.showMessageBox({
          type: 'error',
          title: 'Workspace – eroare setup',
          message: showErrorDialog,
          detail: 'Aplicația folosește WORKSPACE din pachet. Pull/push nu vor actualiza un repo extern.'
        }).catch(() => {});
      }
      openMainAndStart(pendingRepoPath, pendingUsedFallback);
      startAppAfterSetup();
    }

    ipcMain.once('setup-finished', () => {
      closeSetupAndOpenMain(pendingShowError);
    });

    setupWindow.webContents.once('did-finish-load', async () => {
      const { getPreferredWorkspaceRepoPath, isGitRepo, getRepoCloneUrl, ensureWorkspaceRepo } = require('./workspaceRepoSetup');
      const send = (phase, message) => {
        if (setupWindow && !setupWindow.isDestroyed()) setupWindow.webContents.send('setup-phase', { phase, message });
      };
      send('check');
      try {
        const { path: repoPath, usedFallback } = await getPreferredWorkspaceRepoPath();
        const hasGit = await isGitRepo(repoPath);
        const cloneUrl = getRepoCloneUrl();

        if (hasGit) {
          workspaceService.setWorkspaceRepoRoot(repoPath);
          setContentDir(repoPath);
          send('pull');
          await doGitSync().catch(() => {});
          send('pull-done');
          pendingRepoPath = repoPath;
          pendingUsedFallback = usedFallback;
          setTimeout(() => {
            closeSetupAndOpenMain(false);
          }, 1500);
          return;
        }

        if (cloneUrl) {
          send('clone');
          try {
            const result = await ensureWorkspaceRepo();
            pendingRepoPath = result.path;
            pendingUsedFallback = result.usedFallback;
            send('clone-done');
          } catch (e) {
            console.error('[WorkspaceRepo] Setup eșuat:', e.message);
            pendingShowError = e.message;
            send('error', e.message);
          }
          return;
        }

        pendingRepoPath = repoPath;
        send('no-url');
      } catch (e) {
        console.error('[WorkspaceRepo]', e.message);
        pendingShowError = e.message;
        send('error', e.message);
      }
    });
  }

  function startAppAfterSetup() {
    // Versionare + update: la 30 min pull și verificăm version.json; dacă s-a schimbat, verificăm update (electron-updater) sau repornim
    const VERSION_FILE = path.join(__dirname, '..', 'version.json');
  let currentAppVersion = '1.0.0';
  try {
    const raw = fs.readFileSync(VERSION_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data && typeof data.version === 'string') currentAppVersion = data.version.trim();
  } catch (e) {
    console.warn('[Version] Could not read version at startup:', e.message);
  }

  const useUpdater = !isDev && (UPDATE_FEED_URL || GITHUB_UPDATE_REPO.owner);
  if (useUpdater) {
    if (UPDATE_FEED_URL) {
      autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL.replace(/\/$/, '') });
    } else {
      autoUpdater.setFeedURL({ provider: 'github', ...GITHUB_UPDATE_REPO });
    }
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => {
      console.log('[Update] Update available:', info.version);
    });
    autoUpdater.on('update-downloaded', () => {
      console.log('[Update] Update downloaded. Installing and restarting.');
      autoUpdater.quitAndInstall(false, true);
    });
    autoUpdater.on('error', (err) => {
      console.warn('[Update] Error:', err.message);
    });
  }

  setInterval(async () => {
    if (isDev) return;
    try {
      await doGitSync();
      const repoRoot = workspaceService.getWorkspaceRepoRoot();
      const versionFilePath = repoRoot
        ? path.join(repoRoot, 'version.json')
        : VERSION_FILE;
      let raw;
      try {
        raw = await fsPromises.readFile(versionFilePath, 'utf-8');
      } catch (e) {
        if (repoRoot) raw = await fsPromises.readFile(VERSION_FILE, 'utf-8').catch(() => null);
        else return;
      }
      if (!raw) return;
      const data = JSON.parse(raw);
      const newVersion = data && typeof data.version === 'string' ? data.version.trim() : null;
      if (!newVersion || newVersion === currentAppVersion) return;
      console.log('[Version] Detected new version', newVersion, '(current', currentAppVersion + ').');
      if (useUpdater) {
        autoUpdater.checkForUpdates().catch((e) => {
          console.warn('[Update] checkForUpdates failed:', e.message);
          app.relaunch();
          app.exit(0);
        });
      } else {
        app.relaunch();
        app.exit(0);
      }
    } catch (e) {
      console.warn('[Version] Check failed:', e.message);
    }
  }, 30 * 60 * 1000);

  // Canteen menu PDF: la orele din slots, clean + download PDF(s) + convert to images, apoi show popup
  let lastCanteenSlotKey = '';
  function parseDurationMinutes(str) {
    if (typeof str === 'number' && !Number.isNaN(str)) return Math.max(1, Math.min(120, str));
    if (!str || typeof str !== 'string') return 15;
    const num = parseInt(String(str).replace(/\D/g, ''), 10);
    return Number.isNaN(num) || num < 1 ? 15 : num;
  }
  /** Parse slot time: "10:30", "10:30 AM", "2:30 PM", "14:30" → { hour24, minute } or null. */
  function parseSlotTime(timeStr) {
    const s = (timeStr || '').trim();
    if (!s) return null;
    const upper = s.toUpperCase();
    const isAm = upper.endsWith(' AM');
    const isPm = upper.endsWith(' PM');
    let numPart = s;
    if (isAm || isPm) numPart = s.slice(0, -3).trim();
    const colon = numPart.indexOf(':');
    const hStr = colon >= 0 ? numPart.slice(0, colon).trim() : numPart;
    const mStr = colon >= 0 ? numPart.slice(colon + 1).trim().replace(/\D/g, '').slice(0, 2) : '0';
    let h = parseInt(hStr.replace(/\D/g, ''), 10);
    const m = parseInt(mStr, 10) || 0;
    if (Number.isNaN(h)) return null;
    if (isAm) {
      if (h === 12) h = 0;
    } else if (isPm) {
      if (h !== 12) h += 12;
    }
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return { hour24: h, minute: m };
  }
  function getSlotKey(date, timeStr) {
    const parsed = parseSlotTime(timeStr);
    if (!parsed) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}_${parsed.hour24}_${parsed.minute}`;
  }
  function isTimeMatch(slotTime, now) {
    const parsed = parseSlotTime(slotTime);
    if (!parsed) return false;
    return now.getHours() === parsed.hour24 && now.getMinutes() === parsed.minute;
  }
  function getSlotDelayMinutes(slotTime, now) {
    const parsed = parseSlotTime(slotTime);
    if (!parsed) return null;
    const slotDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parsed.hour24, parsed.minute, 0, 0);
    return Math.floor((now.getTime() - slotDate.getTime()) / 60000);
  }
  const CANTEEN_SLOT_GRACE_MINUTES = Math.max(1, Math.min(120, parseInt(process.env.CANTEEN_SLOT_GRACE_MINUTES || '20', 10) || 20));
  function isSlotDue(slotTime, now) {
    const delayMin = getSlotDelayMinutes(slotTime, now);
    if (delayMin == null) return false;
    return delayMin >= 0 && delayMin <= CANTEEN_SLOT_GRACE_MINUTES;
  }
  /** Run one canteen menu show cycle: download from URL if set, convert PDFs to images, then send canteen-menu-show (or load-failed). */
  async function runCanteenMenuShowOnce(team, content, durationMinutes, slotTimeLabel) {
    const slotTime = slotTimeLabel || 'test';
    const log = (msg) => console.log(msg);
    log('[Canteen] ---------- Pornire afisare meniu (slot: ' + slotTime + ') ----------');
    if (!mainWindow || mainWindow.isDestroyed()) {
      log('[Canteen] Eroare: fereastra principala nu este disponibila.');
      return;
    }
    if (!team) {
      log('[Canteen] Eroare: nici o echipa selectata. Selecteaza o echipa in aplicatie.');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('canteen-menu-load-failed', { error: 'Nici o echipă selectată.' });
      }
      return;
    }
    if (!content || typeof content !== 'object') {
      log('[Canteen] Eroare: lipseste continutul sectiunii canteen_menu (content.json gol sau inexistent).');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('canteen-menu-load-failed', { error: 'Lipsește conținutul Cantină. Salvează secțiunea în dashboard.' });
      }
      return;
    }
    const workspaceDir = workspaceService.getWorkspaceDir();
    const locationUrl = (content.canteenMenuLocation && typeof content.canteenMenuLocation === 'string')
      ? content.canteenMenuLocation.trim() : '';
    log('[Canteen] Echipa: ' + team + ' | Locatie URL: ' + (locationUrl ? locationUrl.substring(0, 50) + '...' : '(nesetata)'));

    if (!locationUrl) {
      log('[Canteen] Locatie SharePoint nesetata. Renunt la afisare meniu - nu se incarca PDF-uri din content.json. Fail loading.');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('canteen-menu-load-failed', {
          error: 'Locație SharePoint nesetată. Setează în dashboard (Cantină → Locație URL) pentru a descărca meniul.'
        });
      }
      log('[Canteen] ---------- Sfarsit afisare meniu ----------');
      return;
    }

    const email = (process.env.CANTEEN_LOGIN_EMAIL || '').trim();
    const password = (process.env.CANTEEN_LOGIN_PASSWORD || '').trim();
    if (!email || !password) {
      log('[Canteen] Avertisment: CANTEEN_LOGIN_EMAIL sau CANTEEN_LOGIN_PASSWORD lipsesc din .env - login pe SharePoint poate esua.');
    } else {
      log('[Canteen] Credentiale .env: email setat (' + email.substring(0, 3) + '...), parola setata.');
    }
    log('[Canteen] Label Meniu: "' + (content.canteenLabelMeniu || 'Meniu') + '" | Label Program: "' + (content.canteenLabelProgram || '2025_Cantina') + '"');
    const saveDirPdfs = path.join(workspaceDir, team, 'canteen_menu', 'pdfs');
    try {
      const entries = await fsPromises.readdir(saveDirPdfs, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.isFile()) await fsPromises.unlink(path.join(saveDirPdfs, e.name)).catch(() => {});
      }
      log('[Canteen] Folder pdfs golit. Descarc doar de pe SharePoint.');
    } catch (e) {
      log('[Canteen] Golire pdfs (optional): ' + (e.message || e));
    }
    log('[Canteen] Conectare la locatie si descarcare PDF-uri de pe SharePoint...');
    const downloadResult = await canteenMenuDownloadService.runCanteenMenuDownload({
      locationUrl,
      labelMeniu: (content.canteenLabelMeniu || 'Meniu').trim(),
      labelProgram: (content.canteenLabelProgram || '2025_Cantina').trim(),
      email,
      password,
      saveDirPdfs,
      showWindow: process.env.CANTEEN_DOWNLOAD_VISIBLE === '1'
    }, log);
    if (!downloadResult.ok || (!downloadResult.meniuPath && !downloadResult.programPath)) {
      log('[Canteen] Descarcare esuata sau niciun PDF gasit. Eroare: ' + (downloadResult.error || 'necunoscuta'));
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('canteen-menu-load-failed', {
          error: downloadResult.error || 'Descărcare eșuată. Verifică URL, credențiale (.env) și label-urile în dashboard.'
        });
      }
      log('[Canteen] ---------- Sfarsit afisare meniu ----------');
      return;
    }
    log('[Canteen] Descarcare reusita. Meniu: ' + (downloadResult.meniuPath || '-') + ' | Program: ' + (downloadResult.programPath || '-'));
    await new Promise((r) => setTimeout(r, 2000));
    const newItems = [];
    if (downloadResult.meniuPath) newItems.push({ path: downloadResult.meniuPath, range: 'all' });
    if (downloadResult.programPath) newItems.push({ path: downloadResult.programPath, range: 'all' });
    log('[Canteen] Conversie PDF -> imagini...');
    const refreshResult = await canteenMenuPdfService.runCanteenMenuRefresh(team, newItems, log);
    if (refreshResult.ok) {
      log('[Canteen] Succes: ' + (refreshResult.count || 0) + ' imagini generate. Astept 1.5s, ascund Power BI si afisez meniul.');
      await new Promise((r) => setTimeout(r, 1500));
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          if (powerBiBrowserView) {
            clearPowerBiScrollTimeouts();
            powerBiLoginRetryTimeouts.forEach(function (t) { clearTimeout(t); });
            powerBiLoginRetryTimeouts.length = 0;
            powerBiScrollOptions = null;
            powerBiCurrentUrl = null;
            mainWindow.removeBrowserView(powerBiBrowserView);
            try {
              if (!powerBiBrowserView.webContents.isDestroyed()) powerBiBrowserView.webContents.destroy();
            } catch (e2) {}
            powerBiBrowserView = null;
            powerBiCustomBounds = false;
            log('[Canteen] Power BI ascuns pentru afisare meniu.');
          }
        } catch (e) {
          log('[Canteen] powerbi-hide la show meniu: ' + (e.message || e));
        }
        mainWindow.webContents.send('canteen-menu-show', { durationMinutes, slotTime });
      }
    } else {
      log('[Canteen] Eroare conversie PDF->imagini: ' + (refreshResult.error || ''));
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('canteen-menu-load-failed', { error: refreshResult.error || 'Conversie PDF eșuată.' });
      }
    }
    log('[Canteen] ---------- Sfarsit afisare meniu ----------');
  }

  function tickCanteenMenuSlots() {
    if (!mainWindow) return;
    const log = (msg) => console.log(msg);
    workspaceService.getSelectedTeam().then((team) => {
      if (!team) {
        log('[Canteen] Slot check omis: nu exista echipa selectata.');
        return;
      }
      workspaceService.getSectionContent(team, 'canteen_menu').then(async (content) => {
        const slots = (content && content.slots && Array.isArray(content.slots)) ? content.slots : [];
        if (!slots.length) return;
        const now = new Date();
        for (const slot of slots) {
          const slotTime = slot && slot.time ? slot.time : null;
          if (!slotTime) continue;
          if (!isSlotDue(slotTime, now)) continue;
          const parsed = parseSlotTime(slotTime);
          const delayMin = getSlotDelayMinutes(slotTime, now);
          if (parsed) {
            log('[Canteen] Slot due: curent ' + now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ', slot "' + slotTime + '" -> ' + parsed.hour24 + ':' + String(parsed.minute).padStart(2, '0') + ', delay=' + delayMin + ' min (grace=' + CANTEEN_SLOT_GRACE_MINUTES + ' min)');
          }
          const slotKey = getSlotKey(now, slotTime);
          if (slotKey === lastCanteenSlotKey) continue;
          lastCanteenSlotKey = slotKey;
          const durationMinutes = parseDurationMinutes(slot.duration);
          await runCanteenMenuShowOnce(team, content, durationMinutes, slotTime);
          break;
        }
      });
    });
  }
  setInterval(tickCanteenMenuSlots, 30 * 1000);
  setTimeout(tickCanteenMenuSlots, 5 * 1000);

  // Test: afișare meniu cantină direct la deschiderea aplicației (setează CANTEEN_MENU_TEST_SHOW=1 în .env)
  const canteenTestShow = (process.env.CANTEEN_MENU_TEST_SHOW || '').trim().toLowerCase();
  if (canteenTestShow === '1' || canteenTestShow === 'true') {
    console.log('[Canteen] CANTEEN_MENU_TEST_SHOW=1: meniul va fi afisat la ~8s dupa deschidere.');
    setTimeout(() => {
      workspaceService.getSelectedTeam().then((team) => {
        if (!team || !mainWindow || mainWindow.isDestroyed()) {
          if (!team) console.log('[Canteen] Test show: nici o echipa selectata - omis.');
          return;
        }
        console.log('[Canteen] Test show: pornire afisare meniu pentru echipa "' + team + '".');
        workspaceService.getSectionContent(team, 'canteen_menu').then((content) => {
          const slots = (content && content.slots && Array.isArray(content.slots)) ? content.slots : [];
          const durationMinutes = slots.length && slots[0] ? parseDurationMinutes(slots[0].duration) : 15;
          runCanteenMenuShowOnce(team, content, durationMinutes);
        });
      });
    }, 8000);
  }
  }

  // IPC: echipe și playlist din WORKSPACE
  ipcMain.handle('get-app-env-flags', () => {
    const refreshRaw = parseInt(process.env.HARDWARE_TEMPS_REFRESH_MS, 10);
    const hardwareTempsRefreshMs =
      Number.isFinite(refreshRaw) && refreshRaw >= 60000 && refreshRaw <= 600000 ? refreshRaw : 120000;
    return {
      canteenAlwaysShow: process.env.CANTEEN_ALWAYS_SHOW === '1',
      trafficAlwaysShow: process.env.TRAFFIC_ALWAYS_SHOW === '1',
      hardwareTempsRefreshMs
    };
  });
  ipcMain.handle('get-hardware-temps', () => hardwareTempsService.getHardwareTemps());
  ipcMain.handle('get-teams', () => workspaceService.getTeams());
  ipcMain.handle('get-selected-team', () => workspaceService.getSelectedTeam());
  ipcMain.handle('set-selected-team', (_, team) => workspaceService.setSelectedTeam(team));
  ipcMain.handle('get-playlist', async () => {
    const team = await workspaceService.getSelectedTeam();
    return workspaceService.getPlaylistForTeam(team);
  });
  ipcMain.handle('get-git-sync-status', () => getGitSyncStatus());
  ipcMain.handle('get-playlist-for-team', (_, team) => workspaceService.getPlaylistForTeam(team));
  ipcMain.handle('get-traffic-data', () => trafficService.getTrafficData());
  ipcMain.handle('get-section-content', (_, team, sectionId) => workspaceService.getSectionContent(team, sectionId));
  ipcMain.handle('get-all-sections-content', (_, team) => workspaceService.getAllSectionsContent(team));
  ipcMain.handle('get-workspace-folder-images', (_, relativePath) =>
    workspaceService.getWorkspaceFolderImages(relativePath)
  );
  // Uptime: check if page URL exists and returns content (no CORS in main process)
  ipcMain.handle('check-uptime-url', async (_, url) => {
    if (!url || typeof url !== 'string') return { ok: false };
    const u = url.trim();
    if (!u.startsWith('http://') && !u.startsWith('https://')) return { ok: false };
    try {
      const res = await fetch(u, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'AumovioTV-UptimeCheck/1.0' }
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });
  // Flightboard: JSON cu projects[] (admin); fetch din main pentru a evita CORS
  ipcMain.handle('fetch-flightboard-projects', async (_, url) => {
    const fromEnv = (process.env.FLIGHTBOARD_PROJECTS_URL || '').trim();
    const u =
      typeof url === 'string' && /^https?:\/\//i.test(url.trim())
        ? url.trim()
        : fromEnv && /^https?:\/\//i.test(fromEnv)
          ? fromEnv
          : 'https://flightboard-query-prod.cmo.aws.automotive.cloud/rest/projects';
    try {
      const res = await fetch(u, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AumovioTV-Flightboard/1.0'
        }
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      const projects = Array.isArray(data?.projects) ? data.projects : [];
      return { ok: true, projects };
    } catch (e) {
      return { ok: false, error: e?.message || 'fetch failed' };
    }
  });
  ipcMain.handle('quit-app', () => app.quit());
  ipcMain.handle('open-admin-window', () => createAdminWindow());
  ipcMain.handle('auth-register', (_, email, password) => authService.register(email, password));
  ipcMain.handle('auth-login', (_, email, password) => authService.login(email, password));
  ipcMain.handle('auth-check', (_, token) => authService.checkSession(token));
  ipcMain.handle('auth-logout', (_, token) => authService.logout(token));
  ipcMain.handle('auth-forgot-password', (_, email) => authService.forgotPassword(email));
  ipcMain.handle('auth-reset-password', (_, token, newPassword) => authService.resetPassword(token, newPassword));
  ipcMain.handle('admin-create-team', (_, name) => workspaceService.createTeam(name));
  ipcMain.handle('admin-delete-team', (_, name) => workspaceService.deleteTeam(name));
  ipcMain.handle('admin-save-playlist', async (_, teamName, data) => {
    const res = await workspaceService.savePlaylist(teamName, data);
    if (res && res.ok && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('playlist-updated');
    }
    return res;
  });
  ipcMain.handle('admin-save-section-content', async (_, teamName, sectionId, data) => {
    const ok = await workspaceService.writeSectionContent(teamName, sectionId, data);
    return { ok };
  });

  // MSAL – Microsoft Enterprise (sesiune + cookie-uri pentru webview/iframe protejat)
  ipcMain.handle('msal-is-configured', () => msalAuthService.isLoginAvailable());
  ipcMain.handle('msal-get-account', async () => {
    if (!msalAuthService.isConfigured()) return null;
    try {
      const account = await msalAuthService.getAccount();
      return account ? { username: account.username, name: account.name } : null;
    } catch {
      return null;
    }
  });
  ipcMain.handle('msal-get-access-token', async () => {
    if (!msalAuthService.isConfigured()) return null;
    try {
      return await msalAuthService.getAccessToken();
    } catch {
      return null;
    }
  });
  async function doMsalLogin() {
    if (!msalAuthService.isLoginAvailable()) return { ok: false, error: 'Adaugă AZURE_CLIENT_ID sau MSAL_DIRECT_LOGIN_URL în .env' };
    if (msalAuthWindow && !msalAuthWindow.isDestroyed()) return { ok: false, error: 'Fereastra de login e deja deschisă.' };
    const directUrl = msalAuthService.getDirectLoginUrl();
    const authUrl = directUrl || (msalAuthService.isConfigured() ? await msalAuthService.getAuthCodeUrl() : null);
    if (!authUrl) return { ok: false, error: 'Configurare .env incompletă.' };
    const emailEnv = (process.env.MSAL_LOGIN_EMAIL || '').trim();
    const passEnv = (process.env.MSAL_LOGIN_PASSWORD || '').trim();
    const autoCredentials = !!emailEnv && !!passEnv;
    const iconPath = getAppIconPath();
    msalAuthWindow = new BrowserWindow({
      width: 700,
      height: 800,
      show: false,
      title: 'Sign In Microsoft',
      ...(iconPath && { icon: iconPath }),
      webPreferences: {
        partition: POWERBI_PARTITION,
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    if (!autoCredentials) msalAuthWindow.show();

    const wc = msalAuthWindow.webContents;
    const closeOnSuccess = (reason) => {
      console.log('[MSAL] Login success:', reason || 'redirect detected');
      if (msalAuthWindow && !msalAuthWindow.isDestroyed()) {
        msalAuthWindow.close();
      }
    };

    console.log('[MSAL] Login started. Auto-credentials from .env:', autoCredentials);

    if (autoCredentials) {
      wc.on('did-finish-load', () => {
        const url = (wc.getURL() || '').toLowerCase();
        if (url.startsWith('tvapp://') || url.includes('app.powerbi.com')) {
          closeOnSuccess('reached Power BI / tvapp');
          return;
        }
        const isMsLogin = url.includes('login.microsoftonline.com');
        const isPowerBiPage = url.includes('powerbi.com');
        if (!isMsLogin && !isPowerBiPage) return;
        console.log('[MSAL] Injecting credentials on login page');
        const email = JSON.stringify(emailEnv);
        const pass = JSON.stringify(passEnv);
        const script = `
          (function(){
            var email = ${email};
            var pass = ${pass};
            var done = false;
            function run() {
              if (done) return;
              var emailInp = document.querySelector('input[type="email"]') || document.querySelector('input[name="loginfmt"]') || document.querySelector('#i0116') || document.querySelector('input[placeholder*="mail" i]') || document.querySelector('input[placeholder*="email" i]');
              var passInp = document.querySelector('input[type="password"]') || document.querySelector('input[name="passwd"]') || document.querySelector('#i0118');
              if (emailInp && !passInp && email) {
                emailInp.value = email;
                emailInp.dispatchEvent(new Event('input', { bubbles: true }));
                emailInp.dispatchEvent(new Event('change', { bubbles: true }));
                var next = document.querySelector('input[type="submit"]') || document.querySelector('#idSIButton9') || document.querySelector('button[type="submit"]') || document.querySelector('button[type="button"]') || Array.from(document.querySelectorAll('input[type="submit"], button')).find(function(el){ var t = (el.value || el.textContent || '').toLowerCase(); return /next|continuar|weiter|suivant|submit|trimite/i.test(t); });
                if (next) { next.click(); done = true; }
              } else if (passInp && pass) {
                passInp.value = pass;
                passInp.dispatchEvent(new Event('input', { bubbles: true }));
                passInp.dispatchEvent(new Event('change', { bubbles: true }));
                var submit = document.querySelector('input[type="submit"]') || document.querySelector('#idSIButton9') || document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('input[type="submit"], button')).find(function(el){ var t = (el.value || el.textContent || '').toLowerCase(); return /sign in|conectare|anmelden|se connecter|submit|trimite|sign in/i.test(t); });
                if (submit) { submit.click(); done = true; }
              }
            }
            setTimeout(run, 400);
            setTimeout(run, 1200);
            setTimeout(run, 2500);
          })();
        `;
        wc.executeJavaScript(script).catch(() => {});
      });
      wc.on('did-navigate', (e, url) => {
        if (url && (url.startsWith('tvapp://') || url.includes('app.powerbi.com'))) setTimeout(() => closeOnSuccess('did-navigate'), 150);
      });
      wc.on('will-redirect', (e, url) => {
        if (url && (url.startsWith('tvapp://') || url.includes('app.powerbi.com'))) setTimeout(() => closeOnSuccess('will-redirect'), 150);
      });
    }

    msalAuthWindow.on('closed', () => {
      msalAuthWindow = null;
      console.log('[MSAL] Auth window closed');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        mainWindow.webContents.send('msal-session-update', {});
      }
    });

    msalAuthWindow.loadURL(authUrl);
    return { ok: true };
  }

  ipcMain.handle('msal-login', async () => {
    try {
      return await doMsalLogin();
    } catch (err) {
      return { ok: false, error: err.message || 'Eroare la deschiderea login.' };
    }
  });

  async function isMsalSessionActive() {
    if (msalAuthService.isConfigured()) {
      const account = await msalAuthService.getAccount();
      if (account) return true;
    }
    if (!msalAuthService.getDirectLoginUrl()) return false;
    try {
      const ses = session.fromPartition(POWERBI_PARTITION);
      const [a, b] = await Promise.all([
        ses.cookies.get({ url: 'https://login.microsoftonline.com' }),
        ses.cookies.get({ url: 'https://app.powerbi.com' })
      ]);
      return (a && a.length > 0) || (b && b.length > 0);
    } catch {
      return false;
    }
  }

  ipcMain.handle('msal-session-active', async () => {
    let active = false;
    try {
      if (msalAuthService.isConfigured()) {
        const account = await msalAuthService.getAccount();
        if (account) {
          console.log('[MSAL] Session check: active=YES (OAuth account)');
          return { active: true };
        }
      }
      if (!msalAuthService.getDirectLoginUrl()) {
        console.log('[MSAL] Session check: active=NO (no direct login URL, no OAuth account)');
        return { active: false };
      }
      const ses = session.fromPartition(POWERBI_PARTITION);
      const [loginCookies, powerbiCookies] = await Promise.all([
        ses.cookies.get({ url: 'https://login.microsoftonline.com' }),
        ses.cookies.get({ url: 'https://app.powerbi.com' })
      ]);
      const nLogin = (loginCookies && loginCookies.length) || 0;
      const nPowerBi = (powerbiCookies && powerbiCookies.length) || 0;
      active = nLogin > 0 || nPowerBi > 0;
      console.log(
        '[MSAL] Session check:',
        active ? 'active=YES' : 'active=NO',
        `(partition ${POWERBI_PARTITION}: login.microsoftonline.com: ${nLogin} cookies, app.powerbi.com: ${nPowerBi} cookies)`
      );
    } catch (e) {
      console.error('[MSAL] Session check error:', e.message);
    }
    return { active };
  });

  ipcMain.handle('msal-logout', async () => {
    try {
      await msalAuthService.logout();
      const ses = session.fromPartition(POWERBI_PARTITION);
      const urls = ['https://login.microsoftonline.com', 'https://app.powerbi.com'];
      for (const url of urls) {
        try {
          const list = await ses.cookies.get({ url });
          for (const c of list || []) await ses.cookies.remove(url, c.name);
        } catch {}
      }
      if (mainWindow) mainWindow.webContents.send('msal-session-update', { loggedIn: false });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Pagina de login Microsoft: completare din .env. Simulare tastare + setare nativă ca validarea să accepte.
  function getPowerBiLoginScript() {
    const email = (process.env.MSAL_LOGIN_EMAIL || '').trim();
    const pass = (process.env.MSAL_LOGIN_PASSWORD || '').trim();
    if (!email || !pass) return null;
    return `
      (function(){
        var email = ${JSON.stringify(email)};
        var pass = ${JSON.stringify(pass)};
        function tryPickAccountPage() {
          var bodyText = (document.body && document.body.innerText) ? document.body.innerText : '';
          if (bodyText.indexOf('Pick an account') === -1 && bodyText.indexOf('Choose an account') === -1) return false;
          var emailLower = (email || '').toLowerCase().trim();
          if (!emailLower) return false;
          var all = document.querySelectorAll('div[role="button"], div[role="listitem"], a[href], button, [data-testid], .table-row, [class*="tile"], [class*="account"]');
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            var txt = (el.textContent || el.innerText || '').toLowerCase();
            if (txt.indexOf(emailLower) !== -1) {
              el.click();
              return true;
            }
          }
          var useOther = Array.from(document.querySelectorAll('a, button, div[role="button"], span')).find(function(n) {
            var t = (n.textContent || n.innerText || '').trim().toLowerCase();
            return t.indexOf('use another account') !== -1 || t.indexOf('alt cont') !== -1;
          });
          if (useOther) {
            useOther.click();
            return true;
          }
          return false;
        }
        if (tryPickAccountPage()) return;
        function setInputValueLikeUser(inp, val) {
          inp.focus();
          var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
          if (!proto) proto = inp.constructor.prototype;
          try {
            var desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) {
              desc.set.call(inp, val);
              try { inp.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertText' })); } catch (e) { inp.dispatchEvent(new Event('input', { bubbles: true })); }
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              inp.value = val;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } catch (e) {
            inp.value = val;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
          inp.dispatchEvent(new Event('blur', { bubbles: true }));
        }
        function findEmailInput() {
          return document.querySelector('#i0116') || document.querySelector('input[name="loginfmt"]') || document.querySelector('input[name="username"]') || document.querySelector('input[name="email"]') || document.querySelector('input[id*="user"]') || document.querySelector('input[id*="email"]') || document.querySelector('input[type="email"]') || document.querySelector('input[placeholder*="mail" i]') || document.querySelector('input[placeholder*="user" i]') || document.querySelector('input[placeholder*="Skype" i]') || document.querySelector('input[type="text"]:not([type="hidden"])') || Array.from(document.querySelectorAll('input')).find(function(i){ return i.type !== 'password' && i.type !== 'hidden'; });
        }
        function findPasswordInput() {
          return document.querySelector('#i0118') || document.querySelector('input[name="passwd"]') || document.querySelector('input[name="password"]') || document.querySelector('input[id*="pass"]') || document.querySelector('input[type="password"]');
        }
        function findNextButton() {
          return document.querySelector('#idSIButton9') || document.querySelector('input[type="submit"]') || document.querySelector('input[value="Next"]') || Array.from(document.querySelectorAll('input[type="submit"], button, [type="submit"]')).find(function(b){ var t = (b.value || b.textContent || '').trim(); return /^next$/i.test(t) || /^continuar$/i.test(t) || /^weiter$/i.test(t); });
        }
        function findSignInButton() {
          var s = document.querySelector('#idSIButton9') || document.querySelector('input[value="Sign in"]') || document.querySelector('input[value="Sign  in"]') || document.querySelector('input[type="submit"]') || document.querySelector('button[type="submit"]');
          if (s) return s;
          var candidates = document.querySelectorAll('input[type="submit"], input[type="button"], button, [role="button"]');
          for (var i = 0; i < candidates.length; i++) {
            var t = (candidates[i].value || candidates[i].textContent || candidates[i].innerText || '').trim().toLowerCase();
            if (t.indexOf('sign') >= 0 && t.indexOf('in') >= 0) return candidates[i];
            if (/signin|submit|login|conectare|trimite/.test(t)) return candidates[i];
          }
          var anySubmit = document.querySelector('form input[type="submit"]') || document.querySelector('form button[type="submit"]') || document.querySelector('input[type="submit"]') || document.querySelector('button[type="submit"]');
          return anySubmit;
        }
        var emailInp = findEmailInput();
        var passInp = findPasswordInput();
        if (emailInp && !passInp && email) {
          setInputValueLikeUser(emailInp, email);
          setTimeout(function(){ var n = findNextButton(); if (n) n.click(); }, 1200);
        } else if (passInp && pass) {
          if (emailInp && email) {
            setInputValueLikeUser(emailInp, email);
            setTimeout(function() {
              setInputValueLikeUser(passInp, pass);
              setTimeout(function(){ var s = findSignInButton(); if (s) s.click(); }, 800);
            }, 600);
          } else {
            setInputValueLikeUser(passInp, pass);
            setTimeout(function(){ var s = findSignInButton(); if (s) s.click(); }, 800);
          }
        }
      })();
    `;
  }

  function isLoginPageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();
    if (u.includes('login.microsoftonline.com') || u.includes('login.live.com') || u.includes('login.windows.net')) return true;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname || '';
      const path = parsed.pathname || '';
      if (/adfs|sts|login|signin|auth\./.test(host)) return true;
      if (/\/adfs\/|\/login|\/signin|\/auth\//.test(path)) return true;
    } catch (e) {}
    return false;
  }

  function powerBiDisplayUrl(url) {
    if (!url || typeof url !== 'string') return url;
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + 'chromeless=true';
  }

  function clearPowerBiScrollTimeouts() {
    powerBiScrollTimeouts.forEach(function (t) { clearTimeout(t); });
    powerBiScrollTimeouts = [];
  }

  var POWERBI_SCROLL_LOAD_DELAY_MS = 10000;

  function getAllFrames(frame, list) {
    if (!frame) return list;
    list.push(frame);
    try {
      var frames = frame.frames || [];
      for (var i = 0; i < frames.length; i++) getAllFrames(frames[i], list);
    } catch (e) {}
    return list;
  }

  var POWERBI_FIND_SCROLLABLE_SCRIPT = `
    function findScrollableElement(minHeight) {
      minHeight = minHeight || 80;
      var candidates = [];
      function isNav(el) {
        if (!el || el.nodeType !== 1) return false;
        var c = (el.className && typeof el.className === 'string' ? el.className : '').toLowerCase();
        var i = (el.id || '').toLowerCase();
        var r = (el.getAttribute && el.getAttribute('role')) || '';
        return el.tagName === 'NAV' || c.indexOf('nav') >= 0 || i.indexOf('nav') >= 0 || String(r).toLowerCase() === 'navigation';
      }
      function collect(el) {
        if (!el || el.nodeType !== 1) return;
        if (isNav(el)) return;
        try {
          var sh = el.scrollHeight;
          var ch = el.clientHeight;
          if (ch >= minHeight && sh > ch) candidates.push(el);
        } catch (e) {}
        if (el.children) {
          for (var j = 0; j < el.children.length; j++) collect(el.children[j]);
        }
      }
      var root = document.getElementById('content-container');
      if (!root) root = document.body || document.documentElement;
      if (root) collect(root);
      if (candidates.length === 0) return null;
      candidates.sort(function(a, b) {
        var aPages = (a.scrollHeight - a.clientHeight) / (a.clientHeight || 1);
        var bPages = (b.scrollHeight - b.clientHeight) / (b.clientHeight || 1);
        if (bPages !== aPages) return bPages - aPages;
        return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
      });
      return candidates[0];
    }
  `;

  var WEBLIVE_FIND_SCROLLABLE_SCRIPT = `
    function findScrollableElement(minHeight) {
      minHeight = minHeight || 80;
      var candidates = [];
      function isNav(el) {
        if (!el || el.nodeType !== 1) return false;
        var c = (el.className && typeof el.className === 'string' ? el.className : '').toLowerCase();
        var i = (el.id || '').toLowerCase();
        var r = (el.getAttribute && el.getAttribute('role')) || '';
        return el.tagName === 'NAV' || c.indexOf('nav') >= 0 || i.indexOf('nav') >= 0 || String(r).toLowerCase() === 'navigation';
      }
      function collect(el) {
        if (!el || el.nodeType !== 1) return;
        if (isNav(el)) return;
        try {
          var sh = el.scrollHeight;
          var ch = el.clientHeight;
          if (ch >= minHeight && sh > ch) candidates.push(el);
        } catch (e) {}
        if (el.children) {
          for (var j = 0; j < el.children.length; j++) collect(el.children[j]);
        }
      }
      var root = document.body || document.documentElement;
      if (root) collect(root);
      if (candidates.length === 0) return null;
      candidates.sort(function(a, b) {
        var aPages = (a.scrollHeight - a.clientHeight) / (a.clientHeight || 1);
        var bPages = (b.scrollHeight - b.clientHeight) / (b.clientHeight || 1);
        if (bPages !== aPages) return bPages - aPages;
        return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight);
      });
      return candidates[0];
    }
  `;

  function getPowerBiScrollInfoScript() {
    return `
      (function() {
        ${POWERBI_FIND_SCROLLABLE_SCRIPT}
        var el = findScrollableElement(80);
        if (el) return JSON.stringify({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
        if (document.body && document.body.scrollHeight > document.body.clientHeight)
          return JSON.stringify({ scrollHeight: document.body.scrollHeight, clientHeight: document.body.clientHeight });
        if (document.documentElement)
          return JSON.stringify({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight });
        return JSON.stringify({ scrollHeight: 0, clientHeight: 0 });
      })();
    `;
  }

  function getPowerBiScrollScript() {
    return `
      (function() {
        ${POWERBI_FIND_SCROLLABLE_SCRIPT}
        var el = findScrollableElement(80);
        if (el) {
          var h = el.clientHeight;
          var max = el.scrollHeight - h;
          el.scrollTop = Math.min(el.scrollTop + h, max);
          return JSON.stringify({ scrolled: true, by: 'dynamic', scrollTop: el.scrollTop, max: max });
        }
        if (document.body && document.body.scrollHeight > window.innerHeight) {
          window.scrollBy(0, window.innerHeight);
          return JSON.stringify({ scrolled: true, by: 'window' });
        }
        if (document.documentElement && document.documentElement.scrollHeight > window.innerHeight) {
          document.documentElement.scrollTop += window.innerHeight;
          return JSON.stringify({ scrolled: true, by: 'documentElement' });
        }
        return JSON.stringify({ scrolled: false });
      })();
    `;
  }

  function getWebLiveScrollInfoScript() {
    return `
      (function() {
        ${WEBLIVE_FIND_SCROLLABLE_SCRIPT}
        var el = findScrollableElement(80);
        if (el) return JSON.stringify({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
        if (document.body && document.body.scrollHeight > document.body.clientHeight)
          return JSON.stringify({ scrollHeight: document.body.scrollHeight, clientHeight: document.body.clientHeight });
        if (document.documentElement)
          return JSON.stringify({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight });
        return JSON.stringify({ scrollHeight: 0, clientHeight: 0 });
      })();
    `;
  }

  /** Pentru web_action: CSS selector sau fragment HTML (ex. <label for="x">Text</label>) → click pe elementul din pagină. */
  function buildWebActionClickScript(userInput) {
    var lit = JSON.stringify(userInput);
    return `(function(){
      function escId(id) {
        if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(id);
        return String(id).replace(/([^a-zA-Z0-9_-])/g, '\\\\$1');
      }
      function escAttr(v) {
        return String(v).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
      }
      function resolveAndClick(raw) {
        var s = String(raw || '').trim();
        if (!s) return false;
        if (s.charAt(0) === '<') {
          try {
            var container = document.createElement('div');
            container.innerHTML = s;
            var sample = container.firstElementChild;
            if (!sample) return false;
            var tag = sample.tagName.toLowerCase();
            if (sample.id) {
              var q = '#' + escId(sample.id);
              var el = document.querySelector(q);
              if (el) { el.click(); return true; }
            }
            if (sample.hasAttribute('for')) {
              var fv = sample.getAttribute('for');
              if (fv) {
                var q2 = tag + '[for="' + escAttr(fv) + '"]';
                var el2 = document.querySelector(q2);
                if (el2) { el2.click(); return true; }
              }
            }
            var nv = sample.getAttribute('name');
            if (nv) {
              var q3 = tag + '[name="' + escAttr(nv) + '"]';
              var el3 = document.querySelector(q3);
              if (el3) { el3.click(); return true; }
            }
            var cls = sample.getAttribute('class');
            if (cls) {
              var fc = cls.trim().split(/\\s+/)[0];
              if (fc) {
                var q4 = tag + '[class~="' + escAttr(fc) + '"]';
                var el4 = document.querySelector(q4);
                if (el4) { el4.click(); return true; }
              }
            }
            var href = sample.getAttribute('href');
            if (href && tag === 'a') {
              var q5 = 'a[href="' + escAttr(href) + '"]';
              var el5 = document.querySelector(q5);
              if (el5) { el5.click(); return true; }
            }
            var wantText = (sample.textContent || '').trim();
            if (wantText && tag) {
              var nodes = document.querySelectorAll(tag);
              for (var i = 0; i < nodes.length; i++) {
                if ((nodes[i].textContent || '').trim() === wantText) {
                  nodes[i].click();
                  return true;
                }
              }
            }
          } catch (e) {}
        }
        try {
          var el6 = document.querySelector(s);
          if (el6) { el6.click(); return true; }
        } catch (e2) {}
        return false;
      }
      return resolveAndClick(${lit});
    })()`;
  }

  function getWebLiveScrollScript() {
    return `
      (function() {
        ${WEBLIVE_FIND_SCROLLABLE_SCRIPT}
        var el = findScrollableElement(80);
        if (el) {
          var h = el.clientHeight;
          var max = el.scrollHeight - h;
          el.scrollTop = Math.min(el.scrollTop + h, max);
          return JSON.stringify({ scrolled: true, by: 'dynamic', scrollTop: el.scrollTop, max: max });
        }
        if (document.body && document.body.scrollHeight > window.innerHeight) {
          window.scrollBy(0, window.innerHeight);
          return JSON.stringify({ scrolled: true, by: 'window' });
        }
        if (document.documentElement && document.documentElement.scrollHeight > window.innerHeight) {
          document.documentElement.scrollTop += window.innerHeight;
          return JSON.stringify({ scrolled: true, by: 'documentElement' });
        }
        return JSON.stringify({ scrolled: false });
      })();
    `;
  }

  function runPowerBiScrollOnce(webContents, idx, scrollCount, script, cb) {
    if (!webContents || webContents.isDestroyed()) return;
    var mainFrame = webContents.mainFrame;
    var answered = false;
    function once(o) {
      if (answered) return;
      answered = true;
      if (cb) cb(o);
    }
    if (!mainFrame) {
      webContents.executeJavaScript(script).then(function (r) {
        try { var o = typeof r === 'string' ? JSON.parse(r) : r; once(o); } catch (e) { once({ scrolled: false }); }
      }).catch(function () { once({ scrolled: false }); });
      return;
    }
    var frames = getAllFrames(mainFrame, []);
    frames.forEach(function (frame) {
      frame.executeJavaScript(script).then(function (r) {
        try {
          var o = typeof r === 'string' ? JSON.parse(r) : r;
          if (o.scrolled) once(o);
        } catch (e) {}
      }).catch(function () {});
    });
    setTimeout(function () { once({ scrolled: false }); }, 800);
  }

  function getPowerBiHideNavScript() {
    return `
      (function() {
        var btn = document.querySelector('[data-testid="toggle-nav-btn"]') ||
          document.querySelector('[aria-label="NavigationPane_Minimize"]') ||
          document.querySelector('button[title="Hide the navigation pane"]');
        if (!btn && typeof document.querySelectorAll === 'function') {
          var buttons = document.querySelectorAll('button');
          for (var i = 0; i < buttons.length; i++) {
            if ((buttons[i].textContent || '').indexOf('Hide Navigation') >= 0) { btn = buttons[i]; break; }
          }
        }
        if (btn && btn.ariaExpanded !== 'false') {
          btn.click();
          return JSON.stringify({ clicked: true });
        }
        return JSON.stringify({ clicked: false });
      })();
    `;
  }

  function runPowerBiHideNav(webContents) {
    if (!webContents || webContents.isDestroyed()) return;
    var script = getPowerBiHideNavScript();
    var mainFrame = webContents.mainFrame;
    if (!mainFrame) {
      webContents.executeJavaScript(script).then(function (r) {
        try { var o = typeof r === 'string' ? JSON.parse(r) : r; if (o && o.clicked) console.log('[PowerBI] Hide Navigation: click executat'); } catch (e) {}
      }).catch(function () {});
      return;
    }
    var frames = getAllFrames(mainFrame, []);
    frames.forEach(function (frame) {
      frame.executeJavaScript(script).then(function (r) {
        try {
          var o = typeof r === 'string' ? JSON.parse(r) : r;
          if (o && o.clicked) console.log('[PowerBI] Hide Navigation: click executat');
        } catch (e) {}
      }).catch(function () {});
    });
  }

  function runPowerBiGetScrollInfo(webContents, cb) {
    if (!webContents || webContents.isDestroyed()) return;
    var script = getPowerBiScrollInfoScript();
    var mainFrame = webContents.mainFrame;
    var answered = false;
    function once(info) {
      if (answered) return;
      answered = true;
      if (cb) cb(info);
    }
    if (!mainFrame) {
      webContents.executeJavaScript(script).then(function (r) {
        try { var o = typeof r === 'string' ? JSON.parse(r) : r; once(o); } catch (e) { once({ scrollHeight: 0, clientHeight: 0 }); }
      }).catch(function () { once({ scrollHeight: 0, clientHeight: 0 }); });
      return;
    }
    var frames = getAllFrames(mainFrame, []);
    frames.forEach(function (frame) {
      frame.executeJavaScript(script).then(function (r) {
        try {
          var o = typeof r === 'string' ? JSON.parse(r) : r;
          if (o && o.scrollHeight > 0 && o.clientHeight > 0 && o.scrollHeight > o.clientHeight) once(o);
        } catch (e) {}
      }).catch(function () {});
    });
    setTimeout(function () { once({ scrollHeight: 0, clientHeight: 0 }); }, 1500);
  }

  function schedulePowerBiAutoScroll(webContents, durationSec, scrollCount) {
    if (!webContents || webContents.isDestroyed()) return;
    if (scrollCount < 1 || durationSec < 1) return;
    clearPowerBiScrollTimeouts();
    var durationMs = durationSec * 1000;
    var delayMs = POWERBI_SCROLL_LOAD_DELAY_MS;
    var remainingMs = Math.max(0, durationMs - delayMs);
    var intervalMs = remainingMs / (scrollCount + 1);
    var script = getPowerBiScrollScript();
    console.log('[PowerBI] Auto-scroll: delay', (delayMs / 1000) + 's, apoi', scrollCount, 'scroll(s) la interval', (intervalMs / 1000).toFixed(1) + 's');
    for (var i = 1; i <= scrollCount; i++) {
      (function (idx) {
        var t = setTimeout(function () {
          if (webContents.isDestroyed()) return;
          console.log('[PowerBI] Scroll', idx + '/' + scrollCount);
          runPowerBiScrollOnce(webContents, idx, scrollCount, script, function (out) {
            console.log('[PowerBI] Scroll', idx + '/' + scrollCount, '->', out.scrolled ? 'OK' : 'nu', out.by || '', out.scrollTop != null ? 'scrollTop=' + Math.round(out.scrollTop) : '');
          });
        }, delayMs + idx * intervalMs);
        powerBiScrollTimeouts.push(t);
      })(i);
    }
  }

  function schedulePowerBiAutoScrollFromNow(webContents, remainingMs, scrollCount) {
    if (!webContents || webContents.isDestroyed()) return;
    if (scrollCount < 1 || remainingMs < 100) return;
    clearPowerBiScrollTimeouts();
    var segmentMs = remainingMs / (scrollCount + 1);
    var script = getPowerBiScrollScript();
    console.log('[PowerBI] Auto-scroll: timp împărțit la', (scrollCount + 1), '– delay și interval =', (segmentMs / 1000).toFixed(1) + 's,', scrollCount, 'scroll(uri)');
    for (var i = 1; i <= scrollCount; i++) {
      (function (idx) {
        var t = setTimeout(function () {
          if (webContents.isDestroyed()) return;
          console.log('[PowerBI] Scroll', idx + '/' + scrollCount);
          runPowerBiScrollOnce(webContents, idx, scrollCount, script, function (out) {
            console.log('[PowerBI] Scroll', idx + '/' + scrollCount, '->', out.scrolled ? 'OK' : 'nu', out.by || '', out.scrollTop != null ? 'scrollTop=' + Math.round(out.scrollTop) : '');
          });
        }, idx * segmentMs);
        powerBiScrollTimeouts.push(t);
      })(i);
    }
  }

  function injectPowerBiLoginIfNeeded(webContents) {
    if (!webContents || webContents.isDestroyed()) return;
    const url = webContents.getURL();
    if (!isLoginPageUrl(url)) return;
    const script = getPowerBiLoginScript();
    if (!script) return;
    console.log('[PowerBI] Pagină login detectată, injectare completare email/parolă:', url.substring(0, 80) + '...');
    webContents.executeJavaScript(script).catch(function (e) {
      console.warn('[PowerBI] Login inject error:', e.message);
    });
  }

  function schedulePowerBiLoginRetries(webContents) {
    if (!webContents || webContents.isDestroyed() || !getPowerBiLoginScript()) return;
    powerBiLoginRetryTimeouts.forEach(function (t) { clearTimeout(t); });
    powerBiLoginRetryTimeouts.length = 0;
    console.log('[PowerBI] Programare retry-uri login (1.5s, 4s, 8s, 14s, 22s, 32s)');
    const delays = [1500, 4000, 8000, 14000, 22000, 32000];
    delays.forEach(function (ms) {
      var t = setTimeout(function () {
        powerBiLoginRetryTimeouts = powerBiLoginRetryTimeouts.filter(function (x) { return x !== t; });
        if (webContents.isDestroyed()) return;
        if (!isLoginPageUrl(webContents.getURL())) return;
        console.log('[PowerBI] Retry login @', (ms / 1000) + 's');
        webContents.executeJavaScript(getPowerBiLoginScript()).catch(function () {});
      }, ms);
      powerBiLoginRetryTimeouts.push(t);
    });
  }

  // Auto-login la pornire (opțional; Power BI poate face login la deschidere când detectează pagina de login): dacă MSAL e disponibil (OAuth sau MSAL_DIRECT_LOGIN_URL) și avem
  // MSAL_LOGIN_EMAIL + MSAL_LOGIN_PASSWORD în .env, deschidem fereastra de auth (ascunsă) și completăm formularul.
  async function runAutoMsalLogin() {
    if (!msalAuthService.isLoginAvailable()) return;
    const hasCreds = (process.env.MSAL_LOGIN_EMAIL || '').trim() && (process.env.MSAL_LOGIN_PASSWORD || '').trim();
    if (!hasCreds) return;
    try {
      if (await isMsalSessionActive()) return;
      console.log('[MSAL] Auto-login la pornire (credentiale din .env)');
      await doMsalLogin();
    } catch (e) {
      console.warn('[MSAL] Auto-login failed:', e.message);
    }
  }

  function destroyWebActionBrowserView() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      webActionBrowserView = null;
      webActionCurrentUrl = null;
      webActionCustomBounds = false;
      return;
    }
    try {
      if (webActionBrowserView) {
        try {
          mainWindow.removeBrowserView(webActionBrowserView);
        } catch (e0) {}
        try {
          if (!webActionBrowserView.webContents.isDestroyed()) webActionBrowserView.webContents.destroy();
        } catch (e2) {}
      }
    } catch (e) {}
    webActionBrowserView = null;
    webActionCurrentUrl = null;
    webActionCustomBounds = false;
  }

  // Power BI: același partition ca fereastra de login. bounds opțional: { x, y, width, height }
  // în coordonate ferestră; dacă lipsește, se folosește întreaga fereastră.
  ipcMain.handle('powerbi-show', (_, url, bounds, options) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!url || typeof url !== 'string') return;
    try {
      destroyWebActionBrowserView();
      clearPowerBiScrollTimeouts();
      var durationSec = Math.max(0, Number(options?.duration) || 0);
      var autoScroll = options?.powerBiAutoScroll !== false;
      var applyLoginScript = options?.powerBiApplyLoginScript !== false;
      powerBiScrollOptions = (autoScroll && durationSec >= 1) ? { duration: durationSec, applyLoginScript: applyLoginScript } : null;
      const displayUrl = powerBiDisplayUrl(url);
      console.log('[PowerBI] powerbi-show: duration=', durationSec, 'autoScroll=', autoScroll, 'applyLogin=', applyLoginScript, 'scroll activ=', !!powerBiScrollOptions);
      const hasCustomBounds =
        bounds && typeof bounds === 'object' && Number.isFinite(bounds.width) && Number.isFinite(bounds.height);
      powerBiCustomBounds = !!hasCustomBounds;
      const b = hasCustomBounds
        ? {
            x: Math.round(Number(bounds.x) || 0),
            y: Math.round(Number(bounds.y) || 0),
            width: Math.round(Number(bounds.width) || 0),
            height: Math.round(Number(bounds.height) || 0)
          }
        : mainWindow.getContentBounds();
      if (powerBiBrowserView) {
        powerBiBrowserView.setBounds(b);
        if (url !== powerBiCurrentUrl) {
          console.log('[PowerBI] Reutilizare view, loadURL (URL schimbat)');
          powerBiCurrentUrl = url;
          powerBiScrollOptions = (autoScroll && durationSec >= 1) ? { duration: durationSec, applyLoginScript: applyLoginScript } : null;
          powerBiBrowserView.webContents.loadURL(displayUrl);
        }
        return;
      }
      powerBiBrowserView = new BrowserView({
        webPreferences: {
          partition: POWERBI_PARTITION,
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      powerBiBrowserView.webContents.on('did-finish-load', () => {
        const url = powerBiBrowserView.webContents.getURL();
        console.log('[PowerBI] did-finish-load:', url.substring(0, 100) + (url.length > 100 ? '...' : ''));
        if (isLoginPageUrl(url) && powerBiScrollOptions && powerBiScrollOptions.applyLoginScript !== false) {
          console.log('[PowerBI] Detectat pagină login, aplic script login');
          injectPowerBiLoginIfNeeded(powerBiBrowserView.webContents);
          schedulePowerBiLoginRetries(powerBiBrowserView.webContents);
        }
        var hideNavDelayMs = 2000;
        var hideNavT = setTimeout(function () {
          powerBiScrollTimeouts = powerBiScrollTimeouts.filter(function (x) { return x !== hideNavT; });
          if (powerBiBrowserView && powerBiBrowserView.webContents && !powerBiBrowserView.webContents.isDestroyed()) {
            runPowerBiHideNav(powerBiBrowserView.webContents);
          }
        }, hideNavDelayMs);
        powerBiScrollTimeouts.push(hideNavT);
        if (powerBiScrollOptions && powerBiScrollOptions.duration >= 1) {
          var durationSec = powerBiScrollOptions.duration;
          var delayMs = POWERBI_SCROLL_LOAD_DELAY_MS;
          var remainingMs = Math.max(0, durationSec * 1000 - delayMs);
          console.log('[PowerBI] Programare auto-scroll: delay', (delayMs / 1000) + 's, apoi calcul nr. scrolluri din conținut');
          var t = setTimeout(function () {
            powerBiScrollTimeouts = powerBiScrollTimeouts.filter(function (x) { return x !== t; });
            if (!powerBiBrowserView || !powerBiBrowserView.webContents || powerBiBrowserView.webContents.isDestroyed()) return;
            runPowerBiGetScrollInfo(powerBiBrowserView.webContents, function (info) {
              var sh = info.scrollHeight || 0;
              var ch = info.clientHeight || 0;
              var scrollCount = (ch > 0 && sh > ch)
                ? Math.max(1, Math.min(50, Math.ceil((sh - ch) / ch)))
                : 1;
              console.log('[PowerBI] Scroll info: scrollHeight=', sh, 'clientHeight=', ch, '-> scrollCount=', scrollCount);
              schedulePowerBiAutoScrollFromNow(powerBiBrowserView.webContents, remainingMs, scrollCount);
            });
          }, delayMs);
          powerBiScrollTimeouts.push(t);
        } else {
          console.log('[PowerBI] Fără auto-scroll (opțiuni:', powerBiScrollOptions ? JSON.stringify(powerBiScrollOptions) : 'null', ')');
        }
      });
      powerBiCurrentUrl = url;
      mainWindow.setBrowserView(powerBiBrowserView);
      powerBiBrowserView.setBounds(b);
      powerBiBrowserView.webContents.loadURL(displayUrl);
    } catch (e) {
      console.error('[PowerBI] powerbi-show failed:', e.message);
    }
  });

  ipcMain.handle('powerbi-set-bounds', (_, bounds) => {
    if (!powerBiBrowserView || !mainWindow || mainWindow.isDestroyed()) return;
    if (bounds && typeof bounds === 'object' && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)) {
      console.log('[PowerBI] set-bounds:', Math.round(bounds.width), 'x', Math.round(bounds.height));
      powerBiBrowserView.setBounds({
        x: Math.round(Number(bounds.x) || 0),
        y: Math.round(Number(bounds.y) || 0),
        width: Math.round(Number(bounds.width) || 0),
        height: Math.round(Number(bounds.height) || 0)
      });
    }
  });

  ipcMain.handle('powerbi-hide', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      if (powerBiBrowserView) {
        console.log('[PowerBI] powerbi-hide – remove + destroy view (eliberează procesul renderer)');
        clearPowerBiScrollTimeouts();
        powerBiLoginRetryTimeouts.forEach(function (t) { clearTimeout(t); });
        powerBiLoginRetryTimeouts.length = 0;
        powerBiScrollOptions = null;
        powerBiCurrentUrl = null;
        mainWindow.removeBrowserView(powerBiBrowserView);
        try {
          if (!powerBiBrowserView.webContents.isDestroyed()) powerBiBrowserView.webContents.destroy();
        } catch (e2) {}
        powerBiBrowserView = null;
        powerBiCustomBounds = false;
      }
    } catch (e) {
      console.warn('[PowerBI] powerbi-hide failed:', e.message);
    }
  });

  /** web_action: valoarea din dashboard = zoom % față de 100 (100=1:1, 200=2×). Nu e aceeași semantică ca web_live (iframe). */
  function webActionFitToZoomFactor(options) {
    var fit = Math.max(25, Math.min(500, Number(options && options.webActionFit) || 100));
    var z = fit / 100;
    return Math.max(0.25, Math.min(5, z));
  }

  function applyWebActionZoomToContents(webContents) {
    try {
      if (webContents && !webContents.isDestroyed()) webContents.setZoomFactor(webActionLastZoomFactor);
    } catch (e) {}
  }

  function attachWebActionZoomOnLoad(webContents) {
    if (!webContents || webContents.isDestroyed()) return;
    if (webContents._waZoomOnLoadAttached) return;
    webContents._waZoomOnLoadAttached = true;
    webContents.on('did-finish-load', function () {
      applyWebActionZoomToContents(webContents);
      setTimeout(function () {
        applyWebActionZoomToContents(webContents);
      }, 50);
      setTimeout(function () {
        applyWebActionZoomToContents(webContents);
      }, 400);
    });
  }

  /**
   * web_action: BrowserView (nu iframe în renderer). Automatizarea folosește webContents-ul view-ului.
   * Zoom: webActionFit / 100 (ex. 200 → setZoomFactor 2).
   */
  ipcMain.handle('web-action-show', (_, url, bounds, options) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!url || typeof url !== 'string') return;
    try {
      webActionLastZoomFactor = webActionFitToZoomFactor(options);
      if (powerBiBrowserView) {
        clearPowerBiScrollTimeouts();
        powerBiLoginRetryTimeouts.forEach(function (t) {
          clearTimeout(t);
        });
        powerBiLoginRetryTimeouts.length = 0;
        powerBiScrollOptions = null;
        powerBiCurrentUrl = null;
        try {
          mainWindow.removeBrowserView(powerBiBrowserView);
          if (!powerBiBrowserView.webContents.isDestroyed()) powerBiBrowserView.webContents.destroy();
        } catch (eP) {}
        powerBiBrowserView = null;
        powerBiCustomBounds = false;
      }

      var hasCustomBounds =
        bounds && typeof bounds === 'object' && Number.isFinite(bounds.width) && Number.isFinite(bounds.height);
      webActionCustomBounds = !!hasCustomBounds;
      var b = hasCustomBounds
        ? {
            x: Math.round(Number(bounds.x) || 0),
            y: Math.round(Number(bounds.y) || 0),
            width: Math.round(Number(bounds.width) || 0),
            height: Math.round(Number(bounds.height) || 0)
          }
        : mainWindow.getContentBounds();
      if (webActionBrowserView) {
        webActionBrowserView.setBounds(b);
        var wcReuse = webActionBrowserView.webContents;
        attachWebActionZoomOnLoad(wcReuse);
        if (url !== webActionCurrentUrl) {
          webActionCurrentUrl = url;
          wcReuse.loadURL(url);
        } else {
          applyWebActionZoomToContents(wcReuse);
          setTimeout(function () {
            applyWebActionZoomToContents(wcReuse);
          }, 50);
        }
        return;
      }
      webActionBrowserView = new BrowserView({
        webPreferences: {
          partition: WEB_ACTION_PARTITION,
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      webActionCurrentUrl = url;
      var wcNew = webActionBrowserView.webContents;
      attachWebActionZoomOnLoad(wcNew);
      mainWindow.setBrowserView(webActionBrowserView);
      webActionBrowserView.setBounds(b);
      wcNew.loadURL(url);
    } catch (e) {
      console.error('[WebAction] web-action-show failed:', e.message);
    }
  });

  ipcMain.handle('web-action-set-bounds', (_, bounds) => {
    if (!webActionBrowserView || !mainWindow || mainWindow.isDestroyed()) return;
    if (bounds && typeof bounds === 'object' && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)) {
      webActionBrowserView.setBounds({
        x: Math.round(Number(bounds.x) || 0),
        y: Math.round(Number(bounds.y) || 0),
        width: Math.round(Number(bounds.width) || 0),
        height: Math.round(Number(bounds.height) || 0)
      });
    }
  });

  ipcMain.handle('web-action-hide', () => {
    destroyWebActionBrowserView();
  });

  function clearWebLiveScrollTimeouts() {
    webLiveScrollTimeouts.forEach(function (t) { clearTimeout(t); });
    webLiveScrollTimeouts = [];
    webLiveScrollFrame = null;
  }

  ipcMain.handle('web-live-scroll-start', (_, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    var durationSec = Math.max(1, Number(payload?.duration) || 10);
    var applyLoginScript = payload?.applyLoginScript !== false;
    var autoScroll = payload?.autoScroll === true;
    clearWebLiveScrollTimeouts();
    var delayMs = 2000;
    var t = setTimeout(function () {
      webLiveScrollTimeouts = webLiveScrollTimeouts.filter(function (x) { return x !== t; });
      if (!mainWindow || mainWindow.isDestroyed()) return;
      var wc = mainWindow.webContents;
      var mainFrame = wc.mainFrame;
      if (!mainFrame) return;
      var frames = getAllFrames(mainFrame, []);
      if (applyLoginScript && getPowerBiLoginScript()) {
        frames.forEach(function (frame) {
          frame.executeJavaScript('typeof location !== "undefined" ? location.href : ""').then(function (url) {
            if (url && isLoginPageUrl(url)) {
              console.log('[WebLive] Pagină login detectată în iframe, aplic script login');
              frame.executeJavaScript(getPowerBiLoginScript()).catch(function () {});
            }
          }).catch(function () {});
        });
      }
      if (!autoScroll) return;
      var infoScript = getWebLiveScrollInfoScript();
      var scrollScript = getWebLiveScrollScript();
      var durationMs = durationSec * 1000;
      var promises = frames.map(function (frame) {
        return frame.executeJavaScript(infoScript).then(function (r) {
          try {
            var o = typeof r === 'string' ? JSON.parse(r) : r;
            if (o && o.scrollHeight > 0 && o.clientHeight > 0 && o.scrollHeight > o.clientHeight) {
              return { frame: frame, sh: o.scrollHeight, ch: o.clientHeight };
            }
          } catch (e) {}
          return null;
        }).catch(function () { return null; });
      });
      Promise.all(promises).then(function (results) {
        var best = null;
        results.forEach(function (r) {
          if (!r) return;
          var pages = (r.sh - r.ch) / (r.ch || 1);
          if (!best || pages > (best.sh - best.ch) / (best.ch || 1)) best = r;
        });
        if (!best || !best.frame) return;
        webLiveScrollFrame = best.frame;
        var sh = best.sh;
        var ch = best.ch;
        var scrollCount = Math.max(1, Math.min(50, Math.ceil((sh - ch) / ch)));
        var segmentMs = durationMs / (scrollCount + 1);
        console.log('[WebLive] Auto-scroll: timp împărțit la', (scrollCount + 1), '– delay și interval =', (segmentMs / 1000).toFixed(1) + 's,', scrollCount, 'scroll(uri)');
        for (var i = 1; i <= scrollCount; i++) {
          (function (idx) {
            var tt = setTimeout(function () {
              if (!webLiveScrollFrame || mainWindow.isDestroyed()) return;
              webLiveScrollFrame.executeJavaScript(scrollScript).then(function () {
                console.log('[WebLive] Scroll', idx + '/' + scrollCount);
              }).catch(function () {});
            }, idx * segmentMs);
            webLiveScrollTimeouts.push(tt);
          })(i);
        }
      });
    }, delayMs);
    webLiveScrollTimeouts.push(t);
  });

  /**
   * web_action: automatizare pe BrowserView web_action (partition persist:webaction) + sub-frame-uri.
   * Hard load delay: amână autologin / click-uri / auto-scroll.
   */
  ipcMain.handle('web-action-start', (_, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    clearWebLiveScrollTimeouts();
    webLiveScrollFrame = null;

    var startTime = Date.now();
    var durationSec = Math.max(1, Number(payload?.duration) || 10);
    var durationMs = durationSec * 1000;
    var applyLogin = payload?.webActionApplyLoginScript === true;
    var autoScroll = payload?.webActionAutoScroll === true;
    var actionSelectors = Array.isArray(payload?.webActionScripts)
      ? payload.webActionScripts.map(function (s) { return String(s || '').trim(); }).filter(Boolean)
      : [];
    var hardLoadEnabled = payload?.webActionHardLoadEnabled === true;
    var hardLoadSecRaw = Number(payload?.webActionHardLoadSeconds);
    var hardLoadSec = hardLoadEnabled && !isNaN(hardLoadSecRaw)
      ? Math.max(0, Math.min(600, hardLoadSecRaw))
      : 0;
    var hardDelayMs = hardLoadEnabled && hardLoadSec > 0 ? Math.floor(hardLoadSec * 1000) : 0;

    var WEB_ACTION_LOGIN_FIRST_MS = 2000;
    var WEB_ACTION_PHASE_END_MS = applyLogin || actionSelectors.length > 0 ? 10000 : 2000;
    var CLICK_GAP_MS = 450;

    webActionDevLog(
      'automation start — durată',
      durationSec + 's',
      'hardDelayMs',
      hardDelayMs,
      'login',
      applyLogin,
      'autoScroll',
      autoScroll,
      'acțiuni',
      actionSelectors.length
    );

    function getWebActionFrames() {
      if (webActionBrowserView && !webActionBrowserView.webContents.isDestroyed()) {
        var mf = webActionBrowserView.webContents.mainFrame;
        if (mf) {
          var frames = getAllFrames(mf, []);
          webActionDevLog('frame-uri automatizare (BrowserView):', frames.length);
          return frames;
        }
      }
      webActionDevLog('frame-uri automatizare: niciun BrowserView web_action');
      return [];
    }

    function injectLoginOnLoginFrames() {
      if (!applyLogin || !getPowerBiLoginScript()) return;
      var frames = getWebActionFrames();
      frames.forEach(function (frame) {
        frame.executeJavaScript('typeof location !== "undefined" ? location.href : ""').then(function (url) {
          if (url && isLoginPageUrl(url)) {
            webActionDevLog('Inject login:', url.substring(0, 80));
            frame.executeJavaScript(getPowerBiLoginScript()).catch(function () {});
          }
        }).catch(function () {});
      });
    }

    function scheduleWebActionLoginRetries() {
      if (!applyLogin || !getPowerBiLoginScript()) return;
      var delays = [1500, 4000, 8000, 14000, 22000, 32000];
      delays.forEach(function (ms) {
        var t = setTimeout(function () {
          webLiveScrollTimeouts = webLiveScrollTimeouts.filter(function (x) { return x !== t; });
          injectLoginOnLoginFrames();
        }, ms);
        webLiveScrollTimeouts.push(t);
      });
    }

    var tLogin = setTimeout(function () {
      webLiveScrollTimeouts = webLiveScrollTimeouts.filter(function (x) { return x !== tLogin; });
      injectLoginOnLoginFrames();
      scheduleWebActionLoginRetries();
    }, WEB_ACTION_LOGIN_FIRST_MS + hardDelayMs);
    webLiveScrollTimeouts.push(tLogin);

    function clickSelectorInFramesSequential(frames, selector, cb) {
      var script = buildWebActionClickScript(selector);
      var fi = 0;
      function tryNext() {
        if (fi >= frames.length) {
          if (cb) cb();
          return;
        }
        var fr = frames[fi++];
        fr.executeJavaScript(script).then(function (ok) {
          if (ok === true) {
            if (cb) cb();
            return;
          }
          tryNext();
        }).catch(function () { tryNext(); });
      }
      tryNext();
    }

    function runClickSequence(index, done) {
      var frames = getWebActionFrames();
      if (index >= actionSelectors.length) {
        if (done) done();
        return;
      }
      var sel = actionSelectors[index];
      clickSelectorInFramesSequential(frames, sel, function () {
        webActionDevLog('Click', index + 1, '/', actionSelectors.length, String(sel).substring(0, 80));
        var tNext = setTimeout(function () {
          webLiveScrollTimeouts = webLiveScrollTimeouts.filter(function (x) { return x !== tNext; });
          runClickSequence(index + 1, done);
        }, CLICK_GAP_MS);
        webLiveScrollTimeouts.push(tNext);
      });
    }

    function scheduleAutoScrollAfterPhases(retryLeft) {
      if (!autoScroll) return;
      if (retryLeft == null) retryLeft = 3;
      var elapsed = Date.now() - startTime;
      var remainingMs = Math.max(300, durationMs - elapsed - 200);
      var frames = getWebActionFrames();
      if (!frames.length) {
        if (retryLeft > 0) {
          var tRetryScroll = setTimeout(function () {
            webLiveScrollTimeouts = webLiveScrollTimeouts.filter(function (x) { return x !== tRetryScroll; });
            scheduleAutoScrollAfterPhases(retryLeft - 1);
          }, 1000);
          webLiveScrollTimeouts.push(tRetryScroll);
          webActionDevLog('Auto-scroll: fără frame-uri BrowserView, retry', retryLeft);
        }
        return;
      }
      var infoScript = getWebLiveScrollInfoScript();
      var promises = frames.map(function (frame) {
        return frame.executeJavaScript(infoScript).then(function (r) {
          try {
            var o = typeof r === 'string' ? JSON.parse(r) : r;
            if (o && o.scrollHeight > 0 && o.clientHeight > 0 && o.scrollHeight > o.clientHeight) {
              return { frame: frame, sh: o.scrollHeight, ch: o.clientHeight };
            }
          } catch (e) {}
          return null;
        }).catch(function () { return null; });
      });
      Promise.all(promises).then(function (results) {
        var best = null;
        results.forEach(function (r) {
          if (!r) return;
          var pages = (r.sh - r.ch) / (r.ch || 1);
          if (!best || pages > (best.sh - best.ch) / (best.ch || 1)) best = r;
        });
        if (!best || !best.frame) {
          webActionDevLog('Auto-scroll: niciun frame scrollabil');
          return;
        }
        webLiveScrollFrame = best.frame;
        var sh = best.sh;
        var ch = best.ch;
        var scrollCount = Math.max(1, Math.min(50, Math.ceil((sh - ch) / ch)));
        var segmentMs = remainingMs / (scrollCount + 1);
        var scrollScript = getWebLiveScrollScript();
        webActionDevLog(
          'Auto-scroll: rămas',
          (remainingMs / 1000).toFixed(1) + 's, scrollCount=',
          scrollCount,
          'segment',
          (segmentMs / 1000).toFixed(2) + 's'
        );
        for (var j = 1; j <= scrollCount; j++) {
          (function (idx) {
            var tt = setTimeout(function () {
              if (!webLiveScrollFrame) return;
              if (mainWindow && mainWindow.isDestroyed()) return;
              webLiveScrollFrame.executeJavaScript(scrollScript).then(function () {
                webActionDevLog('Scroll', idx, '/', scrollCount);
              }).catch(function () {});
            }, idx * segmentMs);
            webLiveScrollTimeouts.push(tt);
          })(j);
        }
      });
    }

    var tPhase = setTimeout(function () {
      webLiveScrollTimeouts = webLiveScrollTimeouts.filter(function (x) { return x !== tPhase; });
      runClickSequence(0, function () {
        scheduleAutoScrollAfterPhases();
      });
    }, WEB_ACTION_PHASE_END_MS + hardDelayMs);
    webLiveScrollTimeouts.push(tPhase);
  });

  ipcMain.handle('web-action-stop', () => {
    clearWebLiveScrollTimeouts();
    webLiveScrollFrame = null;
    webActionDevLog('automation stop (timer-e oprite)');
  });

  ipcMain.handle('web-live-scroll-stop', () => {
    clearWebLiveScrollTimeouts();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(getBaseUrl());
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
