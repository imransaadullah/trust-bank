// Status vocabulary for this dashboard's own domain — key status/tier,
// tenant status, sandbox provisioning — distinct from the staff
// console's Badge, which speaks the maker-checker approvals vocabulary.
const STATUS_CLASSES: Record<string, string> = {
  active: 'bg-good/15 text-good',
  provisioned: 'bg-good/15 text-good',
  revoked: 'bg-blocked/15 text-blocked',
  suspended: 'bg-blocked/15 text-blocked',
  offboarding: 'bg-pending/15 text-pending',
  admin: 'bg-brass/15 text-brass-strong',
  production: 'bg-brass/15 text-brass-strong',
  sandbox: 'bg-pending/15 text-pending',
};

export function Badge({ status }: { status: string }) {
  const key = status.toLowerCase();
  const classes = STATUS_CLASSES[key] ?? 'bg-ink-soft/15 text-ink-soft';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-mono uppercase tracking-wide ${classes}`}>
      {status}
    </span>
  );
}
