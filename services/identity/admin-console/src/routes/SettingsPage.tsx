import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changePassword } from '../api/auth';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setSuccess(true);
      setError(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not change password');
      setSuccess(false);
    },
  });

  return (
    <div className="max-w-sm space-y-4">
      <h1 className="text-lg font-semibold text-ink">Settings</h1>
      <h2 className="text-sm font-semibold text-ink">Change password</h2>

      {error && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}
      {success && (
        <div className="text-sm text-good bg-good/10 border border-good/30 rounded px-3 py-2">
          Password changed. Every other active session was signed out — this one stays signed in.
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (newPassword.length < 12) {
            setError('New password must be at least 12 characters');
            return;
          }
          if (newPassword !== confirmPassword) {
            setError('New password and confirmation do not match');
            return;
          }
          mutation.mutate({ currentPassword, newPassword });
        }}
        className="space-y-3"
      >
        <Field label="Current password">
          <TextInput type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Field label="New password" hint="At least 12 characters">
          <TextInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password">
          <TextInput type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
        </Field>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Changing…' : 'Change password'}
        </Button>
      </form>
    </div>
  );
}
