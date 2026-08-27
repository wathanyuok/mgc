import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, Badge, usePaged, Pagination } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { type Curtailment, VENDORS, VEHICLE_TYPES } from '@/types/database';
import { useDealerVendorNames } from '@/lib/vendors';

// ป้ายชื่อขั้นทยอยลดต้น — ต้องครบ 6 ขั้นเท่ากับหน้ารายละเอียด
const TIER_LABELS = ['1st', '2nd', '3rd', '4th', '5th', '6th'] as const;

import { logDelete } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';

export function CurtailmentList() {
  const { names: vendorNames } = useDealerVendorNames(); // Vendor Master — ชุดเดียวกับ FP
  const [search, setSearch] = useState('');
  const [vendor, setVendor] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('master_curtailment', 'edit');

  const { data, isLoading } = useQuery({
    queryKey: ['curt-list', search, vendor, type, status],
    queryFn: async () => {
      let q = supabase.from('curtailments').select('*').order('vendor').order('vehicle_type');
      if (vendor) q = q.eq('vendor', vendor);
      if (type) q = q.eq('vehicle_type', type);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as Curtailment[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.vendor.toLowerCase().includes(s) || r.vehicle_type.toLowerCase().includes(s),
        );
      }
      return rows;
    },
  });

  // BR-MST-CT-003 — Block delete if any Floor Plan matches this Curtailment Set
  // FP doesn't have FK to curtailments; it matches at runtime by (vendor, transaction_date in effective range)
  // So "in use" = there's at least one FP with same vendor AND transaction_date within this curtailment's effective range
  const del = useMutation({
    mutationFn: async (id: string) => {
      // 1. Load the curtailment to get vendor + effective dates
      const { data: curt, error: curtErr } = await supabase
        .from('curtailments')
        .select('vendor, vehicle_type, effective_start_date, effective_end_date')
        .eq('id', id)
        .single();
      if (curtErr) throw curtErr;

      // 2. Check floor_plans matching (same vendor AND transaction_date within effective range)
      // ตรงกับวิธีจับคู่ของหน้าสินเชื่อสต๊อกรถ — ดูผู้จำหน่าย + ช่วงวันที่ เท่านั้น
      // หมายเหตุ: ตารางสินเชื่อสต๊อกรถไม่มีช่องประเภทรถ การจับคู่จึงข้ามประเภทรถไปด้วย
      // ถ้าวันหนึ่งเพิ่มช่องประเภทรถที่สัญญา ต้องเพิ่มเงื่อนไขทั้งที่นี่และที่หน้าสัญญาพร้อมกัน
      let q = supabase
        .from('floor_plans')
        .select('id', { count: 'exact', head: true })
        .ilike('vendor', curt.vendor.trim()) // match แบบไม่สนตัวพิมพ์ — ให้ตรงกับ logic หน้า FP
        .gte('transaction_date', curt.effective_start_date);
      if (curt.effective_end_date) {
        q = q.lte('transaction_date', curt.effective_end_date);
      }
      const { count: fpRefs, error: fpErr } = await q;
      if (fpErr) {
        console.warn('[BR-CT-003] floor_plans check error (treating as 0):', fpErr);
      }

      // 3. Block if any FP matches
      if ((fpRefs ?? 0) > 0) {
        const msg =
          `ลบไม่ได้ — เงื่อนไขของ ${curt.vendor} (${curt.vehicle_type}) ถูกใช้อยู่ที่สินเชื่อสต๊อกรถ ${fpRefs} รายการ ` +
          `ที่วันทำรายการอยู่ในช่วงของเงื่อนไขนี้ · ถ้าต้องการเลิกใช้ ให้เปลี่ยนสถานะเป็น Inactive แทน`;
        throw new Error(msg);
      }

      // 4. Safe to delete
      const { error } = await supabase.from('curtailments').delete().eq('id', id);
      if (error) throw error;
      logDelete('curtailments', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['curt-list'] });
      toast.success('ลบ Curtailment แล้ว');
    },
    onError: (e: any) => {
      console.error('[BR-CT-003] onError fired:', e);
      const msg = e?.message || 'ลบไม่ได้ — เกิดข้อผิดพลาด';
      toast.error(msg, { duration: 8000 });
    },
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Curtailment</h1>
        <p className="text-muted text-sm">Setup Curtailment</p>
      </div>

      <div className="mb-4">
        <Button variant="primary" disabled={!canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => navigate('/master/curtailment/new')}>
          <Plus className="w-4 h-4" /> New Curtailment
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
              <label className="field-label">VENDOR</label>
              <Select value={vendor} onChange={(e) => setVendor(e.target.value)}>
                <option value="">– All –</option>
                {vendorNames.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="field-label">TYPE</label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">– All –</option>
                {VEHICLE_TYPES.map((t) => (
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
              <div className="text-4xl mb-2">🚗</div>
              <p>ไม่พบ Curtailment</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th rowSpan={2} className="w-24 align-middle">
                      Edit | View
                    </th>
                    <th rowSpan={2} className="align-middle">
                      Vendor
                    </th>
                    <th rowSpan={2} className="align-middle">
                      Type
                    </th>
                    <th rowSpan={2} className="align-middle">
                      Effective Start Date
                    </th>
                    <th rowSpan={2} className="align-middle">
                      Effective End Date
                    </th>
                    {TIER_LABELS.map((lbl) => (
                      <th key={lbl} colSpan={2} className="text-center">
                        {lbl} Curtailment
                      </th>
                    ))}
                    <th rowSpan={2} className="align-middle">
                      Status
                    </th>
                    <th rowSpan={2} className="align-middle"></th>
                  </tr>
                  <tr>
                    {TIER_LABELS.map((lbl) => (
                      <Fragment key={lbl}>
                        <th className="text-right">Days</th>
                        <th className="text-right">%</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td>
                        <div className="flex gap-2 text-xs">
                          <Link to={`/master/curtailment/${c.id}`} className="text-brand hover:underline">
                            Edit
                          </Link>
                          <span className="text-gray-300">|</span>
                          <Link to={`/master/curtailment/${c.id}?view=1`} className="text-brand hover:underline">
                            View
                          </Link>
                        </div>
                      </td>
                      <td>{c.vendor}</td>
                      <td className="font-medium">{c.vehicle_type}</td>
                      <td>{fmtDate(c.effective_start_date)}</td>
                      <td>{c.effective_end_date ? fmtDate(c.effective_end_date) : '—'}</td>
                      {([1, 2, 3, 4, 5, 6] as const).map((t) => (
                        <Fragment key={t}>
                          <td className="text-right tabular-nums">{(c as any)[`tier${t}_days`] ?? '—'}</td>
                          <td className="text-right tabular-nums">{(c as any)[`tier${t}_pct`] ?? '—'}</td>
                        </Fragment>
                      ))}
                      <td>
                        <Badge variant={c.status === 'Active' ? 'success' : 'default'}>
                          {c.status}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canEdit || del.isPending}
                          title={canEdit ? 'ลบ' : 'ไม่มีสิทธิ์แก้ไข'}
                          onClick={() => {
                            if (confirm(`ลบ Curtailment ของ ${c.vendor} (${c.vehicle_type}) ?`)) del.mutate(c.id);
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
    </div>
  );
}
