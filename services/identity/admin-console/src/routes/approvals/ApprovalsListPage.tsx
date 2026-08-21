import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listApprovals } from '../../api/approvals';
import { Table, Th, Td } from '../../components/Table';
import { Badge } from '../../components/Badge';
import type { ApprovalStatus } from '../../types/api';

const STATUS_TABS: (ApprovalStatus | 'all')[] = ['pending', 'executed', 'rejected', 'failed', 'all'];

export function ApprovalsListPage() {
  const [status, setStatus] = useState<ApprovalStatus | 'all'>('pending');
  const { data: approvals, isLoading } = useQuery({
    queryKey: ['approvals', status],
    queryFn: () => listApprovals(status === 'all' ? undefined : status),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Approvals</h1>
        <Link to="/approvals/new" className="text-sm text-brass hover:text-brass-strong font-medium">
          + New request
        </Link>
      </div>

      <div className="flex gap-2 border-b border-line">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setStatus(tab)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              status === tab ? 'border-brass text-brass-strong' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Action</Th>
              <Th>Status</Th>
              <Th>Requested</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(approvals ?? []).map((a) => (
              <tr key={a.id}>
                <Td><span className="font-mono text-xs">{a.actionType}</span></Td>
                <Td><Badge status={a.status} /></Td>
                <Td>{new Date(a.requestedAt).toLocaleString()}</Td>
                <Td>
                  <Link to={`/approvals/${a.id}`} className="text-brass hover:text-brass-strong">
                    View
                  </Link>
                </Td>
              </tr>
            ))}
            {approvals?.length === 0 && (
              <tr><Td>No approvals in this status.</Td><Td></Td><Td></Td><Td></Td></tr>
            )}
          </tbody>
        </Table>
      )}
    </div>
  );
}
