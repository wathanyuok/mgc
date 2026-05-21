import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type LetterOfCredit, FINANCE_INSTITUTIONS } from '@/types/database';

export function LCList() {
  const [search, setSearch] = useState('');
  const [fi, setFi] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['lc-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('letters_of_credit').select('*').order('expiry_date', { ascending: true });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as LetterOfCredit[];
      if (search) rows = rows.filter((r) => r.lc_no.toLowerCase().includes(search.toLowerCase()) || (r.beneficiary ?? '').toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('letters_of_credit').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lc-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2"><h1 className="text-2xl font-bold">Letter of Credit (L/C)</h1><p className="text-muted text-sm">Off-Balance / Fee-based · Flow LC → TR</p></div>
      <div className="mb-4"><Button variant="primary" onClick={() => navigate('/tx/lc/new')}><Plus className="w-4 h-4" /> New Letter of Credit</Button></div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="field-label">Search</label>
              <div className="relative"><Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input className="pl-8" placeholder="🔍 LC No / Beneficiary" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div><label className="field-label">FINANCE INSTITUTION</label>
              <Select value={fi} onChange={(e) => setFi(e.target.value)}>
                <option value="">– All –</option>{FINANCE_INSTITUTIONS.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div><label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option><option>Draft</option><option>Approved</option><option>Active</option><option>Converted</option><option>Expired</option><option>Closed</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        {isLoading ? <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
        : !data || data.length === 0 ? <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">📄</div><p>ไม่พบ Letter of Credit</p></div>
        : <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Edit | View</th><th>LC No</th><th>Type</th><th>FI</th><th>Beneficiary</th><th>Issue</th><th>Expiry</th><th className="text-right">Amount (Foreign)</th><th>Ccy</th><th className="text-right">THB Equiv.</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td><div className="flex gap-2 text-xs"><Link to={`/tx/lc/${r.id}`} className="text-brand hover:underline">Edit</Link><span className="text-gray-300">|</span><Link to={`/tx/lc/${r.id}?view=1`} className="text-brand hover:underline">View</Link></div></td>
                <td><Link to={`/tx/lc/${r.id}`} className="text-brand font-medium hover:underline">{r.lc_no}</Link></td>
                <td>{r.lc_type === 'SBLC' ? <Badge variant="warn">SBLC</Badge> : <Badge variant="default">LC</Badge>}</td>
                <td>{r.finance_institution}</td>
                <td>{r.beneficiary}</td>
                <td>{r.issue_date ? fmtDate(r.issue_date) : '—'}</td>
                <td>{r.expiry_date ? fmtDate(r.expiry_date) : '—'}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.amount_foreign)}</td>
                <td>{r.currency}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
                <td><Badge variant={r.status === 'Active' ? 'success' : r.status === 'Converted' ? 'brand' : r.status === 'Expired' || r.status === 'Closed' ? 'default' : 'warn'}>{r.status}</Badge></td>
                <td className="text-right"><Button variant="ghost" size="sm" onClick={() => { if (confirm(`ลบ ${r.lc_no}?`)) del.mutate(r.id); }}><Trash2 className="w-3.5 h-3.5 text-danger" /></Button></td>
              </tr>
            ))}</tbody>
          </table></div>}
      </CardContent></Card>
    </div>
  );
}
