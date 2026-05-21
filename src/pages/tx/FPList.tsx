import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type FloorPlan, FINANCE_INSTITUTIONS } from '@/types/database';

export function FPList() {
  const [search, setSearch] = useState('');
  const [fi, setFi] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['fp-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('floor_plans').select('*').order('start_date', { ascending: false });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as FloorPlan[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r) => r.fp_no.toLowerCase().includes(s) || (r.vendor ?? '').toLowerCase().includes(s));
      }
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('floor_plans').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fp-list'] });
      toast.success('ลบแล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Floor Plan</h1>
        <p className="text-muted text-sm">List</p>
      </div>
      <div className="mb-4">
        <Button variant="primary" onClick={() => navigate('/tx/fp/new')}>
          <Plus className="w-4 h-4" /> New Floor Plan
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input className="pl-8" placeholder="🔍 FP No / Vendor" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="field-label">FINANCE INSTITUTION</label>
              <Select value={fi} onChange={(e) => setFi(e.target.value)}>
                <option value="">– All –</option>
                {FINANCE_INSTITUTIONS.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option>
                <option>Draft</option><option>Active</option><option>Closed</option><option>Cancelled</option>
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
            <div className="p-12 text-center text-muted"><div className="text-4xl mb-2">📦</div><p>ไม่พบ Floor Plan</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-24">Edit | View</th>
                    <th>FP No</th>
                    <th>Finance Institution</th>
                    <th>Vendor</th>
                    <th>Schedule Mode</th>
                    <th>Start Date</th>
                    <th>End Date</th>
                    <th className="text-right">Total Amount</th>
                    <th className="text-right">Used</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`/tx/fp/${r.id}`} className="text-brand hover:underline">Edit</Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`/tx/fp/${r.id}?view=1`} className="text-brand hover:underline">View</Link>
                        </div>
                      </td>
                      <td><Link to={`/tx/fp/${r.id}`} className="text-brand font-medium hover:underline">{r.fp_no}</Link></td>
                      <td>{r.finance_institution}</td>
                      <td>{r.vendor}</td>
                      <td><Badge variant={r.schedule_mode === 'bmw' ? 'brand' : 'default'}>{r.schedule_mode.toUpperCase()}</Badge></td>
                      <td>{fmtDate(r.start_date)}</td>
                      <td>{r.end_date ? fmtDate(r.end_date) : '—'}</td>
                      <td className="text-right tabular-nums">{fmtMoney(r.total_amount)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(r.used_amount)}</td>
                      <td><Badge variant={r.status === 'Active' ? 'success' : 'default'}>{r.status}</Badge></td>
                      <td className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => { if (confirm(`ลบ ${r.fp_no}?`)) del.mutate(r.id); }}>
                          <Trash2 className="w-3.5 h-3.5 text-danger" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
