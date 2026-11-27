import { useState } from 'react';
import { Button, Input, NumInput } from '@/components/ui';
import { ThTip } from '@/components/tx/TipHelpers';
import { useReadOnly } from '@/lib/readonly';
import { fmtDateISO, fmtMoney } from '@/lib/format';
import { LookupChassisModal } from '@/components/shared/LookupChassisModal';
import { PORefImport } from '@/components/shared/PORefImport';
import { type ChassisRow } from '@/types/database';
import { type ConflictModule } from '@/lib/chassis-lookup';

/**
 * ตาราง Chassis (lookup-based) — ใช้ร่วมกันทุกโมดูลที่มี grid หลายคัน (FP / PN / Loan)
 *   - module:  ใช้กับ LookupChassisModal (กันผูกรถซ้ำข้ามสัญญา) และหัว modal
 *   - parentId: สัญญาที่เปิดอยู่ (ยกเว้นตัวเองตอนเช็ครถซ้ำ)
 *   - capPct:  เพดานเบิกต่อคัน (%) · FP = ค่าจากสัญญา · Loan/PN = 100 (ปล่อยเต็มราคา)
 * เก็บ/บันทึกข้อมูลเป็นหน้าที่ของแต่ละหน้า — component ทำแค่ render + onChange(ChassisRow[])
 */
