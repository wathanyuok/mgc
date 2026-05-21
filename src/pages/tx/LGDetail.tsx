import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, Plus, Repeat2, Save, Trash2, XCircle, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Modal, Badge, FieldLabel } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import {
  type LetterGuarantee,
  type LGFee,
  FINANCE_INSTITUTIONS,
  LG_TYPES,
  LG_STATUSES,
  PAYMENT_CYCLES,
} from '@/types/database';
import { Section } from '@/components/tx/Section';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { RateCards, type RateCard, effectiveRate } from '@/components/tx/RateCards';
import { AcctCards, type AcctCard } from '@/components/tx/AcctCards';
import { DocumentTabGeneric } from '@/components/ma/DocumentTabGeneric';
import { InheritedDocs } from '@/components/tx/InheritedDocs';
import { ThTip, RowTip } from '@/components/tx/TipHelpers';
import { RepaymentsReceived } from '@/components/tx/RepaymentsReceived';
import { createJE, postJE } from '@/lib/je';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { AuditFooter } from '@/components/AuditFooter';
import { assertWithinCreditLine } from '@/lib/credit-limit';

type Form = Omit<LetterGuarantee, 'id' | 'created_at' | 'updated_at'> & {
  rate_cards: RateCard[];
  acct_cards: AcctCard[];
};

const blank: Form = {
  lg_no: '',
  name: '',
  lg_type: 'B/G',
  ca_id: null,
  finance_institution: 'KBANK',
  beneficiary: '',
  subject: null,
  amount: 0,
  amount_foreign: null,
  currency: 'THB',
  conversion_date: null,
  conversion_rate: null,
  prepaid: false,
  reference_contract: null,
  issue_date: new Date().toISOString().slice(0, 10),
  expiry_date: new Date().toISOString().slice(0, 10),
  value_date: null,
  status: 'Draft',
  remark: null,
  rate_cards: [],
  payment_cycle: 'Quarterly',
  payment_date: null,
  fee_amount: null,
  rollover_parent_id: null,
  acct_cards: [],
};

