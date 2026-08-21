// One generic form for all 8 action types, rather than bespoke forms for
// each — none of them have a "browse existing records to act on" screen
// in this slice, so a form that pre-fills every field wouldn't have
// anything real to pre-fill from anyway. A JSON payload textarea with a
// placeholder showing the expected shape per type is the honest v1.
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { requestApproval } from '../../api/approvals';
import { ApiError } from '../../api/client';
import { useSession } from '../../context/SessionContext';
import { PERMISSIONS, ACTION_TYPES } from '../../types/permissions';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Combobox } from '../../components/Combobox';
import type { ActionType } from '../../types/api';

const PAYLOAD_PLACEHOLDERS: Record<ActionType, string> = {
  COMPLIANCE_CASE_REVIEW: '{\n  "caseId": "...",\n  "status": "reviewed",\n  "reviewNotes": "..."\n}',
  LEDGER_ADJUSTMENT: '{\n  "reference": "...",\n  "idempotencyKey": "...",\n  "entryType": "adjustment",\n  "currency": "NGN",\n  "description": "...",\n  "lines": [\n    { "ledgerAccountId": "...", "direction": "debit", "amount": 100000 },\n    { "ledgerAccountId": "...", "direction": "credit", "amount": 100000 }\n  ]\n}',
  LEDGER_REVERSAL: '{\n  "journalEntryId": "...",\n  "reason": "...",\n  "idempotencyKey": "..."\n}',
  COMPLIANCE_KYC_POLICY_PUBLISH: '{\n  "tier": 1,\n  "dailyLimitKobo": 3000000,\n  "singleTxnLimitKobo": 3000000\n}',
  COMPLIANCE_DEVICE_POLICY_PUBLISH: '{\n  "newDeviceLimitKobo": 5000000,\n  "cooldownHours": 24\n}',
  COMPLIANCE_MONITORING_POLICY_PUBLISH: '{\n  "velocityThreshold": 5,\n  "structuringThresholdKobo": 100000000\n}',
  LOAN_DISBURSEMENT: '{\n  "loanAccountId": "...",\n  "reference": "...",\n  "idempotencyKey": "...",\n  "description": "..."\n}',
  COMPLIANCE_LOAN_ELIGIBILITY_POLICY_PUBLISH: '{\n  "maxLoanAmountKobo": 50000000,\n  "interestRateAnnualBps": 2400,\n  "maxTenorDays": 180\n}',
};

export function NewApprovalRequestPage() {
  const navigate = useNavigate();
  const { me } = useSession();

  const eligibleTypes = useMemo(
    () => ACTION_TYPES.filter((t) => !me || PERMISSIONS[t].requestRoles.includes(me.role)),
    [me],
  );

  const [actionType, setActionType] = useState<ActionType | ''>('');
  const [payloadText, setPayloadText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: requestApproval,
    onSuccess: (approval) => navigate(`/approvals/${approval.id}`),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not submit request'),
  });

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-lg font-semibold text-ink">New approval request</h1>

      {eligibleTypes.length === 0 && (
        <p className="text-sm text-ink-soft">Your role isn't permitted to request any maker-checker action.</p>
      )}

      {error && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}

      {eligibleTypes.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!actionType) {
              setError('Choose an action type');
              return;
            }
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(payloadText);
            } catch {
              setError('Payload must be valid JSON');
              return;
            }
            mutation.mutate({ actionType, payload });
          }}
          className="space-y-4"
        >
          <Field label="Action type">
            <Combobox
              value={actionType}
              onValueChange={(value) => {
                setActionType(value as ActionType);
                setPayloadText(PAYLOAD_PLACEHOLDERS[value as ActionType]);
              }}
              placeholder="Choose an action…"
              options={eligibleTypes.map((t) => ({ value: t, label: t }))}
            />
          </Field>
          <Field label="Payload (JSON)" hint="Pre-filled with the expected shape — edit the values.">
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              rows={10}
              className="w-full rounded border border-line bg-paper-raised px-3 py-2 text-xs font-mono text-ink focus:outline-none focus:border-brass"
              required
            />
          </Field>
          <Button type="submit" disabled={mutation.isPending || !actionType}>
            {mutation.isPending ? 'Submitting…' : 'Submit request'}
          </Button>
        </form>
      )}
    </div>
  );
}
