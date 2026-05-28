import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Input, Select, Badge, Modal, FieldLabel, HoverTooltip, NumInput } from '@/components/ui';
import { TOOLTIPS } from '@/lib/tooltips';
import { Section } from '@/components/tx/Section';
import { Tabs } from '@/components/tx/Tabs';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { ThTip, TipLabel } from '@/components/tx/TipHelpers';
import { fmtMoney, fmtDate, fmtDateISO} from '@/lib/format';
import { buildSchedule, pmt } from '@/lib/lease-calc';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { buildHPSchedule } from '@/lib/hp-schedule';
import { buildRouDepreciation } from '@/lib/rou-depreciation';
import { createJE, postJE } from '@/lib/je';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import type { Lease, LeaseVersion } from '@/types/database';
import { FINANCE_INSTITUTIONS } from '@/types/database';

const r2 = (n: number) => Math.round(n * 100) / 100;

// "?" hover tooltip for inline checkbox labels (resolves text → TOOLTIPS key)
function CbTip({ k }: { k: string }) {
  const tip = TOOLTIPS[k] ?? TOOLTIPS[k.toUpperCase()];
  if (!tip) return null;
  return (
    <HoverTooltip text={tip}>
      <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-[10px] text-gray-600 cursor-help hover:bg-brand hover:text-white transition">
        ?
      </span>
    </HoverTooltip>
  );
}

// HP / Lease GL accounts — codes per sample
const HP_GL = {
  asset: { code: '1240100', name: 'Right-of-Use Asset / Suspense Vehicle' },
  deferredInterest: { code: '240000', name: 'Deferred Interest' },
  currDeferredInterest: { code: '281000', name: 'Current Portion of Deferred Interest' },
  undueVat: { code: '119601', name: 'Undue Input VAT — Lease' },
  leaseLiabilityLT: { code: '230000', name: 'Long-term Lease Liability' },
  currLeaseLiability: { code: '280000', name: 'Current Portion of Lease Liability' },
  interestExpense: { code: '610000', name: 'Lease Interest Expense' },
  apLeasing: { code: '212010', name: 'AP — Leasing Co.' },
  remeasurePL: { code: '690000', name: 'Lease Re-measurement Gain/(Loss)' },
  // ROU depreciation
  depreciationExpense: { code: '611000', name: 'Depreciation Expense — ROU' },
  accumDepRou: { code: '124900', name: 'Accumulated Depreciation — ROU' },
  // Asset Transfer targets
  ppe: { code: '125000', name: 'Property, Plant & Equipment (Owned)' },
  investmentProperty: { code: '126000', name: 'Investment Property (IP)' },
  assetHeldForSale: { code: '127000', name: 'Asset Held for Sale (รอขาย)' },
  olAsset: { code: '128000', name: 'Operating Lease Asset (ให้เช่าต่อ)' },
};

// Asset Transfer — 5 scenarios.
const ASSET_TRANSFERS = [
  { key: 'ROU_PPE', label: 'ROU → PPE (Owned Asset)', when: 'ครบสัญญาเช่า แล้วซื้อต่อ', from: 'ROU Asset', to: 'PPE (Owned Asset)', drGl: 'ppe', crGl: 'accumDepRou' },
  { key: 'ROU_IP', label: 'ROU → Investment Property (IP)', when: 'เปลี่ยนวัตถุประสงค์เป็นปล่อยให้เช่า', from: 'ROU Asset', to: 'Investment Property', drGl: 'investmentProperty', crGl: 'accumDepRou' },
  { key: 'ROU_HELD_SALE', label: 'ROU → Asset Held for Sale (รอขาย)', when: 'หยุดเช่า ตั้งใจขาย', from: 'ROU Asset', to: 'Asset Held for Sale', drGl: 'assetHeldForSale', crGl: 'accumDepRou' },
  { key: 'ROU_OL', label: 'ROU → Operating Lease (ให้เช่าต่อ)', when: 'เปลี่ยนเป็นการ sublease', from: 'ROU Asset', to: 'Operating Lease Asset', drGl: 'olAsset', crGl: 'accumDepRou' },
  { key: 'PPE_IP', label: 'PPE → Investment Property', when: 'เปลี่ยนวัตถุประสงค์ Owned → ให้เช่า', from: 'PPE (Owned Asset)', to: 'Investment Property', drGl: 'investmentProperty', crGl: 'ppe' },
] as const;
type TransferKey = typeof ASSET_TRANSFERS[number]['key'];

const schema = z.object({
  lease_no: z.string().optional().default(''), // auto running number when blank
  mode: z.enum(['hp', 'other']),
  use_bank_loan: z.boolean(),
  ca_id: z.string().nullable().optional(),
  contract_number: z.string().nullable().optional(),
  contract_date: z.string().nullable().optional(),
  classification: z.string(),
  payment_frequency: z.string(),
  payment_start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  payment_type: z.string(),
  asset_type: z.string().min(1),
  asset_name: z.string().min(1, 'กรอกชื่อสินทรัพย์'),
  vendor: z.string().optional(),
  vehicle_price: z.coerce.number().nullable().optional(),
  down_payment: z.coerce.number().nullable().optional(),
  principal: z.coerce.number().min(0, 'เงินต้นต้อง >= 0'),
  annual_rate: z.coerce.number().min(0).max(100),
  term_months: z.coerce.number().int().min(1, 'อย่างน้อย 1 งวด'),
  start_date: z.string().min(1),
  balloon_amount: z.coerce.number().nullable().optional(),
  balloon_pattern: z.string().nullable().optional(),
  upfront_payment: z.coerce.number().nullable().optional(),
  grace_periods: z.coerce.number().int().nullable().optional(),
  prepaid_periods: z.coerce.number().int().nullable().optional(),
  discount_rate: z.coerce.number().nullable().optional(),
  rou_useful_life: z.coerce.number().int().nullable().optional(),
  vat_rate: z.coerce.number().min(0).max(100),
  posting_lease: z.boolean(),
  jv_auto_approve: z.boolean(),
  inactive: z.boolean(),
  calc_interest_end: z.boolean(),
  include_balloon_installment: z.boolean(),
  pay_eom: z.boolean(),
  status: z.enum(['Draft', 'Approved', 'Active', 'Closed', 'Modified', 'Roll Over']),
  remark: z.string().nullable().optional(),
});

type FormData = z.infer<typeof schema>;

