import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge, usePaged, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import type { GLAccount } from '@/types/database';


export function CoaList() {
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['coa-list', search, company, status],
    queryFn: async () => {
      let q = supabase.from('gl_accounts').select('*').order('code');
      if (company) q = q.eq('company', company);
      if (status === 'Active') q = q.eq('inactive', false);
      if (status === 'Inactive') q = q.eq('inactive', true);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as GLAccount[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r) => r.code.toLowerCase().includes(s) || (r.name ?? '').toLowerCase().includes(s));
      }
      return rows;
    },
  });


  // รายชื่อบริษัทสำหรับตัวกรอง — ต้องดึงแยกจากทั้งตาราง
  // เดิมสร้างจากผลลัพธ์ที่กรองไว้แล้ว พอเลือกบริษัทหนึ่ง รายการจะเหลือแค่บริษัทนั้น
  // ทำให้สลับไปบริษัทอื่นตรงๆ ไม่ได้ ต้องกลับ – All – ก่อน
  const { data: allCompanies = [] } = useQuery({
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


  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('master_coa', 'edit');

  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Chart of Accounts (COA)</h1>
        <p className="text-muted text-sm">List</p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Button variant="primary" disabled={!canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => navigate('/master/coa/new')}>
          <Plus className="w-4 h-4" /> New Account
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input
                  className="pl-8"
                  placeholder="🔍 รหัส / ชื่อบัญชี"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field-label">COMPANY</label>
              <Select value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">– All –</option>
                {allCompanies.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option>
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
          ) : !data || data.length === 0 ? (
            <div className="p-12 text-center text-muted">
              <div className="text-4xl mb-2">📒</div>
              <p>ยังไม่มีบัญชี — กด <strong>+ New Account</strong> เพื่อเพิ่มบัญชีแรก</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-24">Edit | View</th>
                    <th>Company</th>
                    <th>Code</th>
                    <th>Account Name</th>
                    <th>FS No.</th>
                    <th>FS Group</th>
                    <th>NFS Group</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`/master/coa/${r.id}`} className="text-brand hover:underline">
                            Edit
                          </Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`/master/coa/${r.id}?view=1`} className="text-brand hover:underline">
                            View
                          </Link>
                        </div>
                      </td>
                      <td>{r.company}</td>
                      <td className="tabular-nums font-medium">{r.code}</td>
                      <td>{r.name}</td>
                      <td className="text-muted">{r.fs_no}</td>
                      <td className="text-muted">{r.fs_group}</td>
                      <td className="text-muted">{r.nfs_group}</td>
                      <td>
                        <Badge variant={r.inactive ? 'default' : 'success'}>
                          {r.inactive ? 'Inactive' : 'Active'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
        <Pagination {...pg} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 bg-brand-light border-l-4 border-brand p-3 text-sm text-ink rounded">
        💡 <strong>Chart of Accounts (COA)</strong> — ผังบัญชีสำหรับ Account Mapping ตอน Post JE → NetSuite.
        Admin จัดการรายบัญชีในระบบนี้ (Add / Edit) โดยรับ list จาก MGC. ใช้ <strong>Inactive</strong> แทนการลบ
        เพื่อรักษา audit trail ของ Transaction เก่า
      </div>
    </div>
  );
}
