import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Plus, Save, Trash2, FileText, Landmark } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge, FieldLabel, NumInput } from '@/components/ui';
import { fmtMoney, fmtDateISO} from '@/lib/format';
import { createJE, postJE } from '@/lib/je';
import {
  principalGLFor, accruedSourceTypeFor, ACCRUED_INTEREST_GL, INTEREST_EXPENSE_GL,
  VAT_INPUT_GL, WHT_PAYABLE_GL,
} from '@/lib/repayment-gl';
import { pushCheckRequestToNetSuite } from '@/lib/netsuite-stub';
import {
  type Repayment,
  type RepaymentLine,
} from '@/types/database';
import { useFacilityTypesMap, facilityTypeIdByCode } from '@/lib/facility-types';
import { useAuth } from '@/lib/auth';
import { useReadOnly, ReadOnlyContext } from '@/lib/readonly';
import { friendlySaveError } from '@/lib/save-error';
import { nextRunningNo } from '@/lib/running-no';
import { markPaid, type FacilityCode } from '@/lib/schedule-store';

import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── ประเภทของบรรทัดจัดสรร ────────────────────────────────────────────
// ทะเบียนกลางมีแค่ 4 ประเภท แต่ใบตัดชำระจริงต้องแยกภาษีมูลค่าเพิ่มกับ
// ภาษีหัก ณ ที่จ่ายออกมาด้วย เพราะหัวรายการมีช่องเก็บ 2 ยอดนี้อยู่แล้ว
// (เดิมยัดค่า 0 ตายตัว ทำให้กรอกภาษีไม่ได้เลย)
type LineCategory = 'Principal' | 'Interest' | 'Fee' | 'Penalty' | 'VAT' | 'WHT';
const LINE_CATEGORIES: LineCategory[] = ['Principal', 'Interest', 'Fee', 'Penalty', 'VAT', 'WHT'];
const CATEGORY_LABEL: Record<LineCategory, string> = {
  Principal: 'Principal — เงินต้น',
  Interest: 'Interest — ดอกเบี้ย',
  Fee: 'Fee — ค่าธรรมเนียม',
  Penalty: 'Penalty — เบี้ยปรับ',
  VAT: 'VAT — ภาษีมูลค่าเพิ่ม',
  WHT: 'WHT — ภาษีหัก ณ ที่จ่าย (หักออกจากยอดจ่าย)',
};

// ประเภทวงเงินที่เลือกได้ในใบตัดชำระ
//
// เดิมใช้รายการกลางซึ่งมีทั้ง LG และ BG ทั้งที่ระบบเก็บเป็นค่าเดียวกัน
// (BG ถูกแปลงเป็น LG ก่อนบันทึกเสมอ) เลือกอันไหนก็ได้ผลเหมือนกัน — สับสนเปล่าๆ
// และตกเลตเตอร์ออฟเครดิตไปทั้งที่มีโมดูลอยู่จริง
const RP_FACILITY_TYPES = ['PN', 'LG', 'LC', 'FP', 'OD', 'TR', 'FXF', 'Loan', 'Lease', 'HP'] as const;
const FACILITY_TYPE_LABEL: Record<string, string> = {
  PN: 'PN — ตั๋วสัญญาใช้เงิน',
  LG: 'LG / BG — หนังสือค้ำประกัน',
  LC: 'LC — เลตเตอร์ออฟเครดิต',
  FP: 'FP — สินเชื่อสต๊อกรถ',
  OD: 'OD — เบิกเกินบัญชี',
  TR: 'TR — ทรัสต์รีซีท',
  FXF: 'FXF — ซื้อขายเงินตราล่วงหน้า',
  Loan: 'Loan — เงินกู้ยืม',
  Lease: 'Lease — สัญญาเช่า',
  HP: 'HP — สัญญาเช่าซื้อ',
};

// 2-Level Channel + Payment Type (Migration 0047 · per MoM Interface §4)
// AP เป็น parent channel · payment_type เป็น sub-field ที่แสดงเฉพาะ Channel = AP
// MoM §5: ช่องทางชำระ 2 แบบ = Direct Debit (Bank Statement) + Cheque (AP)
// Cash ตัดออก · MoM ไม่ระบุเป็น channel
const CHANNELS = ['Bank Statement', 'AP'];
const PAYMENT_TYPES = ['Cheque'] as const; // Phase 1: เฉพาะ Cheque · Phase 2: ['Cheque', 'Wire', 'EFT', 'CreditCard']
type PaymentType = (typeof PAYMENT_TYPES)[number];

// บัญชีฝั่งเดบิตตอนตัดชำระ · ฝั่งเครดิตคือเงินสด/เจ้าหนี้ตามช่องทางที่เลือก
//
// เงินต้นและดอกเบี้ยไม่ได้อยู่ในตารางนี้ เพราะต้องเลือกตามชนิดสัญญาและตามว่า
// เคยตั้งดอกเบี้ยค้างจ่ายไว้หรือยัง — ดูที่ lib/repayment-gl.ts
const CATEGORY_GL: Record<'Fee' | 'Penalty', { code: string; name: string }> = {
  Fee: { code: '5512201', name: 'ค่าธรรมเนียมจ่าย' },
  Penalty: { code: '5511101', name: 'ค่าธรรมเนียมธนาคาร (Penalty/Late Fee)' },
};
// Credit (จ่ายเงินออก) account per channel —
// Bank Statement → Cr เงินฝากธนาคาร (ตัดผ่าน bank · direct debit)
// AP → Cr เจ้าหนี้ (ตั้งหนี้รอ NetSuite AP จ่าย ทุก payment_type)
const CHANNEL_GL: Record<string, { code: string; name: string }> = {
  'Bank Statement': { code: '100000', name: 'Cheque Account (Bank)' },
  AP: { code: '2110000', name: 'เจ้าหนี้การค้า (Accounts Payable)' },
};

