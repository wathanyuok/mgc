import {
  forwardRef, useRef, useState, useEffect, Children, isValidElement,
  type ChangeEvent,
  type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { InputBase, ListSubheader, MenuItem, Select as MuiSelect } from '@mui/material';
import { useReadOnly } from '@/lib/readonly';
import { cn } from '@/lib/cn';
import { CharCount } from './CharCount';

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

// ความยาวสูงสุดตั้งต้นของช่องข้อความ — หน้าจอกำหนดเองทับได้
// เดิมไม่จำกัดเลย วางข้อความยาวเท่าไรก็ได้ · ฐานข้อมูลบวม รายงานเพี้ยน
// และตอนส่งเข้าระบบบัญชีปลายทางอาจถูกปฏิเสธเพราะเกินความยาวที่ปลายทางรับ
const MAX_TEXT = 200;
const MAX_LONG_TEXT = 2000;

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, disabled, ...props }, ref) => {
  const ro = useReadOnly();
  if (props.type === 'date') {
    return <DateInput className={className} disabled={disabled} inputRef={ref} {...props} />;
  }
  // ช่องตัวเลขไม่ต้องจำกัดตัวอักษร — คุมด้วย min/max แทน
  const limited = props.type === 'number' || props.maxLength !== undefined
    ? props
    : { ...props, maxLength: MAX_TEXT };
  return <InputBase inputRef={ref} className={className} disabled={disabled || ro} sx={inputSx} inputProps={limited as any} />;
});
Input.displayName = 'Input';

/**
 * ช่องวันที่ — บังคับแสดงเป็น วัน/เดือน/ปี (DD/MM/YYYY) ทุกเครื่อง
 *
 * `<input type="date">` ของเบราว์เซอร์แสดงผลตาม locale ของเครื่อง (บางเครื่อง MM/DD/YYYY
 * บางเครื่อง DD/MM/YYYY) ซึ่งบังคับไม่ได้ · จึงซ่อนข้อความ native ไว้เสมอ แล้ว overlay
 * สตริง DD/MM/YYYY ที่เราจัดรูปเองทับ — ค่าในระบบยังเป็น ISO (YYYY-MM-DD) เหมือนเดิม
 * เผย native เฉพาะตอนผู้ใช้กำลังพิมพ์ เพื่อให้เห็นเลขที่พิมพ์ · คลิกที่ช่อง = เปิดปฏิทิน
 */
