import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type Overdraft, FINANCE_INSTITUTIONS } from '@/types/database';

export function ODList() {
  const [search, setSearch] = useState('');
  const [fi, setFi] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['od-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('overdrafts').select('*').order('start_date', { ascending: false });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as Overdraft[];
      if (search) rows = rows.filter((r) => r.od_no.toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('overdrafts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['od-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2"><h1 className="text-2xl font-bold">Overdraft (O/D)</h1><p className="text-muted text-sm">List</p></div>
      <div className="mb-4"><Button variant="primary" onClick={() => navigate('/tx/od/new')}><Plus className="w-4 h-4" /> New Overdraft</Button></div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="field-label">Search</label>
              <div className="relative"><Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input className="pl-8" placeholder="🔍 OD No" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div><label className="field-label">FINANCE INSTITUTION</label>
              <Select value={fi} onChange={(e) => setFi(e.target.value)}>
                <option value="">– All –</option>{FINANCE_INSTITUTIONS.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div><label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option><option>Draft</option><option>Active</option><option>Suspended</option><option>Closed</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        {isLoading ? <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
        : !data || data.length === 0 ? <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">💳</div><p>ไม่พบ Overdraft</p></div>
        : <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Edit | View</th><th>OD No</th><th>FI</th><th>Account No</th><th className="text-right">Limit</th><th className="text-right">Used</th><th className="text-right">Available</th><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td><div className="flex gap-2 text-xs"><Link to={`/tx/od/${r.id}`} className="text-brand hover:underline">Edit</Link><span className="text-gray-300">|</span><Link to={`/tx/od/${r.id}?view=1`} className="text-brand hover:underline">View</Link></div></td>
                <td><Link to={`/tx/od/${r.id}`} className="text-brand font-medium hover:underline">{r.od_no}</Link></td>
                <td>{r.finance_institution}</td>
                <td>{r.account_no}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.facility_limit)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.used_amount)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.facility_limit - r.used_amount)}</td>
                <td>{fmtDate(r.start_date)}</td>
                <td>{r.end_date ? fmtDate(r.end_date) : '—'}</td>
                <td><Badge variant={r.status === 'Active' ? 'success' : 'default'}>{r.status}</Badge></td>
                <td className="text-right"><Button variant="ghost" size="sm" onClick={() => { if (confirm(`ลบ ${r.od_no}?`)) del.mutate(r.id); }}><Trash2 className="w-3.5 h-3.5 text-danger" /></Button></td>
              </tr>
            ))}</tbody>
          </table></div>}
      </CardContent></Card>
    </div>
  );
}
