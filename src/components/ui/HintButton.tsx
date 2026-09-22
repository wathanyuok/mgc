import { HoverTooltip } from './TooltipText';
import { Button, type ButtonProps } from './Button';

export interface HintButtonProps extends ButtonProps {
  /** ข้อความ tooltip — เด้งได้แม้ปุ่มถูก disabled (ต่างจาก native title ที่ไม่เด้งบนปุ่ม disabled) */
  hint?: string;
}

/**
 * ปุ่มที่ tooltip เด้งได้แม้อยู่สถานะ disabled
 *
 * ปัญหา native: ปุ่ม `disabled` ในเบราว์เซอร์ไม่รับ event เมาส์ → `title` ไม่เด้ง
 * วิธีแก้ (ทำครั้งเดียวในตัวนี้ ใช้ซ้ำทุกที่):
 *   1) ใส่ `disabled:pointer-events-none` ให้ปุ่มปล่อย event ทะลุตอน disable
 *   2) ห่อด้วย HoverTooltip (portal) ที่จับ hover ที่ span รอบนอกแทน
 *
 * ไม่ส่ง hint มา → ทำงานเป็นปุ่มปกติ
 */
export function HintButton({ hint, className, ...props }: HintButtonProps) {
  const cls = ['disabled:pointer-events-none', className].filter(Boolean).join(' ');
  const btn = <Button {...props} className={cls} />;
  return hint ? <HoverTooltip text={hint}>{btn}</HoverTooltip> : btn;
}
