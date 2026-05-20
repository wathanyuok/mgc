import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { syncBotRatesToMaster } from '@/lib/bot-rate-feed';
import { Button, Card, CardContent, Input, Select, Badge } from '@/components/ui';
import { fmtDate, fmtPercent } from '@/lib/format';
import {
  type InterestRate,
  INTEREST_TYPES,
  FINANCE_INSTITUTIONS,
} from '@/types/database';

export function InterestRateList() {
  const [search, setSearch] = useState('');
  const [fi, setFi] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['ir-list', search, fi, type, status],
    queryFn: async () => {
      let q = supabase.from('interest_rates').select('*').order('id');
      if (fi) q = q.eq('finance_institution', fi);
      if (type) q = q.eq('interest_type', type);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as InterestRate[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.finance_institution.toLowerCase().includes(s) ||
            r.interest_type.toLowerCase().includes(s),
        );
      }
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('interest_rates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ir-list'] });
      toast.success('ลบแล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncBot = useMutation({
    mutationFn: async () => syncBotRatesToMaster(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['ir-list'] });
      toast.success(`✓ Sync from BOT — เพิ่ม ${r.inserted} · แทนที่ ${r.updated} · ไม่เปลี่ยน ${r.skipped}`);
    },
    onError: (e: any) => toast.error(`BOT sync failed: ${e.message}`),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Master Interest Rate</h1>
        <p className="text-muted text-sm">List</p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Button variant="primary" onClick={() => navigate('/master/interest-rate/new')}>
          <Plus className="w-4 h-4" /> New Master Interest Rate
        </Button>
        <Button
          variant="outline"
          onClick={() => syncBot.mutate()}
          disabled={syncBot.isPending}
          title="ดึงอัตราดอกเบี้ยอ้างอิงธนาคารพาณิชย์ (MLR/MOR/MRR) จาก BOT มา update master · ปัจจุบันเป็น stub รอ API key จาก BOT"
        >
          <RefreshCw className={`w-4 h-4 ${syncBot.isPending ? 'animate-spin' : ''}`} /> {syncBot.isPending ? 'Syncing...' : 'Sync from BOT'}
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
                  placeholder="🔍 ค้นหา…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field-label">FINANCE INSTITUTION</label>
              <Select value={fi} onChange={(e) => setFi(e.target.value)}>
                <option value="">– All –</option>
                {FINANCE_INSTITUTIONS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="field-label">INTEREST TYPE</label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">– All –</option>
                {INTEREST_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option>
                <option>Active</option>
                <option>Inactive</option>
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
              <div className="text-4xl mb-2">📊</div>
              <p>ไม่พบ Interest Rate</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-24">Edit | View</th>
                    <th className="text-right w-12">ID</th>
                    <th>Finance Institution</th>
                    <th>Interest Type</th>
                    <th>Date Effective</th>
                    <th>End Effective Date</th>
                    <th className="text-right">Base Rate</th>
                    <th className="text-right">Margin</th>
                    <th className="text-right">Effective Rate</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`/master/interest-rate/${r.id}`} className="text-brand hover:underline">
                            Edit
                          </Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`/master/interest-rate/${r.id}`} className="text-brand hover:underline">
                            View
                          </Link>
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{r.id}</td>
                      <td>{r.finance_institution}</td>
                      <td className="font-medium">{r.interest_type}</td>
                      <td>{fmtDate(r.date_effective)}</td>
                      <td>{r.end_effective_date ? fmtDate(r.end_effective_date) : '—'}</td>
                      <td className="text-right tabular-nums">{fmtPercent(r.base_rate)}</td>
                      <td className="text-right tabular-nums text-muted">
                        {r.margin >= 0 ? '+' : ''}
                        {r.margin.toFixed(2)}%
                      </td>
                      <td className="text-right tabular-nums font-semibold text-brand">
                        {fmtPercent(r.effective_rate)}
                      </td>
                      <td>
                        <Badge variant={r.status === 'Active' ? 'success' : 'default'}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`ลบ Interest Rate #${r.id}?`)) del.mutate(r.id);
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

      <div className="mt-4 bg-brand-light border-l-4 border-brand p-3 text-sm text-ink rounded">
        💡 <strong>Master Interest Rate</strong> — อัตราดอกเบี้ยอ้างอิงของธนาคาร (MLR · MOR · MRR ฯลฯ)
        ใช้สำหรับคำนวณดอกเบี้ยใน CA / P/N / OD / TR ที่ใช้ Floating Rate. เมื่อมีการเปลี่ยนอัตรา
        ให้สร้าง record ใหม่ ระบบจะ Inactive ตัวเก่าอัตโนมัติ
      </div>
    </div>
  );
}
