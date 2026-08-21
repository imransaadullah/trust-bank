import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../context/SessionContext';
import { listApiKeys } from '../api/apiKeys';
import { getUsage } from '../api/usage';
import { getSandbox } from '../api/sandbox';
import { ApiError } from '../api/client';
import { Badge } from '../components/Badge';
import { Table, Th, Td } from '../components/Table';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function OverviewPage() {
  const { tenant } = useSession();

  const keysQuery = useQuery({ queryKey: ['api-keys'], queryFn: listApiKeys });
  const usageQuery = useQuery({ queryKey: ['usage', 'today'], queryFn: () => getUsage() });
  const sandboxQuery = useQuery({
    queryKey: ['sandbox'],
    queryFn: getSandbox,
    retry: false,
  });

  if (!tenant) return null;

  const activeKeys = keysQuery.data?.filter((k) => k.status === 'active') ?? [];
  const today = todayISO();
  const requestsToday =
    usageQuery.data?.keys.reduce((sum, k) => sum + (k.daily.find((d) => d.date === today)?.requestCount ?? 0), 0) ?? 0;

  const sandboxNotProvisioned =
    sandboxQuery.error instanceof ApiError && sandboxQuery.error.code === 'SANDBOX_NOT_PROVISIONED';
  const sandboxStatus = sandboxQuery.data ? 'Provisioned' : sandboxNotProvisioned ? 'Not provisioned' : '—';

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <div className="text-ink-soft text-xs font-mono uppercase tracking-wide">{tenant.slug}</div>
        <h1 className="text-2xl font-semibold text-ink mt-0.5 flex items-center gap-2">
          {tenant.name}
          <Badge status={tenant.status} />
        </h1>
        <div className="text-ink-soft text-xs font-mono mt-1">{tenant.id}</div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-paper-raised border border-line rounded p-4">
          <div className="text-2xl font-semibold text-brass">{keysQuery.isLoading ? '…' : activeKeys.length}</div>
          <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mt-1">active keys</div>
        </div>
        <div className="bg-paper-raised border border-line rounded p-4">
          <div className="text-2xl font-semibold text-brass">{usageQuery.isLoading ? '…' : requestsToday.toLocaleString()}</div>
          <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mt-1">requests today</div>
        </div>
        <div className="bg-paper-raised border border-line rounded p-4">
          <div className="text-2xl font-semibold" style={{ color: sandboxQuery.data ? '#3f6b4a' : undefined }}>
            {sandboxQuery.isLoading ? '…' : sandboxStatus}
          </div>
          <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mt-1">sandbox status</div>
        </div>
      </div>

      <div className="bg-paper-raised border border-line rounded p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium text-sm text-ink">Active keys</div>
          <Link to="/api-keys" className="text-brass hover:text-brass-strong text-xs">
            View all keys →
          </Link>
        </div>
        {keysQuery.isLoading && <p className="text-ink-soft text-sm">Loading…</p>}
        {!keysQuery.isLoading && activeKeys.length === 0 && (
          <p className="text-ink-soft text-sm">No active keys yet.</p>
        )}
        {activeKeys.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Label</Th>
                <Th>Tier</Th>
                <Th>Limit / min</Th>
                <Th>Last used</Th>
              </tr>
            </thead>
            <tbody>
              {activeKeys.slice(0, 5).map((k) => (
                <tr key={k.id}>
                  <Td>{k.label}</Td>
                  <Td><Badge status={k.tier} /></Td>
                  <Td className="font-mono">{k.rateLimitPerMinute}</Td>
                  <Td className="text-ink-soft">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
