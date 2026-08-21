// Approval Workflow — Maker ส่งขออนุมัติ · Approver อนุมัติ / ส่งกลับแก้ / ปฏิเสธ
// ใช้ร่วมทุกโมดูล: อัปเดตสถานะตรงที่ตาราง แล้วให้หน้าแม่ refresh ผ่าน onChanged
import { useState } from 'react';
import { toast } from 'sonner';
import { Send, CheckCircle2, Undo2, XCircle, MessageSquareText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

export const PENDING_STATUS = 'Pending Approval';

export function ApprovalActions({
  menuKey,
  table,
  id,
  status,
  approvedStatus = 'Approved',
  rejectStatus = 'Rejected',
  onChanged,
  disabled,
}: {
  menuKey: string;               // permission menu key เช่น 'ma', 'ca', 'pn'
  table: string;                 // ตารางที่อัปเดตสถานะ
  id: string | null | undefined; // ต้อง Save ก่อนถึงส่งขออนุมัติได้
  status: string | null | undefined;
  approvedStatus?: string;       // สถานะหลังอนุมัติ (บางโมดูลใช้ Active)
  rejectStatus?: string;         // สถานะเมื่อปฏิเสธ (บางโมดูลใช้ Cancelled)
  onChanged: (newStatus: string) => void;
  disabled?: boolean;
}) {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'return' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const isApprover = can(menuKey, 'approve');
  const isMaker = can(menuKey, 'edit');

  const setStatus = async (newStatus: string, remarkNote?: string) => {
    setBusy(true);
    try {
      const patch: Record<string, any> = { status: newStatus };
      if (remarkNote) {
        const { data } = await supabase.from(table).select('remark').eq('id', id!).maybeSingle();
        const old = (data?.remark ?? '').trim();
        patch.remark = `${old ? old + ' · ' : ''}${remarkNote}`;
      }
      const { error } = await supabase.from(table).update(patch).eq('id', id!);
      if (error) throw error;
      onChanged(newStatus);
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmModal = async () => {
    const isReturn = modal === 'return';
    const prefix = isReturn ? 'ส่งกลับแก้' : 'ปฏิเสธ';
    const ok = await setStatus(isReturn ? 'Draft' : rejectStatus, `${prefix}: ${note.trim() || '-'}`);
    if (ok) {
      toast.success(isReturn ? 'ส่งกลับเรียบร้อย — ผู้จัดทำจะได้รับรายการกลับไปแก้ไข' : 'บันทึกการปฏิเสธเรียบร้อย');
      setModal(null);
      setNote('');
    }
  };

  // ยังไม่ได้ Save → ยังไม่มีรายการในระบบให้ผู้อนุมัติเปิดดู
  // แสดงเฉพาะปุ่มส่งขออนุมัติแบบจาง พร้อมบอกว่าต้อง Save ก่อน
  if (!id) {
    if (!isMaker) return null;
    return (
      <div className="flex items-center gap-2">
        <button type="button" disabled
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs
                     font-medium text-white opacity-40 cursor-not-allowed">
          <Send size={13} /> ส่งขออนุมัติ
        </button>
        <span className="text-[10px] text-muted italic">กด Save ก่อนจึงส่งขออนุมัติได้</span>
      </div>
    );
  }

  // Draft → Maker ส่งขออนุมัติ
  if (status === 'Draft' && isMaker) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || busy || !id}
          onClick={async () => { if (await setStatus(PENDING_STATUS)) toast.success('ส่งขออนุมัติเรียบร้อย — รอผู้อนุมัติพิจารณา'); }}
          className="group inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition
                     hover:bg-brand-dark hover:shadow disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} className="transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />}
          ส่งขออนุมัติ
        </button>
        {!id && <span className="text-[10px] text-muted italic">กด Save ก่อนจึงส่งขออนุมัติได้</span>}
      </div>
    );
  }

  if (status !== PENDING_STATUS) return null;

  // Pending — Approver เห็น 3 ปุ่ม · คนอื่นเห็น banner
  if (!isApprover) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <p className="text-xs text-amber-800">อยู่ระหว่างรอการอนุมัติ — จะแก้ไขได้อีกครั้งเมื่อผู้อนุมัติพิจารณาเสร็จ</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2">
        <span className="relative mr-1 flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <span className="text-xs font-medium text-amber-800 mr-1">รอการพิจารณา</span>
        <button type="button" disabled={busy}
          onClick={async () => { if (await setStatus(approvedStatus)) toast.success(`อนุมัติแล้ว — สถานะ ${approvedStatus}`); }}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-40">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} อนุมัติ
        </button>
        <button type="button" disabled={busy} onClick={() => { setNote(''); setModal('return'); }}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-40">
          <Undo2 size={13} /> ส่งกลับแก้
        </button>
        <button type="button" disabled={busy} onClick={() => { setNote(''); setModal('reject'); }}
          className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3.5 py-1.5 text-xs font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 disabled:opacity-40">
          <XCircle size={13} /> ปฏิเสธ
        </button>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-[2px] p-4"
          onClick={() => !busy && setModal(null)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 animate-in"
            style={{ animation: 'approvalModalIn 160ms ease-out' }}
            onClick={(e) => e.stopPropagation()}
          >
            <style>{`@keyframes approvalModalIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }`}</style>
            <div className="px-6 pt-6">
              <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full ${
                modal === 'return' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'
              }`}>
                {modal === 'return' ? <Undo2 size={20} /> : <XCircle size={20} />}
              </div>
              <h3 className="text-base font-semibold text-gray-900">
                {modal === 'return' ? 'ส่งกลับให้แก้ไข' : 'ปฏิเสธรายการนี้?'}
              </h3>
              <p className="mt-1 text-[13px] leading-5 text-gray-500">
                {modal === 'return'
                  ? 'รายการจะถูกส่งกลับไปให้ผู้จัดทำปรับแก้ และส่งขออนุมัติเข้ามาใหม่ เหตุผลจะแสดงให้ผู้จัดทำเห็นบนหน้ารายการ'
                  : 'รายการจะถูกปฏิเสธและปิดการพิจารณา เหตุผลจะบันทึกไว้เป็นหลักฐาน'}
              </p>
              <textarea
                autoFocus
                className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50/60 px-3.5 py-2.5 text-sm leading-6 outline-none transition
                           placeholder:text-gray-400 focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10 min-h-[96px]"
                placeholder={modal === 'return' ? 'ระบุจุดที่ต้องแก้ไข เช่น วงเงินไม่ตรงกับสัญญา…' : 'ระบุเหตุผลที่ปฏิเสธ เช่น เอกสารไม่ครบถ้วน…'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="mt-5 flex gap-2 border-t border-gray-100 px-6 py-4">
              <button type="button" disabled={busy} onClick={() => setModal(null)}
                className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
                ยกเลิก
              </button>
              <button type="button" disabled={busy || !note.trim()} onClick={confirmModal}
                className={`flex-1 rounded-xl py-2.5 text-sm font-medium text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  modal === 'return' ? 'bg-brand hover:bg-brand-dark' : 'bg-red-600 hover:bg-red-700'
                }`}>
                {busy ? 'กำลังบันทึก…' : modal === 'return' ? 'ส่งกลับแก้' : 'ยืนยันปฏิเสธ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** กล่องหมายเหตุการพิจารณา — timeline สไตล์ activity feed */
export function ApprovalNote({ remark }: { remark?: string | null }) {
  if (!remark) return null;
  const entries = remark
    .split(' · ')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('ส่งกลับแก้:') || s.startsWith('ปฏิเสธ:'));
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
      <div className="mb-2.5 flex items-center gap-1.5">
        <MessageSquareText size={13} className="text-gray-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">ความเห็นการพิจารณา</span>
      </div>
      <ol className="relative space-y-3 border-l border-gray-200 pl-4 ml-1">
        {entries.slice(-3).map((e, i) => {
          const isReject = e.startsWith('ปฏิเสธ:');
          const text = e.replace(/^(ส่งกลับแก้|ปฏิเสธ):\s*/, '');
          return (
            <li key={i} className="relative">
              <span className={`absolute -left-[21.5px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                isReject ? 'bg-red-500' : 'bg-amber-400'
              }`} />
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold ${isReject ? 'text-red-600' : 'text-amber-700'}`}>
                  {isReject ? 'ปฏิเสธ' : 'ส่งกลับให้แก้ไข'}
                </span>
              </div>
              <p className="mt-0.5 text-[13px] leading-5 text-gray-700">{text}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * ตัวกรองตัวเลือกสถานะใน dropdown
 *
 * สถานะที่เป็นผลจากขั้นตอนอนุมัติ (รออนุมัติ · อนุมัติแล้ว · ปฏิเสธ · ร่าง) ต้องเกิดจากการกดปุ่มเท่านั้น
 * ไม่ว่าผู้ใช้จะมีสิทธิ์อนุมัติหรือไม่ก็เลือกเองจาก dropdown ไม่ได้ — กันการข้ามขั้นตอน Maker/Checker
 * (เดิมกันเฉพาะคนที่ไม่มีสิทธิ์อนุมัติ ทำให้ผู้ที่มีสิทธิ์ทั้งจัดทำและอนุมัติกดข้ามได้)
 *
 * เหลือให้เลือกเฉพาะสถานะที่เป็นการทำงานปกติหลังสัญญามีผล เช่น Suspended · Closed · Repaid
 */
export function filterStatusOptions(
  options: readonly string[],
  current: string | null | undefined,
  _isApprover: boolean,
  approvedStatus = 'Approved',
  rejectStatus?: string,
): string[] {
  const byWorkflow = new Set<string>([
    'Draft',
    PENDING_STATUS,
    approvedStatus,
    rejectStatus ?? (approvedStatus === 'Active' ? 'Cancelled' : 'Rejected'),
  ]);
  // ค่าปัจจุบันอาจยังไม่พร้อมในรอบแรกที่วาดจอ (ฟอร์มยังไม่ตั้งค่า) — ถือว่าเป็น Draft ไปก่อน
  const cur = current || 'Draft';
  const out = options.filter((s) => s === cur || !byWorkflow.has(s));
  // รายการต้องมีค่าปัจจุบันเสมอ ไม่งั้นช่องเลือกจะหาค่าที่ตรงไม่เจอแล้ววนตั้งค่าซ้ำไม่รู้จบ
  if (!out.includes(cur)) out.unshift(cur);
  return out;
}
