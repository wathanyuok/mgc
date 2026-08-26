import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, Plus, Repeat2, Save, Trash2, XCircle, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchCaCards } from '@/lib/ca-inherit';
import { Button, Card, CardContent, Input, Select, Modal, Badge, FieldLabel, NumInput } from '@/components/ui';
import { fmtDate, fmtMoney, fmtDateISO} from '@/lib/format';
import {
  type LetterGuarantee,
  type LGFee,
  LG_TYPES,
  LG_STATUSES,
  PAYMENT_CYCLES,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, type RateCard } from '@/components/tx/RateCards';
import { pickEffectiveRate } from '@/lib/rate-helpers';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';
import { RepaymentsReceived } from '@/components/tx/RepaymentsReceived';
import { createJE, postJE } from '@/lib/je';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly, ReadOnlyContext } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import { computeStatusLock, canSaveStatusChange } from '@/lib/status-lock';
import {
  reverseOffBalance, LG_ISSUE_SOURCE, LG_REVERSE_SOURCES, LG_ENDED_STATUSES,
} from '@/lib/offbalance-reverse';
import { StatusLockBanner } from '@/components/tx/StatusLockBanner';
import { ApprovalPanel } from '@/components/tx/ApprovalPanel';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { ClassificationCard } from '@/components/shared/ClassificationCard';
import { fetchInheritedFromCA, type InheritedSegments } from '@/lib/segment-inherit';
import { useBankCodes } from '@/lib/banks';
import { ApprovalActions, ApprovalNote, filterStatusOptions } from '@/components/shared/ApprovalActions';

import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
import { toDbPayload } from '@/lib/save-payload';
type Form = Omit<LetterGuarantee, 'id' | 'created_at' | 'updated_at'> & {
  rate_cards: RateCard[];
  acct_cards: AcctCard[];
};

// Off-Balance GL accounts for LG/BG (Contingent Liability — memo accounts)
// Mirrors LC pattern: Dr Contingent / Cr Contra on Issue, Reverse on Expired/Terminated
const LG_GL = {
  contingent:       { code: '900100', name: 'Contingent Liability — LG/BG (Off-Balance)' },
  contingentContra: { code: '900200', name: 'Contra — LG/BG Commitment' },
};

// Note: 'Approved' removed — Approval Panel now owns that transition.
const LG_STATUS_DROPDOWN = LG_STATUSES.filter((s) => s !== 'Approved');

// เลขที่ระบบออกให้ต้องขึ้นต้นตามประเภทที่เลือกจริง
// เดิมดูแค่ว่ามีคำว่า B/G ไหม → เลือก SBLC แล้วได้เลขขึ้นต้น LG ซึ่งอ่านแล้วเข้าใจผิดว่าเป็นคนละประเภท
const runningPrefixFor = (lgType: string | null | undefined): string =>
  lgType === 'B/G' ? RUNNING_PREFIX.bg : lgType === 'SBLC' ? 'SBLC' : RUNNING_PREFIX.lg;

// จำนวนเดือนต่อ 1 งวดของรอบชำระ · 0 = จ่ายครั้งเดียว (ตัดบัญชีเป็นงวดเดียวตลอดอายุ)
const CYCLE_MONTHS: Record<string, number> = {
  'Monthly': 1, 'Quarterly': 3, 'Semi-Annual': 6, 'Annual': 12, 'One-Time': 0,
};

const blank: Form = {
  lg_no: '',
  name: '',
  lg_type: 'B/G',
  ca_id: null,
  finance_institution: 'KBANK',
  beneficiary: '',
  subject: null,
  amount: 0,
  amount_foreign: null,
  currency: 'THB',
  conversion_date: null,
  conversion_rate: null,
  prepaid: false,
  reference_contract: null,
  issue_date: fmtDateISO(new Date()),
  expiry_date: fmtDateISO(new Date()),
  status: 'Draft',
  remark: null,
  rate_cards: [],
  payment_cycle: 'Quarterly',
  payment_date: null,
  fee_amount: null,
  rollover_parent_id: null,
  acct_cards: [],
};

