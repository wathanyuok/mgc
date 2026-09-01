import { useEffect, useMemo, useRef, useState } from 'react';
import { filterCaOptions } from '@/lib/subsidiary-scope';
import { ScopeGuard } from '@/components/shared/ScopeGuard';
import { subsidiaryOfCa } from '@/lib/scope-filter';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchCaCards } from '@/lib/ca-inherit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { CharCount, Button, Input, Select, Badge, FieldLabel, NumInput } from '@/components/ui';
import { fmtDate, fmtMoney, fmtDateISO} from '@/lib/format';
import {
  type FXForward,
  type FXFFee,
  type FXValuation,
  type FXFStatus,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';
import { createJE, postJE, type NewJELine } from '@/lib/je';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { ReadOnlyContext, useReadOnly } from '@/lib/readonly';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import {
  computeMTM,
  postFXValuationJE,
  assertNoValuationJE,
  valuationPeriod,
  pickAcctCard,
  resolveFXValuationGL,
  type FxAcctCard,
} from '@/lib/fx-valuation';
import { AuditFooter } from '@/components/AuditFooter';
import { computeStatusLock, canSaveStatusChange } from '@/lib/status-lock';
import { StatusLockBanner } from '@/components/tx/StatusLockBanner';
import { ApprovalPanel } from '@/components/tx/ApprovalPanel';
import { ClassificationCard } from '@/components/shared/ClassificationCard';
import { fetchInheritedFromCA, type InheritedSegments } from '@/lib/segment-inherit';
import { useBankCodes } from '@/lib/banks';
import { ApprovalActions, ApprovalNote, filterStatusOptions } from '@/components/shared/ApprovalActions';

import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
import { toDbPayload } from '@/lib/save-payload';
// Note: 'Approved' removed — Approval Panel now owns that transition.
const FXF_STATUSES: FXFStatus[] = ['Draft', 'Pending Approval', 'Active', 'Settled', 'Closed', 'Cancelled'];
const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'SGD'];

// สถานะที่ต้องเกิดจากการลงบัญชีเท่านั้น — เลือกเองจากช่องสถานะไม่ได้
// เดิมเลือก "ปิดสัญญา" ได้ตั้งแต่ยังเป็นร่าง ได้สัญญาที่ดูเหมือนปิดแต่ไม่มีใบสำคัญ
// และไม่เคยผ่านการอนุมัติ · ทางเดียวที่ปิดได้คือกดปุ่มปิดสัญญาซึ่งลงใบสำคัญให้ด้วย
const POSTING_DRIVEN_STATUSES: string[] = ['Settled', 'Closed'];

// ผังบัญชีตั้งต้นของโมดูลนี้ — รหัสทั้งหมดเลือกจากผังบัญชีจริงในระบบ (ตาราง gl_accounts)
// ของเดิมใช้รหัสสมมติ (100000 / 100001 / 2195100 / 7100022 / 5511101 ชื่อผิด)
// ซึ่งเกือบทั้งหมดไม่มีอยู่ในผังบัญชี ใบสำคัญจึงติดตอนส่งเข้าระบบบัญชีปลายทาง
//
// แต่ละรายการคือ [หน้าที่ของบัญชีในแท็บผังบัญชี, บัญชีที่ใช้เมื่อยังไม่ได้ผูกไว้]
const FXF_GL_MAP = {
  // ผังบัญชีไม่มีบัญชีเงินฝากกลาง มีแต่บัญชีกระแสรายวันรายธนาคาร
  // ค่าตั้งต้นจึงเป็นบัญชีกระแสรายวันหลัก — ควรผูกบัญชีที่ใช้จริงในแท็บผังบัญชีของสัญญา
  cash:    ['CASH / BANK ACCOUNT', { code: '1001201', name: 'C/A - BBL#181-3-11063-0' }],
  // ขาเงินตราต่างประเทศตอนส่งมอบ — ถ้าไม่ผูกไว้จะใช้บัญชีเดียวกับขาเงินบาท
  fcyCash: ['OTHER ACCOUNT', { code: '1001201', name: 'C/A - BBL#181-3-11063-0' }],
  fee:     ['FEE EXPENSE ACCOUNT', { code: '5511101', name: 'ค่าธรรมเนียมธนาคาร' }],
  fxGain:  ['FX GAIN ACCOUNT', { code: '4929103', name: 'กำไรจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา' }],
  fxLoss:  ['FX LOSS ACCOUNT', { code: '5439907', name: 'ขาดทุนจากการปรับปรุงอัตราแลกเปลี่ยนเงินตรา' }],
} as const satisfies Record<string, readonly [string, { code: string; name: string }]>;

type FXFGLKey = keyof typeof FXF_GL_MAP;

/**
 * ผังบัญชีที่ใบสำคัญของสัญญาใบนี้จะใช้จริง
 * อ่านจากแท็บผังบัญชีของสัญญาก่อน ถ้าไม่ได้ผูกไว้จึงตกไปใช้ค่าตั้งต้น
 * (เดิมแท็บผังบัญชีไม่มีผลอะไรเลย ใบสำคัญทุกใบใช้บัญชีตายตัว)
 */
function resolveFxfGL(cards?: FxAcctCard[] | null): Record<FXFGLKey, { code: string; name: string }> {
  const out = {} as Record<FXFGLKey, { code: string; name: string }>;
  for (const key of Object.keys(FXF_GL_MAP) as FXFGLKey[]) {
    const [acctType, fallback] = FXF_GL_MAP[key];
    out[key] = pickAcctCard(cards, acctType, fallback);
  }
  return out;
}

/** ปัดทศนิยม 2 ตำแหน่ง — ยอดเงินในใบสำคัญต้องลงตัวถึงสตางค์ ไม่งั้น Dr/Cr ไม่เท่ากัน */
function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** วันสุดท้ายของเดือนที่วันที่นั้นอยู่ — งวดตีราคาปกติจบที่สิ้นเดือน */
function lastDayOfMonthISO(d: Date): string {
  return fmtDateISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * รวมหมายเหตุที่ผู้ใช้พิมพ์ เข้ากับความเห็นของผู้อนุมัติที่ระบบบันทึกไว้แล้ว
 *
 * ขั้นตอนอนุมัติเขียนเหตุผล (ส่งกลับแก้ / ปฏิเสธ) ต่อท้ายช่องหมายเหตุในฐานข้อมูลโดยตรง
 * ถ้าผู้จัดทำกดบันทึกทีหลังโดยที่หน้าจอยังถือค่าเก่าอยู่ เหตุผลนั้นจะถูกเขียนทับหายไป
 */
const APPROVAL_NOTE_PREFIXES = ['ส่งกลับแก้:', 'ปฏิเสธ:'];
function mergeApprovalNotes(formRemark: string | null, dbRemark: string | null): string | null {
  const isApprovalNote = (s: string) => APPROVAL_NOTE_PREFIXES.some((p) => s.startsWith(p));
  const approvalNotes = (dbRemark ?? '').split(' · ').map((s) => s.trim()).filter((s) => s && isApprovalNote(s));
  const userNotes = (formRemark ?? '').split(' · ').map((s) => s.trim()).filter((s) => s && !isApprovalNote(s));
  const merged = [...userNotes, ...approvalNotes].join(' · ');
  return merged || null;
}

/** คอลัมน์ของเส้นทางอนุมัติ — การบันทึกปกติต้องไม่แตะ ไม่งั้นข้อมูลการอนุมัติหาย */
const APPROVAL_ONLY_COLUMNS = [
  'submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'rejection_reason',
] as const;

type Form = Omit<FXForward, 'id' | 'created_at' | 'updated_at'>;

const blank: Form = {
  fxf_no: '',
  name: null,
  ca_id: null,
  finance_institution: '',
  deal_date: fmtDateISO(new Date()),
  value_date: fmtDateISO(new Date()),
  transaction_date: fmtDateISO(new Date()),
  maturity_date: null,
  term_days: 180,
  direction: 'Buy',
  ccy_buy: 'USD',
  ccy_sell: 'THB',
  currency: 'USD',
  amount_buy: 0,
  amount_sell: 0,
  notional_amount_foreign: null,
  amount_thb: null,
  conversion_date: null,
  spot_rate: null,
  forward_rate: 0,
  swap_points: null,
  swap_discount: null,
  discount_mode: null,
  reference_transaction: null,
  reference_tr_contract: null,
  status: 'Draft',
  remark: null,
  acct_cards: [],
};

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  Approved: 'success',
  Active: 'success',
  Settled: 'default',
  Closed: 'default',
  Cancelled: 'danger',
};

