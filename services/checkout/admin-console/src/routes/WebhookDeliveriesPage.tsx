import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../context/SessionContext';
import { listDeliveries } from '../api/webhookDeliveries';
import { Badge } from '../components/Badge';
import { Table, Th, Td } from '../components/Table';

const STATUS_OPTIONS = ['pending', 'processing', 'delivered', 'failed'];

export function WebhookDeliveriesPage() {
  const { merchant } = useSession();
  const [status, setStatus] = useState('');
  const deliveriesQuery = useQuery({
    queryKey: ['deliveries', status, merchant?.id],
    queryFn: () => listDeliveries(merchant!.id, { status: status || undefined, limit: 100 }),
    enabled: !!merchant,
  });

  const deliveries = deliveriesQuery.data ?? [];

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Webhook deliveries</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none focus:border-brass"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <p className="text-ink-soft text-xs">
        Delivered to your configured webhook URL. Failed deliveries retry linearly, up to the configured max, before being marked
        failed for good.
      </p>

      {deliveriesQuery.isLoading && <p className="text-ink-soft text-sm">Loading…</p>}
      {!deliveriesQuery.isLoading && deliveries.length === 0 && <p className="text-ink-soft text-sm">No deliveries match.</p>}

      {deliveries.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Event</Th>
              <Th>Session</Th>
              <Th>Status</Th>
              <Th>Retries</Th>
              <Th>Last error</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <Td>{d.eventType}</Td>
                <Td className="font-mono">{d.checkoutSessionId}</Td>
                <Td>
                  <Badge status={d.status} />
                </Td>
                <Td className="font-mono">{d.retryCount}</Td>
                <Td className="text-ink-soft text-xs">{d.lastError ?? '—'}</Td>
                <Td className="text-ink-soft">{new Date(d.deliveredAt ?? d.createdAt).toLocaleString()}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
