import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type TrustReceipt, FINANCE_INSTITUTIONS } from '@/types/database';

export function TRList() {
  const [search, setSearch] = useState('');
  const [fi, setFi] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['tr-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('trust_receipts').select('*').order('due_date', { ascending: true });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as TrustReceipt[];
      if (search) rows = rows.filter((r) => r.tr_no.toLowerCase().includes(search.toLowerCase()) || (r.supplier ?? '').toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('trust_receipts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tr-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2"><h1 className="text-2xl font-bold">Trust Receipt (T/R)</h1><p className="text-muted text-sm">List</p></div>
      <div className="mb-4"><Button variant="primary" onClick={() => navigate('/tx/tr/new')}><Plus className="w-4 h-4" /> New Trust Receipt</Button></div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="field-label">Search</label>
              <div className="relative"><Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input className="pl-8" placeholder="🔍 TR No / Supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div><label className="field-label">FINANCE INSTITUTION</label>
              <Select value={fi} onChange={(e) => setFi(e.target.value)}>
                <option value="">– All –</option>{FINANCE_INSTITUTIONS.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div><label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option><option>Draft</option><option>Active</option><option>Repaid</option><option>Cancelled</option>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        {isLoading ? <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
        : !data || data.length === 0 ? <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">📥</div><p>ไม่พบ Trust Receipt</p></div>
        : <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Edit | View</th><th>TR No</th><th>FI</th><th>Supplier</th><th>Invoice No</th><th>Invoice Date</th><th>Due Date</th><th className="text-right">Term (Days)</th><th className="text-right">Amount</th><th>Currency</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td><div className="flex gap-2 text-xs"><Link to={`/tx/tr/${r.id}`} className="text-brand hover:underline">Edit</Link><span className="text-gray-300">|</span><Link to={`/tx/tr/${r.id}?view=1`} className="text-brand hover:underline">View</Link></div></td>
                <td><Link to={`/tx/tr/${r.id}`} className="text-brand font-medium hover:underline">{r.tr_no}</Link></td>
                <td>{r.finance_institution}</td>
                <td>{r.supplier}</td>
                <td>{r.invoice_no}</td>
                <td>{r.invoice_date ? fmtDate(r.invoice_date) : '—'}</td>
                <td>{fmtDate(r.due_date)}</td>
                <td className="text-right tabular-nums">{r.term_days}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
                <td>{r.currency}</td>
                <td><Badge variant={r.status === 'Active' ? 'success' : r.status === 'Repaid' ? 'default' : 'warn'}>{r.status}</Badge></td>
                <td className="text-right"><Button variant="ghost" size="sm" onClick={() => { if (confirm(`ลบ ${r.tr_no}?`)) del.mutate(r.id); }}><Trash2 className="w-3.5 h-3.5 text-danger" /></Button></td>
              </tr>
            ))}</tbody>
          </table></div>}
      </CardContent></Card>
    </div>
  );
}
