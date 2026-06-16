import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Input, Select, Badge, FieldLabel } from '@/components/ui';
import { fmtDate, fmtMoney, fmtDateISO} from '@/lib/format';
import {
  type BankStatement,
  type BankStatementLine,
  FINANCE_INSTITUTIONS,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { ThTip } from '@/components/tx/TipHelpers';
import { FacilityPicker, type FacilityType } from '@/components/shared/FacilityPicker';

type HeaderForm = Omit<BankStatement, 'id' | 'created_at' | 'updated_at'>;

/**
 * NumInput — text-based number field that supports partial typing of negative numbers
 * (e.g. user typing "-" or "-30000" doesn't get reset to 0).
 * Keeps an internal string while focused; emits parsed number on every valid update.
 */
function NumInput({
  value,
  onChange,
  className,
  allowNegative = false,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  allowNegative?: boolean;
}) {
  // Display: comma-formatted when blurred (e.g. "1,000,000.00"); raw digits when focused for easy edit.
  const fmt = (n: number) =>
    n === 0 ? '0' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const [raw, setRaw] = useState<string>(fmt(value ?? 0));
  const [focused, setFocused] = useState(false);

  // Sync external changes when not focused → reformat with commas
  useEffect(() => {
    if (!focused) setRaw(fmt(value ?? 0));
  }, [value, focused]);

  const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={raw}
      onFocus={() => {
        setFocused(true);
        // Strip commas so user can edit raw digits
        setRaw(String(value ?? 0));
      }}
      onBlur={() => {
        setFocused(false);
        const n = parseFloat(raw.replace(/,/g, ''));
        if (isNaN(n)) {
          setRaw(fmt(0));
          onChange(0);
        } else {
          setRaw(fmt(n));
          onChange(n);
        }
      }}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '' || pattern.test(v)) {
          setRaw(v);
          const n = parseFloat(v);
          if (!isNaN(n)) onChange(n);
        }
      }}
      className={`text-right tabular-nums text-xs ${className ?? ''}`}
    />
  );
}

const blank: HeaderForm = {
  finance_institution: 'SCB',
  account_no: '',
  statement_name: null,
  statement_period: new Date().toISOString().slice(0, 7), // YYYY-MM
  source: 'Manual',
  inactive: false,
  remark: null,
};

