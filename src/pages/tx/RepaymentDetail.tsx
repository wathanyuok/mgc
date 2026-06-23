import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Plus, Save, Trash2, FileText, Upload, Download, Landmark } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge, FieldLabel, NumInput } from '@/components/ui';
import { fmtMoney, fmtDateISO} from '@/lib/format';
import { createJE, postJE } from '@/lib/je';
import { pushCheckRequestToNetSuite } from '@/lib/netsuite-stub';
import {
  type Repayment,
  type RepaymentLine,
  type RepaymentCategory,
  REPAYMENT_CATEGORIES,
  FACILITY_TYPES,
} from '@/types/database';

const round2 = (n: number) => Math.round(n * 100) / 100;

// 2-Level Channel + Payment Type (Migration 0047 · per MoM Interface §4)
// AP เป็น parent channel · payment_type เป็น sub-field ที่แสดงเฉพาะ Channel = AP
const CHANNELS = ['Bank Statement', 'AP', 'Cash'];
const PAYMENT_TYPES = ['Cheque'] as const; // Phase 1: เฉพาะ Cheque · Phase 2: ['Cheque', 'Wire', 'EFT', 'CreditCard']
type PaymentType = (typeof PAYMENT_TYPES)[number];

// GL accounts per payment category (Dr side); Cash is the Cr side.
const CATEGORY_GL: Record<RepaymentCategory, { code: string; name: string }> = {
  Principal: { code: '2142101', name: 'เงินกู้ยืมระยะสั้นสถาบันการเงิน (Note Payable)' },
  Interest: { code: '5512103', name: 'ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น' },
  Fee: { code: '5512201', name: 'ค่าธรรมเนียมจ่าย' },
  Penalty: { code: '5511101', name: 'ค่าธรรมเนียมธนาคาร (Penalty/Late Fee)' },
};
const CASH_GL = { code: '100000', name: 'Cheque Account' };

