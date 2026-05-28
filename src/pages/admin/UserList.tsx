import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Badge } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { type AppUser, type PermissionGroup } from '@/types/database';

export function UserList() {
  const navigate = useNavigate();
  const qc = useQueryClient();

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

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('app_users').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['app-users'] }); toast.success('ลบผู้ใช้แล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <Users className="w-6 h-6 text-brand" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted text-sm">ผู้ใช้ระบบ — กำหนดให้อยู่กลุ่มสิทธิ์</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/admin/users/new')}>
          <Plus className="w-4 h-4" /> New User
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
          ) : data.length === 0 ? (
            <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">👤</div><p>ยังไม่มีผู้ใช้</p></div>
          ) : (
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
                {data.map((u) => (
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
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm(`ลบผู้ใช้ ${u.name}?`)) del.mutate(u.id); }}>
                        <Trash2 className="w-3.5 h-3.5 text-danger" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
