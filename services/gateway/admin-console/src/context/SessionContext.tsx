import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { probeLogin, getTenant } from '../api/tenants';
import { getTenantId, getApiKey, setCredentials, clearCredentials, setUnauthorizedHandler } from '../api/client';
import type { Tenant } from '../types/api';

interface SessionContextValue {
  tenant: Tenant | null;
  loading: boolean;
  login: (tenantId: string, apiKey: string) => Promise<void>;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const clearSession = () => {
    clearCredentials();
    setTenant(null);
    queryClient.clear();
  };

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      navigate('/login', { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    if (!getTenantId() || !getApiKey()) {
      setLoading(false);
      return;
    }
    getTenant()
      .then((result) => setTenant(result))
      .catch(() => clearCredentials())
      .finally(() => setLoading(false));
  }, []);

  const login = async (tenantId: string, apiKey: string) => {
    // Verify against the real API before persisting anything — a bad
    // tenant ID or a non-admin-tier key must never be stored.
    const result = await probeLogin(tenantId, apiKey);
    setCredentials(tenantId, apiKey);
    setTenant(result);
  };

  const logout = () => {
    clearSession();
    navigate('/login', { replace: true });
  };

  return (
    <SessionContext.Provider value={{ tenant, loading, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { tenant, loading } = useSession();
  if (loading) return <div className="p-8 text-ink-soft">Loading…</div>;
  if (!tenant) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