export function LeaseDetail({
  mode: pageMode,
  leaseMode,
}: {
  mode: 'new' | 'edit';
  leaseMode: 'hp' | 'other';
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const baseRoute = leaseMode === 'hp' ? '/lease/hp' : '/lease/other';
  const userLabel = useCurrentUserLabel();
  const { can: rawCan } = useAuth();
  const viewOnly = useReadOnly();
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);
  const menuKey = leaseMode === 'hp' ? 'lease_hp' : 'lease_other';
  const [acctCards, setAcctCards] = useState<AcctCard[]>([]);

  // Rebate (Close Early) modal state
  const today = fmtDateISO(new Date());
  const [showRebate, setShowRebate] = useState(false);
  const [closeDate, setCloseDate] = useState(today);
  const [closeReason, setCloseReason] = useState('Customer Request');
  const [intRebatePct, setIntRebatePct] = useState(50);
  const [vatRebatePct, setVatRebatePct] = useState(50);

  // Roll Over modal state — HP: balloon ครบ จ่ายไม่ไหว → ปิดเดิม + เปิดใหม่
  const [showRollover, setShowRollover] = useState(false);
  const [rolloverDate, setRolloverDate] = useState(today);
  const [rolloverTerm, setRolloverTerm] = useState(12);
  const [rolloverRate, setRolloverRate] = useState(0);

  // Re-measurement modal state — Lease Other (TFRS 16): Excel คำนวณ ROU/Liability ใหม่ → กรอกกลับ + ลง JE ปรับปรุง
  const [showRemeasure, setShowRemeasure] = useState(false);
  const [remeasureDate, setRemeasureDate] = useState(today);
  const [remeasureRou, setRemeasureRou] = useState(0);
  const [remeasureLiability, setRemeasureLiability] = useState(0);
  const [remeasureTerm, setRemeasureTerm] = useState(0);
  const [remeasureRate, setRemeasureRate] = useState(0);
  const [remeasureReason, setRemeasureReason] = useState('Lease modification (re-measurement)');

  // Asset Transfer modal state
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferKey, setTransferKey] = useState<TransferKey>('ROU_PPE');
  const [transferDate, setTransferDate] = useState(today);
  const [transferAmount, setTransferAmount] = useState(0);
  const [transferNote, setTransferNote] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      lease_no: '',
      mode: leaseMode,
      use_bank_loan: leaseMode === 'hp' ? true : true,
      ca_id: null,
      contract_number: '',
      contract_date: fmtDateISO(new Date()),
      classification: 'Finance',
      payment_frequency: 'Monthly',
      payment_start_date: fmtDateISO(new Date()),
      end_date: null,
      payment_type: 'Fix Installment / Fix Installment & Step payment',
      asset_type: leaseMode === 'hp' ? 'ยานพาหนะ' : 'อาคาร / ที่ดิน',
      asset_name: '',
      vendor: '',
      vehicle_price: 0,
      down_payment: 0,
      principal: 0,
      annual_rate: 0,
      term_months: 48,
      start_date: fmtDateISO(new Date()),
      balloon_amount: 0,
      balloon_pattern: 'with-last',
      upfront_payment: 0,
      grace_periods: 0,
      prepaid_periods: 0,
      discount_rate: 4.65,
      rou_useful_life: null,
      vat_rate: 7,
      posting_lease: true,
      jv_auto_approve: false,
      inactive: false,
      calc_interest_end: false,
      include_balloon_installment: true,
      pay_eom: true,
      status: 'Draft',
      remark: '',
    },
  });

  const watched = useWatch({ control });

  const { data: existing } = useQuery({
    queryKey: ['lease', id],
    enabled: pageMode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('leases').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Lease;
    },
  });

  // Credit Agreement options (CREDIT AGREEMENT NAME)
  const { data: caOptions = [] } = useQuery({
    queryKey: ['lease-ca-options'],
    queryFn: async () => {
      const { data } = await supabase.from('credit_agreements').select('id, ca_name, contract_number, finance_institution').order('ca_name');
      return (data ?? []) as { id: string; ca_name: string; contract_number: string | null; finance_institution: string | null }[];
    },
  });

  useEffect(() => {
    if (existing) {
      reset({
        lease_no: existing.lease_no,
        mode: existing.mode,
        use_bank_loan: existing.use_bank_loan,
        ca_id: existing.ca_id,
        contract_number: existing.contract_number ?? '',
        contract_date: existing.contract_date ?? fmtDateISO(new Date()),
        classification: existing.classification ?? 'Finance',
        payment_frequency: existing.payment_frequency ?? 'Monthly',
        payment_start_date: existing.payment_start_date ?? existing.start_date,
        end_date: existing.end_date ?? null,
        payment_type: existing.payment_type ?? 'Fix Installment',
        asset_type: existing.asset_type,
        asset_name: existing.asset_name,
        vendor: existing.vendor ?? '',
        vehicle_price: existing.vehicle_price ?? 0,
        down_payment: existing.down_payment ?? 0,
        principal: existing.principal,
        annual_rate: existing.annual_rate,
        term_months: existing.term_months,
        start_date: existing.start_date,
        balloon_amount: existing.balloon_amount ?? 0,
        balloon_pattern: existing.balloon_pattern ?? 'with-last',
        upfront_payment: existing.upfront_payment ?? 0,
        grace_periods: existing.grace_periods ?? 0,
        prepaid_periods: existing.prepaid_periods ?? 0,
        discount_rate: existing.discount_rate ?? 4.65,
        rou_useful_life: existing.rou_useful_life ?? null,
        vat_rate: existing.vat_rate ?? 7,
        posting_lease: existing.posting_lease ?? true,
        jv_auto_approve: existing.jv_auto_approve ?? false,
        inactive: existing.inactive ?? false,
        calc_interest_end: existing.calc_interest_end ?? false,
        include_balloon_installment: existing.include_balloon_installment ?? true,
        pay_eom: existing.pay_eom ?? true,
        status: existing.status,
        remark: existing.remark ?? '',
      });
      setAcctCards((existing.acct_cards as AcctCard[]) ?? []);
    }
  }, [existing, reset]);

  // HP auto-compute: Net Vehicle Cost = Vehicle Price - Down Payment → Principal
  useEffect(() => {
    if (watched.mode === 'hp') {
      const net = (watched.vehicle_price ?? 0) - (watched.down_payment ?? 0);
      if (net >= 0) setValue('principal', net, { shouldDirty: false });
    }
  }, [watched.vehicle_price, watched.down_payment, watched.mode, setValue]);

  // Lease Other (bank-credit): Finance Institution ดึงจาก Credit Agreement ที่เลือก (MA → CA → Lease)
  useEffect(() => {
    if (watched.mode === 'other' && watched.use_bank_loan && watched.ca_id) {
      const ca = caOptions.find((c) => c.id === watched.ca_id);
      if (ca?.finance_institution) setValue('vendor', ca.finance_institution, { shouldDirty: false });
    }
  }, [watched.ca_id, watched.use_bank_loan, watched.mode, caOptions, setValue]);

  // Auto-compute END DATE = Payment Start Date + Term (months) − 1 day
  useEffect(() => {
    if (watched.payment_start_date && watched.term_months) {
      const d = new Date(watched.payment_start_date);
      d.setMonth(d.getMonth() + watched.term_months);
      d.setDate(d.getDate() - 1);
      const iso = fmtDateISO(d);
      if (iso !== watched.end_date) setValue('end_date', iso, { shouldDirty: false });
    }
  }, [watched.payment_start_date, watched.term_months, setValue]);

  // Build live schedule preview
  const schedule = useMemo(() => {
    if (!watched.principal || !watched.term_months || !watched.start_date) return [];
    try {
      return buildSchedule({
        principal: watched.principal,
        // IFRS 16 lease (other) discounts at the Discount Rate; HP uses the contract rate
        annualRate: watched.mode === 'other' ? (watched.discount_rate ?? watched.annual_rate ?? 0) : (watched.annual_rate ?? 0),
        termMonths: watched.term_months,
        startDate: watched.payment_start_date ?? watched.start_date,
        balloon: watched.balloon_amount ?? 0,
        upfront: watched.upfront_payment ?? 0,
        gracePeriods: watched.grace_periods ?? 0,
        prepaidPeriods: watched.prepaid_periods ?? 0,
      });
    } catch {
      return [];
    }
  }, [watched]);

  const monthlyEst = useMemo(() => {
    if (!watched.principal || !watched.term_months) return 0;
    return pmt(
      (watched.principal ?? 0) - (watched.upfront_payment ?? 0),
      watched.annual_rate ?? 0,
      Math.max(1, (watched.term_months ?? 0) - (watched.grace_periods ?? 0) - (watched.prepaid_periods ?? 0)),
      watched.balloon_amount ?? 0,
    );
  }, [watched]);

  const totalPayment = useMemo(
    () => schedule.reduce((sum, r) => sum + r.payment, 0),
    [schedule],
  );
  const totalInterest = useMemo(
    () => schedule.reduce((sum, r) => sum + r.interest, 0),
    [schedule],
  );

  // HP-specific schedule (adds VAT / Deferred Interest / VAT Balance)
  const hpSchedule = useMemo(() => {
    if (watched.mode !== 'hp' || !watched.principal || !watched.term_months || !watched.start_date) return null;
    try {
      const step = watched.payment_frequency === 'Quarterly' ? 3 : watched.payment_frequency === 'Yearly' ? 12 : 1;
      return buildHPSchedule({
        principal: watched.principal,
        annualRate: watched.annual_rate ?? 0,
        termMonths: watched.term_months,
        installmentStart: watched.payment_start_date ?? watched.start_date,
        balloon: watched.balloon_amount ?? 0,
        balloonPattern: watched.include_balloon_installment === false ? 'after-last' : watched.balloon_pattern,
        gracePeriods: watched.grace_periods ?? 0,
        vatRate: watched.vat_rate ?? 7,
        payEom: watched.pay_eom ?? true,
        paymentType: watched.payment_type,
        stepMonths: step,
      });
    } catch {
      return null;
    }
  }, [watched]);

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const payload: any = {
        ...form,
        net_vehicle_cost:
          form.mode === 'hp' ? (form.vehicle_price ?? 0) - (form.down_payment ?? 0) : null,
        acct_cards: acctCards,
        updated_by: userLabel,
      };
      if (pageMode === 'new' && !(form.lease_no ?? '').trim()) {
        payload.lease_no = await nextRunningNo(form.mode === 'hp' ? RUNNING_PREFIX.hp : RUNNING_PREFIX.lease);
      }
      let result: any;
      if (pageMode === 'new') {
        const { data, error } = await supabase.from('leases').insert({ ...payload, created_by: userLabel }).select().single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from('leases')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', id!)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      // Regenerate schedule rows
      await supabase.from('lease_schedules').delete().eq('lease_id', result.id);
      if (form.mode === 'hp' && hpSchedule && hpSchedule.rows.length > 0) {
        const rows = hpSchedule.rows.map((r) => ({
          lease_id: result.id,
          period: r.period,
          due_date: r.endDate,
          begin_balance: r.beginBalance,
          payment: r.installment,
          interest: r.interest,
          principal: r.principal,
          end_balance: r.endBalance,
          vat: r.vat,
          total_inc_vat: r.totalIncVat,
          deferred_interest_balance: r.deferredInterestBalance,
          vat_balance: r.vatBalance,
          note: r.note ?? null,
        }));
        const { error: schedErr } = await supabase.from('lease_schedules').insert(rows);
        if (schedErr) throw schedErr;
      } else if (schedule.length > 0) {
        const rows = schedule.map((r) => ({
          lease_id: result.id,
          period: r.period,
          due_date: r.date,
          begin_balance: r.beginBalance,
          payment: r.payment,
          interest: r.interest,
          principal: r.principal,
          end_balance: r.endBalance,
          note: r.note ?? null,
        }));
        const { error: schedErr } = await supabase.from('lease_schedules').insert(rows);
        if (schedErr) throw schedErr;
      }

      return result;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['lease-list'] });
      qc.invalidateQueries({ queryKey: ['lease', id] });
      toast.success(
        pageMode === 'new'
          ? `สร้างสัญญา Lease + Schedule ${schedule.length} งวด`
          : `อัปเดตสัญญา + Schedule ${schedule.length} งวด`,
      );
      if (pageMode === 'new') navigate(`${baseRoute}/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Rebate preview (Close Early) — outstanding pulled from HP schedule at close date ──
  const rebatePreview = useMemo(() => {
    if (!hpSchedule) return null;
    const paid = hpSchedule.rows.filter((r) => r.endDate <= closeDate);
    const last = paid.length ? paid[paid.length - 1] : null;
    const principalOut = last ? last.endBalance : hpSchedule.totalPrincipal;
    const interestOut = last ? last.deferredInterestBalance : hpSchedule.totalInterest;
    const vatOut = last ? last.vatBalance : hpSchedule.totalVat;
    const intRebate = r2((interestOut * intRebatePct) / 100);
    const vatRebate = r2((vatOut * vatRebatePct) / 100);
    const intNet = r2(interestOut - intRebate);
    const vatNet = r2(vatOut - vatRebate);
    const totalSettlement = r2(principalOut + intNet + vatNet);
    return { principalOut, interestOut, vatOut, intRebate, vatRebate, intNet, vatNet, totalSettlement };
  }, [hpSchedule, closeDate, intRebatePct, vatRebatePct]);

  const rebateSettle = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน (ต้องมี ID)');
      if (!rebatePreview) throw new Error('ยังไม่มี schedule');
      const p = rebatePreview;
      const lines = [
        { account_code: '2240100', account_name: 'Lease Liability / HP Payable', dr: p.principalOut, description: 'Settle outstanding principal (no rebate)' },
        ...(p.intNet > 0.005 ? [{ account_code: '610000', account_name: 'Lease Interest Expense', dr: p.intNet, description: `Interest net of rebate ${intRebatePct}%` }] : []),
        ...(p.vatNet > 0.005 ? [{ account_code: '1163100', account_name: 'Undue Input VAT', dr: p.vatNet, description: `VAT net of rebate ${vatRebatePct}%` }] : []),
        { account_code: '100000', account_name: 'Cheque Account', cr: p.totalSettlement, description: 'Early settlement payout' },
      ];
      const je = await createJE({
        source_type: 'LEASE_REBATE',
        source_id: id,
        je_date: closeDate,
        description: `HP Early Settlement (Rebate) — ${watched.lease_no}`,
        remark: `Reason: ${closeReason} · Rebate int ${intRebatePct}% / vat ${vatRebatePct}%`,
        lines,
      });
      await postJE(je.id, 'user');
      await supabase.from('leases').update({ status: 'Closed' }).eq('id', id);
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-list'] });
      qc.invalidateQueries({ queryKey: ['lease', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setShowRebate(false);
      setValue('status', 'Closed', { shouldDirty: false });
      toast.success(`✓ ปิดสัญญา (Rebate) + JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Roll Over (HP): balloon ครบ → ปิดสัญญาเดิม + เปิดสัญญาใหม่ใช้ Balloon เป็นเงินต้น ──
  const rollover = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      if (watched.status !== 'Active') throw new Error('Roll Over ทำได้เฉพาะสัญญา Active');
      const balloon = r2(watched.balloon_amount ?? 0);
      if (balloon <= 0) throw new Error('สัญญานี้ไม่มี Balloon — Roll Over ไม่ได้');
      // 1) close old contract — HP balloon roll over
      await supabase.from('leases').update({ status: 'Roll Over', end_date: rolloverDate }).eq('id', id);
      // 2) create new Draft contract — Balloon becomes new principal
      const { data: newLease, error } = await supabase
        .from('leases')
        .insert({
          lease_no: await nextRunningNo(RUNNING_PREFIX.hp),
          ca_id: watched.ca_id ?? null,
          mode: 'hp',
          use_bank_loan: watched.use_bank_loan ?? true,
          contract_number: watched.contract_number ?? null,
          contract_date: rolloverDate,
          classification: watched.classification ?? 'Finance',
          payment_frequency: watched.payment_frequency ?? 'Monthly',
          payment_start_date: rolloverDate,
          payment_type: watched.payment_type ?? 'Fix Installment / Fix Installment & Step payment',
          asset_type: watched.asset_type,
          asset_name: watched.asset_name,
          vendor: watched.vendor ?? null,
          vehicle_price: balloon,
          down_payment: 0,
          net_vehicle_cost: balloon,
          principal: balloon,
          annual_rate: rolloverRate,
          term_months: rolloverTerm,
          start_date: rolloverDate,
          balloon_amount: 0,
          balloon_pattern: 'with-last',
          vat_rate: watched.vat_rate ?? 7,
          posting_lease: true,
          jv_auto_approve: false,
          inactive: false,
          calc_interest_end: false,
          include_balloon_installment: true,
          pay_eom: watched.pay_eom ?? true,
          acct_cards: acctCards,
          rollover_parent_id: id,
          status: 'Draft',
          remark: `Roll Over from ${watched.lease_no} · Balloon ${fmtMoney(balloon)} → new principal`,
        })
        .select()
        .single();
      if (error) throw error;
      return newLease.id as string;
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['lease-list'] });
      qc.invalidateQueries({ queryKey: ['lease', id] });
      setShowRollover(false);
      setValue('status', 'Roll Over', { shouldDirty: false });
      toast.success('✓ Roll Over → เปิดสัญญาใหม่ (กรอกเงื่อนไขใหม่)');
      navigate(`${baseRoute}/${newId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Lease Other — Re-measurement version history (TFRS 16)
  const { data: leaseVersions = [] } = useQuery({
    queryKey: ['lease-versions', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('lease_versions').select('*')
        .eq('lease_id', id!).order('version', { ascending: true });
      return (data ?? []) as LeaseVersion[];
    },
  });

  // ── Re-measurement (Lease Other / TFRS 16) ──
  // Excel คำนวณ ROU + Lease Liability ใหม่ → กรอกกลับ · ระบบลง JE ปรับปรุงผลต่าง + บันทึกเวอร์ชัน
  // Old book values: ใช้ principal เป็นฐาน (= ROU/Liability ตั้งต้น) เทียบกับยอด v ล่าสุด
  const lastVersion = leaseVersions.length ? leaseVersions[leaseVersions.length - 1] : null;
  const oldRou = r2(lastVersion?.rou_asset ?? watched.principal ?? 0);
  const oldLiability = r2(lastVersion?.lease_liability ?? watched.principal ?? 0);
  const remeasurePreview = useMemo(() => {
    const dRou = r2(remeasureRou - oldRou); // + = ROU up = Dr ROU
    const dLiab = r2(remeasureLiability - oldLiability); // + = liability up = Cr Liability
    const plDr = r2(dLiab - dRou); // plug to balance: + = loss (Dr), - = gain (Cr)
    return { dRou, dLiab, plDr };
  }, [remeasureRou, remeasureLiability, oldRou, oldLiability]);

  const remeasureSettle = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน (ต้องมี ID)');
      if (watched.posting_lease === false) throw new Error('POSTING LEASE ปิดอยู่ — สัญญานี้ไม่ลง GL');
      if (remeasureRou <= 0 || remeasureLiability <= 0) throw new Error('กรอก ROU และ Lease Liability ใหม่ (จาก Excel)');
      const { dRou, dLiab, plDr } = remeasurePreview;
      if (Math.abs(dRou) < 0.005 && Math.abs(dLiab) < 0.005) throw new Error('ไม่มีผลต่าง — ไม่ต้องลง JE');

      // Build balanced adjustment lines (Dr positive)
      const lines: { account_code: string; account_name: string; dr?: number; cr?: number; description?: string }[] = [];
      if (Math.abs(dRou) >= 0.005) {
        lines.push(dRou > 0
          ? { account_code: HP_GL.asset.code, account_name: HP_GL.asset.name, dr: dRou, description: 'Re-measure ROU increase' }
          : { account_code: HP_GL.asset.code, account_name: HP_GL.asset.name, cr: -dRou, description: 'Re-measure ROU decrease' });
      }
      if (Math.abs(dLiab) >= 0.005) {
        lines.push(dLiab > 0
          ? { account_code: HP_GL.leaseLiabilityLT.code, account_name: HP_GL.leaseLiabilityLT.name, cr: dLiab, description: 'Re-measure Lease Liability increase' }
          : { account_code: HP_GL.leaseLiabilityLT.code, account_name: HP_GL.leaseLiabilityLT.name, dr: -dLiab, description: 'Re-measure Lease Liability decrease' });
      }
      if (Math.abs(plDr) >= 0.005) {
        lines.push(plDr > 0
          ? { account_code: HP_GL.remeasurePL.code, account_name: HP_GL.remeasurePL.name, dr: plDr, description: 'Re-measurement loss' }
          : { account_code: HP_GL.remeasurePL.code, account_name: HP_GL.remeasurePL.name, cr: -plDr, description: 'Re-measurement gain' });
      }

      const je = await createJE({
        source_type: 'LEASE_REMEASURE',
        source_id: id,
        je_date: remeasureDate,
        description: `Lease Re-measurement — ${watched.lease_no}`,
        remark: `Reason: ${remeasureReason} · ROU ${fmtMoney(oldRou)}→${fmtMoney(remeasureRou)} · Liab ${fmtMoney(oldLiability)}→${fmtMoney(remeasureLiability)}`,
        lines,
      });
      if (watched.jv_auto_approve === true) await postJE(je.id, 'user');

      const nextVersion = (lastVersion?.version ?? 1) + 1;
      const newTerm = remeasureTerm > 0 ? remeasureTerm : (watched.term_months ?? null);
      const newRate = remeasureRate > 0 ? remeasureRate : (watched.annual_rate ?? null);
      const { error: vErr } = await supabase.from('lease_versions').insert({
        lease_id: id,
        version: nextVersion,
        effective_date: remeasureDate,
        rou_asset: remeasureRou,
        lease_liability: remeasureLiability,
        annual_rate: newRate,
        term_months: newTerm,
        pl_amount: plDr,
        reason: remeasureReason,
        je_id: je.id,
      });
      if (vErr) throw vErr;

      // Update the lease so the schedule re-amortizes on the new liability + terms
      await supabase.from('leases').update({
        principal: remeasureLiability,
        annual_rate: newRate ?? watched.annual_rate,
        term_months: newTerm ?? watched.term_months,
        status: 'Modified',
      }).eq('id', id);

      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-list'] });
      qc.invalidateQueries({ queryKey: ['lease', id] });
      qc.invalidateQueries({ queryKey: ['lease-versions', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setShowRemeasure(false);
      setValue('status', 'Modified', { shouldDirty: false });
      toast.success(`✓ Re-measurement + JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── HP Journal Entries: Day 1 (Inception) + per-period payment ──
  const { data: day1JE = null } = useQuery({
    queryKey: ['lease-day1-je', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries').select('id, je_number, status, is_reversal')
        .eq('source_type', 'LEASE_DAY1').eq('source_id', id!)
        .eq('status', 'Posted').eq('is_reversal', false)
        .limit(1).maybeSingle();
      return data as { id: string; je_number: string } | null;
    },
  });
  const day1Posted = !!day1JE;

  const { data: postedPayPeriods } = useQuery({
    queryKey: ['lease-pay-periods', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries').select('id, je_number, source_period, status, is_reversal')
        .eq('source_type', 'LEASE_PAY').eq('source_id', id!);
      const map = new Map<number, { id: string; je_number: string }>();
      (data ?? []).forEach((d: any) => {
        if (d.source_period != null && d.status === 'Posted' && !d.is_reversal) {
          map.set(d.source_period, { id: d.id, je_number: d.je_number });
        }
      });
      return map;
    },
  });

  // Late Fees — Penalty repayment lines linked to this lease (read-only view)
  const { data: lateFees = [] } = useQuery({
    queryKey: ['lease-late-fees', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('repayment_lines')
        .select('id, amount, description, repayment_id, repayments!inner(id, repayment_no, pay_date, status, je_id, journal_entries(je_number))')
        .eq('facility_id', id!)
        .in('facility_type', ['Lease', 'HP'])
        .eq('category', 'Penalty')
        .eq('repayments.status', 'Posted')
        .order('repayments(pay_date)', { ascending: false });
      return (data ?? []) as any[];
    },
  });

  // Rollover lineage — parent this contract came from + children rolled over to it
  const { data: rolloverLineage } = useQuery({
    queryKey: ['lease-rollover-lineage', id, existing?.rollover_parent_id],
    enabled: !!id,
    queryFn: async () => {
      const parentId = existing?.rollover_parent_id ?? null;
      const [parentRes, childRes] = await Promise.all([
        parentId
          ? supabase.from('leases').select('id, lease_no, contract_date').eq('id', parentId).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('leases').select('id, lease_no, contract_date, start_date').eq('rollover_parent_id', id!),
      ]);
      return {
        parent: (parentRes as any).data as { id: string; lease_no: string; contract_date: string | null } | null,
        children: ((childRes as any).data ?? []) as { id: string; lease_no: string; contract_date: string | null; start_date: string }[],
      };
    },
  });


  const approveLease = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      if (watched.status !== 'Draft') throw new Error('อนุมัติได้เฉพาะสถานะ Draft');
      await supabase.from('leases').update({ status: 'Approved' }).eq('id', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lease', id] });
      setValue('status', 'Approved', { shouldDirty: false });
      toast.success('✓ อนุมัติแล้ว · Status → Approved');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const postDay1JE = useMutation({
    mutationFn: async () => {
      if (!id || !hpSchedule) throw new Error('บันทึกสัญญา + มี schedule ก่อน');
      if (watched.status !== 'Approved') throw new Error('ต้องอนุมัติ (Approved) ก่อน Post Inception JE / Activate');
      if (watched.posting_lease === false) throw new Error('POSTING LEASE ปิดอยู่ — สัญญานี้ไม่ลง GL');
      const autoApprove = watched.jv_auto_approve === true;
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'LEASE_DAY1').eq('source_id', id);
      if (ex && ex.length > 0) throw new Error(`Day 1 JE มีอยู่แล้ว: ${ex[0].je_number}`);
      const principal = r2(watched.principal ?? 0);
      const totalInt = r2(hpSchedule.totalInterest);
      const totalVat = r2(hpSchedule.totalVat);
      const gross = r2(principal + totalInt + totalVat);
      const je = await createJE({
        source_type: 'LEASE_DAY1',
        source_id: id,
        je_date: watched.start_date ?? today,
        description: `HP Inception (Day 1) — ${watched.lease_no ?? ''}`,
        lines: [
          { account_code: HP_GL.asset.code, account_name: HP_GL.asset.name, dr: principal, description: 'Asset / ROU at net cost' },
          ...(totalInt > 0.005 ? [{ account_code: HP_GL.deferredInterest.code, account_name: HP_GL.deferredInterest.name, dr: totalInt, description: 'Deferred interest (unearned)' }] : []),
          ...(totalVat > 0.005 ? [{ account_code: HP_GL.undueVat.code, account_name: HP_GL.undueVat.name, dr: totalVat, description: 'Undue input VAT (full term)' }] : []),
          { account_code: HP_GL.leaseLiabilityLT.code, account_name: HP_GL.leaseLiabilityLT.name, cr: gross, description: 'Gross HP / lease liability' },
        ],
      });
      if (autoApprove) await postJE(je.id, 'user');
      await supabase.from('leases').update({ status: 'Active' }).eq('id', id);
      return autoApprove ? je.je_number : `${je.je_number} (Draft — รออนุมัติ)`;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-day1-posted', id] });
      qc.invalidateQueries({ queryKey: ['lease', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setValue('status', 'Active', { shouldDirty: false });
      toast.success(`✓ Day 1 JE ${jeNo} · Status → Active`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const postPeriodJE = useMutation({
    mutationFn: async (row: NonNullable<typeof hpSchedule>['rows'][number]) => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      if (watched.posting_lease === false) throw new Error('POSTING LEASE ปิดอยู่ — สัญญานี้ไม่ลง GL');
      const autoApprove = watched.jv_auto_approve === true;
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'LEASE_PAY').eq('source_id', id).eq('source_period', row.period);
      if (ex && ex.length > 0) throw new Error(`งวด ${row.period} มี JE แล้ว: ${ex[0].je_number}`);
      const prin = r2(row.principal);
      const intr = r2(row.interest);
      const vat = r2(row.vat);
      const incVat = r2(row.totalIncVat);
      const je = await createJE({
        source_type: 'LEASE_PAY',
        source_id: id,
        source_period: row.period,
        je_date: row.endDate,
        description: `HP Payment งวด ${row.period} — ${watched.lease_no}`,
        lines: [
          { account_code: HP_GL.currLeaseLiability.code, account_name: HP_GL.currLeaseLiability.name, dr: prin, description: 'Principal portion' },
          ...(intr > 0.005 ? [{ account_code: HP_GL.interestExpense.code, account_name: HP_GL.interestExpense.name, dr: intr, description: 'Interest expense (recognized)' }] : []),
          ...(vat > 0.005 ? [{ account_code: HP_GL.undueVat.code, account_name: HP_GL.undueVat.name, dr: vat, description: 'VAT portion' }] : []),
          ...(intr > 0.005 ? [{ account_code: HP_GL.currDeferredInterest.code, account_name: HP_GL.currDeferredInterest.name, dr: intr, description: 'Reclass deferred → recognized' }] : []),
          { account_code: HP_GL.apLeasing.code, account_name: HP_GL.apLeasing.name, cr: incVat, description: 'Payable to leasing co. (inc VAT)' },
          ...(intr > 0.005 ? [{ account_code: HP_GL.deferredInterest.code, account_name: HP_GL.deferredInterest.name, cr: intr, description: 'Release deferred interest' }] : []),
        ],
      });
      if (autoApprove) await postJE(je.id, 'user');
      return autoApprove ? je.je_number : `${je.je_number} (Draft)`;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-pay-periods', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ HP Payment JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── ROU Asset depreciation (straight-line)
  // ROU initial = net cost / principal; useful life falls back to lease term.
  const rouUsefulLife = (watched.rou_useful_life && watched.rou_useful_life > 0)
    ? watched.rou_useful_life
    : (watched.term_months ?? 0);
  const rouDepr = useMemo(() => buildRouDepreciation({
    rouInitial: watched.principal ?? 0,
    usefulLifeMonths: rouUsefulLife,
    startDate: watched.start_date ?? today,
    payEom: watched.pay_eom,
  }), [watched.principal, rouUsefulLife, watched.start_date, watched.pay_eom, today]);

  // Posted depreciation periods (idempotency for per-period Post JE).
  const { data: postedDeprPeriods } = useQuery({
    queryKey: ['lease-depr-periods', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries').select('id, je_number, source_period, status, is_reversal')
        .eq('source_type', 'LEASE_DEPR').eq('source_id', id!);
      const map = new Map<number, { id: string; je_number: string }>();
      (data ?? []).forEach((d: any) => {
        if (d.source_period != null && d.status === 'Posted' && !d.is_reversal) {
          map.set(d.source_period, { id: d.id, je_number: d.je_number });
        }
      });
      return map;
    },
  });

  // Asset Transfer history.
  const { data: assetTransfers = [] } = useQuery({
    queryKey: ['lease-asset-transfers', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('lease_asset_transfers').select('*')
        .eq('lease_id', id!).order('transfer_date', { ascending: true });
      return (data ?? []) as any[];
    },
  });

  // Post one period of ROU depreciation: Dr Depreciation Expense / Cr Accum Dep – ROU.
  const postDeprJE = useMutation({
    mutationFn: async (row: typeof rouDepr.rows[number]) => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      if (watched.posting_lease === false) throw new Error('POSTING LEASE ปิดอยู่ — ไม่ลง GL');
      const autoApprove = watched.jv_auto_approve === true;
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'LEASE_DEPR').eq('source_id', id).eq('source_period', row.period);
      if (ex && ex.length > 0) throw new Error(`ค่าเสื่อมงวด ${row.period} มี JE แล้ว: ${ex[0].je_number}`);
      const dep = r2(row.depreciation);
      const je = await createJE({
        source_type: 'LEASE_DEPR',
        source_id: id,
        source_period: row.period,
        je_date: row.date,
        description: `ROU Depreciation งวด ${row.period} — ${watched.lease_no}`,
        lines: [
          { account_code: HP_GL.depreciationExpense.code, account_name: HP_GL.depreciationExpense.name, dr: dep, description: 'Straight-line ROU depreciation' },
          { account_code: HP_GL.accumDepRou.code, account_name: HP_GL.accumDepRou.name, cr: dep, description: 'Accumulated depreciation — ROU' },
        ],
      });
      if (autoApprove) await postJE(je.id, 'user');
      return autoApprove ? je.je_number : `${je.je_number} (Draft)`;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-depr-periods', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Depreciation JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Asset Transfer — post Dr <to> / Cr <from> at NBV + log the event.
  const assetTransfer = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      if (watched.posting_lease === false) throw new Error('POSTING LEASE ปิดอยู่ — ไม่ลง GL');
      const sc = ASSET_TRANSFERS.find((s) => s.key === transferKey)!;
      const amt = r2(transferAmount);
      if (amt <= 0) throw new Error('กรอกมูลค่าโอน (NBV) มากกว่า 0');
      const drGl = (HP_GL as any)[sc.drGl];
      const crGl = (HP_GL as any)[sc.crGl];
      const autoApprove = watched.jv_auto_approve === true;
      const je = await createJE({
        source_type: 'LEASE_TRANSFER',
        source_id: id,
        je_date: transferDate,
        description: `Asset Transfer ${sc.from} → ${sc.to} — ${watched.lease_no}`,
        remark: `${sc.when}${transferNote ? ` · ${transferNote}` : ''}`,
        lines: [
          { account_code: drGl.code, account_name: drGl.name, dr: amt, description: `Transfer in — ${sc.to}` },
          { account_code: crGl.code, account_name: crGl.name, cr: amt, description: `Transfer out — ${sc.from}` },
        ],
      });
      if (autoApprove) await postJE(je.id, 'user');
      const { error: tErr } = await supabase.from('lease_asset_transfers').insert({
        lease_id: id,
        transfer_date: transferDate,
        scenario: sc.key,
        from_type: sc.from,
        to_type: sc.to,
        amount: amt,
        je_id: je.id,
        note: transferNote || null,
        created_by: userLabel,
      });
      if (tErr) throw tErr;
      return autoApprove ? je.je_number : `${je.je_number} (Draft)`;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-asset-transfers', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setShowTransfer(false);
      toast.success(`✓ Asset Transfer JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const isHP = watched.mode === 'hp';
  const isLeaseOther = watched.mode === 'other';

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(baseRoute)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {pageMode === 'new' ? 'New Lease' : existing?.lease_no ?? 'Loading...'}
          </h1>
          <p className="text-muted text-sm flex items-center gap-2">
            {isHP ? 'Hire Purchase (HP) — เช่าซื้อ' : 'สัญญาเช่า (Leasing)'}
            {isLeaseOther && (
              <Badge variant="brand">{watched.use_bank_loan ? 'Bank-Credit Lease' : 'IFRS 16 — Property'}</Badge>
            )}
            <Badge variant={watched.status === 'Active' ? 'success' : watched.status === 'Approved' ? 'brand' : watched.status === 'Draft' ? 'default' : 'warn'}>{watched.status}</Badge>
            {watched.inactive && <Badge variant="danger">INACTIVE</Badge>}
            {watched.posting_lease === false && <Badge variant="warn">No GL Posting</Badge>}
          </p>
        </div>
        {id && watched.status === 'Draft' && (
          <Button
            variant="primary"
            disabled={!can(menuKey, 'approve') || isDirty || approveLease.isPending}
            title={!can(menuKey, 'approve') ? 'ต้องมีสิทธิ์ Approve' : isDirty ? 'บันทึก (Save) ก่อนอนุมัติ' : 'อนุมัติสัญญา (Draft → Approved)'}
            onClick={() => approveLease.mutate()}
          >
            ✓ Approve
          </Button>
        )}
        {isHP && (
          <Button
            variant="outline"
            disabled={!id || watched.status === 'Closed' || !can(menuKey, 'approve')}
            title={!id ? 'Save ก่อน' : watched.status === 'Closed' ? 'สัญญาปิดแล้ว' : !can(menuKey, 'approve') ? 'ต้องมีสิทธิ์ Approve' : 'ปิดสัญญาก่อนกำหนด (Rebate)'}
            onClick={() => { setCloseDate(today); setShowRebate(true); }}
          >
            🔚 Close Early (Rebate)
          </Button>
        )}
        {isHP && (
          <Button
            variant="outline"
            disabled={!id || watched.status !== 'Active' || (watched.balloon_amount ?? 0) <= 0 || !can(menuKey, 'approve')}
            title={
              !id ? 'Save ก่อน'
                : !can(menuKey, 'approve') ? 'ต้องมีสิทธิ์ Approve'
                  : watched.status !== 'Active' ? 'Roll Over ทำได้เฉพาะสัญญา Active'
                    : (watched.balloon_amount ?? 0) <= 0 ? 'สัญญานี้ไม่มี Balloon'
                      : 'Roll Over (Balloon → สัญญาใหม่)'
            }
            onClick={() => { setRolloverDate(today); setRolloverTerm(watched.term_months ?? 12); setRolloverRate(watched.annual_rate ?? 0); setShowRollover(true); }}
          >
            🔁 Roll Over
          </Button>
        )}
        {isLeaseOther && (
          <Button
            variant="outline"
            disabled={!id || watched.status === 'Closed' || !can(menuKey, 'approve')}
            title={!id ? 'Save ก่อน' : watched.status === 'Closed' ? 'สัญญาปิดแล้ว' : !can(menuKey, 'approve') ? 'ต้องมีสิทธิ์ Approve' : 'Re-measurement — กรอกผลจาก Excel'}
            onClick={() => {
              setRemeasureDate(today);
              setRemeasureRou(r2(oldRou));
              setRemeasureLiability(r2(oldLiability));
              setRemeasureTerm(watched.term_months ?? 0);
              setRemeasureRate(watched.annual_rate ?? 0);
              setShowRemeasure(true);
            }}
          >
            📐 Re-measurement
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!id || !can(menuKey, 'approve')}
          title={!id ? 'Save ก่อน' : !can(menuKey, 'approve') ? 'ต้องมีสิทธิ์ Approve' : 'โอนเปลี่ยนประเภทสินทรัพย์ (ROU → PPE / IP / รอขาย / OL)'}
          onClick={() => {
            setTransferKey('ROU_PPE');
            setTransferDate(today);
            // Default to current NBV = ROU initial − (posted depreciation periods × monthly).
            const posted = postedDeprPeriods?.size ?? 0;
            const nbv = Math.max(0, (watched.principal ?? 0) - posted * rouDepr.monthlyDepreciation);
            setTransferAmount(r2(nbv));
            setTransferNote('');
            setShowTransfer(true);
          }}
        >
          📦 Asset Transfer
        </Button>
        <Button variant="primary" disabled={!isDirty || save.isPending || !can(menuKey, 'edit')} title={!can(menuKey, 'edit') ? 'ไม่มีสิทธิ์แก้ไขสัญญาเช่า' : ''} onClick={handleSubmit((d) => save.mutate(d))}>
          <Save className="w-4 h-4" /> {save.isPending ? 'กำลังบันทึก...' : 'Save'}
        </Button>
      </div>

      <AuditFooter createdBy={(existing as any)?.created_by} createdAt={(existing as any)?.created_at} updatedBy={(existing as any)?.updated_by} updatedAt={(existing as any)?.updated_at} />

      <div className="space-y-0">
        {/* ── Primary Information ── */}
        <Section title="Primary Information">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel tipKey="LEASE COMPANY NAME">
                {isLeaseOther && !watched.use_bank_loan ? 'LESSOR (ผู้ให้เช่า)' : 'FINANCE INSTITUTION'}
              </FieldLabel>
              {isLeaseOther && !watched.use_bank_loan ? (
                <Input {...register('vendor')} placeholder="บริษัท เอบีซี พร็อพเพอร์ตี้ จำกัด" />
              ) : (
                <Select {...register('vendor')}>
                  <option value="">— เลือกสถาบันการเงิน —</option>
                  {FINANCE_INSTITUTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                  {watched.vendor && !(FINANCE_INSTITUTIONS as readonly string[]).includes(watched.vendor) && (
                    <option value={watched.vendor}>{watched.vendor}</option>
                  )}
                </Select>
              )}
              {(isHP || watched.use_bank_loan) && (
                <p className="text-xs text-muted mt-0.5 italic">ค่าเริ่มต้นดึงจาก Credit Agreement (MA → CA) — แก้ได้</p>
              )}
            </div>
            <div>
              <FieldLabel>LEASE ID</FieldLabel>
              <Input readOnly value={id ?? 'auto (สร้างเมื่อ Save)'} className="bg-gray-50 text-muted" />
            </div>
            <div>
              <FieldLabel>LEASE NAME *</FieldLabel>
              <Input {...register('lease_no')} placeholder="MGC-LSE-2026-001" />
              {errors.lease_no && <p className="text-xs text-danger mt-1">{errors.lease_no.message}</p>}
            </div>
            <div>
              <FieldLabel>MODE *</FieldLabel>
              <input type="hidden" {...register('mode')} />
              <Input
                readOnly
                value={
                  isHP
                    ? 'HP Motor — เช่าซื้อรถ'
                    : watched.use_bank_loan
                      ? 'Lease — Bank-Credit (ใช้สินเชื่อธนาคาร)'
                      : 'Lease IFRS 16 — Property (AP + WHT)'
                }
                className="bg-gray-50 text-muted"
              />
              <p className="text-xs text-muted mt-0.5 italic">
                {isHP ? 'กำหนดจากเมนู HP Motor' : 'Lease Other — แบบย่อยปรับตามช่อง “ใช้สินเชื่อธนาคาร” ด้านล่าง'}
              </p>
            </div>
            <div>
              <FieldLabel>STATUS *</FieldLabel>
              <Select {...register('status')}>
                <option>Draft</option>
                <option>Approved</option>
                <option>Active</option>
                <option>Closed</option>
                <option>Modified</option>
                {leaseMode === 'hp' && <option>Roll Over</option>}
              </Select>
            </div>
            <div>
              <FieldLabel>ASSET TYPE</FieldLabel>
              <Select {...register('asset_type')}>
                <option>ยานพาหนะ</option>
                <option>อุปกรณ์</option>
                <option>อาคาร / ที่ดิน</option>
                <option>สำนักงาน</option>
              </Select>
            </div>
            <div>
              <FieldLabel>ASSET NAME *</FieldLabel>
              <Input {...register('asset_name')} placeholder={isHP ? 'BMW 320i 2026' : 'อาคารสำนักงาน ชั้น 10 / ที่ดินโฉนด 12345'} />
              {errors.asset_name && <p className="text-xs text-danger mt-1">{errors.asset_name.message}</p>}
            </div>
            <div>
              <FieldLabel>CREDIT AGREEMENT NAME</FieldLabel>
              <Select {...register('ca_id')}>
                <option value="">— เลือก CA —</option>
                {caOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.ca_name}{c.contract_number ? ` (${c.contract_number})` : ''}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>CONTRACT NUMBER *</FieldLabel>
              <Input {...register('contract_number')} placeholder="LSE-2026-001" />
            </div>
            <div>
              <FieldLabel>CONTRACT DATE *</FieldLabel>
              <Input type="date" {...register('contract_date')} />
            </div>
            <div>
              <FieldLabel>LEASE CLASSIFICATION *</FieldLabel>
              <Select {...register('classification')}>
                <option value="Finance">Finance Lease (เช่าซื้อ/การเงิน)</option>
                <option value="Operating">Operating Lease (เช่าดำเนินงาน)</option>
              </Select>
            </div>
            <div>
              <FieldLabel>PAYMENT FREQUENCY *</FieldLabel>
              <Select {...register('payment_frequency')}>
                <option>Monthly</option>
                <option>Quarterly</option>
                <option>Yearly</option>
              </Select>
            </div>
            <div>
              <FieldLabel>CONTRACT INTEREST RATE (%)</FieldLabel>
              <NumInput value={watched.annual_rate ?? 0} onChange={(v) => setValue('annual_rate', v, { shouldDirty: true })} step="0.01" />
              <p className="text-xs text-muted mt-0.5 italic">Discount Rate auto-fetch (BBL 4.95% + SCB 4.35% = 4.65%)</p>
            </div>
            <div className="md:col-span-3 flex flex-wrap gap-5 pt-1">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('posting_lease')} className="rounded" /> POSTING LEASE<CbTip k="POSTING LEASE" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('inactive')} className="rounded" /> INACTIVE<CbTip k="INACTIVE" /></label>
            </div>

            {isHP && (
              <>
                <div>
                  <FieldLabel>VEHICLE PRICE *</FieldLabel>
                  <NumInput value={watched.vehicle_price ?? 0} onChange={(v) => setValue('vehicle_price', v, { shouldDirty: true })} step="0.01" />
                </div>
                <div>
                  <FieldLabel>DOWN PAYMENT</FieldLabel>
                  <NumInput value={watched.down_payment ?? 0} onChange={(v) => setValue('down_payment', v, { shouldDirty: true })} step="0.01" />
                </div>
                <div>
                  <FieldLabel tipKey="NET VEHICLE COST">NET VEHICLE COST [computed]</FieldLabel>
                  <Input readOnly value={fmtMoney((watched.vehicle_price ?? 0) - (watched.down_payment ?? 0))} className="bg-gray-50" />
                </div>
              </>
            )}

            {isLeaseOther && (
              <>
                <div>
                  <FieldLabel>UPFRONT PAYMENT</FieldLabel>
                  <NumInput value={watched.upfront_payment ?? 0} onChange={(v) => setValue('upfront_payment', v, { shouldDirty: true })} step="0.01" />
                </div>
                <div>
                  <FieldLabel>GRACE PERIOD (MONTHS)</FieldLabel>
                  <NumInput value={watched.grace_periods ?? 0} onChange={(v) => setValue('grace_periods', v, { shouldDirty: true })} />
                </div>
                <div>
                  <FieldLabel>PREPAID PERIODS</FieldLabel>
                  <NumInput value={watched.prepaid_periods ?? 0} onChange={(v) => setValue('prepaid_periods', v, { shouldDirty: true })} />
                </div>
                <div className="md:col-span-3 bg-amber-50 border border-amber-200 rounded p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" {...register('use_bank_loan')} className="rounded" />
                    ใช้สินเชื่อจากธนาคาร (Bank Loan)<CbTip k="USE BANK LOAN" />
                  </label>
                  <p className="text-xs text-muted mt-1">
                    {watched.use_bank_loan ? '📥 Bank Statement direct cut (Case A)' : '🔄 AP Module + WHT 3% — Pure IFRS 16 (Case B)'}
                  </p>
                </div>
              </>
            )}

            <div className="md:col-span-3">
              <FieldLabel>NOTE</FieldLabel>
              <textarea className="input min-h-[70px]" {...register('remark')} />
            </div>
          </div>
        </Section>

        {/* ── Schedule Information ── */}
        <Section title="Schedule Information">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel>START DATE *</FieldLabel>
              <Input type="date" {...register('start_date')} />
            </div>
            <div>
              <FieldLabel>PAYMENT START DATE *</FieldLabel>
              <Input type="date" {...register('payment_start_date')} />
            </div>
            <div>
              <FieldLabel tipKey="INSTALLMENT END DATE">END DATE [computed]</FieldLabel>
              <Input type="date" {...register('end_date')} className="bg-gray-50" />
              <p className="text-xs text-muted mt-0.5 italic">= Payment Start + Term</p>
            </div>
            <div>
              <FieldLabel>LEASE TERM (MONTHS) *</FieldLabel>
              <NumInput value={watched.term_months ?? 0} onChange={(v) => setValue('term_months', v, { shouldDirty: true })} />
              <div className="text-xs mt-1">
                {(watched.term_months ?? 0) >= 12 ? <Badge variant="brand">Long-term</Badge> : <Badge variant="warn">Short-term</Badge>}
              </div>
            </div>
            <div className="md:col-span-2">
              <FieldLabel>PAYMENT TYPE *</FieldLabel>
              <Select {...register('payment_type')}>
                <option>Fix Installment / Fix Installment & Step payment</option>
                <option>Fix Installment (Balloon) / Fix Installment & Step payment (Balloon)</option>
                <option>Fix Principal / Fix Principal & Step payment</option>
                <option>Fix Principal (Balloon) / Fix Principal & Step payment (Balloon)</option>
                <option>Grace Period and Fix Installment</option>
                <option>Grace Period and Fix Principal</option>
                <option>ชำระต้นงวด (Beginning of Period)</option>
                <option>ชำระปลายงวด (End of Period)</option>
              </Select>
            </div>
            <div>
              <FieldLabel>PRINCIPAL AMOUNT *</FieldLabel>
              <NumInput
                step="0.01"
                value={watched.principal ?? 0}
                onChange={(v) => setValue('principal', v, { shouldDirty: true })}
                className={isHP ? 'bg-gray-50' : ''}
                readOnly={isHP}
              />
              {isHP && <p className="text-xs text-muted mt-1">= Net Vehicle Cost</p>}
            </div>
            <div>
              <FieldLabel tipKey="EFFECTIVE INTEREST RATE PER YEAR">EFFECTIVE INTEREST RATE / YEAR (%)</FieldLabel>
              <Input readOnly value={(watched.annual_rate ?? 0).toFixed(4) + '%'} className="bg-gray-50" />
              <p className="text-xs text-muted mt-1">= Contract Interest Rate</p>
            </div>
            <div>
              <FieldLabel tipKey="EFFECTIVE INTEREST RATE PER MONTH">EFFECTIVE INTEREST RATE / MONTH</FieldLabel>
              <Input readOnly value={((watched.annual_rate ?? 0) / 12).toFixed(4) + '%'} className="bg-gray-50" />
            </div>
            <div>
              <FieldLabel tipKey="AMOUNT PER MONTH">AMOUNT PER MONTH (est.)</FieldLabel>
              <Input readOnly value={fmtMoney(monthlyEst)} className="bg-gray-50" />
            </div>
            <div>
              <FieldLabel>BALLOON PAYMENT</FieldLabel>
              <NumInput value={watched.balloon_amount ?? 0} onChange={(v) => setValue('balloon_amount', v, { shouldDirty: true })} step="0.01" />
            </div>
            <div>
              <FieldLabel>BALLOON OPTION</FieldLabel>
              <Select {...register('balloon_pattern')}>
                <option value="with-last">พร้อมงวดสุดท้าย</option>
                <option value="after-last">หลังงวดสุดท้าย</option>
                <option value="before-last">ก่อนงวดสุดท้าย</option>
              </Select>
            </div>
            {isHP && (
              <div>
                <FieldLabel tipKey="VAT">VAT (%)</FieldLabel>
                <NumInput value={watched.vat_rate ?? 0} onChange={(v) => setValue('vat_rate', v, { shouldDirty: true })} step="0.01" />
                <p className="text-xs text-muted mt-1">VAT บนค่างวด (เงินต้น+ดอก)</p>
              </div>
            )}
            {isLeaseOther && (
              <div>
                <FieldLabel>DISCOUNT RATE (%)</FieldLabel>
                <NumInput value={watched.discount_rate ?? 0} onChange={(v) => setValue('discount_rate', v, { shouldDirty: true })} step="0.01" />
              </div>
            )}
            <div>
              <FieldLabel>ROU USEFUL LIFE (เดือน)</FieldLabel>
              <NumInput value={watched.rou_useful_life ?? 0} onChange={(v) => setValue('rou_useful_life', v, { shouldDirty: true })} placeholder={`auto = Term (${watched.term_months ?? 0})`} />
              <p className="text-xs text-muted mt-0.5 italic">อายุการใช้งาน ROU เพื่อตัดค่าเสื่อมเส้นตรง — เว้นว่าง = เท่าอายุสัญญา</p>
            </div>
            <div className="md:col-span-3 flex flex-wrap gap-5 pt-1 border-t border-line mt-1">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('calc_interest_end')} className="rounded" /> CALCULATE INTEREST AT THE END<CbTip k="CALCULATE INTEREST AT THE END" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('include_balloon_installment')} className="rounded" /> INCLUDE BALLOON PAYMENT IN INSTALLMENT<CbTip k="INCLUDE BALLOON PAYMENT IN INSTALLMENT" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('pay_eom')} className="rounded" /> PAY AT END OF MONTHS<CbTip k="PAY AT END OF MONTHS" /></label>
            </div>
          </div>

          {/* Live calc strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Monthly</div><div className="text-right tabular-nums font-semibold">{fmtMoney(monthlyEst)}</div></div>
            <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">งวด</div><div className="text-right tabular-nums font-semibold">{isHP && hpSchedule ? hpSchedule.rows.length : schedule.length}</div></div>
            <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Total Payment (ex VAT)</div><div className="text-right tabular-nums font-semibold">{fmtMoney(isHP && hpSchedule ? hpSchedule.totalPayment : totalPayment)}</div></div>
            {isHP && hpSchedule ? (
              <>
                <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Total VAT ({watched.vat_rate ?? 7}%)</div><div className="text-right tabular-nums font-semibold text-purple-700">{fmtMoney(hpSchedule.totalVat)}</div></div>
                <div className="rounded border border-brand bg-blue-50 p-2.5"><div className="text-[10px] text-brand uppercase font-semibold">Total Inc. VAT</div><div className="text-right tabular-nums font-bold text-brand">{fmtMoney(hpSchedule.totalIncVat)}</div></div>
              </>
            ) : (
              <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Total Interest</div><div className="text-right tabular-nums font-semibold">{fmtMoney(totalInterest)}</div></div>
            )}
          </div>
        </Section>

        {/* ── Tabs ── */}
        <Tabs
          tabs={[
            {
              key: 'accounting',
              label: 'Accounting',
              render: () => (
                <div className="space-y-3">
                  <AcctCards accounts={acctCards} onChange={setAcctCards} />
                  <p className="text-[11px] text-muted">
                    {isHP ? (
                      <>💡 ค่าเริ่มต้น JE ใช้ผัง Deferred Interest model (HP): Asset {HP_GL.asset.code} · Deferred Interest {HP_GL.deferredInterest.code} · Undue VAT {HP_GL.undueVat.code} · Lease Liability {HP_GL.leaseLiabilityLT.code}/{HP_GL.currLeaseLiability.code} · Interest Exp {HP_GL.interestExpense.code} · AP {HP_GL.apLeasing.code}</>
                    ) : (
                      <>💡 ค่าเริ่มต้น JE ใช้ผัง IFRS 16 (Lease Other): ROU Asset {HP_GL.asset.code} · Lease Liability {HP_GL.leaseLiabilityLT.code}/{HP_GL.currLeaseLiability.code} · Interest Exp {HP_GL.interestExpense.code} · Depreciation {HP_GL.depreciationExpense.code}/{HP_GL.accumDepRou.code} · AP {HP_GL.apLeasing.code} (ไม่มี Deferred Interest / VAT)</>
                    )}
                  </p>
                </div>
              ),
            },
            {
              key: 'assets',
              label: 'ROU Asset / ค่าเสื่อม',
              render: () => (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">ROU Asset (ตั้งต้น)</div><div className="text-right tabular-nums font-semibold">{fmtMoney(watched.principal ?? 0)}</div></div>
                    <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Useful Life (เดือน)</div><div className="text-right tabular-nums font-semibold">{rouUsefulLife}{(!watched.rou_useful_life || watched.rou_useful_life <= 0) && <span className="text-[10px] text-muted"> (= term)</span>}</div></div>
                    <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Monthly Depreciation (ค่าเสื่อม/เดือน · เส้นตรง)</div><div className="text-right tabular-nums font-semibold">{fmtMoney(rouDepr.monthlyDepreciation)}</div></div>
                    <div className="rounded border border-brand bg-blue-50 p-2.5"><div className="text-[10px] text-brand uppercase font-semibold">Transfers (โอนแล้ว)</div><div className="text-right tabular-nums font-bold text-brand">{assetTransfers.length}</div></div>
                  </div>

                  <div className="space-y-1">
                    <div><TipLabel tipKey="ASSET NAME" className="text-muted">Asset Name:</TipLabel> <b>{watched.asset_name || '—'}</b> · <span className="text-muted">{watched.asset_type}</span></div>
                    <p className="text-[11px] text-muted italic">ROU ตัดค่าเสื่อมแบบเส้นตรงเริ่มตั้งแต่งวดแรก (แม้อยู่ใน Grace) — IFRS 16</p>
                  </div>

                  {rouDepr.rows.length === 0 ? (
                    <div className="text-muted text-sm p-3">กรอก Principal / Term / Start Date เพื่อแสดงตารางค่าเสื่อม</div>
                  ) : (
                    <div className="overflow-x-auto max-h-[420px]">
                      <table className="table-base text-xs">
                        <thead className="sticky top-0 z-10 bg-white">
                          <tr>
                            <ThTip>Period (งวด)</ThTip>
                            <ThTip>Date (วันที่)</ThTip>
                            <ThTip align="right">NBV Begin (ต้นงวด)</ThTip>
                            <ThTip align="right">Depreciation (ค่าเสื่อม)</ThTip>
                            <ThTip align="right">Accum. (สะสม)</ThTip>
                            <ThTip align="right">NBV End (ปลายงวด)</ThTip>
                            {id && <ThTip>JE</ThTip>}
                          </tr>
                        </thead>
                        <tbody>
                          {rouDepr.rows.map((r) => {
                            const doneJE = postedDeprPeriods?.get(r.period);
                            const done = !!doneJE;
                            return (
                              <tr key={r.period}>
                                <td className="text-center">{r.period}</td>
                                <td>{fmtDate(r.date)}</td>
                                <td className="text-right tabular-nums">{fmtMoney(r.beginNbv)}</td>
                                <td className="text-right tabular-nums">{fmtMoney(r.depreciation)}</td>
                                <td className="text-right tabular-nums text-muted">{fmtMoney(r.accumDepreciation)}</td>
                                <td className="text-right tabular-nums font-medium">{fmtMoney(r.endNbv)}</td>
                                {id && (
                                  <td className="text-center">
                                    {done && doneJE ? (
                                      <a
                                        href={`/je/${doneJE.id}`}
                                        className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 hover:underline"
                                        title={`เปิดหน้า ${doneJE.je_number}`}
                                      >
                                        ✓ Posted
                                      </a>
                                    ) : (() => {
                                      const isFuture = r.date > today;
                                      const disabledReason = isFuture
                                        ? `ยังไม่ถึงเวลา (รอวันที่ ${fmtDate(r.date)})`
                                        : watched.posting_lease === false
                                          ? 'POSTING LEASE ปิดอยู่'
                                          : !can(menuKey, 'approve')
                                            ? 'ต้องมีสิทธิ์ Approve'
                                            : 'Post ค่าเสื่อมงวดนี้';
                                      return (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          disabled={postDeprJE.isPending || watched.posting_lease === false || !can(menuKey, 'approve') || isFuture}
                                          onClick={() => postDeprJE.mutate(r)}
                                          title={disabledReason}
                                        >
                                          Post JE
                                        </Button>
                                      );
                                    })()}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {assetTransfers.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-muted uppercase mb-1">Asset Transfer History</div>
                      <div className="overflow-x-auto">
                        <table className="table-base text-xs">
                          <thead><tr><ThTip>Date (วันที่)</ThTip><ThTip>From (จาก)</ThTip><ThTip>To (ไป)</ThTip><ThTip align="right">NBV (มูลค่า)</ThTip><ThTip>Note (หมายเหตุ)</ThTip></tr></thead>
                          <tbody>
                            {assetTransfers.map((t) => (
                              <tr key={t.id}>
                                <td>{fmtDate(t.transfer_date)}</td>
                                <td>{t.from_type}</td>
                                <td>{t.to_type}</td>
                                <td className="text-right tabular-nums">{fmtMoney(t.amount)}</td>
                                <td className="text-muted">{t.note ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'onetime',
              label: 'One Time Payments',
              render: () => (
                <div className="space-y-2 text-sm">
                  <p className="text-xs text-muted">รายการจ่ายครั้งเดียว: Down Payment / Upfront / Balloon / Documentation Fee</p>
                  <div className="overflow-x-auto max-w-md">
                    <table className="table-base text-sm"><tbody>
                      <tr><td><TipLabel>Down Payment</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(watched.down_payment ?? 0)}</td></tr>
                      <tr><td><TipLabel>Upfront Payment</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(watched.upfront_payment ?? 0)}</td></tr>
                      <tr><td><TipLabel>Balloon Payment</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(watched.balloon_amount ?? 0)}</td></tr>
                    </tbody></table>
                  </div>
                </div>
              ),
            },
            {
              key: 'sched',
              label: 'Amortization Schedule',
              render: () =>
                isHP ? (
                  !hpSchedule || hpSchedule.rows.length === 0 ? (
                    <div className="text-muted text-sm p-4">กรอก Principal / Term / Start Date เพื่อแสดง schedule</div>
                  ) : (
                    <div>
                      {id && (
                        <div className="flex items-center gap-3 mb-3 p-2.5 rounded border border-line bg-soft text-sm">
                          {day1Posted && day1JE ? (
                            <a
                              href={`/je/${day1JE.id}`}
                              className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 hover:underline"
                              title={`เปิดหน้า ${day1JE.je_number}`}
                            >
                              ✓ Day 1 JE Posted
                            </a>
                          ) : (
                            <>
                              <Button type="button" variant="primary" size="sm" onClick={() => postDay1JE.mutate()} disabled={postDay1JE.isPending || watched.posting_lease === false || watched.status !== 'Approved' || !can(menuKey, 'approve')}>
                                📋 Post Inception JE (Day 1)
                              </Button>
                              <span className="text-xs text-muted">{watched.posting_lease === false ? 'POSTING LEASE ปิดอยู่ — ไม่ลง GL' : watched.status !== 'Approved' ? 'ต้องอนุมัติ (Approved) ก่อน' : 'Dr Asset + Deferred Interest + Undue VAT / Cr Lease Liability → Active'}</span>
                            </>
                          )}
                        </div>
                      )}
                      <div className="overflow-x-auto max-h-[520px]">
                        <table className="table-base text-xs">
                          <thead className="sticky top-0 z-10 bg-white">
                            <tr>
                              <ThTip>#</ThTip>
                              <ThTip>Payment Date</ThTip>
                              <ThTip align="right">Installment</ThTip>
                              <ThTip align="right" tipKey="VAT AMOUNT">VAT</ThTip>
                              <ThTip align="right" tipKey="TOTAL INC. VAT">Total Inc. VAT</ThTip>
                              <ThTip align="right">Interest</ThTip>
                              <ThTip align="right">Principal</ThTip>
                              <ThTip align="right">Principal Balance</ThTip>
                              <ThTip align="right" tipKey="DEFERRED INTEREST BALANCE">Deferred Interest Bal.</ThTip>
                              <ThTip align="right">VAT Balance</ThTip>
                              <ThTip align="right">JE</ThTip>
                            </tr>
                          </thead>
                          <tbody>
                            {hpSchedule.rows.map((r) => (
                              <tr key={r.period} className={r.isBalloon ? 'bg-amber-50 font-bold' : 'hover:bg-gray-50'}>
                                <td className="font-medium">{r.period}</td>
                                <td>{fmtDate(r.endDate)}</td>
                                <td className="text-right tabular-nums font-medium">{fmtMoney(r.installment)}</td>
                                <td className="text-right tabular-nums text-purple-700">{fmtMoney(r.vat)}</td>
                                <td className="text-right tabular-nums font-semibold">{fmtMoney(r.totalIncVat)}</td>
                                <td className="text-right tabular-nums text-amber-700">{fmtMoney(r.interest)}</td>
                                <td className="text-right tabular-nums text-emerald-700">{fmtMoney(r.principal)}</td>
                                <td className="text-right tabular-nums">{fmtMoney(r.endBalance)}</td>
                                <td className="text-right tabular-nums text-muted">{fmtMoney(r.deferredInterestBalance)}</td>
                                <td className="text-right tabular-nums text-muted">{fmtMoney(r.vatBalance)}</td>
                                <td className="text-right whitespace-nowrap">
                                  {id && (() => {
                                    const payJE = postedPayPeriods?.get(r.period);
                                    const isFuture = r.endDate > today;
                                    return payJE ? (
                                      <a
                                        href={`/je/${payJE.id}`}
                                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 hover:underline"
                                        title={`เปิดหน้า ${payJE.je_number}`}
                                      >
                                        ✓ Posted
                                      </a>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => postPeriodJE.mutate(r)}
                                        disabled={postPeriodJE.isPending || !day1Posted || watched.posting_lease === false || viewOnly || isFuture}
                                        className="text-brand hover:underline text-[10px] disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                                        title={
                                          isFuture
                                            ? `ยังไม่ถึงเวลา (รอวันที่ ${fmtDate(r.endDate)})`
                                            : day1Posted ? 'Post HP Payment JE (งวดนี้)' : 'Post Day 1 JE ก่อน'
                                        }
                                      >
                                        📋 Post
                                      </button>
                                    );
                                  })()}
                                </td>
                              </tr>
                            ))}
                            <tr className="bg-soft font-bold border-t-2 border-line">
                              <td colSpan={2} className="text-right">Total</td>
                              <td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalPayment)}</td>
                              <td className="text-right tabular-nums text-purple-700">{fmtMoney(hpSchedule.totalVat)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalIncVat)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalInterest)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalPrincipal)}</td>
                              <td colSpan={4} />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                ) : schedule.length === 0 ? (
                  <div className="text-muted text-sm p-4">กรอก Principal / Term / Start Date เพื่อแสดง schedule</div>
                ) : (
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="table-base">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <ThTip>#</ThTip>
                          <ThTip>Due Date</ThTip>
                          <ThTip align="right">Begin</ThTip>
                          <ThTip align="right">Payment</ThTip>
                          <ThTip align="right">Interest</ThTip>
                          <ThTip align="right">Principal</ThTip>
                          <ThTip align="right">End</ThTip>
                          <ThTip>Note</ThTip>
                        </tr>
                      </thead>
                      <tbody>
                        {schedule.map((r) => (
                          <tr key={r.period} className="hover:bg-gray-50">
                            <td className="font-medium">{r.period}</td>
                            <td>{fmtDate(r.date)}</td>
                            <td className="text-right tabular-nums">{fmtMoney(r.beginBalance)}</td>
                            <td className="text-right tabular-nums font-medium">{fmtMoney(r.payment)}</td>
                            <td className="text-right tabular-nums text-amber-700">{fmtMoney(r.interest)}</td>
                            <td className="text-right tabular-nums text-emerald-700">{fmtMoney(r.principal)}</td>
                            <td className="text-right tabular-nums">{fmtMoney(r.endBalance)}</td>
                            <td>{r.note && <Badge variant="brand">{r.note}</Badge>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ),
            },
            {
              key: 'version',
              label: isHP ? 'Contract History' : 'Lease Version',
              render: () =>
                isHP ? (
                  // ── HP: Contract Change History (Rebate / Roll Over) — no NPV/re-measurement ──
                  <div className="space-y-3 text-sm">
                    <p className="text-xs text-muted">ประวัติการเปลี่ยนแปลงสัญญา — ปิดก่อนกำหนด (Rebate) · Roll Over (Balloon → สัญญาใหม่)</p>
                    <div className="overflow-x-auto">
                      <table className="table-base text-sm">
                        <thead>
                          <tr>
                            <ThTip>Event</ThTip>
                            <ThTip>Date</ThTip>
                            <ThTip>Reference</ThTip>
                            <ThTip>Status</ThTip>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Contract Created</td>
                            <td>{watched.contract_date ? fmtDate(watched.contract_date) : '—'}</td>
                            <td>{watched.lease_no || '—'}</td>
                            <td><Badge variant="brand">Origin</Badge></td>
                          </tr>
                          {rolloverLineage?.parent && (
                            <tr>
                              <td>Rolled Over From</td>
                              <td>{rolloverLineage.parent.contract_date ? fmtDate(rolloverLineage.parent.contract_date) : '—'}</td>
                              <td>
                                <button type="button" className="text-brand hover:underline" onClick={() => navigate(`${baseRoute}/${rolloverLineage.parent!.id}`)}>
                                  {rolloverLineage.parent.lease_no}
                                </button>
                              </td>
                              <td><Badge variant="warn">Parent</Badge></td>
                            </tr>
                          )}
                          {(rolloverLineage?.children ?? []).map((c) => (
                            <tr key={c.id}>
                              <td>Rolled Over To</td>
                              <td>{fmtDate(c.start_date)}</td>
                              <td>
                                <button type="button" className="text-brand hover:underline" onClick={() => navigate(`${baseRoute}/${c.id}`)}>
                                  {c.lease_no}
                                </button>
                              </td>
                              <td><Badge variant="success">Roll Over</Badge></td>
                            </tr>
                          ))}
                          {watched.status === 'Closed' && (
                            <tr>
                              <td>Closed Early (Rebate)</td>
                              <td>—</td>
                              <td>ดูรายละเอียดที่ JE (LEASE_REBATE)</td>
                              <td><Badge variant="danger">Closed</Badge></td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-muted">HP ใช้ตารางผ่อนแบบ deferred interest — ไม่มีการ Re-measurement</p>
                  </div>
                ) : (
                  // ── Lease Other (TFRS 16): Re-measurement / version history ──
                  <div className="space-y-2 text-sm">
                    <p className="text-xs text-muted">ประวัติการแก้ไขสัญญา (Modification / Re-measurement)</p>
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ การคำนวณ NPV / Re-measurement ของ ROU ทำใน Excel (ระบบไม่คำนวณ NPV) — กรอกผลลัพธ์กลับเข้ามาผ่านปุ่ม Re-measurement บน header · ตารางนี้เก็บประวัติเวอร์ชัน</p>
                    <div className="overflow-x-auto">
                      <table className="table-base text-sm">
                        <thead><tr><ThTip>Version</ThTip><ThTip tipKey="EFFECTIVE DATE">Effective</ThTip><ThTip align="right" tipKey="ASSET / ROU">ROU Asset</ThTip><ThTip align="right" tipKey="LEASE LIABILITY (GROSS)">Lease Liability</ThTip><ThTip align="right">Rate</ThTip><ThTip align="right">Term</ThTip><ThTip align="right" tipKey="GAIN/(LOSS)">Gain/(Loss)</ThTip><ThTip>Status</ThTip></tr></thead>
                        <tbody>
                          <tr>
                            <td>v1</td>
                            <td>{watched.contract_date ? fmtDate(watched.contract_date) : '—'}</td>
                            <td className="text-right tabular-nums">{fmtMoney(watched.principal ?? 0)}</td>
                            <td className="text-right tabular-nums">{fmtMoney(watched.principal ?? 0)}</td>
                            <td className="text-right">{(watched.annual_rate ?? 0).toFixed(4)}%</td>
                            <td className="text-right">{watched.term_months}</td>
                            <td className="text-right">—</td>
                            <td>{leaseVersions.length === 0 && <Badge variant="success">Current</Badge>}{leaseVersions.length > 0 && <Badge variant="default">Origin</Badge>}</td>
                          </tr>
                          {leaseVersions.map((v, i) => (
                            <tr key={v.id}>
                              <td>v{v.version}</td>
                              <td>{fmtDate(v.effective_date)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(v.rou_asset)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(v.lease_liability)}</td>
                              <td className="text-right">{(v.annual_rate ?? 0).toFixed(4)}%</td>
                              <td className="text-right">{v.term_months ?? '—'}</td>
                              <td className={`text-right tabular-nums ${v.pl_amount > 0 ? 'text-danger' : v.pl_amount < 0 ? 'text-emerald-700' : ''}`}>
                                {v.pl_amount === 0 ? '—' : v.pl_amount > 0 ? `(${fmtMoney(v.pl_amount)})` : fmtMoney(-v.pl_amount)}
                              </td>
                              <td>{i === leaseVersions.length - 1 ? <Badge variant="success">Current</Badge> : <Badge variant="default">Superseded</Badge>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ),
            },
            {
              key: 'classification',
              label: 'Classification',
              render: () => {
                const rows = isHP && hpSchedule
                  ? hpSchedule.rows.map((r) => ({ due: r.endDate, principal: r.principal }))
                  : schedule.map((r) => ({ due: r.date, principal: r.principal }));
                const startISO = watched.payment_start_date ?? watched.start_date ?? today;
                const cutoff = new Date(startISO);
                cutoff.setMonth(cutoff.getMonth() + 12);
                const cutoffISO = fmtDateISO(cutoff);
                const total = rows.reduce((s, r) => s + r.principal, 0);
                const current = rows.filter((r) => r.due <= cutoffISO).reduce((s, r) => s + r.principal, 0);
                const nonCurrent = total - current;
                return (
                  <div className="space-y-2 text-sm">
                    <p className="text-xs text-muted">GL Classification — Aging (Current vs Non-current)</p>
                    <div className="overflow-x-auto max-w-md">
                      <table className="table-base text-sm"><tbody>
                        <tr><td><TipLabel>Current Portion (≤ 12 เดือน)</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(current)}</td></tr>
                        <tr><td><TipLabel>Non-current (&gt; 12 เดือน)</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(nonCurrent)}</td></tr>
                        <tr className="font-semibold"><td><TipLabel>Total Principal</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(total)}</td></tr>
                      </tbody></table>
                    </div>
                    <div><span className="text-muted">Lease Classification:</span> <b>{watched.classification}</b></div>
                  </div>
                );
              },
            },
            {
              key: 'latefees',
              label: 'Late Fees',
              render: () => {
                const totalLate = lateFees.reduce((s: number, r: any) => s + (r.amount || 0), 0);
                const quickAddHref = `/tx/repayment/new?facility_type=${watched.mode === 'hp' ? 'HP' : 'Lease'}&facility_id=${id ?? ''}&category=Penalty`;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted italic">
                        ค่าปรับชำระล่าช้า (Late Fee) — บันทึกเป็นหมวด Penalty ผ่านโมดูล Repayment · แท็บนี้แสดงผลแบบ read-only
                      </div>
                      {id && (
                        <a
                          href={quickAddHref}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold bg-brand text-white hover:bg-brand-dark"
                          title="เปิดหน้า Repayment พร้อม pre-fill: facility = สัญญานี้ · category = Penalty"
                        >
                          + Add Late Fee
                        </a>
                      )}
                    </div>
                    {lateFees.length === 0 ? (
                      <div className="bg-soft border border-line rounded p-5 text-center text-muted text-sm">
                        ยังไม่มี Late Fee — กดปุ่ม "+ Add Late Fee" ด้านบนเพื่อเปิดหน้า Repayment พร้อม pre-fill ให้
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="table-base text-sm">
                          <thead>
                            <tr>
                              <ThTip>Pay Date</ThTip>
                              <ThTip>Repayment No.</ThTip>
                              <ThTip align="right">Amount</ThTip>
                              <ThTip>Description</ThTip>
                              <ThTip>JE</ThTip>
                            </tr>
                          </thead>
                          <tbody>
                            {lateFees.map((r: any) => {
                              const rep = r.repayments;
                              const je = rep?.journal_entries;
                              return (
                                <tr key={r.id}>
                                  <td>{rep?.pay_date ? fmtDate(rep.pay_date) : '—'}</td>
                                  <td>
                                    {rep?.id ? (
                                      <a href={`/tx/repayment/${rep.id}`} className="text-brand hover:underline">
                                        {rep.repayment_no ?? rep.id.slice(0, 8)}
                                      </a>
                                    ) : '—'}
                                  </td>
                                  <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
                                  <td className="text-muted">{r.description ?? '—'}</td>
                                  <td>
                                    {rep?.je_id && je?.je_number ? (
                                      <a href={`/je/${rep.je_id}`} className="text-brand hover:underline text-xs">
                                        {je.je_number}
                                      </a>
                                    ) : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                            <tr className="bg-soft font-bold border-t-2 border-line">
                              <td colSpan={2}>Total ({lateFees.length} รายการ)</td>
                              <td className="text-right tabular-nums">{fmtMoney(totalLate)}</td>
                              <td colSpan={2} />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              },
            },
            {
              key: 'gl',
              label: 'GL Impact',
              render: () => (
                <div className="space-y-3 text-sm">
                  <p className="text-xs text-muted">
                    {isHP || watched.classification === 'Finance'
                      ? 'Finance Lease / HP: Day 1 ตั้ง Asset + Deferred Interest + Undue VAT / Cr Lease Liability · รายงวดรับรู้ดอก/VAT + ตัด Deferred Interest'
                      : 'Operating Lease: รายงวด Dr Rental Expense + Undue VAT / Cr AP — Lessor (ไม่ตั้ง Deferred Interest · ROU ตัดเส้นตรง)'}
                  </p>
                  {isHP && hpSchedule && (
                    <div className="overflow-x-auto max-w-2xl">
                      <table className="table-base text-sm">
                        <thead><tr><th>JV-Create Lease (Day 1)</th><ThTip align="right" tipKey="DR">Dr</ThTip><ThTip align="right" tipKey="CR">Cr</ThTip></tr></thead>
                        <tbody>
                          <tr><td><TipLabel tipKey="ASSET / ROU">Asset / ROU</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(watched.principal ?? 0)}</td><td /></tr>
                          <tr><td><TipLabel>Deferred Interest</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalInterest)}</td><td /></tr>
                          <tr><td><TipLabel>Undue Input VAT</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalVat)}</td><td /></tr>
                          <tr className="font-semibold"><td><TipLabel tipKey="LEASE LIABILITY (GROSS)">Lease Liability (gross)</TipLabel></td><td /><td className="text-right tabular-nums">{fmtMoney((watched.principal ?? 0) + hpSchedule.totalInterest + hpSchedule.totalVat)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-xs text-muted">กดปุ่ม Post (Day 1 + รายงวด) ได้ที่แท็บ Amortization Schedule</p>
                </div>
              ),
            },
            {
              key: 'doc',
              label: 'Document',
              render: () => (
                <div className="text-muted text-sm p-1">เอกสารแนบสัญญาเช่า/เช่าซื้อ (สัญญา · ใบกำกับภาษี · เอกสารโอนกรรมสิทธิ์)</div>
              ),
            },
          ]}
        />
      </div>

      {/* ── Close Early (Rebate) Modal
      <Modal
        open={showRebate}
        onClose={() => setShowRebate(false)}
        title={`🔚 Close Early — Rebate · ${watched.lease_no || 'HP'}`}
        size="lg"
        footer={
          <>
            <Button onClick={() => setShowRebate(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => rebateSettle.mutate()} disabled={rebateSettle.isPending || !rebatePreview || !can(menuKey, 'approve')}>
              ✓ Proceed Settlement
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted italic">
            HP/Lease ปิดก่อนกำหนด: ได้ Rebate (ส่วนลด) ไม่ใช่ Prepayment Fee · เงินต้นไม่ลด · ดอกเบี้ย + VAT ลดได้
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>CLOSE DATE</FieldLabel>
              <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel>REASON</FieldLabel>
              <Select value={closeReason} onChange={(e) => setCloseReason(e.target.value)}>
                <option>Customer Request</option>
                <option>Refinance</option>
                <option>Other</option>
              </Select>
            </div>
          </div>
          {rebatePreview && (
            <table className="table-base text-sm">
              <thead>
                <tr>
                  <ThTip>Component</ThTip>
                  <ThTip align="right" tipKey="OUTSTANDING">Outstanding</ThTip>
                  <ThTip align="right">Rebate %</ThTip>
                  <ThTip align="right">Rebate Amount</ThTip>
                  <ThTip align="right">Net Pay</ThTip>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-semibold">เงินต้น (Principal)</td>
                  <td className="text-right tabular-nums">{fmtMoney(rebatePreview.principalOut)}</td>
                  <td className="text-right text-muted">— (no discount)</td>
                  <td className="text-right tabular-nums">0.00</td>
                  <td className="text-right tabular-nums font-semibold">{fmtMoney(rebatePreview.principalOut)}</td>
                </tr>
                <tr>
                  <td className="font-semibold">ดอกเบี้ยที่เหลือ</td>
                  <td className="text-right tabular-nums">{fmtMoney(rebatePreview.interestOut)}</td>
                  <td className="text-right">
                    <input type="number" value={intRebatePct} onChange={(e) => setIntRebatePct(parseFloat(e.target.value) || 0)} className="w-16 text-right border border-line rounded px-1 py-0.5" />%
                  </td>
                  <td className="text-right tabular-nums text-danger">-{fmtMoney(rebatePreview.intRebate)}</td>
                  <td className="text-right tabular-nums font-semibold">{fmtMoney(rebatePreview.intNet)}</td>
                </tr>
                <tr>
                  <td className="font-semibold">VAT ที่เหลือ</td>
                  <td className="text-right tabular-nums">{fmtMoney(rebatePreview.vatOut)}</td>
                  <td className="text-right">
                    <input type="number" value={vatRebatePct} onChange={(e) => setVatRebatePct(parseFloat(e.target.value) || 0)} className="w-16 text-right border border-line rounded px-1 py-0.5" />%
                  </td>
                  <td className="text-right tabular-nums text-danger">-{fmtMoney(rebatePreview.vatRebate)}</td>
                  <td className="text-right tabular-nums font-semibold">{fmtMoney(rebatePreview.vatNet)}</td>
                </tr>
                <tr className="bg-brand text-white font-bold">
                  <td colSpan={4} className="!text-white !bg-brand">💰 Total Settlement Amount</td>
                  <td className="text-right tabular-nums !text-white !bg-brand">{fmtMoney(rebatePreview.totalSettlement)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </Modal>

      {/* ── Roll Over Modal (HP) ── */}
      <Modal
        open={showRollover}
        onClose={() => setShowRollover(false)}
        title={`🔁 Roll Over — ${watched.lease_no || 'HP'}`}
        size="md"
        footer={
          <>
            <Button onClick={() => setShowRollover(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => rollover.mutate()} disabled={rollover.isPending || !can(menuKey, 'approve')}>
              ✓ Proceed Roll Over
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted italic">เมื่อ Balloon ครบ ลูกค้าจ่ายไม่ไหว → ปิดสัญญาเดิม + เปิดสัญญาใหม่ ใช้ยอด Balloon เป็นเงินต้นใหม่</p>
          <table className="table-base text-sm">
            <tbody>
              <tr><td className="font-semibold">สัญญาเดิม</td><td className="text-right">{watched.lease_no}</td></tr>
              <tr className="bg-soft"><td className="font-bold">Balloon Outstanding</td><td className="text-right tabular-nums font-bold">{fmtMoney(watched.balloon_amount ?? 0)}</td></tr>
              <tr><td className="font-semibold">New Principal</td><td className="text-right tabular-nums text-brand font-semibold">{fmtMoney(watched.balloon_amount ?? 0)} (from Balloon)</td></tr>
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel>ROLL OVER DATE</FieldLabel>
              <Input type="date" value={rolloverDate} onChange={(e) => setRolloverDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel>NEW TERM (MONTHS)</FieldLabel>
              <NumInput value={rolloverTerm} onChange={setRolloverTerm} />
            </div>
            <div>
              <FieldLabel>NEW RATE (%)</FieldLabel>
              <NumInput value={rolloverRate} onChange={setRolloverRate} step="0.01" />
            </div>
          </div>
          <p className="text-xs text-muted">กด Proceed → ปิดสัญญาเดิม (Modified) + เปิดสัญญาใหม่ (Draft) เงินต้น = Balloon · แล้วพาไปกรอกรายละเอียดต่อ</p>
        </div>
      </Modal>

      {/* ── Re-measurement Modal (Lease Other / TFRS 16) ── */}
      <Modal
        open={showRemeasure}
        onClose={() => setShowRemeasure(false)}
        title={`📐 Re-measurement — ${watched.lease_no || 'Lease'}`}
        size="lg"
        footer={
          <>
            <Button onClick={() => setShowRemeasure(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => remeasureSettle.mutate()} disabled={remeasureSettle.isPending || !can(menuKey, 'approve')}>
              ✓ Post Adjustment JE
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            ⚠️ NPV / Re-measurement คำนวณใน Excel — กรอกค่า ROU และ Lease Liability ใหม่ที่ได้จาก Excel · ระบบจะลง JE ปรับปรุงผลต่าง + บันทึกเวอร์ชันให้
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <FieldLabel>EFFECTIVE DATE</FieldLabel>
              <Input type="date" value={remeasureDate} onChange={(e) => setRemeasureDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel tipKey="ASSET / ROU">NEW ROU ASSET</FieldLabel>
              <NumInput value={remeasureRou} onChange={setRemeasureRou} step="0.01" />
              <p className="text-xs text-muted mt-0.5">เดิม {fmtMoney(oldRou)}</p>
            </div>
            <div>
              <FieldLabel tipKey="LEASE LIABILITY (GROSS)">NEW LEASE LIABILITY</FieldLabel>
              <NumInput value={remeasureLiability} onChange={setRemeasureLiability} step="0.01" />
              <p className="text-xs text-muted mt-0.5">เดิม {fmtMoney(oldLiability)}</p>
            </div>
            <div>
              <FieldLabel>NEW TERM (MONTHS)</FieldLabel>
              <NumInput value={remeasureTerm} onChange={setRemeasureTerm} />
            </div>
            <div>
              <FieldLabel>NEW RATE (%)</FieldLabel>
              <NumInput value={remeasureRate} onChange={setRemeasureRate} step="0.01" />
            </div>
            <div>
              <FieldLabel>REASON</FieldLabel>
              <Input value={remeasureReason} onChange={(e) => setRemeasureReason(e.target.value)} />
            </div>
          </div>

          <div className="rounded border border-line bg-soft p-3">
            <div className="text-xs font-semibold mb-1.5">JE Preview — Adjustment</div>
            <table className="table-base text-sm">
              <thead><tr><ThTip tipKey="ACCOUNT">Account</ThTip><ThTip align="right" tipKey="DR">Dr</ThTip><ThTip align="right" tipKey="CR">Cr</ThTip></tr></thead>
              <tbody>
                {Math.abs(remeasurePreview.dRou) >= 0.005 && (
                  <tr>
                    <td>{HP_GL.asset.name}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.dRou > 0 ? fmtMoney(remeasurePreview.dRou) : ''}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.dRou < 0 ? fmtMoney(-remeasurePreview.dRou) : ''}</td>
                  </tr>
                )}
                {Math.abs(remeasurePreview.dLiab) >= 0.005 && (
                  <tr>
                    <td>{HP_GL.leaseLiabilityLT.name}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.dLiab < 0 ? fmtMoney(-remeasurePreview.dLiab) : ''}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.dLiab > 0 ? fmtMoney(remeasurePreview.dLiab) : ''}</td>
                  </tr>
                )}
                {Math.abs(remeasurePreview.plDr) >= 0.005 && (
                  <tr>
                    <td>{HP_GL.remeasurePL.name} {remeasurePreview.plDr > 0 ? '(Loss)' : '(Gain)'}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.plDr > 0 ? fmtMoney(remeasurePreview.plDr) : ''}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.plDr < 0 ? fmtMoney(-remeasurePreview.plDr) : ''}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="text-xs text-muted mt-1.5">
              JE จะถูกบันทึกเป็น Draft (รอ Approve) · สัญญาจะเปลี่ยนสถานะเป็น Modified และ schedule จะคำนวณใหม่จาก Lease Liability ใหม่
            </p>
          </div>
        </div>
      </Modal>

      {/* ── Asset Transfer Modal (IFRS 16, 5 scenarios) ── */}
      <Modal
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        title={`📦 Asset Transfer — ${watched.lease_no || 'Lease'}`}
        size="lg"
        footer={
          <>
            <Button onClick={() => setShowTransfer(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => assetTransfer.mutate()} disabled={assetTransfer.isPending || !can(menuKey, 'approve')}>
              ✓ Post Transfer JE
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-[11px] text-muted italic">โอนเปลี่ยนประเภทสินทรัพย์ ROU ตามสถานการณ์ (IFRS 16) — JE ที่มูลค่าตามบัญชี (NBV)</p>
          <div>
            <FieldLabel>SCENARIO</FieldLabel>
            <Select value={transferKey} onChange={(e) => setTransferKey(e.target.value as TransferKey)}>
              {ASSET_TRANSFERS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
            <p className="text-[11px] text-muted mt-0.5 italic">{ASSET_TRANSFERS.find((s) => s.key === transferKey)?.when}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>TRANSFER DATE</FieldLabel>
              <Input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
            </div>
            <div>
              <FieldLabel>มูลค่าโอน — NBV (บาท)</FieldLabel>
              <NumInput value={transferAmount} onChange={setTransferAmount} step="0.01" />
              <p className="text-[10px] text-muted mt-0.5 italic">ค่าเริ่มต้น = ROU ตั้งต้น − ค่าเสื่อมที่ Post แล้ว</p>
            </div>
          </div>
          {(() => {
            const sc = ASSET_TRANSFERS.find((s) => s.key === transferKey)!;
            const drGl = (HP_GL as any)[sc.drGl];
            const crGl = (HP_GL as any)[sc.crGl];
            return (
              <div className="rounded border border-line bg-soft p-3">
                <div className="text-xs font-semibold text-muted uppercase mb-1">JE Preview</div>
                <table className="table-base text-sm">
                  <thead><tr><ThTip>Account</ThTip><ThTip align="right">Dr</ThTip><ThTip align="right">Cr</ThTip></tr></thead>
                  <tbody>
                    <tr><td>{drGl.code} · {drGl.name}</td><td className="text-right tabular-nums">{fmtMoney(transferAmount)}</td><td /></tr>
                    <tr><td>{crGl.code} · {crGl.name}</td><td /><td className="text-right tabular-nums">{fmtMoney(transferAmount)}</td></tr>
                  </tbody>
                </table>
                <p className="text-[11px] text-muted mt-1.5">
                  JE จะถูกบันทึกเป็น Draft (รอ Approve) · บันทึกประวัติการโอนใน Asset Transfer History
                </p>
              </div>
            );
          })()}
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={bold ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  );
}
