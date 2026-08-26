// AR-AP Netting Tab — sub-component ของ FPDetail.tsx
// MoM workshop (Day 4 transcript §lines 85-100):
//   Netting ผูกตรงกับ Floor Plan payment scenarios — ไม่ใช่ generic AR-AP feature
//   จึงย้ายจากหน้า standalone (/tx/netting) มาเป็น Tab ใต้ Floor Plan
//
// Behavior:
//   • List netting rows ทั้งหมดของ FP นี้ (filter ar_ap_nettings.fp_id = fpId)
//   • Inline form expand เพื่อ Create / Edit row ใหม่
//   • Finance Institution = auto จาก parent FP (read-only)
//   • คงฟิลด์อื่น (Counterparty Vendor / AR / AP / Net / Direction / Status) เหมือนเดิม

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Save, PlayCircle, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Input, Select, Badge, FieldLabel, NumInput } from '@/components/ui';
import { fmtDate, fmtMoney, fmtDateISO } from '@/lib/format';
import {
  type ARAPNetting,
  type ARAPNettingStatus,
  type ARAPNettingDirection,
} from '@/types/database';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { computeNetting, executeNetting } from '@/lib/netting';
import { nextRunningNo } from '@/lib/running-no';
import { friendlySaveError } from '@/lib/save-error';

const STATUSES: ARAPNettingStatus[] = ['Draft', 'Approved', 'Executed', 'Cancelled'];

type Form = {
  id?: string;
  netting_no: string;
  counterparty_vendor_id: string;
  ar_amount: number;
  ap_amount: number;
  net_amount: number;
  direction: ARAPNettingDirection;
  netting_date: string;
  status: ARAPNettingStatus;
  je_id: string | null;
  remark: string | null;
};

const blankForm = (): Form => ({
  netting_no: '',
  counterparty_vendor_id: '',
  ar_amount: 0,
  ap_amount: 0,
  net_amount: 0,
  direction: 'receive',
  netting_date: fmtDateISO(new Date()),
  status: 'Draft',
  je_id: null,
  remark: null,
});

