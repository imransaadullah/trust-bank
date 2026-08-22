import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../context/SessionContext';
import { listCheckoutSessions } from '../api/checkoutSessions';
import { listDeliveries } from '../api/webhookDeliveries';
import { Badge } from '../components/Badge';
import { Table, Th, Td } from '../components/Table';

function formatNaira(amountKobo: number) {
  return `₦${(amountKobo / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export function OverviewPage() {
  const { merchant } = useSession();

  const sessionsQuery = useQuery({
    queryKey: ['checkout-sessions', 'recent'],
    queryFn: () => listCheckoutSessions({ limit: 50 }),
  });
  const deliveriesQuery = useQuery({
    queryKey: ['deliveries', 'recent', merchant?.id],
    queryFn: () => listDeliveries(merchant!.id, { limit: 100 }),
    enabled: !!merchant,
  });

  if (!merchant) return null;

  const sessions = sessionsQuery.data ?? [];
  const deliveries = deliveriesQuery.data ?? [];
  const delivered = deliveries.filter((d) => d.status === 'delivered').length;
  const failing = deliveries.filter((d) => d.status === 'failed').length;
  const deliveredPct = deliveries.length > 0 ? ((delivered / deliveries.length) * 100).toFixed(1) : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <div className="text-ink-soft text-xs font-mono uppercase tracking-wide">Merchant</div>
        <h1 className="text-2xl font-semibold text-ink mt-0.5 flex items-center gap-2">
          {merchant.name}
          <Badge status="active" />
        </h1>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-paper-raised border border-line rounded p-4">
          <div className="text-2xl font-semibold text-brass">{sessionsQuery.isLoading ? '…' : sessions.length}</div>
          <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mt-1">recent sessions</div>
        </div>
        <div className="bg-paper-raised border border-line rounded p-4">
          <div className="text-2xl font-semibold text-good">
            {deliveriesQuery.isLoading ? '…' : deliveredPct !== null ? `${deliveredPct}%` : '—'}
          </div>
          <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mt-1">webhooks delivered</div>
        </div>
        <div className="bg-paper-raised border border-line rounded p-4">
          <div className={`text-2xl font-semibold ${failing > 0 ? 'text-blocked' : 'text-ink'}`}>
            {deliveriesQuery.isLoading ? '…' : failing}
          </div>
          <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mt-1">deliveries failing</div>
        </div>
      </div>

      <div className="bg-paper-raised border border-line rounded p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium text-sm text-ink">Recent checkout sessions</div>
          <Link to="/sessions" className="text-brass hover:text-brass-strong text-xs">
            View all sessions →
          </Link>
        </div>
        {sessionsQuery.isLoading && <p className="text-ink-soft text-sm">Loading…</p>}
        {!sessionsQuery.isLoading && sessions.length === 0 && <p className="text-ink-soft text-sm">No checkout sessions yet.</p>}
        {sessions.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Customer</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 5).map((s) => (
                <tr key={s.id}>
                  <Td className="font-mono">{s.reference}</Td>
                  <Td>{s.customerEmail}</Td>
                  <Td className="font-mono">{formatNaira(s.amountKobo)}</Td>
                  <Td>
                    <Badge status={s.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
