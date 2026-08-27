import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, FileSpreadsheet, AlertCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, Input, Select, Badge, Button, usePaged, Pagination } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { exportAuditTrailToExcel } from '@/lib/excel-export';
import { moduleLabel } from '@/lib/audit-trail';

interface AuditRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  record_label: string | null;
  summary: string | null;
  created_at: string;
}

/** จำนวนรายการสูงสุดที่ดึงมาแสดงต่อครั้ง — เกินกว่านี้ต้องแคบช่วงเวลาลง */
const MAX_ROWS = 1000;

const ACTION_OPTIONS = [
  'create', 'update', 'delete',
  'post_je', 'reverse_je', 'void_je',
  'sync_netsuite', 'eod_sync_run',
  'approve', 'reject',
  'login', 'logout',
];

const actionVariant: Record<string, any> = {
  create: 'success',
  update: 'brand',
  delete: 'danger',
  post_je: 'success',
  reverse_je: 'warn',
  void_je: 'danger',
  sync_netsuite: 'brand',
  approve: 'success',
  reject: 'danger',
  login: 'default',
  logout: 'default',
};

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${fmtDate(iso)} ${d.toTimeString().slice(0, 8)}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AuditTrail() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [tableFilter, setTableFilter] = useState('');
  const [fromDate, setFromDate] = useState(daysAgo(90));
  const [toDate, setToDate] = useState(todayISO());

  const { data, isLoading, error } = useQuery<AuditRow[]>({
    queryKey: ['audit-trail', action, tableFilter, fromDate, toDate],
    queryFn: async () => {
      let q = supabase
        .from('audit_trail')
        .select('id,user_id,user_email,action,table_name,record_id,record_label,summary,created_at')
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS);
      if (action) q = q.eq('action', action);
      if (tableFilter) q = q.eq('table_name', tableFilter);
      if (fromDate) q = q.gte('created_at', `${fromDate}T00:00:00`);
      if (toDate) q = q.lte('created_at', `${toDate}T23:59:59`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  // รายชื่อเมนูสำหรับตัวกรอง — ต้องดึงแยกจากช่วงเวลาที่เลือก ไม่ใช่จากผลที่กรองแล้ว
  // เดิมสร้างจากผลลัพธ์ พอเลือกเมนูหนึ่งรายการจะเหลือแค่เมนูนั้น สลับไปเมนูอื่นตรงๆ ไม่ได้
  const { data: tables = [] } = useQuery({
    queryKey: ['audit-modules', fromDate, toDate],
    queryFn: async () => {
      let q = supabase.from('audit_trail').select('table_name').limit(5000);
      if (fromDate) q = q.gte('created_at', `${fromDate}T00:00:00`);
      if (toDate) q = q.lte('created_at', `${toDate}T23:59:59`);
      const { data, error } = await q;
      if (error) return [] as string[];
      return Array.from(new Set((data ?? []).map((r: any) => r.table_name))).sort() as string[];
    },
    staleTime: 60_000,
  });

  const badRange = !!fromDate && !!toDate && fromDate > toDate;
  const truncated = (data?.length ?? 0) >= MAX_ROWS;

  const filtered = (data ?? []).filter((r) =>
    !search ||
    (r.record_label ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.user_email ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.summary ?? '').toLowerCase().includes(search.toLowerCase()),
  );


  const pg = usePaged(filtered);   // แบ่งหน้ารายการ

  return (
    <div className="max-w-[1500px] mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <ShieldCheck className="w-6 h-6 text-brand mt-1" />
          <div>
            <h1 className="text-2xl font-bold">Audit Trail</h1>
            <p className="text-muted text-sm">
              บันทึกทุกการกระทำในระบบ — สร้าง · แก้ไข · ลบ · ส่งขออนุมัติ · อนุมัติ · ปฏิเสธ · ลงบัญชี · ส่งข้อมูลไป NetSuite · เข้า/ออกระบบ
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!filtered.length) {
              toast.error('ไม่มีข้อมูลให้ส่งออก');
              return;
            }
            if (truncated && !window.confirm(
              `ช่วงเวลานี้มีเหตุการณ์มากกว่า ${MAX_ROWS.toLocaleString()} รายการ\n\n` +
              `ไฟล์ที่ได้จะมีเฉพาะ ${MAX_ROWS.toLocaleString()} รายการล่าสุดเท่านั้น ไม่ครบทั้งช่วง\n` +
              `ต้องการส่งออกต่อหรือไม่?`)) return;
            exportAuditTrailToExcel(filtered);
            toast.success(`ส่งออกแล้ว ${filtered.length.toLocaleString()} รายการ`);
          }}
        >
          <FileSpreadsheet className="w-4 h-4" /> Export to Excel
        </Button>
      </div>

      {error && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardContent className="!py-3">
            <div className="flex items-start gap-2 text-sm text-amber-800">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">ยังใช้หน้านี้ไม่ได้ — ยังไม่ได้เตรียมที่เก็บประวัติในฐานข้อมูล</div>
                <div className="text-xs mt-1">
                  แจ้งผู้ดูแลระบบให้ติดตั้งส่วนเก็บประวัติการใช้งานก่อน · ระหว่างนี้การทำงานอื่นใช้ได้ตามปกติ
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {badRange && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <CardContent className="!py-3">
            <div className="flex items-start gap-2 text-sm text-red-800">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">ช่วงวันที่ไม่ถูกต้อง</div>
                <div className="text-xs mt-1">วันที่เริ่มอยู่หลังวันที่สิ้นสุด — ตารางจึงว่างเปล่า · สลับวันที่ให้ถูกก่อน</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {truncated && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardContent className="!py-3">
            <div className="flex items-start gap-2 text-sm text-amber-800">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">แสดงได้ไม่ครบ</div>
                <div className="text-xs mt-1">
                  ช่วงเวลานี้มีเหตุการณ์มากกว่า {MAX_ROWS.toLocaleString()} รายการ — แสดงเฉพาะ {MAX_ROWS.toLocaleString()} รายการล่าสุด ·
                  รายการที่เก่ากว่านั้นจะไม่ถูกค้นหาและไม่ถูกส่งออกด้วย · ให้แคบช่วงวันที่ลง หรือกรองตามเมนู
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input
                  className="pl-8"
                  placeholder="🔍 Record / User..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field-label">ACTION</label>
              <Select value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">– All –</option>
                {ACTION_OPTIONS.map((a) => <option key={a}>{a}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">MODULE</label>
              <Select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)}>
                <option value="">– All –</option>
                {tables.map((t) => <option key={t} value={t}>{moduleLabel(t)}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">FROM</label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="field-label">TO</label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
          <div className="mt-2 flex gap-2 text-xs">
            <span className="text-muted">Quick:</span>
            <button type="button" className="text-brand hover:underline"
              onClick={() => { setFromDate(daysAgo(7)); setToDate(todayISO()); }}>7 วัน</button>
            <span className="text-muted">·</span>
            <button type="button" className="text-brand hover:underline"
              onClick={() => { setFromDate(daysAgo(30)); setToDate(todayISO()); }}>30 วัน</button>
            <span className="text-muted">·</span>
            <button type="button" className="text-brand hover:underline"
              onClick={() => { setFromDate(daysAgo(90)); setToDate(todayISO()); }}>90 วัน</button>
            <span className="text-muted">·</span>
            <button type="button" className="text-brand hover:underline"
              onClick={() => { setFromDate(daysAgo(365)); setToDate(todayISO()); }}>1 ปี</button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted">
              <div className="text-4xl mb-2">📋</div>
              <p>ยังไม่มีรายการ Audit</p>
              <p className="text-xs mt-1">การ Action จะถูกบันทึกอัตโนมัติ</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Module</th>
                    <th>Record</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="text-xs whitespace-nowrap">{fmtTimestamp(r.created_at)}</td>
                      <td className="text-xs">{r.user_email ?? '—'}</td>
                      <td>
                        <Badge variant={actionVariant[r.action] ?? 'default'} className="text-[10px] uppercase">
                          {r.action}
                        </Badge>
                      </td>
                      <td className="text-xs">{moduleLabel(r.table_name)}</td>
                      <td className="text-xs font-medium">{r.record_label ?? r.record_id ?? '—'}</td>
                      <td className="text-xs max-w-md">{r.summary ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination {...pg} unit="เหตุการณ์" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
