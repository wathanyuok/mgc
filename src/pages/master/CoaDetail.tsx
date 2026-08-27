import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, FieldLabel } from '@/components/ui';
import type { GLAccount } from '@/types/database';

import { checkRequiredFields } from '@/lib/required-check';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { useUnsavedGuard } from '@/lib/unsaved-guard';
import { logSave } from '@/lib/audit-trail';
type CoaForm = {
  company: string;
  code: string;
  name: string;
  fs_no: string;
  fs_name: string;
  fs_group: string;
  conso_group: string;
  nfs_group: string;
  inactive: boolean;
};

const blank: CoaForm = {
  company: '',
  code: '',
  name: '',
  fs_no: '',
  fs_name: '',
  fs_group: '',
  conso_group: '',
  nfs_group: '',
  inactive: false,
};

/**
 * นับว่ารหัสบัญชีนี้ถูกตั้งไว้ในสัญญากี่รายการ
 *
 * สัญญาเก็บบัญชีเป็นข้อความ "รหัส ชื่อบัญชี" ในช่องผังบัญชีของแต่ละใบ (acct_cards)
 * จึงต้องค้นแบบมีข้อความนั้นอยู่ข้างใน — ไม่มีความสัมพันธ์ตรงให้ไล่
 */
async function countAcctCardUsage(code: string): Promise<number> {
  const tables = [
    'credit_agreements', 'promissory_notes', 'letter_guarantees', 'letters_of_credit',
    'floor_plans', 'overdrafts', 'trust_receipts', 'fx_forwards', 'loans', 'leases',
  ] as const;
  let total = 0;
  for (const t of tables) {
    const { count, error } = await supabase
      .from(t)
      .select('id', { count: 'exact', head: true })
      .filter('acct_cards::text', 'ilike', `%${code}%`);
    if (error) {
      console.warn(`[ผังบัญชี] ตรวจการใช้งานที่ ${t} ไม่สำเร็จ — ข้าม`, error.message);
      continue;
    }
    total += count ?? 0;
  }
  return total;
}

