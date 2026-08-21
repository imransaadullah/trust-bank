import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { ApiError } from '../api/client';
import { Field, TextInput } from '../components/Field';
import { Button } from '../components/Button';

type Mode = 'api-key' | 'staff-session';

export function LoginPage() {
  const { login, loginWithStaffSession } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('api-key');
  const [tenantId, setTenantId] = useState('');
  const [credential, setCredential] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setCredential('');
    setError(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'api-key') {
        await login(tenantId.trim(), credential.trim());
      } else {
        await loginWithStaffSession(tenantId.trim(), credential.trim());
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-paper-raised border border-line rounded p-8 space-y-5">
        <div>
          <div className="font-semibold text-lg text-ink">trust-bank</div>
          <div className="text-ink-soft text-sm">Tenant dashboard</div>
        </div>

        <div className="flex border-b border-line -mb-1">
          <button
            type="button"
            onClick={() => switchMode('api-key')}
            className={`flex-1 text-center py-2.5 text-xs ${
              mode === 'api-key' ? 'font-semibold text-brass-strong border-b-2 border-brass -mb-px' : 'text-ink-soft'
            }`}
          >
            Admin API key
          </button>
          <button
            type="button"
            onClick={() => switchMode('staff-session')}
            className={`flex-1 text-center py-2.5 text-xs ${
              mode === 'staff-session' ? 'font-semibold text-brass-strong border-b-2 border-brass -mb-px' : 'text-ink-soft'
            }`}
          >
            Staff session
          </button>
        </div>

        {error && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}

        <Field label="Tenant ID" hint="Given to you at onboarding — a UUID.">
          <TextInput
            className="font-mono"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="9de75b66-4a6c-43f2-a928-…"
            required
          />
        </Field>

        {mode === 'api-key' ? (
          <Field label="Admin API key" hint="Held only in this tab — cleared when you close it. You'll paste it again next visit.">
            <TextInput
              className="font-mono"
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="gw_live_…"
              required
            />
          </Field>
        ) : (
          <Field
            label="Staff session token"
            hint="The same token you're already holding from the staff console — no separate login here. Only an ops_admin session works."
          >
            <TextInput
              className="font-mono"
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="stf_live_…"
              required
            />
          </Field>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Continue'}
        </Button>

        <div className="text-xs text-ink-soft border-t border-line pt-4">
          {mode === 'api-key' ? (
            <>
              This key manages billing-grade access — issuing, rotating, and revoking every credential your
              integration uses. Treat it like a root password.
            </>
          ) : (
            <>
              Exchanged once, server-to-server, for a short-lived Gateway session (30-minute sliding idle
              timeout, same as the staff console's own). trust-bank never stores your raw staff token.
            </>
          )}
        </div>
      </form>
    </div>
  );
}
