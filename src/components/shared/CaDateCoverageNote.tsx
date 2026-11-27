import { caDateCoverageWarning, type CaDateItem } from '@/lib/ca-inherit';

/**
 * ข้อความเตือนใต้ช่องเลือกวงเงิน (CA) — โชว์เมื่อ CA ที่เลือกไว้ครอบคลุมวันทำรายการไม่ถึง
 * (เช่น เลือก CA ไว้ก่อน แล้วมาแก้วันที่ทีหลังให้หลุดช่วง · dropdown กรองไม่ทันเพราะเลือกไปแล้ว)
 * ใช้ร่วมทุกโมดูลธุรกรรม:  <CaDateCoverageNote ca={selectedCa} txDate={form.transaction_date} />
 */
export function CaDateCoverageNote({
  ca,
  txDate,
}: {
  ca: CaDateItem | null | undefined;
  txDate: string | null | undefined;
}) {
  const msg = caDateCoverageWarning(ca, txDate);
  if (!msg) return null;
  return <p className="text-[10px] text-red-600 italic mt-0.5">⚠ {msg}</p>;
}