export function LGDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const [fees, setFees] = useState<LGFee[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [showRollover, setShowRollover] = useState(false);
  const [showTerminate, setShowTerminate] = useState(false);
  const [rolloverNew, setRolloverNew] = useState({ new_name: '', new_issue: '', new_expiry: '' });
  const actionsRef = useRef<HTMLDivElement>(null);

  // CA dropdown options
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-for-lg'],
    queryFn: async () => {
      const { data } = await supabase.from('credit_agreements').select('id, ca_name').eq('status', 'Approved').order('ca_name');
      return (data ?? []) as { id: string; ca_name: string }[];
    },
  });

  const { data: existing } = useQuery({
    queryKey: ['lg', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [main, feeRes] = await Promise.all([
        supabase.from('letter_guarantees').select('*').eq('id', id!).single(),
        supabase.from('lg_fees').select('*').eq('lg_id', id!).order('sort_order'),
      ]);
      if (main.error) throw main.error;
      return { main: main.data as any, fees: (feeRes.data ?? []) as LGFee[] };
    },
  });

  // Strict Save-first gate: maker MUST click Save in this session before
  // the approval workflow's "ส่งขออนุมัติ" button unlocks. Ensures maker
  // has consciously reviewed the record before handing it to the approver
  // — even if the loaded data hasn't been edited.
  const [hasSavedInSession, setHasSavedInSession] = useState(false);
  // Reset the flag only when navigating to a DIFFERENT record (id change) —
  // not on every refetch, or Save's own invalidate would immediately relock.
  const prevIdRef = useRef<string | undefined>(id);
  useEffect(() => {
    // Only reset when navigating between different EXISTING records.
    // Skip the new→saved transition (undefined → newId) so the flag set by
    // save.onSuccess isn't clobbered right after Save creates the record.
    if (prevIdRef.current !== undefined && prevIdRef.current !== id) {
      setHasSavedInSession(false);
    }
    prevIdRef.current = id;
  }, [id]);
  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing.main;
      setForm({
        ...rest,
        rate_cards: existing.main.rate_cards ?? [],
        acct_cards: existing.main.acct_cards ?? [],
      });
      setFees(existing.fees);
    }
  }, [existing]);

  // Auto-expire on expiry: Active + expiry_date past → auto-promote to Expired.
  // Per MoM/BRD: LG/BG ends when END DATE is reached (bank releases guarantee obligation).
  // Also creates Reverse Off-Balance JE (Dr Contra / Cr Contingent) per BR-LG-014.
  // Note: Uses 'Expired' (per lg_status enum); 'Released' is not a valid status value.
  useEffect(() => {
    if (!existing?.main || !id) return;
    const today = fmtDateISO(new Date());
    const expiry = existing.main.expiry_date;
    if (
      existing.main.status === 'Active' &&
      expiry &&
      expiry < today
    ) {
      (async () => {
        // 1) กลับรายการภาระผูกพันนอกงบก่อนเปลี่ยนสถานะ
        let reverseJeNo = '';
        try {
          reverseJeNo = await reverseOffBalance({
            sourceId: id,
            issueSourceType: LG_ISSUE_SOURCE,
            reverseSourceType: 'LG_EXPIRE_REVERSE',
            allReverseSourceTypes: LG_REVERSE_SOURCES,
            amount: existing.main.amount ?? 0,
            jeDate: today,
            label: existing.main.name ?? existing.main.lg_no,
            reason: `ครบกำหนด (วันสิ้นสุด ${expiry})`,
            accounts: LG_GL,
          });
        } catch (e) {
          console.warn('กลับรายการภาระผูกพันนอกงบไม่สำเร็จ:', e);
        }

        // 2) Update status to Expired
        const { error } = await supabase
          .from('letter_guarantees')
          .update({ status: 'Expired' })
          .eq('id', id);
        if (!error) {
          toast.success(
            reverseJeNo
              ? `LG/BG ครบกำหนด → Status → Expired · Off-Balance reversed (JE ${reverseJeNo})`
              : `LG/BG ครบกำหนด → Status → Expired อัตโนมัติ`
          );
          qc.invalidateQueries({ queryKey: ['lg', id] });
          qc.invalidateQueries({ queryKey: ['je-list'] });
        }
      })();
    }
  }, [existing, id, qc]);

  // ตาข่ายกันตก: ไม่ว่าสัญญาจะจบด้วยวิธีไหน ภาระผูกพันนอกงบต้องถูกกลับรายการเสมอ
  // ครอบคลุมทางที่โค้ดเฉพาะทางด้านบนไม่ได้ดูแล เช่น ผู้ใช้เลือกปิด/ยกเลิก/หมดอายุเองจากช่องสถานะ
  // ทำซ้ำได้ — ถ้ากลับรายการไปแล้วจะไม่สร้างใบซ้ำ
  useEffect(() => {
    if (!existing?.main || !id) return;
    if (!LG_ENDED_STATUSES.includes(existing.main.status)) return;
    (async () => {
      try {
        const jeNo = await reverseOffBalance({
          sourceId: id,
          issueSourceType: LG_ISSUE_SOURCE,
          reverseSourceType: 'LG_OFFBALANCE_REVERSE',
          allReverseSourceTypes: LG_REVERSE_SOURCES,
          amount: existing.main.amount ?? 0,
          jeDate: existing.main.expiry_date ?? fmtDateISO(new Date()),
          label: existing.main.name ?? existing.main.lg_no,
          reason: `สถานะเปลี่ยนเป็น ${existing.main.status}`,
          accounts: LG_GL,
        });
        if (jeNo) {
          toast.success(`กลับรายการภาระผูกพันนอกงบแล้ว (${jeNo})`);
          qc.invalidateQueries({ queryKey: ['je-list'] });
        }
      } catch (e) {
        console.warn('กลับรายการภาระผูกพันนอกงบไม่สำเร็จ:', e);
      }
    })();
  }, [existing, id, qc]);

  // Auto-Post Issue Off-Balance JE when LG transitions Approved → Active.
  // Per BR-LG-012: บันทึก contingent liability ใน memo account ตอน Issue.
  // Idempotent — checks if Issue Off-Balance JE already exists before posting.
  useEffect(() => {
    if (!existing?.main || !id) return;
    if (existing.main.status !== 'Active') return;
    if (!existing.main.amount || existing.main.amount <= 0) return;
    (async () => {
      try {
        const { data: existingJEs } = await supabase
          .from('journal_entries')
          .select('id')
          .eq('source_type', 'LG_ISSUE_OFFBALANCE')
          .eq('source_id', id);
        if (existingJEs && existingJEs.length > 0) return; // already posted
        const amount = Math.round((existing.main.amount ?? 0) * 100) / 100;
        const today = fmtDateISO(new Date());
        const je = await createJE({
          source_type: 'LG_ISSUE_OFFBALANCE',
          source_id: id,
          je_date: existing.main.issue_date ?? today,
          description: `${existing.main.name ?? existing.main.lg_no} — Issue Off-Balance`,
          remark: `Contingent liability (off-balance) — LG/BG issued`,
          lines: [
            { account_code: LG_GL.contingent.code,       account_name: LG_GL.contingent.name,       dr: amount, description: 'LG/BG commitment (off-balance)' },
            { account_code: LG_GL.contingentContra.code, account_name: LG_GL.contingentContra.name, cr: amount, description: 'Contra — off-balance' },
          ],
        });
        await postJE(je.id, 'user');
        toast.success(`✓ Off-Balance JE posted (${je.je_number})`);
        qc.invalidateQueries({ queryKey: ['je-list'] });
      } catch (e) {
        console.warn('Issue Off-Balance JE failed:', e);
      }
    })();
  }, [existing, id, qc]);

  // Close actions menu on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // อัตราค่าธรรมเนียมต่อปี — เลือกการ์ดที่ "มีผล ณ วันที่คิดค่าธรรมเนียม"
  // เดิมอ่านการ์ดใบแรกใบเดียว การ์ดที่เพิ่มทีหลัง (เช่น ปรับอัตราตอนต่ออายุ) จึงไม่มีผลกับยอดเลย
  const feeRateDate = form.payment_date ?? form.issue_date;
  const effFeeRate = useMemo(
    () => pickEffectiveRate(form.rate_cards, feeRateDate).rate,
    [form.rate_cards, feeRateDate],
  );

  // สกุลเงินต่างประเทศ: ยอดบาท = ยอดสกุลต่างประเทศ × อัตราแลกเปลี่ยน (วิธีเดียวกับหนังสือเครดิต)
  // เดิม 3 ช่องนี้กรอกทิ้งไว้เฉยๆ ไม่ถูกนำไปคำนวณที่ไหนเลย
  useEffect(() => {
    if (form.currency === 'THB') return;
    if (!form.amount_foreign || !form.conversion_rate) return;
    const thb = form.amount_foreign * form.conversion_rate;
    setForm((f) => (Math.abs((f.amount ?? 0) - thb) > 0.005 ? { ...f, amount: thb } : f));
  }, [form.currency, form.amount_foreign, form.conversion_rate]);

  // Auto-compute new fee for rollover (Guarantee Amount × Rate × 1 year)
  const newRolloverFee = useMemo(() => (form.amount * effFeeRate) / 100, [form.amount, effFeeRate]);

  // ensureLgId for Document upload before save
  const ensureLgId = async (): Promise<string> => {
    if (id) return id;
    const lgNo = form.lg_no.trim() || `DRAFT-${Date.now()}`;
    const name = form.name?.trim() || lgNo;
    const { data, error } = await supabase
      .from('letter_guarantees')
      .insert({ ...toDbPayload(form), lg_no: lgNo, name, status: 'Draft' })
      .select()
      .single();
    if (error) throw error;
    setForm((f) => ({ ...f, lg_no: lgNo, name }));
    navigate(`/tx/lg/${data.id}`, { replace: true });
    toast.success('✓ สร้าง Draft อัตโนมัติ');
    return data.id as string;
  };

  const userLabel = useCurrentUserLabel();
  const { can: rawCan } = useAuth();
  const viewOnly = useReadOnly();
  // Fetch inherited segments (Subsidiary, RPT, Class) จาก parent CA → MA
  const [inheritedSeg, setInheritedSeg] = useState<InheritedSegments>({});
  useEffect(() => {
    if (!form.ca_id) { setInheritedSeg({}); return; }
    fetchInheritedFromCA(form.ca_id).then(setInheritedSeg).catch(() => setInheritedSeg({}));
  }, [form.ca_id]);
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);

  // สถานะที่บันทึกไว้จริงในฐานข้อมูล — ใช้ตัดสินว่า "ปิดไปแล้วหรือยัง"
  // (ห้ามใช้สถานะบนหน้าจอ ไม่งั้นพอเลือกปิดสัญญา ระบบจะบอกว่าแก้ไขไม่ได้ทันที)
  const savedStatus = (existing?.main?.status as string | undefined) ?? form.status;
  const lock = computeStatusLock('LG', form.status);
  // การล็อกช่องกรอกต้องดูจากสถานะที่บันทึกไว้จริง ไม่ใช่สถานะที่เพิ่งเลือกบนหน้าจอ
  // ไม่งั้นพอผู้ใช้เลือก "ปิดสัญญา" ในช่องสถานะ ช่องอื่นจะถูกล็อกทันทีทั้งที่ยังไม่ได้บันทึก
  const savedLock = computeStatusLock('LG', savedStatus);
  // ระบบไม่มีสถานะ "Approved" ให้เลือกเอง — ปุ่มอนุมัติจะตั้งเป็น "Active" โดยตรง
  // จึงต้องรับทั้งสองค่า ไม่งั้นปุ่มลงบัญชีค่าธรรมเนียมแรกเข้าจะกดไม่ได้เลย
  const lgApproved = form.status === 'Approved' || form.status === 'Active';

  const save = useMutation({
    mutationFn: async () => {
      if (!canSaveStatusChange('LG', savedStatus, form.status))
        throw new Error(`LG/BG สถานะ ${savedStatus} — ปิดไปแล้ว แก้ไขไม่ได้ (เปลี่ยนสถานะกลับก่อน)`);
      if (!form.lg_no.trim()) throw new Error('กรอก LG/BG Number');
      // วงเงินค้ำประกันต้องมีจำนวนจริง — เดิมบันทึกยอด 0 ผ่านได้ แล้วไปติดตอนลงบัญชี
      if (!form.amount || form.amount <= 0) {
        throw new Error('จำนวนเงินค้ำประกันต้องมากกว่า 0 — กรอกช่อง AMOUNT ก่อนบันทึก');
      }
      // วันสิ้นสุดก่อนวันเริ่มทำให้ตารางตัดบัญชีสร้างไม่ได้ และค่าธรรมเนียมตามสัดส่วนวันติดลบ
      if (form.issue_date && form.expiry_date && form.expiry_date <= form.issue_date) {
        throw new Error('END DATE ต้องมากกว่า START DATE');
      }
      // เลือกสกุลต่างประเทศแล้วต้องมีทั้งยอดและอัตราแลกเปลี่ยน ไม่งั้นยอดบาทจะคำนวณไม่ได้
      if (form.currency !== 'THB') {
        if (!form.amount_foreign || form.amount_foreign <= 0) {
          throw new Error(`เลือกสกุลเงิน ${form.currency} — ต้องกรอก AMOUNT (FOREIGN)`);
        }
        if (!form.conversion_rate || form.conversion_rate <= 0) {
          throw new Error(`เลือกสกุลเงิน ${form.currency} — ต้องกรอก CONVERSION RATE`);
        }
      }
      await assertWithinCreditLine(form.ca_id, form.amount, { table: 'letter_guarantees', id });

      let lgId = id;
      if (mode === 'new') {
        const nm = (form.name ?? '').trim() || await nextRunningNo(runningPrefixFor(form.lg_type));
        const { data, error } = await supabase.from('letter_guarantees').insert({ ...toDbPayload(form), name: nm, created_by: userLabel, updated_by: userLabel }).select().single();
        if (error) throw error;
        lgId = data.id;
      } else {
        const { error } = await supabase.from('letter_guarantees').update({ ...toDbPayload(form), updated_by: userLabel, updated_at: new Date().toISOString() }).eq('id', lgId!);
        if (error) throw error;
      }
      // Replace fees
      await supabase.from('lg_fees').delete().eq('lg_id', lgId!);
      if (fees.length > 0) {
        const rows = fees.map((f, i) => ({
          lg_id: lgId!,
          fee_date: f.fee_date,
          description: f.description,
          rate_pct: f.rate_pct,
          amount: f.amount,
          paid: f.paid,
          paid_date: f.paid_date,
          sort_order: i,
        }));
        const { error } = await supabase.from('lg_fees').insert(rows);
        if (error) throw error;
      }
      return lgId;
    },
    onSuccess: (lgId: any) => {
      logSave('letter_guarantees', lgId ?? id, form.lg_no, mode === 'new');
      qc.invalidateQueries({ queryKey: ['lg-list'] });
      qc.invalidateQueries({ queryKey: ['lg', lgId] });
      // Save happened in this session → unlock the "ส่งขออนุมัติ" button.
      setHasSavedInSession(true);
      toast.success(mode === 'new' ? '✓ สร้าง LG/BG แล้ว' : '✓ บันทึกแล้ว');
      if (mode === 'new' && lgId) navigate(`/tx/lg/${lgId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rollOver = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save ก่อน');
      if (form.status !== 'Approved' && form.status !== 'Active')
        throw new Error('Roll Over ทำได้เฉพาะ LG/BG ที่ Approved/Active เท่านั้น');
      if (!rolloverNew.new_expiry) throw new Error('กรอก Expiry Date ใหม่');

      // ต้องกลับรายการภาระผูกพันของฉบับเดิมก่อน ไม่งั้นพอฉบับใหม่บันทึกภาระผูกพันเพิ่ม
      // ยอดนอกงบจะทบขึ้นทุกครั้งที่ต่ออายุ
      try {
        await reverseOffBalance({
          sourceId: id,
          issueSourceType: LG_ISSUE_SOURCE,
          reverseSourceType: 'LG_OFFBALANCE_REVERSE',
          allReverseSourceTypes: LG_REVERSE_SOURCES,
          amount: form.amount ?? 0,
          jeDate: rolloverNew.new_issue || form.expiry_date || fmtDateISO(new Date()),
          label: form.name ?? form.lg_no,
          reason: 'ต่ออายุสัญญา',
          accounts: LG_GL,
        });
      } catch (e) {
        console.warn('กลับรายการภาระผูกพันนอกงบตอนต่ออายุไม่สำเร็จ:', e);
      }

      await supabase.from('letter_guarantees').update({ status: 'Roll Over' }).eq('id', id);

      const { id: _i, created_at: _c, updated_at: _u, ...formRest } = form as any;
      // เลขอ้างอิงของฉบับต่ออายุ — นับเป็นครั้งที่ (-RO1, -RO2, …)
      // เดิมต่อท้าย "-RO" ทุกครั้ง พอต่ออายุครั้งที่ 2 จะได้ -RO-RO ยาวขึ้นเรื่อยๆ
      const roMatch = form.lg_no?.match(/^(.*)-RO(\d*)$/);
      const baseNo = roMatch ? roMatch[1] : form.lg_no;
      const roTimes = roMatch ? (parseInt(roMatch[2] || '1', 10) + 1) : 1;
      const { data: newLg, error } = await supabase
        .from('letter_guarantees')
        .insert({
          ...formRest,
          name: await nextRunningNo(runningPrefixFor(form.lg_type)),
          lg_no: baseNo ? `${baseNo}-RO${roTimes}` : null,
          issue_date: rolloverNew.new_issue || form.expiry_date,
          expiry_date: rolloverNew.new_expiry,
          status: 'Draft',
          rollover_parent_id: id,
          reference_contract: form.name ?? form.lg_no,
          // ค่าธรรมเนียมงวดใหม่ที่แสดงในหน้าต่างต่ออายุ ต้องถูกบันทึกลงฉบับใหม่จริง
          // เดิมเป็นแค่ตัวเลขให้ดู ฉบับใหม่ยังใช้ยอดเดิมของฉบับก่อน
          fee_amount: parseFloat(newRolloverFee.toFixed(2)),
          payment_date: rolloverNew.new_issue || form.expiry_date,
          // ฉบับใหม่ต้องเริ่มขั้นตอนอนุมัติใหม่ทั้งหมด — ห้ามคัดลอกร่องรอยการอนุมัติของฉบับเดิมมา
          submitted_by: null,
          submitted_at: null,
          approved_by: null,
          approved_at: null,
          rejection_reason: null,
        })
        .select()
        .single();
      if (error) throw error;
      return newLg;
    },
    onSuccess: (data: any) => {
      toast.success(`✓ Roll Over สำเร็จ → LG/BG ใหม่: ${data.name ?? data.lg_no}`);
      setShowRollover(false);
      setRolloverNew({ new_name: '', new_issue: '', new_expiry: '' });
      qc.invalidateQueries({ queryKey: ['lg-list'] });
      navigate(`/tx/lg/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Early Termination form state ──
  const [termForm, setTermForm] = useState({
    notification_date: fmtDateISO(new Date()),
    lead_time_days: 30,
    refund_schedule: 'One-time' as 'One-time' | 'Quarterly' | 'Semi-annual' | 'Other',
  });

  // Auto-compute Effective Cancel Date = Notification + Lead Time
  const effectiveCancelDate = useMemo(() => {
    if (!termForm.notification_date) return '';
    const d = new Date(termForm.notification_date);
    d.setDate(d.getDate() + termForm.lead_time_days);
    return fmtDateISO(d);
  }, [termForm.notification_date, termForm.lead_time_days]);

  // Auto-compute Pro-rata Refund (Prepaid Mode only)
  const refundCalc = useMemo(() => {
    if (!form.issue_date || !form.expiry_date || !effectiveCancelDate) {
      return { totalDays: 0, daysUsed: 0, daysRemaining: 0, refundAmount: 0, note: '' };
    }
    if (!form.prepaid) {
      return { totalDays: 0, daysUsed: 0, daysRemaining: 0, refundAmount: 0, note: 'Expense Mode — ไม่มี Refund (recognize เต็มจำนวนแล้ว)' };
    }
    const issue = new Date(form.issue_date);
    const expiry = new Date(form.expiry_date);
    const effCancel = new Date(effectiveCancelDate);
    const totalDays = Math.round((expiry.getTime() - issue.getTime()) / 86400000);
    const daysUsed = Math.max(0, Math.round((effCancel.getTime() - issue.getTime()) / 86400000));
    const daysRemaining = Math.max(0, totalDays - daysUsed);
    const refundAmount = (form.fee_amount && totalDays > 0)
      ? Math.round((form.fee_amount * daysRemaining / totalDays) * 100) / 100
      : 0;
    return { totalDays, daysUsed, daysRemaining, refundAmount, note: '' };
  }, [form.issue_date, form.expiry_date, form.fee_amount, form.prepaid, effectiveCancelDate]);

  const terminate = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save ก่อน');
      if (form.status !== 'Active' && form.status !== 'Approved') {
        throw new Error(`Terminate ได้เฉพาะ Active/Approved — Status ปัจจุบัน: "${form.status}"`);
      }
      if (!termForm.notification_date) throw new Error('กรอก Notification Date ก่อน');

      // Create Refund JE only if Prepaid Mode + refund > 0
      let refundJeNo = '';
      if (form.prepaid && refundCalc.refundAmount > 0) {
        const refundAcct = (form.acct_cards as AcctCard[]).find((a) => a.type === 'CASH / BANK ACCOUNT');
        const refundGL = refundAcct?.gl ?? '100000 Cheque Account';
        const sp = refundGL.indexOf(' ');
        const cashCode = sp > 0 ? refundGL.slice(0, sp) : '';
        const cashName = sp > 0 ? refundGL.slice(sp + 1) : refundGL;
        const je = await createJE({
          source_type: 'LG_REFUND',
          source_id: id,
          je_date: effectiveCancelDate,
          description: `${form.name ?? form.lg_no} — Early Termination Refund`,
          remark: `Notification: ${termForm.notification_date} · Lead: ${termForm.lead_time_days}d · ${refundCalc.daysRemaining}/${refundCalc.totalDays} วันคงเหลือ · ${termForm.refund_schedule}`,
          lines: [
            { account_code: cashCode, account_name: cashName, dr: refundCalc.refundAmount, description: `Pro-rata refund (${termForm.refund_schedule})` },
            { account_code: '1193', account_name: 'Prepaid Expenses - L/G, B/G', cr: refundCalc.refundAmount, description: 'Reverse remaining prepaid balance' },
          ],
        });
        await postJE(je.id, 'user');
        refundJeNo = je.je_number;
      }

      // กลับรายการภาระผูกพันนอกงบก่อนปิดสัญญา
      let reverseJeNo = '';
      try {
        reverseJeNo = await reverseOffBalance({
          sourceId: id,
          issueSourceType: LG_ISSUE_SOURCE,
          reverseSourceType: 'LG_TERMINATE_REVERSE',
          allReverseSourceTypes: LG_REVERSE_SOURCES,
          amount: form.amount ?? 0,
          jeDate: effectiveCancelDate,
          label: form.name ?? form.lg_no,
          reason: `ยกเลิกก่อนกำหนด (มีผล ${effectiveCancelDate})`,
          accounts: LG_GL,
        });
      } catch (e) {
        console.warn('กลับรายการภาระผูกพันนอกงบไม่สำเร็จ:', e);
      }

      const { error } = await supabase
        .from('letter_guarantees')
        .update({
          status: 'Terminated',
          remark: `Early Terminated · Effective ${effectiveCancelDate} · Refund ${refundCalc.refundAmount.toLocaleString()} (${termForm.refund_schedule})${refundJeNo ? ` · ${refundJeNo}` : ''}${reverseJeNo ? ` · Off-Balance reversed (${reverseJeNo})` : ''}`,
        })
        .eq('id', id);
      if (error) throw error;
      return { refundJeNo, refundAmount: refundCalc.refundAmount, reverseJeNo };
    },
    onSuccess: ({ refundJeNo, refundAmount, reverseJeNo }: any) => {
      qc.invalidateQueries({ queryKey: ['lg', id] });
      qc.invalidateQueries({ queryKey: ['lg-list'] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setShowTerminate(false);
      setForm((f) => ({ ...f, status: 'Terminated' }));
      if (refundAmount > 0) {
        toast.success(`✓ Terminated · Refund ${refundAmount.toLocaleString()} ${refundJeNo ? `(JE ${refundJeNo})` : ''}`);
      } else {
        toast.success(`✓ Terminated · No refund (${form.prepaid ? 'no remaining days' : 'Expense Mode'})`);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Total Fee Scheduled: prefer fees sub-table (Prepaid Mode installments); fallback to form.fee_amount
  // (Expense Mode posts a single JE without splitting into lg_fees rows).
  const totalFee = fees.length > 0
    ? fees.reduce((s, f) => s + (f.amount || 0), 0)
    : (form.fee_amount ?? 0);

  // Paid Fee: sum repayment_lines with category='Fee' for Posted repayments of this facility.
  // Source of truth for both Expense Mode (no lg_fees rows) and Prepaid Mode.
  const { data: paidFeeFromRepayments = 0 } = useQuery({
    queryKey: ['lg-paid-fee', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('repayment_lines')
        .select('amount, category, repayments!inner(status)')
        .eq('facility_id', id!)
        .eq('category', 'Fee');
      return (data ?? [])
        .filter((r: any) => r.repayments?.status === 'Posted')
        .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    },
  });

  // Upfront Fee JE posted (LG_FEE source_type) — counts as fee paid to bank directly.
  const { data: upfrontFeePosted = 0 } = useQuery({
    queryKey: ['lg-upfront-posted', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('id, status, is_reversal')
        .eq('source_type', 'LG_FEE')
        .eq('source_id', id!)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (!data || data.length === 0) return 0;
      // If any LG_FEE JE is posted, consider the full fee_amount as paid upfront.
      return form.fee_amount ?? 0;
    },
  });

  // Refund Received from Early Termination (LG_REFUND posted JEs)
  const { data: refundReceived = 0 } = useQuery({
    queryKey: ['lg-refund', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('total_dr, status, is_reversal')
        .eq('source_type', 'LG_REFUND')
        .eq('source_id', id!)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      return (data ?? []).reduce((s: number, r: any) => s + Number(r.total_dr || 0), 0);
    },
  });

  // Total Fee Paid: choose largest non-zero source (Upfront JE / Repayment / lg_fees legacy).
  // Plus: if Refund was issued, implies upfront was paid → fall back to fee_amount.
  const paidFromAllSources = Math.max(
    upfrontFeePosted,
    paidFeeFromRepayments,
    fees.filter((f) => f.paid).reduce((s, f) => s + (f.amount || 0), 0),
  );
  const paidFee = paidFromAllSources > 0
    ? paidFromAllSources
    : (refundReceived > 0 ? (form.fee_amount ?? 0) : 0);

  // Create JE for upfront fee payment — posts real JE to GL
  const [showJE, setShowJE] = useState(false);

  // Check if upfront JE already posted (ACTIVE = Posted & not a reversal)
  // After reverse: original Reversed + new is_reversal Posted → both excluded → button unlocks
  const { data: upfrontPosted } = useQuery({
    queryKey: ['je-upfront-lg', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('id, je_number, status, is_reversal')
        .eq('source_type', 'LG_FEE')
        .eq('source_id', id!)
        .eq('source_period', 0)
        .eq('status', 'Posted')
        .eq('is_reversal', false)
        .maybeSingle();
      return data;
    },
  });

  // Lookup accounts from Accounting tab (acct_cards)
  // - If user configured accounts → use those (override)
  // - If not → use sensible defaults (warn user)
  const resolvedAccounts = useMemo(() => {
    const acctByType = (t: string) => form.acct_cards.find((a) => a.type === t);

    const drType = form.prepaid ? 'PREPAID ACCOUNT' : 'FEE EXPENSE ACCOUNT';
    const drAcct = acctByType(drType);
    const crAcct = acctByType('CASH / BANK ACCOUNT') || acctByType('NOTE PAYABLE ACCOUNT');

    const drGL = drAcct?.gl ?? (form.prepaid ? '1193 Prepaid Expenses - L/G, B/G' : '5512201 ค่าธรรมเนียมจ่าย');
    const crGL = crAcct?.gl ?? '2142101 เงินกู้ยืมระยะสั้น (Bank) / AP';

    return {
      drGL,
      crGL,
      isFromAccounting: !!drAcct && !!crAcct,
      missingTypes: [
        !drAcct && drType,
        !crAcct && 'CASH / BANK ACCOUNT (หรือ NOTE PAYABLE ACCOUNT)',
      ].filter(Boolean) as string[],
    };
  }, [form.acct_cards, form.prepaid]);

  const createUpfrontJE = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save LG/BG ก่อน Post JE');
      if (!lock.canPostJE) throw new Error(`LG/BG สถานะ ${form.status} — Post JE ไม่ได้`);
      // ระบบไม่มีสถานะ "Approved" ให้เลือกเอง — ปุ่มอนุมัติตั้งเป็น "Active" โดยตรง จึงต้องรับทั้งสองค่า
      if (form.status !== 'Approved' && form.status !== 'Active') {
        throw new Error(`ลงบัญชีค่าธรรมเนียมแรกเข้าได้เฉพาะ LG/BG ที่อนุมัติแล้ว — สถานะปัจจุบัน: "${form.status}"`);
      }
      if (!form.payment_date) throw new Error('กรอก Payment Date ก่อน');
      if (!form.fee_amount) throw new Error('กรอก Fee Amount ก่อน');

      // Double-check at mutation time (race-safe — re-query before insert)
      // Only block if an ACTIVE (Posted, non-reversal) JE exists.
      // After user reverses, this list is empty → user can post again with corrected accounts.
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('je_number, status, is_reversal')
        .eq('source_type', 'LG_FEE')
        .eq('source_id', id)
        .eq('source_period', 0)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (existing && existing.length > 0) {
        throw new Error(
          `Upfront JE มีอยู่แล้ว: ${existing[0].je_number} (status=${existing[0].status}) — ต้อง Reverse ก่อนถ้าจะ Post ใหม่`,
        );
      }

      const parseGL = (gl: string) => {
        const m = gl.match(/^(\S+)\s+(.+)$/);
        return m ? { code: m[1], name: m[2] } : { code: undefined, name: gl };
      };
      const dr = parseGL(resolvedAccounts.drGL);
      const cr = parseGL(resolvedAccounts.crGL);

      const je = await createJE({
        source_type: 'LG_FEE',
        source_id: id,
        source_period: 0,
        je_date: form.payment_date,
        description: `${form.name ?? form.lg_no} — Upfront Fee Payment`,
        remark: `${form.prepaid ? 'Prepaid mode' : 'Expense mode'} · ${form.payment_cycle ?? ''} · accounts ${resolvedAccounts.isFromAccounting ? 'from Accounting tab' : 'default'}`,
        lines: [
          { account_code: dr.code, account_name: dr.name, dr: form.fee_amount, description: form.prepaid ? 'Prepaid fee' : 'Fee expense (one-shot)' },
          { account_code: cr.code, account_name: cr.name, cr: form.fee_amount, description: 'Pay to bank' },
        ],
      });
      await postJE(je.id, 'user');

      // Auto-promote status: Approved → Active
      await supabase.from('letter_guarantees').update({ status: 'Active' }).eq('id', id);
      return je;
    },
    onSuccess: (je) => {
      qc.invalidateQueries({ queryKey: ['je-upfront-lg', id] });
      qc.invalidateQueries({ queryKey: ['lg', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Active' }));
      toast.success(`✓ ${je.je_number} Posted · Status → Active`);
      setShowJE(true);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onClickCreateJE = () => createUpfrontJE.mutate();

  // ====== Tabs ======
  const tabs: TabDef[] = [
    {
      key: 'fee',
      label: 'Fee',
      render: () => (
        <div className="space-y-6">
          {/* Fee Rate cards (variant=fee uses Fee labels instead of Interest) */}
          <div>
            <h4 className="text-sm font-bold text-ink mb-2 pb-1 border-b border-line">Fee Rate</h4>
            <RateCards
              variant="fee"
              rates={form.rate_cards}
              onChange={(n) => setForm((f) => ({ ...f, rate_cards: n }))}
              showOverlimit={false}
            />
            {form.rate_cards.length > 1 && (
              <p className="text-[11px] text-muted italic mt-2">
                มีอัตราค่าธรรมเนียมหลายใบ — ระบบใช้ใบที่มีผล ณ วันที่ชำระ
                {feeRateDate ? ` (${fmtDate(feeRateDate)})` : ''} คือ {effFeeRate.toFixed(4)}% ต่อปี
              </p>
            )}
          </div>

          {/* Payment section */}
          <div>
            <h4 className="text-sm font-bold text-ink mb-2 pb-1 border-b border-line">Payment</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl">
              <div>
                <FieldLabel required>PAYMENT CYCLE</FieldLabel>
                <Select
                  value={form.payment_cycle ?? 'Quarterly'}
                  onChange={(e) => setForm((f) => ({ ...f, payment_cycle: e.target.value }))}
                >
                  {PAYMENT_CYCLES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </div>
              <div>
                <FieldLabel required>PAYMENT DATE</FieldLabel>
                <Input
                  type="date"
                  value={form.payment_date ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value || null }))}
                />
              </div>
              <div>
                <FieldLabel required>AMOUNT</FieldLabel>
                <NumInput
                  step="0.01"
                  value={form.fee_amount ?? 0}
                  onChange={(v) => setForm((f) => ({ ...f, fee_amount: v || null }))}
                  className="text-right tabular-nums"
                />
              </div>
            </div>
            {!resolvedAccounts.isFromAccounting && !upfrontPosted && (
              <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded text-xs">
                ⚠️ <strong>ใช้ Account default</strong> — แนะนำให้ไปกำหนด <strong>{resolvedAccounts.missingTypes.join(' + ')}</strong> ใน{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); document.querySelectorAll('button').forEach((b) => { if (b.textContent === 'Accounting') (b as HTMLButtonElement).click(); }); }} className="text-brand underline">tab Accounting</a> ก่อน Post JE
              </div>
            )}
            <div className="mt-3 flex items-center gap-3">
              <Button
                onClick={onClickCreateJE}
                disabled={
                  !id ||
                  createUpfrontJE.isPending ||
                  !!upfrontPosted ||
                  !form.fee_amount ||
                  !form.payment_date ||
                  !lgApproved
                }
                title={
                  !id
                    ? 'บันทึก LG/BG ก่อน'
                    : !lgApproved
                      ? `ต้องอนุมัติสัญญาก่อน — สถานะปัจจุบัน: "${form.status}"`
                      : !form.fee_amount
                        ? 'กรอกจำนวนเงินค่าธรรมเนียมก่อน'
                        : !form.payment_date
                          ? 'กรอกวันที่ชำระก่อน'
                          : upfrontPosted
                            ? `ลงบัญชีค่าธรรมเนียมแรกเข้าแล้ว: ${(upfrontPosted as any).je_number}`
                            : 'ลงบัญชีค่าธรรมเนียมแรกเข้า แล้วเปลี่ยนสถานะเป็น Active'
                }
                className={
                  upfrontPosted
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-200 cursor-not-allowed'
                    : 'bg-gray-700 text-white border-gray-700 hover:bg-gray-800'
                }
              >
                {upfrontPosted
                  ? `✓ ลงบัญชีแล้ว: ${(upfrontPosted as any).je_number}`
                  : createUpfrontJE.isPending
                    ? 'กำลังลงบัญชี…'
                    : '📋 ลงบัญชีค่าธรรมเนียมแรกเข้า'}
              </Button>
              {upfrontPosted && (
                <a
                  href={`/je/${(upfrontPosted as any).id}`}
                  className="text-brand text-xs hover:underline"
                >
                  View JE →
                </a>
              )}
            </div>
          </div>

          {/* JE Preview — uses accounts resolved from Accounting tab (or defaults) */}
          {(showJE || upfrontPosted) && form.fee_amount && (
            <div>
              <h4 className="text-sm font-bold text-ink mb-2">
                📒 Generated Journal Entry {upfrontPosted ? '(Posted)' : '(Preview)'}
              </h4>
              <div className={`border rounded p-4 ${upfrontPosted ? 'bg-emerald-50 border-emerald-200' : 'bg-soft border-line'}`}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <ThTip>Account</ThTip>
                      <ThTip align="right" tipKey="DR">Dr.</ThTip>
                      <ThTip align="right" tipKey="CR">Cr.</ThTip>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{resolvedAccounts.drGL}</td>
                      <td className="text-right tabular-nums">{fmtMoney(form.fee_amount)}</td>
                      <td className="text-right">—</td>
                    </tr>
                    <tr>
                      <td>{resolvedAccounts.crGL}</td>
                      <td className="text-right">—</td>
                      <td className="text-right tabular-nums">{fmtMoney(form.fee_amount)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-xs text-muted mt-2 italic">
                  Posting Date: {form.payment_date ? fmtDate(form.payment_date) : '—'} · {form.payment_cycle} fee ·{' '}
                  <strong>{form.prepaid ? 'Prepaid Mode' : 'Expense Mode'}</strong> · accounts{' '}
                  <strong>{resolvedAccounts.isFromAccounting ? 'จาก Accounting tab' : 'default'}</strong>
                </p>
              </div>
            </div>
          )}

          {/* Existing fee schedule table */}
          {fees.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-ink mb-2 pb-1 border-b border-line">Fee Schedule</h4>
              <table className="table-base">
                <thead>
                  <tr>
                    <ThTip>Date</ThTip>
                    <ThTip>Description</ThTip>
                    <ThTip align="right">Rate %</ThTip>
                    <ThTip align="right">Amount</ThTip>
                    <ThTip>Paid</ThTip>
                    <ThTip>Paid Date</ThTip>
                  </tr>
                </thead>
                <tbody>
                  {fees.map((f, i) => (
                    <tr key={f.id}>
                      <td>{fmtDate(f.fee_date)}</td>
                      <td>{f.description}</td>
                      <td className="text-right tabular-nums">{f.rate_pct ?? '—'}</td>
                      <td className="text-right tabular-nums">{fmtMoney(f.amount)}</td>
                      <td>{f.paid ? '✓' : '—'}</td>
                      <td>{f.paid_date ? fmtDate(f.paid_date) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-soft font-semibold">
                    <td colSpan={3} className="text-right">
                      Total
                    </td>
                    <td className="text-right tabular-nums">{fmtMoney(totalFee)}</td>
                    <td colSpan={2}>Paid: {fmtMoney(paidFee)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'acct',
      label: 'Accounting',
      render: () => (
        <AcctCards accounts={form.acct_cards} onChange={(n) => setForm((f) => ({ ...f, acct_cards: n }))} />
      ),
    },
    {
      key: 'schedule',
      label: 'Schedule Calculate',
      render: () => (
        <div>
          <div className="mb-3 text-xs flex items-center gap-2">
            {form.prepaid ? (
              <span className="px-3 py-1 rounded bg-emerald-50 text-emerald-700 font-semibold">
                Prepaid Mode
              </span>
            ) : (
              <span className="px-3 py-1 rounded bg-amber-50 text-amber-700 font-semibold">
                Expense Mode
              </span>
            )}
            <span className="text-muted">
              {form.prepaid
                ? '(ตัดบัญชี Prepaid รายเดือนตามอายุ B/G–L/G)'
                : '(ติ๊ก ☐ PREPAID ใน Primary เพื่อดูตารางตัดบัญชีรายเดือน)'}
            </span>
          </div>
          {!form.prepaid ? (
            <div className="bg-soft border border-line rounded p-6 text-center text-muted text-sm">
              <div className="text-3xl text-gray-400 mb-2">📭</div>
              <div className="font-semibold text-ink">ไม่มีตารางคำนวณ</div>
              <div className="mt-1 text-xs">
                โหมด Expense — ค่าธรรมเนียมถูกบันทึกเป็นค่าใช้จ่ายทั้งจำนวนตอนจ่ายแล้ว ไม่มีการตัดบัญชีรายงวด
              </div>
            </div>
          ) : (
            <PrepaidSchedule
              form={form}
              totalFee={form.fee_amount || totalFee || 0}
              effFeeRate={effFeeRate}
              lgId={id}
            />
          )}
        </div>
      ),
    },
    {
      key: 'balance',
      label: 'Balance Summary',
      render: () => (
        <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
          <div className="space-y-2">
            <RowTip label="Guarantee Amount" value={`${fmtMoney(form.amount)} ${form.currency}`} bold />
            <RowTip label="Fee Rate (annual)" value={`${effFeeRate.toFixed(4)}%`} />
            <RowTip label="Payment Cycle" value={form.payment_cycle ?? '—'} />
            <RowTip label="Prepaid" value={form.prepaid ? '✓ Yes' : 'No'} />
          </div>
          <div className="space-y-2">
            <RowTip label="Total Fee (Scheduled)" value={fmtMoney(totalFee)} />
            <RowTip label="Total Fee (Paid)" value={fmtMoney(paidFee)} bold />
            {refundReceived > 0 && (
              <RowTip
                label="Refund Received (Early Termination)"
                value={`(${fmtMoney(refundReceived)})`}
              />
            )}
            <RowTip
              label={refundReceived > 0 ? 'Net Cash Out' : 'Total Fee (Outstanding)'}
              value={fmtMoney(refundReceived > 0 ? (paidFee - refundReceived) : (totalFee - paidFee))}
              bold
            />
          </div>
        </div>
        <RepaymentsReceived facilityId={id} />
        </div>
      ),
    },
    {
      key: 'rollover',
      label: 'Roll Over History',
      render: () => <RolloverHistory currentId={id ?? ''} />,
    },
    {
      key: 'docs',
      label: 'Document',
      render: () => (
        <div className="space-y-6">
          {/* Inherited: MA + CA documents (read-only audit chain) */}
          <InheritedDocs caId={form.ca_id} />

          {/* Transaction-owned documents */}
          <div>
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              Transaction Documents
              <span className="text-[10px] uppercase tracking-wider text-muted bg-white border border-line px-2 py-0.5 rounded">
                LG / BG
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureLgId}
              bucketName="lg-documents"
              tableName="lg_documents"
              parentFkColumn="lg_id"
            />
          </div>
        </div>
      ),
    },
  ];

  const titleSub = mode === 'new' ? '+ New LG / BG' : form.name ?? form.lg_no;
  const canRollover = ['Approved', 'Active'].includes(form.status);
  // ยกเลิกก่อนกำหนดทำได้เฉพาะฉบับที่มีผลบังคับใช้แล้ว
  // เดิมเมนูเปิดให้กดตั้งแต่ยังเป็นฉบับร่าง ผู้ใช้กรอกข้อมูลจนครบแล้วค่อยโดนปฏิเสธตอนกดยืนยัน
  const canTerminate = ['Approved', 'Active'].includes(form.status);
  const terminateHint = canTerminate
    ? 'ยกเลิกก่อนกำหนด — คำนวณค่าธรรมเนียมคืนตามสัดส่วนวัน'
    : `ยกเลิกก่อนกำหนดได้เฉพาะฉบับที่อนุมัติแล้ว — สถานะปัจจุบัน: "${form.status}"`;
  const rolloverHint = canRollover
    ? 'ต่ออายุ — สร้างฉบับใหม่ต่อจากฉบับนี้'
    : `ต่ออายุได้เฉพาะฉบับที่อนุมัติแล้ว — สถานะปัจจุบัน: "${form.status}"`;

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/lg')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">BG-LG</h1>
          <p className="text-muted text-sm font-medium">{titleSub}</p>
        </div>

        {/* Actions menu */}
        <div ref={actionsRef} className="relative inline-block">
          <Button onClick={() => setShowActions((s) => !s)} disabled={!id}>
            <ChevronDown className="w-4 h-4" /> Actions
          </Button>
          {showActions && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-line rounded shadow-lg min-w-[220px] z-50">
              <button
                type="button"
                onClick={() => { setShowActions(false); setShowRollover(true); }}
                disabled={!canRollover || !can('lg', 'approve')}
                title={!can('lg', 'approve') ? 'ไม่มีสิทธิ์อนุมัติ' : rolloverHint}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line text-brand disabled:text-muted disabled:cursor-not-allowed"
              >
                🔁 Roll Over (ต่ออายุ)
              </button>
              <button
                type="button"
                onClick={() => { setShowActions(false); setShowTerminate(true); }}
                disabled={!canTerminate || !can('lg', 'approve')}
                title={!can('lg', 'approve') ? 'ไม่มีสิทธิ์อนุมัติ' : terminateHint}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft text-ink disabled:text-muted disabled:cursor-not-allowed"
              >
                ⚠️ Terminate B/G, L/G
              </button>
              {/* บอกเหตุผลตั้งแต่เห็นเมนู ไม่ต้องกดแล้วค่อยรู้ว่าทำไม่ได้ */}
              {(!canRollover || !canTerminate) && (
                <div className="px-4 py-2 text-[11px] text-muted border-t border-line">
                  {!canTerminate ? terminateHint : rolloverHint}
                </div>
              )}
            </div>
          )}
        </div>

        <Button variant="primary" disabled={save.isPending || !can('lg', 'edit')} title={!can('lg', 'edit') ? 'ไม่มีสิทธิ์แก้ไข LG/BG' : ''} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={() => navigate('/tx/lg')}>Cancel</Button>
      </div>

      <AuditFooter createdBy={(form as any).created_by} createdAt={(form as any).created_at} updatedBy={(form as any).updated_by} updatedAt={(form as any).updated_at} />

      <StatusLockBanner lock={lock} />

      {id && (
        <ApprovalPanel
          facilityTable="letter_guarantees"
          facilityId={id}
          currentStatus={form.status}
          statusField="status"
          approvedValue="Active"
          disableSubmit={!hasSavedInSession}
          disableSubmitHint="กรุณากด Save ก่อน (เพื่อยืนยันว่าตรวจข้อมูลแล้ว) แล้วจึงส่งขออนุมัติได้"
        />
      )}

      {/* ฉบับที่หมดอายุ/ยกเลิก/ปิดไปแล้วต้องล็อกช่องกรอกตั้งแต่เปิดหน้า ตามที่แถบเตือนด้านบนแจ้งไว้
          ไม่ใช่ปล่อยให้พิมพ์จนกดบันทึกแล้วค่อยฟ้อง — เสียเวลากรอกฟรี
          (ช่องสถานะยกเว้นไว้ เพราะต้องย้อนสถานะกลับมาแก้ไขได้) */}
      <ReadOnlyContext.Provider value={viewOnly || !savedLock.canEditFields}>
      <Section title="Primary Information">
        <PrimaryInfo form={form} setForm={setForm} caOptions={caOptions ?? []} statusReadOnly={viewOnly} />
      </Section>

      {/* ========== Classification (Financial Segment) — Migration 0049-0051 ========== */}
      <Section title="Classification">
        <ClassificationCard
          level="transaction"
          department={(form as any).department_id ? {
            id: (form as any).department_id, code: (form as any).department_code ?? '', name: (form as any).department_name ?? '',
          } : null}
          location={(form as any).location_id ? {
            id: (form as any).location_id, code: (form as any).location_code ?? '', name: (form as any).location_name ?? '',
          } : null}
          klass={(form as any).class_id_override ? {
            id: (form as any).class_id_override, code: (form as any).class_code ?? '', name: (form as any).class_name ?? '',
          } : null}
          rpt={(form as any).rpt ?? null}
          lenderVendorId={(form as any).finance_institution_id ?? null}
          inherited={inheritedSeg}
          onDepartmentChange={(v) => setForm((f) => ({ ...f, department_id: v?.id ?? null, department_code: v?.code ?? null, department_name: v?.name ?? null } as any))}
          onLocationChange={(v) => setForm((f) => ({ ...f, location_id: v?.id ?? null, location_code: v?.code ?? null, location_name: v?.name ?? null } as any))}
          onClassChange={(v) => setForm((f) => ({ ...f, class_id_override: v?.id ?? null, class_code: v?.code ?? null, class_name: v?.name ?? null } as any))}
          onRPTChange={(v) => setForm((f) => ({ ...f, rpt: v } as any))}
          disabled={viewOnly || !savedLock.canEditFields}
        />
      </Section>

      <Tabs tabs={tabs} defaultTab="fee" />
      </ReadOnlyContext.Provider>

      {/* ROLL OVER MODAL */}
      <Modal
        open={showRollover}
        onClose={() => setShowRollover(false)}
        title="🔁 Roll Over Letter of Guarantee (B/G, L/G)"
        size="lg"
        footer={
          <>
            <Button onClick={() => setShowRollover(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => rollOver.mutate()}
              disabled={rollOver.isPending || !rolloverNew.new_expiry}
            >
              {rollOver.isPending ? 'Processing...' : 'Confirm Roll Over'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-xs text-muted mb-2">ระบบจะดำเนินการต่อไปนี้เมื่อยืนยัน:</div>
            <ol className="list-decimal list-inside text-xs space-y-1 text-gray-700 ml-2">
              <li>เปลี่ยน Status ของ B/G–L/G เดิมเป็น <strong>"Roll Over"</strong></li>
              <li>สร้าง B/G–L/G ใหม่ พร้อม <strong>Reference Contract</strong> ชี้กลับมาที่ฉบับเดิม</li>
              <li>คงเงื่อนไขเดิม (Beneficiary, Guarantee Amount, Purpose) — ผู้ใช้แก้ไขได้ภายหลัง</li>
              <li><strong>เตรียม</strong>สัญญาใหม่ (Draft) — ต้องไปกด <strong>Post Fee JE</strong> บนสัญญาใหม่เพื่อออก JE: Dr. Fee Expense / Cr. AP Bank</li>
            </ol>
          </div>

          <div className="bg-brand-light border border-brand p-4 rounded">
            <h4 className="font-bold mb-3 text-brand">📋 Roll Over Plan</h4>
            <table className="w-full text-sm">
              <tbody>
                <Tr label="B/G–L/G เดิม" value={form.name ?? form.lg_no} bold />
                <Tr label="Number เดิม" value={form.lg_no} />
                <Tr label="Beneficiary" value={form.beneficiary || '—'} />
                <Tr label="Guarantee Amount" value={`${fmtMoney(form.amount)} ${form.currency}`} bold />
                <Tr label="Expiry Date เดิม" value={fmtDate(form.expiry_date)} />
                <tr><td colSpan={2} className="pt-2 border-t border-brand"></td></tr>
                <Tr
                  label="B/G–L/G ใหม่ (NAME)"
                  value={<Input value="auto — running no. (สร้างเมื่อ Confirm)" readOnly disabled />}
                />
                <Tr
                  label="Issue Date ใหม่"
                  value={
                    <Input
                      type="date"
                      value={rolloverNew.new_issue}
                      onChange={(e) => setRolloverNew((s) => ({ ...s, new_issue: e.target.value }))}
                    />
                  }
                />
                <Tr
                  label="Expiry Date ใหม่"
                  value={
                    <Input
                      type="date"
                      value={rolloverNew.new_expiry}
                      onChange={(e) => setRolloverNew((s) => ({ ...s, new_expiry: e.target.value }))}
                    />
                  }
                />
                <Tr
                  label={`Fee งวดใหม่ (${effFeeRate.toFixed(2)}%/ปี)`}
                  value={`${fmtMoney(newRolloverFee)} ${form.currency}`}
                  highlight
                  bold
                />
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {/* TERMINATE MODAL — Early Termination per MoM Day 1 §5 */}
      <Modal
        open={showTerminate}
        onClose={() => setShowTerminate(false)}
        title="⚠️ Early Termination — B/G, L/G"
        size="lg"
        footer={
          <>
            <Button onClick={() => setShowTerminate(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => terminate.mutate()}
              disabled={terminate.isPending || !termForm.notification_date}
            >
              {terminate.isPending ? 'Processing...' : 'Confirm Terminate + Refund'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded text-xs">
            <strong>⚠️ ยกเลิกก่อนกำหนด</strong> — คำนวณ Pro-rata Refund · Post JE คืนเงิน · เปลี่ยน Status เป็น "Terminated"
          </div>

          <div className="text-xs space-y-1 bg-soft p-2 rounded">
            <div>ฉบับ: <strong>{form.name ?? form.lg_no}</strong> · Beneficiary: <strong>{form.beneficiary || '—'}</strong></div>
            <div>วงเงิน: {fmtMoney(form.amount)} {form.currency} · Fee Paid: {fmtMoney(form.fee_amount ?? 0)} · Mode: <strong>{form.prepaid ? 'Prepaid' : 'Expense'}</strong></div>
            <div>Issue: {form.issue_date} → Expiry: {form.expiry_date}</div>
          </div>

          {/* Input fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel required>NOTIFICATION DATE</FieldLabel>
              <Input
                type="date"
                value={termForm.notification_date}
                onChange={(e) => setTermForm((s) => ({ ...s, notification_date: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel required>LEAD TIME (DAYS)</FieldLabel>
              <Select
                value={String(termForm.lead_time_days)}
                onChange={(e) => setTermForm((s) => ({ ...s, lead_time_days: parseInt(e.target.value) || 30 }))}
              >
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="0">No lead time</option>
              </Select>
            </div>
            <div>
              <FieldLabel>EFFECTIVE CANCEL DATE (auto)</FieldLabel>
              <Input value={effectiveCancelDate} readOnly className="bg-gray-50" />
            </div>
            <div className="col-span-3">
              <FieldLabel required>REFUND SCHEDULE</FieldLabel>
              <Select
                value={termForm.refund_schedule}
                onChange={(e) => setTermForm((s) => ({ ...s, refund_schedule: e.target.value as any }))}
              >
                <option value="One-time">One-time (คืนทันทีหลังยกเลิก)</option>
                <option value="Quarterly">Quarterly (ทุก 3 เดือน)</option>
                <option value="Semi-annual">Semi-annual (ทุก 6 เดือน)</option>
                <option value="Other">อื่นๆ (ตามตกลง)</option>
              </Select>
            </div>
          </div>

          {/* Calc breakdown */}
          <div className="bg-amber-50 border border-amber-200 p-3 rounded text-xs space-y-1">
            <div className="font-semibold text-amber-900">📐 คำนวณ Pro-rata Refund</div>
            {refundCalc.note ? (
              <div className="text-amber-700 italic">{refundCalc.note}</div>
            ) : (
              <>
                <div>Total Days (Issue → Expiry): <strong>{refundCalc.totalDays}</strong> วัน</div>
                <div>Days Used (Issue → Effective Cancel): <strong>{refundCalc.daysUsed}</strong> วัน</div>
                <div>Days Remaining: <strong>{refundCalc.daysRemaining}</strong> วัน</div>
                <div className="border-t border-amber-300 mt-1 pt-1">
                  Refund = {fmtMoney(form.fee_amount ?? 0)} × ({refundCalc.daysRemaining} ÷ {refundCalc.totalDays}) = <strong className="text-amber-900 text-base">{fmtMoney(refundCalc.refundAmount)} {form.currency}</strong>
                </div>
              </>
            )}
          </div>

          <div className="text-xs text-muted italic">
            หลัง Confirm: {form.prepaid && refundCalc.refundAmount > 0
              ? 'สร้าง LG_REFUND JE (Dr Cash / Cr Prepaid)'
              : 'ไม่มี Refund JE'} · Status: → <strong>Terminated</strong>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// =====================================================================
// Primary Information — 3 columns matching HTML
// =====================================================================
function PrimaryInfo({
  form,
  setForm,
  caOptions,
  statusReadOnly,
}: {
  form: Form;
  setForm: React.Dispatch<React.SetStateAction<Form>>;
  caOptions: { id: string; ca_name: string }[];
  /** โหมดดูอย่างเดียวของ "ช่องสถานะ" เท่านั้น — ไม่รวมการล็อกจากสถานะที่ปิดแล้ว */
  statusReadOnly?: boolean;
}) {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const { can } = useAuth(); // Approval flow
  const { id } = useParams(); // record id สำหรับปุ่มอนุมัติ
  const ro = useReadOnly(); // รับค่าล็อกจากกรอบด้านนอก (โหมดดูอย่างเดียว / ฉบับที่จบแล้ว)
  const isForeign = form.currency !== 'THB';
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
      {/* COL 1 */}
      <div className="space-y-4">
        <div>
          <FieldLabel required>FINANCE INSTITUTION</FieldLabel>
          <Select
            value={form.finance_institution}
            onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}
          >
            {bankCodes.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel required>CREDIT AGREEMENT NAME</FieldLabel>
          <Select value={form.ca_id ?? ''} onChange={async (e) => { const caId = e.target.value || null; setForm((f) => ({ ...f, ca_id: caId })); if (caId) { const cc = await fetchCaCards(caId); setForm((f) => ({ ...f, rate_cards: (f.rate_cards && (f.rate_cards as any[]).length) ? f.rate_cards : cc.rate_cards, acct_cards: (f.acct_cards && (f.acct_cards as any[]).length) ? f.acct_cards : cc.acct_cards })); } }}>
            <option value="">— เลือก —</option>
            {caOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ca_name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel>NAME (auto)</FieldLabel>
          <Input readOnly value={form.name ?? ''} placeholder="auto — running no. (สร้างเมื่อ Save)" className="bg-gray-50 text-muted" />
        </div>
        <div>
          <FieldLabel required tipKey="BANK REFERENCE">BANK REFERENCE</FieldLabel>
          <Input
            value={form.lg_no}
            onChange={(e) => setForm((f) => ({ ...f, lg_no: e.target.value }))}
            placeholder="PP112245777"
          />
        </div>
        <div>
          <FieldLabel required>START DATE</FieldLabel>
          <Input
            type="date"
            value={form.issue_date}
            onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))}
          />
        </div>
        <div>
          <FieldLabel required>END DATE</FieldLabel>
          <Input
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
          />
        </div>
      </div>

      {/* COL 2 */}
      <div className="space-y-4">
        <div>
          <FieldLabel required>AMOUNT (THB)</FieldLabel>
          <NumInput
            step="0.01"
            value={form.amount}
            onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
            className="text-right tabular-nums"
            // เลือกสกุลต่างประเทศแล้ว ยอดบาทมาจากการคำนวณ ห้ามพิมพ์ทับ
            readOnly={isForeign}
          />
          {isForeign && (
            <p className="text-[10px] text-muted italic mt-0.5">
              คำนวณจาก AMOUNT (FOREIGN) × CONVERSION RATE
            </p>
          )}
        </div>
        <div>
          <FieldLabel required>CURRENCY</FieldLabel>
          <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
            <option>THB</option>
            <option>USD</option>
            <option>EUR</option>
            <option>JPY</option>
          </Select>
        </div>
        <div className="flex items-center gap-2 pt-2">
          {/* ช่องติ๊กดิบไม่รับโหมดล็อกจากส่วนกลาง ต้องปิดเอง ไม่งั้นโหมดดูอย่างเดียวยังติ๊กได้ */}
          <input
            id="lg-prepaid"
            type="checkbox"
            checked={form.prepaid}
            disabled={ro}
            onChange={(e) => setForm((f) => ({ ...f, prepaid: e.target.checked }))}
            className="rounded disabled:cursor-not-allowed"
          />
          <label htmlFor="lg-prepaid" className={`text-sm font-semibold tracking-wide ${ro ? 'text-muted' : ''}`}>
            PREPAID
          </label>
        </div>
        <div>
          <FieldLabel required={isForeign}>AMOUNT (FOREIGN)</FieldLabel>
          <NumInput
            step="0.01"
            value={form.amount_foreign ?? 0}
            onChange={(v) => setForm((f) => ({ ...f, amount_foreign: v || null }))}
            className="text-right tabular-nums"
            readOnly={!isForeign}
          />
        </div>
        <div>
          <FieldLabel required={isForeign}>CONVERSION DATE</FieldLabel>
          <Input
            type="date"
            value={form.conversion_date ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, conversion_date: e.target.value || null }))}
            disabled={!isForeign}
          />
        </div>
        <div>
          <FieldLabel required={isForeign}>CONVERSION RATE</FieldLabel>
          <NumInput
            step="0.000001"
            value={form.conversion_rate ?? 0}
            onChange={(v) => setForm((f) => ({ ...f, conversion_rate: v || null }))}
            className="text-right tabular-nums"
            readOnly={!isForeign}
          />
        </div>
      </div>

      {/* COL 3 */}
      <div className="space-y-4">
        <div>
          <FieldLabel required>FACILITY TYPE</FieldLabel>
          <Select value={form.lg_type} onChange={(e) => setForm((f) => ({ ...f, lg_type: e.target.value }))}>
            {LG_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel required>STATUS</FieldLabel>
          {/* ช่องสถานะต้องแก้ได้เสมอแม้สัญญาจะจบไปแล้ว ไม่งั้นย้อนสถานะกลับมาแก้ไขไม่ได้เลย */}
          <ReadOnlyContext.Provider value={!!statusReadOnly}>
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
              {filterStatusOptions(LG_STATUS_DROPDOWN as readonly string[], form.status, can('lg', 'approve'), 'Active').map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </ReadOnlyContext.Provider>
              <div className="mt-2">
                <ApprovalActions menuKey="lg" table="letter_guarantees" id={id} status={form.status}
                  approvedStatus="Active" rejectStatus="Cancelled"
                  onChanged={(s) => setForm((f) => ({ ...f, status: s as any }))} />
              </div>
              <ApprovalNote remark={form.remark} />
        </div>
        <div>
          <FieldLabel required>BENEFICIARY</FieldLabel>
          <Input
            value={form.beneficiary}
            onChange={(e) => setForm((f) => ({ ...f, beneficiary: e.target.value }))}
            placeholder="การไฟฟ้านครหลวง"
          />
        </div>
        <div>
          <FieldLabel>REMARK</FieldLabel>
          {/* ช่องนี้เป็น textarea ดิบ จึงไม่รับโหมดล็อกจากส่วนกลางเหมือนช่องอื่น ต้องปิดเอง */}
          <textarea
            className="input min-h-[80px] disabled:bg-gray-50 disabled:text-muted disabled:cursor-not-allowed"
            disabled={ro}
            value={form.remark ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
          />
        </div>
        <div>
          <FieldLabel>REFERENCE CONTRACT</FieldLabel>
          <Input
            value={form.reference_contract ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, reference_contract: e.target.value || null }))}
          />
        </div>
      </div>
    </div>
  );
}

interface SchedRow {
  period: number;
  paymentDate: string | null;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  feeRate: number;
  feeAmount: number;
  guaranteeAmount: number;
  remaining: number;
}

/**
 * ตารางตัดบัญชีค่าธรรมเนียมแบบเฉลี่ยรายวัน
 * - งวด 0: แถวจ่ายเงิน (จ่ายค่าธรรมเนียมเต็มจำนวนตอนต้น)
 * - งวด 1..N: ตัดตามรอบชำระที่เลือก (รายเดือน/ราย 3 เดือน/ราย 6 เดือน/รายปี/ครั้งเดียว)
 *   เดิมแบ่งเป็นรายเดือนเสมอ รอบชำระที่เลือกไว้ไม่มีผลอะไรเลย
 */
function buildLGSchedule(
  issueDate: string,
  expiryDate: string,
  totalFee: number,
  feeRate: number,
  guaranteeAmount: number,
  paymentCycle?: string | null,
): SchedRow[] {
  if (!issueDate || !expiryDate || !totalFee) return [];
  const start = new Date(issueDate);
  const end = new Date(expiryDate);
  if (end <= start) return [];

  // Total days = days from issue → expiry, EXCLUSIVE day count
  // Matches bank actual practice (Loan Calc Table: Jan 1 → Jan 31 = 30 days, not 31)
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  const dailyRate = totalFee / totalDays;

  const rows: SchedRow[] = [
    {
      period: 0,
      paymentDate: issueDate,
      startDate: null,
      endDate: null,
      days: null,
      feeRate,
      feeAmount: totalFee,
      guaranteeAmount,
      remaining: totalFee,
    },
  ];

  let cur = new Date(start);
  let remaining = totalFee;
  let p = 1;
  // จำนวนเดือนต่องวดตามรอบชำระ · 0 = จ่ายครั้งเดียว → ตัดเป็นงวดเดียวยาวถึงวันสิ้นสุด
  const cycleMonths = CYCLE_MONTHS[paymentCycle ?? 'Monthly'] ?? 1;

  while (cur < end) {
    // สิ้นงวดตามรอบที่เลือก หรือวันสิ้นสุดสัญญาถ้ามาถึงก่อน
    const cycleEnd = cycleMonths > 0
      ? new Date(cur.getFullYear(), cur.getMonth() + cycleMonths, 0)
      : end;
    const periodEnd = cycleEnd > end ? end : cycleEnd;
    // Exclusive day count for Period 1; Period 2+ uses +1 to avoid losing the boundary day
    const days = Math.round((periodEnd.getTime() - cur.getTime()) / 86400000) + (p === 1 ? 0 : 1);
    const actualDays =
      p === 1
        ? Math.round((periodEnd.getTime() - start.getTime()) / 86400000)
        : Math.round((periodEnd.getTime() - cur.getTime()) / 86400000) + 1;
    const amt = parseFloat((dailyRate * actualDays).toFixed(2));
    remaining = parseFloat((remaining - amt).toFixed(2));
    if (remaining < 0) remaining = 0;

    rows.push({
      period: p++,
      paymentDate: null,
      startDate: fmtDateISO(cur),
      endDate: fmtDateISO(periodEnd),
      days: actualDays,
      feeRate,
      feeAmount: amt,
      guaranteeAmount,
      remaining,
    });

    cur = new Date(periodEnd);
    cur.setDate(cur.getDate() + 1);
    if (cur > end) break;
  }

  // Fix last row's remaining to exactly 0 (rounding compensation)
  if (rows.length > 1) {
    rows[rows.length - 1].remaining = 0;
  }
  return rows;
}

function PrepaidSchedule({
  form,
  totalFee,
  effFeeRate,
  lgId,
}: {
  form: Form;
  totalFee: number;
  effFeeRate: number;
  lgId?: string;
}) {
  const rows = useMemo(
    () => buildLGSchedule(form.issue_date, form.expiry_date, totalFee, effFeeRate, form.amount, form.payment_cycle),
    [form.issue_date, form.expiry_date, totalFee, effFeeRate, form.amount, form.payment_cycle],
  );

  if (rows.length === 0) {
    const missing: string[] = [];
    if (!form.issue_date) missing.push('Start Date');
    if (!form.expiry_date) missing.push('End Date');
    if (!totalFee) missing.push('Fee Amount (ใน tab Fee → Payment)');
    if (form.issue_date && form.expiry_date && new Date(form.expiry_date) <= new Date(form.issue_date)) {
      missing.push('End Date ต้องมากกว่า Start Date');
    }
    return (
      <div className="text-center text-muted py-6">
        ต้องระบุ: <strong className="text-danger">{missing.join(' / ') || 'ข้อมูลครบ — กดเปิด tab ใหม่'}</strong>
        <div className="text-xs mt-1 italic">เพื่อสร้างตารางตัดบัญชี Prepaid รายเดือน</div>
      </div>
    );
  }

  // Take a sample period for JE preview (Period 1 if exists)
  const sampleRow = rows[1];

  return (
    <PrepaidScheduleInner
      form={form}
      rows={rows}
      sampleRow={sampleRow}
      totalFee={totalFee}
      lgId={lgId}
    />
  );
}

function PrepaidScheduleInner({
  form,
  rows,
  sampleRow,
  totalFee,
  lgId,
}: {
  form: Form;
  rows: SchedRow[];
  sampleRow: SchedRow | undefined;
  totalFee: number;
  lgId?: string;
}) {
  const qc = useQueryClient();
  const innerLock = computeStatusLock('LG', form.status);

  // ผังบัญชีของการลงบัญชีรายงวด ต้องอ่านจากแท็บ Accounting เหมือนปุ่มค่าธรรมเนียมแรกเข้า
  // เดิมฝังรหัสบัญชีไว้ตายตัว → ตั้งค่าผังบัญชีไว้อย่าง แต่ใบสำคัญรายงวดออกอีกอย่าง
  const glFor = (type: string, fallback: string) => {
    const gl = (form.acct_cards as AcctCard[]).find((a) => a.type === type)?.gl ?? fallback;
    const m = gl.match(/^(\S+)\s+(.+)$/);
    return m ? { code: m[1], name: m[2] } : { code: undefined, name: gl };
  };

  // Check which periods already have ACTIVE posted JEs (net non-zero)
  // - Exclude reversal JEs (is_reversal=true) — they cancel out the original
  // - Exclude Reversed/Voided originals
  // → after reverse, period reverts to "Post JE" so user can re-post with corrected accounts
  const { data: postedPeriods } = useQuery({
    queryKey: ['je-posted-periods-lg', lgId],
    enabled: !!lgId,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('id, je_number, source_period, status, is_reversal')
        .eq('source_type', 'LG_FEE')
        .eq('source_id', lgId!);
      const map = new Map<number, { id: string; je_number: string }>();
      (data ?? []).forEach((d: any) => {
        if (
          d.status === 'Posted' &&
          d.is_reversal !== true &&
          d.source_period != null
        ) {
          map.set(d.source_period, { id: d.id, je_number: d.je_number });
        }
      });
      return map;
    },
  });

  const postPeriod = useMutation({
    mutationFn: async (r: SchedRow) => {
      if (!lgId) throw new Error('Save LG/BG ก่อน Post JE');
      if (!innerLock.canPostJE) throw new Error(`LG/BG สถานะ ${form.status} — Post JE ไม่ได้`);
      if (form.status !== 'Approved' && form.status !== 'Active') {
        throw new Error(`Post Recognition JE ได้เฉพาะ LG/BG ที่ Approved หรือ Active — Status ปัจจุบัน: "${form.status}"`);
      }
      const expense = glFor('FEE EXPENSE ACCOUNT', '5512201 L/G, B/G Expenses');
      const prepaid = glFor('PREPAID ACCOUNT', '1193 Prepaid Expenses - L/G, B/G');
      const je = await createJE({
        source_type: 'LG_FEE',
        source_id: lgId,
        source_period: r.period,
        je_date: r.endDate ?? r.paymentDate ?? form.expiry_date,
        description: `${form.name ?? form.lg_no} — Period ${r.period} Fee Recognition`,
        remark: `${r.days} วัน × daily-rate`,
        lines: [
          {
            account_code: expense.code,
            account_name: expense.name,
            dr: r.feeAmount,
            description: 'Recognize prepaid fee',
          },
          {
            account_code: prepaid.code,
            account_name: prepaid.name,
            cr: r.feeAmount,
            description: 'Reduce prepaid balance',
          },
        ],
      });
      await postJE(je.id, 'user');
      return { je, amount: r.feeAmount };
    },
    onSuccess: ({ je, amount }) => {
      qc.invalidateQueries({ queryKey: ['je-posted-periods-lg', lgId] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Posted ${je.je_number} (LG_FEE · ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <div className="overflow-x-auto max-h-[500px]">
        <table className="table-base">
          <thead className="sticky top-0 bg-white">
            <tr>
              <ThTip align="right">Period</ThTip>
              <ThTip>Payment Date</ThTip>
              <ThTip>Amortize Start Date</ThTip>
              <ThTip>Amortize End Date</ThTip>
              <ThTip align="right">Day</ThTip>
              <ThTip align="right">Fee Rate</ThTip>
              <ThTip align="right">Fee Amount</ThTip>
              <ThTip align="right">Guarantee Amount</ThTip>
              <ThTip align="right">Remaining</ThTip>
              <ThTip>JE</ThTip>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const postedJE = postedPeriods?.get(r.period);
              const isPosted = !!postedJE;
              const statusOk = form.status === 'Approved' || form.status === 'Active';
              const canPost = r.period > 0 && !isPosted && !!lgId && statusOk;
              return (
                <tr key={r.period}>
                  <td className="text-right tabular-nums">{r.period}</td>
                  <td>{r.paymentDate ? fmtDate(r.paymentDate) : '—'}</td>
                  <td>{r.startDate ? fmtDate(r.startDate) : '—'}</td>
                  <td>{r.endDate ? fmtDate(r.endDate) : '—'}</td>
                  <td className="text-right tabular-nums">{r.days ?? '—'}</td>
                  <td className="text-right tabular-nums">{r.feeRate.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.feeAmount)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.guaranteeAmount)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.remaining)}</td>
                  <td className="text-xs">
                    {r.period === 0 ? (
                      <span className="text-muted">—</span>
                    ) : isPosted && postedJE ? (
                      <a
                        href={`/je/${postedJE.id}`}
                        className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 hover:underline"
                        title={`เปิดหน้า ${postedJE.je_number}`}
                      >
                        ✓ ลงบัญชีแล้ว
                      </a>
                    ) : canPost ? (
                      <button
                        onClick={() => postPeriod.mutate(r)}
                        disabled={postPeriod.isPending}
                        className="text-brand hover:underline"
                      >
                        ลงบัญชีงวดนี้
                      </button>
                    ) : !lgId ? (
                      <span className="text-muted text-[10px]">Save first</span>
                    ) : !statusOk ? (
                      <span className="text-muted text-[10px] italic" title={`ต้อง Approved/Active ก่อน (Status: ${form.status})`}>ต้อง Approved</span>
                    ) : (
                      <span className="text-muted text-[10px]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Periodic recognition JE preview — matches HTML */}
      {sampleRow && (
        <div className="mt-5">
          <div className="font-bold text-sm mb-2">
            📒 Monthly Recognition Journal{' '}
            <span className="font-normal text-muted text-xs">
              — ตัวอย่าง Period {sampleRow.period} ({sampleRow.days} วัน × {(totalFee / Math.max(1, rows.slice(1).reduce((s, r) => s + (r.days || 0), 0))).toFixed(2)} บาท/วัน = {fmtMoney(sampleRow.feeAmount)})
            </span>
          </div>
          <div className="max-w-2xl border border-line rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand text-white">
                  <ThTip className="px-4 py-2 text-left" tipKey="JV – L/G, B/G-FEE">JV — L/G, B/G-Fee</ThTip>
                  <ThTip align="center" className="px-4 py-2 w-32">DR</ThTip>
                  <ThTip align="center" className="px-4 py-2 w-32">CR</ThTip>
                </tr>
              </thead>
              <tbody className="bg-white">
                <tr>
                  <td className="px-4 py-2">Dr. {glFor('FEE EXPENSE ACCOUNT', '5512201 L/G, B/G Expenses').name}</td>
                  <td className="px-4 py-2 text-center tabular-nums">{fmtMoney(sampleRow.feeAmount)}</td>
                  <td className="px-4 py-2 text-center">—</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Cr. {glFor('PREPAID ACCOUNT', '1193 Prepaid Expenses - L/G, B/G').name}</td>
                  <td className="px-4 py-2 text-center">—</td>
                  <td className="px-4 py-2 text-center tabular-nums">{fmtMoney(sampleRow.feeAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RolloverHistory({ currentId }: { currentId: string }) {
  const { data: chain } = useQuery({
    queryKey: ['lg-rollover-chain', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const visited: any[] = [];
      let cur: any = currentId;
      while (cur) {
        const { data } = await supabase.from('letter_guarantees').select('*').eq('id', cur).maybeSingle();
        if (!data) break;
        visited.unshift(data);
        cur = data.rollover_parent_id;
      }
      let lastId = currentId;
      while (lastId) {
        const { data } = await supabase
          .from('letter_guarantees')
          .select('*')
          .eq('rollover_parent_id', lastId)
          .maybeSingle();
        if (!data) break;
        visited.push(data);
        lastId = data.id;
      }
      return visited;
    },
  });

  if (!chain || chain.length <= 1)
    return <div className="text-center text-muted py-6 italic text-sm">ยังไม่มีประวัติ Roll Over</div>;

  return (
    <div className="overflow-x-auto">
      <p className="text-xs text-muted mb-3 italic">📌 ประวัติการ Roll Over — แสดงโซ่ของ B/G–L/G (ฉบับเดิม → ฉบับใหม่)</p>
      <table className="table-base">
        <thead>
          <tr>
            <ThTip>#</ThTip>
            <ThTip tipKey="P/N NAME">Name</ThTip>
            <ThTip tipKey="BANK REFERENCE">Number</ThTip>
            <ThTip>Issue Date</ThTip>
            <ThTip>Expiry Date</ThTip>
            <ThTip align="right">Amount</ThTip>
            <ThTip>Status</ThTip>
          </tr>
        </thead>
        <tbody>
          {chain.map((r: any, i: number) => (
            <tr key={r.id} className={r.id === currentId ? 'bg-brand-light' : ''}>
              <td>{i + 1}</td>
              <td className="font-medium">
                {r.name ?? r.lg_no}
                {r.id === currentId && <span className="ml-2 text-xs">(current)</span>}
              </td>
              <td>{r.lg_no}</td>
              <td>{fmtDate(r.issue_date)}</td>
              <td>{fmtDate(r.expiry_date)}</td>
              <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
              <td>
                <Badge variant={r.status === 'Active' || r.status === 'Approved' ? 'success' : 'warn'}>
                  {r.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div className="flex justify-between border-b border-line py-2">
      <span className="text-muted text-sm">{label}</span>
      <span className={bold ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  );
}

function Tr({ label, value, bold, highlight }: { label: string; value: any; bold?: boolean; highlight?: boolean }) {
  return (
    <tr>
      <td className="py-1 text-muted text-xs w-44">{label}:</td>
      <td className={`py-1 ${bold ? 'font-semibold' : ''} ${highlight ? 'text-brand' : ''}`}>{value}</td>
    </tr>
  );
}
