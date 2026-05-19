import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import type { Lease } from '@/types/database';

const TYPES_HP = ['MOTOR_NEW', 'MOTOR_USED'] as const;
const TYPES_OTHER = ['EQUIPMENT', 'BUILDING', 'LAND', 'OFFICE'] as const;
const LEASE_STATUSES = ['Draft', 'Active', 'Closed', 'Modified'] as const;

export function LeaseList({ mode }: { mode: 'hp' | 'other' }) {
  const [search, setSearch] = useState('');
  const [caFilter, setCaFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [stFilter, setStFilter] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isHP = mode === 'hp';
  const baseRoute = isHP ? '/lease/hp' : '/lease/other';
  const title = isHP ? 'HP Motor' : 'Lease Other (TFRS 16)';
  const subtitle = isHP ? 'Hire Purchase — เช่าซื้อ' : 'สัญญาเช่า — TFRS 16 (Pure / ใช้สินเชื่อ)';

  const { data, isLoading } = useQuery({
    queryKey: ['lease-list', mode, search, typeFilter, stFilter],
    queryFn: async () => {
      let q = supabase.from('leases').select('*').eq('mode', mode).order('created_at', { ascending: false });
      if (typeFilter) q = q.eq('asset_type', typeFilter);
      if (stFilter) q = q.eq('status', stFilter);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as Lease[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter(
          (r) => r.lease_no.toLowerCase().includes(s) || r.asset_name.toLowerCase().includes(s),
        );
      }
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('leases').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lease-list'] });
      toast.success('ลบสัญญา Lease แล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const types = isHP ? TYPES_HP : TYPES_OTHER;

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Leases Agreement — {title}</h1>
        <p className="text-muted text-sm">{subtitle}</p>
      </div>

      <div className="mb-4">
        <Button variant="primary" onClick={() => navigate(`${baseRoute}/new`)}>
          <Plus className="w-4 h-4" /> New Lease Contract
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
                  placeholder="🔍 ค้นหา Lease Name / Contract Number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field-label">CREDIT AGREEMENT</label>
              <Select value={caFilter} onChange={(e) => setCaFilter(e.target.value)}>
                <option value="">– All –</option>
                <option>F/L_001</option>
                <option>F/L_002</option>
                <option>F/L_OP01</option>
              </Select>
            </div>
            <div>
              <label className="field-label">TYPE</label>
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">– All –</option>
                {types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="field-label">STATUS</label>
              <Select value={stFilter} onChange={(e) => setStFilter(e.target.value)}>
                <option value="">– All –</option>
                {LEASE_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
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
              <div className="text-4xl mb-2">{isHP ? '🚗' : '🏢'}</div>
              <p>ยังไม่มี {title}</p>
              <Button variant="primary" className="mt-4" onClick={() => navigate(`${baseRoute}/new`)}>
                <Plus className="w-4 h-4" /> สร้างใหม่
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-24">Edit | View</th>
                    <th>Lease Name</th>
                    <th>Contract Number</th>
                    <th>Type</th>
                    <th>Credit Agreement</th>
                    <th>Contract Date</th>
                    <th className="text-right">Term (M)</th>
                    <th className="text-right">Principal Amount</th>
                    <th className="text-right">Amount / Month</th>
                    <th>Classification</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`${baseRoute}/${l.id}`} className="text-brand hover:underline">
                            Edit
                          </Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`${baseRoute}/${l.id}`} className="text-brand hover:underline">
                            View
                          </Link>
                        </div>
                      </td>
                      <td>
                        <Link to={`${baseRoute}/${l.id}`} className="text-brand font-medium hover:underline">
                          {l.lease_no}
                        </Link>
                      </td>
                      <td>{l.lease_no}</td>
                      <td>{l.asset_type}</td>
                      <td>—</td>
                      <td>{fmtDate(l.start_date)}</td>
                      <td className="text-right tabular-nums">{l.term_months}</td>
                      <td className="text-right tabular-nums">{fmtMoney(l.principal)}</td>
                      <td className="text-right tabular-nums">
                        {fmtMoney(estMonthly(l))}
                      </td>
                      <td className="text-xs">{isHP ? 'Financing' : 'Operating'}</td>
                      <td>
                        <Badge variant={l.status === 'Active' ? 'success' : 'default'}>{l.status}</Badge>
                      </td>
                      <td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`ลบ ${l.lease_no}?`)) del.mutate(l.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-danger" />
                        </Button>
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
    </div>
  );
}

function estMonthly(l: Lease): number {
  // Quick estimate: PMT formula (excluding balloon/grace)
  const r = (l.annual_rate || 0) / 100 / 12;
  const n = l.term_months;
  const p = l.principal - (l.upfront_payment ?? 0);
  if (r === 0) return p / n;
  return (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}
