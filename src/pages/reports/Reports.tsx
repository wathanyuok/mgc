import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, Navigate } from 'react-router-dom';
import { FileBarChart } from 'lucide-react';
import { Card, CardContent, Badge, usePaged, Pagination } from '@/components/ui';
import { fmtMoney, fmtDate } from '@/lib/format';
import { getChassisOverlaps } from '@/lib/chassis-overlap';
import { StandardReport, type ReportCol, type ReportFilter } from '@/components/reports/StandardReport';
import {
  getMaReport, getCaReport, getTxReport, getCarStockReport, getMaturityReport, getRepaymentReport,
  getDuePaymentReport, getOverduePaymentReport,
  type MaReportRow, type CaReportRow, type TxReportRow, type CarStockRow,
  type MaturityReportRow, type RepaymentReportRow, type PaymentDueRow,
} from '@/lib/standard-reports';
import {
  getCreditUtilization, getPortfolioSummary, getInterestSummary,
  getCollateralSummary, getMaturityWithin, getLeaseMovement,
} from '@/lib/reports';

// รายชื่อรายงานที่เปิดใช้ — เมนูด้านซ้ายอ่านจากรายการนี้ (REPORT_ITEMS ใน Sidebar)
// ที่เหลือสร้างไว้แล้วแต่ยังไม่มีใครขอ → เก็บที่ HIDDEN_TABS · ย้ายกลับขึ้นมาได้ทันที
export const TABS = [
  { key: 'std_ma',          label: 'Master Agreement Report' },
  { key: 'std_ca',          label: 'Credit Agreement Report' },
  { key: 'std_tx',          label: 'Credit Transaction Report' },
  { key: 'std_car',         label: 'Car Stock Movement Report' },
  { key: 'std_maturity',    label: 'Maturity Report' },
  { key: 'std_repay',       label: 'Repayment Report' },
  { key: 'std_due',         label: 'Due Payment Report' },
  { key: 'std_overdue',     label: 'Overdue Payment Report' },
  { key: 'chassis_move',    label: 'Chassis Movement Report' },
  { key: 'chassis_overlap', label: 'Chassis Cross-Facility Report' },
] as const;

// ยังไม่เปิดใช้ — รอลูกค้ายืนยันรายชื่อรายงานมาตรฐาน
const HIDDEN_TABS = [
  { key: 'util', label: 'Credit Utilization' },
  { key: 'movement', label: 'Loan Movement' },
  { key: 'interest', label: 'Interest' },
  { key: 'lease', label: 'Lease Movement' },
  { key: 'collateral', label: 'Collateral' },
  { key: 'maturity', label: 'ภาระคืน ≤1 ปี' },
  { key: 'financial', label: 'Financial Report' },
] as const;

type TabKey = (typeof TABS)[number]['key'] | (typeof HIDDEN_TABS)[number]['key'];

export function Reports() {
  const { key } = useParams();
  const known = [...TABS, ...HIDDEN_TABS].map((t) => t.key as string);
  if (!key) return <Navigate to={`/reports/${TABS[0].key}`} replace />;
  if (!known.includes(key)) return <Navigate to={`/reports/${TABS[0].key}`} replace />;
  const tab = key as TabKey;
  const title = [...TABS, ...HIDDEN_TABS].find((t) => t.key === key)?.label ?? 'รายงาน';

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <FileBarChart className="w-6 h-6 text-brand" />
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
      </div>

      {tab === 'util' && <UtilizationReport />}
      {tab === 'movement' && <MovementReport />}
      {tab === 'interest' && <InterestReport />}
      {tab === 'collateral' && <CollateralReport />}
      {tab === 'maturity' && <MaturityReport />}
      {tab === 'lease' && <LeaseReport />}
      {tab === 'std_ma' && <StdMaReport />}
      {tab === 'std_ca' && <StdCaReport />}
      {tab === 'std_tx' && <StdTxReport />}
      {tab === 'std_car' && <StdCarStockReport />}
      {tab === 'std_maturity' && <StdMaturityReport />}
      {tab === 'std_repay' && <StdRepaymentReport />}
      {tab === 'std_due' && <StdDueReport />}
      {tab === 'std_overdue' && <StdOverdueReport />}
      {tab === 'chassis_move' && <ChassisMovementReport />}
      {tab === 'chassis_overlap' && <ChassisOverlapReport />}
      {tab === 'financial' && <FinancialPlaceholder />}
    </div>
  );
}

function UtilizationReport() {
  const { data } = useQuery({ queryKey: ['rep-util'], queryFn: getCreditUtilization });
  const rows = data?.rows ?? [];
  return (
    <Card>
      <CardContent className="p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Credit Agreement</th><th>ประเภทวงเงิน</th>
              <th className="text-right">วงเงิน (Line)</th><th className="text-right">ใช้ไป (Utilized)</th>
              <th className="text-right">คงเหลือ (Un-Utilized)</th><th className="text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="font-medium"><Link to={`/ca/${r.id}`} className="text-brand hover:underline">{r.name}</Link></td>
                <td className="text-muted">{r.creditType || '—'}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.creditLine)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.used)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.available)}</td>
                <td className="text-right tabular-nums">
                  <Badge variant={r.pct >= 90 ? 'danger' : r.pct >= 70 ? 'warn' : 'success'}>{r.pct.toFixed(1)}%</Badge>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-6">ไม่มีข้อมูล</td></tr>}
          </tbody>
          {data && (
            <tfoot>
              <tr className="bg-soft font-semibold">
                <td colSpan={2}>รวม</td>
                <td className="text-right tabular-nums">{fmtMoney(data.totalLine)}</td>
                <td className="text-right tabular-nums">{fmtMoney(data.totalUsed)}</td>
                <td className="text-right tabular-nums">{fmtMoney(data.totalLine - data.totalUsed)}</td>
                <td className="text-right tabular-nums">{data.totalLine > 0 ? ((data.totalUsed / data.totalLine) * 100).toFixed(1) : '0.0'}%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </CardContent>
    </Card>
  );
}