type Line = {
  key: string;
  facility_id: string;
  contract_label: string;
  category: LineCategory;
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
  /** ยอดของด้านที่มีค่า — จ่ายออกใช้ด้านเงินออก รับเข้าใช้ด้านเงินเข้า */
  amount: number;
  side: 'เงินออก' | 'เงินเข้า';
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

  // Migration 0074: bank_statement_lines.facility_type is now FK → facility_types(id).
  // Look up UUID from the facility code before filtering.
  const { codeToId: bsCodeToId } = useFacilityTypesMap();
  const bankFtId = bsCodeToId(facilityType);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['fromBank-candidates', bankFtId],
    enabled: !!bankFtId,
    queryFn: async () => {
      // 1) ดึงบรรทัดใบแจ้งยอดของประเภทวงเงินนี้ — เอาทั้งเงินเข้าและเงินออก
      //
      // เดิมกรองเฉพาะเงินเข้า ทั้งที่การตัดชำระคือ "จ่ายเงินออก"
      // บรรทัดที่ควรใช้จริงจึงไม่ขึ้นให้เลือกเลยสักบรรทัด
      const { data: lines, error } = await supabase
        .from('bank_statement_lines')
        .select('id, tx_date, description, debit, credit, facility_id, facility_type_id, source_period, sort_order, statement_id')
        .eq('facility_type_id', bankFtId!)
        .order('tx_date', { ascending: false })
        .limit(200);
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
        // BG เป็นชื่อเรียกเก่าของหนังสือค้ำประกัน — ข้อมูลเก่าบางส่วนยังใช้คำนี้อยู่
        // ถ้าไม่ใส่ไว้ บรรทัดของหนังสือค้ำประกันจะขึ้นเป็นช่องว่างทุกบรรทัด
        // (ชื่อตารางเลตเตอร์ออฟเครดิตเดิมสะกดผิด — ที่ถูกคือ letters_of_credit)
        const tableMap: Record<string, [string, string]> = {
          PN: ['promissory_notes', 'name'], LG: ['letter_guarantees', 'lg_no'],
          BG: ['letter_guarantees', 'lg_no'],
          FP: ['floor_plans', 'fp_no'], OD: ['overdrafts', 'od_no'],
          TR: ['trust_receipts', 'tr_no'], FXF: ['fx_forwards', 'fxf_no'],
          Loan: ['loans', 'loan_no'], Lease: ['leases', 'lease_no'],
          HP: ['leases', 'lease_no'], LC: ['letters_of_credit', 'lc_no'],
        };
        const [table, col] = tableMap[facilityType] ?? ['', ''];
        if (table) {
          const { data: facs } = await supabase.from(table).select(`id, ${col}`).in('id', facIds);
          (facs ?? []).forEach((f: any) => labelByKey.set(f.id, String(f[col] ?? '')));
        }
      }
      return unlinked
        .map((l: any) => {
          const debit = Number(l.debit ?? 0);
          const credit = Number(l.credit ?? 0);
          // ใช้ยอดของด้านที่มีค่า — ปกติบรรทัดหนึ่งมีค่าด้านเดียว
          const isOut = debit > 0;
          return {
            id: l.id,
            tx_date: l.tx_date,
            description: l.description,
            amount: isOut ? debit : credit,
            side: (isOut ? 'เงินออก' : 'เงินเข้า') as PickedBankLine['side'],
            facility_id: l.facility_id,
            facility_label: l.facility_id ? labelByKey.get(l.facility_id) ?? '' : '',
            source_period: l.source_period,
          };
        })
        .filter((l) => l.amount > 0);
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
    () => candidates.filter((c: any) => picked.has(c.id)).reduce((s: number, c: any) => s + c.amount, 0),
    [candidates, picked],
  );

  return (
    <div className="mb-4 rounded border border-dashed border-line bg-soft p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted">
          📑 บรรทัดใบแจ้งยอดธนาคาร ({facilityType}) ที่ยังไม่ผูกใบตัดชำระ — เลือกได้หลายบรรทัด
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
              <th>ด้าน</th>
              <th className="text-right">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="text-center text-muted py-3 italic">กำลังโหลด...</td></tr>
            )}
            {!isLoading && candidates.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted py-3 italic">
                  — ไม่พบบรรทัดใบแจ้งยอดที่ยังไม่ผูก ({facilityType}) —
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
                <td className={c.side === 'เงินออก' ? 'text-danger' : 'text-emerald-700'}>{c.side}</td>
                <td className="text-right tabular-nums">{fmtMoney(c.amount)}</td>
              </tr>
            ))}
          </tbody>
          {picked.size > 0 && (
            <tfoot>
              <tr className="bg-soft font-semibold border-t border-line">
                <td colSpan={6} className="text-right">เลือก {picked.size} บรรทัด · รวม</td>
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
  BG: ['letter_guarantees', 'lg_no'],   // ชื่อเรียกเก่าของหนังสือค้ำประกัน — เผื่อข้อมูลเดิม
  LC: ['letters_of_credit', 'lc_no'],
  FP: ['floor_plans', 'fp_no'],
  OD: ['overdrafts', 'od_no'],
  TR: ['trust_receipts', 'tr_no'],
  FXF: ['fx_forwards', 'fxf_no'],
  Loan: ['loans', 'loan_no'],
  Lease: ['leases', 'lease_no'],
  HP: ['leases', 'lease_no'],
};

/**
 * คอลัมน์ยอดตามสัญญาของแต่ละโมดูล — ใช้เทียบว่าจ่ายครบแล้วหรือยัง
 * และใช้เตือนเมื่อยอดเงินต้นสะสมเกินยอดสัญญา
 *
 * `closedStatus` = สถานะที่ต้องเปลี่ยนเป็นเมื่อจ่ายครบ (แต่ละโมดูลใช้คำไม่เหมือนกัน)
 * `openStatuses` แบบตรงข้าม: สถานะที่ถือว่าจบแล้ว ห้ามเปลี่ยนซ้ำ
 *
 * เบิกเกินบัญชีไม่อยู่ในตารางนี้ เพราะเป็นวงเงินหมุนเวียน เบิกคืนได้หลายรอบ
 * ยอดจ่ายสะสมจึงเกินยอดที่เบิกครั้งล่าสุดได้เป็นเรื่องปกติ — เทียบแล้วจะปิดสัญญาผิด
 */
const PAYOFF_RULE: Record<string, {
  table: string;
  amountCols: string[];
  closedStatus: string;
  endedStatuses: string[];
}> = {
  PN:    { table: 'promissory_notes', amountCols: ['amount'], closedStatus: 'Repaid', endedStatuses: ['Repaid', 'Cancelled', 'Roll Over'] },
  TR:    { table: 'trust_receipts',   amountCols: ['amount'], closedStatus: 'Repaid', endedStatuses: ['Repaid', 'Cancelled', 'Roll Over'] },
  // สินเชื่อสต๊อกรถใช้ยอดที่เบิกจริงรายคันรวมกัน ไม่ใช่เพดานวงเงิน
  FP:    { table: 'floor_plans',      amountCols: ['used_amount', 'amount'], closedStatus: 'Repaid', endedStatuses: ['Repaid', 'Cancelled', 'Roll Over'] },
  // เงินกู้ยืมกับสัญญาเช่าไม่มีสถานะ "ชำระครบ" — ใช้ "ปิดสัญญา" แทน
  Loan:  { table: 'loans',            amountCols: ['principal', 'amount'], closedStatus: 'Closed', endedStatuses: ['Closed', 'Cancelled', 'Rejected', 'Modified'] },
  Lease: { table: 'leases',           amountCols: ['principal'], closedStatus: 'Closed', endedStatuses: ['Closed', 'Cancelled', 'Roll Over'] },
  HP:    { table: 'leases',           amountCols: ['principal'], closedStatus: 'Closed', endedStatuses: ['Closed', 'Cancelled', 'Roll Over'] },
};

/** ประเภทวงเงินในหน้านี้ → รหัสที่ตารางงวดกลางใช้ */
const SCHEDULE_CODE: Record<string, FacilityCode> = {
  PN: 'PN', FP: 'FP', TR: 'TR', OD: 'OD', LC: 'LC',
  Loan: 'LOAN', Lease: 'LEASE', HP: 'LEASE', LG: 'LG', BG: 'LG',
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
  const [entryMode, setEntryMode] = useState<'manual' | 'fromBank'>('manual');

  // สิทธิ์และโหมดดูอย่างเดียว — เดิมหน้านี้ไม่ตรวจอะไรเลย ใครเปิดหน้าได้ก็บันทึกและลงบัญชีได้
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = can('repayment', 'edit');
  /** ล็อกเมื่อยังลงบัญชีอยู่ — ถ้าใบสำคัญถูกกลับรายการแล้ว (Reversed) กลับมาแก้ได้ */
  const locked = header.status === 'Posted';

  // ผู้ใช้แตะข้อมูลแล้วหรือยัง — ใช้เตือนตอนออกจากหน้าโดยยังไม่บันทึก
  const [dirty, setDirty] = useState(false);
  const editHeader: typeof setHeader = (updater) => { setDirty(true); setHeader(updater); };
  const editLines: typeof setLines = (updater) => { setDirty(true); setLines(updater); };
  const editCheque: typeof setChequeInfo = (updater) => { setDirty(true); setChequeInfo(updater); };

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
      // 'Lease' ครอบทั้ง Leasing และ Leasing Other — ถ้ากรองแค่ 'other' ชนิดใหม่จะหายจากตัวเลือก
      if (header.facility_type === 'HP') query = query.eq('mode', 'hp');
      else if (header.facility_type === 'Lease') query = query.in('mode', ['lease', 'other']);
      const { data, error } = await query;
      if (error) return [];
      // สัญญาที่จบไปแล้วต้องไม่อยู่ในตัวเลือกตัดชำระ
      //
      // เดิมคัดออกแค่ที่ยกเลิกกับถูกปฏิเสธ — สัญญาที่ปิดแล้ว ชำระครบแล้ว
      // ต่อสัญญาไปฉบับใหม่แล้ว หรือหมดอายุแล้ว ยังเลือกมาตัดชำระได้อยู่
      const CLOSED_STATUSES = [
        'Cancelled', 'Rejected', 'Closed', 'Repaid', 'Roll Over',
        'Terminated', 'Expired', 'Settled', 'Converted',
      ];
      return (data ?? [])
        .filter((r: any) => !CLOSED_STATUSES.includes(r.status))
        .map((r: any) => {
          const code = String(r[labelCol] ?? r.id);
          return { id: r.id, code, label: `${code}${r.status ? ` · ${r.status}` : ''}` };
        });
    },
  });

  const { data: existing, error: loadError, isLoading: loadingExisting } = useQuery({
    queryKey: ['rep', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      // อ่านบรรทัดจัดสรร — ลองแบบดึงรหัสประเภทวงเงินมาด้วยก่อน
      // ถ้าฐานข้อมูลยังไม่มีคอลัมน์นั้น (ยังไม่ได้อัปเดตโครงสร้าง) ค่อยถอยไปอ่านแบบเดิม
      const readLines = async () => {
        const withFt = await supabase
          .from('repayment_lines').select('*, facility_types(code)')
          .eq('repayment_id', id!).order('sort_order');
        if (!withFt.error) return withFt;
        return supabase
          .from('repayment_lines').select('*')
          .eq('repayment_id', id!).order('sort_order');
      };
      const [h, l, cq] = await Promise.all([
        // Join facility_types to get the code back into the header for local logic.
        supabase.from('repayments').select('*, facility_types(code)').eq('id', id!).single(),
        readLines(),
        supabase.from('ap_cheque_requests').select('cheque_no, issued_date, status').eq('repayment_id', id!).maybeSingle(),
      ]);
      if (h.error) throw h.error;
      // เดิมโยนเฉพาะข้อผิดพลาดของหัวรายการ ถ้าอ่านบรรทัดพลาดจะเงียบแล้วโชว์เป็นตารางว่าง
      // พอกดบันทึกทับ บรรทัดเดิมจะถูกลบทิ้งทั้งหมด — ข้อมูลหายโดยไม่มีใครรู้
      if (l.error) throw l.error;

      // ใบสำคัญที่ผูกไว้ถูกกลับรายการหรือยัง — ถ้าใช่ ใบตัดชำระนี้ต้องไม่นับเป็นลงบัญชีแล้ว
      let jeReversed = false;
      const jeId = (h.data as any)?.je_id as string | null;
      if (jeId) {
        const { data: je } = await supabase
          .from('journal_entries').select('status').eq('id', jeId).maybeSingle();
        jeReversed = (je as any)?.status === 'Reversed';
      }
      return {
        header: h.data as Repayment,
        lines: (l.data ?? []) as RepaymentLine[],
        cheque: cq.data as { cheque_no: string | null; issued_date: string | null; status: string } | null,
        jeReversed,
      };
    },
  });

  /**
   * โหลดข้อมูลเดิมไม่สำเร็จ — ห้ามบันทึกทับ
   * เพราะการบันทึกจะลบบรรทัดเดิมทิ้งก่อนเขียนใหม่ ถ้าตอนนี้บรรทัดว่างอยู่ข้อมูลจะหายหมด
   */
  const loadFailed = mode === 'edit' && !!id && !loadingExisting && !existing;

  useEffect(() => {
    if (existing) {
      const m = existing.header;
      // รหัสประเภทวงเงินของหัวรายการ — ถ้าอ่านจากทะเบียนไม่ได้ ให้ถอยไปดูจากบรรทัดแรก
      // (บรรทัดเก่ายังเก็บเป็นข้อความอยู่) ไม่งั้นช่องประเภทวงเงินจะกลายเป็นว่าง
      const firstLine: any = existing.lines[0];
      const ftCode = ((m as any).facility_types?.code as string)
        || (firstLine?.facility_types?.code as string)
        || (firstLine?.facility_type as string)
        || 'PN';
      setHeader({
        repayment_no: m.repayment_no,
        pay_date: m.pay_date,
        facility_type: ftCode,
        channel: m.channel,
        payment_type: (m as any).payment_type ?? null,
        reference_no: m.reference_no,
        remark: m.remark,
        // ใบสำคัญถูกกลับรายการแล้ว = ใบตัดชำระใบนี้ไม่ได้ลงบัญชีอยู่อีกต่อไป
        // เดิมไม่มีโค้ดไหนเขียนสถานะนี้เลย ใบจึงค้างเป็น "ลงบัญชีแล้ว" และแก้ไม่ได้ตลอดไป
        status: existing.jeReversed ? 'Reversed' : m.status,
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
              category: r.category as LineCategory,
              amount: r.amount,
            }))
          : [newLine()],
      );
      setDirty(false);
    }
  }, [existing]);

  // ใบสำคัญถูกกลับรายการแล้ว แต่ตารางยังเก็บสถานะเดิมไว้ — ปรับให้ตรงกันครั้งเดียว
  useEffect(() => {
    if (existing?.jeReversed && existing.header.status !== 'Reversed' && id) {
      supabase.from('repayments').update({ status: 'Reversed' }).eq('id', id).then(() => {
        qc.invalidateQueries({ queryKey: ['rep-list'] });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.jeReversed]);

  // เตือนก่อนปิดแท็บ/รีเฟรช ถ้ายังมีข้อมูลที่แก้ไว้แล้วยังไม่บันทึก
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  /** ออกจากหน้านี้ — ถามก่อนถ้ายังมีข้อมูลที่ยังไม่บันทึก */
  const leavePage = () => {
    if (dirty && !window.confirm('ข้อมูลที่แก้ไว้ยังไม่ได้บันทึก — ออกจากหน้านี้เลยหรือไม่?')) return;
    navigate('/tx/repayment');
  };

  // ยอดรวมแยกตามประเภท
  //
  // ภาษีหัก ณ ที่จ่ายไม่รวมอยู่ใน "ยอดรวม" เพราะเป็นเงินที่หักไว้นำส่งสรรพากร
  // ไม่ได้จ่ายให้คู่สัญญา — เงินที่จ่ายออกจริง = ยอดรวม − ภาษีหัก ณ ที่จ่าย
  const totals = useMemo(() => {
    const t = { Principal: 0, Interest: 0, Fee: 0, Penalty: 0, VAT: 0, WHT: 0, total: 0 };
    for (const l of lines) {
      t[l.category] += l.amount;
      if (l.category !== 'WHT') t.total += l.amount;
    }
    return t;
  }, [lines]);

  /** เงินที่จ่ายออกจริง — หลังหักภาษี ณ ที่จ่ายแล้ว */
  const netPayout = round2(totals.total - totals.WHT);

  // สัญญาที่ถูกจัดสรรในใบนี้ — ใช้ทั้งตัวอย่างใบสำคัญและการเตือนยอดเกิน
  const allocatedFacilityIds = useMemo(
    () => [...new Set(lines.filter((l) => l.facility_id).map((l) => l.facility_id))],
    [lines],
  );

  /**
   * สัญญาเหล่านี้เคยตั้งดอกเบี้ยค้างจ่ายไว้หรือยัง
   * ต้องรู้ตั้งแต่ก่อนกดลงบัญชี เพื่อให้ตัวอย่างบนจอบอกบัญชีที่จะลงได้ตรงกับของจริง
   */
  const { data: hasAccruedPreview = false } = useQuery({
    queryKey: ['rp-has-accrued', header.facility_type, allocatedFacilityIds.join(',')],
    enabled: allocatedFacilityIds.length > 0,
    queryFn: async () => {
      const accruedType = accruedSourceTypeFor(header.facility_type);
      if (!accruedType) return false;
      const { data } = await supabase
        .from('journal_entries').select('id')
        .eq('source_type', accruedType)
        .in('source_id', allocatedFacilityIds)
        .eq('status', 'Posted')
        .eq('is_reversal', false)
        .limit(1);
      return !!data && data.length > 0;
    },
  });

  /**
   * เตือนเมื่อเงินต้นสะสมเกินยอดตามสัญญา
   * ไม่บล็อกการบันทึก เพราะบางกรณีมีการปรับยอดสัญญาภายหลัง — แค่ให้ผู้ใช้ทันเห็น
   */
  const { data: overPayWarnings = [] } = useQuery({
    queryKey: ['rp-overpay', header.facility_type, allocatedFacilityIds.join(','), round2(totals.Principal)],
    enabled: allocatedFacilityIds.length > 0 && totals.Principal > 0,
    queryFn: async () => {
      const rule = PAYOFF_RULE[header.facility_type];
      if (!rule) return [] as string[];
      const out: string[] = [];
      for (const fid of allocatedFacilityIds as string[]) {
        const { data: fac } = await supabase
          .from(rule.table).select(rule.amountCols.join(', ')).eq('id', fid).maybeSingle();
        if (!fac) continue;
        const target = rule.amountCols.map((c) => Number((fac as any)[c] ?? 0)).find((n) => n > 0) ?? 0;
        if (target <= 0) continue;
        // เงินต้นสะสมจากใบที่ลงบัญชีแล้ว ไม่รวมใบที่กำลังกรอกอยู่ (ถ้าใบนี้ยังไม่ลงบัญชี)
        const { data: prior } = await supabase
          .from('repayment_lines')
          .select('amount, repayment_id, repayments!inner(status)')
          .eq('facility_id', fid).eq('category', 'Principal');
        const posted = (prior ?? [])
          .filter((r: any) => r.repayments?.status === 'Posted' && r.repayment_id !== id)
          .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
        const thisDoc = lines
          .filter((l) => l.facility_id === fid && l.category === 'Principal')
          .reduce((s, l) => s + l.amount, 0);
        const label = lines.find((l) => l.facility_id === fid)?.contract_label || String(fid).slice(0, 8);
        if (round2(posted + thisDoc) > target + 0.01) {
          out.push(`${label}: เงินต้นสะสม ${fmtMoney(round2(posted + thisDoc))} เกินยอดตามสัญญา ${fmtMoney(target)}`);
        }
      }
      return out;
    },
  });

  const updateLine = (key: string, patch: Partial<Line>) =>
    editLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const persist = async (): Promise<string> => {
    if (!canEdit) throw new Error('ไม่มีสิทธิ์แก้ไขใบตัดชำระ');
    if (viewOnly) throw new Error('กำลังเปิดในโหมดดูอย่างเดียว — บันทึกไม่ได้');
    // โหลดข้อมูลเดิมไม่สำเร็จ ห้ามบันทึกทับ ไม่งั้นบรรทัดเดิมถูกลบทิ้งทั้งหมด
    if (loadFailed) {
      throw new Error('ยังโหลดข้อมูลใบเดิมไม่สำเร็จ — บันทึกตอนนี้บรรทัดเดิมจะหาย กรุณารีเฟรชหน้าจอก่อน');
    }
    // เลขที่รายการ — ใช้ตัวนับกลางเหมือนโมดูลอื่น
    // เดิมสร้างจากเวลาปัจจุบัน ถ้าบันทึก 2 ใบในวินาทีเดียวกันจะได้เลขซ้ำ
    const repNo = header.repayment_no.trim() || await nextRunningNo('RP');
    // Validation: must select at least one contract in Payment Allocation
    const firstFacilityId = lines.find((l) => l.facility_id)?.facility_id;
    if (!firstFacilityId) {
      throw new Error(`กรุณาเลือกสัญญา (${header.facility_type}) ในตารางจัดสรรการชำระอย่างน้อย 1 รายการก่อนบันทึก`);
    }
    // Migration 0076: convert facility_type code → FK id at DB boundary.
    const facility_type_id = await facilityTypeIdByCode(header.facility_type);
    if (!facility_type_id) throw new Error(`ไม่พบประเภทวงเงิน "${header.facility_type}" ในทะเบียนประเภทวงเงิน`);

    // บรรทัดใบแจ้งยอดหนึ่งบรรทัดต้องผูกกับใบตัดชำระได้ใบเดียว
    // ฐานข้อมูลกันไว้แล้ว แต่ต้องขึ้นเป็นข้อความที่ผู้ใช้อ่านรู้เรื่องแทนข้อความของฐานข้อมูล
    if (sourceBankLineId) {
      const { data: dup } = await supabase
        .from('repayments')
        .select('id, repayment_no')
        .eq('bank_statement_line_id', sourceBankLineId)
        .limit(2);
      const clash = (dup ?? []).find((r: any) => r.id !== id);
      if (clash) {
        throw new Error(
          `บรรทัดใบแจ้งยอดนี้ถูกใช้สร้างใบตัดชำระ ${(clash as any).repayment_no} ไปแล้ว — หนึ่งบรรทัดใช้ได้ครั้งเดียว`,
        );
      }
    }

    const headerRow = {
      repayment_no: repNo,
      facility_type_id,
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
      vat: round2(totals.VAT),
      wht: round2(totals.WHT),
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
        // เขียนทั้งช่องรหัสและช่องข้อความ เพื่อให้ใช้ได้ทั้งฐานข้อมูลที่อัปเดตโครงสร้างแล้วและยังไม่อัปเดต
        facility_type_id,
        facility_type: header.facility_type,
        facility_id: l.facility_id || null,
        contract_label: l.contract_label || null,
        category: l.category,
        amount: round2(l.amount),
        sort_order: i,
      }));
    if (rows.length) {
      const { error } = await supabase.from('repayment_lines').insert(rows);
      if (error) {
        // ฐานข้อมูลที่ยังไม่ได้เพิ่มช่องรหัสประเภทวงเงิน — ถอยไปเขียนเฉพาะช่องข้อความเดิม
        const missingCol = /facility_type_id/i.test(String(error.message ?? ''));
        if (!missingCol) throw error;
        const legacyRows = rows.map(({ facility_type_id: _ignored, ...rest }) => rest);
        const retry = await supabase.from('repayment_lines').insert(legacyRows);
        if (retry.error) throw retry.error;
      }
    }

    // Upsert AP cheque tracking when channel = AP (per MoM Interface §3.2 + §4 · Migration 0047)
    // 2-Level design: channel='AP' AND payment_type='Cheque' → auto-push to NetSuite AP Bill
    // Phase 2 future payment_types (Wire/EFT/CreditCard) will route to different NetSuite endpoints
    const needsCheque = header.channel === 'AP' && header.payment_type === 'Cheque';
    const chequeTouched = !!(chequeInfo.cheque_no || chequeInfo.issued_date || chequeInfo.cheque_status !== 'Pending');
    // เดิมถ้าเลือกจ่ายด้วยเช็คแล้วไม่กรอกอะไรเลย ระบบข้ามการสร้างรายการเช็คแบบเงียบๆ
    // ผู้ใช้เข้าใจว่าบันทึกครบแล้ว แต่ทีมการเงินไม่เห็นรายการเช็คใบนี้เลย
    if (needsCheque && !chequeTouched) {
      toast.warning('ยังไม่ได้กรอกข้อมูลเช็ค — ระบบยังไม่สร้างรายการเช็คให้ กรอกเลขที่เช็คหรือวันที่ออกเช็คแล้วบันทึกอีกครั้ง', { duration: 8000 });
    }
    if (needsCheque && chequeTouched) {
      const { data: existing } = await supabase
        .from('ap_cheque_requests')
        .select('id, sync_status')
        .eq('repayment_id', rid!)
        .maybeSingle();
      const payload = {
        source_type: 'REPAYMENT',
        source_id: rid!,
        repayment_id: rid!,
        // ยอดหน้าเช็ค = เงินที่จ่ายออกจริง (หักภาษี ณ ที่จ่ายแล้ว)
        amount: netPayout,
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
          // ยังต่อระบบบัญชีปลายทางไม่ได้จริง — ตัวส่งเป็นตัวจำลอง
          // เดิมขึ้นว่า "ส่งแล้ว" ผู้ใช้จึงเข้าใจว่าเอกสารไปถึงระบบบัญชีแล้ว
          toast.success(`บันทึกคำขอจ่ายเช็คแล้ว (ตัวจำลอง · ยังไม่ได้ส่งออกจริง) · เลขอ้างอิง: ${res.netsuite_ap_id}`);
        } catch (e: any) {
          // ไม่ throw — การบันทึกใบตัดชำระยังสำเร็จ แค่ส่งคำขอจ่ายไม่ผ่าน ลองใหม่ได้
          toast.error(`ส่งคำขอจ่าย (ตัวจำลอง) ไม่สำเร็จ: ${friendlySaveError(e)}`, { duration: 8000 });
        }
      }
    }

    setHeader((h) => ({ ...h, repayment_no: repNo }));
    setDirty(false);
    return rid!;
  };

  // กันกดบันทึกรัวจนได้ใบซ้ำ — react-query ตั้งสถานะกำลังทำงานหลังเริ่มไปแล้ว 1 รอบวาดจอ
  // ระหว่างนั้นกดซ้ำได้อีกครั้งและได้ใบใหม่จริง จึงต้องล็อกด้วยตัวแปรตรงๆ
  const busyRef = useRef(false);
  const runOnce = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (busyRef.current) throw new Error('กำลังบันทึกอยู่ — รอสักครู่');
    busyRef.current = true;
    try {
      return await fn();
    } finally {
      busyRef.current = false;
    }
  };

  const save = useMutation({
    mutationFn: () => runOnce(persist),
    onSuccess: (rid) => {
      logSave('repayments', rid ?? id, header.repayment_no, mode === 'new');
      qc.invalidateQueries({ queryKey: ['rep-list'] });
      qc.invalidateQueries({ queryKey: ['rep', rid] });
      toast.success('บันทึกใบตัดชำระแล้ว');
      if (mode === 'new') navigate(`/tx/repayment/${rid}`);
    },
    onError: (e: any) => toast.error(friendlySaveError(e)),
  });

  /**
   * บรรทัดใบสำคัญที่จะลงจริง — ใช้ทั้งตอนลงบัญชีและตอนแสดงตัวอย่างบนหน้าจอ
   * แยกออกมาเพื่อให้ตัวอย่างบนจอตรงกับที่ลงจริงเสมอ (เดิมเขียนข้อความคนละชุด)
   */
  const buildJELines = (hasAccrued: boolean) => {
    const out: { account_code: string; account_name: string; dr?: number; cr?: number; description: string }[] = [];

    // เงินต้น — ล้างบัญชีหนี้สินตัวเดียวกับที่ตั้งไว้ตอนเบิกของสัญญาชนิดนั้น
    if (round2(totals.Principal) > 0.005) {
      const gl = principalGLFor(header.facility_type);
      out.push({ account_code: gl.code, account_name: gl.name, dr: round2(totals.Principal), description: 'จ่ายคืนเงินต้น' });
    }
    if (round2(totals.Interest) > 0.005) {
      const gl = hasAccrued ? ACCRUED_INTEREST_GL : INTEREST_EXPENSE_GL;
      out.push({
        account_code: gl.code, account_name: gl.name, dr: round2(totals.Interest),
        description: hasAccrued ? 'ล้างดอกเบี้ยค้างจ่าย' : 'ดอกเบี้ยจ่าย',
      });
    }
    for (const c of ['Fee', 'Penalty'] as const) {
      if (round2(totals[c]) > 0.005) {
        out.push({
          account_code: CATEGORY_GL[c].code, account_name: CATEGORY_GL[c].name,
          dr: round2(totals[c]), description: c === 'Fee' ? 'ค่าธรรมเนียม' : 'เบี้ยปรับ',
        });
      }
    }
    // ภาษีมูลค่าเพิ่มที่จ่ายไป — ตั้งเป็นภาษีซื้อรอขอคืน
    if (round2(totals.VAT) > 0.005) {
      out.push({
        account_code: VAT_INPUT_GL.code, account_name: VAT_INPUT_GL.name,
        dr: round2(totals.VAT), description: 'ภาษีซื้อ',
      });
    }
    // ภาษีหัก ณ ที่จ่าย — หักไว้จากยอดจ่าย ตั้งเป็นหนี้สินรอนำส่งสรรพากร
    if (round2(totals.WHT) > 0.005) {
      out.push({
        account_code: WHT_PAYABLE_GL.code, account_name: WHT_PAYABLE_GL.name,
        cr: round2(totals.WHT), description: 'ภาษีหัก ณ ที่จ่ายรอนำส่ง',
      });
    }
    const creditGL = CHANNEL_GL[header.channel] ?? CHANNEL_GL['Bank Statement'];
    out.push({
      account_code: creditGL.code, account_name: creditGL.name,
      cr: netPayout, description: `จ่ายชำระ (${header.channel})`,
    });
    return out;
  };

  /** เงินต้นสะสมของสัญญาหนึ่งฉบับ จากใบตัดชำระที่ลงบัญชีแล้วทุกใบ */
  const cumulativePrincipalFor = async (facilityId: string): Promise<number> => {
    const { data } = await supabase
      .from('repayment_lines')
      .select('amount, category, repayments!inner(status)')
      .eq('facility_id', facilityId)
      .eq('category', 'Principal');
    return (data ?? [])
      .filter((r: any) => r.repayments?.status === 'Posted')
      .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  };

  /**
   * ทำเครื่องหมายงวดที่ชำระแล้วในตารางงวดกลาง
   * ไล่จากงวดเก่าสุด ปิดไปเรื่อยๆ เท่าที่เงินต้นสะสมครอบคลุมถึง
   * ถ้างวดไหนไม่มียอดเงินต้น (เช่น งวดดอกเบี้ยล้วน) ให้ข้ามไปโดยไม่กินยอด
   */
  const markSchedulePaid = async (code: FacilityCode, facilityId: string, repaymentId: string): Promise<number> => {
    const cum = await cumulativePrincipalFor(facilityId);
    if (cum <= 0.005) return 0;
    const { data: rows } = await supabase
      .from('installment_schedules')
      .select('period, principal, paid')
      .eq('facility_id', facilityId)
      .order('period');
    // สินเชื่อสต๊อกรถเก็บตารางงวดแยกรายคัน — งวดเดียวกันมีหลายแถว
    // ต้องรวมยอดต่องวดก่อน ไม่งั้นจะนับงวดซ้ำและตัดยอดเกินจริง
    const byPeriod = new Map<number, { principal: number; allPaid: boolean }>();
    for (const r of (rows ?? []) as any[]) {
      const cur = byPeriod.get(r.period) ?? { principal: 0, allPaid: true };
      cur.principal = round2(cur.principal + Number(r.principal ?? 0));
      cur.allPaid = cur.allPaid && !!r.paid;
      byPeriod.set(r.period, cur);
    }
    let left = cum;
    let n = 0;
    for (const period of [...byPeriod.keys()].sort((a, b) => a - b)) {
      const { principal: need, allPaid } = byPeriod.get(period)!;
      if (need > 0.005 && left < need - 0.01) break;   // ยอดไม่พอปิดงวดนี้แล้ว
      left = round2(left - need);
      if (!allPaid) {
        await markPaid(code, facilityId, period, header.pay_date, need, repaymentId);
        n++;
      }
    }
    return n;
  };

  const createJournal = useMutation({
    mutationFn: () => runOnce(async () => {
      if (!canEdit) throw new Error('ไม่มีสิทธิ์ลงบัญชีใบตัดชำระ');
      if (totals.total <= 0) throw new Error('กรอกยอดที่ตัดชำระก่อน — ยอดรวมต้องมากกว่า 0');
      if (netPayout < 0) throw new Error('ภาษีหัก ณ ที่จ่ายมากกว่ายอดที่ต้องจ่าย — ตรวจยอดในตารางจัดสรรอีกครั้ง');
      const rid = await persist();
      // ใบสำคัญหนึ่งใบต่อหนึ่งใบตัดชำระ — ใบที่กลับรายการแล้วไม่นับ ลงใหม่ได้
      const { data: ex } = await supabase
        .from('journal_entries').select('je_number')
        .eq('source_type', 'REPAYMENT').eq('source_id', rid).eq('status', 'Posted');
      if (ex && ex.length > 0) throw new Error(`ใบตัดชำระนี้ลงบัญชีไปแล้ว: ${ex[0].je_number}`);

      // ดอกเบี้ย — ถ้าสัญญาเคยตั้งดอกเบี้ยค้างจ่ายไว้ ต้องล้างยอดค้างจ่าย
      // ถ้ายังไม่เคยตั้ง จ่ายแล้วรับรู้เป็นค่าใช้จ่ายทันที
      // (ถ้าลงค่าใช้จ่ายทุกครั้ง จะกลายเป็นบันทึกค่าใช้จ่ายซ้ำ 2 รอบ และยอดค้างจ่ายไม่เคยถูกล้าง)
      const accruedType = accruedSourceTypeFor(header.facility_type);
      const interestFacIds = [...new Set(lines
        .filter((l) => l.category === 'Interest' && l.amount > 0 && l.facility_id)
        .map((l) => l.facility_id as string))];
      let hasAccrued = false;
      if (accruedType && interestFacIds.length > 0) {
        const { data: accJEs } = await supabase
          .from('journal_entries').select('id')
          .eq('source_type', accruedType)
          .in('source_id', interestFacIds)
          .eq('status', 'Posted')
          .eq('is_reversal', false)
          .limit(1);
        hasAccrued = !!accJEs && accJEs.length > 0;
      }

      const jeLines = buildJELines(hasAccrued);

      const je = await createJE({
        source_type: 'REPAYMENT',
        source_id: rid,
        je_date: header.pay_date,
        description: `ตัดชำระ ${header.repayment_no || ''} — ${header.facility_type}`,
        remark: `ช่องทาง: ${header.channel}`,
        lines: jeLines,
      });
      await postJE(je.id, 'user');
      await supabase.from('repayments').update({ status: 'Posted', je_id: je.id }).eq('id', rid);

      // ── สถานะสัญญาต้นทาง — ปิดให้เองเมื่อจ่ายเงินต้นครบ ──────────────
      //
      // เทียบ "เงินต้นสะสมจากใบตัดชำระที่ลงบัญชีแล้วทุกใบ" กับยอดตามสัญญา
      // บรรทัดของรอบนี้ถูกบันทึกและเปลี่ยนเป็นลงบัญชีแล้วก่อนหน้านี้ จึงถูกนับรวมด้วย
      // เปลี่ยนเฉพาะตอนจ่ายครบเท่านั้น จ่ายบางส่วนจะไม่ถูกปิด
      //
      // เดิมทำแค่ 3 โมดูล — เงินกู้ยืมกับสัญญาเช่า/เช่าซื้อจ่ายครบแล้วสถานะยังค้างเป็นใช้งานอยู่
      let repaidCount = 0;
      const ft = header.facility_type;
      const rule = PAYOFF_RULE[ft];
      const fids = [...new Set(lines.map((l) => l.facility_id).filter(Boolean))] as string[];
      if (rule) {
        for (const fid of fids) {
          const cumPrincipal = await cumulativePrincipalFor(fid);
          const { data: fac } = await supabase
            .from(rule.table).select([...rule.amountCols, 'status'].join(', '))
            .eq('id', fid).single();
          if (!fac) continue;
          const open = !rule.endedStatuses.includes((fac as any).status);
          const principalTarget = rule.amountCols
            .map((c) => Number((fac as any)[c] ?? 0))
            .find((n) => n > 0) ?? 0;
          if (open && principalTarget > 0 && cumPrincipal >= principalTarget - 0.01) {
            await supabase.from(rule.table).update({ status: rule.closedStatus }).eq('id', fid);
            repaidCount++;
          }
        }
      }

      // ── ตารางงวด — ทำเครื่องหมายว่างวดไหนชำระแล้ว ────────────────────
      //
      // เดิมตัดชำระเสร็จแล้วตารางงวดยังขึ้นว่าค้างชำระทุกงวด
      // จับคู่งวดจาก "เงินต้นสะสมของสัญญานั้น" ไล่จากงวดเก่าสุดไปใหม่สุด
      // งวดไหนที่เงินต้นสะสมครอบคลุมถึง ถือว่าชำระแล้ว
      let paidPeriods = 0;
      const schedCode = SCHEDULE_CODE[ft];
      if (schedCode) {
        for (const fid of fids) {
          try {
            paidPeriods += await markSchedulePaid(schedCode, fid, rid);
          } catch (e) {
            // ไม่ให้ล้มทั้งรายการ — ใบสำคัญลงไปแล้ว ตารางงวดค่อยซ่อมทีหลังได้
            console.warn('[ตัดชำระ] ทำเครื่องหมายงวดที่ชำระแล้วไม่สำเร็จ:', e);
          }
        }
      }
      return { jeNo: je.je_number, repaidCount, paidPeriods, rid };
    }),
    onSuccess: ({ jeNo, repaidCount, paidPeriods, rid }) => {
      qc.invalidateQueries({ queryKey: ['rep-list'] });
      qc.invalidateQueries({ queryKey: ['rep', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      setHeader((h) => ({ ...h, status: 'Posted' }));
      const extra = [
        repaidCount > 0 ? `ปิดสัญญาให้ ${repaidCount} ฉบับ` : '',
        paidPeriods > 0 ? `ทำเครื่องหมายชำระแล้ว ${paidPeriods} งวด` : '',
      ].filter(Boolean).join(' · ');
      toast.success(`ลงบัญชีแล้ว ${jeNo}${extra ? ` · ${extra}` : ''}`);
      // If user clicked Create Journal directly from "new" route (skipping Save),
      // navigate to the edit URL so subsequent actions use UPDATE not INSERT.
      if (mode === 'new' && rid) navigate(`/tx/repayment/${rid}`, { replace: true });
    },
    onError: (e: any) => toast.error(friendlySaveError(e)),
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
          disabled={save.isPending || locked || !canEdit || viewOnly || loadFailed}
          title={
            !canEdit ? 'ไม่มีสิทธิ์แก้ไขใบตัดชำระ'
              : viewOnly ? 'กำลังเปิดในโหมดดูอย่างเดียว'
                : loadFailed ? 'ยังโหลดข้อมูลเดิมไม่สำเร็จ — รีเฟรชหน้าจอก่อน'
                  : locked ? 'ลงบัญชีแล้ว — ต้องกลับรายการใบสำคัญก่อนจึงจะแก้ได้'
                    : ''
          }
          onClick={() => { if (checkRequiredFields()) save.mutate(); }}
        >
          <Save className="w-4 h-4" /> {save.isPending ? 'กำลังบันทึก...' : 'Save'}
        </Button>
        <Button onClick={leavePage}>Cancel</Button>
      </div>

      {/* โหลดข้อมูลเดิมไม่สำเร็จ — บอกให้ชัดว่าห้ามบันทึกทับ ไม่งั้นบรรทัดเดิมหาย */}
      {loadFailed && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          โหลดข้อมูลใบตัดชำระนี้ไม่สำเร็จ — ปุ่มบันทึกถูกปิดไว้เพื่อกันข้อมูลเดิมหาย
          {loadError ? <span className="block text-xs mt-1 italic">{friendlySaveError(loadError)}</span> : null}
        </div>
      )}

      {/* ใบสำคัญถูกกลับรายการแล้ว — แก้และลงบัญชีใหม่ได้ */}
      {header.status === 'Reversed' && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ใบสำคัญที่ผูกกับใบตัดชำระนี้ถูกกลับรายการแล้ว — แก้ไขและลงบัญชีใหม่ได้
        </div>
      )}

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

      {/* ล็อกช่องกรอกทั้งหน้าเมื่อเป็นโหมดดูอย่างเดียว ไม่มีสิทธิ์แก้ หรือลงบัญชีไปแล้ว */}
      <ReadOnlyContext.Provider value={viewOnly || !canEdit || locked}>

      {/* Primary Information */}
      <Card className="mb-4"><CardContent>
        <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <FieldLabel>REPAYMENT NO</FieldLabel>
            <Input
              value={header.repayment_no}
              readOnly
              placeholder="ระบบออกเลขให้ตอนบันทึก"
              className="bg-gray-50"
              title="เลขที่ใบตัดชำระ สร้างอัตโนมัติตอนกดบันทึก"
            />
          </div>
          <div>
            <FieldLabel required>PAYMENT DATE</FieldLabel>
            <Input type="date" value={header.pay_date} onChange={(e) => editHeader((h) => ({ ...h, pay_date: e.target.value }))} />
          </div>
          <div>
            <FieldLabel required>FACILITY TYPE</FieldLabel>
            <Select value={header.facility_type} onChange={(e) => editHeader((h) => ({ ...h, facility_type: e.target.value }))}>
              {/* ถ้าใบเก่าเก็บชื่อเรียกที่ไม่มีในรายการแล้ว ต้องยังแสดงค่าเดิมได้ ไม่งั้นช่องจะว่าง */}
              {!RP_FACILITY_TYPES.includes(header.facility_type as any) && header.facility_type && (
                <option value={header.facility_type}>{header.facility_type}</option>
              )}
              {RP_FACILITY_TYPES.map((t) => (
                <option key={t} value={t}>{FACILITY_TYPE_LABEL[t] ?? t}</option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>CHANNEL</FieldLabel>
            <Select
              value={header.channel}
              onChange={(e) => {
                const ch = e.target.value;
                // Auto-fill default payment_type when switching to AP · clear when leaving AP
                editHeader((h) => ({
                  ...h,
                  channel: ch,
                  payment_type: ch === 'AP' ? (h.payment_type ?? 'Cheque') : null,
                }));
              }}
              disabled={!!sourceBankLineId}
              title={sourceBankLineId ? 'ช่องทางถูกล็อกเป็นใบแจ้งยอดธนาคาร เพราะใบนี้สร้างจากบรรทัดใบแจ้งยอด' : ''}
              className={sourceBankLineId ? 'bg-gray-100 cursor-not-allowed' : ''}
            >
              {CHANNELS.map((c) => <option key={c}>{c}</option>)}
            </Select>
            <p className="text-[10px] text-muted mt-0.5 italic">
              {sourceBankLineId
                ? '🔒 ล็อก — มาจากใบแจ้งยอดธนาคาร'
                : 'จ่ายชำระ 2 ช่องทาง: ตัดผ่านบัญชีธนาคาร / ตั้งเบิกจ่ายด้วยเช็ค'}
            </p>
          </div>
          {/* วิธีจ่าย — แสดงเฉพาะช่องทางตั้งเบิกจ่าย */}
          {header.channel === 'AP' && (
            <div>
              <FieldLabel required>PAYMENT TYPE</FieldLabel>
              <Select
                value={header.payment_type ?? 'Cheque'}
                onChange={(e) => editHeader((h) => ({ ...h, payment_type: e.target.value as PaymentType }))}
              >
                {PAYMENT_TYPES.map((p) => <option key={p}>{p}</option>)}
              </Select>
              <p className="text-[10px] text-muted mt-0.5 italic">
                ปัจจุบันรองรับเฉพาะเช็ค · จะเพิ่มวิธีอื่นในอนาคต
              </p>
            </div>
          )}
          <div className="md:col-span-2">
            <FieldLabel>REFERENCE NO</FieldLabel>
            <Input value={header.reference_no ?? ''} onChange={(e) => editHeader((h) => ({ ...h, reference_no: e.target.value || null }))} />
          </div>
          <div className="md:col-span-2">
            <FieldLabel>REMARK</FieldLabel>
            <Input value={header.remark ?? ''} onChange={(e) => editHeader((h) => ({ ...h, remark: e.target.value || null }))} />
          </div>
        </div>

        {/* ติดตามเช็คจ่าย — แสดงเฉพาะช่องทางตั้งเบิกจ่ายด้วยเช็ค */}
        {header.channel === 'AP' && header.payment_type === 'Cheque' && (
          <div className="mt-4 p-3 rounded bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-sm font-semibold text-amber-900">
                ติดตามเช็คจ่าย
                <span className="ml-2 text-[10px] font-normal text-amber-700">
                  (ส่งให้ระบบบัญชีปลายทางออกเช็คตามรอบ — ตอนนี้ยังเป็นตัวจำลอง)
                </span>
              </h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <FieldLabel>CHEQUE NO</FieldLabel>
                <Input
                  placeholder="0000123"
                  value={chequeInfo.cheque_no}
                  onChange={(e) => editCheque((c) => ({ ...c, cheque_no: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel>ISSUED DATE</FieldLabel>
                <Input
                  type="date"
                  value={chequeInfo.issued_date}
                  onChange={(e) => editCheque((c) => ({ ...c, issued_date: e.target.value }))}
                />
                {/* เตือนถ้าออกเช็คกระชั้นกว่ารอบจ่ายปกติ */}
                {(() => {
                  if (!chequeInfo.issued_date || !header.pay_date) return null;
                  const issued = new Date(chequeInfo.issued_date);
                  const pay = new Date(header.pay_date);
                  const daysBetween = Math.floor((pay.getTime() - issued.getTime()) / 86_400_000);
                  if (daysBetween < 14) {
                    return (
                      <p className="text-[10px] text-amber-700 mt-0.5 italic">
                        ⚠ ปกติเช็คควรออกก่อนวันจ่ายอย่างน้อย <strong>14 วัน</strong> · ตอนนี้เหลือ {daysBetween} วัน · อาจไม่ทันรอบจ่าย
                      </p>
                    );
                  }
                  return (
                    <p className="text-[10px] text-green-700 mt-0.5 italic">
                      ✓ ออกเช็คล่วงหน้า {daysBetween} วัน · ทันรอบจ่าย
                    </p>
                  );
                })()}
              </div>
              <div>
                <FieldLabel>สถานะเช็ค</FieldLabel>
                <Select
                  value={chequeInfo.cheque_status}
                  onChange={(e) => editCheque((c) => ({ ...c, cheque_status: e.target.value as ChequeInfo['cheque_status'] }))}
                >
                  <option value="Pending">Pending</option>
                  <option value="Approved">Approved</option>
                  <option value="Issued">Issued</option>
                  <option value="Cleared">Cleared</option>
                  <option value="Cancelled">Cancelled</option>
                </Select>
              </div>
            </div>
            {/* เดิมข้อความชี้ไปที่แท็บซึ่งไม่มีอยู่จริงในระบบ */}
            <p className="text-[10px] text-amber-700 italic mt-2">
              ข้อมูลเช็คแสดงอยู่ในคอลัมน์ Cheque No / AP Status ของหน้ารายการใบตัดชำระ
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
                disabled={viewOnly || !canEdit || locked}
                className={`px-3 py-1.5 border-l border-line disabled:opacity-40 ${entryMode === 'fromBank' ? 'bg-brand text-white' : 'bg-white text-muted hover:bg-soft'}`}
                title="เลือกบรรทัดใบแจ้งยอดธนาคารที่ยังไม่ผูกใบตัดชำระ"
              >
                From Bank
              </button>
            </div>
            {entryMode === 'manual' && (
              <Button size="sm" disabled={viewOnly || !canEdit || locked} onClick={() => editLines((ls) => [...ls, newLine()])}>
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
              // เดิมทับบรรทัดที่กรอกไว้ทันทีโดยไม่ถาม — ที่พิมพ์มาหายทั้งตาราง
              const hasData = lines.some((l) => l.facility_id || l.amount !== 0);
              if (hasData && !window.confirm(
                `จะแทนที่บรรทัดที่กรอกไว้ (${lines.length} บรรทัด) ด้วย ${picked.length} บรรทัดจากใบแจ้งยอด — ดำเนินการต่อหรือไม่?`,
              )) return;
              // บรรทัดแรกที่เลือกเป็นตัวผูกต้นทาง (หนึ่งใบตัดชำระ = หนึ่งบรรทัดใบแจ้งยอด)
              // บรรทัดที่เหลือแค่เติมเป็นแถวจัดสรร
              const master = picked[0];
              setSourceBankLineId(master.id);
              editHeader((h) => ({
                ...h,
                channel: 'Bank Statement',
                pay_date: master.tx_date || h.pay_date,
                remark: master.description
                  ? `[จากใบแจ้งยอด] ${master.description}`
                  : h.remark,
              }));
              editLines(
                picked.map((p) => ({
                  key: crypto.randomUUID(),
                  facility_id: p.facility_id ?? '',
                  contract_label: p.facility_label ?? '',
                  // ตั้งต้นเป็นเงินต้น — เดิมตั้งเป็นดอกเบี้ยหมดทุกบรรทัด
                  // ทำให้ยอดเงินต้นเป็นศูนย์และตารางงวดไม่เคยถูกตัด ถ้าผู้ใช้ลืมแก้
                  category: 'Principal' as LineCategory,
                  amount: p.amount ?? 0,
                })),
              );
              setEntryMode('manual');
              toast.success(`เลือก ${picked.length} บรรทัดจากใบแจ้งยอด — ตรวจประเภทของแต่ละบรรทัดก่อนบันทึก`);
            }}
          />
        )}

        {/* เตือนเมื่อจ่ายเงินต้นเกินยอดตามสัญญา — เตือนอย่างเดียว ไม่บล็อกการบันทึก */}
        {overPayWarnings.length > 0 && (
          <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-semibold mb-1">⚠ เงินต้นสะสมเกินยอดตามสัญญา</div>
            <ul className="list-disc ml-4 space-y-0.5">
              {overPayWarnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
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
                      {/* สัญญาที่จบไปแล้วถูกคัดออกจากตัวเลือก — แต่รายการที่บันทึกไว้ก่อนหน้า
                          ต้องยังแสดงค่าเดิมได้ ไม่งั้นช่องจะกลายเป็นว่างแล้วบันทึกทับหาย */}
                      {l.facility_id && !facilityOpts.some((o) => o.id === l.facility_id) && (
                        <option value={l.facility_id}>{l.contract_label || l.facility_id} · (สัญญาจบแล้ว)</option>
                      )}
                      {facilityOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                  </td>
                  <td>
                    <Select value={l.category} onChange={(e) => updateLine(l.key, { category: e.target.value as LineCategory })}>
                      {LINE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                    </Select>
                  </td>
                  <td className="text-right">
                    <NumInput value={l.amount} onChange={(v) => updateLine(l.key, { amount: v })} className="text-right" />
                  </td>
                  <td className="text-right">
                    <button
                      disabled={viewOnly || !canEdit || locked}
                      onClick={() => editLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                      className="text-danger hover:text-red-700 disabled:opacity-40"
                      title="ลบบรรทัด"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-soft font-bold border-t-2 border-line">
                <td colSpan={2} className="text-right">รวม (ก่อนหักภาษี ณ ที่จ่าย)</td>
                <td className="text-right tabular-nums">{fmtMoney(totals.total)}</td>
                <td />
              </tr>
              {totals.WHT > 0.005 && (
                <>
                  <tr className="bg-soft border-t border-line">
                    <td colSpan={2} className="text-right">หักภาษี ณ ที่จ่าย</td>
                    <td className="text-right tabular-nums text-danger">- {fmtMoney(totals.WHT)}</td>
                    <td />
                  </tr>
                  <tr className="bg-soft font-bold border-t border-line">
                    <td colSpan={2} className="text-right">จ่ายจริง</td>
                    <td className="text-right tabular-nums">{fmtMoney(netPayout)}</td>
                    <td />
                  </tr>
                </>
              )}
            </tfoot>
          </table>
        </div>

        {/* สรุปยอดแยกตามประเภท */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
          {LINE_CATEGORIES.map((c) => (
            <div key={c} className="rounded border border-line bg-soft p-2.5">
              <div className="text-[11px] text-muted uppercase tracking-wide">{c}</div>
              <div className="text-right tabular-nums font-semibold">{fmtMoney(totals[c])}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-line">
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              disabled={createJournal.isPending || locked || totals.total <= 0 || !canEdit || viewOnly || loadFailed}
              onClick={() => { if (checkRequiredFields()) createJournal.mutate(); }}
              title={
                !canEdit ? 'ไม่มีสิทธิ์ลงบัญชีใบตัดชำระ'
                  : viewOnly ? 'กำลังเปิดในโหมดดูอย่างเดียว'
                    : locked ? 'ลงบัญชีไปแล้ว'
                      : 'บันทึกและลงบัญชีใบสำคัญ'
              }
            >
              <FileText className="w-4 h-4" /> {createJournal.isPending ? 'กำลังลงบัญชี...' : 'Create Journal'}
            </Button>
            <span className="text-xs text-muted">
              {locked ? '✓ ลงบัญชีแล้ว' : 'บันทึกและลงบัญชีตามรายการด้านล่าง'}
            </span>
          </div>

          {/* ตัวอย่างใบสำคัญ — คำนวณจากบรรทัดที่จัดสรรไว้จริง จะได้ตรงกับที่ลงจริง */}
          {!locked && totals.total > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="table-base text-xs max-w-2xl">
                <thead>
                  <tr>
                    <th>บัญชี</th>
                    <th className="text-right">เดบิต</th>
                    <th className="text-right">เครดิต</th>
                  </tr>
                </thead>
                <tbody>
                  {buildJELines(hasAccruedPreview).map((jl, i) => (
                    <tr key={i}>
                      <td>
                        {jl.dr ? 'Dr. ' : 'Cr. '}{jl.account_code} {jl.account_name}
                        <span className="text-muted italic"> — {jl.description}</span>
                      </td>
                      <td className="text-right tabular-nums">{jl.dr ? fmtMoney(jl.dr) : ''}</td>
                      <td className="text-right tabular-nums">{jl.cr ? fmtMoney(jl.cr) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent></Card>
      </ReadOnlyContext.Provider>
    </div>
  );
}
