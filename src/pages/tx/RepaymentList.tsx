import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type Repayment, FACILITY_TYPES } from '@/types/database';

export function RepaymentList() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['rep-list', search, type, status],
    queryFn: async () => {
      let q = supabase.from('repayments').select('*').order('pay_date', { ascending: false });
      if (type) q = q.eq('facility_type', type);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as Repayment[];
      if (search) rows = rows.filter((r) => r.repayment_no.toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('repayments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rep-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2"><h1 className="text-2xl font-bold">Repayment</h1><p className="text-muted text-sm">Centralized repayment journal — covers all facility types</p></div>
      <div className="mb-4"><Button variant="primary" onClick={() => navigate('/tx/repayment/new')}><Plus className="w-4 h-4" /> New Repayment</Button></div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="field-label">Search</label>
              <div className="relative"><Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input className="pl-8" placeholder="🔍 Repayment No" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div><label className="field-label">FACILITY TYPE</label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">– All –</option>{FACILITY_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </div>
            <div><label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option><option>Draft</option><option>Posted</option><option>Reversed</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        {isLoading ? <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
        : !data || data.length === 0 ? <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">💸</div><p>ไม่พบ Repayment</p></div>
        : <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Edit | View</th><th>Repayment No</th><th>Facility</th><th>Pay Date</th><th className="text-right">Amount</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Fee</th><th>Channel</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td><div className="flex gap-2 text-xs"><Link to={`/tx/repayment/${r.id}`} className="text-brand hover:underline">Edit</Link><span className="text-gray-300">|</span><Link to={`/tx/repayment/${r.id}?view=1`} className="text-brand hover:underline">View</Link></div></td>
                <td><Link to={`/tx/repayment/${r.id}`} className="text-brand font-medium hover:underline">{r.repayment_no}</Link></td>
                <td><Badge variant="brand">{r.facility_type}</Badge></td>
                <td>{fmtDate(r.pay_date)}</td>
                <td className="text-right tabular-nums font-medium">{fmtMoney(r.amount)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.principal)}</td>
                <td className="text-right tabular-nums text-amber-700">{fmtMoney(r.interest)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.fee)}</td>
                <td className="text-xs">{r.channel}</td>
                <td><Badge variant={r.status === 'Posted' ? 'success' : r.status === 'Reversed' ? 'danger' : 'default'}>{r.status}</Badge></td>
                <td className="text-right"><Button variant="ghost" size="sm" onClick={() => { if (confirm(`ลบ ${r.repayment_no}?`)) del.mutate(r.id); }}><Trash2 className="w-3.5 h-3.5 text-danger" /></Button></td>
              </tr>
            ))}</tbody>
          </table></div>}
      </CardContent></Card>
    </div>
  );
}