function MovementReport() {
  const { data = [] } = useQuery({ queryKey: ['rep-portfolio'], queryFn: getPortfolioSummary });
  const total = data.reduce((s, p) => s + p.outstanding, 0);
  return (
    <Card>
      <CardContent className="p-0">
        <table className="table-base">
          <thead>
            <tr><th>ผลิตภัณฑ์</th><th className="text-right">จำนวนสัญญา (Active)</th><th className="text-right">ยอดคงค้าง (Outstanding)</th><th className="text-right">% ของพอร์ต</th></tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.key} className="hover:bg-gray-50">
                <td><Link to={p.route} className="text-brand hover:underline font-medium">{p.label}</Link></td>
                <td className="text-right tabular-nums">{p.count}</td>
                <td className="text-right tabular-nums">{fmtMoney(p.outstanding)}</td>
                <td className="text-right tabular-nums">{total > 0 ? ((p.outstanding / total) * 100).toFixed(1) : '0.0'}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-soft font-semibold">
              <td>รวม</td>
              <td className="text-right tabular-nums">{data.reduce((s, p) => s + p.count, 0)}</td>
              <td className="text-right tabular-nums">{fmtMoney(total)}</td>
              <td className="text-right tabular-nums">100.0%</td>
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}

function InterestReport() {
  const { data = [] } = useQuery({ queryKey: ['rep-interest'], queryFn: getInterestSummary });
  const total = data.reduce((s, r) => s + r.accrued, 0);
  return (
    <Card>
      <CardContent className="p-0">
        <table className="table-base">
          <thead><tr><th>ผลิตภัณฑ์</th><th className="text-right">ดอกเบี้ยค้างรับ/จ่ายสะสม (Accrued)</th></tr></thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.product} className="hover:bg-gray-50">
                <td className="font-medium">{r.product}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.accrued)}</td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={2} className="text-center text-muted py-6">ยังไม่มีดอกเบี้ยค้างบันทึกในระบบ</td></tr>}
          </tbody>
          {data.length > 0 && <tfoot><tr className="bg-soft font-semibold"><td>รวม</td><td className="text-right tabular-nums">{fmtMoney(total)}</td></tr></tfoot>}
        </table>
        <p className="text-xs text-muted p-3 italic">* ดอกเบี้ยจริงที่ลง GL อยู่ที่ Journal Entries (Accrued/Interest) — ตารางนี้สรุปยอดค้างคงเหลือต่อผลิตภัณฑ์</p>
      </CardContent>
    </Card>
  );
}

function CollateralReport() {
  const { data } = useQuery({ queryKey: ['rep-collateral'], queryFn: getCollateralSummary });
  const rows = data?.rows ?? [];
  return (
    <Card>
      <CardContent className="p-0">
        <table className="table-base">
          <thead>
            <tr><th>ประเภท</th><th>อ้างอิง</th><th className="text-right">ราคาประเมิน</th><th className="text-right">มูลค่าปัจจุบัน</th><th>สถานะ</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="font-medium">{r.type}</td>
                <td><Link to={`/ma/${r.maId}`} className="text-brand hover:underline">{r.ref}</Link></td>
                <td className="text-right tabular-nums">{fmtMoney(r.appraisal)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.value)}</td>
                <td>{r.drop ? <Badge variant="danger">มูลค่าลดลง &gt;10%</Badge> : <Badge variant="success">ปกติ</Badge>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="text-center text-muted py-6">ไม่มีหลักประกัน</td></tr>}
          </tbody>
          {data && rows.length > 0 && (
            <tfoot><tr className="bg-soft font-semibold">
              <td colSpan={2}>รวม</td>
              <td className="text-right tabular-nums">{fmtMoney(data.totalAppraisal)}</td>
              <td className="text-right tabular-nums">{fmtMoney(data.totalValue)}</td><td></td>
            </tr></tfoot>
          )}
        </table>
      </CardContent>
    </Card>
  );
}

function MaturityReport() {
  const { data = [] } = useQuery({ queryKey: ['rep-maturity'], queryFn: () => getMaturityWithin(365) });
  const total = data.reduce((s, m) => s + m.amount, 0);
  return (
    <Card>
      <CardContent className="p-0">
        <table className="table-base">
          <thead>
            <tr><th>ผลิตภัณฑ์</th><th>สัญญา</th><th>วันครบกำหนด</th><th className="text-right">คงเหลือ (วัน)</th><th className="text-right">ยอดเงิน</th><th className="w-16"></th></tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.key} className="hover:bg-gray-50">
                <td><Badge variant="default">{m.product}</Badge></td>
                <td className="font-medium">{m.ref}</td>
                <td>{fmtDate(m.dueDate)}</td>
                <td className={`text-right tabular-nums ${m.days < 0 ? 'text-danger font-semibold' : m.days <= 30 ? 'text-orange-600' : ''}`}>
                  {m.days < 0 ? `เกิน ${Math.abs(m.days)}` : m.days}
                </td>
                <td className="text-right tabular-nums">{fmtMoney(m.amount)}</td>
                <td className="text-right"><Link to={m.route} className="text-brand hover:underline text-xs">เปิด →</Link></td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={6} className="text-center text-muted py-6">ไม่มีรายการครบกำหนดภายใน 1 ปี</td></tr>}
          </tbody>
          {data.length > 0 && <tfoot><tr className="bg-soft font-semibold"><td colSpan={4}>รวม {data.length} รายการ</td><td className="text-right tabular-nums">{fmtMoney(total)}</td><td></td></tr></tfoot>}
        </table>
      </CardContent>
    </Card>
  );
}

