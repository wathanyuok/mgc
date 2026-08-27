import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, ExternalLink, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Input, Select, Badge, FieldLabel } from '@/components/ui';
import { fmtDate, fmtMoney, fmtDateISO} from '@/lib/format';
import {
  type BankStatement,
  type BankStatementLine,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { ThTip } from '@/components/tx/TipHelpers';
import { FacilityPicker, type FacilityType } from '@/components/shared/FacilityPicker';
import { useFacilityTypesMap, toUiFacilityCode } from '@/lib/facility-types';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { useUnsavedGuard } from '@/lib/unsaved-guard';
import { logSave } from '@/lib/audit-trail';
import { useBankCodes } from '@/lib/banks';

import { checkRequiredFields } from '@/lib/required-check';
type HeaderForm = Omit<BankStatement, 'id' | 'created_at' | 'updated_at'>;

/**
 * Local BSL row shape — DB stores `facility_type_id` UUID (Migration 0074) but we keep
 * the legacy string code `facility_type` in memory for the dropdown + FacilityPicker.
 * Save converts back to UUID.
 */
type BSLRow = BankStatementLine & {
  facility_type?: string | null;
  /** ลำดับชุดที่นำเข้า — ใช้กันคำเตือนยอดคงเหลือข้ามชุด · ไม่ได้บันทึกลงฐานข้อมูล */
  import_batch?: number;
};

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
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<HeaderForm>(blank);
  const [lines, setLines] = useState<BSLRow[]>([]);
  const { codeToId } = useFacilityTypesMap();
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('master_bank', 'edit');
  // เตือนก่อนออกจากหน้า — สำคัญมากเพราะรายการที่นำเข้ามาอยู่บนจอจนกว่าจะกด Save
  const guard = useUnsavedGuard({ form, lines }, () => navigate('/master/bank-statement'));
  // Pagination for big statements (imported files may have 1000+ rows).
  // Without this the table rendered every input for every row → freeze.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const visibleLines = useMemo(
    () => lines.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [lines, clampedPage],
  );

  // BR-MST-BS-002 — Balance formula check (warning, not block).
  // For each line N (N≥1): Expected Balance = Previous Balance + Credit − Debit
  // First line cannot be validated (no previous baseline) — skip it.
  const balanceWarnings = useMemo(() => {
    const out: { mismatch: boolean; expected: number; diff: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      // แถวแรกไม่มีแถวก่อนหน้าให้เทียบ · และแถวแรกของไฟล์ที่นำเข้ารอบใหม่ก็เช่นกัน
      // เดิมเทียบข้ามชุดทำให้ขึ้นคำเตือนทั้งที่ข้อมูลถูก
      const newBatch = i > 0 && lines[i].import_batch !== lines[i - 1].import_batch;
      if (i === 0 || newBatch) {
        out.push({ mismatch: false, expected: lines[i].balance, diff: 0 });
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
  // นับเฉพาะหน้าที่เปิดอยู่ด้วย — เดิมบอกยอดรวมทั้งใบ ผู้ใช้หาไอคอนในหน้านั้นไม่เจอ
  const balanceMismatchOnPage = balanceWarnings
    .slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)
    .filter((w) => w.mismatch).length;

  const { data: existing } = useQuery({
    queryKey: ['bank-stmt', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [h, l] = await Promise.all([
        supabase.from('bank_statements').select('*').eq('id', id!).single(),
        // Migration 0074: join facility_types(code) so we can populate legacy string field.
        supabase.from('bank_statement_lines').select('*, facility_types(code)').eq('statement_id', id!).order('sort_order'),
      ]);
      if (h.error) throw h.error;
      return {
        header: h.data as BankStatement,
        lines: (l.data ?? []).map((r: any) => ({
          ...r,
          facility_type: toUiFacilityCode(r.facility_types?.code ?? null),
        })) as BSLRow[],
      };
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing.header;
      // ตั้งค่าเริ่มต้นใหม่ — ยังไม่นับว่าผู้ใช้แก้อะไร
      guard.reset({ form: rest, lines: existing.lines }, ({ form: f, lines: ls }) => {
        setForm(f as any);
        setLines(ls as BSLRow[]);
      });
    }
  }, [existing]);

  // ── รายการตัดชำระที่ผูกกับบรรทัดในใบนี้ ──
  // Pull repayments that were created from any of the current lines so each row
  // can show either "→ Create Repayment" (unlinked) or the linked repayment_no.
  const lineIds = useMemo(() => lines.map((l) => l.id).filter(Boolean), [lines]);
  const { data: linkedRepayments } = useQuery({
    queryKey: ['bank-stmt-linked-rp', lineIds.join(',')],
    enabled: lineIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('repayments')
        .select('id, repayment_no, status, bank_statement_line_id')
        .in('bank_statement_line_id', lineIds);
      if (error) throw error;
      const m = new Map<string, { id: string; repayment_no: string; status: string }>();
      (data ?? []).forEach((r: any) => {
        if (r.bank_statement_line_id) m.set(r.bank_statement_line_id, r);
      });
      return m;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.account_no.trim()) throw new Error('ใส่ Account Number');

      // กันสร้างใบซ้ำ — บัญชีเดียวกัน งวดเดียวกัน มักเกิดจากนำเข้าไฟล์เดิมซ้ำรอบ
      if (form.statement_period) {
        let dup = supabase
          .from('bank_statements')
          .select('id', { count: 'exact', head: true })
          .eq('account_no', form.account_no.trim())
          .eq('statement_period', form.statement_period);
        if (mode === 'edit' && id) dup = dup.neq('id', id);
        const { count, error: dupErr } = await dup;
        if (dupErr) {
          console.warn('[ใบแจ้งยอด] ตรวจใบซ้ำไม่สำเร็จ — ข้ามการตรวจ', dupErr);
        } else if ((count ?? 0) > 0) {
          throw new Error(
            `มีใบแจ้งยอดของบัญชี ${form.account_no} งวด ${form.statement_period} อยู่แล้ว — ` +
            `ถ้าต้องการเพิ่มรายการ ให้เปิดใบเดิมแล้วนำเข้าไฟล์ต่อท้าย แทนการสร้างใบใหม่`,
          );
        }
      }

      // AC-7 of UC-LEASE-008 — Block duplicate facility link
      // Check 1: intra-statement duplicates (within the current lines array)
      const seen = new Map<string, number>();
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        // งวดว่าง = ยังไม่ระบุว่าเป็นงวดไหน จึงบอกไม่ได้ว่าซ้ำ — ข้ามการตรวจ
        // (การผูกอัตโนมัติผ่านเลขเช็คไม่เติมงวดให้ ถ้านับว่าซ้ำจะบันทึกไม่ได้ทั้งที่ถูกต้อง)
        if (!l.facility_type || !l.facility_id || l.source_period == null) continue;
        const key = `${l.facility_type}|${l.facility_id}|${l.source_period}`;
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
        (l) => l.facility_type && l.facility_id && l.source_period != null,
      );
      if (linkedLines.length > 0) {
        for (const l of linkedLines) {
          const ftId = codeToId(l.facility_type);
          if (!ftId) continue;
          let q = supabase
            .from('bank_statement_lines')
            .select('id, statement_id')
            .eq('facility_type_id', ftId)
            .eq('facility_id', l.facility_id!);
          q = q.eq('source_period', l.source_period!);
          // ไม่ต้องนับบรรทัดในใบเดียวกัน — ตรวจซ้ำภายในใบทำไปแล้วข้างบน
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
      // เขียนบรรทัด — ต้องรักษารหัสบรรทัดเดิมไว้
      //
      // เดิมลบทั้งหมดแล้วเขียนใหม่ ทำให้รหัสบรรทัดเปลี่ยนทุกครั้งที่กด Save
      // รายการตัดชำระที่ชี้มาที่บรรทัดนี้ (repayments.bank_statement_line_id) จึงขาดไปเงียบๆ
      // ตอนนี้แยกเป็น 3 อย่าง: ลบเฉพาะแถวที่ผู้ใช้เอาออก · แก้แถวเดิม · เพิ่มแถวใหม่
      const payload = (l: BSLRow, i: number) => ({
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
        facility_type_id: l.facility_type ? codeToId(l.facility_type) : null,
        facility_id: l.facility_id,
        source_period: l.source_period,
      });

      // รหัสบรรทัดที่มีอยู่จริงในฐานข้อมูลตอนนี้
      const { data: dbRows, error: dbErr } = await supabase
        .from('bank_statement_lines')
        .select('id')
        .eq('statement_id', stmtId!);
      if (dbErr) throw dbErr;
      const dbIds = new Set((dbRows ?? []).map((r: any) => r.id as string));

      // 1) ลบเฉพาะแถวที่หายไปจากตารางบนจอ
      const keepIds = new Set(lines.map((l) => l.id).filter((x) => dbIds.has(x)));
      const removed = [...dbIds].filter((x) => !keepIds.has(x));
      if (removed.length > 0) {
        const { error } = await supabase.from('bank_statement_lines').delete().in('id', removed);
        if (error) throw error;
      }

      // 2) แก้แถวเดิม — รหัสเดิมยังอยู่ ลิงก์การตัดชำระจึงไม่ขาด
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!dbIds.has(l.id)) continue;
        const { error } = await supabase
          .from('bank_statement_lines')
          .update(payload(l, i))
          .eq('id', l.id);
        if (error) throw error;
      }

      // 3) เพิ่มแถวใหม่ — ส่งรหัสที่หน้าจอสร้างไว้ไปด้วย จะได้ตรงกันทั้ง 2 ฝั่ง
      const added = lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => !dbIds.has(l.id))
        .map(({ l, i }) => ({ id: l.id, ...payload(l, i) }));
      if (added.length > 0) {
        const { error } = await supabase.from('bank_statement_lines').insert(added);
        if (error) throw error;
      }
      return stmtId;
    },
    onSuccess: (stmtId: any) => {
      logSave('bank_statements', stmtId, `${form.finance_institution} · ${form.account_no}`, mode === 'new');
      qc.invalidateQueries({ queryKey: ['bank-stmt-list'] });
      qc.invalidateQueries({ queryKey: ['bank-stmt', stmtId] });
      guard.markSaved();
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
        facility_type_id: null,
        facility_type: null,
        facility_id: null,
        source_period: null,
      },
    ]);
  };

  // 📁 Import ไฟล์ CSV จริง (KBANK / SCB) — replaces the old demo Import Mock button.
  // เลือกไฟล์ → decode cp874 → auto-detect bank → parse → fill header + append lines.
  const importFileRef = useRef<HTMLInputElement>(null);
  const handleImportFile = async (file: File) => {
    console.log('[Import] file picked:', file.name, file.size, 'bytes');
    toast.info(`กำลังอ่าน ${file.name} ...`);
    try {
      const { decodeCP874, parseBankStatement } = await import('@/lib/bank-statement-parser');
      // Try cp874 first (KBANK/SCB Thai export). If bank not detected in head,
      // fall back to UTF-8 (some banks may export UTF-8 now).
      const buf = await file.arrayBuffer();
      let text = new TextDecoder('windows-874').decode(buf);
      const head500 = text.slice(0, 500);
      console.log('[Import] head (cp874):', head500.slice(0, 200));
      if (!head500.includes('รายการเดินบัญชี') && !head500.startsWith('Account Number,Date,Time')) {
        // Not KBANK/SCB signature in cp874 — try UTF-8
        const utf8 = new TextDecoder('utf-8').decode(buf);
        const utf8head = utf8.slice(0, 500);
        console.log('[Import] head (utf8):', utf8head.slice(0, 200));
        if (utf8head.includes('รายการเดินบัญชี') || utf8head.startsWith('Account Number,Date,Time')) {
          text = utf8;
        }
      }
      // Silence "decodeCP874 imported but unused"
      void decodeCP874;
      const parsed = parseBankStatement(text);
      console.log('[Import] parsed:', parsed.bank, parsed.account_no, parsed.statement_period, parsed.lines.length, 'lines');
      // เตือนถ้าเลขที่บัญชีในไฟล์ไม่ตรงกับใบนี้ — กันเอาไฟล์คนละบัญชีมาต่อท้ายกัน
      if (form.account_no.trim() && parsed.account_no
          && form.account_no.trim() !== parsed.account_no.trim()) {
        const ok = window.confirm(
          `เลขที่บัญชีในไฟล์ (${parsed.account_no}) ไม่ตรงกับใบแจ้งยอดนี้ (${form.account_no})\n\n` +
          `ถ้ายืนยัน รายการจากไฟล์จะถูกเติมต่อท้ายใบนี้ — ต้องการทำต่อหรือไม่?`,
        );
        if (!ok) return;
      }

      // เติมหัวใบจากไฟล์เมื่อใบยังไม่มีรายการ
      //
      // เดิมใช้เงื่อนไข "เติมถ้าช่องว่าง" แต่ธนาคารกับงวดมีค่าตั้งต้นอยู่แล้ว (SCB + เดือนปัจจุบัน)
      // จึงไม่เคยถูกเติมเลย ผลคือนำเข้าไฟล์ธนาคารหนึ่งแต่หัวใบขึ้นอีกธนาคารทุกครั้ง
      const emptyStatement = lines.length === 0;
      setForm((f) => ({
        ...f,
        finance_institution: emptyStatement ? (parsed.bank || f.finance_institution) : f.finance_institution,
        account_no: f.account_no || parsed.account_no,
        statement_period: emptyStatement ? (parsed.statement_period || f.statement_period) : f.statement_period,
        statement_name: f.statement_name || parsed.statement_name || null,
      }));
      // Append parsed lines
      // ชุดที่เท่าไรของใบนี้ — ใช้กันคำเตือนยอดคงเหลือข้ามชุด
      const batch = lines.reduce((m, l) => Math.max(m, l.import_batch ?? 0), 0) + 1;
      const newRows: BSLRow[] = parsed.lines.map((L, i) => ({
        id: crypto.randomUUID(),
        import_batch: batch,
        statement_id: '',
        tx_date: L.tx_date,
        tx_time: L.tx_time ?? null,
        txn_code: L.txn_code ?? null,
        description: L.description ?? null,
        debit: L.debit,
        credit: L.credit,
        balance: L.balance,
        source: 'Import',
        remark: [L.cheque_no && `เช็ค ${L.cheque_no}`, L.channel, L.raw_remark].filter(Boolean).join(' · ') || null,
        sort_order: lines.length + i,
        facility_type_id: null,
        facility_type: null,
        facility_id: null,
        source_period: null,
      }));

      // Tier 1 auto-link — 2 strategies tried per row:
      //   1a. SCB MCL <11-digit> in description → match facility bank_ref
      //   1b. เช็คเลขที่ <n> → match ap_cheque_requests.cheque_no → facility
      const {
        extractMCL, matchByBankRef,
        extractChequeNo, matchByChequeNo,
      } = await import('@/lib/bank-statement/match-by-bank-ref');
      let autoLinked = 0;
      for (const row of newRows) {
        // Strategy 1a — MCL
        const mcl = extractMCL(row.description);
        if (mcl) {
          const match = await matchByBankRef(mcl.ref);
          if (match) {
            row.facility_type_id = match.facility_type_id;
            row.facility_type = toUiFacilityCode(match.facility_code); // ให้ตรงกับตัวเลือกในช่อง
            row.facility_id = match.facility_id;
            row.source_period = mcl.period;
            autoLinked++;
            continue;
          }
        }
        // Strategy 1b — Cheque
        const cheque = extractChequeNo(row.description, row.remark);
        if (cheque) {
          const match = await matchByChequeNo(cheque);
          if (match) {
            row.facility_type_id = match.facility_type_id;
            row.facility_type = toUiFacilityCode(match.facility_code);
            row.facility_id = match.facility_id;
            autoLinked++;
          }
        }
      }

      setLines([...lines, ...newRows]);
      toast.success(`Import ${parsed.bank} — ${newRows.length} รายการ · auto-link ${autoLinked} รายการ · กด Save เพื่อบันทึก`);
    } catch (e: any) {
      toast.error(`Import ไม่สำเร็จ: ${e?.message ?? String(e)}`);
    }
  };

  const update = (i: number, patch: Partial<BSLRow>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /**
   * แก้เงินออก/เงินเข้าของแถวที่คีย์เอง แล้วคำนวณยอดคงเหลือต่อจากแถวก่อนหน้าให้
   * เดิมต้องพิมพ์ยอดคงเหลือเองทุกแถว พิมพ์พลาดแล้วขึ้นคำเตือนโดยไม่รู้ตัว
   * แถวที่มาจากไฟล์ไม่แตะ — ยอดในไฟล์คือของจริงจากธนาคาร
   */
  const updateAmount = (i: number, patch: Partial<BSLRow>) =>
    setLines(lines.map((l, j) => {
      if (j !== i) return l;
      const next = { ...l, ...patch };
      if (next.source === 'Manual' && i > 0) {
        next.balance = lines[i - 1].balance + (next.credit || 0) - (next.debit || 0);
      }
      return next;
    }));
  const remove = (i: number) => {
    const l = lines[i];
    const label = [l.tx_date, l.description].filter(Boolean).join(' · ') || `บรรทัดที่ ${i + 1}`;
    if (!window.confirm(`ลบ ${label} ออกจากตารางหรือไม่?`)) return;
    setLines(lines.filter((_, j) => j !== i));
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={guard.leave}>
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
        <Button variant="primary" disabled={save.isPending || !canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> Save
        </Button>
        <Button onClick={guard.leave}>Cancel</Button>
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
              {bankCodes.map((x) => (
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
            <input
              ref={importFileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                if (importFileRef.current) importFileRef.current.value = '';
              }}
            />
            <Button variant="primary" onClick={() => importFileRef.current?.click()}>
              <RefreshCw className="w-4 h-4" /> Import ไฟล์ (CSV)
            </Button>
            <Button
              onClick={async () => {
                const {
                  extractMCL, matchByBankRef,
                  extractChequeNo, matchByChequeNo,
                } = await import('@/lib/bank-statement/match-by-bank-ref');
                const scanTarget = lines.filter(
                  (L) =>
                    !L.facility_id &&
                    (extractMCL(L.description ?? '') || extractChequeNo(L.description ?? '', L.remark ?? '')),
                );
                if (scanTarget.length === 0) {
                  toast.info('ไม่มีแถวที่มี MCL หรือเลขเช็ค แบบยังไม่ link');
                  return;
                }
                toast.info(`กำลังหา link · ${scanTarget.length} แถว...`);
                let linked = 0;
                const updated = [...lines];
                for (let i = 0; i < updated.length; i++) {
                  const L = updated[i];
                  if (L.facility_id) continue;

                  // Try MCL first (SCB)
                  const mcl = extractMCL(L.description ?? '');
                  if (mcl) {
                    const match = await matchByBankRef(mcl.ref);
                    if (match) {
                      updated[i] = {
                        ...L,
                        facility_type_id: match.facility_type_id,
                        facility_type: toUiFacilityCode(match.facility_code), // Local mirror
                        facility_id: match.facility_id as any,
                        source_period: mcl.period,
                      };
                      linked++;
                      continue;
                    }
                  }

                  // Try cheque number (KBANK AP)
                  const cheque = extractChequeNo(L.description ?? '', L.remark ?? '');
                  if (cheque) {
                    const match = await matchByChequeNo(cheque);
                    if (match) {
                      updated[i] = {
                        ...L,
                        facility_type_id: match.facility_type_id,
                        facility_type: toUiFacilityCode(match.facility_code),
                        facility_id: match.facility_id as any,
                      };
                      linked++;
                    }
                  }
                }
                setLines(updated);
                toast.success(`✓ link สำเร็จ ${linked} / ${scanTarget.length} แถว · กด Save เพื่อบันทึก`);
              }}
              className="bg-white text-ink border-line hover:bg-soft"
              title="หา facility จาก MCL 11 หลัก (SCB) หรือเลขเช็ค (KBANK AP) · สำหรับแถวที่ยังไม่ link"
            >
              🔗 หา link อัตโนมัติ
            </Button>
          </div>
        </div>
        {lines.length > PAGE_SIZE && (
          <div className="flex items-center gap-2 py-2 text-xs">
            <Button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
              className="bg-white text-ink border-line hover:bg-soft"
            >
              ◀ ก่อนหน้า
            </Button>
            <span className="mx-2">
              หน้า <strong>{clampedPage + 1}</strong> / {totalPages} · แสดงแถว {clampedPage * PAGE_SIZE + 1}–
              {Math.min((clampedPage + 1) * PAGE_SIZE, lines.length)} จาก <strong>{lines.length}</strong>
            </span>
            <Button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={clampedPage >= totalPages - 1}
              className="bg-white text-ink border-line hover:bg-soft"
            >
              ถัดไป ▶
            </Button>
          </div>
        )}
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
                <ThTip tip="Repayment ที่เปิดจากบรรทัดนี้ — คลิก → Create เพื่อสร้าง Repayment พร้อม pre-fill">Repayment</ThTip>
                <ThTip>Action</ThTip>
              </tr>
            </thead>
            <tbody>
              {visibleLines.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center text-muted py-6 italic">
                    — ยังไม่มี Statement Lines — กด <strong>+ Add Manual</strong> หรือ <strong>Import ไฟล์ (CSV)</strong> —
                  </td>
                </tr>
              )}
              {visibleLines.map((l, iVisible) => {
                // Absolute index into `lines` — needed for update()/remove()
                const i = clampedPage * PAGE_SIZE + iVisible;
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
                        className="text-xs min-w-[260px]"
                        title={l.description ?? ''}
                      />
                    </td>
                    <td>
                      <NumInput
                        value={l.debit}
                        onChange={(v) => updateAmount(i, { debit: v })}
                        className="w-24"
                      />
                    </td>
                    <td>
                      <NumInput
                        value={l.credit}
                        onChange={(v) => updateAmount(i, { credit: v })}
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
                          onChange={(e) => {
                            const code = e.target.value || null;
                            update(i, {
                              facility_type: code,
                              facility_type_id: code ? codeToId(code) : null,
                            });
                          }}
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
                              min={1}
                              value={l.source_period ?? ''}
                              onChange={(e) => {
                                const n = e.target.value ? Number(e.target.value) : null;
                                // งวดต้องเป็นจำนวนเต็มบวก — 0 หรือติดลบไม่มีความหมาย
                                update(i, { source_period: n != null && n >= 1 ? Math.floor(n) : null });
                              }}
                              className="text-[10px] w-16"
                              placeholder="งวด"
                              title="เลขงวดที่ตัดชำระ · เว้นว่างถ้าเป็นการชำระครั้งเดียวไม่ผูกงวด"
                            />
                          </>
                        )}
                      </div>
                    </td>
                    <td className="text-xs">
                      {(() => {
                        const linked = linkedRepayments?.get(l.id);
                        if (linked) {
                          return (
                            <RouterLink
                              to={`/tx/repayment/${linked.id}`}
                              className="inline-flex items-center gap-1 text-brand font-medium hover:underline"
                              title={`ดู Repayment ${linked.repayment_no} (${linked.status})`}
                            >
                              ✓ {linked.repayment_no}
                              <ExternalLink className="w-3 h-3" />
                            </RouterLink>
                          );
                        }
                        // No repayment yet — show Create button only if line has been saved
                        // (line.statement_id present means it exists in DB already), and
                        // ideally has facility link + a credit amount.
                        const isSaved = !!l.statement_id;
                        const hasMoney = (l.credit ?? 0) > 0;
                        const hasFacility = !!(l.facility_type && l.facility_id);
                        if (!isSaved) {
                          return <span className="text-muted italic">บันทึก statement ก่อน</span>;
                        }
                        if (!hasMoney) {
                          return <span className="text-muted">—</span>;
                        }
                        const params = new URLSearchParams({
                          bank_line_id: l.id,
                          channel: 'Bank Statement',
                          pay_date: l.tx_date,
                          amount: String(l.credit ?? 0),
                        });
                        if (hasFacility) {
                          // Map bank line facility_type ('P/N','HP') to repayment FACILITY_TYPES values.
                          const ftMap: Record<string, string> = {
                            'P/N': 'PN', 'HP': 'HP', 'Lease': 'Lease',
                            'Loan': 'Loan', 'FP': 'FP', 'OD': 'OD',
                            'TR': 'TR', 'FXF': 'FXF', 'LG': 'LG', 'LC': 'LC',
                          };
                          const mapped = ftMap[l.facility_type as string] ?? l.facility_type;
                          params.set('facility_type', mapped as string);
                          params.set('facility_id', l.facility_id as string);
                          if (l.source_period != null) params.set('source_period', String(l.source_period));
                        }
                        if (l.description) params.set('memo', l.description);
                        const href = `/tx/repayment/new?${params.toString()}`;
                        return (
                          <RouterLink
                            to={href}
                            className="inline-flex items-center gap-1 text-brand hover:underline italic"
                            title="เปิด Repayment form พร้อม pre-fill"
                          >
                            → Create
                          </RouterLink>
                        );
                      })()}
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
                <strong>{balanceMismatchCount}</strong> บรรทัดยอดคงเหลือไม่ตรงสูตร
                {totalPages > 1 && ` · อยู่ในหน้านี้ ${balanceMismatchOnPage} บรรทัด`}
                {' '}— ชี้เมาส์ที่ไอคอนเตือนเพื่อดูส่วนต่าง · เป็นคำเตือนอย่างเดียว ยังบันทึกได้
              </span>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
