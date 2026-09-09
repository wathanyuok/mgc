// Financial Segment Master (BRD §2.13.5)
// Master Data มิติบัญชี 4 ตาราง (subsidiaries / departments / locations / classes)
// ใช้เป็น source ของการ์ด Classification ในทุก Transaction + สะพานไป NetSuite Segment
//
// NetSuite เป็นเจ้าของข้อมูล — ระบบ sync ลงมา · หน้านี้ view-only + ปุ่ม Sync (Admin)
// ห้ามแก้ Code / NetSuite ID (BR-SEG-01/05) จึงไม่มีปุ่ม New / Edit / Delete
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Badge, usePaged, Pagination } from '@/components/ui';
import { Tabs, type TabDef } from '@/components/tx/Tabs';
import { fmtDate } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { syncSegmentsFromNetSuite } from '@/lib/segment-sync';

interface Col {
  header: string;
  render: (r: any) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

function SegmentTable({ table, select, columns }: { table: string; select: string; columns: Col[] }) {
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery({
    queryKey: ['seg-master', table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select(select).order('code');
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const kw = q.trim().toLowerCase();
  const shown = data.filter(
    (r) => !kw || [r.code, r.name].some((v) => String(v ?? '').toLowerCase().includes(kw)),
  );
  const pg = usePaged(shown);

  return (
    <div>
      <div className="mb-3 max-w-xs">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted" />
          <Input className="pl-8" placeholder="ค้นหา รหัส / ชื่อ…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.header} className={c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={columns.length} className="text-center text-muted py-6">กำลังโหลด...</td></tr>
            )}
            {!isLoading && pg.rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                {columns.map((c) => (
                  <td key={c.header} className={c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!isLoading && shown.length === 0 && (
              <tr><td colSpan={columns.length} className="text-center text-muted py-6">ไม่มีข้อมูล</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination {...pg} unit="รายการ" />
    </div>
  );
}

const activeBadge = (r: any) =>
  r.active ? <Badge variant="success">เปิดใช้งาน</Badge> : <Badge variant="default">ปิดใช้งาน</Badge>;
const nsId = (v: any) => v ?? <span className="text-muted">—</span>;

export function FinancialSegmentList() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const viewOnly = useReadOnly();
  const canSync = isAdmin && !viewOnly;

  const sync = useMutation({
    mutationFn: async () => syncSegmentsFromNetSuite(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['seg-master'] });
      toast.success(`Sync จาก NetSuite — เพิ่ม ${r.inserted} · อัปเดต ${r.updated} · ไม่เปลี่ยน ${r.skipped}`);
    },
    onError: (e: any) => toast.error(`Sync ล้มเหลว: ${e.message}`),
  });

  const tabs: TabDef[] = [
    {
      key: 'subsidiaries', label: 'Subsidiary (บริษัท)',
      render: () => (
        <SegmentTable
          table="subsidiaries"
          select="id, code, name, tax_id, netsuite_subsidiary_id, active, updated_at"
          columns={[
            { header: 'รหัส', render: (r) => <span className="font-medium">{r.code}</span> },
            { header: 'ชื่อเต็ม', render: (r) => r.name },
            { header: 'เลขผู้เสียภาษี', render: (r) => nsId(r.tax_id) },
            { header: 'NetSuite ID', render: (r) => nsId(r.netsuite_subsidiary_id) },
            { header: 'สถานะ', render: activeBadge, align: 'center' },
            { header: 'แก้ล่าสุด', render: (r) => fmtDate(r.updated_at), align: 'right' },
          ]}
        />
      ),
    },
    {
      key: 'departments', label: 'Department (หน่วยงาน)',
      render: () => (
        <SegmentTable
          table="departments"
          select="id, code, name, netsuite_department_id, active, updated_at"
          columns={[
            { header: 'รหัส', render: (r) => <span className="font-medium">{r.code}</span> },
            { header: 'ชื่อเต็ม', render: (r) => r.name },
            { header: 'NetSuite ID', render: (r) => nsId(r.netsuite_department_id) },
            { header: 'สถานะ', render: activeBadge, align: 'center' },
            { header: 'แก้ล่าสุด', render: (r) => fmtDate(r.updated_at), align: 'right' },
          ]}
        />
      ),
    },
    {
      key: 'locations', label: 'Location (สถานที่)',
      render: () => (
        <SegmentTable
          table="locations"
          select="id, code, name, netsuite_location_id, active, updated_at, subsidiaries(code)"
          columns={[
            { header: 'รหัส', render: (r) => <span className="font-medium">{r.code}</span> },
            { header: 'ชื่อเต็ม', render: (r) => r.name },
            { header: 'บริษัท', render: (r) => nsId(r.subsidiaries?.code) },
            { header: 'NetSuite ID', render: (r) => nsId(r.netsuite_location_id) },
            { header: 'สถานะ', render: activeBadge, align: 'center' },
            { header: 'แก้ล่าสุด', render: (r) => fmtDate(r.updated_at), align: 'right' },
          ]}
        />
      ),
    },
    {
      key: 'classes', label: 'Class (ประเภทธุรกิจ)',
      render: () => (
        <SegmentTable
          table="classes"
          select="id, code, name, netsuite_class_id, active, updated_at"
          columns={[
            { header: 'รหัส', render: (r) => <span className="font-medium">{r.code}</span> },
            { header: 'ชื่อเต็ม', render: (r) => r.name },
            { header: 'NetSuite ID', render: (r) => nsId(r.netsuite_class_id) },
            { header: 'สถานะ', render: activeBadge, align: 'center' },
            { header: 'แก้ล่าสุด', render: (r) => fmtDate(r.updated_at), align: 'right' },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-2 flex items-center gap-2">
        <Layers className="w-6 h-6 text-brand" />
        <div>
          <h1 className="text-2xl font-bold">Financial Segment</h1>
          <p className="text-muted text-sm">มิติบัญชีสำหรับลงบัญชี GL — บริษัท · หน่วยงาน · สถานที่ · ประเภทธุรกิจ</p>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => sync.mutate()}
          disabled={sync.isPending || !canSync}
          title={canSync ? 'ดึง Master Data มิติบัญชีจาก NetSuite (Admin) · ปัจจุบันเป็น stub รอ credential' : 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น'}
        >
          <RefreshCw className={`w-4 h-4 ${sync.isPending ? 'animate-spin' : ''}`} /> {sync.isPending ? 'Syncing...' : 'Sync จาก NetSuite'}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabs tabs={tabs} />
        </CardContent>
      </Card>

      <div className="mt-4 bg-brand-light border-l-4 border-brand p-3 text-sm text-ink rounded">
        NetSuite เป็นเจ้าของข้อมูลหลัก — ระบบ sync ลงมาแล้วเก็บ copy ในเครื่อง · หน้านี้ดูอย่างเดียว แก้ไม่ได้
        (ห้ามแก้ Code / NetSuite ID) · การเพิ่ม/ปิดใช้งานทำผ่านการ Sync จาก NetSuite เท่านั้น
      </div>
    </div>
  );
}
