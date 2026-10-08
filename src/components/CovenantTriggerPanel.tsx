// Covenant Trigger panel — ใช้ร่วมกันในแท็บ Condition ของ CA (M1) และ MA (M0)
// ตาม MoM 30 ก.ย. 2026 (เช้า): ดึงอัตราส่วนจริงจาก NetSuite มาเทียบเกณฑ์ D/E, DSCR → Breach
//
// ⚠ การเชื่อม NetSuite ยังเป็น MOCK — ติดป้าย "รอ Reconfirm" จนกว่า API จริงจะพร้อม
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  evalCovenant,
  fetchRatiosFromNetSuite,
  type CovenantActuals,
  type CovenantStatus,
} from '@/lib/covenant';

interface Props {
  /** บริษัทที่ใช้เช็กอัตราส่วน (M0 = บริษัท Main · M1 = บริษัทที่เปิด CA) */
  subsidiary: string;
  deOp: string | null;
  deValue: number | null;
  deActual: number | null | undefined;
  dscrOp: string | null;
  dscrValue: number | null;
  dscrActual: number | null | undefined;
  fetchedAt?: string | null;
  source?: string | null;
  readOnly?: boolean;
  onFetched: (a: CovenantActuals) => void;
}

function StatusBadge({ status }: { status: CovenantStatus }) {
  if (status === 'breach')
    return <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-danger">⚠ Breach</span>;
  if (status === 'pass')
    return <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">✓ ผ่าน</span>;
  return <span className="inline-block px-2 py-0.5 rounded text-xs text-muted bg-gray-100">— ยังไม่ดึง</span>;
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function CovenantTriggerPanel(props: Props) {
  const { subsidiary, deOp, deValue, deActual, dscrOp, dscrValue, dscrActual, fetchedAt, source, readOnly, onFetched } = props;
  const [loading, setLoading] = useState(false);

  const deStatus = evalCovenant(deOp, deValue, deActual);
  const dscrStatus = evalCovenant(dscrOp, dscrValue, dscrActual);

  const doFetch = async () => {
    setLoading(true);
    try {
      const a = await fetchRatiosFromNetSuite(subsidiary);
      onFetched(a);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 border border-line rounded-lg p-3 bg-soft/40">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold">
            Covenant Trigger — อัตราส่วนทางการเงิน (NetSuite)
          </div>
          {/* MoM: การเชื่อม NetSuite ยังไม่ได้ทำจริง — เป็นของใหม่ */}
          <div className="text-xs text-danger font-medium">รอ Reconfirm · เชื่อมต่อ NetSuite (ยังเป็นข้อมูลจำลอง)</div>
        </div>
        <Button variant="outline" size="sm" disabled={loading || readOnly} onClick={doFetch}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'กำลังดึง...' : 'ดึงจาก NetSuite'}
        </Button>
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="text-xs text-muted">ความถี่การดึง/ตรวจ (Frequency):</span>
        <span className="text-xs font-medium">รายเดือน (Monthly)</span>
      </div>

      <div className="overflow-x-auto mt-2">
        <table className="table-base text-xs m-0">
          <thead>
            <tr>
              <th>อัตราส่วน</th>
              <th className="text-center">เกณฑ์ (Trigger)</th>
              <th className="text-center">ค่าจริง (NetSuite)</th>
              <th className="text-center">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>D/E Ratio</td>
              <td className="text-center tabular-nums">{deOp ?? '<='} {fmt(deValue)}</td>
              <td className="text-center tabular-nums">{fmt(deActual)}</td>
              <td className="text-center"><StatusBadge status={deStatus} /></td>
            </tr>
            <tr>
              <td>DSCR Ratio</td>
              <td className="text-center tabular-nums">{dscrOp ?? '>='} {fmt(dscrValue)}</td>
              <td className="text-center tabular-nums">{fmt(dscrActual)}</td>
              <td className="text-center"><StatusBadge status={dscrStatus} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {(deStatus === 'breach' || dscrStatus === 'breach') && (
        <div className="text-xs text-danger mt-2">
          ⚠ อัตราส่วนผิดเงื่อนไข (Breach) — จะขึ้นแจ้งเตือนในเมนู Noti (ระดับ M0 และ M1)
        </div>
      )}
    </div>
  );
}
