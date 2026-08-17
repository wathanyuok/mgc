import {
  forwardRef, useRef, useState, Children, isValidElement,
  type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { InputBase, MenuItem, Select as MuiSelect } from '@mui/material';
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
  if (props.type === 'date') {
    return <DateInput className={className} disabled={disabled} inputRef={ref} {...props} />;
  }
  return <InputBase inputRef={ref} className={className} disabled={disabled || ro} sx={inputSx} inputProps={props as any} />;
});
Input.displayName = 'Input';

/**
 * ช่องวันที่ — คลิกตรงไหนก็เปิดปฏิทิน (ไม่ต้องเล็งไอคอน)
 * และตอนยังไม่เลือก แสดงคำใบ้ "วัน/เดือน/ปี" แทน dd/mm/yyyy ของเบราว์เซอร์
 */
function DateInput({
  className, disabled, inputRef, ...props
}: InputProps & { inputRef?: React.Ref<HTMLInputElement> }) {
  const ro = useReadOnly();
  const innerRef = useRef<HTMLInputElement | null>(null);
  // typing = ผู้ใช้เริ่มพิมพ์เอง → ต้องโชว์ช่องย่อยของเบราว์เซอร์เพื่อให้เห็นเลขที่พิมพ์
  const [typing, setTyping] = useState(false);
  const locked = disabled || ro || props.readOnly;
  const empty = !props.value;
  const showHint = empty && !typing;   // ยังไม่มีวัน + ยังไม่พิมพ์ → โชว์ "วัน/เดือน/ปี"

  const openPicker = () => {
    if (locked) return;
    const el = innerRef.current;
    // showPicker รองรับ Chrome/Edge · เบราว์เซอร์อื่นตกกลับไปใช้ไอคอนตามเดิม
    try { (el as any)?.showPicker?.(); } catch { /* ปฏิทินเปิดอยู่แล้ว — ไม่ต้องทำอะไร */ }
  };

  return (
    <div className="relative w-full">
      <InputBase
        className={className}
        disabled={disabled || ro}
        sx={inputSx}
        inputRef={(el: HTMLInputElement) => {
          innerRef.current = el;
          if (typeof inputRef === 'function') inputRef(el);
          else if (inputRef && typeof inputRef === 'object') (inputRef as any).current = el;
        }}
        inputProps={{
          ...props,
          // ซ่อน dd/mm/yyyy ของเบราว์เซอร์ แล้วเอาคำใบ้ไทยทับแทน
          className: showHint ? 'date-hide-native' : undefined,
          onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => {
            props.onMouseDown?.(e);
            openPicker();
          },
          // เริ่มพิมพ์ตัวเลข/กดลูกศร → เผยช่องย่อยให้เห็นสิ่งที่พิมพ์
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (/^[0-9]$/.test(e.key) || e.key.startsWith('Arrow')) setTyping(true);
            props.onKeyDown?.(e);
          },
          onBlur: (e: React.FocusEvent<HTMLInputElement>) => { setTyping(false); props.onBlur?.(e); },
        } as any}
      />
      {showHint && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
          วัน/เดือน/ปี
        </span>
      )}
    </div>
  );
}

// รายการที่เลื่อนดูได้ — ยาวแค่ไหนก็ไม่ล้นจอ (ประมาณ 8 บรรทัดแล้วเลื่อนต่อ)
const menuProps = {
  MenuListProps: { dense: true, sx: { py: 0.75 } },
  PaperProps: {
    sx: {
      maxHeight: 320,
      mt: 0.5,
      borderRadius: 2.5,
      border: '1px solid',
      borderColor: 'divider',
      boxShadow: '0 12px 32px rgba(15,23,42,0.12)',
      // แถบเลื่อนบางๆ ไม่เกะกะ
      '&::-webkit-scrollbar': { width: 8 },
      '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(15,23,42,0.18)', borderRadius: 8, border: '2px solid transparent', backgroundClip: 'content-box' },
      '&::-webkit-scrollbar-thumb:hover': { bgcolor: 'rgba(15,23,42,0.3)' },
      '& .MuiMenuItem-root': {
        fontSize: 14,
        mx: 0.75,
        my: '1px',
        px: 1.25,
        py: 0.85,
        borderRadius: 1.5,
        '&:hover': { bgcolor: 'grey.100' },
        '&.Mui-selected': { bgcolor: 'primary.light', color: 'primary.main', fontWeight: 500 },
        '&.Mui-selected:hover': { bgcolor: 'primary.light' },
      },
    },
  },
  anchorOrigin: { vertical: 'bottom' as const, horizontal: 'left' as const },
  transformOrigin: { vertical: 'top' as const, horizontal: 'left' as const },
};

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, children, disabled, ...props }, ref) => {
  const ro = useReadOnly();
  // แปลง <option> ที่หน้าจอส่งมาเป็นรายการของ MUI — หน้าที่เรียกใช้ไม่ต้องแก้อะไร
  const items = Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child) || child.type !== 'option') return [];
    const p: any = child.props;
    const label = p.children;
    const value = p.value !== undefined ? p.value : (typeof label === 'string' ? label : '');
    return [
      <MenuItem key={String(value)} value={value} disabled={p.disabled}>
        {label === '' ? ' ' : label}
      </MenuItem>,
    ];
  });

  return (
    <MuiSelect
      inputRef={ref}
      variant="standard"
      disableUnderline
      displayEmpty
      disabled={disabled || ro}
      className={className}
      value={(props.value ?? '') as any}
      onChange={props.onChange as any}
      name={props.name}
      sx={{
        ...inputSx,
        '& .MuiSelect-select': {
          ...(inputSx['& .MuiInputBase-input'] as any),
          display: 'flex',
          alignItems: 'center',
          minHeight: 'unset',
        },
        '& .MuiSelect-icon': { right: 6, color: 'text.disabled' },
      }}
      MenuProps={menuProps}
    >
      {items}
    </MuiSelect>
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
