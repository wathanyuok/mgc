// Helpers for adding tooltip ? indicators to table headers and key/value rows.
// Auto-resolves text → TOOLTIPS dict (case-insensitive, strips trailing "(...)").
import { type ReactNode } from 'react';
import { TOOLTIPS } from '@/lib/tooltips';
import { HoverTooltip } from '@/components/ui/TooltipText';
import { cn } from '@/lib/cn';

function resolveTip(label: string, tipKey?: string, tip?: string): string | undefined {
  if (tip) return tip;
  const key = (tipKey ?? label).trim();
  return (
    TOOLTIPS[key] ??
    TOOLTIPS[key.toUpperCase()] ??
    TOOLTIPS[key.replace(/\s*\(.*\)\s*$/, '').toUpperCase()]
  );
}

function TipMark() {
  return (
    <span className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200 text-[9px] text-gray-600 cursor-help hover:bg-brand hover:text-white transition align-middle">
      ?
    </span>
  );
}

/**
 * Table header cell with optional tooltip. Drop-in replacement for <th>.
 * Resolves tooltip from TOOLTIPS dict by label (or tipKey override).
 */
export function ThTip({
  children,
  tipKey,
  tip,
  className,
  align = 'left',
  ...rest
}: {
  children: ReactNode;
  tipKey?: string;
  tip?: string;
  className?: string;
  align?: 'left' | 'right' | 'center';
} & React.ThHTMLAttributes<HTMLTableCellElement>) {
  const label = typeof children === 'string' ? children : '';
  const resolved = resolveTip(label, tipKey, tip);
  // Use ! prefix to override the .table-base thead th { text-align: left } base rule
  const alignClass = align === 'right' ? '!text-right' : align === 'center' ? '!text-center' : '';

  const inner = (
    <span className="inline-flex items-center">
      <span>{children}</span>
      {resolved && <TipMark />}
    </span>
  );

  return (
    <th className={cn(alignClass, className)} {...rest}>
      {resolved ? <HoverTooltip text={resolved}>{inner}</HoverTooltip> : inner}
    </th>
  );
}

/**
 * Key/value row with tooltip on the label.
 * Used for Balance Summary, side cards, etc.
 */
export function RowTip({
  label,
  value,
  tipKey,
  tip,
  bold,
  className,
}: {
  label: string;
  value: ReactNode;
  tipKey?: string;
  tip?: string;
  bold?: boolean;
  className?: string;
}) {
  const resolved = resolveTip(label, tipKey, tip);
  const labelNode = (
    <span className="inline-flex items-center text-muted text-sm">
      <span>{label}</span>
      {resolved && <TipMark />}
    </span>
  );
  return (
    <div className={cn('flex items-center justify-between py-1.5 border-b border-line', className)}>
      {resolved ? <HoverTooltip text={resolved}>{labelNode}</HoverTooltip> : labelNode}
      <span className={cn('tabular-nums', bold && 'font-semibold')}>{value}</span>
    </div>
  );
}

/**
 * Inline tooltip-aware label fragment (no wrapper).
 * Use inside other elements where a separate row/cell is not desired.
 */
export function TipLabel({
  children,
  tipKey,
  tip,
  className,
}: {
  children: ReactNode;
  tipKey?: string;
  tip?: string;
  className?: string;
}) {
  const label = typeof children === 'string' ? children : '';
  const resolved = resolveTip(label, tipKey, tip);
  const inner = (
    <span className={cn('inline-flex items-center', className)}>
      <span>{children}</span>
      {resolved && <TipMark />}
    </span>
  );
  return resolved ? <HoverTooltip text={resolved}>{inner}</HoverTooltip> : inner;
}
