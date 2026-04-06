/**
 * Auth: login, register, forgot password.
 * Users stored in userData/signage-users.json; passwords hashed with scrypt.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const USERS_PATH = path.join(app.getPath('userData'), 'signage-users.json');
const RESET_TOKENS_PATH = path.join(app.getPath('userData'), 'signage-reset-tokens.json');
const SALT_LEN = 16;
const KEY_LEN = 64;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function readUsers() {
  try {
    const raw = await fs.readFile(USERS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { users: [] };
  }
}

async function writeUsers(data) {
  await fs.mkdir(path.dirname(USERS_PATH), { recursive: true });
  await fs.writeFile(USERS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = crypto.scryptSync(password, salt, KEY_LEN);
  return salt.toString('hex') + ':' + key.toString('hex');
}

function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const key = crypto.scryptSync(password, salt, KEY_LEN);
  return key.toString('hex') === keyHex;
}

async function register(email, password) {
  const data = await readUsers();
  const normalized = email.trim().toLowerCase();
  if (data.users.some((u) => u.email === normalized)) {
    return { ok: false, error: 'Email already registered' };
  }
  data.users.push({
    email: normalized,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  });
  await writeUsers(data);
  return { ok: true };
}

async function login(email, password) {
  const data = await readUsers();
  const normalized = email.trim().toLowerCase();
  const user = data.users.find((u) => u.email === normalized);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: 'Invalid email or password' };
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  if (!data.sessions) data.sessions = [];
  data.sessions.push({ token, email: user.email, expiresAt });
  await writeUsers(data);
  return { ok: true, token, email: user.email, expiresAt };
}

async function checkSession(token) {
  if (!token) return { ok: false };
  const data = await readUsers();
  const session = (data.sessions || []).find((s) => s.token === token && s.expiresAt > Date.now());
  if (!session) return { ok: false };
  return { ok: true, email: session.email };
}

async function logout(token) {
  const data = await readUsers();
  if (data.sessions) {
    data.sessions = data.sessions.filter((s) => s.token !== token);
    await writeUsers(data);
  }
  return { ok: true };
}

async function forgotPassword(email) {
  const data = await readUsers();
  const normalized = email.trim().toLowerCase();
  const user = data.users.find((u) => u.email === normalized);
  if (!user) {
    return { ok: true };
  }
  const token = crypto.randomBytes(24).toString('hex');
  let tokens = {};
  try {
    const raw = await fs.readFile(RESET_TOKENS_PATH, 'utf-8');
    tokens = JSON.parse(raw);
  } catch {
    await fs.mkdir(path.dirname(RESET_TOKENS_PATH), { recursive: true });
  }
  tokens[token] = { email: normalized, expiresAt: Date.now() + 60 * 60 * 1000 };
  await fs.writeFile(RESET_TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
  return { ok: true, message: 'If this email is registered, you will receive a reset link.' };
}

async function resetPassword(token, newPassword) {
  let tokens = {};
  try {
    const raw = await fs.readFile(RESET_TOKENS_PATH, 'utf-8');
    tokens = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid or expired token' };
  }
  const entry = tokens[token];
  delete tokens[token];
  await fs.writeFile(RESET_TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
  if (!entry || entry.expiresAt < Date.now()) {
    return { ok: false, error: 'Invalid or expired token' };
  }
  const data = await readUsers();
  const user = data.users.find((u) => u.email === entry.email);
  if (!user) return { ok: false, error: 'User not found' };
  user.passwordHash = hashPassword(newPassword);
  await writeUsers(data);
  return { ok: true };
}

module.exports = {
  register,
  login,
  checkSession,
  logout,
  forgotPassword,
  resetPassword
};
