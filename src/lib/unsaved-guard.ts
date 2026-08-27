// เตือนก่อนออกจากหน้าเมื่อยังมีข้อมูลที่แก้ไว้แล้วยังไม่บันทึก
//
// เดิมหน้าทะเบียนต่างๆ กด Cancel หรือ Back แล้วออกทันที ข้อมูลที่กรอกไว้หายเงียบๆ
// ตัวช่วยนี้เทียบค่าปัจจุบันกับค่าตอนโหลดเข้ามา ถ้าต่างกันจะถาม 1 ครั้งก่อนออก
// และกันการปิดแท็บ/รีเฟรชด้วย
import { useCallback, useEffect, useRef, useState } from 'react';

const ASK = 'ข้อมูลที่แก้ไว้ยังไม่ได้บันทึก — ออกจากหน้านี้เลยหรือไม่?';

export interface UnsavedGuard<T> {
  /** true = มีข้อมูลที่ยังไม่บันทึก */
  dirty: boolean;
  /** ตั้งค่าเริ่มต้นใหม่ (ใช้ตอนโหลดข้อมูลเดิมเข้าฟอร์ม) — ไม่นับว่าเป็นการแก้ */
  reset: (next: T, apply?: (v: T) => void) => void;
  /** เรียกหลังบันทึกสำเร็จ — ถือว่าค่าปัจจุบันคือค่าที่บันทึกแล้ว */
  markSaved: () => void;
  /** ออกจากหน้า — ถามก่อนถ้ายังมีข้อมูลที่ยังไม่บันทึก */
  leave: () => void;
}

export function useUnsavedGuard<T>(current: T, onLeave: () => void): UnsavedGuard<T> {
  const [baseline, setBaseline] = useState(() => JSON.stringify(current));
  // เก็บค่าล่าสุดไว้ให้ markSaved อ่านได้ โดยไม่ต้องผูกเป็น dependency
  const latest = useRef(current);
  latest.current = current;

  const dirty = JSON.stringify(current) !== baseline;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const reset = useCallback((next: T, apply?: (v: T) => void) => {
    apply?.(next);
    setBaseline(JSON.stringify(next));
  }, []);

  const markSaved = useCallback(() => {
    setBaseline(JSON.stringify(latest.current));
  }, []);

  const leave = useCallback(() => {
    if (JSON.stringify(latest.current) !== baseline && !window.confirm(ASK)) return;
    onLeave();
  }, [baseline, onLeave]);

  return { dirty, reset, markSaved, leave };
}
