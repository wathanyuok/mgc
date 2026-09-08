import { useEffect, useRef, useState } from 'react';
import { Input } from './Input';

/**
 * Number input field with UX improvements:
 * - Auto-selects content on focus (user can type to overwrite immediately)
 * - Displays with thousand separators when blurred ("10,000")
 * - Allows free typing while focused (handles partial '-', '.', etc.)
 * - Supports negative numbers via `allowNegative` prop
 * - Always emits parsed number to parent via onChange
 */
export function NumInput({
  value,
  onChange,
  className,
  allowNegative = false,
  placeholder,
  step,
  readOnly,
  decimals,
  integer = false,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  allowNegative?: boolean;
  placeholder?: string;
  step?: string;
  readOnly?: boolean;
  /** บังคับจำนวนทศนิยมตอนแสดงผล — ช่องยอดเงินควรใส่ 2 ให้ตรงกับตัวเลขอื่นบนจอ */
  decimals?: number;
  /** จำนวนเต็มเท่านั้น — บล็อกจุดทศนิยม + ตัดเศษ (เช่น จำนวนวัน/จำนวนครั้ง) */
  integer?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  // Raw string while user types (allows '-', '.', partial state)
  const [raw, setRaw] = useState<string>(String(value ?? 0));

  // Sync external changes when NOT focused (avoid clobbering during typing)
  useEffect(() => {
    if (!focused) setRaw(String(value ?? 0));
  }, [value, focused]);

  const pattern = integer
    ? (allowNegative ? /^-?\d*$/ : /^\d*$/)
    : (allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/);

  // Display formatted value when blurred, raw value when focused
  const shown = integer ? Math.trunc(value ?? 0) : value;
  const displayValue = focused
    ? raw
    : shown == null || shown === 0
      ? '0'
      : new Intl.NumberFormat('en-US', {
          minimumFractionDigits: integer ? 0 : (decimals ?? 0),
          maximumFractionDigits: integer ? 0 : (decimals ?? 2),
        }).format(shown);

  return (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      value={displayValue}
      placeholder={placeholder}
      readOnly={readOnly}
      onFocus={(e) => {
        setFocused(true);
        setRaw(String(value ?? 0));
        // auto-select after state update
        setTimeout(() => e.target.select(), 0);
      }}
      onBlur={() => {
        setFocused(false);
        const n = parseFloat(raw);
        if (isNaN(n)) {
          onChange(0);
        } else {
          onChange(integer ? Math.trunc(n) : n);
        }
      }}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '' || pattern.test(v)) {
          setRaw(v);
          const n = parseFloat(v);
          if (!isNaN(n)) onChange(integer ? Math.trunc(n) : n);
        }
      }}
      className={`text-right tabular-nums ${className ?? ''}`}
      step={step ?? (integer ? '1' : undefined)}
    />
  );
}
