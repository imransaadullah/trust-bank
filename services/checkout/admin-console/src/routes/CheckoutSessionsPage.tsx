import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listCheckoutSessions } from '../api/checkoutSessions';
import { Badge } from '../components/Badge';
import { Table, Th, Td } from '../components/Table';

const STATUS_OPTIONS = ['pending', 'processing', 'paid', 'failed', 'expired', 'cancelled'];

function formatNaira(amountKobo: number) {
  return `₦${(amountKobo / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export function CheckoutSessionsPage() {
  const [status, setStatus] = useState('');
  const sessionsQuery = useQuery({
    queryKey: ['checkout-sessions', status],
    queryFn: () => listCheckoutSessions({ status: status || undefined, limit: 100 }),
  });

  const sessions = sessionsQuery.data ?? [];

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Checkout sessions</h1>
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

      {sessionsQuery.isLoading && <p className="text-ink-soft text-sm">Loading…</p>}
      {!sessionsQuery.isLoading && sessions.length === 0 && <p className="text-ink-soft text-sm">No checkout sessions match.</p>}

      {sessions.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Reference</Th>
              <Th>Customer</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <Td className="font-mono">{s.reference}</Td>
                <Td>{s.customerEmail}</Td>
                <Td className="font-mono">{formatNaira(s.amountKobo)}</Td>
                <Td>
                  <Badge status={s.status} />
                </Td>
                <Td className="text-ink-soft">{new Date(s.createdAt).toLocaleString()}</Td>
                <Td>
                  {s.status === 'pending' && (
                    <a href={s.authorizationUrl} target="_blank" rel="noreferrer" className="text-brass hover:text-brass-strong text-xs">
                      Open pay page →
                    </a>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
