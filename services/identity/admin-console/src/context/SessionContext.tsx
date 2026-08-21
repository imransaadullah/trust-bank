import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { getMe } from '../api/auth';
import { getToken, setToken as storeToken, clearToken, setUnauthorizedHandler } from '../api/client';
import type { Me, StaffRole } from '../types/api';

interface SessionContextValue {
  me: Me | null;
  loading: boolean;
  setSession: (token: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const clearSession = () => {
    clearToken();
    setMe(null);
    queryClient.clear();
  };

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      navigate('/login', { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    getMe()
      .then((result) => setMe(result))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const setSession = async (token: string) => {
    storeToken(token);
    const result = await getMe();
    setMe(result);
  };

  const logout = () => {
    clearSession();
    navigate('/login', { replace: true });
  };

  return (
    <SessionContext.Provider value={{ me, loading, setSession, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}

// UI convenience only — every real gate is server-side
// (requireStaffSession({roles}) / approvalService's PERMISSIONS map).
// Hiding a button here never substitutes for the server re-checking it.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return <div className="p-8 text-ink-soft">Loading…</div>;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: StaffRole[]; children: ReactNode }) {
  const { me } = useSession();
  if (!me || !roles.includes(me.role)) {
    return <div className="p-8 text-ink-soft">You don't have permission to view this page.</div>;
  }
  return <>{children}</>;
}
