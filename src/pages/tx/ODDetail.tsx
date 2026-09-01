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
import { Button, Input, Select, Badge, FieldLabel, NumInput, Textarea } from '@/components/ui';
import { fmtDate, fmtMoney, fmtPercent, fmtDateISO} from '@/lib/format';
import {
  type Overdraft,
  type ODBankTransaction,
  type ODStatus,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, effectiveRate, type RateCard } from '@/components/tx/RateCards';
import { useBaseRateLookup } from '@/lib/interest-rate-master';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { ReadOnlyContext, useReadOnly } from '@/lib/readonly';
import { pickEffectiveRate } from '@/lib/rate-helpers';
import { friendlySaveError } from '@/lib/save-error';
import { AuditFooter } from '@/components/AuditFooter';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';
import { createJE, postJE, reverseJE } from '@/lib/je';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { computeStatusLock, canSaveStatusChange } from '@/lib/status-lock';
import { StatusLockBanner } from '@/components/tx/StatusLockBanner';
import { ApprovalPanel } from '@/components/tx/ApprovalPanel';
import { ClassificationCard } from '@/components/shared/ClassificationCard';
import { fetchInheritedFromCA, type InheritedSegments } from '@/lib/segment-inherit';
import {
  buildODDailyRows,
  buildODMonthSummary,
  odTotalInterest,
  odLastEndingBalance,
} from '@/lib/od-schedule';
import { useBankCodes } from '@/lib/banks';
import { ApprovalActions, ApprovalNote, filterStatusOptions } from '@/components/shared/ApprovalActions';

import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
import { toDbPayload } from '@/lib/save-payload';
// Note: 'Approved' removed — Approval Panel now owns that transition.
const OD_STATUSES: ODStatus[] = ['Draft', 'Pending Approval', 'Active', 'Suspended', 'Closed', 'Cancelled'];

// สถานะที่เป็นเหตุการณ์ "หลังวงเงินมีผลแล้ว" — เลือกเองตั้งแต่ยังเป็นร่างไม่ได้
// เดิมเลือกระงับหรือปิดวงเงินได้ทันทีจากร่าง ได้วงเงินที่ดูเหมือนปิดแล้ว
// ทั้งที่ไม่เคยผ่านการอนุมัติและไม่มีใบสำคัญสักใบ
const POST_APPROVAL_STATUSES: string[] = ['Suspended', 'Closed'];
// สถานะที่ยังไม่ผ่านการอนุมัติ — ใช้ตัดสินว่าจะซ่อนตัวเลือกข้างบนหรือไม่
const NOT_YET_APPROVED: string[] = ['Draft', 'Pending Approval', 'Cancelled'];

type Form = Omit<Overdraft, 'id' | 'created_at' | 'updated_at'>;

const blank: Form = {
  od_no: '',
  name: null,
  ca_id: null,
  finance_institution: '',
  facility_limit: 0,
  used_amount: 0,
  amount: 0,
  interest_rate_id: null,
  effective_rate: null,
  start_date: fmtDateISO(new Date()),
  end_date: null,
  transaction_date: fmtDateISO(new Date()),
  account_no: null,
  status: 'Draft',
  rollover_parent_id: null,
  currency: 'THB',
  remark: null,
  rate_cards: [],
  acct_cards: [],
};

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  'Pending Approval': 'warn',
  Approved: 'success',   // สถานะเก่า เก็บไว้เผื่อข้อมูลที่ย้ายมา
  Active: 'success',
  Suspended: 'warn',
  Closed: 'default',
  Cancelled: 'danger',
};

