import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, Input, Select, Badge, Button } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { exportSyncLogToExcel } from '@/lib/excel-export';

interface SyncLogRow {
  id: string;
  je_id: string | null;
  je_number: string;
  sync_method: string;
  triggered_by: string | null;
  response_status: number | null;
  sync_status: string;
  netsuite_je_id: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

const STATUS_OPTIONS = ['success', 'failed', 'pending'];

const statusVariant: Record<string, any> = {
  success: 'success',
  failed: 'danger',
  pending: 'warn',
};

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${fmtDate(iso)} ${d.toTimeString().slice(0, 8)}`;
}

// Default: last 90 days. User can adjust.
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function SyncLog() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState(daysAgo(90));
  const [toDate, setToDate] = useState(todayISO());

  const { data, isLoading, error } = useQuery<SyncLogRow[]>({
    queryKey: ['netsuite-sync-log', status, fromDate, toDate],
    queryFn: async () => {
      let q = supabase
        .from('netsuite_sync_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (status) q = q.eq('sync_status', status);
      if (fromDate) q = q.gte('created_at', `${fromDate}T00:00:00`);
      if (toDate) q = q.lte('created_at', `${toDate}T23:59:59`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SyncLogRow[];
    },
  });

  const filtered = (data ?? []).filter((r) =>
    !search ||
    r.je_number.toLowerCase().includes(search.toLowerCase()) ||
    (r.netsuite_je_id ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-[1500px] mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">NetSuite Sync Audit Log</h1>
          <p className="text-muted text-sm">
            บันทึกการ Sync JE → NetSuite GL ทุก call (สำเร็จ + ล้มเหลว) สำหรับ Auditor + Reconciliation
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!filtered.length) {
              toast.error('ไม่มีข้อมูลให้ export');
              return;
            }
            exportSyncLogToExcel(filtered);
            toast.success(`✓ Exported ${filtered.length} log entries → Excel`);
          }}
        >
          <FileSpreadsheet className="w-4 h-4" /> Export Audit Log
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
                  ตาราง <code className="bg-white px-1.5 py-0.5 rounded border border-amber-300">netsuite_sync_log</code> ยังไม่มี — รัน migration 0041 ก่อน
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input
                  className="pl-8"
                  placeholder="🔍 JE Number / NetSuite ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field-label">SYNC STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option>
                {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">FROM</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">TO</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2 flex gap-2 text-xs">
            <span className="text-muted">Quick:</span>
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() => { setFromDate(daysAgo(7)); setToDate(todayISO()); }}
            >7 วัน</button>
            <span className="text-muted">·</span>
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() => { setFromDate(daysAgo(30)); setToDate(todayISO()); }}
            >30 วัน</button>
            <span className="text-muted">·</span>
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() => { setFromDate(daysAgo(90)); setToDate(todayISO()); }}
            >90 วัน</button>
            <span className="text-muted">·</span>
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() => { setFromDate(daysAgo(365)); setToDate(todayISO()); }}
            >1 ปี</button>
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
              <p>ยังไม่มีรายการ Sync</p>
              <p className="text-xs mt-1">กด "Send to NetSuite" บนหน้า JE List เพื่อสร้างรายการ</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>JE Number</th>
                    <th>Method</th>
                    <th>Triggered By</th>
                    <th>HTTP</th>
                    <th>Status</th>
                    <th>NetSuite ID</th>
                    <th className="text-right">Duration</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="text-xs whitespace-nowrap">{fmtTimestamp(r.created_at)}</td>
                      <td>
                        {r.je_id ? (
                          <Link to={`/je/${r.je_id}`} className="text-brand font-medium hover:underline">
                            {r.je_number}
                          </Link>
                        ) : (
                          <span>{r.je_number}</span>
                        )}
                      </td>
                      <td>
                        <Badge variant="default" className="text-[10px] uppercase">{r.sync_method}</Badge>
                      </td>
                      <td className="text-xs">{r.triggered_by ?? '—'}</td>
                      <td className="text-xs tabular-nums">{r.response_status ?? '—'}</td>
                      <td>
                        <Badge variant={statusVariant[r.sync_status] ?? 'default'}>
                          {r.sync_status}
                        </Badge>
                      </td>
                      <td className="text-xs font-mono">{r.netsuite_je_id ?? '—'}</td>
                      <td className="text-right tabular-nums text-xs">
                        {r.duration_ms != null ? `${r.duration_ms}ms` : '—'}
                      </td>
                      <td className="text-xs text-danger max-w-xs truncate" title={r.error_message ?? ''}>
                        {r.error_message ?? ''}
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
