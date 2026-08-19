import { TOOLTIPS } from '@/lib/tooltips';
import { cn } from '@/lib/cn';
import { HoverTooltip } from './TooltipText';

interface Props {
  children: React.ReactNode;
  tipKey?: string;
  tip?: string;
  required?: boolean;
  className?: string;
}

/**
 * Field label with optional "?" hover-tooltip rendered via portal
 * (so it can't be clipped by parent overflow).
 */
export function FieldLabel({ children, tipKey, tip, required, className }: Props) {
  const text = typeof children === 'string' ? children : '';
  const key = (tipKey ?? text).replace(/\s*\*+\s*$/, '').trim();
  const resolved =
    tip ?? TOOLTIPS[key] ?? TOOLTIPS[key.toUpperCase()] ?? TOOLTIPS[key.replace(/\s*\(.*\)\s*$/, '').toUpperCase()];

  return (
    // data-required — ให้ตัวตรวจตอนกด Save รู้ว่าช่องนี้จำเป็นต้องกรอก (ดู lib/required-check.ts)
    <div className={cn('field-label flex items-center gap-1', className)} data-required={required ? '1' : undefined}>
      <span className="tracking-wide">{children}</span>
      {required && (
        <span
          title="จำเป็นต้องกรอก"
          className="ml-0.5 mb-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/90 ring-2 ring-red-100"
        />
      )}
      {resolved && (
        <HoverTooltip text={resolved}>
          <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-[10px] text-gray-600 cursor-help hover:bg-brand hover:text-white transition">
            ?
          </span>
        </HoverTooltip>
      )}
    </div>
  );
}
