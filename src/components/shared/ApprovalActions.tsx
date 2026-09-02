// Approval Workflow — Maker ส่งขออนุมัติ · Approver อนุมัติ / ส่งกลับแก้ / ปฏิเสธ
// ใช้ร่วมทุกโมดูล: อัปเดตสถานะตรงที่ตาราง แล้วให้หน้าแม่ refresh ผ่าน onChanged
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Send, CheckCircle2, Undo2, XCircle, MessageSquareText, Loader2, Lock } from 'lucide-react';
import { CharCount, Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';

export const PENDING_STATUS = 'Pending Approval';

// ตารางที่มีช่องเก็บประวัติการอนุมัติ (ผู้ส่ง · เวลาที่ส่ง · ผู้อนุมัติ · เวลาที่อนุมัติ · เหตุผล)
//
// เดิมปุ่มชุดนี้เปลี่ยนแค่สถานะ ส่วนการ์ดด้านบนเขียนแค่ประวัติ ทั้งสองไม่รู้จักกัน
// ผลคือกดปุ่มชุดนี้แล้วป้าย "อนุมัติโดยใคร เมื่อไร" ไม่เคยขึ้น และกดที่การ์ดแล้ว
// สถานะไม่ขยับ ผู้อนุมัติจึงไม่เห็นรายการในหน้าแจ้งเตือน
// ตอนนี้ปุ่มชุดนี้เป็นที่เดียวที่สั่งงาน และเขียนทั้งสถานะและประวัติพร้อมกัน
const APPROVAL_FLAG_TABLES = new Set([
  'loans', 'promissory_notes', 'floor_plans', 'overdrafts', 'trust_receipts',
  'letter_guarantees', 'letters_of_credit', 'leases', 'fx_forwards',
  // เพิ่มเข้ามาพร้อม migration 0103 — เดิมสองตารางนี้ไม่มีช่องเก็บ
  // จึงเขียนได้แค่สถานะ และตรวจการแยกหน้าที่ผู้จัดทำกับผู้อนุมัติไม่ได้
  'master_agreements', 'credit_agreements',
]);

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
  const { can, isAdmin } = useAuth();
  const userLabel = useCurrentUserLabel();
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'return' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [submittedBy, setSubmittedBy] = useState<string | null>(null);
  const isApprover = can(menuKey, 'approve');
  const isMaker = can(menuKey, 'edit');
  const tracks = APPROVAL_FLAG_TABLES.has(table);

  // ── แยกหน้าที่ผู้จัดทำกับผู้อนุมัติ ────────────────────────────────────────
  //
  // เดิมตรวจแค่ว่า "มีสิทธิ์อนุมัติไหม" ไม่ได้ตรวจว่าคนอนุมัติกับคนส่งเป็นคนเดียวกัน
  // ใครที่มีทั้งสิทธิ์แก้และสิทธิ์อนุมัติในเมนูเดียวกัน จึงส่งเองแล้วกดอนุมัติเองได้
  // ระบบแยกหน้าที่ก็ไม่มีความหมาย และเป็นข้อที่ผู้ตรวจสอบบัญชีถามเสมอ
  //
  // ผู้ดูแลระบบข้ามด่านนี้ได้ตามที่ตกลงไว้ — แต่ยังถูกบันทึกชื่อไว้ในประวัติเหมือนกัน
  useEffect(() => {
    if (!id || !tracks || status !== PENDING_STATUS) { setSubmittedBy(null); return; }
    let alive = true;
    void supabase.from(table).select('submitted_by').eq('id', id).maybeSingle()
      .then(({ data }) => { if (alive) setSubmittedBy((data as any)?.submitted_by ?? null); });
    return () => { alive = false; };
  }, [id, table, status, tracks]);

  const isOwnSubmission = !!submittedBy && submittedBy === userLabel;
  const blockSelfApprove = isOwnSubmission && !isAdmin;

  const setStatus = async (newStatus: string, remarkNote?: string) => {
    setBusy(true);
    try {
      // ด่านที่สอง — ปุ่มถูกปิดไว้อยู่แล้ว แต่กันไว้ที่ตัวสั่งงานด้วย
      // เผื่อกรณีที่สถานะเปลี่ยนระหว่างที่หน้าจอยังไม่ทันรีเฟรช
      if (newStatus === approvedStatus && blockSelfApprove) {
        throw new Error('รายการนี้คุณเป็นคนส่งขออนุมัติเอง — ต้องให้คนอื่นเป็นผู้อนุมัติ');
      }
      const patch: Record<string, any> = { status: newStatus };
      if (remarkNote) {
        const { data } = await supabase.from(table).select('remark').eq('id', id!).maybeSingle();
        const old = (data?.remark ?? '').trim();
        patch.remark = `${old ? old + ' · ' : ''}${remarkNote}`;
      }
      // เขียนประวัติการอนุมัติไปพร้อมกับสถานะ — ป้าย "ส่งโดยใคร / อนุมัติโดยใคร เมื่อไร"
      // ด้านบนอ่านจากช่องเหล่านี้ ถ้าไม่เขียนจะไม่มีวันขึ้น
      if (tracks) {
        const now = new Date().toISOString();
        if (newStatus === PENDING_STATUS) {
          patch.submitted_by = userLabel;
          patch.submitted_at = now;
          patch.rejection_reason = null;   // ส่งใหม่ = ล้างเหตุผลที่เคยถูกตีกลับ
        } else if (newStatus === approvedStatus) {
          patch.approved_by = userLabel;
          patch.approved_at = now;
        } else {
          // ส่งกลับแก้ (Draft) หรือปฏิเสธ — เก็บเหตุผลไว้ แล้วล้างการส่งขออนุมัติ
          patch.rejection_reason = remarkNote ?? null;
          patch.submitted_by = null;
          patch.submitted_at = null;
          patch.approved_by = null;
          patch.approved_at = null;
        }
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

  // กล่องกรอกเหตุผล — ใช้ร่วมกันทั้งตอนรออนุมัติ (ส่งกลับแก้ / ปฏิเสธ)
  // และตอนอนุมัติแล้ว (ขอให้แก้ไข) จึงต้องประกาศไว้ก่อนทางแยกสถานะข้างล่าง
  const dialog = modal ? (
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
          <textarea maxLength={2000}
            autoFocus
            className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50/60 px-3.5 py-2.5 text-sm leading-6 outline-none transition
                       placeholder:text-gray-400 focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10 min-h-[96px]"
            placeholder={modal === 'return' ? 'ระบุจุดที่ต้องแก้ไข เช่น วงเงินไม่ตรงกับสัญญา…' : 'ระบุเหตุผลที่ปฏิเสธ เช่น เอกสารไม่ครบถ้วน…'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <CharCount value={note} max={2000} />
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
  ) : null;

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

  // ── อนุมัติแล้ว — ผู้จัดทำแตะไม่ได้ ต้องให้ผู้อนุมัติส่งกลับก่อน ──────────
  //
  // เดิมพออนุมัติเสร็จ กล่องนี้หายไปเลยและฟอร์มก็เปิดให้แก้ตามปกติ
  // ผู้จัดทำจึงแก้วงเงินที่อนุมัติไปแล้วได้เงียบๆ โดยสถานะยังขึ้นว่า Approved
  // คนอ่านทีหลังจะเข้าใจว่าผู้อนุมัติเห็นตัวเลขใหม่แล้ว ทั้งที่ไม่เคยเห็น
  //
  // ทางออกคือให้การออกจากสถานะอนุมัติต้องผ่านมือผู้อนุมัติเสมอ
  // ผู้จัดทำดึงกลับเองไม่ได้ ตรงกับหลักการแยกหน้าที่
  if (status === approvedStatus) {
    if (!isApprover) {
      if (!isMaker) return null;
      return (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50 px-3 py-2">
          <Lock size={13} className="shrink-0 text-emerald-700" />
          <p className="text-xs text-emerald-800">
            อนุมัติแล้ว — แก้ไขไม่ได้ · ถ้าต้องแก้ ให้ผู้อนุมัติกด "ขอให้แก้ไข" ก่อน
          </p>
        </div>
      );
    }
    return (
      <>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/60 px-3 py-2">
          <Lock size={13} className="shrink-0 text-emerald-700" />
          <span className="mr-1 text-xs font-medium text-emerald-800">อนุมัติแล้ว — ล็อกการแก้ไข</span>
          <button type="button" disabled={busy || disabled}
            onClick={() => { setNote(''); setModal('return'); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-40">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} ขอให้แก้ไข
          </button>
          <span className="text-[11px] text-emerald-800">กดแล้วรายการกลับไปเป็นฉบับร่างให้ผู้จัดทำแก้</span>
        </div>
        {dialog}
      </>
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
        <button type="button" disabled={busy || blockSelfApprove}
          title={blockSelfApprove ? 'รายการนี้คุณเป็นคนส่งเอง — ต้องให้คนอื่นเป็นผู้อนุมัติ' : ''}
          onClick={async () => { if (await setStatus(approvedStatus)) toast.success(`อนุมัติแล้ว — สถานะ ${approvedStatus}`); }}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} อนุมัติ
        </button>
        {blockSelfApprove && (
          <span className="text-[11px] text-amber-800">
            คุณเป็นคนส่งรายการนี้เอง — ต้องให้คนอื่นเป็นผู้อนุมัติ
          </span>
        )}
        <button type="button" disabled={busy} onClick={() => { setNote(''); setModal('return'); }}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-40">
          <Undo2 size={13} /> ส่งกลับแก้
        </button>
        <button type="button" disabled={busy} onClick={() => { setNote(''); setModal('reject'); }}
          className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3.5 py-1.5 text-xs font-medium text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 disabled:opacity-40">
          <XCircle size={13} /> ปฏิเสธ
        </button>
      </div>

      {dialog}
    </>
  );
}

/** กล่องหมายเหตุการพิจารณา — timeline สไตล์ activity feed */
/**
 * บรรทัดบอกว่าใครส่ง ใครอนุมัติ เมื่อไร
 *
 * โมดูลธุรกรรมมีการ์ดของตัวเองอยู่แล้ว ตัวนี้ทำไว้ให้สัญญาหลักกับวงเงินย่อย
 * ซึ่งเพิ่งมีช่องเก็บพร้อม migration 0103
 */
export function ApprovalTrail({ table, id, refreshKey }: {
  table: string;
  id?: string | null;
  refreshKey?: unknown;
}) {
  const [row, setRow] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (!id) { setRow(null); return; }
    let alive = true;
    void supabase.from(table)
      .select('submitted_by, submitted_at, approved_by, approved_at')
      .eq('id', id).maybeSingle()
      .then(({ data }) => { if (alive) setRow((data as any) ?? null); });
    return () => { alive = false; };
  }, [table, id, refreshKey]);

  if (!row?.submitted_by && !row?.approved_by) return null;
  const when = (v?: string | null) =>
    v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '';

  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {row.submitted_by && <span>ส่งขออนุมัติโดย <strong>{row.submitted_by}</strong> {when(row.submitted_at)}</span>}
      {row.approved_by && <span>อนุมัติโดย <strong>{row.approved_by}</strong> {when(row.approved_at)}</span>}
    </div>
  );
}

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
  const reject = rejectStatus ?? (approvedStatus === 'Active' ? 'Cancelled' : 'Rejected');
  // ค่าปัจจุบันอาจยังไม่พร้อมในรอบแรกที่วาดจอ (ฟอร์มยังไม่ตั้งค่า) — ถือว่าเป็น Draft ไปก่อน
  const cur = current || 'Draft';

  // สัญญาที่ผ่านการอนุมัติมาแล้ว (สถานะไม่ใช่ Draft / รออนุมัติ / ถูกปฏิเสธ)
  // ต้องกลับมาสถานะใช้งานปกติได้ เช่น ระงับชั่วคราวแล้วธนาคารปลดให้ หรือเปิดสัญญาที่ปิดไปแล้ว
  //
  // เดิมตัดสถานะใช้งานปกติออกเสมอ เพื่อกันการข้ามขั้นอนุมัติจาก Draft
  // แต่ไปตัดทางกลับของสัญญาที่อนุมัติแล้วด้วย — พอระงับแล้วกลับไม่ได้อีกเลยทั้งระบบ
  const alreadyApproved = cur !== 'Draft' && cur !== PENDING_STATUS && cur !== reject;

  const byWorkflow = new Set<string>(['Draft', PENDING_STATUS, reject]);
  if (!alreadyApproved) byWorkflow.add(approvedStatus);
  const out = options.filter((s) => s === cur || !byWorkflow.has(s));
  // รายการต้องมีค่าปัจจุบันเสมอ ไม่งั้นช่องเลือกจะหาค่าที่ตรงไม่เจอแล้ววนตั้งค่าซ้ำไม่รู้จบ
  if (!out.includes(cur)) out.unshift(cur);
  return out;
}
