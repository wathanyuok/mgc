import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, FieldLabel } from '@/components/ui';
import { type AppUser, type PermissionGroup } from '@/types/database';

import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { useUnsavedGuard } from '@/lib/unsaved-guard';

/** รูปแบบอีเมลพื้นฐาน — ต้องมี @ และโดเมนที่มีจุด */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Form = { name: string; email: string; group_id: string; status: 'Active' | 'Inactive' };
const blank: Form = { name: '', email: '', group_id: '', status: 'Active' };

export function UserDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('user_mgmt', 'edit');
  const guard = useUnsavedGuard(form, () => navigate('/admin/users'));

  const { data: groups = [] } = useQuery({
    queryKey: ['perm-groups-opts'],
    queryFn: async () => {
      const { data } = await supabase.from('permission_groups').select('id, name').order('name');
      return (data ?? []) as Pick<PermissionGroup, 'id' | 'name'>[];
    },
  });

  const { data: existing } = useQuery({
    queryKey: ['app-user', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_users').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as AppUser;
    },
  });

  useEffect(() => {
    if (existing) {
      guard.reset(
        { name: existing.name, email: existing.email, group_id: existing.group_id ?? '', status: existing.status },
        setForm,
      );
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      const email = form.email.trim().toLowerCase();
      if (!name) throw new Error('กรอกชื่อก่อน');
      if (!email) throw new Error('กรอกอีเมลก่อน');
      // อีเมลผิดรูปแบบ = ผู้ใช้รายนั้นเข้าระบบไม่ได้ตลอดไป เพราะระบบจับคู่ด้วยอีเมล
      if (!EMAIL_RE.test(email)) {
        throw new Error(`อีเมล "${form.email.trim()}" ไม่ถูกรูปแบบ — ต้องเป็นแบบ name@company.com`);
      }
      const payload = { name, email, group_id: form.group_id || null, status: form.status };
      if (mode === 'new') {
        const { data, error } = await supabase.from('app_users').insert(payload).select().single();
        if (error) throw error;
        return data.id;
      } else {
        const { error } = await supabase.from('app_users').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id!);
        if (error) throw error;
        return id;
      }
    },
    onSuccess: (uid) => {
      logSave('app_users', uid ?? id, form.email.trim(), mode === 'new');
      guard.markSaved();
      qc.invalidateQueries({ queryKey: ['app-users'] });
      qc.invalidateQueries({ queryKey: ['app-user', uid] });
      toast.success(mode === 'new' ? 'สร้างผู้ใช้แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/admin/users/${uid}`);
    },
    onError: (e: any) => {
      // อีเมลซ้ำ — ฐานข้อมูลกันไว้แล้ว แต่ข้อความดิบอ่านไม่รู้เรื่อง
      const dup = e?.code === '23505' || /duplicate key|app_users_email_key|unique constraint/i.test(e?.message ?? '');
      if (dup) {
        toast.error(`อีเมล ${form.email.trim()} ถูกใช้กับผู้ใช้รายอื่นแล้ว`, {
          description: 'อีเมลต้องไม่ซ้ำกัน เพราะระบบใช้อีเมลจับคู่ผู้ใช้ตอนเข้าระบบ',
          duration: 8000,
        });
        return;
      }
      toast.error(e.message, { duration: 8000 });
    },
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={guard.leave}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">User</h1>
          <p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New User' : form.name}</p>
        </div>
        <Button variant="primary" disabled={save.isPending || !canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <Card>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>NAME</FieldLabel>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="ชื่อ-นามสกุล" />
            </div>
            <div>
              <FieldLabel required>EMAIL</FieldLabel>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="name@mgc-asia.com" />
            </div>
            <div>
              <FieldLabel>PERMISSION GROUP</FieldLabel>
              <Select value={form.group_id} onChange={(e) => setForm((f) => ({ ...f, group_id: e.target.value }))}>
                <option value="">— เลือกกลุ่มสิทธิ์ —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>STATUS</FieldLabel>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Form['status'] }))}>
                <option>Active</option>
                <option>Inactive</option>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted mt-4 italic">* หน้านี้จัดการผู้ใช้และกลุ่มสิทธิ์ · การยืนยันตัวตนตอนเข้าระบบจะเชื่อมกับระบบขององค์กรในขั้นถัดไป</p>
        </CardContent>
      </Card>
    </div>
  );
}
