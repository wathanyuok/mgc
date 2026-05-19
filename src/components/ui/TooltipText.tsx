import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TOOLTIPS } from '@/lib/tooltips';

/**
 * Tooltip-aware inline text. Renders the (?) trigger inline,
 * and floats the popup via portal + position:fixed so it never
 * gets clipped by parent overflow/z-index.
 */
export function TooltipText({
  children,
  tipKey,
  tip,
}: {
  children: React.ReactNode;
  tipKey?: string;
  tip?: string;
}) {
  const text = typeof children === 'string' ? children : '';
  const key = (tipKey ?? text).trim();
  const resolved =
    tip ??
    TOOLTIPS[key] ??
    TOOLTIPS[key.toUpperCase()] ??
    TOOLTIPS[key.replace(/\s*\(.*\)\s*$/, '').toUpperCase()];

  if (!resolved) return <>{children}</>;

  return (
    <HoverTooltip text={resolved}>
      <span className="inline-flex items-center gap-1 relative">
        <span>{children}</span>
        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200 text-[9px] text-gray-600 cursor-help">
          ?
        </span>
      </span>
    </HoverTooltip>
  );
}

/**
 * Portal-based tooltip that follows the trigger using fixed positioning.
 * Auto-flips horizontally / vertically to stay inside the viewport.
 */
export function HoverTooltip({
  text,
  children,
}: {
  text: string;
  children: React.ReactElement;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placeAbove: boolean }>({
    top: 0,
    left: 0,
    placeAbove: false,
  });

  useEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const TOOLTIP_MAX_W = 320;
    const TOOLTIP_PADDING = 12;

    // Prefer below; flip above if not enough room
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < 80 && rect.top > 120;
    const top = placeAbove ? rect.top - 8 : rect.bottom + 8;

    // Center horizontally but clamp to viewport
    let left = rect.left + rect.width / 2;
    const halfW = TOOLTIP_MAX_W / 2;
    if (left - halfW < TOOLTIP_PADDING) left = halfW + TOOLTIP_PADDING;
    if (left + halfW > window.innerWidth - TOOLTIP_PADDING)
      left = window.innerWidth - halfW - TOOLTIP_PADDING;

    setPos({ top, left, placeAbove });
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[9999] bg-gray-900 text-white text-xs leading-relaxed px-3 py-2 rounded shadow-lg whitespace-normal"
            style={{
              top: pos.top,
              left: pos.left,
              transform: `translate(-50%, ${pos.placeAbove ? '-100%' : '0'})`,
              maxWidth: '320px',
              width: 'max-content',
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
