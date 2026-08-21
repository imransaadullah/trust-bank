import { type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-brass text-paper hover:bg-brass-strong',
  secondary: 'bg-paper-raised text-ink border border-line hover:border-brass',
  danger: 'bg-blocked text-paper hover:opacity-90',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
