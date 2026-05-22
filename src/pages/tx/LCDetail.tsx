import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Repeat2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchCaCards } from '@/lib/ca-inherit';
import { Button, Input, Select, Badge, FieldLabel, Modal, NumInput } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type LetterOfCredit, type LCStatus, FINANCE_INSTITUTIONS } from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { RepaymentsReceived } from '@/components/tx/RepaymentsReceived';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import { createJE, postJE } from '@/lib/je';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { buildLCFeeSchedule } from '@/lib/lc-fee-schedule';

const LC_STATUSES: LCStatus[] = ['Draft', 'Approved', 'Active', 'Converted', 'Expired', 'Closed'];
const CURRENCIES = ['USD', 'THB', 'EUR', 'JPY', 'GBP', 'CNY', 'SGD'];

type Form = Omit<LetterOfCredit, 'id' | 'created_at' | 'updated_at'>;

const blank: Form = {
  lc_no: '',
  name: null,
  ca_id: null,
  finance_institution: 'KBANK',
  lc_type: 'LC',
  beneficiary: null,
  applicant: 'MGC Asia',
  currency: 'USD',
  amount_foreign: 0,
  conversion_rate: null,
  amount: 0,
  issue_date: new Date().toISOString().slice(0, 10),
  expiry_date: null,
  transaction_date: new Date().toISOString().slice(0, 10),
  term_days: 90,
  fee_mode: 'full_term',
  fee_rate: 1.48,
  engagement_fee: 0,
  fee_amount: 0,
  reference_fxf_id: null,
  reference_contract: null,
  shared_limit_with_tr: true,
  converted_tr_id: null,
  conversion_date: null,
  inactive: false,
  status: 'Draft',
  remark: null,
  rate_cards: [],
  acct_cards: [],
};

// LC GL accounts — Off-Balance fee model (no interest, MoM Day3 §7).
const LC_GL = {
  feeExpense: { code: '615000', name: 'L/C Fee Expense' },
  prepaidFee: { code: '118500', name: 'Prepaid L/C Fee' },
  bankPayable: { code: '212020', name: 'Bank Payable — L/C Fee' },
  contingent: { code: '900100', name: 'Contingent Liability — L/C (Off-Balance)' },
  contingentContra: { code: '900200', name: 'Contra — L/C Commitment' },
};