function isoToThai(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function DateInput({
  className, disabled, inputRef, ...props
}: InputProps & { inputRef?: React.Ref<HTMLInputElement> }) {
  const ro = useReadOnly();
  const innerRef = useRef<HTMLInputElement | null>(null);
  // typing = ผู้ใช้เริ่มพิมพ์เอง → เผยช่องย่อยของเบราว์เซอร์เพื่อให้เห็นเลขที่พิมพ์
  const [typing, setTyping] = useState(false);
  // ISO ปัจจุบันของช่อง — controlled อ่านจาก props.value · uncontrolled (react-hook-form)
  // อ่านจากตัวช่องเอง เพราะ register ไม่ส่ง props.value มา
  const [iso, setIso] = useState<string>(
    props.value != null && props.value !== '' ? String(props.value) : '',
  );
  // controlled: sync ตาม props.value
  useEffect(() => {
    if (props.value !== undefined) setIso(props.value == null ? '' : String(props.value));
  }, [props.value]);
  // uncontrolled (react-hook-form reset แบบ async): sync จากค่าจริงในช่อง
  useEffect(() => {
    if (props.value === undefined && innerRef.current && innerRef.current.value !== iso) {
      setIso(innerRef.current.value);
    }
  });
  const locked = disabled || ro || props.readOnly;
  const showOverlay = !typing;             // ไม่ได้พิมพ์ → แสดงรูปแบบ DD/MM/YYYY ของเราทับ native
  const thai = isoToThai(iso);

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
          // ซ่อนข้อความ native (รูปแบบตาม locale) ไว้เสมอตอนไม่ได้พิมพ์ แล้ว overlay DD/MM/YYYY ทับ
          className: showOverlay ? 'date-hide-native' : undefined,
          onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => {
            props.onMouseDown?.(e);
            openPicker();
          },
          // เริ่มพิมพ์ตัวเลข/กดลูกศร → เผยช่องย่อยให้เห็นสิ่งที่พิมพ์
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (/^[0-9]$/.test(e.key) || e.key.startsWith('Arrow')) setTyping(true);
            props.onKeyDown?.(e);
          },
          // เลือกวันจากปฏิทิน หรือพิมพ์ → อัปเดต ISO (overlay เปลี่ยนตาม)
          onChange: (e: ChangeEvent<HTMLInputElement>) => {
            setIso(e.target.value);
            props.onChange?.(e as any);
          },
          onBlur: (e: React.FocusEvent<HTMLInputElement>) => { setTyping(false); props.onBlur?.(e); },
        } as any}
      />
      {showOverlay && (
        <span
          className={cn(
            'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm',
            thai ? 'text-gray-900' : 'text-gray-400',
          )}
        >
          {thai || 'วัน/เดือน/ปี'}
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

  // หน้าที่ผูกช่องด้วยตัวจัดการฟอร์ม (react-hook-form) จะส่งมาแค่ name / onChange / ref
  // ไม่มี value มาด้วย — ถ้าดันไปใช้ Select ของ MUI ค่าที่แสดงจะไม่ตรงกับค่าในฟอร์ม
  // และตัวจัดการฟอร์มจะพยายามตั้งค่าซ้ำไปเรื่อยๆ จนหน้าจอค้างเป็นหน้าขาว
  // กรณีนี้จึงใช้ช่องเลือกพื้นฐานของเบราว์เซอร์ที่จัดสไตล์ให้เหมือนกัน
  if (props.value === undefined && props.defaultValue === undefined) {
    return (
      <select
        ref={ref}
        disabled={disabled || ro}
        {...props}
        className={cn(
          'w-full rounded border border-line bg-white px-2.5 py-2 text-sm outline-none transition',
          'focus:border-brand focus:ring-2 focus:ring-brand/15',
          'disabled:bg-gray-50 disabled:text-muted disabled:cursor-not-allowed',
          className,
        )}
      >
        {children}
      </select>
    );
  }

  // แปลง <option> ที่หน้าจอส่งมาเป็นรายการของ MUI — หน้าที่เรียกใช้ไม่ต้องแก้อะไร
  // รองรับ <optgroup> ด้วย — เดิมข้ามทิ้งทั้งก้อน ทำให้ช่องเลือกที่จัดกลุ่มไว้กลายเป็นว่างเปล่า
  // ตัวเลือกในกลุ่มจะถูกดึงออกมา แล้วแทรกหัวข้อกลุ่มคั่นไว้ข้างบน
  const toItem = (child: any) => {
    const cp: any = child.props;
    const label = cp.children;
    const value = cp.value !== undefined ? cp.value : (typeof label === 'string' ? label : '');
    return (
      <MenuItem key={String(value)} value={value} disabled={cp.disabled}>
        {label === '' ? ' ' : label}
      </MenuItem>
    );
  };

  const items = Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    if (child.type === 'option') return [toItem(child)];
    if (child.type === 'optgroup') {
      const gp: any = child.props;
      const opts = Children.toArray(gp.children)
        .filter((c) => isValidElement(c) && c.type === 'option')
        .map(toItem);
      if (opts.length === 0) return [];
      return [
        <ListSubheader
          key={`group-${gp.label}`}
          sx={{ lineHeight: '30px', fontSize: 12, fontWeight: 700, color: 'primary.main', bgcolor: 'grey.50' }}
        >
          {gp.label}
        </ListSubheader>,
        ...opts,
      ];
    }
    return [];
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
  const max = props.maxLength ?? MAX_LONG_TEXT;
  // ช่องที่คุมค่าจากภายนอกอ่านความยาวจาก value ได้เลย
  // ส่วนช่องที่ไม่ได้คุมค่า (เช่น react-hook-form) ต้องนับเองตอนพิมพ์
  const [typed, setTyped] = useState('');
  const current = props.value !== undefined ? String(props.value ?? '') : typed;
  return (
    <>
      <InputBase
        inputRef={ref}
        multiline
        minRows={3}
        className={className}
        disabled={disabled || ro}
        sx={inputSx}
        inputProps={{
          ...props,
          maxLength: max,
          onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
            if (props.value === undefined) setTyped(e.target.value);
            props.onChange?.(e);
          },
        } as any}
      />
      <CharCount value={current} max={max} />
    </>
  );
});
Textarea.displayName = 'Textarea';
