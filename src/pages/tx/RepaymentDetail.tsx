import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Save, Trash2, FileText, Upload, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge, FieldLabel, NumInput } from '@/components/ui';
import { fmtMoney, fmtDateISO} from '@/lib/format';
import { createJE, postJE } from '@/lib/je';
import {
  type Repayment,
  type RepaymentLine,
  type RepaymentCategory,
  REPAYMENT_CATEGORIES,
  FACILITY_TYPES,
} from '@/types/database';

const round2 = (n: number) => Math.round(n * 100) / 100;

const CHANNELS = ['Bank Statement', 'AP Module', 'Cash', 'Cheque'];

// GL accounts per payment category (Dr side); Cash is the Cr side.
const CATEGORY_GL: Record<RepaymentCategory, { code: string; name: string }> = {
  Principal: { code: '2142101', name: 'เงินกู้ยืมระยะสั้นสถาบันการเงิน (Note Payable)' },
  Interest: { code: '5512103', name: 'ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น' },
  Fee: { code: '5512201', name: 'ค่าธรรมเนียมจ่าย' },
  Penalty: { code: '5511101', name: 'ค่าธรรมเนียมธนาคาร (Penalty/Late Fee)' },
};
const CASH_GL = { code: '100000', name: 'Cheque Account' };

// Credit (จ่ายเงินออก) account per channel —
// Bank Statement / Cheque → Cr เงินฝากธนาคาร · AP Module → Cr เจ้าหนี้ (ตั้งหนี้รอจ่าย) · Cash → Cr เงินสด
const CHANNEL_GL: Record<string, { code: string; name: string }> = {
  'Bank Statement': { code: '100000', name: 'Cheque Account (Bank)' },
  'AP Module': { code: '2110000', name: 'เจ้าหนี้การค้า (Accounts Payable)' },
  Cash: { code: '101000', name: 'เงินสด (Cash)' },
  Cheque: { code: '100000', name: 'Cheque Account' },
};

// Map a Thai/English payment-method label → repayment category
function mapCategory(method: string): RepaymentCategory {
  const m = (method || '').toLowerCase();
  if (m.includes('เงินต้น') || m.includes('ต้น') || m.includes('principal')) return 'Principal';
  if (m.includes('เบี้ยปรับ') || m.includes('ค่าปรับ') || m.includes('penalty') || m.includes('late')) return 'Penalty';
  if (m.includes('ธรรมเนียม') || m.includes('fee') || m.includes('charge')) return 'Fee';
  return 'Interest'; // default — ดอกเบี้ย
}

// Minimal CSV parser (handles quoted fields + commas). Returns array of cell arrays.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { cur.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(cur); cur = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') pushRow();
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length > 0 || cur.length > 0) pushRow();
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const TEMPLATE_HEADERS = ['เลขที่สัญญา', 'วันครบกำหนด', 'ยอดค้างชำระ', 'วิธีการชำระ'];

type Line = {
  key: string;
  facility_id: string;
  contract_label: string;
  category: RepaymentCategory;
  amount: number;
};

const newLine = (): Line => ({
  key: crypto.randomUUID(),
  facility_id: '',
  contract_label: '',
  category: 'Interest',
  amount: 0,
});

type Header = {
  repayment_no: string;
  pay_date: string;
  facility_type: string;
  channel: string;
  reference_no: string | null;
  remark: string | null;
  status: 'Draft' | 'Posted' | 'Reversed';
};

const blankHeader: Header = {
  repayment_no: '',
  pay_date: fmtDateISO(new Date()),
  facility_type: 'PN',
  channel: 'Bank Statement',
  reference_no: null,
  remark: null,
  status: 'Draft',
};

const FACILITY_TABLE: Record<string, [string, string]> = {
  PN: ['promissory_notes', 'name'],
  LG: ['letter_guarantees', 'lg_no'],
  BG: ['letter_guarantees', 'lg_no'],
  FP: ['floor_plans', 'fp_no'],
  OD: ['overdrafts', 'od_no'],
  TR: ['trust_receipts', 'tr_no'],
  FXF: ['fx_forwards', 'fxf_no'],
  Loan: ['loans', 'loan_no'],
  Lease: ['leases', 'lease_no'],
  HP: ['leases', 'lease_no'],
};

