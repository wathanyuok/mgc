import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { type BankStatement, FINANCE_INSTITUTIONS } from '@/types/database';

export function BankStatementList() {
  const [search, setSearch] = useState('');
  const [inst, setInst] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['bank-stmt-list', search, inst],
    queryFn: async () => {
      let q = supabase.from('bank_statements').select('*').order('updated_at', { ascending: false });
      if (inst) q = q.eq('finance_institution', inst);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as BankStatement[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.account_no.toLowerCase().includes(s) ||
            (r.statement_name ?? '').toLowerCase().includes(s) ||
            (r.statement_period ?? '').toLowerCase().includes(s),
        );
      }
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bank_statements').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-stmt-list'] });
      toast.success('ลบ Bank Statement แล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Bank Statement</h1>
        <p className="text-muted text-sm">
          จัดการ Bank Statement กลาง — ใช้คำนวณดอกเบี้ย O/D โดย match จาก Account Number
        </p>
      </div>

      <div className="mb-4">
        <Button variant="primary" onClick={() => navigate('/master/bank-statement/new')}>
          <Plus className="w-4 h-4" /> New Bank Statement
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input
                  className="pl-8"
                  placeholder="🔍 Account Number / Period / Name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field-label">FINANCE INSTITUTION</label>
              <Select value={inst} onChange={(e) => setInst(e.target.value)}>
                <option value="">– All –</option>
                {FINANCE_INSTITUTIONS.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </div>
            <div />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
          ) : !data || data.length === 0 ? (
            <div className="p-12 text-center text-muted">
              <div className="text-4xl mb-2">🏦</div>
              <p>ไม่พบ Bank Statement — กด "+ New Bank Statement" เพื่อสร้าง</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-24">Edit | View</th>
                    <th>Institution</th>
                    <th>Account Number</th>
                    <th>Period</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th className="w-24">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`/master/bank-statement/${r.id}`} className="text-brand hover:underline">
                            Edit
                          </Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`/master/bank-statement/${r.id}`} className="text-brand hover:underline">
                            View
                          </Link>
                        </div>
                      </td>
                      <td className="font-semibold">{r.finance_institution}</td>
                      <td className="font-mono text-xs">{r.account_no}</td>
                      <td>{r.statement_period ?? '—'}</td>
                      <td>{r.statement_name ?? '—'}</td>
                      <td>
                        {r.inactive ? <Badge variant="default">Inactive</Badge> : <Badge variant="success">Active</Badge>}
                      </td>
                      <td className="text-xs">{fmtDate(r.updated_at)}</td>
                      <td>
                        <button
                          onClick={() => {
                            if (confirm(`ลบ Statement ${r.account_no} ?`)) del.mutate(r.id);
                          }}
                          className="text-danger hover:underline text-xs"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline" /> Delete
                        </button>
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
