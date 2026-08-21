import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUsage } from '../api/usage';
import { Table, Th, Td } from '../components/Table';
import { Badge } from '../components/Badge';
import { TextInput } from '../components/Field';

export function UsagePage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['usage', from, to],
    queryFn: () => getUsage({ from: from || undefined, to: to || undefined }),
  });

  const dailyTotals = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, number>();
    for (const key of data.keys) {
      for (const point of key.daily) {
        byDate.set(point.date, (byDate.get(point.date) ?? 0) + point.requestCount);
      }
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, requestCount]) => ({ date, requestCount }));
  }, [data]);

  const max = Math.max(1, ...dailyTotals.map((d) => d.requestCount));

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Usage</h1>
        <div className="flex items-center gap-2 text-sm">
          <TextInput type="date" className="font-mono w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-ink-soft">→</span>
          <TextInput type="date" className="font-mono w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-ink-soft -mt-3">
        Request counts only — no cost or plan data. Today's figure is live; earlier days are a settled daily rollup.
        {!from && !to && data && (
          <>
            {' '}Showing {data.from} → {data.to} (default range).
          </>
        )}
      </p>

      {isLoading && <p className="text-ink-soft text-sm">Loading…</p>}

      {!isLoading && data && (
        <>
          <div className="bg-paper-raised border border-line rounded p-5">
            <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mb-3">Requests / day, all keys</div>
            {dailyTotals.length === 0 ? (
              <p className="text-ink-soft text-sm">No requests in this range.</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {dailyTotals.map((d) => (
                  <div
                    key={d.date}
                    title={`${d.date}: ${d.requestCount.toLocaleString()}`}
                    className="flex-1 bg-brass rounded-t opacity-80 hover:opacity-100"
                    style={{ height: `${Math.max(2, (d.requestCount / max) * 100)}%` }}
                  />
                ))}
              </div>
            )}
          </div>

          <Table>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Tier</Th>
                <Th>Total (range)</Th>
              </tr>
            </thead>
            <tbody>
              {data.keys.length === 0 && (
                <tr>
                  <Td className="text-ink-soft">No keys in this range.</Td>
                  <Td></Td>
                  <Td></Td>
                </tr>
              )}
              {data.keys.map((k) => (
                <tr key={k.apiKeyId}>
                  <Td>{k.label}</Td>
                  <Td><Badge status={k.tier} /></Td>
                  <Td className="font-mono">{k.totalRequests.toLocaleString()}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
