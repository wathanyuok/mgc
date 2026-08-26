import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Plus, Repeat2, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchCaCards } from '@/lib/ca-inherit';
import { Button, Input, Select, Badge, FieldLabel, Modal, NumInput } from '@/components/ui';
import { fmtDate, fmtMoney, fmtPercent, fmtDateISO} from '@/lib/format';
import {
  type TrustReceipt,
  type TRImportedGoods,
  type TRStatus,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, effectiveRate, type RateCard } from '@/components/tx/RateCards';
import { useBaseRateLookup } from '@/lib/interest-rate-master';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import { computeStatusLock, canSaveStatusChange } from '@/lib/status-lock';
import { StatusLockBanner } from '@/components/tx/StatusLockBanner';
import { ApprovalPanel } from '@/components/tx/ApprovalPanel';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';
import { RepaymentsReceived } from '@/components/tx/RepaymentsReceived';
import { ClassificationCard } from '@/components/shared/ClassificationCard';
import { fetchInheritedFromCA, type InheritedSegments } from '@/lib/segment-inherit';
import { createJE, postJE, reverseJE } from '@/lib/je';
import { fetchBankConfirmed, bankConfirmedQueryKey } from '@/lib/bank-statement-match';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { buildPNSchedule, totalDays, totalInterest } from '@/lib/pn-schedule';
import { ReconcileTab, type ReconcileScheduleRow } from '@/components/tx/ReconcileTab';
import { useBankCodes } from '@/lib/banks';
import { ApprovalActions, ApprovalNote, filterStatusOptions } from '@/components/shared/ApprovalActions';
import { syncScheduleFor } from '@/lib/schedule-store';

import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
import { toDbPayload } from '@/lib/save-payload';
// Note: 'Approved' removed — Approval Panel now owns that transition.
const TR_STATUSES: TRStatus[] = ['Draft', 'Pending Approval', 'Active', 'Roll Over', 'Repaid', 'Closed', 'Cancelled'];
const CURRENCIES = ['THB', 'USD', 'EUR', 'JPY', 'GBP', 'CNY', 'SGD'];

type Form = Omit<TrustReceipt, 'id' | 'created_at' | 'updated_at'>;

const blank: Form = {
  tr_no: '',
  name: null,
  ca_id: null,
  finance_institution: 'KBANK',
  supplier: null,
  invoice_no: null,
  invoice_date: null,
  due_date: fmtDateISO(new Date()),
  transaction_date: fmtDateISO(new Date()),
  maturity_date: null,
  term_days: 60,
  amount: 0,
  amount_foreign: null,
  conversion_date: null,
  conversion_rate: null,
  currency: 'THB',
  reference_contract: null,
  rollover_parent_id: null,
  interest_rate_id: null,
  effective_rate: null,
  status: 'Draft',
  remark: null,
  rate_cards: [],
  acct_cards: [],
};

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  Approved: 'success',
  Active: 'success',
  'Roll Over': 'brand',
  Repaid: 'default',
  Closed: 'default',
  Cancelled: 'danger',
};

