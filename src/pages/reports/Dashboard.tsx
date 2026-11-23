import { useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { LayoutDashboard, TrendingUp, Wallet, AlertTriangle, CalendarClock, Car, Building2 } from 'lucide-react';
import { Card, CardContent, Badge } from '@/components/ui';
import { fmtMoney, fmtDateISO} from '@/lib/format';
import { getPortfolioSummary, getCreditUtilization, getMaturityWithin, getMaSubAllocations, PRODUCTS, type CAUtilization, type MaSubAllocation } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { useFiltersStore } from '@/stores/useFiltersStore';

const compact = (n: number) =>
  Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);

function KpiCard({ icon, label, value, sub, tone = 'brand' }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string }) {
  const toneMap: Record<string, string> = {
    brand: 'text-brand bg-blue-50', green: 'text-green-600 bg-green-50',
    orange: 'text-orange-600 bg-orange-50', red: 'text-red-600 bg-red-50', violet: 'text-violet-600 bg-violet-50',
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3.5 py-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${toneMap[tone]}`}>{icon}</div>
        <div className="min-w-0">
          <div className="text-xs text-muted font-medium uppercase tracking-wide">{label}</div>
          <div className="text-xl font-bold tabular-nums truncate">{value}</div>
          {sub && <div className="text-xs text-muted">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

const todayStr = () => fmtDateISO(new Date());
const eom = () => {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 0);
  return fmtDateISO(d);
};
const eoq = () => {
  const d = new Date(); const m = d.getMonth();
  d.setMonth(m - (m % 3) + 3, 0);
  return fmtDateISO(d);
};
const eoy = () => `${new Date().getFullYear()}-12-31`;

const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: '30 วัน' },
  { value: 90, label: '90 วัน' },
  { value: 180, label: '180 วัน' },
  { value: 365, label: '1 ปี' },
  { value: 730, label: '2 ปี' },
  { value: 1825, label: '5 ปี' },
];

const fmtThaiDate = (iso: string) => {
  const d = new Date(iso);
  // วัน/เดือน/ปี เลขล้วน ให้ตรงกับทั้งระบบ
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export function Dashboard() {
  const [asOf, setAsOf] = useState(todayStr());
  const [window, setWindow] = useState(365);
  // ตัวกรองประเภทสินเชื่อ — null = ทุกประเภท · กดการ์ดประเภทเพื่อเลือก
  const [productFilter, setProductFilter] = useState<string | null>(null);

  const { data: portfolio = [] } = useQuery({ queryKey: ['rep-portfolio'], queryFn: getPortfolioSummary });
  const { data: util } = useQuery({ queryKey: ['rep-util'], queryFn: getCreditUtilization });
  const { data: maSubAllocs = [] } = useQuery({ queryKey: ['ma-sub-allocs'], queryFn: getMaSubAllocations });
  const { data: maturities = [] } = useQuery({
    queryKey: ['rep-maturity', window, asOf],
    queryFn: () => getMaturityWithin(window, asOf),
  });

  // ประเภทที่เลือกกรอง (ถ้ามี) — ใช้คุม KPI คงค้าง/ครบกำหนด + กราฟ
  const selProd = productFilter ? portfolio.find((p) => p.key === productFilter) : null;
  const selLabel = selProd?.label ?? null;
  const mats = selLabel ? maturities.filter((m) => m.product === selLabel) : maturities;

  const totalOutstanding = selProd ? selProd.outstanding : portfolio.reduce((s, p) => s + p.outstanding, 0);
  const totalContracts = selProd ? selProd.count : portfolio.reduce((s, p) => s + p.count, 0);
  const utilPct = util && util.totalLine > 0 ? (util.totalUsed / util.totalLine) * 100 : 0;
  const overdue = mats.filter((m) => m.bucket === 'overdue');
  const soon = mats.filter((m) => m.days >= 0 && m.days <= 30);

  const barData = portfolio.filter((p) => p.outstanding > 0).map((p) => ({ name: p.label, outstanding: p.outstanding, color: p.color }));
  const pieData = barData.map((p) => ({ name: p.name, value: p.outstanding, color: p.color }));

  // Stacked-bar: maturity buckets × ประเภทสินเชื่อ
  const productLabels = PRODUCTS.map((p) => p.label);
  const productColor: Record<string, string> = Object.fromEntries(PRODUCTS.map((p) => [p.label, p.color]));
  const allBucketDefs = [
    { name: 'เกินกำหนดแล้ว', key: 'overdue', maxDays: 0 },
    { name: 'ใน 30 วัน', key: '30', maxDays: 30 },
    { name: '31–90 วัน', key: '90', maxDays: 90 },
    { name: '91–180 วัน', key: '180', maxDays: 180 },
    { name: '181–365 วัน', key: '365', maxDays: 365 },
  ];
  // Only include buckets relevant to selected window
  const bucketDefs = allBucketDefs.filter((b) => b.maxDays === 0 || b.maxDays <= window);
  const buckets = bucketDefs.map((b) => {
    const items = mats.filter((m) => m.bucket === b.key);
    const row: Record<string, any> = { name: b.name };
    for (const p of productLabels) row[p] = items.filter((i) => i.product === p).length;
    return row;
  });
  // Only show products that have at least 1 item across all buckets
  const activeProducts = productLabels.filter((p) => buckets.some((b) => b[p] > 0));

  const isToday = asOf === todayStr();

  return (
    <div className="max-w-[1300px] mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <LayoutDashboard className="w-6 h-6 text-brand" />
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted text-sm">ภาพรวมพอร์ตสินเชื่อ · วงเงิน · รายการใกล้ครบกำหนด</p>
        </div>
      </div>

      {/* Filter bar */}
      <Card className="mb-4">
        <CardContent className="!py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted text-xs">📅 ข้อมูล ณ วันที่:</span>
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="border border-line rounded px-2 py-1 text-sm"
              />
              <span className="text-xs text-muted">({fmtThaiDate(asOf)})</span>
            </div>
            <div className="flex gap-1.5">
              {[
                { label: 'วันนี้', fn: () => setAsOf(todayStr()) },
                { label: 'สิ้นเดือน', fn: () => setAsOf(eom()) },
                { label: 'สิ้นไตรมาส', fn: () => setAsOf(eoq()) },
                { label: 'สิ้นปี', fn: () => setAsOf(eoy()) },
              ].map((b) => (
                <button
                  key={b.label}
                  onClick={b.fn}
                  className="px-2.5 py-1 text-xs rounded border border-line bg-white hover:bg-soft text-ink"
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-muted text-xs">⏰ ครบกำหนดภายใน:</span>
              <select
                value={window}
                onChange={(e) => setWindow(Number(e.target.value))}
                className="border border-line rounded px-2 py-1 text-sm bg-white"
              >
                {WINDOW_OPTIONS.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </div>
          </div>
          {!isToday && (
            <p className="text-[11px] text-muted mt-2 italic">
              ⓘ ข้อมูล ณ วันอื่นนอกจากวันนี้: ปัจจุบันรองรับเฉพาะ chart ครบกำหนด (Maturity) ส่วน KPI หลักยังแสดงข้อมูล ณ ปัจจุบัน
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="วงเงินรวม" value={`฿${compact(util?.totalLine ?? 0)}`} sub={`ใช้ไป ฿${compact(util?.totalUsed ?? 0)}${productFilter ? ' · ภาพรวมทุกประเภท (วงเงินไม่แยกตามผลิตภัณฑ์)' : ''}`} tone="violet" />
        <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="การใช้วงเงิน" value={`${utilPct.toFixed(1)}%`} sub={`คงเหลือ ฿${compact((util?.totalLine ?? 0) - (util?.totalUsed ?? 0))}${productFilter ? ' · ภาพรวมทุกประเภท' : ''}`} tone="green" />
        <KpiCard icon={<Wallet className="w-5 h-5" />} label="ยอดคงค้างรวม" value={`฿${compact(totalOutstanding)}`} sub={`${totalContracts} สัญญา`} tone="brand" />
        <KpiCard icon={<CalendarClock className="w-5 h-5" />} label="ครบกำหนด ≤30 วัน" value={String(soon.length)} sub="รายการ" tone="orange" />
        <KpiCard icon={<AlertTriangle className="w-5 h-5" />} label="เกินกำหนด" value={String(overdue.length)} sub="รายการ" tone="red" />
      </div>

      {/* ประเภทสินเชื่อครบทุกประเภท — กรองทั้ง Dashboard ด้วย dropdown · การ์ด = แสดงผล */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <span className="text-xs text-muted">ประเภทสินเชื่อ</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted">กรอง:</span>
            <select
              value={productFilter ?? ''}
              onChange={(e) => setProductFilter(e.target.value || null)}
              className={`rounded border px-2 py-1 text-xs outline-none cursor-pointer ${productFilter ? 'border-brand/40 bg-brand-light/40 font-medium text-brand' : 'border-line text-gray-700'}`}
              title="กรองตามประเภทสินเชื่อ"
            >
              <option value="">ทุกประเภทสินเชื่อ</option>
              {portfolio.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {portfolio.map((p) => {
            const sel = productFilter === p.key;
            return (
              <div
                key={p.key}
                className={`rounded-lg border p-2.5 transition ${sel ? 'border-brand ring-2 ring-brand/20 bg-brand-light/30' : productFilter ? 'border-line bg-white opacity-50' : 'border-line bg-white'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                  <span className="text-[11px] font-medium text-gray-700 truncate">{p.label}</span>
                </div>
                <div className="text-sm font-bold tabular-nums mt-0.5">฿{compact(p.outstanding)}</div>
                <div className="text-[10px] text-muted">{p.count} สัญญา</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MoM 30Sep2026 บ.617 — ภาพรวมวงเงิน แยกตาม Bank / MA / CA */}
      <CreditLineOverview rows={util?.rows ?? []} maSubAllocs={maSubAllocs} />

      {/* MoM 30Sep2026 — Foreign Currency Monitor (ฟีเจอร์ใหม่ · รอ Reconfirm) */}
      <ForeignCurrencyMonitor />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-2">
          <CardContent>
            <h3 className="font-semibold text-sm mb-1">ยอดคงค้างแยกตามประเภทสินเชื่อ (THB)</h3>
            <p className="text-[11px] text-muted mb-3">มูลค่าหนี้คงค้างต่อสัญญาที่ยังเปิดอยู่ ในแต่ละประเภทสินเชื่อ (Loan · P/N · LG/BG · L/C · Floor Plan · O/D · T/R · FX Forward · Hire Purchase · Leasing · Leasing Other)</p>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={barData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={48} />
                <RTooltip formatter={(v: any) => `฿${fmtMoney(v)}`} />
                <Bar dataKey="outstanding" radius={[6, 6, 0, 0]}>
                  {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <h3 className="font-semibold text-sm mb-1">สัดส่วนสินเชื่อรวม (%)</h3>
            <p className="text-[11px] text-muted mb-3">เปอร์เซ็นต์ของยอดคงค้างแต่ละประเภทสินเชื่อ เทียบกับยอดสินเชื่อรวมทั้งหมด</p>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={52} outerRadius={84} paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <RTooltip formatter={(v: any) => `฿${fmtMoney(v)}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent>
            <h3 className="font-semibold text-sm mb-1">สัญญาที่จะครบกำหนด — แยกตามช่วงเวลา + ประเภทสินเชื่อ</h3>
            <p className="text-[11px] text-muted mb-3">จำนวนสัญญาใกล้/เลยวันครบกำหนด (Maturity Date) — สีในแต่ละแท่ง = ประเภทสินเชื่อ (P/N · LG/BG · L/C · Floor Plan · O/D · T/R · FX Forward · Loan · Hire Purchase · Leasing · Leasing Other)</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={buckets} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 24 }}>
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  label={{ value: 'จำนวนสัญญา', position: 'insideBottom', offset: -2, style: { fontSize: 11, fill: '#6b7280' } }}
                />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={88} />
                <RTooltip formatter={(v: any, name: any) => [`${v} สัญญา`, name]} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                {activeProducts.map((p, idx) => (
                  <Bar key={p} dataKey={p} stackId="maturity" fill={productColor[p]} radius={idx === activeProducts.length - 1 ? [0, 6, 6, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <h3 className="font-semibold text-sm">CA ที่ใช้วงเงินมากที่สุด (Top 6)</h3>
              <Link to="/reports" className="text-brand text-xs hover:underline">ดูรายงานทั้งหมด →</Link>
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Credit Agreement</th>
                  <th className="text-right">วงเงิน</th>
                  <th className="text-right">ใช้ไป</th>
                  <th className="w-40">การใช้วงเงิน</th>
                </tr>
              </thead>
              <tbody>
                {(util?.rows ?? []).slice(0, 6).map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="font-medium">{r.name}</td>
                    <td className="text-right tabular-nums">{fmtMoney(r.creditLine)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(r.used)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className={`h-full rounded-full ${r.pct >= 90 ? 'bg-red-500' : r.pct >= 70 ? 'bg-orange-500' : 'bg-brand'}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                        </div>
                        <span className="text-xs tabular-nums w-10 text-right">{r.pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {(util?.rows ?? []).length === 0 && (
                  <tr><td colSpan={4} className="text-center text-muted py-6">ยังไม่มีข้อมูลวงเงิน</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {overdue.length > 0 && (
        <div className="mt-2 text-xs text-muted flex items-center gap-1.5">
          <Badge variant="danger">เกินกำหนด {overdue.length}</Badge>
          <Link to="/notifications" className="text-brand hover:underline">ดูใน Notifications →</Link>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ภาพรวมวงเงิน — แยกตาม Bank / MA / CA (MoM 30Sep2026 บ.617)
//   รวมวงเงิน/ใช้ไป/คงเหลือ/%ใช้ ตามกลุ่มที่เลือก · ต่อยอดจาก getCreditUtilization (ราย CA)
// ════════════════════════════════════════════════════════════════════════════
type GroupBy = 'bank' | 'ma' | 'ca' | 'sub';
const GROUP_TABS: { key: GroupBy; label: string }[] = [
  { key: 'bank', label: 'ตาม Bank' },
  { key: 'sub', label: 'ตามบริษัท' },
  { key: 'ma', label: 'ตาม MA (สัญญาหลัก)' },
  { key: 'ca', label: 'ตาม CA (วงเงิน)' },
];

function UtilBar({ line, used }: { line: number; used: number }) {
  const pct = line > 0 ? (used / line) * 100 : 0;
  const over = pct > 100;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full ${over ? 'bg-danger' : 'bg-brand'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${over ? 'text-danger font-semibold' : 'text-muted'}`}>{pct.toFixed(0)}%</span>
    </div>
  );
}

const OVERVIEW_PAGE = 10;

function CreditLineOverview({ rows, maSubAllocs }: { rows: CAUtilization[]; maSubAllocs: MaSubAllocation[] }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('bank');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(OVERVIEW_PAGE);
  // ตัวกรองสถาบันการเงิน — '' = ทุกธนาคาร · เลือกแล้วทั้งการ์ดเหลือเฉพาะธนาคารนั้น
  const [fiFilter, setFiFilter] = useState<string>('');

  const bankOptions = [...new Set(rows.map((r) => r.bank || '—'))].filter((b) => b !== '—').sort();
  const fRows = fiFilter ? rows.filter((r) => (r.bank || '—') === fiFilter) : rows;

  const groups = (() => {
    if (groupBy === 'ca') {
      return fRows.map((r) => ({ key: r.id, label: r.name, line: r.creditLine, used: r.used }));
    }
    const map = new Map<string, { label: string; line: number; used: number; count: number }>();
    for (const r of fRows) {
      const key = groupBy === 'bank' ? (r.bank || '—') : groupBy === 'sub' ? (r.subsidiary || '—') : (r.maId ?? '—');
      const label = groupBy === 'bank' ? (r.bank || '—') : groupBy === 'sub' ? (r.subsidiary || '(ไม่ระบุบริษัท)') : (r.maName || '—');
      const cur = map.get(key) ?? { label, line: 0, used: 0, count: 0 };
      cur.line += r.creditLine;
      cur.used += r.used;
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.entries()].map(([key, v]) => ({ key, ...v }));
  })();

  const sorted = [...groups].sort((a, b) => b.used - a.used);
  const totalLine = sorted.reduce((s, g) => s + g.line, 0);
  const totalUsed = sorted.reduce((s, g) => s + g.used, 0);
  const visible = sorted.slice(0, limit);
  const remaining = sorted.length - visible.length;

  // เจาะดูรายการย่อยของแต่ละกลุ่ม
  //   • ตาม MA (Shared Credit Line · MoM บ.649/683/999): รายบริษัทลูก — วงเงินจัดสรร vs ใช้ไป/คงเหลือ
  //   • ตาม Bank (MoM บ.517/639/667): แต่ละวงเงิน (CA) ภายใต้แบงก์นั้น
  const childRows = (key: string): { label: string; line: number; used: number }[] => {
    if (groupBy === 'ma') {
      const m = new Map<string, { line: number; used: number }>();
      for (const a of maSubAllocs.filter((a) => a.maId === key)) {
        m.set(a.subsidiary, { line: a.creditLine, used: 0 });
      }
      for (const r of fRows.filter((r) => r.maId === key && r.subsidiary)) {
        const cur = m.get(r.subsidiary) ?? { line: 0, used: 0 };
        cur.used += r.used;
        m.set(r.subsidiary, cur);
      }
      return [...m.entries()]
        .map(([sub, v]) => ({ label: sub || '(ไม่ระบุบริษัท)', ...v }))
        .sort((a, b) => b.used - a.used);
    }
    if (groupBy === 'sub') {
      // ตามบริษัท → แต่ละวงเงิน (CA) ของบริษัทนั้น
      return fRows
        .filter((r) => (r.subsidiary || '—') === key)
        .map((r) => ({ label: r.name, line: r.creditLine, used: r.used }))
        .sort((a, b) => b.used - a.used);
    }
    // ตาม Bank → แต่ละวงเงิน CA
    return fRows
      .filter((r) => (r.bank || '—') === key)
      .map((r) => ({ label: r.name, line: r.creditLine, used: r.used }))
      .sort((a, b) => b.used - a.used);
  };

  const canDrill = groupBy === 'ma' || groupBy === 'bank' || groupBy === 'sub';
  const toggle = (key: string) => setExpanded((s) => {
    const n = new Set(s);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  return (
    <Card className="mb-4">
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-sm">ภาพรวมวงเงิน — แยกตาม Bank / MA / CA</h3>
          <div className="flex items-center gap-1.5 flex-wrap">
          {/* ตัวกรองสถาบันการเงิน (คนละหน้าที่กับปุ่มจัดกลุ่ม) — เลือกแล้วทั้งการ์ดเหลือเฉพาะธนาคารนั้น */}
          <span className="text-[11px] text-muted">กรอง:</span>
          <select
            value={fiFilter}
            onChange={(e) => { setFiFilter(e.target.value); setExpanded(new Set()); setLimit(OVERVIEW_PAGE); }}
            className={`rounded border px-2 py-1 text-xs outline-none cursor-pointer ${fiFilter ? 'border-brand/40 bg-brand-light/40 font-medium text-brand' : 'border-line text-gray-700'}`}
            title="กรองตามสถาบันการเงิน"
          >
            <option value="">ทุกสถาบันการเงิน</option>
            {bankOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <span className="mx-1 h-5 w-px bg-line" />
          <span className="text-[11px] text-muted">แยกตาม:</span>
          <div className="inline-flex rounded border border-line overflow-hidden">
            {GROUP_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => { setGroupBy(t.key); setExpanded(new Set()); setLimit(OVERVIEW_PAGE); }}
                className={`px-3 py-1 text-xs ${groupBy === t.key ? 'bg-brand text-white' : 'bg-white text-muted hover:bg-soft'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          </div>
        </div>
        {canDrill && (
          <div className="px-4 py-1.5 text-xs text-muted bg-soft/40 border-b border-line">
            {groupBy === 'ma'
              ? 'คลิกแถว MA เพื่อดูการใช้วงเงินรายบริษัทลูก (Shared Credit Line)'
              : groupBy === 'sub'
                ? 'คลิกแถวบริษัทเพื่อดูแต่ละวงเงิน (CA) ของบริษัทนั้น'
                : 'คลิกแถวธนาคารเพื่อดูแต่ละวงเงิน (CA) ภายใต้ธนาคารนั้น'}
          </div>
        )}
        <table className="table-base">
          <thead>
            <tr>
              <th>{groupBy === 'bank' ? 'สถาบันการเงิน' : groupBy === 'sub' ? 'บริษัท' : groupBy === 'ma' ? 'สัญญาหลัก (MA)' : 'วงเงิน (CA)'}</th>
              <th className="text-right">วงเงินรวม</th>
              <th className="text-right">ใช้ไป</th>
              <th className="text-right">คงเหลือ</th>
              <th className="w-40">การใช้วงเงิน</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-muted py-6 italic">ยังไม่มีข้อมูลวงเงิน</td></tr>
            ) : visible.map((g) => {
              const drillable = canDrill && g.key !== '—';
              const isOpen = expanded.has(g.key);
              const subs = drillable && isOpen ? childRows(g.key) : [];
              return (
                <Fragment key={g.key}>
                  <tr
                    className={`hover:bg-gray-50 ${drillable ? 'cursor-pointer' : ''}`}
                    onClick={drillable ? () => toggle(g.key) : undefined}
                  >
                    <td className="font-medium">
                      {drillable && <span className="inline-block w-4 text-muted">{isOpen ? '▾' : '▸'}</span>}
                      {g.label}
                      {groupBy === 'sub' && 'count' in g && (
                        <span className="ml-1.5 text-xs font-normal text-muted">· {(g as any).count} สัญญา</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{fmtMoney(g.line)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(g.used)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(g.line - g.used)}</td>
                    <td><UtilBar line={g.line} used={g.used} /></td>
                  </tr>
                  {subs.map((s, si) => (
                    <tr key={`${g.key}:${si}:${s.label}`} className="bg-soft/30 text-xs">
                      <td className="pl-10 text-muted">↳ {s.label}</td>
                      <td className="text-right tabular-nums">{fmtMoney(s.line)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(s.used)}</td>
                      <td className="text-right tabular-nums">{fmtMoney(s.line - s.used)}</td>
                      <td><UtilBar line={s.line} used={s.used} /></td>
                    </tr>
                  ))}
                  {drillable && isOpen && subs.length === 0 && (
                    <tr className="bg-soft/30 text-xs">
                      <td colSpan={5} className="pl-10 text-muted italic">
                        {groupBy === 'ma' ? 'ไม่มีบริษัทลูกจัดสรรวงเงินภายใต้สัญญาหลักนี้' : 'ไม่มีวงเงินภายใต้ธนาคารนี้'}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {remaining > 0 && (
              <tr>
                <td colSpan={5} className="text-center py-2">
                  <button
                    onClick={() => setLimit((l) => l + OVERVIEW_PAGE)}
                    className="text-brand text-xs hover:underline"
                  >
                    แสดงเพิ่ม (เหลืออีก {remaining})
                  </button>
                  {limit > OVERVIEW_PAGE && (
                    <button onClick={() => setLimit(OVERVIEW_PAGE)} className="text-muted text-xs hover:underline ml-3">
                      ย่อกลับ
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line font-semibold">
                <td>รวมทั้งหมด</td>
                <td className="text-right tabular-nums">{fmtMoney(totalLine)}</td>
                <td className="text-right tabular-nums">{fmtMoney(totalUsed)}</td>
                <td className="text-right tabular-nums">{fmtMoney(totalLine - totalUsed)}</td>
                <td className="text-right tabular-nums">{totalLine > 0 ? ((totalUsed / totalLine) * 100).toFixed(1) : '0'}%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Foreign Currency Monitor (MoM 30Sep2026 · ฟีเจอร์ใหม่ · รอ Reconfirm)
//   ภาระสกุลต่างประเทศรวม (Loan/LC/TR/LG) เทียบกับ FX Forward ที่ Hedge ไว้
//   + % cover + alert unhedged · + จำนวน FX ที่ยังไม่ผูก LC (ลิงก์ไปดูละเอียด)
// ════════════════════════════════════════════════════════════════════════════
const FC_CLOSED = ['closed', 'cancelled', 'repaid', 'converted', 'settled', 'rejected', 'expired', 'roll over'];
const fcOpen = (s: string | null | undefined) => !FC_CLOSED.includes((s ?? '').trim().toLowerCase());

function ForeignCurrencyMonitor() {
  const setFilter = useFiltersStore((s) => s.set);
  // กด "ดูรายการ" → เปิดหน้า FX Forward พร้อมกรอง Active + ยังไม่ผูก ให้ตรงกับเลขบนการ์ด
  const openUnlinked = () => setFilter('fxf', { statusFilter: 'Active', lcLink: 'unlinked' });
  const { data } = useQuery({
    queryKey: ['fc-monitor'],
    queryFn: async () => {
      const [loans, lcs, trs, lgs, fxf, links, lcRefs] = await Promise.all([
        supabase.from('loans').select('currency, amount_foreign, status'),
        supabase.from('letters_of_credit').select('currency, amount_foreign, status'),
        supabase.from('trust_receipts').select('currency, amount_foreign, status'),
        supabase.from('letters_of_guarantee').select('currency, amount_foreign, status'),
        supabase.from('fx_forwards').select('id, currency, notional_amount_foreign, status'),
        supabase.from('lc_fx_links').select('fxf_id'),
        supabase.from('letters_of_credit').select('reference_fxf_id').not('reference_fxf_id', 'is', null),
      ]);

      // ภาระ (exposure) ต่อสกุล — เฉพาะสกุลต่างประเทศ (ไม่ใช่ THB) และสัญญาที่ยังเปิด
      const exposure = new Map<string, number>();
      const addExp = (rows: any[]) => (rows ?? []).forEach((r) => {
        const ccy = (r.currency ?? '').toUpperCase();
        const amt = Number(r.amount_foreign ?? 0);
        if (!ccy || ccy === 'THB' || amt <= 0 || !fcOpen(r.status)) return;
        exposure.set(ccy, (exposure.get(ccy) ?? 0) + amt);
      });
      addExp(loans.data as any[]); addExp(lcs.data as any[]); addExp(trs.data as any[]); addExp(lgs.data as any[]);

      // Hedge ต่อสกุล — FX Forward ที่ยังมีผล
      const hedged = new Map<string, number>();
      (fxf.data ?? []).forEach((r: any) => {
        const ccy = (r.currency ?? '').toUpperCase();
        const amt = Number(r.notional_amount_foreign ?? 0);
        if (!ccy || ccy === 'THB' || amt <= 0 || !fcOpen(r.status)) return;
        hedged.set(ccy, (hedged.get(ccy) ?? 0) + amt);
      });

      // FX ที่ยังไม่ผูก LC (idle hedge) — Active แต่ไม่โผล่ใน lc_fx_links / reference_fxf_id
      const mapped = new Set<string>();
      (links.data ?? []).forEach((r: any) => r.fxf_id && mapped.add(r.fxf_id));
      (lcRefs.data ?? []).forEach((r: any) => r.reference_fxf_id && mapped.add(r.reference_fxf_id));
      // นับเฉพาะ FX ที่ "Active + ยังไม่ผูก L/C" — ตรงกับที่หน้า List กรอง (status=Active + unlinked)
      // Draft/รออนุมัติ = ยังไม่เสร็จ ไม่นับ · settled/closed = จบแล้ว ไม่นับ
      const unmappedFx = (fxf.data ?? []).filter((r: any) => r.status === 'Active' && !mapped.has(r.id)).length;

      const ccys = Array.from(new Set([...exposure.keys(), ...hedged.keys()])).sort();
      const rows = ccys.map((ccy) => {
        const exp = exposure.get(ccy) ?? 0;
        const hed = hedged.get(ccy) ?? 0;
        const cover = exp > 0 ? (hed / exp) * 100 : (hed > 0 ? 999 : 0);
        const unhedged = Math.max(0, exp - hed);
        return { ccy, exp, hed, cover, unhedged };
      });
      return { rows, unmappedFx };
    },
  });

  const rows = data?.rows ?? [];
  const fmtFc = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  // ซ่อนตารางภาพรวม Exposure/Hedged ไว้ก่อน (ยังเป็นตัวชี้วัดแบบหยาบ · รอ Reconfirm เรื่อง timing/direction)
  //   เหลือโชว์แค่ "FX ยังไม่ผูก L/C" ที่ชัดเจนแล้ว · เปิดกลับเป็น true เมื่อ Confirm ตรรกะ Monitor
  const SHOW_FC_TABLE = false;

  if (!SHOW_FC_TABLE) {
    return (
      <Card className="mb-4 border-2 border-amber-300">
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-amber-600 bg-amber-50">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-muted font-medium uppercase tracking-wide">FX Forward ที่ยังไม่ผูก L/C</div>
                <div className="text-xl font-bold tabular-nums">{data?.unmappedFx ?? 0} <span className="text-sm font-normal text-muted">สัญญา</span></div>
                <div className="text-[11px] text-muted">สัญญา FX ที่เปิดไว้แต่ยังไม่ได้นำไปผูกกับ L/C — ควรตรวจสอบและจับคู่</div>
              </div>
            </div>
            <Link to="/tx/fxf" onClick={openUnlinked} className="text-xs text-brand underline shrink-0">ดูรายการ →</Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4 border-2 border-red-300">
      <CardContent>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> 🔴 Foreign Currency Monitor
            <span className="text-[10px] font-normal bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded">ฟีเจอร์ใหม่ · รอ Reconfirm</span>
          </div>
          <Link to="/tx/fxf" onClick={openUnlinked} className="text-xs text-brand underline">
            FX ยังไม่ผูก L/C: <strong>{data?.unmappedFx ?? 0}</strong> สัญญา →
          </Link>
        </div>
        <p className="text-[11px] text-muted italic mb-3">
          เงินต่างประเทศที่ต้องจ่าย (จาก Loan · L/C · T/R · L/G) เทียบกับที่ซื้อ FX Forward ล็อกเรทไว้แล้ว · แถวสีแดง = ยังมีส่วนที่ไม่ได้ล็อกเรท เสี่ยงขาดทุนค่าเงิน
        </p>
        {rows.length === 0 ? (
          <div className="text-center text-muted text-sm py-4">ไม่มีภาระสกุลต่างประเทศ / FX Forward ที่ยังเปิดอยู่</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead>
                <tr>
                  <th>สกุลเงิน</th>
                  <th className="text-right" title="ยอดเงินต่างประเทศที่ต้องจ่ายจริง รวมจาก Loan/LC/TR/LG">Exposure<br /><span className="font-normal text-[10px] text-muted">(เงินต่างประเทศที่เราต้องจ่ายในอนาคต)</span></th>
                  <th className="text-right" title="ยอดที่ซื้อ FX Forward ล็อกเรทกันความเสี่ยงไว้แล้ว">Hedged<br /><span className="font-normal text-[10px] text-muted">(ล็อกเรทไว้แล้ว)</span></th>
                  <th className="text-right" title="ล็อกเรทไปแล้วกี่ % ของยอดที่ต้องจ่าย">% Cover</th>
                  <th className="text-right" title="ส่วนที่ยังไม่ได้ล็อกเรท ยังเสี่ยงค่าเงิน (Unhedged)">Uncovered</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const danger = r.unhedged > 0.005;
                  return (
                    <tr key={r.ccy} className={danger ? 'bg-red-50' : ''}>
                      <td className="font-semibold">{r.ccy}</td>
                      <td className="text-right tabular-nums">{fmtFc(r.exp)}</td>
                      <td className="text-right tabular-nums">{fmtFc(r.hed)}</td>
                      <td className="text-right tabular-nums font-semibold" style={{ color: r.cover >= 100 ? '#16a34a' : r.cover >= 70 ? '#ca8a04' : '#dc2626' }}>
                        {r.cover >= 999 ? '—' : `${r.cover.toFixed(0)}%`}
                      </td>
                      <td className="text-right tabular-nums text-red-600 font-semibold">{danger ? fmtFc(r.unhedged) : '—'}</td>
                      <td>
                        {danger
                          ? <Badge variant="danger">🔴 ยังเสี่ยง</Badge>
                          : <Badge variant="success">✓ ครบแล้ว</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
