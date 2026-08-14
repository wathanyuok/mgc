// Auto Gen PO — ช่อง PO Ref (NetSuite) + ปุ่ม "นำเข้าจาก NetSuite" (BRD FR-FP-020/021)
// ใช้ร่วม 3 หน้า: PN / FP / Loan · ดึงผ่าน stub lib/netsuite-po (สลับ API จริงตอน SIT)
import { useState } from 'react';
import { toast } from 'sonner';
import { CloudDownload, Loader2 } from 'lucide-react';
import { Button, Input, FieldLabel, Badge } from '@/components/ui';
import { fetchNetSuitePO, assertPORefUnique, type NetSuitePO } from '@/lib/netsuite-po';

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
  const [imported, setImported] = useState(false);

  const doImport = async () => {
    const poNo = (value ?? '').trim();
    if (!poNo) { toast.error('พิมพ์เลข PO ก่อน เช่น PO-2026-45678'); return; }
    setLoading(true);
    try {
      await assertPORefUnique(poNo, excludeTable, excludeId); // BR-PN-024
      const po = await fetchNetSuitePO(poNo);
      onImport(po);
      setImported(true);
      toast.success(`✓ นำเข้า ${po.po_no} — ${po.vendor} · ${po.chassis.length} คัน · ${po.amount.toLocaleString()} บาท`);
    } catch (e: any) {
      toast.error(e.message); // A1 404 / A2 5xx → user คีย์เองต่อได้
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <FieldLabel tip="เลข Purchase Order จาก NetSuite — กดนำเข้าเพื่อดึง vendor · chassis · ยอด มาเติมฟอร์มอัตโนมัติ (คีย์เองต่อได้ทุกช่อง)">PO REF (NETSUITE)</FieldLabel>
        {imported && <Badge variant="brand" className="text-[10px]">สร้างจาก NetSuite PO</Badge>}
      </div>
      <div className="flex gap-2">
        <Input
          value={value ?? ''}
          onChange={(e) => { onChange(e.target.value || null); setImported(false); }}
          placeholder="PO-2026-45678"
          disabled={disabled || loading}
        />
        <Button type="button" variant="outline" onClick={doImport} disabled={disabled || loading} className="whitespace-nowrap">
          {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : <CloudDownload size={14} className="mr-1" />}
          นำเข้าจาก NetSuite
        </Button>
      </div>
      <p className="text-[10px] text-muted mt-0.5 italic">เว้นว่าง = คีย์ข้อมูลเองตามปกติ · PO 1 เลขใช้สร้างได้ 1 รายการ</p>
    </div>
  );
}