export function NettingTab({
  fpId,
  financeInstitution,
}: {
  fpId: string | undefined;
  financeInstitution: string;
}) {
  const qc = useQueryClient();
  const userLabel = useCurrentUserLabel();
  const { can: rawCan } = useAuth();
  const viewOnly = useReadOnly();
  // แท็บนี้อยู่ใต้สินเชื่อสต๊อกรถ ต้องตรวจสิทธิ์ด้วยรหัสเมนูของสินเชื่อสต๊อกรถ
  // เดิมตรวจด้วยรหัสเมนูการรับชำระ คนที่ไม่มีสิทธิ์สินเชื่อสต๊อกรถจึงทำรายการหักกลบได้
  const can = (a?: 'view' | 'edit' | 'approve') => !viewOnly && rawCan('fp', a);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Form>(blankForm());
  const formMode: 'new' | 'edit' = form.id ? 'edit' : 'new';

  // ── List of netting rows for this FP ──
  const { data: rows = [] } = useQuery({
    queryKey: ['fp-nettings', fpId],
    enabled: !!fpId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ar_ap_nettings')
        .select('*')
        .eq('fp_id', fpId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ARAPNetting[];
    },
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ['netting-vendors'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vendors')
        .select('id, code, name')
        .eq('active', true)
        .order('code');
      return (data ?? []) as { id: string; code: string; name: string }[];
    },
  });

  // Auto-recompute net + direction from AR / AP
  useEffect(() => {
    const { net, direction } = computeNetting(form.ar_amount, form.ap_amount);
    if (net !== form.net_amount || direction !== form.direction) {
      setForm((f) => ({ ...f, net_amount: net, direction }));
    }
  }, [form.ar_amount, form.ap_amount]);

  const selectedVendor = useMemo(
    () => vendors.find((v) => v.id === form.counterparty_vendor_id) ?? null,
    [vendors, form.counterparty_vendor_id],
  );

  const isLocked = form.status === 'Executed' || form.status === 'Cancelled';

  const openNew = () => {
    setForm(blankForm());
    setShowForm(true);
  };
  const openEdit = (r: ARAPNetting) => {
    setForm({
      id: r.id,
      netting_no: r.netting_no,
      counterparty_vendor_id: r.counterparty_vendor_id,
      ar_amount: r.ar_amount,
      ap_amount: r.ap_amount,
      net_amount: r.net_amount,
      direction: r.direction,
      netting_date: r.netting_date,
      status: r.status,
      je_id: r.je_id,
      remark: r.remark,
    });
    setShowForm(true);
  };
  const closeForm = () => {
    setShowForm(false);
    setForm(blankForm());
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!fpId) throw new Error('Save Floor Plan ก่อนสร้าง Netting');
      if (isLocked) throw new Error(`สถานะ ${form.status} — แก้ไขไม่ได้`);
      if (!form.counterparty_vendor_id) throw new Error('เลือก Counterparty (Vendor) ก่อน');
      // ยอดใดยอดหนึ่งเป็น 0 = ไม่มีอะไรให้หักกลบ · เดิมบันทึกผ่านแล้วได้ใบสำคัญบรรทัดละ 0
      if (!(form.ar_amount > 0)) throw new Error('ยอดลูกหนี้ (AR) ต้องมากกว่า 0');
      if (!(form.ap_amount > 0)) throw new Error('ยอดเจ้าหนี้ (AP) ต้องมากกว่า 0');

      let nettingNo = (form.netting_no ?? '').trim();
      // เดิมสร้างจากเวลาปัจจุบัน (ตัด 8 หลักท้าย) — สองเครื่องกดพร้อมกันมีสิทธิ์ได้เลขเดียวกัน
      // ใช้ตัวออกเลขที่กลางชุดเดียวกับโมดูลอื่น ซึ่งเดินเลขไม่ซ้ำจากฐานข้อมูล
      if (!nettingNo) nettingNo = await nextRunningNo('NETT');

      const payload = {
        netting_no: nettingNo,
        finance_institution: financeInstitution,
        finance_institution_id: null,
        counterparty_vendor_id: form.counterparty_vendor_id,
        ar_amount: form.ar_amount,
        ap_amount: form.ap_amount,
        net_amount: form.net_amount,
        direction: form.direction,
        netting_date: form.netting_date,
        status: form.status,
        je_id: form.je_id,
        remark: form.remark,
        fp_id: fpId,
        updated_by: userLabel,
      };

      if (formMode === 'new') {
        const { data, error } = await supabase
          .from('ar_ap_nettings')
          .insert({ ...payload, created_by: userLabel })
          .select()
          .single();
        if (error) throw error;
        return data.id as string;
      } else {
        const { error } = await supabase
          .from('ar_ap_nettings')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', form.id!);
        if (error) throw error;
        return form.id!;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fp-nettings', fpId] });
      toast.success('บันทึก Netting แล้ว');
      closeForm();
    },
    onError: (e: any) => toast.error(friendlySaveError(e)),
  });

  const execute = useMutation({
    mutationFn: async (rowId: string) => {
      if (!can('approve')) throw new Error('ไม่มีสิทธิ์ทำรายการหักกลบ');
      const { data: row, error } = await supabase
        .from('ar_ap_nettings')
        .select('*')
        .eq('id', rowId)
        .single();
      if (error) throw error;
      const r = row as ARAPNetting;
      // ต้องอนุมัติก่อนถึงทำได้ — เดิมทำได้ตั้งแต่ยังเป็นฉบับร่าง ข้ามการอนุมัติไปเลย
      if (r.status !== 'Approved') {
        throw new Error(
          r.status === 'Draft'
            ? 'ยังเป็นฉบับร่าง — เปลี่ยนสถานะเป็น Approved ก่อนจึงทำรายการหักกลบได้'
            : `สถานะ ${r.status} — ทำรายการหักกลบไม่ได้`,
        );
      }
      if (!(r.ar_amount > 0) || !(r.ap_amount > 0)) {
        throw new Error('ยอดลูกหนี้และยอดเจ้าหนี้ต้องมากกว่า 0 ทั้งคู่');
      }
      const v = vendors.find((x) => x.id === r.counterparty_vendor_id);
      const label = v ? `${v.code} ${v.name}` : r.counterparty_vendor_id;
      return executeNetting(r, label);
    },
    onSuccess: (jeNo) => {
      qc.invalidateQueries({ queryKey: ['fp-nettings', fpId] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Executed · JE ${jeNo}`);
    },
    onError: (e: any) => toast.error(friendlySaveError(e)),
  });

  // ถามยืนยันก่อนทำรายการหักกลบ — ปุ่มนี้สร้างใบสำคัญทางบัญชีทันที ย้อนกลับไม่ได้ง่ายๆ
  const confirmExecute = (r: { netting_no: string; net_amount: number; direction: ARAPNettingDirection; counterparty_vendor_id: string; id: string }) => {
    const v = vendors.find((x) => x.id === r.counterparty_vendor_id);
    const ok = confirm(
      `ทำรายการหักกลบ ${r.netting_no}?\n\n` +
      `คู่ค้า: ${v ? `${v.code} — ${v.name}` : r.counterparty_vendor_id}\n` +
      `${r.direction === 'receive' ? 'รับ' : 'จ่าย'}สุทธิ: ${fmtMoney(r.net_amount)} บาท\n\n` +
      `ระบบจะสร้างใบสำคัญทางบัญชีทันที และรายการจะถูกล็อกไม่ให้แก้ไขอีก`,
    );
    if (ok) execute.mutate(r.id);
  };

  const setF = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const vendorLabel = (vid: string) => {
    const v = vendors.find((x) => x.id === vid);
    return v ? `${v.code} — ${v.name}` : vid;
  };

  const statusVariant = (s: ARAPNettingStatus) =>
    s === 'Executed' ? 'success' : s === 'Cancelled' ? 'danger' : s === 'Approved' ? 'brand' : 'warn';

  return (
    <div className="space-y-4">
      {/* Subtitle */}
      <div className="bg-blue-50 border-l-4 border-brand rounded p-3 text-xs leading-relaxed">
        <div className="font-semibold text-brand-dark">AR-AP Netting</div>
        <div className="text-muted">
          หักลบ AR ↔ AP ของคู่ค้ารายเดียวกัน · เฉพาะธนาคารเดียวกับวงเงิน Floor Plan
        </div>
        <div className="text-[11px] text-muted mt-1">
          Finance Institution:{' '}
          <strong className="text-ink">{financeInstitution}</strong> (ดึงจาก Floor Plan อัตโนมัติ)
        </div>
      </div>

      {/* List + New button */}
      <div className="flex justify-between items-center">
        <div className="text-sm font-semibold">
          Netting Records ({rows.length})
        </div>
        <Button
          variant="primary"
          onClick={openNew}
          disabled={!fpId || !can('edit') || showForm}
          title={!fpId ? 'Save Floor Plan ก่อน' : !can('edit') ? 'ไม่มีสิทธิ์แก้ไข' : 'สร้าง Netting Record ใหม่'}
        >
          <Plus className="w-4 h-4" /> New Netting
        </Button>
      </div>

      {/* List Table */}
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>NETTING NO</th>
              <th>DATE</th>
              <th>COUNTERPARTY</th>
              <th className="text-right">AR</th>
              <th className="text-right">AP</th>
              <th className="text-right">NET</th>
              <th>DIRECTION</th>
              <th>STATUS</th>
              <th>JE</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-muted py-6 italic">
                  — ยังไม่มี Netting Record — กด <strong>+ New Netting</strong> เพื่อเพิ่ม —
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-xs">{r.netting_no}</td>
                <td>{fmtDate(r.netting_date)}</td>
                <td>{vendorLabel(r.counterparty_vendor_id)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.ar_amount)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.ap_amount)}</td>
                <td className="text-right tabular-nums font-semibold">{fmtMoney(r.net_amount)}</td>
                <td>
                  {r.direction === 'receive' ? (
                    <span className="text-success text-xs">รับ</span>
                  ) : (
                    <span className="text-danger text-xs">จ่าย</span>
                  )}
                </td>
                <td>
                  <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                </td>
                <td className="text-xs">
                  {r.je_id ? (
                    <a className="text-brand hover:underline" href={`/je/${r.je_id}`}>
                      เปิด JE
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="text-xs">
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="text-brand hover:underline mr-2"
                    disabled={showForm}
                  >
                    Edit
                  </button>
                  {r.status === 'Approved' && (
                    <button
                      type="button"
                      onClick={() => confirmExecute(r)}
                      disabled={execute.isPending || !can('approve')}
                      className="text-emerald-700 hover:underline disabled:text-muted disabled:no-underline disabled:cursor-not-allowed"
                      title={!can('approve') ? 'ไม่มีสิทธิ์ทำรายการหักกลบ' : 'ทำรายการหักกลบ (สร้างใบสำคัญ)'}
                    >
                      Execute
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Inline Form */}
      {showForm && (
        <div className="border border-line rounded-lg p-4 bg-soft space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sm">
              {formMode === 'new' ? '+ สร้าง Netting Record ใหม่' : `แก้ไข ${form.netting_no}`}
            </div>
            <button type="button" onClick={closeForm} className="text-muted hover:text-ink">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel>NETTING NO</FieldLabel>
              <Input
                value={form.netting_no}
                onChange={(e) => setF('netting_no', e.target.value)}
                placeholder="auto NETT-xxxxxxxx"
                disabled={isLocked}
              />
            </div>
            <div>
              <FieldLabel>FINANCE INSTITUTION</FieldLabel>
              <Input value={financeInstitution} readOnly className="bg-gray-50 text-muted" />
              <p className="text-[10px] text-muted mt-0.5 italic">
                ดึงจาก Floor Plan อัตโนมัติ — เฉพาะธนาคารเดียวกัน
              </p>
            </div>
            <div>
              <FieldLabel required>NETTING DATE</FieldLabel>
              <Input
                type="date"
                value={form.netting_date}
                onChange={(e) => setF('netting_date', e.target.value)}
                disabled={isLocked}
              />
            </div>
            <div className="md:col-span-2">
              <FieldLabel required>COUNTERPARTY (Customer AND Vendor)</FieldLabel>
              <Select
                value={form.counterparty_vendor_id}
                onChange={(e) => setF('counterparty_vendor_id', e.target.value)}
                disabled={isLocked}
              >
                <option value="">— เลือก Vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code} — {v.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>STATUS</FieldLabel>
              <Select
                value={form.status}
                onChange={(e) => setF('status', e.target.value as ARAPNettingStatus)}
                disabled={form.status === 'Executed'}
              >
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>AR AMOUNT (เขาเป็นหนี้เรา)</FieldLabel>
              <NumInput
                value={form.ar_amount}
                onChange={(v) => setF('ar_amount', v)}
                readOnly={isLocked}
              />
            </div>
            <div>
              <FieldLabel required>AP AMOUNT (เราเป็นหนี้เขา)</FieldLabel>
              <NumInput
                value={form.ap_amount}
                onChange={(v) => setF('ap_amount', v)}
                readOnly={isLocked}
              />
            </div>
            <div>
              <FieldLabel>NET AMOUNT (auto)</FieldLabel>
              <NumInput value={form.net_amount} onChange={() => {}} readOnly />
              <p className="text-[10px] text-muted mt-0.5 italic">|AR − AP|</p>
            </div>
          </div>

          <div className="rounded border border-line bg-white p-3 text-sm">
            <div className="font-semibold mb-1">สรุปการ Net</div>
            {form.direction === 'receive' ? (
              <div>
                MGC จะ <strong className="text-success">รับ</strong> {fmtMoney(form.net_amount)} THB จาก{' '}
                {selectedVendor ? <strong>{selectedVendor.name}</strong> : '—'}
                {' '}(AR {fmtMoney(form.ar_amount)} − AP {fmtMoney(form.ap_amount)})
              </div>
            ) : (
              <div>
                MGC จะ <strong className="text-danger">จ่าย</strong> {fmtMoney(form.net_amount)} THB ให้{' '}
                {selectedVendor ? <strong>{selectedVendor.name}</strong> : '—'}
                {' '}(AP {fmtMoney(form.ap_amount)} − AR {fmtMoney(form.ar_amount)})
              </div>
            )}
          </div>

          <div>
            <FieldLabel>REMARK</FieldLabel>
            <textarea
              className="w-full border border-line rounded p-2 text-sm"
              rows={2}
              value={form.remark ?? ''}
              onChange={(e) => setF('remark', e.target.value || null)}
              disabled={isLocked}
              placeholder="หมายเหตุ / Reference"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button onClick={closeForm}>Cancel</Button>
            {formMode === 'edit' && form.id && form.status === 'Approved' && (
              <Button
                variant="outline"
                onClick={() => confirmExecute({
                  id: form.id!,
                  netting_no: form.netting_no,
                  net_amount: form.net_amount,
                  direction: form.direction,
                  counterparty_vendor_id: form.counterparty_vendor_id,
                })}
                disabled={execute.isPending || !can('approve')}
                title={!can('approve') ? 'ไม่มีสิทธิ์ทำรายการหักกลบ' : 'ทำรายการหักกลบ (สร้างใบสำคัญ)'}
              >
                <PlayCircle className="w-4 h-4" /> Execute (Post JE)
              </Button>
            )}
            <Button
              variant="primary"
              disabled={save.isPending || isLocked || !can('edit')}
              onClick={() => save.mutate()}
            >
              <Save className="w-4 h-4" /> {save.isPending ? 'กำลังบันทึก…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
