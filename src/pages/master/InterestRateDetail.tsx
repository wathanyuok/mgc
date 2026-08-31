import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { CharCount, Button, Card, CardContent, Input, Select, FieldLabel } from '@/components/ui';
import { fmtPercent, fmtDateISO} from '@/lib/format';
import {
  type InterestRate,
  INTEREST_TYPES,
} from '@/types/database';
import { useBankCodes } from '@/lib/banks';

import { checkRequiredFields } from '@/lib/required-check';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { useUnsavedGuard } from '@/lib/unsaved-guard';

const blank: Omit<InterestRate, 'id' | 'effective_rate' | 'created_at' | 'updated_at'> = {
  finance_institution: 'BBL',
  interest_type: 'MLR',
  base_rate: 0,
  margin: 0,
  date_effective: fmtDateISO(new Date()),
  end_effective_date: null,
  status: 'Active',
  remark: null,
};

export function InterestRateDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<typeof blank>(blank);
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('master_interest', 'edit');
  // เตือนก่อนออกจากหน้าถ้ายังมีข้อมูลที่ยังไม่บันทึก
  const guard = useUnsavedGuard(form, () => navigate('/master/interest-rate'));

  const { data: existing } = useQuery({
    queryKey: ['ir', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('interest_rates').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as InterestRate;
    },
  });

  useEffect(() => {
    if (existing) {
      guard.reset({
        finance_institution: existing.finance_institution,
        interest_type: existing.interest_type,
        base_rate: existing.base_rate,
        margin: existing.margin,
        date_effective: existing.date_effective,
        end_effective_date: existing.end_effective_date,
        status: existing.status,
        remark: existing.remark,
      }, setForm);
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      // อัตราฐานต้องเป็นบวก — ติดลบทำให้อัตราสุทธิที่ส่งไปใช้ที่สัญญาติดลบตาม
      if (!(form.base_rate > 0)) {
        throw new Error('อัตราฐานต้องมากกว่า 0');
      }
      // อัตราสุทธิ (อัตราฐาน + ส่วนต่าง) ต้องเป็นบวก — ส่วนต่างติดลบได้แต่ห้ามกดจนติดลบ
      if (form.base_rate + form.margin <= 0) {
        throw new Error('อัตราสุทธิต้องมากกว่า 0 — ส่วนต่างติดลบมากเกินไป');
      }
      if (form.end_effective_date && form.end_effective_date < form.date_effective) {
        throw new Error('วันที่สิ้นสุดต้องไม่อยู่ก่อนวันที่เริ่มใช้');
      }
      // กันอัตราซ้ำ — ธนาคาร + ประเภท + วันที่เริ่มใช้เดียวกัน และยังใช้งานอยู่ทั้งคู่
      if (form.status === 'Active') {
        let dup = supabase
          .from('interest_rates')
          .select('id', { count: 'exact', head: true })
          .eq('finance_institution', form.finance_institution)
          .eq('interest_type', form.interest_type)
          .eq('date_effective', form.date_effective)
          .eq('status', 'Active');
        if (mode === 'edit' && id) dup = dup.neq('id', id);
        const { count, error: dupErr } = await dup;
        if (dupErr) {
          console.warn('[อัตราดอกเบี้ย] ตรวจซ้ำไม่สำเร็จ — ข้ามการตรวจ', dupErr);
        } else if ((count ?? 0) > 0) {
          throw new Error(
            `มีอัตรา ${form.interest_type} ของ ${form.finance_institution} ` +
            `ที่เริ่มใช้วันเดียวกันและยังใช้งานอยู่แล้ว — ` +
            `ถ้าเป็นการเปลี่ยนอัตรา ให้ปิดรายการเดิมก่อน (ใส่วันที่สิ้นสุด หรือเปลี่ยนสถานะเป็น Inactive)`,
          );
        }
      }
      if (mode === 'new') {
        const { data, error } = await supabase.from('interest_rates').insert(form).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('interest_rates')
          .update(form)
          .eq('id', id!)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['ir-list'] });
      guard.markSaved();
      toast.success(mode === 'new' ? 'สร้าง Interest Rate แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/master/interest-rate/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const effectiveRate = form.base_rate + form.margin;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={guard.leave}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Master Interest Rate</h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New Master Interest Rate' : `ID: ${id}`}
          </p>
        </div>
        <Button variant="primary" disabled={save.isPending || !canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={guard.leave}>Cancel</Button>
      </div>

      <Card>
        <CardContent>
          <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>FINANCE INSTITUTION</FieldLabel>
              <Select
                value={form.finance_institution}
                onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}
              >
                {bankCodes.map((fi) => (
                  <option key={fi}>{fi}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel required>INTEREST TYPE</FieldLabel>
              <Select
                value={form.interest_type}
                onChange={(e) => setForm((f) => ({ ...f, interest_type: e.target.value as any }))}
              >
                {INTEREST_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>STATUS</FieldLabel>
              <Select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}
              >
                <option>Active</option>
                <option>Inactive</option>
              </Select>
            </div>

            <div>
              <FieldLabel required>BASE RATE (%)</FieldLabel>
              <Input
                type="number"
                step="0.0001"
                value={form.base_rate}
                onChange={(e) => setForm((f) => ({ ...f, base_rate: parseFloat(e.target.value) || 0 }))}
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <FieldLabel>MARGIN (%)</FieldLabel>
              <Input
                type="number"
                step="0.0001"
                value={form.margin}
                onChange={(e) => setForm((f) => ({ ...f, margin: parseFloat(e.target.value) || 0 }))}
                className="text-right tabular-nums"
              />
            </div>
            <div>
              <FieldLabel tipKey="EFFECTIVE RATE">EFFECTIVE RATE (auto)</FieldLabel>
              <Input readOnly value={fmtPercent(effectiveRate)} className="bg-gray-50 text-right tabular-nums font-semibold text-brand" />
            </div>

            <div>
              <FieldLabel required>DATE EFFECTIVE</FieldLabel>
              <Input
                type="date"
                value={form.date_effective}
                onChange={(e) => setForm((f) => ({ ...f, date_effective: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel>END EFFECTIVE DATE</FieldLabel>
              <Input
                type="date"
                value={form.end_effective_date ?? ''}
                onChange={(e) =>
                  setForm((f) => ({ ...f, end_effective_date: e.target.value || null }))
                }
              />
              <p className="text-xs text-muted mt-1">เว้นว่าง = ยังใช้อยู่</p>
            </div>
            <div />

            <div className="md:col-span-3">
              <FieldLabel>REMARK</FieldLabel>
              <textarea maxLength={2000}
                className="input min-h-[80px]"
                value={form.remark ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
                placeholder="หมายเหตุเพิ่มเติม..."
              />
              <CharCount value={form.remark ?? ''} max={2000} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 bg-brand-light border-l-4 border-brand p-3 text-sm rounded">
        💡 <strong>Master Interest Rate</strong> — อัตราดอกเบี้ยอ้างอิงของธนาคารใช้สำหรับคำนวณดอกเบี้ยใน
        CA / P/N / OD / TR ที่ใช้ Floating Rate
      </div>
    </div>
  );
}
