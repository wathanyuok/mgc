import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Plus, RefreshCw, Repeat2, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchCaCards } from '@/lib/ca-inherit';
import { Button, Card, CardContent, Input, Select, Badge, FieldLabel, Modal } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import {
  type FloorPlan,
  type FPChassis,
  type FPApBill,
  type FPArBill,
  type FPStatus,
  FINANCE_INSTITUTIONS,
  VENDORS,
} from '@/types/database';
import { createJE, postJE, reverseJE } from '@/lib/je';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, effectiveRate, type RateCard } from '@/components/tx/RateCards';
import { useBaseRateLookup } from '@/lib/interest-rate-master';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';
import { RepaymentsReceived } from '@/components/tx/RepaymentsReceived';
import {
  buildFPSchedule,
  fpTotalInterest,
  fpTotalCurtailment,
  curtailmentFromMaster,
  DEFAULT_CURTAILMENT,
  type FPSchedulePeriod,
} from '@/lib/fp-schedule';

const FP_STATUSES: FPStatus[] = ['Draft', 'Approved', 'Active', 'Roll Over', 'Repaid', 'Closed', 'Cancelled'];

/**
 * Build + post Drawdown JE for a Floor Plan:
 *   Dr. Inventory Floor Plan   (inv)
 *   Dr. Undue Input VAT        (vat = ap - inv)
 *     Cr. AP-Floor Plan        (ap)
 * Marked source_type='FP_DRAWDOWN' so it can be reversed/regenerated.
 */
async function buildAndPostDrawdownJE(
  fpId: string,
  form: any,
  inv: number,
  vat: number,
  ap: number,
) {
  const lines: any[] = [
    {
      account_code: '1213100',
      account_name: 'Inventory — Floor Plan',
      dr: parseFloat(inv.toFixed(2)),
      description: 'Inventory at cost (ex-VAT)',
    },
  ];
  if (vat > 0.005) {
    lines.push({
      account_code: '1163100',
      account_name: 'Undue Input VAT',
      dr: parseFloat(vat.toFixed(2)),
      description: 'VAT — paid to vendor, claim later',
    });
  }
  lines.push({
    account_code: '2142109',
    account_name: 'AP — Floor Plan (Bank)',
    cr: parseFloat(ap.toFixed(2)),
    description: 'Note Payable — Floor Plan drawdown',
  });

  const je = await createJE({
    source_type: 'FP_DRAWDOWN',
    source_id: fpId,
    je_date: form.transaction_date ?? form.start_date,
    description: `${form.name ?? form.fp_no} — Floor Plan Drawdown`,
    remark: `Vendor: ${form.vendor ?? '—'}`,
    lines,
  });
  await postJE(je.id, 'user');
  return je;
}

type Form = Omit<FloorPlan, 'id' | 'created_at' | 'updated_at'>;

