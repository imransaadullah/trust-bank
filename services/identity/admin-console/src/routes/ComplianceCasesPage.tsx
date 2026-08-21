import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listComplianceCases } from '../api/complianceCases';
import { requestApproval } from '../api/approvals';
import { ApiError } from '../api/client';
import { useSession } from '../context/SessionContext';
import { PERMISSIONS } from '../types/permissions';
import { Table, Th, Td } from '../components/Table';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Field, TextInput } from '../components/Field';
import { Combobox } from '../components/Combobox';
import type { ComplianceCase } from '../types/api';

const REVIEW_OUTCOMES = [
  { value: 'reviewed', label: 'Reviewed — no action' },
  { value: 'dismissed', label: 'Dismissed — false positive' },
  { value: 'escalated', label: 'Escalated' },
];

export function ComplianceCasesPage() {
  const { me } = useSession();
  const queryClient = useQueryClient();
  const canRequestReview = !!me && PERMISSIONS.COMPLIANCE_CASE_REVIEW.requestRoles.includes(me.role);

  const { data: cases, isLoading } = useQuery({ queryKey: ['compliance-cases'], queryFn: () => listComplianceCases() });

  const [target, setTarget] = useState<ComplianceCase | null>(null);
  const [reviewStatus, setReviewStatus] = useState('reviewed');
  const [reviewNotes, setReviewNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      requestApproval({
        actionType: 'COMPLIANCE_CASE_REVIEW',
        payload: { caseId: target!.id, status: reviewStatus, reviewNotes },
      }),
    onSuccess: () => {
      setTarget(null);
      setReviewNotes('');
      queryClient.invalidateQueries({ queryKey: ['compliance-cases'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not submit review request'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-ink">Compliance cases</h1>

      {isLoading ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>Severity</Th>
              <Th>Status</Th>
              <Th>Opened</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(cases ?? []).map((c) => (
              <tr key={c.id}>
                <Td>{c.caseType}</Td>
                <Td>{c.severity}</Td>
                <Td><Badge status={c.status} /></Td>
                <Td>{new Date(c.createdAt).toLocaleString()}</Td>
                <Td>
                  {canRequestReview && c.status === 'open' && (
                    <button
                      onClick={() => {
                        setTarget(c);
                        setError(null);
                      }}
                      className="text-brass hover:text-brass-strong text-sm"
                    >
                      Request review
                    </button>
                  )}
                </Td>
              </tr>
            ))}
            {cases?.length === 0 && (
              <tr><Td>No cases.</Td><Td></Td><Td></Td><Td></Td><Td></Td></tr>
            )}
          </tbody>
        </Table>
      )}

      <Modal open={!!target} onOpenChange={(open) => !open && setTarget(null)} title="Request case review">
        {error && <div className="mb-3 text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Outcome">
            <Combobox value={reviewStatus} onValueChange={setReviewStatus} options={REVIEW_OUTCOMES} />
          </Field>
          <Field label="Notes">
            <TextInput value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} />
          </Field>
          <p className="text-xs text-ink-soft">
            This creates a review request — a different compliance officer or ops admin must approve
            it from the Approvals inbox before it takes effect.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Submitting…' : 'Submit request'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
