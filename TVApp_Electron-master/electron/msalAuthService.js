/**
 * Autentificare Microsoft (Azure AD / Entra ID) cu MSAL Node.
 * - Auth code flow cu redirect tvapp://auth (session + cookie-uri pentru webview/iframe).
 * - Persistență token (refresh) în userData pentru sesiune fără re-login.
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');

const CACHE_PATH = path.join(app.getPath('userData'), 'msal-cache.json');
const REDIRECT_URI = 'tvapp://auth';

let msalClient = null;
let cachePlugin = null;

function getConfig() {
  const clientId = process.env.AZURE_CLIENT_ID || process.env.MSAL_CLIENT_ID;
  const tenantId = process.env.AZURE_TENANT_ID || process.env.MSAL_TENANT_ID || 'common';
  const authority = tenantId === 'common'
    ? 'https://login.microsoftonline.com/common'
    : `https://login.microsoftonline.com/${tenantId}`;
  return {
    clientId: clientId || '',
    authority,
    redirectUri: REDIRECT_URI,
    scopes: (process.env.MSAL_SCOPES || 'openid profile user.read').split(/\s+/).filter(Boolean)
  };
}

function createCachePlugin() {
  return {
    async beforeCacheAccess(cacheContext) {
      try {
        const data = await fs.readFile(CACHE_PATH, 'utf-8');
        if (data && data.trim()) cacheContext.tokenCache.deserialize(data);
      } catch {
        // Fișier inexistent sau invalid – cache gol
      }
    },
    async afterCacheAccess(cacheContext) {
      if (cacheContext.cacheHasChanged) {
        try {
          const data = cacheContext.tokenCache.serialize();
          await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
          await fs.writeFile(CACHE_PATH, data, 'utf-8');
        } catch (err) {
          console.warn('[MSAL] Cache write failed:', err.message);
        }
      }
    }
  };
}

function getClient() {
  if (msalClient) return msalClient;
  const config = getConfig();
  if (!config.clientId) {
    throw new Error('AZURE_CLIENT_ID (sau MSAL_CLIENT_ID) lipsește din .env');
  }
  const { PublicClientApplication } = require('@azure/msal-node');
  cachePlugin = createCachePlugin();
  msalClient = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: config.authority,
      redirectUri: config.redirectUri
    },
    cache: { cachePlugin }
  });
  return msalClient;
}

/**
 * Returnează URL-ul de login Microsoft (pasul 1 – deschis în fereastra de auth).
 * Dacă MSAL_LOGIN_HINT=email@company.com în .env, emailul apare deja completat pe pagina de login.
 */
async function getAuthCodeUrl(state) {
  const client = getClient();
  const config = getConfig();
  const loginHint = (process.env.MSAL_LOGIN_HINT || '').trim() || undefined;
  return client.getAuthCodeUrl({
    scopes: config.scopes,
    state: state || undefined,
    loginHint
  });
}

/**
 * Schimbă code-ul primit la redirect pentru access + refresh token și le persistă în cache.
 */
async function acquireTokenByCode(code, state) {
  const client = getClient();
  const config = getConfig();
  const result = await client.acquireTokenByCode({
    code,
    scopes: config.scopes,
    redirectUri: config.redirectUri
  });
  return result;
}

/**
 * Preia access token folosind refresh token (fără UI). Pentru sesiune persistentă.
 */
async function acquireTokenSilent(account) {
  const client = getClient();
  const config = getConfig();
  return client.acquireTokenSilent({
    scopes: config.scopes,
    account
  });
}

/**
 * Contul curent din cache (primul disponibil).
 */
async function getAccount() {
  try {
    const client = getClient();
    const accounts = await client.getTokenCache().getAllAccounts();
    return accounts.length ? accounts[0] : null;
  } catch {
    return null;
  }
}

/**
 * Access token curent (din cache sau refresh).
 */
async function getAccessToken() {
  const account = await getAccount();
  if (!account) return null;
  try {
    const response = await acquireTokenSilent(account);
    return response ? response.accessToken : null;
  } catch {
    return null;
  }
}

/**
 * Logout: șterge cache-ul local (refresh token etc.).
 */
async function logout() {
  try {
    await fs.unlink(CACHE_PATH);
  } catch {
    // ignore
  }
  msalClient = null;
}

function isConfigured() {
  return !!(process.env.AZURE_CLIENT_ID || process.env.MSAL_CLIENT_ID);
}

/** URL pentru „conectare directă”: deschide această pagină, te loghezi acolo, cookie-urile rămân în sesiune. */
function getDirectLoginUrl() {
  const url = (process.env.MSAL_DIRECT_LOGIN_URL || '').trim();
  return url || null;
}

/** True dacă poți folosi fie OAuth (AZURE_CLIENT_ID), fie conectare directă (MSAL_DIRECT_LOGIN_URL). */
function isLoginAvailable() {
  return isConfigured() || !!getDirectLoginUrl();
}

module.exports = {
  REDIRECT_URI,
  getConfig,
  getAuthCodeUrl,
  acquireTokenByCode,
  getAccount,
  getAccessToken,
  acquireTokenSilent,
  logout,
  isConfigured,
  getDirectLoginUrl,
  isLoginAvailable
};
