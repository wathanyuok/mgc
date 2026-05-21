import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, FileText, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge, FieldLabel, NumInput, Modal } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { buildLoanSchedule, type PrepaymentEvent, type ReamortizeMode, type LoanScheduleRow } from '@/lib/loan-schedule';
import { createJE, postJE } from '@/lib/je';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import {
  DEFAULT_PREPAY_TIERS,
  monthsSince,
  pickPrepayTier,
  computeOutstanding,
  computePrepayFee,
  feeBaseFromLabel,
} from '@/lib/loan-prepay';
import {
  type Loan,
  type LoanChassis,
  type LoanPrepayment,
  type LoanStatus,
  FINANCE_INSTITUTIONS,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, effectiveRate, type RateCard } from '@/components/tx/RateCards';
import { useBaseRateLookup } from '@/lib/interest-rate-master';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';

const LOAN_STATUSES: LoanStatus[] = ['Draft', 'Approved', 'Active', 'Closed', 'Modified', 'Rejected', 'Cancelled'];
const CURRENCIES = ['THB', 'USD', 'EUR', 'JPY', 'GBP', 'CNY', 'SGD'];
const PAYMENT_TYPES = [
  'Fix Installment / Fix Installment & Step payment',
  'Fix Installment (Balloon) / Fix Installment & Step payment (Balloon)',
  'Fix Principal / Fix Principal & Step payment',
  'Fix Principal (Balloon) / Fix Principal & Step payment (Balloon)',
  'Grace Period and Fix Installment',
  'Grace Period and Fix Principal',
];
const BALLOON_OPTIONS = ['พร้อมค่างวด (รวมในงวดสุดท้าย)', 'หลัง Term (เป็นงวด N+1)', 'ก่อน Term (ลดงวดเหลือ N-1)'];

const round2 = (n: number) => Math.round(n * 100) / 100;

type Form = Omit<Loan, 'id' | 'created_at' | 'updated_at'>;

const blank: Form = {
  loan_no: '',
  name: null,
  ca_id: null,
  finance_institution: 'KBANK',
  principal: 0,
  amount: 0,
  amount_foreign: null,
  conversion_date: null,
  conversion_rate: null,
  currency: 'THB',
  annual_rate: 5.5,
  term_months: 24,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: null,
  transaction_date: new Date().toISOString().slice(0, 10),
  installment_start_date: new Date().toISOString().slice(0, 10),
  installment_end_date: null,
  pay_eom: true,
  payment_timing: 'arrears',
  payment_type: 'Fix Installment / Fix Installment & Step payment',
  grace_months: 0,
  installment: null,
  residual_value: 0,
  include_rv_in_installment: true,
  step_period: null,
  step_residual: null,
  balloon_option: 'พร้อมค่างวด (รวมในงวดสุดท้าย)',
  effective_rate: null,
  irr_month: null,
  allow_prepayment: 'Yes — รองรับทั้ง Full + Partial',
  prepayment_fee_base: 'Outstanding Principal (หนี้คงเหลือ)',
  rollover_parent_id: null,
  inactive: false,
  payment_freq: 'monthly',
  status: 'Draft',
  closed_at: null,
  closed_reason: null,
  remark: null,
  rate_cards: [],
  acct_cards: [],
};

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  Approved: 'success',
  Active: 'success',
  Closed: 'default',
  Modified: 'brand',
  Rejected: 'danger',
  Cancelled: 'danger',
};

