import { forwardRef, type ButtonHTMLAttributes } from 'react';
import MuiButton from '@mui/material/Button';
import type { ButtonProps as MuiButtonProps } from '@mui/material/Button';

type Variant = 'primary' | 'default' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variant?: Variant;
  size?: Size;
}

const variantMap: Record<Variant, { variant: MuiButtonProps['variant']; color?: MuiButtonProps['color']; sx?: any }> = {
  primary: { variant: 'contained', color: 'primary' },
  default: { variant: 'outlined', color: 'inherit', sx: { color: 'text.primary', borderColor: 'divider', bgcolor: 'background.paper', '&:hover': { bgcolor: 'grey.50' } } },
  ghost: { variant: 'text', color: 'inherit', sx: { color: 'text.primary', '&:hover': { bgcolor: 'grey.100' } } },
  danger: { variant: 'contained', color: 'error' },
  outline: { variant: 'outlined', color: 'primary' },
};

const sizeMap: Record<Size, MuiButtonProps['size']> = { sm: 'small', md: 'small', lg: 'medium' };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', className, children, ...props }, ref) => {
    const v = variantMap[variant];
    return (
      <MuiButton
        ref={ref}
        variant={v.variant}
        color={v.color}
        size={sizeMap[size]}
        sx={v.sx}
        className={className}
        {...(props as any)}
      >
        {children}
      </MuiButton>
    );
  },
);
Button.displayName = 'Button';
