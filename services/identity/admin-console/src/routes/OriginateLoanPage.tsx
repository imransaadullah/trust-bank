import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { originateLoan } from '../api/loans';
import { listBranches } from '../api/branches';
import { ApiError } from '../api/client';
import { useSession } from '../context/SessionContext';
import { nairaToKobo, koboToNairaDisplay } from '../lib/money';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';
import { Combobox } from '../components/Combobox';
import type { LoanAccount, LoanEligibilityDecision } from '../types/api';

export function OriginateLoanPage() {
  const { me } = useSession();
  const isTenantWide = me?.role === 'credit_manager';
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: listBranches, enabled: isTenantWide });

  const [externalCustomerId, setExternalCustomerId] = useState('');
  const [principalNaira, setPrincipalNaira] = useState('');
  const [tenorDays, setTenorDays] = useState('30');
  const [branchId, setBranchId] = useState('');
  const [result, setResult] = useState<LoanAccount | null>(null);
  const [ineligible, setIneligible] = useState<{ reason: string; decision: LoanEligibilityDecision } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: originateLoan,
    onSuccess: (data) => {
      setResult(data);
      setIneligible(null);
      setError(null);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'LOAN_NOT_ELIGIBLE') {
        setIneligible({ reason: err.message, decision: err.data as LoanEligibilityDecision });
        setError(null);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not originate loan');
        setIneligible(null);
      }
      setResult(null);
    },
  });

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-lg font-semibold text-ink">Originate loan</h1>
      <p className="text-sm text-ink-soft">
        Origination is a deterministic eligibility check, not staff discretion — disbursement (the
        actual release of funds) is a separate, dual-approval action from the Approvals inbox.
      </p>

      {error && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}
      {ineligible && (
        <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2 space-y-1">
          <p className="font-medium">Not eligible: {ineligible.reason}</p>
          {ineligible.decision.maxLoanAmountKobo !== undefined && (
            <p>Max amount: {koboToNairaDisplay(ineligible.decision.maxLoanAmountKobo)}</p>
          )}
          {ineligible.decision.maxTenorDays !== undefined && <p>Max tenor: {ineligible.decision.maxTenorDays} days</p>}
        </div>
      )}
      {result && (
        <div className="text-sm text-good bg-good/10 border border-good/30 rounded px-3 py-2">
          Loan originated — status {result.status}. Request disbursement from the Approvals inbox
          when ready.
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            externalCustomerId,
            principalKobo: nairaToKobo(Number(principalNaira)),
            tenorDays: Number(tenorDays),
            branchId: isTenantWide && branchId ? branchId : undefined,
          });
        }}
        className="space-y-3"
      >
        <Field label="External customer ID">
          <TextInput value={externalCustomerId} onChange={(e) => setExternalCustomerId(e.target.value)} required />
        </Field>
        <Field label="Principal (₦)">
          <TextInput type="number" min={1} step="0.01" value={principalNaira} onChange={(e) => setPrincipalNaira(e.target.value)} required />
        </Field>
        <Field label="Tenor (days)">
          <TextInput type="number" min={1} value={tenorDays} onChange={(e) => setTenorDays(e.target.value)} required />
        </Field>
        {isTenantWide && (
          <Field label="Branch (optional)">
            <Combobox
              value={branchId}
              onValueChange={setBranchId}
              placeholder="No branch"
              options={(branches ?? []).filter((b) => b.status === 'active').map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))}
            />
          </Field>
        )}
        {!isTenantWide && <p className="text-xs text-ink-soft">This loan will be tagged to your own branch.</p>}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Checking eligibility…' : 'Originate loan'}
        </Button>
      </form>
    </div>
  );
}
