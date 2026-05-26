import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileBarChart } from 'lucide-react';
import { Card, CardContent, Badge } from '@/components/ui';
import { fmtMoney, fmtDate } from '@/lib/format';
import {
  getCreditUtilization, getPortfolioSummary, getInterestSummary,
  getCollateralSummary, getMaturityWithin, getLeaseMovement,
} from '@/lib/reports';

const TABS = [
  { key: 'util', label: 'Credit Utilization' },
  { key: 'movement', label: 'Loan Movement' },
  { key: 'interest', label: 'Interest' },
  { key: 'collateral', label: 'Collateral' },
  { key: 'maturity', label: 'ภาระคืน ≤1 ปี' },
  { key: 'lease', label: 'Lease Movement' },
  { key: 'financial', label: 'Financial Report' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function Reports() {
  const [tab, setTab] = useState<TabKey>('util');
  return (
    <div className="max-w-[1300px] mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <FileBarChart className="w-6 h-6 text-brand" />
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted text-sm">รายงานตาม — Utilization · Movement · Interest · Collateral · ครบกำหนด · Lease (Liability/ROU)</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'util' && <UtilizationReport />}
      {tab === 'movement' && <MovementReport />}
      {tab === 'interest' && <InterestReport />}
      {tab === 'collateral' && <CollateralReport />}
      {tab === 'maturity' && <MaturityReport />}
      {tab === 'lease' && <LeaseReport />}
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
