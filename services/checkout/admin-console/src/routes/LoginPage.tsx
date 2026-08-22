import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { ApiError } from '../api/client';
import { Field, TextInput } from '../components/Field';
import { Button } from '../components/Button';

type Step = 'email' | 'code';

export function LoginPage() {
  const { sendOtp, verifyOtp } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [tenantId, setTenantId] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSendCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await sendOtp(tenantId.trim(), email.trim());
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send code');
    } finally {
      setSubmitting(false);
    }
  };

  const onVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyOtp(tenantId.trim(), email.trim(), code.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid or expired code');
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    setError(null);
    try {
      await sendOtp(tenantId.trim(), email.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend code');
    }
  };

  if (step === 'email') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <form onSubmit={onSendCode} className="w-full max-w-sm bg-paper-raised border border-line rounded p-8 space-y-5">
          <div>
            <div className="font-semibold text-lg text-ink">trust-bank</div>
            <div className="text-ink-soft text-sm">Merchant dashboard</div>
          </div>

          {error && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}

          <Field label="Tenant ID" hint="Given to you by the bank you sell through.">
            <TextInput
              className="font-mono"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="9de75b66-4a6c-43f2-a928-…"
              required
            />
          </Field>

          <Field label="Email" hint="The email your merchant account was set up with.">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourbusiness.com"
              required
            />
          </Field>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send code'}
          </Button>

          <div className="text-xs text-ink-soft border-t border-line pt-4">
            We'll email a 6-digit code — no password to remember or leak.
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <form onSubmit={onVerifyCode} className="w-full max-w-sm bg-paper-raised border border-line rounded p-8 space-y-5">
        <div>
          <div className="font-semibold text-lg text-ink">trust-bank</div>
          <div className="text-ink-soft text-sm">Merchant dashboard</div>
        </div>

        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-soft">
            Code sent to <span className="font-mono text-ink">{email}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
            className="text-brass hover:text-brass-strong"
          >
            Change
          </button>
        </div>

        {error && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}

        <Field label="Code">
          <TextInput
            className="font-mono text-center text-lg tracking-[0.4em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            required
          />
        </Field>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Verifying…' : 'Verify & continue'}
        </Button>

        <div className="text-xs text-ink-soft border-t border-line pt-4">
          Didn't get it?{' '}
          <button type="button" onClick={onResend} className="text-brass hover:text-brass-strong">
            Resend code
          </button>
        </div>
      </form>
    </div>
  );
}
