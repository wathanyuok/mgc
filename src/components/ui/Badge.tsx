import type { HTMLAttributes } from 'react';
import { Chip } from '@mui/material';

type Variant = 'default' | 'brand' | 'success' | 'warn' | 'danger';

interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  variant?: Variant;
}

const colorMap: Record<Variant, { color: any; sx?: any }> = {
  default: { color: 'default' },
  brand: { color: 'primary' },
  success: { color: 'success' },
  warn: { color: 'warning' },
  danger: { color: 'error' },
};

export function Badge({ className, variant = 'default', children, style, ...rest }: BadgeProps) {
  const c = colorMap[variant];
  return (
    <Chip
      size="small"
      label={children as any}
      color={c.color}
      className={className}
      style={style}
      sx={{ height: 20, fontSize: 11, fontWeight: 500, ...c.sx }}
      {...(rest as any)}
    />
  );
}
