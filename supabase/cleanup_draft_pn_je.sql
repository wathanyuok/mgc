-- ============================================================
-- Cleanup: ลบ Draft JE ของ Promissory Note ที่ค้างจากการทดสอบ (7 ใบตามหน้าจอ)
-- ล็อก status='Draft' → ไม่แตะ JE ที่ Posted · ลบบรรทัดลูกก่อน แล้วค่อยลบหัว
-- รันซ้ำได้ (ถ้าลบไปแล้วจะไม่เจอ = ไม่ทำอะไร)
-- ============================================================

-- ลบบรรทัด je_lines ของใบเป้าหมายก่อน (กัน FK)
delete from je_lines
 where je_id in (
   select id from journal_entries
    where status = 'Draft'
      and je_number in (
        'JE-2026-00161','JE-2026-00152','JE-2026-00145',
        'JE-2026-00138','JE-2026-00131','JE-2026-00114','JE-2026-00048'
      )
 );

-- ลบหัว JE
delete from journal_entries
 where status = 'Draft'
   and je_number in (
     'JE-2026-00161','JE-2026-00152','JE-2026-00145',
     'JE-2026-00138','JE-2026-00131','JE-2026-00114','JE-2026-00048'
   );

-- ตรวจผล (ควรได้ 0 แถว)
select je_number, status
  from journal_entries
 where je_number in (
   'JE-2026-00161','JE-2026-00152','JE-2026-00145',
   'JE-2026-00138','JE-2026-00131','JE-2026-00114','JE-2026-00048'
 );
