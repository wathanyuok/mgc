-- ============================================================
-- Clear JE ของใบตัดชำระ — ให้กลับไปเหมือน "ไม่เคยกด Create Journal"
--
--   ลบ JE ทิ้งจริงใน DB + ปลดใบตัดชำระกลับเป็น Draft + ล้างธงงวดที่ชำระ
--   หลังรันเสร็จ → เปิดใบนั้นในหน้า Repayment แล้วกด Create Journal ใหม่ได้เลย
--   (โค้ด payoff ที่แก้แล้วจะปิดสัญญา Closed ให้อัตโนมัติถ้าจ่ายครบ)
--
--   เปลี่ยน 'RP00036' เป็นเลขใบที่ต้องการ
--
--   สิ่งที่ทำ:
--     1) ล้างธง paid / paid_date / paid_amount / repayment_id ในตารางงวด
--        (เฉพาะงวดที่ "ใบนี้" ตัด — ไม่แตะงวดของใบอื่น)  → ยอดคงค้างกลับมา
--     2) ใบตัดชำระ → Draft + je_id = null
--     3) ลบ je_lines + journal_entries ของใบนี้ (เฉพาะใบ Posted) ทิ้งจริง
--
--   ไม่แตะสถานะสัญญา — ถ้าสัญญาเคยถูกปิดจากใบนี้ การกด Create Journal ใหม่
--   จะเช็คปิดให้เองอีกครั้ง
-- ============================================================

do $$
declare
  v_rid  uuid;
  v_jeid uuid;
begin
  select id into v_rid from repayments where repayment_no = 'RP00036';
  if v_rid is null then
    raise exception 'ไม่พบใบตัดชำระ RP00036';
  end if;

  -- JE (Posted) ของใบตัดชำระนี้
  select id into v_jeid
    from journal_entries
   where source_type = 'REPAYMENT' and source_id = v_rid and status = 'Posted'
   limit 1;

  -- 1) ปลดธง "จ่ายแล้ว" ของงวดที่ใบนี้ตัด
  update installment_schedules
     set paid = false, paid_date = null, paid_amount = 0, repayment_id = null
   where repayment_id = v_rid;

  -- 2) ใบตัดชำระกลับเป็น Draft + ล้าง je_id
  update repayments set status = 'Draft', je_id = null where id = v_rid;

  -- 3) ลบ JE ทิ้งจริง (บรรทัด + หัวใบ)
  if v_jeid is not null then
    delete from je_lines where je_id = v_jeid;
    delete from journal_entries where id = v_jeid;
    raise notice 'ลบ JE % แล้ว · ใบ % กลับเป็น Draft', v_jeid, 'RP00036';
  else
    raise notice 'ไม่พบ JE Posted ของ RP00036 — ปลดใบเป็น Draft ให้แล้ว';
  end if;
end $$;

-- ตรวจผล
select repayment_no, status, je_id from repayments where repayment_no = 'RP00036';
