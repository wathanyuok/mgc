import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Input, Select, Badge, FieldLabel } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import {
  type BankStatement,
  type BankStatementLine,
  FINANCE_INSTITUTIONS,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { ThTip } from '@/components/tx/TipHelpers';

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
  const [raw, setRaw] = useState<string>(String(value ?? 0));
  const [focused, setFocused] = useState(false);

  // Sync external changes when not focused
  useEffect(() => {
    if (!focused) setRaw(String(value ?? 0));
  }, [value, focused]);

  const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={raw}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const n = parseFloat(raw);
        if (isNaN(n)) {
          setRaw('0');
          onChange(0);
        } else {
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
    const today = new Date().toISOString().slice(0, 10);
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
      },
    ]);
  };

  const importMock = () => {
    const samples: { date: string; code: string; debit: number; credit: number; balance: number }[] = [
      { date: '2024-09-01', code: 'FE',    debit: 5000,    credit: 0,     balance: -5000 },
      { date: '2024-09-02', code: 'ENET',  debit: 0,       credit: 35000, balance: -30000 },
      { date: '2024-09-03', code: 'FE',    debit: 15000,   credit: 0,     balance: -15000 },
      { date: '2024-09-04', code: 'FE',    debit: 0,       credit: 35000, balance: -50000 },
      { date: '2024-09-05', code: 'TRANSFER', debit: 0,    credit: 0,     balance: -50000 },
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
                <ThTip>Action</ThTip>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-muted py-6 italic">
                    — ยังไม่มี Statement Lines — กด <strong>+ Add Manual</strong> หรือ <strong>Import Mock</strong> —
                  </td>
                </tr>
              )}
              {lines.map((l, i) => {
                const isManual = l.source === 'Manual';
                const negBalance = l.balance < 0;
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
                      <NumInput
                        value={l.balance}
                        onChange={(v) => update(i, { balance: v })}
                        className={`w-28 ${negBalance ? 'text-danger' : ''}`}
                        allowNegative
                      />
                    </td>
                    <td className={isManual ? 'text-amber-700 text-xs font-semibold' : 'text-xs'}>{l.source}</td>
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
        <div className="mt-2 text-[11px] text-muted">
          Total lines: <strong>{lines.length}</strong> · Final balance:{' '}
          <strong className={lines.length > 0 && lines[lines.length - 1].balance < 0 ? 'text-danger' : ''}>
            {lines.length > 0 ? fmtMoney(lines[lines.length - 1].balance) : '—'}
          </strong>
        </div>
      </Section>
    </div>
  );
}