// Credit (จ่ายเงินออก) account per channel —
// Bank Statement → Cr เงินฝากธนาคาร (ตัดผ่าน bank · direct debit)
// AP → Cr เจ้าหนี้ (ตั้งหนี้รอ NetSuite AP จ่าย ทุก payment_type)
// Cash → Cr เงินสด
const CHANNEL_GL: Record<string, { code: string; name: string }> = {
  'Bank Statement': { code: '100000', name: 'Cheque Account (Bank)' },
  AP: { code: '2110000', name: 'เจ้าหนี้การค้า (Accounts Payable)' },
  Cash: { code: '101000', name: 'เงินสด (Cash)' },
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

type PickedBankLine = {
  id: string;
  tx_date: string;
  description: string | null;
  credit: number;
  facility_id: string | null;
  facility_label: string | null;
};

/**
 * Inline picker for "From Bank" allocation mode — shows credit lines from any
 * Bank Statement that match the chosen facility_type and have no linked Repayment yet.
 * Accountant multi-selects → click "Add to Allocation" → rows pre-fill in the Allocation table.
 */
function FromBankPicker({
  facilityType,
  onPick,
}: {
  facilityType: string;
  onPick: (lines: PickedBankLine[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Map repayment FACILITY_TYPES (PN/HP/...) → bank_statement_lines.facility_type ('P/N'/'HP'/...)
  const ftMap: Record<string, string> = {
    PN: 'P/N', HP: 'HP', Lease: 'Lease', Loan: 'Loan', FP: 'FP', OD: 'OD',
    TR: 'TR', FXF: 'FXF', LG: 'LG', LC: 'LC', BG: 'LG',
  };
  const bankFt = ftMap[facilityType] ?? facilityType;

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['fromBank-candidates', bankFt],
    queryFn: async () => {
      // 1) Fetch bank lines for this facility type with credit > 0
      const { data: lines, error } = await supabase
        .from('bank_statement_lines')
        .select('id, tx_date, description, credit, facility_id, facility_type, source_period, sort_order, statement_id')
        .eq('facility_type', bankFt)
        .gt('credit', 0)
        .order('tx_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      // 2) Filter out lines already linked to a Repayment
      const lineIds = (lines ?? []).map((l: any) => l.id);
      if (lineIds.length === 0) return [];
      const { data: usedRows } = await supabase
        .from('repayments')
        .select('bank_statement_line_id')
        .in('bank_statement_line_id', lineIds);
      const used = new Set((usedRows ?? []).map((r: any) => r.bank_statement_line_id));
      const unlinked = (lines ?? []).filter((l: any) => !used.has(l.id));
      // 3) Resolve facility natural-key label for each
      const facIds = [...new Set(unlinked.map((l: any) => l.facility_id).filter(Boolean))];
      const labelByKey = new Map<string, string>();
      if (facIds.length) {
        const tableMap: Record<string, [string, string]> = {
          PN: ['promissory_notes', 'name'], LG: ['letter_guarantees', 'lg_no'],
          FP: ['floor_plans', 'fp_no'], OD: ['overdrafts', 'od_no'],
          TR: ['trust_receipts', 'tr_no'], FXF: ['fx_forwards', 'fxf_no'],
          Loan: ['loans', 'loan_no'], Lease: ['leases', 'lease_no'],
          HP: ['leases', 'lease_no'], LC: ['letter_of_credit', 'lc_no'],
        };
        const [table, col] = tableMap[facilityType] ?? ['', ''];
        if (table) {
          const { data: facs } = await supabase.from(table).select(`id, ${col}`).in('id', facIds);
          (facs ?? []).forEach((f: any) => labelByKey.set(f.id, String(f[col] ?? '')));
        }
      }
      return unlinked.map((l: any) => ({
        id: l.id,
        tx_date: l.tx_date,
        description: l.description,
        credit: Number(l.credit ?? 0),
        facility_id: l.facility_id,
        facility_label: l.facility_id ? labelByKey.get(l.facility_id) ?? '' : '',
        source_period: l.source_period,
      }));
    },
  });

  const toggle = (id: string) => {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const totalPicked = useMemo(
    () => candidates.filter((c: any) => picked.has(c.id)).reduce((s: number, c: any) => s + c.credit, 0),
    [candidates, picked],
  );

  return (
    <div className="mb-4 rounded border border-dashed border-line bg-soft p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted">
          📑 Bank Statement Lines (Credit · {facilityType}) ที่ยังไม่ผูก Repayment — เลือกได้หลายบรรทัด
        </p>
        <Button
          size="sm"
          variant="primary"
          disabled={picked.size === 0}
          onClick={() => onPick(candidates.filter((c: any) => picked.has(c.id)))}
        >
          <Plus className="w-3.5 h-3.5" /> Add to Allocation ({picked.size})
        </Button>
      </div>
      <div className="overflow-x-auto max-h-64 border border-line rounded bg-white">
        <table className="table-base text-xs m-0">
          <thead className="sticky top-0 bg-soft">
            <tr>
              <th className="w-8" />
              <th>Date</th>
              <th>Description</th>
              <th>Facility</th>
              <th>งวด</th>
              <th className="text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center text-muted py-3 italic">กำลังโหลด...</td></tr>
            )}
            {!isLoading && candidates.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted py-3 italic">
                  — ไม่พบ Bank Statement Lines ที่ยังไม่ผูก ({facilityType}) —
                </td>
              </tr>
            )}
            {candidates.map((c: any) => (
              <tr
                key={c.id}
                className={`hover:bg-soft cursor-pointer ${picked.has(c.id) ? 'bg-blue-50' : ''}`}
                onClick={() => toggle(c.id)}
              >
                <td><input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} /></td>
                <td>{c.tx_date}</td>
                <td className="italic">{c.description ?? <span className="text-muted">—</span>}</td>
                <td>{c.facility_label || <span className="text-muted">—</span>}</td>
                <td>{c.source_period ?? <span className="text-muted">—</span>}</td>
                <td className="text-right tabular-nums">{fmtMoney(c.credit)}</td>
              </tr>
            ))}
          </tbody>
          {picked.size > 0 && (
            <tfoot>
              <tr className="bg-soft font-semibold border-t border-line">
                <td colSpan={5} className="text-right">เลือก {picked.size} บรรทัด · รวม</td>
                <td className="text-right tabular-nums">{fmtMoney(totalPicked)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

type Header = {
  repayment_no: string;
  pay_date: string;
  facility_type: string;
  channel: string;
  payment_type: PaymentType | null;
  reference_no: string | null;
  remark: string | null;
  status: 'Draft' | 'Posted' | 'Reversed';
};

// AP Cheque tracking (shown when channel = 'Cheque' or 'AP Module') — per MoM §3.2
type ChequeInfo = {
  cheque_no: string;
  issued_date: string;
  cheque_status: 'Pending' | 'Approved' | 'Issued' | 'Cleared' | 'Cancelled';
};
const blankCheque: ChequeInfo = { cheque_no: '', issued_date: '', cheque_status: 'Pending' };

const blankHeader: Header = {
  repayment_no: '',
  pay_date: fmtDateISO(new Date()),
  facility_type: 'PN',
  channel: 'Bank Statement',
  payment_type: null,
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
  // Pre-fill from URL search params:
  //   ?facility_type=HP&facility_id=...&category=Penalty       — from facility/schedule
  //   ?bank_line_id=...&channel=...&pay_date=...&amount=...    — from Bank Statement (Source = Bank)
  //   ?memo=...                                                — from bank line description
  const [searchParams] = useSearchParams();
  const prefilledFacilityType = searchParams.get('facility_type') || 'PN';
  const prefilledFacilityId = searchParams.get('facility_id') || '';
  const prefilledCategory = searchParams.get('category') || '';
  const bankLineId = searchParams.get('bank_line_id') || '';
  const prefilledChannel = searchParams.get('channel') || '';
  const prefilledPayDate = searchParams.get('pay_date') || '';
  const prefilledAmount = parseFloat(searchParams.get('amount') || '0') || 0;
  const prefilledMemo = searchParams.get('memo') || '';
  const sourcePeriod = searchParams.get('source_period') || '';

  const [header, setHeader] = useState<Header>({
    ...blankHeader,
    facility_type: prefilledFacilityType,
    channel: prefilledChannel || blankHeader.channel,
    pay_date: prefilledPayDate || blankHeader.pay_date,
    remark: prefilledMemo
      ? `[Bank memo${sourcePeriod ? ` · งวด ${sourcePeriod}` : ''}] ${prefilledMemo}`
      : blankHeader.remark,
  });
  const [chequeInfo, setChequeInfo] = useState<ChequeInfo>(blankCheque);
  const [lines, setLines] = useState<Line[]>([
    prefilledFacilityId || prefilledCategory
      ? {
          ...newLine(),
          facility_id: prefilledFacilityId,
          category: (prefilledCategory as any) || 'Interest',
          amount: prefilledAmount,
        }
      : newLine(),
  ]);
  // CSV Import mode is fully hidden from UI — kept in the union type so handlers + 'import' branch
  // below remain valid for future re-enable (data migration / fallback). Default stays 'manual'.
  const [entryMode, setEntryMode] = useState<'manual' | 'fromBank' | 'import'>('manual');

  // Bank line being used as source (for back-link banner + idempotency)
  // — fetched only when `bank_line_id` query param is present OR when an existing
  // edited Repayment was originally created from a bank line.
  const [sourceBankLineId, setSourceBankLineId] = useState<string | null>(
    bankLineId || null,
  );
  const { data: sourceBankLine } = useQuery({
    queryKey: ['rp-source-bank-line', sourceBankLineId],
    enabled: !!sourceBankLineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_statement_lines')
        .select(
          'id, statement_id, tx_date, description, debit, credit, sort_order,'
          + ' bank_statements!inner(id, finance_institution, account_no, statement_period, statement_name)',
        )
        .eq('id', sourceBankLineId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });
  const sourceLabel = useMemo(() => {
    if (!sourceBankLine) return '';
    const stmt = sourceBankLine.bank_statements;
    return `${stmt.finance_institution} · ${stmt.account_no} · ${stmt.statement_period ?? ''} · line #${(sourceBankLine.sort_order ?? 0) + 1}`;
  }, [sourceBankLine]);

  // Auto-fill REFERENCE NO once bank line is loaded (only if user hasn't set it yet)
  useEffect(() => {
    if (sourceBankLine && !header.reference_no) {
      const stmt = sourceBankLine.bank_statements;
      const ref = `BS-${stmt.statement_period ?? ''}-${stmt.account_no}-L${(sourceBankLine.sort_order ?? 0) + 1}`;
      setHeader((h) => ({ ...h, reference_no: ref }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceBankLine]);

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
      const [h, l, cq] = await Promise.all([
        supabase.from('repayments').select('*').eq('id', id!).single(),
        supabase.from('repayment_lines').select('*').eq('repayment_id', id!).order('sort_order'),
        supabase.from('ap_cheque_requests').select('cheque_no, issued_date, status').eq('repayment_id', id!).maybeSingle(),
      ]);
      if (h.error) throw h.error;
      return {
        header: h.data as Repayment,
        lines: (l.data ?? []) as RepaymentLine[],
        cheque: cq.data as { cheque_no: string | null; issued_date: string | null; status: string } | null,
      };
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
        payment_type: (m as any).payment_type ?? null,
        reference_no: m.reference_no,
        remark: m.remark,
        status: m.status,
      });
      if (m.bank_statement_line_id) setSourceBankLineId(m.bank_statement_line_id);
      if (existing.cheque) {
        setChequeInfo({
          cheque_no: existing.cheque.cheque_no ?? '',
          issued_date: existing.cheque.issued_date ?? '',
          cheque_status: (existing.cheque.status as ChequeInfo['cheque_status']) ?? 'Pending',
        });
      }
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
    // Validation: must select at least one contract in Payment Allocation
    const firstFacilityId = lines.find((l) => l.facility_id)?.facility_id;
    if (!firstFacilityId) {
      throw new Error(`กรุณาเลือกสัญญา (${header.facility_type}) ในตาราง Payment Allocation อย่างน้อย 1 รายการก่อน Save`);
    }
    const headerRow = {
      repayment_no: repNo,
      facility_type: header.facility_type,
      facility_id: firstFacilityId,
      pay_date: header.pay_date,
      channel: header.channel,
      payment_type: header.channel === 'AP' ? header.payment_type : null,
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
      // Migration 0045 — preserve back-link to Bank Statement Line when created from Bank source
      bank_statement_line_id: sourceBankLineId || null,
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

    // Upsert AP cheque tracking when channel = AP (per MoM Interface §3.2 + §4 · Migration 0047)
    // 2-Level design: channel='AP' AND payment_type='Cheque' → auto-push to NetSuite AP Bill
    // Phase 2 future payment_types (Wire/EFT/CreditCard) will route to different NetSuite endpoints
    const needsCheque = header.channel === 'AP' && header.payment_type === 'Cheque';
    if (needsCheque && (chequeInfo.cheque_no || chequeInfo.issued_date || chequeInfo.cheque_status !== 'Pending')) {
      const { data: existing } = await supabase
        .from('ap_cheque_requests')
        .select('id, sync_status')
        .eq('repayment_id', rid!)
        .maybeSingle();
      const payload = {
        source_type: 'REPAYMENT',
        source_id: rid!,
        repayment_id: rid!,
        amount: round2(totals.total),
        currency: 'THB',
        memo: header.remark ?? `Repayment ${repNo}`,
        cheque_no: chequeInfo.cheque_no || null,
        issued_date: chequeInfo.issued_date || null,
        status: chequeInfo.cheque_status,
        gl_account: '2110000',  // All AP-channel payments use Accounts Payable GL
      };
      let chequeId: string | null = null;
      if (existing) {
        await supabase.from('ap_cheque_requests').update(payload).eq('id', existing.id);
        chequeId = existing.id;
      } else {
        const ins = await supabase.from('ap_cheque_requests').insert(payload).select('id').single();
        chequeId = ins.data?.id ?? null;
      }
      // Gap 1 (MoM Interface §4) — Auto-push to NetSuite AP when channel = AP
      // 2-Level: channel='AP' AND payment_type='Cheque' → ส่ง AP Bill ออกเช็ค
      // ถ้า sync แล้ว (existing.sync_status === 'synced') → skip ป้องกัน duplicate
      if (chequeId && header.channel === 'AP' && header.payment_type === 'Cheque' && existing?.sync_status !== 'synced') {
        try {
          const res = await pushCheckRequestToNetSuite(chequeId);
          toast.success(`✓ ส่ง NetSuite AP แล้ว · ID: ${res.netsuite_ap_id}`);
        } catch (e: any) {
          // ไม่ throw — Repayment save ยังสำเร็จ แค่ AP sync ล้มเหลว user retry ได้
          toast.error(`NetSuite AP sync ล้มเหลว: ${e.message}`, { duration: 8000 });
        }
      }
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
          // FP uses `used_amount` (= Σ chassis drawn) as actual outstanding principal;
          // PN/TR use `amount` (single fixed loan amount). Pick the right field per type.
          const selectCols = ft === 'FP' ? 'amount, used_amount, status' : 'amount, status';
          const { data: fac } = await supabase.from(table).select(selectCols).eq('id', fid).single();
          if (!fac) continue;
          const open = !['Repaid', 'Cancelled', 'Roll Over'].includes((fac as any).status);
          const principalTarget = ft === 'FP'
            ? Number((fac as any).used_amount ?? (fac as any).amount ?? 0)
            : Number((fac as any).amount ?? 0);
          if (open && principalTarget > 0 && cumPrincipal >= principalTarget - 0.01) {
            await supabase.from(table).update({ status: 'Repaid' }).eq('id', fid);
            repaidCount++;
          }
        }
      }
      return { jeNo: je.je_number, repaidCount, rid };
    },
    onSuccess: ({ jeNo, repaidCount, rid }) => {
      qc.invalidateQueries({ queryKey: ['rep-list'] });
      qc.invalidateQueries({ queryKey: ['rep', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      setHeader((h) => ({ ...h, status: 'Posted' }));
      toast.success(repaidCount > 0 ? `✓ Posted JE ${jeNo} · ${repaidCount} สัญญา → Repaid` : `✓ Posted JE ${jeNo}`);
      // If user clicked Create Journal directly from "new" route (skipping Save),
      // navigate to the edit URL so subsequent actions use UPDATE not INSERT.
      if (mode === 'new' && rid) navigate(`/tx/repayment/${rid}`, { replace: true });
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
        <Button
          variant="primary"
          disabled={save.isPending || header.status === 'Posted'}
          title={header.status === 'Posted' ? 'JE Posted แล้ว — แก้ไขไม่ได้ (Reverse JE ก่อนถ้าต้องการแก้)' : ''}
          onClick={() => save.mutate()}
        >
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={() => navigate('/tx/repayment')}>Cancel</Button>
      </div>

      {/* Source banner — when this Repayment was created from a Bank Statement Line */}
      {sourceBankLineId && (
        <Card className="mb-3 border-l-4" style={{ borderLeftColor: '#5E7A9B' }}>
          <CardContent className="!py-2.5">
            <div className="flex items-center gap-3 text-sm">
              <Landmark className="w-5 h-5 text-brand flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink">Source · Bank Statement</div>
                <div className="text-xs text-muted truncate">
                  {sourceLabel || 'กำลังโหลดข้อมูลต้นทาง...'}
                  {sourceBankLine?.description && (
                    <> · <span className="italic">"{sourceBankLine.description}"</span></>
                  )}
                </div>
              </div>
              {sourceBankLine && (
                <RouterLink
                  to={`/master/bank-statement/${sourceBankLine.statement_id}`}
                  className="inline-flex items-center gap-1 text-brand text-xs hover:underline flex-shrink-0"
                  title="ย้อนกลับไปดู Bank Statement Line ต้นทาง"
                >
                  ดูต้นทาง <ExternalLink className="w-3.5 h-3.5" />
                </RouterLink>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
            <Select
              value={header.channel}
              onChange={(e) => {
                const ch = e.target.value;
                // Auto-fill default payment_type when switching to AP · clear when leaving AP
                setHeader((h) => ({
                  ...h,
                  channel: ch,
                  payment_type: ch === 'AP' ? (h.payment_type ?? 'Cheque') : null,
                }));
              }}
              disabled={!!sourceBankLineId}
              title={sourceBankLineId ? 'Channel ถูก lock เป็น Bank Statement เพราะ Repayment นี้สร้างจาก Bank Statement Line' : ''}
              className={sourceBankLineId ? 'bg-gray-100 cursor-not-allowed' : ''}
            >
              {CHANNELS.map((c) => <option key={c}>{c}</option>)}
            </Select>
            <p className="text-[10px] text-muted mt-0.5 italic">
              {sourceBankLineId
                ? '🔒 Lock — มาจาก Bank Statement'
                : 'รับชำระ 3 ช่องทาง: Bank Statement / AP / Cash'}
            </p>
          </div>
          {/* Payment Type — แสดงเฉพาะ Channel = AP (2-Level per MoM §4 · Migration 0047) */}
          {header.channel === 'AP' && (
            <div>
              <FieldLabel required>PAYMENT TYPE</FieldLabel>
              <Select
                value={header.payment_type ?? 'Cheque'}
                onChange={(e) => setHeader((h) => ({ ...h, payment_type: e.target.value as PaymentType }))}
              >
                {PAYMENT_TYPES.map((p) => <option key={p}>{p}</option>)}
              </Select>
              <p className="text-[10px] text-muted mt-0.5 italic">
                Phase 1: เฉพาะ Cheque · Phase 2: เพิ่ม Wire / EFT / CreditCard
              </p>
            </div>
          )}
          <div className="md:col-span-2">
            <FieldLabel>REFERENCE NO</FieldLabel>
            <Input value={header.reference_no ?? ''} onChange={(e) => setHeader((h) => ({ ...h, reference_no: e.target.value || null }))} />
          </div>
          <div className="md:col-span-2">
            <FieldLabel>REMARK</FieldLabel>
            <Input value={header.remark ?? ''} onChange={(e) => setHeader((h) => ({ ...h, remark: e.target.value || null }))} />
          </div>
        </div>

        {/* AP Cheque tracking — show only when channel=AP + payment_type=Cheque (Migration 0047) */}
        {header.channel === 'AP' && header.payment_type === 'Cheque' && (
          <div className="mt-4 p-3 rounded bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-sm font-semibold text-amber-900">
                AP Cheque Tracking
                <span className="ml-2 text-[10px] font-normal text-amber-700">
                  (ส่ง NetSuite AP — ออกเช็คตามรอบ · MoM Interface §4)
                </span>
              </h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <FieldLabel>CHEQUE NO</FieldLabel>
                <Input
                  placeholder="0000123"
                  value={chequeInfo.cheque_no}
                  onChange={(e) => setChequeInfo((c) => ({ ...c, cheque_no: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel>ISSUED DATE</FieldLabel>
                <Input
                  type="date"
                  value={chequeInfo.issued_date}
                  onChange={(e) => setChequeInfo((c) => ({ ...c, issued_date: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel>AP STATUS</FieldLabel>
                <Select
                  value={chequeInfo.cheque_status}
                  onChange={(e) => setChequeInfo((c) => ({ ...c, cheque_status: e.target.value as ChequeInfo['cheque_status'] }))}
                >
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                  <option value="Issued">Issued</option>
                  <option value="Cleared">Cleared</option>
                  <option value="Cancelled">Cancelled</option>
                </Select>
              </div>
            </div>
            <p className="text-[10px] text-amber-700 italic mt-2">
              ข้อมูลจะถูก track ใน /tx/repayments → Tab "AP Cheques" สำหรับทีม Finance (รอ NetSuite AP Template เพื่อ auto-sync)
            </p>
          </div>
        )}
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
                onClick={() => setEntryMode('fromBank')}
                className={`px-3 py-1.5 border-l border-line ${entryMode === 'fromBank' ? 'bg-brand text-white' : 'bg-white text-muted hover:bg-soft'}`}
                title="เลือก Bank Statement Line ที่ยังไม่ผูก Repayment"
              >
                From Bank
              </button>
              {/* CSV Import — fully hidden from UI per product decision.
                  Underlying handlers (parseCSV / handleImportFile / downloadTemplate / TEMPLATE_HEADERS)
                  intentionally kept in code for future re-enable (data migration / fallback).
                  To re-enable: add a button here that calls setEntryMode('import'). */}
            </div>
            {entryMode === 'manual' && (
              <Button size="sm" onClick={() => setLines((ls) => [...ls, newLine()])}>
                <Plus className="w-4 h-4" /> Add Row
              </Button>
            )}
          </div>
        </div>

        {entryMode === 'fromBank' && (
          <FromBankPicker
            facilityType={header.facility_type}
            onPick={(picked) => {
              if (picked.length === 0) return;
              // Use first picked line as the master source link (one Repayment ↔ one bank line);
              // additional lines just contribute allocation rows.
              const master = picked[0];
              setSourceBankLineId(master.id);
              setHeader((h) => ({
                ...h,
                channel: 'Bank Statement',
                pay_date: master.tx_date || h.pay_date,
                remark: master.description
                  ? `[Bank memo] ${master.description}`
                  : h.remark,
              }));
              setLines(
                picked.map((p) => ({
                  key: crypto.randomUUID(),
                  facility_id: p.facility_id ?? '',
                  contract_label: p.facility_label ?? '',
                  category: 'Interest' as RepaymentCategory,
                  amount: p.credit ?? 0,
                })),
              );
              setEntryMode('manual');
              toast.success(`เลือก ${picked.length} บรรทัดจาก Bank Statement — แก้ Category ก่อน Save`);
            }}
          />
        )}

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
