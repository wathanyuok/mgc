// ตรวจช่องที่จำเป็นต้องกรอกตอนกด Save
// ------------------------------------------------------------------
// ทำงานจากป้ายชื่อช่อง — FieldLabel ที่ตั้ง required จะติด data-required="1" ไว้
// ตัวตรวจจะไล่หาป้ายเหล่านั้น แล้วดูช่องกรอกที่อยู่ในกล่องเดียวกันว่าว่างหรือไม่
//
// ทำแบบนี้เพราะแต่ละหน้ามีรูปแบบช่องกรอกต่างกัน (Input / Select / NumInput / วันที่)
// รวมกันกว่า 160 จุด การไล่ผูกทีละช่องจะพลาดง่ายและดูแลยาก
//
// ช่องที่ว่าง → กรอบแดง + ข้อความ "จำเป็นต้องกรอก" ใต้ช่อง
// พอผู้ใช้เริ่มกรอก เครื่องหมายแดงจะหายเอง

import { toast } from 'sonner';

const MARK = 'field-invalid';

/** ช่องกรอกที่อยู่ในกล่องเดียวกับป้ายชื่อ */
function controlOf(label: Element): HTMLElement | null {
  const box = label.parentElement;
  if (!box) return null;
  return box.querySelector<HTMLElement>('input, textarea, select');
}

/** ถือว่าว่างเมื่อไม่มีค่า — เลข 0 ไม่ถือว่าว่าง เพราะบางช่องใส่ 0 ได้จริง */
function isEmpty(el: HTMLElement): boolean {
  const v = (el as HTMLInputElement).value;
  if (v == null) return true;
  const s = String(v).trim();
  if (s === '') return true;
  // ตัวเลือกที่ยังไม่ได้เลือก เช่น "— เลือก —"
  if (s === '—' || s === '-') return true;
  return false;
}

/** ช่องที่ถูกซ่อน (อยู่คนละแท็บ / ยุบอยู่) ไม่ต้องตรวจ */
function isVisible(el: HTMLElement): boolean {
  return !!(el.offsetParent || el.getClientRects().length);
}

function clearMark(box: HTMLElement) {
  box.classList.remove(MARK);
  box.querySelector('.field-invalid-msg')?.remove();
}

function addMark(box: HTMLElement) {
  if (box.classList.contains(MARK)) return;
  box.classList.add(MARK);
  const msg = document.createElement('p');
  msg.className = 'field-invalid-msg';
  msg.textContent = 'จำเป็นต้องกรอก';
  box.appendChild(msg);
}

/**
 * ตรวจทุกช่องที่จำเป็นในหน้าจอปัจจุบัน
 * คืนค่า true = กรอกครบ · false = ยังมีช่องว่าง (และได้ทำเครื่องหมายแดงไว้แล้ว)
 *
 * หมายเหตุ: ตรวจเฉพาะช่องที่แสดงอยู่บนจอ ช่องในแท็บอื่นที่ยังไม่ได้เปิดจะไม่ถูกตรวจ
 */
export function checkRequiredFields(root: ParentNode = document): boolean {
  const labels = Array.from(root.querySelectorAll<HTMLElement>('[data-required="1"]'));
  let first: HTMLElement | null = null;
  let bad = 0;

  for (const label of labels) {
    const box = label.parentElement as HTMLElement | null;
    const ctrl = controlOf(label);
    if (!box || !ctrl) continue;
    if (!isVisible(ctrl)) { clearMark(box); continue; }

    if (isEmpty(ctrl)) {
      addMark(box);
      bad++;
      if (!first) first = ctrl;
      // กรอกแล้วให้เครื่องหมายแดงหายเอง
      const off = () => { clearMark(box); ctrl.removeEventListener('input', off); ctrl.removeEventListener('change', off); };
      ctrl.addEventListener('input', off);
      ctrl.addEventListener('change', off);
    } else {
      clearMark(box);
    }
  }

  if (first) {
    // ช่องแบบเลือกจากรายการ ตัวที่เก็บค่าจริงเป็นช่องซ่อน — เลื่อนจอไปที่กล่องและโฟกัสตัวที่มองเห็น
    const box = first.parentElement?.closest('div') ?? first;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = box.querySelector<HTMLElement>(
      'input:not([aria-hidden="true"]), textarea, select, [role="combobox"]',
    );
    setTimeout(() => (focusable ?? first)?.focus?.(), 300);
    toast.error(`ยังกรอกไม่ครบ — เหลืออีก ${bad} ช่องที่จำเป็น`);
  }
  return bad === 0;
}

/** ล้างเครื่องหมายแดงทั้งหมด — ใช้ตอนออกจากหน้าหรือหลังบันทึกสำเร็จ */
export function clearRequiredMarks(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(`.${MARK}`).forEach(clearMark);
}
