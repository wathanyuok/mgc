import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, FieldLabel } from '@/components/ui';
import { ThTip, TipLabel } from '@/components/tx/TipHelpers';
import { type Curtailment, VENDORS, VEHICLE_TYPES } from '@/types/database';
import { useDealerVendorNames } from '@/lib/vendors';

import { fmtDateISO } from '@/lib/format';
import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { useUnsavedGuard } from '@/lib/unsaved-guard';

type CurtailmentForm = Omit<Curtailment, 'id' | 'created_at' | 'updated_at'>;

const blank: CurtailmentForm = {
  vendor: VENDORS[0],
  vehicle_type: VEHICLE_TYPES[0],
  effective_start_date: fmtDateISO(new Date()),
  effective_end_date: null,
  tier1_days: null,
  tier1_pct: null,
  tier2_days: null,
  tier2_pct: null,
  tier3_days: null,
  tier3_pct: null,
  tier4_days: null,
  tier4_pct: null,
  tier5_days: null,
  tier5_pct: null,
  tier6_days: null,
  tier6_pct: null,
  status: 'Active',
  remark: null,
};

const TIER_LABELS = ['1st', '2nd', '3rd', '4th', '5th', '6th'] as const;

export function CurtailmentDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { names: vendorNames } = useDealerVendorNames(); // Vendor Master — ชุดเดียวกับ FP
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<CurtailmentForm>(blank);
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('master_curtailment', 'edit');
  const guard = useUnsavedGuard(form, () => navigate('/master/curtailment'));

  const { data: existing } = useQuery({
    queryKey: ['curt', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('curtailments').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Curtailment;
    },
  });

  useEffect(() => {
    if (existing) {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = existing;
      guard.reset(rest, setForm);
    }
  }, [existing]);

  // BR-MST-CT-002 + FR-MST-CT-003 — compute Total % sum + Days sort warning
  const tierStats = useMemo(() => {
    const tiers = ([1, 2, 3, 4, 5, 6] as const).map((t) => ({
      tier: t,
      days: form[`tier${t}_days` as const] as number | null,
      pct: form[`tier${t}_pct` as const] as number | null,
    }));
    const totalPct = tiers.reduce((s, x) => s + (x.pct ?? 0), 0);
    const pctExceeded = totalPct > 100.01; // tolerance for float rounding

    // Days sort check — only compare consecutive non-null tiers
    const filledDays = tiers.filter((x) => x.days != null).map((x) => x.days as number);
    let outOfOrder = false;
    for (let i = 1; i < filledDays.length; i++) {
      if (filledDays[i] <= filledDays[i - 1]) {
        outOfOrder = true;
        break;
      }
    }
    // ขั้นที่กรอกอย่างน้อยหนึ่งช่อง ถือว่าผู้ใช้ตั้งใจใช้ขั้นนั้น
    const touched = tiers.filter((x) => x.days != null || x.pct != null);
    const filledCount = touched.length;
    // กรอกครึ่งเดียว — มีวันแต่ไม่มีเปอร์เซ็นต์ หรือกลับกัน
    const halfFilled = touched
      .filter((x) => x.days == null || x.pct == null)
      .map((x) => x.tier);
    // ค่าติดลบหรือศูนย์ — ไม่มีความหมายทั้งจำนวนวันและเปอร์เซ็นต์
    const nonPositive = touched
      .filter((x) => (x.days != null && x.days <= 0) || (x.pct != null && x.pct <= 0))
      .map((x) => x.tier);
    return { totalPct, pctExceeded, outOfOrder, filledCount, halfFilled, nonPositive };
  }, [form]);

  const save = useMutation({
    mutationFn: async () => {
      // ต้องมีอย่างน้อย 1 ขั้น — เงื่อนไขที่ไม่มีขั้นเลยเอาไปคำนวณอะไรไม่ได้
      if (tierStats.filledCount === 0) {
        throw new Error('ต้องกรอกอย่างน้อย 1 ขั้น — ระบุจำนวนวันและเปอร์เซ็นต์');
      }
      // กรอกครึ่งเดียวไม่ได้ — ขั้นที่มีกำหนดวันต้องบอกด้วยว่าต้องจ่ายกี่เปอร์เซ็นต์
      if (tierStats.halfFilled.length) {
        throw new Error(
          `ขั้นที่ ${tierStats.halfFilled.join(', ')} กรอกไม่ครบ — ต้องใส่ทั้งจำนวนวันและเปอร์เซ็นต์`,
        );
      }
      // ค่าติดลบหรือศูนย์หลุดการตรวจผลรวมมาได้ จึงต้องดักแยก
      if (tierStats.nonPositive.length) {
        throw new Error(
          `ขั้นที่ ${tierStats.nonPositive.join(', ')} มีค่าที่ไม่ถูกต้อง — จำนวนวันและเปอร์เซ็นต์ต้องมากกว่า 0`,
        );
      }
      if (form.effective_end_date && form.effective_end_date < form.effective_start_date) {
        throw new Error('วันที่สิ้นสุดต้องไม่อยู่ก่อนวันที่เริ่มใช้');
      }
      // กันช่วงเวลาซ้อนทับ — ผู้จำหน่ายและประเภทรถเดียวกัน ที่ยังใช้งานอยู่ทั้งคู่
      // ถ้าซ้อนกัน หน้าสัญญาจะหยิบชุดที่เริ่มใช้ใหม่สุดไปใช้ ซึ่งเดาไม่ได้ว่าชุดไหน
      if (form.status === 'Active') {
        let ov = supabase
          .from('curtailments')
          .select('effective_start_date, effective_end_date')
          .ilike('vendor', form.vendor.trim())
          .eq('vehicle_type', form.vehicle_type)
          .eq('status', 'Active');
        if (mode === 'edit' && id) ov = ov.neq('id', id);
        const { data: others, error: ovErr } = await ov;
        if (ovErr) {
          console.warn('[ทยอยลดต้น] ตรวจช่วงซ้อนไม่สำเร็จ — ข้ามการตรวจ', ovErr);
        } else {
          const aStart = form.effective_start_date;
          const aEnd = form.effective_end_date ?? '9999-12-31';
          const clash = (others ?? []).find((o: any) => {
            const bStart = o.effective_start_date as string;
            const bEnd = (o.effective_end_date as string | null) ?? '9999-12-31';
            return aStart <= bEnd && bStart <= aEnd;   // 2 ช่วงคาบเกี่ยวกัน
          });
          if (clash) {
            const to = clash.effective_end_date ?? 'ไม่มีกำหนด';
            throw new Error(
              `ช่วงเวลาซ้อนกับเงื่อนไขที่มีอยู่ของ ${form.vendor} (${form.vehicle_type}) ` +
              `ช่วง ${clash.effective_start_date} ถึง ${to} — ` +
              `ให้ใส่วันที่สิ้นสุดให้ชุดเดิมก่อน หรือเปลี่ยนสถานะชุดเดิมเป็น Inactive`,
            );
          }
        }
      }
      // BR-MST-CT-001 — block save if Days not in ascending order
      if (tierStats.outOfOrder) {
        throw new Error(
          `Days ต้องเรียงน้อย→มาก (tier1 < tier2 < … < tier6) — milestone ตามเวลา (BR-MST-CT-001)`,
        );
      }
      // BR-MST-CT-002 — block save if % sum > 100%
      if (tierStats.pctExceeded) {
        throw new Error(
          `% เงินต้นทุกขั้น (${tierStats.totalPct.toFixed(2)}%) เกิน 100% — กรุณาแก้ % แต่ละ tier (BR-MST-CT-002)`,
        );
      }
      if (mode === 'new') {
        const { data, error } = await supabase.from('curtailments').insert(form).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('curtailments')
          .update(form)
          .eq('id', id!)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: (data: any) => {
      logSave('curtailments', data ?? id, `${form.vendor} · ${form.vehicle_type}`, mode === 'new');
      qc.invalidateQueries({ queryKey: ['curt-list'] });
      guard.markSaved();
      toast.success(mode === 'new' ? 'สร้าง Curtailment แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/master/curtailment/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const title = mode === 'new' ? '+ New Curtailment' : `${form.vendor} — ${form.vehicle_type}`;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={guard.leave}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Curtailment</h1>
          <p className="text-muted text-sm font-medium">{title}</p>
        </div>
        <Button variant="primary" disabled={save.isPending || !canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={guard.leave}>Cancel</Button>
      </div>

      <Card className="mb-4">
        <CardContent>
          <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>VENDOR</FieldLabel>
              <Select value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}>
                {vendorNames.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel required>TYPE</FieldLabel>
              <Select
                value={form.vehicle_type}
                onChange={(e) => setForm((f) => ({ ...f, vehicle_type: e.target.value }))}
              >
                {VEHICLE_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>STATUS</FieldLabel>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
                <option>Active</option>
                <option>Inactive</option>
              </Select>
            </div>
            <div>
              <FieldLabel required>EFFECTIVE START DATE</FieldLabel>
              <Input
                type="date"
                value={form.effective_start_date}
                onChange={(e) => setForm((f) => ({ ...f, effective_start_date: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel>EFFECTIVE END DATE</FieldLabel>
              <Input
                type="date"
                value={form.effective_end_date ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, effective_end_date: e.target.value || null }))}
              />
            </div>
            <div />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h3 className="font-semibold text-sm tracking-wide mb-4">Curtailment Tiers</h3>
          <p className="text-xs text-muted mb-4">
            ระยะเวลาที่ครบกำหนดผ่อนชำระตามเงื่อนไข Floor Plan (วันนับจากวันรับสินค้า) และเปอร์เซ็นต์ที่ต้องชำระ
          </p>
          <table className="table-base">
            <thead>
              <tr>
                <th></th>
                <ThTip align="right" tipKey="CURTAILMENT DAYS">Days</ThTip>
                <ThTip align="right" tipKey="CURTAILMENT PCT">%</ThTip>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3, 4, 5, 6] as const).map((tier) => {
                const daysKey = `tier${tier}_days` as const;
                const pctKey = `tier${tier}_pct` as const;
                return (
                  <tr key={tier}>
                    <td className="font-medium">
                      <TipLabel tipKey="CURTAILMENT TIER">
                        {TIER_LABELS[tier - 1]} Curtailment
                      </TipLabel>
                    </td>
                    <td>
                      <Input
                        type="number"
                        value={form[daysKey] ?? ''}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            [daysKey]: e.target.value ? parseInt(e.target.value) : null,
                          }))
                        }
                        className="text-right tabular-nums"
                        placeholder="180"
                      />
                    </td>
                    <td>
                      <Input
                        type="number"
                        step="0.01"
                        value={form[pctKey] ?? ''}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            [pctKey]: e.target.value ? parseFloat(e.target.value) : null,
                          }))
                        }
                        className="text-right tabular-nums"
                        placeholder="15"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-soft">
                <td className="font-semibold"><TipLabel tipKey="CURTAILMENT TOTAL PCT">Total %</TipLabel></td>
                <td></td>
                <td
                  className={`text-right tabular-nums font-semibold ${
                    tierStats.pctExceeded ? 'text-danger' : ''
                  }`}
                >
                  {tierStats.totalPct.toFixed(2)}%
                  {tierStats.pctExceeded && (
                    <span className="ml-1 text-xs font-normal">(เกิน 100%!)</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* FR-MST-CT-003 + BR-MST-CT-001/002 — validation banners */}
          {tierStats.pctExceeded && (
            <div className="mt-3 flex items-center gap-2 text-sm rounded border border-red-200 bg-red-50 text-red-800 px-3 py-2">
              <AlertTriangle className="w-4 h-4" />
              <span>
                <strong>BR-MST-CT-002:</strong> ผลรวม % เงินต้นทุกขั้นต้อง ≤ 100% — ตอนนี้{' '}
                <strong>{tierStats.totalPct.toFixed(2)}%</strong> · กด Save ไม่ได้
              </span>
            </div>
          )}
          {tierStats.halfFilled.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm rounded border border-red-200 bg-red-50 text-red-800 px-3 py-2">
              <AlertTriangle className="w-4 h-4" />
              <span>
                ขั้นที่ <strong>{tierStats.halfFilled.join(', ')}</strong> กรอกไม่ครบ —
                ต้องใส่ทั้งจำนวนวันและเปอร์เซ็นต์ · กด Save ไม่ได้
              </span>
            </div>
          )}
          {tierStats.nonPositive.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm rounded border border-red-200 bg-red-50 text-red-800 px-3 py-2">
              <AlertTriangle className="w-4 h-4" />
              <span>
                ขั้นที่ <strong>{tierStats.nonPositive.join(', ')}</strong> มีค่าที่ไม่ถูกต้อง —
                จำนวนวันและเปอร์เซ็นต์ต้องมากกว่า 0 · กด Save ไม่ได้
              </span>
            </div>
          )}
          {tierStats.outOfOrder && (
            <div className="mt-3 flex items-center gap-2 text-sm rounded border border-red-200 bg-red-50 text-red-800 px-3 py-2">
              <AlertTriangle className="w-4 h-4" />
              <span>
                <strong>BR-MST-CT-001:</strong> Days ต้องเรียงน้อย→มาก (tier1 &lt; tier2 &lt; … &lt; tier6) —
                milestone ตามเวลา · กด Save ไม่ได้
              </span>
            </div>
          )}

          <div className="mt-4">
            <FieldLabel>REMARK</FieldLabel>
            <textarea
              className="input min-h-[80px]"
              value={form.remark ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
              placeholder="หมายเหตุ..."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
