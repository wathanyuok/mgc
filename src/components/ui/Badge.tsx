import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const colors: Record<string, string> = {
  default: 'bg-gray-100 text-gray-700',
  brand: 'bg-brand-light text-brand',
  success: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof colors;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return <span className={cn('badge', colors[variant], className)} {...props} />;
}
