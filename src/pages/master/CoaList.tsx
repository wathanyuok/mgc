import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import type { GLAccount } from '@/types/database';

const MOCK_ACCOUNTS: Array<Omit<GLAccount, 'id' | 'created_at'>> = [
  { company: 'MGC Asia', code: '1100-01', name: 'เงินสด – บัญชีออมทรัพย์ SCB', fs_no: '1.1', fs_name: 'เงินสดและรายการเทียบเท่า', fs_group: 'Current Assets', conso_group: null, nfs_group: null, inactive: false },
  { company: 'MGC Asia', code: '1200-01', name: 'ลูกหนี้การค้า', fs_no: '1.2', fs_name: 'ลูกหนี้การค้า', fs_group: 'Current Assets', conso_group: null, nfs_group: null, inactive: false },
  { company: 'MGC Asia', code: '1300-01', name: 'เงินให้กู้ยืม – Loan Receivable', fs_no: '1.3', fs_name: 'เงินให้กู้ยืม', fs_group: 'Current Assets', conso_group: null, nfs_group: null, inactive: false },
  { company: 'MGC Asia', code: '2100-01', name: 'เงินกู้ยืมระยะสั้น – ธนาคาร', fs_no: '2.1', fs_name: 'เงินกู้ยืมระยะสั้น', fs_group: 'Current Liabilities', conso_group: null, nfs_group: null, inactive: false },
  { company: 'MGC Asia', code: '2200-01', name: 'เงินกู้ยืมระยะยาว – ธนาคาร', fs_no: '2.2', fs_name: 'เงินกู้ยืมระยะยาว', fs_group: 'Long-term Liabilities', conso_group: null, nfs_group: null, inactive: false },
  { company: 'MGC Asia', code: '5100-01', name: 'ดอกเบี้ยจ่าย', fs_no: '5.1', fs_name: 'ค่าใช้จ่ายทางการเงิน', fs_group: 'Expenses', conso_group: null, nfs_group: null, inactive: false },
  { company: 'MGC Asia', code: '5200-01', name: 'ค่าธรรมเนียมธนาคาร', fs_no: '5.2', fs_name: 'ค่าใช้จ่ายอื่น', fs_group: 'Expenses', conso_group: null, nfs_group: null, inactive: false },
  { company: 'MGC Asia', code: '5300-01', name: 'ค่าปรับชำระล่าช้า', fs_no: '5.3', fs_name: 'ค่าใช้จ่ายอื่น', fs_group: 'Expenses', conso_group: null, nfs_group: null, inactive: false },
];

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

  const importMock = useMutation({
    mutationFn: async () => {
      const existing = data ?? [];
      const existingCodes = new Set(existing.map((r) => `${r.company ?? ''}|${r.code}`));
      const toInsert = MOCK_ACCOUNTS.filter((m) => !existingCodes.has(`${m.company ?? ''}|${m.code}`));
      if (toInsert.length === 0) return 0;
      const { error } = await supabase.from('gl_accounts').insert(toInsert);
      if (error) throw error;
      return toInsert.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['coa-list'] });
      if (n === 0) toast.info('ทุก mock account มีอยู่แล้ว');
      else toast.success(`✓ Import mock — เพิ่ม ${n} บัญชี`);
    },
    onError: (e: any) => toast.error(`Import failed: ${e.message}`),
  });

  // Distinct companies for filter dropdown
  const allCompanies = Array.from(new Set((data ?? []).map((r) => r.company).filter(Boolean))) as string[];

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Chart of Accounts (COA)</h1>
        <p className="text-muted text-sm">List</p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Button variant="primary" onClick={() => navigate('/master/coa/new')}>
          <Plus className="w-4 h-4" /> New Account
        </Button>
        <Button
          variant="outline"
          onClick={() => importMock.mutate()}
          disabled={importMock.isPending}
          title="นำเข้าตัวอย่าง 8 บัญชีเพื่อใช้ทดสอบ — ของจริงให้ Import จากไฟล์ที่ MGC ส่งให้"
        >
          <RefreshCw className={`w-4 h-4 ${importMock.isPending ? 'animate-spin' : ''}`} /> {importMock.isPending ? 'Importing...' : `Import Mock (${MOCK_ACCOUNTS.length} rows)`}
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
              <p>ยังไม่มีบัญชี — กด <strong>+ New Account</strong> หรือ <strong>Import Mock</strong></p>
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
                  {data.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`/master/coa/${r.id}`} className="text-brand hover:underline">
                            Edit
                          </Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`/master/coa/${r.id}`} className="text-brand hover:underline">
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
              <div className="px-4 py-2 border-t border-line text-xs text-muted">
                1 - {data.length} of {data.length}
              </div>
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
