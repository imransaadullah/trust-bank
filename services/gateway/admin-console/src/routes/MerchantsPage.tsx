import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listMerchants, getMerchant, updateWebhookUrl, rotateWebhookSecret } from '../api/merchants';
import { ApiError } from '../api/client';
import type { Merchant } from '../types/api';
import { Table, Th, Td } from '../components/Table';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';
import { Modal } from '../components/Modal';

function MerchantDetail({ merchant, onClose }: { merchant: Merchant; onClose: () => void }) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({ queryKey: ['merchant', merchant.id], queryFn: () => getMerchant(merchant.id), initialData: merchant });

  const [webhookUrlDraft, setWebhookUrlDraft] = useState(merchant.webhookUrl ?? '');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  useEffect(() => {
    setWebhookUrlDraft(detailQuery.data?.webhookUrl ?? '');
  }, [detailQuery.data?.webhookUrl]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['merchant', merchant.id] });

  const saveUrlMutation = useMutation({
    mutationFn: () => updateWebhookUrl(merchant.id, webhookUrlDraft.trim()),
    onSuccess: () => {
      setUrlError(null);
      invalidate();
    },
    onError: (err) => setUrlError(err instanceof ApiError ? err.message : 'Could not save webhook URL'),
  });

  const rotateMutation = useMutation({
    mutationFn: () => rotateWebhookSecret(merchant.id),
    onSuccess: () => {
      setConfirmingRotate(false);
      invalidate();
    },
  });

  const urlChanged = webhookUrlDraft.trim() !== (detailQuery.data?.webhookUrl ?? '');

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={merchant.name}>
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft">{merchant.email}</span>
          <Badge status={detailQuery.data?.status ?? merchant.status} />
        </div>

        <div>
          <Field label="Webhook URL">
            <div className="flex gap-2">
              <TextInput
                className="font-mono"
                value={webhookUrlDraft}
                onChange={(e) => setWebhookUrlDraft(e.target.value)}
                placeholder="https://merchant.example/webhooks/trustbank"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => saveUrlMutation.mutate()}
                disabled={saveUrlMutation.isPending || !urlChanged || !webhookUrlDraft.trim()}
              >
                {saveUrlMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </Field>
          {urlError && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2 mt-2">{urlError}</div>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="block text-sm font-medium text-ink">Webhook signing secret</span>
            {!confirmingRotate && (
              <button onClick={() => setConfirmingRotate(true)} className="text-xs text-brass hover:text-brass-strong">
                Rotate
              </button>
            )}
          </div>
          <div className="bg-brass/10 border border-brass rounded px-3 py-2.5">
            <div className="font-mono text-xs text-brass-strong break-all">{detailQuery.data?.webhookSecret}</div>
          </div>
          <div className="text-xs text-ink-soft mt-2">
            Visible any time you come back — not a shown-once secret. Rotating on the merchant's behalf immediately invalidates their
            current one; useful if they're locked out of their own dashboard.
          </div>
          {confirmingRotate && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="text-ink-soft">Rotate now? The old secret stops working immediately.</span>
              <Button type="button" variant="danger" className="px-2 py-1" onClick={() => rotateMutation.mutate()} disabled={rotateMutation.isPending}>
                {rotateMutation.isPending ? 'Rotating…' : 'Confirm rotate'}
              </Button>
              <button onClick={() => setConfirmingRotate(false)} className="text-ink-soft hover:text-ink">
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-line">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function MerchantsPage() {
  const { data: merchants, isLoading } = useQuery({ queryKey: ['merchants'], queryFn: listMerchants });
  const [selected, setSelected] = useState<Merchant | null>(null);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Merchants</h1>
        <p className="text-ink-soft text-sm mt-1">
          Your own merchants' webhook configuration — view or rotate a webhook secret on their behalf, e.g. if they're locked out of
          their own dashboard. Merchants manage this themselves day to day at their own <span className="font-mono">/merchant</span>{' '}
          login.
        </p>
      </div>

      {isLoading && <p className="text-ink-soft text-sm">Loading…</p>}
      {!isLoading && (merchants?.length ?? 0) === 0 && <p className="text-ink-soft text-sm">No merchants yet.</p>}

      {(merchants?.length ?? 0) > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Webhook URL</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {merchants!.map((m) => (
              <tr key={m.id}>
                <Td>{m.name}</Td>
                <Td>{m.email}</Td>
                <Td className="font-mono text-xs">{m.webhookUrl ?? '— not configured —'}</Td>
                <Td>
                  <Badge status={m.status} />
                </Td>
                <Td>
                  <button onClick={() => setSelected(m)} className="text-xs text-brass hover:text-brass-strong">
                    Manage →
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {selected && <MerchantDetail merchant={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