export function LGDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const [fees, setFees] = useState<LGFee[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [showRollover, setShowRollover] = useState(false);
  const [showTerminate, setShowTerminate] = useState(false);
  const [rolloverNew, setRolloverNew] = useState({ new_name: '', new_issue: '', new_expiry: '' });
  const actionsRef = useRef<HTMLDivElement>(null);

  // CA dropdown options
  const { data: caOptions } = useQuery({
    queryKey: ['ca-options-for-lg'],
    queryFn: async () => {
      const { data } = await supabase.from('credit_agreements').select('id, ca_name').order('ca_name');
      return (data ?? []) as { id: string; ca_name: string }[];
    },
  });

  const { data: existing } = useQuery({
    queryKey: ['lg', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [main, feeRes] = await Promise.all([
        supabase.from('letter_guarantees').select('*').eq('id', id!).single(),
        supabase.from('lg_fees').select('*').eq('lg_id', id!).order('sort_order'),
      ]);
      if (main.error) throw main.error;
      return { main: main.data as any, fees: (feeRes.data ?? []) as LGFee[] };
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
      setFees(existing.fees);
    }
  }, [existing]);

  // Close actions menu on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Effective fee rate (annual %)
  const effFeeRate = useMemo(
    () => (form.rate_cards.length > 0 ? effectiveRate(form.rate_cards[0]) : 0),
    [form.rate_cards],
  );

  // Auto-compute new fee for rollover (Guarantee Amount × Rate × 1 year)
  const newRolloverFee = useMemo(() => (form.amount * effFeeRate) / 100, [form.amount, effFeeRate]);

  // ensureLgId for Document upload before save
  const ensureLgId = async (): Promise<string> => {
    if (id) return id;
    const lgNo = form.lg_no.trim() || `DRAFT-${Date.now()}`;
    const name = form.name?.trim() || lgNo;
    const { data, error } = await supabase
      .from('letter_guarantees')
      .insert({ ...form, lg_no: lgNo, name, status: 'Draft' })
      .select()
      .single();
    if (error) throw error;
    setForm((f) => ({ ...f, lg_no: lgNo, name }));
    navigate(`/tx/lg/${data.id}`, { replace: true });
    toast.success('✓ สร้าง Draft อัตโนมัติ');
    return data.id as string;
  };

  const userLabel = useCurrentUserLabel();
  const { can: rawCan } = useAuth();
  const viewOnly = useReadOnly();
  const can = (k: string, a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan(k, a);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.lg_no.trim()) throw new Error('กรอก LG/BG Number');
      await assertWithinCreditLine(form.ca_id, form.amount, { table: 'letter_guarantees', id });

      let lgId = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('letter_guarantees').insert({ ...form, created_by: userLabel, updated_by: userLabel }).select().single();
        if (error) throw error;
        lgId = data.id;
      } else {
        const { error } = await supabase.from('letter_guarantees').update({ ...form, updated_by: userLabel, updated_at: new Date().toISOString() }).eq('id', lgId!);
        if (error) throw error;
      }
      // Replace fees
      await supabase.from('lg_fees').delete().eq('lg_id', lgId!);
      if (fees.length > 0) {
        const rows = fees.map((f, i) => ({
          lg_id: lgId!,
          fee_date: f.fee_date,
          description: f.description,
          rate_pct: f.rate_pct,
          amount: f.amount,
          paid: f.paid,
          paid_date: f.paid_date,
          sort_order: i,
        }));
        const { error } = await supabase.from('lg_fees').insert(rows);
        if (error) throw error;
      }
      return lgId;
    },
    onSuccess: (lgId: any) => {
      qc.invalidateQueries({ queryKey: ['lg-list'] });
      qc.invalidateQueries({ queryKey: ['lg', lgId] });
      toast.success(mode === 'new' ? '✓ สร้าง LG/BG แล้ว' : '✓ บันทึกแล้ว');
      if (mode === 'new' && lgId) navigate(`/tx/lg/${lgId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rollOver = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save ก่อน');
      if (form.status !== 'Approved' && form.status !== 'Active')
        throw new Error('Roll Over ทำได้เฉพาะ LG/BG ที่ Approved/Active เท่านั้น');
      if (!rolloverNew.new_expiry) throw new Error('กรอก Expiry Date ใหม่');

      await supabase.from('letter_guarantees').update({ status: 'Roll Over' }).eq('id', id);

      const { id: _i, created_at: _c, updated_at: _u, ...formRest } = form as any;
      const { data: newLg, error } = await supabase
        .from('letter_guarantees')
        .insert({
          ...formRest,
          name: rolloverNew.new_name || `${form.name}-RO`,
          lg_no: form.lg_no ? `${form.lg_no}-RO` : null,
          issue_date: rolloverNew.new_issue || form.expiry_date,
          expiry_date: rolloverNew.new_expiry,
          status: 'Draft',
          rollover_parent_id: id,
          reference_contract: form.name ?? form.lg_no,
        })
        .select()
        .single();
      if (error) throw error;
      return newLg;
    },
    onSuccess: (data: any) => {
      toast.success(`✓ Roll Over สำเร็จ → LG/BG ใหม่: ${data.name ?? data.lg_no}`);
      setShowRollover(false);
      setRolloverNew({ new_name: '', new_issue: '', new_expiry: '' });
      qc.invalidateQueries({ queryKey: ['lg-list'] });
      navigate(`/tx/lg/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const terminate = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save ก่อน');
      const { error } = await supabase
        .from('letter_guarantees')
        .update({ status: 'Terminated' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lg', id] });
      qc.invalidateQueries({ queryKey: ['lg-list'] });
      setShowTerminate(false);
      setForm((f) => ({ ...f, status: 'Terminated' }));
      toast.success('✓ Terminate B/G, L/G แล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalFee = fees.reduce((s, f) => s + (f.amount || 0), 0);
  const paidFee = fees.filter((f) => f.paid).reduce((s, f) => s + (f.amount || 0), 0);

  // Create JE for upfront fee payment — posts real JE to GL
  const [showJE, setShowJE] = useState(false);

  // Check if upfront JE already posted (ACTIVE = Posted & not a reversal)
  // After reverse: original Reversed + new is_reversal Posted → both excluded → button unlocks
  const { data: upfrontPosted } = useQuery({
    queryKey: ['je-upfront-lg', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('id, je_number, status, is_reversal')
        .eq('source_type', 'LG_FEE')
        .eq('source_id', id!)
        .eq('source_period', 0)
        .eq('status', 'Posted')
        .eq('is_reversal', false)
        .maybeSingle();
      return data;
    },
  });

  // Lookup accounts from Accounting tab (acct_cards)
  // - If user configured accounts → use those (override)
  // - If not → use sensible defaults (warn user)
  const resolvedAccounts = useMemo(() => {
    const acctByType = (t: string) => form.acct_cards.find((a) => a.type === t);

    const drType = form.prepaid ? 'PREPAID ACCOUNT' : 'FEE EXPENSE ACCOUNT';
    const drAcct = acctByType(drType);
    const crAcct = acctByType('CASH / BANK ACCOUNT') || acctByType('NOTE PAYABLE ACCOUNT');

    const drGL = drAcct?.gl ?? (form.prepaid ? '1193 Prepaid Expenses - L/G, B/G' : '5512201 ค่าธรรมเนียมจ่าย');
    const crGL = crAcct?.gl ?? '2142101 เงินกู้ยืมระยะสั้น (Bank) / AP';

    return {
      drGL,
      crGL,
      isFromAccounting: !!drAcct && !!crAcct,
      missingTypes: [
        !drAcct && drType,
        !crAcct && 'CASH / BANK ACCOUNT (หรือ NOTE PAYABLE ACCOUNT)',
      ].filter(Boolean) as string[],
    };
  }, [form.acct_cards, form.prepaid]);

  const createUpfrontJE = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save LG/BG ก่อน Post JE');
      if (form.status !== 'Approved') {
        throw new Error(`Post JE ได้เฉพาะ LG/BG ที่ Approved — Status ปัจจุบัน: "${form.status}"`);
      }
      if (!form.payment_date) throw new Error('กรอก Payment Date ก่อน');
      if (!form.fee_amount) throw new Error('กรอก Fee Amount ก่อน');

      // Double-check at mutation time (race-safe — re-query before insert)
      // Only block if an ACTIVE (Posted, non-reversal) JE exists.
      // After user reverses, this list is empty → user can post again with corrected accounts.
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('je_number, status, is_reversal')
        .eq('source_type', 'LG_FEE')
        .eq('source_id', id)
        .eq('source_period', 0)
        .eq('status', 'Posted')
        .eq('is_reversal', false);
      if (existing && existing.length > 0) {
        throw new Error(
          `Upfront JE มีอยู่แล้ว: ${existing[0].je_number} (status=${existing[0].status}) — ต้อง Reverse ก่อนถ้าจะ Post ใหม่`,
        );
      }

      const parseGL = (gl: string) => {
        const m = gl.match(/^(\S+)\s+(.+)$/);
        return m ? { code: m[1], name: m[2] } : { code: undefined, name: gl };
      };
      const dr = parseGL(resolvedAccounts.drGL);
      const cr = parseGL(resolvedAccounts.crGL);

      const je = await createJE({
        source_type: 'LG_FEE',
        source_id: id,
        source_period: 0,
        je_date: form.payment_date,
        description: `${form.name ?? form.lg_no} — Upfront Fee Payment`,
        remark: `${form.prepaid ? 'Prepaid mode' : 'Expense mode'} · ${form.payment_cycle ?? ''} · accounts ${resolvedAccounts.isFromAccounting ? 'from Accounting tab' : 'default'}`,
        lines: [
          { account_code: dr.code, account_name: dr.name, dr: form.fee_amount, description: form.prepaid ? 'Prepaid fee' : 'Fee expense (one-shot)' },
          { account_code: cr.code, account_name: cr.name, cr: form.fee_amount, description: 'Pay to bank' },
        ],
      });
      await postJE(je.id, 'user');

      // Auto-promote status: Approved → Active
      await supabase.from('letter_guarantees').update({ status: 'Active' }).eq('id', id);
      return je;
    },
    onSuccess: (je) => {
      qc.invalidateQueries({ queryKey: ['je-upfront-lg', id] });
      qc.invalidateQueries({ queryKey: ['lg', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      setForm((f) => ({ ...f, status: 'Active' }));
      toast.success(`✓ ${je.je_number} Posted · Status → Active`);
      setShowJE(true);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onClickCreateJE = () => createUpfrontJE.mutate();

  // ====== Tabs ======
  const tabs: TabDef[] = [
    {
      key: 'fee',
      label: 'Fee',
      render: () => (
        <div className="space-y-6">
          {/* Fee Rate cards (variant=fee uses Fee labels instead of Interest) */}
          <div>
            <h4 className="text-sm font-bold text-ink mb-2 pb-1 border-b border-line">Fee Rate</h4>
            <RateCards
              variant="fee"
              rates={form.rate_cards}
              onChange={(n) => setForm((f) => ({ ...f, rate_cards: n }))}
            />
          </div>

          {/* Payment section */}
          <div>
            <h4 className="text-sm font-bold text-ink mb-2 pb-1 border-b border-line">Payment</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl">
              <div>
                <FieldLabel required>PAYMENT CYCLE</FieldLabel>
                <Select
                  value={form.payment_cycle ?? 'Quarterly'}
                  onChange={(e) => setForm((f) => ({ ...f, payment_cycle: e.target.value }))}
                >
                  {PAYMENT_CYCLES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </div>
              <div>
                <FieldLabel required>PAYMENT DATE</FieldLabel>
                <Input
                  type="date"
                  value={form.payment_date ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value || null }))}
                />
              </div>
              <div>
                <FieldLabel required>AMOUNT</FieldLabel>
                <Input
                  type="number"
                  step="0.01"
                  value={form.fee_amount ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fee_amount: e.target.value ? parseFloat(e.target.value) : null }))
                  }
                  className="text-right tabular-nums"
                />
              </div>
            </div>
            {!resolvedAccounts.isFromAccounting && !upfrontPosted && (
              <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded text-xs">
                ⚠️ <strong>ใช้ Account default</strong> — แนะนำให้ไปกำหนด <strong>{resolvedAccounts.missingTypes.join(' + ')}</strong> ใน{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); document.querySelectorAll('button').forEach((b) => { if (b.textContent === 'Accounting') (b as HTMLButtonElement).click(); }); }} className="text-brand underline">tab Accounting</a> ก่อน Post JE
              </div>
            )}
            <div className="mt-3 flex items-center gap-3">
              <Button
                onClick={onClickCreateJE}
                disabled={
                  !id ||
                  createUpfrontJE.isPending ||
                  !!upfrontPosted ||
                  !form.fee_amount ||
                  !form.payment_date ||
                  form.status !== 'Approved'
                }
                title={
                  !id
                    ? 'Save LG/BG ก่อน'
                    : form.status !== 'Approved'
                      ? `Post ได้เฉพาะ Status = Approved — ตอนนี้: "${form.status}" (เปลี่ยน Status ก่อน)`
                      : !form.fee_amount
                        ? 'กรอก Amount ก่อน'
                        : !form.payment_date
                          ? 'กรอก Payment Date ก่อน'
                          : upfrontPosted
                            ? `Upfront JE มีแล้ว: ${(upfrontPosted as any).je_number}`
                            : 'Post JE + เปลี่ยน Status เป็น Active'
                }
                className={
                  upfrontPosted
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-200 cursor-not-allowed'
                    : 'bg-gray-700 text-white border-gray-700 hover:bg-gray-800'
                }
              >
                {upfrontPosted
                  ? `✓ JE Posted: ${(upfrontPosted as any).je_number}`
                  : createUpfrontJE.isPending
                    ? 'Posting...'
                    : '📋 Create Journal Entry'}
              </Button>
              {upfrontPosted && (
                <a
                  href={`/je/${(upfrontPosted as any).id}`}
                  className="text-brand text-xs hover:underline"
                >
                  View JE →
                </a>
              )}
            </div>
          </div>

          {/* JE Preview — uses accounts resolved from Accounting tab (or defaults) */}
          {(showJE || upfrontPosted) && form.fee_amount && (
            <div>
              <h4 className="text-sm font-bold text-ink mb-2">
                📒 Generated Journal Entry {upfrontPosted ? '(Posted)' : '(Preview)'}
              </h4>
              <div className={`border rounded p-4 ${upfrontPosted ? 'bg-emerald-50 border-emerald-200' : 'bg-soft border-line'}`}>
                <table className="table-base">
                  <thead>
                    <tr>
                      <ThTip>Account</ThTip>
                      <ThTip align="right" tipKey="DR">Dr.</ThTip>
                      <ThTip align="right" tipKey="CR">Cr.</ThTip>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{resolvedAccounts.drGL}</td>
                      <td className="text-right tabular-nums">{fmtMoney(form.fee_amount)}</td>
                      <td className="text-right">—</td>
                    </tr>
                    <tr>
                      <td>{resolvedAccounts.crGL}</td>
                      <td className="text-right">—</td>
                      <td className="text-right tabular-nums">{fmtMoney(form.fee_amount)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-xs text-muted mt-2 italic">
                  Posting Date: {form.payment_date ? fmtDate(form.payment_date) : '—'} · {form.payment_cycle} fee ·{' '}
                  <strong>{form.prepaid ? 'Prepaid Mode' : 'Expense Mode'}</strong> · accounts{' '}
                  <strong>{resolvedAccounts.isFromAccounting ? 'จาก Accounting tab' : 'default'}</strong>
                </p>
              </div>
            </div>
          )}

          {/* Existing fee schedule table */}
          {fees.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-ink mb-2 pb-1 border-b border-line">Fee Schedule</h4>
              <table className="table-base">
                <thead>
                  <tr>
                    <ThTip>Date</ThTip>
                    <ThTip>Description</ThTip>
                    <ThTip align="right">Rate %</ThTip>
                    <ThTip align="right">Amount</ThTip>
                    <ThTip>Paid</ThTip>
                    <ThTip>Paid Date</ThTip>
                  </tr>
                </thead>
                <tbody>
                  {fees.map((f, i) => (
                    <tr key={f.id}>
                      <td>{fmtDate(f.fee_date)}</td>
                      <td>{f.description}</td>
                      <td className="text-right tabular-nums">{f.rate_pct ?? '—'}</td>
                      <td className="text-right tabular-nums">{fmtMoney(f.amount)}</td>
                      <td>{f.paid ? '✓' : '—'}</td>
                      <td>{f.paid_date ? fmtDate(f.paid_date) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="bg-soft font-semibold">
                    <td colSpan={3} className="text-right">
                      Total
                    </td>
                    <td className="text-right tabular-nums">{fmtMoney(totalFee)}</td>
                    <td colSpan={2}>Paid: {fmtMoney(paidFee)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'acct',
      label: 'Accounting',
      render: () => (
        <AcctCards accounts={form.acct_cards} onChange={(n) => setForm((f) => ({ ...f, acct_cards: n }))} />
      ),
    },
    {
      key: 'schedule',
      label: 'Schedule Calculate',
      render: () => (
        <div>
          <div className="mb-3 text-xs flex items-center gap-2">
            {form.prepaid ? (
              <span className="px-3 py-1 rounded bg-emerald-50 text-emerald-700 font-semibold">
                Prepaid Mode
              </span>
            ) : (
              <span className="px-3 py-1 rounded bg-amber-50 text-amber-700 font-semibold">
                Expense Mode
              </span>
            )}
            <span className="text-muted">
              {form.prepaid
                ? '(ตัดบัญชี Prepaid รายเดือนตามอายุ B/G–L/G)'
                : '(ติ๊ก ☐ PREPAID ใน Primary เพื่อดูตารางตัดบัญชีรายเดือน)'}
            </span>
          </div>
          {!form.prepaid ? (
            <div className="bg-soft border border-line rounded p-6 text-center text-muted text-sm">
              <div className="text-3xl text-gray-400 mb-2">📭</div>
              <div className="font-semibold text-ink">ไม่มีตารางคำนวณ</div>
              <div className="mt-1 text-xs">
                โหมด Expense — ค่าธรรมเนียมถูกบันทึกเป็นค่าใช้จ่ายทั้งจำนวนตอนจ่ายแล้ว ไม่มีการตัดบัญชีรายงวด
              </div>
            </div>
          ) : (
            <PrepaidSchedule
              form={form}
              totalFee={form.fee_amount || totalFee || 0}
              effFeeRate={effFeeRate}
              lgId={id}
            />
          )}
        </div>
      ),
    },
    {
      key: 'balance',
      label: 'Balance Summary',
      render: () => (
        <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
          <div className="space-y-2">
            <RowTip label="Guarantee Amount" value={`${fmtMoney(form.amount)} ${form.currency}`} bold />
            <RowTip label="Fee Rate (annual)" value={`${effFeeRate.toFixed(4)}%`} />
            <RowTip label="Payment Cycle" value={form.payment_cycle ?? '—'} />
            <RowTip label="Prepaid" value={form.prepaid ? '✓ Yes' : 'No'} />
          </div>
          <div className="space-y-2">
            <RowTip label="Total Fee (Scheduled)" value={fmtMoney(totalFee)} />
            <RowTip label="Total Fee (Paid)" value={fmtMoney(paidFee)} bold />
            <RowTip label="Total Fee (Outstanding)" value={fmtMoney(totalFee - paidFee)} />
          </div>
        </div>
        <RepaymentsReceived facilityId={id} />
        </div>
      ),
    },
    {
      key: 'rollover',
      label: 'Roll Over History',
      render: () => <RolloverHistory currentId={id ?? ''} />,
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
                LG / BG
              </span>
            </div>
            <DocumentTabGeneric
              parentId={id}
              ensureParentId={ensureLgId}
              bucketName="lg-documents"
              tableName="lg_documents"
              parentFkColumn="lg_id"
            />
          </div>
        </div>
      ),
    },
  ];

  const titleSub = mode === 'new' ? '+ New LG / BG' : form.name ?? form.lg_no;
  const canRollover = ['Approved', 'Active'].includes(form.status);
  const canTerminate = ['Approved', 'Active', 'Draft'].includes(form.status);

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tx/lg')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">BG-LG</h1>
          <p className="text-muted text-sm font-medium">{titleSub}</p>
        </div>

        {/* Actions menu */}
        <div ref={actionsRef} className="relative inline-block">
          <Button onClick={() => setShowActions((s) => !s)} disabled={!id}>
            <ChevronDown className="w-4 h-4" /> Actions
          </Button>
          {showActions && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-line rounded shadow-lg min-w-[220px] z-50">
              <button
                type="button"
                onClick={() => {
                  setShowActions(false);
                  if (canRollover) setShowRollover(true);
                  else toast.error('Roll Over ทำได้เฉพาะ Approved/Active');
                }}
                disabled={!canRollover || !can('lg', 'approve')}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft border-b border-line text-brand disabled:text-muted disabled:cursor-not-allowed"
              >
                🔁 Roll Over (ต่ออายุ)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowActions(false);
                  if (canTerminate) setShowTerminate(true);
                  else toast.error('Terminate ทำได้เฉพาะ Draft/Approved/Active');
                }}
                disabled={!canTerminate || !can('lg', 'approve')}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-soft text-ink disabled:text-muted disabled:cursor-not-allowed"
              >
                ⚠️ Terminate B/G, L/G
              </button>
            </div>
          )}
        </div>

        <Button variant="primary" disabled={save.isPending || !can('lg', 'edit')} title={!can('lg', 'edit') ? 'ไม่มีสิทธิ์แก้ไข LG/BG' : ''} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={() => navigate('/tx/lg')}>Cancel</Button>
      </div>

      <AuditFooter createdBy={(form as any).created_by} createdAt={(form as any).created_at} updatedBy={(form as any).updated_by} updatedAt={(form as any).updated_at} />

      <Section title="Primary Information">
        <PrimaryInfo form={form} setForm={setForm} caOptions={caOptions ?? []} />
      </Section>

      <Tabs tabs={tabs} defaultTab="fee" />

      {/* ROLL OVER MODAL */}
      <Modal
        open={showRollover}
        onClose={() => setShowRollover(false)}
        title="🔁 Roll Over Letter of Guarantee (B/G, L/G)"
        size="lg"
        footer={
          <>
            <Button onClick={() => setShowRollover(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => rollOver.mutate()}
              disabled={rollOver.isPending || !rolloverNew.new_expiry}
            >
              {rollOver.isPending ? 'Processing...' : 'Confirm Roll Over'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-xs text-muted mb-2">ระบบจะดำเนินการต่อไปนี้เมื่อยืนยัน:</div>
            <ol className="list-decimal list-inside text-xs space-y-1 text-gray-700 ml-2">
              <li>เปลี่ยน Status ของ B/G–L/G เดิมเป็น <strong>"Roll Over"</strong></li>
              <li>สร้าง B/G–L/G ใหม่ พร้อม <strong>Reference Contract</strong> ชี้กลับมาที่ฉบับเดิม</li>
              <li>คงเงื่อนไขเดิม (Beneficiary, Guarantee Amount, Purpose) — ผู้ใช้แก้ไขได้ภายหลัง</li>
              <li>ออก Journal Entry สำหรับ Fee งวดใหม่ — <strong>Dr. Fee Expense / Cr. AP Bank</strong></li>
            </ol>
          </div>

          <div className="bg-brand-light border border-brand p-4 rounded">
            <h4 className="font-bold mb-3 text-brand">📋 Roll Over Plan</h4>
            <table className="w-full text-sm">
              <tbody>
                <Tr label="B/G–L/G เดิม" value={form.name ?? form.lg_no} bold />
                <Tr label="Number เดิม" value={form.lg_no} />
                <Tr label="Beneficiary" value={form.beneficiary || '—'} />
                <Tr label="Guarantee Amount" value={`${fmtMoney(form.amount)} ${form.currency}`} bold />
                <Tr label="Expiry Date เดิม" value={fmtDate(form.expiry_date)} />
                <tr><td colSpan={2} className="pt-2 border-t border-brand"></td></tr>
                <Tr
                  label="B/G–L/G ใหม่"
                  value={
                    <Input
                      value={rolloverNew.new_name}
                      onChange={(e) => setRolloverNew((s) => ({ ...s, new_name: e.target.value }))}
                      placeholder={`${form.name ?? form.lg_no}-RO`}
                    />
                  }
                />
                <Tr
                  label="Issue Date ใหม่"
                  value={
                    <Input
                      type="date"
                      value={rolloverNew.new_issue}
                      onChange={(e) => setRolloverNew((s) => ({ ...s, new_issue: e.target.value }))}
                    />
                  }
                />
                <Tr
                  label="Expiry Date ใหม่"
                  value={
                    <Input
                      type="date"
                      value={rolloverNew.new_expiry}
                      onChange={(e) => setRolloverNew((s) => ({ ...s, new_expiry: e.target.value }))}
                    />
                  }
                />
                <Tr
                  label={`Fee งวดใหม่ (${effFeeRate.toFixed(2)}%/ปี)`}
                  value={`${fmtMoney(newRolloverFee)} ${form.currency}`}
                  highlight
                  bold
                />
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {/* TERMINATE MODAL */}
      <Modal
        open={showTerminate}
        onClose={() => setShowTerminate(false)}
        title="⚠️ Terminate B/G, L/G"
        size="md"
        footer={
          <>
            <Button onClick={() => setShowTerminate(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => terminate.mutate()}
              disabled={terminate.isPending}
            >
              {terminate.isPending ? 'Processing...' : 'Confirm Terminate'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded text-xs">
            <strong>⚠️ Terminate ก่อนกำหนด</strong> — เปลี่ยน Status เป็น "Terminated" และหยุดบันทึกค่าธรรมเนียมตั้งแต่วันนี้เป็นต้นไป
          </div>
          <p>
            ฉบับ <strong>{form.name ?? form.lg_no}</strong> Beneficiary: <strong>{form.beneficiary || '—'}</strong>
          </p>
          <p>Amount: {fmtMoney(form.amount)} {form.currency}</p>
          <p className="text-xs text-muted">หลังกด Confirm จะเปลี่ยน status ทันที — ไม่สามารถ undo ได้</p>
        </div>
      </Modal>
    </div>
  );
}

// =====================================================================
//  Primary Information — 3 columns matching HTML
// =====================================================================
function PrimaryInfo({
  form,
  setForm,
  caOptions,
}: {
  form: Form;
  setForm: React.Dispatch<React.SetStateAction<Form>>;
  caOptions: { id: string; ca_name: string }[];
}) {
  const isForeign = form.currency !== 'THB';
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
      {/* COL 1 */}
      <div className="space-y-4">
        <div>
          <FieldLabel>CREDIT AGREEMENT NAME</FieldLabel>
          <Select value={form.ca_id ?? ''} onChange={(e) => setForm((f) => ({ ...f, ca_id: e.target.value || null }))}>
            <option value="">— เลือก —</option>
            {caOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ca_name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel required>NAME</FieldLabel>
          <Input
            value={form.name ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="BGBBL001"
          />
        </div>
        <div>
          <FieldLabel tipKey="BANK REFERENCE">BANK REFERENCE</FieldLabel>
          <Input
            value={form.lg_no}
            onChange={(e) => setForm((f) => ({ ...f, lg_no: e.target.value }))}
            placeholder="PP112245777"
          />
        </div>
        <div>
          <FieldLabel>VALUE DATE</FieldLabel>
          <Input
            type="date"
            value={form.value_date ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, value_date: e.target.value || null }))}
          />
        </div>
        <div>
          <FieldLabel required>START DATE</FieldLabel>
          <Input
            type="date"
            value={form.issue_date}
            onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))}
          />
        </div>
        <div>
          <FieldLabel required>END DATE</FieldLabel>
          <Input
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
          />
        </div>
      </div>

      {/* COL 2 */}
      <div className="space-y-4">
        <div>
          <FieldLabel required>AMOUNT (THB)</FieldLabel>
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
          <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
            <option>THB</option>
            <option>USD</option>
            <option>EUR</option>
            <option>JPY</option>
          </Select>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <input
            id="lg-prepaid"
            type="checkbox"
            checked={form.prepaid}
            onChange={(e) => setForm((f) => ({ ...f, prepaid: e.target.checked }))}
            className="rounded"
          />
          <label htmlFor="lg-prepaid" className="text-sm font-semibold tracking-wide">
            PREPAID
          </label>
        </div>
        <div>
          <FieldLabel>AMOUNT (FOREIGN)</FieldLabel>
          <Input
            type="number"
            step="0.01"
            value={form.amount_foreign ?? ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, amount_foreign: e.target.value ? parseFloat(e.target.value) : null }))
            }
            className="text-right tabular-nums"
            disabled={!isForeign}
          />
        </div>
        <div>
          <FieldLabel>CONVERSION DATE</FieldLabel>
          <Input
            type="date"
            value={form.conversion_date ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, conversion_date: e.target.value || null }))}
            disabled={!isForeign}
          />
        </div>
        <div>
          <FieldLabel>CONVERSION RATE</FieldLabel>
          <Input
            type="number"
            step="0.000001"
            value={form.conversion_rate ?? ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, conversion_rate: e.target.value ? parseFloat(e.target.value) : null }))
            }
            className="text-right tabular-nums"
            disabled={!isForeign}
          />
        </div>
      </div>

      {/* COL 3 */}
      <div className="space-y-4">
        <div>
          <FieldLabel required>FACILITY TYPE</FieldLabel>
          <Select value={form.lg_type} onChange={(e) => setForm((f) => ({ ...f, lg_type: e.target.value }))}>
            {LG_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </div>
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
          <FieldLabel required>STATUS</FieldLabel>
          <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
            {LG_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel>BENEFICIARY</FieldLabel>
          <Input
            value={form.beneficiary}
            onChange={(e) => setForm((f) => ({ ...f, beneficiary: e.target.value }))}
            placeholder="การไฟฟ้านครหลวง"
          />
        </div>
        <div>
          <FieldLabel>REMARK</FieldLabel>
          <textarea
            className="input min-h-[80px]"
            value={form.remark ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
          />
        </div>
        <div>
          <FieldLabel>REFERENCE CONTRACT</FieldLabel>
          <Input
            value={form.reference_contract ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, reference_contract: e.target.value || null }))}
          />
        </div>
      </div>
    </div>
  );
}

