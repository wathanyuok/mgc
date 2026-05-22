import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Repeat2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchCaCards } from '@/lib/ca-inherit';
import { Button, Card, CardContent, Input, Select, Modal, Badge, FieldLabel, TooltipText } from '@/components/ui';
import { fmtDate, fmtMoney, fmtPercent } from '@/lib/format';
import { type PromissoryNote, FINANCE_INSTITUTIONS, FACILITY_TYPES } from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, effectiveRate, type RateCard } from '@/components/tx/RateCards';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, TipLabel } from '@/components/tx/TipHelpers';
import { RepaymentsReceived } from '@/components/tx/RepaymentsReceived';
import { buildPNSchedule, accruedInterest, totalInterest, totalDays } from '@/lib/pn-schedule';
import { createJE, postJE } from '@/lib/je';
import { useBaseRateLookup } from '@/lib/interest-rate-master';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';

const PN_STATUSES = ['Draft', 'Approved', 'Active', 'Roll Over', 'Repaid', 'Cancelled'] as const;

interface Chassis {
  id: string;
  chassis_no: string;     // เลขตัวถัง
  engine_no: string;      // เลขเครื่อง (MoM Day3 §3)
  car_model: string;
  location: string;
  cost: number;
  status: 'Active' | 'Inactive';
}

type Form = Omit<PromissoryNote, 'id' | 'created_at' | 'updated_at'> & {
  rate_cards: RateCard[];
  acct_cards: AcctCard[];
  chassis_list: Chassis[];
  rollover_parent_id: string | null;
  accrued_interest: number;
};

const blank: Form = {
  name: '', pn_number: null, ca_id: null, finance_institution: 'KBANK', facility_type: 'PN',
  transaction_date: new Date().toISOString().slice(0, 10),
  maturity_date: null, term_days: 60, amount: 0, currency: 'THB',
  interest_rate_id: null, effective_rate: null, reference_contract: null,
  reference_transaction_id: null,
  status: 'Draft', remark: null,
  rate_cards: [], acct_cards: [], chassis_list: [],
  rollover_parent_id: null, accrued_interest: 0,
};

