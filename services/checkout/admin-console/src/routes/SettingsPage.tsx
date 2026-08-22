import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../context/SessionContext';
import { getMerchant, rotateWebhookSecret, updateWebhookUrl } from '../api/merchant';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { TextInput } from '../components/Field';

export function SettingsPage() {
  const { merchant } = useSession();
  const queryClient = useQueryClient();
  const [rotating, setRotating] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [webhookUrlDraft, setWebhookUrlDraft] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const merchantQuery = useQuery({
    queryKey: ['merchant', merchant?.id],
    queryFn: () => getMerchant(merchant!.id),
    enabled: !!merchant,
  });

  // Sync the editable draft to the fetched value — but only until the
  // user starts typing, so a background refetch (e.g. after rotate)
  // never clobbers an in-progress edit.
  useEffect(() => {
    if (merchantQuery.data && webhookUrlDraft === '') {
      setWebhookUrlDraft(merchantQuery.data.webhookUrl ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantQuery.data]);

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

  const onSaveWebhookUrl = async () => {
    if (!merchant) return;
    setUrlError(null);
    setSavingUrl(true);
    try {
      await updateWebhookUrl(merchant.id, webhookUrlDraft.trim());
      await queryClient.invalidateQueries({ queryKey: ['merchant', merchant.id] });
    } catch (err) {
      setUrlError(err instanceof ApiError ? err.message : 'Could not save webhook URL');
    } finally {
      setSavingUrl(false);
    }
  };

  if (!merchant) return null;

  const urlChanged = merchantQuery.data && webhookUrlDraft.trim() !== (merchantQuery.data.webhookUrl ?? '');

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold text-ink">Settings</h1>

      <div className="bg-paper-raised border border-line rounded p-5">
        <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mb-2">Webhook URL</div>
        {urlError && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2 mb-2">{urlError}</div>}
        <div className="flex gap-2">
          <TextInput
            className="font-mono"
            value={webhookUrlDraft}
            onChange={(e) => setWebhookUrlDraft(e.target.value)}
            placeholder="https://yourbusiness.example/webhooks/trustbank"
          />
          <Button variant="secondary" onClick={onSaveWebhookUrl} disabled={savingUrl || !urlChanged || !webhookUrlDraft.trim()}>
            {savingUrl ? 'Saving…' : 'Save'}
          </Button>
        </div>
        <div className="text-xs text-ink-soft mt-2">Where checkout_session.paid and other events get delivered, signed with the secret below.</div>
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
