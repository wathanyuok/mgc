// กล่องยืนยัน (SweetAlert) ใช้ร่วมทุกหน้า — แทน window.confirm เดิมที่หน้าตาเป็น native browser
// โหลด sweetalert2 แบบ dynamic import (ให้ตรง pattern เดิมในโปรเจกต์ · ไม่เพิ่ม bundle หน้าแรก)
import type { SweetAlertIcon } from 'sweetalert2';

/** ยืนยันการลบ — คืน true ถ้าผู้ใช้กดยืนยัน (ปุ่มแดง) */
export async function confirmDelete(opts: {
  title: string;
  html?: string;
  confirmText?: string;
  icon?: SweetAlertIcon;
}): Promise<boolean> {
  const Swal = (await import('sweetalert2')).default;
  const res = await Swal.fire({
    icon: opts.icon ?? 'warning',
    title: opts.title,
    html: opts.html,
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? 'ลบ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#6b7280',
    reverseButtons: true,
  });
  return res.isConfirmed;
}
