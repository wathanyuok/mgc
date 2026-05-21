import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type FXForward, FINANCE_INSTITUTIONS } from '@/types/database';

export function FXFList() {
  const [search, setSearch] = useState('');
  const [fi, setFi] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['fxf-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('fx_forwards').select('*').order('value_date', { ascending: true });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as FXForward[];
      if (search) rows = rows.filter((r) => r.fxf_no.toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fx_forwards').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fxf-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2"><h1 className="text-2xl font-bold">FX Forward Rate</h1><p className="text-muted text-sm">List</p></div>
      <div className="mb-4"><Button variant="primary" onClick={() => navigate('/tx/fxf/new')}><Plus className="w-4 h-4" /> New FX Forward</Button></div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="field-label">Search</label>
              <div className="relative"><Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input className="pl-8" placeholder="🔍 FXF No" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div><label className="field-label">FINANCE INSTITUTION</label>
              <Select value={fi} onChange={(e) => setFi(e.target.value)}>
                <option value="">– All –</option>{FINANCE_INSTITUTIONS.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div><label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option><option>Draft</option><option>Active</option><option>Settled</option><option>Cancelled</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        {isLoading ? <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
        : !data || data.length === 0 ? <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">💱</div><p>ไม่พบ FX Forward</p></div>
        : <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Edit | View</th><th>FXF No</th><th>FI</th><th>Direction</th><th>Pair</th><th className="text-right">Amount Buy</th><th className="text-right">Amount Sell</th><th className="text-right">Forward Rate</th><th>Deal Date</th><th>Value Date</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td><div className="flex gap-2 text-xs"><Link to={`/tx/fxf/${r.id}`} className="text-brand hover:underline">Edit</Link><span className="text-gray-300">|</span><Link to={`/tx/fxf/${r.id}?view=1`} className="text-brand hover:underline">View</Link></div></td>
                <td><Link to={`/tx/fxf/${r.id}`} className="text-brand font-medium hover:underline">{r.fxf_no}</Link></td>
                <td>{r.finance_institution}</td>
                <td><Badge variant={r.direction === 'Buy' ? 'success' : 'warn'}>{r.direction}</Badge></td>
                <td>{r.ccy_buy}/{r.ccy_sell}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.amount_buy, { decimals: 4 })}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.amount_sell, { decimals: 2 })}</td>
                <td className="text-right tabular-nums">{r.forward_rate.toFixed(6)}</td>
                <td>{fmtDate(r.deal_date)}</td>
                <td>{fmtDate(r.value_date)}</td>
                <td><Badge variant={r.status === 'Active' ? 'success' : r.status === 'Settled' ? 'default' : 'warn'}>{r.status}</Badge></td>
                <td className="text-right"><Button variant="ghost" size="sm" onClick={() => { if (confirm(`ลบ ${r.fxf_no}?`)) del.mutate(r.id); }}><Trash2 className="w-3.5 h-3.5 text-danger" /></Button></td>
              </tr>
            ))}</tbody>
          </table></div>}
      </CardContent></Card>
    </div>
  );
}
