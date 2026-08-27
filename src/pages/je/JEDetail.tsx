import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, Upload, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { formatJEPeriod, postJE, reverseJE, jeSourceLabel } from '@/lib/je';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { Button, Card, CardContent, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type JournalEntry, type JELine } from '@/types/database';
import { pushJournalEntryToNetSuite } from '@/lib/netsuite-stub';

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  Posted: 'success',
  Reversed: 'default',
};

// ที่มาของใบสำคัญเก็บเป็น "ชนิดสัญญา + ชนิดงาน" เช่น LOAN_DRAWDOWN, LEASE_DEPR
// ตัดชนิดงานออกก่อนเพื่อหาว่าเป็นสัญญาชนิดไหน จะได้ย้อนกลับไปหน้าสัญญาต้นทางได้
const FACILITY_PREFIXES = ['LOAN', 'LEASE', 'HP', 'PN', 'FP', 'OD', 'TR', 'FXF', 'LG', 'BG', 'LC'];
function facilityKind(sourceTypeUpper: string): string {
  if (sourceTypeUpper === 'FX_VALUATION') return 'FXF';
  return FACILITY_PREFIXES.find((p) => sourceTypeUpper === p || sourceTypeUpper.startsWith(`${p}_`))
    ?? sourceTypeUpper;
}

const SOURCE_TABLES: Record<string, { table: string; noCol: string; path: string }> = {
  LOAN: { table: 'loans', noCol: 'loan_no', path: '/tx/loan' },
  PN: { table: 'promissory_notes', noCol: 'pn_number', path: '/tx/pn' },
  FP: { table: 'floor_plans', noCol: 'fp_no', path: '/tx/fp' },
  OD: { table: 'overdrafts', noCol: 'od_no', path: '/tx/od' },
  TR: { table: 'trust_receipts', noCol: 'tr_no', path: '/tx/tr' },
  FXF: { table: 'fx_forwards', noCol: 'fxf_no', path: '/tx/fxf' },
  LG: { table: 'letter_guarantees', noCol: 'lg_no', path: '/tx/lg' },
  BG: { table: 'letter_guarantees', noCol: 'lg_no', path: '/tx/lg' },
  LC: { table: 'letters_of_credit', noCol: 'lc_no', path: '/tx/lc' },
  REPAYMENT: { table: 'repayments', noCol: 'repayment_no', path: '/tx/repayment' },
};

// สัญญาเช่าใช้ตารางเดียวกัน แต่แยกเมนูตามรูปแบบสัญญา
const LEASE_PATHS: Record<string, string> = {
  hp: '/lease/hp',
  lease: '/lease/leasing',
  other: '/lease/other',
};

/** แปลงที่มาของใบสำคัญเป็นเลขที่สัญญา + เส้นทางไปหน้าสัญญานั้น (คืน null ถ้าโยงไม่ได้) */
async function resolveSourceLink(
  sourceType: string,
  sourceId: string,
): Promise<{ no: string; to: string } | null> {
  const kind = facilityKind(sourceType.toUpperCase());
  if (kind === 'LEASE' || kind === 'HP') {
    const { data } = await supabase.from('leases').select('lease_no, mode').eq('id', sourceId).maybeSingle();
    if (!data) return null;
    const mode = (data as any).mode as string | null;
    return {
      no: ((data as any).lease_no as string) ?? sourceId,
      to: `${LEASE_PATHS[mode ?? ''] ?? '/lease/hp'}/${sourceId}`,
    };
  }
  const m = SOURCE_TABLES[kind];
  if (!m) return null;
  const { data } = await supabase.from(m.table).select(m.noCol).eq('id', sourceId).maybeSingle();
  if (!data) return null;
  const no = (data as any)[m.noCol] as string | null;
  return { no: no ?? sourceId, to: `${m.path}/${sourceId}` };
}

