import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { ApiError } from '../api/client';
import { Field, TextInput } from '../components/Field';
import { Button } from '../components/Button';

export function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const [tenantId, setTenantId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(tenantId.trim(), apiKey.trim());
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
        <Field label="Admin API key" hint="Held only in this tab — cleared when you close it. You'll paste it again next visit.">
          <TextInput
            className="font-mono"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="gw_live_…"
            required
          />
        </Field>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Continue'}
        </Button>

        <div className="text-xs text-ink-soft border-t border-line pt-4">
          This key manages billing-grade access — issuing, rotating, and revoking every credential your
          integration uses. Treat it like a root password.
        </div>
      </form>
    </div>
  );
}
