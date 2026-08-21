import { NavLink, Outlet } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useSession } from '../context/SessionContext';
import { logout as logoutRequest } from '../api/auth';

const NAV_LINKS = [
  { to: '/', label: 'Approvals', end: true },
  { to: '/branches', label: 'Branches' },
  { to: '/accounts/open', label: 'Open account' },
  { to: '/loans/originate', label: 'Originate loan' },
  { to: '/compliance-cases', label: 'Compliance cases' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell() {
  const { me, logout } = useSession();

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    // Log the user out client-side regardless of whether the server
    // call itself succeeds (e.g. session already expired) — logout
    // should never get "stuck" because the revoke call 401'd.
    onSettled: () => logout(),
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-paper-raised px-6 py-3 flex items-center justify-between">
        <div>
          <span className="font-semibold text-ink">trust-bank</span>
          <span className="text-ink-soft text-sm ml-2">Staff console</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {me && (
            <span className="text-ink-soft">
              {me.email} · <span className="font-mono">{me.role}</span>
              {me.branchId && <span className="text-xs"> · branch {me.branchId.slice(0, 8)}</span>}
            </span>
          )}
          <button
            onClick={() => logoutMutation.mutate()}
            className="text-brass hover:text-brass-strong text-sm font-medium"
          >
            Log out
          </button>
        </div>
      </header>
      <div className="flex flex-1">
        <nav className="w-52 border-r border-line bg-paper-raised px-3 py-4 space-y-1">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `block px-3 py-2 rounded text-sm ${isActive ? 'bg-brass/15 text-brass-strong font-medium' : 'text-ink-soft hover:bg-paper hover:text-ink'}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
