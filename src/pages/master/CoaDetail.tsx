import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, FieldLabel } from '@/components/ui';
import type { GLAccount } from '@/types/database';

type CoaForm = {
  company: string;
  code: string;
  name: string;
  fs_no: string;
  fs_group: string;
  nfs_group: string;
  inactive: boolean;
};

const blank: CoaForm = {
  company: '',
  code: '',
  name: '',
  fs_no: '',
  fs_group: '',
  nfs_group: '',
  inactive: false,
};

export function CoaDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<CoaForm>(blank);

  const { data: existing } = useQuery({
    queryKey: ['coa', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('gl_accounts').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as GLAccount;
    },
  });

  useEffect(() => {
    if (existing) {
      setForm({
        company: existing.company ?? '',
        code: existing.code,
        name: existing.name,
        fs_no: existing.fs_no ?? '',
        fs_group: existing.fs_group ?? '',
        nfs_group: existing.nfs_group ?? '',
        inactive: existing.inactive,
      });
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        company: form.company || null,
        code: form.code,
        name: form.name,
        fs_no: form.fs_no || null,
        fs_group: form.fs_group || null,
        nfs_group: form.nfs_group || null,
        inactive: form.inactive,
      };
      if (mode === 'new') {
        const { data, error } = await supabase.from('gl_accounts').insert(payload).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase.from('gl_accounts').update(payload).eq('id', id!).select().single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['coa-list'] });
      toast.success(mode === 'new' ? 'สร้างบัญชีแล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/master/coa/${data.id}`);
    },
    onError: (e: any) => {
      // BR-MST-COA-001: Friendly error for UNIQUE (company, code) violation (Postgres code 23505)
      const isDupKey =
        e?.code === '23505' ||
        /uq_gl_accounts_company_code|duplicate key|unique constraint/i.test(e?.message ?? '');
      if (isDupKey) {
        const companyLabel = form.company || '(ทุกบริษัท)';
        toast.error(`บัญชี ${form.code} มีอยู่แล้วใน ${companyLabel}`, {
          description: 'BR-MST-COA-001: Code ต้องไม่ซ้ำในบริษัทเดียวกัน · กรุณาเปลี่ยน Code หรือเลือกบริษัทอื่น',
          duration: 8000,
        });
        return;
      }
      toast.error(e?.message ?? 'บันทึกไม่สำเร็จ');
    },
  });

  const canSave = form.code.trim() !== '' && form.name.trim() !== '';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/master/coa')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Chart of Accounts</h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New Account' : `${form.code} — ${form.name}`}
          </p>
        </div>
        <Button variant="primary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={() => navigate('/master/coa')}>Cancel</Button>
      </div>

      <Card>
        <CardContent>
          <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel tipKey="COA_COMPANY">COMPANY</FieldLabel>
              <Input
                placeholder="เช่น MGC Asia"
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel tipKey="COA_CODE">CODE *</FieldLabel>
              <Input
                placeholder="รหัสบัญชี (ตรงกับ NetSuite)"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel tipKey="COA_STATUS">STATUS</FieldLabel>
              <Select
                value={form.inactive ? 'Inactive' : 'Active'}
                onChange={(e) => setForm((f) => ({ ...f, inactive: e.target.value === 'Inactive' }))}
              >
                <option>Active</option>
                <option>Inactive</option>
              </Select>
            </div>

            <div className="md:col-span-3">
              <FieldLabel tipKey="COA_ACCOUNT_NAME">ACCOUNT NAME *</FieldLabel>
              <Input
                placeholder="ชื่อบัญชี"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div>
              <FieldLabel tipKey="COA_FS_NO">FS No.</FieldLabel>
              <Input
                placeholder="เลขที่งบการเงิน"
                value={form.fs_no}
                onChange={(e) => setForm((f) => ({ ...f, fs_no: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel tipKey="COA_FS_GROUP">FS GROUP</FieldLabel>
              <Input
                placeholder="เช่น Current Assets"
                value={form.fs_group}
                onChange={(e) => setForm((f) => ({ ...f, fs_group: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel tipKey="COA_NFS_GROUP">NFS GROUP</FieldLabel>
              <Input
                placeholder="กลุ่มย่อยเสริม"
                value={form.nfs_group}
                onChange={(e) => setForm((f) => ({ ...f, nfs_group: e.target.value }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 bg-brand-light border-l-4 border-brand p-3 text-sm rounded">
        💡 <strong>Chart of Accounts</strong> — ผังบัญชีสำหรับ Account Mapping. ใช้ <strong>Inactive</strong> เพื่อพักการใช้งานบัญชี (ไม่รองรับการลบ — เพื่อรักษา audit trail ของ Transaction เก่า)
      </div>
    </div>
  );
}
