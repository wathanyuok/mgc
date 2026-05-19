import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import {
  type CreditAgreement,
  FINANCE_INSTITUTIONS,
  CA_FACILITY_TYPES,
  CA_STATUS,
} from '@/types/database';

const statusVariant: Record<string, any> = {
  Approved: 'success',
  Draft: 'default',
  Expired: 'warn',
  Closed: 'default',
  Terminated: 'danger',
};

export function CAList() {
  const [search, setSearch] = useState('');
  const [fi, setFi] = useState('');
  const [ft, setFt] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['ca-list', search, fi, ft, status],
    queryFn: async () => {
      let q = supabase
        .from('credit_agreements')
        .select('*, master_agreements(ma_name)')
        .order('ca_name');
      if (fi) q = q.eq('finance_institution', fi);
      if (ft) q = q.eq('facility_type', ft);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as any[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.ca_name.toLowerCase().includes(s) ||
            (r.contract_number ?? '').toLowerCase().includes(s),
        );
      }
      return rows as (CreditAgreement & { master_agreements: { ma_name: string } | null })[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('credit_agreements').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ca-list'] });
      toast.success('ลบแล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1500px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Credit Agreement</h1>
        <p className="text-muted text-sm">List</p>
      </div>
      <div className="mb-4">
        <Button variant="primary" onClick={() => navigate('/ca/new')}>
          <Plus className="w-4 h-4" /> New Credit Agreement
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input
                  className="pl-8"
                  placeholder="🔍 ค้นหา Credit Agreement Name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
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
              <label className="field-label">FACILITY TYPE</label>
              <Select value={ft} onChange={(e) => setFt(e.target.value)}>
                <option value="">– All –</option>
                {CA_FACILITY_TYPES.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option>
                {CA_STATUS.map((s) => <option key={s}>{s}</option>)}
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
              <div className="text-4xl mb-2">💳</div>
              <p>ไม่พบ Credit Agreement</p>
              <Button variant="primary" className="mt-4" onClick={() => navigate('/ca/new')}>
                <Plus className="w-4 h-4" /> สร้างใหม่
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-24">Edit | View</th>
                    <th>Name</th>
                    <th>Contract Number</th>
                    <th>Master Agreement</th>
                    <th>Subsidiary</th>
                    <th>Facility Type</th>
                    <th>Finance Institution</th>
                    <th>Start Date</th>
                    <th>End Date</th>
                    <th className="text-right">Credit Line</th>
                    <th className="text-right">Utilization</th>
                    <th className="text-right">Remaining</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`/ca/${c.id}`} className="text-brand hover:underline">Edit</Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`/ca/${c.id}`} className="text-brand hover:underline">View</Link>
                        </div>
                      </td>
                      <td><Link to={`/ca/${c.id}`} className="text-brand font-medium hover:underline">{c.ca_name}</Link></td>
                      <td>{c.contract_number}</td>
                      <td>{c.master_agreements?.ma_name ?? '—'}</td>
                      <td>{c.subsidiary}</td>
                      <td><span className="px-2 py-0.5 text-xs bg-brand-light text-brand rounded">{c.facility_type}</span></td>
                      <td>{c.finance_institution ?? '—'}</td>
                      <td>{fmtDate(c.start_date)}</td>
                      <td>{fmtDate(c.end_date)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(c.credit_line)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(c.utilization)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(c.remaining)}</td>
                      <td><Badge variant={statusVariant[c.status] ?? 'default'}>{c.status}</Badge></td>
                      <td className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => { if (confirm(`ลบ ${c.ca_name}?`)) del.mutate(c.id); }}>
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
