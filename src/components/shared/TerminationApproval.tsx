// TerminationApproval — ปุ่มอนุมัติ "ปิดสัญญา" สำหรับ MA / CA (component กลาง)
//
// Flow: Maker/Checker เลือก "Terminated" ใน dropdown จาก Approved → Save
//       ระบบเก็บเป็น "Pending Termination" (ขอปิด) แล้วโชว์กล่องนี้
//       Approver "อีกคน" กด "อนุมัติปิด" → Terminated จริง · หรือ "ส่งกลับ" → Approved
//
// กติกาเดียวกับ approval flow ปกติ: คนขอปิดเองมาอนุมัติเองไม่ได้ (ยกเว้น admin)
// และปิดไม่ได้ถ้าลูก (CA/ธุรกรรม) ยังไม่จบ — ใช้ termination-guard กลางตัวเดียว
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Undo2, Loader2, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { assertNoActiveChildren } from '@/lib/termination-guard';

export function TerminationApproval({
  module,
  table,
  menuKey,
  id,
  status,
  requestedBy,
  onChanged,
}: {
  module: 'MA' | 'CA';
  table: 'master_agreements' | 'credit_agreements';
  menuKey: string;                 // permission key เช่น 'ma' / 'ca'
  id?: string | null;
  status: string;                  // สถานะที่บันทึกจริง (savedStatus)
  requestedBy?: string | null;     // คนยื่นขอปิด — กันอนุมัติเอง
  onChanged?: (s: string) => void;
}) {
  const qc = useQueryClient();
  const { can, isAdmin } = useAuth();
  const me = useCurrentUserLabel();
  const label = module === 'MA' ? 'สัญญาหลัก' : 'วงเงิน';
  const isApprover = can(menuKey, 'approve');
  const blockSelf = !!requestedBy && requestedBy === me && !isAdmin;

  const refresh = (s: string) => {
    if (id) qc.invalidateQueries({ queryKey: [menuKey, id] });
    qc.invalidateQueries({ queryKey: [`${menuKey}-list`] });
    onChanged?.(s);
  };

  const approve = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกก่อน');
      if (blockSelf) throw new Error('คุณเป็นคนขอปิดสัญญานี้เอง — ต้องให้คนอื่นเป็นผู้อนุมัติการปิด');
      await assertNoActiveChildren(module, id);   // ลูกต้องจบก่อนจึงปิดได้
      const { error } = await supabase.from(table).update({ status: 'Terminated' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { refresh('Terminated'); toast.success('✓ ปิดสัญญาแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกก่อน');
      const { error } = await supabase
        .from(table)
        .update({ status: 'Approved', termination_requested_by: null, termination_requested_at: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { refresh('Approved'); toast.success('ส่งคำขอปิดกลับแล้ว — กลับสู่ Approved'); },
    onError: (e: any) => toast.error(e.message),
  });

  if (status !== 'Pending Termination') return null;
  const busy = approve.isPending || reject.isPending;

  // ไม่มีสิทธิ์อนุมัติ (รวมถึงคนขอเอง) → เห็นแค่ป้ายว่ารออนุมัติ
  if (!isApprover) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2">
        <Lock size={13} className="shrink-0 text-amber-700" />
        <span className="text-xs text-amber-800">
          มีคำขอปิด{label} (ขอโดย {requestedBy ?? '-'}) — รอผู้อนุมัติพิจารณา
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2">
      <span className="mr-1 text-xs font-medium text-amber-800">
        ⏳ คำขอปิด{label} — ขอโดย {requestedBy ?? '-'}
      </span>
      <button
        type="button"
        disabled={busy || blockSelf}
        title={blockSelf ? 'คุณเป็นคนขอเอง — ต้องให้คนอื่นอนุมัติ' : ''}
        onClick={() => { if (confirm(`อนุมัติปิด${label}นี้?`)) approve.mutate(); }}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} อนุมัติปิด
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => reject.mutate()}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-40"
      >
        <Undo2 size={13} /> ส่งกลับ
      </button>
      {blockSelf && (
        <span className="text-[11px] text-amber-800">คุณเป็นคนขอเอง — ต้องให้คนอื่นอนุมัติ</span>
      )}
    </div>
  );
}