interface SchedRow {
  period: number;
  paymentDate: string | null;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  feeRate: number;
  feeAmount: number;
  guaranteeAmount: number;
  remaining: number;
}

/**
 * Build daily-prorated monthly amortization schedule matching HTML.
 * - Period 0: payment row (full fee paid upfront)
 * - Period 1..N: month-end-based recognition, days × dailyRate
 */
function buildLGSchedule(
  issueDate: string,
  expiryDate: string,
  totalFee: number,
  feeRate: number,
  guaranteeAmount: number,
): SchedRow[] {
  if (!issueDate || !expiryDate || !totalFee) return [];
  const start = new Date(issueDate);
  const end = new Date(expiryDate);
  if (end <= start) return [];

  // Total days = days from issue → expiry (inclusive)
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  const dailyRate = totalFee / totalDays;

  const rows: SchedRow[] = [
    {
      period: 0,
      paymentDate: issueDate,
      startDate: null,
      endDate: null,
      days: null,
      feeRate,
      feeAmount: totalFee,
      guaranteeAmount,
      remaining: totalFee,
    },
  ];

  let cur = new Date(start);
  let remaining = totalFee;
  let p = 1;

  while (cur < end) {
    // End of current calendar month, or expiry if it comes first
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const periodEnd = monthEnd > end ? end : monthEnd;
    const days = Math.round((periodEnd.getTime() - cur.getTime()) / 86400000) + (p === 1 ? 0 : 1);
    // For first period: from cur to monthEnd inclusive on partial month
    // Simpler: use diff days. For first row: issue → monthEnd → days = (monthEnd - issue) days
    const actualDays =
      p === 1
        ? Math.round((periodEnd.getTime() - start.getTime()) / 86400000)
        : Math.round((periodEnd.getTime() - cur.getTime()) / 86400000) + 1;
    const amt = parseFloat((dailyRate * actualDays).toFixed(2));
    remaining = parseFloat((remaining - amt).toFixed(2));
    if (remaining < 0) remaining = 0;

    rows.push({
      period: p++,
      paymentDate: null,
      startDate: cur.toISOString().slice(0, 10),
      endDate: periodEnd.toISOString().slice(0, 10),
      days: actualDays,
      feeRate,
      feeAmount: amt,
      guaranteeAmount,
      remaining,
    });

    cur = new Date(periodEnd);
    cur.setDate(cur.getDate() + 1);
    if (cur > end) break;
  }

  // Fix last row's remaining to exactly 0 (rounding compensation)
  if (rows.length > 1) {
    rows[rows.length - 1].remaining = 0;
  }
  return rows;
}

