import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Trash2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Badge, usePaged, Pagination } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { type PermissionGroup } from '@/types/database';

import { logDelete } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
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

  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('user_mgmt', 'edit');

  const del = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      // เตือนก่อนว่ามีใครอยู่ในกลุ่มนี้บ้าง — ลบแล้วคนเหล่านั้นจะไม่เหลือสิทธิ์ใดเลย
      const { count, error: cErr } = await supabase
        .from('app_users')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', id);
      if (cErr) console.warn('[กลุ่มสิทธิ์] นับผู้ใช้ในกลุ่มไม่สำเร็จ — ข้ามการเตือน', cErr.message);
      if ((count ?? 0) > 0) {
        const ok = window.confirm(
          `กลุ่ม ${name} มีผู้ใช้อยู่ ${count} คน\n\n` +
          `ถ้าลบกลุ่มนี้ ทุกคนในกลุ่มจะกลายเป็น "ยังไม่กำหนดกลุ่มสิทธิ์" และใช้งานระบบไม่ได้ทันที\n` +
          `ควรย้ายคนเหล่านั้นไปกลุ่มอื่นก่อน — ต้องการลบต่อหรือไม่?`,
        );
        if (!ok) throw new Error('ยกเลิกการลบ');
      }
      const { error } = await supabase.from('permission_groups').delete().eq('id', id);
      if (error) throw error;
      logDelete('permission_groups', id, name);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['perm-groups'] }); toast.success('ลบกลุ่มแล้ว'); },
    onError: (e: any) => {
      if (e?.message === 'ยกเลิกการลบ') return;   // ผู้ใช้กดยกเลิกเอง
      toast.error(e.message);
    },
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="w-6 h-6 text-brand" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Permission Groups</h1>
          <p className="text-muted text-sm">กลุ่มสิทธิ์ — กำหนดสิทธิ์ View / Edit / Approve รายเมนู</p>
        </div>
        <Button variant="primary" disabled={!canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => navigate('/admin/groups/new')}>
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
            <>
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
                {pg.rows.map((g) => (
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
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canEdit || del.isPending}
                        title={canEdit ? 'ลบกลุ่ม' : 'ไม่มีสิทธิ์แก้ไข'}
                        onClick={() => { if (confirm(`ลบกลุ่ม ${g.name}?`)) del.mutate({ id: g.id, name: g.name }); }}
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
