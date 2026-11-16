// ทาสีหัวตารางตอน export Excel ให้เป็นฟ้าอ่อน + ตัวหนา (ใช้ร่วมทุก report)
// ใช้ xlsx-js-style (fork ของ SheetJS ที่เขียน cell style ได้ — ตัวฟรี 'xlsx' เขียน style ไม่ได้)
import * as XLSX from 'xlsx-js-style';

/** สไตล์หัวตาราง — ฟ้าอ่อน (ตรงกับหัวตารางบนจอ) + ตัวหนาน้ำเงินเข้ม + เส้นใต้บาง */
export const HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: 'DDEBF7' } },
  font: { bold: true, color: { rgb: '1F3864' } },
  alignment: { vertical: 'center', wrapText: true },
  border: { bottom: { style: 'thin', color: { rgb: 'B4C6E7' } } },
} as const;

/** ทาสีแถวหัว (default = แถวแรก) ของ worksheet ที่สร้างจาก json_to_sheet/aoa_to_sheet */
export function styleHeaderRow(ws: XLSX.WorkSheet, headerRowIndex = 0): void {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
    const cell = ws[addr];
    if (cell) cell.s = { ...HEADER_STYLE };
  }
}
