import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listApiKeys, issueApiKey, rotateApiKey, revokeApiKey } from '../api/apiKeys';
import { ApiError } from '../api/client';
import type { ApiKeySummary, ApiKeyTier, IssuedApiKey } from '../types/api';
import { Table, Th, Td } from '../components/Table';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';
import { Combobox } from '../components/Combobox';
import { Modal } from '../components/Modal';

const TIER_OPTIONS = [
  { value: 'sandbox', label: 'Sandbox' },
  { value: 'production', label: 'Production' },
];

function TokenReveal({ issued, onDone }: { issued: IssuedApiKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <div className="text-sm text-ink-soft">Copy it now — this is the only time it's shown in full.</div>
      <div className="bg-brass/10 border border-brass rounded px-3 py-3">
        <div className="font-mono text-xs break-all text-brass-strong">{issued.token}</div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={() => {
            navigator.clipboard.writeText(issued.token);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button type="button" className="flex-1" onClick={onDone}>
          Done
        </Button>
      </div>
      <div className="text-xs text-ink-soft border-t border-line pt-3">
        Label: <span className="font-mono text-ink">{issued.label}</span> · Tier: <Badge status={issued.tier} /> · Limit:{' '}
        <span className="font-mono text-ink">{issued.rateLimitPerMinute}/min</span>
      </div>
    </div>
  );
}

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const { data: keys, isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: listApiKeys });

  const [issueOpen, setIssueOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [tier, setTier] = useState<ApiKeyTier>('sandbox');
  const [rateLimit, setRateLimit] = useState('');
  const [issueError, setIssueError] = useState<string | null>(null);

  const [revealToken, setRevealToken] = useState<IssuedApiKey | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ApiKeySummary | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['api-keys'] });

  const issueMutation = useMutation({
    mutationFn: () =>
      issueApiKey({ label, tier, rateLimitPerMinute: rateLimit ? Number(rateLimit) : undefined }),
    onSuccess: (result) => {
      setIssueOpen(false);
      setLabel('');
      setTier('sandbox');
      setRateLimit('');
      setIssueError(null);
      setRevealToken(result);
      invalidate();
    },
    onError: (err) => setIssueError(err instanceof ApiError ? err.message : 'Could not issue key'),
  });

  const rotateMutation = useMutation({
    mutationFn: (apiKeyId: string) => rotateApiKey(apiKeyId),
    onSuccess: (result) => {
      setRotateTarget(null);
      setRevealToken(result);
      invalidate();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (apiKeyId: string) => revokeApiKey(apiKeyId),
    onSuccess: () => {
      setRevokeTarget(null);
      invalidate();
    },
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">API keys</h1>
        <Button onClick={() => setIssueOpen(true)}>+ Issue key</Button>
      </div>

      {isLoading && <p className="text-ink-soft text-sm">Loading…</p>}
      {!isLoading && (keys?.length ?? 0) === 0 && <p className="text-ink-soft text-sm">No keys issued yet.</p>}

      {(keys?.length ?? 0) > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Label</Th>
              <Th>Tier</Th>
              <Th>Prefix</Th>
              <Th>Status</Th>
              <Th>Limit / min</Th>
              <Th>Last used</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {keys!.map((k) => (
              <tr key={k.id}>
                <Td>{k.label}</Td>
                <Td><Badge status={k.tier} /></Td>
                <Td className="font-mono text-xs">{k.tokenPrefix}</Td>
                <Td><Badge status={k.status} /></Td>
                <Td className="font-mono">{k.rateLimitPerMinute}</Td>
                <Td className="text-ink-soft">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}</Td>
                <Td>
                  {k.status === 'active' && (
                    <div className="flex gap-3">
                      <button onClick={() => setRotateTarget(k)} className="text-xs text-brass hover:text-brass-strong">
                        Rotate
                      </button>
                      <button onClick={() => setRevokeTarget(k)} className="text-xs text-blocked hover:opacity-80">
                        Revoke
                      </button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={issueOpen} onOpenChange={setIssueOpen} title="Issue key">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            issueMutation.mutate();
          }}
          className="space-y-4"
        >
          {issueError && <div className="text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{issueError}</div>}
          <Field label="Label">
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} required />
          </Field>
          <Field label="Tier" hint="Only sandbox and production are self-issuable.">
            <Combobox value={tier} onValueChange={(v) => setTier(v as ApiKeyTier)} options={TIER_OPTIONS} />
          </Field>
          <Field label="Rate limit / min" hint="Optional — leave blank for the default.">
            <TextInput type="number" min={1} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setIssueOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={issueMutation.isPending}>
              {issueMutation.isPending ? 'Issuing…' : 'Issue key'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!revealToken} onOpenChange={(open) => !open && setRevealToken(null)} title="Key issued">
        {revealToken && <TokenReveal issued={revealToken} onDone={() => setRevealToken(null)} />}
      </Modal>

      <Modal open={!!rotateTarget} onOpenChange={(open) => !open && setRotateTarget(null)} title="Rotate key">
        <div className="space-y-4">
          <p className="text-sm text-ink">
            Rotating <span className="font-mono">{rotateTarget?.label}</span> immediately revokes its current token and issues a
            new one. Anything still using the old token will start failing right away.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRotateTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={rotateMutation.isPending}
              onClick={() => rotateTarget && rotateMutation.mutate(rotateTarget.id)}
            >
              {rotateMutation.isPending ? 'Rotating…' : 'Rotate'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)} title="Revoke key">
        <div className="space-y-4">
          <p className="text-sm text-ink">
            Revoking <span className="font-mono">{revokeTarget?.label}</span> takes effect immediately and can't be undone —
            issue a new key if you need a replacement.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={revokeMutation.isPending}
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
            >
              {revokeMutation.isPending ? 'Revoking…' : 'Revoke'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
