import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../context/SessionContext';
import { getMerchant, rotateWebhookSecret } from '../api/merchant';
import { Button } from '../components/Button';

export function SettingsPage() {
  const { merchant } = useSession();
  const queryClient = useQueryClient();
  const [rotating, setRotating] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  const merchantQuery = useQuery({
    queryKey: ['merchant', merchant?.id],
    queryFn: () => getMerchant(merchant!.id),
    enabled: !!merchant,
  });

  const onRotate = async () => {
    if (!merchant) return;
    setRotating(true);
    try {
      await rotateWebhookSecret(merchant.id);
      await queryClient.invalidateQueries({ queryKey: ['merchant', merchant.id] });
    } finally {
      setRotating(false);
      setConfirmingRotate(false);
    }
  };

  if (!merchant) return null;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold text-ink">Settings</h1>

      <div className="bg-paper-raised border border-line rounded p-5">
        <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mb-2">Webhook URL</div>
        <div className="font-mono text-sm text-ink">
          {merchantQuery.isLoading ? '…' : (merchantQuery.data?.webhookUrl ?? '— not configured —')}
        </div>
        {/* No route to change this yet this slice — a named gap, same
            discipline as merchant suspend in the schema's own comment.
            Set by the tenant at merchant creation, via the Gateway proxy. */}
        <div className="text-xs text-ink-soft mt-2">Set by your bank when your merchant account is created — contact them to change it.</div>
      </div>

      <div className="bg-paper-raised border border-line rounded p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-mono uppercase tracking-wide text-ink-soft">Webhook signing secret</div>
          {!confirmingRotate && (
            <button onClick={() => setConfirmingRotate(true)} className="text-brass hover:text-brass-strong text-xs">
              Rotate
            </button>
          )}
        </div>

        <div className="bg-brass/10 border border-brass rounded px-3 py-2.5">
          <div className="font-mono text-xs text-brass-strong break-all">
            {merchantQuery.isLoading ? '…' : merchantQuery.data?.webhookSecret}
          </div>
        </div>

        <div className="text-xs text-ink-soft mt-2.5">
          Visible any time you come back — unlike an API key, this isn't a shown-once secret. Rotating replaces it immediately;
          update your endpoint before the old one stops verifying.
        </div>

        {confirmingRotate && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className="text-ink-soft">Rotate now? The old secret stops working immediately.</span>
            <Button variant="danger" className="px-2 py-1" onClick={onRotate} disabled={rotating}>
              {rotating ? 'Rotating…' : 'Confirm rotate'}
            </Button>
            <button onClick={() => setConfirmingRotate(false)} className="text-ink-soft hover:text-ink">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
