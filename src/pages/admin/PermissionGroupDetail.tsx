import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, FieldLabel } from '@/components/ui';
import { MENU_CATALOG, MENU_SECTIONS } from '@/lib/menus';
import { type PermissionGroup, type GroupPermission } from '@/types/database';

type Perm = { view: boolean; edit: boolean; approve: boolean };
const blankPerms = (): Record<string, Perm> =>
  Object.fromEntries(MENU_CATALOG.map((m) => [m.key, { view: false, edit: false, approve: false }]));

export function PermissionGroupDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [perms, setPerms] = useState<Record<string, Perm>>(blankPerms());

  const { data: existing } = useQuery({
    queryKey: ['perm-group', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [g, p] = await Promise.all([
        supabase.from('permission_groups').select('*').eq('id', id!).single(),
        supabase.from('group_permissions').select('*').eq('group_id', id!),
      ]);
      if (g.error) throw g.error;
      return { group: g.data as PermissionGroup, perms: (p.data ?? []) as GroupPermission[] };
    },
  });

  useEffect(() => {
    if (!existing) return;
    setName(existing.group.name);
    setDescription(existing.group.description ?? '');
    setIsAdmin(existing.group.is_admin);
    const next = blankPerms();
    for (const gp of existing.perms) {
      if (next[gp.menu_key]) next[gp.menu_key] = { view: gp.can_view, edit: gp.can_edit, approve: gp.can_approve };
    }
    setPerms(next);
  }, [existing]);

  const toggle = (key: string, field: keyof Perm) =>
    setPerms((p) => {
      const cur = { ...p[key], [field]: !p[key][field] };
      // edit/approve imply view
      if ((field === 'edit' || field === 'approve') && cur[field]) cur.view = true;
      return { ...p, [key]: cur };
    });

  const setAll = (field: keyof Perm, val: boolean) =>
    setPerms((p) => {
      const next = { ...p };
      for (const m of MENU_CATALOG) {
        if (field === 'approve' && !m.approve) continue;
        next[m.key] = { ...next[m.key], [field]: val };
        if (val && (field === 'edit' || field === 'approve')) next[m.key].view = true;
      }
      return next;
    });

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('กรอกชื่อกลุ่มก่อน');
      let gid = id;
      if (mode === 'new') {
        const { data, error } = await supabase
          .from('permission_groups').insert({ name, description: description || null, is_admin: isAdmin }).select().single();
        if (error) throw error;
        gid = data.id;
      } else {
        const { error } = await supabase
          .from('permission_groups').update({ name, description: description || null, is_admin: isAdmin, updated_at: new Date().toISOString() }).eq('id', id!);
        if (error) throw error;
      }
      // replace permissions — keep only rows with at least one flag
      await supabase.from('group_permissions').delete().eq('group_id', gid!);
      const rows = MENU_CATALOG
        .map((m) => ({ group_id: gid!, menu_key: m.key, can_view: perms[m.key].view, can_edit: perms[m.key].edit, can_approve: perms[m.key].approve }))
        .filter((r) => r.can_view || r.can_edit || r.can_approve);
      if (rows.length) {
        const { error } = await supabase.from('group_permissions').insert(rows);
        if (error) throw error;
      }
      return gid;
    },
    onSuccess: (gid) => {
      qc.invalidateQueries({ queryKey: ['perm-groups'] });
      qc.invalidateQueries({ queryKey: ['perm-group', gid] });
      toast.success(mode === 'new' ? 'สร้างกลุ่มสิทธิ์แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/admin/groups/${gid}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/groups')}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Permission Group</h1>
          <p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New Group' : name}</p>
        </div>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel>GROUP NAME *</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ผู้อนุมัติ, เจ้าหน้าที่การเงิน" />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>DESCRIPTION</FieldLabel>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="คำอธิบายกลุ่ม" />
            </div>
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
            <span className="font-medium">Admin (เข้าถึงทุกเมนูเต็มสิทธิ์)</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h3 className="font-semibold text-sm">สิทธิ์รายเมนู</h3>
            <div className="flex gap-2 text-xs">
              <button className="text-brand hover:underline" onClick={() => setAll('view', true)}>เลือก View ทั้งหมด</button>
              <span className="text-gray-300">|</span>
              <button className="text-muted hover:underline" onClick={() => { setAll('view', false); setAll('edit', false); setAll('approve', false); }}>ล้างทั้งหมด</button>
            </div>
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>เมนู</th>
                <th className="text-center w-24">View</th>
                <th className="text-center w-24">Edit</th>
                <th className="text-center w-24">Approve</th>
              </tr>
            </thead>
            <tbody>
              {MENU_SECTIONS.map((section) => {
                const items = MENU_CATALOG.filter((m) => m.section === section);
                if (items.length === 0) return null;
                return (
                  <>
                    <tr key={section} className="bg-soft">
                      <td colSpan={4} className="font-semibold text-xs uppercase tracking-wide text-muted">{section}</td>
                    </tr>
                    {items.map((m) => (
                      <tr key={m.key} className="hover:bg-gray-50">
                        <td className="font-medium">{m.label}</td>
                        <td className="text-center"><input type="checkbox" checked={perms[m.key].view} onChange={() => toggle(m.key, 'view')} /></td>
                        <td className="text-center"><input type="checkbox" checked={perms[m.key].edit} onChange={() => toggle(m.key, 'edit')} /></td>
                        <td className="text-center">
                          {m.approve
                            ? <input type="checkbox" checked={perms[m.key].approve} onChange={() => toggle(m.key, 'approve')} />
                            : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted p-3 italic">* ติ๊ก Edit หรือ Approve จะเปิด View ให้อัตโนมัติ · Approve มีเฉพาะเมนูที่มีขั้นตอนอนุมัติ</p>
        </CardContent>
      </Card>
    </div>
  );
}
