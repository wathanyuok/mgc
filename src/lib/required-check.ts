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

/**
 * เปิดสิ่งที่ซ่อนช่องนี้อยู่ ให้ผู้ใช้เห็นช่องที่ยังไม่ได้กรอก
 *
 * เดิมตัวตรวจ "ข้าม" ช่องที่มองไม่เห็น ทำให้ยุบหัวข้อลงแล้วกดบันทึก
 * ระบบจะไม่เจอช่องบังคับสักช่องแล้วปล่อยผ่าน · ช่องที่อยู่ในแท็บที่ไม่ได้เปิดก็เช่นกัน
 * ตอนนี้ตรวจทุกช่อง แล้วค่อยเปิดหัวข้อ/สลับแท็บไปให้เมื่อเจอช่องที่ยังว่าง
 */
function reveal(el: HTMLElement) {
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    // แท็บที่ยังไม่ได้เปิด — กดปุ่มแท็บนั้นให้
    const tabKey = node.dataset?.tabPanel;
    if (tabKey && node.style.display === 'none') {
      document.querySelector<HTMLElement>(`[data-tab-btn="${CSS.escape(tabKey)}"]`)?.click();
    }
    // หัวข้อที่ยุบอยู่ — กดหัวข้อให้กางออก
    if (node.dataset?.section !== undefined) {
      node.querySelector<HTMLElement>('[data-section-toggle][aria-expanded="false"]')?.click();
    }
    node = node.parentElement;
  }
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
 * ตรวจทุกช่องบังคับในหน้า รวมถึงช่องที่อยู่ในหัวข้อที่ยุบไว้หรือแท็บที่ยังไม่ได้เปิด
 * ถ้าเจอช่องว่าง ระบบจะเปิดหัวข้อและสลับแท็บไปให้เอง แล้วเลื่อนจอไปที่ช่องนั้น
 */
export function checkRequiredFields(root: ParentNode = document): boolean {
  const labels = Array.from(root.querySelectorAll<HTMLElement>('[data-required="1"]'));
  let first: HTMLElement | null = null;
  let bad = 0;

  for (const label of labels) {
    const box = label.parentElement as HTMLElement | null;
    const ctrl = controlOf(label);
    if (!box || !ctrl) continue;

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
    // เปิดหัวข้อ/สลับแท็บที่ซ่อนช่องนี้อยู่ก่อน แล้วรอให้จอวาดเสร็จจึงค่อยเลื่อนไปหา
    reveal(first);
    const box = first.parentElement?.closest('div') ?? first;
    const focusable = box.querySelector<HTMLElement>(
      'input:not([aria-hidden="true"]), textarea, select, [role="combobox"]',
    );
    setTimeout(() => {
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => (focusable ?? first)?.focus?.(), 300);
    }, 120);
    toast.error(`ยังกรอกไม่ครบ — เหลืออีก ${bad} ช่องที่จำเป็น`);
  }
  return bad === 0;
}

/** ล้างเครื่องหมายแดงทั้งหมด — ใช้ตอนออกจากหน้าหรือหลังบันทึกสำเร็จ */
export function clearRequiredMarks(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(`.${MARK}`).forEach(clearMark);
}
