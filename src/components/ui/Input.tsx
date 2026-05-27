import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { InputBase, NativeSelect } from '@mui/material';
import { useReadOnly } from '@/lib/readonly';

const inputSx = {
  fontSize: 14,
  width: '100%',
  '& .MuiInputBase-input': {
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: 1,
    px: 1.5, py: 1,
    bgcolor: 'background.paper',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    '&:focus': { borderColor: 'primary.main', boxShadow: '0 0 0 2px rgba(10,93,194,0.15)' },
    '&:disabled': { bgcolor: 'grey.50', color: 'text.secondary', cursor: 'not-allowed' },
    // Read-only / auto-computed fields look the same as disabled (grey background, muted text)
    // so users can tell they should not type into them.
    '&[readonly]': { bgcolor: 'grey.50', color: 'text.secondary', cursor: 'not-allowed' },
  },
};

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}
export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, disabled, ...props }, ref) => {
  const ro = useReadOnly();
  return <InputBase inputRef={ref} className={className} disabled={disabled || ro} sx={inputSx} inputProps={props as any} />;
});
Input.displayName = 'Input';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, children, disabled, ...props }, ref) => {
  const ro = useReadOnly();
  return (
    <NativeSelect
      inputRef={ref}
      disableUnderline
      disabled={disabled || ro}
      className={className}
      sx={inputSx}
      inputProps={props as any}
    >
      {children}
    </NativeSelect>
  );
});
Select.displayName = 'Select';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, disabled, ...props }, ref) => {
  const ro = useReadOnly();
  return (
    <InputBase
      inputRef={ref}
      multiline
      minRows={3}
      className={className}
      disabled={disabled || ro}
      sx={inputSx}
      inputProps={props as any}
    />
  );
});
Textarea.displayName = 'Textarea';
