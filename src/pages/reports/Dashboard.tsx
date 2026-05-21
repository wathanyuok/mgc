import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { LayoutDashboard, TrendingUp, Wallet, AlertTriangle, CalendarClock } from 'lucide-react';
import { Card, CardContent, Badge } from '@/components/ui';
import { fmtMoney } from '@/lib/format';
import { getPortfolioSummary, getCreditUtilization, getMaturityWithin } from '@/lib/reports';

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

export function Dashboard() {
  const { data: portfolio = [] } = useQuery({ queryKey: ['rep-portfolio'], queryFn: getPortfolioSummary });
  const { data: util } = useQuery({ queryKey: ['rep-util'], queryFn: getCreditUtilization });
  const { data: maturities = [] } = useQuery({ queryKey: ['rep-maturity'], queryFn: () => getMaturityWithin(365) });

  const totalOutstanding = portfolio.reduce((s, p) => s + p.outstanding, 0);
  const totalContracts = portfolio.reduce((s, p) => s + p.count, 0);
  const utilPct = util && util.totalLine > 0 ? (util.totalUsed / util.totalLine) * 100 : 0;
  const overdue = maturities.filter((m) => m.bucket === 'overdue');
  const soon = maturities.filter((m) => m.days >= 0 && m.days <= 30);

  const barData = portfolio.filter((p) => p.outstanding > 0).map((p) => ({ name: p.label, outstanding: p.outstanding, color: p.color }));
  const pieData = barData.map((p) => ({ name: p.name, value: p.outstanding, color: p.color }));

  const buckets = [
    { name: 'เกินกำหนด', key: 'overdue', color: '#dc2626' },
    { name: '≤30 วัน', key: '30', color: '#ea580c' },
    { name: '≤90 วัน', key: '90', color: '#ca8a04' },
    { name: '≤180 วัน', key: '180', color: '#2563eb' },
    { name: '≤1 ปี', key: '365', color: '#0d9488' },
  ].map((b) => ({ name: b.name, count: maturities.filter((m) => m.bucket === b.key).length, color: b.color }));

  return (
    <div className="max-w-[1300px] mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <LayoutDashboard className="w-6 h-6 text-brand" />
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted text-sm">ภาพรวมพอร์ตสินเชื่อ · วงเงิน · รายการใกล้ครบกำหนด</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <KpiCard icon={<Wallet className="w-5 h-5" />} label="ยอดคงค้างรวม" value={`฿${compact(totalOutstanding)}`} sub={`${totalContracts} สัญญา`} tone="brand" />
        <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="วงเงินรวม" value={`฿${compact(util?.totalLine ?? 0)}`} sub={`ใช้ไป ฿${compact(util?.totalUsed ?? 0)}`} tone="violet" />
        <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="Utilization" value={`${utilPct.toFixed(1)}%`} sub={`คงเหลือ ฿${compact((util?.totalLine ?? 0) - (util?.totalUsed ?? 0))}`} tone="green" />
        <KpiCard icon={<CalendarClock className="w-5 h-5" />} label="ครบกำหนด ≤30 วัน" value={String(soon.length)} sub="รายการ" tone="orange" />
        <KpiCard icon={<AlertTriangle className="w-5 h-5" />} label="เกินกำหนด" value={String(overdue.length)} sub="รายการ" tone="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-2">
          <CardContent>
            <h3 className="font-semibold text-sm mb-3">ยอดคงค้างแยกตามผลิตภัณฑ์</h3>
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
            <h3 className="font-semibold text-sm mb-3">สัดส่วนพอร์ต</h3>
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
            <h3 className="font-semibold text-sm mb-3">ภาระครบกำหนดภายใน 1 ปี</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={buckets} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={72} />
                <RTooltip />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {buckets.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <h3 className="font-semibold text-sm">วงเงินที่ใช้สูงสุด (Top Utilization)</h3>
              <Link to="/reports" className="text-brand text-xs hover:underline">ดูรายงานทั้งหมด →</Link>
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Credit Agreement</th>
                  <th className="text-right">วงเงิน</th>
                  <th className="text-right">ใช้ไป</th>
                  <th className="w-40">Utilization</th>
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
