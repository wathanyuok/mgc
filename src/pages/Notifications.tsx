import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Card, CardContent, Badge } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { getAllNotifications, type NotiItem, type NotiSeverity } from '@/lib/notifications';

const SEV: Record<NotiSeverity, { label: string; variant: any; note: (d: number) => string }> = {
  overdue: { label: 'เกินกำหนด', variant: 'danger', note: (d) => `เกินกำหนด ${Math.abs(d)} วัน` },
  soon: { label: 'ใกล้ครบ (≤7 วัน)', variant: 'warn', note: (d) => `อีก ${d} วัน` },
  upcoming: { label: 'กำลังจะถึง (≤30 วัน)', variant: 'brand', note: (d) => `อีก ${d} วัน` },
};

export function Notifications() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getAllNotifications(30),
  });

  const groups: NotiSeverity[] = ['overdue', 'soon', 'upcoming'];

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <Bell className="w-6 h-6 text-brand" />
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-muted text-sm">แจ้งเตือนล่วงหน้าก่อนครบกำหนด / หมดอายุ — ทุกผลิตภัณฑ์ (PN · LG/BG · Floor Plan · O/D · T/R · FX · Loan · Lease)</p>
        </div>
      </div>

      {isLoading ? (
        <div className="p-6 text-muted text-sm">กำลังโหลด...</div>
      ) : data.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted">
          <div className="text-4xl mb-2">✅</div>
          <p>ไม่มีรายการใกล้ครบกำหนดภายใน 30 วัน</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const items = data.filter((i) => i.severity === g);
            if (items.length === 0) return null;
            return (
              <div key={g}>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={SEV[g].variant}>{SEV[g].label}</Badge>
                  <span className="text-sm text-muted">{items.length} รายการ</span>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>ประเภท</th>
                          <th>สัญญา</th>
                          <th>วันครบกำหนด</th>
                          <th className="text-right">คงเหลือ</th>
                          <th className="w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((i: NotiItem) => (
                          <tr key={i.key} className="hover:bg-gray-50">
                            <td><Badge variant="default">{i.kind}</Badge></td>
                            <td className="font-medium">{i.ref}</td>
                            <td>{fmtDate(i.dueDate)}</td>
                            <td className={`text-right tabular-nums ${i.severity === 'overdue' ? 'text-danger font-semibold' : ''}`}>
                              {i.note ?? SEV[i.severity].note(i.days)}
                            </td>
                            <td className="text-right">
                              <Link to={i.route} className="text-brand hover:underline text-xs">เปิด →</Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 bg-brand-light border-l-4 border-brand p-3 text-xs text-ink rounded">
        💡 รายการคำนวณสด ๆ จากวันครบกำหนด/หมดอายุของแต่ละสัญญา (window 30 วัน) · ตาม MoM Day1 §5.3 — แจ้งล่วงหน้าเพื่อเตรียม Rollover / ชำระคืน / ต่ออายุ
        <br />ส่วนการเตือนหลักประกัน (รอบประเมิน/มูลค่าลด) และช่องทาง Email/Report อยู่ระหว่างรอ MGC สรุป (MoM ค้างไว้)
      </div>
    </div>
  );
}
