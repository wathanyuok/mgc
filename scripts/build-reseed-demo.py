# -*- coding: utf-8 -*-
"""สร้างสคริปต์ล้างข้อมูลเดิม + ใส่ข้อมูลตัวอย่างชุดใหม่ที่สอดคล้องกันทั้งระบบ"""
import io, datetime

L = []
def w(s=''): L.append(s)

def U(pfx, n):            # uuid อ่านออก ใช้อ้างอิงข้ามตารางได้ง่าย
    return f"{pfx:>08s}-0000-4000-8000-{n:012d}".replace(' ', '0')

def addm(y, m, d, n):
    """บวกเดือนแบบทดข้ามปี — กันเดือนที่ 13 14 ที่ฐานข้อมูลไม่รับ"""
    t = (y * 12 + (m - 1)) + n
    return t // 12, t % 12 + 1, min(d, 28)

D = lambda y,m,d: f"'{y:04d}-{m:02d}-{d:02d}'"
Q = lambda s: "'" + str(s).replace("'", "''") + "'"

TODAY = (2026, 8, 27)   # วันที่ใช้อ้างอิงตอนสร้างข้อมูลชุดนี้

def RC(rate, uid):
    """อัตราดอกเบี้ยที่หน้าจอใช้จริง — เก็บเป็นการ์ดอัตรา ไม่ใช่ตัวเลขลอย
       หน้าจอคำนวณตารางดอกเบี้ยจากการ์ดนี้ ถ้าไม่มีการ์ด ตารางจะว่างเปล่า"""
    return Q('[{"id":"%s","type":"Fixed","rate":%s,"condition":0,'
             '"overlimit":0,"start_date":null}]' % (uid, rate))

# ══ ตัวเลขทั้งหมดมาจากตัวคำนวณของระบบ ไม่คำนวณเองซ้ำ ══════════════════
#    สร้างไฟล์ด้วย  npx vitest run scripts/dump-seed-calcs.test.ts
import json
CALC = json.load(io.open('/tmp/seed-calcs.json', encoding='utf-8'))

def D2(iso):
    """แปลง 'YYYY-MM-DD' เป็นทูเพิลปี เดือน วัน"""
    y, m, d = map(int, iso.split('-'))
    return (y, m, d)

def periods(key):
    """งวดดอกเบี้ยของสัญญา — คืนเฉพาะงวดที่ปิดไปแล้วจริง
       (งวดที่ยังไม่สิ้นสุด ยังไม่ควรมีใบสำคัญ)"""
    return [(p['period'], D2(p['start']), D2(p['end']), p['days'], p['interest'])
            for p in CALC[key] if D2(p['end']) <= TODAY]

def sched(key):
    """ตารางผ่อนของสัญญา"""
    return CALC[key]

# ── บัญชีแยกประเภทที่ใช้ (ตรงกับที่โปรแกรมใช้จริง) ───────────────────────
GL = {
 'cash':   ('1001201', 'เงินฝากธนาคาร - กระแสรายวัน'),
 'pn':     ('2142102', 'ตั๋วสัญญาใช้เงิน (P/N) - สถาบันการเงิน'),
 'fp':     ('2142103', 'เงินกู้ยืมระยะสั้น - สินเชื่อรถในสต๊อก'),
 'tr':     ('2142104', 'ทรัสต์รีซีท - สถาบันการเงิน'),
 'od':     ('2142101', 'เงินเบิกเกินบัญชีธนาคาร'),
 'loan':   ('2142105', 'เงินกู้ยืมระยะยาว - สถาบันการเงิน'),
 'accr':   ('2194109', 'ดอกเบี้ยค้างจ่าย-สถาบันการเงิน'),
 'intexp': ('5512103', 'ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น'),
 'fee':    ('5511101', 'ค่าธรรมเนียมธนาคาร'),
 'ob_dr':  ('9911001', 'ภาระผูกพันจากการค้ำประกัน'),
 'ob_cr':  ('9912001', 'ภาระผูกพันจากการค้ำประกัน - คู่สัญญา'),
 'rou':    ('1240101', 'สินทรัพย์สิทธิการใช้'),
 'lliab':  ('2143101', 'หนี้สินตามสัญญาเช่า'),
 'depr':   ('5411101', 'ค่าเสื่อมราคา - สินทรัพย์สิทธิการใช้'),
 'prepay': ('1180101', 'ค่าใช้จ่ายจ่ายล่วงหน้า'),
}

# ═══════════════════════════════════════════════════════════════════════
w("-- ═══════════════════════════════════════════════════════════════════")
w("-- ล้างข้อมูลสัญญาและธุรกรรมเดิม แล้วใส่ข้อมูลตัวอย่างชุดใหม่")
w("-- สร้างเมื่อ 2026-08-27 · ทะเบียนทั้งหมดไม่ถูกแตะ")
w("--")
w("--   เก็บไว้  ผู้ขาย/ธนาคาร · บริษัทในเครือ · ผังบัญชี · ดอกเบี้ย")
w("--            Curtailment · ประเภทวงเงิน · ผู้ใช้ · กลุ่มสิทธิ์")
w("--   ล้าง     สัญญาหลัก · วงเงิน · ธุรกรรมทุกเมนู · ใบสำคัญบัญชี")
w("--            ตัดชำระ · ใบแจ้งยอด · ตารางผ่อน · ทะเบียนรถ")
w("-- ═══════════════════════════════════════════════════════════════════")
w()
w("BEGIN;")
w()
w("-- ── 1 · ล้างข้อมูลเดิม ────────────────────────────────────────────")
w("--")
w("-- ใช้ TRUNCATE ... CASCADE ทีเดียวทั้งชุด แทนการไล่ลบทีละตาราง")
w("-- เพราะเลตเตอร์ออฟเครดิตกับทรัสต์รีซีทอ้างถึงกันไปมา เรียงลำดับลบยังไงก็ติด")
w("-- CASCADE จัดลำดับให้เอง และข้ามตารางที่ยังไม่มีในฐานข้อมูลนี้")
w("--")
w("-- 58 ตารางนี้คือสัญญา ธุรกรรม เอกสารแนบ และผลพลอยได้ทางบัญชีทั้งหมด")
w("-- ทะเบียนไม่อยู่ในรายการนี้ จึงไม่ถูกแตะ")
w("""DO $$
DECLARE
  v_t    TEXT;
  v_list TEXT := '';
BEGIN
  FOREACH v_t IN ARRAY ARRAY[
    'ap_cheque_requests', 'ar_ap_nettings', 'bank_statement_lines',\n    'bank_statements', 'ca_collaterals', 'ca_conditions',\n    'ca_documents', 'ca_guarantors', 'credit_agreements',\n    'fa_transfers', 'facility_adjustments', 'floor_plans',\n    'fp_ap_bills', 'fp_ar_bills', 'fp_chassis',\n    'fp_documents', 'fx_forwards', 'fx_valuations',\n    'fxf_documents', 'fxf_fair_values', 'fxf_fees',\n    'installment_schedules', 'je_lines', 'journal_entries',\n    'lc_documents', 'lease_asset_transfers', 'lease_documents',\n    'lease_schedules', 'lease_versions', 'leases',\n    'letter_guarantees', 'letters_of_credit', 'lg_documents',\n    'lg_fees', 'loan_chassis', 'loan_documents',\n    'loan_prepayments', 'loan_schedules', 'loans',\n    'ma_collaterals', 'ma_conditions', 'ma_documents',\n    'ma_guarantors', 'ma_subsidiaries', 'master_agreements',\n    'netsuite_sync_log', 'od_bank_transactions', 'od_documents',\n    'overdrafts', 'pn_documents', 'promissory_notes',\n    'repayment_lines', 'repayments', 'tr_documents',\n    'tr_imported_goods', 'trust_receipts', 'vehicle_movements',\n    'vehicles'
  ] LOOP
    IF to_regclass('public.' || v_t) IS NOT NULL THEN
      v_list := v_list || CASE WHEN v_list = '' THEN '' ELSE ', ' END || quote_ident(v_t);
    END IF;
  END LOOP;

  IF v_list <> '' THEN
    EXECUTE 'TRUNCATE TABLE ' || v_list || ' CASCADE';
  END IF;
END $$;""")
w()
w("-- ═════════════════════════════════════════════════════════════════")
w("-- 2 · สัญญาหลัก 5 ฉบับ · คละสถานะ")
w("-- ═════════════════════════════════════════════════════════════════")

