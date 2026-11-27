// className กลางสำหรับช่อง "แก้ตารางเอง" ในตารางผ่อน (NumInput ในเซลล์ตาราง)
// ตัวเลขชิดขวาตรงขอบคอลัมน์เหมือนแถวปกติ · ไม่มีกรอบ · hover/focus เป็นพื้นเทาอ่อนบอกว่าแก้ได้
// ใช้ร่วมทุกโมดูล (PN/TR/FP/Loan/OD/LG) ให้ align เหมือนกันหมด
export const SCHED_EDIT_CLS =
  "!w-full [&_.MuiInputBase-input]:!text-right [&_.MuiInputBase-input]:!px-0 [&_.MuiInputBase-input]:!border-0 [&_.MuiInputBase-input]:!bg-transparent [&_.MuiInputBase-input]:!tabular-nums [&_.MuiInputBase-input]:hover:!bg-slate-100 [&_.MuiInputBase-input]:focus:!bg-slate-100 [&_.MuiInputBase-input]:rounded";
