import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, Input, Select } from '@/components/ui';
import type { GLAccount } from '@/types/database';

// Chart of Accounts master (MoM Day1 §2.7). Hidden page — reached by /master/coa,
// not shown in the sidebar yet. Feeds the GL Account dropdown in Account Mapping.
export function CoaList() {
  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['coa-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('gl_accounts').select('*').order('code');
      if (error) throw error;
      return (data ?? []) as GLAccount[];
    },
  });

  const companies = Array.from(new Set(data.map((r) => r.company).filter(Boolean))) as string[];
  const rows = data.filter((r) => {
    if (company && r.company !== company) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.code.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Chart of Accounts (COA)</h1>
        <p className="text-muted text-sm">ผังบัญชีสำหรับ Account Mapping — ใช้ผูก GL ตอน Post JE → NetSuite</p>
      </div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input className="pl-8" placeholder="🔍 รหัส / ชื่อบัญชี" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="field-label">Company (Apply for)</label>
              <Select value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">– All –</option>
                {companies.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div className="flex items-end text-sm text-muted">{rows.length.toLocaleString()} / {data.length.toLocaleString()} บัญชี</div>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        {isLoading ? <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
        : rows.length === 0 ? <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">📒</div><p>ไม่พบบัญชี (ต้อง apply migration 0036 ก่อน)</p></div>
        : <div className="overflow-x-auto max-h-[70vh]"><table className="table-base text-sm">
            <thead className="sticky top-0 bg-white"><tr><th>Company</th><th>Code</th><th>Account Name</th><th>FS No.</th><th>FS Group</th><th>NFS Group</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td>{r.company}</td>
                <td className="tabular-nums font-medium">{r.code}</td>
                <td>{r.name}</td>
                <td className="text-muted">{r.fs_no}</td>
                <td className="text-muted">{r.fs_group}</td>
                <td className="text-muted">{r.nfs_group}</td>
              </tr>
            ))}</tbody>
          </table></div>}
      </CardContent></Card>
    </div>
  );
}
