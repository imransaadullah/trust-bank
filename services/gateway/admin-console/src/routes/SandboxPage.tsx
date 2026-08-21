import { useQuery } from '@tanstack/react-query';
import { useSession } from '../context/SessionContext';
import { getSandbox } from '../api/sandbox';
import { ApiError } from '../api/client';
import { Badge } from '../components/Badge';

export function SandboxPage() {
  const { tenant } = useSession();
  const { data, error, isLoading } = useQuery({
    queryKey: ['sandbox'],
    queryFn: getSandbox,
    retry: false,
  });

  const notProvisioned = error instanceof ApiError && error.code === 'SANDBOX_NOT_PROVISIONED';

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Sandbox</h1>
        <p className="text-ink-soft text-sm mt-1 max-w-[70ch]">
          A sandbox-tier key resolves to a fully separate twin tenant — its own accounts, safe to break — reached
          at the same URL as production. Nothing here shares data with the tenant below.
        </p>
      </div>

      {isLoading && <p className="text-ink-soft text-sm">Loading…</p>}

      {!isLoading && data && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-paper-raised border border-line rounded p-5">
            <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mb-2">Production tenant</div>
            <div className="font-mono text-sm">{tenant?.id}</div>
            <div className="mt-2"><Badge status="production" /></div>
          </div>
          <div className="bg-paper-raised border border-line rounded p-5">
            <div className="text-xs font-mono uppercase tracking-wide text-ink-soft mb-2">Sandbox twin</div>
            <div className="font-mono text-sm">{data.sandboxTenantId}</div>
            <div className="mt-2"><Badge status="provisioned" /></div>
          </div>
        </div>
      )}

      {!isLoading && notProvisioned && (
        <div className="bg-paper-raised border border-line rounded p-5">
          <div className="font-medium text-sm text-ink mb-1">Not provisioned yet</div>
          {/* Deliberately no self-service button here: registering a
              sandbox twin needs a Ledger platform-admin credential to
              create the twin tenant itself first (deploy/provision-
              tenant.sh's provision_sandbox_twin) — nothing a tenant's
              own admin-tier key can do on its own. Building a button
              for an action the tenant can't actually complete would be
              dishonest UX. */}
          <p className="text-ink-soft text-sm">
            This tenant has no sandbox environment yet. It's set up by trust-bank during onboarding, not something
            your own admin key can provision — contact your account team to add one.
          </p>
        </div>
      )}
    </div>
  );
}
