import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, FileSpreadsheet, AlertCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, Input, Select, Badge, Button } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { exportAuditTrailToExcel } from '@/lib/excel-export';

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

const ACTION_OPTIONS = [
  'create', 'update', 'delete',
  'post_je', 'reverse_je', 'void_je',
  'sync_netsuite',
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
        .limit(1000);
      if (action) q = q.eq('action', action);
      if (tableFilter) q = q.eq('table_name', tableFilter);
      if (fromDate) q = q.gte('created_at', `${fromDate}T00:00:00`);
      if (toDate) q = q.lte('created_at', `${toDate}T23:59:59`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const tables = Array.from(new Set((data ?? []).map((r) => r.table_name))).sort();

  const filtered = (data ?? []).filter((r) =>
    !search ||
    (r.record_label ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.user_email ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.summary ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-[1500px] mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <ShieldCheck className="w-6 h-6 text-brand mt-1" />
          <div>
            <h1 className="text-2xl font-bold">Audit Trail</h1>
            <p className="text-muted text-sm">
              บันทึก action ทุกอย่างที่เกิดในระบบ (Create / Update / Delete / Post JE / Sync NetSuite) สำหรับ Auditor + Compliance
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!filtered.length) {
              toast.error('ไม่มีข้อมูลให้ export');
              return;
            }
            exportAuditTrailToExcel(filtered);
            toast.success(`✓ Exported ${filtered.length} records → Excel`);
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
                <div className="font-semibold">Migration ยังไม่ apply</div>
                <div className="text-xs mt-1">
                  ตาราง <code className="bg-white px-1.5 py-0.5 rounded border border-amber-300">audit_trail</code> ยังไม่มี — รัน migration 0042 ก่อน
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
                {tables.map((t) => <option key={t}>{t}</option>)}
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
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="text-xs whitespace-nowrap">{fmtTimestamp(r.created_at)}</td>
                      <td className="text-xs">{r.user_email ?? '—'}</td>
                      <td>
                        <Badge variant={actionVariant[r.action] ?? 'default'} className="text-[10px] uppercase">
                          {r.action}
                        </Badge>
                      </td>
                      <td className="text-xs">{r.table_name}</td>
                      <td className="text-xs font-medium">{r.record_label ?? r.record_id ?? '—'}</td>
                      <td className="text-xs max-w-md">{r.summary ?? '—'}</td>
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