// รายงานรถค้ำประกันซ้ำวงเงิน — เลขตัวถังเดียวอยู่ในสัญญาที่ยังไม่ปิดมากกว่า 1 วงเงิน
function ChassisOverlapReport() {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<'all' | 'violation' | 'review'>('all');
  const [bank, setBank] = useState('');
  const [module, setModule] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['rep-chassis-overlap'],
    queryFn: getChassisOverlaps,
  });

  const violation = data.filter((r) => r.sameBank).length;
  const review = data.length - violation;
  const banks = [...new Set(data.flatMap((r) => r.uses.map((u) => u.bank)))]
    .filter((b) => b && b !== '—').sort();
  const modules = [...new Set(data.flatMap((r) => r.uses.map((u) => u.module)))].sort();

  const kw = q.trim().toLowerCase();
  const shown = data.filter((r) => {
    if (result === 'violation' && !r.sameBank) return false;
    if (result === 'review' && r.sameBank) return false;
    if (bank && !r.uses.some((u) => u.bank === bank)) return false;
    if (module && !r.uses.some((u) => u.module === module)) return false;
    if (!kw) return true;
    return [r.chassisNo, r.model, ...r.uses.map((u) => u.contractNo)]
      .some((v) => String(v ?? '').toLowerCase().includes(kw));
  });

  const pg = usePaged(shown);
  const chips = [
    { key: 'all' as const,       label: 'ทั้งหมด',                  n: data.length, dot: '' },
    { key: 'violation' as const, label: 'ธนาคารเดียวกัน — ผิดกฎ',   n: violation,   dot: 'bg-red-500' },
    { key: 'review' as const,    label: 'ต่างธนาคาร — ตรวจสอบ',     n: review,      dot: 'bg-amber-500' },
  ];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-line space-y-2.5">
          <p className="text-sm text-muted">
            รถคันเดียวถูกใช้ค้ำมากกว่า 1 วงเงิน — ธนาคารเดียวกันถือว่าผิดกฎ · ต่างธนาคารทำได้แต่ต้องตรวจสอบ
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <button
                key={c.key} type="button" onClick={() => setResult(c.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  result === c.key ? 'border-brand bg-brand-light font-medium text-brand'
                                   : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {c.dot && <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />}
                {c.label}
                <span className="tabular-nums text-gray-400">{c.n}</span>
              </button>
            ))}

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหา เลขตัวถัง · รุ่นรถ · เลขสัญญา"
                className="h-8 w-56 rounded-lg border border-gray-200 px-2.5 text-sm outline-none transition
                           placeholder:text-gray-400 focus:border-brand focus:ring-4 focus:ring-brand/10"
              />
              {banks.length > 1 && (
                <select
                  value={bank} onChange={(e) => setBank(e.target.value)}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none focus:border-brand"
                >
                  <option value="">ทุกธนาคาร</option>
                  {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
              {modules.length > 1 && (
                <select
                  value={module} onChange={(e) => setModule(e.target.value)}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none focus:border-brand"
                >
                  <option value="">ทุกประเภทสัญญา</option>
                  {modules.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              {(q || result !== 'all' || bank || module) && (
                <button
                  type="button"
                  onClick={() => { setQ(''); setResult('all'); setBank(''); setModule(''); }}
                  className="h-8 rounded-lg border border-gray-200 px-2.5 text-xs text-gray-600 transition hover:bg-gray-50"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>
          </div>
        </div>

        <table className="table-base">
          <thead>
            <tr>
              <th>เลขตัวถัง</th>
              <th>รุ่นรถ</th>
              <th>อยู่ในวงเงิน</th>
              <th className="text-center">จำนวนสัญญา</th>
              <th>ผลตรวจ</th>
            </tr>
          </thead>
          <tbody>
            {pg.rows.map((r) => (
              <tr key={r.chassisNo} className={r.sameBank ? 'bg-red-50/60 hover:bg-red-50' : 'bg-amber-50/40 hover:bg-amber-50'}>
                <td className="font-mono text-xs align-top">{r.chassisNo}</td>
                <td className="align-top">{r.model ?? '—'}</td>
                <td>
                  <div className="space-y-1">
                    {r.uses.map((u, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">{u.module}</span>
                        <Link to={u.route} className="font-medium text-brand hover:underline">{u.contractNo}</Link>
                        <span className="text-muted">·</span>
                        <span>{u.bank}</span>
                        <span className="text-muted">·</span>
                        <span className="text-muted">{u.status}</span>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="text-center align-top tabular-nums">
                  {r.uses.length}
                  <div className="text-[10px] text-muted">{r.bankCount} ธนาคาร</div>
                </td>
                <td className="align-top">
                  {r.sameBank
                    ? <Badge variant="danger">ธนาคารเดียวกัน — ผิดกฎ</Badge>
                    : <Badge variant="warn">ต่างธนาคาร — ตรวจสอบ</Badge>}
                </td>
              </tr>
            ))}
            {!isLoading && shown.length === 0 && (
              <tr><td colSpan={5} className="text-center text-muted py-8">
                {data.length > 0 ? 'ไม่พบรายการตามเงื่อนไขที่เลือก' : 'ไม่พบรถที่ถูกใช้ค้ำซ้อนกัน — ข้อมูลถูกต้องทั้งหมด'}
              </td></tr>
            )}
            {isLoading && (
              <tr><td colSpan={5} className="text-center text-muted py-8">กำลังตรวจสอบทั้งพอร์ต...</td></tr>
            )}
          </tbody>
        </table>
        <Pagination {...pg} unit="คัน" />
      </CardContent>
    </Card>
  );
}

// FR-FP-022 — รถที่ขายแล้วแต่วงเงินยังไม่ปิด · เป็นรายการงานค้าง ไม่ใช่รายงานสรุป
// จึงแสดงเฉพาะที่ยังไม่ปิด และเรียงตามจำนวนวันที่ค้างมานานสุดขึ้นก่อน (ไม่ต้องมีตัวกรองวันที่)
const FP_CLOSED = ['Repaid', 'Closed', 'Cancelled'];

// ช่วงอายุค้าง — ใช้ทั้งชิปสรุปด้านบนและการกรอง
const AGE_BANDS = [
  { key: 'all',  label: 'ทั้งหมด',        dot: '',   test: () => true },
  { key: 'over30', label: 'เกิน 30 วัน',   dot: 'bg-red-500',    test: (d: number) => d >= 30 },
  { key: 'mid',    label: '15–29 วัน',     dot: 'bg-amber-500',  test: (d: number) => d >= 15 && d < 30 },
  { key: 'new',    label: 'ต่ำกว่า 15 วัน', dot: 'bg-gray-300',   test: (d: number) => d < 15 },
] as const;

function ChassisMovementReport() {
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState('');
  const [band, setBand] = useState<string>('all');
  const [bank, setBank] = useState('');

  const { data = [] } = useQuery({
    queryKey: ['rep-chassis-movement'],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabase');
      const { data: sold } = await supabase
        .from('fp_chassis')
        .select('id, fp_id, chassis_no, model, sold_date, sold_source, amount')
        .not('sold_date', 'is', null)
        .order('sold_date');
      const rows = (sold ?? []) as any[];
      if (rows.length === 0) return [];
      const fpIds = [...new Set(rows.map((r) => r.fp_id))];
      const { data: fps } = await supabase
        .from('floor_plans')
        .select('id, fp_no, name, status, finance_institution')
        .in('id', fpIds);
      const fpMap = new Map(((fps ?? []) as any[]).map((f) => [f.id, f]));
      const today = new Date();
      return rows
        .map((r) => {
          const fp = fpMap.get(r.fp_id);
          const days = r.sold_date
            ? Math.max(0, Math.floor((today.getTime() - new Date(r.sold_date).getTime()) / 86400000))
            : 0;
          return { ...r, fp, days, open: fp ? !FP_CLOSED.includes(fp.status) : false };
        })
        .filter((r) => r.fp)
        .sort((a, b) => Number(b.open) - Number(a.open) || b.days - a.days); // ค้างนานสุดขึ้นก่อน
    },
  });

  const openRows = data.filter((r: any) => r.open);
  const doneRows = data.filter((r: any) => !r.open);
  const banks = [...new Set(data.map((r: any) => r.fp?.finance_institution).filter(Boolean))].sort();

  // ชิปอายุค้าง — นับจากรายการที่ยังไม่ปิดเท่านั้น (ที่ปิดแล้วไม่ใช่งานค้าง)
  const bandCount = (key: string) => {
    const b = AGE_BANDS.find((x) => x.key === key)!;
    return openRows.filter((r: any) => (b.test as any)(r.days)).length;
  };

  const kw = q.trim().toLowerCase();
  const match = (r: any) => {
    if (bank && r.fp?.finance_institution !== bank) return false;
    if (band !== 'all' && r.open) {
      const b = AGE_BANDS.find((x) => x.key === band)!;
      if (!(b.test as any)(r.days)) return false;
    }
    if (band !== 'all' && !r.open) return false;   // กรองตามอายุ = ดูเฉพาะงานค้าง
    if (!kw) return true;
    return [r.chassis_no, r.model, r.fp?.name, r.fp?.fp_no]
      .some((v) => String(v ?? '').toLowerCase().includes(kw));
  };

  const shown = (showDone ? [...openRows, ...doneRows] : openRows).filter(match);
  const totalDue = shown.filter((r: any) => r.open).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const pg = usePaged(shown);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-line space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted flex-1">
              รถที่ขายแล้วแต่วงเงินยังไม่ปิด — ต้องปิดวงเงินและจ่ายคืนธนาคาร
            </p>
            {shown.some((r: any) => r.open) && (
              <Badge variant="default">ยอดที่ต้องจ่ายคืน {fmtMoney(totalDue)}</Badge>
            )}
          </div>

          {/* ชิปอายุค้าง — เห็นยอดแต่ละกลุ่มทันที กดแล้วกรองได้ */}
          <div className="flex flex-wrap items-center gap-1.5">
            {AGE_BANDS.map((b) => {
              const n = b.key === 'all' ? openRows.length : bandCount(b.key);
              const active = band === b.key;
              return (
                <button
                  key={b.key} type="button" onClick={() => setBand(b.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                    active ? 'border-brand bg-brand-light font-medium text-brand'
                           : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  {b.dot && <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />}
                  {b.label}
                  <span className="tabular-nums text-gray-400">{n}</span>
                </button>
              );
            })}

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหา เลขตัวถัง · รุ่นรถ · เลขวงเงิน"
                className="h-8 w-56 rounded-lg border border-gray-200 px-2.5 text-sm outline-none transition
                           placeholder:text-gray-400 focus:border-brand focus:ring-4 focus:ring-brand/10"
              />
              {banks.length > 1 && (
                <select
                  value={bank} onChange={(e) => setBank(e.target.value)}
                  className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none focus:border-brand"
                >
                  <option value="">ทุกธนาคาร</option>
                  {banks.map((b: any) => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
              {(q || band !== 'all' || bank) && (
                <button
                  type="button"
                  onClick={() => { setQ(''); setBand('all'); setBank(''); }}
                  className="h-8 rounded-lg border border-gray-200 px-2.5 text-xs text-gray-600 transition hover:bg-gray-50"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
          {doneRows.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
            >
              {showDone ? 'ซ่อนที่ปิดแล้ว' : `แสดงที่ปิดแล้ว (${doneRows.length})`}
            </button>
          )}
          </div>
        </div>

        <table className="table-base">
          <thead>
            <tr>
              <th>เลขตัวถัง</th><th>รุ่นรถ</th><th>วงเงิน</th><th>ธนาคาร</th>
              <th>วันขาย</th>
              <th className="text-right">ค้างมา</th>
              <th>ที่มา</th>
              <th className="text-right">ยอดที่ต้องจ่ายคืน</th>
              <th>สถานะวงเงิน</th>
            </tr>
          </thead>
          <tbody>
            {pg.rows.map((r: any) => (
              <tr key={r.id} className={r.open ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'}>
                <td className="font-mono text-xs">{r.chassis_no}</td>
                <td>{r.model ?? '—'}</td>
                <td><Link to={`/tx/fp/${r.fp_id}`} className="text-brand hover:underline font-medium">{r.fp.name ?? r.fp.fp_no}</Link></td>
                <td className="text-xs">{r.fp.finance_institution ?? '—'}</td>
                <td>{fmtDate(r.sold_date)}</td>
                <td className="text-right tabular-nums">
                  {r.open ? (
                    <span className={
                      r.days >= 30 ? 'font-semibold text-red-600'
                        : r.days >= 15 ? 'font-medium text-amber-600'
                          : 'text-gray-600'
                    }>
                      {r.days} วัน
                    </span>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="text-xs">{r.sold_source === 'netsuite' ? 'NetSuite' : 'กรอกเอง'}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
                <td>
                  {r.open
                    ? <Badge variant="warn">ยังไม่ปิด — ต้องจ่ายคืนธนาคาร</Badge>
                    : <Badge variant="success">ปิดแล้ว · {r.fp.status}</Badge>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-muted py-8">
                  {data.length === 0
                    ? '— ยังไม่มีรถที่บันทึกการขาย —'
                    : (q || band !== 'all' || bank)
                      ? 'ไม่พบรายการตามเงื่อนไขที่เลือก'
                      : '✓ ไม่มีงานค้าง — รถที่ขายแล้วปิดวงเงินครบทุกคัน'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination {...pg} unit="คัน" />
      </CardContent>
    </Card>
  );
}

function LeaseReport() {
  const { data = [] } = useQuery({ queryKey: ['rep-lease'], queryFn: getLeaseMovement });
  const t = data.reduce((a, r) => ({
    libBeg: a.libBeg + r.liabilityBeginning, libEnd: a.libEnd + r.liabilityEnding,
    rouCost: a.rouCost + r.rouCost, rouNbv: a.rouNbv + r.rouNbv,
  }), { libBeg: 0, libEnd: 0, rouCost: 0, rouNbv: 0 });
  return (
    <Card>
      <CardContent className="p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>สัญญา</th><th>ประเภท</th><th>สินทรัพย์</th><th>อายุ</th>
              <th className="text-right">Lease Liability (ต้นงวด)</th><th className="text-right">คงเหลือ</th>
              <th className="text-right">ROU Cost</th><th className="text-right">ROU NBV</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="font-medium">{r.ref}</td>
                <td><Badge variant={r.mode === 'HP' ? 'brand' : 'default'}>{r.mode}</Badge></td>
                <td className="text-muted">{r.assetType}</td>
                <td>{r.ageBucket}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.liabilityBeginning)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.liabilityEnding)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.rouCost)}</td>
                <td className="text-right tabular-nums">{fmtMoney(r.rouNbv)}</td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={8} className="text-center text-muted py-6">ไม่มีสัญญา Lease/HP ที่ Active</td></tr>}
          </tbody>
          {data.length > 0 && (
            <tfoot><tr className="bg-soft font-semibold">
              <td colSpan={4}>รวม</td>
              <td className="text-right tabular-nums">{fmtMoney(t.libBeg)}</td>
              <td className="text-right tabular-nums">{fmtMoney(t.libEnd)}</td>
              <td className="text-right tabular-nums">{fmtMoney(t.rouCost)}</td>
              <td className="text-right tabular-nums">{fmtMoney(t.rouNbv)}</td>
            </tr></tfoot>
          )}
        </table>
        <p className="text-xs text-muted p-3 italic">* Movement ของ Lease Liability + ROU Asset · ROU NBV คำนวณแบบ straight-line จากอายุที่ผ่านไป</p>
      </CardContent>
    </Card>
  );
}

function FinancialPlaceholder() {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <div className="text-4xl mb-3">📊</div>
        <h3 className="font-semibold mb-1">Financial Report</h3>
        <p className="text-muted text-sm max-w-md mx-auto">
          รายงานงบการเงิน (จัดกลุ่ม Loan/Lease, หมายเหตุประกอบงบ, กระแสเงินสด)
          ส่วนนี้ยังไม่ยืนยันว่าจะอยู่ในระบบนี้หรือออกจาก NetSuite จึงทำเป็น placeholder ไว้ก่อน
          ระบบนี้เป็นแหล่งข้อมูล (Schedule, Movement, JE) ส่งต่อให้ NetSuite ออกงบ
        </p>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// รายงานมาตรฐาน 6 ฉบับ ตามแบบฟอร์มที่ลูกค้ากำหนด
// ═══════════════════════════════════════════════════════════════

function StdMaReport() {
  const { data = [], isLoading } = useQuery({ queryKey: ['std-ma'], queryFn: getMaReport });
  const cols: ReportCol<MaReportRow>[] = [
    { key: 'no', label: "No.", kind: 'number', render: (r) => (r.no === 0 ? '' : r.no) },
    { key: 'company', label: "Company" },
    { key: 'maName', label: "Master Agreement Name", min: 140,
      render: (r) => <span className="font-medium text-gray-800">{r.maName}</span> },
    { key: 'fiType', label: "Finance Institution Type" },
    { key: 'fiName', label: "Finance Institution Name" },
    { key: 'startDate', label: "Start Date", kind: 'date' },
    { key: 'endDate', label: "End Date", kind: 'date' },
    { key: 'status', label: "Status", render: (r) => <Badge variant={r.status === 'Approved' ? 'success' : 'default'}>{r.status}</Badge> },
    { key: 'deRatio', label: "D/E Ratio" },
    { key: 'dscrRatio', label: "DSCR Ratio" },
    { key: 'otherRequirement', label: "Other Requirement", min: 160 },
    { key: 'consentWaiver', label: "Consent / Waiver", min: 140 },
    { key: 'guarantee', label: "Guarantee", min: 140 },
    { key: 'collateral', label: "Collateral", min: 140 },
    { key: 'creditLine', label: "Credit Line", kind: 'money' },
    { key: 'utilization', label: "Line Utilization", kind: 'money' },
    { key: 'remaining', label: "Remaining Credit Line", kind: 'money' },
    { key: 'childSubsidiary', label: "Subsidiary" },
    { key: 'childCreditLine', label: "Credit Line (Child)", kind: 'money' },
    { key: 'childUtilization', label: "Line Utilization (Child)", kind: 'money' },
    { key: 'childRemaining', label: "Remaining Credit Line (Child)", kind: 'money' },
  ];
  return (
    <StandardReport
      title="Master Agreement Report"
      description="สัญญาวงเงินหลักทั้งหมด พร้อมเงื่อนไข ผู้ค้ำประกัน หลักประกัน และการจัดสรรวงเงินให้บริษัทย่อย"
      columns={cols} rows={data} isLoading={isLoading} unit="สัญญา"
      searchKeys={['maName', 'company', 'fiName', 'childSubsidiary']}
      filters={[
        { key: 'company', label: "Company" },
        { key: 'fiType', label: "Finance Institution Type" },
        { key: 'fiName', label: "Finance Institution Name" },
        { key: 'startDate', label: "Start Date", kind: 'dateRange' },
        { key: 'endDate', label: "End Date", kind: 'dateRange' },
        { key: 'maName', label: "Master Agreement Name", kind: 'text' },
        { key: 'status', label: "Status" },
      ]}
    />
  );
}

function StdCaReport() {
  const { data = [], isLoading } = useQuery({ queryKey: ['std-ca'], queryFn: getCaReport });
  const cols: ReportCol<CaReportRow>[] = [
    { key: 'no', label: "No.", kind: 'number' },
    { key: 'subsidiary', label: "Subsidiary" },
    { key: 'caName', label: "Credit Agreement Name", min: 150,
      render: (r) => <span className="font-medium text-gray-800">{r.caName}</span> },
    { key: 'caNumber', label: "Credit Agreement Number" },
    { key: 'maName', label: "Master Agreement Name", min: 130 },
    { key: 'fiType', label: "Finance Institution Type" },
    { key: 'fiName', label: "Finance Institution Name" },
    { key: 'facilityType', label: "Facility Type" },
    { key: 'purpose', label: "Purpose", min: 140 },
    { key: 'creditType', label: "Credit Type" },
    { key: 'startDate', label: "Start Date", kind: 'date' },
    { key: 'endDate', label: "End Date", kind: 'date' },
    { key: 'status', label: "Status", render: (r) => <Badge variant={r.status === 'Approved' ? 'success' : 'default'}>{r.status}</Badge> },
    { key: 'interestType', label: "Interest Type" },
    { key: 'interestRate', label: "Interest Rate (%)", kind: 'percent' },
    { key: 'creditLineForeign', label: "Credit Line (Currency)", kind: 'money' },
    { key: 'currency', label: "Currency" },
    { key: 'fxRate', label: "Conversion Rate", kind: 'number' },
    { key: 'creditLine', label: "Credit Line", kind: 'money' },
    { key: 'utilization', label: "Line Utilization", kind: 'money' },
    { key: 'remaining', label: "Remaining Credit Line", kind: 'money' },
  ];
  return (
    <StandardReport
      title="Credit Agreement Report"
      description="วงเงินสินเชื่อทุกประเภท พร้อมเงื่อนไขดอกเบี้ยและยอดใช้วงเงิน"
      columns={cols} rows={data} isLoading={isLoading} unit="วงเงิน"
      searchKeys={['caName', 'caNumber', 'maName', 'fiName', 'purpose']}
      filters={[
        { key: 'subsidiary', label: "Subsidiary" },
        { key: 'fiType', label: "Finance Institution Type" },
        { key: 'facilityType', label: "Facility Type" },
        { key: 'creditType', label: "Credit Type" },
        { key: 'status', label: "Status" },
        { key: 'startDate', label: "Report Period", kind: 'dateRange' },
      ]}
    />
  );
}

function StdTxReport() {
  const { data = [], isLoading } = useQuery({ queryKey: ['std-tx'], queryFn: getTxReport });
  const cols: ReportCol<TxReportRow>[] = [
    { key: 'no', label: "No.", kind: 'number' },
    { key: 'subsidiary', label: "Subsidiary" },
    { key: 'txName', label: "Transaction Name", min: 150,
      render: (r) => <span className="font-medium text-gray-800">{r.txName}</span> },
    { key: 'txNumber', label: "Transaction Number" },
    { key: 'caName', label: "Credit Agreement Name", min: 130 },
    { key: 'fiType', label: "Finance Institution Type" },
    { key: 'fiName', label: "Finance Institution Name" },
    { key: 'facilityType', label: "Facility Type" },
    { key: 'status', label: "Status" },
    { key: 'transactionDate', label: "Transaction Date", kind: 'date' },
    { key: 'maturityDate', label: "Maturity Date", kind: 'date' },
    { key: 'term', label: "Term", kind: 'number' },
    { key: 'termType', label: "Term Type" },
    { key: 'interestType', label: "Interest Type / Fee Type" },
    { key: 'interestRate', label: "Interest Rate / Fee Rate (%)", kind: 'percent' },
    { key: 'amountForeign', label: "Transaction Amount (Currency)", kind: 'money' },
    { key: 'currency', label: "Currency" },
    { key: 'fxRate', label: "Conversion Rate", kind: 'number' },
    { key: 'amount', label: "Transaction Amount", kind: 'money' },
    { key: 'referenceContract', label: "Reference Contract", min: 120 },
    { key: 'chassis', label: "Chassis", min: 160 },
  ];
  return (
    <StandardReport
      title="Credit Transaction Report"
      description="รายการเบิกใช้วงเงินทุกประเภทรวมกัน — ตั๋วสัญญาใช้เงิน · หนังสือค้ำประกัน · เลตเตอร์ออฟเครดิต · สินเชื่อรถ · เงินเบิกเกินบัญชี · ทรัสต์รีซีท · สัญญาซื้อขายเงินตราล่วงหน้า · เงินกู้ · สัญญาเช่า"
      columns={cols} rows={data} isLoading={isLoading}
      searchKeys={['txName', 'txNumber', 'caName', 'fiName', 'chassis', 'referenceContract']}
      filters={[
        { key: 'subsidiary', label: "Subsidiary" },
        { key: 'fiType', label: "Finance Institution Type" },
        { key: 'facilityType', label: "Facility Type" },
        { key: 'txName', label: "Transaction Name", kind: 'text' },
        { key: 'status', label: "Status" },
        { key: 'transactionDate', label: "Report Period", kind: 'dateRange' },
      ]}
    />
  );
}

function StdCarStockReport() {
  const { data = [], isLoading } = useQuery({ queryKey: ['std-car'], queryFn: getCarStockReport });
  const cols: ReportCol<CarStockRow>[] = [
    { key: 'no', label: "No.", kind: 'number' },
    { key: 'subsidiary', label: "Subsidiary" },
    { key: 'chassis', label: "Chassis", min: 160,
      render: (r) => <span className="font-mono">{r.chassis}</span> },
    { key: 'carModel', label: "Car Model", min: 150 },
    { key: 'status', label: "Status",
      render: (r) => <Badge variant={r.status === 'ขายแล้ว' ? 'success' : 'default'}>{r.status}</Badge> },
    { key: 'originalLocation', label: "Original Location", min: 120 },
    { key: 'currentLocation', label: "Current Location", min: 120 },
    { key: 'fpNumber', label: "FP Number", min: 120 },
    { key: 'pnNumber', label: "PN Number", min: 120 },
    { key: 'trNumber', label: "TR Number", min: 120 },
    { key: 'lnNumber', label: "LN Number", min: 120 },
    { key: 'latestNumber', label: "Latest Number", min: 120 },
    { key: 'curtailDays', label: 'Curtailment (Days)', kind: 'number' },
    { key: 'curtailPct', label: 'Curtailment (%)', kind: 'percent' },
    { key: 'curtailAmount', label: 'Curtailment Amount', kind: 'money' },
    { key: 'startDate', label: 'Start Date', kind: 'date' },
    { key: 'dueDate', label: 'Due Date', kind: 'date' },
    { key: 'paidDate', label: 'Paid Date', kind: 'date' },
    { key: 'overdueDays', label: 'Overdue (Days)', kind: 'number',
      render: (r) => {
        const d = r.overdueDays ?? 0;
        if (!r.overdueDays) return <span className="text-gray-400">—</span>;
        const cls = d >= 30 ? 'font-semibold text-red-600' : d >= 15 ? 'font-medium text-amber-600' : 'text-gray-600';
        return <span className={cls}>{d}</span>;
      } },
    { key: 'totalPrincipal', label: 'Total Principal', kind: 'money' },
    { key: 'interestType', label: 'Interest Type' },
    { key: 'interestRate', label: 'Interest Rate (%)', kind: 'percent' },
    { key: 'totalInterest', label: 'Total Interest', kind: 'money' },
    { key: 'remainingInterest', label: 'Remaining Interest', kind: 'money' },
    { key: 'accumInterest', label: 'Accumulated Interest', kind: 'money' },
  ];
  return (
    <StandardReport
      title="Car Stock Movement Report"
      description="รถทุกคันที่ผูกกับวงเงิน — สถานที่จัดเก็บ สัญญาที่เกี่ยวข้อง และสถานะการขาย"
      columns={cols} rows={data} isLoading={isLoading} unit="คัน"
      searchKeys={['chassis', 'carModel', 'fpNumber', 'pnNumber', 'lnNumber', 'currentLocation']}
      filters={[
        { key: 'subsidiary', label: "Subsidiary" },
        { key: 'chassis', label: "Chassis", kind: 'text' },
        { key: 'currentLocation', label: "Current Location" },
        { key: 'status', label: "Status" },
        { key: 'startDate', label: "Report Period", kind: 'dateRange' },
      ]}
    />
  );
}

function StdMaturityReport() {
  const { data = [], isLoading } = useQuery({ queryKey: ['std-maturity'], queryFn: getMaturityReport });
  const cols: ReportCol<MaturityReportRow>[] = [
    { key: 'no', label: "No.", kind: 'number' },
    { key: 'subsidiary', label: "Subsidiary" },
    { key: 'txName', label: "Transaction Name", min: 150,
      render: (r) => <span className="font-medium text-gray-800">{r.txName}</span> },
    { key: 'txNumber', label: "Transaction Number" },
    { key: 'fiType', label: "Finance Institution Type" },
    { key: 'fiName', label: "Finance Institution Name" },
    { key: 'facilityType', label: "Facility Type" },
    { key: 'transactionDate', label: "Transaction Date", kind: 'date' },
    { key: 'maturityDate', label: "Maturity Date", kind: 'date' },
    { key: 'daysToMaturity', label: "Days to Maturity", kind: 'number',
      render: (r) => {
        const d = r.daysToMaturity ?? 0;
        const cls = d < 0 ? 'font-semibold text-red-600' : d <= 30 ? 'font-medium text-amber-600' : 'text-gray-600';
        return <span className={cls}>{d < 0 ? `เลยมา ${Math.abs(d)}` : d}</span>;
      } },
    { key: 'term', label: "Term", kind: 'number' },
    { key: 'termType', label: "Term Type" },
    { key: 'interestType', label: "Interest Type / Fee Type" },
    { key: 'interestRate', label: "Interest Rate / Fee Rate (%)", kind: 'percent' },
    { key: 'amountForeign', label: "Transaction Amount (Currency)", kind: 'money' },
    { key: 'currency', label: "Currency" },
    { key: 'fxRate', label: "Conversion Rate", kind: 'number' },
    { key: 'amount', label: "Transaction Amount", kind: 'money' },
  ];
  return (
    <StandardReport
      title="Maturity Report"
      description="รายการที่ยังไม่ปิด เรียงตามวันครบกำหนดใกล้ที่สุด — เลยกำหนดแสดงสีแดง ใกล้ครบใน 30 วันแสดงสีส้ม"
      columns={cols} rows={data} isLoading={isLoading}
      searchKeys={['txName', 'txNumber', 'fiName']}
      filters={[
        { key: 'subsidiary', label: "Subsidiary" },
        { key: 'fiType', label: "Finance Institution Type" },
        { key: 'facilityType', label: "Facility Type" },
        { key: 'txName', label: "Transaction Name", kind: 'text' },
        { key: 'maturityDate', label: "Maturity Date", kind: 'dateRange' },
      ]}
    />
  );
}

function StdRepaymentReport() {
  const { data = [], isLoading } = useQuery({ queryKey: ['std-repay'], queryFn: getRepaymentReport });
  const cols: ReportCol<RepaymentReportRow>[] = [
    { key: 'no', label: "No.", kind: 'number' },
    { key: 'subsidiary', label: "Subsidiary" },
    { key: 'txName', label: "Transaction Name", min: 150,
      render: (r) => <span className="font-medium text-gray-800">{r.txName}</span> },
    { key: 'txNumber', label: "Transaction Number" },
    { key: 'fiType', label: "Finance Institution Type" },
    { key: 'fiName', label: "Finance Institution Name" },
    { key: 'facilityType', label: "Facility Type" },
    { key: 'maturityDate', label: "Maturity Date", kind: 'date' },
    { key: 'term', label: "Term", kind: 'number' },
    { key: 'termType', label: "Term Type" },
    { key: 'interestRate', label: "Interest Rate (%)", kind: 'percent' },
    { key: 'payDate', label: "Payment Date", kind: 'date' },
    { key: 'paidPrincipal', label: "Paid Principal", kind: 'money' },
    { key: 'paidInterest', label: "Paid Interest", kind: 'money' },
    { key: 'accumPrincipal', label: "Accumulated Principal", kind: 'money' },
    { key: 'accumInterest', label: "Accumulated Interest", kind: 'money' },
    { key: 'status', label: "Status" },
  ];
  return (
    <StandardReport
      title="Repayment Report"
      description="รายการชำระที่บันทึกแล้ว พร้อมยอดสะสมต่อสัญญา (ไม่รวมรายการที่กลับรายการแล้ว)"
      columns={cols} rows={data} isLoading={isLoading}
      searchKeys={['txName', 'txNumber', 'fiName']}
      filters={[
        { key: 'subsidiary', label: "Subsidiary" },
        { key: 'fiType', label: "Finance Institution Type" },
        { key: 'facilityType', label: "Facility Type" },
        { key: 'txName', label: "Transaction Name", kind: 'text' },
        { key: 'payDate', label: "Payment Date", kind: 'dateRange' },
      ]}
    />
  );
}

// คอลัมน์ร่วมของรายงานครบกำหนดชำระ / ค้างชำระ
function paymentCols(overdue: boolean): ReportCol<PaymentDueRow>[] {
  const base: ReportCol<PaymentDueRow>[] = [
    { key: 'no', label: 'No.', kind: 'number' },
    { key: 'subsidiary', label: 'Subsidiary' },
    { key: 'txName', label: 'Transaction Name', min: 150,
      render: (r) => <span className="font-medium text-gray-800">{r.txName}</span> },
    { key: 'txNumber', label: 'Transaction Number' },
    { key: 'fiType', label: 'Finance Institution Type' },
    { key: 'fiName', label: 'Finance Institution Name' },
    { key: 'facilityType', label: 'Facility Type' },
    { key: 'maturityDate', label: 'Maturity Date', kind: 'date' },
    { key: 'term', label: 'Term', kind: 'number' },
    { key: 'termType', label: 'Term Type' },
    { key: 'interestRate', label: 'Interest Rate / Fee Rate (%)', kind: 'percent' },
    { key: 'period', label: 'Period', kind: 'number' },
    { key: 'dueDate', label: 'Due Payment Date', kind: 'date' },
  ];
  if (overdue) {
    base.push({
      key: 'overdueDays', label: 'Overdue (Days)', kind: 'number',
      render: (r) => {
        const cls = r.overdueDays >= 30 ? 'font-semibold text-red-600'
          : r.overdueDays >= 15 ? 'font-medium text-amber-600' : 'text-gray-600';
        return <span className={cls}>{r.overdueDays}</span>;
      },
    });
  }
  base.push(
    { key: 'installmentAmount', label: 'Installment Amount', kind: 'money' },
    { key: 'curtailBalloon', label: 'Curtailment / Balloon', kind: 'money' },
    { key: 'interestFee', label: 'Interest / Fee', kind: 'money' },
    { key: 'totalDue', label: 'Total Amount', kind: 'money' },
  );
  return base;
}

const PAYMENT_FILTERS: ReportFilter<PaymentDueRow>[] = [
  { key: 'subsidiary', label: 'Subsidiary' },
  { key: 'fiType', label: 'Finance Institution Type' },
  { key: 'facilityType', label: 'Facility Type' },
  { key: 'txName', label: 'Transaction Name', kind: 'text' },
];

function StdDueReport() {
  const { data = [], isLoading } = useQuery({ queryKey: ['std-due'], queryFn: getDuePaymentReport });
  return (
    <StandardReport
      title="Due Payment Report"
      description="งวดที่ยังไม่ถึงกำหนดชำระ — ใช้วางแผนเงินสดจ่ายล่วงหน้า"
      columns={paymentCols(false)} rows={data} isLoading={isLoading} unit="งวด"
      searchKeys={['txName', 'txNumber', 'fiName']}
      filters={[...PAYMENT_FILTERS, { key: 'dueDate', label: 'Due Payment Date', kind: 'dateRange' }]}
    />
  );
}

function StdOverdueReport() {
  const { data = [], isLoading } = useQuery({ queryKey: ['std-overdue'], queryFn: getOverduePaymentReport });
  return (
    <StandardReport
      title="Overdue Payment Report"
      description="งวดที่เลยกำหนดแล้วยังไม่ชำระ เรียงค้างนานสุดขึ้นก่อน — เกิน 30 วันแสดงสีแดง"
      columns={paymentCols(true)} rows={data} isLoading={isLoading} unit="งวด"
      searchKeys={['txName', 'txNumber', 'fiName']}
      filters={[...PAYMENT_FILTERS, { key: 'dueDate', label: 'Overdue Payment Date', kind: 'dateRange' }]}
    />
  );
}
