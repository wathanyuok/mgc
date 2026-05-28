import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, FieldLabel } from '@/components/ui';
import { fmtPercent, fmtDateISO} from '@/lib/format';
import {
  type InterestRate,
  INTEREST_TYPES,
  FINANCE_INSTITUTIONS,
} from '@/types/database';

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
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<typeof blank>(blank);

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
      setForm({
        finance_institution: existing.finance_institution,
        interest_type: existing.interest_type,
        base_rate: existing.base_rate,
        margin: existing.margin,
        date_effective: existing.date_effective,
        end_effective_date: existing.end_effective_date,
        status: existing.status,
        remark: existing.remark,
      });
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
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
      toast.success(mode === 'new' ? 'สร้าง Interest Rate แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/master/interest-rate/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const effectiveRate = form.base_rate + form.margin;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/master/interest-rate')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Master Interest Rate</h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New Master Interest Rate' : `ID: ${id}`}
          </p>
        </div>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={() => navigate('/master/interest-rate')}>Cancel</Button>
      </div>

      <Card>
        <CardContent>
          <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel>FINANCE INSTITUTION *</FieldLabel>
              <Select
                value={form.finance_institution}
                onChange={(e) => setForm((f) => ({ ...f, finance_institution: e.target.value }))}
              >
                {FINANCE_INSTITUTIONS.map((fi) => (
                  <option key={fi}>{fi}</option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>INTEREST TYPE *</FieldLabel>
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
              <FieldLabel>BASE RATE (%) *</FieldLabel>
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
              <FieldLabel>DATE EFFECTIVE *</FieldLabel>
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
              <textarea
                className="input min-h-[80px]"
                value={form.remark ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value || null }))}
                placeholder="หมายเหตุเพิ่มเติม..."
              />
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
