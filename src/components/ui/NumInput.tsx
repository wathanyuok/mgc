import { useEffect, useRef, useState } from 'react';
import { Input } from './Input';

/**
 * Number input field with UX improvements:
 *  - Auto-selects content on focus (user can type to overwrite immediately)
 *  - Displays with thousand separators when blurred ("10,000")
 *  - Allows free typing while focused (handles partial '-', '.', etc.)
 *  - Supports negative numbers via `allowNegative` prop
 *  - Always emits parsed number to parent via onChange
 */
export function NumInput({
  value,
  onChange,
  className,
  allowNegative = false,
  placeholder,
  step,
  readOnly,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  allowNegative?: boolean;
  placeholder?: string;
  step?: string;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  // Raw string while user types (allows '-', '.', partial state)
  const [raw, setRaw] = useState<string>(String(value ?? 0));

  // Sync external changes when NOT focused (avoid clobbering during typing)
  useEffect(() => {
    if (!focused) setRaw(String(value ?? 0));
  }, [value, focused]);

  const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  // Display formatted value when blurred, raw value when focused
  const displayValue = focused
    ? raw
    : value == null || value === 0
      ? '0'
      : new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);

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
          onChange(n);
        }
      }}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '' || pattern.test(v)) {
          setRaw(v);
          const n = parseFloat(v);
          if (!isNaN(n)) onChange(n);
        }
      }}
      className={`text-right tabular-nums ${className ?? ''}`}
      step={step}
    />
  );
}
