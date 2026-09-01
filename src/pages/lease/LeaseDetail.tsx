import { useEffect, useMemo, useRef, useState } from 'react';
import { assertCanUseSubsidiary, filterCaOptions } from '@/lib/subsidiary-scope';
import { ScopeGuard } from '@/components/shared/ScopeGuard';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save, Search } from 'lucide-react';
import { LookupFAModal } from '@/components/shared/LookupFAModal';
import { LookupChassisModal } from '@/components/shared/LookupChassisModal';
import { LookupVendorModal } from '@/components/shared/LookupVendorModal';
import { ClassificationCard } from '@/components/shared/ClassificationCard';
import { fetchInheritedFromMA, type InheritedSegments } from '@/lib/segment-inherit';
import type { FixedAsset } from '@/lib/fa-lookup';
import type { ChassisInventory } from '@/lib/chassis-lookup';
import { checkChassisConflict, classifyConflicts } from '@/lib/chassis-lookup';
import type { Vendor } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { Button, Input, Select, Badge, Modal, FieldLabel, HoverTooltip, NumInput, CharCount } from '@/components/ui';
import { TOOLTIPS } from '@/lib/tooltips';
import { Section } from '@/components/tx/Section';
import { Tabs } from '@/components/tx/Tabs';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { ThTip, TipLabel } from '@/components/tx/TipHelpers';
import { fmtMoney, fmtDate, fmtDateISO} from '@/lib/format';
import { buildSchedule, npvOfRentSteps, type RentStep } from '@/lib/lease-calc';
import { irr } from '@/lib/irr';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { buildHPSchedule } from '@/lib/hp-schedule';
import { buildRouDepreciation } from '@/lib/rou-depreciation';
import { createJE, postJE } from '@/lib/je';
import { fetchCaCards } from '@/lib/ca-inherit';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly, ReadOnlyContext } from '@/lib/readonly';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import { AuditFooter } from '@/components/AuditFooter';
import { computeStatusLock, canSaveStatusChange } from '@/lib/status-lock';
import { toDbPayload } from '@/lib/save-payload';
import { StatusLockBanner } from '@/components/tx/StatusLockBanner';
import { ApprovalPanel } from '@/components/tx/ApprovalPanel';
import { fetchBankConfirmed, bankConfirmedQueryKey } from '@/lib/bank-statement-match';
import type { Lease, LeaseVersion } from '@/types/database';
import { useBankCodes } from '@/lib/banks';
import { useSubsidiaryCodes } from '@/lib/subsidiaries';
import { ApprovalActions, ApprovalNote, filterStatusOptions } from '@/components/shared/ApprovalActions';
import { syncScheduleFor } from '@/lib/schedule-store';

import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
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
  asset: { code: '1240100', name: 'Right-of-Use Asset' },
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
  cash: { code: '100000', name: 'Cheque Account' },
};

// หน้าที่ของบัญชีที่สัญญาเช่าใช้จริง — แสดงเป็นตัวเลือกในแท็บ Accounting
// ชื่อต้องตรงกับรายการกลางใน AcctCards ไม่งั้นตัวลงบัญชีจะหาไม่เจอ
const LEASE_ACCT_TYPES = [
  'RIGHT-OF-USE ASSET',
  'LEASE LIABILITY',
  'CURRENT PORTION OF LEASE LIABILITY',
  'DEFERRED INTEREST',
  'CURRENT PORTION OF DEFERRED INTEREST',
  'UNDUE INPUT VAT',
  'INTEREST EXPENSE ACCOUNT',
  'AP LEASE ACCOUNT',
  'CASH / BANK ACCOUNT',
  'DEPRECIATION EXPENSE - ROU',
  'ACCUMULATED DEPRECIATION - ROU',
  'GAIN(LOSS) ON MODIFICATION',
] as const;

// จับคู่หน้าที่บัญชี → ค่าตั้งต้นที่ใช้เมื่อยังไม่ได้เลือกในแท็บ Accounting
const LEASE_GL_MAP = {
  asset: ['RIGHT-OF-USE ASSET', HP_GL.asset],
  leaseLiabilityLT: ['LEASE LIABILITY', HP_GL.leaseLiabilityLT],
  currLeaseLiability: ['CURRENT PORTION OF LEASE LIABILITY', HP_GL.currLeaseLiability],
  deferredInterest: ['DEFERRED INTEREST', HP_GL.deferredInterest],
  currDeferredInterest: ['CURRENT PORTION OF DEFERRED INTEREST', HP_GL.currDeferredInterest],
  undueVat: ['UNDUE INPUT VAT', HP_GL.undueVat],
  interestExpense: ['INTEREST EXPENSE ACCOUNT', HP_GL.interestExpense],
  apLeasing: ['AP LEASE ACCOUNT', HP_GL.apLeasing],
  cash: ['CASH / BANK ACCOUNT', HP_GL.cash],
  depreciationExpense: ['DEPRECIATION EXPENSE - ROU', HP_GL.depreciationExpense],
  accumDepRou: ['ACCUMULATED DEPRECIATION - ROU', HP_GL.accumDepRou],
  remeasurePL: ['GAIN(LOSS) ON MODIFICATION', HP_GL.remeasurePL],
} as const satisfies Record<string, readonly [string, { code: string; name: string }]>;

type LeaseGLKey = keyof typeof LEASE_GL_MAP;

/** แยกข้อความ "รหัส ชื่อบัญชี" ที่ผู้ใช้เลือกไว้ ออกเป็นรหัสกับชื่อ */
function splitGL(raw: string): { code: string; name: string } {
  const sp = raw.indexOf(' ');
  return sp > 0 ? { code: raw.slice(0, sp), name: raw.slice(sp + 1) } : { code: '', name: raw };
}

/**
 * ผังบัญชีที่จะใช้ลง JE ของสัญญานี้
 * ถ้าแท็บ Accounting เลือกบัญชีไว้ ใช้ตามนั้น · ถ้าไม่ได้เลือก ใช้ค่าตั้งต้น
 */
function resolveLeaseGL(cards: AcctCard[]): Record<LeaseGLKey, { code: string; name: string }> {
  const out = {} as Record<LeaseGLKey, { code: string; name: string }>;
  for (const key of Object.keys(LEASE_GL_MAP) as LeaseGLKey[]) {
    const [acctType, fallback] = LEASE_GL_MAP[key];
    const hit = cards.find((c) => c.type === acctType && c.gl?.trim());
    out[key] = hit ? splitGL(hit.gl.trim()) : fallback;
  }
  return out;
}

// Asset Transfer — 5 scenarios.
const ASSET_TRANSFERS = [
  { key: 'ROU_PPE', label: 'ROU → PPE (Owned Asset)', when: 'ครบสัญญาเช่า แล้วซื้อต่อ', from: 'ROU Asset', to: 'PPE (Owned Asset)', drGl: 'ppe', crGl: 'asset' },
  { key: 'ROU_IP', label: 'ROU → Investment Property (IP)', when: 'เปลี่ยนวัตถุประสงค์เป็นปล่อยให้เช่า', from: 'ROU Asset', to: 'Investment Property', drGl: 'investmentProperty', crGl: 'asset' },
  { key: 'ROU_HELD_SALE', label: 'ROU → Asset Held for Sale (รอขาย)', when: 'หยุดเช่า ตั้งใจขาย', from: 'ROU Asset', to: 'Asset Held for Sale', drGl: 'assetHeldForSale', crGl: 'asset' },
  { key: 'ROU_OL', label: 'ROU → Operating Lease (ให้เช่าต่อ)', when: 'เปลี่ยนเป็นการ sublease', from: 'ROU Asset', to: 'Operating Lease Asset', drGl: 'olAsset', crGl: 'asset' },
  { key: 'PPE_IP', label: 'PPE → Investment Property', when: 'เปลี่ยนวัตถุประสงค์ Owned → ให้เช่า', from: 'PPE (Owned Asset)', to: 'Investment Property', drGl: 'investmentProperty', crGl: 'ppe' },
] as const;
type TransferKey = typeof ASSET_TRANSFERS[number]['key'];

const schema = z.object({
  lease_no: z.string().optional().default(''), // auto running number when blank
  mode: z.enum(['hp', 'lease', 'other']),
  use_bank_loan: z.boolean(),
  ca_id: z.string().nullable().optional(),
  /** บริษัทเจ้าของสัญญา — ผูกวงเงินแล้วดึงมาให้ · ไม่ผูกวงเงินต้องเลือกเอง */
  subsidiary: z.string().nullable().optional(),
  contract_number: z.string().nullable().optional(),
  contract_date: z.string().nullable().optional(),
  classification: z.string(),
  payment_frequency: z.string(),
  payment_start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  payment_type: z.string(),
  asset_type: z.string().min(1),
  asset_name: z.string().min(1, 'กรอกชื่อสินทรัพย์'),
  chassis_no: z.string().nullable().optional(),  // HP mode — BR-LEASE-026
  vendor: z.string().optional(),
  vendor_id: z.string().optional().nullable(), // FK → vendors.id (Lessor for IFRS 16) · Migration 0046
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
  // เงินของงวดท้ายที่จ่ายไปแล้ววันแรก — ไม่อยู่ในหนี้สิน แต่รวมในสิทธิการใช้สินทรัพย์
  prepaid_amount: z.coerce.number().nullable().optional(),
  discount_rate: z.coerce.number().nullable().optional(),
  rou_useful_life: z.coerce.number().int().nullable().optional(),
  vat_rate: z.coerce.number().min(0).max(100),
  posting_lease: z.boolean(),
  calc_interest_end: z.boolean(),
  include_balloon_installment: z.boolean(),
  pay_eom: z.boolean(),
  // ค่าเช่าไม่เท่ากันตลอดสัญญา — ระบุเป็นช่วงงวด · ว่าง = เท่ากันทุกงวด
  rent_steps: z.array(z.object({
    fromPeriod: z.number().default(1),
    toPeriod: z.number().default(1),
    amount: z.number().default(0),
  })).nullable().optional(),
  status: z.enum(['Draft', 'Pending Approval', 'Approved', 'Active', 'Closed', 'Modified', 'Roll Over', 'Cancelled']),
  remark: z.string().nullable().optional(),
  bank_ref: z.string().nullable().optional(), // Migration 0062 — Bank Statement auto-link
  tfrs16_exemption: z.enum(['short_term', 'low_value']).nullable().optional(), // Migration 0065 — Rental Expense Mode (DB column kept as-is)

  // กล่องจัดประเภท — ต้องประกาศไว้ตรงนี้ด้วย ไม่ใช่แค่ตั้งค่าด้วย setValue
  //
  // ตัวตรวจข้อมูลของฟอร์มจะตัดคีย์ที่ไม่ได้ประกาศทิ้งก่อนส่งไปบันทึก คีย์ 4 ตัวนี้จึงไม่เคย
  // ถูกเขียนลงฐานข้อมูลเลย — ผู้ใช้เลือกฝ่าย สถานที่ ประเภทธุรกิจ แล้วกดบันทึกได้ตามปกติ
  // แต่พอเปิดขึ้นมาใหม่ค่าหายหมด · ส่วน _code / _name เป็นค่าไว้แสดงบนจอเท่านั้น
  // จะถูก toDbPayload คัดออกก่อนเขียนลงฐานข้อมูลอยู่แล้ว
  department_id: z.string().nullable().optional(),
  department_code: z.string().nullable().optional(),
  department_name: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  location_code: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  class_id_override: z.string().nullable().optional(),
  class_code: z.string().nullable().optional(),
  class_name: z.string().nullable().optional(),
  rpt: z.string().nullable().optional(),
});

type FormData = z.infer<typeof schema>;

