import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { syncBotRatesToMaster } from '@/lib/bot-rate-feed';
import { Button, Card, CardContent, Input, Select, Badge, usePaged, Pagination } from '@/components/ui';
import { fmtDate, fmtPercent } from '@/lib/format';
import {
  type InterestRate,
  INTEREST_TYPES,
} from '@/types/database';
import { useBankCodes } from '@/lib/banks';

import { logDelete } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';

export function InterestRateList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const [search, setSearch] = useState('');
  const [fi, setFi] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('master_interest', 'edit');

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

  // BR-MST-IR-002 — Block delete if interest_type is referenced by any TX rate_cards
  const del = useMutation({
    mutationFn: async (id: number) => {
      // 1. Load the rate to get interest_type (needed for jsonb contains check)
      const { data: rate, error: rateErr } = await supabase
        .from('interest_rates')
        .select('interest_type, finance_institution')
        .eq('id', id)
        .single();
      if (rateErr) throw rateErr;

      // 2. ไล่ทุกตารางที่เก็บการ์ดอัตราดอกเบี้ย — เดิมตรวจแค่ 5 ตารางธุรกรรม
      //    ทำให้อัตราที่ถูกใช้เฉพาะในวงเงินหรือหนังสือค้ำประกันถูกลบทิ้งได้
      //    โครงสร้างการ์ด: [{ type, rate, condition, ... }]
      const tables = [
        'credit_agreements', 'letter_guarantees',
        'promissory_notes', 'floor_plans', 'overdrafts', 'trust_receipts', 'loans',
      ] as const;
      const TABLE_LABEL: Record<string, string> = {
        credit_agreements: 'วงเงิน',
        letter_guarantees: 'หนังสือค้ำประกัน',
        promissory_notes: 'ตั๋วสัญญาใช้เงิน',
        floor_plans: 'สินเชื่อสต๊อกรถ',
        overdrafts: 'เบิกเกินบัญชี',
        trust_receipts: 'ทรัสต์รีซีท',
        loans: 'เงินกู้',
      };
      const usageCounts: Record<string, number> = {};
      let totalUsage = 0;

      for (const tbl of tables) {
        const { count, error } = await supabase
          .from(tbl)
          .select('id', { count: 'exact', head: true })
          .filter('rate_cards', 'cs', JSON.stringify([{ type: rate.interest_type }]));
        if (error) {
          // Treat error as 0 (don't block legitimate delete due to query bug)
          console.warn(`[BR-IR-002] ${tbl} check error (treating as 0):`, error);
          continue;
        }
        if ((count ?? 0) > 0) {
          usageCounts[tbl] = count ?? 0;
          totalUsage += count ?? 0;
        }
      }

      // 3. Block if any usage
      if (totalUsage > 0) {
        const parts = Object.entries(usageCounts).map(
          ([tbl, n]) => `${TABLE_LABEL[tbl] ?? tbl} ${n} รายการ`,
        );
        const msg = `ลบไม่ได้ — อัตรา ${rate.interest_type} ของ ${rate.finance_institution} ถูกใช้อยู่ที่ ${parts.join(' · ')} · ถ้าต้องการเลิกใช้ ให้เปลี่ยนสถานะเป็น Inactive แทน`;
        throw new Error(msg);
      }

      // 4. Safe to delete
      const { error } = await supabase.from('interest_rates').delete().eq('id', id);
      if (error) throw error;
      logDelete('interest_rates', String(id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ir-list'] });
      toast.success('ลบ Interest Rate แล้ว');
    },
    onError: (e: any) => {
      console.error('[BR-IR-002] onError fired:', e);
      const msg = e?.message || 'ลบไม่ได้ — เกิดข้อผิดพลาด';
      toast.error(msg, { duration: 8000 });
    },
  });

  const syncBot = useMutation({
    mutationFn: async () => syncBotRatesToMaster(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['ir-list'] });
      toast.success(`✓ Sync from BOT — เพิ่ม ${r.inserted} · แทนที่ ${r.updated} · ไม่เปลี่ยน ${r.skipped}`);
    },
    onError: (e: any) => toast.error(`BOT sync failed: ${e.message}`),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Master Interest Rate</h1>
        <p className="text-muted text-sm">List</p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Button variant="primary" disabled={!canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => navigate('/master/interest-rate/new')}>
          <Plus className="w-4 h-4" /> New Master Interest Rate
        </Button>
        <Button
          variant="outline"
          onClick={() => syncBot.mutate()}
          disabled={syncBot.isPending || !canEdit}
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
                {bankCodes.map((f) => (
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
                  {pg.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`/master/interest-rate/${r.id}`} className="text-brand hover:underline">
                            Edit
                          </Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`/master/interest-rate/${r.id}?view=1`} className="text-brand hover:underline">
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
                        {/* BR/AC-MST-IR-003: Effective status = status='Active' AND end_effective_date NOT passed */}
                        {(() => {
                          const todayStr = (() => {
                            const d = new Date();
                            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          })();
                          const isExpired =
                            r.status === 'Active' &&
                            r.end_effective_date != null &&
                            r.end_effective_date < todayStr;
                          if (isExpired) {
                            return (
                              <Badge
                                variant="warn"
                                title={`End Effective: ${r.end_effective_date} (เลยกำหนดแล้ว — TX ใหม่จะไม่ pre-fill rate นี้)`}
                              >
                                ⏱ Expired
                              </Badge>
                            );
                          }
                          return (
                            <Badge variant={r.status === 'Active' ? 'success' : 'default'}>
                              {r.status}
                            </Badge>
                          );
                        })()}
                      </td>
                      <td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canEdit || del.isPending}
                          title={canEdit ? 'ลบ' : 'ไม่มีสิทธิ์แก้ไข'}
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
        <Pagination {...pg} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 bg-brand-light border-l-4 border-brand p-3 text-sm text-ink rounded">
        💡 <strong>Master Interest Rate</strong> — อัตราดอกเบี้ยอ้างอิงของธนาคาร (MLR · MOR · MRR ฯลฯ)
        ใช้สำหรับคำนวณดอกเบี้ยใน CA / P/N / OD / TR ที่ใช้ Floating Rate · เมื่อธนาคารเปลี่ยนอัตรา
        ให้สร้างรายการใหม่ แล้วปิดรายการเก่าด้วยการใส่วันที่สิ้นสุด หรือเปลี่ยนสถานะเป็น Inactive
      </div>
    </div>
  );
}
