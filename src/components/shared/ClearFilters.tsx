import { Button } from '@mui/material';
import { X } from 'lucide-react';
import type { ListFilter } from '@/stores/useFiltersStore';

/**
 * ปุ่มล้างตัวกรองของหน้ารายการ
 *
 * ตัวกรองถูกจำไว้ข้ามเมนูและข้ามการปิดเบราว์เซอร์ (เก็บลงเครื่องผู้ใช้)
 * ซึ่งสะดวกตอนสลับไปดูเมนูอื่นแล้วกลับมา แต่ก็ทำให้เปิดหน้ามาแล้วเห็นข้อมูลไม่ครบ
 * โดยไม่รู้ว่าเพราะยังมีตัวกรองค้างอยู่จากครั้งก่อน
 *
 * ปุ่มอยู่ตรงเดิมเสมอ ไม่โผล่ๆ หายๆ — ผู้ใช้จะได้จำตำแหน่งได้
 * ตอนไม่มีอะไรให้ล้าง ปุ่มจะจางและกดไม่ได้ แทนที่จะหายไปทั้งปุ่มแล้วช่องอื่นขยับตาม
 */
export function ClearFilters({ filter, onClear }: { filter: ListFilter; onClear: () => void }) {
  const active = Object.values(filter).filter((v) => String(v ?? '').trim() !== '').length;

  return (
    <Button
      size="small"
      variant="outlined"
      color="inherit"
      disabled={active === 0}
      startIcon={<X size={14} />}
      onClick={onClear}
      title={active === 0 ? 'ยังไม่ได้ตั้งตัวกรอง' : `ล้างตัวกรอง ${active} ช่อง`}
      sx={{ alignSelf: 'center', whiteSpace: 'nowrap', height: 40, px: 1.75, color: 'text.secondary' }}
    >
      ล้างตัวกรอง{active > 0 ? ` (${active})` : ''}
    </Button>
  );
}
