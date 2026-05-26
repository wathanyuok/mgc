import { type HTMLAttributes } from 'react';
import { Card as MuiCard, CardContent as MuiCardContent } from '@mui/material';

export function Card({ className, style, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <MuiCard className={className} style={style} {...(rest as any)}>
      {children}
    </MuiCard>
  );
}

export function CardHeader({ className, style, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={className}
      style={{ padding: '12px 20px', borderBottom: '1px solid #d1d5db', ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, style, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={className}
      style={{ fontSize: '1rem', fontWeight: 600, color: '#1c1c1c', margin: 0, ...style }}
      {...rest}
    >
      {children}
    </h3>
  );
}

export function CardContent({ className, style, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <MuiCardContent className={className} style={style} {...(rest as any)}>
      {children}
    </MuiCardContent>
  );
}
