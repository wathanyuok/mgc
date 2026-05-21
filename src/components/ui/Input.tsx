import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useReadOnly } from '@/lib/readonly';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, disabled, ...props }, ref) => {
  const ro = useReadOnly();
  return <input ref={ref} className={cn('input', className)} disabled={disabled || ro} {...props} />;
});
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, children, disabled, ...props }, ref) => {
  const ro = useReadOnly();
  return (
    <select ref={ref} className={cn('select', className)} disabled={disabled || ro} {...props}>
      {children}
    </select>
  );
});
Select.displayName = 'Select';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, disabled, ...props }, ref) => {
  const ro = useReadOnly();
  return <textarea ref={ref} className={cn('input min-h-[80px]', className)} disabled={disabled || ro} {...props} />;
});
Textarea.displayName = 'Textarea';
