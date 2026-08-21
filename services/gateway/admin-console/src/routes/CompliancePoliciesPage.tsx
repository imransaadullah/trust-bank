// One generic page for all five policy types, mirroring the staff
// console's own NewApprovalRequestPage pattern — a type selector plus a
// JSON payload textarea, rather than five bespoke publish forms.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPolicy, publishPolicy, POLICY_TYPES, PAYLOAD_PLACEHOLDERS } from '../api/compliancePolicies';
import { ApiError } from '../api/client';
import type { PolicyType } from '../types/api';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';
import { Combobox } from '../components/Combobox';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';

export function CompliancePoliciesPage() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<PolicyType>('kyc');
  const [tier, setTier] = useState('1');
  const meta = POLICY_TYPES.find((t) => t.value === type)!;
  const queryKey = ['compliance-policy', type, meta.needsTier ? tier : ''];

  const { data: policy, error, isLoading } = useQuery({
    queryKey,
    queryFn: () => getPolicy(type, meta.needsTier ? { tier } : {}),
    retry: false,
  });
  const notConfigured = error instanceof ApiError && error.code === 'NO_POLICY_CONFIGURED';

  const [publishOpen, setPublishOpen] = useState(false);
  const [payloadText, setPayloadText] = useState(PAYLOAD_PLACEHOLDERS[type]);
  const [publishError, setPublishError] = useState<string | null>(null);

  const openPublish = () => {
    setPayloadText(PAYLOAD_PLACEHOLDERS[type]);
    setPublishError(null);
    setPublishOpen(true);
  };

  const publishMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => publishPolicy(type, payload),
    onSuccess: () => {
      setPublishOpen(false);
      queryClient.invalidateQueries({ queryKey: ['compliance-policy', type] });
    },
    onError: (err) => setPublishError(err instanceof ApiError ? err.message : 'Could not publish'),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold text-ink">Compliance policies</h1>

      <div className="flex gap-3 items-end">
        <div className="w-56">
          <Field label="Policy type">
            <Combobox
              value={type}
              onValueChange={(v) => setType(v as PolicyType)}
              options={POLICY_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </Field>
        </div>
        {meta.needsTier && (
          <div className="w-24">
            <Field label="Tier">
              <TextInput type="number" min={0} value={tier} onChange={(e) => setTier(e.target.value)} />
            </Field>
          </div>
        )}
        <Button onClick={openPublish}>Publish new version</Button>
      </div>

      <div className="bg-paper-raised border border-line rounded p-5 max-w-lg">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium text-sm text-ink">Current version</div>
          {policy && <Badge status={`v${policy.version}`} />}
        </div>
        {isLoading && <p className="text-ink-soft text-sm">Loading…</p>}
        {notConfigured && <p className="text-ink-soft text-sm">No policy published yet.</p>}
        {policy && (
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(policy)
                .filter(([key]) => !['id', 'tenantId', 'jurisdiction', 'version', 'createdAt'].includes(key))
                .map(([key, value]) => (
                  <tr key={key}>
                    <td className="text-ink-soft py-1 pr-4 align-top">{key}</td>
                    <td className="font-mono text-ink py-1">{JSON.stringify(value)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={publishOpen} onOpenChange={setPublishOpen} title={`Publish new version — ${meta.label}`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPublishError(null);
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(payloadText);
            } catch {
              setPublishError('Payload must be valid JSON');
              return;
            }
            publishMutation.mutate(payload);
          }}
          className="space-y-4"
        >
          {publishError && (
            <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{publishError}</div>
          )}
          <p className="text-xs text-ink-soft">
            Publishing never edits the current version — it inserts a new, higher one. The old version stays in
            the audit trail.
          </p>
          <Field label="Payload (JSON)" hint="Pre-filled with the expected shape — edit the values.">
            <textarea
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              rows={10}
              className="w-full rounded border border-line bg-paper-raised px-3 py-2 text-xs font-mono text-ink focus:outline-none focus:border-brass"
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={publishMutation.isPending}>
              {publishMutation.isPending ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
