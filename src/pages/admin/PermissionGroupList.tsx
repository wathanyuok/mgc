import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Badge } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { type PermissionGroup } from '@/types/database';

export function PermissionGroupList() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ['perm-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('permission_groups')
        .select('*')
        .order('created_at');
      if (error) throw error;
      return data as PermissionGroup[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('permission_groups').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['perm-groups'] }); toast.success('ลบกลุ่มแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="w-6 h-6 text-brand" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Permission Groups</h1>
          <p className="text-muted text-sm">กลุ่มสิทธิ์ — กำหนดสิทธิ์ View / Edit / Approve รายเมนู</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/admin/groups/new')}>
          <Plus className="w-4 h-4" /> New Group
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
          ) : data.length === 0 ? (
            <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">🛡️</div><p>ยังไม่มีกลุ่มสิทธิ์</p></div>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-32">Edit | View</th>
                  <th>ชื่อกลุ่ม</th>
                  <th>คำอธิบาย</th>
                  <th>สร้างเมื่อ</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50">
                    <td className="text-xs">
                      <Link to={`/admin/groups/${g.id}`} className="text-brand hover:underline">Edit</Link>
                      <span className="text-gray-300 mx-1">|</span>
                      <Link to={`/admin/groups/${g.id}?view=1`} className="text-brand hover:underline">View</Link>
                    </td>
                    <td>
                      <span className="font-medium">{g.name}</span>
                      {g.is_admin && <Badge variant="brand" className="ml-2">Admin</Badge>}
                    </td>
                    <td className="text-muted">{g.description ?? '—'}</td>
                    <td className="text-xs">{fmtDate(g.created_at)}</td>
                    <td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm(`ลบกลุ่ม ${g.name}?`)) del.mutate(g.id); }}>
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
