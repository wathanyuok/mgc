-- ============================================================
-- Cleanup: ลบ Draft JE "ทั้งหมด" (ทุก source_type) ที่ค้างจากการทดสอบ
-- ล็อก status='Draft' → ไม่แตะ JE ที่ Posted เด็ดขาด
-- ลบบรรทัดลูก (je_lines) ก่อน แล้วค่อยลบหัว (journal_entries)
-- รันซ้ำได้ (ถ้าไม่เหลือ Draft = ไม่ทำอะไร)
-- ============================================================

-- ① พรีวิว: มี Draft กี่ใบ แยกตาม source_type
select source_type, count(*) as draft_count
  from journal_entries
 where status = 'Draft'
 group by source_type
 order by source_type;

-- ② ลบบรรทัด je_lines ของ Draft ทั้งหมดก่อน (กัน FK)
delete from je_lines
 where je_id in (select id from journal_entries where status = 'Draft');

-- ③ ลบหัว JE ที่เป็น Draft ทั้งหมด
delete from journal_entries
 where status = 'Draft';

-- ④ ตรวจผล (ควรได้ 0)
select count(*) as remaining_draft
  from journal_entries
 where status = 'Draft';
