import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, FieldLabel } from '@/components/ui';
import { MENU_CATALOG, MENU_SECTIONS } from '@/lib/menus';
import { type PermissionGroup, type GroupPermission } from '@/types/database';

import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { useUnsavedGuard } from '@/lib/unsaved-guard';
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
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('user_mgmt', 'edit');
  // เตือนก่อนออก — สิทธิ์ที่เพิ่งติ๊กไปหลายสิบช่องหายหมดถ้าเผลอกด Back
  const guard = useUnsavedGuard({ name, description, isAdmin, perms },
    () => navigate('/admin/groups'));

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
    const next = blankPerms();
    for (const gp of existing.perms) {
      if (next[gp.menu_key]) next[gp.menu_key] = { view: gp.can_view, edit: gp.can_edit, approve: gp.can_approve };
    }
    guard.reset(
      { name: existing.group.name, description: existing.group.description ?? '', isAdmin: existing.group.is_admin, perms: next },
      (v) => { setName(v.name); setDescription(v.description); setIsAdmin(v.isAdmin); setPerms(v.perms); },
    );
  }, [existing]);

  const toggle = (key: string, field: keyof Perm) => {
    if (!canEdit) return;
    setPerms((p) => {
      const cur = { ...p[key], [field]: !p[key][field] };
      // edit/approve imply view
      if ((field === 'edit' || field === 'approve') && cur[field]) cur.view = true;
      return { ...p, [key]: cur };
    });
  };

  const setAll = (field: keyof Perm, val: boolean) => {
    if (!canEdit) return;
    setPerms((p) => {
      const next = { ...p };
      for (const m of MENU_CATALOG) {
        if (field === 'approve' && !m.approve) continue;
        next[m.key] = { ...next[m.key], [field]: val };
        if (val && (field === 'edit' || field === 'approve')) next[m.key].view = true;
      }
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const cleanName = name.trim();
      if (!cleanName) throw new Error('กรอกชื่อกลุ่มก่อน');

      // ชื่อกลุ่มห้ามซ้ำ — ถ้ามี "ผู้อนุมัติ" 2 กลุ่มที่สิทธิ์คนละแบบ คนกำหนดสิทธิ์จะเลือกผิด
      let dup = supabase
        .from('permission_groups')
        .select('id', { count: 'exact', head: true })
        .ilike('name', cleanName);
      if (mode === 'edit' && id) dup = dup.neq('id', id);
      const { count, error: dupErr } = await dup;
      if (dupErr) console.warn('[กลุ่มสิทธิ์] ตรวจชื่อซ้ำไม่สำเร็จ — ข้ามการตรวจ', dupErr.message);
      else if ((count ?? 0) > 0) throw new Error(`มีกลุ่มชื่อ "${cleanName}" อยู่แล้ว — เปลี่ยนชื่อใหม่`);

      // เมนูที่แก้ไขหรืออนุมัติได้ ต้องเข้าดูได้ด้วย ไม่งั้นใช้งานจริงไม่ได้
      const broken = MENU_CATALOG
        .filter((m) => (perms[m.key].edit || perms[m.key].approve) && !perms[m.key].view)
        .map((m) => m.label);
      if (broken.length) {
        throw new Error(
          `เมนู ${broken.join(', ')} ให้สิทธิ์แก้ไขหรืออนุมัติไว้ แต่ไม่ได้ให้สิทธิ์ดู — ` +
          `ผู้ใช้จะเข้าเมนูไม่ได้เลย · ติ๊กช่องดูด้วย หรือปลดช่องแก้ไข/อนุมัติออก`,
        );
      }

      let gid = id;
      if (mode === 'new') {
        const { data, error } = await supabase
          .from('permission_groups').insert({ name: cleanName, description: description.trim() || null, is_admin: isAdmin }).select().single();
        if (error) throw error;
        gid = data.id;
      } else {
        const { error } = await supabase
          .from('permission_groups').update({ name: cleanName, description: description.trim() || null, is_admin: isAdmin, updated_at: new Date().toISOString() }).eq('id', id!);
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
      logSave('permission_groups', gid ?? id, name.trim(), mode === 'new');
      guard.markSaved();
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
        <Button variant="ghost" size="sm" onClick={guard.leave}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Permission Group</h1>
          <p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New Group' : name}</p>
        </div>
        <Button variant="primary" disabled={save.isPending || !canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>GROUP NAME</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ผู้อนุมัติ, เจ้าหน้าที่การเงิน" />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>DESCRIPTION</FieldLabel>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="คำอธิบายกลุ่ม" />
            </div>
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isAdmin}
              disabled={!canEdit}
              onChange={(e) => {
                // ติ๊กแล้วกลุ่มนี้ได้สิทธิ์เต็มทุกเมนูทันที — ถามยืนยันก่อน
                if (e.target.checked
                    && !window.confirm('กลุ่มนี้จะเข้าได้ทุกเมนูเต็มสิทธิ์ โดยไม่สนใจช่องติ๊กด้านล่าง\n\nยืนยันหรือไม่?')) return;
                setIsAdmin(e.target.checked);
              }}
            />
            <span className="font-medium">Admin (เข้าถึงทุกเมนูเต็มสิทธิ์)</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h3 className="font-semibold text-sm">สิทธิ์รายเมนู</h3>
            <div className="flex gap-2 text-xs">
              <button className="text-brand hover:underline disabled:opacity-40 disabled:no-underline"
                disabled={!canEdit} onClick={() => setAll('view', true)}>เลือก View ทั้งหมด</button>
              <span className="text-gray-300">|</span>
              <button className="text-muted hover:underline disabled:opacity-40 disabled:no-underline"
                disabled={!canEdit}
                onClick={() => {
                  if (!window.confirm('ล้างสิทธิ์ทุกเมนูของกลุ่มนี้ทั้งหมด — ยืนยันหรือไม่?')) return;
                  setAll('view', false); setAll('edit', false); setAll('approve', false);
                }}>ล้างทั้งหมด</button>
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
                        <td className="text-center"><input type="checkbox" disabled={!canEdit} checked={perms[m.key].view} onChange={() => toggle(m.key, 'view')} /></td>
                        <td className="text-center"><input type="checkbox" disabled={!canEdit} checked={perms[m.key].edit} onChange={() => toggle(m.key, 'edit')} /></td>
                        <td className="text-center">
                          {m.approve
                            ? <input type="checkbox" disabled={!canEdit} checked={perms[m.key].approve} onChange={() => toggle(m.key, 'approve')} />
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