function PrepaidSchedule({
  form,
  totalFee,
  effFeeRate,
  lgId,
}: {
  form: Form;
  totalFee: number;
  effFeeRate: number;
  lgId?: string;
}) {
  const rows = useMemo(
    () => buildLGSchedule(form.issue_date, form.expiry_date, totalFee, effFeeRate, form.amount),
    [form.issue_date, form.expiry_date, totalFee, effFeeRate, form.amount],
  );

  if (rows.length === 0) {
    const missing: string[] = [];
    if (!form.issue_date) missing.push('Start Date');
    if (!form.expiry_date) missing.push('End Date');
    if (!totalFee) missing.push('Fee Amount (ใน tab Fee → Payment)');
    if (form.issue_date && form.expiry_date && new Date(form.expiry_date) <= new Date(form.issue_date)) {
      missing.push('End Date ต้องมากกว่า Start Date');
    }
    return (
      <div className="text-center text-muted py-6">
        ต้องระบุ: <strong className="text-danger">{missing.join(' / ') || 'ข้อมูลครบ — กดเปิด tab ใหม่'}</strong>
        <div className="text-xs mt-1 italic">เพื่อสร้างตารางตัดบัญชี Prepaid รายเดือน</div>
      </div>
    );
  }

  // Take a sample period for JE preview (Period 1 if exists)
  const sampleRow = rows[1];

  return (
    <PrepaidScheduleInner
      form={form}
      rows={rows}
      sampleRow={sampleRow}
      totalFee={totalFee}
      lgId={lgId}
    />
  );
}

