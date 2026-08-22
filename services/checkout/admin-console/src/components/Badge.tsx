// Status vocabulary for this dashboard's own domain — checkout session
// and webhook delivery statuses — distinct from the tenant dashboard's
// Badge, which speaks the API-key/tenant vocabulary.
const STATUS_CLASSES: Record<string, string> = {
  active: 'bg-good/15 text-good',
  paid: 'bg-good/15 text-good',
  delivered: 'bg-good/15 text-good',
  pending: 'bg-pending/15 text-pending',
  processing: 'bg-pending/15 text-pending',
  expired: 'bg-blocked/15 text-blocked',
  cancelled: 'bg-blocked/15 text-blocked',
  failed: 'bg-blocked/15 text-blocked',
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
