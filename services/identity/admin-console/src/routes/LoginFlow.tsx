// A single state machine, not separate routed pages — none of the
// intermediate steps (mfa-enroll, mfa-verify) are meaningfully
// bookmarkable, so routing between them would just add complexity.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { login, mfaEnroll, mfaEnrollConfirm, loginMfa } from '../api/auth';
import { ApiError } from '../api/client';
import { useSession } from '../context/SessionContext';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';

type Step = 'credentials' | 'enroll-confirm' | 'verify';

export function LoginFlow() {
  const navigate = useNavigate();
  const { setSession } = useSession();

  const [step, setStep] = useState<Step>('credentials');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [tenantId, setTenantId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaChallengeToken, setMfaChallengeToken] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (step === 'enroll-confirm' && otpauthUri && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, otpauthUri, { width: 220 }).catch(() => {
        setError('Could not render the enrollment QR code.');
      });
    }
  }, [step, otpauthUri]);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ tenantId, email, password });
      setMfaChallengeToken(result.mfaChallengeToken);
      if (result.mfaEnrolled) {
        setStep('verify');
      } else {
        const enrollResult = await mfaEnroll(result.mfaChallengeToken);
        setOtpauthUri(enrollResult.otpauthUri);
        setStep('enroll-confirm');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { sessionToken } = await loginMfa(mfaChallengeToken, code);
      await setSession(sessionToken);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnrollConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { sessionToken } = await mfaEnrollConfirm(mfaChallengeToken, code);
      await setSession(sessionToken);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enrollment failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <div className="w-full max-w-sm bg-paper-raised border border-line rounded-lg p-8">
        <h1 className="text-xl font-semibold text-ink mb-1">trust-bank</h1>
        <p className="text-sm text-ink-soft mb-6">Staff console</p>

        {error && <div className="mb-4 text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}

        {step === 'credentials' && (
          <form onSubmit={handleCredentials} className="space-y-4">
            <Field label="Tenant ID" hint="Given to you at onboarding — a UUID">
              <TextInput value={tenantId} onChange={(e) => setTenantId(e.target.value)} required autoComplete="off" />
            </Field>
            <Field label="Email">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            </Field>
            <Field label="Password">
              <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </Field>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}

        {step === 'verify' && (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-ink-soft">Enter the 6-digit code from your authenticator app.</p>
            <Field label="Code">
              <TextInput value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="one-time-code" inputMode="numeric" maxLength={6} />
            </Field>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Verifying…' : 'Verify'}
            </Button>
          </form>
        )}

        {step === 'enroll-confirm' && (
          <form onSubmit={handleEnrollConfirm} className="space-y-4">
            <p className="text-sm text-ink-soft">Scan this with your authenticator app, then enter the code it shows.</p>
            <div className="flex justify-center">
              <canvas ref={canvasRef} />
            </div>
            <Field label="Code">
              <TextInput value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="one-time-code" inputMode="numeric" maxLength={6} />
            </Field>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Confirming…' : 'Confirm & sign in'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
