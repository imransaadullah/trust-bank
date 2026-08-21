import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { openAccount } from '../api/accounts';
import { listBranches } from '../api/branches';
import { ApiError } from '../api/client';
import { useSession } from '../context/SessionContext';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';
import { Combobox } from '../components/Combobox';
import type { LedgerAccount } from '../types/api';

export function OpenAccountPage() {
  const { me } = useSession();
  const isTenantWide = me?.role === 'ops_admin';
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: listBranches, enabled: isTenantWide });

  const [externalCustomerId, setExternalCustomerId] = useState('');
  const [productType, setProductType] = useState('wallet');
  const [currency, setCurrency] = useState('NGN');
  const [kycTier, setKycTier] = useState('0');
  const [branchId, setBranchId] = useState('');
  const [result, setResult] = useState<LedgerAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: openAccount,
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not open account');
      setResult(null);
    },
  });

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-lg font-semibold text-ink">Open account</h1>
      <p className="text-sm text-ink-soft">
        No customer search exists yet — enter the customer's external ID directly (from wherever
        the bank's own customer records live).
      </p>

      {error && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}
      {result && (
        <div className="text-sm text-good bg-good/10 border border-good/30 rounded px-3 py-2">
          Account opened — account number <span className="font-mono">{result.accountNumber}</span>, status {result.status}.
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            externalCustomerId,
            productType,
            currency,
            kycTier: Number(kycTier),
            branchId: isTenantWide && branchId ? branchId : undefined,
          });
        }}
        className="space-y-3"
      >
        <Field label="External customer ID">
          <TextInput value={externalCustomerId} onChange={(e) => setExternalCustomerId(e.target.value)} required />
        </Field>
        <Field label="Product type">
          <TextInput value={productType} onChange={(e) => setProductType(e.target.value)} />
        </Field>
        <Field label="Currency">
          <TextInput value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </Field>
        <Field label="KYC tier">
          <TextInput type="number" min={0} max={3} value={kycTier} onChange={(e) => setKycTier(e.target.value)} />
        </Field>
        {isTenantWide && (
          <Field label="Branch (optional — leave unset for an unbranched account)">
            <Combobox
              value={branchId}
              onValueChange={setBranchId}
              placeholder="No branch"
              options={(branches ?? []).filter((b) => b.status === 'active').map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))}
            />
          </Field>
        )}
        {!isTenantWide && (
          <p className="text-xs text-ink-soft">This account will be tagged to your own branch.</p>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Opening…' : 'Open account'}
        </Button>
      </form>
    </div>
  );
}
