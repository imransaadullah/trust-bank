import { type ReactNode } from 'react';

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto border border-line rounded">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children?: ReactNode }) {
  return <th className="text-left px-3 py-2 font-mono text-xs uppercase tracking-wide text-brass border-b border-line">{children}</th>;
}

export function Td({ children }: { children?: ReactNode }) {
  return <td className="px-3 py-2 border-b border-line text-ink">{children}</td>;
}
