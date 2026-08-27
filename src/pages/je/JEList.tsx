import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Download } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { reverseJE, jeSourceLabel, jeSourceCodes, JE_SOURCE_MENUS } from '@/lib/je';
import { pushJournalEntryToNetSuite } from '@/lib/netsuite-stub';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { exportJEListToExcel } from '@/lib/excel-export';
import { Card, CardContent, Input, Select, Badge, Button, usePaged, Pagination } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { type JournalEntry } from '@/types/database';

// สถานะ Voided มีในเงื่อนไขของฐานข้อมูล แต่ไม่มีโค้ดไหนตั้งค่านี้เลย
// จึงไม่ใส่เป็นตัวเลือก เพราะเลือกแล้วจะได้ผลว่างเสมอ
// ไม่มี Draft ในตัวกรอง — ทุกเส้นทางในระบบสร้างใบแล้วลงบัญชีทันทีในคำสั่งถัดไป
// ใบจึงเป็นฉบับร่างอยู่แค่เสี้ยววินาที เลือกแล้วได้ผลว่างเปล่าเกือบตลอด
// (ถ้าลงบัญชีไม่สำเร็จจนมีใบค้าง ยังกดลงบัญชีได้จากหน้ารายละเอียดใบสำคัญ)
const STATUS_OPTIONS = ['Posted', 'Reversed'];

// เพดานจำนวนแถวที่ดึงได้ต่อครั้ง — ฐานข้อมูลตัดที่ 1,000 แถวอยู่แล้ว
// ประกาศไว้ตรงนี้เพื่อให้รู้ตัวว่าถึงเพดานแล้ว และเตือนผู้ใช้ให้แคบช่วงวันที่ลง
const ROW_LIMIT = 1000;

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  Posted: 'success',
  Reversed: 'default',
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/**
 * ขอบบนของช่วงวันที่ — ต้องเลยวันนี้ไปข้างหน้าด้วย
 *
 * ใบกลับรายการของการตีราคาเงินตราลงวันที่ 1 ของเดือนถัดไป ซึ่งเป็นวันในอนาคต
 * ถ้าขอบบนเป็นวันนี้ ผู้ใช้จะเห็นใบตีราคาใบเดียว แล้วเข้าใจว่าระบบไม่ได้กลับรายการให้
 */
function defaultToISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 45);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ตัวเลือกสถานะการส่งข้อมูล — ในฐานข้อมูลมีแค่ส่งแล้วกับส่งไม่สำเร็จ
// ใบที่ยังไม่เคยส่งจะไม่มีค่าในคอลัมน์นี้ (ไม่ใช่คำว่ารอส่ง) ตัวกรองจึงต้องจับค่าว่าง
const SYNC_NOT_SENT = 'not_sent';
const SYNC_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'synced', label: 'ส่งแล้ว' },
  { value: 'failed', label: 'ส่งไม่สำเร็จ' },
  { value: SYNC_NOT_SENT, label: 'รอส่ง' },
];