export function PNDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const [showRollover, setShowRollover] = useState(false);
  const [rolloverNew, setRolloverNew] = useState({ new_name: '', new_maturity: '' });

  const { data: existing } = useQuery({
    queryKey: ['pn', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('promissory_notes').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing;
      setForm({
        ...rest,
        rate_cards: existing.rate_cards ?? [],
        acct_cards: existing.acct_cards ?? [],
        // Filter out legacy empty rows from old "+ Add Chassis" flow
        chassis_list: (existing.chassis_list ?? []).filter((c: any) => c.chassis_no?.trim()),
      });
    }
  }, [existing]);

  // Auto-compute maturity from transaction_date + term_days
  useEffect(() => {
    if (form.transaction_date && form.term_days) {
      const d = new Date(form.transaction_date);
      d.setDate(d.getDate() + form.term_days);
      const iso = d.toISOString().slice(0, 10);
      if (iso !== form.maturity_date) setForm((f) => ({ ...f, maturity_date: iso }));
    }
  }, [form.transaction_date, form.term_days]);

  // Effective rate from first rate card
  const effRate = useMemo(() => {
    if (form.rate_cards.length === 0) return form.effective_rate ?? 0;
    return effectiveRate(form.rate_cards[0]);
  }, [form.rate_cards, form.effective_rate]);

  // Floating base rate ดึงจาก Interest Rate master (ตาม finance institution)
  const baseRateLookup = useBaseRateLookup(form.finance_institution);

  // Schedule rows
  const schedule = useMemo(
    () => buildPNSchedule(form.amount, form.rate_cards as RateCard[], form.transaction_date, form.maturity_date ?? form.transaction_date),
    [form.amount, effRate, form.transaction_date, form.maturity_date],
  );

  const totals = useMemo(() => {
    const totalInt = schedule.slice(1).reduce((s, r) => s + r.interestPaid, 0);
    const accumAccrued = totalInt; // simplified — could split by past periods
    return { totalInt, accumAccrued };
  }, [schedule]);

  // ── GL posting (MoM: เบิกวงเงิน → ลงบัญชี · ตั้งดอกค้างทุกสิ้นเดือน · ชำระคืนผ่าน Repayment) ──
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const glFor = (acctType: string, fallback: string): { code: string; name: string } => {
    const card = (form.acct_cards as AcctCard[]).find((a) => a.type === acctType);
    const raw = card?.gl ?? fallback;
    const sp = raw.indexOf(' ');
    return sp > 0 ? { code: raw.slice(0, sp), name: raw.slice(sp + 1) } : { code: '', name: raw };
  };
  const firstOfNextMonth = (isoDate: string) => {
    const d = new Date(isoDate);
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
  };

  const { data: pnDrawdownPosted = false } = useQuery({
    queryKey: ['pn-drawdown-posted', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries').select('id')
        .eq('source_type', 'PN_DRAWDOWN').eq('source_id', id!).eq('status', 'Posted');
      return (data ?? []).length > 0;
    },
  });

  const { data: pnAccruedPeriods } = useQuery({
    queryKey: ['pn-accrued-periods', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries').select('source_period, status, is_reversal')
        .eq('source_type', 'PN_ACCRUED').eq('source_id', id!);
      const set = new Set<number>();
      (data ?? []).forEach((d: any) => {
        if (d.status === 'Posted' && d.is_reversal !== true && d.source_period != null) set.add(d.source_period);
      });
      return set;
    },
  });

  const postPnDrawdownJE = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('บันทึก P/N ก่อน Post JE');
      if (form.status !== 'Approved') throw new Error(`Post Drawdown ได้เฉพาะ P/N ที่ Approved — Status ปัจจุบัน: "${form.status}"`);
      if (!form.amount) throw new Error('ยังไม่มีเงินต้น (Amount)');
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'PN_DRAWDOWN').eq('source_id', id).eq('status', 'Posted');
      if (ex && ex.length > 0) throw new Error(`Drawdown JE มีอยู่แล้ว: ${ex[0].je_number}`);

      const cash = glFor('CASH / BANK ACCOUNT', '100000 Cheque Account');
      const note = glFor('NOTE PAYABLE ACCOUNT', '2142102 ตั๋วสัญญาใช้เงิน (P/N) — สถาบันการเงิน');
      const je = await createJE({
        source_type: 'PN_DRAWDOWN',
        source_id: id,
        je_date: form.transaction_date,
        description: `${form.name ?? form.pn_number} — P/N Drawdown (เบิกใช้วงเงิน)`,
        lines: [
          { account_code: cash.code, account_name: cash.name, dr: round2(form.amount), description: 'Cash received from P/N drawdown' },
          { account_code: note.code, account_name: note.name, cr: round2(form.amount), description: 'Note Payable — P/N principal' },
        ],
      });
      await postJE(je.id, 'user');
      // P/N is now drawn/outstanding → promote Approved → Active (mirror TR/FP)
      await supabase.from('promissory_notes').update({ status: 'Active' }).eq('id', id);
      return je.je_number;
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['pn-drawdown-posted', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Active' }));
      toast.success(`✓ Posted Drawdown JE ${jeNo} · Status → Active`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const postPnAccruedJE = useMutation({
    mutationFn: async (r: typeof schedule[number]) => {
      if (!id) throw new Error('บันทึก P/N ก่อน Post JE');
      if (r.interestPaid <= 0.005) throw new Error(`Period ${r.period} ไม่มีดอกเบี้ย`);
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'PN_ACCRUED').eq('source_id', id)
        .eq('source_period', r.period).eq('status', 'Posted').eq('is_reversal', false);
      if (ex && ex.length > 0) throw new Error(`Period ${r.period} มี Accrued JE อยู่แล้ว: ${ex[0].je_number}`);

      const intExp = glFor('INTEREST EXPENSE ACCOUNT', '5512103 ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น');
      const accr = glFor('ACCRUED INTEREST ACCOUNT', '2194109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน');
      const amt = round2(r.interestPaid);

      const accrued = await createJE({
        source_type: 'PN_ACCRUED',
        source_id: id,
        source_period: r.period,
        je_date: r.endDate,
        description: `${form.name ?? form.pn_number} — Period ${r.period} Accrued Interest`,
        remark: `Accrued ${r.days} วัน × ${effRate.toFixed(4)}% / 365 (daily basis, month-end)`,
        lines: [
          { account_code: intExp.code, account_name: intExp.name, dr: amt, description: 'Interest expense (accrued)' },
          { account_code: accr.code, account_name: accr.name, cr: amt, description: 'Accrued interest payable' },
        ],
      });
      await postJE(accrued.id, 'user');

      const reversal = await createJE({
        source_type: 'PN_ACCRUED',
        source_id: id,
        source_period: r.period,
        je_date: firstOfNextMonth(r.endDate),
        description: `${form.name ?? form.pn_number} — Period ${r.period} Accrued Reversal`,
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
      qc.invalidateQueries({ queryKey: ['pn-accrued-periods', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Posted Accrued + Reversal · ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const userLabel = useCurrentUserLabel();
  const { can: rawCan } = useAuth();
  const viewOnly = useReadOnly();
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);

  const save = useMutation({
    mutationFn: async () => {
      await assertWithinCreditLine(form.ca_id, form.amount, { table: 'promissory_notes', id });
      const payload = {
        ...form,
        effective_rate: effRate,
        updated_by: userLabel,
      };
      if (mode === 'new') {
        const nm = (form.name ?? '').trim() || await nextRunningNo(RUNNING_PREFIX.pn);
        const { data, error } = await supabase.from('promissory_notes').insert({ ...payload, name: nm, created_by: userLabel }).select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.from('promissory_notes').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id!).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['pn-list'] });
      toast.success(mode === 'new' ? 'สร้าง P/N แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/tx/pn/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ensurePnId — auto-create Draft so user can upload Document before formal save
  const ensurePnId = async (): Promise<string> => {
    if (id) return id;
    const pnNo = (form.pn_number ?? '').trim() || `DRAFT-${Date.now()}`;
    const name = (form.name ?? '').trim() || pnNo;
    const { data, error } = await supabase
      .from('promissory_notes')
      .insert({ ...form, pn_number: pnNo, name, status: 'Draft', effective_rate: effRate })
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['pn-list'] });
    navigate(`/tx/pn/${data.id}`, { replace: true });
    return data.id as string;
  };

  // ─── Roll Over: validation against CA limits ──────────────────────
  // Walk parent chain to find original PN + count rollovers
  const { data: rolloverContext } = useQuery({
    queryKey: ['pn-rollover-context', id, form.ca_id],
    enabled: !!id,
    queryFn: async () => {
      // Walk up the rollover_parent_id chain to find the original
      let cur: any = id;
      let originalTxDate = form.transaction_date;
      let rolloverCount = 0;
      const visited = new Set<string>();
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        const { data } = await supabase.from('promissory_notes').select('id, transaction_date, rollover_parent_id').eq('id', cur).maybeSingle();
        if (!data) break;
        originalTxDate = data.transaction_date;
        if (data.rollover_parent_id) rolloverCount++;
        cur = data.rollover_parent_id;
      }
      // Fetch CA limits
      let caLimits: { rollover_max_days: number | null; rollover_max_times: number | null } = {
        rollover_max_days: null,
        rollover_max_times: null,
      };
      if (form.ca_id) {
        const { data } = await supabase
          .from('credit_agreements')
          .select('rollover_max_days, rollover_max_times')
          .eq('id', form.ca_id)
          .maybeSingle();
        if (data) caLimits = data as any;
      }
      return { originalTxDate, rolloverCount, ...caLimits };
    },
  });

  // Roll Over validation
  const rolloverValidation = useMemo(() => {
    if (!rolloverContext) return { canRollover: true, errors: [] as string[], warnings: [] as string[] };
    const errors: string[] = [];
    const warnings: string[] = [];
    const newCount = rolloverContext.rolloverCount + 1;

    if (rolloverContext.rollover_max_times != null && newCount > rolloverContext.rollover_max_times) {
      errors.push(`เกิน Maximum Roll Over (${rolloverContext.rollover_max_times} ครั้ง จาก CA)`);
    }
    if (rolloverContext.rollover_max_days && rolloverNew.new_maturity) {
      const start = new Date(rolloverContext.originalTxDate);
      const end = new Date(rolloverNew.new_maturity);
      const days = Math.round((end.getTime() - start.getTime()) / 86400000);
      if (days > rolloverContext.rollover_max_days) {
        errors.push(`อายุรวม ${days} วัน เกินจำกัด ${rolloverContext.rollover_max_days} วัน (จาก CA)`);
      } else if (days > rolloverContext.rollover_max_days * 0.9) {
        warnings.push(`อายุรวม ${days} วัน ใกล้เพดาน ${rolloverContext.rollover_max_days} วัน`);
      }
    }
    return { canRollover: errors.length === 0, errors, warnings, newCount };
  }, [rolloverContext, rolloverNew.new_maturity]);

  // Auto-suggest new name based on count
  useEffect(() => {
    if (showRollover && rolloverContext && !rolloverNew.new_name) {
      const suffix = String(rolloverContext.rolloverCount + 1).padStart(3, '0');
      setRolloverNew((s) => ({ ...s, new_name: `${form.name}-RO${suffix}` }));
    }
  }, [showRollover, rolloverContext]);

  const rollOver = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save P/N ก่อนทำ Roll Over');
      if (!rolloverValidation.canRollover) throw new Error(rolloverValidation.errors.join(' / '));
      if (!form.maturity_date) throw new Error('PN เดิมต้องมี Maturity Date ก่อน Roll Over');
      if (!rolloverNew.new_maturity) throw new Error('กรอก Maturity Date ใหม่');

      const accrued = accruedInterest(form.amount, effRate, form.transaction_date, form.maturity_date);
      const newPrincipal = form.amount + accrued;

      // 1. Mark old PN as "Roll Over"
      await supabase.from('promissory_notes').update({ status: 'Roll Over' }).eq('id', id);

      // 2. Create new PN — new tx_date = old maturity, principal = old + accrued
      const { id: _i, created_at: _c, updated_at: _u, ...formRest } = form as any;
      const { data: newPn, error } = await supabase
        .from('promissory_notes')
        .insert({
          ...formRest,
          name: await nextRunningNo(RUNNING_PREFIX.pn),
          pn_number: null, // Bank will issue new reference
          transaction_date: form.maturity_date,
          maturity_date: rolloverNew.new_maturity,
          amount: parseFloat(newPrincipal.toFixed(2)),
          status: 'Draft',
          rollover_parent_id: id,
          accrued_interest: parseFloat(accrued.toFixed(2)),
          reference_contract: form.name,
        })
        .select()
        .single();
      if (error) throw error;

      // 3. (Future) Post JE: Dr. ตั๋วเงินจ่าย-PN เดิม / Cr. ตั๋วเงินจ่าย-PN ใหม่
      // — would create a repayment record + posting to GL

      return newPn;
    },
    onSuccess: (data: any) => {
      toast.success(`✓ Roll Over สำเร็จ → P/N ใหม่: ${data.name}`);
      setShowRollover(false);
      setRolloverNew({ new_name: '', new_maturity: '' });
      qc.invalidateQueries({ queryKey: ['pn-list'] });
      navigate(`/tx/pn/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const tabs: TabDef[] = [
    {
      key: 'interest',
      label: 'Interest Rate',
      render: () => <RateCards rates={form.rate_cards} onChange={(n) => setForm((f) => ({ ...f, rate_cards: n }))} baseRateLookup={baseRateLookup} />,
    },
    {
      key: 'accounting',
      label: 'Accounting',
      render: () => <AcctCards accounts={form.acct_cards} onChange={(n) => setForm((f) => ({ ...f, acct_cards: n }))} />,
    },
    {
      key: 'chassis',
      label: 'Chassis',
      render: () => <ChassisTab list={form.chassis_list} onChange={(n) => setForm((f) => ({ ...f, chassis_list: n }))} />,
    },
    {
      key: 'schedule',
      label: 'Schedule Calculate',
      render: () => (
        <div>
          {id && (
            <div className="flex items-center gap-3 mb-3 p-2.5 rounded border border-line bg-soft text-sm">
              {pnDrawdownPosted ? (
                <Badge variant="success">✓ Drawdown JE Posted</Badge>
              ) : (
                <>
                  <Button type="button" variant="primary" size="sm" onClick={() => postPnDrawdownJE.mutate()} disabled={postPnDrawdownJE.isPending || form.status !== 'Approved' || !can('pn', 'approve')}>
                    📋 Post Drawdown JE
                  </Button>
                  <span className="text-xs text-muted">{form.status !== 'Approved' ? 'ต้อง Approved ก่อน — Dr เงินฝากธนาคาร / Cr ตั๋วเงินจ่าย-P/N' : 'Dr เงินฝากธนาคาร / Cr ตั๋วเงินจ่าย-P/N (เบิกใช้วงเงิน)'}</span>
                </>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <ThTip align="right">Period</ThTip>
                <ThTip>Start Date</ThTip>
                <ThTip>End Date</ThTip>
                <ThTip align="right">Days</ThTip>
                <ThTip align="right">Rate (%)</ThTip>
                <ThTip align="right">Interest Paid</ThTip>
                <ThTip align="right">Principal Bal.</ThTip>
                <ThTip align="right">Interest Bal.</ThTip>
                <ThTip>Due Date</ThTip>
                <ThTip align="right">JE</ThTip>
              </tr>
            </thead>
            <tbody>
              {schedule.map((p) => (
                <tr key={p.period}>
                  <td className="text-right tabular-nums">{p.period}</td>
                  <td>{fmtDate(p.startDate)}</td>
                  <td>{p.period === 0 ? fmtDate(p.endDate) : fmtDate(p.endDate)}</td>
                  <td className="text-right tabular-nums">{p.days || '—'}</td>
                  <td className="text-right tabular-nums">{p.rate ? p.rate.toFixed(2) : '—'}</td>
                  <td className="text-right tabular-nums">{p.interestPaid ? fmtMoney(p.interestPaid) : '—'}</td>
                  <td className="text-right tabular-nums">{fmtMoney(p.principalBalance)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(p.interestBalance)}</td>
                  <td>{p.dueDate ? fmtDate(p.dueDate) : '—'}</td>
                  <td className="text-right whitespace-nowrap">
                    {id && p.period > 0 && p.interestPaid > 0.005 && (
                      pnAccruedPeriods?.has(p.period) ? (
                        <span className="text-emerald-600 text-[10px]" title="Accrued JE posted">✓ Posted</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => postPnAccruedJE.mutate(p)}
                          disabled={postPnAccruedJE.isPending || !pnDrawdownPosted || viewOnly}
                          className="text-brand hover:underline text-[10px] disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                          title={pnDrawdownPosted ? 'Post Accrued Interest JE (งวดนี้)' : 'Post Drawdown JE ก่อน'}
                        >
                          📋 Post
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {schedule.length > 1 && (
                <tr className="bg-soft font-semibold">
                  <td colSpan={3} className="text-right">Total</td>
                  <td className="text-right tabular-nums">{totalDays(form.transaction_date, form.maturity_date ?? form.transaction_date)}</td>
                  <td className="text-right">—</td>
                  <td className="text-right tabular-nums">{fmtMoney(totals.totalInt)}</td>
                  <td className="text-right">—</td>
                  <td className="text-right">—</td>
                  <td>—</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          {schedule.length === 0 && <div className="text-center text-muted py-6">ยังไม่มี schedule — ใส่ Amount + Rate + Term ก่อน</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'balance',
      label: 'Balance Summary',
      render: () => (
        <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <FieldRow label="Effective Interest Rate" value={fmtPercent(effRate)} />
            <FieldRow label="Term (Days)" value={totalDays(form.transaction_date, form.maturity_date ?? form.transaction_date)} />
            <FieldRow label="Total Principal" value={fmtMoney(form.amount)} bold />
            <FieldRow label="Total Interest" value={fmtMoney(totals.totalInt)} />
            <FieldRow label="Accumulated Accrued Interest" value={fmtMoney(totals.accumAccrued)} bold />
          </div>
          <Card>
            <CardContent className="!p-0">
              <table className="table-base">
                <thead>
                  <tr>
                    <th><TooltipText>Actual</TooltipText></th>
                    <th className="text-right"><TooltipText>Total</TooltipText></th>
                    <th className="text-right"><TooltipText>Repayment</TooltipText></th>
                    <th className="text-right"><TooltipText>Remaining</TooltipText></th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Principal</td>
                    <td className="text-right tabular-nums">{fmtMoney(form.amount)}</td>
                    <td className="text-right tabular-nums">{form.status === 'Repaid' ? fmtMoney(form.amount) : '—'}</td>
                    <td className="text-right tabular-nums">{form.status === 'Repaid' ? '0.00' : fmtMoney(form.amount)}</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Interest</td>
                    <td className="text-right tabular-nums">{fmtMoney(totals.totalInt)}</td>
                    <td className="text-right tabular-nums">—</td>
                    <td className="text-right tabular-nums">{fmtMoney(totals.totalInt)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
        <RepaymentsReceived facilityId={id} principal={form.amount} interest={totals.totalInt} />
        </div>
      ),
    },
    {
      key: 'rollover',
      label: 'Roll Over History',
      render: () => (
        <RolloverHistory currentId={id ?? ''} parentId={form.rollover_parent_id} accrued={form.accrued_interest} />
      ),
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
                P/N
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensurePnId}
              bucketName="pn-documents"
              tableName="pn_documents"
              parentFkColumn="pn_id"
            />
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/pn')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Promissory Note</h1>
          <p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New Promissory Note' : form.name}</p>
        </div>
        <Button
          onClick={() => setShowRollover(true)}
          disabled={!id || form.status !== 'Approved' || !can('pn', 'approve')}
          title={
            !id
              ? 'Save ก่อน'
              : !can('pn', 'approve')
                ? 'ไม่มีสิทธิ์อนุมัติ P/N'
                : form.status !== 'Approved'
                  ? `Roll Over ทำได้เฉพาะ P/N ที่ Approved — Status ปัจจุบัน: "${form.status}"`
                  : ''
          }
        >
          <Repeat2 className="w-4 h-4" /> Roll Over
        </Button>
        <Button variant="primary" disabled={save.isPending || !can('pn', 'edit')} title={!can('pn', 'edit') ? 'ไม่มีสิทธิ์แก้ไข P/N' : ''} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={() => navigate('/tx/pn')}>Cancel</Button>
      </div>

      <AuditFooter
        createdBy={(form as any).created_by}
        createdAt={(form as any).created_at}
        updatedBy={(form as any).updated_by}
        updatedAt={(form as any).updated_at}
      />

      <PrimaryInfoSection form={form} setForm={setForm} effRate={effRate} currentPNId={id} />


      <Tabs tabs={tabs} defaultTab="interest" />

      <Modal
        open={showRollover}
        onClose={() => setShowRollover(false)}
        title="🔁 Roll Over Promissory Note"
        size="lg"
        footer={
          <>
            <Button onClick={() => setShowRollover(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => rollOver.mutate()}
              disabled={rollOver.isPending || !rolloverValidation.canRollover || !rolloverNew.new_maturity}
            >
              {rollOver.isPending ? 'Processing...' : 'Confirm Roll Over'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          {/* Step description — matches HTML §pn-rollover-modal */}
          <div>
            <div className="text-xs text-muted mb-2">ระบบจะดำเนินการต่อไปนี้เมื่อยืนยัน:</div>
            <ol className="list-decimal list-inside text-xs space-y-1 text-gray-700 ml-2">
              <li>เปลี่ยน Status ของ P/N เดิมเป็น <strong>"Roll Over"</strong></li>
              <li>สร้าง P/N ใหม่ พร้อม <strong>Reference Contract</strong> ชี้กลับมาที่ P/N เดิม</li>
              <li>ตั้ง Transaction Date ของ P/N ใหม่ = Maturity Date ของ P/N เดิม</li>
              <li>ทบ Accrued Interest เข้ากับเงินต้นใหม่ (Principal ใหม่ = Principal เดิม + Interest ที่ค้าง)</li>
              <li>ออก Journal Entry: <strong>Dr. ตั๋วเงินจ่าย-PN เดิม / Cr. ตั๋วเงินจ่าย-PN ใหม่</strong></li>
            </ol>
          </div>

          {/* Plan section */}
          <div className="bg-brand-light border border-brand p-4 rounded">
            <h4 className="font-bold mb-3 text-brand">📋 Roll Over Plan</h4>
            <table className="w-full text-sm">
              <tbody>
                <Tr label="P/N เดิม" value={form.name} bold />
                <Tr label="Maturity Date เดิม" value={form.maturity_date ? fmtDate(form.maturity_date) : '—'} />
                <Tr label="Principal" value={`${fmtMoney(form.amount)} ${form.currency}`} />
                <Tr
                  label="Accrued Interest (ทบ)"
                  value={`${fmtMoney(accruedInterest(form.amount, effRate, form.transaction_date, form.maturity_date ?? new Date().toISOString().slice(0, 10)))} ${form.currency}`}
                  highlight
                />
                <tr>
                  <td colSpan={2} className="pt-2 border-t border-brand"></td>
                </tr>
                <Tr
                  label="P/N ใหม่ (NAME)"
                  value={<Input value="auto — running no. (สร้างเมื่อ Confirm)" readOnly disabled />}
                />
                <Tr
                  label="Maturity Date ใหม่"
                  value={
                    <Input
                      type="date"
                      value={rolloverNew.new_maturity}
                      onChange={(e) => setRolloverNew((s) => ({ ...s, new_maturity: e.target.value }))}
                    />
                  }
                />
                <Tr
                  label="Principal ใหม่ (รวมดอกเบี้ย)"
                  value={`${fmtMoney(form.amount + accruedInterest(form.amount, effRate, form.transaction_date, form.maturity_date ?? new Date().toISOString().slice(0, 10)))} ${form.currency}`}
                  highlight
                  bold
                />
              </tbody>
            </table>
          </div>

          {/* Validation against CA limits — matches HTML "🔍 Validation" */}
          {rolloverContext && (
            <div className="bg-gray-50 border border-line p-3 rounded">
              <div className="text-xs font-semibold mb-2">🔍 Validation</div>
              <ul className="list-disc list-inside text-xs space-y-1 text-gray-700">
                <li>
                  Roll Over ครั้งที่{' '}
                  <strong className="text-brand">{rolloverContext.rolloverCount + 1}</strong>
                  {rolloverContext.rollover_max_times != null && (
                    <> จากสูงสุด <strong>{rolloverContext.rollover_max_times}</strong> ครั้ง (จาก CA)</>
                  )}{' '}
                  {rolloverValidation.errors.find((e) => e.includes('Maximum')) ? (
                    <span className="text-danger">✗</span>
                  ) : (
                    <span className="text-emerald-600">✓</span>
                  )}
                </li>
                {rolloverContext.rollover_max_days && rolloverNew.new_maturity && (
                  <li>
                    อายุรวมหลัง Roll Over:{' '}
                    <strong className="text-brand">
                      {Math.round(
                        (new Date(rolloverNew.new_maturity).getTime() -
                          new Date(rolloverContext.originalTxDate).getTime()) /
                          86400000,
                      )}
                    </strong>{' '}
                    วัน ≤ <strong>{rolloverContext.rollover_max_days}</strong> วัน (จาก CA){' '}
                    {rolloverValidation.errors.find((e) => e.includes('อายุรวม')) ? (
                      <span className="text-danger">✗</span>
                    ) : (
                      <span className="text-emerald-600">✓</span>
                    )}
                  </li>
                )}
                {!form.ca_id && (
                  <li className="text-muted italic">
                    ⚠ ไม่ได้ผูก Credit Agreement — ไม่มีเพดาน validation
                  </li>
                )}
              </ul>
              {rolloverValidation.errors.length > 0 && (
                <div className="mt-2 text-xs text-danger">
                  {rolloverValidation.errors.map((e, i) => (
                    <div key={i}>⚠ {e}</div>
                  ))}
                </div>
              )}
              {rolloverValidation.warnings.length > 0 && (
                <div className="mt-2 text-xs text-amber-700">
                  {rolloverValidation.warnings.map((w, i) => (
                    <div key={i}>⚠ {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// =====================================================================
//  Primary Information — matches HTML 3-column layout exactly
// =====================================================================
function PrimaryInfoSection({
  form,
  setForm,
  effRate,
  currentPNId,
}: {
  form: Form;
  setForm: React.Dispatch<React.SetStateAction<Form>>;
  effRate: number;
  currentPNId?: string;
}) {
  // CA options for "CREDIT AGREEMENT NAME" dropdown
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-for-pn'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credit_agreements')
        .select('id, ca_name')
        .order('ca_name');
      if (error) return [];
      return (data ?? []) as { id: string; ca_name: string }[];
    },
  });

  // Reference Transaction options (other PN records)
  const { data: pnOptions } = useQuery({
    queryKey: ['pn-options', currentPNId],
    queryFn: async () => {
      let q = supabase.from('promissory_notes').select('id, name, pn_number').order('name');
      if (currentPNId) q = q.neq('id', currentPNId);
      const { data, error } = await q;
      if (error) return [];
      return (data ?? []) as { id: string; name: string; pn_number: string | null }[];
    },
  });

  return (
    <Section title="Primary Information">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
        {/* ─── COLUMN 1 ─── */}
        <div className="space-y-4">
          <div>
            <FieldLabel required>FINANCE INSTITUTION</FieldLabel>
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
            <FieldLabel>CREDIT AGREEMENT NAME</FieldLabel>
            <Select
              value={form.ca_id ?? ''}
              onChange={async (e) => { const caId = e.target.value || null; setForm((f) => ({ ...f, ca_id: caId })); if (caId) { const cc = await fetchCaCards(caId); setForm((f) => ({ ...f, rate_cards: (f.rate_cards && (f.rate_cards as any[]).length) ? f.rate_cards : cc.rate_cards, acct_cards: (f.acct_cards && (f.acct_cards as any[]).length) ? f.acct_cards : cc.acct_cards })); } }}
            >
              <option value="">— เลือก —</option>
              {(caOptions ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ca_name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel tipKey="P/N NAME">NAME (auto)</FieldLabel>
            <Input readOnly value={form.name} placeholder="auto — running no. (สร้างเมื่อ Save)" className="bg-gray-50 text-muted" />
          </div>
          <div>
            <FieldLabel tipKey="BANK REFERENCE">BANK REFERENCE</FieldLabel>
            <Input
              value={form.pn_number ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, pn_number: e.target.value || null }))}
              placeholder="P112245679"
            />
          </div>
          <div>
            <FieldLabel required>TRANSACTION DATE</FieldLabel>
            <Input
              type="date"
              value={form.transaction_date}
              onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))}
            />
          </div>
          <div>
            <FieldLabel>TERM (DAYS)</FieldLabel>
            <Input
              type="number"
              value={form.term_days ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, term_days: e.target.value ? parseInt(e.target.value) : null }))
              }
              className="text-right tabular-nums"
            />
          </div>
        </div>

        {/* ─── COLUMN 2 ─── */}
        <div className="space-y-4">
          <div>
            <FieldLabel>MATURITY DATE (auto)</FieldLabel>
            <Input
              type="date"
              value={form.maturity_date ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, maturity_date: e.target.value || null }))}
              className="bg-gray-50"
            />
          </div>
          <div>
            <FieldLabel>AMOUNT</FieldLabel>
            <Input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
              className="text-right tabular-nums"
            />
          </div>
          <div>
            <FieldLabel>CURRENCY</FieldLabel>
            <Select
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            >
              <option>THB</option>
              <option>USD</option>
              <option>EUR</option>
              <option>JPY</option>
            </Select>
          </div>
          <div>
            <FieldLabel>FACILITY TYPE</FieldLabel>
            <Input readOnly value="P/N" className="bg-gray-50" />
          </div>
        </div>

        {/* ─── COLUMN 3 ─── */}
        <div className="space-y-4">
          <div>
            <FieldLabel required>STATUS</FieldLabel>
            <Select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}
            >
              {PN_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>REMARK</FieldLabel>
            <textarea
              className="input min-h-[112px]"
              rows={4}
              value={form.remark ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
            />
          </div>
          <div>
            <FieldLabel>REFERENCE CONTRACT</FieldLabel>
            <Input
              value={form.reference_contract ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, reference_contract: e.target.value || null }))
              }
              placeholder="(เว้นว่างได้)"
              className="max-w-[200px]"
            />
          </div>
          <div>
            <FieldLabel>REFERENCE TRANSACTION</FieldLabel>
            <Select
              value={form.reference_transaction_id ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, reference_transaction_id: e.target.value || null }))
              }
            >
              <option value="">— เลือก —</option>
              {(pnOptions ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.pn_number ? ` (${p.pn_number})` : ''}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </Section>
  );
}

// =====================================================================
//  Subcomponents
// =====================================================================
function FieldRow({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div className="flex justify-between border-b border-line py-2">
      <span className="text-muted text-sm">
        <TipLabel>{label}</TipLabel>
      </span>
      <span className={bold ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  );
}

function Tr({ label, value, bold, highlight }: { label: string; value: any; bold?: boolean; highlight?: boolean }) {
  return (
    <tr>
      <td className="py-1 text-muted text-xs w-44">
        <TipLabel>{label}</TipLabel>:
      </td>
      <td className={`py-1 ${bold ? 'font-semibold' : ''} ${highlight ? 'text-brand' : ''}`}>{value}</td>
    </tr>
  );
}

/**
 * Mock chassis inventory — simulates pulling from NetSuite ERP (FA Master / Inventory).
 * In production, this would be a Supabase query to a `chassis_inventory` table or a NetSuite API call.
 */
const MOCK_CHASSIS_INVENTORY: Chassis[] = [
  { id: 'inv-1', chassis_no: 'MMTFR86A8RH001234', engine_no: 'B58B30-1024578', car_model: 'BMW X7 xDrive40d',  location: 'MCR HQ Showroom',     cost: 3850000, status: 'Active' },
  { id: 'inv-2', chassis_no: 'WBA8E5C50JG924765', engine_no: 'B48B20-8847213', car_model: 'BMW 320i M Sport',   location: 'MCR Rama 9',          cost: 1800000, status: 'Active' },
  { id: 'inv-3', chassis_no: 'WMW7D5108K5K12345', engine_no: 'B38A15-3320145', car_model: 'MINI Cooper S 5DR',  location: 'MCR HQ Showroom',     cost: 1400000, status: 'Active' },
  { id: 'inv-4', chassis_no: 'JTHGK1BB1J2046823', engine_no: '2GR-FXE-556102', car_model: 'Lexus ES 300h',      location: 'MAG Rangsit',         cost: 2950000, status: 'Active' },
  { id: 'inv-5', chassis_no: 'JTDKBRFU6K3107452', engine_no: '2ZR-FXE-771230', car_model: 'Toyota Corolla Hybrid', location: 'MAS Bangna',       cost: 950000,  status: 'Active' },
  { id: 'inv-6', chassis_no: 'WBAJB4C50KBV98762', engine_no: 'B48B20-9912034', car_model: 'BMW 530e M Sport',   location: 'MCR HQ Showroom',     cost: 3450000, status: 'Active' },
  { id: 'inv-7', chassis_no: 'WAUE8AF44LA011234', engine_no: 'DLVA-4451209', car_model: 'Audi A6 45 TFSI',    location: 'MAG Lat Phrao',       cost: 3290000, status: 'Active' },
  { id: 'inv-8', chassis_no: 'JHMFC1F70KX021234', engine_no: 'L15B7-2203471', car_model: 'Honda Civic RS',     location: 'MAG Rangsit',         cost: 1090000, status: 'Active' },
];

function ChassisTab({ list, onChange }: { list: Chassis[]; onChange: (n: Chassis[]) => void }) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ro = useReadOnly();

  const usedChassisNos = new Set(list.map((c) => c.chassis_no));
  const filtered = MOCK_CHASSIS_INVENTORY.filter((c) => {
    if (usedChassisNos.has(c.chassis_no)) return false; // hide already-added
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.chassis_no.toLowerCase().includes(q) ||
      (c.engine_no ?? '').toLowerCase().includes(q) ||
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
    const picked = MOCK_CHASSIS_INVENTORY.filter((c) => selected.has(c.id)).map((c) => ({
      ...c,
      id: crypto.randomUUID(), // fresh id for the linked row
    }));
    onChange([...list, ...picked]);
    setSelected(new Set());
    setLookupOpen(false);
    setSearch('');
  };

  return (
    <div>
      <div className="mb-3 flex justify-between items-center">
        <p className="text-xs text-muted italic">
          📌 Chassis ดึงจาก Inventory (NetSuite ERP) — 1 Chassis ผูกได้ 1 Facility เท่านั้น
        </p>
        {!ro && (
          <Button variant="primary" onClick={() => setLookupOpen(true)}>
            🔍 Lookup Chassis
          </Button>
        )}
      </div>
      <table className="table-base">
        <thead>
          <tr>
            <th><TooltipText>Chassis No.</TooltipText></th>
            <th><TooltipText>Engine No.</TooltipText></th>
            <th><TooltipText>Car Model</TooltipText></th>
            <th><TooltipText>Location</TooltipText></th>
            <th className="text-center"><TooltipText>Cost (THB)</TooltipText></th>
            <th><TooltipText>Status</TooltipText></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-muted py-6">
                ยังไม่มี Chassis — กด "🔍 Lookup Chassis"
              </td>
            </tr>
          )}
          {list.map((c, i) => (
            <tr key={c.id}>
              <td className="font-mono text-xs">{c.chassis_no}</td>
              <td className="font-mono text-xs">{c.engine_no}</td>
              <td>{c.car_model}</td>
              <td>{c.location}</td>
              <td className="text-center tabular-nums">{fmtMoney(c.cost)}</td>
              <td>
                <Badge variant={c.status === 'Active' ? 'success' : 'default'}>{c.status}</Badge>
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => onChange(list.filter((_, j) => j !== i))}
                  className="text-danger hover:underline text-xs"
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

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
          💡 Mock data — ระบบจริงจะดึงจาก NetSuite FA Master / Aliyan Inventory
        </p>
        <div className="overflow-x-auto max-h-[400px]">
          <table className="table-base">
            <thead className="sticky top-0">
              <tr>
                <th className="w-10"></th>
                <ThTip>Chassis No.</ThTip>
                <ThTip>Engine No.</ThTip>
                <ThTip>Car Model</ThTip>
                <ThTip>Location</ThTip>
                <ThTip align="center">Cost (THB)</ThTip>
                <ThTip>Status</ThTip>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted py-6">
                    {usedChassisNos.size === MOCK_CHASSIS_INVENTORY.length
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
                  <td className="text-center tabular-nums">{fmtMoney(c.cost)}</td>
                  <td>
                    <Badge variant="success">{c.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}

function RolloverHistory({ currentId, parentId, accrued }: { currentId: string; parentId: string | null; accrued: number }) {
  // Recursively walk parent chain + children list
  const { data: chain } = useQuery({
    queryKey: ['pn-rollover-chain', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const visited: any[] = [];
      // Walk up
      let cur: any = currentId;
      while (cur) {
        const { data, error } = await supabase.from('promissory_notes').select('*').eq('id', cur).single();
        if (error || !data) break;
        visited.unshift(data);
        cur = data.rollover_parent_id;
      }
      // Walk down
      let lastId = currentId;
      while (lastId) {
        const { data, error } = await supabase.from('promissory_notes').select('*').eq('rollover_parent_id', lastId).maybeSingle();
        if (error || !data) break;
        visited.push(data);
        lastId = data.id;
      }
      return visited;
    },
  });

  if (!chain || chain.length <= 1) {
    // Match LG/BG: only show history once an actual Roll Over has occurred
    // (a lone current contract — incl. Draft — is not "history").
    return <div className="text-center text-muted py-6 italic text-sm">ยังไม่มีประวัติ Roll Over</div>;
  }

  return (
    <div className="overflow-x-auto">
      <p className="text-xs text-muted mb-3 italic">📌 ประวัติการ Roll Over — แสดงโซ่ของตั๋ว P/N (ตั๋วเดิม → ตั๋วใหม่)</p>
      <table className="table-base">
        <thead>
          <tr>
            <th>#</th>
            <th><TooltipText>P/N Name</TooltipText></th>
            <th><TooltipText tipKey="BANK REFERENCE">Bank Reference</TooltipText></th>
            <th><TooltipText tipKey="TRANSACTION DATE">Transaction Date</TooltipText></th>
            <th><TooltipText tipKey="MATURITY DATE">Maturity</TooltipText></th>
            <th className="text-right"><TooltipText>Principal</TooltipText></th>
            <th className="text-right"><TooltipText>Accrued Interest</TooltipText></th>
            <th><TooltipText>Status</TooltipText></th>
            <th><TooltipText>Reference</TooltipText></th>
          </tr>
        </thead>
        <tbody>
          {chain.map((r: any, i: number) => (
            <tr key={r.id} className={r.id === currentId ? 'bg-brand-light' : ''}>
              <td>{i + 1}</td>
              <td className="font-medium">{r.name}{r.id === currentId && <span className="ml-2 text-xs">(current)</span>}</td>
              <td>{r.pn_number}</td>
              <td>{fmtDate(r.transaction_date)}</td>
              <td>{r.maturity_date ? fmtDate(r.maturity_date) : '—'}</td>
              <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
              <td className="text-right tabular-nums">{r.accrued_interest ? fmtMoney(r.accrued_interest) : '—'}</td>
              <td><Badge variant={r.status === 'Approved' ? 'success' : 'warn'}>{r.status}</Badge></td>
              <td>{r.reference_contract ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
