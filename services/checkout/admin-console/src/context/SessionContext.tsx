import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { sendOtp as sendOtpRequest, verifyOtp as verifyOtpRequest, logout as logoutRequest } from '../api/merchantLogin';
import { getTenantId, getToken, setCredentials, clearCredentials, setUnauthorizedHandler } from '../api/client';

interface MerchantIdentity {
  id: string;
  name: string;
  tenantId: string;
}

interface SessionContextValue {
  merchant: MerchantIdentity | null;
  loading: boolean;
  sendOtp: (tenantId: string, email: string) => Promise<void>;
  verifyOtp: (tenantId: string, email: string, code: string) => Promise<void>;
  logout: () => void;
}

const MERCHANT_IDENTITY_KEY = 'trustbank_merchant_identity';

const SessionContext = createContext<SessionContextValue | null>(null);

function loadStoredIdentity(): MerchantIdentity | null {
  const raw = sessionStorage.getItem(MERCHANT_IDENTITY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MerchantIdentity;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [merchant, setMerchant] = useState<MerchantIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const clearSession = () => {
    clearCredentials();
    sessionStorage.removeItem(MERCHANT_IDENTITY_KEY);
    setMerchant(null);
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
    // Unlike the tenant dashboard, there's no probe/self-lookup route for
    // a MerchantSession — trust the identity stored at verify-otp time. A
    // stale/revoked token still gets caught on the first real request via
    // the 401 handler above, same end result either way.
    const stored = loadStoredIdentity();
    if (stored && getTenantId() && getToken()) {
      setMerchant(stored);
    } else {
      clearCredentials();
    }
    setLoading(false);
  }, []);

  const sendOtp = async (tenantId: string, email: string) => {
    await sendOtpRequest(tenantId, email);
  };

  const verifyOtp = async (tenantId: string, email: string, code: string) => {
    const result = await verifyOtpRequest(tenantId, email, code);
    setCredentials(tenantId, result.token);
    const identity: MerchantIdentity = { id: result.merchantId, name: result.merchantName, tenantId: result.tenantId };
    sessionStorage.setItem(MERCHANT_IDENTITY_KEY, JSON.stringify(identity));
    setMerchant(identity);
  };

  const logout = () => {
    // Best-effort, fire-and-forget — same reasoning as the tenant
    // dashboard's own logout: a real server-side revoke happens, but the
    // browser doesn't block on it.
    logoutRequest().catch(() => {});
    clearSession();
    navigate('/login', { replace: true });
  };

  return (
    <SessionContext.Provider value={{ merchant, loading, sendOtp, verifyOtp, logout }}>
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
  const { merchant, loading } = useSession();
  if (loading) return <div className="p-8 text-ink-soft">Loading…</div>;
  if (!merchant) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
