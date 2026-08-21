import { koboToNairaDisplay } from '../../lib/money';
import type { ActionType } from '../../types/api';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1 border-b border-line last:border-0">
      <span className="text-ink-soft">{label}</span>
      <span className="text-ink font-mono">{value}</span>
    </div>
  );
}

function JsonFallback({ payload }: { payload: Record<string, unknown> }) {
  return (
    <pre className="text-xs bg-paper-raised border border-line rounded p-3 overflow-x-auto text-ink-soft">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

interface LedgerLine {
  ledgerAccountId: string;
  direction: string;
  amount: number;
}

function LedgerAdjustmentView({ payload }: { payload: Record<string, unknown> }) {
  const lines = (payload.lines as LedgerLine[] | undefined) ?? [];
  return (
    <div className="space-y-2">
      {payload.reference !== undefined && <Row label="Reference" value={String(payload.reference)} />}
      {payload.description !== undefined && <Row label="Description" value={String(payload.description)} />}
      {lines.map((line, i) => (
        <Row key={i} label={`${line.direction} — ${line.ledgerAccountId}`} value={koboToNairaDisplay(line.amount)} />
      ))}
    </div>
  );
}

function LedgerReversalView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {payload.journalEntryId !== undefined && <Row label="Journal entry" value={String(payload.journalEntryId)} />}
      {payload.reason !== undefined && <Row label="Reason" value={String(payload.reason)} />}
    </div>
  );
}

function LoanDisbursementView({ payload }: { payload: Record<string, unknown> }) {
  // No amount field in this payload — the loan account already carries
  // its own principalKobo server-side, disbursement doesn't restate it.
  return (
    <div className="space-y-2">
      {payload.reference !== undefined && <Row label="Reference" value={String(payload.reference)} />}
      {payload.description !== undefined && <Row label="Description" value={String(payload.description)} />}
    </div>
  );
}

function ComplianceCaseReviewView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {payload.caseId !== undefined && <Row label="Case" value={String(payload.caseId)} />}
      {payload.status !== undefined && <Row label="Decision" value={String(payload.status)} />}
      {payload.reviewNotes !== undefined && (
        <div className="text-sm">
          <span className="text-ink-soft block mb-1">Notes</span>
          <p className="text-ink">{String(payload.reviewNotes)}</p>
        </div>
      )}
    </div>
  );
}

function PolicyPublishView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {Object.entries(payload).map(([key, value]) => (
        <Row key={key} label={key} value={typeof value === 'object' ? JSON.stringify(value) : String(value)} />
      ))}
    </div>
  );
}

const FORMATTERS: Partial<Record<ActionType, (props: { payload: Record<string, unknown> }) => JSX.Element>> = {
  LEDGER_ADJUSTMENT: LedgerAdjustmentView,
  LEDGER_REVERSAL: LedgerReversalView,
  LOAN_DISBURSEMENT: LoanDisbursementView,
  COMPLIANCE_CASE_REVIEW: ComplianceCaseReviewView,
  COMPLIANCE_KYC_POLICY_PUBLISH: PolicyPublishView,
  COMPLIANCE_DEVICE_POLICY_PUBLISH: PolicyPublishView,
  COMPLIANCE_MONITORING_POLICY_PUBLISH: PolicyPublishView,
  COMPLIANCE_LOAN_ELIGIBILITY_POLICY_PUBLISH: PolicyPublishView,
};

export function PayloadView({ actionType, payload }: { actionType: ActionType; payload: Record<string, unknown> }) {
  const Formatter = FORMATTERS[actionType];
  if (!Formatter) return <JsonFallback payload={payload} />;
  try {
    return <Formatter payload={payload} />;
  } catch {
    // A malformed or unexpected payload shape shouldn't crash the whole
    // detail view — fall back to the raw JSON.
    return <JsonFallback payload={payload} />;
  }
}
