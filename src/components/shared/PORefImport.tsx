// Auto Gen PO — ช่อง PO Ref (NetSuite) + ปุ่ม "นำเข้าจาก NetSuite" (BRD FR-FP-020/021)
// ใช้ร่วม 3 หน้า: PN / FP / Loan · ดึงผ่าน stub lib/netsuite-po (สลับ API จริงตอน SIT)
import { useState } from 'react';
import { toast } from 'sonner';
import { CloudDownload, Loader2, Check } from 'lucide-react';
import { FieldLabel } from '@/components/ui';
import { fetchNetSuitePO, assertPORefUnique, type NetSuitePO } from '@/lib/netsuite-po';
import { cn } from '@/lib/cn';

export function PORefImport({
  value,
  onChange,
  onImport,
  excludeTable,
  excludeId,
  disabled,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  /** เรียกเมื่อดึง PO สำเร็จ — หน้าแม่เอาข้อมูลไป auto-fill ฟอร์มตาม shape ของตัวเอง */
  onImport: (po: NetSuitePO) => void;
  excludeTable?: string;
  excludeId?: string | null;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [imported, setImported] = useState<NetSuitePO | null>(null);

  const doImport = async () => {
    const poNo = (value ?? '').trim();
    if (!poNo) { toast.error('พิมพ์เลข PO ก่อน เช่น PO-2026-45678'); return; }
    setLoading(true);
    try {
      await assertPORefUnique(poNo, excludeTable, excludeId); // BR-PN-024
      const po = await fetchNetSuitePO(poNo);
      onImport(po);
      setImported(po);
      toast.success(`✓ นำเข้า ${po.po_no} — ${po.vendor} · ${po.chassis.length} คัน · ${po.amount.toLocaleString()} บาท`);
    } catch (e: any) {
      toast.error(e.message); // A1 404 / A2 5xx → user คีย์เองต่อได้
    } finally {
      setLoading(false);
    }
  };

  const locked = disabled || loading;

  return (
    <div>
      <FieldLabel tip="เลข Purchase Order จาก NetSuite — กดนำเข้าเพื่อดึง vendor · chassis · ยอด มาเติมฟอร์มอัตโนมัติ (คีย์เองต่อได้ทุกช่อง)">
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
        <input
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
          onClick={doImport}
          disabled={locked}
          title="ดึงข้อมูล vendor · เลขตัวถัง · ยอดเงิน จาก NetSuite มาเติมให้อัตโนมัติ"
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
          <span className="tabular-nums">{imported.amount.toLocaleString()} บาท</span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-gray-400">
          เว้นว่าง = คีย์ข้อมูลเองตามปกติ · PO 1 เลขใช้สร้างได้ 1 รายการ
        </p>
      )}
    </div>
  );
}