export function LoanDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const baseRateLookup = useBaseRateLookup(form.finance_institution);
  const [chassis, setChassis] = useState<LoanChassis[]>([]);
  const [showActions, setShowActions] = useState(false);

  // Prepayment modal state
  const [showFullPrepay, setShowFullPrepay] = useState(false);
  const [showPartPrepay, setShowPartPrepay] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [payoffDate, setPayoffDate] = useState(today);
  const [partDate, setPartDate] = useState(today);
  const [partAmount, setPartAmount] = useState(0);
  const [partMode, setPartMode] = useState<ReamortizeMode>('reduce-installment');

  // Modify / Close modal state
  const [showModify, setShowModify] = useState(false);
  const [modifyDate, setModifyDate] = useState(today);
  const [modifyMode, setModifyMode] = useState<'reopen' | 'change'>('reopen');
  const [accruedOption, setAccruedOption] = useState<1 | 2 | 3>(1); // 1=pay now, 2=separate, 3=roll into principal
  const [showClose, setShowClose] = useState(false);
  const [closeDate, setCloseDate] = useState(today);

  // Interest Payment modal state
  const [showIntPay, setShowIntPay] = useState(false);
  const [intPayRow, setIntPayRow] = useState<LoanScheduleRow | null>(null);
  const [intPayDate, setIntPayDate] = useState(today);

  // Close actions menu on outside click
  useEffect(() => {
    if (!showActions) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-loan-actions]')) setShowActions(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showActions]);

  const { data: existing } = useQuery({
    queryKey: ['loan', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [m, c] = await Promise.all([
        supabase.from('loans').select('*').eq('id', id!).single(),
        supabase.from('loan_chassis').select('*').eq('loan_id', id!).order('sort_order'),
      ]);
      if (m.error) throw m.error;
      return { main: m.data as Loan, chassis: (c.data ?? []) as LoanChassis[] };
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
    }
  }, [existing]);

  // Prepayment history (folded into the live schedule + re-amortization)
  const { data: prepayments = [] } = useQuery({
    queryKey: ['loan-prepayments', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_prepayments')
        .select('*')
        .eq('loan_id', id!)
        .order('prepay_date');
      if (error) throw error;
      return (data ?? []) as LoanPrepayment[];
    },
  });

  const prepayEvents: PrepaymentEvent[] = prepayments
    .filter((p) => p.kind === 'Partial')
    .map((p) => ({
      date: p.prepay_date,
      amount: p.amount,
      mode: (p.reamortize_mode as ReamortizeMode) ?? 'reduce-installment',
    }));

  // Actual repayments received on this loan (from the Repayment module, Posted only)
  const { data: repaid = { Principal: 0, Interest: 0, Fee: 0, Penalty: 0 } } = useQuery({
    queryKey: ['loan-repaid', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('repayment_lines')
        .select('category, amount, repayments!inner(status)')
        .eq('facility_id', id!)
        .eq('facility_type', 'Loan')
        .eq('repayments.status', 'Posted');
      if (error) throw error;
      const sum = { Principal: 0, Interest: 0, Fee: 0, Penalty: 0 } as Record<string, number>;
      (data ?? []).forEach((r: any) => { sum[r.category] = (sum[r.category] ?? 0) + (r.amount ?? 0); });
      return sum;
    },
  });

  // CA options
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-loan'],
    queryFn: async () => {
      const { data } = await supabase
        .from('credit_agreements')
        .select('id, ca_name, contract_number, ma_id')
        .order('ca_name');
      return data ?? [];
    },
  });

  // Auto-sync effective rate from rate_cards
  const effRate = useMemo(
    () => (form.rate_cards.length > 0 ? effectiveRate((form.rate_cards as RateCard[])[0]) : form.annual_rate),
    [form.rate_cards, form.annual_rate],
  );

  useEffect(() => {
    if (Math.abs(effRate - form.annual_rate) > 0.0001) {
      setForm((f) => ({ ...f, annual_rate: effRate, effective_rate: effRate, irr_month: effRate / 12 }));
    }
  }, [effRate]);

  // Auto-compute installment_end_date = installment_start + term_months
  useEffect(() => {
    if (form.installment_start_date && form.term_months) {
      const d = new Date(form.installment_start_date);
      d.setMonth(d.getMonth() + form.term_months);
      d.setDate(d.getDate() - 1);
      const iso = d.toISOString().slice(0, 10);
      if (iso !== form.installment_end_date) setForm((f) => ({ ...f, installment_end_date: iso }));
    }
  }, [form.installment_start_date, form.term_months]);

  // Auto-sync amount → principal
  useEffect(() => {
    if (form.amount && form.amount !== form.principal) {
      setForm((f) => ({ ...f, principal: f.amount ?? 0 }));
    }
  }, [form.amount]);

  // Guard: RV/balloon must be smaller than the financed principal, otherwise
  // PMT turns negative (lender paying borrower) and the schedule is meaningless.
  const rvTooLarge = form.residual_value > 0 && form.residual_value >= form.principal;

  const sched = useMemo(() => {
    if (rvTooLarge) {
      return { rows: [], representativeInstallment: 0, totalPayment: 0, totalInterest: 0, totalPrincipal: 0 };
    }
    try {
      return buildLoanSchedule({
        principal: form.principal,
        rateCards: form.rate_cards as RateCard[],
        fallbackRate: effRate,
        termMonths: form.term_months,
        installmentStart: form.installment_start_date ?? form.start_date,
        paymentType: form.payment_type,
        residualValue: form.residual_value,
        balloonOption: form.balloon_option,
        includeRvInInstallment: form.include_rv_in_installment,
        payEom: form.pay_eom,
        gracePeriods: form.grace_months,
        paymentTiming: form.payment_timing as 'arrears' | 'advance',
        stepPeriod: form.step_period ?? undefined,
        stepResidual: form.step_residual ?? undefined,
        prepayments: prepayEvents,
      });
    } catch {
      return { rows: [], representativeInstallment: 0, totalPayment: 0, totalInterest: 0, totalPrincipal: 0 };
    }
  }, [
    form.principal, effRate, form.term_months, form.installment_start_date, form.start_date,
    form.payment_type, form.residual_value, form.balloon_option, form.include_rv_in_installment,
    form.pay_eom, form.grace_months, form.payment_timing, form.step_period, form.step_residual,
    form.rate_cards, rvTooLarge, prepayments,
  ]);

  const schedule = sched.rows;
  const monthlyPayment = sched.representativeInstallment;
  const totalPay = sched.totalPayment;
  const totalInt = sched.totalInterest;

  // Save
  const userLabel = useCurrentUserLabel();
  const { can: rawCan } = useAuth();
  const viewOnly = useReadOnly();
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);

  const save = useMutation({
    mutationFn: async () => {
      await assertWithinCreditLine(form.ca_id, form.principal, { table: 'loans', id });
      const payload = { ...form, effective_rate: effRate, irr_month: effRate / 12, updated_by: userLabel };
      let lid = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('loans').insert({ ...payload, created_by: userLabel }).select().single();
        if (error) throw error;
        lid = data.id;
      } else {
        const { error } = await supabase.from('loans').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', lid!);
        if (error) throw error;
      }

      // Replace chassis
      await supabase.from('loan_chassis').delete().eq('loan_id', lid!);
      if (chassis.length > 0) {
        const rows = chassis.map((c, i) => ({
          loan_id: lid!,
          chassis_no: c.chassis_no,
          engine_no: c.engine_no,
          car_model: c.car_model,
          location: c.location,
          cost: c.cost,
          status: c.status,
          sort_order: i,
        }));
        const { error } = await supabase.from('loan_chassis').insert(rows);
        if (error) throw error;
      }

      // Replace schedule
      await supabase.from('loan_schedules').delete().eq('loan_id', lid!);
      if (schedule.length > 0) {
        const rows = schedule.map((r) => ({
          loan_id: lid!,
          period: r.period,
          due_date: r.endDate,
          begin_balance: r.beginBalance,
          payment: r.installment,
          interest: r.interest,
          principal: r.principal,
          end_balance: r.endBalance,
        }));
        const { error } = await supabase.from('loan_schedules').insert(rows);
        if (error) throw error;
      }
      return lid;
    },
    onSuccess: (lid: any) => {
      qc.invalidateQueries({ queryKey: ['loan-list'] });
      qc.invalidateQueries({ queryKey: ['loan', lid] });
      toast.success(`บันทึก + Schedule ${schedule.length} งวด`);
      if (mode === 'new' && lid) navigate(`/tx/loan/${lid}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const ensureLoanId = async (): Promise<string> => {
    if (id) return id;
    const loanNo = (form.loan_no ?? '').trim() || `DRAFT-${Date.now()}`;
    const name = (form.name ?? '').trim() || (id ? loanNo : await nextRunningNo(RUNNING_PREFIX.loan));
    const { data, error } = await supabase
      .from('loans')
      .insert({ ...form, loan_no: loanNo, name, status: 'Draft', effective_rate: effRate })
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['loan-list'] });
    navigate(`/tx/loan/${data.id}`, { replace: true });
    return data.id as string;
  };

  // ============== Prepayment ==============
  const prepayAllowed = !(form.allow_prepayment ?? '').toLowerCase().startsWith('no');
  const allowFull = prepayAllowed && !(form.allow_prepayment ?? '').includes('Partial Only');
  const allowPartial = prepayAllowed && !(form.allow_prepayment ?? '').includes('Full Only');
  const feeBase = feeBaseFromLabel(form.prepayment_fee_base);

  // Pick GL account string ("code name") from acct_cards by ACCT type, with fallback.
  const glFor = (acctType: string, fallback: string): { code: string; name: string } => {
    const card = (form.acct_cards as AcctCard[]).find((a) => a.type === acctType);
    const raw = card?.gl ?? fallback;
    const sp = raw.indexOf(' ');
    return sp > 0 ? { code: raw.slice(0, sp), name: raw.slice(sp + 1) } : { code: '', name: raw };
  };

  // Full Prepayment preview (outstanding + accrued + fee → total to pay)
  const fullPreview = useMemo(() => {
    const o = computeOutstanding(schedule, payoffDate, effRate, form.installment_start_date ?? form.start_date, form.principal);
    const months = monthsSince(form.installment_start_date ?? form.start_date, payoffDate);
    const tier = pickPrepayTier(DEFAULT_PREPAY_TIERS, months);
    const fee = computePrepayFee(feeBase, o.outstanding, o.outstanding, tier.rate);
    return { ...o, months, tier, fee, totalToPay: o.outstanding + o.accruedInterest + fee };
  }, [schedule, payoffDate, effRate, form.installment_start_date, form.start_date, form.principal, feeBase]);

  // Partial Prepayment preview (amount + fee, re-amortize)
  const partPreview = useMemo(() => {
    const o = computeOutstanding(schedule, partDate, effRate, form.installment_start_date ?? form.start_date, form.principal);
    const months = monthsSince(form.installment_start_date ?? form.start_date, partDate);
    const tier = pickPrepayTier(DEFAULT_PREPAY_TIERS, months);
    const fee = computePrepayFee(feeBase, o.outstanding, partAmount, tier.rate);
    const newOutstanding = Math.max(0, o.outstanding - partAmount);
    return { ...o, months, tier, fee, newOutstanding, totalToPay: partAmount + fee };
  }, [schedule, partDate, partAmount, effRate, form.installment_start_date, form.start_date, form.principal, feeBase]);

  const fullPrepay = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึก Loan ก่อน (ต้องมี ID)');
      if (form.status !== 'Active') throw new Error('Full Prepayment ทำได้เฉพาะ Loan ที่ Status = Active');
      if (!allowFull) throw new Error('สัญญานี้ไม่อนุญาต Full Prepayment (ดู ALLOW PREPAYMENT)');
      const p = fullPreview;
      const cash = glFor('CASH / BANK ACCOUNT', '100000 Cheque Account');
      const note = glFor('NOTE PAYABLE ACCOUNT', '2142101 เงินกู้ยืมระยะสั้นสถาบันการเงิน');
      const intExp = glFor('INTEREST EXPENSE ACCOUNT', '5512103 ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น');
      const feeExp = glFor('FEE EXPENSE ACCOUNT', '5512201 ค่าธรรมเนียมจ่าย');
      const lines = [
        { account_code: note.code, account_name: note.name, dr: round2(p.outstanding), description: 'Settle outstanding principal' },
        ...(p.accruedInterest > 0.005 ? [{ account_code: intExp.code, account_name: intExp.name, dr: round2(p.accruedInterest), description: 'Accrued interest to payoff' }] : []),
        ...(p.fee > 0.005 ? [{ account_code: feeExp.code, account_name: feeExp.name, dr: round2(p.fee), description: `Prepayment fee ${p.tier.rate}%` }] : []),
        { account_code: cash.code, account_name: cash.name, cr: round2(p.totalToPay), description: 'Full prepayment payout' },
      ];
      const je = await createJE({
        source_type: 'LOAN_PREPAY',
        source_id: id,
        je_date: payoffDate,
        description: `Full Prepayment — ${form.loan_no}`,
        lines,
      });
      await postJE(je.id, 'user');
      await supabase.from('loan_prepayments').insert({
        loan_id: id, prepay_date: payoffDate, kind: 'Full',
        amount: round2(p.outstanding), accrued_interest: round2(p.accruedInterest),
        fee: round2(p.fee), fee_rate: p.tier.rate, fee_base: feeBase,
        reamortize_mode: null, total_paid: round2(p.totalToPay), je_id: je.id, created_by: 'user',
      });
      await supabase.from('loans').update({
        status: 'Closed', closed_at: payoffDate, closed_reason: 'Full Prepayment',
      }).eq('id', id);
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['loan', id] });
      qc.invalidateQueries({ queryKey: ['loan-prepayments', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setShowFullPrepay(false);
      setForm((f) => ({ ...f, status: 'Closed', closed_at: payoffDate, closed_reason: 'Full Prepayment' }));
      toast.success(`✓ ปิดสัญญา + JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const partialPrepay = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึก Loan ก่อน (ต้องมี ID)');
      if (form.status !== 'Active') throw new Error('Partial Prepayment ทำได้เฉพาะ Loan ที่ Status = Active');
      if (!allowPartial) throw new Error('สัญญานี้ไม่อนุญาต Partial Prepayment (ดู ALLOW PREPAYMENT)');
      if (partAmount <= 0) throw new Error('กรอก Prepayment Amount');
      if (partAmount >= partPreview.outstanding) throw new Error('Amount ต้องน้อยกว่า Outstanding — ถ้าจะปิดทั้งก้อนใช้ Full Prepayment');
      const p = partPreview;
      const cash = glFor('CASH / BANK ACCOUNT', '100000 Cheque Account');
      const note = glFor('NOTE PAYABLE ACCOUNT', '2142101 เงินกู้ยืมระยะสั้นสถาบันการเงิน');
      const feeExp = glFor('FEE EXPENSE ACCOUNT', '5512201 ค่าธรรมเนียมจ่าย');
      const lines = [
        { account_code: note.code, account_name: note.name, dr: round2(partAmount), description: 'Partial principal prepayment' },
        ...(p.fee > 0.005 ? [{ account_code: feeExp.code, account_name: feeExp.name, dr: round2(p.fee), description: `Prepayment fee ${p.tier.rate}%` }] : []),
        { account_code: cash.code, account_name: cash.name, cr: round2(p.totalToPay), description: 'Partial prepayment payout' },
      ];
      const je = await createJE({
        source_type: 'LOAN_PREPAY',
        source_id: id,
        je_date: partDate,
        description: `Partial Prepayment ${fmtMoney(partAmount)} — ${form.loan_no}`,
        lines,
      });
      await postJE(je.id, 'user');
      await supabase.from('loan_prepayments').insert({
        loan_id: id, prepay_date: partDate, kind: 'Partial',
        amount: round2(partAmount), accrued_interest: 0,
        fee: round2(p.fee), fee_rate: p.tier.rate, fee_base: feeBase,
        reamortize_mode: partMode, total_paid: round2(p.totalToPay), je_id: je.id, created_by: 'user',
      });
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['loan-prepayments', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setShowPartPrepay(false);
      setPartAmount(0);
      toast.success(`✓ Partial Prepayment + re-amortize · JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ============== Modify Loan Condition (Close + Reopen — MGC standard) ==============
  const modifyPreview = useMemo(() => {
    const o = computeOutstanding(schedule, modifyDate, effRate, form.installment_start_date ?? form.start_date, form.principal);
    // New principal depends on accrued-interest handling
    const newPrincipal = accruedOption === 3 ? o.outstanding + o.accruedInterest : o.outstanding;
    return { ...o, newPrincipal };
  }, [schedule, modifyDate, effRate, form.installment_start_date, form.start_date, form.principal, accruedOption]);

  const modify = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึก Loan ก่อน (ต้องมี ID)');
      if (form.status !== 'Active') throw new Error('Modify ทำได้เฉพาะ Loan ที่ Status = Active');

      // Option B — Change Condition on the same contract: editing is already live;
      // the schedule re-amortizes on Save. We just flag IRR impact.
      if (modifyMode === 'change') {
        return { mode: 'change' as const };
      }

      const p = modifyPreview;
      const cash = glFor('CASH / BANK ACCOUNT', '100000 Cheque Account');
      const accr = glFor('ACCRUED INTEREST ACCOUNT', '2194109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน');

      // Accrued option 1 = pay cash now → post a JE clearing accrued interest.
      if (accruedOption === 1 && p.accruedInterest > 0.005) {
        const je = await createJE({
          source_type: 'LOAN_PREPAY',
          source_id: id,
          je_date: modifyDate,
          description: `Modify (Close+Reopen) — pay accrued interest — ${form.loan_no}`,
          lines: [
            { account_code: accr.code, account_name: accr.name, dr: round2(p.accruedInterest), description: 'Clear accrued interest' },
            { account_code: cash.code, account_name: cash.name, cr: round2(p.accruedInterest), description: 'Pay accrued interest (cash)' },
          ],
        });
        await postJE(je.id, 'user');
      }

      // Close the old loan
      await supabase.from('loans').update({
        status: 'Modified', closed_at: modifyDate,
        closed_reason: `Modify · Close+Reopen · accrued opt ${accruedOption}`,
      }).eq('id', id);

      // Reopen — new Draft loan inheriting conditions, principal = new principal
      const { rate_cards, acct_cards } = form;
      const { data: newLoan, error } = await supabase
        .from('loans')
        .insert({
          ...form,
          loan_no: `${form.loan_no || 'LOAN'}-M`,
          name: form.name ? `${form.name}-M` : null,
          principal: round2(p.newPrincipal),
          amount: round2(p.newPrincipal),
          transaction_date: modifyDate,
          start_date: modifyDate,
          installment_start_date: modifyDate,
          installment_end_date: null,
          status: 'Draft',
          closed_at: null,
          closed_reason: null,
          rollover_parent_id: id,
          rate_cards: rate_cards ?? [],
          acct_cards: acct_cards ?? [],
          remark: `Modify from ${form.loan_no} · accrued opt ${accruedOption}${accruedOption === 3 ? ` (rolled +${round2(p.accruedInterest)})` : ''}`,
        })
        .select()
        .single();
      if (error) throw error;
      return { mode: 'reopen' as const, newId: newLoan.id as string };
    },
    onSuccess: (res) => {
      setShowModify(false);
      if (res.mode === 'change') {
        toast.info('แก้เงื่อนไขในฟอร์มได้เลย แล้วกด Save เพื่อ re-amortize (⚠️ IRR จะเปลี่ยน)');
        return;
      }
      qc.invalidateQueries({ queryKey: ['loan-list'] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Modified' }));
      toast.success('✓ ปิดสัญญาเดิม + เปิดสัญญาใหม่ → กรอกเงื่อนไขใหม่');
      navigate(`/tx/loan/${res.newId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ============== Close Loan (paid off) ==============
  const closePreview = useMemo(
    () => computeOutstanding(schedule, closeDate, effRate, form.installment_start_date ?? form.start_date, form.principal),
    [schedule, closeDate, effRate, form.installment_start_date, form.start_date, form.principal],
  );

  const closeLoan = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึก Loan ก่อน (ต้องมี ID)');
      if (form.status !== 'Active') throw new Error('Close ทำได้เฉพาะ Loan ที่ Status = Active');
      if (closePreview.outstanding > 0.01) {
        throw new Error('ยังมีเงินต้นคงเหลือ — ถ้าจะปิดก่อนกำหนดใช้ Full Prepayment แทน');
      }
      await supabase.from('loans').update({
        status: 'Closed', closed_at: closeDate, closed_reason: 'Manual Close (paid off)',
      }).eq('id', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan', id] });
      qc.invalidateQueries({ queryKey: ['loan-list'] });
      setShowClose(false);
      setForm((f) => ({ ...f, status: 'Closed', closed_at: closeDate, closed_reason: 'Manual Close (paid off)' }));
      toast.success('✓ ปิดสัญญา Loan แล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ============== Journal Entries per period (MoM: Drawdown + Accrued + Reversal) ==============
  // First day of the month AFTER the given ISO date (for accrual reversal per MoM).
  const firstOfNextMonth = (isoDate: string) => {
    const d = new Date(isoDate);
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
  };

  const { data: drawdownPosted = false } = useQuery({
    queryKey: ['loan-drawdown-posted', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('source_type', 'LOAN_DRAWDOWN')
        .eq('source_id', id!)
        .eq('status', 'Posted');
      return (data ?? []).length > 0;
    },
  });

  const { data: postedAccruedPeriods } = useQuery({
    queryKey: ['loan-posted-periods', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('source_period, status, is_reversal')
        .eq('source_type', 'LOAN_ACCRUED')
        .eq('source_id', id!);
      const set = new Set<number>();
      (data ?? []).forEach((d: any) => {
        if (d.status === 'Posted' && d.is_reversal !== true && d.source_period != null) set.add(d.source_period);
      });
      return set;
    },
  });

  const postDrawdownJE = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึก Loan ก่อน Post JE');
      if (form.status !== 'Approved') throw new Error(`Post Drawdown ได้เฉพาะ Loan ที่ Approved — Status ปัจจุบัน: "${form.status}"`);
      if (!form.principal) throw new Error('ยังไม่มีเงินต้น (Principal)');
      // Idempotent
      const { data: ex } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'LOAN_DRAWDOWN').eq('source_id', id).eq('status', 'Posted');
      if (ex && ex.length > 0) throw new Error(`Drawdown JE มีอยู่แล้ว: ${ex[0].je_number}`);

      const cash = glFor('CASH / BANK ACCOUNT', '100000 Cheque Account');
      const note = glFor('NOTE PAYABLE ACCOUNT', '2142101 เงินกู้ยืมระยะสั้นสถาบันการเงิน');
      const je = await createJE({
        source_type: 'LOAN_DRAWDOWN',
        source_id: id,
        je_date: form.transaction_date ?? form.start_date,
        description: `${form.name ?? form.loan_no} — Loan Drawdown`,
        lines: [
          { account_code: cash.code, account_name: cash.name, dr: round2(form.principal), description: 'Cash received from loan drawdown' },
          { account_code: note.code, account_name: note.name, cr: round2(form.principal), description: 'Note Payable — loan principal' },
        ],
      });
      await postJE(je.id, 'user');
      await supabase.from('loans').update({ status: 'Active' }).eq('id', id);
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['loan-drawdown-posted', id] });
      qc.invalidateQueries({ queryKey: ['loan', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Active' }));
      toast.success(`✓ Posted Drawdown JE ${jeNo} · Status → Active`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Post Accrued Interest for a period + auto-Reversal on the 1st of next month (MoM)
  const postAccruedJE = useMutation({
    mutationFn: async (r: LoanScheduleRow) => {
      if (!id) throw new Error('บันทึก Loan ก่อน Post JE');
      if (r.interest <= 0.005) throw new Error(`Period ${r.period} ไม่มีดอกเบี้ย`);
      // Idempotent
      const { data: ex } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'LOAN_ACCRUED').eq('source_id', id)
        .eq('source_period', r.period).eq('status', 'Posted').eq('is_reversal', false);
      if (ex && ex.length > 0) throw new Error(`Period ${r.period} มี Accrued JE อยู่แล้ว: ${ex[0].je_number}`);

      const intExp = glFor('INTEREST EXPENSE ACCOUNT', '5512103 ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น');
      const accr = glFor('ACCRUED INTEREST ACCOUNT', '2194109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน');
      const amt = round2(r.interest);

      // 1) Accrued JE at month-end
      const accrued = await createJE({
        source_type: 'LOAN_ACCRUED',
        source_id: id,
        source_period: r.period,
        je_date: r.endDate,
        description: `${form.name ?? form.loan_no} — Period ${r.period} Accrued Interest`,
        remark: `Accrued ${r.days} วัน × ${effRate.toFixed(4)}% / 365 (daily basis, month-end)`,
        lines: [
          { account_code: intExp.code, account_name: intExp.name, dr: amt, description: 'Interest expense (accrued)' },
          { account_code: accr.code, account_name: accr.name, cr: amt, description: 'Accrued interest payable' },
        ],
      });
      await postJE(accrued.id, 'user');

      // 2) Reversal JE on the 1st of next month (MoM: กลับรายการต้นเดือนถัดไป)
      const reversal = await createJE({
        source_type: 'LOAN_ACCRUED',
        source_id: id,
        source_period: r.period,
        je_date: firstOfNextMonth(r.endDate),
        description: `${form.name ?? form.loan_no} — Period ${r.period} Accrued Reversal`,
        remark: 'Reverse accrued interest — 1st of next month',
        lines: [
          { account_code: accr.code, account_name: accr.name, dr: amt, description: 'Reverse accrued interest payable' },
          { account_code: intExp.code, account_name: intExp.name, cr: amt, description: 'Reverse interest expense' },
        ],
      });
      await postJE(reversal.id, 'user');
      await supabase.from('journal_entries').update({ is_reversal: true }).eq('id', reversal.id);
      return accrued.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['loan-posted-periods', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Posted Accrued + Reversal · ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Interest Payment — actual cash payment of interest (MoM: ยึด Actual เป็นหลัก — คำนวณดอกตามวันจ่ายจริง)
  // ส่วนต่างระหว่างดอกตามตาราง (planned) กับดอกตามวันจ่ายจริง (actual) = Adjustment อัตโนมัติ
  const intPayActual = useMemo(() => {
    if (!intPayRow) return null;
    const start = new Date(intPayRow.startDate);
    const pay = new Date(intPayDate);
    const actualDays = Math.max(0, Math.round((pay.getTime() - start.getTime()) / 86400000));
    const actualInterest = round2((intPayRow.beginBalance * effRate * actualDays) / 100 / 365);
    const scheduled = round2(intPayRow.interest);
    return { actualDays, actualInterest, scheduled, adjustment: round2(actualInterest - scheduled) };
  }, [intPayRow, intPayDate, effRate]);

  const { data: paidIntPeriods } = useQuery({
    queryKey: ['loan-intpay-periods', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('source_period, status')
        .eq('source_type', 'LOAN_INT_PAY')
        .eq('source_id', id!);
      const set = new Set<number>();
      (data ?? []).forEach((d: any) => { if (d.status === 'Posted' && d.source_period != null) set.add(d.source_period); });
      return set;
    },
  });

  const postIntPayJE = useMutation({
    mutationFn: async () => {
      if (!id || !intPayRow) throw new Error('เลือกงวดก่อน');
      const r = intPayRow;
      // Idempotent
      const { data: ex } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'LOAN_INT_PAY').eq('source_id', id)
        .eq('source_period', r.period).eq('status', 'Posted');
      if (ex && ex.length > 0) throw new Error(`Period ${r.period} จ่ายดอกแล้ว: ${ex[0].je_number}`);

      const intExp = glFor('INTEREST EXPENSE ACCOUNT', '5512103 ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น');
      const cash = glFor('CASH / BANK ACCOUNT', '100000 Cheque Account');
      // ยึด Actual: คำนวณดอกตามจำนวนวันถึงวันจ่ายจริง — ส่วนต่างจากตาราง = adjustment ในตัว
      const startD = new Date(r.startDate);
      const payD = new Date(intPayDate);
      const actualDays = Math.max(0, Math.round((payD.getTime() - startD.getTime()) / 86400000));
      const amt = round2((r.beginBalance * effRate * actualDays) / 100 / 365);
      const scheduled = round2(r.interest);
      const adj = round2(amt - scheduled);
      const je = await createJE({
        source_type: 'LOAN_INT_PAY',
        source_id: id,
        source_period: r.period,
        je_date: intPayDate,
        description: `${form.name ?? form.loan_no} — Period ${r.period} Interest Payment`,
        remark: `Actual basis: ${actualDays} วัน × ${effRate.toFixed(4)}%/365 = ${fmtMoney(amt)} · ตามตาราง ${fmtMoney(scheduled)} · adjustment ${adj >= 0 ? '+' : ''}${fmtMoney(adj)} (จ่ายจริง ${fmtDate(intPayDate)} / กำหนด ${fmtDate(r.endDate)})`,
        lines: [
          { account_code: intExp.code, account_name: intExp.name, dr: amt, description: `Interest expense — actual ${actualDays} days to payment date` },
          { account_code: cash.code, account_name: cash.name, cr: amt, description: 'Cash paid for interest' },
        ],
      });
      await postJE(je.id, 'user');
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['loan-intpay-periods', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setShowIntPay(false);
      setIntPayRow(null);
      toast.success(`✓ Posted Interest Payment · ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ============== Tabs ==============
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
        <AcctCards
          accounts={form.acct_cards as AcctCard[]}
          onChange={(n) => setForm((f) => ({ ...f, acct_cards: n }))}
        />
      ),
    },
    {
      key: 'chassis',
      label: 'Chassis',
      render: () => <ChassisTab chassis={chassis} onChange={setChassis} />,
    },
    {
      key: 'sched',
      label: 'Schedule Calculate',
      render: () => (
        <div>
          {/* Indicators */}
          <div className="flex gap-2 flex-wrap items-center mb-3">
            <span className="px-2.5 py-1 rounded text-xs font-bold bg-amber-100 text-amber-800">
              {form.payment_type.split(' / ')[0]}
            </span>
            {form.residual_value > 0 && (
              <span className="px-2.5 py-1 rounded text-xs font-bold bg-red-100 text-red-800">
                Balloon = Yes
              </span>
            )}
            {form.residual_value > 0 && (
              <span className="text-xs text-muted italic">
                {!form.include_rv_in_installment || (form.balloon_option ?? '').includes('หลัง')
                  ? `Balloon/RV ${fmtMoney(form.residual_value)} แยกเป็นงวด ${schedule.length} (งวด N+1)`
                  : (form.balloon_option ?? '').includes('ก่อน')
                    ? `Balloon/RV ${fmtMoney(form.residual_value)} รวมในงวด ${schedule.length} (ลดเหลือ N-1)`
                    : `งวด ${schedule.length} (งวดสุดท้าย) รวม Balloon/RV ${fmtMoney(form.residual_value)}`}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Stat label="Monthly Payment" value={fmtMoney(monthlyPayment)} highlight />
            <Stat label="จำนวนงวด" value={schedule.length} />
            <Stat label="Total Payment" value={fmtMoney(totalPay)} />
            <Stat label="Total Interest" value={fmtMoney(totalInt)} />
          </div>

          {/* Drawdown JE control (MoM: เบิก/ตั้งหนี้) */}
          {id && (
            <div className="flex items-center gap-3 mb-3 p-2.5 rounded border border-line bg-soft text-sm">
              {drawdownPosted ? (
                <Badge variant="success">✓ Drawdown JE Posted</Badge>
              ) : (
                <>
                  <Button
                    variant="primary"
                    onClick={() => postDrawdownJE.mutate()}
                    disabled={postDrawdownJE.isPending || form.status !== 'Approved' || !can('loan', 'approve')}
                    title={form.status !== 'Approved' ? 'ต้อง Approved ก่อน (Dr Cash / Cr Note Payable) → Active' : 'Dr Cash / Cr Note Payable'}
                  >
                    📋 Post Drawdown JE
                  </Button>
                  <span className="text-xs text-muted">
                    {form.status !== 'Approved' ? 'เปลี่ยน Status เป็น Approved ก่อน' : 'Dr Cash / Cr Note Payable → Status เป็น Active'}
                  </span>
                </>
              )}
            </div>
          )}

          {rvTooLarge ? (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded p-4 text-sm">
              ⚠️ Residual Value / Balloon ({fmtMoney(form.residual_value)}) ต้องน้อยกว่าเงินต้น ({fmtMoney(form.principal)})
              <div className="text-xs text-red-600 mt-1">
                ถ้า RV ≥ เงินต้น ค่างวดจะติดลบและตารางจะเพี้ยน — โดยทั่วไป RV ของ HP/Loan อยู่ที่ราว 10–50% ของเงินต้น
              </div>
            </div>
          ) : schedule.length === 0 ? (
            <div className="bg-soft border border-line rounded p-6 text-center text-muted text-sm">
              กรอก Principal / Term / Installment Start Date + เพิ่ม Rate Card เพื่อแสดง schedule
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[520px]">
              <table className="table-base text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    <ThTip align="right">Period</ThTip>
                    <ThTip>Start Date</ThTip>
                    <ThTip>End Date</ThTip>
                    <ThTip align="right">Days</ThTip>
                    <ThTip align="right">Installment</ThTip>
                    <ThTip align="right">Principal</ThTip>
                    <ThTip align="right">Interest</ThTip>
                    <ThTip align="right">Principal Balance</ThTip>
                    <ThTip align="right">Interest Balance</ThTip>
                    <ThTip>End of Month</ThTip>
                    <ThTip align="right">Days</ThTip>
                    <ThTip align="right">Accrued</ThTip>
                    <ThTip align="right">JE</ThTip>
                  </tr>
                </thead>
                <tbody>
                  {/* Period 0 row */}
                  <tr>
                    <td className="text-right tabular-nums font-medium">0</td>
                    <td>{form.installment_start_date ? fmtDate(form.installment_start_date) : '—'}</td>
                    <td className="text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right tabular-nums">{fmtMoney(form.principal)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                    <td className="text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                    <td className="text-right text-muted">–</td>
                  </tr>
                  {schedule.map((r, idx) => {
                    const eomDate = (() => {
                      const d = new Date(r.endDate);
                      return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
                    })();
                    // Accrued days: days between period end and EOM (for "pay before EOM" case)
                    const accruedDays = Math.max(
                      0,
                      Math.round((new Date(eomDate).getTime() - new Date(r.endDate).getTime()) / 86400000),
                    );
                    const accrued = (r.endBalance * effRate * accruedDays) / 100 / 365;
                    const intBalance = Math.max(
                      0,
                      totalInt - schedule.slice(0, idx + 1).reduce((s, p) => s + p.interest, 0),
                    );
                    return (
                      <tr
                        key={r.period}
                        className={r.isBalloon ? 'bg-amber-50 font-bold' : 'hover:bg-gray-50'}
                      >
                        <td className="text-right tabular-nums font-medium">{r.period}</td>
                        <td>{fmtDate(r.startDate)}</td>
                        <td>{fmtDate(r.endDate)}</td>
                        <td className="text-right tabular-nums">{r.days || '—'}</td>
                        <td className="text-right tabular-nums font-medium">{fmtMoney(r.installment)}</td>
                        <td className="text-right tabular-nums text-emerald-700">{fmtMoney(r.principal)}</td>
                        <td className="text-right tabular-nums text-amber-700">{fmtMoney(r.interest)}</td>
                        <td className="text-right tabular-nums">{fmtMoney(r.endBalance)}</td>
                        <td className="text-right tabular-nums">{fmtMoney(intBalance)}</td>
                        <td className="text-xs">{fmtDate(eomDate)}</td>
                        <td className="text-right tabular-nums">{accruedDays || '0'}</td>
                        <td className="text-right tabular-nums">{accrued > 0.01 ? fmtMoney(accrued) : '0.00'}</td>
                        <td className="text-right whitespace-nowrap">
                          {id && r.interest > 0.005 && (
                            paidIntPeriods?.has(r.period) ? (
                              <span className="text-emerald-600 text-[10px]" title="Interest paid (cash)">✓ Paid</span>
                            ) : postedAccruedPeriods?.has(r.period) ? (
                              <span className="flex gap-1.5 justify-end items-center">
                                <span className="text-emerald-600 text-[10px]" title="Accrued + Reversal posted">✓ Accr</span>
                                <button
                                  onClick={() => { setIntPayRow(r); setIntPayDate(r.endDate); setShowIntPay(true); }}
                                  className="text-brand hover:underline text-[10px]"
                                  title="ลงจ่ายดอกเบี้ยจริง (Dr Interest Expense / Cr Cash)"
                                >
                                  💵 Pay
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => postAccruedJE.mutate(r)}
                                disabled={postAccruedJE.isPending || !drawdownPosted || viewOnly}
                                className="text-brand hover:underline text-[10px] disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                                title={drawdownPosted ? 'Post Accrued + Reversal (1st next month)' : 'Post Drawdown JE ก่อน'}
                              >
                                📋 Accrued
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-soft font-bold border-t-2 border-line">
                    <td colSpan={4} className="text-right">Total</td>
                    <td className="text-right tabular-nums">{fmtMoney(totalPay)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(sched.totalPrincipal)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                    <td colSpan={6} />
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
            <RowTip label="Effective Interest Rate (%)" value={effRate.toFixed(4)} bold />
            <RowTip label="IRR (Monthly, %)" value={(effRate / 12).toFixed(4)} />
            <RowTip label="Term (Periods)" value={form.term_months} />
            <RowTip label="Installment" value={fmtMoney(monthlyPayment)} bold />
          </div>
          <div className="overflow-x-auto max-w-3xl">
            <table className="table-base">
              <thead>
                <tr className="bg-brand text-white">
                  <th className="!text-white !bg-brand">Actual</th>
                  <th className="!text-white !bg-brand text-right">Total</th>
                  <th className="!text-white !bg-brand text-right">Repayment</th>
                  <th className="!text-white !bg-brand text-right">Remaining</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-semibold">Principal</td>
                  <td className="text-right tabular-nums">{fmtMoney(form.principal)}</td>
                  <td className="text-right tabular-nums text-emerald-700">{fmtMoney(repaid.Principal)}</td>
                  <td className="text-right tabular-nums font-semibold">{fmtMoney(Math.max(0, form.principal - repaid.Principal))}</td>
                </tr>
                <tr>
                  <td className="font-semibold">Interest</td>
                  <td className="text-right tabular-nums">{fmtMoney(totalInt)}</td>
                  <td className="text-right tabular-nums text-emerald-700">{fmtMoney(repaid.Interest)}</td>
                  <td className="text-right tabular-nums font-semibold">{fmtMoney(Math.max(0, totalInt - repaid.Interest))}</td>
                </tr>
                {(repaid.Fee > 0 || repaid.Penalty > 0) && (
                  <tr>
                    <td className="font-semibold">Fee / Penalty</td>
                    <td className="text-right tabular-nums text-muted">—</td>
                    <td className="text-right tabular-nums text-emerald-700">{fmtMoney(repaid.Fee + repaid.Penalty)}</td>
                    <td className="text-right tabular-nums text-muted">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted -mt-2">
            คอลัมน์ <b>Repayment</b> = ยอดที่จ่ายจริงผ่านโมดูล Repayment (Posted) · <b>Remaining</b> = คงเหลือหลังหักจ่ายจริง
            {repaid.Principal > 0 && form.principal - repaid.Principal <= 0.01 && (
              <span className="text-emerald-700 font-semibold"> · ✓ ชำระเงินต้นครบแล้ว — ปิดสัญญาได้</span>
            )}
          </p>

          {prepayments.length > 0 && (
            <div className="overflow-x-auto max-w-4xl">
              <div className="text-sm font-semibold mb-2">Prepayment History</div>
              <table className="table-base text-xs">
                <thead>
                  <tr>
                    <ThTip>Date</ThTip>
                    <ThTip>Kind</ThTip>
                    <ThTip align="right">Principal</ThTip>
                    <ThTip align="right">Accrued Int.</ThTip>
                    <ThTip align="right">Fee</ThTip>
                    <ThTip align="right">Total Paid</ThTip>
                    <ThTip>Re-amortize</ThTip>
                  </tr>
                </thead>
                <tbody>
                  {prepayments.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.prepay_date)}</td>
                      <td><Badge variant={p.kind === 'Full' ? 'danger' : 'brand'}>{p.kind}</Badge></td>
                      <td className="text-right tabular-nums">{fmtMoney(p.amount)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(p.accrued_interest)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(p.fee)} <span className="text-muted">({p.fee_rate}%)</span></td>
                      <td className="text-right tabular-nums font-medium">{fmtMoney(p.total_paid)}</td>
                      <td className="text-muted">{p.reamortize_mode === 'reduce-term' ? 'ลด Term' : p.reamortize_mode === 'reduce-installment' ? 'ลดค่างวด' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
                Loan
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureLoanId}
              bucketName="loan-documents"
              tableName="loan_documents"
              parentFkColumn="loan_id"
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
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/loan')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Loan
            <Badge variant={statusVariant[form.status] ?? 'default'}>{form.status}</Badge>
          </h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New Loan' : (form.name ?? form.loan_no)}
          </p>
        </div>
        {/* Actions dropdown */}
        <div className="relative" data-loan-actions>
          <Button
            onClick={() => setShowActions((s) => !s)}
            disabled={!id}
            title={!id ? 'Save ก่อน' : 'Loan Actions'}
            className="bg-gray-700 text-white border-gray-700 hover:bg-gray-800"
          >
            ↩ Actions <ChevronDown className="w-3 h-3" />
          </Button>
          {showActions && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-line rounded shadow-lg z-50 min-w-[240px]">
              <button
                onClick={() => {
                  if (form.status !== 'Active') { toast.error('Modify ทำได้เฉพาะ Status = Active'); return; }
                  setModifyDate(today); setModifyMode('reopen'); setAccruedOption(1); setShowModify(true); setShowActions(false);
                }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line"
                title="แก้ไขเงื่อนไข Loan ระหว่างทาง (Close + Reopen หรือ Change Condition)"
              >
                📝 Modify Loan Condition
              </button>
              <button
                disabled={!allowFull}
                onClick={() => {
                  if (form.status !== 'Active') { toast.error('Full Prepayment ทำได้เฉพาะ Status = Active'); return; }
                  setPayoffDate(today); setShowFullPrepay(true); setShowActions(false);
                }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line disabled:opacity-40 disabled:cursor-not-allowed"
                title={allowFull ? 'ปิดยอด Outstanding ทั้งหมดก่อนกำหนด (อาจมี Prepayment Fee)' : 'ALLOW PREPAYMENT ไม่อนุญาต Full'}
              >
                💰 Full Prepayment
              </button>
              <button
                disabled={!allowPartial}
                onClick={() => {
                  if (form.status !== 'Active') { toast.error('Partial Prepayment ทำได้เฉพาะ Status = Active'); return; }
                  setPartDate(today); setPartAmount(0); setPartMode('reduce-installment'); setShowPartPrepay(true); setShowActions(false);
                }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line disabled:opacity-40 disabled:cursor-not-allowed"
                title={allowPartial ? 'ชำระเงินต้นเพิ่มบางส่วน → re-amortize (อาจมี Prepayment Fee)' : 'ALLOW PREPAYMENT ไม่อนุญาต Partial'}
              >
                💵 Partial Prepayment
              </button>
              <button
                onClick={() => { navigate('/tx/repayment/new'); setShowActions(false); }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line"
                title="บันทึกการชำระงวดปกติตาม Schedule"
              >
                ↩ Make Regular Repayment
              </button>
              <button
                onClick={() => {
                  if (form.status !== 'Active') { toast.error('Close ทำได้เฉพาะ Status = Active'); return; }
                  setCloseDate(today); setShowClose(true); setShowActions(false);
                }}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft text-danger"
                title="ปิดสัญญา Loan — เฉพาะกรณีชำระครบ"
              >
                ✗ Close Loan
              </button>
            </div>
          )}
        </div>
        <Button variant="primary" disabled={save.isPending || !can('loan', 'edit')} title={!can('loan', 'edit') ? 'ไม่มีสิทธิ์แก้ไข Loan' : ''} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={() => navigate('/tx/loan')}>Cancel</Button>
      </div>

      <AuditFooter createdBy={(form as any).created_by} createdAt={(form as any).created_at} updatedBy={(form as any).updated_by} updatedAt={(form as any).updated_at} />

      {/* Primary Information (3-col) */}
      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required tipKey="CREDIT AGREEMENT NAME">CREDIT AGREEMENT NAME</FieldLabel>
              <Select
                value={form.ca_id ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, ca_id: e.target.value || null }))}
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
              <FieldLabel tipKey="LOAN NAME">NAME (auto)</FieldLabel>
              <Input
                readOnly
                value={form.name ?? ''}
                placeholder="auto — running no. (สร้างเมื่อ Save)"
                className="bg-gray-50 text-muted"
              />
            </div>
            <div>
              <FieldLabel required tipKey="LOAN NUMBER">LOAN NUMBER</FieldLabel>
              <Input
                value={form.loan_no}
                onChange={(e) => setForm((f) => ({ ...f, loan_no: e.target.value }))}
                placeholder="LN-FX-001"
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
              <FieldLabel required>AMOUNT (THB)</FieldLabel>
              <NumInput value={form.amount ?? 0} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
            </div>
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel>CURRENCY</FieldLabel>
              <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>AMOUNT (FOREIGN)</FieldLabel>
              <NumInput
                value={form.amount_foreign ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, amount_foreign: v }))}
              />
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
              <FieldLabel>CONVERSION RATE</FieldLabel>
              <NumInput
                value={form.conversion_rate ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, conversion_rate: v }))}
              />
            </div>
            <div>
              <FieldLabel>FACILITY TYPE</FieldLabel>
              <Input readOnly value="Loan" className="bg-gray-50" />
            </div>
          </div>

          {/* COL 3 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required>STATUS</FieldLabel>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as LoanStatus }))}>
                {LOAN_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>FINANCE INSTITUTION</FieldLabel>
              <Select
                value={form.finance_institution}
                onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}
              >
                {FINANCE_INSTITUTIONS.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>REMARK</FieldLabel>
              <textarea
                className="input min-h-[120px]"
                value={form.remark ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
                placeholder="หมายเหตุ"
              />
            </div>
          </div>
        </div>
      </Section>

      {/* Schedule Information (3-col) */}
      <Section title="Schedule Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required tipKey="START DATE">START DATE</FieldLabel>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel required>INSTALLMENT START DATE</FieldLabel>
              <Input
                type="date"
                value={form.installment_start_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, installment_start_date: e.target.value || null }))}
              />
            </div>
            <div>
              <FieldLabel>INSTALLMENT END DATE</FieldLabel>
              <Input
                type="date"
                value={form.installment_end_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, installment_end_date: e.target.value || null }))}
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = Installment Start Date + Term (Months)</p>
            </div>
            <label className="flex items-center gap-2 text-sm mt-2">
              <input
                type="checkbox"
                checked={form.pay_eom}
                onChange={(e) => setForm((f) => ({ ...f, pay_eom: e.target.checked }))}
              />
              <FieldLabel>PAY AT END OF MONTH</FieldLabel>
            </label>
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel tipKey="TERM (MONTHS)">TERM (MONTHS)</FieldLabel>
              <NumInput value={form.term_months ?? 0} onChange={(v) => setForm((f) => ({ ...f, term_months: v }))} />
            </div>
            <div>
              <FieldLabel>PAYMENT TYPE</FieldLabel>
              <Select
                value={form.payment_type}
                onChange={(e) => setForm((f) => ({ ...f, payment_type: e.target.value }))}
              >
                {PAYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>PAYMENT TIMING</FieldLabel>
              <Select
                value={form.payment_timing ?? 'arrears'}
                onChange={(e) => setForm((f) => ({ ...f, payment_timing: e.target.value }))}
              >
                <option value="arrears">ชำระปลายงวด (Arrears)</option>
                <option value="advance">ชำระต้นงวด (Advance)</option>
              </Select>
              <p className="text-[10px] text-muted mt-0.5 italic">
                ต้นงวด = จ่ายค่างวดแรกวันเริ่มสัญญา (งวดแรกไม่มีดอกเบี้ย)
              </p>
            </div>
            {form.payment_type.toLowerCase().includes('grace') && (
              <div>
                <FieldLabel>GRACE PERIOD (MONTHS)</FieldLabel>
                <NumInput
                  value={form.grace_months ?? 0}
                  onChange={(v) => setForm((f) => ({ ...f, grace_months: Math.max(0, Math.floor(v)) }))}
                />
                <p className="text-[10px] text-muted mt-0.5 italic">
                  จำนวนงวดต้นสัญญาที่จ่ายเฉพาะดอกเบี้ย (ยังไม่ตัดเงินต้น)
                </p>
              </div>
            )}
            {form.payment_type.toLowerCase().includes('step') && (
              <>
                <div>
                  <FieldLabel>STEP PERIOD (งวดที่เปลี่ยนค่างวด)</FieldLabel>
                  <NumInput
                    value={form.step_period ?? 0}
                    onChange={(v) => setForm((f) => ({ ...f, step_period: v > 0 ? Math.floor(v) : null }))}
                  />
                  <p className="text-[10px] text-muted mt-0.5 italic">
                    เฟส 1 = งวด 1..N (ค่างวดต่ำ) · งวด N+1 เป็นต้นไปค่างวดกระโดด (MoM Day3 §3)
                  </p>
                </div>
                <div>
                  <FieldLabel>STEP RV (ยอดคงเหลือปลายเฟส 1)</FieldLabel>
                  <NumInput
                    value={form.step_residual ?? 0}
                    onChange={(v) => setForm((f) => ({ ...f, step_residual: v > 0 ? v : null }))}
                  />
                  <p className="text-[10px] text-muted mt-0.5 italic">
                    เฟส 1 amortize เงินต้นลงเหลือยอดนี้ แล้วเฟส 2 amortize ต่อลงเหลือ Residual Value สุดท้าย
                  </p>
                </div>
              </>
            )}
            <div>
              <FieldLabel>INSTALLMENT</FieldLabel>
              <NumInput
                value={form.installment ?? monthlyPayment}
                onChange={(v) => setForm((f) => ({ ...f, installment: v }))}
                readOnly
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = PMT(Principal, Rate, Term)</p>
            </div>
            <div>
              <FieldLabel>PRINCIPAL</FieldLabel>
              <NumInput
                value={form.principal}
                onChange={(v) => setForm((f) => ({ ...f, principal: v }))}
                readOnly
                className="bg-gray-50"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">auto = AMOUNT (THB)</p>
            </div>
          </div>

          {/* COL 3 */}
          <div className="space-y-4">
            <div>
              <FieldLabel>RESIDUAL VALUE (RV)</FieldLabel>
              <NumInput
                value={form.residual_value}
                onChange={(v) => setForm((f) => ({ ...f, residual_value: v }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.include_rv_in_installment}
                onChange={(e) => setForm((f) => ({ ...f, include_rv_in_installment: e.target.checked }))}
              />
              <FieldLabel>INCLUDE RV IN INSTALLMENT</FieldLabel>
            </label>
            <div>
              <FieldLabel>BALLOON OPTION</FieldLabel>
              <Select
                value={form.balloon_option ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, balloon_option: e.target.value || null }))}
              >
                {BALLOON_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel tipKey="EFFECTIVE INTEREST RATE">EFFECTIVE INTEREST RATE / YEAR (%)</FieldLabel>
              <Input
                readOnly
                value={effRate.toFixed(4) + '%'}
                className="bg-gray-50 text-right tabular-nums font-semibold text-brand"
              />
              <p className="text-[10px] text-muted mt-0.5 italic">จาก Rate Cards (Interest Rate tab)</p>
            </div>
            <div>
              <FieldLabel>IRR / MONTH (%)</FieldLabel>
              <Input
                readOnly
                value={(effRate / 12).toFixed(4) + '%'}
                className="bg-gray-50 text-right tabular-nums"
              />
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted mt-3 italic">
          💡 ตัวอย่าง: Term Loan {form.term_months} เดือน · {form.payment_type.split(' / ')[0]} · ผ่อนเดือนละ {fmtMoney(monthlyPayment)} บาท
          {form.residual_value > 0 ? ` · Residual Value ${fmtMoney(form.residual_value)} (รวมในงวด)` : ''}
        </p>
      </Section>

      {/* Prepayment Configuration */}
      <Section title="Prepayment Configuration">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>ALLOW PREPAYMENT</FieldLabel>
            <Select
              value={form.allow_prepayment}
              onChange={(e) => setForm((f) => ({ ...f, allow_prepayment: e.target.value }))}
            >
              <option>Yes — รองรับทั้ง Full + Partial</option>
              <option>Full Only</option>
              <option>Partial Only</option>
              <option>No</option>
            </Select>
          </div>
          <div>
            <FieldLabel tipKey="FEE BASE">FEE BASE</FieldLabel>
            <Select
              value={form.prepayment_fee_base}
              onChange={(e) => setForm((f) => ({ ...f, prepayment_fee_base: e.target.value }))}
            >
              <option>Outstanding Principal (หนี้คงเหลือ)</option>
              <option>Prepayment Amount (ยอดที่ชำระคืน)</option>
            </Select>
          </div>
          <div className="md:col-span-3 text-[11px] text-muted italic">
            💡 รายละเอียด Prepayment Fee Rate Card (per tier) — ทำใน CA / ภายหลัง
          </div>
        </div>
      </Section>

      <div className="mt-4">
        <Tabs tabs={tabs} />
      </div>

      {/* ── Full Prepayment Modal ── */}
      <Modal
        open={showFullPrepay}
        onClose={() => setShowFullPrepay(false)}
        title={`💰 Full Prepayment — ${form.loan_no || 'Loan'}`}
        size="md"
        footer={
          <>
            <Button onClick={() => setShowFullPrepay(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => fullPrepay.mutate()} disabled={fullPrepay.isPending}>
              ✓ Confirm Full Prepayment
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted italic">ปิดยอด Outstanding ทั้งหมด → ปิดสัญญา Loan</p>
          <div>
            <FieldLabel required>PAYOFF DATE</FieldLabel>
            <Input type="date" value={payoffDate} onChange={(e) => setPayoffDate(e.target.value)} />
          </div>
          <table className="table-base text-sm">
            <tbody>
              <tr><td className="font-semibold">Original Amount</td><td className="text-right tabular-nums">{fmtMoney(form.principal)}</td></tr>
              <tr><td className="font-semibold">Principal Paid to Date</td><td className="text-right tabular-nums">{fmtMoney(fullPreview.principalPaid)}</td></tr>
              <tr className="bg-soft"><td className="font-bold">Outstanding Principal</td><td className="text-right tabular-nums font-bold">{fmtMoney(fullPreview.outstanding)}</td></tr>
              <tr><td className="font-semibold">Accrued Interest</td><td className="text-right tabular-nums">{fmtMoney(fullPreview.accruedInterest)}</td></tr>
              <tr><td className="font-semibold">Months Since Start</td><td className="text-right tabular-nums">{fullPreview.months} เดือน</td></tr>
            </tbody>
          </table>
          <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-800">
            <div className="font-bold mb-1">📊 Prepayment Fee</div>
            ปิด ณ เดือนที่ {fullPreview.months} → Tier <b>"{fullPreview.tier.label}" = {fullPreview.tier.rate.toFixed(2)}%</b><br />
            Fee = {fmtMoney(feeBase === 'amount' ? fullPreview.outstanding : fullPreview.outstanding)} × {fullPreview.tier.rate.toFixed(2)}% = <b>{fmtMoney(fullPreview.fee)}</b>
            <span className="text-amber-600"> (ฐาน: {feeBase === 'amount' ? 'Prepayment Amount' : 'Outstanding'})</span>
          </div>
          <table className="table-base text-sm border-2 border-brand">
            <tbody>
              <tr><td className="font-semibold">Outstanding Principal</td><td className="text-right tabular-nums">{fmtMoney(fullPreview.outstanding)}</td></tr>
              <tr><td className="font-semibold">+ Accrued Interest</td><td className="text-right tabular-nums">{fmtMoney(fullPreview.accruedInterest)}</td></tr>
              <tr><td className="font-semibold">+ Prepayment Fee ({fullPreview.tier.rate.toFixed(2)}%)</td><td className="text-right tabular-nums">{fmtMoney(fullPreview.fee)}</td></tr>
              <tr className="bg-brand text-white"><td className="!text-white font-bold">💰 TOTAL TO PAY</td><td className="text-right tabular-nums !text-white font-bold">{fmtMoney(fullPreview.totalToPay)}</td></tr>
            </tbody>
          </table>
        </div>
      </Modal>

      {/* ── Partial Prepayment Modal ── */}
      <Modal
        open={showPartPrepay}
        onClose={() => setShowPartPrepay(false)}
        title={`💵 Partial Prepayment — ${form.loan_no || 'Loan'}`}
        size="md"
        footer={
          <>
            <Button onClick={() => setShowPartPrepay(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => partialPrepay.mutate()} disabled={partialPrepay.isPending}>
              ✓ Confirm Partial Prepayment
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted italic">ชำระเพิ่มบางส่วน → ลดเงินต้น Outstanding → Re-amortize Schedule ใหม่</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel required>PREPAYMENT DATE</FieldLabel>
              <Input type="date" value={partDate} onChange={(e) => setPartDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel required>PREPAYMENT AMOUNT (บาท)</FieldLabel>
              <NumInput value={partAmount} onChange={setPartAmount} />
            </div>
          </div>
          <table className="table-base text-sm">
            <tbody>
              <tr><td className="font-semibold">Current Outstanding</td><td className="text-right tabular-nums">{fmtMoney(partPreview.outstanding)}</td></tr>
              <tr><td className="font-semibold">Remaining Periods</td><td className="text-right tabular-nums">{partPreview.remainingPeriods} งวด</td></tr>
              <tr><td className="font-semibold">Current Installment</td><td className="text-right tabular-nums">{fmtMoney(partPreview.currentInstallment)}</td></tr>
            </tbody>
          </table>
          <div>
            <FieldLabel>RE-AMORTIZATION OPTION</FieldLabel>
            <Select value={partMode} onChange={(e) => setPartMode(e.target.value as ReamortizeMode)}>
              <option value="reduce-installment">ลดค่างวด (Term เท่าเดิม {partPreview.remainingPeriods} งวด)</option>
              <option value="reduce-term">ลด Term (ค่างวดเท่าเดิม {fmtMoney(partPreview.currentInstallment)})</option>
            </Select>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-800">
            <div className="font-bold mb-1">📊 Prepayment Fee</div>
            Fee = {fmtMoney(feeBase === 'amount' ? partAmount : partPreview.outstanding)} × {partPreview.tier.rate.toFixed(2)}% ({partPreview.tier.label}) = <b>{fmtMoney(partPreview.fee)}</b>
          </div>
          <table className="table-base text-sm border-2 border-brand">
            <thead><tr className="bg-brand text-white"><th className="!text-white !bg-brand">After Prepayment</th><th className="!text-white !bg-brand text-right">New Value</th></tr></thead>
            <tbody>
              <tr><td className="font-semibold">New Outstanding Principal</td><td className="text-right tabular-nums">{fmtMoney(partPreview.newOutstanding)}</td></tr>
              <tr><td className="font-semibold">Re-amortize</td><td className="text-right">{partMode === 'reduce-installment' ? 'ลดค่างวด' : 'ลด Term'}</td></tr>
              <tr><td className="font-semibold">Total to Pay (Now)</td><td className="text-right tabular-nums font-bold">{fmtMoney(partPreview.totalToPay)}</td></tr>
            </tbody>
          </table>
        </div>
      </Modal>

      {/* ── Modify Loan Condition Modal ── */}
      <Modal
        open={showModify}
        onClose={() => setShowModify(false)}
        title={`📝 Modify Loan Condition — ${form.loan_no || 'Loan'}`}
        size="md"
        footer={
          <>
            <Button onClick={() => setShowModify(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => modify.mutate()} disabled={modify.isPending}>
              {modifyMode === 'reopen' ? 'Proceed → Close & Reopen' : 'Proceed → Edit'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted italic">เลือกวิธีปรับเปลี่ยนเงื่อนไขสัญญา Loan</p>
          <div>
            <FieldLabel required>MODIFY DATE</FieldLabel>
            <Input type="date" value={modifyDate} onChange={(e) => setModifyDate(e.target.value)} />
          </div>

          <label className={`flex gap-2.5 p-3 border rounded cursor-pointer ${modifyMode === 'reopen' ? 'border-brand bg-blue-50' : 'border-line bg-soft'}`}>
            <input type="radio" name="modify-mode" checked={modifyMode === 'reopen'} onChange={() => setModifyMode('reopen')} className="mt-1" />
            <div>
              <div className="font-bold">A. Close + Reopen <span className="text-brand text-xs font-normal">(วิธี MGC ใช้ปัจจุบัน)</span></div>
              <div className="text-xs text-muted mt-0.5">ปิดสัญญาเดิม แล้วเปิดสัญญาใหม่ด้วยเงื่อนไขใหม่</div>
              <div className="text-[10px] text-muted italic mt-0.5">✓ IRR ไม่ติด · ไม่กระทบ schedule เดิม</div>
            </div>
          </label>
          <label className={`flex gap-2.5 p-3 border rounded cursor-pointer ${modifyMode === 'change' ? 'border-brand bg-blue-50' : 'border-line bg-soft'}`}>
            <input type="radio" name="modify-mode" checked={modifyMode === 'change'} onChange={() => setModifyMode('change')} className="mt-1" />
            <div>
              <div className="font-bold">B. Change Condition <span className="text-danger text-xs font-normal">(iCE ทำได้ — MGC ยังไม่เคยใช้)</span></div>
              <div className="text-xs text-muted mt-0.5">ปรับเงื่อนไขบนสัญญาเดิม + Re-amortize schedule ใหม่</div>
              <div className="text-[10px] text-danger italic mt-0.5">⚠️ IRR จะติด · ตัวเลขในตารางเดิมเปลี่ยน</div>
            </div>
          </label>

          {modifyMode === 'reopen' && (
            <>
              <table className="table-base text-sm">
                <tbody>
                  <tr><td className="font-semibold">เงินต้นคงเหลือ (Outstanding)</td><td className="text-right tabular-nums">{fmtMoney(modifyPreview.outstanding)}</td></tr>
                  <tr><td className="font-semibold">ดอกเบี้ยค้างจ่าย (Accrued)</td><td className="text-right tabular-nums">{fmtMoney(modifyPreview.accruedInterest)}</td></tr>
                </tbody>
              </table>
              <div className="bg-blue-50 border border-blue-200 rounded p-2.5">
                <div className="text-xs font-bold text-brand mb-1.5">เลือกวิธีจัดการดอกเบี้ยค้าง {fmtMoney(modifyPreview.accruedInterest)} บาท:</div>
                <div className="space-y-1.5">
                  {[
                    { v: 1, t: '1. จ่าย Full ทันที', d: `จ่ายดอกเบี้ยค้างเป็นเงินสด ณ วันปิดสัญญาเดิม · เงินต้นใหม่ = ${fmtMoney(modifyPreview.outstanding)}` },
                    { v: 2, t: '2. ผ่อนจ่ายแยก', d: `แยกดอกเบี้ยค้างเป็น schedule แยก · เงินต้นใหม่ = ${fmtMoney(modifyPreview.outstanding)}` },
                    { v: 3, t: '3. รวมเป็นเงินต้นก้อนใหม่', d: `รวมดอกเบี้ยค้างเข้าเงินต้นใหม่ · เงินต้นใหม่ = ${fmtMoney(modifyPreview.outstanding + modifyPreview.accruedInterest)}` },
                  ].map((o) => (
                    <label key={o.v} className={`flex gap-2 p-2 border rounded cursor-pointer text-xs ${accruedOption === o.v ? 'border-brand bg-white' : 'border-line bg-white/50'}`}>
                      <input type="radio" name="accrued-opt" checked={accruedOption === o.v} onChange={() => setAccruedOption(o.v as 1 | 2 | 3)} className="mt-0.5" />
                      <div><div className="font-semibold">{o.t}</div><div className="text-muted mt-0.5">{o.d}</div></div>
                    </label>
                  ))}
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-800">
                💡 หลังกด Proceed → ระบบสร้างสัญญาใหม่ (Draft) เงินต้น <b>{fmtMoney(modifyPreview.newPrincipal)}</b> แล้วพาไปกรอกเงื่อนไขใหม่ (Term / Rate / Payment Type)
              </div>
            </>
          )}
          {modifyMode === 'change' && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-800">
              ⚠️ MGC ยังไม่ใช้วิธีนี้ — กด Proceed แล้วแก้เงื่อนไขในฟอร์มได้เลย จากนั้นกด Save เพื่อ re-amortize (ตัวเลขในตารางเดิมจะเปลี่ยน · IRR จะติด)
            </div>
          )}
        </div>
      </Modal>

      {/* ── Close Loan Modal ── */}
      <Modal
        open={showClose}
        onClose={() => setShowClose(false)}
        title={`✗ Close Loan — ${form.loan_no || 'Loan'}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setShowClose(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => closeLoan.mutate()} disabled={closeLoan.isPending || closePreview.outstanding > 0.01}>
              ✗ Confirm Close
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted italic">ปิดสัญญา Loan — เฉพาะกรณีชำระครบ (เงินต้นคงเหลือ = 0)</p>
          <div>
            <FieldLabel required>CLOSE DATE</FieldLabel>
            <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
          </div>
          <table className="table-base text-sm">
            <tbody>
              <tr className="bg-soft"><td className="font-bold">เงินต้นคงเหลือ ณ วันปิด</td><td className="text-right tabular-nums font-bold">{fmtMoney(closePreview.outstanding)}</td></tr>
            </tbody>
          </table>
          {closePreview.outstanding > 0.01 ? (
            <div className="bg-red-50 border border-red-200 rounded p-2.5 text-xs text-red-800">
              ⚠️ ยังมีเงินต้นคงเหลือ {fmtMoney(closePreview.outstanding)} — ปิดแบบนี้ไม่ได้ ถ้าจะปิดก่อนกำหนดให้ใช้ <b>Full Prepayment</b> แทน
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-2.5 text-xs text-emerald-800">
              ✓ ชำระครบแล้ว — ปิดสัญญาได้
            </div>
          )}
        </div>
      </Modal>

      {/* ── Interest Payment Modal (MoM: จ่ายดอกจริงตามวันจ่ายจริง) ── */}
      <Modal
        open={showIntPay}
        onClose={() => setShowIntPay(false)}
        title={`💵 Interest Payment — Period ${intPayRow?.period ?? ''}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setShowIntPay(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => postIntPayJE.mutate()} disabled={postIntPayJE.isPending || !can('loan', 'approve')}>
              ✓ Confirm Interest Payment
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted italic">ลงจ่ายดอกเบี้ยจริง (Dr Interest Expense / Cr Cash) — ระบบยึดวันจ่ายจริงเป็นหลัก ส่วนต่างจากตาราง = adjustment อัตโนมัติ</p>
          <div>
            <FieldLabel required>วันที่จ่ายจริง (Actual Payment Date)</FieldLabel>
            <Input type="date" value={intPayDate} onChange={(e) => setIntPayDate(e.target.value)} />
          </div>
          <table className="table-base text-sm">
            <tbody>
              <tr><td className="font-semibold">งวดที่</td><td className="text-right">{intPayRow?.period}</td></tr>
              <tr><td className="font-semibold">กำหนดชำระ (ตาราง)</td><td className="text-right">{intPayRow ? fmtDate(intPayRow.endDate) : '—'}</td></tr>
              <tr><td>ดอกเบี้ยตามตาราง (Planned)</td><td className="text-right tabular-nums">{fmtMoney(intPayActual?.scheduled ?? 0)}</td></tr>
              <tr><td>จำนวนวันจริง (Actual)</td><td className="text-right tabular-nums">{intPayActual?.actualDays ?? 0} วัน</td></tr>
              <tr className="bg-soft"><td className="font-bold">ดอกเบี้ยตามวันจ่ายจริง (Actual)</td><td className="text-right tabular-nums font-bold">{fmtMoney(intPayActual?.actualInterest ?? 0)}</td></tr>
              <tr className={(intPayActual?.adjustment ?? 0) === 0 ? '' : (intPayActual?.adjustment ?? 0) > 0 ? 'text-danger' : 'text-emerald-700'}>
                <td className="font-semibold">Adjustment (Actual − Planned)</td>
                <td className="text-right tabular-nums font-semibold">
                  {(intPayActual?.adjustment ?? 0) === 0 ? '—' : `${(intPayActual?.adjustment ?? 0) > 0 ? '+' : ''}${fmtMoney(intPayActual?.adjustment ?? 0)}`}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-muted">JE จะลงดอกตาม Actual ({fmtMoney(intPayActual?.actualInterest ?? 0)}) — ส่วนต่างจากที่ตั้งค้างไว้ถูกปรับให้อัตโนมัติ</p>
        </div>
      </Modal>
    </div>
  );
}

// ============== Chassis Tab — Modal Lookup (PN-style) ==============
function ChassisTab({ chassis, onChange }: { chassis: LoanChassis[]; onChange: (n: LoanChassis[]) => void }) {
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
      c.car_model.toLowerCase().includes(q) ||
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
    const picked = MOCK_INVENTORY.filter((c) => selected.has(c.id)).map<LoanChassis>((c) => ({
      id: crypto.randomUUID(),
      loan_id: '',
      chassis_no: c.chassis_no,
      engine_no: c.engine_no,
      car_model: c.car_model,
      location: c.location,
      cost: c.cost,
      status: 'Active',
      sort_order: chassis.length,
    }));
    onChange([...chassis, ...picked]);
    setSelected(new Set());
    setLookupOpen(false);
    setSearch('');
  };

  const remove = (i: number) => onChange(chassis.filter((_, j) => j !== i));

  return (
    <div>
      <div className="mb-3 flex justify-between items-center">
        <p className="text-[11px] text-muted italic">
          📌 Chassis ดึงจาก NetSuite Inventory (mock) · 1 Chassis ผูกได้ 1 Facility เท่านั้น
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
              <ThTip>Chassis No.</ThTip>
              <ThTip>Engine No.</ThTip>
              <ThTip>Car Model</ThTip>
              <ThTip>Location</ThTip>
              <ThTip align="right">Cost (THB)</ThTip>
              <ThTip>Status</ThTip>
              <ThTip>Action</ThTip>
            </tr>
          </thead>
          <tbody>
            {chassis.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-6 italic">
                  ยังไม่มี Chassis — กด <strong>🔍 Lookup Chassis</strong>
                </td>
              </tr>
            )}
            {chassis.map((c, i) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.chassis_no}</td>
                <td className="font-mono text-xs">{c.engine_no ?? '—'}</td>
                <td>{c.car_model ?? '—'}</td>
                <td>{c.location ?? '—'}</td>
                <td className="text-right tabular-nums">{fmtMoney(c.cost)}</td>
                <td><Badge variant="success">{c.status}</Badge></td>
                <td>
                  <button onClick={() => remove(i)} className="text-danger hover:underline text-xs">
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
          💡 Mock data — ระบบจริงจะดึงจาก NetSuite Inventory · 1 Chassis ผูกได้ 1 Facility
        </p>
        <div className="overflow-x-auto max-h-[400px]">
          <table className="table-base">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th className="w-10"></th>
                <ThTip>Chassis No.</ThTip>
                <ThTip>Engine No.</ThTip>
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
                      ? 'Chassis ทั้งหมดถูกผูกแล้ว'
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
                  <td>{c.car_model}</td>
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

function Stat({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="!py-3">
        <div className="text-xs text-muted">{label}</div>
        <div className={`text-lg font-semibold tabular-nums ${highlight ? 'text-brand' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// Mock chassis inventory (NetSuite — Aliyan)
const MOCK_INVENTORY: { id: string; chassis_no: string; engine_no: string; car_model: string; location: string; cost: number }[] = [
  { id: 'inv-l-1', chassis_no: 'MMTFR86A8RH001238', engine_no: 'B38A15-1107238', car_model: 'MINI Cooper S 5DR',   location: 'MAG Phaholyothin', cost: 2_390_000 },
  { id: 'inv-l-2', chassis_no: 'WBA8E5C50JG924765', engine_no: 'B48B20-8847213', car_model: 'BMW 320i M Sport',     location: 'MAG Rama 9',        cost: 1_800_000 },
  { id: 'inv-l-3', chassis_no: 'WMW7D5108K5K12345', engine_no: 'B38A15-3320145', car_model: 'MINI Cooper Country',  location: 'MAG Bangna',        cost: 1_650_000 },
  { id: 'inv-l-4', chassis_no: 'WBAJB4C50KBV98762', engine_no: 'B48B20-9912034', car_model: 'BMW 530e M Sport',     location: 'MAG HQ Showroom',   cost: 3_450_000 },
  { id: 'inv-l-5', chassis_no: 'WAUE8AF44LA011234', engine_no: 'DLVA-4451209',   car_model: 'Audi A6 45 TFSI',      location: 'MAG Lat Phrao',     cost: 3_290_000 },
  { id: 'inv-l-6', chassis_no: 'JHMFC1F70KX021234', engine_no: 'L15B7-2203471', car_model: 'Honda Civic RS',       location: 'MAG Rangsit',       cost: 1_090_000 },
];
