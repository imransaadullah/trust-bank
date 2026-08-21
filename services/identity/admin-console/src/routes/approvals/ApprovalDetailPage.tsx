import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getApproval, approveApproval, rejectApproval, retryExecution } from '../../api/approvals';
import { ApiError } from '../../api/client';
import { useSession } from '../../context/SessionContext';
import { PERMISSIONS } from '../../types/permissions';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { Field, TextInput } from '../../components/Field';
import { PayloadView } from './payloadFormatters';

export function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { me } = useSession();
  const queryClient = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: approval, isLoading } = useQuery({
    queryKey: ['approvals', id],
    queryFn: () => getApproval(id!),
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['approvals'] });
  };

  const approveMutation = useMutation({
    mutationFn: () => approveApproval(id!),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectApproval(id!, reason),
    onSuccess: () => {
      setRejectOpen(false);
      setReason('');
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not reject'),
  });

  const retryMutation = useMutation({
    mutationFn: () => retryExecution(id!),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not retry'),
  });

  if (isLoading) return <p className="text-ink-soft text-sm">Loading…</p>;
  if (!approval) return <p className="text-ink-soft text-sm">Not found.</p>;

  const permissions = PERMISSIONS[approval.actionType];
  // UI convenience only — the server re-checks role and self-approval
  // on every call regardless of what's shown here.
  const hasApproverRole = !!me && permissions.approveRoles.includes(me.role);
  const isSelfRequest = !!me && approval.requestedById === me.id;
  const canApprove = hasApproverRole && !isSelfRequest;
  const canReject = hasApproverRole;
  const canRetry = approval.status === 'failed' && canReject;

  return (
    <div className="max-w-2xl space-y-6">
      <button onClick={() => navigate('/')} className="text-sm text-brass hover:text-brass-strong">
        ← Back to approvals
      </button>

      <div>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-lg font-semibold text-ink font-mono">{approval.actionType}</h1>
          <Badge status={approval.status} />
        </div>
        <p className="text-sm text-ink-soft">Requested {new Date(approval.requestedAt).toLocaleString()}</p>
      </div>

      {error && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}

      <div>
        <h2 className="text-sm font-semibold text-ink mb-2">Request payload</h2>
        <PayloadView actionType={approval.actionType} payload={approval.payload} />
      </div>

      {approval.status === 'rejected' && approval.rejectionReason && (
        <div className="text-sm bg-blocked/10 border border-blocked/30 rounded px-3 py-2">
          <span className="font-medium text-blocked">Rejected: </span>
          <span className="text-ink">{approval.rejectionReason}</span>
        </div>
      )}

      {approval.status === 'failed' && approval.executionError && (
        <div className="text-sm bg-blocked/10 border border-blocked/30 rounded px-3 py-2">
          <span className="font-medium text-blocked">Execution failed: </span>
          <span className="text-ink">{approval.executionError}</span>
        </div>
      )}

      {approval.status === 'executed' && (
        <div className="text-sm bg-good/10 border border-good/30 rounded px-3 py-2 text-good">
          Executed {approval.executedAt && new Date(approval.executedAt).toLocaleString()}
        </div>
      )}

      {approval.status === 'pending' && !hasApproverRole && (
        <p className="text-sm text-ink-soft">You don't have permission to act on this request.</p>
      )}
      {approval.status === 'pending' && hasApproverRole && isSelfRequest && (
        <p className="text-sm text-ink-soft">You requested this — a different staff member must approve it.</p>
      )}

      {approval.status === 'pending' && (
        <div className="flex gap-3">
          {canApprove && (
            <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
              {approveMutation.isPending ? 'Approving…' : 'Approve'}
            </Button>
          )}
          {canReject && (
            <Button variant="danger" onClick={() => setRejectOpen(true)}>
              Reject
            </Button>
          )}
        </div>
      )}

      {canRetry && (
        <Button onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
          {retryMutation.isPending ? 'Retrying…' : 'Retry execution'}
        </Button>
      )}

      <Modal open={rejectOpen} onOpenChange={setRejectOpen} title="Reject request">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            rejectMutation.mutate();
          }}
          className="space-y-4"
        >
          <Field label="Reason">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={rejectMutation.isPending}>
              {rejectMutation.isPending ? 'Rejecting…' : 'Reject'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
