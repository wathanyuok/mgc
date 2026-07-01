import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchCaCards } from '@/lib/ca-inherit';
import { Button, Input, Select, Badge, FieldLabel, NumInput } from '@/components/ui';
import { fmtDate, fmtMoney, fmtPercent, fmtDateISO} from '@/lib/format';
import {
  type Overdraft,
  type ODBankTransaction,
  type ODStatus,
  FINANCE_INSTITUTIONS,
} from '@/types/database';
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
import { createJE, postJE, reverseJE } from '@/lib/je';
import { assertWithinCreditLine } from '@/lib/credit-limit';
import { nextRunningNo, RUNNING_PREFIX } from '@/lib/running-no';
import { computeStatusLock } from '@/lib/status-lock';
import { StatusLockBanner } from '@/components/tx/StatusLockBanner';
import { ClassificationCard } from '@/components/shared/ClassificationCard';
import { fetchInheritedFromCA, type InheritedSegments } from '@/lib/segment-inherit';
import {
  buildODDailyRows,
  buildODMonthSummary,
  odTotalInterest,
  odLastEndingBalance,
} from '@/lib/od-schedule';
import { ReconcileTab } from '@/components/tx/ReconcileTab';

const OD_STATUSES: ODStatus[] = ['Draft', 'Approved', 'Active', 'Suspended', 'Closed', 'Cancelled'];

type Form = Omit<Overdraft, 'id' | 'created_at' | 'updated_at'>;

const blank: Form = {
  od_no: '',
  name: null,
  ca_id: null,
  finance_institution: 'KBANK',
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
  Suspended: 'warn',
  Closed: 'default',
  Cancelled: 'danger',
};

