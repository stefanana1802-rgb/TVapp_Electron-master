import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => localStorage.getItem('signage_admin_token') || null);
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!token);

  const setToken = useCallback((t) => {
    if (t) localStorage.setItem('signage_admin_token', t);
    else localStorage.removeItem('signage_admin_token');
    setTokenState(t);
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setChecking(false);
      return;
    }
    if (!window.api?.authCheck) {
      setChecking(false);
      return;
    }
    window.api.authCheck(token).then((res) => {
      if (res.ok) setUser({ email: res.email });
      else setToken(null);
      setChecking(false);
    }).catch(() => {
      setToken(null);
      setChecking(false);
    });
  }, [token, setToken]);

  const login = useCallback(async (email, password) => {
    const res = await window.api.authLogin(email, password);
    if (res.ok) {
      setToken(res.token);
      setUser({ email: res.email });
      return { ok: true };
    }
    return { ok: false, error: res.error };
  }, [setToken]);

  const register = useCallback(async (email, password) => {
    const res = await window.api.authRegister(email, password);
    if (res.ok) return { ok: true };
    return { ok: false, error: res.error };
  }, []);

  const logout = useCallback(async () => {
    if (token) await window.api.authLogout(token);
    setToken(null);
    setUser(null);
  }, [token, setToken]);

  const forgotPassword = useCallback(async (email) => {
    const res = await window.api.authForgotPassword(email);
    return res;
  }, []);

  const value = { token, user, checking, login, register, logout, forgotPassword, setToken };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
