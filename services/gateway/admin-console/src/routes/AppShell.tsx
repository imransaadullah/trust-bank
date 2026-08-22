import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

const NAV_LINKS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/api-keys', label: 'API keys' },
  { to: '/usage', label: 'Usage' },
  { to: '/sandbox', label: 'Sandbox' },
  { to: '/compliance-policies', label: 'Compliance policies' },
  { to: '/merchants', label: 'Merchants' },
];

export function AppShell() {
  const { tenant, logout } = useSession();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-paper-raised px-6 py-3 flex items-center justify-between">
        <div>
          <span className="font-semibold text-ink">trust-bank</span>
          <span className="text-ink-soft text-sm ml-2">Tenant dashboard</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {tenant && <span className="text-ink-soft">{tenant.name}</span>}
          {/* A gws_live_ staff session has a real server-side row
              SessionContext.logout revokes before clearing local state;
              a gw_live_ API key has nothing session-shaped to revoke, so
              the same call is a harmless no-op for that login mode. */}
          <button onClick={logout} className="text-brass hover:text-brass-strong text-sm font-medium">
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