export function ChassisSubTab<T extends ChassisRow>({
  chassis,
  onChange,
  module,
  parentId,
  currentBank,
  capPct,
  allowPoImport,
  excludeTable,
  excludeId,
}: {
  chassis: T[];
  onChange: (c: T[]) => void;
  module: ConflictModule;
  parentId?: string;
  currentBank?: string | null;
  capPct: number;
  /** Multi-PO (MoM ข้อ 4): แสดงปุ่มนำเข้าจาก NetSuite แบบเพิ่มต่อ (append) + คอลัมน์ PO · ใช้กับ Loan/PN/FP */
  allowPoImport?: boolean;
  excludeTable?: string;
  excludeId?: string | null;
}) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [poInput, setPoInput] = useState<string | null>(null);
  const ro = useReadOnly();

  // Multi-PO: นำเข้า PO หนึ่งใบ → เพิ่มรถต่อท้าย (ไม่ทับของเดิม) · ติด po_ref ทุกคัน
  const appendFromPO = (po: { po_no: string; chassis: { chassis_no: string; engine_no: string | null; model: string | null; price: number }[] }) => {
    const base = chassis.length;
    const rows = po.chassis.map((c, i) => ({
      id: `po-${Date.now()}-${base + i}`,
      chassis_no: c.chassis_no,
      po_ref: po.po_no,
      engine_no: c.engine_no ?? null,
      model: c.model ?? null,
      receive_date: null,
      amount: Math.round(((c.price ?? 0) * capPct) / 100 * 100) / 100,
      chassis_price: c.price ?? null,
      price_ex_vat: c.price ?? null, // MoM: PO มี VAT แต่ Inventory ไม่มี — ตั้งเป็นไม่รวม VAT ไว้ก่อน ให้กรอก VAT เอง
      vat_amount: null,
      curtail_id: null,
      status: 'In Stock',
      sort_order: base + i,
      original_location: null,
      current_location: null,
      location_modified_at: null,
    } as unknown as T));
    onChange([...chassis, ...rows]);
  };

  const updateAmount = (i: number, v: number) => {
    onChange(chassis.map((c, j) => (j === i ? { ...c, amount: v } : c)));
  };
  // ปิดรถ (ขายและปิดรายการแล้ว) → status 'Returned' = ปลดออกจาก Active (ไม่นับหลักประกัน)
  // กดกลับเป็น In Stock ได้ถ้าเผลอ
  const setStatus = (i: number, status: string) => {
    onChange(chassis.map((c, j) => (j === i ? { ...c, status } : c)));
  };
  // สถานะที่แสดง: Returned = ปิดแล้ว · มี sold_date = ขายแล้ว · อื่นๆ = In Stock
  const chassisState = (c: T): { label: string; cls: string } => {
    if (c.status === 'Returned') return { label: 'ปิดแล้ว (Returned)', cls: 'bg-gray-200 text-gray-700' };
    if (c.sold_date) return { label: 'ขายแล้ว', cls: 'bg-amber-100 text-amber-800' };
    return { label: c.status || 'In Stock', cls: 'bg-emerald-50 text-emerald-700' };
  };
  // MoM ข้อ 4: มูลค่ารถแยก ไม่รวม VAT / VAT (แก้ไขได้) · รวม VAT = ex + vat
  const updateExVat = (i: number, v: number) => {
    onChange(chassis.map((c, j) => (j === i ? { ...c, price_ex_vat: v, chassis_price: v + (c.vat_amount ?? 0) } : c)));
  };
  const updateVat = (i: number, v: number) => {
    onChange(chassis.map((c, j) => (j === i ? { ...c, vat_amount: v, chassis_price: (c.price_ex_vat ?? c.chassis_price ?? 0) + v } : c)));
  };
  // ถามก่อนลบ — เดิมกดปุ่มแล้วรถหายจากตารางทันที กดพลาดแล้วเรียกคืนไม่ได้
  const remove = (i: number) => {
    const c = chassis[i];
    const label = c?.chassis_no?.trim() ? c.chassis_no : '(ยังไม่ระบุเลขตัวถัง)';
    const ok = confirm(
      `เอารถออกจากสัญญานี้?\n\n` +
      `เลขตัวถัง: ${label}\n` +
      `รุ่น: ${c?.model ?? '—'}\n` +
      `ยอดเบิก: ${fmtMoney(c?.amount ?? 0)} บาท\n\n` +
      `การเปลี่ยนแปลงจะมีผลเมื่อกดบันทึกสัญญา`,
    );
    if (ok) onChange(chassis.filter((_, j) => j !== i));
  };

  return (
    <div>
      {/* Multi-PO (MoM ข้อ 4): นำเข้าจาก NetSuite ได้หลายใบ เพิ่มรถต่อท้าย · ย้ายมาอยู่คู่ตาราง Chassis */}
      {allowPoImport && !ro && (
        <div className="mb-4 max-w-md rounded-lg border border-red-200 bg-red-50/40 p-3">
          <PORefImport
            appendMode
            value={poInput}
            onChange={setPoInput}
            onImport={appendFromPO}
            excludeTable={excludeTable}
            excludeId={excludeId}
            existingChassisCount={chassis.length}
          />
        </div>
      )}

      <div className="mb-3 flex justify-between items-center">
        <p className="text-[11px] text-muted italic">
          Chassis ดึงจาก NetSuite Inventory · 1 Chassis ผูกได้ 1 Active contract เท่านั้น ·
          เบิกได้ไม่เกิน <strong>{capPct}%</strong> ของราคารถ ต่อคัน
        </p>
        {!ro && (
          <Button variant="primary" onClick={() => setLookupOpen(true)}>
            Lookup Chassis
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <ThTip>CHASSIS NO. *</ThTip>
              {/* Multi-PO: รถแต่ละคันมาจาก PO ใบไหน (MoM ข้อ 4) — เฉพาะ module ที่มี PO */}
              {allowPoImport && (
                <ThTip tip="เลข PO ที่รถคันนี้ถูกนำเข้ามา (ว่าง = เพิ่มเอง/ไม่ผ่าน PO)"><span className="text-red-600">PO REF</span></ThTip>
              )}
              <ThTip tip="เลข Invoice จาก NetSuite ที่รถคันนี้ถูกรับเข้ามา (ติดมากับรถตอน Lookup Inventory)"><span className="text-red-600">INVOICE</span></ThTip>
              <ThTip tipKey="ENGINE NO.">ENGINE NO.</ThTip>
              <ThTip tipKey="CAR MODEL">CAR MODEL</ThTip>
              {/* MoM ข้อ 4: แยกมูลค่ารถ ไม่รวม VAT / VAT / รวม VAT (แก้ไขได้) + % ค้ำ + มูลค่าหลังหัก % */}
              <ThTip align="right" tip="ราคารถไม่รวม VAT (แก้ไขได้)"><span className="text-red-600">ราคาไม่รวม VAT</span></ThTip>
              <ThTip align="right" tip="VAT (แก้ไขได้) · ดึงจาก Inventory อาจไม่มี VAT ต้องกรอกเอง"><span className="text-red-600">VAT</span></ThTip>
              <ThTip align="right" tip="รวม VAT = ไม่รวม VAT + VAT (คำนวณให้)"><span className="text-red-600">รวม VAT</span></ThTip>
              <ThTip align="right" tip="เพดาน % ที่ใช้ค้ำต่อคัน">% ค้ำ</ThTip>
              <ThTip align="right" tip="มูลค่าที่ใช้ค้ำจริง = รวม VAT × % ค้ำ"><span className="text-red-600">มูลค่าหลังหัก %</span></ThTip>
              <ThTip align="right">เบิก (Amount)</ThTip>
              {/* LOCATION columns ซ่อนไว้ — ข้อมูลตำแหน่งรถเป็นของ NetSuite Inventory ไม่จำเป็นในโมดูล Floor Plan
              <ThTip tipKey="ORIGINAL LOCATION">ORIGINAL LOCATION</ThTip>
              <ThTip tipKey="CURRENT LOCATION">CURRENT LOCATION</ThTip>
              <ThTip tipKey="LOCATION LAST MODIFIED">LOCATION LAST MODIFIED</ThTip>
              */}
              <ThTip tip="วันที่รถถูกขาย (สัญญาณจาก NetSuite หรือกรอกเอง) — บันทึกแล้วระบบแจ้งเตือนให้ปิดสัญญา + ขึ้น Pending Chassis Movement Report">SOLD DATE</ThTip>
              <ThTip tip="In Stock = ยังเป็นหลักประกัน · ขายแล้ว = มี Sold Date ยังไม่ปิด · ปิดแล้ว (Returned) = ปลดออกจาก Active ไม่นับหลักประกัน"><span className="text-red-600">STATUS</span></ThTip>
              <ThTip>ACTION</ThTip>
            </tr>
          </thead>
          <tbody>
            {chassis.length === 0 && (
              <tr>
                <td colSpan={allowPoImport ? 14 : 13} className="text-center text-muted py-6">
                  ยังไม่มี Chassis — กด <strong>Lookup Chassis</strong> เพื่อเลือกจาก NetSuite Inventory
                </td>
              </tr>
            )}
            {chassis.map((c, i) => {
              const exVat = c.price_ex_vat ?? c.chassis_price ?? c.amount ?? 0;
              const vat = c.vat_amount ?? 0;
              const incVat = exVat + vat;            // รวม VAT = ไม่รวม VAT + VAT
              const cap = (incVat * capPct) / 100;   // มูลค่าหลังหัก % · ฐาน = รวม VAT (MoM: เบิก 80% ของรวม VAT)
              const overCap = incVat > 0 && (c.amount ?? 0) > cap + 0.005;
              return (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.chassis_no}</td>
                {allowPoImport && <td className="font-mono text-xs text-red-600">{c.po_ref ?? '—'}</td>}
                <td className="font-mono text-xs text-red-600">{c.invoice ?? '—'}</td>
                <td className="font-mono text-xs">{c.engine_no ?? '—'}</td>
                <td>{c.model ?? '—'}</td>
                {/* MoM ข้อ 4: ไม่รวม VAT / VAT (แก้ไขได้) · รวม VAT · % ค้ำ · มูลค่าหลังหัก % */}
                <td className="text-right">
                  {/* ครอบ div กำหนดความกว้าง — Input(MUI) มี width:100% ใน sx ที่ทับ Tailwind w-* */}
                  <div className="w-40 ml-auto"><NumInput step="0.01" value={c.price_ex_vat ?? c.chassis_price ?? 0} onChange={(v) => updateExVat(i, v)} className="text-right tabular-nums" /></div>
                </td>
                <td className="text-right">
                  <div className="w-32 ml-auto"><NumInput step="0.01" value={c.vat_amount ?? 0} onChange={(v) => updateVat(i, v)} className="text-right tabular-nums" /></div>
                </td>
                <td className="text-right tabular-nums text-xs font-medium">{incVat > 0 ? fmtMoney(incVat) : '—'}</td>
                <td className="text-right tabular-nums text-xs">{capPct}%</td>
                <td className="text-right tabular-nums text-xs text-red-600">{incVat > 0 ? fmtMoney(cap) : '—'}</td>
                <td>
                  <div className="w-40 ml-auto" title={incVat > 0 ? `max ${fmtMoney(cap)} (${capPct}% × ${fmtMoney(incVat)})` : ''}>
                    <NumInput
                      step="0.01"
                      value={c.amount ?? 0}
                      onChange={(v) => updateAmount(i, v)}
                      className={`text-right tabular-nums ${overCap ? 'border-red-400 bg-red-50' : ''}`}
                    />
                  </div>
                  {overCap && (
                    <p className="text-[10px] text-red-600 mt-0.5">
                      ⚠ เกิน {capPct}% cap — ลดเหลือ ≤ {fmtMoney(cap)}
                    </p>
                  )}
                </td>
                {/* LOCATION columns ซ่อนไว้ — ข้อมูลตำแหน่งรถเป็นของ NetSuite Inventory
                <td className="text-muted">{c.original_location ?? '—'}</td>
                <td className="text-muted">{c.current_location ?? '—'}</td>
                <td className="text-xs">{c.location_modified_at ? fmtDate(c.location_modified_at) : '—'}</td>
                */}
                <td>
                  {/* FR-FP-022 — รถขายแล้ว → แจ้งเตือนปิดสัญญา + Chassis Movement Report */}
                  <Input
                    type="date"
                    value={c.sold_date ?? ''}
                    onChange={(e) =>
                      onChange(chassis.map((x, j) => (j === i
                        ? { ...x, sold_date: e.target.value || null, sold_source: e.target.value ? (x.sold_source ?? 'manual') : null }
                        : x)))
                    }
                    className="text-xs w-[130px]"
                  />
                  {c.sold_date && c.status !== 'Returned' && (
                    <p className="text-[10px] text-amber-600 mt-0.5">ขายแล้ว — ต้องปิดสัญญา</p>
                  )}
                </td>
                {/* STATUS chip — In Stock / ขายแล้ว / ปิดแล้ว (Returned) */}
                <td>
                  {(() => { const st = chassisState(c); return (
                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                  ); })()}
                </td>
                <td>
                  <div className="flex flex-col gap-1 items-start">
                    {/* ปิดรถ → Returned: กดได้เมื่อมี sold_date และยังไม่ปิด */}
                    {c.sold_date && c.status !== 'Returned' && !ro && (
                      <button
                        type="button"
                        onClick={() => setStatus(i, 'Returned')}
                        className="text-emerald-700 hover:underline text-xs font-medium"
                        title="ปลดรถออกจาก Active — ไม่นับเป็นหลักประกันอีก"
                      >
                        ปิดรถ (Returned)
                      </button>
                    )}
                    {c.status === 'Returned' && !ro && (
                      <button
                        type="button"
                        onClick={() => setStatus(i, 'In Stock')}
                        className="text-muted hover:underline text-[11px]"
                        title="ยกเลิกการปิด — กลับมาเป็นหลักประกัน"
                      >
                        ↩ ยกเลิกปิด
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      disabled={ro}
                      className="text-danger hover:underline text-xs disabled:text-muted disabled:no-underline disabled:cursor-not-allowed"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <LookupChassisModal
        open={lookupOpen}
        onClose={() => setLookupOpen(false)}
        multi
        excludeModule={module}
        excludeContractId={parentId}
        excludeChassisNos={chassis.map((c) => c.chassis_no)}
        currentBank={currentBank}
        onSelect={(picked) => {
          const today = fmtDateISO(new Date());
          const rows = picked.map((c) => ({
            id: crypto.randomUUID(),
            chassis_no: c.chassis_no,
            po_ref: null,   // รถจาก Inventory ไม่มีเลข PO (PO อยู่บนเอกสาร PO) — po_ref เติมเฉพาะตอน Import ตาม PO
            invoice: c.invoice ?? null,   // เลข Invoice ติดมากับรถจาก NetSuite Inventory
            engine_no: c.engine_no,
            model: c.car_model,
            receive_date: today,
            // default draw = cap% × ราคารถ · ผู้ใช้ปรับได้ (Loan/PN cap=100 → เบิกเต็มราคา)
            amount: parseFloat((c.cost * (capPct / 100)).toFixed(2)),
            // Snapshot ราคารถตอน Lookup — ใช้เป็นฐาน cap (ภายหลัง cost master เปลี่ยน ก็ไม่กระทบสัญญาเก่า)
            chassis_price: c.cost,
            curtail_id: null,
            status: 'In Stock',
            sort_order: 0,
            original_location: c.location,
            current_location: c.location,
            location_modified_at: today,
          })) as unknown as T[];
          onChange([...chassis, ...rows]);
        }}
        title={`Lookup Chassis (NetSuite Inventory) — ${module}`}
      />
    </div>
  );
}