export function CoaDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<CoaForm>(blank);
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('master_coa', 'edit');
  const guard = useUnsavedGuard(form, () => navigate('/master/coa'));

  // รายชื่อบริษัทที่มีอยู่ในผังบัญชี — ใช้เป็นตัวเลือกในช่อง COMPANY
  const { data: companies = [] } = useQuery({
    queryKey: ['coa-companies'],
    queryFn: async () => {
      const { data, error } = await supabase.from('gl_accounts').select('company');
      if (error) throw error;
      return Array.from(
        new Set((data ?? []).map((r: any) => r.company).filter(Boolean)),
      ).sort() as string[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: existing, isLoading: loadingExisting, error: loadError } = useQuery({
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
      guard.reset({
        company: existing.company ?? '',
        code: existing.code,
        name: existing.name,
        fs_no: existing.fs_no ?? '',
        fs_name: existing.fs_name ?? '',
        fs_group: existing.fs_group ?? '',
        conso_group: existing.conso_group ?? '',
        nfs_group: existing.nfs_group ?? '',
        inactive: existing.inactive,
      }, setForm);
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      // ตัดช่องว่างหัวท้ายทุกช่อง — " 1100-01" กับ "1100-01" ต้องเป็นบัญชีเดียวกัน
      // ไม่งั้นตัวกันรหัสซ้ำมองเป็นคนละค่า และรายการเลือกบัญชีในสัญญาจะแยกรหัสกับชื่อผิด
      const payload = {
        company: form.company.trim() || null,
        code: form.code.trim(),
        name: form.name.trim(),
        fs_no: form.fs_no.trim() || null,
        fs_name: form.fs_name.trim() || null,
        fs_group: form.fs_group.trim() || null,
        conso_group: form.conso_group.trim() || null,
        nfs_group: form.nfs_group.trim() || null,
        inactive: form.inactive,
      };
      // ปิดใช้งานบัญชี = บัญชีหายจากรายการให้เลือกทันที แต่สัญญาเดิมยังใช้ลงบัญชีต่อ
      // จึงต้องบอกก่อนว่ามีสัญญาใดอ้างอิงอยู่บ้าง
      if (mode === 'edit' && form.inactive && !existing?.inactive) {
        const used = await countAcctCardUsage(payload.code);
        if (used > 0) {
          const ok = window.confirm(
            `บัญชี ${payload.code} ถูกตั้งไว้ในสัญญา ${used} รายการ\n\n` +
            `ถ้าปิดใช้งาน บัญชีนี้จะหายจากรายการให้เลือก แต่สัญญาที่ตั้งไว้แล้วจะยังลงบัญชีด้วยรหัสนี้ต่อไป\n` +
            `ต้องการปิดใช้งานหรือไม่?`,
          );
          if (!ok) throw new Error('ยกเลิกการปิดใช้งาน');
        }
      }
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
      logSave('gl_accounts', data ?? id, `${form.code.trim()} ${form.name.trim()}`, mode === 'new');
      qc.invalidateQueries({ queryKey: ['coa-list'] });
      qc.invalidateQueries({ queryKey: ['gl-accounts'] });
      guard.markSaved();
      toast.success(mode === 'new' ? 'สร้างบัญชีแล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/master/coa/${data.id}`);
    },
    onError: (e: any) => {
      // ข้อความภาษาคนเมื่อรหัสบัญชีซ้ำในบริษัทเดียวกัน
      const isDupKey =
        e?.code === '23505' ||
        /uq_gl_accounts_company_code|duplicate key|unique constraint/i.test(e?.message ?? '');
      if (isDupKey) {
        const companyLabel = form.company.trim() || '(ทุกบริษัท)';
        toast.error(`บัญชี ${form.code.trim()} มีอยู่แล้วใน ${companyLabel}`, {
          description: 'รหัสบัญชีต้องไม่ซ้ำกันในบริษัทเดียวกัน · เปลี่ยนรหัส หรือเลือกบริษัทอื่น',
          duration: 8000,
        });
        return;
      }
      if (e?.message === 'ยกเลิกการปิดใช้งาน') return;   // ผู้ใช้กดยกเลิกเอง ไม่ต้องขึ้นข้อความผิดพลาด
      toast.error(e?.message ?? 'บันทึกไม่สำเร็จ');
    },
  });

  const canSave = form.code.trim() !== '' && form.name.trim() !== '';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={guard.leave}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Chart of Accounts</h1>
          <p className="text-muted text-sm font-medium">
            {mode === 'new' ? '+ New Account' : `${form.code} — ${form.name}`}
          </p>
        </div>
        <Button
          variant="primary"
          disabled={!canSave || save.isPending || !canEdit || !!loadError}
          title={!canEdit ? 'ไม่มีสิทธิ์แก้ไข' : !canSave ? 'ต้องกรอกรหัสบัญชีและชื่อบัญชีก่อน' : ''}
          onClick={() => { if (checkRequiredFields()) save.mutate(); }}
        >
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={guard.leave}>Cancel</Button>
      </div>

      {mode === 'edit' && loadError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm">
          โหลดข้อมูลบัญชีนี้ไม่สำเร็จ — ปุ่มบันทึกถูกปิดไว้เพื่อกันเขียนทับข้อมูลเดิมด้วยฟอร์มเปล่า ·
          กรุณารีเฟรชหน้าใหม่
        </div>
      )}
      {mode === 'edit' && loadingExisting && !loadError && (
        <div className="mb-4 text-sm text-muted">กำลังโหลด...</div>
      )}

      <Card>
        <CardContent>
          <h3 className="font-semibold text-sm tracking-wide mb-4">Primary Information</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel tipKey="COA_COMPANY">COMPANY</FieldLabel>
              <Input
                list="coa-company-list"
                placeholder="เช่น MGC Asia"
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              />
              {/* รายชื่อบริษัทที่มีอยู่แล้ว — พิมพ์เองได้ แต่มีให้เลือกกันพิมพ์เพี้ยน
                  เช่น "MGC ASIA" กับ "MGC Asia" จะกลายเป็น 2 บริษัทคนละอัน */}
              <datalist id="coa-company-list">
                {companies.map((c) => <option key={c} value={c} />)}
              </datalist>
              {form.company.trim() && !companies.includes(form.company.trim()) && companies.length > 0 && (
                <p className="text-xs text-orange-700 mt-1">
                  ยังไม่มีบริษัทชื่อนี้ในผังบัญชี — จะถูกสร้างเป็นบริษัทใหม่
                </p>
              )}
            </div>
            <div>
              <FieldLabel tipKey="COA_CODE" required>CODE</FieldLabel>
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
              <FieldLabel tipKey="COA_ACCOUNT_NAME" required>ACCOUNT NAME</FieldLabel>
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
            <div>
              <FieldLabel>FS NAME</FieldLabel>
              <Input
                placeholder="ชื่อรายการในงบการเงิน"
                value={form.fs_name}
                onChange={(e) => setForm((f) => ({ ...f, fs_name: e.target.value }))}
              />
            </div>
            <div>
              <FieldLabel>CONSO GROUP</FieldLabel>
              <Input
                placeholder="กลุ่มสำหรับงบการเงินรวม"
                value={form.conso_group}
                onChange={(e) => setForm((f) => ({ ...f, conso_group: e.target.value }))}
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