const blank: Form = {
  fp_no: '',
  name: null,
  ca_id: null,
  finance_institution: 'KBANK',
  vendor: VENDORS[0],
  schedule_mode: 'bmw',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  transaction_date: new Date().toISOString().slice(0, 10),
  maturity_date: null,
  term_days: 360,
  amount: 0,
  total_amount: 0,
  used_amount: 0,
  status: 'Draft',
  netting_ap: true,
  netting_ar: true,
  reference_contract: null,
  rollover_parent_id: null,
  inactive: false,
  currency: 'THB',
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

export function FPDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const baseRateLookup = useBaseRateLookup(form.finance_institution);
  const [chassis, setChassis] = useState<FPChassis[]>([]);
  const [apBills, setApBills] = useState<FPApBill[]>([]);
  const [arBills, setArBills] = useState<FPArBill[]>([]);
  const [showRollover, setShowRollover] = useState(false);
  const [rolloverNew, setRolloverNew] = useState({ new_name: '', new_fp_no: '', new_term_days: 360 });

  // Load existing
  const { data: existing } = useQuery({
    queryKey: ['fp', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [m, c, ap, ar] = await Promise.all([
        supabase.from('floor_plans').select('*').eq('id', id!).single(),
        supabase.from('fp_chassis').select('*').eq('fp_id', id!).order('sort_order'),
        supabase.from('fp_ap_bills').select('*').eq('fp_id', id!).order('sort_order'),
        supabase.from('fp_ar_bills').select('*').eq('fp_id', id!).order('sort_order'),
      ]);
      if (m.error) throw m.error;
      return {
        main: m.data as FloorPlan,
        chassis: (c.data ?? []) as FPChassis[],
        apBills: (ap.data ?? []) as FPApBill[],
        arBills: (ar.data ?? []) as FPArBill[],
      };
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing.main;
      setForm({
        ...rest,
        rate_cards: existing.main.rate_cards ?? [],
        acct_cards: existing.main.acct_cards ?? [],
      });
      setChassis(existing.chassis);
      setApBills(existing.apBills);
      setArBills(existing.arBills);
    }
  }, [existing]);

  // CA options (for primary info dropdown)
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-fp'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credit_agreements')
        .select('id, ca_name, contract_number, ma_id')
        .order('ca_name');
      if (error) {
        console.error('FP CA options query error:', error);
        return [];
      }
      return data ?? [];
    },
  });

  // Auto-compute maturity_date = transaction_date + term_days
  useEffect(() => {
    if (form.transaction_date && form.term_days) {
      const d = new Date(form.transaction_date);
      d.setDate(d.getDate() + form.term_days);
      const iso = d.toISOString().slice(0, 10);
      if (iso !== form.maturity_date) setForm((f) => ({ ...f, maturity_date: iso }));
    }
  }, [form.transaction_date, form.term_days]);

  // Effective interest rate
  const effRate = useMemo(
    () => (form.rate_cards.length > 0 ? effectiveRate((form.rate_cards as RateCard[])[0]) : 0),
    [form.rate_cards],
  );

  // ── Match Curtailment master by vendor + active effective range ──
  const { data: matchedCurtailment } = useQuery({
    queryKey: ['fp-curtailment-master', form.vendor, form.transaction_date],
    enabled: !!form.vendor && !!form.transaction_date,
    queryFn: async () => {
      const { data } = await supabase
        .from('curtailments')
        .select('*')
        .eq('vendor', form.vendor!)
        .eq('status', 'Active')
        .lte('effective_start_date', form.transaction_date!)
        .or(`effective_end_date.is.null,effective_end_date.gte.${form.transaction_date!}`)
        .order('effective_start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const milestones = useMemo(
    () => (matchedCurtailment ? curtailmentFromMaster(matchedCurtailment) : DEFAULT_CURTAILMENT),
    [matchedCurtailment],
  );

  // Schedule
  const schedule = useMemo<FPSchedulePeriod[]>(
    () =>
      buildFPSchedule(
        form.amount || 0,
        form.rate_cards as RateCard[],
        form.transaction_date ?? form.start_date,
        form.maturity_date ?? form.end_date ?? '',
        form.schedule_mode,
        milestones,
      ),
    [form.amount, form.rate_cards, form.transaction_date, form.start_date, form.maturity_date, form.end_date, form.schedule_mode, milestones],
  );

  const totalInt = useMemo(() => fpTotalInterest(schedule), [schedule]);
  const totalCurtail = useMemo(() => fpTotalCurtailment(schedule), [schedule]);

  const userLabel = useCurrentUserLabel();
  const { can: rawCan } = useAuth();
  const viewOnly = useReadOnly();
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);

  // Save (persists FP + chassis + AP/AR bills, then auto-generates Drawdown JE)
  const save = useMutation({
    mutationFn: async () => {
      await assertWithinCreditLine(form.ca_id, form.amount, { table: 'floor_plans', id });
      const usedAmount = chassis.reduce((s, c) => s + (c.status !== 'Returned' ? c.amount : 0), 0);
      const payload = { ...form, used_amount: usedAmount, total_amount: form.amount || usedAmount, updated_by: userLabel };
      let fpId = id;
      if (mode === 'new') {
        const nm = (form.name ?? '').trim() || await nextRunningNo(RUNNING_PREFIX.fp);
        const { data, error } = await supabase.from('floor_plans').insert({ ...payload, name: nm, created_by: userLabel }).select().single();
        if (error) throw error;
        fpId = data.id;
      } else {
        const { error } = await supabase.from('floor_plans').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', fpId!);
        if (error) throw error;
      }

      // Replace chassis
      await supabase.from('fp_chassis').delete().eq('fp_id', fpId!);
      if (chassis.length > 0) {
        const rows = chassis.map((c, i) => ({
          fp_id: fpId!,
          chassis_no: c.chassis_no,
          engine_no: c.engine_no,
          model: c.model,
          receive_date: c.receive_date,
          amount: c.amount,
          curtail_id: c.curtail_id,
          status: c.status,
          sort_order: i,
          original_location: c.original_location,
          current_location: c.current_location,
          location_modified_at: c.location_modified_at,
        }));
        const { error } = await supabase.from('fp_chassis').insert(rows);
        if (error) throw error;
      }

      // Replace AP Bills
      await supabase.from('fp_ap_bills').delete().eq('fp_id', fpId!);
      if (apBills.length > 0) {
        const rows = apBills.map((b, i) => ({
          fp_id: fpId!,
          invoice_no: b.invoice_no,
          vendor_name: b.vendor_name,
          inventory_amount: b.inventory_amount,
          ap_amount: b.ap_amount,
          sort_order: i,
        }));
        const { error } = await supabase.from('fp_ap_bills').insert(rows);
        if (error) throw error;
      }

      // Replace AR Bills
      await supabase.from('fp_ar_bills').delete().eq('fp_id', fpId!);
      if (arBills.length > 0) {
        const rows = arBills.map((b, i) => ({
          fp_id: fpId!,
          ar_invoice_no: b.ar_invoice_no,
          customer_name: b.customer_name,
          ar_amount: b.ar_amount,
          status: b.status,
          sort_order: i,
        }));
        const { error } = await supabase.from('fp_ar_bills').insert(rows);
        if (error) throw error;
      }

      return fpId;
    },
    onSuccess: (fpId: any) => {
      qc.invalidateQueries({ queryKey: ['fp-list'] });
      qc.invalidateQueries({ queryKey: ['fp', fpId] });
      toast.success(mode === 'new' ? 'สร้าง Floor Plan แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new' && fpId) navigate(`/tx/fp/${fpId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Auto JE list for this FP ──
  const { data: fpJEs } = useQuery({
    queryKey: ['fp-je', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('id, je_number, status, is_reversal, total_dr, total_cr, je_date, description')
        .eq('source_type', 'FP_DRAWDOWN')
        .eq('source_id', id!)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
  });

  // ── Has active (Posted, non-reversal) JE? ──
  const hasActiveJE = useMemo(
    () => (fpJEs ?? []).some((j: any) => j.status === 'Posted' && !j.is_reversal),
    [fpJEs],
  );

  // ── Post Drawdown JE manually (initial post) ──
  const postDrawdownJE = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save Floor Plan ก่อน Post JE');
      if (form.status !== 'Approved') {
        throw new Error(`Post JE ได้เฉพาะ FP ที่ Approved — Status ปัจจุบัน: "${form.status}"`);
      }
      if (apBills.length === 0) throw new Error('เพิ่ม AP Bill ก่อน Post JE');
      const totalAp = apBills.reduce((s, b) => s + b.ap_amount, 0);
      const totalInv = apBills.reduce((s, b) => s + b.inventory_amount, 0);
      const totalVat = totalAp - totalInv;
      if (totalAp <= 0) throw new Error('AP Bill ต้องมียอดมากกว่า 0');

      // Race-safe: re-check at mutation time
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('id, je_number')
        .eq('source_type', 'FP_DRAWDOWN')
        .eq('source_id', id)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (existing && existing.length > 0) {
        throw new Error(`JE มีอยู่แล้ว: ${existing[0].je_number} — กด Regenerate ถ้าจะแทนที่`);
      }

      await buildAndPostDrawdownJE(id, form, totalInv, totalVat, totalAp);

      // Auto-promote status: Approved → Active
      await supabase.from('floor_plans').update({ status: 'Active' }).eq('id', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fp-je', id] });
      qc.invalidateQueries({ queryKey: ['fp', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Active' }));
      toast.success('✓ Posted Drawdown JE · Status → Active');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Regenerate JE: reverse all active + post fresh ──
  const regenerateJE = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save Floor Plan ก่อน Regenerate JE');
      const totalAp = apBills.reduce((s, b) => s + b.ap_amount, 0);
      const totalInv = apBills.reduce((s, b) => s + b.inventory_amount, 0);
      const totalVat = totalAp - totalInv;
      if (totalAp <= 0) throw new Error('AP Bill ต้องมียอดมากกว่า 0');

      const { data: actives } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('source_type', 'FP_DRAWDOWN')
        .eq('source_id', id)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      for (const je of actives ?? []) {
        await reverseJE(je.id, 'user');
      }

      await buildAndPostDrawdownJE(id, form, totalInv, totalVat, totalAp);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fp-je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('✓ Regenerated Journal Entry');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Posted-periods tracking for Schedule Calculate (Accrued + Curtailment per period) ──
  const { data: postedPeriods } = useQuery({
    queryKey: ['fp-posted-periods', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('source_period, source_type, status, is_reversal')
        .in('source_type', ['FP_ACCRUED', 'FP_CURTAIL'])
        .eq('source_id', id!);
      const set = new Set<string>();
      (data ?? []).forEach((d: any) => {
        if (d.status === 'Posted' && d.is_reversal !== true && d.source_period != null) {
          set.add(`${d.source_type}:${d.source_period}`);
        }
      });
      return set;
    },
  });

  const postPeriodJE = useMutation({
    mutationFn: async (r: FPSchedulePeriod) => {
      if (!id) throw new Error('Save Floor Plan ก่อน Post JE');
      const isCurtail = r.curtailPct > 0;
      const sourceType = isCurtail ? 'FP_CURTAIL' : 'FP_ACCRUED';

      // Race-safe re-check
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', sourceType)
        .eq('source_id', id)
        .eq('source_period', r.period)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (existing && existing.length > 0) {
        throw new Error(`Period ${r.period} (${sourceType}) มี JE อยู่แล้ว: ${existing[0].je_number}`);
      }

      const desc = isCurtail
        ? `${form.name ?? form.fp_no} — Period ${r.period} Curtailment ${r.curtailPct}%`
        : `${form.name ?? form.fp_no} — Period ${r.period} Accrued Interest`;

      const lines = isCurtail
        ? [
            {
              account_code: '2142109',
              account_name: 'Note Payable - Floor Plan',
              dr: r.curtailAmount,
              description: `Curtailment ${r.curtailPct}% (day ${r.days})`,
            },
            {
              account_code: '100000',
              account_name: 'Cash - Bank',
              cr: r.curtailAmount,
              description: 'Cash out for curtailment',
            },
          ]
        : [
            {
              account_code: '5512105',
              account_name: 'ดอกเบี้ยจ่าย-Floor Plan',
              dr: r.interest,
              description: `Accrued interest ${r.days} วัน × ${r.rate.toFixed(4)}%`,
            },
            {
              account_code: '2194109',
              account_name: 'ดอกเบี้ยค้างจ่าย-สถาบันการเงิน',
              cr: r.interest,
              description: 'Accrued interest payable',
            },
          ];

      const je = await createJE({
        source_type: sourceType,
        source_id: id,
        source_period: r.period,
        je_date: r.endDate ?? form.transaction_date ?? form.start_date,
        description: desc,
        remark: isCurtail
          ? `Curtailment milestone — day ${r.days}, ${r.curtailPct}% of original principal`
          : 'Monthly accrued interest — auto-reverse on next month start (manual flag)',
        lines,
      });
      await postJE(je.id, 'user');
      return je;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fp-posted-periods', id] });
      qc.invalidateQueries({ queryKey: ['fp-je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('✓ JE Posted to GL');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Roll Over chain context (validate against CA limits) ──
  const { data: rolloverContext } = useQuery({
    queryKey: ['fp-rollover-context', id, form.ca_id],
    enabled: !!id,
    queryFn: async () => {
      // Walk up parent chain to count rollovers + accumulated days
      let cur = id!;
      let count = 0;
      let earliestStart = form.transaction_date;
      while (cur) {
        const { data } = await supabase
          .from('floor_plans')
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
      // Fetch CA limits
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
      if (!id) throw new Error('Save Floor Plan ก่อน');
      if (form.status !== 'Approved' && form.status !== 'Active')
        throw new Error(`Roll Over ได้เฉพาะ FP สถานะ Approved หรือ Active (ปัจจุบัน: ${form.status})`);
      if (!rolloverNew.new_fp_no.trim()) throw new Error('กรุณาระบุ New FP Number');
      if (!rolloverNew.new_term_days || rolloverNew.new_term_days <= 0) {
        throw new Error('Term (Days) ต้องมากกว่า 0');
      }

      // Validate against CA limits
      const ctx = rolloverContext;
      if (ctx?.max_times != null && ctx.count >= ctx.max_times) {
        throw new Error(`เกินจำนวน Roll Over สูงสุด (${ctx.max_times} ครั้ง) ที่กำหนดใน CA`);
      }
      if (ctx?.max_days != null && ctx.usedDays + rolloverNew.new_term_days > ctx.max_days) {
        throw new Error(`รวมระยะเวลาเกิน ${ctx.max_days} วันที่ CA กำหนด — ใช้ไป ${ctx.usedDays}, ขอเพิ่ม ${rolloverNew.new_term_days}`);
      }

      // Today as new transaction date; maturity = today + new_term_days
      const today = new Date().toISOString().slice(0, 10);
      const matDate = new Date();
      matDate.setDate(matDate.getDate() + rolloverNew.new_term_days);
      const newMaturity = matDate.toISOString().slice(0, 10);

      // Create new FP (copy form, override key fields)
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = form as any;
      const newPayload = {
        ...rest,
        fp_no: rolloverNew.new_fp_no.trim(),
        name: await nextRunningNo(RUNNING_PREFIX.fp),
        transaction_date: today,
        start_date: today,
        maturity_date: newMaturity,
        term_days: rolloverNew.new_term_days,
        status: 'Approved' as FPStatus,
        rollover_parent_id: id,
      };
      const { data: newFp, error: insErr } = await supabase
        .from('floor_plans')
        .insert(newPayload)
        .select()
        .single();
      if (insErr) throw insErr;

      // Mark old as Roll Over
      await supabase.from('floor_plans').update({ status: 'Roll Over' }).eq('id', id);

      return newFp;
    },
    onSuccess: (newFp: any) => {
      qc.invalidateQueries({ queryKey: ['fp-list'] });
      qc.invalidateQueries({ queryKey: ['fp', id] });
      toast.success(`✓ Roll Over → ${newFp.fp_no}`);
      setShowRollover(false);
      navigate(`/tx/fp/${newFp.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ensureFpId — auto-create Draft so user can upload Document before formal save
  const ensureFpId = async (): Promise<string> => {
    if (id) return id;
    const fpNo = (form.fp_no ?? '').trim() || `DRAFT-${Date.now()}`;
    const name = (form.name ?? '').trim() || fpNo;
    const { data, error } = await supabase
      .from('floor_plans')
      .insert({ ...form, fp_no: fpNo, name, status: 'Draft' })
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['fp-list'] });
    navigate(`/tx/fp/${data.id}`, { replace: true });
    return data.id as string;
  };

  // ========= Tabs =========
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
        />
      ),
    },
    {
      key: 'acct',
      label: 'Accounting',
      render: () => (
        <AcctCards accounts={form.acct_cards as AcctCard[]} onChange={(n) => setForm((f) => ({ ...f, acct_cards: n }))} />
      ),
    },
    {
      key: 'chassis',
      label: 'Chassis',
      render: () => (
        <ChassisWithBillsTab
          chassis={chassis}
          onChangeChassis={setChassis}
          apBills={apBills}
          onChangeAp={setApBills}
          arBills={arBills}
          onChangeAr={setArBills}
          fpJEs={fpJEs ?? []}
          hasActiveJE={hasActiveJE}
          onPost={() => postDrawdownJE.mutate()}
          onRegenerate={() => regenerateJE.mutate()}
          posting={postDrawdownJE.isPending}
          regenerating={regenerateJE.isPending}
          fpId={id}
          fpStatus={form.status}
          effRate={effRate}
          startDate={form.transaction_date ?? form.start_date}
          maturityDate={form.maturity_date ?? form.end_date ?? null}
        />
      ),
    },
    {
      key: 'sched',
      label: 'Schedule Calculate',
      render: () => (
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs">
            <div className="inline-flex rounded border border-line overflow-hidden">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, schedule_mode: 'bmw' }))}
                className={`px-4 py-2 text-xs font-semibold ${form.schedule_mode === 'bmw' ? 'bg-brand text-white' : 'bg-white text-ink hover:bg-soft'}`}
              >
                ✓ Curtailment Schedule
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, schedule_mode: 'other' }))}
                className={`px-4 py-2 text-xs font-semibold ${form.schedule_mode === 'other' ? 'bg-brand text-white' : 'bg-white text-ink hover:bg-soft border-l border-line'}`}
              >
                ☐ No Curtailment
              </button>
            </div>
            <span className="text-muted ml-2">
              {form.schedule_mode === 'bmw' ? (
                <>
                  {`(Curtailment ${milestones.map((m) => `${m.day}d ${m.pct}%`).join(' · ')})`}
                  {matchedCurtailment ? (
                    <span className="ml-1 text-emerald-700">
                      ← จาก master <strong>{matchedCurtailment.vendor}</strong>
                    </span>
                  ) : (
                    <span className="ml-1 text-amber-700">← ใช้ default (ไม่พบ master ตาม vendor)</span>
                  )}
                </>
              ) : (
                '(รับรู้ดอกเบี้ยรายเดือนถึง Maturity · ไม่มี curtailment milestone)'
              )}
            </span>
          </div>
          {schedule.length === 0 ? (
            <div className="bg-soft border border-line rounded p-6 text-center text-muted text-sm">
              กรอก Amount + Transaction Date + Maturity Date + Interest Rate ใน Primary / Interest Rate tab
              เพื่อแสดงตาราง schedule
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[520px]">
              <table className="table-base">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    <ThTip align="right">Period</ThTip>
                    <ThTip>Start Date</ThTip>
                    <ThTip>End Date</ThTip>
                    <ThTip align="right">Day</ThTip>
                    {form.schedule_mode === 'bmw' && <ThTip align="right">Due Curtailment</ThTip>}
                    {form.schedule_mode === 'bmw' && <ThTip align="right">Curtailment</ThTip>}
                    <ThTip align="right">Interest Rate</ThTip>
                    <ThTip align="right">Interest</ThTip>
                    <ThTip align="right">Principal Balance</ThTip>
                    <ThTip align="right">Interest Balance</ThTip>
                    <ThTip>JE</ThTip>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((r) => {
                    const isCurtail = r.curtailPct > 0;
                    const sourceType = isCurtail ? 'FP_CURTAIL' : 'FP_ACCRUED';
                    const posted = postedPeriods?.has(`${sourceType}:${r.period}`) ?? false;
                    const canPost = r.period > 0 && !posted && !!id && (isCurtail ? r.curtailAmount > 0 : r.interest > 0);
                    return (
                      <tr key={r.period} className={isCurtail ? (r.curtailPct >= 50 ? 'bg-red-50' : 'bg-amber-50') : ''}>
                        <td className="text-right tabular-nums">{r.period}</td>
                        <td>{r.startDate ? fmtDate(r.startDate) : '—'}</td>
                        <td>{r.endDate ? fmtDate(r.endDate) : '—'}</td>
                        <td className="text-right tabular-nums">{r.days || '—'}</td>
                        {form.schedule_mode === 'bmw' && (
                          <td className="text-right tabular-nums">
                            {r.curtailPct > 0 ? <strong className={r.curtailPct >= 50 ? 'text-danger' : 'text-amber-700'}>{r.curtailPct}%</strong> : '—'}
                          </td>
                        )}
                        {form.schedule_mode === 'bmw' && (
                          <td className="text-right tabular-nums">
                            {r.curtailAmount > 0 ? <strong className={r.curtailPct >= 50 ? 'text-danger' : 'text-amber-700'}>{fmtMoney(r.curtailAmount)}</strong> : '—'}
                          </td>
                        )}
                        <td className="text-right tabular-nums">{r.rate.toFixed(4)}%</td>
                        <td className="text-right tabular-nums">{fmtMoney(r.interest)}</td>
                        <td className="text-right tabular-nums font-medium">{fmtMoney(r.principalBalance)}</td>
                        <td className="text-right tabular-nums">{fmtMoney(r.interestBalance)}</td>
                        <td className="text-xs">
                          {r.period === 0 ? (
                            <span className="text-muted">—</span>
                          ) : posted ? (
                            <Badge variant="success">Posted</Badge>
                          ) : canPost ? (
                            <button
                              onClick={() => postPeriodJE.mutate(r)}
                              disabled={postPeriodJE.isPending || viewOnly}
                              className={`hover:underline ${isCurtail ? 'text-danger font-semibold' : 'text-brand'}`}
                              title={isCurtail ? `Post Curtailment ${r.curtailPct}% JE` : 'Post Accrued Interest JE'}
                            >
                              {isCurtail ? `📋 Curtail` : `📋 Accrued`}
                            </button>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-soft font-bold border-t-2 border-line">
                    <td colSpan={3} className="text-right">Total</td>
                    <td className="text-right tabular-nums">
                      {schedule.slice(1).reduce((s, r) => s + r.days, 0)}
                    </td>
                    {form.schedule_mode === 'bmw' && (
                      <>
                        <td className="text-right tabular-nums">
                          {totalCurtail > 0 ? '100%' : '—'}
                        </td>
                        <td className="text-right tabular-nums">{fmtMoney(totalCurtail)}</td>
                      </>
                    )}
                    <td />
                    <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                    <td />
                    <td />
                    <td />
                  </tr>
                </tbody>
              </table>
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
            <RowTip label="Effective Interest Rate" value={`${effRate.toFixed(4)}%`} bold />
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
                  <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                  <td className="text-right tabular-nums">0.00</td>
                  <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                </tr>
                <tr>
                  <td><strong>Curtailment Plan</strong></td>
                  <td className="text-right tabular-nums">{fmtMoney(totalCurtail)}</td>
                  <td className="text-right tabular-nums">0.00</td>
                  <td className="text-right tabular-nums">{fmtMoney(totalCurtail)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted">
            ACCUMULATED ACCRUED: <strong>{fmtMoney(0)}</strong>
          </div>
          <RepaymentsReceived facilityId={id} principal={form.amount} interest={totalInt} />
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
          <InheritedDocs caId={form.ca_id} />
          <div>
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              Transaction Documents
              <span className="text-[10px] uppercase tracking-wider text-muted bg-white border border-line px-2 py-0.5 rounded">
                Floor Plan
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureFpId}
              bucketName="fp-documents"
              tableName="fp_documents"
              parentFkColumn="fp_id"
            />
          </div>
        </div>
      ),
    },
  ];

  const selectedCa = caOptions?.find((c) => c.id === form.ca_id);

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/fp')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Floor Plan
            <Badge variant={statusVariant[form.status] ?? 'default'}>{form.status}</Badge>
          </h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New Floor Plan' : (form.name ?? form.fp_no)}
          </p>
        </div>
        <Button
          onClick={() => setShowRollover(true)}
          disabled={!id || (form.status !== 'Approved' && form.status !== 'Active') || !can('fp', 'approve')}
          title={
            !id
              ? 'Save Floor Plan ก่อน'
              : form.status !== 'Approved' && form.status !== 'Active'
                ? `Roll Over ได้เฉพาะ FP ที่ Approved หรือ Active — Status: "${form.status}"`
                : 'Roll Over Floor Plan — สร้าง FP ใหม่ที่อ้างถึงใบนี้'
          }
        >
          <Repeat2 className="w-4 h-4" /> Roll Over
        </Button>
        <Button variant="primary" disabled={save.isPending || !can('fp', 'edit')} title={!can('fp', 'edit') ? 'ไม่มีสิทธิ์แก้ไข Floor Plan' : ''} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={() => navigate('/tx/fp')}>Cancel</Button>
      </div>

      <AuditFooter createdBy={(form as any).created_by} createdAt={(form as any).created_at} updatedBy={(form as any).updated_by} updatedAt={(form as any).updated_at} />

      {/* ── Primary Information (3-col) ── */}
      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.inactive}
                onChange={(e) => setForm((f) => ({ ...f, inactive: e.target.checked }))}
              />
              <FieldLabel>INACTIVE</FieldLabel>
            </label>
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
              <FieldLabel tipKey="FP NAME">NAME (auto)</FieldLabel>
              <Input readOnly value={form.name ?? ''} placeholder="auto — running no. (สร้างเมื่อ Save)" className="bg-gray-50 text-muted" />
            </div>
            <div>
              <FieldLabel required tipKey="FLOOR PLAN NUMBER">FLOOR PLAN NUMBER</FieldLabel>
              <Input
                value={form.fp_no}
                onChange={(e) => setForm((f) => ({ ...f, fp_no: e.target.value }))}
                placeholder="FP00001"
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
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required tipKey="TERM (DAYS)">TERM (DAYS)</FieldLabel>
              <Input
                type="number"
                value={form.term_days ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, term_days: parseInt(e.target.value) || null }))}
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
            <div>
              <FieldLabel required>AMOUNT</FieldLabel>
              <Input
                type="number"
                step="0.01"
                value={form.amount ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <FieldLabel>FACILITY TYPE</FieldLabel>
              <Input readOnly value="Floor Plan" className="bg-gray-50" />
            </div>
            <div>
              <FieldLabel required>STATUS</FieldLabel>
              <Select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as FPStatus }))}
              >
                {FP_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* COL 3 */}
          <div className="space-y-4">
            <div>
              <FieldLabel>FINANCE INSTITUTION</FieldLabel>
              <Select
                value={form.finance_institution}
                onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}
              >
                {FINANCE_INSTITUTIONS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>VENDOR</FieldLabel>
              <Select
                value={form.vendor ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value || null }))}
              >
                {VENDORS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </div>
            {/* NETTING AP / NETTING AR — hidden until business logic is finalized
                (default = true ใน DB · ใส่กลับเมื่อ implement logic จริง)
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.netting_ap}
                onChange={(e) => setForm((f) => ({ ...f, netting_ap: e.target.checked }))}
              />
              <FieldLabel tipKey="NETTING AP">NETTING AP</FieldLabel>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.netting_ar}
                onChange={(e) => setForm((f) => ({ ...f, netting_ar: e.target.checked }))}
              />
              <FieldLabel tipKey="NETTING AR">NETTING AR</FieldLabel>
            </label>
            */}
            <div>
              <FieldLabel tipKey="REFERENCE CONTRACT">REFERENCE CONTRACT</FieldLabel>
              <Input
                value={form.reference_contract ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, reference_contract: e.target.value || null }))}
                placeholder=""
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

      {/* ── Tabs ── */}
      <div className="mt-4">
        <Tabs tabs={tabs} />
      </div>

      {/* ── Roll Over Modal ── */}
      <Modal
        open={showRollover}
        onClose={() => setShowRollover(false)}
        title="🔁 Roll Over Floor Plan"
        size="lg"
        footer={
          <>
            <Button onClick={() => setShowRollover(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => rollover.mutate()}
              disabled={rollover.isPending}
            >
              <Repeat2 className="w-4 h-4" /> {rollover.isPending ? 'Rolling Over...' : 'Confirm Roll Over'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          {/* Workflow explanation */}
          <div className="bg-blue-50 border-l-4 border-brand rounded p-3 text-xs leading-relaxed">
            <div className="font-bold text-brand-dark mb-1">ℹ️ Roll Over จะทำอะไรบ้าง</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>เปลี่ยน Status ของ Floor Plan เดิมเป็น <strong>"Roll Over"</strong></li>
              <li>สร้าง Floor Plan Usage ใหม่ พร้อม <strong>Reference Contract</strong> ชี้กลับ FP เดิม</li>
              <li>คัดลอก Chassis / Rate / Account / AP-AR Bills จาก FP เดิม</li>
              <li>เริ่ม Curtailment Schedule ใหม่จากวันที่ Roll Over (90 / 180 / 270 วัน — 10%/10%/80%)</li>
            </ol>
          </div>

          {/* Roll Over context */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-soft rounded p-2">
              <div className="text-muted">Floor Plan เดิม</div>
              <div className="font-semibold">{form.name ?? form.fp_no}</div>
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
              <div className="text-muted">Vendor</div>
              <div className="font-semibold">{form.vendor ?? '—'}</div>
            </div>
          </div>

          {/* CA Limits info */}
          {rolloverContext && (
            <div className="bg-amber-50 border-l-4 border-amber-400 rounded p-3 text-xs">
              <div className="font-bold text-amber-800 mb-1">💡 Roll Over Rules (จาก CA)</div>
              <ul className="list-disc list-inside space-y-0.5">
                <li>
                  Maximum Roll Over (Times):{' '}
                  <strong>{rolloverContext.max_times ?? 'ไม่จำกัด'}</strong> ครั้ง — ใช้ไปแล้ว{' '}
                  <strong className="text-brand">{rolloverContext.count}</strong> ครั้ง
                  {rolloverContext.max_times != null && (
                    <> · เหลือ <strong>{Math.max(0, rolloverContext.max_times - rolloverContext.count)}</strong> ครั้ง</>
                  )}
                </li>
                <li>
                  Maximum Term (Days):{' '}
                  <strong>{rolloverContext.max_days ?? 'ไม่จำกัด'}</strong> วัน — ใช้ไปแล้ว{' '}
                  <strong className="text-brand">{rolloverContext.usedDays}</strong> วัน
                  {rolloverContext.max_days != null && (
                    <> · เหลือ <strong>{Math.max(0, rolloverContext.max_days - rolloverContext.usedDays)}</strong> วัน</>
                  )}
                </li>
              </ul>
            </div>
          )}

          {/* New FP fields */}
          <div className="border-t border-line pt-3">
            <div className="font-bold mb-2">📝 Floor Plan ใหม่</div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <FieldLabel tipKey="FP NAME">NEW NAME</FieldLabel>
                <Input value="auto — running no. (สร้างเมื่อ Confirm)" readOnly disabled />
              </div>
              <div>
                <FieldLabel required tipKey="FLOOR PLAN NUMBER">NEW FP NUMBER</FieldLabel>
                <Input
                  value={rolloverNew.new_fp_no}
                  onChange={(e) => setRolloverNew((r) => ({ ...r, new_fp_no: e.target.value }))}
                  placeholder="FP00002"
                />
              </div>
              <div>
                <FieldLabel required tipKey="TERM (DAYS)">NEW TERM (DAYS)</FieldLabel>
                <Input
                  type="number"
                  value={rolloverNew.new_term_days}
                  onChange={(e) => setRolloverNew((r) => ({ ...r, new_term_days: parseInt(e.target.value) || 0 }))}
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

// ====== Chassis tab WRAPPER — 3 sub-tabs + Workflow + Regenerate JE + JE list ======
function ChassisWithBillsTab({
  chassis,
  onChangeChassis,
  apBills,
  onChangeAp,
  arBills,
  onChangeAr,
  fpJEs,
  hasActiveJE,
  onPost,
  onRegenerate,
  posting,
  regenerating,
  fpId,
  fpStatus,
  effRate,
  startDate,
  maturityDate,
}: {
  chassis: FPChassis[];
  onChangeChassis: (c: FPChassis[]) => void;
  apBills: FPApBill[];
  onChangeAp: (b: FPApBill[]) => void;
  arBills: FPArBill[];
  onChangeAr: (b: FPArBill[]) => void;
  fpJEs: any[];
  hasActiveJE: boolean;
  onPost: () => void;
  onRegenerate: () => void;
  posting: boolean;
  regenerating: boolean;
  fpId: string | undefined;
  fpStatus: string;
  effRate: number;
  startDate: string;
  maturityDate: string | null;
}) {
  const [sub, setSub] = useState<'chassis' | 'apbill' | 'arbill' | 'rental'>('chassis');
  const ro = useReadOnly();

  const activeJEs = fpJEs.filter((j: any) => j.status === 'Posted' && !j.is_reversal);

  return (
    <div>
      {/* ── Sub-tabs pill nav ── */}
      <div className="flex gap-5 mb-4 pb-1.5 border-b border-line">
        {([
          { key: 'chassis', label: 'Chassis' },
          { key: 'apbill', label: 'AP Bill' },
          { key: 'arbill', label: 'AR Bill' },
          { key: 'rental', label: 'Rental (รายคัน)' },
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

      {sub === 'chassis' && <ChassisSubTab chassis={chassis} onChange={onChangeChassis} />}
      {sub === 'apbill' && <ApBillSubTab apBills={apBills} onChange={onChangeAp} />}
      {sub === 'arbill' && <ArBillSubTab arBills={arBills} onChange={onChangeAr} />}
      {sub === 'rental' && <RentalUnitSubTab chassis={chassis} effRate={effRate} startDate={startDate} maturityDate={maturityDate} />}

      {/* ── Workflow info banner ── */}
      <div className="mt-6 bg-blue-50 border-l-4 border-brand rounded p-3 text-xs leading-relaxed">
        <div className="font-bold text-brand-dark mb-1 flex items-center gap-1">
          ℹ️ <span>Workflow ของหน้านี้</span>
        </div>
        <ol className="list-decimal list-inside space-y-0.5 text-ink">
          <li>กรอกข้อมูลใน <strong>Chassis / AP Bill / AR Bill</strong> ให้ครบ</li>
          <li>กด <strong>[Save]</strong> บน toolbar ด้านบน — บันทึกเฉพาะข้อมูล (<strong className="text-muted">ไม่ post JE</strong>)</li>
          <li>กด <strong>[📋 Post Journal Entry]</strong> เมื่อข้อมูลพร้อม — ระบบสร้าง JE Drawdown ลง GL</li>
          <li>กด <strong>[🔄 Regenerate Journal Entry]</strong> ถ้าแก้ข้อมูลภายหลัง — reverse JE เดิม + post ใหม่</li>
        </ol>
      </div>

      {/* ── Post / Regenerate JE buttons ── */}
      <div className="mt-4 flex justify-between items-center">
        <div className="text-xs text-muted italic">
          💡 {hasActiveJE
            ? 'มี JE Posted แล้ว — กด Regenerate เพื่อ reverse + post ใหม่ตามข้อมูลล่าสุด'
            : 'JE ยังไม่ได้โพสต์ — กด Post เพื่อสร้าง JE Drawdown'}
        </div>
        {hasActiveJE ? (
          <Button
            onClick={onRegenerate}
            disabled={!fpId || regenerating || apBills.length === 0 || ro}
            title={
              !fpId
                ? 'Save Floor Plan ก่อน'
                : apBills.length === 0
                  ? 'เพิ่ม AP Bill ก่อน'
                  : 'Reverse JE ปัจจุบัน + สร้างใหม่จากข้อมูลล่าสุด'
            }
            className="bg-gray-700 text-white border-gray-700 hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} />
            {regenerating ? 'Regenerating...' : 'Regenerate Journal Entry'}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={onPost}
            disabled={!fpId || posting || apBills.length === 0 || fpStatus !== 'Approved' || ro}
            title={
              !fpId
                ? 'Save Floor Plan ก่อน'
                : fpStatus !== 'Approved'
                  ? `Post ได้เฉพาะ Status = Approved — ตอนนี้: "${fpStatus}" (เปลี่ยน Status ก่อน)`
                  : apBills.length === 0
                    ? 'เพิ่ม AP Bill ก่อน Post JE'
                    : 'สร้าง JE Drawdown + เปลี่ยน Status เป็น Active'
            }
          >
            📋 {posting ? 'Posting...' : 'Post Journal Entry'}
          </Button>
        )}
      </div>

      {/* ── JE list / preview cards ── */}
      {fpJEs.length > 0 && (
        <div className="mt-5">
          <div className="text-sm font-bold mb-2 flex items-center gap-2">
            📒 <span>Generated Journal Entries ({activeJEs.length} active / {fpJEs.length} total)</span>
          </div>
          <div className="space-y-2">
            {fpJEs.map((je: any) => (
              <div
                key={je.id}
                className={`border rounded p-3 text-xs flex items-center justify-between ${
                  je.is_reversal
                    ? 'bg-gray-50 border-line text-muted'
                    : je.status === 'Posted'
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-soft border-line'
                }`}
              >
                <div>
                  <a className="font-bold text-brand hover:underline" href={`/je/${je.id}`}>
                    {je.je_number}
                  </a>
                  <span className="ml-2 text-muted">·</span>
                  <span className="ml-2">{je.je_date ? fmtDate(je.je_date) : '—'}</span>
                  <span className="ml-2 text-muted">·</span>
                  <span className="ml-2">{je.description}</span>
                  {je.is_reversal && (
                    <Badge variant="warn" className="ml-2">
                      REVERSAL
                    </Badge>
                  )}
                  <Badge variant={je.status === 'Posted' ? 'success' : je.status === 'Reversed' ? 'default' : 'warn'} className="ml-1.5">
                    {je.status}
                  </Badge>
                </div>
                <div className="font-semibold tabular-nums">
                  Dr {fmtMoney(je.total_dr)} / Cr {fmtMoney(je.total_cr)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AP Bill sub-tab ──
function ApBillSubTab({ apBills, onChange }: { apBills: FPApBill[]; onChange: (b: FPApBill[]) => void }) {
  const add = () =>
    onChange([
      ...apBills,
      {
        id: crypto.randomUUID(),
        fp_id: '',
        invoice_no: '',
        vendor_name: 'BMW (Thailand) Co., Ltd.',
        inventory_amount: 0,
        ap_amount: 0,
        sort_order: apBills.length,
      },
    ]);
  const update = (i: number, patch: Partial<FPApBill>) =>
    onChange(apBills.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => onChange(apBills.filter((_, j) => j !== i));

  const totalInv = apBills.reduce((s, b) => s + b.inventory_amount, 0);
  const totalAp = apBills.reduce((s, b) => s + b.ap_amount, 0);

  return (
    <div>
      <div className="mb-3 flex justify-between items-center">
        <p className="text-[11px] text-muted italic">
          📌 AP Bill — ใบเรียกเก็บจากผู้ผลิตรถ · Inventory Amount = ราคารถไม่รวม VAT · AP Amount = ราคารวม VAT
        </p>
        <Button variant="primary" onClick={add}>
          <Plus className="w-4 h-4" /> New AP Bill
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <ThTip>INVOICE NO.</ThTip>
              <ThTip>VENDOR NAME</ThTip>
              <ThTip align="right">INVENTORY AMOUNT</ThTip>
              <ThTip align="right">AP AMOUNT</ThTip>
              <ThTip>ACTION</ThTip>
            </tr>
          </thead>
          <tbody>
            {apBills.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-6 italic">
                  — ยังไม่มี AP Bill — กด <strong>+ New AP Bill</strong> เพื่อเพิ่ม —
                </td>
              </tr>
            )}
            {apBills.map((b, i) => (
              <tr key={b.id}>
                <td>
                  <Input value={b.invoice_no} onChange={(e) => update(i, { invoice_no: e.target.value })} placeholder="CARIN2024100005" />
                </td>
                <td>
                  <Select
                    value={b.vendor_name ?? ''}
                    onChange={(e) => update(i, { vendor_name: e.target.value || null })}
                  >
                    {VENDORS.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                </td>
                <td>
                  <Input
                    type="number"
                    step="0.01"
                    value={b.inventory_amount}
                    onChange={(e) => update(i, { inventory_amount: parseFloat(e.target.value) || 0 })}
                    className="text-right tabular-nums"
                  />
                </td>
                <td>
                  <Input
                    type="number"
                    step="0.01"
                    value={b.ap_amount}
                    onChange={(e) => update(i, { ap_amount: parseFloat(e.target.value) || 0 })}
                    className="text-right tabular-nums"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="text-danger hover:underline text-xs"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {apBills.length > 0 && (
              <tr className="bg-soft font-bold border-t-2 border-line">
                <td colSpan={2} className="text-right">Total</td>
                <td className="text-right tabular-nums">{fmtMoney(totalInv)}</td>
                <td className="text-right tabular-nums">{fmtMoney(totalAp)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── AR Bill sub-tab ──
function ArBillSubTab({ arBills, onChange }: { arBills: FPArBill[]; onChange: (b: FPArBill[]) => void }) {
  const add = () =>
    onChange([
      ...arBills,
      {
        id: crypto.randomUUID(),
        fp_id: '',
        ar_invoice_no: '',
        customer_name: '',
        ar_amount: 0,
        status: 'Pending',
        sort_order: arBills.length,
      },
    ]);
  const update = (i: number, patch: Partial<FPArBill>) =>
    onChange(arBills.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => onChange(arBills.filter((_, j) => j !== i));

  const totalAr = arBills.reduce((s, b) => s + b.ar_amount, 0);

  return (
    <div>
      <div className="mb-3 flex justify-between items-center">
        <p className="text-[11px] text-muted italic">
          📌 AR Bill — ใบเรียกเก็บจากลูกค้าเมื่อขายรถ · ใช้เป็นตัว trigger Curtailment (คืนเงินต้น)
        </p>
        <Button variant="primary" onClick={add}>
          <Plus className="w-4 h-4" /> New AR Bill
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <ThTip>AR INVOICE NO.</ThTip>
              <ThTip>CUSTOMER</ThTip>
              <ThTip align="right">AR AMOUNT</ThTip>
              <ThTip>STATUS</ThTip>
              <ThTip>ACTION</ThTip>
            </tr>
          </thead>
          <tbody>
            {arBills.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted py-6 italic">
                  — ยังไม่มี AR Bill — กด <strong>+ New AR Bill</strong> เพื่อเพิ่ม —
                </td>
              </tr>
            )}
            {arBills.map((b, i) => (
              <tr key={b.id}>
                <td>
                  <Input value={b.ar_invoice_no} onChange={(e) => update(i, { ar_invoice_no: e.target.value })} placeholder="AR-2024-001" />
                </td>
                <td>
                  <Input value={b.customer_name ?? ''} onChange={(e) => update(i, { customer_name: e.target.value || null })} placeholder="ลูกค้า" />
                </td>
                <td>
                  <Input
                    type="number"
                    step="0.01"
                    value={b.ar_amount}
                    onChange={(e) => update(i, { ar_amount: parseFloat(e.target.value) || 0 })}
                    className="text-right tabular-nums"
                  />
                </td>
                <td>
                  <Select value={b.status} onChange={(e) => update(i, { status: e.target.value })}>
                    <option>Pending</option>
                    <option>Paid</option>
                    <option>Cancelled</option>
                  </Select>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="text-danger hover:underline text-xs"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {arBills.length > 0 && (
              <tr className="bg-soft font-bold border-t-2 border-line">
                <td colSpan={2} className="text-right">Total</td>
                <td className="text-right tabular-nums">{fmtMoney(totalAr)}</td>
                <td />
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ====== Rental Charges (รายคัน) — per-unit interest report ======
// ตรงตามตัวอย่าง "Rental Charges Unit by Unit Report" ของ MGC:
//   Charges ต่อคัน = Amount × Rate% × Days / 365 (actual/365, ดอกเบี้ย FP ไม่มี VAT)
//   Days = จำนวนวันที่รถอยู่บน floor plan ถึงวันรายงาน (cap ที่ Maturity)
function RentalUnitSubTab({ chassis, effRate, startDate, maturityDate }: {
  chassis: FPChassis[]; effRate: number; startDate: string; maturityDate: string | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [reportDate, setReportDate] = useState(today);
  const dd = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
  const rows = chassis
    .filter((c) => c.status !== 'Returned')
    .map((c, i) => {
      const from = c.receive_date || startDate;
      const to = maturityDate && reportDate > maturityDate ? maturityDate : reportDate;
      const days = dd(from, to);
      const preVat = (c.amount * effRate * days) / 100 / 365;
      return { no: i + 1, mid: c.chassis_no, model: c.model, amount: c.amount, days, preVat, vat: 0, total: preVat };
    });
  const tot = rows.reduce((s, r) => ({ amount: s.amount + r.amount, preVat: s.preVat + r.preVat, total: s.total + r.total }), { amount: 0, preVat: 0, total: 0 });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-semibold">Rental Charges รายคัน</span>
        <span className="text-muted">Rate {effRate.toFixed(2)}% · actual/365</span>
        <label className="ml-auto flex items-center gap-2">As of <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="w-40" /></label>
      </div>
      {rows.length === 0 ? (
        <div className="bg-soft border border-line rounded p-5 text-center text-muted text-sm">ยังไม่มี Chassis (Active) สำหรับคำนวณดอกเบี้ย</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base text-sm">
            <thead>
              <tr><th>No</th><th>Mid (Chassis)</th><th>Model</th><th className="text-right">Amount</th><th className="text-right">Rate%</th><th className="text-right">Days</th><th className="text-right">Pre VAT</th><th className="text-right">VAT</th><th className="text-right">Total Charges</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no}>
                  <td className="text-center">{r.no}</td>
                  <td>{r.mid}</td>
                  <td className="text-muted">{r.model ?? '—'}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
                  <td className="text-right tabular-nums">{effRate.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{r.days}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.preVat)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.vat)}</td>
                  <td className="text-right tabular-nums font-medium">{fmtMoney(r.total)}</td>
                </tr>
              ))}
              <tr className="bg-soft font-bold">
                <td colSpan={3}>TOTAL ({rows.length} คัน)</td>
                <td className="text-right tabular-nums">{fmtMoney(tot.amount)}</td>
                <td /><td />
                <td className="text-right tabular-nums">{fmtMoney(tot.preVat)}</td>
                <td className="text-right tabular-nums">0.00</td>
                <td className="text-right tabular-nums">{fmtMoney(tot.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted italic">ตรงตามรายงาน "Rental Charges Unit by Unit" ของ MGC — ดอกเบี้ยต่อคัน = Amount × Rate% × Days/365</p>
    </div>
  );
}

// ====== Chassis sub-tab (HTML-faithful: lookup-based + Current Location editable) ======
function ChassisSubTab({ chassis, onChange }: { chassis: FPChassis[]; onChange: (c: FPChassis[]) => void }) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ro = useReadOnly();

  const usedChassisNos = new Set(chassis.map((c) => c.chassis_no));
  const filtered = MOCK_INVENTORY.filter((c) => {
    if (usedChassisNos.has(c.chassis_no)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.chassis_no.toLowerCase().includes(q) ||
      c.engine_no.toLowerCase().includes(q) ||
      c.model.toLowerCase().includes(q) ||
      c.location.toLowerCase().includes(q)
    );
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const onConfirm = () => {
    const today = new Date().toISOString().slice(0, 10);
    const picked = MOCK_INVENTORY.filter((c) => selected.has(c.id)).map<FPChassis>((c) => ({
      id: crypto.randomUUID(),
      fp_id: '',
      chassis_no: c.chassis_no,
      engine_no: c.engine_no,
      model: c.model,
      receive_date: today,
      amount: c.cost,
      curtail_id: null,
      status: 'In Stock',
      sort_order: 0,
      original_location: c.location,
      current_location: c.location,
      location_modified_at: today,
    }));
    onChange([...chassis, ...picked]);
    setSelected(new Set());
    setLookupOpen(false);
    setSearch('');
  };

  const updateCurrentLocation = (i: number, value: string) => {
    const today = new Date().toISOString().slice(0, 10);
    onChange(
      chassis.map((c, j) =>
        j === i
          ? {
              ...c,
              current_location: value || null,
              location_modified_at: value !== c.current_location ? today : c.location_modified_at,
            }
          : c,
      ),
    );
  };
  const remove = (i: number) => onChange(chassis.filter((_, j) => j !== i));

  return (
    <div>
      <div className="mb-3 flex justify-between items-center">
        <p className="text-[11px] text-muted italic">
          📌 Chassis ดึงจาก Inventory (NetSuite ERP — ระบบ Aliyan) · 1 Chassis ผูกได้ 1 Facility เท่านั้น
        </p>
        {!ro && (
        <Button variant="primary" onClick={() => setLookupOpen(true)}>
          🔍 Lookup Chassis
        </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <ThTip>CHASSIS NO. *</ThTip>
              <ThTip tipKey="ENGINE NO.">ENGINE NO.</ThTip>
              <ThTip tipKey="CAR MODEL">CAR MODEL</ThTip>
              <ThTip tipKey="ORIGINAL LOCATION">ORIGINAL LOCATION</ThTip>
              <ThTip tipKey="CURRENT LOCATION">CURRENT LOCATION</ThTip>
              <ThTip tipKey="LOCATION LAST MODIFIED">LOCATION LAST MODIFIED</ThTip>
              <ThTip>ACTION</ThTip>
            </tr>
          </thead>
          <tbody>
            {chassis.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-6">
                  ยังไม่มี Chassis — กด <strong>🔍 Lookup Chassis</strong> เพื่อเลือกจาก NetSuite Inventory
                </td>
              </tr>
            )}
            {chassis.map((c, i) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.chassis_no}</td>
                <td className="font-mono text-xs">{c.engine_no ?? '—'}</td>
                <td>{c.model ?? '—'}</td>
                <td className="text-muted">{c.original_location ?? '—'}</td>
                <td>
                  <Input
                    value={c.current_location ?? ''}
                    onChange={(e) => updateCurrentLocation(i, e.target.value)}
                    className="w-full"
                  />
                </td>
                <td className="text-xs">
                  {c.location_modified_at ? fmtDate(c.location_modified_at) : '—'}
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="text-danger hover:underline text-xs"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Lookup Modal ── */}
      <Modal
        open={lookupOpen}
        onClose={() => {
          setLookupOpen(false);
          setSelected(new Set());
        }}
        title="🔍 Lookup Chassis — NetSuite Inventory"
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
            placeholder="🔍 ค้นหา Chassis No / Model / Location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted mb-3 italic">
          💡 Mock data — ระบบจริงจะดึงจาก NetSuite FA Master / Aliyan Inventory · 1 Chassis ผูกได้ 1 Facility
        </p>
        <div className="overflow-x-auto max-h-[400px]">
          <table className="table-base">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th className="w-10"></th>
                <ThTip>Chassis No.</ThTip>
                <ThTip tipKey="ENGINE NO.">Engine No.</ThTip>
                <ThTip>Car Model</ThTip>
                <ThTip>Location</ThTip>
                <ThTip align="right">Cost (THB)</ThTip>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-6">
                    {usedChassisNos.size === MOCK_INVENTORY.length
                      ? 'Chassis ทั้งหมดถูกผูกกับ Facility อื่นแล้ว'
                      : 'ไม่พบ Chassis ตามเงื่อนไข'}
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={selected.has(c.id) ? 'bg-brand-light' : 'hover:bg-gray-50 cursor-pointer'}
                  onClick={() => toggleSelect(c.id)}
                >
                  <td>
                    <input type="checkbox" checked={selected.has(c.id)} readOnly />
                  </td>
                  <td className="font-mono text-xs">{c.chassis_no}</td>
                  <td className="font-mono text-xs">{c.engine_no}</td>
                  <td>{c.model}</td>
                  <td>{c.location}</td>
                  <td className="text-right tabular-nums">{fmtMoney(c.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}

// ====== Roll Over History ======
function RolloverHistory({ currentId }: { currentId: string }) {
  const { data: chain } = useQuery({
    queryKey: ['fp-rollover-chain', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      // Walk parent + children
      const visited: any[] = [];
      let cur = currentId;
      while (cur) {
        const { data } = await supabase.from('floor_plans').select('*').eq('id', cur).maybeSingle();
        if (!data) break;
        visited.unshift(data);
        cur = data.rollover_parent_id;
      }
      // Walk children
      let last = currentId;
      while (true) {
        const { data } = await supabase
          .from('floor_plans')
          .select('*')
          .eq('rollover_parent_id', last)
          .maybeSingle();
        if (!data) break;
        visited.push(data);
        last = data.id;
      }
      return visited;
    },
  });

  if (!chain || chain.length === 0) {
    return <p className="text-muted text-sm">ยังไม่มี Roll Over chain</p>;
  }

  return (
    <div>
      <p className="text-xs text-muted mb-3 italic">
        📌 ประวัติการ Roll Over Floor Plan — แสดงโซ่ของ FP Usage ที่อ้างอิงต่อกัน
      </p>
      <table className="table-base">
        <thead>
          <tr>
            <ThTip>#</ThTip>
            <ThTip>FP Name / Number</ThTip>
            <ThTip>Transaction Date</ThTip>
            <ThTip>Maturity</ThTip>
            <ThTip align="right">Amount (THB)</ThTip>
            <ThTip>Status</ThTip>
            <ThTip>Reference</ThTip>
          </tr>
        </thead>
        <tbody>
          {chain.map((r: any, i: number) => (
            <tr key={r.id} className={r.id === currentId ? 'bg-brand-light' : ''}>
              <td>{i + 1}</td>
              <td className="font-medium">
                <strong>{r.fp_no}</strong>
                {r.id === currentId && <span className="ml-2 text-xs text-muted">(current)</span>}
              </td>
              <td>{r.transaction_date ? fmtDate(r.transaction_date) : '—'}</td>
              <td>{r.maturity_date ? fmtDate(r.maturity_date) : '—'}</td>
              <td className="text-right tabular-nums">{fmtMoney(r.amount ?? r.total_amount)}</td>
              <td><Badge variant={statusVariant[r.status] ?? 'default'}>{r.status}</Badge></td>
              <td className="text-muted">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Mock NetSuite inventory — matches HTML prototype seed
const MOCK_INVENTORY: { id: string; chassis_no: string; engine_no: string; model: string; location: string; cost: number }[] = [
  { id: 'inv-fp-1', chassis_no: 'MMF24FW020Y000001', engine_no: 'B58B30-1024578', model: 'X7 xDrive40d Msport LCI', location: 'MAG Latphrao', cost: 6599000 },
  { id: 'inv-fp-2', chassis_no: 'MMF24FW020Y000002', engine_no: 'B47D20-2048891', model: 'X3 xDrive20d Msport',     location: 'MAG Latphrao', cost: 3299000 },
  { id: 'inv-fp-3', chassis_no: 'MMF24FW020Y000003', engine_no: 'B48B20-3055012', model: '5 Series 530e M Sport',    location: 'MAG Latphrao', cost: 3899000 },
  { id: 'inv-fp-4', chassis_no: 'MMF24FW020Y000004', engine_no: 'B48B20-4061230', model: '3 Series 320i M Sport',    location: 'MAG Rama 4',   cost: 2599000 },
  { id: 'inv-fp-5', chassis_no: 'MMF24FW020Y000005', engine_no: 'EE90-5079334',    model: 'iX xDrive50 M Sport',      location: 'MAG Rangsit',  cost: 5999000 },
  { id: 'inv-fp-6', chassis_no: 'MMF24FW020Y000006', engine_no: 'B38A15-6088457', model: '2 Series Gran Coupe',      location: 'MAG Latphrao', cost: 2199000 },
];
