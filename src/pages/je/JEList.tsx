import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { reverseJE, voidJE } from '@/lib/je';
import { pushJournalEntryToNetSuite } from '@/lib/netsuite-stub';
import { Card, CardContent, Input, Select, Badge, Button } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { exportJEListToExcel } from '@/lib/excel-export';
import { type JournalEntry, JE_SOURCE_TYPES } from '@/types/database';

const STATUS_OPTIONS = ['Draft', 'Posted', 'Reversed', 'Voided'];

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  Posted: 'success',
  Reversed: 'default',
  Voided: 'danger',
};

export function JEList() {
  const [search, setSearch] = useState('');
  const [src, setSrc] = useState('');
  const [status, setStatus] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['je-list', search, src, status],
    queryFn: async () => {
      let q = supabase.from('journal_entries').select('*').order('je_date', { ascending: false }).order('je_number', { ascending: false });
      if (src) q = q.eq('source_type', src);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as JournalEntry[];
      if (search) rows = rows.filter((r) => r.je_number.toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
  });

  const reverse = useMutation({
    mutationFn: async (id: string) => reverseJE(id, 'user'),
    onSuccess: (newJE) => {
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Reversed → ${newJE.je_number}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const voidIt = useMutation({
    mutationFn: async (id: string) => voidJE(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('Voided');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const pushNs = useMutation({
    mutationFn: async (id: string) => pushJournalEntryToNetSuite(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Synced to NetSuite · ${res.netsuite_je_id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-[1500px] mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Journal Entries</h1>
          <p className="text-muted text-sm">
            คอนโซลรวม JE จากทุกธุรกรรม → ส่งเข้า GL / NetSuite · การปรับปรุงด้วยมือทำที่ NetSuite
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            if (!data || data.length === 0) {
              toast.error('ไม่มีข้อมูลให้ export');
              return;
            }
            // Pull JE lines for the filtered JEs — auditor uses these to trace VAT/WHT
            const ids = data.map((j) => j.id);
            const { data: lines, error: lineErr } = await supabase
              .from('je_lines')
              .select('je_id, line_no, account_code, account_name, description, dr, cr')
              .in('je_id', ids)
              .order('line_no');
            if (lineErr) {
              toast.error(`ไม่สามารถดึง JE Lines: ${lineErr.message}`);
              return;
            }
            exportJEListToExcel(data, undefined, lines ?? []);
            toast.success(`✓ Exported ${data.length} JE + ${lines?.length ?? 0} lines → Excel`);
          }}
          title="Export current filtered JE list + Lines to Excel (Sheet 2 มี Account Code + Memo สำหรับ Auditor ดูภาษี VAT/WHT)"
        >
          <FileSpreadsheet className="w-4 h-4" /> Export Excel
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="field-label">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
                <Input className="pl-8" placeholder="🔍 JE Number..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="field-label">SOURCE TYPE</label>
              <Select value={src} onChange={(e) => setSrc(e.target.value)}>
                <option value="">– All –</option>
                {JE_SOURCE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option>
                {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
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
              <div className="text-4xl mb-2">📒</div>
              <p>ไม่มี Journal Entry</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>JE Number</th>
                    <th>JE Date</th>
                    <th>Posting Period</th>
                    <th>Source</th>
                    <th>Description</th>
                    <th className="text-right">Dr</th>
                    <th className="text-right">Cr</th>
                    <th>Status</th>
                    <th>NetSuite</th>
                    <th>Posted</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((j) => (
                    <tr key={j.id} className="hover:bg-gray-50">
                      <td>
                        <Link to={`/je/${j.id}`} className="text-brand font-medium hover:underline">
                          {j.je_number}
                        </Link>
                        {j.is_reversal && <Badge variant="warn" className="ml-2 text-[10px]">REV</Badge>}
                      </td>
                      <td>{fmtDate(j.je_date)}</td>
                      <td>{j.posting_period}</td>
                      <td>
                        <Badge variant="brand">{j.source_type}</Badge>
                      </td>
                      <td className="text-xs">{j.description}</td>
                      <td className="text-right tabular-nums">{fmtMoney(j.total_dr)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(j.total_cr)}</td>
                      <td><Badge variant={statusVariant[j.status] ?? 'default'}>{j.status}</Badge></td>
                      <td className="text-xs">
                        {j.sync_status === 'synced' ? (
                          <Badge variant="brand" title={`NetSuite ID: ${j.netsuite_je_id}`}>✓ Synced</Badge>
                        ) : j.sync_status === 'failed' ? (
                          <Link to="/je/sync-log" className="inline-block" title="ดูสาเหตุใน Sync Log">
                            <Badge variant="danger">❌ Sync Failed</Badge>
                          </Link>
                        ) : j.status === 'Posted' ? (
                          <Badge variant="warn">⏳ Not Synced</Badge>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-xs">
                        {j.posted_at ? (
                          <>
                            <div>{fmtDate(j.posted_at)}</div>
                            <div className="text-muted">{j.posted_by}</div>
                          </>
                        ) : '—'}
                      </td>
                      <td className="text-right">
                        <div className="flex gap-2 justify-end text-xs">
                          {j.status === 'Posted' && j.sync_status !== 'synced' && (
                            <button
                              onClick={() => pushNs.mutate(j.id)}
                              disabled={pushNs.isPending}
                              className="text-brand hover:underline disabled:opacity-40"
                            >
                              Push to NetSuite
                            </button>
                          )}
                          {j.status === 'Posted' && !j.is_reversal && (
                            <button
                              onClick={() => { if (confirm(`Reverse ${j.je_number}?`)) reverse.mutate(j.id); }}
                              className="text-amber-700 hover:underline"
                            >
                              Reverse
                            </button>
                          )}
                          {j.status === 'Draft' && (
                            <button
                              onClick={() => { if (confirm(`Void ${j.je_number}?`)) voidIt.mutate(j.id); }}
                              className="text-danger hover:underline"
                            >
                              Void
                            </button>
                          )}
                        </div>
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