export function JEDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const readOnly = useReadOnly();
  const userLabel = useCurrentUserLabel();
  const canSync = can('je', 'edit') && !readOnly;       // ส่งข้อมูลเข้าระบบบัญชี
  const canApprove = can('je', 'approve') && !readOnly; // ลงบัญชี / กลับรายการ

  const { data, isLoading } = useQuery({
    queryKey: ['je', id],
    enabled: !!id,
    queryFn: async () => {
      const [hdr, lines] = await Promise.all([
        supabase.from('journal_entries').select('*').eq('id', id!).single(),
        supabase.from('je_lines').select('*').eq('je_id', id!).order('line_no'),
      ]);
      if (hdr.error) throw hdr.error;
      return { je: hdr.data as JournalEntry, lines: (lines.data ?? []) as JELine[] };
    },
  });

  // เลขที่สัญญาต้นทาง + ลิงก์กลับไปหน้าโมดูลนั้น
  const srcJE = data?.je;
  const { data: sourceLink } = useQuery({
    queryKey: ['je-source-link', srcJE?.source_type, srcJE?.source_id],
    enabled: !!srcJE?.source_id,
    queryFn: async () => resolveSourceLink(srcJE!.source_type, srcJE!.source_id!),
  });

  const post = useMutation({
    mutationFn: async () => postJE(id!, userLabel),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('✓ Posted to GL');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reverse = useMutation({
    mutationFn: async () => reverseJE(id!, userLabel),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      // ยกเลิกไม่ได้ออกใบใหม่ — ยังอยู่หน้าเดิม ไม่ต้องพาไปไหน
      if (res.mode === 'cancel') {
        toast.success(`ยกเลิกใบสำคัญ ${res.je.je_number} แล้ว — ยังไม่ได้ส่งเข้า NetSuite จึงไม่ต้องออกใบกลับรายการ`);
        return;
      }
      toast.success(`กลับรายการแล้ว — ใบกลับรายการเลขที่ ${res.je.je_number}`);
      navigate(`/je/${res.je.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncNs = useMutation({
    mutationFn: async () => pushJournalEntryToNetSuite(id!),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Synced to NetSuite: ${r.netsuite_je_id}`);
    },
    onError: (e: any) => toast.error(`NetSuite sync failed: ${e.message}`),
  });

  if (isLoading) return <div className="p-6 text-muted">กำลังโหลด...</div>;
  if (!data) return <div className="p-6">ไม่พบ JE</div>;
  const { je, lines } = data;

  // ยอดรวมต้องบวกจากบรรทัดที่แสดงจริง ไม่ใช่หยิบจากหัวใบ
  // ไม่งั้นถ้าบรรทัดหายหรือหัวใบเพี้ยน หน้าจอจะยังดูสวยเหมือนไม่มีอะไรผิด
  const lineDr = lines.reduce((s, l) => s + (l.dr ?? 0), 0);
  const lineCr = lines.reduce((s, l) => s + (l.cr ?? 0), 0);
  const TOL = 0.01;
  const notBalanced = Math.abs(lineDr - lineCr) > TOL;
  const headerMismatch =
    Math.abs(lineDr - (je.total_dr ?? 0)) > TOL || Math.abs(lineCr - (je.total_cr ?? 0)) > TOL;
  const hasIssue = notBalanced || headerMismatch;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/je')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{je.je_number}</h1>
            <Badge variant={statusVariant[je.status] ?? 'default'}>{je.status}</Badge>
            {je.is_reversal && <Badge variant="warn">REVERSAL</Badge>}
            {je.sync_status === 'synced' ? (
              <Badge variant="brand" title={`NetSuite ID: ${je.netsuite_je_id}`}>
                ✓ NS Synced
              </Badge>
            ) : je.status === 'Posted' ? (
              <Badge variant="warn">⏳ Not Synced</Badge>
            ) : null}
          </div>
          <p className="text-muted text-sm">{je.description}</p>
          {je.sync_status === 'synced' && (
            <p className="text-xs text-muted mt-0.5">
              NetSuite JE: <strong className="font-mono">{je.netsuite_je_id}</strong> · synced{' '}
              {je.netsuite_synced_at ? new Date(je.netsuite_synced_at).toLocaleString('en-GB') : ''}
            </p>
          )}
        </div>

        {/* Sync to NetSuite — show only when Posted + not yet synced */}
        {canSync && je.status === 'Posted' && je.sync_status !== 'synced' && (
          <Button
            onClick={() => syncNs.mutate()}
            disabled={syncNs.isPending}
            className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200"
            title="Push this JE to NetSuite GL (currently mock — logs to console + sets sync metadata)"
          >
            <Upload className="w-4 h-4" /> {syncNs.isPending ? 'Syncing...' : 'Sync to NetSuite'}
          </Button>
        )}

        {canApprove && je.status === 'Draft' && (
          <>
            <Button variant="primary" onClick={() => post.mutate()} disabled={post.isPending}>
              <CheckCircle className="w-4 h-4" /> Post to GL
            </Button>
          </>
        )}
        {/* ใบที่ผูกใบกลับรายการไว้แล้ว (เช่น ใบตีราคาเงินตราที่ออกใบกลับรายการล่วงหน้า)
            ต้องซ่อนปุ่ม ไม่งั้นกดแล้วได้ใบกลับรายการซ้ำ กำไรขาดทุนถูกกลับออก 2 รอบ */}
        {canApprove && je.status === 'Posted' && !je.is_reversal && !je.reversed_by_je_id && (
          <Button onClick={() => { if (confirm(`Reverse ${je.je_number}?`)) reverse.mutate(); }}>
            <RotateCcw className="w-4 h-4" /> Reverse
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <Card><CardContent>
          <div className="text-xs text-muted">JE Date</div>
          <div className="font-semibold">{fmtDate(je.je_date)}</div>
        </CardContent></Card>
        <Card><CardContent>
          <div className="text-xs text-muted">Posting Period</div>
          <div className="font-semibold">{je.posting_period}</div>
        </CardContent></Card>
        <Card><CardContent>
          <div className="text-xs text-muted">Source</div>
          <div className="font-semibold">
            <Badge variant="brand" title={je.source_type}>{jeSourceLabel(je.source_type)}</Badge>
            {/* งวดของใบตีราคาเก็บเป็นปีเดือน 6 หลัก ต้องแปลงให้อ่านเข้าใจ */}
            {je.source_period != null && (
              <span className="ml-2 text-xs">งวด {formatJEPeriod(je.source_period)}</span>
            )}
          </div>
        </CardContent></Card>
        <Card><CardContent>
          <div className="text-xs text-muted">สัญญาต้นทาง</div>
          <div className="font-semibold text-sm">
            {sourceLink ? (
              <Link to={sourceLink.to} className="text-brand hover:underline">{sourceLink.no}</Link>
            ) : (
              <span className="text-muted">—</span>
            )}
          </div>
        </CardContent></Card>
      </div>

      {je.posted_at && (
        <Card className="mb-4">
          <CardContent>
            <div className="text-xs text-muted">Posted by</div>
            <div className="text-sm">{je.posted_by} · {fmtDate(je.posted_at)}</div>
          </CardContent>
        </Card>
      )}

      {hasIssue && (
        <Card className="mb-4 border-2 border-red-500 bg-red-50">
          <CardContent className="!py-3 text-sm text-red-800">
            <div className="font-bold mb-1">⚠ ยอดในใบสำคัญนี้ไม่ถูกต้อง</div>
            {notBalanced && (
              <div>
                เดบิตไม่เท่ากับเครดิต — เดบิต {fmtMoney(lineDr)} · เครดิต {fmtMoney(lineCr)} ·
                ต่างกัน {fmtMoney(Math.abs(lineDr - lineCr))}
              </div>
            )}
            {headerMismatch && (
              <div>
                ยอดรวมที่บวกจากบรรทัดบัญชี (เดบิต {fmtMoney(lineDr)} · เครดิต {fmtMoney(lineCr)})
                ไม่ตรงกับยอดที่บันทึกไว้ในหัวใบ (เดบิต {fmtMoney(je.total_dr)} · เครดิต {fmtMoney(je.total_cr)})
                — อาจมีบรรทัดบัญชีหายไป
              </div>
            )}
            <div className="mt-1">ห้ามส่งใบนี้เข้าระบบบัญชีจนกว่าจะแก้ให้ถูกต้อง</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="table-base">
            <thead>
              <tr className="bg-brand text-white">
                <th className="!text-white !bg-brand w-10">#</th>
                <th className="!text-white !bg-brand">Account</th>
                <th className="!text-white !bg-brand">Description</th>
                <th className="!text-white !bg-brand text-right w-32">Dr</th>
                <th className="!text-white !bg-brand text-right w-32">Cr</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="text-right tabular-nums">{l.line_no}</td>
                  <td>
                    {l.account_code && <span className="text-xs text-muted mr-2">{l.account_code}</span>}
                    {l.account_name}
                  </td>
                  <td className="text-xs">{l.description}</td>
                  <td className="text-right tabular-nums">{l.dr > 0 ? fmtMoney(l.dr) : '—'}</td>
                  <td className="text-right tabular-nums">{l.cr > 0 ? fmtMoney(l.cr) : '—'}</td>
                </tr>
              ))}
              {/* ยอดรวมบวกจากบรรทัดที่แสดงจริง — ถ้าไม่ตรงกับหัวใบหรือไม่ดุลจะขึ้นแถบเตือนด้านบน */}
              <tr className={`font-bold border-t-2 border-line ${hasIssue ? 'bg-red-50 text-red-800' : 'bg-soft'}`}>
                <td colSpan={3} className="text-right">
                  Total {notBalanced ? '· ไม่ดุล' : '· ดุล'}
                </td>
                <td className="text-right tabular-nums">{fmtMoney(lineDr)}</td>
                <td className="text-right tabular-nums">{fmtMoney(lineCr)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {je.remark && (
        <Card className="mt-4">
          <CardContent>
            <div className="text-xs text-muted mb-1">Remark</div>
            <div className="text-sm">{je.remark}</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
