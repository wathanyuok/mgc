import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-white border border-brand hover:bg-brand-dark',
        default: 'bg-white text-ink border border-line hover:bg-gray-50',
        ghost: 'bg-transparent text-ink hover:bg-gray-100',
        danger: 'bg-danger text-white border border-danger hover:bg-red-600',
        outline: 'bg-transparent text-brand border border-brand hover:bg-brand-light',
      },
      size: {
        sm: 'px-2.5 py-1 text-xs',
        md: 'px-3 py-2 text-sm',
        lg: 'px-4 py-2.5 text-base',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