export function FXFDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { can: rawCan, scope } = useAuth();
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  // ผู้ใช้แตะข้อมูลแล้วหรือยัง — ใช้เตือนตอนออกจากหน้าโดยยังไม่บันทึก
  // แยกจาก setForm ตรงๆ เพราะบางค่าระบบคำนวณให้เอง (วันครบกำหนด ยอดบาท คู่สกุลเงิน)
  // ถ้านับรวมด้วยจะขึ้นเตือนทั้งที่ผู้ใช้ยังไม่ได้แก้อะไรเลย
  const [dirty, setDirty] = useState(false);
  const edit: typeof setForm = (updater) => { setDirty(true); setForm(updater); };
  // กล่องยืนยันตอนปิดสัญญา — เดิมกดแล้วลงบัญชีทันทีโดยไม่ถาม
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleRate, setSettleRate] = useState(0);

  const { data: existing } = useQuery({
    queryKey: ['fxf', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('fx_forwards').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as FXForward;
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
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing;
      setForm({ ...rest, acct_cards: existing.acct_cards ?? [] });
      setDirty(false);
    }
  }, [existing]);

  // เตือนก่อนปิดแท็บ/รีเฟรช ถ้ายังมีข้อมูลที่แก้ไว้แล้วยังไม่บันทึก
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  /** ออกจากหน้านี้ — ถามก่อนถ้ายังมีข้อมูลที่ยังไม่บันทึก */
  const leavePage = () => {
    if (dirty && !window.confirm('ข้อมูลที่แก้ไว้ยังไม่ได้บันทึก — ออกจากหน้านี้เลยหรือไม่?')) return;
    navigate('/tx/fxf');
  };

  // CA options
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-fxf', scope],
    queryFn: async () => {
      const { data } = await supabase
        .from('credit_agreements')
        .select('id, ca_name, contract_number, ma_id, subsidiary').eq('status', 'Approved')
        .order('ca_name');
      // เห็นเฉพาะวงเงินของบริษัทที่ตัวเองดูแล
      return filterCaOptions(scope, data ?? []);
    },
  });

  // Auto-compute maturity = transaction + term_days
  useEffect(() => {
    if (form.transaction_date && form.term_days) {
      const d = new Date(form.transaction_date);
      d.setDate(d.getDate() + form.term_days);
      const iso = fmtDateISO(d);
      // วันส่งมอบเดินตามวันครบกำหนดให้เอง ยกเว้นผู้ใช้ตั้งวันส่งมอบไว้เองแล้ว
      // (ถ้าเขียนทับทุกครั้ง วันที่ผู้ใช้กรอกจะหายทันทีที่เปิดหน้าขึ้นมาใหม่)
      if (iso !== form.maturity_date) {
        setForm((f) => ({
          ...f,
          maturity_date: iso,
          value_date: (!f.value_date || f.value_date === f.maturity_date) ? iso : f.value_date,
        }));
      }
    }
  }, [form.transaction_date, form.term_days]);

  // Auto-compute amount_thb = notional × forward_rate
  useEffect(() => {
    if (form.notional_amount_foreign != null && form.forward_rate) {
      const calc = form.notional_amount_foreign * form.forward_rate;
      if (Math.abs(calc - (form.amount_thb ?? 0)) > 0.01) {
        setForm((f) => ({ ...f, amount_thb: parseFloat(calc.toFixed(2)) }));
      }
    }
  }, [form.notional_amount_foreign, form.forward_rate]);

  // เติมคู่สกุลเงินและยอดซื้อ/ขายให้อัตโนมัติจากทิศทางสัญญา + สกุลเงิน + จำนวนเงิน
  //
  // หน้ารายการแสดงคอลัมน์เหล่านี้ แต่หน้ารายละเอียดไม่เคยเขียนค่าลงไปเลย
  // ทุกแถวจึงขึ้น 0.0000 / 0.00 · ค่าที่ถูกต้องผูกกับข้อมูลที่กรอกอยู่แล้วแบบตายตัว
  //   ซื้อเงินตราต่างประเทศ → รับสกุลต่างประเทศ จ่ายบาท
  //   ขายเงินตราต่างประเทศ → รับบาท จ่ายสกุลต่างประเทศ
  useEffect(() => {
    const isSell = form.direction === 'Sell';
    const notional = form.notional_amount_foreign ?? 0;
    const thb = form.amount_thb ?? 0;
    const next = {
      ccy_buy: isSell ? 'THB' : form.currency,
      ccy_sell: isSell ? form.currency : 'THB',
      amount_buy: isSell ? thb : notional,
      amount_sell: isSell ? notional : thb,
    };
    if (
      next.ccy_buy !== form.ccy_buy || next.ccy_sell !== form.ccy_sell ||
      Math.abs(next.amount_buy - (form.amount_buy ?? 0)) > 0.005 ||
      Math.abs(next.amount_sell - (form.amount_sell ?? 0)) > 0.005
    ) {
      setForm((f) => ({ ...f, ...next }));
    }
  }, [form.direction, form.currency, form.notional_amount_foreign, form.amount_thb]);

  const userLabel = useCurrentUserLabel();
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
  const savedStatus = (existing?.status as string | undefined) ?? form.status;
  const lock = computeStatusLock('FXF', form.status);
  // ผังบัญชีที่ใบสำคัญทุกใบของสัญญานี้ใช้ — มาจากแท็บผังบัญชีถ้าผูกไว้ ไม่งั้นใช้ค่าตั้งต้น
  const GL = useMemo(() => resolveFxfGL(form.acct_cards as FxAcctCard[]), [form.acct_cards]);

  // Save
  // บริษัทเจ้าของรายการ — ธุรกรรมไม่ได้เก็บเอง ต้องไล่ขึ้นไปที่วงเงินที่ผูกอยู่
  // ใช้กันคนพิมพ์ลิงก์เข้าดูรายการของบริษัทที่ตัวเองไม่ได้ดูแล
  const { data: ownerSub } = useQuery({
    queryKey: ['scope-owner', 'fxf', form.ca_id],
    enabled: !!form.ca_id,
    queryFn: () => subsidiaryOfCa(form.ca_id),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!canSaveStatusChange('FXF', savedStatus, form.status))
        throw new Error(`FX Forward สถานะ ${savedStatus} — ปิดไปแล้ว แก้ไขไม่ได้ (เปลี่ยนสถานะกลับก่อน)`);
      // ช่องที่ติดจุดแดงว่าบังคับ ต้องมีค่ามากกว่า 0 จริงๆ ไม่ใช่แค่ไม่ว่าง
      // เดิมใส่ 0 แล้วบันทึกผ่าน ได้สัญญาที่คำนวณยอดบาทไม่ได้เลย
      if (!((form.forward_rate ?? 0) > 0))
        throw new Error('อัตราล่วงหน้า (Forward Rate) ต้องมากกว่า 0');
      if (!((form.notional_amount_foreign ?? 0) > 0))
        throw new Error('จำนวนเงินสกุลต่างประเทศ (Notional) ต้องมากกว่า 0');
      // เลือกวิธีคิดส่วนลดไว้แต่ไม่ใส่ส่วนลด = ตอนปิดสัญญาจะไม่คิดส่วนลดให้เงียบๆ
      if (form.discount_mode && !form.swap_discount)
        throw new Error('เลือกวิธีคิดส่วนลดไว้แล้ว แต่ยังไม่ได้กรอกส่วนลด — กรอกส่วนลด หรือเลือก "ไม่ใช้ส่วนลด"');

      // ปิดสัญญาไปแล้วและลงใบสำคัญแล้ว จะย้อนสถานะกลับมาแก้เฉยๆ ไม่ได้
      // ต้องกลับรายการใบสำคัญก่อน ไม่งั้นบัญชีกับสถานะสัญญาจะไม่ตรงกัน
      const wasTerminal = computeStatusLock('FXF', savedStatus).isTerminal;
      if (id && wasTerminal && !computeStatusLock('FXF', form.status).isTerminal) {
        const { data: settleJE } = await supabase
          .from('journal_entries')
          .select('je_number')
          .eq('source_type', 'FXF_SETTLEMENT')
          .eq('source_id', id)
          .eq('status', 'Posted')
          .eq('is_reversal', false);
        if (settleJE && settleJE.length > 0) {
          throw new Error(
            `เปิดสัญญากลับมาแก้ไม่ได้ — ใบสำคัญปิดสัญญา ${settleJE[0].je_number} ลงบัญชีไปแล้ว · ต้องกลับรายการใบสำคัญนั้นก่อน`,
          );
        }
      }

      // วงเงินของสัญญาสินเชื่อ — ยอดที่กินวงเงินคือยอดบาทของสัญญา
      await assertWithinCreditLine(form.ca_id, form.amount_thb ?? 0, { table: 'fx_forwards', id });

      // Auto-fill name (running no) — also backfills existing FXF that had empty name
      const nameFilled = (form.name ?? '').trim() || await nextRunningNo(RUNNING_PREFIX.fxf);
      const payload: Record<string, any> = { ...toDbPayload(form), name: nameFilled };
      // ห้ามส่งคอลัมน์ของเส้นทางอนุมัติไปกับการบันทึกปกติ — ไม่งั้นข้อมูลการอนุมัติหาย
      for (const k of APPROVAL_ONLY_COLUMNS) delete payload[k];

      let fxfId = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('fx_forwards').insert({ ...payload, created_by: userLabel, updated_by: userLabel }).select().single();
        if (error) throw error;
        fxfId = data.id;
      } else {
        // ความเห็นของผู้อนุมัติถูกเขียนต่อท้ายหมายเหตุในฐานข้อมูลโดยตรง
        // อ่านค่าล่าสุดมารวมก่อนบันทึก ไม่งั้นค่าเก่าบนหน้าจอจะเขียนทับ
        const { data: dbRow } = await supabase.from('fx_forwards').select('remark').eq('id', fxfId!).maybeSingle();
        payload.remark = mergeApprovalNotes(form.remark ?? null, dbRow?.remark ?? null);
        const { error } = await supabase.from('fx_forwards').update({ ...payload, updated_by: userLabel, updated_at: new Date().toISOString() }).eq('id', fxfId!);
        if (error) throw error;
      }
      // Sync local form so UI shows the auto-filled NAME after save
      setForm((f) => ({ ...f, name: nameFilled, remark: (payload.remark ?? f.remark) }));
      return fxfId;
    },
    onSuccess: (fxfId: any) => {
      logSave('fx_forwards', fxfId ?? id, form.fxf_no, mode === 'new');
      qc.invalidateQueries({ queryKey: ['fxf-list'] });
      qc.invalidateQueries({ queryKey: ['fxf', fxfId] });
      // Save happened in this session → unlock the "ส่งขออนุมัติ" button.
      setHasSavedInSession(true);
      setDirty(false);
      toast.success(mode === 'new' ? 'สร้าง FX Forward แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new' && fxfId) navigate(`/tx/fxf/${fxfId}`);
    },
    // เลขที่ซ้ำเป็นข้อผิดพลาดที่ผู้ใช้แก้เองได้ — แปลงข้อความดิบจากฐานข้อมูลให้อ่านรู้เรื่อง
    onError: (e: any) => {
      const dup = e?.code === '23505' || /duplicate key|unique constraint/i.test(e?.message ?? '');
      toast.error(
        dup
          ? `เลขที่รายการ "${form.fxf_no}" มีอยู่ในระบบแล้ว — ใช้เลขที่อื่น`
          : e.message,
      );
    },
  });

  // ── Settlement JE (Maturity — Amount THB → GL) ──
  const settleContract = useMutation({
    mutationFn: async (closeRate: number) => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      if (!can('fxf', 'approve')) throw new Error('ไม่มีสิทธิ์ปิดสัญญาซื้อขายเงินตราล่วงหน้า');
      if (!(closeRate > 0)) throw new Error('กรอกอัตราตลาด ณ วันปิดสัญญาให้มากกว่า 0');
      // ใช้ค่าที่บันทึกในฐานข้อมูลเท่านั้น — กันใบสำคัญคิดจากค่าบนหน้าจอที่ยังไม่บันทึก
      const { data: db, error: dbErr } = await supabase.from('fx_forwards').select('*').eq('id', id).single();
      if (dbErr || !db) throw new Error('อ่านข้อมูลสัญญาจากฐานข้อมูลไม่ได้ — กดบันทึกก่อนปิดสัญญา');
      if (db.status !== 'Active') {
        throw new Error(`ปิดสัญญาได้เฉพาะสถานะ Active ที่บันทึกแล้ว — ตอนนี้: "${db.status}" · ถ้าเพิ่งแก้บนหน้าจอ กดบันทึกก่อน`);
      }
      // ยังมีค่าบนหน้าจอที่ยังไม่บันทึก — ใบสำคัญต้องคิดจากข้อมูลที่บันทึกไว้เท่านั้น
      // (เดิมตรวจแค่ 3 ช่อง แล้วยังไปหยิบวันครบกำหนดกับสกุลเงินจากหน้าจอมาใช้อยู่ดี)
      const stale =
        (form.swap_discount ?? null) !== (db.swap_discount ?? null) ||
        (form.discount_mode ?? null) !== (db.discount_mode ?? null) ||
        (form.forward_rate ?? 0) !== (db.forward_rate ?? 0) ||
        (form.notional_amount_foreign ?? 0) !== (db.notional_amount_foreign ?? 0) ||
        (form.maturity_date ?? null) !== (db.maturity_date ?? null) ||
        (form.value_date ?? null) !== (db.value_date ?? null) ||
        (form.deal_date ?? null) !== (db.deal_date ?? null) ||
        (form.currency ?? '') !== (db.currency ?? '') ||
        (form.direction ?? '') !== (db.direction ?? '');
      if (stale) throw new Error('ค่าบนหน้าจอยังไม่ถูกบันทึก — กด Save ก่อนปิดสัญญา');

      const notional = db.notional_amount_foreign ?? 0;
      if (!(notional > 0)) throw new Error('จำนวนเงินสกุลต่างประเทศ (Notional) ต้องมากกว่า 0');
      if (!((db.forward_rate ?? 0) > 0)) throw new Error('อัตราล่วงหน้า (Forward Rate) ต้องมากกว่า 0');
      if (db.discount_mode && !db.swap_discount) {
        throw new Error('เลือกวิธีคิดส่วนลดไว้แล้ว แต่ยังไม่ได้กรอกส่วนลด — ระบบจะไม่คิดส่วนลดให้ · แก้ก่อนปิดสัญญา');
      }

      // อัตราสุทธิที่ใช้จ่ายจริง = อัตราล่วงหน้า + ส่วนลด
      //   เต็มจำนวน  → ใช้ส่วนลดทั้งก้อน
      //   ปันส่วน    → ส่วนลด × (จำนวนวันที่ใช้จริงตามสัญญา ÷ จำนวนวันเต็มของสัญญา)
      //
      // จำนวนวันต้องนับจากวันที่ตามสัญญา (วันทำสัญญา → วันส่งมอบ) ไม่ใช่วันที่กดปุ่ม
      // เดิมนับถึง "วันนี้" กดคนละวันจึงได้ยอดคนละอย่างสำหรับสัญญาใบเดียวกัน
      let effectiveRate = db.forward_rate ?? 0;
      let discountNote = '';
      if (db.swap_discount != null && db.discount_mode) {
        let d = db.swap_discount;
        if (db.discount_mode === 'pro_rate' && db.deal_date && db.maturity_date) {
          const day = 86400000;
          const fullDays = Math.max(1, Math.round((+new Date(db.maturity_date) - +new Date(db.deal_date)) / day));
          const usedDays = Math.min(
            fullDays,
            Math.max(0, Math.round((+new Date(db.value_date ?? db.maturity_date) - +new Date(db.deal_date)) / day)),
          );
          d = db.swap_discount * (usedDays / fullDays);
          discountNote = ` · ส่วนลดปันส่วน ${usedDays}/${fullDays} วัน = ${d.toFixed(4)}`;
        } else {
          discountNote = ` · ส่วนลดเต็มจำนวน ${d.toFixed(4)}`;
        }
        effectiveRate = (db.forward_rate ?? 0) + d;
      }
      const amountContract = round2(notional * effectiveRate);   // ยอดบาทตามสัญญา
      const amountMarket = round2(notional * closeRate);         // ยอดบาทตามอัตราตลาด ณ วันปิด
      if (!(amountContract > 0)) throw new Error('ยอดบาทตามสัญญาต้องมากกว่า 0 — ตรวจจำนวนเงิน อัตราล่วงหน้า และส่วนลด');

      // มีใบสำคัญปิดสัญญาอยู่แล้วหรือยัง (ไม่นับใบที่ถูกกลับรายการไปแล้ว)
      const { data: existingJE } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'FXF_SETTLEMENT')
        .eq('source_id', id)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (existingJE && existingJE.length > 0) {
        throw new Error(`สัญญานี้ปิดไปแล้ว — ใบสำคัญเลขที่ ${existingJE[0].je_number}`);
      }

      // จองสิทธิ์ปิดสัญญาด้วยการเปลี่ยนสถานะแบบมีเงื่อนไขก่อนลงบัญชี
      // ถ้ามีอีกหน้าต่างกดพร้อมกัน จะมีแค่หน้าต่างเดียวที่เปลี่ยนสถานะสำเร็จ
      const { data: claimed } = await supabase
        .from('fx_forwards')
        .update({ status: 'Settled', updated_by: userLabel, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'Active')
        .select('id');
      if (!claimed || claimed.length === 0) {
        throw new Error('สัญญานี้ถูกปิดไปแล้ว (อาจกดจากอีกหน้าต่างหนึ่ง) — รีเฟรชหน้าจอแล้วตรวจอีกครั้ง');
      }

      try {
        // ผลต่างระหว่างอัตราตามสัญญากับอัตราตลาด ณ วันปิด = กำไร/ขาดทุนที่เกิดขึ้นจริง
        //   ซื้อเงินตราต่างประเทศ → ตลาดสูงกว่าสัญญา = กำไร (ซื้อได้ถูกกว่าตลาด)
        //   ขายเงินตราต่างประเทศ → ตลาดต่ำกว่าสัญญา = กำไร (ขายได้แพงกว่าตลาด)
        const realized = round2(db.direction === 'Sell' ? amountContract - amountMarket : amountMarket - amountContract);
        const isGain = realized > 0;
        const pl = isGain ? GL.fxGain : GL.fxLoss;
        const fcyText = `${notional.toLocaleString()} ${db.currency}`;

        // ทิศ Dr/Cr ต้องกลับด้านตามทิศทางสัญญา
        // เดิมได้ใบสำคัญเหมือนกันเป๊ะทั้งซื้อและขาย ทั้งที่ตอนตีราคายังดูทิศทางให้
        const lines: NewJELine[] = db.direction === 'Sell'
          ? [
              { account_code: GL.cash.code, account_name: GL.cash.name, dr: amountContract, description: `รับเงินบาทตามอัตราสุทธิ ${effectiveRate.toFixed(4)}` },
              { account_code: GL.fcyCash.code, account_name: GL.fcyCash.name, cr: amountMarket, description: `ส่งมอบ ${fcyText} ตีเป็นบาทที่อัตราตลาด ${closeRate.toFixed(4)}` },
            ]
          : [
              { account_code: GL.fcyCash.code, account_name: GL.fcyCash.name, dr: amountMarket, description: `รับ ${fcyText} ตีเป็นบาทที่อัตราตลาด ${closeRate.toFixed(4)}` },
              { account_code: GL.cash.code, account_name: GL.cash.name, cr: amountContract, description: `จ่ายเงินบาทตามอัตราสุทธิ ${effectiveRate.toFixed(4)}` },
            ];
        const plAmount = Math.abs(realized);
        if (plAmount >= 0.005) {
          lines.push(
            isGain
              ? { account_code: pl.code, account_name: pl.name, cr: plAmount, description: 'กำไรจากอัตราแลกเปลี่ยนที่เกิดขึ้นจริง ณ วันปิดสัญญา' }
              : { account_code: pl.code, account_name: pl.name, dr: plAmount, description: 'ขาดทุนจากอัตราแลกเปลี่ยนที่เกิดขึ้นจริง ณ วันปิดสัญญา' },
          );
        }

        const je = await createJE({
          source_type: 'FXF_SETTLEMENT',
          source_id: id,
          je_date: db.value_date ?? db.maturity_date ?? fmtDateISO(new Date()),
          description: `${db.name ?? db.fxf_no} — ปิดสัญญาซื้อขายเงินตราล่วงหน้า`,
          remark:
            `${fcyText} · อัตราสุทธิตามสัญญา ${effectiveRate.toFixed(4)} = ${amountContract.toLocaleString()} บาท` +
            ` · อัตราตลาด ณ วันปิด ${closeRate.toFixed(4)} = ${amountMarket.toLocaleString()} บาท` +
            ` · ${isGain ? 'กำไร' : 'ขาดทุน'}ที่เกิดขึ้นจริง ${plAmount.toLocaleString()} บาท${discountNote}`,
          lines,
        });
        await postJE(je.id, 'user');
        return je;
      } catch (err) {
        // ลงบัญชีไม่สำเร็จ ต้องคืนสถานะกลับ ไม่งั้นสัญญาจะค้างเป็นปิดแล้วแต่ไม่มีใบสำคัญ
        await supabase.from('fx_forwards').update({ status: 'Active' }).eq('id', id);
        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fxf-je', id] });
      qc.invalidateQueries({ queryKey: ['fxf', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Settled' }));
      setSettleOpen(false);
      setSettleRate(0);
      toast.success('✓ ปิดสัญญาแล้ว · ลงใบสำคัญพร้อมกำไร/ขาดทุนที่เกิดขึ้นจริงเรียบร้อย');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const ensureFxfId = async (): Promise<string> => {
    if (id) return id;
    if (!can('fxf', 'edit')) throw new Error('ไม่มีสิทธิ์แก้ไขสัญญาซื้อขายเงินตราล่วงหน้า');
    // ต้องกรอกช่องที่จำเป็นให้ครบก่อน แล้วสร้างผ่านเส้นทางบันทึกปกติ
    //
    // เดิมแนบไฟล์ตั้งแต่ยังไม่กรอกอะไร ระบบก็สร้างรายการให้เงียบๆ
    // ได้รายการเลขที่ขึ้นต้นด้วย DRAFT- โผล่ในหน้ารายการทันทีโดยผู้ใช้ไม่รู้ตัว
    if (!checkRequiredFields()) throw new Error('กรอกข้อมูลที่จำเป็นให้ครบก่อนแนบไฟล์');
    if (!(form.fxf_no ?? '').trim()) throw new Error('กรอกเลขที่รายการก่อนแนบไฟล์');
    const newId = await save.mutateAsync();
    if (!newId) throw new Error('สร้างรายการไม่สำเร็จ — ลองกดบันทึกอีกครั้ง');
    return newId;
  };

  // =========== Tabs ===========
  const tabs: TabDef[] = [
    {
      key: 'acct',
      label: 'Accounting',
      render: () => (
        <AcctCards
          accounts={form.acct_cards as AcctCard[]}
          onChange={(n) => edit((f) => ({ ...f, acct_cards: n }))}
        />
      ),
    },
    {
      key: 'fee',
      label: 'Fee Payment',
      render: () => (
        <FeePaymentTab
          fxfId={id}
          fxfName={form.name ?? form.fxf_no}
          fxfStatus={form.status}
          gl={GL}
          canPost={can('fxf', 'edit') && lock.canPostJE}
        />
      ),
    },
    {
      key: 'fair',
      label: 'Fair Value',
      render: () => (
        <FairValueTab
          fxfId={id}
          fxfNo={form.fxf_no}
          fxfName={form.name ?? form.fxf_no}
          fxfStatus={form.status}
          notional={form.notional_amount_foreign ?? 0}
          contractRate={form.forward_rate ?? 0}
          amountThb={form.amount_thb ?? 0}
          direction={form.direction ?? 'Buy'}
          currency={form.currency}
          cards={form.acct_cards as FxAcctCard[]}
          canPost={can('fxf', 'edit') && lock.canPostJE}
        />
      ),
    },
    {
      key: 'docs',
      label: 'Document',
      render: () => (
        <div className="space-y-6">
          <InheritedDocs caId={form.ca_id} />
          <div>
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              Transaction Documents
              <span className="text-[10px] uppercase tracking-wider text-muted bg-white border border-line px-2 py-0.5 rounded">
                FX Forward
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureFxfId}
              bucketName="fxf-documents"
              tableName="fxf_documents"
              parentFkColumn="fxf_id"
            />
          </div>
        </div>
      ),
    },
  ];

  const selectedCa = caOptions?.find((c) => c.id === form.ca_id);

  return (
    <ScopeGuard skip={mode === 'new'} subsidiary={mode === 'edit' && !form.ca_id ? undefined : ownerSub}>
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={leavePage}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            FX Forward
            <Badge variant={statusVariant[form.status] ?? 'default'}>{form.status}</Badge>
          </h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New FX Forward' : (form.name ?? form.fxf_no)}
          </p>
        </div>
        <Button
          onClick={() => { setSettleRate(form.spot_rate ?? 0); setSettleOpen(true); }}
          disabled={!id || settleContract.isPending || form.status !== 'Active' || !can('fxf', 'approve') || dirty}
          title={
            !id
              ? 'บันทึกก่อน'
              : form.status !== 'Active'
                ? `ปิดสัญญาได้เฉพาะสถานะ Active — ตอนนี้: "${form.status}"`
                : dirty
                  ? 'ยังมีข้อมูลที่แก้ไว้แล้วยังไม่บันทึก — กดบันทึกก่อนปิดสัญญา'
                  : `ปิดสัญญา · ยอดตามสัญญา ${fmtMoney(form.amount_thb ?? 0)} บาท`
          }
          className="bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800 disabled:opacity-50"
        >
          💱 {settleContract.isPending ? 'กำลังปิดสัญญา…' : 'ปิดสัญญา'}
        </Button>
        <Button variant="primary" disabled={save.isPending || !can('fxf', 'edit')} title={!can('fxf', 'edit') ? 'ไม่มีสิทธิ์แก้ไข FX Forward' : ''} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={leavePage}>Cancel</Button>
      </div>

      {/* กล่องยืนยันปิดสัญญา — ถามก่อนลงบัญชี และรับอัตราตลาด ณ วันปิดมาคิดกำไร/ขาดทุนที่เกิดขึ้นจริง */}
      {settleOpen && (
        <SettleDialog
          form={form}
          rate={settleRate}
          onRate={setSettleRate}
          busy={settleContract.isPending}
          onCancel={() => setSettleOpen(false)}
          onConfirm={() => settleContract.mutate(settleRate)}
        />
      )}

      <AuditFooter createdBy={(form as any).created_by} createdAt={(form as any).created_at} updatedBy={(form as any).updated_by} updatedAt={(form as any).updated_at} />

      <StatusLockBanner lock={lock} />

      {id && (
        <ApprovalPanel
          facilityTable="fx_forwards"
          facilityId={id}
          currentStatus={form.status}
          statusField="status"
          approvedValue="Active"
          disableSubmit={!hasSavedInSession}
          disableSubmitHint="กรุณากด Save ก่อน (เพื่อยืนยันว่าตรวจข้อมูลแล้ว) แล้วจึงส่งขออนุมัติได้"
        />
      )}

      <Section title="Primary Information">
        {/* สัญญาที่ปิดไปแล้วต้องแก้ช่องต่างๆ ไม่ได้ — เหลือให้แตะได้เฉพาะช่องสถานะ (ไว้ย้อนกลับมาแก้)
            ช่องสถานะจึงอยู่นอกกรอบนี้ */}
        <ReadOnlyContext.Provider value={viewOnly || lock.isTerminal}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <div>
              {/* เลือกวงเงินแล้วธนาคารตามมาให้เอง แต่ยังแก้เองได้ตามที่เอกสารข้อกำหนดระบุ
                  (ระบุ read-only ไว้เฉพาะชั้นวงเงินเท่านั้น ไม่ใช่ชั้นรายการธุรกรรม) */}
                  <FieldLabel required>FINANCE INSTITUTION</FieldLabel>
              <Select
                value={form.finance_institution}
                onChange={(e) => edit((f) => ({ ...f, finance_institution: e.target.value }))}
              >
                <option value="">— เลือกสถาบันการเงิน —</option>
                {bankCodes.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel required tipKey="CREDIT AGREEMENT NAME">CREDIT AGREEMENT NAME</FieldLabel>
              <Select
                value={form.ca_id ?? ''}
                onChange={async (e) => { const caId = e.target.value || null; edit((f) => ({ ...f, ca_id: caId })); if (caId) { const cc = await fetchCaCards(caId); edit((f) => ({ ...f, finance_institution: cc.fi || f.finance_institution, acct_cards: (f.acct_cards && (f.acct_cards as any[]).length) ? f.acct_cards : cc.acct_cards })); } }}
              >
                <option value="">— เลือก —</option>
                {caOptions?.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.ca_name}
                  </option>
                ))}
              </Select>
              {selectedCa && (
                <p className="text-xs text-muted mt-1">
                  → <a className="text-brand hover:underline" href={`/ca/${selectedCa.id}`}>{(selectedCa as any).ca_name}</a>
                </p>
              )}
            </div>
            <div>
              <FieldLabel tipKey="FXF NAME">NAME (auto)</FieldLabel>
              <Input readOnly value={form.name ?? ''} placeholder="auto — running no. (สร้างเมื่อ Save)" className="bg-gray-50 text-muted" />
            </div>
            <div>
              <FieldLabel tipKey="BANK REFERENCE">TRANSACTION NUMBER</FieldLabel>
              <Input
                value={form.fxf_no}
                onChange={(e) => edit((f) => ({ ...f, fxf_no: e.target.value }))}
                placeholder="FWC0001"
              />
            </div>
            <div>
              <FieldLabel required tipKey="TRANSACTION DATE">TRANSACTION DATE</FieldLabel>
              <Input
                type="date"
                value={form.transaction_date ?? ''}
                onChange={(e) => edit((f) => ({ ...f, transaction_date: e.target.value || null }))}
              />
            </div>
            {/* วันทำสัญญา — เดิมไม่มีช่องให้กรอก ระบบตั้งเป็นวันที่สร้างรายการเสมอ
                ทั้งที่เป็นตัวตั้งต้นของการปันส่วนส่วนลดตามจำนวนวัน */}
            <div>
              <FieldLabel required tip="วันที่ตกลงทำสัญญากับธนาคาร — ใช้เป็นวันเริ่มนับจำนวนวันของส่วนลดแบบปันส่วน">DEAL DATE</FieldLabel>
              <Input
                type="date"
                value={form.deal_date ?? ''}
                onChange={(e) => edit((f) => ({ ...f, deal_date: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel required tipKey="TERM (DAYS)">TERM (DAYS)</FieldLabel>
              <NumInput value={form.term_days ?? 0} onChange={(v) => edit((f) => ({ ...f, term_days: v }))} />
            </div>
            <div>
              <FieldLabel tipKey="MATURITY DATE">MATURITY DATE</FieldLabel>
              <Input
                type="date"
                value={form.maturity_date ?? ''}
                onChange={(e) => edit((f) => ({ ...f, maturity_date: e.target.value || null }))}
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = Transaction Date + Term (Days)</p>
            </div>
            <div>
              <FieldLabel tip="วันส่งมอบเงินตามสัญญา — ตั้งตามวันครบกำหนดให้อัตโนมัติ แก้ได้ถ้าส่งมอบก่อนกำหนด">VALUE DATE</FieldLabel>
              <Input
                type="date"
                value={form.value_date ?? ''}
                onChange={(e) => edit((f) => ({ ...f, value_date: e.target.value }))}
              />
            </div>
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel>FACILITY TYPE</FieldLabel>
              <Input readOnly value="FX Forward" className="bg-gray-50" />
            </div>
            <div>
              <FieldLabel required>DIRECTION</FieldLabel>
              <Select
                value={form.direction ?? 'Buy'}
                onChange={(e) => edit((f) => ({ ...f, direction: e.target.value as 'Buy' | 'Sell' }))}
              >
                <option value="Buy">Buy ({form.currency}) — ซื้อสกุลต่างประเทศ · จ่าย THB</option>
                <option value="Sell">Sell ({form.currency}) — ขายสกุลต่างประเทศ · รับ THB</option>
              </Select>
              <p className="text-[10px] text-muted mt-0.5 italic">มีผลต่อทิศ Dr/Cr ของใบสำคัญทั้งตอนตีราคาและตอนปิดสัญญา</p>
            </div>
            <div>
              <FieldLabel required>CURRENCY</FieldLabel>
              <Select value={form.currency} onChange={(e) => edit((f) => ({ ...f, currency: e.target.value }))}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel required>NOTIONAL AMOUNT (FOREIGN)</FieldLabel>
              <NumInput
                value={form.notional_amount_foreign ?? 0}
                onChange={(v) => edit((f) => ({ ...f, notional_amount_foreign: v }))}
              />
            </div>
            <div>
              <FieldLabel tipKey="CONVERSION DATE">CONVERSION DATE</FieldLabel>
              <Input
                type="date"
                value={form.conversion_date ?? ''}
                onChange={(e) => edit((f) => ({ ...f, conversion_date: e.target.value || null }))}
              />
            </div>
            <div>
              <FieldLabel required>FORWARD RATE</FieldLabel>
              <NumInput
                value={form.forward_rate ?? 0}
                onChange={(v) => edit((f) => ({ ...f, forward_rate: v }))}
                placeholder="35.0000"
              />
            </div>
            <div>
              <FieldLabel>AMOUNT (THB)</FieldLabel>
              <NumInput
                value={form.amount_thb ?? 0}
                onChange={(v) => edit((f) => ({ ...f, amount_thb: v }))}
                readOnly
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = Notional × Forward Rate</p>
            </div>
            <div>
              <FieldLabel required tipKey="SPOT RATE">SPOT RATE</FieldLabel>
              <NumInput
                value={form.spot_rate ?? 0}
                onChange={(v) => edit((f) => ({ ...f, spot_rate: v }))}
                placeholder="36.0000"
              />
            </div>
            {/* Swap Discount / Net Rate */}
            <div>
              <FieldLabel tip="ส่วนลดที่ธนาคารตกลง ณ วันทำสัญญา (บาทต่อ 1 หน่วยเงินตราต่างประเทศ เช่น -0.1) — ใช้คำนวณอัตราสุทธิตอนจ่ายจริง">SWAP DISCOUNT</FieldLabel>
              <NumInput
                allowNegative
                value={form.swap_discount ?? 0}
                onChange={(v) => edit((f) => ({ ...f, swap_discount: v === 0 ? null : v }))}
                placeholder="-0.1000"
              />
            </div>
            <div>
              <FieldLabel tip="เต็มจำนวน = ใช้ส่วนลดทั้งก้อนเมื่อจ่าย ณ วันครบกำหนด · ปันส่วน = เฉลี่ยตามจำนวนวันที่ใช้จริงตามสัญญา (ตามเงื่อนไขแต่ละธนาคาร)">DISCOUNT MODE</FieldLabel>
              <Select
                value={form.discount_mode ?? ''}
                onChange={(e) => edit((f) => ({ ...f, discount_mode: (e.target.value || null) as any }))}
              >
                <option value="">— ไม่ใช้ส่วนลด —</option>
                <option value="full_at_last_date">เต็มจำนวน ณ วันครบกำหนด</option>
                <option value="pro_rate">ปันส่วนตามวันใช้จริง</option>
              </Select>
              {form.swap_discount != null && form.discount_mode && (
                <p className="text-[10px] text-muted mt-0.5 italic">
                  ⚙ อัตราสุทธิ ณ วันครบกำหนด = {(form.forward_rate ?? 0).toFixed(4)} + ({form.swap_discount.toFixed(4)}) ={' '}
                  {((form.forward_rate ?? 0) + form.swap_discount).toFixed(4)}
                </p>
              )}
              {/* เลือกวิธีคิดส่วนลดไว้แต่ไม่ใส่ส่วนลด = ตอนปิดสัญญาจะไม่คิดส่วนลดให้เงียบๆ */}
              {form.discount_mode && !form.swap_discount && (
                <p className="text-[11px] text-danger mt-1 font-medium">
                  ⚠ เลือกวิธีคิดส่วนลดไว้แล้ว แต่ยังไม่ได้กรอกส่วนลด — ตอนปิดสัญญาระบบจะไม่คิดส่วนลดให้
                </p>
              )}
            </div>

            {/* คู่สกุลเงินและยอดซื้อ/ขาย — ระบบเติมให้จากทิศทางสัญญา สกุลเงิน และจำนวนเงิน
                เพื่อให้หน้ารายการแสดงตรงกับข้อมูลจริงเสมอ (เดิมทุกแถวขึ้น 0) */}
            <div className="rounded border border-line bg-soft p-3 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                คู่สกุลเงิน / ยอดซื้อ-ขาย (ระบบเติมให้)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>CCY BUY</FieldLabel>
                  <Input readOnly value={form.ccy_buy ?? ''} className="bg-gray-50" />
                </div>
                <div>
                  <FieldLabel>CCY SELL</FieldLabel>
                  <Input readOnly value={form.ccy_sell ?? ''} className="bg-gray-50" />
                </div>
                <div>
                  <FieldLabel>AMOUNT BUY</FieldLabel>
                  <NumInput readOnly value={form.amount_buy ?? 0} className="bg-gray-50" onChange={() => {}} />
                </div>
                <div>
                  <FieldLabel>AMOUNT SELL</FieldLabel>
                  <NumInput readOnly value={form.amount_sell ?? 0} className="bg-gray-50" onChange={() => {}} />
                </div>
              </div>
              <p className="text-[10px] text-muted italic">
                {form.direction === 'Sell'
                  ? 'ขายสกุลต่างประเทศ → รับบาท จ่ายสกุลต่างประเทศ'
                  : 'ซื้อสกุลต่างประเทศ → รับสกุลต่างประเทศ จ่ายบาท'} · ยอดบาท = จำนวนเงิน × อัตราล่วงหน้า
              </p>
            </div>
          </div>

          {/* COL 3 */}
          <div className="space-y-4">
            {/* ช่องสถานะอยู่นอกกรอบล็อกด้านบน เพื่อให้ย้อนสถานะของสัญญาที่ปิดแล้วกลับมาแก้ได้ */}
            <ReadOnlyContext.Provider value={viewOnly}>
              <div>
                <FieldLabel required>STATUS</FieldLabel>
                <Select value={form.status} onChange={(e) => edit((f) => ({ ...f, status: e.target.value as FXFStatus }))}>
                  {filterStatusOptions(FXF_STATUSES as readonly string[], form.status, can('fxf', 'approve'), 'Active')
                    .filter((s) => s === form.status || !POSTING_DRIVEN_STATUSES.includes(s))
                    .map((s) => <option key={s}>{s}</option>)}
                </Select>
                <p className="text-[10px] text-muted mt-0.5 italic">
                  สถานะปิดสัญญาเลือกเองไม่ได้ — เกิดจากการกดปุ่มปิดสัญญาซึ่งลงใบสำคัญให้พร้อมกัน
                </p>
                <div className="mt-2">
                  <ApprovalActions menuKey="fxf" table="fx_forwards" id={id} status={form.status}
                    approvedStatus="Active" rejectStatus="Cancelled"
                    onChanged={(s) => { setForm((f) => ({ ...f, status: s as any })); qc.invalidateQueries({ queryKey: ['fxf', id] }); }} />
                </div>
                <ApprovalNote remark={form.remark} />
              </div>
            </ReadOnlyContext.Provider>
            <div>
              <FieldLabel>REMARK</FieldLabel>
              <textarea maxLength={2000}
                className="input min-h-[60px]"
                value={form.remark ?? ''}
                disabled={viewOnly || lock.isTerminal}
                onChange={(e) => edit((f) => ({ ...f, remark: e.target.value || null }))}
                placeholder="หมายเหตุ"
              />
              <CharCount value={form.remark ?? ''} max={2000} />
            </div>
            <div>
              <FieldLabel>REFERENCE TRANSACTION</FieldLabel>
              <Input
                value={form.reference_transaction ?? ''}
                onChange={(e) => edit((f) => ({ ...f, reference_transaction: e.target.value || null }))}
                placeholder="INV2024100005"
              />
            </div>
            <div>
              <FieldLabel>REFERENCE T/R CONTRACT</FieldLabel>
              <Input
                value={form.reference_tr_contract ?? ''}
                onChange={(e) => edit((f) => ({ ...f, reference_tr_contract: e.target.value || null }))}
                placeholder=""
              />
            </div>
          </div>
        </div>
        </ReadOnlyContext.Provider>
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
          onDepartmentChange={(v) => edit((f) => ({ ...f, department_id: v?.id ?? null, department_code: v?.code ?? null, department_name: v?.name ?? null } as any))}
          onLocationChange={(v) => edit((f) => ({ ...f, location_id: v?.id ?? null, location_code: v?.code ?? null, location_name: v?.name ?? null } as any))}
          onClassChange={(v) => edit((f) => ({ ...f, class_id_override: v?.id ?? null, class_code: v?.code ?? null, class_name: v?.name ?? null } as any))}
          onRPTChange={(v) => edit((f) => ({ ...f, rpt: v } as any))}
          disabled={viewOnly || lock.isTerminal}
        />
      </Section>

      {/* Section title (ตาม HTML) */}
      <div className="text-sm font-bold text-ink mt-5 mb-2 pl-1">บันทึก Credit Transaction</div>

      <div>
        <Tabs tabs={tabs} />
      </div>
    </div>
    </ScopeGuard>
  );
}

// ============== กล่องยืนยันปิดสัญญา ==============
//
// เดิมกดปุ่มปิดสัญญาแล้วลงบัญชีทันทีโดยไม่ถามอะไรเลย และไม่มีที่ให้กรอกอัตราตลาด ณ วันปิด
// จึงลงใบสำคัญด้วยอัตราตามสัญญาตรงๆ ไม่มีบรรทัดกำไร/ขาดทุนที่เกิดขึ้นจริงเลย
//
// อัตราตลาด ณ วันปิดยังไม่มีคอลัมน์เก็บในตาราง จึงรับค่าที่กล่องนี้แล้วบันทึกไว้ในใบสำคัญแทน
function SettleDialog({
  form, rate, onRate, busy, onCancel, onConfirm,
}: {
  form: Form;
  rate: number;
  onRate: (v: number) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const notional = form.notional_amount_foreign ?? 0;
  const netRate = (form.forward_rate ?? 0) + (form.discount_mode ? (form.swap_discount ?? 0) : 0);
  const amountContract = round2(notional * netRate);
  const amountMarket = round2(notional * rate);
  const realized = round2(form.direction === 'Sell' ? amountContract - amountMarket : amountMarket - amountContract);
  const isGain = realized > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-[2px] p-4"
      onClick={() => !busy && onCancel()}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-black/5" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6">
          <h3 className="text-base font-semibold text-gray-900">ยืนยันปิดสัญญาซื้อขายเงินตราล่วงหน้า</h3>
          <p className="mt-1 text-[13px] leading-5 text-gray-500">
            ระบบจะลงใบสำคัญปิดสัญญาและเปลี่ยนสถานะเป็น Settled — ย้อนกลับได้ด้วยการกลับรายการใบสำคัญเท่านั้น
          </p>

          <div className="mt-4 rounded-xl border border-line bg-soft p-3 text-[13px] space-y-1">
            <RowTip label="จำนวนเงิน" value={`${fmtMoney(notional)} ${form.currency}`} />
            <RowTip label="อัตราสุทธิตามสัญญา" value={netRate.toFixed(4)} />
            <RowTip label="ยอดบาทตามสัญญา" value={fmtMoney(amountContract)} bold />
          </div>

          <div className="mt-4">
            <FieldLabel required tip="อัตราตลาด ณ วันที่ปิดสัญญา — ใช้คำนวณกำไร/ขาดทุนที่เกิดขึ้นจริง">
              อัตราตลาด ณ วันปิดสัญญา
            </FieldLabel>
            <NumInput value={rate} onChange={onRate} placeholder="เช่น 35.8000" />
          </div>

          {rate > 0 && (
            <div className="mt-3 rounded-xl border border-line p-3 text-[13px] space-y-1">
              <RowTip label="ยอดบาทตามอัตราตลาด" value={fmtMoney(amountMarket)} />
              <RowTip
                label={isGain ? 'กำไรที่เกิดขึ้นจริง' : 'ขาดทุนที่เกิดขึ้นจริง'}
                value={
                  <span className={isGain ? 'text-emerald-700 font-bold' : 'text-danger font-bold'}>
                    {fmtMoney(Math.abs(realized))}
                  </span>
                }
              />
            </div>
          )}
        </div>
        <div className="mt-5 flex gap-2 border-t border-gray-100 px-6 py-4">
          <button type="button" disabled={busy} onClick={onCancel}
            className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            ยกเลิก
          </button>
          <button type="button" disabled={busy || !(rate > 0)} onClick={onConfirm}
            className="flex-1 rounded-xl bg-emerald-700 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40">
            {busy ? 'กำลังปิดสัญญา…' : 'ยืนยันปิดสัญญา'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============== Contract Summary Card ==============
function ContractSummaryCard({ form }: { form: Form }) {
  const notional = form.notional_amount_foreign ?? 0;
  const forward = form.forward_rate ?? 0;
  const spot = form.spot_rate ?? 0;

  const amountTHB = form.amount_thb ?? notional * forward;
  const spotValue = notional * spot;
  const rateDiff = spot - forward; // positive = spot higher than forward
  const initialFairValue = notional * rateDiff; // Buyer's perspective: positive = locked at cheaper rate (gain)
  const isGain = initialFairValue > 0;
  const isLoss = initialFairValue < 0;

  // Days remaining
  let daysToMaturity = 0;
  let isMatured = false;
  if (form.maturity_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const mat = new Date(form.maturity_date);
    daysToMaturity = Math.round((mat.getTime() - today.getTime()) / 86400000);
    isMatured = daysToMaturity < 0;
  }

  const hasData = notional > 0 && forward > 0;

  return (
    <div className="mt-4 bg-gradient-to-r from-blue-50 via-white to-amber-50 border border-line rounded-lg overflow-hidden">
      <div className="bg-brand text-white px-4 py-2 text-sm font-bold flex items-center gap-2">
        Contract Summary
      </div>

      {!hasData ? (
        <div className="p-6 text-center text-muted text-sm italic">
          กรอก <strong>Notional Amount (Foreign)</strong> + <strong>Forward Rate</strong> ใน Primary Info เพื่อแสดงสรุป
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Block 1 — Settlement Amount */}
          <div className="bg-white border border-line rounded p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
              💰 ยอดที่ต้องเตรียม ณ Maturity
            </div>
            <div className="text-2xl font-bold text-brand tabular-nums">
              {fmtMoney(amountTHB)}
            </div>
            <div className="text-xs text-muted">THB</div>
            <div className="text-[10px] text-muted mt-1.5 italic">
              = {fmtMoney(notional)} {form.currency} × {forward.toFixed(4)}
            </div>
          </div>

          {/* Block 2 — Settle Date */}
          <div className="bg-white border border-line rounded p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
              📅 วันที่ Settle
            </div>
            <div className={`text-2xl font-bold tabular-nums ${isMatured ? 'text-danger' : 'text-ink'}`}>
              {form.maturity_date ? fmtDate(form.maturity_date) : '—'}
            </div>
            <div className="text-xs text-muted">{form.term_days ?? 0} วัน · {form.currency}</div>
            <div className="text-[10px] text-muted mt-1.5 italic">
              {isMatured ? (
                <span className="text-danger font-semibold">⚠ Past due {Math.abs(daysToMaturity)} วัน</span>
              ) : daysToMaturity === 0 ? (
                <span className="text-amber-700 font-semibold">⚡ Settle วันนี้</span>
              ) : (
                <>เหลือ <strong>{daysToMaturity}</strong> วัน จนถึง Maturity</>
              )}
            </div>
          </div>

          {/* Block 3 — Rate Comparison & Initial Fair Value */}
          <div className="bg-white border border-line rounded p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">
              📈 Initial Fair Value (Day 1)
            </div>
            {spot > 0 ? (
              <>
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    isGain ? 'text-emerald-700' : isLoss ? 'text-danger' : 'text-ink'
                  }`}
                >
                  {isGain ? '+' : ''}{fmtMoney(initialFairValue)}
                </div>
                <div className="text-xs text-muted">THB · {isGain ? 'Unrealized Gain' : isLoss ? 'Unrealized Loss' : 'Break-even'}</div>
                <div className="text-[10px] text-muted mt-1.5">
                  Forward: <strong>{forward.toFixed(4)}</strong> ·{' '}
                  Spot: <strong>{spot.toFixed(4)}</strong> ·{' '}
                  Diff:{' '}
                  <strong className={rateDiff > 0 ? 'text-emerald-700' : rateDiff < 0 ? 'text-danger' : ''}>
                    {rateDiff > 0 ? '+' : ''}{rateDiff.toFixed(4)}
                  </strong>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm text-muted italic mt-2">
                  กรอก <strong>Spot Rate</strong> เพื่อเทียบ
                </div>
                <div className="text-[10px] text-muted mt-1.5">
                  เพื่อคำนวณ Unrealized Gain/Loss ณ Day 1
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ============== Fee Payment Tab ==============
function FeePaymentTab({ fxfId, fxfName, fxfStatus, gl, canPost }: {
  fxfId: string | undefined;
  fxfName: string;
  fxfStatus: string;
  gl: Record<FXFGLKey, { code: string; name: string }>;
  canPost: boolean;
}) {
  const qc = useQueryClient();
  const [glDate, setGlDate] = useState(fmtDateISO(new Date()));
  const [spotFee, setSpotFee] = useState(0);
  const [cancelFee, setCancelFee] = useState(0);

  // ใบสำคัญค่าธรรมเนียมที่ลงไปแล้วของสัญญานี้
  //
  // ใช้สองอย่าง: (1) กันลงซ้ำ — เดิมกดกี่ครั้งก็ได้ใบสำคัญใหม่ทุกครั้ง
  // (2) เป็นแหล่งอ้างอิงวันที่ลงบัญชี — เดิมวันที่ไม่ถูกบันทึกไว้ที่ไหนเลย ออกจากหน้าแล้วกลับเป็นวันนี้
  const { data: postedFeeJE } = useQuery({
    queryKey: ['fxf-fee-je', fxfId],
    enabled: !!fxfId,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('je_number, je_date')
        .eq('source_type', 'FXF_FEE')
        .eq('source_id', fxfId!)
        .eq('status', 'Posted')
        .eq('is_reversal', false)
        .order('je_date')
        .limit(1);
      return data?.[0] ?? null;
    },
  });

  // วันที่ในใบสำคัญที่ลงไปแล้วคือค่าที่ถูกต้อง — เอามาแสดงแทนวันที่ตั้งต้นบนหน้าจอ
  useEffect(() => {
    if (postedFeeJE?.je_date) setGlDate(postedFeeJE.je_date);
  }, [postedFeeJE?.je_date]);

  const { data: fees = [] } = useQuery({
    queryKey: ['fxf-fees', fxfId],
    enabled: !!fxfId,
    queryFn: async () => {
      const { data } = await supabase
        .from('fxf_fees')
        .select('*')
        .eq('fxf_id', fxfId!)
        .order('created_at', { ascending: false });
      return (data ?? []) as FXFFee[];
    },
  });

  const totalFee = spotFee + cancelFee;

  const postFeeJE = useMutation({
    mutationFn: async () => {
      if (!fxfId) throw new Error('Save FX Forward ก่อน');
      if (!canPost) throw new Error('ไม่มีสิทธิ์ลงบัญชีค่าธรรมเนียมของสัญญานี้');
      if (fxfStatus !== 'Approved' && fxfStatus !== 'Active') {
        throw new Error(`ลงบัญชีได้เฉพาะสถานะ Active — ตอนนี้: "${fxfStatus}"`);
      }
      if (totalFee <= 0) throw new Error('กรอกค่าธรรมเนียมก่อน');

      // ตรวจจากใบสำคัญที่ลงไปแล้วโดยตรง — กันกดซ้ำแล้วได้ใบสำคัญกับแถวประวัติเพิ่มทุกครั้ง
      const { data: dup } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'FXF_FEE')
        .eq('source_id', fxfId)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (dup && dup.length > 0) {
        throw new Error(`ค่าธรรมเนียมของสัญญานี้ลงบัญชีไปแล้ว — ใบสำคัญเลขที่ ${dup[0].je_number} · ถ้าต้องแก้ ให้กลับรายการใบเดิมก่อน`);
      }

      const je = await createJE({
        source_type: 'FXF_FEE',
        source_id: fxfId,
        je_date: glDate,
        description: `${fxfName} — ค่าธรรมเนียมสัญญาซื้อขายเงินตราล่วงหน้า`,
        remark: `ค่าธรรมเนียมอัตราทันที ${fmtMoney(spotFee)} · ค่าธรรมเนียมยกเลิก/แก้ไขสัญญา ${fmtMoney(cancelFee)}`,
        lines: [
          {
            account_code: gl.fee.code,
            account_name: gl.fee.name,
            dr: totalFee,
            description: 'ค่าธรรมเนียมสัญญาซื้อขายเงินตราล่วงหน้า',
          },
          {
            account_code: gl.cash.code,
            account_name: gl.cash.name,
            cr: totalFee,
            description: 'จ่ายจากบัญชีธนาคาร',
          },
        ],
      });
      await postJE(je.id, 'user');

      // Insert fee record
      await supabase.from('fxf_fees').insert({
        fxf_id: fxfId,
        gl_date: glDate,
        spot_fee: spotFee,
        cancellation_amendment_fee: cancelFee,
        je_id: je.id,
      });

      return je;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fxf-fees', fxfId] });
      qc.invalidateQueries({ queryKey: ['fxf-fee-je', fxfId] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('✓ ลงบัญชีค่าธรรมเนียมแล้ว');
      setSpotFee(0);
      setCancelFee(0);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <p className="text-sm text-muted mb-4 italic">
        บันทึกค่าธรรมเนียมจากการใช้ Forward Rate ไม่ครบตามสัญญา หรือ Spot Rate กรณีพิเศษ
      </p>
      {postedFeeJE && (
        <div className="mb-4 rounded border border-line bg-soft px-3 py-2 text-xs">
          ค่าธรรมเนียมของสัญญานี้ลงบัญชีไปแล้วเมื่อ <strong>{fmtDate(postedFeeJE.je_date)}</strong>{' '}
          (ใบสำคัญเลขที่ {postedFeeJE.je_number}) — ถ้าต้องแก้ ให้กลับรายการใบเดิมก่อน
        </div>
      )}
      <div className="flex gap-8 flex-wrap mb-6">
        {/* LEFT */}
        <div className="flex-1 min-w-[240px] space-y-3">
          <div>
            <FieldLabel>GL DATE</FieldLabel>
            <Input type="date" value={glDate} disabled={!canPost || !!postedFeeJE} onChange={(e) => setGlDate(e.target.value)} />
            {postedFeeJE && <p className="text-[10px] text-muted mt-0.5 italic">วันที่ตามใบสำคัญที่ลงบัญชีไปแล้ว</p>}
          </div>
          <div>
            <FieldLabel tipKey="SPOT FEE">SPOT FEE</FieldLabel>
            <NumInput value={spotFee} onChange={setSpotFee} placeholder="0.00" readOnly={!canPost || !!postedFeeJE} />
          </div>
        </div>

        {/* CENTER */}
        <div className="flex-1 min-w-[240px] space-y-3">
          <div>
            <FieldLabel tipKey="CANCELLATION OR AMENDMENT FEE">CANCELLATION OR AMENDMENT FEE</FieldLabel>
            <NumInput value={cancelFee} onChange={setCancelFee} placeholder="0.00" readOnly={!canPost || !!postedFeeJE} />
          </div>
        </div>

        {/* RIGHT: JE Preview + Post */}
        <div className="flex-[1.2] min-w-[340px]">
          <div className="text-right mb-3">
            <Button
              onClick={() => postFeeJE.mutate()}
              disabled={!fxfId || !canPost || !!postedFeeJE || postFeeJE.isPending || totalFee <= 0 || (fxfStatus !== 'Approved' && fxfStatus !== 'Active')}
              title={
                !fxfId
                  ? 'บันทึกก่อน'
                  : !canPost
                    ? 'ไม่มีสิทธิ์ลงบัญชีค่าธรรมเนียม'
                    : postedFeeJE
                      ? `ลงบัญชีไปแล้ว — ใบสำคัญเลขที่ ${postedFeeJE.je_number}`
                      : fxfStatus !== 'Approved' && fxfStatus !== 'Active'
                        ? `ต้องเป็นสถานะ Active — ตอนนี้: "${fxfStatus}"`
                        : totalFee <= 0
                          ? 'กรอกค่าธรรมเนียมก่อน'
                          : 'ลงบัญชีค่าธรรมเนียม'
              }
              className="bg-gray-700 text-white border-gray-700 hover:bg-gray-800 disabled:opacity-50"
            >
              📋 {postFeeJE.isPending ? 'กำลังลงบัญชี…' : 'ลงบัญชีค่าธรรมเนียม'}
            </Button>
          </div>

          {totalFee > 0 && (
            <div className="border border-line rounded overflow-hidden">
              <div className="bg-brand text-white px-3 py-2 text-xs font-bold flex justify-between">
                <span>JV – Fee</span>
                <span className="flex gap-6 tracking-wider"><span>DR</span><span>CR</span></span>
              </div>
              <table className="table-base text-xs m-0">
                <tbody>
                  <tr>
                    <td>Dr. {gl.fee.code} {gl.fee.name}</td>
                    <td className="text-right tabular-nums">{fmtMoney(totalFee)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td>Cr. {gl.cash.code} {gl.cash.name}</td>
                    <td />
                    <td className="text-right tabular-nums">{fmtMoney(totalFee)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Posted Fee history */}
      {fees.length > 0 && (
        <div>
          <div className="text-sm font-bold mb-2">📋 Fee Payment History</div>
          <table className="table-base">
            <thead>
              <tr>
                <ThTip>GL Date</ThTip>
                <ThTip align="right">Spot Fee</ThTip>
                <ThTip align="right">Cancel/Amend Fee</ThTip>
                <ThTip align="right">Total</ThTip>
                <ThTip>JE</ThTip>
              </tr>
            </thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.id}>
                  <td>{fmtDate(f.gl_date)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(f.spot_fee)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(f.cancellation_amendment_fee)}</td>
                  <td className="text-right tabular-nums font-semibold">
                    {fmtMoney(f.spot_fee + f.cancellation_amendment_fee)}
                  </td>
                  <td>
                    {f.je_id ? (
                      <a className="text-brand hover:underline text-xs" href={`/je/${f.je_id}`}>
                        View JE →
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============== Fair Value Tab ==============
//
// แท็บนี้กับปุ่มลงบัญชีทั้งพอร์ตในหน้ารายการเคยเป็นการตีราคาคนละชุด ลงคนละบัญชีกัน 4 บัญชี
// สัญญาเดียวเดือนเดียวจึงมีกำไร/ขาดทุนที่ยังไม่เกิดขึ้นจริงซ้ำสองชุด
//
// ตอนนี้ทั้งสองทางเรียกตัวคำนวณและตัวลงบัญชีตัวเดียวกัน (lib/fx-valuation) เก็บลงตาราง
// การตีราคาตารางเดียวกัน ซึ่งมีทั้งอัตราสิ้นงวดที่ใช้ (ย้อนตรวจได้) และกันลงซ้ำงวดเดิมได้
function FairValueTab({
  fxfId,
  fxfNo,
  fxfName,
  fxfStatus,
  notional,
  contractRate,
  amountThb,
  direction,
  currency,
  cards,
  canPost,
}: {
  fxfId: string | undefined;
  fxfNo: string;
  fxfName: string;
  fxfStatus: string;
  notional: number;
  contractRate: number;
  amountThb: number;
  direction: string;
  currency: string;
  cards: FxAcctCard[];
  canPost: boolean;
}) {
  const qc = useQueryClient();
  const [sub, setSub] = useState<'fair' | 'summary'>('fair');
  // งวดตีราคาปกติจบที่สิ้นเดือน — ตั้งค่าตั้งต้นให้ตรงกับที่ใช้จริง
  const [accountingPeriod, setAccountingPeriod] = useState(() => lastDayOfMonthISO(new Date()));
  const [spotRateEom, setSpotRateEom] = useState(0);

  // มูลค่ายุติธรรมกับผลต่างคำนวณจากตัวเดียวกับปุ่มลงบัญชีทั้งพอร์ต
  const { fairValue, unrealized } = useMemo(() => {
    if (!(spotRateEom > 0) || !(notional > 0)) return { fairValue: 0, unrealized: 0 };
    const { mtm_thb } = computeMTM(
      { notional_amount_foreign: notional, amount_buy: notional, forward_rate: contractRate, direction: direction as 'Buy' | 'Sell' },
      spotRateEom,
      accountingPeriod,
    );
    return { fairValue: round2(notional * spotRateEom), unrealized: mtm_thb };
  }, [spotRateEom, notional, contractRate, direction, accountingPeriod]);

  // ผังบัญชีที่ใบสำคัญตีราคาจะใช้ — แสดงในตัวอย่างใบสำคัญให้ตรงกับที่ลงจริง
  const valGL = useMemo(() => resolveFXValuationGL(cards), [cards]);

  const { data: fairs = [] } = useQuery({
    queryKey: ['fxf-valuations', fxfId],
    enabled: !!fxfId,
    queryFn: async () => {
      const { data } = await supabase
        .from('fx_valuations')
        .select('*')
        .eq('fxf_id', fxfId!)
        .order('valuation_date', { ascending: false });
      return (data ?? []) as FXValuation[];
    },
  });

  const postFairJE = useMutation({
    mutationFn: async () => {
      if (!fxfId) throw new Error('Save FX Forward ก่อน');
      if (!canPost) throw new Error('ไม่มีสิทธิ์ลงบัญชีตีราคาของสัญญานี้');
      if (fxfStatus !== 'Approved' && fxfStatus !== 'Active') {
        throw new Error(`ลงบัญชีได้เฉพาะสถานะ Active — ตอนนี้: "${fxfStatus}"`);
      }
      if (!(spotRateEom > 0)) throw new Error('กรอกอัตราตลาด ณ สิ้นงวดก่อน');
      if (unrealized === 0) throw new Error('อัตราสิ้นงวดเท่ากับอัตราตามสัญญา — ไม่มีผลต่างให้ลงบัญชี');

      // กันลงซ้ำงวดเดิม — ตรวจทั้งจากใบสำคัญและจากแถวการตีราคา
      await assertNoValuationJE(fxfId, valuationPeriod(accountingPeriod));

      const { data: val, error } = await supabase
        .from('fx_valuations')
        .insert({
          fxf_id: fxfId,
          valuation_date: accountingPeriod,
          month_end_rate: spotRateEom,
          contract_rate: contractRate,
          notional_amount: notional,
          notional_thb: round2(notional * contractRate),
          mtm_thb: unrealized,
          status: 'Draft',
        })
        .select()
        .single();
      if (error) {
        // ดัชนีของตารางบังคับไว้ว่าหนึ่งสัญญามีได้งวดละแถวเดียว
        if ((error as any).code === '23505') throw new Error('งวดนี้มีการตีราคาอยู่แล้ว — เลือกวันสิ้นงวดอื่น หรือกลับรายการของเดิมก่อน');
        throw error;
      }

      await postFXValuationJE(val as FXValuation, fxfNo || fxfName, cards);

      // ตีราคาครั้งแรก = สัญญาเริ่มมีผลจริง → เลื่อนสถานะให้อัตโนมัติ
      let activated = false;
      if (fxfStatus === 'Approved') {
        await supabase.from('fx_forwards').update({ status: 'Active' }).eq('id', fxfId);
        activated = true;
      }
      return { activated };
    },
    onSuccess: ({ activated }) => {
      qc.invalidateQueries({ queryKey: ['fxf-valuations', fxfId] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      if (activated) {
        qc.invalidateQueries({ queryKey: ['fxf', fxfId] });
        qc.invalidateQueries({ queryKey: ['notifications'] });
      }
      toast.success(activated ? '✓ ลงบัญชีตีราคาแล้ว · สถานะเปลี่ยนเป็น Active' : '✓ ลงบัญชีตีราคาแล้ว (พร้อมใบกลับรายการต้นเดือนถัดไป)');
      setSpotRateEom(0);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-5 mb-4 pb-1.5 border-b border-line">
        {([
          { key: 'fair', label: 'Fair Value' },
          { key: 'summary', label: 'Summary' },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSub(t.key)}
            className={`text-sm font-semibold pb-1 -mb-[7px] border-b-2 transition ${
              sub === t.key ? 'border-brand text-ink' : 'border-transparent text-brand hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'fair' ? (
        <div className="flex gap-8 flex-wrap">
          {/* LEFT */}
          <div className="flex-1 min-w-[300px]">
            <div className="space-y-3 max-w-sm">
              <div>
                <FieldLabel>ACCOUNTING PERIOD</FieldLabel>
                <Input
                  type="date"
                  value={accountingPeriod}
                  disabled={!canPost}
                  onChange={(e) => setAccountingPeriod(e.target.value)}
                />
                <p className="text-[10px] text-muted mt-0.5">วันสิ้นงวดที่ตีราคา · หนึ่งงวดลงบัญชีได้ครั้งเดียว</p>
              </div>
              <div>
                <FieldLabel required>SPOT RATE (ณ สิ้นงวด)</FieldLabel>
                <NumInput
                  value={spotRateEom}
                  onChange={setSpotRateEom}
                  readOnly={!canPost}
                  placeholder={`เช่น 35.2000 (${currency} → THB)`}
                />
                <p className="text-[10px] text-muted mt-0.5">
                  อัตราตลาด ณ วันสิ้นงวด · จำนวนเงิน {notional.toLocaleString()} {currency} × อัตรา = มูลค่ายุติธรรม
                  <br />อัตราที่ใช้จะถูกเก็บไว้กับรายการตีราคาและในหมายเหตุของใบสำคัญ เพื่อย้อนกลับมาตรวจได้
                </p>
              </div>
              <div>
                <FieldLabel>FAIR VALUE (auto)</FieldLabel>
                <NumInput value={fairValue} onChange={() => {}} readOnly className="bg-gray-50" />
                <p className="text-[10px] text-muted mt-0.5">= จำนวนเงิน × อัตราตลาด ณ สิ้นงวด</p>
              </div>
              <div>
                <FieldLabel>UNREALIZED GAIN/LOSS (auto)</FieldLabel>
                <NumInput value={unrealized} onChange={() => {}} allowNegative readOnly className="bg-gray-50" />
                <p className="text-[10px] text-muted mt-0.5">
                  บวก = กำไร · ลบ = ขาดทุน · {direction === 'Sell'
                    ? 'ขาย: ยอดตามสัญญา − มูลค่ายุติธรรม'
                    : 'ซื้อ: มูลค่ายุติธรรม − ยอดตามสัญญา'} ({amountThb.toLocaleString()} บาท)
                </p>
              </div>
            </div>
          </div>

          {/* CENTER: Post button */}
          <div className="flex items-start min-w-[200px]">
            <Button
              onClick={() => postFairJE.mutate()}
              disabled={!fxfId || !canPost || postFairJE.isPending || unrealized === 0 || (fxfStatus !== 'Approved' && fxfStatus !== 'Active')}
              title={
                !fxfId
                  ? 'บันทึกก่อน'
                  : !canPost
                    ? 'ไม่มีสิทธิ์ลงบัญชีตีราคา'
                    : fxfStatus !== 'Approved' && fxfStatus !== 'Active'
                      ? `ต้องเป็นสถานะ Active — ตอนนี้: "${fxfStatus}"`
                      : unrealized === 0
                        ? 'กรอกอัตราตลาด ณ สิ้นงวดก่อน'
                        : 'ลงบัญชีตีราคา (พร้อมใบกลับรายการต้นเดือนถัดไป)'
              }
              className="bg-gray-700 text-white border-gray-700 hover:bg-gray-800 disabled:opacity-50"
            >
              📋 {postFairJE.isPending ? 'กำลังลงบัญชี…' : 'ลงบัญชีมูลค่ายุติธรรม'}
            </Button>
          </div>

          {/* RIGHT: JV Preview */}
          <div className="flex-[1.2] min-w-[340px]">
            {unrealized !== 0 && (
              <>
                <div className="border border-line rounded overflow-hidden">
                  <div className="bg-brand text-white px-3 py-2 text-xs font-bold flex justify-between">
                    <span>JV – Fair Value</span>
                    <span className="flex gap-6 tracking-wider"><span>DR</span><span>CR</span></span>
                  </div>
                  <table className="table-base text-xs m-0">
                    <tbody>
                      {unrealized > 0 ? (
                        <>
                          <tr>
                            <td>Dr. {valGL.fxfAsset.code} {valGL.fxfAsset.name}</td>
                            <td className="text-right tabular-nums">{fmtMoney(Math.abs(unrealized))}</td>
                            <td />
                          </tr>
                          <tr>
                            <td>Cr. {valGL.fxGainUnreal.code} {valGL.fxGainUnreal.name}</td>
                            <td />
                            <td className="text-right tabular-nums">{fmtMoney(Math.abs(unrealized))}</td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr>
                            <td>Dr. {valGL.fxLossUnreal.code} {valGL.fxLossUnreal.name}</td>
                            <td className="text-right tabular-nums">{fmtMoney(Math.abs(unrealized))}</td>
                            <td />
                          </tr>
                          <tr>
                            <td>Cr. {valGL.fxfLiab.code} {valGL.fxfLiab.name}</td>
                            <td />
                            <td className="text-right tabular-nums">{fmtMoney(Math.abs(unrealized))}</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted italic mt-1.5">
                  ** ระบบลงใบกลับรายการ ลงวันที่ 1 ของเดือนถัดไป ให้พร้อมกันโดยอัตโนมัติ
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        // Summary sub-tab
        <div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <ThTip>Accounting Period</ThTip>
                  <ThTip align="right">อัตราสิ้นงวดที่ใช้</ThTip>
                  <ThTip align="right">Fair Value</ThTip>
                  <ThTip align="right">Unrealized Gain/Loss</ThTip>
                  <ThTip>Journal Entry</ThTip>
                </tr>
              </thead>
              <tbody>
                {fairs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-8 italic">
                      ยังไม่มีรายการตีราคา — กลับไปแท็บย่อย Fair Value เพื่อลงบัญชี
                    </td>
                  </tr>
                ) : (
                  fairs.map((fv) => (
                    <tr key={fv.id}>
                      <td>{fmtDate(fv.valuation_date)}</td>
                      <td className="text-right tabular-nums">{Number(fv.month_end_rate).toFixed(4)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(Number(fv.notional_amount) * Number(fv.month_end_rate))}</td>
                      <td className={`text-right tabular-nums ${fv.mtm_thb < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                        {fv.mtm_thb > 0 ? '+' : ''}
                        {fmtMoney(fv.mtm_thb)}
                      </td>
                      <td>
                        {fv.je_id ? (
                          <a className="text-brand hover:underline text-xs" href={`/je/${fv.je_id}`}>
                            View JE →
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {fairs.length > 0 && (
            <div className="mt-3 max-w-md space-y-1 text-sm">
              <RowTip
                label="Latest Fair Value"
                value={fmtMoney(Number(fairs[0]?.notional_amount ?? 0) * Number(fairs[0]?.month_end_rate ?? 0))}
                bold
              />
              <RowTip
                label="Latest Unrealized Gain/Loss"
                value={
                  <span className={(fairs[0]?.mtm_thb ?? 0) < 0 ? 'text-danger font-bold' : 'text-emerald-700 font-bold'}>
                    {(fairs[0]?.mtm_thb ?? 0) > 0 ? '+' : ''}
                    {fmtMoney(fairs[0]?.mtm_thb ?? 0)}
                  </span>
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
