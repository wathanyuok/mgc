import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, FieldLabel } from '@/components/ui';
import { type AppUser, type PermissionGroup } from '@/types/database';

type Form = { name: string; email: string; group_id: string; status: 'Active' | 'Inactive' };
const blank: Form = { name: '', email: '', group_id: '', status: 'Active' };

export function UserDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);

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
    if (existing) setForm({ name: existing.name, email: existing.email, group_id: existing.group_id ?? '', status: existing.status });
  }, [existing]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('กรอกชื่อก่อน');
      if (!form.email.trim()) throw new Error('กรอกอีเมลก่อน');
      const payload = { name: form.name, email: form.email, group_id: form.group_id || null, status: form.status };
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
      qc.invalidateQueries({ queryKey: ['app-users'] });
      qc.invalidateQueries({ queryKey: ['app-user', uid] });
      toast.success(mode === 'new' ? 'สร้างผู้ใช้แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/admin/users/${uid}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/users')}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">User</h1>
          <p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New User' : form.name}</p>
        </div>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <Card>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel>NAME *</FieldLabel>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="ชื่อ-นามสกุล" />
            </div>
            <div>
              <FieldLabel>EMAIL *</FieldLabel>
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
          <p className="text-xs text-muted mt-4 italic">* ระยะนี้เป็นหน้าจัดการผู้ใช้ + กลุ่มสิทธิ์ การบังคับ login จะเชื่อมในขั้นถัดไป (Supabase Auth)</p>
        </CardContent>
      </Card>
    </div>
  );
}
