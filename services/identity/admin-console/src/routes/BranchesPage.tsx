import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listBranches, createBranch } from '../api/branches';
import { ApiError } from '../api/client';
import { useSession } from '../context/SessionContext';
import { Table, Th, Td } from '../components/Table';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Field, TextInput } from '../components/Field';

export function BranchesPage() {
  const { me } = useSession();
  const queryClient = useQueryClient();
  const { data: branches, isLoading } = useQuery({ queryKey: ['branches'], queryFn: listBranches });

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createBranch,
    onSuccess: () => {
      setCode('');
      setName('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create branch'),
  });

  const activeBranches = (branches ?? []).filter((b) => b.status === 'active');
  const otherBranches = (branches ?? []).filter((b) => b.status !== 'active');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-ink mb-4">Branches</h1>
        {isLoading ? (
          <p className="text-ink-soft text-sm">Loading…</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {[...activeBranches, ...otherBranches].map((b) => (
                <tr key={b.id}>
                  <Td><span className="font-mono">{b.code}</span></Td>
                  <Td>{b.name}</Td>
                  <Td><Badge status={b.status} /></Td>
                </tr>
              ))}
              {branches?.length === 0 && (
                <tr><Td>No branches yet.</Td><Td></Td><Td></Td></tr>
              )}
            </tbody>
          </Table>
        )}
      </div>

      {me?.role === 'ops_admin' && (
        <div className="max-w-sm">
          <h2 className="text-sm font-semibold text-ink mb-3">Create a branch</h2>
          {error && <div className="mb-3 text-sm text-blocked bg-blocked/10 border border-blocked/30 rounded px-3 py-2">{error}</div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate({ code, name });
            }}
            className="space-y-3"
          >
            <Field label="Code">
              <TextInput value={code} onChange={(e) => setCode(e.target.value)} required />
            </Field>
            <Field label="Name">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create branch'}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
