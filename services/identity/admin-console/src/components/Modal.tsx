import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode } from 'react';

export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-paper rounded-lg shadow-lg p-6 w-full max-w-md border border-line">
          <Dialog.Title className="text-lg font-semibold text-ink mb-4">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
