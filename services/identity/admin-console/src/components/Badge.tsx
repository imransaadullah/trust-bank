const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-pending/15 text-pending',
  approved: 'bg-good/15 text-good',
  executed: 'bg-good/15 text-good',
  rejected: 'bg-blocked/15 text-blocked',
  failed: 'bg-blocked/15 text-blocked',
  active: 'bg-good/15 text-good',
  closed: 'bg-ink-soft/15 text-ink-soft',
};

export function Badge({ status }: { status: string }) {
  const classes = STATUS_CLASSES[status] ?? 'bg-ink-soft/15 text-ink-soft';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-mono uppercase tracking-wide ${classes}`}>
      {status}
    </span>
  );
}