# ma_no, ชื่อ, ธนาคาร, บริษัท, สถานะ, วงเงิน, เริ่ม, สิ้นสุด
MA = [
 (1,'MGC-KBANK-2026','KBANK','MCR','Approved',        500_000_000,(2026,1,5),(2027,1,4)),
 (2,'MGC-SCB-2026',  'SCB',  'MAG','Approved',        300_000_000,(2026,2,1),(2027,1,31)),
 (3,'MGC-BBL-2026',  'BBL',  'MGC','Approved',        400_000_000,(2026,3,1),(2027,2,28)),
 (4,'MGC-KTB-2026',  'KTB',  'i24','Pending Approval',150_000_000,(2026,6,1),(2027,5,31)),
 (5,'MGC-BAY-2025',  'BAY',  'NEO','Expired',         100_000_000,(2025,7,1),(2026,6,30)),
]
w("INSERT INTO master_agreements")
w("  (id, ma_name, finance_institution, subsidiary, subsidiary_id, status,")
w("   credit_line, utilization, start_date, end_date, remark, created_by, updated_by)")
w("VALUES")
rows=[]
for i,(n,name,fi,sub,st,cl,sd,ed) in enumerate(MA):
    util = {1:180_000_000, 2:95_000_000, 3:120_000_000}.get(n, 0)
    rows.append(f"  ('{U('a1',n)}', {Q(name)}, {Q(fi)}, {Q(sub)},"
                f" (SELECT id FROM subsidiaries WHERE code={Q(sub)}), {Q(st)},"
                f" {cl}, {util}, {D(*sd)}, {D(*ed)},"
                f" {Q('ข้อมูลตัวอย่างสำหรับทดสอบระบบ')}, 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()
w("-- วงเงินรายบริษัทในเครือ")
w("INSERT INTO ma_subsidiaries (id, ma_id, subsidiary, credit_line, utilization, sort_order) VALUES")
rows=[]; k=0
SUBS = {1:[('MCR',300_000_000,120_000_000),('MAG',200_000_000,60_000_000)],
        2:[('MAG',300_000_000,95_000_000)],
        3:[('MGC',250_000_000,80_000_000),('i24',150_000_000,40_000_000)],
        4:[('i24',150_000_000,0)],
        5:[('NEO',100_000_000,0)]}
for man, lst in SUBS.items():
    for j,(sc,cl,ut) in enumerate(lst):
        k+=1
        rows.append(f"  ('{U('a2',k)}', '{U('a1',man)}', {Q(sc)}, {cl}, {ut}, {j})")
w(",\n".join(rows) + ";")
w()
w("-- เงื่อนไขทางการเงินของสัญญาหลัก")
w("INSERT INTO ma_conditions (id, ma_id, de_value, de_op, dscr_value, dscr_op) VALUES")
w(",\n".join(f"  ('{U('a3',n)}', '{U('a1',n)}', 2.50, '<=', 1.20, '>=')" for n,*_ in MA) + ";")
w()
w("-- ผู้ค้ำประกัน")
w("INSERT INTO ma_guarantors (id, ma_id, type, name, company_name, id_card_or_tax_id, amount, sort_order) VALUES")
w(",\n".join(
  f"  ('{U('a4',n)}', '{U('a1',n)}', 'นิติบุคคลค้ำประกัน', NULL, "
  f"{Q('บริษัท มิลเลนเนียม กรุ๊ป คอร์ปอเรชั่น (เอเชีย) จำกัด (มหาชน)')}, '0107548000234', {cl}, 0)"
  for n,name,fi,sub,st,cl,sd,ed in MA) + ";")
w()

w("-- ═════════════════════════════════════════════════════════════════")
w("-- 3 · วงเงิน — 1 วงเงินต่อ 1 ประเภท เพื่อให้ทุกเมนูธุรกรรมมีวงเงินให้เลือก")
w("-- ═════════════════════════════════════════════════════════════════")
# n, เลขที่, ชื่อ, ประเภท, MA, ธนาคาร, บริษัท, สถานะ, วงเงิน, ใช้ไป, สกุล, เริ่ม, สิ้นสุด
CA = [
 (1,'CA-2026-PN-01','วงเงินตั๋วสัญญาใช้เงิน','PN',   1,'KBANK','MCR','Approved',150_000_000, 48_000_000,'THB',(2026,1,5),(2027,1,4)),
 (2,'CA-2026-FP-01','วงเงินสินเชื่อรถในสต๊อก','FP',  1,'KBANK','MCR','Approved',200_000_000, 72_000_000,'THB',(2026,1,5),(2027,1,4)),
 (3,'CA-2026-LG-01','วงเงินหนังสือค้ำประกัน','LG',   1,'KBANK','MAG','Approved', 50_000_000, 14_500_000,'THB',(2026,1,5),(2027,1,4)),
 (4,'CA-2026-OD-01','วงเงินเบิกเกินบัญชี','OD',      2,'SCB',  'MAG','Approved', 30_000_000,  9_800_000,'THB',(2026,2,1),(2027,1,31)),
 (5,'CA-2026-TR-01','วงเงินทรัสต์รีซีท','TR',        2,'SCB',  'MAG','Approved', 80_000_000, 26_000_000,'THB',(2026,2,1),(2027,1,31)),
 (6,'CA-2026-LC-01','วงเงินเลตเตอร์ออฟเครดิต','LC',  2,'SCB',  'MAG','Approved', 80_000_000, 22_400_000,'USD',(2026,2,1),(2027,1,31)),
 (7,'CA-2026-FX-01','วงเงินซื้อขายเงินตราล่วงหน้า','FXF',3,'BBL','MGC','Approved',60_000_000, 18_000_000,'USD',(2026,3,1),(2027,2,28)),
 (8,'CA-2026-LN-01','วงเงินเงินกู้ระยะยาว','LOAN',   3,'BBL',  'MGC','Approved',120_000_000, 55_000_000,'THB',(2026,3,1),(2029,2,28)),
 (9,'CA-2026-HP-01','วงเงินเช่าซื้อ','HP',           3,'BBL',  'i24','Approved', 90_000_000, 31_500_000,'THB',(2026,3,1),(2029,2,28)),
 (10,'CA-2026-LS-01','วงเงินสัญญาเช่า','LEASE',      3,'BBL',  'i24','Approved', 70_000_000, 24_000_000,'THB',(2026,3,1),(2029,2,28)),
]
w("INSERT INTO credit_agreements")
w("  (id, ca_name, contract_number, ma_id, facility_type_id, finance_institution,")
w("   subsidiary, status, credit_line, utilization, currency, credit_type,")
w("   start_date, end_date, remark, created_by, updated_by)")
w("VALUES")
rows=[]
for n,cno,nm,ft,man,fi,sub,st,cl,ut,cur,sd,ed in CA:
    ctype = 'Non Revolving' if ft in ('LOAN','HP','LEASE') else 'Revolving'
    rows.append(f"  ('{U('b1',n)}', {Q(nm)}, {Q(cno)}, '{U('a1',man)}',"
                f" (SELECT id FROM facility_types WHERE code={Q(ft)}), {Q(fi)},"
                f" {Q(sub)}, {Q(st)}, {cl}, {ut}, {Q(cur)}, {Q(ctype)},"
                f" {D(*sd)}, {D(*ed)}, {Q('ข้อมูลตัวอย่างสำหรับทดสอบระบบ')}, 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()
w("INSERT INTO ca_conditions (id, ca_id, de_value, de_op, dscr_value, dscr_op) VALUES")
w(",\n".join(f"  ('{U('b2',n)}', '{U('b1',n)}', 2.50, '<=', 1.20, '>=')" for n,*_ in CA) + ";")
w()

def ca(n): return f"'{U('b1',n)}'"

w("-- ═════════════════════════════════════════════════════════════════")
w("-- 4 · ธุรกรรม — เมนูละ 5 รายการ คละสถานะ")
w("-- ═════════════════════════════════════════════════════════════════")
w()

# ── ตั๋วสัญญาใช้เงิน ────────────────────────────────────────────────────
w("-- ตั๋วสัญญาใช้เงิน (Promissory Note)")
PN = [
 (1,'PN-2026-001','Draft',            12_000_000,(2026,7,1),  60,6.25,None),
 (2,'PN-2026-002','Pending Approval', 15_000_000,(2026,7,15), 90,6.25,None),
 (3,'PN-2026-003','Approved',         10_000_000,(2026,8,1),  60,6.50,None),
 (4,'PN-2026-004','Active',           18_000_000,(2026,6,1), 120,6.50,'P112245001'),
 (5,'PN-2026-005','Repaid',            5_000_000,(2026,4,1),  90,6.00,'P112245002'),
]
w("INSERT INTO promissory_notes")
w("  (id, name, pn_number, ca_id, facility_type_id, finance_institution, transaction_date,")
w("   maturity_date, term_days, amount, currency, effective_rate, rate_cards, status,")
w("   rpt, remark, created_by, updated_by)")
w("VALUES")
rows=[]
for n,no,st,amt,td,term,rate,bref in PN:
    mat = (datetime.date(*td) + datetime.timedelta(days=term))
    rows.append(f"  ('{U('c1',n)}', {Q(no)}, {Q(no)}, {ca(1)},"
                f" (SELECT id FROM facility_types WHERE code='PN'), 'KBANK', {D(*td)},"
                f" '{mat}', {term}, {amt}, 'THB', {rate}, {RC(rate, U('c1',n))}, {Q(st)},"
                f" 'External', NULL, 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()

# ── หนังสือค้ำประกัน ────────────────────────────────────────────────────
w("-- หนังสือค้ำประกัน (LG / BG)")
LG = [
 (1,'LG-2026-001','Draft',            2_000_000,(2026,7,1),(2027,6,30),'B/G','กรมสรรพากร'),
 (2,'LG-2026-002','Pending Approval', 3_500_000,(2026,7,10),(2027,7,9),'B/G','การไฟฟ้านครหลวง'),
 (3,'LG-2026-003','Approved',         4_000_000,(2026,8,1),(2027,7,31),'L/G','บริษัท ปตท. น้ำมันและการค้าปลีก จำกัด (มหาชน)'),
 (4,'LG-2026-004','Active',           5_000_000,(2026,5,1),(2027,4,30),'B/G','กรมศุลกากร'),
 (5,'LG-2025-009','Expired',          1_500_000,(2025,6,1),(2026,5,31),'SBLC','Bank of China (Hong Kong)'),
]
w("INSERT INTO letter_guarantees")
w("  (id, lg_no, ca_id, finance_institution, lg_type, beneficiary, issue_date, expiry_date,")
w("   amount, currency, fee_amount, rate_cards, status, rpt, created_by, updated_by)")
w("VALUES")
w(",\n".join(
  f"  ('{U('c2',n)}', {Q(no)}, {ca(3)}, 'KBANK', {Q(ty)}, {Q(ben)}, {D(*iss)}, {D(*exp)},"
  f" {amt}, 'THB', {round(amt*0.015,2)}, {RC(1.50, U('c2',n))}, {Q(st)}, 'External', 'admin', 'admin')"
  for n,no,st,amt,iss,exp,ty,ben in LG) + ";")
w()
w("-- ค่าธรรมเนียมค้ำประกันของฉบับที่ใช้งานอยู่")
w("INSERT INTO lg_fees (id, lg_id, fee_date, amount, paid, sort_order) VALUES")
w(",\n".join(f"  ('{U('c3',i+1)}', '{U('c2',4)}', {D(*addm(2026,5,1,i*3))}, 18750,"
             f" {'true' if i==0 else 'false'}, {i})" for i in range(4)) + ";")
w()
# ── เลตเตอร์ออฟเครดิต ──────────────────────────────────────────────────
w("-- เลตเตอร์ออฟเครดิต (Letter of Credit)")
LC = [
 (1,'LC-2026-001','Draft',           200_000,(2026,7,5),(2026,10,5),'LC'),
 (2,'LC-2026-002','Pending Approval',350_000,(2026,7,20),(2026,10,20),'LC'),
 (3,'LC-2026-003','Approved',        180_000,(2026,8,5),(2026,11,5),'LC'),
 (4,'LC-2026-004','Active',          420_000,(2026,6,10),(2026,9,10),'LC'),
 (5,'LC-2026-005','Converted',       250_000,(2026,4,1),(2026,7,1),'SBLC'),
]
w("INSERT INTO letters_of_credit")
w("  (id, lc_no, ca_id, finance_institution, lc_type, applicant, beneficiary, issue_date,")
w("   expiry_date, currency, amount_foreign, amount, fee_mode, fee_rate,")
w("   fee_amount, rate_cards, status, rpt, created_by, updated_by)")
w("VALUES")
rows=[]
for n,no,st,famt,iss,exp,ty in LC:
    rate=35.20; thb=round(famt*rate,2); fee=round(thb*0.0025,2)
    rows.append(f"  ('{U('c4',n)}', {Q(no)}, {ca(6)}, 'SCB', {Q(ty)},"
                f" {Q('บริษัท มิลเลนเนียม ออโต้ กรุ๊ป จำกัด')}, {Q('Bayerische Motoren Werke AG')},"
                f" {D(*iss)}, {D(*exp)}, 'USD', {famt}, {thb},"
                f" 'full_term', 0.25, {fee}, {RC(0.25, U('c4',n))}, {Q(st)}, 'External', 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()

# ── สินเชื่อรถในสต๊อก ──────────────────────────────────────────────────
w("-- สินเชื่อรถในสต๊อก (Floor Plan)")
FP = [
 (1,'FP-2026-001','Draft',            8_000_000,(2026,7,1)),
 (2,'FP-2026-002','Pending Approval',12_000_000,(2026,7,15)),
 (3,'FP-2026-003','Approved',        15_000_000,(2026,8,1)),
 (4,'FP-2026-004','Active',          22_000_000,(2026,5,1)),
 (5,'FP-2026-005','Repaid',           6_000_000,(2026,3,1)),
]
w("INSERT INTO floor_plans")
w("  (id, fp_no, ca_id, finance_institution, vendor, transaction_date, start_date, end_date,")
w("   total_amount, used_amount, amount, currency, cap_pct, schedule_mode,")
w("   rate_cards, status, rpt, created_by, updated_by)")
w("VALUES")
rows=[]
for n,no,st,amt,sd in FP:
    ed = datetime.date(*sd) + datetime.timedelta(days=180)
    used = amt if st in ('Active','Repaid') else 0
    rows.append(f"  ('{U('c5',n)}', {Q(no)}, {ca(2)}, 'KBANK',"
                f" {Q('BMW (Thailand) Co., Ltd.')}, {D(*sd)}, {D(*sd)}, '{ed}',"
                f" {amt}, {used}, {amt}, 'THB', 80.00, 'bmw', {RC(5.75, U('c5',n))},"
                f" {Q(st)}, 'External', 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()
w("-- ทะเบียนรถของสินเชื่อรถในสต๊อก")
CH = [('WBA5R1C50KAJ00101','BMW 320d M Sport',2_800_000),
      ('WBA5R1C50KAJ00102','BMW 520d Luxury',3_600_000),
      ('WBA5R1C50KAJ00103','BMW X3 xDrive20d',3_900_000),
      ('WBA5R1C50KAJ00104','BMW X5 xDrive45e',5_800_000),
      ('WBA5R1C50KAJ00105','BMW 730Ld',5_900_000)]
w("INSERT INTO vehicles (id, chassis_no, car_model, brand, subsidiary, status, cost, receive_date) VALUES")
w(",\n".join(f"  ('{U('dc',i+1)}', {Q(c)}, {Q(m)}, 'BMW', 'MCR', 'Open', {p}, {D(2026,5,1)})"
             for i,(c,m,p) in enumerate(CH)) + ";")
w()
w("INSERT INTO fp_chassis (id, fp_id, chassis_no, model, amount, status, sort_order) VALUES")
w(",\n".join(f"  ('{U('c6',i+1)}', '{U('c5',4)}', {Q(c)}, {Q(m)}, {p}, 'In Stock', {i})"
             for i,(c,m,p) in enumerate(CH)) + ";")
w()

# ── เบิกเกินบัญชี ──────────────────────────────────────────────────────
w("-- เบิกเกินบัญชี (Overdraft)")
OD = [
 (1,'OD-2026-001','Draft',            5_000_000,(2026,7,1)),
 (2,'OD-2026-002','Pending Approval', 8_000_000,(2026,7,10)),
 (3,'OD-2026-003','Approved',         6_000_000,(2026,8,1)),
 (4,'OD-2026-004','Active',          10_000_000,(2026,4,1)),
 (5,'OD-2025-012','Closed',           4_000_000,(2025,9,1)),
]
w("INSERT INTO overdrafts")
w("  (id, od_no, ca_id, finance_institution, account_no, start_date, end_date,")
w("   facility_limit, used_amount, amount, currency, effective_rate, rate_cards, status, rpt,")
w("   created_by, updated_by)")
w("VALUES")
rows=[]
for n,no,st,lim,sd in OD:
    ed = datetime.date(*sd) + datetime.timedelta(days=365)
    used = 3_400_000 if st=='Active' else 0
    rows.append(f"  ('{U('c7',n)}', {Q(no)}, {ca(4)}, 'SCB', '181-3-11063-0', {D(*sd)}, '{ed}',"
                f" {lim}, {used}, {lim}, 'THB', 7.25, {RC(7.25, U('c7',n))}, {Q(st)}, 'External', 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()
w("-- ยอดคงเหลือรายวันของบัญชีเบิกเกินบัญชีที่ใช้งานอยู่")
w("INSERT INTO od_bank_transactions (id, od_id, tx_date, ending_balance, source) VALUES")
w(",\n".join(f"  ('{U('c8',i+1)}', '{U('c7',4)}', {D(2026,8,20+i)}, {-b}, 'Manual')"
             for i,b in enumerate([3_100_000,3_250_000,3_400_000,3_400_000,3_380_000])) + ";")
w()

# ── ทรัสต์รีซีท ────────────────────────────────────────────────────────
w("-- ทรัสต์รีซีท (Trust Receipt)")
TR = [
 (1,'TR-2026-001','Draft',            4_000_000,(2026,7,1),  90),
 (2,'TR-2026-002','Pending Approval', 6_500_000,(2026,7,20), 90),
 (3,'TR-2026-003','Approved',         5_000_000,(2026,8,1), 120),
 (4,'TR-2026-004','Active',           9_000_000,(2026,6,1), 120),
 (5,'TR-2026-005','Repaid',           3_500_000,(2026,3,1),  90),
]
w("INSERT INTO trust_receipts")
w("  (id, tr_no, ca_id, source_lc_id, finance_institution, transaction_date, due_date,")
w("   amount, currency, effective_rate, rate_cards, status, rpt, created_by, updated_by)")
w("VALUES")
rows=[]
for n,no,st,amt,td,term in TR:
    due = datetime.date(*td) + datetime.timedelta(days=term)
    src = f"'{U('c4',5)}'" if n==4 else 'NULL'
    rows.append(f"  ('{U('c9',n)}', {Q(no)}, {ca(5)}, {src}, 'SCB', {D(*td)}, '{due}',"
                f" {amt}, 'THB', 6.75, {RC(6.75, U('c9',n))}, {Q(st)}, 'External', 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()
w("INSERT INTO tr_imported_goods (id, tr_id, reference_no, description, amount_foreign, sort_order) VALUES")
w(",\n".join(f"  ('{U('ca',i+1)}', '{U('c9',4)}', {Q(f'INV-2026-{i+1:03d}')},"
             f" {Q('อะไหล่และอุปกรณ์ยานยนต์นำเข้า')}, {60000+i*15000}, {i})" for i in range(3)) + ";")
w()
# ── สัญญาซื้อขายเงินตราต่างประเทศล่วงหน้า ────────────────────────────────
w("-- สัญญาซื้อขายเงินตราต่างประเทศล่วงหน้า (FX Forward Rate)")
FX = [
 (1,'FXF-2026-001','Draft',            200_000,(2026,7,1),(2026,10,1),35.10),
 (2,'FXF-2026-002','Pending Approval', 300_000,(2026,7,15),(2026,10,15),35.25),
 (3,'FXF-2026-003','Approved',         250_000,(2026,8,1),(2026,11,2),35.40),
 (4,'FXF-2026-004','Active',           500_000,(2026,6,1),(2026,9,1),34.95),
 (5,'FXF-2026-005','Settled',          150_000,(2026,3,2),(2026,6,1),34.60),
]
w("INSERT INTO fx_forwards")
w("  (id, fxf_no, ca_id, finance_institution, deal_date, value_date, direction,")
w("   ccy_buy, ccy_sell, amount_buy, amount_sell, forward_rate, currency, status, rpt,")
w("   created_by, updated_by)")
w("VALUES")
rows=[]
for n,no,st,amt,dd,vd,rate in FX:
    rows.append(f"  ('{U('d1',n)}', {Q(no)}, {ca(7)}, 'BBL', {D(*dd)}, {D(*vd)}, 'Buy',"
                f" 'USD', 'THB', {amt}, {round(amt*rate,2)}, {rate}, 'USD', {Q(st)},"
                f" 'External', 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()
w("INSERT INTO fxf_fees (id, fxf_id, gl_date, spot_fee, cancellation_amendment_fee) VALUES")
w(f"  ('{U('d2',1)}', '{U('d1',4)}', {D(2026,6,1)}, 12500, 0),")
w(f"  ('{U('d2',2)}', '{U('d1',5)}', {D(2026,3,2)}, 6800, 0);")
w()

# ── เงินกู้ ────────────────────────────────────────────────────────────
w("-- เงินกู้ (Loan)")
LN = [
 (1,'LN-2026-001','Draft',            10_000_000,(2026,7,1), 36,5.50),
 (2,'LN-2026-002','Pending Approval', 15_000_000,(2026,7,15),48,5.75),
 (3,'LN-2026-003','Approved',         12_000_000,(2026,8,1), 36,5.60),
 (4,'LN-2026-004','Active',           20_000_000,(2026,3,1), 60,5.25),
 (5,'LN-2025-008','Closed',            8_000_000,(2025,4,1), 24,6.00),
]
w("INSERT INTO loans")
w("  (id, loan_no, ca_id, finance_institution, transaction_date, start_date, principal,")
w("   amount, annual_rate, term_months, payment_freq, payment_type, payment_timing,")
w("   grace_months, currency, rate_cards, status, bank_ref, rpt, created_by, updated_by)")
w("VALUES")
rows=[]
for n,no,st,amt,sd,term,rate in LN:
    rows.append(f"  ('{U('d3',n)}', {Q(no)}, {ca(8)}, 'BBL', {D(*sd)}, {D(*sd)}, {amt},"
                f" {amt}, {rate}, {term}, 'monthly', 'Fix Installment', 'arrears',"
                f" 0, 'THB', {RC(rate, U('d3',n))}, {Q(st)}, {Q('0110800' + str(7000+n))}, 'External', 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()

w("-- ตารางผ่อนของเงินกู้ที่ใช้งานอยู่")
w("INSERT INTO loan_schedules (id, loan_id, period, due_date, begin_balance, payment, interest, principal, end_balance, paid) VALUES")
rows=[]
for i,r in enumerate(sched('LN_004')):
    paid = 'true' if r['period'] <= 5 else 'false'
    rows.append(f"  ('{U('d4',i+1)}', '{U('d3',4)}', {r['period']}, {D(*D2(r['due']))},"
                f" {r['begin']}, {r['payment']}, {r['interest']}, {r['principal']}, {r['end']}, {paid})")
w(",\n".join(rows) + ";")
w()

# ── สัญญาเช่า 3 ชนิด ───────────────────────────────────────────────────
w("-- สัญญาเช่า — เช่าซื้อ (Hire Purchase)")
HP = [
 (1,'HP-2026-001','Draft',            3_000_000,(2026,7,1), 48,4.75),
 (2,'HP-2026-002','Pending Approval', 4_500_000,(2026,7,15),60,4.85),
 (3,'HP-2026-003','Approved',         3_800_000,(2026,8,1), 48,4.75),
 (4,'HP-2026-004','Active',           6_200_000,(2026,3,1), 60,4.50),
 (5,'HP-2025-011','Closed',           2_500_000,(2025,2,1), 36,5.00),
]
w("-- สัญญาเช่า — ให้เช่าดำเนินงาน (Leasing)")
LS = [
 (1,'LS-2026-001','Draft',            2_400_000,(2026,7,1), 36,4.25),
 (2,'LS-2026-002','Pending Approval', 3_600_000,(2026,7,20),48,4.35),
 (3,'LS-2026-003','Approved',         2_800_000,(2026,8,1), 36,4.25),
 (4,'LS-2026-004','Active',           5_400_000,(2026,4,1), 60,4.10),
 (5,'LS-2025-006','Closed',           1_800_000,(2025,5,1), 24,4.50),
]
w("-- สัญญาเช่า — ไม่ใช้สินเชื่อ (Leasing Other) · ไม่มีวงเงินตามข้อบังคับของระบบ")
LO = [
 (1,'LO-2026-001','Draft',              960_000,(2026,7,1), 24,0.00),
 (2,'LO-2026-002','Pending Approval', 1_440_000,(2026,7,15),36,0.00),
 (3,'LO-2026-003','Approved',         1_200_000,(2026,8,1), 24,0.00),
 (4,'LO-2026-004','Active',           2_160_000,(2026,2,1), 36,0.00),
 (5,'LO-2025-004','Closed',             720_000,(2025,3,1), 12,0.00),
]
w("INSERT INTO leases")
w("  (id, lease_no, ca_id, mode, asset_type, asset_name, contract_number, contract_date,")
w("   start_date, end_date, principal, annual_rate, term_months, payment_frequency,")
w("   payment_type, payment_timing, classification, vat_rate, use_bank_loan, status,")
w("   rpt, created_by, updated_by)")
w("VALUES")
rows=[]
for grp,(pfx,mode,caid,asset,aname,uid) in {
  'HP':(('HP','hp',9,'ยานพาหนะ','รถยนต์นั่งส่วนบุคคล BMW Series 5','e1')),
  'LS':(('LS','lease',10,'ยานพาหนะ','รถยนต์เพื่อการพาณิชย์ Toyota Hiace','e2')),
  'LO':(('LO','other',None,'อสังหาริมทรัพย์','พื้นที่สำนักงานและโชว์รูม','e3')),
}.items():
    data = {'HP':HP,'LS':LS,'LO':LO}[grp]
    for n,no,st,amt,sd,term,rate in data:
        ey, em, ed_ = addm(sd[0], sd[1], sd[2], term); ed = datetime.date(ey, em, ed_)
        cid = f"'{U('b1',caid)}'" if caid else 'NULL'
        cls = 'Finance' if mode!='other' else 'Operating'
        ubl = 'true' if mode!='other' else 'false'
        rows.append(f"  ('{U(uid,n)}', {Q(no)}, {cid}, {Q(mode)}, {Q(asset)}, {Q(aname)},"
                    f" {Q(no)}, {D(*sd)}, {D(*sd)}, '{ed}', {amt}, {rate}, {term},"
                    f" 'Monthly', 'Fix Installment', 'arrears', {Q(cls)}, 7, {ubl},"
                    f" {Q(st)}, 'External', 'admin', 'admin')")
w(",\n".join(rows) + ";")
w()
# ── ตารางผ่อนกลาง ──────────────────────────────────────────────────────
w("-- ตารางผ่อนกลาง — ใช้ออกรายงานงวดที่ถึงกำหนดและงวดที่เกินกำหนด")
w("INSERT INTO installment_schedules")
w("  (id, facility_type_id, facility_id, contract_no, period, due_date, begin_balance,")
w("   principal, interest, fee, vat, payment, end_balance, paid, paid_amount, paid_date)")
w("VALUES")
rows=[]; k=0
for code, fid, cno, key, npaid in [
    ('LOAN', U('d3',4), 'LN-2026-004', 'LN_004', 5),
    ('HP',   U('e1',4), 'HP-2026-004', 'HP_004', 5),
    ('LEASE',U('e2',4), 'LS-2026-004', 'LS_004', 4),
    ('LEASE',U('e3',4), 'LO-2026-004', 'LO_004', 6),
]:
    for r in sched(key)[:12]:          # เก็บ 12 งวดแรกพอ ใช้ออกรายงานงวดที่ถึงกำหนด
        k+=1
        pd = r['period']; due = D2(r['due']); paid = pd <= npaid
        vat = round(r['payment']*0.07, 2) if code=='LEASE' else 0
        rows.append(
          f"  ('{U('f1',k)}', (SELECT id FROM facility_types WHERE code={Q(code)}), '{fid}',"
          f" {Q(cno)}, {pd}, {D(*due)}, {r['begin']}, {r['principal']}, {r['interest']}, 0, {vat},"
          f" {r['payment']}, {r['end']},"
          f" {'true' if paid else 'false'}, {r['payment'] if paid else 0},"
          f" {D(*due) if paid else 'NULL'})")
w(",\n".join(rows) + ";")
w()

# ── ใบแจ้งยอดธนาคาร ────────────────────────────────────────────────────
w("-- ═════════════════════════════════════════════════════════════════")
w("-- 5 · ใบแจ้งยอดธนาคาร 5 ฉบับ")
w("-- ═════════════════════════════════════════════════════════════════")
BS = [
 (1,'KBANK','181-3-11063-0','ใบแจ้งยอด KBANK ส.ค. 2026','2026-08'),
 (2,'SCB',  '405-8-77219-4','ใบแจ้งยอด SCB ส.ค. 2026','2026-08'),
 (3,'BBL',  '101-7-45532-9','ใบแจ้งยอด BBL ส.ค. 2026','2026-08'),
 (4,'KBANK','181-3-11063-0','ใบแจ้งยอด KBANK ก.ค. 2026','2026-07'),
 (5,'SCB',  '405-8-77219-4','ใบแจ้งยอด SCB ก.ค. 2026','2026-07'),
]
w("INSERT INTO bank_statements (id, finance_institution, account_no, statement_name, statement_period, source) VALUES")
w(",\n".join(f"  ('{U('cb',n)}', {Q(fi)}, {Q(acct)}, {Q(nm)}, {Q(pr)}, 'Manual')"
             for n,fi,acct,nm,pr in BS) + ";")
w()
w("-- รายการในใบแจ้งยอด — 5 บรรทัดที่จะถูกนำไปตัดชำระ")
# ยอดในใบแจ้งยอดต้องเท่ากับดอกเบี้ย/ค่างวดที่คำนวณได้จริง ไม่ใช่ตัวเลขสมมติ
PN_INT1 = CALC['PN_004'][0]['interest']
TR_INT1 = CALC['TR_004'][0]['interest']
LOAN_S  = sched('LN_004')
HP_S    = sched('HP_004')
BSL = [
 (1,1,(2026,8,5),  'ชำระดอกเบี้ยตั๋วสัญญาใช้เงิน งวดที่ 1', PN_INT1, 'PN',  U('c1',4)),
 (2,1,(2026,8,10), 'ชำระค่าธรรมเนียมหนังสือค้ำประกัน', 18_750.00, 'LG', U('c2',4)),
 (3,2,(2026,8,12), 'ชำระดอกเบี้ยทรัสต์รีซีท งวดที่ 1', TR_INT1, 'TR', U('c9',4)),
 (4,3,(2026,8,15), 'ชำระค่างวดเงินกู้ งวดที่ 6', LOAN_S[5]['payment'], 'LOAN', U('d3',4)),
 (5,3,(2026,8,20), 'ชำระค่างวดเช่าซื้อ งวดที่ 6', HP_S[5]['payment'], 'HP', U('e1',4)),
]
w("INSERT INTO bank_statement_lines")
w("  (id, statement_id, tx_date, description, debit, credit, balance,")
w("   facility_type_id, facility_id, source_period, source, sort_order)")
w("VALUES")
rows=[]
for n,st,dt,desc,amt,code,fid in BSL:
    rows.append(f"  ('{U('cc',n)}', '{U('cb',st)}', {D(*dt)}, {Q(desc)}, {amt}, 0, 0,"
                f" (SELECT id FROM facility_types WHERE code={Q(code)}), '{fid}', {n},"
                f" 'Manual', {n})")
w(",\n".join(rows) + ";")
w()

# ── ใบสำคัญบัญชี ───────────────────────────────────────────────────────
w("-- ═════════════════════════════════════════════════════════════════")
w("-- 6 · ใบสำคัญบัญชี — สร้างจากธุรกรรมที่ลงบัญชีแล้วเท่านั้น")
w("-- ═════════════════════════════════════════════════════════════════")

JE=[]; JL=[]; jn=[0]
def je(src, sid, period, date, desc, lines, status='Posted', sync='synced', rev=False, posted=None):
    """lines = [(บัญชี, เดบิต, เครดิต, คำอธิบาย)] — เดบิตต้องเท่ากับเครดิตเสมอ

    date   = วันที่ทางบัญชี (ตัวเลขเข้างบเดือนไหน)
    posted = วันที่คนกดลงบัญชีจริง · ต้องไม่เป็นวันในอนาคต
             ใบกลับรายการลงวันที่ล่วงหน้า แต่ถูกกดพร้อมใบตั้งดอกเบี้ย จึงส่ง posted มาเอง
    """
    jn[0]+=1; i=jn[0]
    dr = round(sum(l[1] for l in lines),2); cr = round(sum(l[2] for l in lines),2)
    assert abs(dr-cr) < 0.005, f"ใบสำคัญ {i} ไม่ดุล {dr} vs {cr}"
    p = posted or date
    assert p <= TODAY, f"ใบสำคัญ {i}: วันที่ลงบัญชี {p} เป็นวันในอนาคต"
    assert date <= TODAY, f"ใบสำคัญ {i}: วันที่ทางบัญชี {date} เป็นวันในอนาคต"
    JE.append((i, f"JE-2026-{i:05d}", src, sid, period, date, desc, dr, cr, status, sync, rev, p))
    for k,(acc,d,c,ds) in enumerate(lines, 1):
        code,name = GL[acc]
        JL.append((i, k, code, name, d, c, ds))
    return i

def acc_int(p, rate, days): return round(p*rate/100*days/365, 2)

# ตั๋วสัญญาใช้เงิน PN-2026-004 — เบิก 18 ล้าน อัตรา 6.50%
je('PN_DRAWDOWN', U('c1',4), None, (2026,6,1), 'PN-2026-004 — เบิกใช้วงเงินตั๋วสัญญาใช้เงิน',
   [('cash',18_000_000,0,'รับเงินเข้าบัญชีจากการเบิกตั๋วสัญญาใช้เงิน'),
    ('pn',0,18_000_000,'ตั้งหนี้ตั๋วสัญญาใช้เงิน')])
# ดอกเบี้ยคิดจากงวดชุดเดียวกับที่หน้าตั๋วคำนวณ — ตัวเลขในใบสำคัญจึงตรงกับตารางบนจอ
# ลงบัญชีเฉพาะงวดที่ปิดไปแล้วจริง งวดที่ยังไม่สิ้นสุดจะยังไม่มีใบสำคัญ
PN4 = periods('PN_004')
for pi, st_, ed_, days, amt in PN4:
    je('PN_ACCRUED', U('c1',4), pi, ed_, f'PN-2026-004 — ดอกเบี้ยค้างจ่าย งวดที่ {pi}',
       [('intexp',amt,0,f'ดอกเบี้ยจ่าย {days} วัน'),('accr',0,amt,'ดอกเบี้ยค้างจ่าย')],
       sync='synced' if pi < len(PN4) else None)
    # ใบกลับรายการลงวันที่วันแรกของเดือนถัดไป แต่ถูกกดพร้อมใบตั้งดอกเบี้ย
    je('PN_ACCRUED', U('c1',4), pi, addm(ed_[0], ed_[1], 1, 1),
       f'PN-2026-004 — กลับดอกเบี้ยค้างจ่าย งวดที่ {pi}',
       [('accr',amt,0,'กลับดอกเบี้ยค้างจ่าย'),('intexp',0,amt,'กลับดอกเบี้ยจ่าย')],
       sync='synced' if pi < len(PN4) else None, rev=True, posted=ed_)

# สินเชื่อรถในสต๊อก FP-2026-004 — 22 ล้าน อัตรา 5.75%
je('FP_DRAWDOWN', U('c5',4), None, (2026,5,1), 'FP-2026-004 — เบิกใช้วงเงินสินเชื่อรถในสต๊อก',
   [('cash',22_000_000,0,'รับเงินเข้าบัญชี'),('fp',0,22_000_000,'ตั้งหนี้สินเชื่อรถในสต๊อก')])
for pi, st_, ed_, days, amt in periods('FP_004'):
    je('FP_ACCRUED', U('c5',4), pi, ed_,
       f'FP-2026-004 — ดอกเบี้ยค้างจ่าย งวดที่ {pi}',
       [('intexp',amt,0,f'ดอกเบี้ยจ่าย {days} วัน'),('accr',0,amt,'ดอกเบี้ยค้างจ่าย')])

# หนังสือค้ำประกัน LG-2026-004 — 5 ล้าน
je('LG_ISSUE_OFFBALANCE', U('c2',4), None, (2026,5,1), 'LG-2026-004 — บันทึกภาระผูกพันนอกงบดุล',
   [('ob_dr',5_000_000,0,'ภาระผูกพันจากการค้ำประกัน'),
    ('ob_cr',0,5_000_000,'ภาระผูกพันจากการค้ำประกัน - คู่สัญญา')])
je('LG_FEE', U('c2',4), 1, (2026,5,1), 'LG-2026-004 — ค่าธรรมเนียมหนังสือค้ำประกัน',
   [('fee',18_750,0,'ค่าธรรมเนียมหนังสือค้ำประกัน'),('cash',0,18_750,'จ่ายจากบัญชีธนาคาร')])

# เลตเตอร์ออฟเครดิต LC-2026-004
je('LC_FEE', U('c4',4), None, (2026,6,10), 'LC-2026-004 — ค่าธรรมเนียมรอตัดบัญชี',
   [('prepay',36_960,0,'ค่าธรรมเนียมรอตัดบัญชี'),('cash',0,36_960,'จ่ายจากบัญชีธนาคาร')])
je('LC_FEE_RECOG', U('c4',4), 1, (2026,6,30), 'LC-2026-004 — รับรู้ค่าธรรมเนียมตามงวด',
   [('fee',12_320,0,'ค่าธรรมเนียมธนาคาร'),('prepay',0,12_320,'ตัดค่าธรรมเนียมรอตัดบัญชี')])

# เบิกเกินบัญชี OD-2026-004
for pi, st_, ed_, days, amt in periods('OD_004'):
    je('OD_ACCRUED', U('c7',4), pi, ed_,
       f'OD-2026-004 — ดอกเบี้ยค้างจ่าย งวดที่ {pi}',
       [('intexp',amt,0,f'ดอกเบี้ยจ่าย {days} วัน'),('accr',0,amt,'ดอกเบี้ยค้างจ่าย')])

# ทรัสต์รีซีท TR-2026-004
je('TR_DRAWDOWN', U('c9',4), None, (2026,6,1), 'TR-2026-004 — เบิกใช้วงเงินทรัสต์รีซีท',
   [('cash',9_000_000,0,'รับเงินเข้าบัญชี'),('tr',0,9_000_000,'ตั้งหนี้ทรัสต์รีซีท')])
for pi, st_, ed_, days, amt in periods('TR_004'):
    je('TR_ACCRUED', U('c9',4), pi, ed_,
       f'TR-2026-004 — ดอกเบี้ยค้างจ่าย งวดที่ {pi}',
       [('intexp',amt,0,f'ดอกเบี้ยจ่าย {days} วัน'),('accr',0,amt,'ดอกเบี้ยค้างจ่าย')])

# สัญญาซื้อขายเงินตราต่างประเทศล่วงหน้า
je('FXF_FEE', U('d1',4), None, (2026,6,1), 'FXF-2026-004 — ค่าธรรมเนียมสัญญาซื้อขายเงินตราล่วงหน้า',
   [('fee',12_500,0,'ค่าธรรมเนียมธนาคาร'),('cash',0,12_500,'จ่ายจากบัญชีธนาคาร')], sync=None)

# เงินกู้ LN-2026-004
je('LOAN_DRAWDOWN', U('d3',4), None, (2026,3,1), 'LN-2026-004 — เบิกใช้วงเงินเงินกู้',
   [('cash',20_000_000,0,'รับเงินเข้าบัญชี'),('loan',0,20_000_000,'ตั้งหนี้เงินกู้')])
for r in sched('LN_004')[:3]:
    it = r['interest']; pi = r['period']
    je('LOAN_ACCRUED', U('d3',4), pi, D2(r['due']),
       f"LN-2026-004 — ดอกเบี้ยค้างจ่าย งวดที่ {pi}",
       [('intexp',it,0,f"ดอกเบี้ยจ่าย {r['days']} วัน"),('accr',0,it,'ดอกเบี้ยค้างจ่าย')])

# สัญญาเช่า
je('LEASE_DAY1', U('e1',4), None, (2026,3,1), 'HP-2026-004 — บันทึกสัญญาเช่า ณ วันเริ่มสัญญา',
   [('rou',6_200_000,0,'สินทรัพย์สิทธิการใช้'),('lliab',0,6_200_000,'หนี้สินตามสัญญาเช่า')])
je('LEASE_DEPR', U('e1',4), 1, (2026,3,31), 'HP-2026-004 — ค่าเสื่อมราคาสินทรัพย์สิทธิการใช้',
   [('depr',103_333.33,0,'ค่าเสื่อมราคา'),('rou',0,103_333.33,'ค่าเสื่อมราคาสะสม')])
je('LEASE_DAY1', U('e2',4), None, (2026,4,1), 'LS-2026-004 — บันทึกสัญญาเช่า ณ วันเริ่มสัญญา',
   [('rou',5_400_000,0,'สินทรัพย์สิทธิการใช้'),('lliab',0,5_400_000,'หนี้สินตามสัญญาเช่า')],
   sync=None)
je('LEASE_PAY', U('e3',4), 1, (2026,2,28), 'LO-2026-004 — ชำระค่าเช่าตามงวด',
   [('fee',60_000,0,'ค่าเช่าจ่าย'),('cash',0,60_000,'จ่ายจากบัญชีธนาคาร')], sync='failed')
# ── การตัดชำระ 5 รายการ ────────────────────────────────────────────────
REP = [
 (1,'RP-2026-001', U('c1',4),'PN',  (2026,8,5),  PN_INT1, 0, PN_INT1, 0, 1, 'Bank Statement', 'Posted'),
 (2,'RP-2026-002', U('c2',4),'LG',  (2026,8,10), 18_750.00, 0, 0, 18_750.00, 2, 'Bank Statement', 'Posted'),
 (3,'RP-2026-003', U('c9',4),'TR',  (2026,8,12), TR_INT1, 0, TR_INT1, 0, 3, 'Bank Statement', 'Posted'),
 (4,'RP-2026-004', U('d3',4),'LOAN',(2026,8,15), LOAN_S[5]['payment'], LOAN_S[5]['principal'], LOAN_S[5]['interest'], 0, 4, 'Bank Statement', 'Posted'),
 (5,'RP-2026-005', U('e1',4),'HP',  (2026,8,20), HP_S[5]['payment'], HP_S[5]['principal'], HP_S[5]['interest'], 0, 5, 'AP', 'Draft'),
]
for n,no,fid,code,pd,amt,pr,it,fee,bsl,ch,st in REP:
    if st == 'Posted':
        # ฝั่งเดบิตแยกตามสิ่งที่ตัดชำระ ฝั่งเครดิตคือเงินที่จ่ายออกจากบัญชี
        ln = []
        if it:  ln.append(('accr', it, 0, 'ล้างดอกเบี้ยค้างจ่าย'))
        if pr:
            acct = 'loan' if code == 'LOAN' else 'lliab' if code == 'HP' else 'pn'
            ln.append((acct, pr, 0, 'ชำระคืนเงินต้น'))
        if fee: ln.append(('fee', fee, 0, 'ค่าธรรมเนียม'))
        ln.append(('cash', 0, round(it + pr + fee, 2), 'จ่ายจากบัญชีธนาคาร'))
        i = je('REPAYMENT', U('cd',n), None, pd, f'{no} — ตัดชำระหนี้', ln,
               sync='synced' if n<=3 else None)
        REP[n-1] = (n,no,fid,code,pd,amt,pr,it,fee,bsl,ch,st,i)
    else:
        REP[n-1] = (n,no,fid,code,pd,amt,pr,it,fee,bsl,ch,st,None)

w("INSERT INTO journal_entries")
w("  (id, je_number, source_type, source_id, source_period, je_date, posting_period,")
w("   description, total_dr, total_cr, status, is_reversal, sync_status, netsuite_je_id,")
w("   posted_by, posted_at)")
w("VALUES")
rows=[]
MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
for i,num,src,sid,per,dt,desc,dr,cr,st,sync,rev,pdt in JE:
    pp = f"{MON[dt[1]-1]} {dt[0]}"
    ns = f"'NS-{100000+i}'" if sync=='synced' else 'NULL'
    rows.append(f"  ('{U('da',i)}', {Q(num)}, {Q(src)}, '{sid}',"
                f" {per if per else 'NULL'}, {D(*dt)}, {Q(pp)}, {Q(desc)},"
                f" {dr}, {cr}, {Q(st)}, {'true' if rev else 'false'},"
                f" {Q(sync) if sync else 'NULL'}, {ns},"
                f" 'admin', {D(*pdt)}::timestamptz + interval '10 hours')")
w(",\n".join(rows) + ";")
w()
w("INSERT INTO je_lines (id, je_id, line_no, account_code, account_name, dr, cr, description) VALUES")
rows=[]
for k,(ji,ln,code,name,d,c,ds) in enumerate(JL, 1):
    rows.append(f"  ('{U('db',k)}', '{U('da',ji)}', {ln}, {Q(code)}, {Q(name)}, {d}, {c}, {Q(ds)})")
w(",\n".join(rows) + ";")
w()

w("-- ═════════════════════════════════════════════════════════════════")
w("-- 7 · การตัดชำระ 5 รายการ · ผูกกับรายการในใบแจ้งยอดและใบสำคัญ")
w("-- ═════════════════════════════════════════════════════════════════")
w("INSERT INTO repayments")
w("  (id, repayment_no, facility_type_id, facility_id, pay_date, amount, principal,")
w("   interest, fee, penalty, vat, wht, channel, payment_type, status, je_id,")
w("   bank_statement_line_id)")
w("VALUES")
rows=[]
for n,no,fid,code,pd,amt,pr,it,fee,bsl,ch,st,jei in REP:
    jeref = "'" + U('da',jei) + "'" if jei else 'NULL'
    rows.append(f"  ('{U('cd',n)}', {Q(no)},"
                f" (SELECT id FROM facility_types WHERE code={Q(code)}), '{fid}', {D(*pd)},"
                f" {amt}, {pr}, {it}, {fee}, 0, 0, 0, {Q(ch)},"
                f" {'NULL' if ch!='AP' else Q('Cheque')}, {Q(st)},"
                f" {jeref},"
                f" '{U('cc',bsl)}')")
w(",\n".join(rows) + ";")
w()
w("INSERT INTO repayment_lines")
w("  (id, repayment_id, facility_type_id, facility_type, facility_id, category, amount, sort_order)")
w("VALUES")
rows=[]; k=0
for n,no,fid,code,pd,amt,pr,it,fee,bsl,ch,st,jei in REP:
    for cat, val in (('Principal',pr), ('Interest',it), ('Fee',fee)):
        if val:
            k+=1
            rows.append(f"  ('{U('ce',k)}', '{U('cd',n)}',"
                        f" (SELECT id FROM facility_types WHERE code={Q(code)}), {Q(code)},"
                        f" '{fid}', {Q(cat)}, {val}, {k})")
w(",\n".join(rows) + ";")
w()
w("COMMIT;")
w()
w("-- ═════════════════════════════════════════════════════════════════")
w("-- 8 · ตรวจผล — รันแล้วดูว่าจำนวนตรงตามที่ตั้งใจไหม")
w("-- ═════════════════════════════════════════════════════════════════")
w("""
SELECT 'สัญญาหลัก' AS "เมนู", count(*) AS "จำนวน" FROM master_agreements
UNION ALL SELECT 'วงเงิน', count(*) FROM credit_agreements
UNION ALL SELECT 'ตั๋วสัญญาใช้เงิน', count(*) FROM promissory_notes
UNION ALL SELECT 'หนังสือค้ำประกัน', count(*) FROM letter_guarantees
UNION ALL SELECT 'เลตเตอร์ออฟเครดิต', count(*) FROM letters_of_credit
UNION ALL SELECT 'สินเชื่อรถในสต๊อก', count(*) FROM floor_plans
UNION ALL SELECT 'เบิกเกินบัญชี', count(*) FROM overdrafts
UNION ALL SELECT 'ทรัสต์รีซีท', count(*) FROM trust_receipts
UNION ALL SELECT 'ซื้อขายเงินตราล่วงหน้า', count(*) FROM fx_forwards
UNION ALL SELECT 'เงินกู้', count(*) FROM loans
UNION ALL SELECT 'เช่าซื้อ', count(*) FROM leases WHERE mode='hp'
UNION ALL SELECT 'ให้เช่าดำเนินงาน', count(*) FROM leases WHERE mode='lease'
UNION ALL SELECT 'เช่าไม่ใช้สินเชื่อ', count(*) FROM leases WHERE mode='other'
UNION ALL SELECT 'ใบแจ้งยอดธนาคาร', count(*) FROM bank_statements
UNION ALL SELECT 'การตัดชำระ', count(*) FROM repayments
UNION ALL SELECT 'ใบสำคัญบัญชี', count(*) FROM journal_entries;

-- ใบสำคัญที่เดบิตไม่เท่าเครดิต — ต้องได้ 0 แถว
SELECT je_number, total_dr, total_cr FROM journal_entries WHERE total_dr <> total_cr;

-- ใบสำคัญที่หัวใบไม่ตรงกับผลรวมบรรทัด — ต้องได้ 0 แถว
SELECT j.je_number, j.total_dr, sum(l.dr) AS "รวมเดบิตในบรรทัด"
FROM journal_entries j JOIN je_lines l ON l.je_id = j.id
GROUP BY j.id, j.je_number, j.total_dr HAVING j.total_dr <> sum(l.dr);

-- ธุรกรรมที่ไม่มีวงเงินผูกอยู่ — ควรมีแค่สัญญาเช่าไม่ใช้สินเชื่อเท่านั้น
SELECT 'สัญญาเช่าไม่มีวงเงิน' AS "รายการ", lease_no, mode FROM leases WHERE ca_id IS NULL;

-- ยอดใช้วงเงินเทียบเพดาน — remaining ต้องไม่ติดลบ
SELECT contract_number, credit_line, utilization, remaining
FROM credit_agreements WHERE remaining < 0;
""")

io.open('/sessions/fervent-nifty-dirac/gen/out.sql','w',encoding='utf-8').write("\n".join(L))
print("บรรทัดทั้งหมด", len(L), "· ใบสำคัญ", len(JE), "· บรรทัดใบสำคัญ", len(JL))