export function ODDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { can: rawCan, scope } = useAuth();
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const baseRateLookup = useBaseRateLookup(form.finance_institution);

  // Load existing
  const { data: existing } = useQuery({
    queryKey: ['od', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('overdrafts').select('*').eq('id', id!).single();
      if (error) throw error;
      return { main: data as Overdraft };
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
    }
  }, [existing]);

  // Derive daily ending balance from bank_statement_lines (match by account_no)
  const { data: bankTxs = [] } = useQuery({
    queryKey: ['od-bank-lines', form.account_no],
    enabled: !!form.account_no,
    queryFn: async () => {
      // Find all statements with this account_no
      const { data: stmts } = await supabase
        .from('bank_statements')
        .select('id')
        .eq('account_no', form.account_no!)
        .eq('inactive', false);
      const stmtIds = (stmts ?? []).map((s) => s.id);
      if (stmtIds.length === 0) return [];

      // ต้องเรียงตามลำดับในใบแจ้งยอดด้วย ไม่ใช่แค่วันที่
      // เพราะรายการวันเดียวกันจะถูกยุบเหลือแถวเดียว โดยใช้ยอดของรายการสุดท้ายเป็นยอดสิ้นวัน
      const { data: lines } = await supabase
        .from('bank_statement_lines')
        .select('tx_date, balance, source, sort_order')
        .in('statement_id', stmtIds)
        .order('tx_date')
        .order('sort_order', { nullsFirst: true });
      // Map to ODBankTransaction-compatible shape (for downstream daily-rows calc)
      return (lines ?? []).map((l: any) => ({
        id: crypto.randomUUID(),
        od_id: id ?? '',
        tx_date: l.tx_date,
        ending_balance: l.balance,
        source: l.source,
        last_modified: new Date().toISOString(),
        remark: null,
      })) as ODBankTransaction[];
    },
  });

  // CA options
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-od', scope],
    queryFn: async () => {
      const { data } = await supabase
        .from('credit_agreements')
        .select('id, ca_name, contract_number, ma_id, subsidiary').eq('status', 'Approved')
        .order('ca_name');
      // เห็นเฉพาะวงเงินของบริษัทที่ตัวเองดูแล
      return filterCaOptions(scope, data ?? []);
    },
  });

  // Bank Statement accounts (ALL active — no FI filter to avoid blank dropdown)
  const { data: bankStmtAccounts } = useQuery({
    queryKey: ['bank-stmt-accounts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bank_statements')
        .select('account_no, finance_institution, statement_name, statement_period')
        .eq('inactive', false)
        .order('account_no');
      // dedupe by account_no (latest statement wins)
      const seen = new Set<string>();
      const unique: any[] = [];
      for (const r of data ?? []) {
        if (r.account_no && !seen.has(r.account_no)) {
          seen.add(r.account_no);
          unique.push(r);
        }
      }
      return unique;
    },
  });

  // Ensure current account_no exists as option (in case it was set before but no matching statement)
  const accountOptions = useMemo(() => {
    const list = [...(bankStmtAccounts ?? [])];
    if (form.account_no && !list.some((s: any) => s.account_no === form.account_no)) {
      list.unshift({
        account_no: form.account_no,
        finance_institution: '(no statement)',
        statement_name: null,
        statement_period: null,
      });
    }
    return list;
  }, [bankStmtAccounts, form.account_no]);

  // วันที่ใช้เลือกอัตราดอกเบี้ย = วันเริ่มคำนวณ (รายการเดินบัญชีใบแรก)
  // ถ้ายังไม่มีรายการเดินบัญชี ใช้วันเริ่มวงเงินหรือวันทำรายการแทน
  const rateAsOfDate = useMemo(
    () => bankTxs[0]?.tx_date ?? form.start_date ?? form.transaction_date ?? null,
    [bankTxs, form.start_date, form.transaction_date],
  );

  // ใบอัตราดอกเบี้ยที่มีผล ณ วันเริ่มคำนวณ
  //
  // เดิมหยิบใบแรกในรายการเสมอ ไม่สนวันที่มีผล — พอเพิ่มใบใหม่ที่อัตราเปลี่ยน
  // ระบบยังคิดด้วยใบเก่า · ตอนนี้เลือกใบที่มีผล ณ วันเริ่มคำนวณแทน
  const activeRateCard = useMemo(
    () => pickEffectiveRate(form.rate_cards as RateCard[], rateAsOfDate).card,
    [form.rate_cards, rateAsOfDate],
  );

  // Effective rate
  const effRate = useMemo(
    () => (activeRateCard ? effectiveRate(activeRateCard) : form.effective_rate ?? 0),
    [activeRateCard, form.effective_rate],
  );

  // Overlimit rate (absolute rate %, NOT additive)
  // = overlimit field if set, else fall back to normal effRate
  const overlimitRate = useMemo(() => {
    const ovl = activeRateCard?.overlimit ?? 0;
    return ovl > 0 ? ovl : effRate;
  }, [activeRateCard, effRate]);

  // Daily rows + monthly summary (now uses AMOUNT as facility limit + overlimit rate)
  const dailyRows = useMemo(
    () => buildODDailyRows(bankTxs, effRate, form.amount || 0, overlimitRate),
    [bankTxs, effRate, form.amount, overlimitRate],
  );
  const monthSummary = useMemo(() => buildODMonthSummary(dailyRows), [dailyRows]);
  const totalInterest = useMemo(() => odTotalInterest(dailyRows), [dailyRows]);
  const lastBalance = useMemo(() => odLastEndingBalance(dailyRows), [dailyRows]);

  // หมายเหตุ: เดิมมี effect เลื่อนสถานะ Approved → Active อัตโนมัติเมื่อมีการเบิกใช้จริง
  // แต่ปุ่มอนุมัติตั้งสถานะเป็น Active ให้อยู่แล้ว effect นั้นจึงไม่มีทางทำงาน — ถอดออก

  const userLabel = useCurrentUserLabel();
  const viewOnly = useReadOnly();
  // Fetch inherited segments (Subsidiary, RPT, Class) จาก parent CA → MA
  const [inheritedSeg, setInheritedSeg] = useState<InheritedSegments>({});
  useEffect(() => {
    if (!form.ca_id) { setInheritedSeg({}); return; }
    fetchInheritedFromCA(form.ca_id).then(setInheritedSeg).catch(() => setInheritedSeg({}));
  }, [form.ca_id]);
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);

  // Status-based locking (Option B+ — shared policy in lib/status-lock.ts)
  // สถานะที่บันทึกไว้จริงในฐานข้อมูล — ใช้ตัดสินว่า "ปิดไปแล้วหรือยัง"
  // (ห้ามใช้สถานะบนหน้าจอ ไม่งั้นพอเลือกปิดสัญญา ระบบจะบอกว่าแก้ไขไม่ได้ทันที)
  const savedStatus = ((existing as any)?.main?.status as string | undefined) ?? form.status;
  const lock = computeStatusLock('OD', form.status);
  // ล็อกช่องกรอกจาก "สถานะที่บันทึกไว้จริง" ไม่ใช่สถานะบนหน้าจอ
  // ไม่งั้นพอเลือกระงับ/ปิดในช่องสถานะ ช่องอื่นจะถูกล็อกทันทีก่อนจะได้กดบันทึกด้วยซ้ำ
  const savedLock = computeStatusLock('OD', savedStatus);
  const isTerminal = lock.isTerminal;

  // ตัวเลือกสถานะที่ผู้ใช้เลือกเองได้ — ตัดสถานะของเส้นทางอนุมัติออกก่อน
  // แล้วตัดสถานะหลังอนุมัติออกด้วย ถ้าวงเงินยังไม่เคยผ่านการอนุมัติ
  const selectableStatuses = filterStatusOptions(
    OD_STATUSES as readonly string[], form.status, can('od', 'approve'), 'Active',
  ).filter((s) => s === form.status
    || !(NOT_YET_APPROVED.includes(savedStatus) && POST_APPROVAL_STATUSES.includes(s)));

  // Save
  // บริษัทเจ้าของรายการ — ธุรกรรมไม่ได้เก็บเอง ต้องไล่ขึ้นไปที่วงเงินที่ผูกอยู่
  // ใช้กันคนพิมพ์ลิงก์เข้าดูรายการของบริษัทที่ตัวเองไม่ได้ดูแล
  const { data: ownerSub } = useQuery({
    queryKey: ['scope-owner', 'od', form.ca_id],
    enabled: !!form.ca_id,
    queryFn: () => subsidiaryOfCa(form.ca_id),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!canSaveStatusChange('OD', savedStatus, form.status))
        throw new Error(`O/D สถานะ ${savedStatus} — ปิดไปแล้ว แก้ไขไม่ได้ (เปลี่ยนสถานะกลับก่อน)`);
      // ตัวตรวจช่องบังคับไม่ถือว่าเลข 0 คือช่องว่าง จึงต้องกันเองตรงนี้
      // ถ้าปล่อยให้เป็น 0 การตรวจวงเงินจะถูกข้ามไปเงียบๆ และการตรวจเบิกเกินวงเงินก็ปิดตัวเองด้วย
      if (!form.amount || form.amount <= 0) throw new Error('กรอกจำนวนเงิน (AMOUNT) ให้มากกว่า 0 ก่อนบันทึก');
      // อัตราดอกเบี้ยอยู่คนละแท็บ ตัวตรวจช่องบังคับจึงมองไม่เห็นเมื่ออยู่แท็บอื่น
      // ถ้าไม่มีอัตรา ตารางดอกเบี้ยจะว่างเปล่าและขึ้นข้อความชี้ผิดจุดว่าให้เพิ่มรายการเดินบัญชี
      if (!effRate || effRate <= 0) throw new Error('กรอกอัตราดอกเบี้ยที่แท็บ Interest ก่อนบันทึก — ถ้าไม่มีอัตรา ระบบคำนวณดอกเบี้ยไม่ได้');
      // ตรวจอัตราดอกเบี้ย "ทุกใบ" ไม่ใช่แค่ใบที่กำลังมีผล
      // เดิมตรวจแค่ใบแรก ใบที่ 2 ขึ้นไปจะใส่ค่าติดลบไว้ก็บันทึกผ่าน
      // แล้วพอถึงวันที่ใบนั้นมีผล ดอกเบี้ยจะกลายเป็นค่าติดลบทันที
      (form.rate_cards as RateCard[]).forEach((c, i) => {
        const no = i + 1;
        if ((c.rate ?? 0) < 0) throw new Error(`อัตราดอกเบี้ยใบที่ ${no} ติดลบ — กรอกค่าตั้งแต่ 0 ขึ้นไป`);
        if ((c.overlimit ?? 0) < 0) throw new Error(`อัตราส่วนเกินวงเงินใบที่ ${no} ติดลบ — กรอกค่าตั้งแต่ 0 ขึ้นไป`);
        if (effectiveRate(c) <= 0) throw new Error(`อัตราดอกเบี้ยสุทธิของใบที่ ${no} เป็น 0 หรือติดลบ (อัตรา + ส่วนต่าง) — ตรวจอีกครั้ง`);
      });
      if (!(form.account_no ?? '').trim()) throw new Error('เลือกหรือกรอกเลขบัญชี (BANK REFERENCE) ก่อนบันทึก');

      // เตือนเมื่อเลขบัญชีนี้ถูกใช้กับวงเงินเบิกเกินบัญชีฉบับอื่นอยู่แล้ว
      //
      // ดอกเบี้ยของหน้านี้คิดจากรายการเดินบัญชีของเลขบัญชีที่เลือก
      // ถ้า 2 ฉบับใช้เลขบัญชีเดียวกัน ทั้งคู่จะคิดดอกเบี้ยจากรายการชุดเดียวกัน = นับซ้ำ
      // ฐานข้อมูลไม่ได้ห้ามไว้ จึงเตือนให้ผู้ใช้ตัดสินใจแทนการบล็อก
      {
        let q = supabase
          .from('overdrafts')
          .select('od_no, name, status')
          .eq('account_no', (form.account_no ?? '').trim())
          .not('status', 'in', '("Cancelled","Closed")')
          .limit(3);
        if (id) q = q.neq('id', id);
        const { data: dupes } = await q;
        if (dupes && dupes.length > 0) {
          const refs = dupes.map((d: any) => d.name ?? d.od_no).join(', ');
          toast.warning(`เลขบัญชีนี้ถูกใช้กับวงเงินเบิกเกินบัญชีฉบับอื่นอยู่แล้ว (${refs}) — ดอกเบี้ยจะถูกคิดจากรายการเดินบัญชีชุดเดียวกันทั้ง 2 ฉบับ`);
        }
      }

      await assertWithinCreditLine(form.ca_id, form.amount, { table: 'overdrafts', id });
      // Auto-fill od_no + name if blank (avoids unique-constraint conflict on empty string)
      // Also backfills existing records with empty name → fresh running no
      const odNoFilled = (form.od_no ?? '').trim() || `DRAFT-${Date.now()}`;
      const nameFilled = (form.name ?? '').trim() || await nextRunningNo(RUNNING_PREFIX.od);
      // ช่องของขั้นตอนอนุมัติเป็นของปุ่มอนุมัติเท่านั้น — การบันทึกปกติห้ามแตะ
      // เดิมส่งทั้งฟอร์มไป ค่าที่ค้างบนจอ (โหลดมาก่อนที่ผู้อนุมัติจะกด) จะเขียนทับของจริง
      const {
        status: _status,
        submitted_by: _sb, submitted_at: _sa,
        approved_by: _ab, approved_at: _aa,
        rejection_reason: _rr,
        ...formForDb
      } = toDbPayload(form) as any;
      const payload: Record<string, any> = {
        ...formForDb,
        od_no: odNoFilled,
        name: nameFilled,
        effective_rate: effRate,
        // หน้ารายการและรายงานการใช้วงเงินอ่าน 2 ช่องนี้ แต่เดิมไม่มีใครเขียนเลย
        // ทำให้ทุกแถวขึ้น 0.00 และรายงาน 2 ฉบับให้ตัวเลขคนละอย่างสำหรับรายการเดียวกัน
        facility_limit: form.amount,
        used_amount: Math.max(0, -odLastEndingBalance(dailyRows)),
        updated_by: userLabel,
      };
      // ส่งสถานะไปเฉพาะตอนที่ผู้ใช้ตั้งใจเปลี่ยนเองในหน้านี้เท่านั้น
      if (mode === 'new' || form.status !== savedStatus) payload.status = form.status;
      let odId = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('overdrafts').insert({ ...payload, created_by: userLabel }).select().single();
        if (error) throw error;
        odId = data.id;
      } else {
        const { error } = await supabase.from('overdrafts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', odId!);
        if (error) throw error;
      }
      // Sync local form so UI shows auto-filled values
      setForm((f) => ({ ...f, od_no: odNoFilled, name: nameFilled }));
      return odId;
    },
    onSuccess: (odId: any) => {
      logSave('overdrafts', odId ?? id, form.od_no, mode === 'new');
      qc.invalidateQueries({ queryKey: ['od-list'] });
      qc.invalidateQueries({ queryKey: ['od', odId] });
      // Save happened in this session → unlock the "ส่งขออนุมัติ" button.
      setHasSavedInSession(true);
      toast.success(mode === 'new' ? 'สร้าง O/D แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new' && odId) navigate(`/tx/od/${odId}`);
    },
    // เลขที่ซ้ำ/ช่องบังคับว่างจากฐานข้อมูลเป็นข้อความอังกฤษดิบ — แปลเป็นภาษาคนก่อน
    onError: (e: any) => toast.error(friendlySaveError(e)),
  });

  // ensureOdId — auto-create Draft for Document upload before save
  const ensureOdId = async (): Promise<string> => {
    if (id) return id;
    // เดิมแนบไฟล์ก่อนบันทึกแล้วระบบสร้างรายการ DRAFT- ให้เงียบๆ ทั้งที่ยังกรอกไม่ครบ
    // ตรวจช่องบังคับก่อน แล้วบอกผู้ใช้ว่าระบบกำลังจะสร้างรายการให้
    if (!checkRequiredFields()) throw new Error('กรอกข้อมูลที่จำเป็นให้ครบก่อนแนบไฟล์');
    const odNo = (form.od_no ?? '').trim() || `DRAFT-${Date.now()}`;
    const name = (form.name ?? '').trim() || (id ? odNo : await nextRunningNo(RUNNING_PREFIX.od));
    const { data, error } = await supabase
      .from('overdrafts')
      .insert({ ...toDbPayload(form), od_no: odNo, name, status: 'Draft', effective_rate: effRate })
      .select()
      .single();
    if (error) throw new Error(friendlySaveError(error));
    qc.invalidateQueries({ queryKey: ['od-list'] });
    setForm((f) => ({ ...f, od_no: odNo, name }));
    toast.info(`สร้างรายการ ${name} ให้อัตโนมัติเพื่อเก็บไฟล์แนบ — อย่าลืมกด Save เมื่อกรอกครบ`);
    navigate(`/tx/od/${data.id}`, { replace: true });
    return data.id as string;
  };

  // JE list for this OD
  const { data: odJEs } = useQuery({
    queryKey: ['od-je', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('id, je_number, status, is_reversal, total_dr, total_cr, je_date, description, source_type, source_period')
        .in('source_type', ['OD_ACCRUED', 'OD_REVERSAL'])
        .eq('source_id', id!)
        .order('created_at', { ascending: false });
      return data ?? [];
    },
  });

  // Posted-periods (per month key = YYYY-MM) → Map for clickable Posted badges
  const postedPeriods = useMemo(() => {
    const map = new Map<string, { id: string; je_number: string }>();
    (odJEs ?? []).forEach((j: any) => {
      if (j.status === 'Posted' && !j.is_reversal && j.source_period != null) {
        map.set(String(j.source_period), { id: j.id, je_number: j.je_number });
      }
    });
    return map;
  }, [odJEs]);

  // Post Accrued JE for a month
  const postMonthJE = useMutation({
    mutationFn: async (m: { year: number; month: number; monthLabel: string; totalInterest: number; endingBalance: number }) => {
      if (!id) throw new Error('Save O/D ก่อน Post JE');
      if (!lock.canPostJE) throw new Error(`OD สถานะ ${form.status} — Post JE ไม่ได้`);
      const periodKey = `${m.year}${String(m.month).padStart(2, '0')}`;
      const sourcePeriod = parseInt(periodKey);

      // กันลงบัญชีเดือนเดิมซ้ำ — นับใบสำคัญของเดือนนี้ทุกสถานะ ไม่ใช่เฉพาะที่ลงบัญชีแล้ว
      //
      // เดิมนับเฉพาะใบที่สถานะลงบัญชีแล้ว ถ้าอีกหน้าต่างเพิ่งสร้างใบไว้แต่ยังลงไม่เสร็จ
      // หน้าต่างนี้จะมองไม่เห็นแล้วสร้างใบที่ 2 ทับ
      const countExisting = async () => {
        const { data } = await supabase
          .from('journal_entries')
          .select('je_number, status')
          .eq('source_type', 'OD_ACCRUED')
          .eq('source_id', id)
          .eq('source_period', sourcePeriod)
          .eq('is_reversal', false);
        return (data ?? []).filter((j: any) => j.status !== 'Cancelled' && j.status !== 'Void');
      };
      const before = await countExisting();
      if (before.length > 0) {
        throw new Error(`เดือน ${m.monthLabel} มีใบสำคัญอยู่แล้ว: ${before[0].je_number}`);
      }

      const totalEnding = m.endingBalance - m.totalInterest;
      const jeDate = fmtDateISO(new Date(m.year, m.month, 0)); // end of month

      // ผังบัญชีอ่านจากแท็บผังบัญชีของสัญญา — ถ้ายังไม่ได้ผูกไว้ค่อยใช้บัญชีตั้งต้น
      // เดิมฝังรหัสบัญชีไว้ในโค้ด ใบสำคัญจึงไม่ตรงกับที่ผู้ใช้ตั้งไว้ในแท็บผังบัญชี
      const glFor = (acctType: string, fallback: string): { code: string; name: string } => {
        const card = (form.acct_cards as AcctCard[]).find((a) => a.type === acctType);
        const raw = card?.gl ?? fallback;
        const sp = raw.indexOf(' ');
        return sp > 0 ? { code: raw.slice(0, sp), name: raw.slice(sp + 1) } : { code: '', name: raw };
      };
      const glInterest = glFor('INTEREST EXPENSE ACCOUNT', '5512101 ดอกเบี้ยจ่าย-เงินเบิกเกินบัญชี');
      const glCash = glFor('CASH / BANK ACCOUNT', '100000 Cheque Account');
      const glOD = glFor('NOTE PAYABLE ACCOUNT', '2142101 เงินกู้ยืมระยะสั้นสถาบันการเงิน (O/D)');

      const je = await createJE({
        source_type: 'OD_ACCRUED',
        source_id: id,
        source_period: sourcePeriod,
        je_date: jeDate,
        description: `${form.name ?? form.od_no} — ${m.monthLabel} Accrued Interest`,
        remark: 'JV – Interest + Bank Overdraft · Auto-reverse next month',
        lines: [
          // JV – Interest
          {
            account_code: glInterest.code,
            account_name: glInterest.name,
            dr: m.totalInterest,
            description: 'Interest expense — O/D',
          },
          {
            account_code: glCash.code,
            account_name: glCash.name,
            cr: m.totalInterest,
            description: 'Cash leg (offset)',
          },
          // JV – Bank Overdraft (Outstanding)
          {
            account_code: glCash.code,
            account_name: glCash.name,
            dr: Math.abs(totalEnding),
            description: 'Reclass utilized OD to Bank Overdraft liability',
          },
          {
            account_code: glOD.code,
            account_name: glOD.name,
            cr: Math.abs(totalEnding),
            description: 'Bank Overdraft outstanding',
          },
        ],
      });
      // ตรวจอีกครั้งหลังสร้าง — ถ้าอีกหน้าต่างสร้างใบของเดือนเดียวกันแทรกมาระหว่างนี้
      // ให้หยุดก่อนลงบัญชี จะได้ไม่มีใบสำคัญของเดือนเดียวกัน 2 ใบที่ลงบัญชีทั้งคู่
      const after = (await countExisting()).filter((j: any) => j.je_number !== je.je_number);
      if (after.length > 0) {
        throw new Error(`มีใบสำคัญของเดือน ${m.monthLabel} ถูกสร้างพร้อมกันจากอีกหน้าต่าง (${after[0].je_number}) — ยกเลิกการลงบัญชีรอบนี้ กรุณาโหลดหน้าใหม่`);
      }
      await postJE(je.id, 'user');
      return { je, amount: m.totalInterest };
    },
    onSuccess: ({ je, amount }) => {
      qc.invalidateQueries({ queryKey: ['od-je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Posted ${je.je_number} (OD_ACCRUED · ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Reverse a posted JE
  const reverseMonthJE = useMutation({
    mutationFn: async (jeId: string) => {
      await reverseJE(jeId, 'user');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['od-je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('✓ JE reversed');
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ============ Tabs ============
  const tabs: TabDef[] = [
    {
      key: 'interest',
      label: 'Interest',
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
      key: 'bank',
      label: 'Bank Transaction',
      render: () => <BankTransactionTab accountNo={form.account_no} />,
    },
    {
      key: 'sched',
      label: 'Schedule Calculate',
      render: () => (
        <ScheduleCalcTab
          dailyRows={dailyRows}
          monthSummary={monthSummary}
          totalInterest={totalInterest}
          lastBalance={lastBalance}
          postedPeriods={postedPeriods}
          onPostMonth={(m) => postMonthJE.mutate(m)}
          posting={postMonthJE.isPending}
          fpJEs={odJEs ?? []}
          onReverseJE={(jeId) => reverseMonthJE.mutate(jeId)}
          reversing={reverseMonthJE.isPending}
          odId={id}
          canPostJE={lock.canPostJE}
          statusLabel={form.status}
          viewOnly={viewOnly}
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
                O/D
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureOdId}
              bucketName="od-documents"
              tableName="od_documents"
              parentFkColumn="od_id"
            />
          </div>
        </div>
      ),
    },
    // แท็บกระทบยอดถูกถอดออกจากโมดูลนี้
    // วงเงินเบิกเกินบัญชีคิดดอกเบี้ยจากยอดคงเหลือรายวัน ไม่มีตารางงวดให้เทียบ
    // แท็บนี้จึงว่างเปล่าตลอด — การกระทบยอดทำที่แท็บรายการเดินบัญชีแทน
  ];

  const selectedCa = caOptions?.find((c) => c.id === form.ca_id);

  return (
    <ScopeGuard skip={mode === 'new'} subsidiary={mode === 'edit' && !form.ca_id ? undefined : ownerSub}>
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/od')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Overdraft
            <Badge variant={statusVariant[form.status] ?? 'default'}>{form.status}</Badge>
          </h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New Overdraft' : (form.name ?? form.od_no)}
          </p>
        </div>
        <Button variant="primary" disabled={save.isPending || !can('od', 'edit')} title={!can('od', 'edit') ? 'ไม่มีสิทธิ์แก้ไข O/D' : ''} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={() => navigate('/tx/od')}>Cancel</Button>
      </div>

      {/* วันเวลาถูกตัดออกตอนโหลดเข้าฟอร์ม จึงต้องอ่านจากข้อมูลที่โหลดมาโดยตรง
          ไม่งั้นแถบนี้จะมีแต่ชื่อ ไม่เคยขึ้นวันเวลาเลย */}
      <AuditFooter
        createdBy={(form as any).created_by}
        createdAt={(existing as any)?.main?.created_at}
        updatedBy={(form as any).updated_by}
        updatedAt={(existing as any)?.main?.updated_at}
      />

      <StatusLockBanner lock={lock} />

      {id && (
        <ApprovalPanel
          facilityTable="overdrafts"
          facilityId={id}
          currentStatus={form.status}
          statusField="status"
          approvedValue="Active"
          disableSubmit={!hasSavedInSession}
          disableSubmitHint="กรุณากด Save ก่อน (เพื่อยืนยันว่าตรวจข้อมูลแล้ว) แล้วจึงส่งขออนุมัติได้"
        />
      )}

      {/* วงเงินที่ถูกระงับหรือปิดไปแล้ว ต้องล็อกช่องเงื่อนไขตั้งแต่เปิดหน้า ตามที่แถบเตือนด้านบนแจ้งไว้
          ไม่ใช่ปล่อยให้พิมพ์ได้แล้วค่อยฟ้องตอนกดบันทึก — เสียเวลากรอกฟรี
          (ช่องสถานะกับช่องหมายเหตุยกเว้นไว้ด้านล่าง เพราะต้องปลดระงับหรือย้อนสถานะกลับมาแก้ได้) */}
      <ReadOnlyContext.Provider value={viewOnly || savedLock.termsFrozen}>

      {/* Primary Information (3-col) */}
      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
          <div className="space-y-4">
            <div>
              {/* เลือกวงเงินแล้วธนาคารตามมาให้เอง แต่ยังแก้เองได้ตามที่เอกสารข้อกำหนดระบุ
                  (ระบุ read-only ไว้เฉพาะชั้นวงเงินเท่านั้น ไม่ใช่ชั้นรายการธุรกรรม) */}
                  <FieldLabel required>FINANCE INSTITUTION</FieldLabel>
              <Select
                value={form.finance_institution}
                onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}
              >
                <option value="">— เลือกสถาบันการเงิน —</option>
                {bankCodes.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel tipKey="OD NAME">NAME (auto)</FieldLabel>
              <Input readOnly value={form.name ?? ''} placeholder="auto — running no. (สร้างเมื่อ Save)" className="bg-gray-50 text-muted" />
            </div>
            <div>
              <FieldLabel required tipKey="CREDIT AGREEMENT NAME">CREDIT AGREEMENT NAME</FieldLabel>
              <Select
                value={form.ca_id ?? ''}
                onChange={async (e) => { const caId = e.target.value || null; setForm((f) => ({ ...f, ca_id: caId })); if (caId) { const cc = await fetchCaCards(caId); setForm((f) => ({ ...f, finance_institution: cc.fi || f.finance_institution, rate_cards: (f.rate_cards && (f.rate_cards as any[]).length) ? f.rate_cards : cc.rate_cards, acct_cards: (f.acct_cards && (f.acct_cards as any[]).length) ? f.acct_cards : cc.acct_cards })); } }}
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
              <FieldLabel tipKey="OD TRANSACTION NUMBER">OD TRANSACTION NUMBER</FieldLabel>
              <Input
                value={form.od_no}
                onChange={(e) => setForm((f) => ({ ...f, od_no: e.target.value }))}
                placeholder="O/D 202410-001178"
                className="bg-gray-50"
              />
            </div>
            <div>
              <FieldLabel required tipKey="BANK REFERENCE">BANK REFERENCE (Account No)</FieldLabel>
              {accountOptions.length === 0 ? (
                <>
                  {/* เดิมช่องนี้เป็นช่องอ่านอย่างเดียวว่างเปล่า ทั้งที่บังคับกรอก
                      ถ้ายังไม่มีใบแจ้งยอดในระบบเลย ผู้ใช้จะบันทึกรายการไม่ได้และแก้ในหน้านี้ไม่ได้
                      จึงเปิดให้พิมพ์เลขบัญชีเองไว้ก่อน แล้วค่อยไปสร้างใบแจ้งยอดทีหลัง */}
                  <Input
                    value={form.account_no ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, account_no: e.target.value || null }))}
                    placeholder="พิมพ์เลขบัญชี เช่น 123-4-56789-0"
                  />
                  <p className="text-[10px] text-muted mt-0.5">
                    ⚠️ ยังไม่มี Bank Statement ในระบบ — พิมพ์เลขบัญชีไว้ก่อนได้ แต่จะยังไม่มีดอกเบี้ยให้คำนวณจนกว่าจะ{' '}
                    <a href="/master/bank-statement/new" className="text-brand underline">
                      สร้าง Bank Statement
                    </a>
                  </p>
                </>
              ) : (
                <>
                  <Select
                    value={form.account_no ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, account_no: e.target.value || null }))}
                  >
                    {/* ต้องมีตัวเลือกว่าง ไม่งั้นตอนสร้างใหม่ช่องจะโชว์เลขบัญชีแรกเหมือนเลือกไว้แล้ว
                        ทั้งที่ค่าจริงยังว่าง · และเลือกไปแล้วก็ล้างค่าไม่ได้อีกเลย */}
                    <option value="">— เลือกเลขบัญชี —</option>
                    {accountOptions.map((s: any) => (
                      <option key={s.account_no} value={s.account_no}>
                        {s.account_no}
                        {s.finance_institution ? ` · ${s.finance_institution}` : ''}
                        {s.statement_name ? ` · ${s.statement_name}` : ''}
                        {s.statement_period ? ` (${s.statement_period})` : ''}
                      </option>
                    ))}
                  </Select>
                </>
              )}
            </div>
          </div>

          {/* COL 2 */}
          <div className="space-y-4">
            <div>
              <FieldLabel required tipKey="OD TRANSACTION DATE">OD TRANSACTION DATE</FieldLabel>
              <Input
                type="date"
                value={form.transaction_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value || null }))}
              />
            </div>
            <div>
              {/* หน้ารายการมีคอลัมน์ Start แต่เดิมไม่มีช่องให้กรอก ค่าถูกตั้งเป็นวันที่สร้างเสมอ */}
              <FieldLabel>วันเริ่มวงเงิน (START DATE)</FieldLabel>
              <Input
                type="date"
                value={form.start_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value || fmtDateISO(new Date()) }))}
              />
            </div>
            <div>
              {/* เดิมไม่มีช่องนี้เลย ค่าจึงว่างตลอด ทำให้แจ้งเตือนวงเงินใกล้หมดอายุ
                  ไม่มีวันทำงานกับรายการที่สร้างจากหน้าจอ และคอลัมน์ End ในหน้ารายการขึ้น — ทุกแถว */}
              <FieldLabel>วันสิ้นสุดวงเงิน (END DATE)</FieldLabel>
              <Input
                type="date"
                value={form.end_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value || null }))}
              />
              <p className="text-[10px] text-muted mt-0.5">ใช้แจ้งเตือนล่วงหน้าก่อนวงเงินหมดอายุ · เว้นว่างได้ถ้าวงเงินไม่มีกำหนดสิ้นสุด</p>
            </div>
            <div>
              <FieldLabel>FACILITY TYPE</FieldLabel>
              <Input readOnly value="O/D" className="bg-gray-50" />
            </div>
            <div>
              <FieldLabel required>AMOUNT</FieldLabel>
              <NumInput
                step="0.01"
                value={form.amount ?? 0}
                onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
                className="text-right tabular-nums"
              />
            </div>
          </div>

          {/* COL 3 */}
          {/* ช่องสถานะกับช่องหมายเหตุอยู่นอกกรอบล็อกด้านบน — ต้องปลดระงับหรือย้อนสถานะกลับมาแก้ได้เสมอ */}
          <ReadOnlyContext.Provider value={viewOnly}>
          <div className="space-y-4">
            <div>
              <FieldLabel required>STATUS</FieldLabel>
              <Select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ODStatus }))}
              >
                {selectableStatuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
              {NOT_YET_APPROVED.includes(savedStatus) && (
                <p className="text-[10px] text-muted mt-0.5 italic">
                  สถานะระงับชั่วคราวและปิดวงเงินจะเลือกได้หลังวงเงินผ่านการอนุมัติแล้วเท่านั้น
                </p>
              )}
              {/* ปุ่มขออนุมัติ/อนุมัติ ต้องหายไปตอนเปิดดูอย่างเดียว — ปุ่มชุดนี้เช็คสิทธิ์เอง ไม่รู้จักโหมดเปิดดู */}
              {!viewOnly && (
                <div className="mt-2">
                  <ApprovalActions menuKey="od" table="overdrafts" id={id} status={form.status}
                    approvedStatus="Active" rejectStatus="Cancelled"
                    onChanged={(s) => {
                      setForm((f) => ({ ...f, status: s as any }));
                      // ผู้อนุมัติเพิ่งเขียนเหตุผลต่อท้ายหมายเหตุลงฐานข้อมูล — ต้องดึงกลับมาแสดงทันที
                      // ไม่งั้นค่าบนจอเป็นของเก่า แล้วการบันทึกครั้งถัดไปจะเขียนทับข้อความนั้น
                      qc.invalidateQueries({ queryKey: ['od', id] });
                    }} />
                </div>
              )}
              <ApprovalNote remark={form.remark} />
            </div>
            <div>
              <FieldLabel>REMARK</FieldLabel>
              {/* ช่องหมายเหตุเดิมเป็นช่องพิมพ์ดิบ ไม่รู้จักโหมดเปิดดูอย่างเดียว จึงยังพิมพ์ได้ */}
              <Textarea
                className="min-h-[60px]"
                value={form.remark ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
                placeholder="เพื่อใช้ในการหมุนเวียนกิจการ"
              />
            </div>
          </div>
          </ReadOnlyContext.Provider>
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
          disabled={viewOnly || savedLock.termsFrozen}
        />
      </Section>

      <div className="mt-4">
        <Tabs tabs={tabs} />
      </div>
      </ReadOnlyContext.Provider>
    </div>
    </ScopeGuard>
  );
}