export function BankStatementDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<HeaderForm>(blank);
  const [lines, setLines] = useState<BankStatementLine[]>([]);

  // BR-MST-BS-002 — Balance formula check (warning, not block).
  // For each line N (N≥1): Expected Balance = Previous Balance + Credit − Debit
  // First line cannot be validated (no previous baseline) — skip it.
  const balanceWarnings = useMemo(() => {
    const out: { mismatch: boolean; expected: number; diff: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) {
        out.push({ mismatch: false, expected: lines[0].balance, diff: 0 });
        continue;
      }
      const prev = lines[i - 1].balance;
      const expected = prev + (lines[i].credit || 0) - (lines[i].debit || 0);
      const actual = lines[i].balance;
      const diff = actual - expected;
      out.push({ mismatch: Math.abs(diff) > 0.01, expected, diff });
    }
    return out;
  }, [lines]);

  const balanceMismatchCount = balanceWarnings.filter((w) => w.mismatch).length;

  const { data: existing } = useQuery({
    queryKey: ['bank-stmt', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [h, l] = await Promise.all([
        supabase.from('bank_statements').select('*').eq('id', id!).single(),
        supabase.from('bank_statement_lines').select('*').eq('statement_id', id!).order('sort_order'),
      ]);
      if (h.error) throw h.error;
      return {
        header: h.data as BankStatement,
        lines: (l.data ?? []) as BankStatementLine[],
      };
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing.header;
      setForm(rest);
      setLines(existing.lines);
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.account_no.trim()) throw new Error('ใส่ Account Number');

      // AC-7 of UC-LEASE-008 — Block duplicate facility link
      // Check 1: intra-statement duplicates (within the current lines array)
      const seen = new Map<string, number>();
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l.facility_type || !l.facility_id) continue;
        const key = `${l.facility_type}|${l.facility_id}|${l.source_period ?? 'null'}`;
        if (seen.has(key)) {
          const otherIdx = seen.get(key)!;
          throw new Error(
            `บรรทัด #${i + 1} และ #${otherIdx + 1} link facility/งวดเดียวกัน — ` +
            `1 Bank Line ↔ 1 งวด (เปลี่ยน facility หรือ source_period)`
          );
        }
        seen.set(key, i);
      }

      // Check 2: cross-statement duplicates (other statements in DB)
      const linkedLines = lines.filter(
        (l) => l.facility_type && l.facility_id,
      );
      if (linkedLines.length > 0) {
        for (const l of linkedLines) {
          let q = supabase
            .from('bank_statement_lines')
            .select('id, statement_id')
            .eq('facility_type', l.facility_type!)
            .eq('facility_id', l.facility_id!);
          // null != null in SQL — handle source_period explicitly
          q = l.source_period == null
            ? q.is('source_period', null)
            : q.eq('source_period', l.source_period);
          // Exclude lines from this statement (will be deleted+reinserted below)
          if (id) q = q.neq('statement_id', id);
          const { data: dupes } = await q;
          if (dupes && dupes.length > 0) {
            throw new Error(
              `งวดนี้ link Bank Line อื่นไปแล้ว — ` +
              `กรุณาลบ link เดิมก่อน หรือเลือกงวดอื่น ` +
              `(facility: ${l.facility_type}, period: ${l.source_period ?? '-'})`
            );
          }
        }
      }

      let stmtId = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('bank_statements').insert(form).select().single();
        if (error) throw error;
        stmtId = data.id;
      } else {
        const { error } = await supabase.from('bank_statements').update(form).eq('id', stmtId!);
        if (error) throw error;
      }
      // Replace lines
      await supabase.from('bank_statement_lines').delete().eq('statement_id', stmtId!);
      if (lines.length > 0) {
        const rows = lines.map((l, i) => ({
          statement_id: stmtId!,
          tx_date: l.tx_date,
          tx_time: l.tx_time,
          txn_code: l.txn_code,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
          balance: l.balance,
          source: l.source,
          remark: l.remark,
          sort_order: i,
          facility_type: l.facility_type,
          facility_id: l.facility_id,
          source_period: l.source_period,
        }));
        const { error } = await supabase.from('bank_statement_lines').insert(rows);
        if (error) throw error;
      }
      return stmtId;
    },
    onSuccess: (stmtId: any) => {
      qc.invalidateQueries({ queryKey: ['bank-stmt-list'] });
      qc.invalidateQueries({ queryKey: ['bank-stmt', stmtId] });
      toast.success(mode === 'new' ? 'สร้าง Bank Statement แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new' && stmtId) navigate(`/master/bank-statement/${stmtId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addManual = () => {
    const today = fmtDateISO(new Date());
    const lastBal = lines.length > 0 ? lines[lines.length - 1].balance : 0;
    setLines([
      ...lines,
      {
        id: crypto.randomUUID(),
        statement_id: '',
        tx_date: today,
        tx_time: null,
        txn_code: null,
        description: null,
        debit: 0,
        credit: 0,
        balance: lastBal,
        source: 'Manual',
        remark: null,
        sort_order: lines.length,
        facility_type: null,
        facility_id: null,
        source_period: null,
      },
    ]);
  };

  const importMock = () => {
    const samples: { date: string; code: string; debit: number; credit: number; balance: number }[] = [
      { date: '2024-09-01', code: 'FE', debit: 5000, credit: 0, balance: -5000 },
      { date: '2024-09-02', code: 'ENET', debit: 0, credit: 35000, balance: -30000 },
      { date: '2024-09-03', code: 'FE', debit: 15000, credit: 0, balance: -15000 },
      { date: '2024-09-04', code: 'FE', debit: 0, credit: 35000, balance: -50000 },
      { date: '2024-09-05', code: 'TRANSFER', debit: 0, credit: 0, balance: -50000 },
    ];
    const newRows: BankStatementLine[] = samples.map((s, i) => ({
      id: crypto.randomUUID(),
      statement_id: '',
      tx_date: s.date,
      tx_time: null,
      txn_code: s.code,
      description: null,
      debit: s.debit,
      credit: s.credit,
      balance: s.balance,
      source: 'Import',
      remark: null,
      sort_order: lines.length + i,
      facility_type: null,
      facility_id: null,
      source_period: null,
    }));
    setLines([...lines, ...newRows]);
    toast.success(`Import mock — ${newRows.length} rows`);
  };

  const update = (i: number, patch: Partial<BankStatementLine>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => setLines(lines.filter((_, j) => j !== i));

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/master/bank-statement')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Bank Statement
            <Badge variant={form.inactive ? 'default' : 'success'}>{form.inactive ? 'Inactive' : 'Active'}</Badge>
          </h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New' : `${form.finance_institution} · ${form.account_no} · ${form.statement_period ?? ''}`}
          </p>
        </div>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={() => navigate('/master/bank-statement')}>Cancel</Button>
      </div>

      {/* Primary Info (2-col compact) */}
      <Section title="Primary Information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 max-w-3xl">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.inactive}
              onChange={(e) => setForm((f) => ({ ...f, inactive: e.target.checked }))}
            />
            <FieldLabel>INACTIVE</FieldLabel>
          </label>
          <div />
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
            <FieldLabel required>ACCOUNT NUMBER</FieldLabel>
            <Input
              value={form.account_no}
              onChange={(e) => setForm((f) => ({ ...f, account_no: e.target.value }))}
              placeholder="1403024625"
            />
            <p className="text-[10px] text-muted mt-0.5">
              💡 ระบบจะ match ตัวเลขนี้กับ O/D Account No เพื่อคำนวณดอกเบี้ย
            </p>
          </div>
          <div>
            <FieldLabel>STATEMENT PERIOD</FieldLabel>
            <Input
              type="month"
              value={form.statement_period ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, statement_period: e.target.value || null }))}
            />
          </div>
          <div>
            <FieldLabel>STATEMENT NAME</FieldLabel>
            <Input
              value={form.statement_name ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, statement_name: e.target.value || null }))}
              placeholder="SCB Sep 2024"
            />
          </div>
          <div className="md:col-span-2">
            <FieldLabel>REMARK</FieldLabel>
            <Input
              value={form.remark ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
              placeholder=""
            />
          </div>
        </div>
      </Section>

      {/* Lines */}
      <Section title="Statement Lines">
        <div className="mb-3 flex justify-between items-center">
          <p className="text-[11px] text-muted italic">
            📋 รายการธุรกรรมรายวัน · Debit = เงินออก · Credit = เงินเข้า · Balance = ยอดคงเหลือ (ลบ = OD ใช้จริง)
          </p>
          <div className="flex gap-2">
            <Button onClick={addManual} className="bg-white text-ink border-line hover:bg-soft">
              <Plus className="w-4 h-4" /> Add Manual
            </Button>
            <Button variant="primary" onClick={importMock}>
              <RefreshCw className="w-4 h-4" /> Import Mock (5 rows)
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[520px] border border-line rounded">
          <table className="table-base text-xs m-0">
            <thead className="sticky top-0 bg-soft">
              <tr>
                <ThTip>Date</ThTip>
                <ThTip>Time</ThTip>
                <ThTip>Txn Code</ThTip>
                <ThTip>Description</ThTip>
                <ThTip align="right">Debit</ThTip>
                <ThTip align="right">Credit</ThTip>
                <ThTip align="right">Balance</ThTip>
                <ThTip>Source</ThTip>
                <ThTip>Linked Facility</ThTip>
                <ThTip>Action</ThTip>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-muted py-6 italic">
                    — ยังไม่มี Statement Lines — กด <strong>+ Add Manual</strong> หรือ <strong>Import Mock</strong> —
                  </td>
                </tr>
              )}
              {lines.map((l, i) => {
                const isManual = l.source === 'Manual';
                const negBalance = l.balance < 0;
                const balWarn = balanceWarnings[i];
                return (
                  <tr key={l.id} className={isManual ? 'bg-amber-50' : ''}>
                    <td>
                      <Input
                        type="date"
                        value={l.tx_date}
                        onChange={(e) => update(i, { tx_date: e.target.value })}
                        className="text-xs"
                      />
                    </td>
                    <td>
                      <Input
                        value={l.tx_time ?? ''}
                        onChange={(e) => update(i, { tx_time: e.target.value || null })}
                        className="text-xs w-20"
                        placeholder="12:30"
                      />
                    </td>
                    <td>
                      <Input
                        value={l.txn_code ?? ''}
                        onChange={(e) => update(i, { txn_code: e.target.value || null })}
                        className="text-xs w-20"
                        placeholder="FE / ENET"
                      />
                    </td>
                    <td>
                      <Input
                        value={l.description ?? ''}
                        onChange={(e) => update(i, { description: e.target.value || null })}
                        className="text-xs"
                      />
                    </td>
                    <td>
                      <NumInput
                        value={l.debit}
                        onChange={(v) => update(i, { debit: v })}
                        className="w-24"
                      />
                    </td>
                    <td>
                      <NumInput
                        value={l.credit}
                        onChange={(v) => update(i, { credit: v })}
                        className="w-24"
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <NumInput
                          value={l.balance}
                          onChange={(v) => update(i, { balance: v })}
                          className={`w-28 ${negBalance ? 'text-danger' : ''}`}
                          allowNegative
                        />
                        {balWarn?.mismatch && (
                          <span
                            title={
                              `BR-MST-BS-002: BALANCE ผิดสูตร\n` +
                              `Expected = Prev (${fmtMoney(lines[i - 1].balance)}) + Credit (${fmtMoney(l.credit)}) − Debit (${fmtMoney(l.debit)})\n` +
                              `         = ${fmtMoney(balWarn.expected)}\n` +
                              `Actual  = ${fmtMoney(l.balance)}\n` +
                              `Diff    = ${fmtMoney(balWarn.diff)}`
                            }
                          >
                            <AlertTriangle className="w-4 h-4 text-orange-500" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={isManual ? 'text-amber-700 text-xs font-semibold' : 'text-xs'}>{l.source}</td>
                    <td>
                      <div className="flex flex-col gap-1">
                        <Select
                          value={l.facility_type ?? ''}
                          onChange={(e) => update(i, { facility_type: (e.target.value || null) as BankStatementLine['facility_type'] })}
                          className="text-xs w-24"
                        >
                          <option value="">—</option>
                          <option>P/N</option>
                          <option>LG</option>
                          <option>LC</option>
                          <option>FP</option>
                          <option>OD</option>
                          <option>TR</option>
                          <option>FXF</option>
                          <option>Loan</option>
                          <option>HP</option>
                          <option>Lease</option>
                        </Select>
                        {l.facility_type && (
                          <>
                            <FacilityPicker
                              facilityType={l.facility_type as FacilityType}
                              value={l.facility_id ?? null}
                              onChange={(uuid) => update(i, { facility_id: uuid })}
                              className="text-[10px] w-40"
                              placeholder={`เลือก ${l.facility_type}`}
                            />
                            <Input
                              type="number"
                              value={l.source_period ?? ''}
                              onChange={(e) => update(i, { source_period: e.target.value ? Number(e.target.value) : null })}
                              className="text-[10px] w-16"
                              placeholder="งวด"
                              title="Installment number (blank for one-time settlement)"
                            />
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      <button onClick={() => remove(i)} className="text-danger text-xs hover:underline">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-muted flex items-center justify-between">
          <div>
            Total lines: <strong>{lines.length}</strong> · Final balance:{' '}
            <strong className={lines.length > 0 && lines[lines.length - 1].balance < 0 ? 'text-danger' : ''}>
              {lines.length > 0 ? fmtMoney(lines[lines.length - 1].balance) : '—'}
            </strong>
          </div>
          {balanceMismatchCount > 0 && (
            <div className="inline-flex items-center gap-1 text-orange-700 bg-orange-50 px-2 py-1 rounded border border-orange-200">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>
                <strong>{balanceMismatchCount}</strong> บรรทัด BALANCE ผิดสูตร —
                hover icon ⚠️ เพื่อดู diff (BR-MST-BS-002 · warning only ไม่ block save)
              </span>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
