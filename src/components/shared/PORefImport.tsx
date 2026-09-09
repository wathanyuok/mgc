// Auto Gen PO — ช่อง PO Ref (NetSuite) + ปุ่ม "นำเข้าจาก NetSuite" (BRD FR-FP-020/021)
// ใช้ร่วม 3 หน้า: PN / FP / Loan · ดึงผ่าน stub lib/netsuite-po (สลับ API จริงตอน SIT)
//
// Flow: กดปุ่ม → ดึง PO → เปิด "หน้าตรวจก่อนนำเข้า" (preview) ให้ดู vendor · รถ · ยอด ก่อน
//       → user กด "ยืนยันนำเข้า" ค่อย onImport ทับฟอร์ม · กัน PO ผิดคันทับข้อมูลเดิมเงียบๆ
import { useState } from 'react';
import { toast } from 'sonner';
import { CloudDownload, Loader2, Check } from 'lucide-react';
import { FieldLabel, Modal, Button } from '@/components/ui';
import { fetchNetSuitePO, assertPORefUnique, type NetSuitePO } from '@/lib/netsuite-po';
import { cn } from '@/lib/cn';

const fmtNum = (n: number) => n.toLocaleString('en-US');
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function PORefImport({
  value,
  onChange,
  onImport,
  excludeTable,
  excludeId,
  disabled,
  existingChassisCount = 0,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  /** เรียกเมื่อ user "ยืนยันนำเข้า" — หน้าแม่เอาข้อมูลไป auto-fill ฟอร์มตาม shape ของตัวเอง */
  onImport: (po: NetSuitePO) => void;
  excludeTable?: string;
  excludeId?: string | null;
  disabled?: boolean;
  /** จำนวนรถที่มีอยู่แล้วในฟอร์ม — ใช้เตือนใน preview ว่าการนำเข้าจะทับทั้งชุด */
  existingChassisCount?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [imported, setImported] = useState<NetSuitePO | null>(null);
  const [preview, setPreview] = useState<NetSuitePO | null>(null);

  // ขั้นที่ 1 — ดึง PO มาเปิด preview (ยังไม่ทับฟอร์ม)
  const doFetch = async () => {
    const poNo = (value ?? '').trim();
    if (!poNo) { toast.error('พิมพ์เลข PO ก่อน เช่น PO-2026-45678'); return; }
    setLoading(true);
    try {
      await assertPORefUnique(poNo, excludeTable, excludeId); // BR-PN-024
      const po = await fetchNetSuitePO(poNo);
      setPreview(po); // เปิดหน้าตรวจก่อนนำเข้า
    } catch (e: any) {
      toast.error(e.message); // A1 404 / A2 5xx → user คีย์เองต่อได้
    } finally {
      setLoading(false);
    }
  };

  // ขั้นที่ 2 — user ยืนยันแล้วค่อยทับฟอร์ม
  const confirmImport = () => {
    if (!preview) return;
    onImport(preview);
    setImported(preview);
    toast.success(`✓ นำเข้า ${preview.po_no} — ${preview.vendor} · ${preview.chassis.length} คัน · ${fmtNum(preview.amount)} บาท`);
    setPreview(null);
  };

  const locked = disabled || loading;
  const willOverwrite = existingChassisCount > 0;

  return (
    <div>
      <FieldLabel tip="เลข Purchase Order จาก NetSuite — กดนำเข้าเพื่อดึง vendor · chassis · ยอด มาแสดงตรวจก่อน แล้วยืนยันจึงเติมฟอร์ม (คีย์เองต่อได้ทุกช่อง)">
        PO REF (NETSUITE)
      </FieldLabel>

      {/* input + ปุ่ม เชื่อมเป็นกล่องเดียว — กรอบ active ตอน focus · เขียวเมื่อนำเข้าสำเร็จ */}
      <div
        className={cn(
          'flex items-stretch overflow-hidden rounded-lg border bg-white transition',
          disabled && 'opacity-60',
          imported
            ? 'border-emerald-300 ring-4 ring-emerald-500/10'
            : 'border-gray-200 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10',
        )}
      >
        <input maxLength={200}
          value={value ?? ''}
          onChange={(e) => { onChange(e.target.value || null); setImported(null); }}
          placeholder="PO-2026-45678"
          disabled={locked}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
        />

        {imported && (
          <span className="flex items-center pr-2 text-emerald-600">
            <Check size={16} strokeWidth={2.5} />
          </span>
        )}

        <button
          type="button"
          onClick={doFetch}
          disabled={locked}
          title="ดึงข้อมูล vendor · เลขตัวถัง · ยอดเงิน จาก NetSuite มาแสดงตรวจก่อนนำเข้า"
          className={cn(
            'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-l px-3 text-[13px] font-medium transition',
            imported
              ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
              : 'border-gray-200 text-brand hover:bg-brand-light',
            locked && 'cursor-not-allowed opacity-50 hover:bg-transparent',
          )}
        >
          {loading
            ? <><Loader2 size={14} className="animate-spin" /> กำลังดึง...</>
            : <><CloudDownload size={14} /> {imported ? 'ดึงใหม่' : 'นำเข้าจาก NetSuite'}</>}
        </button>
      </div>

      {imported ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-emerald-700">
          <span className="font-medium">นำเข้าแล้ว</span>
          <span className="text-emerald-600/70">·</span>
          <span>{imported.vendor}</span>
          <span className="text-emerald-600/70">·</span>
          <span>{imported.chassis.length} คัน</span>
          <span className="text-emerald-600/70">·</span>
          <span className="tabular-nums">{fmtNum(imported.amount)} บาท</span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-gray-400">
          เว้นว่าง = คีย์ข้อมูลเองตามปกติ · PO 1 เลขใช้สร้างได้ 1 รายการ
        </p>
      )}

      {/* ── หน้าตรวจก่อนนำเข้า (Preview) ── */}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title="ตรวจข้อมูลก่อนนำเข้าจาก NetSuite"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>ยกเลิก</Button>
            <Button variant="primary" onClick={confirmImport}>ยืนยันนำเข้า</Button>
          </>
        }
      >
        {preview && (
          <div className="space-y-3">
            {/* หัวข้อมูล PO */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-[11px] text-gray-400">PO No.</div>
                <div className="font-medium">{preview.po_no}</div>
              </div>
              <div>
                <div className="text-[11px] text-gray-400">Vendor</div>
                <div className="font-medium">{preview.vendor}</div>
              </div>
              <div>
                <div className="text-[11px] text-gray-400">กำหนดส่งมอบ</div>
                <div className="font-medium">{fmtDate(preview.expected_delivery)}</div>
              </div>
              <div>
                <div className="text-[11px] text-gray-400">สกุลเงิน</div>
                <div className="font-medium">{preview.currency}</div>
              </div>
            </div>

            {/* เตือนทับข้อมูลเดิม */}
            {willOverwrite && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                ⚠️ ฟอร์มนี้มีรถอยู่แล้ว {existingChassisCount} คัน — การนำเข้าจะ<b>แทนที่ทั้งชุด</b>ด้วยรถ {preview.chassis.length} คันจากใบสั่งซื้อ และตั้งยอดใหม่ตาม PO
              </div>
            )}

            {/* ตารางรถ */}
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[12px] text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">เลขตัวถัง</th>
                    <th className="px-3 py-2 text-left font-medium">เลขเครื่อง</th>
                    <th className="px-3 py-2 text-left font-medium">รุ่นรถ</th>
                    <th className="px-3 py-2 text-right font-medium">ราคา</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.chassis.map((c, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-1.5 font-mono text-[12.5px]">{c.chassis_no}</td>
                      <td className="px-3 py-1.5 text-[12.5px]">{c.engine_no ?? '—'}</td>
                      <td className="px-3 py-1.5">{c.model ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(c.price)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-3 py-2" colSpan={4}>รวม {preview.chassis.length} คัน</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(preview.amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="text-[11px] text-gray-400">
              * นำเข้าแล้วยังแก้ทุกช่องเองได้ · ระบบจะตรวจรถซ้ำวงเงินตอนบันทึกอีกครั้ง
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