export function LCDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const userLabel = useCurrentUserLabel();
  const { can: rawCan } = useAuth();
  const viewOnly = useReadOnly();
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);

  const [form, setForm] = useState<Form>(blank);
  const [acctCards, setAcctCards] = useState<AcctCard[]>([]);
  const today = new Date().toISOString().slice(0, 10);

  // Convert → TR modal
  const [showConvert, setShowConvert] = useState(false);
  const [convertDate, setConvertDate] = useState(today);
  const [convertTermDays, setConvertTermDays] = useState(90);

  const { data: existing } = useQuery({
    queryKey: ['lc', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('letters_of_credit').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as LetterOfCredit;
    },
  });

  const { data: caOptions = [] } = useQuery({
    queryKey: ['lc-ca-options'],
    queryFn: async () => {
      const { data } = await supabase.from('credit_agreements').select('id, ca_name, contract_number, finance_institution').order('ca_name');
      return (data ?? []) as { id: string; ca_name: string; contract_number: string | null; finance_institution: string | null }[];
    },
  });

  // FX Forward contracts to reference (Hedge) — MoM Day3 §FX "Link กับ LC"
  const { data: fxfOptions = [] } = useQuery({
    queryKey: ['lc-fxf-options'],
    queryFn: async () => {
      const { data } = await supabase.from('fx_forwards').select('id, fxf_no, currency, notional_amount_foreign, forward_rate').order('fxf_no');
      return (data ?? []) as any[];
    },
  });

  useEffect(() => {
    if (existing) {
      setForm({ ...blank, ...existing });
      setAcctCards((existing.acct_cards as AcctCard[]) ?? []);
    }
  }, [existing]);

  // THB equivalent auto-compute from foreign × rate.
  useEffect(() => {
    if (form.amount_foreign && form.conversion_rate) {
      const thb = form.amount_foreign * form.conversion_rate;
      setForm((f) => (Math.abs((f.amount ?? 0) - thb) > 0.005 ? { ...f, amount: thb } : f));
    }
  }, [form.amount_foreign, form.conversion_rate]);

  // Fee calculation (MoM Day3 §7):
  //  full_term         → fee = THB amount × fee_rate%
  //  engagement_prorated → fee = engagement + THB × fee_rate% × days/365
  const feeCalc = useMemo(() => {
    const base = form.amount ?? 0;
    const ratePart = (base * (form.fee_rate ?? 0)) / 100;
    if (form.fee_mode === 'engagement_prorated') {
      const days = form.term_days ?? 0;
      const prorated = (ratePart * days) / 365;
      return { fee: (form.engagement_fee ?? 0) + prorated, ratePart, prorated };
    }
    return { fee: ratePart, ratePart, prorated: ratePart };
  }, [form.amount, form.fee_rate, form.fee_mode, form.engagement_fee, form.term_days]);

  // Daily-prorated fee recognition schedule (mirror LG/BG prepaid amortization).
  const feeSchedule = useMemo(
    () => buildLCFeeSchedule(form.issue_date ?? '', form.expiry_date ?? '', feeCalc.fee),
    [form.issue_date, form.expiry_date, feeCalc.fee],
  );

  // Posted fee-recognition periods (idempotency for per-period Post JE).
  const { data: postedFeePeriods } = useQuery({
    queryKey: ['lc-fee-periods', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries').select('source_period')
        .eq('source_type', 'LC_FEE_RECOG').eq('source_id', id!);
      const set = new Set<number>();
      (data ?? []).forEach((d: any) => { if (d.source_period != null) set.add(d.source_period); });
      return set;
    },
  });

  // Create a Draft L/C on demand (so documents can be uploaded before first Save).
  const ensureLcId = async (): Promise<string> => {
    if (id) return id;
    const lcNo = (form.lc_no ?? '').trim() || `DRAFT-LC-${Date.now()}`;
    const { data, error } = await supabase
      .from('letters_of_credit')
      .insert({ ...form, lc_no: lcNo, fee_amount: feeCalc.fee, acct_cards: acctCards, status: 'Draft', created_by: userLabel })
      .select().single();
    if (error) throw error;
    setForm((f) => ({ ...f, lc_no: lcNo }));
    navigate(`/tx/lc/${data.id}`, { replace: true });
    toast.success('✓ สร้าง Draft อัตโนมัติ');
    return data.id as string;
  };

  // Auto expiry = issue + term days.
  useEffect(() => {
    if (form.issue_date && form.term_days) {
      const d = new Date(form.issue_date);
      d.setDate(d.getDate() + form.term_days);
      const exp = d.toISOString().slice(0, 10);
      setForm((f) => (f.expiry_date !== exp ? { ...f, expiry_date: exp } : f));
    }
  }, [form.issue_date, form.term_days]);

  const save = useMutation({
    mutationFn: async () => {
      await assertWithinCreditLine(form.ca_id, form.amount, { table: 'letters_of_credit', id });
      const lcNo = (form.lc_no ?? '').trim() || `DRAFT-LC-${Date.now()}`;
      const payload: any = { ...form, lc_no: lcNo, fee_amount: feeCalc.fee, acct_cards: acctCards, updated_by: userLabel };
      let lid = id;
      if (mode === 'new') {
        const nm = (form.name ?? '').trim() || await nextRunningNo(RUNNING_PREFIX.lc);
        const { data, error } = await supabase.from('letters_of_credit').insert({ ...payload, name: nm, created_by: userLabel }).select().single();
        if (error) throw error;
        lid = data.id;
      } else {
        const { error } = await supabase.from('letters_of_credit').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', lid!);
        if (error) throw error;
      }
      return lid;
    },
    onSuccess: (lid: any) => {
      qc.invalidateQueries({ queryKey: ['lc-list'] });
      qc.invalidateQueries({ queryKey: ['lc', lid] });
      toast.success('บันทึก L/C แล้ว');
      if (mode === 'new' && lid) navigate(`/tx/lc/${lid}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Post the fee JE (Off-Balance: contingent memo + fee expense).
  const postFeeJE = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึก L/C ก่อน');
      if (form.status !== 'Approved' && form.status !== 'Active') throw new Error('ต้อง Approve ก่อนจึงจะลง Fee JE');
      const { data: ex } = await supabase.from('journal_entries').select('je_number').eq('source_type', 'LC_FEE').eq('source_id', id);
      if (ex && ex.length > 0) throw new Error(`Fee JE มีอยู่แล้ว: ${ex[0].je_number}`);
      const fee = Math.round(feeCalc.fee * 100) / 100;
      if (fee <= 0) throw new Error('Fee = 0 — ตรวจสอบ Amount / Fee Rate');
      const je = await createJE({
        source_type: 'LC_FEE',
        source_id: id,
        je_date: form.issue_date ?? today,
        description: `L/C Fee — ${form.lc_no}`,
        lines: [
          // Upfront fee paid → Prepaid (amortized over L/C life in Schedule Calculate)
          { account_code: LC_GL.prepaidFee.code, account_name: LC_GL.prepaidFee.name, dr: fee, description: `L/C fee prepaid (${form.fee_mode})` },
          { account_code: LC_GL.bankPayable.code, account_name: LC_GL.bankPayable.name, cr: fee, description: 'Payable to bank' },
          // Off-Balance memo (contingent commitment)
          { account_code: LC_GL.contingent.code, account_name: LC_GL.contingent.name, dr: Math.round((form.amount ?? 0) * 100) / 100, description: 'L/C commitment (off-balance)' },
          { account_code: LC_GL.contingentContra.code, account_name: LC_GL.contingentContra.name, cr: Math.round((form.amount ?? 0) * 100) / 100, description: 'Contra — off-balance' },
        ],
      });
      await postJE(je.id, 'user');
      await supabase.from('letters_of_credit').update({ status: 'Active' }).eq('id', id);
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lc', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Active' }));
      toast.success(`✓ Fee JE ${jeNo} · Status → Active`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Per-period fee recognition: Dr Fee Expense / Cr Prepaid L/C Fee.
  const postFeeRecogJE = useMutation({
    mutationFn: async (row: typeof feeSchedule[number]) => {
      if (!id) throw new Error('บันทึก L/C ก่อน');
      const { data: ex } = await supabase.from('journal_entries').select('je_number')
        .eq('source_type', 'LC_FEE_RECOG').eq('source_id', id).eq('source_period', row.period);
      if (ex && ex.length > 0) throw new Error(`งวด ${row.period} มี JE แล้ว: ${ex[0].je_number}`);
      const amt = Math.round(row.feeAmount * 100) / 100;
      if (amt <= 0) throw new Error('ค่าธรรมเนียมงวดนี้ = 0');
      const je = await createJE({
        source_type: 'LC_FEE_RECOG',
        source_id: id,
        source_period: row.period,
        je_date: row.endDate ?? form.issue_date ?? today,
        description: `L/C Fee Recognition งวด ${row.period} — ${form.lc_no}`,
        lines: [
          { account_code: LC_GL.feeExpense.code, account_name: LC_GL.feeExpense.name, dr: amt, description: `${row.days} วัน × daily-rate` },
          { account_code: LC_GL.prepaidFee.code, account_name: LC_GL.prepaidFee.name, cr: amt, description: 'Amortize prepaid L/C fee' },
        ],
      });
      await postJE(je.id, 'user');
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['lc-fee-periods', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Fee Recognition JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Flow LC → TR: เปิด TR เมื่อสินค้ามาถึง → เริ่มคิดดอกเบี้ย (On-Balance).
  const convertToTR = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึก L/C ก่อน');
      if (form.status === 'Converted') throw new Error('L/C นี้แปลงเป็น TR แล้ว');
      const trNo = `${form.lc_no}-TR`;
      const { data: tr, error } = await supabase.from('trust_receipts').insert({
        tr_no: trNo,
        name: `${form.name ?? form.lc_no} (from L/C)`,
        ca_id: form.ca_id,
        finance_institution: form.finance_institution,
        supplier: form.beneficiary,
        due_date: (() => { const d = new Date(convertDate); d.setDate(d.getDate() + convertTermDays); return d.toISOString().slice(0, 10); })(),
        transaction_date: convertDate,
        term_days: convertTermDays,
        amount: form.amount,
        amount_foreign: form.amount_foreign,
        conversion_date: convertDate,
        conversion_rate: form.conversion_rate,
        currency: form.currency,
        reference_contract: form.reference_contract,
        source_lc_id: id,
        status: 'Draft',
        rate_cards: [],
        acct_cards: [],
        created_by: userLabel,
      }).select().single();
      if (error) throw error;
      await supabase.from('letters_of_credit').update({
        status: 'Converted', converted_tr_id: tr.id, conversion_date: convertDate, updated_by: userLabel,
      }).eq('id', id);
      return tr.id as string;
    },
    onSuccess: (trId) => {
      qc.invalidateQueries({ queryKey: ['lc', id] });
      qc.invalidateQueries({ queryKey: ['tr-list'] });
      setShowConvert(false);
      setForm((f) => ({ ...f, status: 'Converted', converted_tr_id: trId }));
      toast.success('✓ เปิด T/R จาก L/C แล้ว — เริ่มคิดดอกเบี้ย (On-Balance)');
      navigate(`/tx/tr/${trId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const tabs: TabDef[] = [
    {
      key: 'fee',
      label: 'Fee',
      render: () => (
        <div className="space-y-3 text-sm">
          <p className="text-[11px] text-muted italic">L/C ไม่คิดดอกเบี้ย — คิดเป็น Fee (MoM Day3 §7). เมื่อเปิด TR จึงเริ่มคิดดอกเบี้ย</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-xl">
            <div>
              <FieldLabel>FEE MODE</FieldLabel>
              <Select value={form.fee_mode} onChange={(e) => set('fee_mode', e.target.value)}>
                <option value="full_term">Full-term % (ตลอดเทอม)</option>
                <option value="engagement_prorated">Engagement Fee + Pro-rated (ตามวันใช้จริง)</option>
              </Select>
            </div>
            <div>
              <FieldLabel>FEE RATE (%)</FieldLabel>
              <NumInput value={form.fee_rate ?? 0} onChange={(v) => set('fee_rate', v)} />
            </div>
            {form.fee_mode === 'engagement_prorated' && (
              <div>
                <FieldLabel>ENGAGEMENT FEE (THB)</FieldLabel>
                <NumInput value={form.engagement_fee ?? 0} onChange={(v) => set('engagement_fee', v)} />
              </div>
            )}
          </div>
          <table className="table-base text-sm max-w-md">
            <tbody>
              <tr><td>L/C Amount (THB)</td><td className="text-right tabular-nums">{fmtMoney(form.amount)}</td></tr>
              <tr><td>Rate Component ({form.fee_rate}%)</td><td className="text-right tabular-nums">{fmtMoney(feeCalc.ratePart)}</td></tr>
              {form.fee_mode === 'engagement_prorated' && (
                <>
                  <tr><td>Pro-rated ({form.term_days} days / 365)</td><td className="text-right tabular-nums">{fmtMoney(feeCalc.prorated)}</td></tr>
                  <tr><td>Engagement Fee</td><td className="text-right tabular-nums">{fmtMoney(form.engagement_fee ?? 0)}</td></tr>
                </>
              )}
              <tr className="bg-brand text-white font-bold"><td className="!text-white !bg-brand">💰 Total Fee</td><td className="text-right tabular-nums !text-white !bg-brand">{fmtMoney(feeCalc.fee)}</td></tr>
            </tbody>
          </table>
          {id && (
            <div className="flex items-center gap-3">
              <Button type="button" variant="primary" size="sm" disabled={postFeeJE.isPending || !can('lc', 'approve')} onClick={() => postFeeJE.mutate()}>
                📋 Post Fee JE (Upfront)
              </Button>
              <span className="text-xs text-muted">Dr Prepaid L/C Fee / Cr Bank Payable + Off-Balance memo → Active · ตัดบัญชีรายงวดที่ Schedule Calculate</span>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'schedule',
      label: 'Schedule Calculate',
      render: () => (
        <div>
          <p className="text-[11px] text-muted italic mb-3">
            ตัดบัญชี Prepaid L/C Fee รายเดือนแบบ daily-prorated ตลอดอายุ L/C (Issue → Expiry) — MoM Day3 §7 · Period 0 = จ่าย upfront
          </p>
          {feeSchedule.length === 0 ? (
            <div className="bg-soft border border-line rounded p-6 text-center text-muted text-sm">
              <div className="text-3xl text-gray-400 mb-2">📭</div>
              <div className="font-semibold text-ink">ไม่มีตารางคำนวณ</div>
              <div className="mt-1 text-xs">กรอก Issue Date / Expiry Date / Fee เพื่อแสดงตารางตัดบัญชี</div>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[480px]">
              <table className="table-base text-xs">
                <thead className="sticky top-0 z-10 bg-white">
                  <tr>
                    <ThTip>Period</ThTip>
                    <ThTip>Payment Date</ThTip>
                    <ThTip>Start</ThTip>
                    <ThTip>End</ThTip>
                    <ThTip align="right">Days</ThTip>
                    <ThTip align="right">Fee Amount</ThTip>
                    <ThTip align="right">Remaining</ThTip>
                    {id && <ThTip>JE</ThTip>}
                  </tr>
                </thead>
                <tbody>
                  {feeSchedule.map((r) => {
                    const done = postedFeePeriods?.has(r.period) ?? false;
                    return (
                      <tr key={r.period} className={r.period === 0 ? 'bg-soft font-medium' : ''}>
                        <td className="text-center">{r.period === 0 ? 'จ่าย' : r.period}</td>
                        <td>{r.paymentDate ? fmtDate(r.paymentDate) : '—'}</td>
                        <td>{r.startDate ? fmtDate(r.startDate) : '—'}</td>
                        <td>{r.endDate ? fmtDate(r.endDate) : '—'}</td>
                        <td className="text-right tabular-nums">{r.days ?? '—'}</td>
                        <td className="text-right tabular-nums">{fmtMoney(r.feeAmount)}</td>
                        <td className="text-right tabular-nums text-muted">{fmtMoney(r.remaining)}</td>
                        {id && (
                          <td className="text-center">
                            {r.period === 0 ? '—' : done ? <Badge variant="success">✓</Badge> : (
                              <Button type="button" size="sm" variant="ghost" disabled={postFeeRecogJE.isPending || !can('lc', 'approve')} onClick={() => postFeeRecogJE.mutate(r)}>Post</Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'references',
      label: 'References',
      render: () => (
        <div className="space-y-3 text-sm max-w-xl">
          <div>
            <FieldLabel>FX FORWARD (Hedge Reference)</FieldLabel>
            <Select value={form.reference_fxf_id ?? ''} onChange={(e) => set('reference_fxf_id', e.target.value || null)}>
              <option value="">— ไม่อ้างอิง —</option>
              {fxfOptions.map((f) => <option key={f.id} value={f.id}>{f.fxf_no} · {f.currency} {fmtMoney(f.notional_amount_foreign ?? 0)} @ {f.forward_rate}</option>)}
            </Select>
            <p className="text-[11px] text-muted mt-0.5 italic">อ้างอิง FX Forward ที่ Hedge ไว้ — รองรับ Partial Use (MoM Day3)</p>
          </div>
          <div>
            <FieldLabel>REFERENCE CONTRACT</FieldLabel>
            <Input value={form.reference_contract ?? ''} onChange={(e) => set('reference_contract', e.target.value || null)} placeholder="PO / Sales contract ref" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.shared_limit_with_tr} onChange={(e) => set('shared_limit_with_tr', e.target.checked)} />
            <span>LC + TR แชร์วงเงินเดียวกัน (Shared Limit)</span>
          </label>
          {form.converted_tr_id && (
            <div className="rounded border border-brand bg-blue-50 p-2.5 text-xs">
              ✓ แปลงเป็น T/R แล้ว · <button className="text-brand underline" onClick={() => navigate(`/tx/tr/${form.converted_tr_id}`)}>เปิด T/R</button> · วันที่ {form.conversion_date ? fmtDate(form.conversion_date) : '—'}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'accounting',
      label: 'Accounting',
      render: () => (
        <div className="space-y-3">
          <AcctCards accounts={acctCards} onChange={setAcctCards} />
          <p className="text-[11px] text-muted">💡 ค่าเริ่มต้น: Prepaid Fee {LC_GL.prepaidFee.code} · Fee Expense {LC_GL.feeExpense.code} · Bank Payable {LC_GL.bankPayable.code} · Off-Balance {LC_GL.contingent.code}/{LC_GL.contingentContra.code}</p>
        </div>
      ),
    },
    {
      key: 'balance',
      label: 'Balance Summary',
      render: () => {
        const recognised = (feeSchedule.filter((r) => r.period > 0 && (postedFeePeriods?.has(r.period) ?? false))
          .reduce((s, r) => s + r.feeAmount, 0));
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
              <div className="space-y-2">
                <RowTip label="L/C Amount" value={`${fmtMoney(form.amount)} THB`} bold />
                <RowTip label="Currency" value={`${form.currency} ${fmtMoney(form.amount_foreign)}`} />
                <RowTip label="Fee Rate (annual)" value={`${(form.fee_rate ?? 0).toFixed(4)}%`} />
                <RowTip label="Fee Mode" value={form.fee_mode === 'full_term' ? 'Full-term %' : 'Engagement + Pro-rated'} />
              </div>
              <div className="space-y-2">
                <RowTip label="Total Fee (Scheduled)" value={fmtMoney(feeCalc.fee)} />
                <RowTip label="Total Fee (Recognised)" value={fmtMoney(recognised)} bold />
                <RowTip label="Total Fee (Prepaid Remaining)" value={fmtMoney(Math.max(0, feeCalc.fee - recognised))} />
              </div>
            </div>
            <RepaymentsReceived facilityId={id} />
          </div>
        );
      },
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
              <span className="text-[10px] uppercase tracking-wider text-muted bg-white border border-line px-2 py-0.5 rounded">L/C</span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureLcId}
              bucketName="lc-documents"
              tableName="lc_documents"
              parentFkColumn="lc_id"
            />
          </div>
        </div>
      ),
    },
  ];

  const canConvert = !!id && form.status !== 'Converted' && form.status !== 'Closed';

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/lc')}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{mode === 'new' ? 'New Letter of Credit' : existing?.lc_no ?? 'Loading...'}</h1>
          <p className="text-muted text-sm flex items-center gap-2">
            Letter of Credit (L/C) — Off-Balance / Fee-based
            {form.lc_type === 'SBLC' && <Badge variant="warn">SBLC</Badge>}
            {form.inactive && <Badge variant="danger">INACTIVE</Badge>}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!canConvert || !can('lc', 'approve')}
          title={!id ? 'Save ก่อน' : form.status === 'Converted' ? 'แปลงเป็น TR แล้ว' : !can('lc', 'approve') ? 'ต้องมีสิทธิ์ Approve' : 'เปิด T/R เมื่อสินค้ามาถึง (เริ่มคิดดอกเบี้ย)'}
          onClick={() => { setConvertDate(today); setConvertTermDays(90); setShowConvert(true); }}
        >
          <Repeat2 className="w-4 h-4" /> Convert → T/R
        </Button>
        <Button variant="primary" disabled={save.isPending || !can('lc', 'edit')} title={!can('lc', 'edit') ? 'ไม่มีสิทธิ์แก้ไข' : ''} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'กำลังบันทึก...' : 'Save'}
        </Button>
      </div>

      <AuditFooter createdBy={(existing as any)?.created_by} createdAt={(existing as any)?.created_at} updatedBy={(existing as any)?.updated_by} updatedAt={(existing as any)?.updated_at} />

      <div className="space-y-0">
        <Section title="Primary Information">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><FieldLabel>L/C ID</FieldLabel><Input readOnly value={id ?? 'auto (สร้างเมื่อ Save)'} className="bg-gray-50 text-muted" /></div>
            <div><FieldLabel>L/C NO *</FieldLabel><Input value={form.lc_no} onChange={(e) => set('lc_no', e.target.value)} placeholder="MGC-LC-2026-001" /></div>
            <div><FieldLabel>NAME (auto)</FieldLabel><Input readOnly value={form.name ?? ''} placeholder="auto — running no. (สร้างเมื่อ Save)" className="bg-gray-50 text-muted" /></div>
            <div>
              <FieldLabel>L/C TYPE</FieldLabel>
              <Select value={form.lc_type} onChange={(e) => set('lc_type', e.target.value)}>
                <option value="LC">L/C (Documentary Credit)</option>
                <option value="SBLC">SBLC (Standby L/C)</option>
              </Select>
            </div>
            <div>
              <FieldLabel>FINANCE INSTITUTION *</FieldLabel>
              <Select value={form.finance_institution} onChange={(e) => set('finance_institution', e.target.value)}>
                {FINANCE_INSTITUTIONS.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>CREDIT AGREEMENT</FieldLabel>
              <Select value={form.ca_id ?? ''} onChange={async (e) => { const caId = e.target.value || null; set('ca_id', caId); if (caId) { const cc = await fetchCaCards(caId); setForm((f) => ({ ...f, rate_cards: (f.rate_cards && (f.rate_cards as any[]).length) ? f.rate_cards : cc.rate_cards, acct_cards: (f.acct_cards && (f.acct_cards as any[]).length) ? f.acct_cards : cc.acct_cards })); } }}>
                <option value="">— เลือก CA —</option>
                {caOptions.map((c) => <option key={c.id} value={c.id}>{c.ca_name}{c.contract_number ? ` (${c.contract_number})` : ''}</option>)}
              </Select>
            </div>
            <div><FieldLabel>BENEFICIARY (ผู้รับผลประโยชน์)</FieldLabel><Input value={form.beneficiary ?? ''} onChange={(e) => set('beneficiary', e.target.value || null)} placeholder="BYD Auto Co., Ltd." /></div>
            <div><FieldLabel>APPLICANT (ผู้ขอเปิด)</FieldLabel><Input value={form.applicant ?? ''} onChange={(e) => set('applicant', e.target.value || null)} /></div>
            <div>
              <FieldLabel>STATUS</FieldLabel>
              <Select value={form.status} onChange={(e) => set('status', e.target.value as LCStatus)}>
                {LC_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </div>

            <div>
              <FieldLabel>CURRENCY</FieldLabel>
              <Select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div><FieldLabel>AMOUNT (FOREIGN) *</FieldLabel><NumInput value={form.amount_foreign ?? 0} onChange={(v) => set('amount_foreign', v)} /></div>
            <div><FieldLabel>FX RATE → THB</FieldLabel><NumInput value={form.conversion_rate ?? 0} onChange={(v) => set('conversion_rate', v)} /></div>
            <div><FieldLabel>AMOUNT (THB EQUIV.)</FieldLabel><NumInput value={form.amount ?? 0} onChange={(v) => set('amount', v)} /><p className="text-[10px] text-muted mt-0.5 italic">auto = Foreign × FX Rate</p></div>

            <div><FieldLabel>ISSUE DATE</FieldLabel><Input type="date" value={form.issue_date ?? ''} onChange={(e) => set('issue_date', e.target.value || null)} /></div>
            <div><FieldLabel>TERM (DAYS)</FieldLabel><NumInput value={form.term_days ?? 0} onChange={(v) => set('term_days', Math.round(v))} /><p className="text-[10px] text-muted mt-0.5 italic">LC ปกติ Short Term 2–3 เดือน</p></div>
            <div><FieldLabel>EXPIRY DATE</FieldLabel><Input type="date" value={form.expiry_date ?? ''} onChange={(e) => set('expiry_date', e.target.value || null)} className="bg-gray-50" /><p className="text-[10px] text-muted mt-0.5 italic">auto = Issue + Term</p></div>

            <div className="md:col-span-3 flex flex-wrap gap-5 pt-1">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.inactive} onChange={(e) => set('inactive', e.target.checked)} className="rounded" /> INACTIVE</label>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">L/C Amount (THB)</div><div className="text-right tabular-nums font-semibold">{fmtMoney(form.amount)}</div></div>
            <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Total Fee</div><div className="text-right tabular-nums font-semibold">{fmtMoney(feeCalc.fee)}</div></div>
            <div className="rounded border border-line bg-soft p-2.5"><div className="text-[10px] text-muted uppercase">Term (Days)</div><div className="text-right tabular-nums font-semibold">{form.term_days}</div></div>
            <div className="rounded border border-brand bg-blue-50 p-2.5"><div className="text-[10px] text-brand uppercase font-semibold">Type</div><div className="text-right tabular-nums font-bold text-brand">{form.lc_type}</div></div>
          </div>
        </Section>

        <Tabs tabs={tabs} />
      </div>

      <Modal
        open={showConvert}
        onClose={() => setShowConvert(false)}
        title={`🔁 Convert L/C → T/R — ${form.lc_no}`}
        size="md"
        footer={
          <>
            <Button onClick={() => setShowConvert(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => convertToTR.mutate()} disabled={convertToTR.isPending || !can('lc', 'approve')}>✓ เปิด T/R</Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted italic">เมื่อสินค้ามาถึง (Shipment + ผ่านพิธีการศุลกากร) → เปิด T/R ที่ธนาคาร เริ่มคิดดอกเบี้ยตั้งแต่วันเปิด T/R (กลายเป็น On-Balance Loan) — MoM Day3 §7</p>
          <table className="table-base text-sm">
            <tbody>
              <tr><td className="font-semibold">L/C</td><td className="text-right">{form.lc_no}</td></tr>
              <tr className="bg-soft"><td className="font-bold">Amount (THB)</td><td className="text-right tabular-nums font-bold">{fmtMoney(form.amount)}</td></tr>
              <tr><td>Beneficiary → Supplier</td><td className="text-right">{form.beneficiary ?? '—'}</td></tr>
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel>T/R OPEN DATE</FieldLabel><Input type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} /></div>
            <div><FieldLabel>T/R TERM (DAYS)</FieldLabel><NumInput value={convertTermDays} onChange={(v) => setConvertTermDays(Math.round(v))} /></div>
          </div>
          <p className="text-xs text-muted">กด เปิด T/R → สร้าง T/R (Draft) เงินต้น = LC Amount · L/C เปลี่ยนสถานะเป็น Converted · พาไปกรอก T/R ต่อ</p>
        </div>
      </Modal>
    </div>
  );
}
