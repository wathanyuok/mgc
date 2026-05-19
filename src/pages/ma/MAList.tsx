import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import {
  type MasterAgreement,
  FINANCE_INSTITUTIONS,
  SUBSIDIARIES,
  MA_STATUS,
} from '@/types/database';

const statusVariant: Record<string, any> = {
  Approved: 'success',
  Draft: 'default',
  Rejected: 'danger',
  Expired: 'warn',
  Terminated: 'danger',
};

export function MAList() {
  const [search, setSearch] = useState('');
  const [subFilter, setSubFilter] = useState('');
  const [fiFilter, setFiFilter] = useState('');
  const [stFilter, setStFilter] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['ma-list', search, subFilter, fiFilter, stFilter],
    queryFn: async () => {
      let q = supabase.from('master_agreements').select('*').order('ma_name');
      if (search) q = q.ilike('ma_name', `%${search}%`);
      if (subFilter) q = q.eq('subsidiary', subFilter);
      if (fiFilter) q = q.eq('finance_institution', fiFilter);
      if (stFilter) q = q.eq('status', stFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as MasterAgreement[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('master_agreements').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ma-list'] });
      toast.success('ลบสัญญาแล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Master Agreement</h1>
        <p className="text-muted text-sm">List</p>
      </div>

      <div className="mb-4">
        <Button variant="primary" onClick={() => navigate('/ma/new')}>
          <Plus className="w-4 h-4" /> New Master Agreement
        </Button>
      </div>

      {/* Filter bar — matches HTML .list-filter */}
      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input
                  className="pl-8"
                  placeholder="🔍 ค้นหา Agreement Name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field-label">SUBSIDIARY</label>
              <Select value={subFilter} onChange={(e) => setSubFilter(e.target.value)}>
                <option value="">– All –</option>
                {SUBSIDIARIES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="field-label">FINANCE INSTITUTION</label>
              <Select value={fiFilter} onChange={(e) => setFiFilter(e.target.value)}>
                <option value="">– All –</option>
                {FINANCE_INSTITUTIONS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="field-label">STATUS</label>
              <Select value={stFilter} onChange={(e) => setStFilter(e.target.value)}>
                <option value="">– All –</option>
                {MA_STATUS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-danger text-sm">เกิดข้อผิดพลาด: {(error as any).message}</div>
          ) : isLoading ? (
            <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
          ) : !data || data.length === 0 ? (
            <div className="p-12 text-center text-muted">
              <div className="text-4xl mb-2">📄</div>
              <p>ไม่พบ Master Agreement</p>
              <Button variant="primary" className="mt-4" onClick={() => navigate('/ma/new')}>
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
                    <th>Subsidiary</th>
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
                  {data.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`/ma/${m.id}`} className="text-brand hover:underline">
                            Edit
                          </Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`/ma/${m.id}`} className="text-brand hover:underline">
                            View
                          </Link>
                        </div>
                      </td>
                      <td>
                        <Link to={`/ma/${m.id}`} className="text-brand font-medium hover:underline">
                          {m.ma_name}
                        </Link>
                      </td>
                      <td>{m.subsidiary}</td>
                      <td>{m.finance_institution}</td>
                      <td>{fmtDate(m.start_date)}</td>
                      <td>{fmtDate(m.end_date)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(m.credit_line)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(m.utilization)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(m.remaining_credit)}</td>
                      <td>
                        <Badge variant={statusVariant[m.status] ?? 'default'}>{m.status}</Badge>
                      </td>
                      <td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`ลบ ${m.ma_name}?`)) del.mutate(m.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-danger" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-4 py-2 border-t border-line text-xs text-muted">
                <div>
                  1 - {data.length} of {data.length}
                </div>
                <div className="flex gap-1">
                  <button className="btn btn-ghost !px-2 !py-1 text-xs" disabled>
                    «
                  </button>
                  <button className="btn btn-ghost !px-2 !py-1 text-xs" disabled>
                    ‹
                  </button>
                  <button className="btn btn-primary !px-2 !py-1 text-xs">1</button>
                  <button className="btn btn-ghost !px-2 !py-1 text-xs" disabled>
                    ›
                  </button>
                  <button className="btn btn-ghost !px-2 !py-1 text-xs" disabled>
                    »
                  </button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