export function JEList() {
  const [search, setSearch] = useState('');
  // หน่วงคำค้นไว้ก่อนยิงคำสั่ง ไม่งั้นพิมพ์ 1 ตัวอักษรจะยิงคำสั่งค้นสัญญาทีละ 10 คำสั่ง
  const [searchTerm, setSearchTerm] = useState('');
  const [src, setSrc] = useState('');
  const [status, setStatus] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [fromDate, setFromDate] = useState(daysAgo(90));
  const [toDate, setToDate] = useState(defaultToISO());
  const qc = useQueryClient();
  const { can } = useAuth();
  const readOnly = useReadOnly();
  const userLabel = useCurrentUserLabel();
  const canSync = can('je', 'edit') && !readOnly;      // ส่งข้อมูลเข้าระบบบัญชี
  const canApprove = can('je', 'approve') && !readOnly; // ลงบัญชี / กลับรายการ

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['je-list', searchTerm, src, status, syncStatus, fromDate, toDate],
    queryFn: async () => {
      let q = supabase.from('journal_entries').select('*').order('je_date', { ascending: false }).order('je_number', { ascending: false }).limit(ROW_LIMIT);
      // ตัวกรองเก็บ "ชื่อเมนู" จึงต้องกรองด้วยรหัสทุกตัวที่อยู่ใต้เมนูนั้น
      if (src) q = q.in('source_type', jeSourceCodes(src));
      if (status) q = q.eq('status', status);
      if (syncStatus === SYNC_NOT_SENT) q = q.is('sync_status', null);
      else if (syncStatus) q = q.eq('sync_status', syncStatus);
      if (fromDate) q = q.gte('je_date', fromDate);
      if (toDate) q = q.lte('je_date', toDate);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as JournalEntry[];
      const truncated = rows.length >= ROW_LIMIT;
      // Search across je_number + description + remark + facility natural keys
      // (loan_no, lease_no, pn_number, etc.) — JE descriptions often use form.name
      // which doesn't always contain the contract number, so we look up the
      // source_id directly from facility tables.
      if (searchTerm) {
        const qs = searchTerm.toLowerCase();
        const matchedSourceIds = new Set<string>();
        const like = `%${searchTerm}%`;
        const lookups = await Promise.all([
          supabase.from('loans').select('id').ilike('loan_no', like),
          supabase.from('leases').select('id').ilike('lease_no', like),
          supabase.from('promissory_notes').select('id').ilike('pn_number', like),
          supabase.from('floor_plans').select('id').ilike('fp_no', like),
          supabase.from('overdrafts').select('id').ilike('od_no', like),
          supabase.from('trust_receipts').select('id').ilike('tr_no', like),
          supabase.from('fx_forwards').select('id').ilike('fxf_no', like),
          supabase.from('letter_guarantees').select('id').ilike('lg_no', like),
          supabase.from('letters_of_credit').select('id').ilike('lc_no', like),
        ]);
        // เดิมกลืนข้อผิดพลาดไว้เงียบๆ ค้นไม่เจอแล้วผู้ใช้ไม่รู้ว่าเพราะอะไร
        const failed = lookups.find((res) => res.error);
        if (failed?.error) throw failed.error;
        lookups.forEach((res) => {
          (res.data ?? []).forEach((row: any) => matchedSourceIds.add(row.id));
        });
        rows = rows.filter((r) =>
          r.je_number.toLowerCase().includes(qs) ||
          (r.description ?? '').toLowerCase().includes(qs) ||
          (r.remark ?? '').toLowerCase().includes(qs) ||
          (r.source_id && matchedSourceIds.has(r.source_id)),
        );
      }
      return { rows, truncated };
    },
  });

  const rows = data?.rows;

  const reverse = useMutation({
    mutationFn: async (id: string) => reverseJE(id, userLabel),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['je-list'] });
      // สองเส้นทางให้ผลต่างกัน — ยกเลิกไม่มีใบใหม่เกิดขึ้น
      toast.success(
        res.mode === 'cancel'
          ? `ยกเลิกใบสำคัญ ${res.je.je_number} แล้ว — ยังไม่ได้ส่งเข้า NetSuite จึงไม่ต้องออกใบกลับรายการ`
          : `กลับรายการแล้ว — ใบกลับรายการเลขที่ ${res.je.je_number}`,
      );
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


  const pg = usePaged(rows);   // แบ่งหน้ารายการ
  return (
    <div className="max-w-[1500px] mx-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Journal Entries</h1>
          <p className="text-muted text-sm">
            คอนโซลรวม JE จากทุกธุรกรรม → ส่งเข้า GL / NetSuite · การปรับปรุงด้วยมือทำที่ NetSuite
          </p>
        </div>
        {/* ส่งออกรายการตามตัวกรองที่เลือกอยู่ — ได้ทั้งหัวใบและบรรทัดบัญชี */}
        <Button
          variant="ghost"
          onClick={() => exportJEListToExcel(rows ?? [])}
          disabled={!rows || rows.length === 0}
        >
          <Download className="w-4 h-4" /> ส่งออก Excel
        </Button>
      </div>

      <Card className="mb-4">
        <CardContent className="!py-3">
          {/* ช่องค้นหากว้าง 2 เท่า เพราะใช้บ่อยสุดและข้อความยาว · วันที่แคบได้เพราะความกว้างคงที่
              จัดเป็นแถวเดียวบนจอกว้าง พับเป็น 2 คอลัมน์บนจอแคบ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1.3fr_1fr_1.3fr_1fr_1fr] gap-x-4 gap-y-3">
            <div>
              <label className="field-label">SEARCH</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted pointer-events-none" />
                <Input
                  className="pl-8"
                  placeholder="เลขที่ใบสำคัญ · เลขที่สัญญา · คำอธิบาย"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="field-label">SOURCE</label>
              <Select value={src} onChange={(e) => setSrc(e.target.value)}>
                <option value="">– All –</option>
                {JE_SOURCE_MENUS.map((g) => <option key={g.menu} value={g.menu}>{g.menu}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">STATUS</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">– All –</option>
                {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <label className="field-label">NETSUITE SYNC</label>
              <Select value={syncStatus} onChange={(e) => setSyncStatus(e.target.value)}>
                <option value="">– All –</option>
                {SYNC_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
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
        </CardContent>
      </Card>

      {data?.truncated && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardContent className="!py-2 text-sm text-amber-900">
            แสดงได้สูงสุด {ROW_LIMIT.toLocaleString()} รายการต่อครั้ง — ยังมีใบสำคัญมากกว่านี้
            กรุณาแคบช่วงวันที่ลง หรือเลือกที่มาของใบสำคัญเพิ่ม
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
          ) : !rows || rows.length === 0 ? (
            <div className="p-12 text-center text-muted">
              <div className="text-4xl mb-2">📒</div>
              <p>ไม่มี Journal Entry</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    {/* กำหนดความกว้างตามเนื้อหาจริง เหลือให้ Source ยืดเอง
                        เดิมไม่กำหนดเลย เบราว์เซอร์เฉลี่ยให้เท่าๆ กัน คอลัมน์เลขที่ใบเลยกว้างเวิ้งว้าง */}
                    <th className="w-[190px]">JE Number</th>
                    <th className="w-[120px]">JE Date</th>
                    <th>Source</th>
                    <th className="w-[100px]">Status</th>
                    <th className="w-[120px]">NetSuite</th>
                    <th className="text-center w-[230px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((j) => (
                    <tr key={j.id} className="hover:bg-gray-50">
                      <td>
                        <Link to={`/je/${j.id}`} className="text-brand font-medium hover:underline">
                          {j.je_number}
                        </Link>
                        {j.is_reversal && (
                          <Badge variant="warn" className="ml-2 text-[10px]" title="ใบนี้เป็นใบกลับรายการของใบอื่น">
                            REV
                          </Badge>
                        )}
                      </td>
                      <td>{fmtDate(j.je_date)}</td>
                      <td>
                        {/* ป้ายที่มาใช้สีเทา ไม่ใช่สีเข้ม — เป็นการจัดหมวด ไม่ใช่สถานะที่ต้องสะดุดตา
                            ปล่อยให้สีเด่นเหลือแค่ Status กับ NetSuite ที่ต้องกวาดตาหา */}
                        <Badge variant="default" title={j.source_type}>{jeSourceLabel(j.source_type)}</Badge>
                      </td>
                      <td><Badge variant={statusVariant[j.status] ?? 'default'}>{j.status}</Badge></td>
                      <td className="text-xs">
                        {/* ระบบไม่มีคิวและไม่ลองส่งใหม่ให้อัตโนมัติ — ทุกใบต้องกดส่งเอง
                            รายละเอียดข้อผิดพลาดอยู่ที่บันทึกการส่ง ไม่ได้เก็บบนใบสำคัญ */}
                        {j.sync_status === 'synced' ? (
                          <Badge variant="brand" title={`เลขที่ในระบบบัญชี: ${j.netsuite_je_id ?? '—'}`}>✓ ส่งแล้ว</Badge>
                        ) : j.sync_status === 'failed' ? (
                          <Badge variant="danger" title="ส่งครั้งล่าสุดไม่สำเร็จ — กดส่งใหม่ได้จากปุ่มด้านขวา">
                            ❌ ส่งไม่สำเร็จ
                          </Badge>
                        ) : j.status === 'Posted' ? (
                          <Badge variant="warn" title="ยังไม่เคยส่ง — ต้องกดส่งเอง">⏳ รอส่ง</Badge>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-center">
                        {/* ช่องของแต่ละปุ่มกว้างคงที่ ปุ่มจึงอยู่ตำแหน่งเดิมทุกแถว ไม่ขยับไปมาตามว่าแถวนั้นมีกี่ปุ่ม
                            แถวที่ทำอะไรไม่ได้แสดงขีด เพื่อไม่ให้ดูเหมือนตารางแหว่ง */}
                        {(() => {
                          const showPush = canSync && j.status === 'Posted' && j.sync_status !== 'synced';
                          // ใบที่มีใบกลับรายการรออยู่แล้ว (เช่น ใบตีราคาเงินตรา) ต้องซ่อนปุ่ม
                          // ไม่งั้นกดแล้วจะได้ใบกลับรายการซ้ำ กำไรขาดทุนถูกกลับออก 2 รอบ
                          const showReverse =
                            canApprove && j.status === 'Posted' && !j.is_reversal && !j.reversed_by_je_id;
                          if (!showPush && !showReverse) {
                            // ใบตีราคาเงินตราออกใบกลับรายการล่วงหน้าไว้ตั้งแต่ลงบัญชี ใบต้นเรื่องจึงยังเป็น Posted
                            // แต่กดกลับรายการซ้ำไม่ได้ · เดิมติดป้ายไว้ที่เลขที่ใบ แต่ซ้ำกับคอลัมน์ Status
                            // จึงย้ายคำอธิบายมาไว้ที่ขีดตรงนี้ ให้เอาเมาส์ชี้แล้วรู้เหตุผล
                            const why =
                              !j.is_reversal && j.reversed_by_je_id
                                ? 'ใบนี้มีใบกลับรายการรออยู่แล้ว จึงกลับรายการซ้ำไม่ได้'
                                : undefined;
                            return <span className="text-muted text-xs" title={why}>—</span>;
                          }
                          return (
                            <div className="flex justify-center gap-1.5">
                              <span className="w-[124px] inline-flex">
                                {showPush && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="!w-full !py-0.5 !text-xs !normal-case !whitespace-nowrap"
                                    disabled={pushNs.isPending}
                                    title="ส่งใบสำคัญนี้เข้า NetSuite"
                                    onClick={() => pushNs.mutate(j.id)}
                                  >
                                    Push to NetSuite
                                  </Button>
                                )}
                              </span>
                              <span className="w-[78px] inline-flex">
                                {showReverse && (
                                  <Button
                                    variant="default"
                                    size="sm"
                                    className="!w-full !py-0.5 !text-xs !normal-case !whitespace-nowrap"
                                    title={
                                      j.sync_status === 'synced'
                                        ? 'กลับรายการ — ออกใบสำคัญใหม่มาหักล้างใบนี้ ใบเดิมยังอยู่ในระบบ'
                                        : 'ยังไม่ได้ส่งเข้า NetSuite — กดแล้วระบบจะยกเลิกใบนี้ โดยไม่ออกใบสำคัญใหม่'
                                    }
                                    onClick={() => {
                                      // ยังไม่ส่ง NetSuite ระบบจะยกเลิกใบเดิมให้ ไม่ได้ออกใบใหม่
                                      // กล่องยืนยันจึงต้องบอกให้ตรงกับสิ่งที่จะเกิดขึ้นจริง
                                      const msg =
                                        j.sync_status === 'synced'
                                          ? `กลับรายการใบสำคัญ ${j.je_number}?\n\nระบบจะออกใบสำคัญใหม่ที่กลับด้านเดบิต-เครดิตมาหักล้างใบนี้ ใบเดิมยังคงอยู่`
                                          : `ยกเลิกใบสำคัญ ${j.je_number}?\n\nใบนี้ยังไม่ได้ส่งเข้า NetSuite ระบบจะเปลี่ยนสถานะเป็นยกเลิก โดยไม่ออกใบสำคัญใหม่`;
                                      if (confirm(msg)) reverse.mutate(j.id);
                                    }}
                                  >
                                    Reverse
                                  </Button>
                                )}
                              </span>
                            </div>
                          );
                        })()}
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
