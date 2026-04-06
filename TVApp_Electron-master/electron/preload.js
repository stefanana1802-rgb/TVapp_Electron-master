const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPlaylist: () => ipcRenderer.invoke('get-playlist'),
  getGitSyncStatus: () => ipcRenderer.invoke('get-git-sync-status'),
  getPlaylistForTeam: (team) => ipcRenderer.invoke('get-playlist-for-team', team),
  getTeams: () => ipcRenderer.invoke('get-teams'),
  getSelectedTeam: () => ipcRenderer.invoke('get-selected-team'),
  setSelectedTeam: (team) => ipcRenderer.invoke('set-selected-team', team),
  onPlaylistUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('playlist-updated', listener);
    return () => ipcRenderer.removeListener('playlist-updated', listener);
  },
  onCanteenMenuShow: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('canteen-menu-show', listener);
    return () => ipcRenderer.removeListener('canteen-menu-show', listener);
  },
  onCanteenMenuLoadFailed: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('canteen-menu-load-failed', listener);
    return () => ipcRenderer.removeListener('canteen-menu-load-failed', listener);
  },
  getAppEnvFlags: () => ipcRenderer.invoke('get-app-env-flags'),
  getHardwareTemps: () => ipcRenderer.invoke('get-hardware-temps'),
  getTrafficData: () => ipcRenderer.invoke('get-traffic-data'),
  getSectionContent: (team, sectionId) => ipcRenderer.invoke('get-section-content', team, sectionId),
  getAllSectionsContent: (team) => ipcRenderer.invoke('get-all-sections-content', team),
  getWorkspaceFolderImages: (path) => ipcRenderer.invoke('get-workspace-folder-images', path),
  checkUptimeUrl: (url) => ipcRenderer.invoke('check-uptime-url', url),
  fetchFlightboardProjects: (url) => ipcRenderer.invoke('fetch-flightboard-projects', url),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  openAdminWindow: () => ipcRenderer.invoke('open-admin-window'),
  authRegister: (email, password) => ipcRenderer.invoke('auth-register', email, password),
  authLogin: (email, password) => ipcRenderer.invoke('auth-login', email, password),
  authCheck: (token) => ipcRenderer.invoke('auth-check', token),
  authLogout: (token) => ipcRenderer.invoke('auth-logout', token),
  authForgotPassword: (email) => ipcRenderer.invoke('auth-forgot-password', email),
  authResetPassword: (token, newPassword) => ipcRenderer.invoke('auth-reset-password', token, newPassword),
  adminCreateTeam: (name) => ipcRenderer.invoke('admin-create-team', name),
  adminDeleteTeam: (name) => ipcRenderer.invoke('admin-delete-team', name),
  adminSavePlaylist: (teamName, data) => ipcRenderer.invoke('admin-save-playlist', teamName, data),
  adminSaveSectionContent: (teamName, sectionId, data) => ipcRenderer.invoke('admin-save-section-content', teamName, sectionId, data),

  // MSAL – Microsoft Enterprise (sesiune persistentă, cookie-uri pentru conținut protejat în iframe)
  msalIsConfigured: () => ipcRenderer.invoke('msal-is-configured'),
  msalSessionActive: () => ipcRenderer.invoke('msal-session-active'),
  msalGetAccount: () => ipcRenderer.invoke('msal-get-account'),
  msalGetAccessToken: () => ipcRenderer.invoke('msal-get-access-token'),
  msalLogin: () => ipcRenderer.invoke('msal-login'),
  msalLogout: () => ipcRenderer.invoke('msal-logout'),
  onMsalSessionUpdate: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('msal-session-update', listener);
    return () => ipcRenderer.removeListener('msal-session-update', listener);
  },

  powerbiShow: (url, bounds, options) => ipcRenderer.invoke('powerbi-show', url, bounds, options),
  powerbiSetBounds: (bounds) => ipcRenderer.invoke('powerbi-set-bounds', bounds),
  powerbiHide: () => ipcRenderer.invoke('powerbi-hide'),
  webLiveScrollStart: (payload) => ipcRenderer.invoke('web-live-scroll-start', payload),
  webLiveScrollStop: () => ipcRenderer.invoke('web-live-scroll-stop'),
  webActionStart: (payload) => ipcRenderer.invoke('web-action-start', payload),
  webActionStop: () => ipcRenderer.invoke('web-action-stop'),
  webActionShow: (url, bounds, options) => ipcRenderer.invoke('web-action-show', url, bounds, options),
  webActionSetBounds: (bounds) => ipcRenderer.invoke('web-action-set-bounds', bounds),
  webActionHide: () => ipcRenderer.invoke('web-action-hide'),
  onPowerBiRequestBounds: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('powerbi-request-bounds', listener);
    return () => ipcRenderer.removeListener('powerbi-request-bounds', listener);
  },
  onWebActionRequestBounds: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('web-action-request-bounds', listener);
    return () => ipcRenderer.removeListener('web-action-request-bounds', listener);
  },

  // Fereastra de setup (clone/pull) înainte de aplicație
  onSetupPhase: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('setup-phase', listener);
    return () => ipcRenderer.removeListener('setup-phase', listener);
  },
  setupFinished: () => ipcRenderer.send('setup-finished')
});

