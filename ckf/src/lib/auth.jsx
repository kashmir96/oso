import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { call, getToken, setToken } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const t = getToken();
    if (!t) { setUser(null); setLoading(false); return; }
    try {
      const res = await call('ckf-auth', { action: 'check', token: t });
      setUser(res.user);
    } catch (e) {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    const res = await call('ckf-auth', { action: 'login', email, password });
    setToken(res.token);
    setUser(res.user);
    return res;
  }, []);

  const logout = useCallback(async () => {
    const t = getToken();
    if (t) {
      try { await call('ckf-auth', { action: 'logout', token: t }); } catch {}
    }
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
}