// ============== Bank Transaction Tab (derived view) ==============
function BankTransactionTab({ accountNo }: { accountNo: string | null }) {
  // Fetch matching statements + lines (read-only view of master data)
  const { data: matchedStmts } = useQuery({
    queryKey: ['od-bank-stmts', accountNo],
    enabled: !!accountNo,
    queryFn: async () => {
      // ต้องกรองใบแจ้งยอดที่ปิดใช้งานแล้วออกให้เหมือนตอนคำนวณดอกเบี้ย
      // เดิมแท็บนี้โชว์ทุกใบ ผู้ใช้จึงเห็นรายการที่ตารางดอกเบี้ยไม่ได้นับ แล้วงงว่าทำไมยอดไม่ตรง
      const { data } = await supabase
        .from('bank_statements')
        .select('*')
        .eq('account_no', accountNo!)
        .eq('inactive', false)
        .order('statement_period', { ascending: false });
      return data ?? [];
    },
  });

  const stmtIds = (matchedStmts ?? []).map((s: any) => s.id);

  const { data: lines = [] } = useQuery({
    queryKey: ['od-bank-stmt-lines', stmtIds.join(',')],
    enabled: stmtIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('bank_statement_lines')
        .select('*')
        .in('statement_id', stmtIds)
        .order('tx_date');
      return data ?? [];
    },
  });

  if (!accountNo) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded text-sm">
        ⚠️ ยังไม่ได้ระบุ <strong>Bank Reference (Account No)</strong> ใน Primary Information —
        กรอกก่อนเพื่อ match กับ Bank Statement master
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Daily list — all columns center-aligned */}
      <div className="overflow-x-auto max-h-[520px] border border-line rounded">
        <table className="table-base text-xs m-0 text-center">
          <thead className="sticky top-0 bg-soft">
            <tr>
              <ThTip align="center">Date</ThTip>
              <ThTip align="center">Time</ThTip>
              <ThTip align="center">Txn Code</ThTip>
              <ThTip align="center">Debit</ThTip>
              <ThTip align="center">Credit</ThTip>
              <ThTip align="center">Balance</ThTip>
              <ThTip align="center">Source</ThTip>
              <ThTip align="center">Statement</ThTip>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-muted py-8 italic">
                  ไม่พบ Bank Statement สำหรับ Account <strong className="font-mono">{accountNo}</strong>
                  <br />
                  ไปสร้างที่{' '}
                  <a href="/master/bank-statement/new" className="text-brand underline">
                    + New Bank Statement
                  </a>
                </td>
              </tr>
            )}
            {lines.map((l: any) => {
              const isManual = l.source === 'Manual';
              const negBalance = l.balance < 0;
              const stmt: any = matchedStmts?.find((s: any) => s.id === l.statement_id);
              return (
                <tr key={l.id} className={isManual ? 'bg-amber-50' : ''}>
                  <td className="text-center">{fmtDate(l.tx_date)}</td>
                  <td className="text-center text-xs">{l.tx_time ?? '—'}</td>
                  <td className="text-center font-mono text-xs">{l.txn_code ?? '—'}</td>
                  <td className="text-center tabular-nums">{l.debit > 0 ? fmtMoney(l.debit) : '—'}</td>
                  <td className="text-center tabular-nums">{l.credit > 0 ? fmtMoney(l.credit) : '—'}</td>
                  <td className={`text-center tabular-nums ${negBalance ? 'text-danger' : ''}`}>
                    {negBalance ? `(${fmtMoney(Math.abs(l.balance))})` : fmtMoney(l.balance)}
                  </td>
                  <td className={`text-center ${isManual ? 'text-amber-700 font-semibold' : ''}`}>{l.source}</td>
                  <td className="text-center text-xs">
                    <a className="text-brand hover:underline" href={`/master/bank-statement/${l.statement_id}`}>
                      {stmt?.statement_period ?? stmt?.statement_name ?? l.statement_id.slice(0, 8)}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============== Schedule Calculate Tab ==============
function ScheduleCalcTab({
  dailyRows,
  monthSummary,
  totalInterest,
  lastBalance,
  postedPeriods,
  onPostMonth,
  posting,
  fpJEs,
  onReverseJE,
  reversing,
  odId,
  canPostJE,
  statusLabel,
  viewOnly,
}: {
  dailyRows: any[];
  monthSummary: any[];
  totalInterest: number;
  lastBalance: number;
  postedPeriods: Map<string, { id: string; je_number: string }>;
  onPostMonth: (m: any) => void;
  posting: boolean;
  fpJEs: any[];
  onReverseJE: (id: string) => void;
  reversing: boolean;
  odId: string | undefined;
  canPostJE: boolean;
  statusLabel: string;
  viewOnly: boolean;
}) {
  const [sub, setSub] = useState<'daily' | 'summary'>('daily');
  const totalEnding = lastBalance - totalInterest;

  // ช่วงวันที่ที่ตารางรายวันครอบคลุมจริง — เดิมหัวตารางบอกเดือนของแถวสุดท้ายเดือนเดียว
  // ทั้งที่ตารางแสดงทุกเดือนที่มีรายการเดินบัญชี
  const dailyRangeLabel = dailyRows.length === 0
    ? '—'
    : (() => {
        const first = fmtDate(dailyRows[0].date);
        const last = fmtDate(dailyRows[dailyRows.length - 1].date);
        return first === last ? first : `${first} – ${last}`;
      })();

  // ช่วงปีที่ตารางสรุปรายเดือนครอบคลุม — เดิมบอกปีของแถวแรกปีเดียว
  const summaryYearLabel = monthSummary.length === 0
    ? String(new Date().getFullYear())
    : (() => {
        const years = monthSummary.map((m: any) => m.year);
        const min = Math.min(...years);
        const max = Math.max(...years);
        return min === max ? String(min) : `${min} – ${max}`;
      })();

  // ใบสำคัญของจริงลงแยกรายเดือน — ตัวอย่างจึงต้องใช้ยอดของเดือนล่าสุดเดือนเดียว
  // เดิมตัวอย่างเอาดอกเบี้ยทุกเดือนมารวมกัน ผู้ใช้เทียบกับใบจริงแล้วยอดไม่ตรง
  const previewMonth = monthSummary.length > 0 ? monthSummary[monthSummary.length - 1] : null;
  const previewInterest = previewMonth ? previewMonth.totalInterest : 0;
  const previewEnding = previewMonth ? Math.abs(previewMonth.totalEndingBalance) : 0;

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-5 mb-4 pb-1.5 border-b border-line">
        {([
          { key: 'daily', label: 'Daily Transaction' },
          { key: 'summary', label: 'Summary Transaction' },
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

      {sub === 'daily' ? (
        <div className="flex gap-6 flex-wrap">
          <div className="flex-1 min-w-[380px]">
            <div className="text-sm font-bold mb-2">
              ดอกเบี้ยรายวัน — {dailyRangeLabel}
            </div>
            <div className="overflow-x-auto max-h-[520px] border border-line rounded">
              <table className="table-base text-xs m-0 text-center">
                <thead className="sticky top-0 bg-soft">
                  <tr>
                    <ThTip align="center">Date</ThTip>
                    <ThTip align="center">Days</ThTip>
                    <ThTip align="center">Ending Balance</ThTip>
                    <ThTip align="center">Interest Rate</ThTip>
                    <ThTip align="center">Interest</ThTip>
                    <ThTip align="center">Status</ThTip>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-muted py-6 italic">
                        ยังไม่มีข้อมูล — เพิ่ม Bank Transaction ก่อน
                      </td>
                    </tr>
                  ) : (
                    dailyRows.map((r: any) => {
                      const neg = r.endingBalance < 0;
                      return (
                        <tr key={r.date} className={r.overLimit ? 'bg-red-50' : ''}>
                          <td className="text-center">{fmtDate(r.date)}</td>
                          <td className="text-center tabular-nums" title={`Daily Interest = ${fmtMoney(r.dailyInterest ?? 0)} × ${r.days ?? 1} days`}>
                            {r.days ?? 1}
                          </td>
                          <td className={`text-center tabular-nums ${neg ? 'text-danger' : ''}`}>
                            {neg ? `(${fmtMoney(Math.abs(r.endingBalance))})` : fmtMoney(r.endingBalance)}
                          </td>
                          <td className="text-center tabular-nums">
                            {r.overLimit ? (
                              // ข้อความเดิมเขียนว่า "+ x% overlimit" เหมือนเอาไปบวกเพิ่มจากอัตราปกติ
                              // แต่ระบบคิดที่ x% เต็มของยอดส่วนที่เกินวงเงิน ไม่ได้บวกทบ
                              <div
                                className="leading-tight"
                                title={
                                  `คิดแยก 2 ส่วน: ยอดในวงเงิน ${fmtMoney(r.endingBalance < 0 ? Math.abs(r.endingBalance) - r.overLimitAmount : 0)} คิดที่ ${r.ratePct.toFixed(4)}%`
                                  + ` · ยอดส่วนเกิน ${fmtMoney(r.overLimitAmount)} คิดที่ ${r.overlimitRatePct.toFixed(4)}% เต็ม (ไม่ได้บวกทบกับอัตราปกติ)`
                                }
                              >
                                <div>ในวงเงิน {r.ratePct.toFixed(4)}%</div>
                                <div className="text-danger font-semibold text-[10px]">
                                  ส่วนเกิน {r.overlimitRatePct.toFixed(4)}%
                                </div>
                              </div>
                            ) : (
                              `${r.ratePct.toFixed(4)}%`
                            )}
                          </td>
                          <td className="text-center tabular-nums">{fmtMoney(r.interest)}</td>
                          <td className="text-center">
                            {r.overLimit ? (
                              <span className="text-danger font-semibold" title={`Over limit by ${fmtMoney(r.overLimitAmount)}`}>
                                ⚠ Over Limit
                              </span>
                            ) : neg ? (
                              <span className="text-amber-700">Within Limit</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-1 text-sm max-w-md">
              <RowTip label="Interest Expense (Outstanding)" value={fmtMoney(totalInterest)} bold />
              <RowTip
                label="Ending Balance"
                value={
                  <span className={lastBalance < 0 ? 'text-danger font-bold' : 'font-bold'}>
                    {lastBalance < 0 ? `(${fmtMoney(Math.abs(lastBalance))})` : fmtMoney(lastBalance)}
                  </span>
                }
              />
              {/* เดิมยอดนี้แสดงในวงเล็บสีแดงตลอด แม้เป็นยอดบวก (มีเงินคงเหลือ ไม่ได้เป็นหนี้) */}
              <RowTip
                label="Total Ending Balance"
                value={
                  <span className={totalEnding < 0 ? 'text-danger font-bold' : 'font-bold'}>
                    {totalEnding < 0 ? `(${fmtMoney(Math.abs(totalEnding))})` : fmtMoney(totalEnding)}
                  </span>
                }
                bold
              />
            </div>
            <p className="text-[11px] text-muted mt-2 italic">
              💡 ระบบจะนำข้อมูลจาก Import / Manual Bank Statement มาคำนวณดอกเบี้ยอัตโนมัติ (ตอนยอดติดลบเท่านั้น)
            </p>
            <p className="text-[11px] text-muted mt-1 italic">
              ℹ️ ตารางนี้คิดด้วยอัตราดอกเบี้ยใบที่มีผล ณ วันเริ่มคำนวณใบเดียวตลอดช่วง —
              ถ้าอัตราเปลี่ยนกลางช่วง ให้แยกใบแจ้งยอดตามช่วงอัตราแล้วดูทีละช่วง
            </p>
          </div>

          <div className="flex-1 min-w-[360px]">
            <div className="text-sm font-bold mb-3">
              📋 ตัวอย่างใบสำคัญ — เดือน {previewMonth ? previewMonth.monthLabel : '—'}
            </div>
            {previewMonth ? (
              <>
                <div className="mb-4 border border-line rounded overflow-hidden">
                  <div className="bg-brand text-white px-3 py-2 text-xs font-bold flex justify-between">
                    <span>JV – Interest</span>
                    <span className="flex gap-6 tracking-wider"><span>DR</span><span>CR</span></span>
                  </div>
                  <table className="table-base text-xs m-0">
                    <tbody>
                      <tr><td>Dr. Interest Expenses</td><td className="text-right tabular-nums">{fmtMoney(previewInterest)}</td><td /></tr>
                      <tr><td>Cr. Bank</td><td /><td className="text-right tabular-nums">{fmtMoney(previewInterest)}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div className="mb-2 border border-line rounded overflow-hidden">
                  <div className="bg-brand text-white px-3 py-2 text-xs font-bold flex justify-between">
                    <span>JV – Bank Overdraft</span>
                    <span className="flex gap-6 tracking-wider"><span>DR</span><span>CR</span></span>
                  </div>
                  <table className="table-base text-xs m-0">
                    <tbody>
                      <tr><td>Dr. Bank</td><td className="text-right tabular-nums">{fmtMoney(previewEnding)}</td><td /></tr>
                      <tr><td>Cr. Bank Overdraft</td><td /><td className="text-right tabular-nums">{fmtMoney(previewEnding)}</td></tr>
                    </tbody>
                  </table>
                </div>
                {/* ตัวอย่างต้องตรงกับใบจริง — ใบจริงลงแยกรายเดือนที่แท็บสรุปรายเดือน */}
                <p className="text-[11px] text-muted italic mb-3">
                  ** ตัวอย่างนี้คือใบสำคัญของเดือน {previewMonth.monthLabel} เดือนเดียว —
                  ใบจริงลงแยกรายเดือน กดได้ที่แท็บ Summary Transaction · กลับรายการต้นเดือนถัดไป
                </p>
              </>
            ) : (
              <p className="text-muted text-sm italic">เพิ่ม Bank Transaction ก่อน — ตัวอย่างใบสำคัญจะแสดงที่นี่</p>
            )}
          </div>
        </div>
      ) : (
        // Summary Transaction sub-tab
        <div>
          <div className="text-sm font-bold mb-2">สรุปรายเดือน — ปี {summaryYearLabel}</div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <ThTip>Month</ThTip>
                  {/* คอลัมน์ Actual Interest ถูกถอดออก — เดิมแสดงตัวเลขชุดเดียวกับ Interest เสมอ
                      เพราะยังไม่มีที่เก็บยอดดอกเบี้ยที่ธนาคารเรียกเก็บจริงแยกต่างหาก */}
                  <ThTip align="right">Interest</ThTip>
                  <ThTip align="right">Interest Rate</ThTip>
                  <ThTip align="right">Utilization End of Month</ThTip>
                  <ThTip>Journal Entry</ThTip>
                </tr>
              </thead>
              <tbody>
                {monthSummary.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-6 italic">
                      ยังไม่มีข้อมูล — เพิ่ม Bank Transaction ก่อน
                    </td>
                  </tr>
                ) : (
                  monthSummary.map((m) => {
                    const periodKey = `${m.year}${String(m.month).padStart(2, '0')}`;
                    const isPosted = postedPeriods.has(periodKey);
                    const monthJE = fpJEs.find((j: any) => String(j.source_period) === periodKey && !j.is_reversal && j.status === 'Posted');
                    return (
                      <tr key={periodKey} className={isPosted ? 'bg-emerald-50' : 'bg-amber-50'}>
                        <td className="font-bold text-brand">{m.monthLabel}</td>
                        <td className="text-right tabular-nums font-semibold">{fmtMoney(m.totalInterest)}</td>
                        <td className="text-right tabular-nums">{m.rate.toFixed(4)}%</td>
                        {/* เดิมเงื่อนไขสีเช็ค endingBalance แต่ตัวเลขที่แสดงคือ totalEndingBalance — คนละค่ากัน */}
                        <td className={`text-right tabular-nums ${m.totalEndingBalance < 0 ? 'text-danger font-semibold' : ''}`}>
                          {m.totalEndingBalance < 0 ? `(${fmtMoney(Math.abs(m.totalEndingBalance))})` : fmtMoney(m.totalEndingBalance)}
                        </td>
                        <td>
                          {isPosted && monthJE ? (
                            <div className="flex gap-2 items-center justify-center text-xs">
                              <a href={`/je/${monthJE.id}`} title={`เปิดดู ${monthJE.je_number}`}>
                                <Badge variant="success">✓ ลงบัญชีแล้ว</Badge>
                              </a>
                              <button
                                onClick={() => {
                                  // กลับรายการใบสำคัญที่ลงบัญชีไปแล้ว ย้อนคืนเองไม่ได้ — ต้องถามก่อน
                                  if (confirm(`กลับรายการใบสำคัญ ${monthJE.je_number} ของเดือน ${m.monthLabel}?`)) {
                                    onReverseJE(monthJE.id);
                                  }
                                }}
                                disabled={reversing || viewOnly}
                                className="text-danger hover:underline"
                                title="กลับรายการใบสำคัญเดือนนี้"
                              >
                                ↩ Reverse
                              </button>
                            </div>
                          ) : (
                            (() => {
                              const cantSave = !odId;
                              const noInterest = m.totalInterest <= 0;
                              // เดิมปุ่มดูเหมือนกดได้แม้สัญญาปิดไปแล้ว กดแล้วถึงขึ้นข้อความว่าลงบัญชีไม่ได้
                              const statusBlocked = !canPostJE;
                              const isDisabled = cantSave || posting || noInterest || statusBlocked || viewOnly;
                              const reason = cantSave
                                ? 'บันทึก O/D ก่อน'
                                : statusBlocked
                                  ? `สถานะ ${statusLabel} — ลงบัญชีไม่ได้`
                                  : noInterest
                                    ? 'ดอกเบี้ยเดือนนี้เป็น 0 (ยอดคงเหลือไม่ติดลบ) — ไม่มีอะไรให้ลงบัญชี'
                                    : 'ลงบัญชีดอกเบี้ยค้างจ่ายและยอดเบิกเกินบัญชีของเดือนนี้';
                              return (
                                <button
                                  onClick={() => onPostMonth(m)}
                                  disabled={isDisabled}
                                  title={reason}
                                  className={`text-xs font-semibold rounded px-2 py-1 transition ${
                                    isDisabled
                                      ? 'bg-gray-100 text-muted cursor-not-allowed line-through opacity-60'
                                      : 'bg-brand text-white hover:bg-brand-dark'
                                  }`}
                                >
                                  📋 {posting ? 'กำลังลงบัญชี…' : 'ลงบัญชีเดือนนี้'}
                                </button>
                              );
                            })()
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 space-y-1 text-sm max-w-md">
            <RowTip label="Interest Expense (Outstanding)" value={fmtMoney(totalInterest)} bold />
            {/* เดิมยอดนี้แสดงในวงเล็บสีแดงตลอด แม้เป็นยอดบวก */}
            <RowTip
              label="Total Ending Balance"
              value={
                <span className={totalEnding < 0 ? 'text-danger font-bold' : 'font-bold'}>
                  {totalEnding < 0 ? `(${fmtMoney(Math.abs(totalEnding))})` : fmtMoney(totalEnding)}
                </span>
              }
              bold
            />
          </div>
        </div>
      )}
    </div>
  );
}