export function LeaseDetail({
  mode: pageMode,
  leaseMode,
}: {
  mode: 'new' | 'edit';
  leaseMode: 'hp' | 'lease' | 'other';
}) {
  const { can: rawCan, scope } = useAuth();
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // เส้นทางหน้าจอ + รหัสสิทธิ์ แยกตามชนิดสัญญาเช่า 3 แบบ
  const LEASE_ROUTE = { hp: '/lease/hp', lease: '/lease/leasing', other: '/lease/other' } as const;
  const LEASE_MENU_KEY = { hp: 'lease_hp', lease: 'lease_leasing', other: 'lease_other' } as const;
  const baseRoute = LEASE_ROUTE[leaseMode];
  const LEASE_KIND_LABEL = { hp: 'Hire Purchase', lease: 'Leasing', other: 'Leasing Other' } as const;
  const kindLabelOf = (m: string | null | undefined) => LEASE_KIND_LABEL[(m as keyof typeof LEASE_KIND_LABEL)] ?? 'Leasing';
  const userLabel = useCurrentUserLabel();
  const viewOnly = useReadOnly();
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);
  const menuKey = LEASE_MENU_KEY[leaseMode];
  const [acctCards, setAcctCards] = useState<AcctCard[]>([]);
  // ผังบัญชีที่ JE ทุกใบของสัญญานี้ใช้ — มาจากแท็บ Accounting ถ้าเลือกไว้ ไม่งั้นใช้ค่าตั้งต้น
  const GL = useMemo(() => resolveLeaseGL(acctCards), [acctCards]);

  // Rebate (Close Early) modal state
  const today = fmtDateISO(new Date());
  const [showRebate, setShowRebate] = useState(false);
  const [closeDate, setCloseDate] = useState(today);
  const [closeReason, setCloseReason] = useState('Customer Request');
  const [intRebatePct, setIntRebatePct] = useState(50);
  const [vatRebatePct, setVatRebatePct] = useState(50);

  // NetSuite FA Lookup (per MoM §5) — track linked Asset No (display-only)
  const [showFALookup, setShowFALookup] = useState(false);
  const [vendorLookupOpen, setVendorLookupOpen] = useState(false);  // IFRS 16 Lessor lookup (MoM §3)
  const [linkedAssetNo, setLinkedAssetNo] = useState<string | null>(null);
  // NetSuite Inventory Chassis Lookup (HP mode — per MoM §5)
  const [showChassisLookup, setShowChassisLookup] = useState(false);
  const [linkedChassisNo, setLinkedChassisNo] = useState<string | null>(null);

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
    getValues,
    formState: { errors, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      lease_no: '',
      mode: leaseMode,
      // ใช้วงเงินธนาคารหรือไม่ คำนวณจากชนิดสัญญา ไม่ใช่ให้ผู้ใช้ติ๊กเอง
      use_bank_loan: leaseMode !== 'other',
      ca_id: null,
      // ไม่ตั้งค่าเริ่มต้นเป็นบริษัทใดบริษัทหนึ่ง — ต้องเลือกเองหรือได้จากวงเงิน
      subsidiary: null,
      contract_number: '',
      contract_date: fmtDateISO(new Date()),
      classification: leaseMode === 'other' ? 'Operating' : 'Finance',
      payment_frequency: 'Monthly',
      payment_start_date: fmtDateISO(new Date()),
      end_date: null,
      payment_type: 'Fix Installment / Fix Installment & Step payment',
      asset_type: leaseMode === 'other' ? 'อาคาร / ที่ดิน' : 'ยานพาหนะ',
      asset_name: '',
      chassis_no: null,
      vendor: '',
      vendor_id: null,
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
      prepaid_amount: 0,
      discount_rate: 4.65,
      rou_useful_life: null,
      vat_rate: 7,
      posting_lease: true,
      calc_interest_end: false,
      include_balloon_installment: true,
      pay_eom: true,
      rent_steps: null,
      status: 'Draft',
      remark: '',
      bank_ref: '',
      tfrs16_exemption: null,
    },
  });

  const watched = useWatch({ control });

  // Fetch inherited segments (Subsidiary, Finance Institution) จาก parent MA (direct)
  const [inheritedSeg, setInheritedSeg] = useState<InheritedSegments>({});
  useEffect(() => {
    const maId = (watched as any)?.ma_id ?? null;
    if (!maId) { setInheritedSeg({}); return; }
    fetchInheritedFromMA(maId).then(setInheritedSeg).catch(() => setInheritedSeg({}));
  }, [(watched as any)?.ma_id]);

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
      const { data } = await supabase.from('credit_agreements').select('id, ca_name, contract_number, finance_institution, subsidiary').eq('status', 'Approved').order('ca_name');
      return filterCaOptions(scope, (data ?? []) as { id: string; ca_name: string; contract_number: string | null; finance_institution: string | null; subsidiary: string | null }[]);
    },
  });

  // รายชื่อบริษัทในกลุ่ม — ใช้เฉพาะสัญญาเช่าที่ไม่ผูกวงเงิน ซึ่งต้องเลือกเอง
  const { codes: subCodes } = useSubsidiaryCodes();
  // สัญญาเช่าอื่นเลือกบริษัทเอง — ให้เลือกได้เฉพาะบริษัทที่ตัวเองดูแล
  const mySubCodes = scope.all ? subCodes : subCodes.filter((c) => scope.codes.includes(c));

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
        chassis_no: existing.chassis_no ?? null,
        vendor: existing.vendor ?? '',
        vendor_id: (existing as any).vendor_id ?? null,
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
        prepaid_amount: (existing as any).prepaid_amount ?? 0,
        discount_rate: existing.discount_rate ?? 4.65,
        rou_useful_life: existing.rou_useful_life ?? null,
        vat_rate: existing.vat_rate ?? 7,
        posting_lease: existing.posting_lease ?? true,
        calc_interest_end: existing.calc_interest_end ?? false,
        include_balloon_installment: existing.include_balloon_installment ?? true,
        pay_eom: existing.pay_eom ?? true,
        rent_steps: ((existing as any).rent_steps ?? null),
        status: existing.status,
        remark: existing.remark ?? '',
        bank_ref: (existing as any).bank_ref ?? '',
        tfrs16_exemption: (existing as any).tfrs16_exemption ?? null,
      });
      setAcctCards((existing.acct_cards as AcctCard[]) ?? []);
      if (existing.chassis_no) setLinkedChassisNo(existing.chassis_no);  // BR-LEASE-026: restore badge
    }
  }, [existing, reset]);

  // HP auto-compute: Net Vehicle Cost = Vehicle Price - Down Payment → Principal
  useEffect(() => {
    if (watched.mode === 'hp') {
      const net = (watched.vehicle_price ?? 0) - (watched.down_payment ?? 0);
      if (net >= 0) setValue('principal', net, { shouldDirty: false });
    }
  }, [watched.vehicle_price, watched.down_payment, watched.mode, setValue]);

  // Leasing: สถาบันการเงินดึงจาก Credit Agreement ที่เลือก (Master Agreement → Credit Agreement → สัญญาเช่า)
  useEffect(() => {
    if (watched.mode === 'lease' && watched.ca_id) {
      const ca = caOptions.find((c) => c.id === watched.ca_id);
      if (ca?.finance_institution) setValue('vendor', ca.finance_institution, { shouldDirty: false });
    }
  }, [watched.ca_id, watched.mode, caOptions, setValue]);

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
      // After Re-measurement, principal = new Lease Liability (NPV only — upfront already excluded).
      // Detect re-measurement via status === 'Modified' to avoid TDZ issue (leaseVersions declared below).
      // For initial Day 1, principal = ROU and we DO subtract upfront to get NPV.
      const isReMeasured = watched.status === 'Modified';
      return buildSchedule({
        principal: watched.principal,
        // IFRS 16 lease (other) discounts at the Discount Rate; HP uses the contract rate
        annualRate: watched.mode === 'other' ? (watched.discount_rate ?? watched.annual_rate ?? 0) : (watched.annual_rate ?? 0),
        termMonths: watched.term_months,
        startDate: watched.payment_start_date ?? watched.start_date,
        balloon: watched.balloon_amount ?? 0,
        upfront: isReMeasured ? 0 : ((watched.upfront_payment ?? 0) + (watched.prepaid_amount ?? 0)),
        gracePeriods: watched.grace_periods ?? 0,
        prepaidPeriods: watched.prepaid_periods ?? 0,
        payEom: watched.pay_eom ?? true,
        // สัญญาเช่าใช้ชุดรูปแบบการชำระเดียวกับสินเชื่อ ตามที่ตกลงกัน
        paymentType: watched.payment_type,
        paymentTiming: (watched.payment_type ?? '').includes('ต้นงวด') ? 'advance' : 'arrears',
        rentSteps: (watched.rent_steps as RentStep[] | null | undefined) ?? undefined,
      });
    } catch {
      return [];
    }
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

  /**
   * อัตราดอกเบี้ยที่แท้จริง — แก้ย้อนจากกระแสเงินสดในตารางผ่อนที่แสดงอยู่จริง
   *
   * เดิม 2 ช่องนี้เอาอัตราตามสัญญามาโชว์ตรงๆ ทั้งที่ป้ายบอกว่าเป็นอัตราที่มีผล
   * ซึ่งไม่ตรงกันเมื่อมีเงินจ่ายวันแรก · งวดปลอดชำระ · งวดจ่ายล่วงหน้า · เงินก้อนท้าย
   * คืน null เมื่อคำนวณไม่ได้ — ห้ามโชว์ตัวเลขที่ไม่ใช่ของจริงแทน
   */
  const effectiveRate = useMemo<{ year: number; month: number } | null>(() => {
    const isHpMode = watched.mode === 'hp';
    const rows: { amount: number }[] = isHpMode
      ? (hpSchedule?.rows ?? []).map((r) => ({ amount: r.installment }))
      : schedule.map((r) => ({ amount: r.payment }));
    if (rows.length === 0) return null;
    const opening = isHpMode ? (hpSchedule?.rows[0]?.beginBalance ?? 0) : (schedule[0]?.beginBalance ?? 0);
    if (opening <= 0) return null;
    // เช่าซื้อจ่ายปลายงวดเสมอ · สัญญาเช่าแบบชำระต้นงวด งวดแรกจ่ายตั้งแต่วันแรก จึงไม่ต้องคิดลด
    const advance = !isHpMode && (watched.payment_type ?? '').includes('ต้นงวด');
    const cashflow: number[] = [-opening];
    rows.forEach((r, idx) => {
      const t = advance ? idx : idx + 1;
      cashflow[t] = (cashflow[t] ?? 0) + r.amount;
    });
    // เช่าซื้อจ่ายราย 3 เดือน/ปี 1 งวดในตารางจึงไม่ใช่ 1 เดือน ต้องแปลงกลับเป็นต่อปีตามจังหวะจริง
    const stepMonths = isHpMode
      ? (watched.payment_frequency === 'Quarterly' ? 3 : watched.payment_frequency === 'Yearly' ? 12 : 1)
      : 1;
    const perPeriod = irr(cashflow, 0.01);
    if (!Number.isFinite(perPeriod)) return null;
    const year = perPeriod * (12 / stepMonths) * 100;
    if (!Number.isFinite(year)) return null;
    return { year, month: year / 12 };
  }, [schedule, hpSchedule, watched.mode, watched.payment_type, watched.payment_frequency]);

  // ค่างวดโดยประมาณที่แสดงด้านบน ต้องเป็นตัวเลขชุดเดียวกับคอลัมน์ค่างวดในตารางผ่อน
  //
  // เดิมช่องนี้คำนวณเองด้วยสูตรค่างวดคงที่ จึงไม่ตรงกับตารางเมื่อ
  //   • มีเงินจ่ายล่วงหน้า (ตารางหักออกจากยอดหนี้สิน แต่สูตรเดิมไม่ได้หัก)
  //   • เลือกชำระต้นงวด (ตารางคิดลดต่างกัน 1 งวด)
  //   • เช่าซื้อที่คิดดอกเบี้ยรายวันตามยอดคงเหลือ (ค่างวดไม่เท่ากันทุกงวด)
  // จึงเปลี่ยนมาอ่านจากตารางที่คำนวณไว้แล้วแทน — มีแหล่งความจริงเดียว
  const installmentInfo = useMemo(() => {
    const amounts = (watched.mode === 'hp' && hpSchedule)
      ? hpSchedule.rows.map((r) => r.installment ?? 0)
      : schedule.map((r) => r.payment ?? 0);
    // งวดปลอดชำระค่างวดเป็น 0 — ไม่ควรถูกนับเป็น "ค่างวดต่ำสุด"
    const due = amounts.filter((a) => a > 0.005);
    if (due.length === 0) return { first: 0, min: 0, max: 0, uniform: true };
    const min = Math.min(...due);
    const max = Math.max(...due);
    return { first: due[0], min, max, uniform: max - min <= 0.005 };
  }, [watched.mode, hpSchedule, schedule]);
  const monthlyEst = installmentInfo.first;
  // ค่างวดไม่เท่ากันทุกงวด → แสดงเป็นช่วง จะได้ไม่เข้าใจผิดว่าจ่ายเท่านี้ตลอดสัญญา
  const monthlyEstText = installmentInfo.uniform
    ? fmtMoney(monthlyEst)
    : `${fmtMoney(installmentInfo.min)} – ${fmtMoney(installmentInfo.max)}`;

  // ค่าเช่าเป็นช่วง → ยอดเงินต้นคือมูลค่าปัจจุบันของค่าเช่าทั้งหมด ไม่ให้กรอกเอง
  const rentSteps = (watched.rent_steps ?? []) as RentStep[];
  const hasRentSteps = rentSteps.length > 0;
  const rentStepsNpv = useMemo(() => {
    if (!hasRentSteps || !watched.term_months) return 0;
    const rate = watched.mode === 'other'
      ? (watched.discount_rate ?? watched.annual_rate ?? 0)
      : (watched.annual_rate ?? 0);
    return npvOfRentSteps(
      rentSteps, watched.term_months, rate,
      (watched.payment_type ?? '').includes('ต้นงวด') ? 'advance' : 'arrears',
    );
  }, [hasRentSteps, rentSteps, watched.term_months, watched.discount_rate, watched.annual_rate, watched.mode, watched.payment_type]);

  // ช่อง PRINCIPAL AMOUNT เก็บยอดสิทธิการใช้สินทรัพย์ ณ วันแรก
  //   = มูลค่าปัจจุบันของค่าเช่าที่ยังต้องจ่าย + เงินจ่ายล่วงหน้า + เงินงวดท้ายที่จ่ายไปแล้ว
  // ตัวหักออกเป็นหนี้สินอยู่ที่ตอนลงบัญชีวันแรก
  useEffect(() => {
    if (hasRentSteps && rentStepsNpv > 0) {
      const rou = rentStepsNpv + (watched.upfront_payment ?? 0) + (watched.prepaid_amount ?? 0);
      setValue('principal', Number(rou.toFixed(2)), { shouldDirty: false });
    }
  }, [hasRentSteps, rentStepsNpv, watched.upfront_payment, watched.prepaid_amount, setValue]);

  // ตรวจว่าช่วงงวดครอบคลุมครบและไม่ทับกัน — ถ้าไม่ครบ งวดที่ขาดจะกลายเป็นไม่ต้องจ่าย
  const rentStepsIssue = useMemo(() => {
    if (!hasRentSteps) return '';
    const term = watched.term_months ?? 0;
    const sorted = [...rentSteps].sort((a, b) => a.fromPeriod - b.fromPeriod);
    if (sorted[0].fromPeriod !== 1) return 'ช่วงแรกต้องเริ่มที่งวดที่ 1';
    for (let k = 0; k < sorted.length; k++) {
      const st = sorted[k];
      if (st.toPeriod < st.fromPeriod) return `ช่วงที่ ${k + 1} งวดสิ้นสุดน้อยกว่างวดเริ่ม`;
      if (k > 0 && st.fromPeriod !== sorted[k - 1].toPeriod + 1) {
        return `ช่วงงวดไม่ต่อเนื่อง — ช่วงที่ ${k + 1} ควรเริ่มที่งวดที่ ${sorted[k - 1].toPeriod + 1}`;
      }
    }
    const last = sorted[sorted.length - 1].toPeriod;
    if (term && last !== term) return `ช่วงสุดท้ายควรจบที่งวดที่ ${term} (อายุสัญญา) — ตอนนี้จบที่ ${last}`;
    if (sorted.some((st) => st.amount <= 0)) return 'ยังมีช่วงที่ยังไม่ได้ใส่ค่าเช่า';
    return '';
  }, [hasRentSteps, rentSteps, watched.term_months]);

  // สถานะที่บันทึกไว้จริงในฐานข้อมูล — ใช้ตัดสินว่า "ปิดไปแล้วหรือยัง"
  // (ห้ามใช้สถานะบนหน้าจอ ไม่งั้นพอเลือกปิดสัญญา ระบบจะบอกว่าแก้ไขไม่ได้ทันที)
  const savedStatus = (existing?.status as string | undefined) ?? watched.status;
  const lock = computeStatusLock('Lease', watched.status);
  // การล็อกช่องกรอกต้องดูจากสถานะที่บันทึกไว้จริง ไม่ใช่สถานะที่เพิ่งเลือกบนหน้าจอ
  // ไม่งั้นพอผู้ใช้เลือก "ปิดสัญญา" ในช่องสถานะ ช่องอื่นจะถูกล็อกทันทีทั้งที่ยังไม่ได้บันทึก
  const savedLock = computeStatusLock('Lease', savedStatus);

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      if (!canSaveStatusChange('Lease', savedStatus, watched.status))
        throw new Error(`Lease สถานะ ${savedStatus} — ปิดไปแล้ว แก้ไขไม่ได้ (เปลี่ยนสถานะกลับก่อน)`);
      // Hire Purchase กับ Leasing ใช้วงเงินธนาคาร จึงต้องอ้างอิง Credit Agreement เสมอ
      // Leasing Other ไม่ใช้วงเงิน เปิดสัญญาได้เลย และต้องไม่ผูก Credit Agreement
      if (rentStepsIssue) throw new Error(`ค่าเช่าแยกตามช่วงงวดยังไม่ถูกต้อง — ${rentStepsIssue}`);
      // จำนวนเงินเป็นศูนย์ = สัญญาเปล่า พอกดลงบัญชีจะได้ใบสำคัญยอด 0 บาทที่ไม่มีความหมาย
      if (!(Number(form.principal) > 0)) {
        throw new Error('จำนวนเงินต้องมากกว่า 0 — กรอกยอดเงินต้น (หรือราคารถ/ค่าเช่าตามช่วงงวด) ก่อนบันทึก');
      }
      if (form.mode !== 'other' && !form.ca_id) {
        throw new Error('สัญญาชนิดนี้ใช้วงเงินธนาคาร — ต้องเลือก Credit Agreement ก่อนบันทึก');
      }
      // บริษัทเจ้าของสัญญาต้องมีเสมอ — ค่าเช่าต้องลงเป็นค่าใช้จ่ายของบริษัทใดบริษัทหนึ่ง
      // และใบสำคัญที่ส่งไประบบบัญชีปลายทางต้องแนบรหัสบริษัท
      // ชนิดที่ใช้วงเงินได้มาจากวงเงินอยู่แล้ว · ชนิดที่ไม่ใช้วงเงินต้องเลือกเอง
      if (!form.subsidiary) {
        throw new Error(
          form.mode === 'other'
            ? 'เลือกบริษัทเจ้าของสัญญา (Subsidiary) ก่อนบันทึก'
            : 'ยังไม่ได้บริษัทเจ้าของสัญญา — เลือก Credit Agreement ใหม่อีกครั้ง',
        );
      }
      // กันสร้างสัญญาให้บริษัทที่ตัวเองไม่ได้ดูแล
      const scopeErr = assertCanUseSubsidiary(scope, form.subsidiary);
      if (scopeErr) throw new Error(scopeErr);
      // สัญญาเช่าที่ใช้วงเงินธนาคารถูกนับเป็นการใช้วงเงินของ Credit Agreement อยู่แล้ว
      // แต่เดิมโมดูลนี้ไม่เคยตรวจ จึงกินวงเงินจนโมดูลอื่นบันทึกไม่ได้ ทั้งที่ตัวเองไม่เคยถูกห้าม
      // exclude = ตัวเอง เพื่อไม่ให้ตอนแก้ไขถูกนับซ้ำสองรอบ
      if (form.mode !== 'other' && form.ca_id) {
        await assertWithinCreditLine(form.ca_id, Number(form.principal ?? 0), { table: 'leases', id });
      }
      const payload: any = {
        ...toDbPayload(form),
        use_bank_loan: form.mode !== 'other',
        // Leasing Other ไม่มีช่องอัตราดอกเบี้ยตามสัญญาแล้ว — ให้เท่ากับอัตราคิดลดที่ใช้คำนวณจริง
        annual_rate: form.mode === 'other' ? (form.discount_rate ?? 0) : form.annual_rate,
        // สัญญาเช่าคำนวณรายเดือนเสมอ — บันทึกให้ตรงกับที่ระบบใช้จริง
        payment_frequency: form.mode === 'hp' ? form.payment_frequency : 'Monthly',
        rent_steps: form.mode === 'other' ? (form.rent_steps ?? null) : null,
        // เงินงวดท้ายที่จ่ายล่วงหน้าใช้เฉพาะสัญญาเช่า — เช่าซื้อไม่มี
        prepaid_amount: form.mode === 'hp' ? 0 : (form.prepaid_amount ?? 0),
        ca_id: form.mode === 'other' ? null : form.ca_id,
        net_vehicle_cost:
          form.mode === 'hp' ? (form.vehicle_price ?? 0) - (form.down_payment ?? 0) : null,
        acct_cards: acctCards,
        updated_by: userLabel,
      };
      // Coerce empty-string UUID fields → null (Postgres rejects "" for uuid columns).
      // Affects IFRS 16 case where ca_id is blank (no Credit Agreement linked).
      if (payload.ca_id === '') payload.ca_id = null;
      if (payload.ma_id === '') payload.ma_id = null;
      if (payload.finance_institution === '') payload.finance_institution = null;
      // สัญญาที่ผูกรถต้องมีเลขตัวถังเสมอ — ถ้ารถยังมาไม่ถึงให้ใส่ 000 ไว้ก่อน ห้ามปล่อยว่าง
      const isVehicleContract = form.mode === 'hp'
        || (form.mode === 'lease' && form.asset_type === 'ยานพาหนะ');
      if (isVehicleContract && (!payload.chassis_no || String(payload.chassis_no).trim() === '')) {
        payload.chassis_no = '000';
        toast.info("ใส่เลขตัวถัง 000 ไว้ก่อน · กลับมาแก้เมื่อรถมาถึง", { duration: 5000 });
      }

      // Chassis Conflict Check — same rule as HP · Loan · FP · PN (BR-COL-001):
      // Same bank → BLOCK · different bank → WARN
      // Skip placeholder '000' and empty
      const chNo = String(payload.chassis_no ?? '').trim();
      if (chNo && chNo !== '000') {
        const excludeMod = form.mode === 'hp' ? 'HP' : 'LEASE';
        const conflicts = await checkChassisConflict(chNo, excludeMod as any, id, payload.finance_institution ?? null);
        const { blockers, warnings } = classifyConflicts(conflicts);
        if (blockers.length > 0) {
          const msg = blockers.map((x) => `${x.module} ${x.contract_no} ของ ${x.bank || '?'} (${x.status})`).join(', ');
          throw new Error(`รถนี้ (${chNo}) ใช้อยู่ใน: ${msg} — แบงก์เดียวกัน บันทึกไม่ได้`);
        }
        if (warnings.length > 0) {
          const msg = warnings.map((x) => `${x.module} ${x.contract_no} ของ ${x.bank || '?'}`).join(', ');
          toast.warning(`รถนี้ใช้อยู่ในสัญญาต่างแบงก์ (ดำเนินการต่อได้): ${msg}`, { duration: 6000 });
        }
      }

      // ความเห็นของผู้อนุมัติ (ส่งกลับแก้ / ปฏิเสธ) ถูกต่อท้ายช่องหมายเหตุในฐานข้อมูลโดยตรง
      // ค่าบนหน้าจอคือค่าที่โหลดมาก่อนหน้านั้น ถ้าส่งทับกลับไปตรงๆ ข้อความของผู้อนุมัติจะหายทันที
      // จึงอ่านของจริงมาก่อน แล้วต่อเฉพาะบรรทัดการพิจารณาที่หน้าจอยังไม่มีกลับเข้าไป
      if (pageMode === 'edit' && id) {
        const { data: cur } = await supabase.from('leases').select('remark').eq('id', id).maybeSingle();
        const formRemark = String(payload.remark ?? '');
        const missingTrail = String((cur as any)?.remark ?? '')
          .split(' · ')
          .map((s) => s.trim())
          .filter((s) => s.startsWith('ส่งกลับแก้:') || s.startsWith('ปฏิเสธ:'))
          .filter((s) => !formRemark.includes(s));
        if (missingTrail.length > 0) {
          payload.remark = [formRemark, ...missingTrail].filter(Boolean).join(' · ');
        }
      }

      if (pageMode === 'new' && !(form.lease_no ?? '').trim()) {
        const prefixKey = form.mode === 'hp' ? 'hp' : form.mode === 'lease' ? 'lease' : 'leaseOther';
        payload.lease_no = await nextRunningNo(RUNNING_PREFIX[prefixKey]);
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
      logSave('leases', data ?? id, watched.lease_no, pageMode === 'new');
      qc.invalidateQueries({ queryKey: ['lease-list'] });
      // เก็บตารางผ่อนลงตารางกลาง — ใช้ทำรายงานครบกำหนด/ค้างชำระ และแจ้งเตือนรายงวด
      void syncScheduleFor('LEASE', data?.id ?? id);
      qc.invalidateQueries({ queryKey: ['lease', id] });
      // Save happened in this session → unlock the "ส่งขออนุมัติ" button.
      setHasSavedInSession(true);
      toast.success(
        pageMode === 'new'
          ? `สร้างสัญญาแล้ว · ตารางผ่อน ${schedule.length} งวด`
          : `บันทึกสัญญาแล้ว · ตารางผ่อน ${schedule.length} งวด`,
      );
      if (pageMode === 'new') navigate(`${baseRoute}/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // แนบไฟล์ต้องมีสัญญาในระบบก่อน — ถ้ายังไม่เคยบันทึก ให้บันทึกให้อัตโนมัติแล้วค่อยแนบ
  // ใช้เส้นทางบันทึกเดิมทั้งหมด จึงผ่านการตรวจข้อมูลและออกเลขที่สัญญาให้เหมือนกดปุ่มบันทึกเอง
  const ensureLeaseId = async (): Promise<string> => {
    if (id) return id;
    if (!checkRequiredFields()) throw new Error('กรอกข้อมูลที่จำเป็นให้ครบก่อนแนบไฟล์');
    const saved: any = await save.mutateAsync(getValues());
    return saved.id as string;
  };

  // ── Rebate preview (Close Early) — outstanding pulled from HP schedule at close date ──
  const rebatePreview = useMemo(() => {
    // เดิมรองรับเฉพาะเช่าซื้อ ทำให้สัญญาเช่าเปิดหน้าต่างได้แต่กดยืนยันไม่ได้เลย
    // สัญญาเช่าไม่มีดอกเบี้ยรอตัดบัญชีและภาษีรอตัด — ยอดที่ต้องล้างจึงเหลือแค่หนี้สินคงเหลือ
    let principalOut: number;
    let interestOut: number;
    let vatOut: number;
    if (hpSchedule) {
      const paid = hpSchedule.rows.filter((r) => r.endDate <= closeDate);
      const last = paid.length ? paid[paid.length - 1] : null;
      principalOut = last ? last.endBalance : hpSchedule.totalPrincipal;
      interestOut = last ? last.deferredInterestBalance : hpSchedule.totalInterest;
      vatOut = last ? last.vatBalance : hpSchedule.totalVat;
    } else if (schedule.length > 0) {
      const paid = schedule.filter((r) => r.date <= closeDate);
      const last = paid.length ? paid[paid.length - 1] : null;
      principalOut = last ? last.endBalance : schedule[0].beginBalance;
      interestOut = 0;
      vatOut = 0;
    } else {
      return null;
    }
    const intRebate = r2((interestOut * intRebatePct) / 100);
    const vatRebate = r2((vatOut * vatRebatePct) / 100);
    const intNet = r2(interestOut - intRebate);
    const vatNet = r2(vatOut - vatRebate);
    const totalSettlement = r2(principalOut + intNet + vatNet);
    return { principalOut, interestOut, vatOut, intRebate, vatRebate, intNet, vatNet, totalSettlement };
  }, [hpSchedule, schedule, closeDate, intRebatePct, vatRebatePct]);

  const rebateSettle = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน (ต้องมี ID)');
      if (!rebatePreview) throw new Error('ยังไม่มี schedule');
      const p = rebatePreview;
      // ตอนปิดก่อนกำหนดต้องล้าง "บัญชีเดียวกับที่ตั้งไว้วันแรก" ไม่ใช่รหัสบัญชีที่ฝังไว้ตายตัว
      // (วันแรก: เครดิตหนี้สินยอดรวม · เดบิตดอกเบี้ยรอตัดบัญชีกับภาษีรอตัด)
      // เดิมฝังรหัสไว้ในโค้ด ทำให้ล้างคนละบัญชีกับที่ตั้ง ยอดจึงค้างทั้งสองฝั่งตลอดไป
      //
      // ส่วนลดที่ได้ไม่ต้องมีบรรทัดกำไรแยก เพราะหักกลบในตัวอยู่แล้ว —
      // หนี้สินที่ล้างออก (เต็มจำนวนคงเหลือ) มากกว่าเงินสดที่จ่ายจริงเท่ากับส่วนลด
      // ผลต่างจึงไหลไปลดค่าใช้จ่ายดอกเบี้ย/ภาษีที่รับรู้ในบรรทัดเดบิตด้านล่างเอง
      const gross = r2(p.principalOut + p.interestOut + p.vatOut);
      const lines = [
        { account_code: GL.leaseLiabilityLT.code, account_name: GL.leaseLiabilityLT.name, dr: gross, description: 'ล้างหนี้สินตามสัญญาคงเหลือทั้งจำนวน' },
        ...(p.interestOut > 0.005 ? [{ account_code: GL.deferredInterest.code, account_name: GL.deferredInterest.name, cr: p.interestOut, description: 'ปลดดอกเบี้ยรอตัดบัญชีที่เหลือ' }] : []),
        ...(p.vatOut > 0.005 ? [{ account_code: GL.undueVat.code, account_name: GL.undueVat.name, cr: p.vatOut, description: 'ปลดภาษีรอตัดที่เหลือ' }] : []),
        ...(p.intNet > 0.005 ? [{ account_code: GL.interestExpense.code, account_name: GL.interestExpense.name, dr: p.intNet, description: `ดอกเบี้ยที่เรียกเก็บจริงหลังส่วนลด ${intRebatePct}%` }] : []),
        ...(p.vatNet > 0.005 ? [{ account_code: GL.undueVat.code, account_name: GL.undueVat.name, dr: p.vatNet, description: `ภาษีที่เรียกเก็บจริงหลังส่วนลด ${vatRebatePct}%` }] : []),
        { account_code: GL.cash.code, account_name: GL.cash.name, cr: p.totalSettlement, description: 'จ่ายปิดสัญญาก่อนกำหนด' },
      ];
      // กันพลาด: เดบิตรวมต้องเท่ากับเครดิตรวมเสมอ
      // Dr = (P+I+V) + intNet + vatNet · Cr = I + V + (P + intNet + vatNet)
      const drSum = r2(lines.reduce((s, l: any) => s + (l.dr ?? 0), 0));
      const crSum = r2(lines.reduce((s, l: any) => s + (l.cr ?? 0), 0));
      if (Math.abs(drSum - crSum) > 0.01) {
        throw new Error(`รายการบัญชีไม่ดุล — เดบิต ${fmtMoney(drSum)} · เครดิต ${fmtMoney(crSum)}`);
      }
      const je = await createJE({
        source_type: 'LEASE_REBATE',
        source_id: id,
        je_date: closeDate,
        description: `${kindLabelOf(watched.mode)} Early Settlement (Rebate) — ${watched.lease_no}`,
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
      toast.success(`✓ ปิดสัญญาก่อนกำหนดแล้ว · ใบสำคัญ ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── ต่อสัญญา: งวดโป่งท้ายครบแล้วจ่ายไม่ไหว → ปิดสัญญาเดิม เปิดใหม่โดยยกยอดก้อนท้ายมาเป็นเงินต้น
  //    ใช้กับชนิดที่ใช้วงเงินธนาคาร เพราะเป็นชนิดที่มีงวดโป่งท้าย ──
  const rollover = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      if (watched.status !== 'Active') throw new Error('Roll Over ทำได้เฉพาะสัญญา Active');
      const balloon = r2(watched.balloon_amount ?? 0);
      if (balloon <= 0) throw new Error('สัญญานี้ไม่มี Balloon — Roll Over ไม่ได้');
      // 1) ปิดสัญญาเดิม
      await supabase.from('leases').update({ status: 'Roll Over', end_date: rolloverDate }).eq('id', id);
      // 2) create new Draft contract — Balloon becomes new principal
      const { data: newLease, error } = await supabase
        .from('leases')
        .insert({
          lease_no: await nextRunningNo(RUNNING_PREFIX[leaseMode === 'hp' ? 'hp' : 'lease']),
          ca_id: watched.ca_id ?? null,
          mode: leaseMode,   // สัญญาใหม่เป็นชนิดเดียวกับสัญญาเดิม
          use_bank_loan: true,
          contract_number: watched.contract_number ?? null,
          contract_date: rolloverDate,
          classification: watched.classification ?? 'Finance',
          payment_frequency: watched.payment_frequency ?? 'Monthly',
          payment_start_date: rolloverDate,
          payment_type: watched.payment_type ?? 'Fix Installment / Fix Installment & Step payment',
          asset_type: watched.asset_type,
          asset_name: watched.asset_name,
          vendor: watched.vendor ?? null,
          vendor_id: watched.vendor_id ?? null,
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
                  calc_interest_end: false,
          include_balloon_installment: true,
          pay_eom: watched.pay_eom ?? true,
          // สัญญาใหม่คือสัญญาเดิมที่ต่ออายุ — ข้อมูลของตัวทรัพย์ เงื่อนไขการชำระ
          // และกล่องจัดประเภทต้องตามไปด้วย ไม่งั้นผู้ใช้ต้องกรอกใหม่ทั้งชุดและมักตกหล่น
          chassis_no: watched.chassis_no ?? null,
          bank_ref: watched.bank_ref ?? null,
          upfront_payment: watched.upfront_payment ?? 0,
          grace_periods: watched.grace_periods ?? 0,
          prepaid_periods: watched.prepaid_periods ?? 0,
          prepaid_amount: (watched as any).prepaid_amount ?? 0,
          rou_useful_life: watched.rou_useful_life ?? null,
          discount_rate: watched.discount_rate ?? null,
          // ค่าเช่าแยกตามช่วงงวดใช้เฉพาะสัญญาเช่าที่ไม่ใช้สินเชื่อ — ชนิดอื่นเก็บว่างไว้
          rent_steps: leaseMode === 'other' ? ((watched.rent_steps as any) ?? null) : null,
          department_id: (watched as any).department_id ?? null,
          location_id: (watched as any).location_id ?? null,
          class_id_override: (watched as any).class_id_override ?? null,
          rpt: (watched as any).rpt ?? null,
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
      toast.success('✓ ต่อสัญญาแล้ว — เปิดสัญญาใหม่ให้ กรอกเงื่อนไขใหม่ได้เลย');
      navigate(`${baseRoute}/${newId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ประวัติการปรับปรุงมูลค่าสัญญา — มีเฉพาะสัญญาเช่าที่บันทึกสิทธิการใช้สินทรัพย์
  // เช่าซื้อใช้วิธีดอกเบี้ยรอตัดบัญชี ไม่มีเวอร์ชัน จึงไม่ต้องยิงคำถามไปที่ฐานข้อมูล
  const { data: leaseVersions = [] } = useQuery({
    queryKey: ['lease-versions', id],
    enabled: !!id && leaseMode !== 'hp',
    queryFn: async () => {
      const { data } = await supabase
        .from('lease_versions').select('*')
        .eq('lease_id', id!).order('version', { ascending: true });
      return (data ?? []) as LeaseVersion[];
    },
  });

  // ── Re-measurement (Lease Other / TFRS 16) ──
  // Excel คำนวณ ROU + Lease Liability ใหม่ → กรอกกลับ · ระบบลง JE ปรับปรุงผลต่าง + บันทึกเวอร์ชัน
  // Old book values: ใช้ principal เป็นฐาน (= ROU ตั้งต้น) · Liability = principal − upfront (= NPV)
  const lastVersion = leaseVersions.length ? leaseVersions[leaseVersions.length - 1] : null;
  const oldRou = r2(lastVersion?.rou_asset ?? watched.principal ?? 0);
  // หนี้สินตั้งต้นต้องใช้สูตรเดียวกับตอนลงบัญชีวันแรก คือหักทั้งเงินจ่ายล่วงหน้า
  // และเงินงวดท้ายที่จ่ายไปแล้ว (วันแรก: หนี้สิน = เงินต้น − จ่ายล่วงหน้า − งวดท้ายที่จ่ายแล้ว)
  // เดิมลืมหักงวดท้ายที่จ่ายแล้ว ทำให้ผลต่างและบรรทัดกำไร/ขาดทุนเพี้ยนเท่ากับเงินก้อนนั้น
  const day1LiabilityOf = (p: number, upfront: number, prepaidCash: number) => r2(p - upfront - prepaidCash);
  const oldLiability = r2(lastVersion?.lease_liability
    ?? day1LiabilityOf(watched.principal ?? 0, watched.upfront_payment ?? 0, (watched as any).prepaid_amount ?? 0));
  const remeasurePreview = useMemo(() => {
    const dRou = r2(remeasureRou - oldRou); // + = ROU up = Dr ROU
    const dLiab = r2(remeasureLiability - oldLiability); // + = liability up = Cr Liability
    const plDr = r2(dLiab - dRou); // plug to balance: + = loss (Dr), - = gain (Cr)
    return { dRou, dLiab, plDr };
  }, [remeasureRou, remeasureLiability, oldRou, oldLiability]);

  const remeasureSettle = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน (ต้องมี ID)');
      if (remeasureRou <= 0 || remeasureLiability <= 0) throw new Error('กรอก ROU และ Lease Liability ใหม่ (จาก Excel)');
      const { dRou, dLiab, plDr } = remeasurePreview;
      if (Math.abs(dRou) < 0.005 && Math.abs(dLiab) < 0.005) throw new Error('ไม่มีผลต่าง — ไม่ต้องลง JE');

      // Build balanced adjustment lines (Dr positive)
      const lines: { account_code: string; account_name: string; dr?: number; cr?: number; description?: string }[] = [];
      if (Math.abs(dRou) >= 0.005) {
        lines.push(dRou > 0
          ? { account_code: GL.asset.code, account_name: GL.asset.name, dr: dRou, description: 'Re-measure ROU increase' }
          : { account_code: GL.asset.code, account_name: GL.asset.name, cr: -dRou, description: 'Re-measure ROU decrease' });
      }
      if (Math.abs(dLiab) >= 0.005) {
        lines.push(dLiab > 0
          ? { account_code: GL.leaseLiabilityLT.code, account_name: GL.leaseLiabilityLT.name, cr: dLiab, description: 'Re-measure Lease Liability increase' }
          : { account_code: GL.leaseLiabilityLT.code, account_name: GL.leaseLiabilityLT.name, dr: -dLiab, description: 'Re-measure Lease Liability decrease' });
      }
      if (Math.abs(plDr) >= 0.005) {
        lines.push(plDr > 0
          ? { account_code: GL.remeasurePL.code, account_name: GL.remeasurePL.name, dr: plDr, description: 'Re-measurement loss' }
          : { account_code: GL.remeasurePL.code, account_name: GL.remeasurePL.name, cr: -plDr, description: 'Re-measurement gain' });
      }

      const je = await createJE({
        source_type: 'LEASE_REMEASURE',
        source_id: id,
        je_date: remeasureDate,
        description: `Lease Re-measurement — ${watched.lease_no}`,
        remark: `Reason: ${remeasureReason} · ROU ${fmtMoney(oldRou)}→${fmtMoney(remeasureRou)} · Liab ${fmtMoney(oldLiability)}→${fmtMoney(remeasureLiability)}`,
        lines,
      });
      await postJE(je.id, 'user');

      const newTerm = remeasureTerm > 0 ? remeasureTerm : (watched.term_months ?? null);
      const newRate = remeasureRate > 0 ? remeasureRate : (watched.annual_rate ?? null);

      // First Re-measurement: insert v1 = Day 1 snapshot (Origin) before inserting new version
      if (!lastVersion) {
        const day1Rou = r2(watched.principal ?? 0);
        const day1Liab = day1LiabilityOf(watched.principal ?? 0, watched.upfront_payment ?? 0, (watched as any).prepaid_amount ?? 0);
        const { error: v1Err } = await supabase.from('lease_versions').insert({
          lease_id: id,
          version: 1,
          effective_date: watched.contract_date ?? watched.start_date ?? today,
          rou_asset: day1Rou,
          lease_liability: day1Liab,
          annual_rate: watched.annual_rate ?? null,
          term_months: watched.term_months ?? null,
          pl_amount: 0,
          reason: 'Initial (Day 1 snapshot)',
          je_id: null,
        });
        if (v1Err) throw v1Err;
      }

      const nextVersion = (lastVersion?.version ?? 1) + 1;
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

      // Update the lease so the schedule re-amortizes on the new liability + terms.
      // Note: upfront_payment is preserved (audit trail of original Day 1 payment).
      // The schedule.buildSchedule call detects re-measurement via leaseVersions.length and
      // skips subtracting upfront when re-measured (because new principal = new Liability already excludes upfront).
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
      toast.success(`✓ ปรับปรุงมูลค่าสัญญาแล้ว · ใบสำคัญ ${jeNo}`);
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
  // มีงวดไหนที่มีหมายเหตุไหม — ถ้าไม่มีเลยก็ไม่ต้องโชว์คอลัมน์ให้รก
  const hasScheduleNotes = useMemo(() => schedule.some((r) => !!r.note), [schedule]);

  // ใบสำคัญตอนปิดสัญญาก่อนกำหนด — ใช้แสดงวันที่และลิงก์ในตารางประวัติสัญญา
  const { data: rebateJE = null } = useQuery({
    queryKey: ['lease-rebate-je', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries').select('id, je_number, je_date')
        .eq('source_type', 'LEASE_REBATE').eq('source_id', id!)
        .eq('status', 'Posted').eq('is_reversal', false)
        .order('je_date', { ascending: false })
        .limit(1).maybeSingle();
      return data as { id: string; je_number: string; je_date: string } | null;
    },
  });

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

  // Bank Statement reconciliation — manually linked bank_statement_lines per period.
  // ใช้เฉพาะชนิดที่ใช้วงเงินธนาคาร — Leasing Other จ่ายผ่านโมดูลเจ้าหนี้ ไม่มีรายการเดินบัญชีให้จับคู่
  const bankConfirmedFacilityType: 'HP' | 'Lease' = watched.mode === 'hp' ? 'HP' : 'Lease';
  const showBankConfirmed = watched.mode !== 'other';
  const { data: bankConfirmed } = useQuery({
    queryKey: bankConfirmedQueryKey(bankConfirmedFacilityType, id),
    enabled: !!id && showBankConfirmed,
    queryFn: () => fetchBankConfirmed(bankConfirmedFacilityType, id!),
  });

  // ค่าปรับจ่ายล่าช้าไม่ผูกกับสัญญาเช่า — บันทึกเป็นค่าใช้จ่ายแยกในระบบบัญชี ไม่ผ่านโมดูลนี้

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
  // มีเหตุการณ์เปลี่ยนแปลงสัญญาจริงไหม — ต่อมาจากใบไหน · ต่อไปเป็นใบไหน · ปิดก่อนกำหนด
  const hasContractEvents = !!rolloverLineage?.parent
    || (rolloverLineage?.children?.length ?? 0) > 0
    || watched.status === 'Closed';


  // ระบบไม่มีสถานะ "Approved" ให้เลือกเอง — ปุ่มอนุมัติจะตั้งเป็น "Active" โดยตรง
  // จึงต้องรับทั้งสองค่า ไม่งั้นปุ่มลงบัญชีวันแรกจะกดไม่ได้เลย
  const leaseApproved = watched.status === 'Approved' || watched.status === 'Active';

  const postDay1JE = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      const isHpMode = watched.mode === 'hp';
      if (isHpMode && !hpSchedule) throw new Error('มี HP schedule ก่อน');
      if (!isHpMode && schedule.length === 0) throw new Error('มี Lease schedule ก่อน');
      if (!lock.canPostJE) throw new Error(`Lease สถานะ ${watched.status} — Post JE ไม่ได้`);
      if (!leaseApproved) throw new Error(`ต้องอนุมัติสัญญาก่อนจึงจะลงบัญชีวันแรกได้ — สถานะปัจจุบัน: "${watched.status}"`);
      // นับเฉพาะใบที่ผ่านรายการแล้วและไม่ใช่ใบกลับรายการ — ให้ตรงกับตัวที่ใช้แสดงผลบนจอ
      // เดิมนับทุกใบ พอกลับรายการแล้วยังถูกนับอยู่ จึงลงบัญชีใหม่ไม่ได้อีกเลย
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'LEASE_DAY1').eq('source_id', id)
        .eq('status', 'Posted').eq('is_reversal', false);
      if (ex && ex.length > 0) throw new Error(`Day 1 JE มีอยู่แล้ว: ${ex[0].je_number}`);

      const principal = r2(watched.principal ?? 0);
      // กันใบสำคัญยอด 0 บาท — สัญญาที่ยังไม่มีจำนวนเงินไม่ควรลงบัญชีได้
      if (principal <= 0) throw new Error('จำนวนเงินของสัญญายังเป็น 0 — กรอกยอดเงินให้เรียบร้อยก่อนลงบัญชีวันแรก');
      const upfront = r2(watched.upfront_payment ?? 0);
      let lines: any[];
      let description: string;

      if (isHpMode && hpSchedule) {
        // HP: Dr Asset + Deferred Int + Undue VAT / Cr Lease Liability (gross)
        const totalInt = r2(hpSchedule.totalInterest);
        const totalVat = r2(hpSchedule.totalVat);
        const gross = r2(principal + totalInt + totalVat);
        description = `HP Inception (Day 1) — ${watched.lease_no ?? ''}`;
        lines = [
          { account_code: GL.asset.code, account_name: GL.asset.name, dr: principal, description: 'Asset / ROU at net cost' },
          ...(totalInt > 0.005 ? [{ account_code: GL.deferredInterest.code, account_name: GL.deferredInterest.name, dr: totalInt, description: 'Deferred interest (unearned)' }] : []),
          ...(totalVat > 0.005 ? [{ account_code: GL.undueVat.code, account_name: GL.undueVat.name, dr: totalVat, description: 'Undue input VAT (full term)' }] : []),
          { account_code: GL.leaseLiabilityLT.code, account_name: GL.leaseLiabilityLT.name, cr: gross, description: 'Gross HP / lease liability' },
        ];
      } else {
        // Lease Other (Bank-Credit Lease + IFRS 16) — per MoM Day 4 §1.2 + §8:
        //   ROU Asset = Lease Liability + Upfront Payment
        //   Day 1: Dr ROU / Cr Lease Liability (+ Cr Cash for Upfront if any)
        // งวดท้ายที่จ่ายไปแล้วไม่ใช่ภาระในอนาคต จึงไม่อยู่ในหนี้สิน แต่ยังอยู่ในสิทธิการใช้สินทรัพย์
        const prepaidCash = r2(watched.prepaid_amount ?? 0);
        const liability = r2(principal - upfront - prepaidCash);
        const modeLabel = kindLabelOf(watched.mode);
        description = `${modeLabel} Inception (Day 1) — ${watched.lease_no ?? ''}`;
        lines = [
          { account_code: GL.asset.code, account_name: GL.asset.name, dr: principal, description: 'ROU Asset at inception (= NPV + Upfront)' },
          { account_code: GL.leaseLiabilityLT.code, account_name: GL.leaseLiabilityLT.name, cr: liability, description: 'Lease Liability (NPV of remaining payments)' },
          ...(upfront > 0.005 ? [{ account_code: GL.cash.code, account_name: GL.cash.name, cr: upfront, description: 'Upfront payment at Day 1' }] : []),
          ...(prepaidCash > 0.005 ? [{ account_code: GL.cash.code, account_name: GL.cash.name, cr: prepaidCash, description: 'งวดท้ายที่จ่ายล่วงหน้า ณ วันแรก' }] : []),
        ];
      }

      const je = await createJE({
        source_type: 'LEASE_DAY1',
        source_id: id,
        je_date: watched.start_date ?? today,
        description,
        lines,
      });
      await postJE(je.id, 'user'); // Auto-Post to GL (align with Loan/OD/LC behavior)
      await supabase.from('leases').update({ status: 'Active' }).eq('id', id);
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-day1-posted', id] });
      qc.invalidateQueries({ queryKey: ['lease', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setValue('status', 'Active', { shouldDirty: false });
      toast.success(`✓ ลงบัญชีวันแรกแล้ว · ใบสำคัญ ${jeNo} — สัญญาเริ่มมีผล`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const postPeriodJE = useMutation({
    mutationFn: async (row: any) => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      if (!lock.canPostJE) throw new Error(`Lease สถานะ ${watched.status} — Post JE ไม่ได้`);
      // กันลงซ้ำเฉพาะใบที่ยังมีผลอยู่ — ใบที่ถูกกลับรายการแล้วต้องลงใหม่ได้
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'LEASE_PAY').eq('source_id', id).eq('source_period', row.period)
        .eq('status', 'Posted').eq('is_reversal', false);
      if (ex && ex.length > 0) throw new Error(`งวด ${row.period} มี JE แล้ว: ${ex[0].je_number}`);

      const isHpMode = watched.mode === 'hp';
      let lines: any[];
      let description: string;
      let jeDate: string;

      if (isHpMode) {
        const intr = r2(row.interest);
        const vat = r2(row.vat);
        const incVat = r2(row.totalIncVat);
        jeDate = row.endDate;
        description = `HP Payment งวด ${row.period} — ${watched.lease_no}`;
        // บัญชีที่ตัดรายงวดต้องเป็นบัญชีเดียวกับที่ตั้งไว้ตอนลงบัญชีวันแรก ไม่งั้นยอดจะไม่มีวันปลด
        //
        // วันแรกเครดิตหนี้สินยอดรวม (เงินต้น+ดอกเบี้ย+ภาษี) ไว้ที่บัญชีเดียว
        // แต่รายงวดเดิมไปเดบิตบัญชี "ส่วนที่ถึงกำหนดใน 1 ปี" ซึ่งไม่เคยมีรายการโอนมาตั้งยอดให้
        // ผลคือบัญชีหนึ่งค้างเครดิต อีกบัญชีค้างเดบิตตลอดไป — เช่นเดียวกับดอกเบี้ยรอตัดบัญชี
        //
        // จึงตัดที่บัญชีเดียวกับวันแรก และตัดด้วยยอดรวมทั้งงวด (เงินต้น+ดอกเบี้ย+ภาษี)
        // เพราะยอดที่ตั้งไว้วันแรกเป็นยอดรวม ไม่ใช่เฉพาะเงินต้น
        //
        // บรรทัดโอนประเภทดอกเบี้ยรอตัดบัญชีถูกตัดทิ้ง เพราะพอใช้บัญชีเดียวกันแล้ว
        // มันเดบิตและเครดิตบัญชีเดียวกันด้วยจำนวนเท่ากัน = ไม่มีผลใดๆ เหลือไว้แค่บรรทัดปลดยอด
        //
        // ภาษีซื้อที่รอตัด: ปลดออกแล้วตั้งเป็นภาษีซื้อที่ขอคืนได้ในบัญชีเดียวกัน
        // (เดบิตกับเครดิตเท่ากันจึงหักกลบหมด ไม่ต้องมีบรรทัด — ยอดคงอยู่ที่บัญชีภาษีซื้อตามเดิม)
        lines = [
          { account_code: GL.leaseLiabilityLT.code, account_name: GL.leaseLiabilityLT.name, dr: incVat, description: 'ตัดหนี้สินตามสัญญาเช่าซื้อของงวดนี้ (รวมดอกเบี้ยและภาษีที่ตั้งไว้วันแรก)' },
          ...(intr > 0.005 ? [{ account_code: GL.interestExpense.code, account_name: GL.interestExpense.name, dr: intr, description: 'รับรู้ดอกเบี้ยเป็นค่าใช้จ่ายงวดนี้' }] : []),
          ...(intr > 0.005 ? [{ account_code: GL.deferredInterest.code, account_name: GL.deferredInterest.name, cr: intr, description: 'ปลดดอกเบี้ยรอตัดบัญชีของงวดนี้' }] : []),
          { account_code: GL.apLeasing.code, account_name: GL.apLeasing.name, cr: incVat, description: `เจ้าหนี้ผู้ให้เช่าซื้อ (รวมภาษี ${fmtMoney(vat)})` },
        ];
      } else {
        // Lease Other (Bank-Credit Lease + IFRS 16) per MoM Day 4 §8:
        //   Hire Purchase / Leasing — ใช้วงเงินธนาคาร ตัดเงินสดโดยตรง
        //   Leasing Other      — ตั้งเจ้าหนี้ค่าเช่า ส่งให้โมดูลเจ้าหนี้หักภาษี ณ ที่จ่าย 3%
        const prin = r2(row.principal);
        const intr = r2(row.interest);
        const pay = r2(row.payment);
        jeDate = row.date;
        // ใช้วงเงินธนาคาร → ตัดเงินสดโดยตรง · ไม่ใช้วงเงิน → ตั้งเจ้าหนี้แล้วให้โมดูลเจ้าหนี้หักภาษี ณ ที่จ่าย
        const useBank = watched.mode !== 'other';
        const modeLabel = useBank ? 'Lease (ใช้สินเชื่อ)' : 'Lease (ไม่ใช้สินเชื่อ)';
        description = `${modeLabel} Payment งวด ${row.period} — ${watched.lease_no}`;
        const crGL = useBank
          ? { code: GL.cash.code, name: GL.cash.name }
          : { code: GL.apLeasing.code, name: GL.apLeasing.name };
        const crDesc = useBank
          ? 'ตัดชำระโดยตรง (Bank Statement)'
          : 'ส่งไป NetSuite AP Module — WHT 3% applied at AP';
        lines = [
          { account_code: GL.leaseLiabilityLT.code, account_name: GL.leaseLiabilityLT.name, dr: prin, description: 'ลด Lease Liability (Principal portion)' },
          ...(intr > 0.005 ? [{ account_code: GL.interestExpense.code, account_name: GL.interestExpense.name, dr: intr, description: 'Lease interest expense (รับรู้ดอกเบี้ย)' }] : []),
          { account_code: crGL.code, account_name: crGL.name, cr: pay, description: crDesc },
        ];
      }

      const je = await createJE({
        source_type: 'LEASE_PAY',
        source_id: id,
        source_period: row.period,
        je_date: jeDate,
        description,
        lines,
      });
      await postJE(je.id, 'user'); // Auto-Post to GL (align with Loan/OD/LC behavior)
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-pay-periods', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ ลงบัญชีค่างวดแล้ว · ใบสำคัญ ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── ROU Asset depreciation (straight-line)
  // ROU initial = net cost / principal; useful life falls back to lease term.
  const rouUsefulLife = (watched.rou_useful_life && watched.rou_useful_life > 0)
    ? watched.rou_useful_life
    : (watched.term_months ?? 0);
  // ROU initial = latest lease_versions.rou_asset if Re-measured, otherwise watched.principal.
  // (After Re-measurement, principal stores new Liability, not new ROU — they can differ.)
  const rouInitialAmount = useMemo(() => {
    if (leaseVersions.length > 0) {
      const latest = leaseVersions[leaseVersions.length - 1];
      return latest?.rou_asset ?? watched.principal ?? 0;
    }
    return watched.principal ?? 0;
  }, [leaseVersions, watched.principal]);
  const rouDepr = useMemo(() => buildRouDepreciation({
    rouInitial: rouInitialAmount,
    usefulLifeMonths: rouUsefulLife,
    startDate: watched.start_date ?? today,
    payEom: watched.pay_eom,
  }), [rouInitialAmount, rouUsefulLife, watched.start_date, watched.pay_eom, today]);

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
      if (!lock.canPostJE) throw new Error(`Lease สถานะ ${watched.status} — Post JE ไม่ได้`);
      // กันลงซ้ำเฉพาะใบที่ยังมีผลอยู่ — ใบที่ถูกกลับรายการแล้วต้องลงใหม่ได้
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'LEASE_DEPR').eq('source_id', id).eq('source_period', row.period)
        .eq('status', 'Posted').eq('is_reversal', false);
      if (ex && ex.length > 0) throw new Error(`ค่าเสื่อมงวด ${row.period} มี JE แล้ว: ${ex[0].je_number}`);
      const dep = r2(row.depreciation);
      const je = await createJE({
        source_type: 'LEASE_DEPR',
        source_id: id,
        source_period: row.period,
        je_date: row.date,
        description: `ROU Depreciation งวด ${row.period} — ${watched.lease_no}`,
        lines: [
          { account_code: GL.depreciationExpense.code, account_name: GL.depreciationExpense.name, dr: dep, description: 'Straight-line ROU depreciation' },
          { account_code: GL.accumDepRou.code, account_name: GL.accumDepRou.name, cr: dep, description: 'Accumulated depreciation — ROU' },
        ],
      });
      await postJE(je.id, 'user'); // Auto-Post to GL (align with Loan/OD/LC behavior)
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-depr-periods', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ ลงบัญชีค่าเสื่อมแล้ว · ใบสำคัญ ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Asset Transfer — post Dr <to> / Cr <from> at NBV + log the event.
  const assetTransfer = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึกสัญญาก่อน');
      const sc = ASSET_TRANSFERS.find((s) => s.key === transferKey)!;
      const amt = r2(transferAmount);
      if (amt <= 0) throw new Error('กรอกมูลค่าโอน (NBV) มากกว่า 0');
      const drGl = (HP_GL as any)[sc.drGl];
      const crGl = (HP_GL as any)[sc.crGl];
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
      await postJE(je.id, 'user'); // Auto-Post to GL (align with Loan/OD/LC behavior)
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
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lease-asset-transfers', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setShowTransfer(false);
      toast.success(`✓ โอนสินทรัพย์แล้ว · ใบสำคัญ ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // สัญญาเช่า 3 ชนิด
  //   isHP        Hire Purchase — ดอกเบี้ยรอตัดบัญชี · กรรมสิทธิ์โอนให้ผู้เช่าซื้อ
  //   isRou       Leasing + Leasing Other — บันทึกเป็นสิทธิการใช้สินทรัพย์
  //   usesCredit  Hire Purchase + Leasing — ใช้วงเงินธนาคาร ต้องมี Credit Agreement
  const isHP = watched.mode === 'hp';
  const isOther = watched.mode === 'other';
  const isRou = !isHP;
  const usesCredit = !isOther;
  const kindLabel = kindLabelOf(watched.mode);
  // เงินก้อนท้ายถูกคิดในตารางจริงหรือไม่ — ปุ่มต่อสัญญาและข้อความเตือนใช้ค่านี้ตัวเดียวกัน
  //   เช่าซื้อ  ตัวสร้างตารางคิดให้เฉพาะเมื่อรูปแบบการชำระเป็นแบบที่มีเงินก้อนท้าย (มีคำว่า Balloon)
  //   อีก 2 ชนิด ใส่ยอดแล้วคิดรวมในงวดสุดท้ายให้เสมอ — ตัวเลขในช่องคือสวิตช์ในตัว
  const balloonAmount = watched.balloon_amount ?? 0;
  const balloonActive =
    balloonAmount > 0 && (!isHP || (watched.payment_type ?? '').toLowerCase().includes('balloon'));
  // ใส่ยอดไว้แต่รูปแบบการชำระไม่รองรับ → ระบบไม่ได้นำไปคิด ต้องบอกให้รู้บนจอ
  const balloonIgnored = balloonAmount > 0 && !balloonActive;
  // ตัวอย่างเลขที่ให้ตรงกับชุดเลขที่ระบบสร้างจริงของชนิดนั้น
  const noPrefix = isHP ? 'HP' : isOther ? 'LSO' : 'LSE';
  // รูปแบบการโอนทรัพย์สินที่เลือกได้ ขึ้นกับชนิดสัญญา
  //   ครบสัญญาแล้วซื้อต่อ  = รูปแบบของเช่าซื้อ
  //   ที่ดินอาคารอุปกรณ์ → อสังหาฯ เพื่อการลงทุน = ทรัพย์สินที่บริษัทเป็นเจ้าของเอง ไม่เกี่ยวกับสัญญาเช่านี้
  // รูปแบบการโอนที่เลือกได้
  //   ตัด PPE_IP ทุกกรณี — เป็นการย้ายประเภททรัพย์สินที่บริษัทเป็นเจ้าของเอง ไม่เกี่ยวกับสัญญาเช่านี้
  //   ถ้าทรัพย์สินเป็นยานพาหนะ ตัดการโอนไปอสังหาริมทรัพย์เพื่อการลงทุนออกด้วย เพราะรถไม่ใช่อสังหาริมทรัพย์
  const transferOptions = ASSET_TRANSFERS.filter((t) => {
    if (t.key === 'PPE_IP') return false;
    if (t.key === 'ROU_IP' && watched.asset_type === 'ยานพาหนะ') return false;
    return true;
  });
  // ประเภททรัพย์สินที่เลือกได้ ขึ้นกับชนิดสัญญา
  //   Hire Purchase · Leasing = ทรัพย์สินที่เคลื่อนย้ายได้ (เช่าซื้อรถ เครื่องจักร)
  //   Leasing Other           = อสังหาริมทรัพย์และอุปกรณ์ที่เช่าใช้
  const ASSET_TYPES = isOther
    ? ['อาคาร / ที่ดิน', 'สำนักงาน', 'อุปกรณ์'] as const
    : ['ยานพาหนะ', 'อุปกรณ์'] as const;
  // ค้นรถจากคลัง NetSuite ได้เฉพาะสัญญาที่ใช้วงเงินธนาคาร — Leasing Other ไม่ผูกรถ
  const isVehicleAsset = usesCredit && (isHP || watched.asset_type === 'ยานพาหนะ');

  return (
    <ScopeGuard skip={pageMode === 'new'} subsidiary={pageMode === 'edit' && !existing ? undefined : ((watched as any).subsidiary ?? null)}>
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(baseRoute)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {pageMode === 'new' ? 'New Lease' : existing?.lease_no ?? 'Loading...'}
          </h1>
          <div className="text-muted text-sm flex items-center gap-2">
            {isHP ? 'Hire Purchase — เช่าซื้อ · กรรมสิทธิ์โอนเมื่อผ่อนครบ'
              : isOther ? 'Leasing Other — สัญญาเช่าอื่น · ไม่ใช้วงเงินธนาคาร'
                : 'Leasing — เช่า · ใช้วงเงินธนาคาร · กรรมสิทธิ์เป็นของผู้ให้เช่า'}
            <Badge variant={watched.status === 'Active' ? 'success' : watched.status === 'Approved' ? 'brand' : watched.status === 'Draft' ? 'default' : 'warn'}>{watched.status}</Badge>
          </div>
        </div>
        {/* Approve button removed — use Status dropdown (Draft → Approved manually) to match Loan/LC pattern */}
        {/* ปิดสัญญาก่อนกำหนดทำได้ทั้ง 3 ชนิด — สัญญาเช่าก็เลิกกลางคันได้เหมือนกัน
            ต่างกันแค่สัญญาเช่าไม่มีดอกเบี้ยรอตัดบัญชี/ภาษีรอตัดให้ขอส่วนลด */}
        <span className="relative inline-flex">
          <Button
            variant="outline"
            disabled={!id || watched.status !== 'Active' || !can(menuKey, 'approve')}
            title={
              !id ? 'Save ก่อน'
                : !can(menuKey, 'approve') ? 'ต้องมีสิทธิ์ Approve'
                  : watched.status !== 'Active' ? `Close Early ทำได้เฉพาะสัญญา Active — ตอนนี้: ${watched.status}`
                    : 'ปิดสัญญาก่อนกำหนด (Rebate)'
            }
            onClick={() => { setCloseDate(today); setShowRebate(true); }}
          >
            🔚 Close Early (Rebate)
          </Button>
          {/* วางเครื่องหมายคำถามชิดมุมขวาบนของปุ่ม จะได้ไม่ลอยห่างจนดูเป็นคนละชิ้น */}
          <span className="absolute -top-1.5 -right-1.5">
            <CbTip k="BTN CLOSE EARLY" />
          </span>
        </span>
        {usesCredit && (
          <span className="relative inline-flex">
          <Button
            variant="outline"
            disabled={!id || watched.status !== 'Active' || !balloonActive || !can(menuKey, 'approve')}
            title={
              !id ? 'Save ก่อน'
                : !can(menuKey, 'approve') ? 'ต้องมีสิทธิ์ Approve'
                  : watched.status !== 'Active' ? 'Roll Over ทำได้เฉพาะสัญญา Active'
                    : balloonIgnored ? 'ใส่ยอด Balloon ไว้ แต่รูปแบบการชำระที่เลือกไม่รองรับ ระบบจึงไม่ได้คิดยอดนี้ในตารางผ่อน — เลือกรูปแบบการชำระแบบ (Balloon) ก่อน'
                      : balloonAmount <= 0 ? 'สัญญานี้ไม่มี Balloon'
                        : 'Roll Over (Balloon → สัญญาใหม่)'
            }
            onClick={() => { setRolloverDate(today); setRolloverTerm(watched.term_months ?? 12); setRolloverRate(watched.annual_rate ?? 0); setShowRollover(true); }}
          >
            🔁 Roll Over
          </Button>
            {/* วางเครื่องหมายคำถามชิดมุมขวาบนของปุ่ม จะได้ไม่ลอยห่างจนดูเป็นคนละชิ้น */}
            <span className="absolute -top-1.5 -right-1.5">
              <CbTip k="BTN ROLL OVER" />
            </span>
          </span>
        )}
        {isRou && (
          <span className="relative inline-flex">
          <Button
            variant="outline"
            disabled={!id || (watched.status !== 'Active' && watched.status !== 'Modified') || !can(menuKey, 'approve')}
            title={
              !id ? 'Save ก่อน'
                : !can(menuKey, 'approve') ? 'ต้องมีสิทธิ์ Approve'
                  : (watched.status !== 'Active' && watched.status !== 'Modified') ? `Re-measurement ทำได้เฉพาะสัญญา Active/Modified — ตอนนี้: ${watched.status}`
                    : 'Re-measurement — กรอกผลจาก Excel'
            }
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
            {/* วางเครื่องหมายคำถามชิดมุมขวาบนของปุ่ม จะได้ไม่ลอยห่างจนดูเป็นคนละชิ้น */}
            <span className="absolute -top-1.5 -right-1.5">
              <CbTip k="BTN RE-MEASUREMENT" />
            </span>
          </span>
        )}
        {/* โอนเปลี่ยนประเภทสินทรัพย์เป็นเรื่องของสิทธิการใช้สินทรัพย์
            เช่าซื้อฝั่งทรัพย์สินอยู่ที่ทะเบียนทรัพย์สินใน NetSuite จึงไม่มีปุ่มนี้ */}
        {isRou && (
          <span className="relative inline-flex">
            <Button
              variant="outline"
              disabled={!id || (watched.status !== 'Active' && watched.status !== 'Modified') || !can(menuKey, 'approve')}
              title={
                !id ? 'Save ก่อน'
                  : !can(menuKey, 'approve') ? 'ต้องมีสิทธิ์ Approve'
                    : (watched.status !== 'Active' && watched.status !== 'Modified') ? `Asset Transfer ทำได้เฉพาะสัญญา Active/Modified — ตอนนี้: ${watched.status}`
                      : 'โอนเปลี่ยนประเภทสินทรัพย์'
              }
              onClick={() => {
                setTransferKey(transferOptions[0].key);
                setTransferDate(today);
                // ค่าตั้งต้น = มูลค่าคงเหลือ = ยอดตั้งต้น − ค่าเสื่อมที่ลงบัญชีไปแล้ว
                const posted = postedDeprPeriods?.size ?? 0;
                const nbv = Math.max(0, rouInitialAmount - posted * rouDepr.monthlyDepreciation);
                setTransferAmount(r2(nbv));
                setTransferNote('');
                setShowTransfer(true);
              }}
            >
              📦 Asset Transfer
            </Button>
            {/* วางเครื่องหมายคำถามชิดมุมขวาบนของปุ่ม */}
            <span className="absolute -top-1.5 -right-1.5">
              <CbTip k="BTN ASSET TRANSFER" />
            </span>
          </span>
        )}
        <Button variant="primary" disabled={!isDirty || save.isPending || !can(menuKey, 'edit')} title={!can(menuKey, 'edit') ? 'ไม่มีสิทธิ์แก้ไขสัญญาเช่า' : ''} onClick={handleSubmit((d) => { if (checkRequiredFields()) save.mutate(d); })}>
          <Save className="w-4 h-4" /> {save.isPending ? 'กำลังบันทึก...' : 'Save'}
        </Button>
      </div>

      <AuditFooter createdBy={(existing as any)?.created_by} createdAt={(existing as any)?.created_at} updatedBy={(existing as any)?.updated_by} updatedAt={(existing as any)?.updated_at} />

      <StatusLockBanner lock={lock} />

      {id && (
        <ApprovalPanel
          facilityTable="leases"
          facilityId={id}
          menuKeyOverride={menuKey}
          currentStatus={(watched.status ?? 'Draft') as string}
          statusField="status"
          approvedValue="Active"
          disableSubmit={!hasSavedInSession}
          disableSubmitHint="กรุณากด Save ก่อน (เพื่อยืนยันว่าตรวจข้อมูลแล้ว) แล้วจึงส่งขออนุมัติได้"
        />
      )}

      {/* สัญญาที่จบไปแล้วต้องล็อกช่องกรอกตั้งแต่เปิดหน้า ตามที่แถบเตือนด้านบนแจ้งไว้
          ไม่ใช่ปล่อยให้พิมพ์ได้จนกดบันทึกแล้วค่อยฟ้อง — เสียเวลากรอกฟรี
          (ช่องสถานะยกเว้นไว้ด้านล่าง เพราะต้องย้อนสถานะกลับมาแก้ไขได้) */}
      <ReadOnlyContext.Provider value={viewOnly || !savedLock.canEditFields}>
      <div className="space-y-0">
        {/* ── Primary Information ── */}
        <Section title="Primary Information">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel required tipKey="LEASE COMPANY NAME">
                {isOther ? 'LESSOR (ผู้ให้เช่า)' : 'FINANCE INSTITUTION'}
              </FieldLabel>
              {isOther ? (
                // ไม่ใช้วงเงินธนาคาร → ผู้ให้เช่าดึงจากทะเบียนคู่ค้าใน NetSuite
                // Only show vendor name if linked via vendor_id (i.e., picked from lookup) —
                // legacy text data (without vendor_id) is hidden to encourage re-pick from NetSuite.
                <div className="flex gap-2">
                  <Input
                    value={watched.vendor_id ? (watched.vendor ?? '') : ''}
                    readOnly
                    placeholder="คลิก 🔍 เพื่อ Lookup Lessor"
                    className="bg-gray-50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setVendorLookupOpen(true)}
                    title="Lookup Lessor จาก NetSuite Vendor Master"
                  >
                    🔍
                  </Button>
                </div>
              ) : (
                <Select {...register('vendor')}>
                  <option value="">— เลือกสถาบันการเงิน —</option>
                  {bankCodes.map((b) => <option key={b} value={b}>{b}</option>)}
                  {watched.vendor && !(bankCodes as readonly string[]).includes(watched.vendor) && (
                    <option value={watched.vendor}>{watched.vendor}</option>
                  )}
                </Select>
              )}
              {isOther && watched.vendor_id && (
                <p className="text-[10px] text-success mt-0.5 italic">
                  ✓ ผูก vendor_id แล้ว (ดึงจาก NetSuite Vendor Master)
                </p>
              )}
              {usesCredit && (
                <p className="text-xs text-muted mt-0.5 italic">ค่าเริ่มต้นดึงจาก Credit Agreement — แก้ได้</p>
              )}
            </div>
            {/* Leasing Other ไม่ใช้วงเงินธนาคาร จึงเปิดสัญญาได้เลยโดยไม่ต้องมีวงเงิน
                วางไว้ติดกับช่องสถาบันการเงิน เพราะเลือกช่องนี้แล้วช่องบนจะเติมตาม — อยู่ห่างกันคนละมุมจอจะไม่เห็นความเชื่อมโยง */}
            {usesCredit && (
              <div>
                <FieldLabel required>CREDIT AGREEMENT NAME</FieldLabel>
                <Select
                  {...register('ca_id')}
                  onChange={async (e) => {
                    register('ca_id').onChange(e);
                    const caId = e.target.value;
                    if (!caId) return;
                    const cc = await fetchCaCards(caId);
                    // ธนาคารตามวงเงิน — เขียนทับเฉพาะตอนที่ยังว่าง เพื่อไม่ลบค่าที่ผู้ใช้ตั้งเอง
                    if (cc.fi && !watched.vendor) setValue('vendor', cc.fi, { shouldDirty: true });
                    // บริษัทเจ้าของสัญญามาจากวงเงินเสมอ — ผู้ใช้แก้เองไม่ได้
                    const ca = caOptions.find((c) => c.id === caId);
                    setValue('subsidiary' as any, ca?.subsidiary ?? null, { shouldDirty: true });
                    if (cc.acct_cards.length === 0 || acctCards.length > 0) return;
                    setAcctCards(cc.acct_cards as AcctCard[]);
                  }}
                >
                  <option value="">— เลือก —</option>
                  {caOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.ca_name}</option>
                  ))}
                </Select>
              </div>
            )}

            {/* บริษัทเจ้าของสัญญา
                ผูกวงเงิน  → ดึงจากวงเงิน แก้ไม่ได้ (ตามเอกสารความต้องการที่ระบุว่าห้ามแก้ที่รายการ)
                ไม่ผูกวงเงิน → เลือกเอง บังคับกรอก เพราะไม่มีต้นทางให้ดึง
                              และค่าเช่าต้องลงเป็นค่าใช้จ่ายของบริษัทใดบริษัทหนึ่ง
                              ใบสำคัญที่ส่งไประบบบัญชีปลายทางก็ต้องแนบรหัสบริษัท */}
            <div>
              <FieldLabel required>SUBSIDIARY</FieldLabel>
              {isOther ? (
                // ส่งค่าเข้าไปเอง ไม่ผูกผ่าน register — ไม่งั้นตัวกลางจะตกไปใช้
                // ช่องเลือกพื้นฐานของเบราว์เซอร์ ซึ่งคุมความสูงรายการไม่ได้
                // 16 บริษัทจะกางยาวเต็มจอ เลื่อนดูลำบาก
                <Select
                  value={(watched as any).subsidiary ?? ''}
                  onChange={(e) => setValue('subsidiary' as any, e.target.value || null, { shouldDirty: true })}
                >
                  <option value="">— เลือก —</option>
                  {mySubCodes.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              ) : (
                <Input
                  readOnly
                  value={(watched as any).subsidiary ?? ''}
                  placeholder="เลือกวงเงินก่อน"
                  className="bg-gray-50"
                />
              )}
              <p className="text-xs text-muted mt-0.5 italic">
                {isOther ? 'บริษัทที่เช่าและรับรู้ค่าใช้จ่าย' : 'ดึงจากวงเงินที่เลือก — แก้ที่นี่ไม่ได้'}
              </p>
            </div>
            <div>
              <FieldLabel>LEASE ID</FieldLabel>
              <Input readOnly value={id ?? 'auto (สร้างเมื่อ Save)'} className="bg-gray-50 text-muted" />
            </div>
            <div>
              <FieldLabel required>LEASE NAME</FieldLabel>
              <Input {...register('lease_no')} placeholder={`MGC-${noPrefix}-2026-001`} />
              {errors.lease_no && <p className="text-xs text-danger mt-1">{errors.lease_no.message}</p>}
            </div>
            <div>
              <FieldLabel required>MODE</FieldLabel>
              <input type="hidden" {...register('mode')} />
              <Input readOnly value={kindLabel} className="bg-gray-50 text-muted" />
              <p className="text-xs text-muted mt-0.5 italic">
                กำหนดจากเมนูที่เข้ามา — เปลี่ยนชนิดภายหลังไม่ได้
              </p>
            </div>
            <div>
              <FieldLabel required>STATUS</FieldLabel>
              {/* Note: 'Approved' removed — Approval Panel now owns that transition. */}
              {/* ช่องสถานะต้องแก้ได้เสมอแม้สัญญาจะจบไปแล้ว ไม่งั้นย้อนสถานะกลับมาแก้ไขไม่ได้เลย */}
              <ReadOnlyContext.Provider value={viewOnly}>
                <Select {...register('status')}>
                  {filterStatusOptions(
                    ['Draft', 'Pending Approval', 'Active', 'Closed', 'Modified', 'Cancelled', ...(leaseMode === 'hp' ? ['Roll Over'] : [])],
                    watched.status, rawCan(menuKey, 'approve'), 'Active',
                  ).map((st) => <option key={st}>{st}</option>)}
                </Select>
              </ReadOnlyContext.Provider>
              <div className="mt-2">
                <ApprovalActions menuKey={menuKey} table="leases" id={id}
                  status={watched.status} approvedStatus="Active" rejectStatus="Cancelled"
                  onChanged={(st) => {
                    setValue('status', st as any, { shouldDirty: false });
                    // ผู้อนุมัติเพิ่งเขียนเหตุผลต่อท้ายหมายเหตุในฐานข้อมูล — ต้องดึงกลับมาแสดงทันที
                    // ไม่งั้นค่าบนจอจะเป็นของเก่า แล้วการบันทึกครั้งถัดไปจะเขียนทับข้อความนั้น
                    qc.invalidateQueries({ queryKey: ['lease', id] });
                  }} />
              </div>
              <ApprovalNote remark={watched.remark ?? null} />
            </div>
            <div>
              <FieldLabel required>ASSET TYPE</FieldLabel>
              <Select {...register('asset_type')}>
                {ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}
                {/* ข้อมูลเก่าที่ประเภทไม่อยู่ในรายการของชนิดนี้ ยังต้องแสดงได้ ไม่งั้นค่าจะหายตอนบันทึก */}
                {watched.asset_type && !ASSET_TYPES.includes(watched.asset_type as any) && (
                  <option>{watched.asset_type}</option>
                )}
              </Select>
            </div>
            <div>
              <div className="flex items-end justify-between gap-2 mb-1">
                <FieldLabel required>ASSET NAME</FieldLabel>
                {isVehicleAsset ? (
                  <button
                    type="button"
                    onClick={() => setShowChassisLookup(true)}
                    className="text-[11px] text-brand hover:underline flex items-center gap-1"
                    title="Lookup จาก NetSuite Inventory"
                  >
                    <Search className="w-3 h-3" /> Lookup Chassis
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowFALookup(true)}
                    className="text-[11px] text-brand hover:underline flex items-center gap-1"
                    title="Lookup จาก NetSuite Fixed Asset Master"
                  >
                    <Search className="w-3 h-3" /> Lookup NS FA
                  </button>
                )}
              </div>
              <Input {...register('asset_name')} placeholder={isVehicleAsset ? 'BMW 320i 2026' : 'อาคารสำนักงาน ชั้น 10 / ที่ดินโฉนด 12345'} />
              {errors.asset_name && <p className="text-xs text-danger mt-1">{errors.asset_name.message}</p>}
              {linkedAssetNo && (
                <p className="text-[10px] text-emerald-700 mt-0.5">
                  ✓ Linked to NetSuite FA <code className="bg-emerald-50 px-1 rounded">{linkedAssetNo}</code>
                </p>
              )}
              {linkedChassisNo && (
                <p className="text-[10px] text-emerald-700 mt-0.5">
                  ✓ Linked to NetSuite Chassis <code className="bg-emerald-50 px-1 rounded">{linkedChassisNo}</code>
                </p>
              )}
            </div>
            {/* เลขตัวถัง — ใช้กับสัญญาที่ผูกรถ ทั้งเช่าซื้อและเช่า เพราะเลขนี้ต้องติดไปกับรายการบัญชี
                ถ้ารถยังมาไม่ถึงให้ใส่ 000 ไว้ก่อน ห้ามปล่อยว่าง แล้วกลับมาแก้เมื่อได้เลขจริง */}
            {isVehicleAsset && (
              <div>
                <FieldLabel required tipKey="CHASSIS NO.">CHASSIS NO.</FieldLabel>
                <Input {...register('chassis_no')} placeholder="ใส่ 000 ไว้ก่อนถ้ารถยังมาไม่ถึง" />
              </div>
            )}
            <div>
              <FieldLabel required>CONTRACT NUMBER</FieldLabel>
              <Input {...register('contract_number')} placeholder={`${noPrefix}-2026-001`} />
            </div>
            {/* เลขอ้างอิงที่ธนาคารออกให้ — Leasing Other ไม่มีธนาคารเกี่ยวข้อง จึงไม่มีเลขนี้ */}
            {usesCredit && (
              <div>
                <FieldLabel required tipKey="BANK REFERENCE">BANK REFERENCE</FieldLabel>
                <Input {...register('bank_ref')} placeholder="MCL 11 หลัก (SCB) · หรือเลขที่ธนาคารให้" />
              </div>
            )}
            <div>
              <FieldLabel required>CONTRACT DATE</FieldLabel>
              <Input type="date" {...register('contract_date')} />
            </div>
            {/* ระบบคำนวณดอกเบี้ยรายเดือน (อัตราต่อปีหาร 12) ตามที่ตกลงกัน
                เช่าซื้อรองรับความถี่อื่นได้จริง · สัญญาเช่าคิดรายเดือนอย่างเดียว จึงไม่ต้องมีให้เลือก */}
            {isHP && (
              <div>
                <FieldLabel required>PAYMENT FREQUENCY</FieldLabel>
                <Select {...register('payment_frequency')}>
                  <option>Monthly</option>
                  <option>Quarterly</option>
                  <option>Yearly</option>
                </Select>
              </div>
            )}
            {/* Leasing Other ใช้อัตราคิดลดช่องเดียวในการหามูลค่าปัจจุบัน ไม่มีอัตราดอกเบี้ยตามสัญญาแยก */}
            {usesCredit && (
              <div>
                <FieldLabel required>CONTRACT INTEREST RATE (%)</FieldLabel>
                <NumInput value={watched.annual_rate ?? 0} onChange={(v) => setValue('annual_rate', v, { shouldDirty: true })} step="0.01" />
                <p className="text-xs text-muted mt-0.5 italic">อัตราดอกเบี้ยตามสัญญาที่ธนาคารกำหนด</p>
              </div>
            )}

            {isHP && (
              <>
                <div>
                  <FieldLabel required>VEHICLE PRICE</FieldLabel>
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

            {/* ช่วงปลอดชำระใช้ได้ทุกชนิด — รูปแบบการชำระมีตัวเลือกที่ต้องระบุจำนวนงวดปลอดชำระ */}
            <div>
              <FieldLabel>GRACE PERIOD (MONTHS)</FieldLabel>
              <NumInput value={watched.grace_periods ?? 0} onChange={(v) => setValue('grace_periods', v, { shouldDirty: true })} />
              <p className="text-xs text-muted mt-0.5 italic">จำนวนงวดต้นสัญญาที่ยังไม่ต้องชำระ — ใช้กับรูปแบบการชำระที่มีช่วงปลอดชำระ</p>
            </div>
            {isRou && (
              <>
                <div>
                  <FieldLabel>UPFRONT PAYMENT</FieldLabel>
                  <NumInput value={watched.upfront_payment ?? 0} onChange={(v) => setValue('upfront_payment', v, { shouldDirty: true })} step="0.01" />
                </div>
                <div>
                  <FieldLabel>PREPAID PERIODS</FieldLabel>
                  <NumInput value={watched.prepaid_periods ?? 0} onChange={(v) => setValue('prepaid_periods', v, { shouldDirty: true })} />
                  <p className="text-xs text-muted mt-0.5 italic">จำนวนงวดท้ายที่จ่ายไปแล้วตั้งแต่วันแรก</p>
                </div>
                <div>
                  <FieldLabel>PREPAID AMOUNT</FieldLabel>
                  <NumInput value={watched.prepaid_amount ?? 0} onChange={(v) => setValue('prepaid_amount', v, { shouldDirty: true })} step="0.01" />
                  <p className="text-xs text-muted mt-0.5 italic">เงินก้อนนั้น — ไม่อยู่ในหนี้สิน แต่รวมอยู่ในสิทธิการใช้สินทรัพย์</p>
                </div>
              </>
            )}

            <div className="md:col-span-3">
              <FieldLabel>NOTE</FieldLabel>
              {/* ช่องนี้เป็น textarea ดิบ จึงไม่รับโหมดดูอย่างเดียวจากส่วนกลางเหมือนช่องอื่น
                  ต้องปิดการพิมพ์เอง ไม่งั้นโหมดดูอย่างเดียวยังแก้หมายเหตุได้ */}
              <textarea maxLength={2000}
                className="input min-h-[70px] disabled:bg-gray-50 disabled:text-muted disabled:cursor-not-allowed"
                disabled={viewOnly || !savedLock.canEditFields}
                {...register('remark')}
              />
              <CharCount value={watched?.remark ?? ''} max={2000} />
            </div>
          </div>
        </Section>

        {/* ========== Classification (Financial Segment) — Migration 0049-0051 ========== */}
        <Section title="Classification">
          <ClassificationCard
            level="transaction"
            department={(watched as any).department_id ? { id: (watched as any).department_id, code: (watched as any).department_code ?? '', name: (watched as any).department_name ?? '' } : null}
            location={(watched as any).location_id ? { id: (watched as any).location_id, code: (watched as any).location_code ?? '', name: (watched as any).location_name ?? '' } : null}
            klass={(watched as any).class_id_override ? { id: (watched as any).class_id_override, code: (watched as any).class_code ?? '', name: (watched as any).class_name ?? '' } : null}
            rpt={(watched as any).rpt ?? null}
            lenderVendorId={(watched as any).finance_institution_id ?? null}
            inherited={inheritedSeg}
            onDepartmentChange={(v) => { setValue('department_id' as any, v?.id ?? null, { shouldDirty: true }); setValue('department_code' as any, v?.code ?? null); setValue('department_name' as any, v?.name ?? null); }}
            onLocationChange={(v) => { setValue('location_id' as any, v?.id ?? null, { shouldDirty: true }); setValue('location_code' as any, v?.code ?? null); setValue('location_name' as any, v?.name ?? null); }}
            onClassChange={(v) => { setValue('class_id_override' as any, v?.id ?? null, { shouldDirty: true }); setValue('class_code' as any, v?.code ?? null); setValue('class_name' as any, v?.name ?? null); }}
            onRPTChange={(v) => setValue('rpt' as any, v, { shouldDirty: true })}
            disabled={viewOnly || !savedLock.canEditFields}
          />
        </Section>

        {/* ── Schedule Information ── */}
        <Section title="Schedule Information">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>START DATE</FieldLabel>
              <Input type="date" {...register('start_date')} />
            </div>
            <div>
              <FieldLabel required>PAYMENT START DATE</FieldLabel>
              <Input type="date" {...register('payment_start_date')} />
            </div>
            <div>
              <FieldLabel tipKey="INSTALLMENT END DATE">END DATE [computed]</FieldLabel>
              {/* ระบบคำนวณให้และเขียนทับทันทีที่วันเริ่มชำระหรืออายุสัญญาเปลี่ยน
                  เดิมเปิดให้พิมพ์ได้ทั้งที่ค่าที่พิมพ์หายทันที — ปิดไม่ให้พิมพ์ไปเลยจะตรงไปตรงมากว่า */}
              <Input type="date" readOnly {...register('end_date')} className="bg-gray-50" />
              <p className="text-xs text-muted mt-0.5 italic">
                ระบบคำนวณให้ = วันเริ่มชำระ + อายุสัญญา − 1 วัน · แก้ไม่ได้โดยตรง (แก้ที่วันเริ่มชำระหรืออายุสัญญาแทน)
              </p>
            </div>
            <div>
              <FieldLabel required>LEASE TERM (MONTHS)</FieldLabel>
              <NumInput value={watched.term_months ?? 0} onChange={(v) => setValue('term_months', v, { shouldDirty: true })} />
              <div className="text-xs mt-1">
                {(watched.term_months ?? 0) >= 12 ? <Badge variant="brand">Long-term</Badge> : <Badge variant="warn">Short-term</Badge>}
              </div>
            </div>
            {/* สัญญาเช่าระยะสั้นและมูลค่าต่ำไม่ต้องตั้งสิทธิการใช้สินทรัพย์
                ตามที่ตกลงกัน สัญญากลุ่มนี้บันทึกเป็นค่าเช่าที่ระบบบัญชีโดยตรง ไม่ผ่านโมดูลนี้
                จึงไม่มีตัวเลือกให้กรอกที่นี่ (คอลัมน์ในฐานข้อมูลยังคงไว้เผื่อข้อมูลเดิม) */}
            <div className="md:col-span-2">
              <FieldLabel required>PAYMENT TYPE</FieldLabel>
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
              <FieldLabel required>PRINCIPAL AMOUNT</FieldLabel>
              <NumInput
                step="0.01"
                value={watched.principal ?? 0}
                onChange={(v) => setValue('principal', v, { shouldDirty: true })}
                className={isHP || hasRentSteps ? 'bg-gray-50' : ''}
                readOnly={isHP || hasRentSteps}
              />
              {isHP && <p className="text-xs text-muted mt-1">= Net Vehicle Cost</p>}
              {hasRentSteps && <p className="text-xs text-muted mt-1">= มูลค่าปัจจุบันของค่าเช่าตามช่วงด้านล่าง</p>}
            </div>
            {usesCredit && (
              <>
                {/* คิดย้อนจากกระแสเงินสดในตารางผ่อนจริง ไม่ใช่อัตราตามสัญญาที่กรอกไว้ */}
                <div>
                  <FieldLabel tipKey="EFFECTIVE INTEREST RATE PER YEAR">EFFECTIVE INTEREST RATE / YEAR (%)</FieldLabel>
                  <Input
                    readOnly
                    value={effectiveRate ? effectiveRate.year.toFixed(4) + '%' : 'คำนวณไม่ได้'}
                    className="bg-gray-50"
                  />
                  <p className="text-xs text-muted mt-1">
                    {effectiveRate
                      ? `คิดย้อนจากกระแสเงินสดในตารางผ่อน · อัตราตามสัญญา ${(watched.annual_rate ?? 0).toFixed(4)}%`
                      : 'ยังไม่มีตารางผ่อนให้คิดย้อน — กรอกเงินต้น / จำนวนงวด / วันเริ่มสัญญาให้ครบก่อน'}
                  </p>
                </div>
                <div>
                  <FieldLabel tipKey="EFFECTIVE INTEREST RATE PER MONTH">EFFECTIVE INTEREST RATE / MONTH</FieldLabel>
                  <Input
                    readOnly
                    value={effectiveRate ? effectiveRate.month.toFixed(4) + '%' : 'คำนวณไม่ได้'}
                    className="bg-gray-50"
                  />
                </div>
              </>
            )}
            <div>
              <FieldLabel tipKey="AMOUNT PER MONTH">AMOUNT PER MONTH (est.)</FieldLabel>
              <Input readOnly value={monthlyEstText} className="bg-gray-50" />
              <p className="text-xs text-muted mt-0.5 italic">
                {installmentInfo.uniform
                  ? 'ดึงจากคอลัมน์ค่างวดในตารางผ่อน'
                  : 'ค่างวดไม่เท่ากันทุกงวด — แสดงเป็นช่วงต่ำสุดถึงสูงสุดจากตารางผ่อน'}
              </p>
            </div>
            <div>
              <FieldLabel>BALLOON PAYMENT</FieldLabel>
              <NumInput value={watched.balloon_amount ?? 0} onChange={(v) => setValue('balloon_amount', v, { shouldDirty: true })} step="0.01" />
              {balloonIgnored && (
                <p className="text-xs text-amber-700 mt-1">
                  ⚠️ รูปแบบการชำระที่เลือกไม่รองรับเงินก้อนท้าย ระบบจึงไม่ได้คิดยอดนี้ในตารางผ่อน
                  — เลือกรูปแบบการชำระแบบ (Balloon) ถ้าต้องการให้คิดจริง
                </p>
              )}
              {!isHP && balloonAmount > 0 && (
                <p className="text-xs text-muted mt-1">คิดรวมในงวดสุดท้ายให้อัตโนมัติ</p>
              )}
            </div>
            {/* รูปแบบการจ่ายงวดโป่งท้าย 3 แบบ มีผลเฉพาะเช่าซื้อ
                อีก 2 ชนิดตัวสร้างตารางคิดรวมในงวดสุดท้ายเสมอ ไม่ได้อ่านค่านี้ — เดิมโชว์ไว้ทั้งที่เลือกแล้วไม่มีอะไรเปลี่ยน */}
            {isHP && (
              <div>
                <FieldLabel>BALLOON OPTION</FieldLabel>
                <Select {...register('balloon_pattern')}>
                  <option value="with-last">พร้อมงวดสุดท้าย</option>
                  <option value="after-last">หลังงวดสุดท้าย</option>
                  <option value="before-last">ก่อนงวดสุดท้าย</option>
                </Select>
              </div>
            )}
            {isHP && (
              <div>
                <FieldLabel required tipKey="VAT">VAT (%)</FieldLabel>
                <NumInput value={watched.vat_rate ?? 0} onChange={(v) => setValue('vat_rate', v, { shouldDirty: true })} step="0.01" />
                <p className="text-xs text-muted mt-1">VAT บนค่างวด (เงินต้น+ดอก)</p>
              </div>
            )}
            {/* อัตราคิดลดใช้กับ Leasing Other เท่านั้น — Leasing คิดจากอัตราดอกเบี้ยตามสัญญา */}
            {isOther && (
              <div>
                <FieldLabel required>DISCOUNT RATE (%)</FieldLabel>
                <NumInput value={watched.discount_rate ?? 0} onChange={(v) => setValue('discount_rate', v, { shouldDirty: true })} step="0.01" />
              </div>
            )}
            {/* ค่าเสื่อมของรถเช่าซื้ออยู่ที่ทะเบียนทรัพย์สินใน NetSuite ตามที่ตกลงกัน
                ระบบนี้ดูแลเฉพาะฝั่งสัญญาและการผ่อนชำระ จึงมีช่องนี้เฉพาะสัญญาเช่า */}
            {isRou && (
              <div>
                <FieldLabel>ROU USEFUL LIFE (เดือน)</FieldLabel>
                <NumInput value={watched.rou_useful_life ?? 0} onChange={(v) => setValue('rou_useful_life', v, { shouldDirty: true })} placeholder={`auto = Term (${watched.term_months ?? 0})`} />
                <p className="text-xs text-muted mt-0.5 italic">อายุการใช้งานสิทธิการใช้สินทรัพย์ เพื่อตัดค่าเสื่อมเส้นตรง — เว้นว่าง = เท่าอายุสัญญา</p>
              </div>
            )}
            {/* ค่าเช่าไม่เท่ากันตลอดสัญญา — เช่น ปีแรกเดือนละ 200,000 ปีถัดไป 260,000
                ว่างไว้ = ค่าเช่าเท่ากันทุกงวด คำนวณจากเงินต้นแบบเดิม */}
            {isOther && !hasRentSteps && (
              <div className="md:col-span-3">
                <button
                  type="button" disabled={viewOnly || !savedLock.canEditFields}
                  className="text-xs text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                  onClick={() => setValue('rent_steps', [{ fromPeriod: 1, toPeriod: watched.term_months ?? 1, amount: 0 }], { shouldDirty: true })}
                >
                  + กำหนดค่าเช่าแยกตามช่วงงวด
                </button>
                <span className="text-[11px] text-muted ml-2">ใช้เมื่อค่าเช่าไม่เท่ากันตลอดสัญญา เช่น ปีแรกราคาหนึ่ง ปีถัดไปอีกราคาหนึ่ง</span>
              </div>
            )}
            {isOther && hasRentSteps && (
              <div className="md:col-span-3 rounded border border-line bg-soft p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <div className="text-sm font-medium">ค่าเช่าแยกตามช่วงงวด</div>
                    <p className="text-[11px] text-muted mt-0.5">
                      ยอดเงินต้นคิดจากมูลค่าปัจจุบันของค่าเช่าเหล่านี้ให้อัตโนมัติ
                    </p>
                  </div>
                  <Button
                    type="button" variant="outline" size="sm" disabled={viewOnly || !savedLock.canEditFields}
                    onClick={() => {
                      const last = rentSteps[rentSteps.length - 1];
                      const from = last ? last.toPeriod + 1 : 1;
                      setValue('rent_steps', [...rentSteps, { fromPeriod: from, toPeriod: watched.term_months ?? from, amount: 0 }], { shouldDirty: true });
                    }}
                  >
                    + เพิ่มช่วง
                  </Button>
                </div>
                {(
                  <div className="overflow-x-auto">
                    <table className="table-base text-sm w-full max-w-2xl">
                      <thead>
                        <tr>
                          <th className="w-28">งวดที่เริ่ม</th>
                          <th className="w-28">ถึงงวดที่</th>
                          <th className="text-right">ค่าเช่าต่อเดือน</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {rentSteps.map((st, idx) => {
                          const patch = (next: Partial<RentStep>) => {
                            const copy = rentSteps.map((x, k) => (k === idx ? { ...x, ...next } : x));
                            setValue('rent_steps', copy, { shouldDirty: true });
                          };
                          return (
                            <tr key={idx}>
                              <td><NumInput value={st.fromPeriod} onChange={(v) => patch({ fromPeriod: v })} /></td>
                              <td><NumInput value={st.toPeriod} onChange={(v) => patch({ toPeriod: v })} /></td>
                              <td><NumInput value={st.amount} onChange={(v) => patch({ amount: v })} step="0.01" /></td>
                              <td className="text-right">
                                {/* ปุ่มลบใช้สีแดงเหมือนที่อื่นในระบบ — เป็นการกระทำที่ย้อนไม่ได้ */}
                                <button
                                  type="button" disabled={viewOnly || !savedLock.canEditFields} hidden={viewOnly}
                                  className="text-danger hover:underline text-xs disabled:opacity-40"
                                  onClick={() => {
                                    const copy = rentSteps.filter((_, k) => k !== idx);
                                    setValue('rent_steps', copy.length ? copy : null, { shouldDirty: true });
                                  }}
                                >
                                  ลบ
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {rentStepsIssue && <p className="text-xs text-danger mt-1.5">{rentStepsIssue}</p>}
                  </div>
                )}
              </div>
            )}

            <div className="md:col-span-3 flex flex-wrap gap-5 pt-1 border-t border-line mt-1">
              {/* ช่องนี้มีผลเฉพาะเช่าซื้อเช่นเดียวกับรูปแบบเงินก้อนท้าย
                  อีก 2 ชนิดคิดรวมในงวดสุดท้ายเสมอ ติ๊กแล้วไม่มีอะไรเปลี่ยน จึงไม่โชว์ */}
              {isHP && (
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('include_balloon_installment')} className="rounded" /> INCLUDE BALLOON PAYMENT IN INSTALLMENT<CbTip k="INCLUDE BALLOON PAYMENT IN INSTALLMENT" /></label>
              )}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('pay_eom')} className="rounded" /> PAY AT END OF MONTHS<CbTip k="PAY AT END OF MONTHS" /></label>
            </div>
          </div>

          {/* Live calc strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">{installmentInfo.uniform ? 'Monthly' : 'Monthly (งวดแรก–สูงสุด)'}</div><div className="text-right tabular-nums font-semibold">{monthlyEstText}</div></div>
            <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Periods</div><div className="text-right tabular-nums font-semibold">{isHP && hpSchedule ? hpSchedule.rows.length : schedule.length}</div></div>
            <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">{isHP ? 'Total Payment (ex VAT)' : 'Total Payment'}</div><div className="text-right tabular-nums font-semibold">{fmtMoney(isHP && hpSchedule ? hpSchedule.totalPayment : totalPayment)}</div></div>
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
                  <p className="text-[11px] text-muted">
                    เลือกว่าจะใช้บัญชีไหนกับรายการอะไร — ทุกใบบันทึกบัญชีของสัญญานี้จะใช้ตามที่เลือกไว้
                    · หน้าที่ไหนไม่ได้เลือก ระบบใช้บัญชีตั้งต้นให้
                  </p>
                  <AcctCards accounts={acctCards} onChange={setAcctCards} types={LEASE_ACCT_TYPES} />
                </div>
              ),
            },
            // ค่าเสื่อมของรถเช่าซื้ออยู่ที่ทะเบียนทรัพย์สินใน NetSuite — แท็บนี้จึงมีเฉพาะสัญญาเช่า
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
                              ✓ ลงบัญชีวันแรกแล้ว
                            </a>
                          ) : (
                            <>
                              <Button type="button" variant="primary" size="sm" onClick={() => postDay1JE.mutate()} disabled={postDay1JE.isPending || !leaseApproved || !can(menuKey, 'approve')}>
                                📋 ลงบัญชีวันแรก
                              </Button>
                              <span className="text-xs text-muted">{!leaseApproved ? 'ต้องอนุมัติสัญญาก่อน' : 'Dr Asset + Deferred Interest + Undue VAT / Cr Lease Liability → Active'}</span>
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
                              <ThTip align="right" tip="ค่างวดที่ต้องจ่ายในงวดนี้ (ก่อน VAT)">Installment</ThTip>
                              <ThTip align="right" tipKey="VAT AMOUNT">VAT</ThTip>
                              <ThTip align="right" tipKey="TOTAL INC. VAT">Total Inc. VAT</ThTip>
                              <ThTip align="right" tip="ดอกเบี้ยที่เกิดในงวดนี้">Interest</ThTip>
                              <ThTip align="right" tip="ดอกเบี้ยสะสมตั้งแต่ต้นสัญญาถึงงวดนี้">Accum. Interest</ThTip>
                              <ThTip align="right" tip="ส่วนที่ตัดยอดหนี้สินในงวดนี้ = ค่างวด − ดอกเบี้ย">Amortisation</ThTip>
                              <ThTip align="right" tip="ยอดหนี้สินตามสัญญาเช่าคงเหลือหลังตัดงวดนี้">Balance</ThTip>
                              <ThTip align="right" tip="ค่าเสื่อมสิทธิการใช้สินทรัพย์งวดนี้ — เส้นตรง = ROU ตั้งต้น ÷ อายุการใช้งาน">Depreciation</ThTip>
                              <ThTip align="right" tip="ยอดสิทธิการใช้สินทรัพย์คงเหลือหลังตัดค่าเสื่อม (มูลค่าตามบัญชี)">ROU Balance</ThTip>
                              <ThTip align="right" tipKey="DEFERRED INTEREST BALANCE">Deferred Interest Bal.</ThTip>
                              <ThTip align="right">VAT Balance</ThTip>
                              <ThTip align="right">JE</ThTip>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              // Accum. Interest reset here so each render pass restarts from 0
                              let accumInt = 0;
                              return hpSchedule.rows.map((r) => {
                                accumInt += r.interest || 0;
                                return (
                              <tr key={r.period} className={r.isBalloon ? 'bg-amber-50 font-bold' : 'hover:bg-gray-50'}>
                                <td className="font-medium">{r.period}</td>
                                <td>{fmtDate(r.endDate)}</td>
                                <td className="text-right tabular-nums font-medium">{fmtMoney(r.installment)}</td>
                                <td className="text-right tabular-nums text-purple-700">{fmtMoney(r.vat)}</td>
                                <td className="text-right tabular-nums font-semibold">{fmtMoney(r.totalIncVat)}</td>
                                <td className="text-right tabular-nums text-amber-700">{fmtMoney(r.interest)}</td>
                                <td className="text-right tabular-nums text-amber-900">{fmtMoney(accumInt)}</td>
                                <td className="text-right tabular-nums text-emerald-700">{fmtMoney(r.principal)}</td>
                                <td className="text-right tabular-nums">{fmtMoney(r.endBalance)}</td>
                                {(() => {
                                  const dRow = rouDepr.rows.find((rd) => rd.period === r.period);
                                  return (
                                    <>
                                      <td className="text-right tabular-nums text-sky-700">{fmtMoney(dRow?.depreciation ?? 0)}</td>
                                      <td className="text-right tabular-nums text-sky-900">{fmtMoney(dRow?.endNbv ?? 0)}</td>
                                    </>
                                  );
                                })()}
                                <td className="text-right tabular-nums text-muted">{fmtMoney(r.deferredInterestBalance)}</td>
                                <td className="text-right tabular-nums text-muted">{fmtMoney(r.vatBalance)}</td>
                                <td className="text-right whitespace-nowrap">
                                  {id && (() => {
                                    const payJE = postedPayPeriods?.get(r.period);
                                    const isFuture = r.endDate > today;
                                    const bankLine = showBankConfirmed ? bankConfirmed?.byPeriod.get(r.period) : undefined;
                                    // ตารางของสัญญาเช่าตรวจสิทธิ์อนุมัติก่อนลงบัญชีอยู่แล้ว
                                    // ตารางเช่าซื้อเดิมไม่ตรวจ ทำให้คนไม่มีสิทธิ์กดลงบัญชีได้ — ทำให้เหมือนกัน
                                    const blocked = !day1Posted
                                      ? 'ต้องลงบัญชีวันแรกก่อน'
                                      : isFuture
                                        ? `ยังไม่ถึงกำหนด (รอวันที่ ${fmtDate(r.endDate)})`
                                        : !can(menuKey, 'approve')
                                          ? 'ต้องมีสิทธิ์อนุมัติ'
                                          : '';
                                    return (
                                      <div className="flex items-center justify-end gap-1">
                                        {payJE ? (
                                          <a
                                            href={`/je/${payJE.id}`}
                                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 hover:underline"
                                            title={`เปิดหน้า ${payJE.je_number}`}
                                          >
                                            ✓ ลงบัญชีแล้ว
                                          </a>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => postPeriodJE.mutate(r)}
                                            disabled={postPeriodJE.isPending || viewOnly || !!blocked}
                                            className="text-brand hover:underline text-[10px] disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                                            title={blocked || 'ลงบัญชีค่างวดนี้'}
                                          >
                                            📋 ลงบัญชีงวดนี้
                                          </button>
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
                                      </div>
                                    );
                                  })()}
                                </td>
                              </tr>
                                );
                              });
                            })()}
                            <tr className="bg-soft font-bold border-t-2 border-line">
                              <td colSpan={2} className="text-right">Total</td>
                              <td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalPayment)}</td>
                              <td className="text-right tabular-nums text-purple-700">{fmtMoney(hpSchedule.totalVat)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalIncVat)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalInterest)}</td>
                              <td className="text-right tabular-nums text-amber-900">{fmtMoney(hpSchedule.totalInterest)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(hpSchedule.totalPrincipal)}</td>
                              <td colSpan={5} />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                ) : schedule.length === 0 ? (
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
                            ✓ ลงบัญชีวันแรกแล้ว
                          </a>
                        ) : (
                          <>
                            <Button type="button" variant="primary" size="sm" onClick={() => postDay1JE.mutate()} disabled={postDay1JE.isPending || !leaseApproved || !can(menuKey, 'approve')}>
                              📋 ลงบัญชีวันแรก
                            </Button>
                            <span className="text-xs text-muted">
                              {!leaseApproved
                                ? 'ต้องอนุมัติสัญญาก่อน'
                                : 'Dr ROU Asset / Cr Lease Liability' + ((watched.upfront_payment ?? 0) > 0 ? ' + Cr Cash (Upfront)' : '') + ' → Active'}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    {/* สรุปสิทธิการใช้สินทรัพย์ — รวมมาไว้เหนือตารางเดียวกัน ไม่แยกแท็บ */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                      <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">ROU Asset {leaseVersions.length > 1 ? '(หลังปรับปรุงสัญญา)' : '(ตั้งต้น)'}</div><div className="text-right tabular-nums font-semibold">{fmtMoney(rouInitialAmount)}</div></div>
                      <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Useful Life (เดือน)</div><div className="text-right tabular-nums font-semibold">{rouUsefulLife}{(!watched.rou_useful_life || watched.rou_useful_life <= 0) && <span className="text-[10px] text-muted"> (= term)</span>}</div></div>
                      <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">ค่าเสื่อม/เดือน (เส้นตรง)</div><div className="text-right tabular-nums font-semibold">{fmtMoney(rouDepr.monthlyDepreciation)}</div></div>
                      <div className="rounded border border-brand bg-blue-50 p-2.5"><div className="text-[10px] text-brand uppercase font-semibold">โอนสินทรัพย์แล้ว</div><div className="text-right tabular-nums font-bold text-brand">{assetTransfers.length}</div></div>
                    </div>
                    <p className="text-[11px] text-muted italic mb-2">
                      สิทธิการใช้สินทรัพย์ตัดค่าเสื่อมแบบเส้นตรงตั้งแต่งวดแรก แม้อยู่ในช่วงปลอดชำระ
                      {watched.status === 'Closed' && ' · สัญญาปิดแล้ว — ยอดคงเหลือถูกตัดออกตอนปิดสัญญา ปุ่มลงบัญชีจึงปิดทั้งหมด'}
                    </p>
                    {rouDepr.rows.length > schedule.length && (
                      <p className="text-[11px] text-amber-700 mb-2">
                        อายุการใช้งานสิทธิการใช้สินทรัพย์ ({rouDepr.rows.length} เดือน) ยาวกว่าอายุสัญญา ({schedule.length} เดือน)
                        — ค่าเสื่อมงวดที่ {schedule.length + 1} ถึง {rouDepr.rows.length} เกิดหลังจบสัญญา จึงไม่มีในตารางนี้
                      </p>
                    )}
                    <div className="overflow-x-auto max-h-[500px]">
                      <table className="table-base">
                        <thead className="sticky top-0 z-10">
                          <tr>
                            <ThTip>#</ThTip>
                            <ThTip>Payment Date</ThTip>
                            <ThTip align="right" tip="ค่างวดที่ต้องจ่ายในงวดนี้">Installment</ThTip>
                            <ThTip align="right" tip="ดอกเบี้ยที่เกิดในงวดนี้">Interest</ThTip>
                            <ThTip align="right" tip="ดอกเบี้ยสะสมตั้งแต่ต้นสัญญาถึงงวดนี้">Accum. Interest</ThTip>
                            {/* ตัวเลขในคอลัมน์นี้คือ ค่างวดทั้งสัญญารวมกัน ลบ ดอกเบี้ยสะสมถึงงวดนี้
                                ไม่ใช่เงินต้นของงวดนั้น (เงินต้นของงวดอยู่คอลัมน์ Amortisation) หัวคอลัมน์จึงเขียนตามตัวเลขจริง */}
                            <ThTip align="right" tip="ค่างวดทั้งสัญญารวมกัน ลบ ดอกเบี้ยสะสมถึงงวดนี้ — เป็นยอดสะสมแบบไม่คิดลด ใช้กระทบยอดกับไฟล์ของทีมบัญชี · ไม่ใช่เงินต้นของงวดนี้">ค่างวดรวม − ดอกเบี้ยสะสม</ThTip>
                            <ThTip align="right" tip="ส่วนที่ตัดยอดหนี้สินในงวดนี้ = ค่างวด − ดอกเบี้ย">Amortisation</ThTip>
                            <ThTip align="right" tip="ยอดหนี้สินตามสัญญาเช่าคงเหลือหลังตัดงวดนี้">Balance</ThTip>
                            <ThTip align="right" tip="ค่าเสื่อมสิทธิการใช้สินทรัพย์งวดนี้ — เส้นตรง = ROU ตั้งต้น ÷ อายุการใช้งาน">Depreciation</ThTip>
                            <ThTip align="right" tip="ยอดสิทธิการใช้สินทรัพย์คงเหลือหลังตัดค่าเสื่อม (มูลค่าตามบัญชี)">ROU Balance</ThTip>
                            {hasScheduleNotes && <ThTip>Note</ThTip>}
                            <ThTip align="right">JE</ThTip>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            let accumInt = 0;
                            // Total lease payments (undiscounted) = base for Principal running column
                            const totalPayments = schedule.reduce((s, r) => s + (r.payment || 0), 0);
                            return schedule.map((r) => {
                              accumInt += r.interest || 0;
                              const principalOutstanding = Math.max(0, totalPayments - accumInt);
                              const dRow = rouDepr.rows.find((rd) => rd.period === r.period);
                              return (
                            <tr key={r.period} className="hover:bg-gray-50">
                              <td className="font-medium">{r.period}</td>
                              <td>{fmtDate(r.date)}</td>
                              <td className="text-right tabular-nums font-medium">{fmtMoney(r.payment)}</td>
                              <td className="text-right tabular-nums text-amber-700">{fmtMoney(r.interest)}</td>
                              <td className="text-right tabular-nums text-amber-900">{fmtMoney(accumInt)}</td>
                              <td className="text-right tabular-nums text-purple-700">{fmtMoney(principalOutstanding)}</td>
                              <td className="text-right tabular-nums text-emerald-700">{fmtMoney(r.principal)}</td>
                              <td className="text-right tabular-nums">{fmtMoney(r.endBalance)}</td>
                              <td className="text-right tabular-nums text-sky-700">{fmtMoney(dRow?.depreciation ?? 0)}</td>
                              <td className="text-right tabular-nums text-sky-900">{fmtMoney(dRow?.endNbv ?? 0)}</td>
                              {hasScheduleNotes && <td>{r.note && <Badge variant="brand">{r.note}</Badge>}</td>}
                              <td className="text-right whitespace-nowrap">
                                {id && (() => {
                                  const payJE = postedPayPeriods?.get(r.period);
                                  const deprJE = dRow ? postedDeprPeriods?.get(dRow.period) : undefined;
                                  const needPay = !payJE;
                                  const needDepr = !!dRow && !deprJE;
                                  const isFuture = r.date > today;
                                  const bankLine = showBankConfirmed ? bankConfirmed?.byPeriod.get(r.period) : undefined;
                                  const busy = postPeriodJE.isPending || postDeprJE.isPending;
                                  // งวดหนึ่งมีใบสำคัญ 2 ใบเสมอ — ค่างวด กับ ค่าเสื่อม
                                  // จึงรวมเป็นปุ่มเดียว กดครั้งเดียวลงให้ทั้งคู่ (ใบไหนลงแล้วข้าม)
                                  const postBoth = async () => {
                                    if (needPay) await postPeriodJE.mutateAsync(r);
                                    if (needDepr && dRow) await postDeprJE.mutateAsync(dRow);
                                  };
                                  const blocked = !day1Posted
                                    ? 'ต้องลงบัญชีวันแรกก่อน'
                                    : isFuture
                                      ? `ยังไม่ถึงกำหนด (รอวันที่ ${fmtDate(r.date)})`
                                      : !can(menuKey, 'approve')
                                        ? 'ต้องมีสิทธิ์อนุมัติ'
                                        : '';
                                  return (
                                    <div className="flex items-center justify-end gap-1">
                                      {!needPay && !needDepr ? (
                                        <a
                                          href={`/je/${payJE!.id}`}
                                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 hover:underline"
                                          title={`ลงบัญชีแล้ว — ค่างวด ${payJE!.je_number}${deprJE ? ` · ค่าเสื่อม ${deprJE.je_number}` : ''}`}
                                        >
                                          ✓ ลงบัญชีแล้ว
                                        </a>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={postBoth}
                                          disabled={busy || viewOnly || !!blocked}
                                          className="text-brand hover:underline text-[10px] disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                                          title={blocked || `ลงบัญชีงวดนี้ — ${[needPay && 'ค่างวด', needDepr && 'ค่าเสื่อม'].filter(Boolean).join(' + ')}`}
                                        >
                                          📋 ลงบัญชีงวดนี้
                                        </button>
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
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                              );
                            });
                          })()}
                          {/* แถวรวมท้ายตาราง — ให้อ่านยอดรวมได้เหมือนตารางเช่าซื้อ
                              รวมเฉพาะคอลัมน์ที่บวกกันแล้วมีความหมาย ส่วนคอลัมน์ยอดคงเหลือปล่อยว่างไว้ */}
                          {(() => {
                            const totalAmort = schedule.reduce((s, r) => s + (r.principal || 0), 0);
                            const totalDepr = schedule.reduce(
                              (s, r) => s + (rouDepr.rows.find((rd) => rd.period === r.period)?.depreciation ?? 0),
                              0,
                            );
                            return (
                              <tr className="bg-soft font-bold border-t-2 border-line">
                                <td colSpan={2} className="text-right">รวม</td>
                                <td className="text-right tabular-nums">{fmtMoney(totalPayment)}</td>
                                <td className="text-right tabular-nums text-amber-700">{fmtMoney(totalInterest)}</td>
                                <td className="text-right text-muted">–</td>
                                <td className="text-right text-muted">–</td>
                                <td className="text-right tabular-nums text-emerald-700">{fmtMoney(totalAmort)}</td>
                                <td className="text-right text-muted">–</td>
                                <td className="text-right tabular-nums text-sky-700">{fmtMoney(totalDepr)}</td>
                                <td className="text-right text-muted">–</td>
                                <td colSpan={hasScheduleNotes ? 2 : 1} />
                              </tr>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                    {assetTransfers.length > 0 && (
                      <div className="mt-4">
                        <div className="text-xs font-semibold text-muted uppercase mb-1">ประวัติการโอนสินทรัพย์</div>
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
              key: 'version',
              label: 'Contract History',
              render: () => (
                // ประวัติสัญญา — ต่อสัญญา (Roll Over) และปิดก่อนกำหนด มีทั้ง 3 ชนิดที่ใช้วงเงินธนาคาร
                // ส่วนประวัติการปรับปรุงมูลค่า (Re-measurement) มีเฉพาะสัญญาเช่าที่มีสิทธิการใช้สินทรัพย์
                <div className="space-y-4 text-sm">
                  {!hasContractEvents && leaseVersions.length === 0 && (
                    <p className="text-muted text-sm p-1">
                      ยังไม่มีประวัติ — สัญญานี้ยังไม่เคย
                      {usesCredit ? 'ต่อสัญญา ปิดก่อนกำหนด' : ''}
                      {usesCredit && isRou ? ' หรือ' : ''}
                      {isRou ? 'ปรับปรุงมูลค่าสัญญา' : ''}
                    </p>
                  )}
                  {usesCredit && hasContractEvents && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted">ประวัติการเปลี่ยนแปลงสัญญา — ปิดก่อนกำหนด · ต่อสัญญา</p>
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
                              <td>ปิดสัญญาก่อนกำหนด</td>
                              <td>{rebateJE?.je_date ? fmtDate(rebateJE.je_date) : '—'}</td>
                              <td>
                                {rebateJE ? (
                                  <a href={`/je/${rebateJE.id}`} className="text-brand hover:underline" title="เปิดดูใบสำคัญ">
                                    {rebateJE.je_number}
                                  </a>
                                ) : (
                                  <span className="text-muted">ยังไม่ได้ลงบัญชี</span>
                                )}
                              </td>
                              <td><Badge variant="danger">Closed</Badge></td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {isHP && (
                      <p className="text-[11px] text-muted">เช่าซื้อใช้วิธีดอกเบี้ยรอตัดบัญชี จึงไม่มีการปรับปรุงมูลค่าสิทธิการใช้สินทรัพย์</p>
                    )}
                  </div>
                  )}
                  {isRou && leaseVersions.length > 0 && (
                  <div className={`space-y-2 ${hasContractEvents ? 'border-t border-line pt-3' : ''}`}>
                    <p className="text-xs text-muted">ประวัติการปรับปรุงมูลค่าสัญญา</p>
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">⚠️ มูลค่าปัจจุบันของค่าเช่าและยอดปรับปรุงคำนวณใน Excel — ระบบไม่คำนวณให้ · กรอกผลลัพธ์กลับเข้ามาด้วยปุ่ม Re-measurement ด้านบน แล้วระบบจะเก็บเป็นเวอร์ชันไว้ในตารางนี้</p>
                    <div className="overflow-x-auto">
                      <table className="table-base text-sm">
                        <thead><tr><ThTip>Version</ThTip><ThTip tipKey="EFFECTIVE DATE">Effective</ThTip><ThTip align="right" tipKey="ASSET / ROU">ROU Asset</ThTip><ThTip align="right" tipKey="LEASE LIABILITY (GROSS)">Lease Liability</ThTip><ThTip align="right">Rate</ThTip><ThTip align="right">Term</ThTip><ThTip align="right" tipKey="GAIN/(LOSS)">Gain/(Loss)</ThTip><ThTip>Status</ThTip></tr></thead>
                        <tbody>
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
                              <td>{i === 0 ? <Badge variant="default">Origin</Badge> : i === leaseVersions.length - 1 ? <Badge variant="success">Current</Badge> : <Badge variant="default">Superseded</Badge>}</td>
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
              key: 'classification',
              // ชื่อเดิม "Classification" ซ้ำกับหัวข้อกรอกรหัสลงบัญชีด้านบน — แท็บนี้คือตัวเลขแยกตามอายุครบกำหนด
              label: 'Maturity Profile',
              render: () => {
                // After Close (Rebate or Manual) → Outstanding = 0 (already settled).
                const isClosed = watched.status === 'Closed';
                const rows = isClosed
                  ? []
                  : (isHP && hpSchedule
                    ? hpSchedule.rows.map((r) => ({ due: r.endDate, principal: r.principal, interest: r.interest }))
                    : schedule.map((r) => ({ due: r.date, principal: r.principal, interest: r.interest })));
                const startISO = watched.payment_start_date ?? watched.start_date ?? today;
                // 12-month cutoff (Current vs Non-current — เงินต้นเท่านั้น ตามมาตรฐานงบดุล)
                const cutoff12 = new Date(startISO);
                cutoff12.setMonth(cutoff12.getMonth() + 12);
                const cutoff12ISO = fmtDateISO(cutoff12);
                // TOR272: IFRS 16 maturity buckets — 1 yr / 1-5 yr / >5 yr
                const cutoff60 = new Date(startISO);
                cutoff60.setMonth(cutoff60.getMonth() + 60);
                const cutoff60ISO = fmtDateISO(cutoff60);
                const total = rows.reduce((s, r) => s + r.principal, 0);
                const current = rows.filter((r) => r.due <= cutoff12ISO).reduce((s, r) => s + r.principal, 0);
                const nonCurrent = total - current;
                // TOR272 buckets — Future Cash Flow รวม Principal + Interest (per MoM Day 4 §6.1)
                const totalCF = rows.reduce((s, r) => s + r.principal + r.interest, 0);
                const cf1yr = rows.filter((r) => r.due <= cutoff12ISO).reduce((s, r) => s + r.principal + r.interest, 0);
                const cf1to5yr = rows.filter((r) => r.due > cutoff12ISO && r.due <= cutoff60ISO).reduce((s, r) => s + r.principal + r.interest, 0);
                const cfOver5yr = rows.filter((r) => r.due > cutoff60ISO).reduce((s, r) => s + r.principal + r.interest, 0);
                return (
                  <div className="space-y-3 text-sm">
                    <p className="text-xs text-muted">GL Classification — Aging (Current vs Non-current)</p>
                    {isClosed && (
                      <p className="text-xs text-emerald-700 font-medium">✓ Lease ปิดสัญญาแล้ว — Outstanding = 0</p>
                    )}
                    <div className="overflow-x-auto max-w-md">
                      <table className="table-base text-sm"><tbody>
                        <tr><td><TipLabel>Current Portion (≤ 12 เดือน)</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(current)}</td></tr>
                        <tr><td><TipLabel>Non-current (&gt; 12 เดือน)</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(nonCurrent)}</td></tr>
                        <tr className="font-semibold"><td><TipLabel>Total Principal</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(total)}</td></tr>
                      </tbody></table>
                    </div>

                    {/* TOR272 — IFRS 16 Maturity Profile (per MoM Day 4 §6.1) */}
                    <div className="mt-4">
                      <p className="text-xs text-muted">
                        📊 ภาระผูกพันตามสัญญาเช่าในอนาคต — แยกตามช่วงเวลาครบกำหนด (รวมเงินต้น + ดอกเบี้ย)
                      </p>
                      <div className="overflow-x-auto max-w-md mt-1">
                        <table className="table-base text-sm"><tbody>
                          <tr><td><TipLabel>ภายใน 1 ปี</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(cf1yr)}</td></tr>
                          <tr><td><TipLabel>1 - 5 ปี</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(cf1to5yr)}</td></tr>
                          <tr><td><TipLabel>มากกว่า 5 ปี</TipLabel></td><td className="text-right tabular-nums">{fmtMoney(cfOver5yr)}</td></tr>
                          <tr className="font-semibold bg-soft"><td>Total Future Cash Flow</td><td className="text-right tabular-nums">{fmtMoney(totalCF)}</td></tr>
                        </tbody></table>
                      </div>
                      <p className="text-[11px] text-muted italic mt-1">
                        สำหรับหมายเหตุประกอบงบการเงินตามมาตรฐาน TFRS 16 · รวมเงินต้น + ดอกเบี้ย ยังไม่คิดลด
                      </p>
                    </div>

                    <div><span className="text-muted">Lease Classification:</span> <b>{watched.classification}</b></div>
                  </div>
                );
              },
            },
            {
              key: 'doc',
              label: 'Document',
              render: () => (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted">
                    {isHP
                      ? 'เอกสารแนบสัญญาเช่าซื้อ — สัญญา · ใบกำกับภาษี · เอกสารโอนกรรมสิทธิ์'
                      : isOther
                        ? 'เอกสารแนบสัญญาเช่า — สัญญาเช่า · ใบเสร็จรับเงิน · หนังสือรับรองการหักภาษี ณ ที่จ่าย'
                        : 'เอกสารแนบสัญญาเช่า — สัญญา · ใบกำกับภาษี'}
                  </p>
                  <DocumentTabGeneric
                    parentId={id}
                    ensureParentId={ensureLeaseId}
                    bucketName="lease-documents"
                    tableName="lease_documents"
                    parentFkColumn="lease_id"
                  />
                </div>
              ),
            },
          ]}
        />
      </div>
      </ReadOnlyContext.Provider>

      {/* ── Close Early (Rebate) Modal ── */}
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
            {isHP
              ? 'ปิดก่อนกำหนด: ได้ส่วนลด (Rebate) ไม่ใช่ค่าปรับ · เงินต้นไม่ลด · ดอกเบี้ยและภาษีที่ยังไม่ถึงกำหนดขอลดได้'
              : 'ปิดก่อนกำหนด: จ่ายเคลียร์หนี้สินตามสัญญาที่คงเหลือ ณ วันที่ปิด · สัญญาเช่าไม่มีดอกเบี้ยรอตัดบัญชีและภาษีรอตัดจึงไม่มีส่วนลด'}
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
                {/* ดอกเบี้ยรอตัดบัญชีและภาษีรอตัดมีเฉพาะเช่าซื้อ — ชนิดอื่นแสดงแล้วเป็น 0 เปล่าๆ */}
                {isHP && (
                <tr>
                  <td className="font-semibold">ดอกเบี้ยที่เหลือ</td>
                  <td className="text-right tabular-nums">{fmtMoney(rebatePreview.interestOut)}</td>
                  <td className="text-right">
                    <input type="number" value={intRebatePct} disabled={viewOnly} readOnly={viewOnly} onChange={(e) => setIntRebatePct(parseFloat(e.target.value) || 0)} className="w-16 text-right border border-line rounded px-1 py-0.5 disabled:bg-gray-50 disabled:text-muted disabled:cursor-not-allowed" />%
                  </td>
                  <td className="text-right tabular-nums text-danger">-{fmtMoney(rebatePreview.intRebate)}</td>
                  <td className="text-right tabular-nums font-semibold">{fmtMoney(rebatePreview.intNet)}</td>
                </tr>
                )}
                {isHP && (
                <tr>
                  <td className="font-semibold">VAT ที่เหลือ</td>
                  <td className="text-right tabular-nums">{fmtMoney(rebatePreview.vatOut)}</td>
                  <td className="text-right">
                    <input type="number" value={vatRebatePct} disabled={viewOnly} readOnly={viewOnly} onChange={(e) => setVatRebatePct(parseFloat(e.target.value) || 0)} className="w-16 text-right border border-line rounded px-1 py-0.5 disabled:bg-gray-50 disabled:text-muted disabled:cursor-not-allowed" />%
                  </td>
                  <td className="text-right tabular-nums text-danger">-{fmtMoney(rebatePreview.vatRebate)}</td>
                  <td className="text-right tabular-nums font-semibold">{fmtMoney(rebatePreview.vatNet)}</td>
                </tr>
                )}
                <tr className="bg-brand text-white font-bold">
                  <td colSpan={4} className="!text-white !bg-brand">💰 Total Settlement Amount</td>
                  <td className="text-right tabular-nums !text-white !bg-brand">{fmtMoney(rebatePreview.totalSettlement)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </Modal>

      {/* ── ต่อสัญญา (ยกยอดงวดโป่งท้ายมาเป็นเงินต้นสัญญาใหม่) ── */}
      <Modal
        open={showRollover}
        onClose={() => setShowRollover(false)}
        title={`🔁 Roll Over — ${watched.lease_no || kindLabel}`}
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
          {/* ข้อความต้องตรงกับที่ระบบทำจริง — โค้ดตั้งสัญญาเดิมเป็น Roll Over ไม่ใช่ Modified */}
          <p className="text-xs text-muted">กด Proceed → สัญญาเดิมเปลี่ยนสถานะเป็น Roll Over + เปิดสัญญาใหม่ (Draft) เงินต้น = Balloon · แล้วพาไปกรอกรายละเอียดต่อ · ข้อมูลทรัพย์สินและกล่องจัดประเภทจะถูกยกไปให้</p>
        </div>
      </Modal>

      {/* ── ปรับมูลค่าสัญญา (สัญญาเช่า) ── */}
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
                    <td>{GL.asset.name}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.dRou > 0 ? fmtMoney(remeasurePreview.dRou) : ''}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.dRou < 0 ? fmtMoney(-remeasurePreview.dRou) : ''}</td>
                  </tr>
                )}
                {Math.abs(remeasurePreview.dLiab) >= 0.005 && (
                  <tr>
                    <td>{GL.leaseLiabilityLT.name}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.dLiab < 0 ? fmtMoney(-remeasurePreview.dLiab) : ''}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.dLiab > 0 ? fmtMoney(remeasurePreview.dLiab) : ''}</td>
                  </tr>
                )}
                {Math.abs(remeasurePreview.plDr) >= 0.005 && (
                  <tr>
                    <td>{GL.remeasurePL.name} {remeasurePreview.plDr > 0 ? '(Loss)' : '(Gain)'}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.plDr > 0 ? fmtMoney(remeasurePreview.plDr) : ''}</td>
                    <td className="text-right tabular-nums">{remeasurePreview.plDr < 0 ? fmtMoney(-remeasurePreview.plDr) : ''}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {/* โค้ดเรียกลงบัญชีทันที ไม่ได้ตั้งเป็นร่างรอการอนุมัติ — ข้อความต้องตรงกับที่ระบบทำ */}
            <p className="text-xs text-muted mt-1.5">
              กดยืนยันแล้วระบบลงบัญชีให้ทันที (ไม่ต้องรออนุมัติซ้ำ) · สัญญาจะเปลี่ยนสถานะเป็น Modified และตารางผ่อนจะคำนวณใหม่จากยอดหนี้สินใหม่
            </p>
          </div>
        </div>
      </Modal>

      {/* ── โอนเปลี่ยนประเภทสินทรัพย์ (สัญญาเช่า) ── */}
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
          <p className="text-[11px] text-muted italic">โอนเปลี่ยนประเภทสิทธิการใช้สินทรัพย์ตามสถานการณ์ — บันทึกบัญชีที่มูลค่าตามบัญชีคงเหลือ</p>
          <div>
            <FieldLabel>SCENARIO</FieldLabel>
            <Select value={transferKey} onChange={(e) => setTransferKey(e.target.value as TransferKey)}>
              {transferOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
            <p className="text-[11px] text-muted mt-0.5 italic">{transferOptions.find((s) => s.key === transferKey)?.when}</p>
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
                {/* โค้ดเรียกลงบัญชีทันที ไม่ได้ตั้งเป็นร่างรอการอนุมัติ */}
                <p className="text-[11px] text-muted mt-1.5">
                  กดยืนยันแล้วระบบลงบัญชีให้ทันที (ไม่ต้องรออนุมัติซ้ำ) · พร้อมบันทึกประวัติการโอนไว้ในตารางด้านล่าง
                </p>
              </div>
            );
          })()}
        </div>
      </Modal>

      {/* NetSuite Chassis Lookup (per MoM §5) — for HP mode (เช่าซื้อรถจาก Inventory) */}
      <LookupChassisModal
        open={showChassisLookup}
        onClose={() => setShowChassisLookup(false)}
        onSelect={(c: ChassisInventory) => {
          setValue('asset_name', c.car_model, { shouldDirty: true });
          setValue('asset_type', 'ยานพาหนะ', { shouldDirty: true });
          setValue('chassis_no', c.chassis_no, { shouldDirty: true });  // BR-LEASE-026: persist to DB
          // Auto-fill vehicle price from chassis cost
          if (c.cost > 0) setValue('vehicle_price', c.cost, { shouldDirty: true });
          setLinkedChassisNo(c.chassis_no);
        }}
        title="Lookup Chassis (NetSuite Inventory) — HP"
        excludeContractId={id}
        currentBank={inheritedSeg.finance_institution ?? null}
      />

      {/* NetSuite Vendor Lookup (per MoM Interface §3) — for IFRS 16 Lessor selection */}
      <LookupVendorModal
        open={vendorLookupOpen}
        onClose={() => setVendorLookupOpen(false)}
        onSelect={(v: Vendor) => {
          setValue('vendor', v.name, { shouldDirty: true });
          setValue('vendor_id', v.id, { shouldDirty: true });
          setVendorLookupOpen(false);
          if (!v.netsuite_vendor_id) {
            toast.warning(`Vendor "${v.name}" ยังไม่ map กับ NetSuite — admin ต้องกรอก netsuite_vendor_id ก่อน sync AP`, { duration: 6000 });
          } else {
            toast.success(`✓ เลือกผู้ให้เช่า: ${v.name}`);
          }
        }}
        typeFilter="lessor"
        title="Lookup Lessor (Vendor Master)"
      />

      {/* NetSuite FA Lookup (per MoM §5) — for IFRS 16 อาคาร/ที่ดิน + MCR Lease */}
      <LookupFAModal
        open={showFALookup}
        onClose={() => setShowFALookup(false)}
        onSelect={(fa: FixedAsset) => {
          setValue('asset_name', fa.description, { shouldDirty: true });
          // Set asset_type based on FA type
          const typeMap: Record<string, string> = {
            realestate: 'อาคาร / ที่ดิน',
            building: 'อาคาร / ที่ดิน',
            vehicle: 'ยานพาหนะ',
            equipment: 'อุปกรณ์',
          };
          const mappedType = typeMap[fa.type];
          if (mappedType) setValue('asset_type', mappedType, { shouldDirty: true });
          setLinkedAssetNo(fa.asset_no);
        }}
        typeFilter={['realestate', 'building', 'vehicle', 'equipment']}
        title="Lookup Fixed Asset (NetSuite) — Lease/HP"
      />
    </div>
    </ScopeGuard>
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