export function RepaymentDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Pre-fill from URL search params (e.g. ?facility_type=HP&facility_id=...&category=Penalty)
  const [searchParams] = useSearchParams();
  const prefilledFacilityType = searchParams.get('facility_type') || 'PN';
  const prefilledFacilityId = searchParams.get('facility_id') || '';
  const prefilledCategory = searchParams.get('category') || '';
  const [header, setHeader] = useState<Header>({ ...blankHeader, facility_type: prefilledFacilityType });
  const [lines, setLines] = useState<Line[]>([
    prefilledFacilityId || prefilledCategory
      ? { ...newLine(), facility_id: prefilledFacilityId, category: (prefilledCategory as any) || 'Interest' }
      : newLine(),
  ]);
  const [entryMode, setEntryMode] = useState<'manual' | 'import'>('manual');

  // Contracts for the chosen facility type
  const { data: facilityOpts = [] } = useQuery({
    queryKey: ['rp-facility-opts', header.facility_type],
    queryFn: async () => {
      const [table, labelCol] = FACILITY_TABLE[header.facility_type] ?? ['', ''];
      if (!table) return [] as { id: string; code: string; label: string }[];
      // HP/Lease share `leases` table but filter by mode column
      const needsLeaseFilter = header.facility_type === 'HP' || header.facility_type === 'Lease';
      const selectCols = needsLeaseFilter ? `id, ${labelCol}, status, mode` : `id, ${labelCol}, status`;
      let query = supabase.from(table).select(selectCols).order(labelCol);
      if (header.facility_type === 'HP') query = query.eq('mode', 'hp');
      else if (header.facility_type === 'Lease') query = query.eq('mode', 'other');
      const { data, error } = await query;
      if (error) return [];
      return (data ?? [])
        .filter((r: any) => !['Cancelled', 'Rejected'].includes(r.status))
        .map((r: any) => {
          const code = String(r[labelCol] ?? r.id);
          return { id: r.id, code, label: `${code}${r.status ? ` · ${r.status}` : ''}` };
        });
    },
  });

  const { data: existing } = useQuery({
    queryKey: ['rep', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [h, l] = await Promise.all([
        supabase.from('repayments').select('*').eq('id', id!).single(),
        supabase.from('repayment_lines').select('*').eq('repayment_id', id!).order('sort_order'),
      ]);
      if (h.error) throw h.error;
      return { header: h.data as Repayment, lines: (l.data ?? []) as RepaymentLine[] };
    },
  });

  useEffect(() => {
    if (existing) {
      const m = existing.header;
      setHeader({
        repayment_no: m.repayment_no,
        pay_date: m.pay_date,
        facility_type: m.facility_type,
        channel: m.channel,
        reference_no: m.reference_no,
        remark: m.remark,
        status: m.status,
      });
      setLines(
        existing.lines.length
          ? existing.lines.map((r) => ({
              key: r.id,
              facility_id: r.facility_id ?? '',
              contract_label: r.contract_label ?? '',
              category: r.category,
              amount: r.amount,
            }))
          : [newLine()],
      );
    }
  }, [existing]);

  // Totals by category
  const totals = useMemo(() => {
    const t = { Principal: 0, Interest: 0, Fee: 0, Penalty: 0, total: 0 };
    for (const l of lines) {
      t[l.category] += l.amount;
      t.total += l.amount;
    }
    return t;
  }, [lines]);

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // ── Import ──
  const downloadTemplate = () => {
    const sample = ['PNWC002', '2024-10-31', '150000', 'ดอกเบี้ย'];
    const csv = TEMPLATE_HEADERS.join(',') + '\n' + sample.join(',') + '\n';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'repayment-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) { toast.error('ไฟล์ว่าง'); return; }
      const start = rows[0].some((c) => TEMPLATE_HEADERS.some((h) => c.trim() === h)) ? 1 : 0;
      let matched = 0;
      let unmatched = 0;
      const imported: Line[] = [];
      for (let i = start; i < rows.length; i++) {
        const cells = rows[i].map((c) => c.trim());
        const contract = cells[0] ?? '';
        const amountStr = cells[2] ?? '';
        const method = cells[3] ?? '';
        if (!contract && !amountStr) continue;
        const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
        const opt = facilityOpts.find((o) => o.code.toLowerCase() === contract.toLowerCase());
        if (opt) matched++; else unmatched++;
        imported.push({
          key: crypto.randomUUID(),
          facility_id: opt?.id ?? '',
          contract_label: opt?.code ?? contract,
          category: mapCategory(method),
          amount,
        });
      }
      if (imported.length === 0) { toast.error('ไม่พบรายการในไฟล์'); return; }
      setLines(imported);
      toast.success(`Import ${imported.length} แถว · matched ${matched} สัญญา${unmatched ? ` · ไม่ match ${unmatched} (เลือกสัญญาเอง)` : ''}`);
    } catch (e: any) {
      toast.error(`อ่านไฟล์ไม่ได้: ${e.message}`);
    }
  };

  const persist = async (): Promise<string> => {
    const repNo = header.repayment_no.trim() || `RP-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
    const headerRow = {
      repayment_no: repNo,
      facility_type: header.facility_type,
      facility_id: lines[0]?.facility_id || null,
      pay_date: header.pay_date,
      channel: header.channel,
      reference_no: header.reference_no,
      remark: header.remark,
      status: header.status,
      principal: round2(totals.Principal),
      interest: round2(totals.Interest),
      fee: round2(totals.Fee),
      penalty: round2(totals.Penalty),
      vat: 0,
      wht: 0,
      amount: round2(totals.total),
    };
    let rid = id;
    if (mode === 'new' && !id) {
      const { data, error } = await supabase.from('repayments').insert(headerRow).select().single();
      if (error) throw error;
      rid = data.id;
    } else {
      const { error } = await supabase.from('repayments').update(headerRow).eq('id', rid!);
      if (error) throw error;
    }
    // Replace lines
    await supabase.from('repayment_lines').delete().eq('repayment_id', rid!);
    const rows = lines
      .filter((l) => l.amount !== 0 || l.facility_id)
      .map((l, i) => ({
        repayment_id: rid!,
        facility_type: header.facility_type,
        facility_id: l.facility_id || null,
        contract_label: l.contract_label || null,
        category: l.category,
        amount: round2(l.amount),
        sort_order: i,
      }));
    if (rows.length) {
      const { error } = await supabase.from('repayment_lines').insert(rows);
      if (error) throw error;
    }
    setHeader((h) => ({ ...h, repayment_no: repNo }));
    return rid!;
  };

  const save = useMutation({
    mutationFn: persist,
    onSuccess: (rid) => {
      qc.invalidateQueries({ queryKey: ['rep-list'] });
      qc.invalidateQueries({ queryKey: ['rep', rid] });
      toast.success('บันทึก Repayment แล้ว');
      if (mode === 'new') navigate(`/tx/repayment/${rid}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createJournal = useMutation({
    mutationFn: async () => {
      if (totals.total <= 0) throw new Error('กรอกยอดรับชำระก่อน (Total ต้องมากกว่า 0)');
      const rid = await persist();
      // Idempotent
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'REPAYMENT').eq('source_id', rid).eq('status', 'Posted');
      if (ex && ex.length > 0) throw new Error(`Repayment นี้มี JE แล้ว: ${ex[0].je_number}`);

      const jeLines = REPAYMENT_CATEGORIES
        .filter((c) => round2(totals[c]) > 0.005)
        .map((c) => ({
          account_code: CATEGORY_GL[c].code,
          account_name: CATEGORY_GL[c].name,
          dr: round2(totals[c]),
          description: `${c} repayment`,
        }));
      const creditGL = CHANNEL_GL[header.channel] ?? CASH_GL;
      jeLines.push({
        account_code: creditGL.code,
        account_name: creditGL.name,
        cr: round2(totals.total),
        description: `Repayment payout (${header.channel})`,
      } as any);

      const je = await createJE({
        source_type: 'REPAYMENT',
        source_id: rid,
        je_date: header.pay_date,
        description: `Repayment ${header.repayment_no || ''} — ${header.facility_type}`,
        remark: `Channel: ${header.channel}`,
        lines: jeLines,
      });
      await postJE(je.id, 'user');
      await supabase.from('repayments').update({ status: 'Posted', je_id: je.id }).eq('id', rid);

      // Auto-promote source facility → Repaid when principal is fully repaid.
      // Works for PN/TR (bullet) and FP (curtailment): compares CUMULATIVE principal
      // across all Posted repayments for the facility against its amount. This batch's
      // lines are already saved + marked Posted above, so they're included in the sum.
      // Conservative: only fires at full payoff, so it never marks a partial as Repaid.
      //, not a manual status toggle).
      let repaidCount = 0;
      const ft = header.facility_type;
      if (ft === 'PN' || ft === 'TR' || ft === 'FP') {
        const table = FACILITY_TABLE[ft][0];
        const fids = [...new Set(lines.map((l) => l.facility_id).filter(Boolean))];
        for (const fid of fids) {
          const { data: pl } = await supabase
            .from('repayment_lines')
            .select('amount, category, repayments!inner(status, facility_type)')
            .eq('facility_id', fid)
            .eq('category', 'Principal');
          const cumPrincipal = (pl ?? [])
            .filter((r: any) => r.repayments?.status === 'Posted')
            .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
          const { data: fac } = await supabase.from(table).select('amount, status').eq('id', fid).single();
          if (!fac) continue;
          const open = !['Repaid', 'Cancelled', 'Roll Over'].includes((fac as any).status);
          if (open && Number((fac as any).amount) > 0 && cumPrincipal >= Number((fac as any).amount) - 0.01) {
            await supabase.from(table).update({ status: 'Repaid' }).eq('id', fid);
            repaidCount++;
          }
        }
      }
      return { jeNo: je.je_number, repaidCount };
    },
    onSuccess: ({ jeNo, repaidCount }) => {
      qc.invalidateQueries({ queryKey: ['rep-list'] });
      qc.invalidateQueries({ queryKey: ['rep', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      setHeader((h) => ({ ...h, status: 'Posted' }));
      toast.success(repaidCount > 0 ? `✓ Posted JE ${jeNo} · ${repaidCount} สัญญา → Repaid` : `✓ Posted JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/repayment')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Repayment</h1>
          <p className="text-muted text-sm">การจ่ายคืนเงินต้น/ดอกเบี้ย/ค่าธรรมเนียม ระหว่างสัญญา</p>
        </div>
        <Badge variant={header.status === 'Posted' ? 'success' : header.status === 'Reversed' ? 'danger' : 'warn'}>
          {header.status}
        </Badge>
      </div>
      <div className="flex gap-2 mb-4">
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={() => navigate('/tx/repayment')}>Cancel</Button>
      </div>

      {/* Primary Information */}
      <Card className="mb-4"><CardContent>
        <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <FieldLabel>REPAYMENT NO</FieldLabel>
            <Input
              value={header.repayment_no}
              readOnly
              placeholder="Auto-generated on Save"
              className="bg-gray-50"
              title="Repayment No. สร้างอัตโนมัติตอนกด Save (รูปแบบ RP-YYYY-NNNNN)"
            />
          </div>
          <div>
            <FieldLabel required>PAYMENT DATE</FieldLabel>
            <Input type="date" value={header.pay_date} onChange={(e) => setHeader((h) => ({ ...h, pay_date: e.target.value }))} />
          </div>
          <div>
            <FieldLabel required>FACILITY TYPE</FieldLabel>
            <Select value={header.facility_type} onChange={(e) => setHeader((h) => ({ ...h, facility_type: e.target.value }))}>
              {FACILITY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel>CHANNEL</FieldLabel>
            <Select value={header.channel} onChange={(e) => setHeader((h) => ({ ...h, channel: e.target.value }))}>
              {CHANNELS.map((c) => <option key={c}>{c}</option>)}
            </Select>
            <p className="text-[10px] text-muted mt-0.5 italic">รับชำระ 2 ช่องทาง (Bank Statement / AP)</p>
          </div>
          <div className="md:col-span-2">
            <FieldLabel>REFERENCE NO</FieldLabel>
            <Input value={header.reference_no ?? ''} onChange={(e) => setHeader((h) => ({ ...h, reference_no: e.target.value || null }))} />
          </div>
          <div className="md:col-span-2">
            <FieldLabel>REMARK</FieldLabel>
            <Input value={header.remark ?? ''} onChange={(e) => setHeader((h) => ({ ...h, remark: e.target.value || null }))} />
          </div>
        </div>
      </CardContent></Card>

      {/* Allocation */}
      <Card className="mb-4"><CardContent>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm tracking-wide">Payment Allocation</h3>
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-line overflow-hidden text-xs">
              <button
                onClick={() => setEntryMode('manual')}
                className={`px-3 py-1.5 ${entryMode === 'manual' ? 'bg-brand text-white' : 'bg-white text-muted hover:bg-soft'}`}
              >
                Manual
              </button>
              <button
                onClick={() => setEntryMode('import')}
                className={`px-3 py-1.5 ${entryMode === 'import' ? 'bg-brand text-white' : 'bg-white text-muted hover:bg-soft'}`}
              >
                Import
              </button>
            </div>
            {entryMode === 'manual' && (
              <Button size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
                <Plus className="w-4 h-4" /> Add Row
              </Button>
            )}
          </div>
        </div>

        {entryMode === 'import' && (
          <div className="mb-4 rounded border border-dashed border-line bg-soft p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5 cursor-pointer rounded bg-brand text-white px-3 py-1.5 text-sm hover:opacity-90">
                <Upload className="w-4 h-4" /> Choose CSV File
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
                />
              </label>
              <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-brand hover:underline text-sm">
                <Download className="w-4 h-4" /> Download Template
              </button>
            </div>
            <p className="text-[11px] text-muted mt-2">
              คอลัมน์: {TEMPLATE_HEADERS.join(', ')} · ระบบจะ <b>Matching เลขที่สัญญา</b> อัตโนมัติ — แถวที่ match ไม่ได้ให้เลือกสัญญาเองในตาราง
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="table-base text-sm">
            <thead>
              <tr>
                <th>Contract ({header.facility_type})</th>
                <th>Payment Category</th>
                <th className="text-right">Amount</th>
                <th className="text-right">—</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td>
                    <Select
                      value={l.facility_id}
                      onChange={(e) => {
                        const opt = facilityOpts.find((o) => o.id === e.target.value);
                        updateLine(l.key, { facility_id: e.target.value, contract_label: opt?.code ?? '' });
                      }}
                    >
                      <option value="">— เลือกสัญญา —</option>
                      {facilityOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                  </td>
                  <td>
                    <Select value={l.category} onChange={(e) => updateLine(l.key, { category: e.target.value as RepaymentCategory })}>
                      {REPAYMENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </Select>
                  </td>
                  <td className="text-right">
                    <NumInput value={l.amount} onChange={(v) => updateLine(l.key, { amount: v })} className="text-right" />
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                      className="text-danger hover:text-red-700"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-soft font-bold border-t-2 border-line">
                <td colSpan={2} className="text-right">Total</td>
                <td className="text-right tabular-nums">{fmtMoney(totals.total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Category summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {REPAYMENT_CATEGORIES.map((c) => (
            <div key={c} className="rounded border border-line bg-soft p-2.5">
              <div className="text-[11px] text-muted uppercase tracking-wide">{c}</div>
              <div className="text-right tabular-nums font-semibold">{fmtMoney(totals[c])}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-line">
          <Button
            variant="primary"
            disabled={createJournal.isPending || header.status === 'Posted' || totals.total <= 0}
            onClick={() => createJournal.mutate()}
            title={header.status === 'Posted' ? 'Posted แล้ว' : 'สร้าง + Post JE ลง GL'}
          >
            <FileText className="w-4 h-4" /> Create Journal
          </Button>
          <span className="text-xs text-muted">
            {header.status === 'Posted'
              ? '✓ JE posted แล้ว'
              : `Dr Principal/Interest/Fee/Penalty · Cr ${(CHANNEL_GL[header.channel] ?? CASH_GL).name} — Post ลง GL`}
          </span>
        </div>
      </CardContent></Card>
    </div>
  );
}