export function TRDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const baseRateLookup = useBaseRateLookup(form.finance_institution);
  const [goods, setGoods] = useState<TRImportedGoods[]>([]);
  const [showRollover, setShowRollover] = useState(false);
  const [rolloverNew, setRolloverNew] = useState({ new_name: '', new_tr_no: '', new_term_days: 60 });
  // Track which amount field user last edited — used to decide direction of auto-fill
  // when CONVERSION RATE changes
  const [lastEditedAmount, setLastEditedAmount] = useState<'thb' | 'foreign'>('thb');
  const isForeign = form.currency !== 'THB';

  // Load existing
  const { data: existing } = useQuery({
    queryKey: ['tr', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [m, g] = await Promise.all([
        supabase.from('trust_receipts').select('*').eq('id', id!).single(),
        supabase.from('tr_imported_goods').select('*').eq('tr_id', id!).order('sort_order'),
      ]);
      if (m.error) throw m.error;
      return {
        main: m.data as TrustReceipt,
        goods: (g.data ?? []) as TRImportedGoods[],
      };
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
      setGoods(existing.goods);
    }
  }, [existing]);

  // CA options
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-tr'],
    queryFn: async () => {
      const { data } = await supabase
        .from('credit_agreements')
        .select('id, ca_name, contract_number, ma_id').eq('status', 'Approved')
        .order('ca_name');
      return data ?? [];
    },
  });

  // Auto-compute maturity from transaction_date + term_days
  useEffect(() => {
    if (form.transaction_date && form.term_days) {
      const d = new Date(form.transaction_date);
      d.setDate(d.getDate() + form.term_days);
      const iso = fmtDateISO(d);
      if (iso !== form.maturity_date) setForm((f) => ({ ...f, maturity_date: iso, due_date: iso }));
    }
  }, [form.transaction_date, form.term_days]);

  const effRate = useMemo(
    () =>
      form.rate_cards.length > 0
        ? effectiveRate((form.rate_cards as RateCard[])[0])
        : form.effective_rate ?? 0,
    [form.rate_cards, form.effective_rate],
  );

  // Schedule using PN-style (bullet — month-end accrual)
  const schedule = useMemo(
    () =>
      buildPNSchedule(
        form.amount,
        form.rate_cards as RateCard[],
        form.transaction_date ?? form.invoice_date ?? form.due_date,
        form.maturity_date ?? form.due_date,
      ),
    [form.amount, form.rate_cards, form.transaction_date, form.invoice_date, form.due_date, form.maturity_date],
  );
  const intTotal = useMemo(
    () =>
      totalInterest(
        form.amount,
        form.rate_cards as RateCard[],
        form.transaction_date ?? form.invoice_date ?? form.due_date,
        form.maturity_date ?? form.due_date,
      ),
    [form.amount, form.rate_cards, form.transaction_date, form.invoice_date, form.due_date, form.maturity_date],
  );

  // Save
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
  const lock = computeStatusLock('TR', form.status);
  // ระบบไม่มีสถานะ "Approved" ให้เลือกเอง — ปุ่มอนุมัติจะตั้งเป็น "Active" โดยตรง
  // จึงต้องรับทั้งสองค่า ไม่งั้นปุ่มลงบัญชีวันเบิกเงินจะกดไม่ได้เลย
  const trApproved = form.status === 'Approved' || form.status === 'Active';

  const save = useMutation({
    mutationFn: async () => {
      if (!canSaveStatusChange('TR', savedStatus, form.status))
        throw new Error(`T/R สถานะ ${savedStatus} — ปิดไปแล้ว แก้ไขไม่ได้ (เปลี่ยนสถานะกลับก่อน)`);
      // Soft cap (opt-in): only enforce Σ Imported Goods ≤ AMOUNT (FOREIGN) when user sets a cap.
      // Rationale: TR is per-transaction (1 set of goods per TR), not a revolving facility like FP.
      // AMOUNT (FOREIGN) is informational; user may optionally cap it to mirror bank-approved foreign limit.
      const goodsSum = goods.reduce((s, g) => s + (g.amount_foreign || 0), 0);
      const cap = form.amount_foreign ?? 0;
      if (goodsSum > 0 && cap > 0 && goodsSum > cap) {
        throw new Error(`Σ Imported Goods (${goodsSum.toLocaleString()} ${form.currency}) เกินเพดาน AMOUNT (FOREIGN) (${cap.toLocaleString()} ${form.currency}) — ลด Goods หรือเพิ่ม/ลบเพดาน`);
      }
      await assertWithinCreditLine(form.ca_id, form.amount, { table: 'trust_receipts', id });
      // Auto-fill name (running no) — also backfills existing T/R that had empty name
      const nameFilled = (form.name ?? '').trim() || await nextRunningNo(RUNNING_PREFIX.tr);
      const payload = { ...toDbPayload(form), name: nameFilled, effective_rate: effRate, updated_by: userLabel };
      let trId = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('trust_receipts').insert({ ...payload, created_by: userLabel }).select().single();
        if (error) throw error;
        trId = data.id;
      } else {
        const { error } = await supabase.from('trust_receipts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', trId!);
        if (error) throw error;
      }
      // Replace imported goods
      await supabase.from('tr_imported_goods').delete().eq('tr_id', trId!);
      if (goods.length > 0) {
        const rows = goods.map((g, i) => ({
          tr_id: trId!,
          reference_no: g.reference_no,
          description: g.description,
          vendor: g.vendor,
          amount_foreign: g.amount_foreign,
          sort_order: i,
        }));
        const { error } = await supabase.from('tr_imported_goods').insert(rows);
        if (error) throw error;
      }
      // Sync local form so UI shows the auto-filled NAME after save
      setForm((f) => ({ ...f, name: nameFilled }));
      return trId;
    },
    onSuccess: (trId: any) => {
      logSave('trust_receipts', trId ?? id, form.tr_no, mode === 'new');
      // เก็บตารางผ่อนลงตารางกลาง — ใช้ทำรายงานครบกำหนด/ค้างชำระ และแจ้งเตือนรายงวด
      void syncScheduleFor('TR', trId);
      qc.invalidateQueries({ queryKey: ['tr-list'] });
      qc.invalidateQueries({ queryKey: ['tr', trId] });
      // Save happened in this session → unlock the "ส่งขออนุมัติ" button.
      setHasSavedInSession(true);
      toast.success(mode === 'new' ? 'สร้าง T/R แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new' && trId) navigate(`/tx/tr/${trId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const ensureTrId = async (): Promise<string> => {
    if (id) return id;
    const trNo = (form.tr_no ?? '').trim() || `DRAFT-${Date.now()}`;
    const name = (form.name ?? '').trim() || (id ? trNo : await nextRunningNo(RUNNING_PREFIX.tr));
    const { data, error } = await supabase
      .from('trust_receipts')
      .insert({ ...toDbPayload(form), tr_no: trNo, name, status: 'Draft', effective_rate: effRate })
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['tr-list'] });
    navigate(`/tx/tr/${data.id}`, { replace: true });
    return data.id as string;
  };

  // JE list
  const { data: trJEs } = useQuery({
    queryKey: ['tr-je', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('id, je_number, status, is_reversal, total_dr, total_cr, je_date, description, source_type, source_period')
        .in('source_type', ['TR_DRAWDOWN', 'TR_ACCRUED'])
        .eq('source_id', id!)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
  });

  // Posted periods (Map for clickable Posted badges)
  const postedPeriods = useMemo(() => {
    const map = new Map<string, { id: string; je_number: string }>();
    (trJEs ?? []).forEach((j: any) => {
      if (j.status === 'Posted' && !j.is_reversal && j.source_period != null) {
        map.set(`${j.source_type}:${j.source_period}`, { id: j.id, je_number: j.je_number });
      }
    });
    return map;
  }, [trJEs]);

  const hasActiveDrawdownJE = useMemo(
    () => (trJEs ?? []).some((j: any) => j.source_type === 'TR_DRAWDOWN' && j.status === 'Posted' && !j.is_reversal),
    [trJEs],
  );

  // Bank Statement reconciliation — MoM Day4 §8.1 "ใช้ Import Bank Statement".
  // Show "🏦 Bank Confirmed" badge per TR period once Finance has linked a bank_statement_lines row.
  const { data: bankConfirmed } = useQuery({
    queryKey: bankConfirmedQueryKey('TR', id),
    enabled: !!id,
    queryFn: () => fetchBankConfirmed('TR', id!),
  });

  // ── Post Drawdown JE (Day 1) ──
  const postDrawdownJE = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save T/R ก่อน Post JE');
      if (!lock.canPostJE) throw new Error(`T/R สถานะ ${form.status} — Post JE ไม่ได้`);
      if (!trApproved) {
        throw new Error(`ลงบัญชีวันเบิกเงินได้เฉพาะ T/R ที่อนุมัติแล้ว — สถานะปัจจุบัน: "${form.status}"`);
      }
      if (form.amount <= 0) throw new Error('Amount ต้อง > 0');

      // ต้องลงบัญชีด้วยค่าที่บันทึกไว้จริง ไม่ใช่ค่าที่ค้างอยู่บนหน้าจอ
      // เดิมถ้าแก้ยอดแล้วยังไม่กด Save แล้วกดลงบัญชีเลย จะได้ใบสำคัญคนละยอดกับในฐานข้อมูลทันที
      const { data: db, error: dbErr } = await supabase
        .from('trust_receipts')
        .select('amount, amount_foreign, currency, supplier, name, tr_no, transaction_date, invoice_date, due_date')
        .eq('id', id).single();
      if (dbErr || !db) throw new Error('อ่านข้อมูล T/R จากฐานข้อมูลไม่ได้ — กด Save ก่อน');
      const dirty =
        Number(db.amount ?? 0) !== Number(form.amount ?? 0)
        || (db.transaction_date ?? null) !== (form.transaction_date ?? null)
        || (db.currency ?? null) !== (form.currency ?? null)
        || (db.supplier ?? null) !== (form.supplier ?? null);
      if (dirty) throw new Error('ค่าบนหน้าจอยังไม่ถูกบันทึก — กด Save ก่อนลงบัญชี');

      const { data: existing } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'TR_DRAWDOWN')
        .eq('source_id', id)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (existing && existing.length > 0) {
        throw new Error(`Drawdown JE มีอยู่แล้ว: ${existing[0].je_number}`);
      }

      const je = await createJE({
        source_type: 'TR_DRAWDOWN',
        source_id: id,
        source_period: 0,
        je_date: db.transaction_date ?? db.invoice_date ?? db.due_date,
        description: `${db.name ?? db.tr_no} — T/R Drawdown`,
        remark: `Supplier: ${db.supplier ?? '—'} · ${db.currency} ${fmtMoney(db.amount_foreign ?? 0)}`,
        lines: [
          {
            account_code: '1213100',
            account_name: 'Inventory — Imported Goods',
            dr: db.amount,
            description: 'Imported goods financed via T/R',
          },
          {
            account_code: '2142109',
            account_name: 'AP — T/R (Bank)',
            cr: db.amount,
            description: 'Note Payable — Trust Receipt',
          },
        ],
      });
      await postJE(je.id, 'user');

      // Auto-promote status: Approved → Active after successful Drawdown post
      await supabase.from('trust_receipts').update({ status: 'Active' }).eq('id', id);
      return je;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tr-je', id] });
      qc.invalidateQueries({ queryKey: ['tr', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Active' }));
      toast.success('✓ Posted T/R Drawdown JE · Status → Active');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reverseDrawdownJE = useMutation({
    mutationFn: async () => {
      // เดิมปุ่มนี้ไม่ตรวจอะไรเลย — กลับรายการใบสำคัญที่ลงไปแล้วได้ทันทีโดยไม่ต้องมีสิทธิ์
      if (!can('tr', 'approve')) throw new Error('ไม่มีสิทธิ์กลับรายการใบสำคัญของ T/R');
      if (!id) throw new Error('Save T/R ก่อน');
      const { data: actives } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('source_type', 'TR_DRAWDOWN')
        .eq('source_id', id)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      for (const je of actives ?? []) {
        await reverseJE(je.id, 'user');
      }
      // คืนสถานะกลับเป็นก่อนเบิก — เดิมค้างเป็น Active ทั้งที่ไม่มีใบสำคัญแล้ว
      // ทำให้กดลงบัญชีใหม่ได้อีกและเกิดใบสำคัญซ้ำ
      await supabase.from('trust_receipts').update({ status: 'Active' }).eq('id', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tr-je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      qc.invalidateQueries({ queryKey: ['tr', id] });
      toast.success('กลับรายการใบสำคัญวันเบิกเงินแล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Post Accrued Interest JE per period ──
  const postPeriodJE = useMutation({
    mutationFn: async (p: any) => {
      if (!id) throw new Error('Save T/R ก่อน');
      // เดิมปุ่มรายงวดไม่ตรวจสิทธิ์เลย ต่างจากปุ่มลงบัญชีวันเบิกเงินที่ตรวจอยู่แล้ว
      if (!can('tr', 'approve')) throw new Error('ไม่มีสิทธิ์ลงบัญชีของ T/R');
      if (!lock.canPostJE) throw new Error(`T/R สถานะ ${form.status} — Post JE ไม่ได้`);
      if (form.status !== 'Approved' && form.status !== 'Active' && form.status !== 'Repaid') {
        throw new Error(`Post Period JE ได้เฉพาะ T/R ที่ Approved / Active / Repaid (backfill) — Status ปัจจุบัน: "${form.status}"`);
      }
      if (!hasActiveDrawdownJE) {
        throw new Error('ต้อง Post Drawdown JE ก่อน จึงจะ Post Period JE ได้');
      }
      // ตารางดอกเบี้ยคำนวณจากค่าบนหน้าจอ ถ้ายังไม่บันทึกจะได้ใบสำคัญที่ไม่ตรงกับสัญญา
      {
        const { data: dbRow, error: dbErr } = await supabase
          .from('trust_receipts')
          .select('amount, transaction_date, maturity_date, due_date, rate_cards')
          .eq('id', id).single();
        if (dbErr || !dbRow) throw new Error('อ่านข้อมูล T/R จากฐานข้อมูลไม่ได้ — กด Save ก่อน');
        const sameRates = JSON.stringify(dbRow.rate_cards ?? []) === JSON.stringify(form.rate_cards ?? []);
        const dirty =
          Number(dbRow.amount ?? 0) !== Number(form.amount ?? 0)
          || (dbRow.transaction_date ?? null) !== (form.transaction_date ?? null)
          || (dbRow.maturity_date ?? null) !== (form.maturity_date ?? null)
          || !sameRates;
        if (dirty) throw new Error('ค่าบนหน้าจอยังไม่ถูกบันทึก — กด Save ก่อนลงบัญชีงวดนี้');
      }
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'TR_ACCRUED')
        .eq('source_id', id)
        .eq('source_period', p.period)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (existing && existing.length > 0) {
        throw new Error(`Period ${p.period} มี JE อยู่แล้ว: ${existing[0].je_number}`);
      }

      const je = await createJE({
        source_type: 'TR_ACCRUED',
        source_id: id,
        source_period: p.period,
        je_date: p.endDate ?? form.due_date,
        description: `${form.name ?? form.tr_no} — Period ${p.period} Accrued Interest`,
        remark: `${p.days} วัน × ${p.rate.toFixed(4)}%`,
        lines: [
          {
            account_code: '5512103',
            account_name: 'ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น',
            dr: p.interestPaid,
            description: `Accrued interest for ${p.days} days`,
          },
          {
            account_code: '2194109',
            account_name: 'ดอกเบี้ยค้างจ่าย-สถาบันการเงิน',
            cr: p.interestPaid,
            description: 'Accrued interest payable',
          },
        ],
      });
      await postJE(je.id, 'user');
      return { je, amount: p.interestPaid };
    },
    onSuccess: ({ je, amount }) => {
      qc.invalidateQueries({ queryKey: ['tr-je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Posted ${je.je_number} (TR_ACCRUED · ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Roll Over context (CA limits) ──
  const { data: rolloverContext } = useQuery({
    queryKey: ['tr-rollover-context', id, form.ca_id],
    enabled: !!id,
    queryFn: async () => {
      let cur = id!;
      let count = 0;
      let earliestStart = form.transaction_date ?? form.invoice_date;
      while (cur) {
        const { data } = await supabase
          .from('trust_receipts')
          .select('id, rollover_parent_id, transaction_date')
          .eq('id', cur)
          .maybeSingle();
        if (!data) break;
        if (data.rollover_parent_id) count++;
        if (data.transaction_date && (!earliestStart || data.transaction_date < earliestStart)) {
          earliestStart = data.transaction_date;
        }
        cur = data.rollover_parent_id;
      }
      let max_times: number | null = null;
      let max_days: number | null = null;
      if (form.ca_id) {
        const { data } = await supabase
          .from('credit_agreements')
          .select('rollover_max_times, rollover_max_days')
          .eq('id', form.ca_id)
          .maybeSingle();
        max_times = data?.rollover_max_times ?? null;
        max_days = data?.rollover_max_days ?? null;
      }
      const usedDays = earliestStart && form.maturity_date
        ? Math.round((new Date(form.maturity_date).getTime() - new Date(earliestStart).getTime()) / 86400000)
        : 0;
      return { count, usedDays, earliestStart, max_times, max_days };
    },
  });

  const rollover = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save T/R ก่อน');
      if (form.status !== 'Approved' && form.status !== 'Active')
        throw new Error(`Roll Over ได้เฉพาะ T/R สถานะ Approved หรือ Active (ปัจจุบัน: ${form.status})`);
      if (!rolloverNew.new_name.trim()) throw new Error('กรุณาระบุ New Name');
      if (!rolloverNew.new_tr_no.trim()) throw new Error('กรุณาระบุ New T/R Number');
      if (!rolloverNew.new_term_days || rolloverNew.new_term_days <= 0) throw new Error('Term (Days) > 0');

      const ctx = rolloverContext;
      if (ctx?.max_times != null && ctx.count >= ctx.max_times) {
        throw new Error(`เกินจำนวน Roll Over สูงสุด (${ctx.max_times} ครั้ง) ที่กำหนดใน CA`);
      }
      if (ctx?.max_days != null && ctx.usedDays + rolloverNew.new_term_days > ctx.max_days) {
        throw new Error(`รวมระยะเวลาเกิน ${ctx.max_days} วันที่ CA กำหนด`);
      }

      const today = fmtDateISO(new Date());
      const matDate = new Date();
      matDate.setDate(matDate.getDate() + rolloverNew.new_term_days);
      const newMaturity = fmtDateISO(matDate);

      // สัญญาใหม่ยังกินวงเงินเหมือนเดิม ต้องตรวจก่อน ไม่งั้นต่อสัญญาไปเรื่อยๆ จนเกินวงเงินได้
      await assertWithinCreditLine(form.ca_id, form.amount, { table: 'trust_receipts', id });

      // toDbPayload — ตัดคีย์ที่มีไว้แสดงผลอย่างเดียวออก
      // เดิมจุดนี้ไม่ได้ตัด พอผู้ใช้แตะกล่องจัดประเภทก่อนต่อสัญญา จะพังด้วยข้อความดิบจากฐานข้อมูล
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = toDbPayload(form) as any;
      const newPayload = {
        ...rest,
        tr_no: rolloverNew.new_tr_no.trim(),
        name: rolloverNew.new_name.trim(),
        transaction_date: today,
        maturity_date: newMaturity,
        due_date: newMaturity,
        term_days: rolloverNew.new_term_days,
        // สถานะ Approved เลิกใช้แล้วและไม่มีในช่องให้เลือก — ตั้งเป็น Active ให้ตรงกับที่ปุ่มอนุมัติทำ
        status: 'Active' as TRStatus,
        rollover_parent_id: id,
        // ให้เห็นได้จากตัวสัญญาเองว่าต่อมาจากฉบับไหน
        reference_contract: form.name ?? form.tr_no ?? null,
        // สัญญาใหม่ต้องเริ่มกระบวนการอนุมัติของตัวเอง ไม่ใช่ยกของเดิมมา
        submitted_by: null, submitted_at: null,
        approved_by: null, approved_at: null,
        rejection_reason: null,
        created_by: userLabel,
      };
      const { data: newTr, error: insErr } = await supabase
        .from('trust_receipts')
        .insert(newPayload)
        .select()
        .single();
      if (insErr) throw insErr;

      // ย้ายสินค้านำเข้าไปสัญญาใหม่ ตามที่หน้าต่างเขียนไว้ — เดิมไม่ได้ทำเลย
      if (goods.length > 0) {
        const rows = goods.map((g: any, i: number) => {
          const { id: _gi, tr_id: _gt, created_at: _gc, ...gr } = g;
          return { ...gr, tr_id: newTr.id, sort_order: i };
        });
        const { error: gErr } = await supabase.from('tr_imported_goods').insert(rows);
        if (gErr) throw gErr;
      }

      await supabase.from('trust_receipts').update({ status: 'Roll Over' }).eq('id', id);

      // สร้างตารางงวดให้สัญญาใหม่ ไม่งั้นจะไม่โผล่ในรายงานครบกำหนด
      await syncScheduleFor('TR', newTr.id as string);
      return newTr;
    },
    onSuccess: (newTr: any) => {
      qc.invalidateQueries({ queryKey: ['tr-list'] });
      qc.invalidateQueries({ queryKey: ['tr', id] });
      qc.invalidateQueries({ queryKey: ['tr', newTr.id] });
      toast.success(`ต่อสัญญาแล้ว → ${newTr.tr_no} · ย้ายสินค้านำเข้ามาให้ครบแล้ว`);
      setShowRollover(false);
      navigate(`/tx/tr/${newTr.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // =========== Tabs ===========
  const tabs: TabDef[] = [
    {
      key: 'interest',
      label: 'Interest Rate',
      render: () => (
        <RateCards
          variant="interest"
          rates={form.rate_cards as RateCard[]}
          onChange={(n) => setForm((f) => ({ ...f, rate_cards: n }))}
          baseRateLookup={baseRateLookup}
          showOverlimit={false}
        />
      ),
    },
    {
      key: 'acct',
      label: 'Accounting',
      render: () => (
        <AcctCards
          accounts={form.acct_cards as AcctCard[]}
          onChange={(n) => setForm((f) => ({ ...f, acct_cards: n }))}
        />
      ),
    },
    {
      key: 'goods',
      label: 'Imported Goods',
      render: () => <ImportedGoodsTab goods={goods} onChange={setGoods} />,
    },
    {
      key: 'sched',
      label: 'Schedule Calculate',
      render: () => (
        <div>
          <div className="overflow-x-auto">
            <table className="table-base text-center">
              <thead>
                <tr>
                  <ThTip align="center">Period</ThTip>
                  <ThTip align="center">Start Date</ThTip>
                  <ThTip align="center">End Date</ThTip>
                  <ThTip align="center">Day</ThTip>
                  <ThTip align="center">Interest Rate</ThTip>
                  <ThTip align="center">Interest</ThTip>
                  <ThTip align="center">Principal Balance</ThTip>
                  <ThTip align="center">Interest Balance</ThTip>
                  <ThTip align="center">JE</ThTip>
                </tr>
              </thead>
              <tbody>
                {schedule.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted py-6">
                      กรอก Amount + Transaction Date + Maturity Date + Interest Rate
                    </td>
                  </tr>
                ) : (
                  schedule.map((p) => {
                    const postedJE = postedPeriods.get(`TR_ACCRUED:${p.period}`);
                    const posted = !!postedJE;
                    // รวม Repaid ด้วย ให้ตรงกับแถบเตือนที่บอกว่ายังลงบัญชีย้อนหลังของงวดที่ขาดได้
                    const statusOk = form.status === 'Approved' || form.status === 'Active' || form.status === 'Repaid';
                    // Block period JE until Drawdown JE is Posted
                    const canPost = p.period > 0 && !posted && !!id && statusOk && hasActiveDrawdownJE
                      && p.interestPaid > 0 && can('tr', 'approve');
                    return (
                      <tr key={p.period}>
                        <td className="text-center tabular-nums">{p.period}</td>
                        <td className="text-center">{fmtDate(p.startDate)}</td>
                        <td className="text-center">{fmtDate(p.endDate)}</td>
                        <td className="text-center tabular-nums">{p.days || '—'}</td>
                        <td className="text-center tabular-nums">{p.rate ? `${p.rate.toFixed(4)}%` : '—'}</td>
                        <td className="text-center tabular-nums">{p.interestPaid ? fmtMoney(p.interestPaid) : '—'}</td>
                        <td className="text-center tabular-nums">{fmtMoney(p.principalBalance)}</td>
                        <td className="text-center tabular-nums">{fmtMoney(p.interestBalance)}</td>
                        <td className="text-center text-xs whitespace-nowrap">
                          {(() => {
                            const bankLine = bankConfirmed?.byPeriod.get(p.period);
                            return (
                              <span className="inline-flex items-center gap-1.5">
                                {p.period === 0 ? (
                                  <span className="text-muted">—</span>
                                ) : posted && postedJE ? (
                                  <a
                                    href={`/je/${postedJE.id}`}
                                    className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 hover:underline"
                                    title={`เปิดหน้า ${postedJE.je_number}`}
                                  >
                                    ✓ ลงบัญชีแล้ว
                                  </a>
                                ) : canPost ? (
                                  <button
                                    onClick={() => postPeriodJE.mutate(p)}
                                    disabled={postPeriodJE.isPending}
                                    className="text-brand font-semibold hover:underline"
                                  >
                                    📋 ลงบัญชีงวดนี้
                                  </button>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                                {bankLine && (
                                  <a
                                    href={`/master/bank-statement/${bankLine.bank_statement_id}`}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-700 hover:bg-sky-200 hover:underline"
                                    title={`Bank Statement: ${fmtDate(bankLine.txn_date)} · ${fmtMoney(bankLine.amount)} · ${bankLine.description ?? ''}`}
                                  >
                                    🏦 Bank Confirmed
                                  </a>
                                )}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })
                )}
                {schedule.length > 1 && (
                  <tr className="bg-soft font-bold border-t-2 border-line">
                    <td colSpan={3} className="text-right">Total</td>
                    <td className="text-center tabular-nums" title="ผลรวมวันจริงจากทุกงวด (อาจ ≠ Term Days ในสัญญา เนื่องจากการแบ่งงวดตามเดือนปฏิทิน)">
                      {schedule.reduce((s, p) => s + (p.days || 0), 0)}
                    </td>
                    <td />
                    <td className="text-center tabular-nums">{fmtMoney(intTotal)}</td>
                    <td />
                    <td />
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* JE Preview (sample row 1) */}
          {schedule.length > 1 && (
            <div className="mt-4 max-w-lg">
              <div className="text-sm font-bold mb-2">📒 JE Preview — Accrued Interest (Period 1)</div>
              <div className="border border-line rounded overflow-hidden">
                <div className="bg-brand text-white px-3 py-2 text-xs font-bold flex justify-between">
                  <span>JV – Accrued Interest</span>
                  <span className="flex gap-6 tracking-wider"><span>DR</span><span>CR</span></span>
                </div>
                <table className="table-base text-xs m-0">
                  <tbody>
                    <tr>
                      <td>Dr. Interest Expense</td>
                      <td className="text-right tabular-nums">{fmtMoney(schedule[1].interestPaid)}</td>
                      <td />
                    </tr>
                    <tr>
                      <td>Cr. Accrued Interest</td>
                      <td />
                      <td className="text-right tabular-nums">{fmtMoney(schedule[1].interestPaid)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'balance',
      label: 'Balance Summary',
      render: () => (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
            <RowTip label="Effective Interest Rate" value={fmtPercent(effRate)} bold />
            <RowTip label="Term (Days)" value={form.term_days ?? '—'} />
          </div>
          <div className="overflow-x-auto max-w-3xl">
            <table className="table-base">
              <thead>
                <tr>
                  <ThTip>Actual</ThTip>
                  <ThTip align="right">Total</ThTip>
                  <ThTip align="right">Repayment</ThTip>
                  <ThTip align="right">Remaining</ThTip>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Principal</strong></td>
                  <td className="text-right tabular-nums">{fmtMoney(form.amount)}</td>
                  <td className="text-right tabular-nums">0.00</td>
                  <td className="text-right tabular-nums">{fmtMoney(form.amount)}</td>
                </tr>
                <tr>
                  <td><strong>Interest</strong></td>
                  <td className="text-right tabular-nums">{fmtMoney(intTotal)}</td>
                  <td className="text-right tabular-nums">0.00</td>
                  <td className="text-right tabular-nums">{fmtMoney(intTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted">
            ACCUMULATED ACCRUED: <strong>{fmtMoney(0)}</strong>
          </div>
          <RepaymentsReceived facilityId={id} principal={form.amount} interest={intTotal} />
        </div>
      ),
    },
    {
      key: 'rollover',
      label: 'Roll Over History',
      render: () => <TRRolloverHistory currentId={id ?? ''} />,
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
                T/R
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureTrId}
              bucketName="tr-documents"
              tableName="tr_documents"
              parentFkColumn="tr_id"
            />
          </div>
        </div>
      ),
    },
    {
      key: 'reconcile',
      label: '🔧 Reconcile',
      render: () => {
        // TR uses buildPNSchedule shape (interest per period, principal at maturity)
        const rows: ReconcileScheduleRow[] = schedule
          .filter((r) => r.period > 0)
          .map((r, i, arr) => {
            const isLast = i === arr.length - 1;
            return {
              id: `tr-${id ?? 'new'}-${r.period}`,
              period: r.period,
              due_date: r.dueDate,
              principal: isLast ? Number(form.amount ?? 0) : 0,
              interest: Number(r.interestPaid),
              payment: (isLast ? Number(form.amount ?? 0) : 0) + Number(r.interestPaid),
            };
          });
        return (
          <ReconcileTab
            facilityType="TR"
            facilityId={id ?? ''}
            facilityNo={form.name ?? form.tr_no ?? undefined}
            schedule={rows}
            title="Trust Receipt: ดอกเบี้ยรายงวด · เงินต้นชำระตอนครบกำหนด · กด Adjust เมื่อ Bank Statement ต่างจาก schedule"
          />
        );
      },
    },
  ];

  const selectedCa = caOptions?.find((c) => c.id === form.ca_id);

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/tr')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Trust Receipt
            <Badge variant={statusVariant[form.status] ?? 'default'}>{form.status}</Badge>
          </h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New T/R' : (form.name ?? form.tr_no)}
          </p>
        </div>
        <Button
          onClick={() => setShowRollover(true)}
          disabled={!id || (form.status !== 'Approved' && form.status !== 'Active') || !can('tr', 'approve')}
          title={
            !id
              ? 'Save T/R ก่อน'
              : form.status !== 'Approved' && form.status !== 'Active'
                ? `Roll Over ได้เฉพาะ Approved หรือ Active — Status: "${form.status}"`
                : 'Roll Over Trust Receipt — สร้างใบใหม่ที่อ้างถึงใบนี้'
          }
        >
          <Repeat2 className="w-4 h-4" /> Roll Over
        </Button>
        {hasActiveDrawdownJE ? (
          <Button
            onClick={() => {
              // กลับรายการใบสำคัญที่ลงบัญชีไปแล้ว ย้อนคืนเองไม่ได้ — ต้องถามก่อน
              if (confirm('กลับรายการใบสำคัญวันเบิกเงินของ T/R นี้?')) reverseDrawdownJE.mutate();
            }}
            disabled={reverseDrawdownJE.isPending || !can('tr', 'approve')}
            className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200"
            title={can('tr', 'approve') ? 'กลับรายการใบสำคัญวันเบิกเงิน' : 'ไม่มีสิทธิ์กลับรายการ'}
          >
            ↩ กลับรายการวันเบิกเงิน
          </Button>
        ) : (
          <Button
            onClick={() => postDrawdownJE.mutate()}
            disabled={!id || postDrawdownJE.isPending || form.amount <= 0 || !trApproved || !can('tr', 'approve')}
            className="bg-gray-700 text-white border-gray-700 hover:bg-gray-800 disabled:opacity-50"
            title={
              !id
                ? 'Save ก่อน'
                : form.amount <= 0
                  ? 'Amount > 0 ก่อน'
                  : !trApproved
                    ? `ต้องอนุมัติสัญญาก่อน — สถานะปัจจุบัน: "${form.status}"`
                    : 'Post Drawdown JE → ระบบจะเปลี่ยน Status เป็น Active'
            }
          >
            📋 {postDrawdownJE.isPending ? 'กำลังลงบัญชี…' : 'ลงบัญชีวันเบิกเงิน'}
          </Button>
        )}
        <Button variant="primary" disabled={save.isPending || !can('tr', 'edit')} title={!can('tr', 'edit') ? 'ไม่มีสิทธิ์แก้ไข T/R' : ''} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={() => navigate('/tx/tr')}>Cancel</Button>
      </div>

      <AuditFooter createdBy={(form as any).created_by} createdAt={(form as any).created_at} updatedBy={(form as any).updated_by} updatedAt={(form as any).updated_at} />

      <StatusLockBanner lock={lock} />

      {id && (
        <ApprovalPanel
          facilityTable="trust_receipts"
          facilityId={id}
          currentStatus={form.status}
          statusField="status"
          approvedValue="Active"
          disableSubmit={!hasSavedInSession}
          disableSubmitHint="กรุณากด Save ก่อน (เพื่อยืนยันว่าตรวจข้อมูลแล้ว) แล้วจึงส่งขออนุมัติได้"
        />
      )}

      {/* Primary Information (3-col) */}
      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required>FINANCE INSTITUTION</FieldLabel>
              <Select
                value={form.finance_institution}
                onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}
              >
                {bankCodes.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel required tipKey="CREDIT AGREEMENT NAME">CREDIT AGREEMENT NAME</FieldLabel>
              <Select
                value={form.ca_id ?? ''}
                onChange={async (e) => { const caId = e.target.value || null; setForm((f) => ({ ...f, ca_id: caId })); if (caId) { const cc = await fetchCaCards(caId); setForm((f) => ({ ...f, rate_cards: (f.rate_cards && (f.rate_cards as any[]).length) ? f.rate_cards : cc.rate_cards, acct_cards: (f.acct_cards && (f.acct_cards as any[]).length) ? f.acct_cards : cc.acct_cards })); } }}
              >
                <option value="">— เลือก CA —</option>
                {caOptions?.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.ca_name}{c.contract_number ? ` · ${c.contract_number}` : ''}
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
              <FieldLabel tipKey="TR NAME">NAME (auto)</FieldLabel>
              <Input readOnly value={form.name ?? ''} placeholder="auto — running no. (สร้างเมื่อ Save)" className="bg-gray-50 text-muted" />
            </div>
            <div>
              <FieldLabel required tipKey="BANK REFERENCE">T/R NUMBER</FieldLabel>
              <Input
                value={form.tr_no}
                onChange={(e) => setForm((f) => ({ ...f, tr_no: e.target.value }))}
                placeholder="T112245679"
              />
            </div>
            <div>
              <FieldLabel required tipKey="TRANSACTION DATE">TRANSACTION DATE</FieldLabel>
              <Input
                type="date"
                value={form.transaction_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value || null }))}
              />
            </div>
            <div>
              <FieldLabel required tipKey="TERM (DAYS)">TERM (DAYS)</FieldLabel>
              <NumInput
                value={form.term_days ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, term_days: v || null }))}
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <FieldLabel tipKey="MATURITY DATE">MATURITY DATE</FieldLabel>
              <Input
                type="date"
                value={form.maturity_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, maturity_date: e.target.value || null }))}
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = Transaction Date + Term (Days)</p>
            </div>
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required>AMOUNT (THB)</FieldLabel>
              <NumInput
                value={form.amount ?? 0}
                onChange={(v) => {
                  setLastEditedAmount('thb');
                  setForm((f) => {
                    const rate = f.conversion_rate ?? 0;
                    // If foreign currency + rate set → auto-fill FOREIGN = THB / rate
                    const newForeign = isForeign && rate > 0 ? Math.round((v / rate) * 100) / 100 : f.amount_foreign;
                    return { ...f, amount: v, amount_foreign: newForeign };
                  });
                }}
              />
            </div>
            <div>
              <FieldLabel required tipKey="CURRENCY">CURRENCY</FieldLabel>
              <Select
                value={form.currency}
                onChange={(e) => {
                  const next = e.target.value;
                  setForm((f) => ({
                    ...f,
                    currency: next,
                    // Clear foreign fields when switching to THB
                    amount_foreign: next === 'THB' ? null : f.amount_foreign,
                    conversion_date: next === 'THB' ? null : f.conversion_date,
                    conversion_rate: next === 'THB' ? null : f.conversion_rate,
                  }));
                }}
              >
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>

            {/* Foreign-only block — hidden when Currency = THB */}
            {isForeign && (
              <>
                <div>
                  <FieldLabel>AMOUNT (FOREIGN) — ยอดในสกุล {form.currency}</FieldLabel>
                  <NumInput
                    value={form.amount_foreign ?? 0}
                    onChange={(v) => {
                      setLastEditedAmount('foreign');
                      setForm((f) => {
                        const rate = f.conversion_rate ?? 0;
                        // Auto-fill THB = FOREIGN × rate
                        const newThb = rate > 0 ? Math.round((v * rate) * 100) / 100 : f.amount;
                        return { ...f, amount_foreign: v, amount: newThb };
                      });
                    }}
                    className={(() => {
                      const sum = goods.reduce((s, g) => s + (g.amount_foreign || 0), 0);
                      const cap = form.amount_foreign ?? 0;
                      return cap > 0 && sum > cap ? 'border-red-400 bg-red-50' : '';
                    })()}
                  />
                  {(() => {
                    const sum = goods.reduce((s, g) => s + (g.amount_foreign || 0), 0);
                    const cap = form.amount_foreign ?? 0;
                    if (cap <= 0) {
                      return <p className="text-[10px] text-muted mt-0.5 italic">เพดาน Imported Goods (optional) — ถ้ากรอก ระบบจะ check Σ Goods ≤ เพดาน</p>;
                    }
                    const exceed = sum > cap;
                    return (
                      <p className={`text-[10px] mt-0.5 italic ${exceed ? 'text-red-600 font-medium' : 'text-muted'}`}>
                        {exceed
                          ? `⚠ Σ Goods ${sum.toLocaleString()} ${form.currency} เกินเพดาน — ลด Goods หรือเพิ่มเพดาน`
                          : `Utilization: ${((sum / cap) * 100).toFixed(1)}% (Σ Goods ${sum.toLocaleString()} ${form.currency} · เหลือ ${(cap - sum).toLocaleString()})`}
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <FieldLabel tipKey="CONVERSION DATE">CONVERSION DATE</FieldLabel>
                  <Input
                    type="date"
                    value={form.conversion_date ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, conversion_date: e.target.value || null }))}
                  />
                </div>
                <div>
                  <FieldLabel required>CONVERSION RATE (1 {form.currency} → THB)</FieldLabel>
                  <NumInput
                    value={form.conversion_rate ?? 0}
                    onChange={(v) => {
                      setForm((f) => {
                        if (v <= 0) return { ...f, conversion_rate: v };
                        // Recompute the OTHER amount based on which one user last edited
                        if (lastEditedAmount === 'thb' && (f.amount ?? 0) > 0) {
                          return { ...f, conversion_rate: v, amount_foreign: Math.round((f.amount! / v) * 100) / 100 };
                        }
                        if ((f.amount_foreign ?? 0) > 0) {
                          return { ...f, conversion_rate: v, amount: Math.round((f.amount_foreign! * v) * 100) / 100 };
                        }
                        return { ...f, conversion_rate: v };
                      });
                    }}
                    placeholder="35.0000"
                  />
                  {(() => {
                    const thb = form.amount ?? 0;
                    const fx = form.amount_foreign ?? 0;
                    const rate = form.conversion_rate ?? 0;
                    if (thb <= 0 || fx <= 0 || rate <= 0) return null;
                    const computed = fx * rate;
                    const diff = Math.abs(computed - thb);
                    const pct = (diff / thb) * 100;
                    if (pct < 0.1) return null; // tolerance 0.1%
                    return (
                      <p className="text-[10px] text-amber-700 mt-0.5 italic">
                        ⚠ ค่าไม่ตรงกัน: FOREIGN × Rate = {computed.toLocaleString(undefined, { maximumFractionDigits: 2 })} ≠ AMOUNT (THB) {thb.toLocaleString()} (ต่าง {pct.toFixed(2)}%)
                      </p>
                    );
                  })()}
                </div>
              </>
            )}

            <div>
              <FieldLabel>FACILITY TYPE</FieldLabel>
              <Input readOnly value="T/R" className="bg-gray-50" />
            </div>
          </div>

          {/* COL 3 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required>STATUS</FieldLabel>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TRStatus }))}>
                {filterStatusOptions(TR_STATUSES as readonly string[], form.status, can('tr', 'approve'), 'Active').map((s) => <option key={s}>{s}</option>)}
              </Select>
              <div className="mt-2">
                <ApprovalActions menuKey="tr" table="trust_receipts" id={id} status={form.status}
                  approvedStatus="Active" rejectStatus="Cancelled"
                  onChanged={(s) => setForm((f) => ({ ...f, status: s as any }))} />
              </div>
              <ApprovalNote remark={form.remark} />
            </div>
            <div>
              <FieldLabel required>SUPPLIER</FieldLabel>
              <Input
                value={form.supplier ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value || null }))}
                placeholder="BMW (Thailand) Co., Ltd."
              />
            </div>
            <div>
              <FieldLabel tipKey="REFERENCE CONTRACT">REFERENCE CONTRACT</FieldLabel>
              <Input
                value={form.reference_contract ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, reference_contract: e.target.value || null }))}
                placeholder="ระบุ T/R เดิมกรณี Roll Over"
              />
            </div>
            <div>
              <FieldLabel>REMARK</FieldLabel>
              <textarea
                className="input min-h-[60px]"
                value={form.remark ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
                placeholder="หมายเหตุ"
              />
            </div>
          </div>
        </div>
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
          disabled={viewOnly}
        />
      </Section>

      <div className="mt-4">
        <Tabs tabs={tabs} />
      </div>

      {/* Roll Over Modal */}
      <Modal
        open={showRollover}
        onClose={() => setShowRollover(false)}
        title="🔁 Roll Over Trust Receipt"
        size="lg"
        footer={
          <>
            <Button onClick={() => setShowRollover(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => rollover.mutate()} disabled={rollover.isPending}>
              <Repeat2 className="w-4 h-4" /> {rollover.isPending ? 'Rolling Over...' : 'Confirm Roll Over'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="bg-blue-50 border-l-4 border-brand rounded p-3 text-xs leading-relaxed">
            <div className="font-bold text-brand-dark mb-1">ℹ️ Roll Over จะทำอะไรบ้าง</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>ตรวจว่าวงเงินคงเหลือพอสำหรับสัญญาใหม่</li>
              <li>เปลี่ยนสถานะสัญญาเดิมเป็น <strong>Roll Over</strong> · สัญญาใหม่เป็น <strong>Active</strong></li>
              <li>สร้าง T/R ใหม่ พร้อม Reference Contract ชี้กลับ T/R เดิม</li>
              <li><strong>ย้ายสินค้านำเข้าทั้งหมด</strong>ไปสัญญาใหม่ พร้อมอัตราดอกเบี้ยและผังบัญชี</li>
            </ol>
          </div>

          {rolloverContext && (
            <div className="bg-amber-50 border-l-4 border-amber-400 rounded p-3 text-xs">
              <div className="font-bold text-amber-800 mb-1">💡 Roll Over Rules (CA)</div>
              <ul className="list-disc list-inside space-y-0.5">
                <li>
                  Max Roll Over: <strong>{rolloverContext.max_times ?? 'ไม่จำกัด'}</strong> ครั้ง · ใช้ไป{' '}
                  <strong className="text-brand">{rolloverContext.count}</strong>
                </li>
                <li>
                  Max Term: <strong>{rolloverContext.max_days ?? 'ไม่จำกัด'}</strong> วัน · ใช้ไป{' '}
                  <strong className="text-brand">{rolloverContext.usedDays}</strong>
                </li>
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-soft rounded p-2">
              <div className="text-muted">T/R เดิม</div>
              <div className="font-semibold">{form.name ?? form.tr_no}</div>
            </div>
            <div className="bg-soft rounded p-2">
              <div className="text-muted">Maturity Date เดิม</div>
              <div className="font-semibold">{form.maturity_date ? fmtDate(form.maturity_date) : '—'}</div>
            </div>
            <div className="bg-soft rounded p-2">
              <div className="text-muted">Amount</div>
              <div className="font-semibold tabular-nums">{fmtMoney(form.amount)} {form.currency}</div>
            </div>
            <div className="bg-soft rounded p-2">
              <div className="text-muted">Supplier</div>
              <div className="font-semibold">{form.supplier ?? '—'}</div>
            </div>
          </div>

          <div className="border-t border-line pt-3">
            <div className="font-bold mb-2">📝 T/R ใหม่</div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <FieldLabel required tipKey="TR NAME">NEW NAME</FieldLabel>
                <Input
                  value={rolloverNew.new_name}
                  onChange={(e) => setRolloverNew((r) => ({ ...r, new_name: e.target.value }))}
                  placeholder="TRWC003"
                />
              </div>
              <div>
                <FieldLabel required>NEW T/R NUMBER</FieldLabel>
                <Input
                  value={rolloverNew.new_tr_no}
                  onChange={(e) => setRolloverNew((r) => ({ ...r, new_tr_no: e.target.value }))}
                  placeholder="T112245680"
                />
              </div>
              <div>
                <FieldLabel required tipKey="TERM (DAYS)">NEW TERM (DAYS)</FieldLabel>
                <NumInput
                  value={rolloverNew.new_term_days}
                  onChange={(v) => setRolloverNew((r) => ({ ...r, new_term_days: v }))}
                  className="text-right tabular-nums"
                />
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// =========== Imported Goods Tab ===========
function ImportedGoodsTab({ goods, onChange }: { goods: TRImportedGoods[]; onChange: (n: TRImportedGoods[]) => void }) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const usedRefs = new Set(goods.map((g) => g.reference_no));
  const filtered = MOCK_PURCHASE_ORDERS.filter((p) => {
    if (usedRefs.has(p.reference_no)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.reference_no.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.vendor.toLowerCase().includes(q)
    );
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const onConfirm = () => {
    const picked = MOCK_PURCHASE_ORDERS.filter((p) => selected.has(p.id)).map<TRImportedGoods>((p) => ({
      id: crypto.randomUUID(),
      tr_id: '',
      reference_no: p.reference_no,
      description: p.description,
      vendor: p.vendor,
      amount_foreign: p.amount_foreign,
      sort_order: 0,
    }));
    onChange([...goods, ...picked]);
    setSelected(new Set());
    setLookupOpen(false);
    setSearch('');
  };

  const remove = (i: number) => onChange(goods.filter((_, j) => j !== i));
  const total = goods.reduce((s, g) => s + g.amount_foreign, 0);

  return (
    <div>
      <div className="mb-3 flex justify-between items-center">
        <p className="text-[11px] text-muted italic">
          📌 Imported Goods ดึงจาก <strong>NetSuite Purchase Module</strong> (Vendor Bill + B/L) · 1 invoice ผูกได้ 1 T/R เท่านั้น
        </p>
        <Button variant="primary" onClick={() => setLookupOpen(true)}>
          🔍 Lookup Imported Goods
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <ThTip>Reference No.</ThTip>
              <ThTip>Description</ThTip>
              <ThTip>Vendor</ThTip>
              <ThTip align="right">Amount (Foreign)</ThTip>
              <ThTip>Action</ThTip>
            </tr>
          </thead>
          <tbody>
            {goods.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-6 italic">
                  ยังไม่มี Imported Goods — กด <strong>🔍 Lookup Imported Goods</strong> เพื่อเลือกจาก NetSuite
                </td>
              </tr>
            )}
            {goods.map((g, i) => (
              <tr key={g.id}>
                <td className="font-mono text-xs">{g.reference_no}</td>
                <td>{g.description ?? '—'}</td>
                <td className="text-muted">{g.vendor ?? '—'}</td>
                <td className="text-right tabular-nums">
                  {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                    g.amount_foreign,
                  )}
                </td>
                <td>
                  <button onClick={() => remove(i)} className="text-danger hover:underline text-xs">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {goods.length > 0 && (
              <tr className="bg-soft font-bold border-t-2 border-line">
                <td colSpan={3} className="text-right">Total</td>
                <td className="text-right tabular-nums">
                  {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total)}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Lookup Modal — mock NetSuite Purchase */}
      <Modal
        open={lookupOpen}
        onClose={() => {
          setLookupOpen(false);
          setSelected(new Set());
        }}
        title="🔍 Lookup Imported Goods — NetSuite Purchase Module"
        size="xl"
        footer={
          <>
            <Button onClick={() => setLookupOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={onConfirm} disabled={selected.size === 0}>
              Add Selected ({selected.size})
            </Button>
          </>
        }
      >
        <div className="mb-3">
          <Input
            placeholder="🔍 ค้นหา Reference / Description / Vendor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted mb-3 italic">
          💡 Mock data — ระบบจริงจะดึง <strong>Vendor Bill + B/L</strong> จาก NetSuite Purchase / Import module · 1 invoice ผูกได้ 1 T/R
        </p>
        <div className="overflow-x-auto max-h-[400px]">
          <table className="table-base">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th className="w-10"></th>
                <ThTip>Reference No.</ThTip>
                <ThTip>Description</ThTip>
                <ThTip>Vendor</ThTip>
                <ThTip>Origin</ThTip>
                <ThTip align="right">Amount (Foreign)</ThTip>
                <ThTip align="right">Currency</ThTip>
                <ThTip>B/L Date</ThTip>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted py-6">
                    {usedRefs.size === MOCK_PURCHASE_ORDERS.length
                      ? 'Invoices ทั้งหมดถูกผูกกับ T/R อื่นแล้ว'
                      : 'ไม่พบรายการตามเงื่อนไข'}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className={selected.has(p.id) ? 'bg-brand-light' : 'hover:bg-gray-50 cursor-pointer'}
                  onClick={() => toggleSelect(p.id)}
                >
                  <td>
                    <input type="checkbox" checked={selected.has(p.id)} readOnly />
                  </td>
                  <td className="font-mono text-xs">{p.reference_no}</td>
                  <td>{p.description}</td>
                  <td>{p.vendor}</td>
                  <td className="text-xs">{p.origin}</td>
                  <td className="text-right tabular-nums">
                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                      p.amount_foreign,
                    )}
                  </td>
                  <td className="text-right text-xs">{p.currency}</td>
                  <td className="text-xs">{p.bl_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}

// Mock NetSuite Purchase / Vendor Bill (Imported Goods with B/L)
const MOCK_PURCHASE_ORDERS: {
  id: string;
  reference_no: string;
  description: string;
  vendor: string;
  origin: string;
  amount_foreign: number;
  currency: string;
  bl_date: string;
}[] = [
  { id: 'po-1', reference_no: 'INV-IMP-2023-0421', description: 'Auto parts (BMW Series)', vendor: 'BMW (Thailand) Co., Ltd.', origin: 'Germany', amount_foreign: 122727.27, currency: 'USD', bl_date: '10/10/2023' },
  { id: 'po-2', reference_no: 'INV-IMP-2024-0188', description: 'Engine components X5', vendor: 'BMW AG (Munich)', origin: 'Germany', amount_foreign: 89500.00, currency: 'EUR', bl_date: '15/3/2024' },
  { id: 'po-3', reference_no: 'INV-IMP-2024-0245', description: 'Brake systems batch', vendor: 'Continental AG', origin: 'Germany', amount_foreign: 45200.50, currency: 'EUR', bl_date: '22/5/2024' },
  { id: 'po-4', reference_no: 'INV-IMP-2024-0301', description: 'Transmission units', vendor: 'ZF Friedrichshafen AG', origin: 'Germany', amount_foreign: 156800.00, currency: 'EUR', bl_date: '8/7/2024' },
  { id: 'po-5', reference_no: 'INV-IMP-2024-0354', description: 'Body panels (X7 LCI)', vendor: 'BMW (Thailand) Co., Ltd.', origin: 'Germany', amount_foreign: 78900.00, currency: 'USD', bl_date: '18/8/2024' },
  { id: 'po-6', reference_no: 'INV-IMP-2024-0412', description: 'Electronics & wiring harness', vendor: 'Bosch Mobility', origin: 'Germany', amount_foreign: 34500.00, currency: 'EUR', bl_date: '5/9/2024' },
  { id: 'po-7', reference_no: 'INV-IMP-2024-0467', description: 'Tires (Run-flat) — Pirelli', vendor: 'Pirelli Tyres', origin: 'Italy', amount_foreign: 28700.75, currency: 'EUR', bl_date: '20/9/2024' },
  { id: 'po-8', reference_no: 'INV-IMP-2024-0521', description: 'Spare parts catalog (mixed)', vendor: 'Mahle GmbH', origin: 'Germany', amount_foreign: 19500.00, currency: 'EUR', bl_date: '2/10/2024' },
];

// ── ประวัติการต่ออายุ (Roll Over) ──────────────────────────────────
// ไล่โซ่เอกสารทั้งขึ้นและลงจากฉบับที่เปิดอยู่ ผ่านช่อง rollover_parent_id
// รูปแบบเดียวกับ P/N · L/G · Floor Plan (T/R ตกหล่นไปตอนแรก)
function TRRolloverHistory({ currentId }: { currentId: string }) {
  const { data: chain } = useQuery({
    queryKey: ['tr-rollover-chain', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const visited: any[] = [];
      // ไล่ขึ้นหาฉบับก่อนหน้า
      let cur: any = currentId;
      while (cur) {
        const { data, error } = await supabase.from('trust_receipts').select('*').eq('id', cur).single();
        if (error || !data) break;
        visited.unshift(data);
        cur = data.rollover_parent_id;
      }
      // ไล่ลงหาฉบับที่ต่อจากฉบับนี้
      let lastId = currentId;
      while (lastId) {
        const { data, error } = await supabase.from('trust_receipts')
          .select('*').eq('rollover_parent_id', lastId).maybeSingle();
        if (error || !data) break;
        visited.push(data);
        lastId = data.id;
      }
      return visited;
    },
  });

  // มีแค่ฉบับปัจจุบัน = ยังไม่เคยต่ออายุ ไม่ถือว่าเป็นประวัติ
  if (!chain || chain.length <= 1) {
    return <div className="text-center text-muted py-6 italic text-sm">ยังไม่มีประวัติ Roll Over</div>;
  }

  return (
    <div className="overflow-x-auto">
      <p className="text-xs text-muted mb-3 italic">
        📌 ประวัติการ Roll Over — แสดงโซ่ของ T/R (ฉบับเดิม → ฉบับใหม่)
      </p>
      <table className="table-base">
        <thead>
          <tr>
            <th>#</th>
            <th>T/R Name</th>
            <th>T/R Number</th>
            <th>Transaction Date</th>
            <th>Maturity</th>
            <th className="text-right">Principal</th>
            <th>Status</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          {chain.map((r: any, i: number) => (
            <tr key={r.id} className={r.id === currentId ? 'bg-brand-light' : ''}>
              <td>{i + 1}</td>
              <td className="font-medium">
                {r.name ?? r.tr_no}
                {r.id === currentId && <span className="ml-2 text-xs">(current)</span>}
              </td>
              <td>{r.tr_no}</td>
              <td>{r.transaction_date ? fmtDate(r.transaction_date) : '—'}</td>
              <td>{r.maturity_date ? fmtDate(r.maturity_date) : '—'}</td>
              <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
              <td><Badge variant={statusVariant[r.status] ?? 'default'}>{r.status}</Badge></td>
              <td>{r.reference_contract ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