export function ODDetail({ mode }: { mode: 'new' | 'edit' }) {
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

      const { data: lines } = await supabase
        .from('bank_statement_lines')
        .select('tx_date, balance, source, sort_order')
        .in('statement_id', stmtIds)
        .order('tx_date');
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
    queryKey: ['ca-options-od'],
    queryFn: async () => {
      const { data } = await supabase
        .from('credit_agreements')
        .select('id, ca_name, contract_number, ma_id')
        .order('ca_name');
      return data ?? [];
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

  // Effective rate
  const effRate = useMemo(
    () => (form.rate_cards.length > 0 ? effectiveRate((form.rate_cards as RateCard[])[0]) : form.effective_rate ?? 0),
    [form.rate_cards, form.effective_rate],
  );

  // Overlimit rate (absolute rate %, NOT additive)
  // = overlimit field if set, else fall back to normal effRate
  const overlimitRate = useMemo(() => {
    const ovl = (form.rate_cards as RateCard[])[0]?.overlimit ?? 0;
    return ovl > 0 ? ovl : effRate;
  }, [form.rate_cards, effRate]);

  // Daily rows + monthly summary (now uses AMOUNT as facility limit + overlimit rate)
  const dailyRows = useMemo(
    () => buildODDailyRows(bankTxs, effRate, form.amount || 0, overlimitRate),
    [bankTxs, effRate, form.amount, overlimitRate],
  );
  const monthSummary = useMemo(() => buildODMonthSummary(dailyRows), [dailyRows]);
  const totalInterest = useMemo(() => odTotalInterest(dailyRows), [dailyRows]);
  const lastBalance = useMemo(() => odLastEndingBalance(dailyRows), [dailyRows]);

  // Auto-Active: once the OD facility is actually drawn (any day with a negative
  // ending balance = overdraft used), promote Approved → Active. endingBalance<0 = drawn.
  useEffect(() => {
    if (!id || form.status !== 'Approved') return;
    if (!dailyRows.some((r) => r.endingBalance < 0)) return;
    supabase.from('overdrafts').update({ status: 'Active' }).eq('id', id).then(() => {
      setForm((f) => ({ ...f, status: 'Active' }));
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('O/D ถูกเบิกใช้แล้ว · Status → Active');
    });
  }, [id, form.status, dailyRows]);

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

  // Status-based locking (Option B+ — shared policy in lib/status-lock.ts)
  const lock = computeStatusLock('OD', form.status);
  const isTerminal = lock.isTerminal;

  // Save
  const save = useMutation({
    mutationFn: async () => {
      if (isTerminal) throw new Error('OD ปิด/ยกเลิกแล้ว — แก้ไขไม่ได้ (revert Status กลับก่อน)');
      await assertWithinCreditLine(form.ca_id, form.amount, { table: 'overdrafts', id });
      // Auto-fill od_no + name if blank (avoids unique-constraint conflict on empty string)
      // Also backfills existing records with empty name → fresh running no
      const odNoFilled = (form.od_no ?? '').trim() || `DRAFT-${Date.now()}`;
      const nameFilled = (form.name ?? '').trim() || await nextRunningNo(RUNNING_PREFIX.od);
      const payload = { ...form, od_no: odNoFilled, name: nameFilled, effective_rate: effRate, updated_by: userLabel };
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
      qc.invalidateQueries({ queryKey: ['od-list'] });
      qc.invalidateQueries({ queryKey: ['od', odId] });
      toast.success(mode === 'new' ? 'สร้าง O/D แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new' && odId) navigate(`/tx/od/${odId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ensureOdId — auto-create Draft for Document upload before save
  const ensureOdId = async (): Promise<string> => {
    if (id) return id;
    const odNo = (form.od_no ?? '').trim() || `DRAFT-${Date.now()}`;
    const name = (form.name ?? '').trim() || (id ? odNo : await nextRunningNo(RUNNING_PREFIX.od));
    const { data, error } = await supabase
      .from('overdrafts')
      .insert({ ...form, od_no: odNo, name, status: 'Draft', effective_rate: effRate })
      .select()
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['od-list'] });
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

      // Race-safe check
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'OD_ACCRUED')
        .eq('source_id', id)
        .eq('source_period', sourcePeriod)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (existing && existing.length > 0) {
        throw new Error(`Period ${m.monthLabel} มี JE อยู่แล้ว: ${existing[0].je_number}`);
      }

      const totalEnding = m.endingBalance - m.totalInterest;
      const jeDate = fmtDateISO(new Date(m.year, m.month, 0)); // end of month

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
            account_code: '5512101',
            account_name: 'ดอกเบี้ยจ่าย-เงินเบิกเกินบัญชี',
            dr: m.totalInterest,
            description: 'Interest expense — O/D',
          },
          {
            account_code: '100000',
            account_name: 'Cheque Account',
            cr: m.totalInterest,
            description: 'Cash leg (offset)',
          },
          // JV – Bank Overdraft (Outstanding)
          {
            account_code: '100000',
            account_name: 'Cheque Account',
            dr: Math.abs(totalEnding),
            description: 'Reclass utilized OD to Bank Overdraft liability',
          },
          {
            account_code: '2142101',
            account_name: 'เงินกู้ยืมระยะสั้นสถาบันการเงิน (O/D)',
            cr: Math.abs(totalEnding),
            description: 'Bank Overdraft outstanding',
          },
        ],
      });
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
    {
      key: 'reconcile',
      label: '🔧 Reconcile',
      render: () => (
        <ReconcileTab
          facilityType="OD"
          facilityId={id ?? ''}
          facilityNo={form.name ?? form.od_no ?? undefined}
          schedule={[]}
          title="Overdraft: ตัดดอกเบี้ยตาม Bank Transaction · Reconcile monthly interest charges เมื่อ Bank Statement ระบุยอด · schedule เกิดจาก Bank Confirmed lines (ไม่ pre-generate)"
        />
      ),
    },
  ];

  const selectedCa = caOptions?.find((c) => c.id === form.ca_id);

  return (
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
        <Button variant="primary" disabled={save.isPending || !can('od', 'edit')} title={!can('od', 'edit') ? 'ไม่มีสิทธิ์แก้ไข O/D' : ''} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={() => navigate('/tx/od')}>Cancel</Button>
      </div>

      <AuditFooter createdBy={(form as any).created_by} createdAt={(form as any).created_at} updatedBy={(form as any).updated_by} updatedAt={(form as any).updated_at} />

      <StatusLockBanner lock={lock} />

      {/* Primary Information (3-col) */}
      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* COL 1 */}
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
              <FieldLabel tipKey="OD NAME">NAME (auto)</FieldLabel>
              <Input readOnly value={form.name ?? ''} placeholder="auto — running no. (สร้างเมื่อ Save)" className="bg-gray-50 text-muted" />
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
              <FieldLabel tipKey="OD TRANSACTION NUMBER">OD TRANSACTION NUMBER</FieldLabel>
              <Input
                value={form.od_no}
                onChange={(e) => setForm((f) => ({ ...f, od_no: e.target.value }))}
                placeholder="O/D 202410-001178"
                className="bg-gray-50"
              />
            </div>
            <div>
              <FieldLabel tipKey="BANK REFERENCE">BANK REFERENCE (Account No)</FieldLabel>
              {accountOptions.length === 0 ? (
                <>
                  <Input value="" readOnly className="bg-gray-50 text-muted" placeholder="ยังไม่มี Bank Statement" />
                  <p className="text-[10px] text-muted mt-0.5">
                    ⚠️ ยังไม่มี Bank Statement —{' '}
                    <a href="/master/bank-statement/new" className="text-brand underline">
                      + สร้าง Bank Statement ก่อน
                    </a>
                  </p>
                </>
              ) : (
                <>
                  <Select
                    value={form.account_no ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, account_no: e.target.value || null }))}
                  >
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
          <div className="space-y-4">
            <div>
              <FieldLabel required>STATUS</FieldLabel>
              <Select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ODStatus }))}
              >
                {OD_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>REMARK</FieldLabel>
              <textarea
                className="input min-h-[60px]"
                value={form.remark ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
                placeholder="เพื่อใช้ในการหมุนเวียนกิจการ"
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
    </div>
  );
}

// ============== Bank Transaction Tab (derived view) ==============
function BankTransactionTab({ accountNo }: { accountNo: string | null }) {
  // Fetch matching statements + lines (read-only view of master data)
  const { data: matchedStmts } = useQuery({
    queryKey: ['od-bank-stmts', accountNo],
    enabled: !!accountNo,
    queryFn: async () => {
      const { data } = await supabase
        .from('bank_statements')
        .select('*')
        .eq('account_no', accountNo!)
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
}) {
  const [sub, setSub] = useState<'daily' | 'summary'>('daily');
  const totalEnding = lastBalance - totalInterest;

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
              Current Period — {dailyRows.length > 0 ? new Date(dailyRows[dailyRows.length - 1].date).toLocaleString('en-US', { month: 'short', year: 'numeric' }) : '—'}
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
                              <div
                                className="leading-tight"
                                title={`Blended: ${r.ratePct.toFixed(2)}% ภายในวงเงิน + ${r.overlimitRatePct.toFixed(2)}% ส่วนเกิน ${fmtMoney(r.overLimitAmount)}`}
                              >
                                <div>{r.ratePct.toFixed(4)}%</div>
                                <div className="text-danger font-semibold text-[10px]">
                                  + {r.overlimitRatePct.toFixed(2)}% overlimit
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
              <RowTip
                label="Total Ending Balance"
                value={
                  <span className="text-danger font-bold">
                    ({fmtMoney(Math.abs(totalEnding))})
                  </span>
                }
                bold
              />
            </div>
            <p className="text-[11px] text-muted mt-2 italic">
              💡 ระบบจะนำข้อมูลจาก Import / Manual Bank Statement มาคำนวณดอกเบี้ยอัตโนมัติ (ตอนยอดติดลบเท่านั้น)
            </p>
          </div>

          <div className="flex-1 min-w-[360px]">
            <div className="text-sm font-bold mb-3">📋 JE Preview (รายเดือนล่าสุด)</div>
            {dailyRows.length > 0 ? (
              <>
                <div className="mb-4 border border-line rounded overflow-hidden">
                  <div className="bg-brand text-white px-3 py-2 text-xs font-bold flex justify-between">
                    <span>JV – Interest</span>
                    <span className="flex gap-6 tracking-wider"><span>DR</span><span>CR</span></span>
                  </div>
                  <table className="table-base text-xs m-0">
                    <tbody>
                      <tr><td>Dr. Interest Expenses</td><td className="text-right tabular-nums">{fmtMoney(totalInterest)}</td><td /></tr>
                      <tr><td>Cr. Bank</td><td /><td className="text-right tabular-nums">{fmtMoney(totalInterest)}</td></tr>
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
                      <tr><td>Dr. Bank</td><td className="text-right tabular-nums">{fmtMoney(Math.abs(totalEnding))}</td><td /></tr>
                      <tr><td>Cr. Bank Overdraft</td><td /><td className="text-right tabular-nums">{fmtMoney(Math.abs(totalEnding))}</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted italic mb-3">** Auto Reverse ต้นเดือนถัดไป (manual)</p>
              </>
            ) : (
              <p className="text-muted text-sm italic">เพิ่ม Bank Transaction ก่อน — JE preview จะแสดงที่นี่</p>
            )}
          </div>
        </div>
      ) : (
        // Summary Transaction sub-tab
        <div>
          <div className="text-sm font-bold mb-2">Year {monthSummary[0]?.year ?? new Date().getFullYear()}</div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <ThTip>Month</ThTip>
                  <ThTip align="right">Interest</ThTip>
                  <ThTip align="right">Actual Interest</ThTip>
                  <ThTip align="right">Interest Rate</ThTip>
                  <ThTip align="right">Utilization End of Month</ThTip>
                  <ThTip>Journal Entry</ThTip>
                </tr>
              </thead>
              <tbody>
                {monthSummary.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-6 italic">
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
                        <td className="text-right tabular-nums">{fmtMoney(m.totalInterest)}</td>
                        <td className="text-right tabular-nums">{m.rate.toFixed(4)}%</td>
                        <td className={`text-right tabular-nums ${m.endingBalance < 0 ? 'text-danger font-semibold' : ''}`}>
                          {m.totalEndingBalance < 0 ? `(${fmtMoney(Math.abs(m.totalEndingBalance))})` : fmtMoney(m.totalEndingBalance)}
                        </td>
                        <td>
                          {isPosted && monthJE ? (
                            <div className="flex gap-2 items-center justify-center text-xs">
                              <a href={`/je/${monthJE.id}`} title={`เปิดดู ${monthJE.je_number}`}>
                                <Badge variant="success">✓ Posted</Badge>
                              </a>
                              <button
                                onClick={() => onReverseJE(monthJE.id)}
                                disabled={reversing}
                                className="text-danger hover:underline"
                                title="Reverse JE (auto-reverse next month)"
                              >
                                ↩ Reverse
                              </button>
                            </div>
                          ) : (
                            (() => {
                              const cantSave = !odId;
                              const noInterest = m.totalInterest <= 0;
                              const isDisabled = cantSave || posting || noInterest;
                              const reason = cantSave
                                ? 'Save O/D ก่อน'
                                : noInterest
                                  ? `ดอกเบี้ยเดือนนี้ = 0 (balance ไม่ติดลบ) — ไม่มี JE ให้ post`
                                  : 'Post Accrued Interest + Bank Overdraft JE';
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
                                  📋 {posting ? 'Posting...' : 'Post JE'}
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
            <RowTip
              label="Total Ending Balance"
              value={
                <span className="text-danger font-bold">
                  ({fmtMoney(Math.abs(totalEnding))})
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