function PrepaidScheduleInner({
  form,
  rows,
  sampleRow,
  totalFee,
  lgId,
}: {
  form: Form;
  rows: SchedRow[];
  sampleRow: SchedRow | undefined;
  totalFee: number;
  lgId?: string;
}) {
  const qc = useQueryClient();

  // Check which periods already have ACTIVE posted JEs (net non-zero)
  // - Exclude reversal JEs (is_reversal=true) — they cancel out the original
  // - Exclude Reversed/Voided originals
  // → after reverse, period reverts to "Post JE" so user can re-post with corrected accounts
  const { data: postedPeriods } = useQuery({
    queryKey: ['je-posted-periods-lg', lgId],
    enabled: !!lgId,
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('source_period, status, is_reversal')
        .eq('source_type', 'LG_FEE')
        .eq('source_id', lgId!);
      const set = new Set<number>();
      (data ?? []).forEach((d: any) => {
        if (
          d.status === 'Posted' &&
          d.is_reversal !== true &&
          d.source_period != null
        ) {
          set.add(d.source_period);
        }
      });
      return set;
    },
  });

  const postPeriod = useMutation({
    mutationFn: async (r: SchedRow) => {
      if (!lgId) throw new Error('Save LG/BG ก่อน Post JE');
      const je = await createJE({
        source_type: 'LG_FEE',
        source_id: lgId,
        source_period: r.period,
        je_date: r.endDate ?? r.paymentDate ?? form.expiry_date,
        description: `${form.name ?? form.lg_no} — Period ${r.period} Fee Recognition`,
        remark: `${r.days} วัน × daily-rate`,
        lines: [
          {
            account_code: '5512201',
            account_name: 'L/G, B/G Expenses',
            dr: r.feeAmount,
            description: 'Recognize prepaid fee',
          },
          {
            account_code: '1193',
            account_name: 'Prepaid Expenses - L/G, B/G',
            cr: r.feeAmount,
            description: 'Reduce prepaid balance',
          },
        ],
      });
      await postJE(je.id, 'user');
      return je;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['je-posted-periods-lg', lgId] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('✓ JE Posted to GL');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <div className="overflow-x-auto max-h-[500px]">
        <table className="table-base">
          <thead className="sticky top-0 bg-white">
            <tr>
              <ThTip align="right">Period</ThTip>
              <ThTip>Payment Date</ThTip>
              <ThTip>Amortize Start Date</ThTip>
              <ThTip>Amortize End Date</ThTip>
              <ThTip align="right">Day</ThTip>
              <ThTip align="right">Fee Rate</ThTip>
              <ThTip align="right">Fee Amount</ThTip>
              <ThTip align="right">Guarantee Amount</ThTip>
              <ThTip align="right">Remaining</ThTip>
              <ThTip>JE</ThTip>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isPosted = postedPeriods?.has(r.period) ?? false;
              const canPost = r.period > 0 && !isPosted && !!lgId;
              return (
                <tr key={r.period}>
                  <td className="text-right tabular-nums">{r.period}</td>
                  <td>{r.paymentDate ? fmtDate(r.paymentDate) : '—'}</td>
                  <td>{r.startDate ? fmtDate(r.startDate) : '—'}</td>
                  <td>{r.endDate ? fmtDate(r.endDate) : '—'}</td>
                  <td className="text-right tabular-nums">{r.days ?? '—'}</td>
                  <td className="text-right tabular-nums">{r.feeRate.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.feeAmount)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.guaranteeAmount)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(r.remaining)}</td>
                  <td className="text-xs">
                    {r.period === 0 ? (
                      <span className="text-muted">—</span>
                    ) : isPosted ? (
                      <Badge variant="success">Posted</Badge>
                    ) : canPost ? (
                      <button
                        onClick={() => postPeriod.mutate(r)}
                        disabled={postPeriod.isPending}
                        className="text-brand hover:underline"
                      >
                        Post JE
                      </button>
                    ) : (
                      <span className="text-muted text-[10px]">Save first</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Periodic recognition JE preview — matches HTML */}
      {sampleRow && (
        <div className="mt-5">
          <div className="font-bold text-sm mb-2">
            📒 Monthly Recognition Journal{' '}
            <span className="font-normal text-muted text-xs">
              — ตัวอย่าง Period {sampleRow.period} ({sampleRow.days} วัน × {(totalFee / Math.max(1, rows.slice(1).reduce((s, r) => s + (r.days || 0), 0))).toFixed(2)} บาท/วัน = {fmtMoney(sampleRow.feeAmount)})
            </span>
          </div>
          <div className="max-w-2xl border border-line rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand text-white">
                  <ThTip className="px-4 py-2 text-left" tipKey="JV – L/G, B/G-FEE">JV — L/G, B/G-Fee</ThTip>
                  <ThTip align="center" className="px-4 py-2 w-32">DR</ThTip>
                  <ThTip align="center" className="px-4 py-2 w-32">CR</ThTip>
                </tr>
              </thead>
              <tbody className="bg-white">
                <tr>
                  <td className="px-4 py-2">Dr. L/G, B/G Expenses</td>
                  <td className="px-4 py-2 text-center tabular-nums">{fmtMoney(sampleRow.feeAmount)}</td>
                  <td className="px-4 py-2 text-center">—</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">Cr. Prepaid Expenses - L/G, B/G</td>
                  <td className="px-4 py-2 text-center">—</td>
                  <td className="px-4 py-2 text-center tabular-nums">{fmtMoney(sampleRow.feeAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RolloverHistory({ currentId }: { currentId: string }) {
  const { data: chain } = useQuery({
    queryKey: ['lg-rollover-chain', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const visited: any[] = [];
      let cur: any = currentId;
      while (cur) {
        const { data } = await supabase.from('letter_guarantees').select('*').eq('id', cur).maybeSingle();
        if (!data) break;
        visited.unshift(data);
        cur = data.rollover_parent_id;
      }
      let lastId = currentId;
      while (lastId) {
        const { data } = await supabase
          .from('letter_guarantees')
          .select('*')
          .eq('rollover_parent_id', lastId)
          .maybeSingle();
        if (!data) break;
        visited.push(data);
        lastId = data.id;
      }
      return visited;
    },
  });

  if (!chain || chain.length <= 1)
    return <div className="text-center text-muted py-6 italic text-sm">ยังไม่มีประวัติ Roll Over</div>;

  return (
    <div className="overflow-x-auto">
      <p className="text-xs text-muted mb-3 italic">📌 ประวัติการ Roll Over — แสดงโซ่ของ B/G–L/G (ฉบับเดิม → ฉบับใหม่)</p>
      <table className="table-base">
        <thead>
          <tr>
            <ThTip>#</ThTip>
            <ThTip tipKey="P/N NAME">Name</ThTip>
            <ThTip tipKey="BANK REFERENCE">Number</ThTip>
            <ThTip>Issue Date</ThTip>
            <ThTip>Expiry Date</ThTip>
            <ThTip align="right">Amount</ThTip>
            <ThTip>Status</ThTip>
          </tr>
        </thead>
        <tbody>
          {chain.map((r: any, i: number) => (
            <tr key={r.id} className={r.id === currentId ? 'bg-brand-light' : ''}>
              <td>{i + 1}</td>
              <td className="font-medium">
                {r.name ?? r.lg_no}
                {r.id === currentId && <span className="ml-2 text-xs">(current)</span>}
              </td>
              <td>{r.lg_no}</td>
              <td>{fmtDate(r.issue_date)}</td>
              <td>{fmtDate(r.expiry_date)}</td>
              <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
              <td>
                <Badge variant={r.status === 'Active' || r.status === 'Approved' ? 'success' : 'warn'}>
                  {r.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div className="flex justify-between border-b border-line py-2">
      <span className="text-muted text-sm">{label}</span>
      <span className={bold ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  );
}

function Tr({ label, value, bold, highlight }: { label: string; value: any; bold?: boolean; highlight?: boolean }) {
  return (
    <tr>
      <td className="py-1 text-muted text-xs w-44">{label}:</td>
      <td className={`py-1 ${bold ? 'font-semibold' : ''} ${highlight ? 'text-brand' : ''}`}>{value}</td>
    </tr>
  );
}
