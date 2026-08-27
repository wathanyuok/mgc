import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Users, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Badge, Input, Select, usePaged, Pagination } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { type AppUser, type PermissionGroup } from '@/types/database';

import { logDelete } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
export function UserList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, user: me } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('user_mgmt', 'edit');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['app-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_users')
        .select('*, permission_groups(name)')
        .order('created_at');
      if (error) throw error;
      return data as (AppUser & { permission_groups: Pick<PermissionGroup, 'name'> | null })[];
    },
  });

  // รายชื่อกลุ่มสำหรับตัวกรอง — ดึงแยกจากทะเบียนกลุ่ม ไม่ใช่จากผลที่กรองไว้แล้ว
  const { data: groupOpts = [] } = useQuery({
    queryKey: ['perm-groups-opts'],
    queryFn: async () => {
      const { data } = await supabase.from('permission_groups').select('id, name').order('name');
      return (data ?? []) as { id: string; name: string }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const rows = data.filter((u) => {
    const s = search.trim().toLowerCase();
    if (s && !u.name.toLowerCase().includes(s) && !u.email.toLowerCase().includes(s)) return false;
    if (groupFilter === '__none__' ? u.group_id != null : groupFilter && u.group_id !== groupFilter) return false;
    if (statusFilter && u.status !== statusFilter) return false;
    return true;
  });

  const del = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      // ห้ามลบบัญชีตัวเอง — ลบแล้วจะหลุดสิทธิ์ทันทีและกู้เองไม่ได้
      if (me?.id && me.id === id) {
        throw new Error('ลบบัญชีของตัวเองไม่ได้ — ให้ผู้ดูแลระบบคนอื่นเป็นคนลบให้');
      }
      // ห้ามลบผู้ดูแลระบบคนสุดท้าย — ไม่งั้นจะไม่มีใครเข้าเมนูผู้ดูแลระบบได้อีก
      const { data: target } = await supabase
        .from('app_users')
        .select('group_id, permission_groups(is_admin)')
        .eq('id', id)
        .maybeSingle();
      if ((target as any)?.permission_groups?.is_admin) {
        const { data: adminGroups } = await supabase
          .from('permission_groups').select('id').eq('is_admin', true);
        const ids = (adminGroups ?? []).map((g: any) => g.id);
        const { count } = await supabase
          .from('app_users')
          .select('id', { count: 'exact', head: true })
          .in('group_id', ids)
          .eq('status', 'Active');
        if ((count ?? 0) <= 1) {
          throw new Error(
            'ลบไม่ได้ — เป็นผู้ดูแลระบบที่ใช้งานอยู่คนสุดท้าย · ' +
            'ถ้าลบจะไม่มีใครเข้าเมนูผู้ดูแลระบบได้อีก ต้องตั้งผู้ดูแลระบบคนใหม่ก่อน',
          );
        }
      }
      const { error } = await supabase.from('app_users').delete().eq('id', id);
      if (error) throw error;
      logDelete('app_users', id, name);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['app-users'] }); toast.success('ลบผู้ใช้แล้ว'); },
    onError: (e: any) => toast.error(e.message, { duration: 8000 }),
  });


  const pg = usePaged(rows);   // แบ่งหน้ารายการ
  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <Users className="w-6 h-6 text-brand" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted text-sm">ผู้ใช้ระบบ — กำหนดให้อยู่กลุ่มสิทธิ์</p>
        </div>
        <Button variant="primary" disabled={!canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => navigate('/admin/users/new')}>
          <Plus className="w-4 h-4" /> New User
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input className="pl-8" placeholder="🔍 ชื่อ หรือ อีเมล…"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="field-label">กลุ่มสิทธิ์</label>
              <Select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                <option value="">– ทั้งหมด –</option>
                <option value="__none__">— ยังไม่กำหนด —</option>
                {groupOpts.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">สถานะ</label>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">– ทั้งหมด –</option>
                <option>Active</option>
                <option>Inactive</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">👤</div><p>{data.length === 0 ? 'ยังไม่มีผู้ใช้' : 'ไม่พบผู้ใช้ที่ตรงกับที่ค้นหา'}</p></div>
          ) : (
            <>
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-32">Edit | View</th>
                  <th>ชื่อ</th>
                  <th>อีเมล</th>
                  <th>กลุ่มสิทธิ์</th>
                  <th>สถานะ</th>
                  <th>สร้างเมื่อ</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="text-xs">
                      <Link to={`/admin/users/${u.id}`} className="text-brand hover:underline">Edit</Link>
                      <span className="text-gray-300 mx-1">|</span>
                      <Link to={`/admin/users/${u.id}?view=1`} className="text-brand hover:underline">View</Link>
                    </td>
                    <td><span className="font-medium">{u.name}</span></td>
                    <td className="text-muted">{u.email}</td>
                    <td>{u.permission_groups?.name ? <Badge variant="default">{u.permission_groups.name}</Badge> : <span className="text-muted">— ยังไม่กำหนด —</span>}</td>
                    <td><Badge variant={u.status === 'Active' ? 'success' : 'default'}>{u.status}</Badge></td>
                    <td className="text-xs">{fmtDate(u.created_at)}</td>
                    <td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canEdit || del.isPending || me?.id === u.id}
                        title={me?.id === u.id ? 'ลบบัญชีของตัวเองไม่ได้' : canEdit ? 'ลบผู้ใช้' : 'ไม่มีสิทธิ์แก้ไข'}
                        onClick={() => { if (confirm(`ลบผู้ใช้ ${u.name}?`)) del.mutate({ id: u.id, name: u.name }); }}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-danger" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination {...pg} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
