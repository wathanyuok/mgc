import { useEffect, useMemo, useState } from 'react';
import { removalBlockedReason } from '@/lib/ma-allocation';
import { assertCanUseSubsidiary } from '@/lib/subsidiary-scope';
import { ScopeGuard } from '@/components/shared/ScopeGuard';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ChevronDown, ChevronRight, Plus, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { CharCount, Button, Card, CardContent, Input, Select, Badge , FieldLabel, NumInput } from '@/components/ui';
import { fmtDate, fmtMoney, fmtDateISO} from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  type MasterAgreement,
  type MASubsidiary,
  type MACondition,
  type MACollateral,
  type MAGuarantor,
  type CreditAgreement,
  MA_STATUS,
  RATIO_OPS,
} from '@/types/database';
import { useSubsidiaryCodes } from '@/lib/subsidiaries';
import { TOOLTIPS } from '@/lib/tooltips';
import { useCurrentUserLabel, useAuth } from '@/lib/auth';
import { ApprovalActions, ApprovalNote, ApprovalTrail, PENDING_STATUS, filterStatusOptions } from '@/components/shared/ApprovalActions';
import { useReadOnly, ReadOnlyContext } from '@/lib/readonly';
import { checkChassisConflict, classifyConflicts } from '@/lib/chassis-lookup';
import { AuditFooter } from '@/components/AuditFooter';
import { CollateralCards, type Collateral, type CollateralType } from '@/components/ma/CollateralCards';
import { GuarantorCards, invalidGuarantorIds, type Guarantor } from '@/components/ma/GuarantorCards';
import { DocumentTab } from '@/components/ma/DocumentTab';
import { ClassificationCard } from '@/components/shared/ClassificationCard';
import { useBankCodes } from '@/lib/banks';

import { checkRequiredFields } from '@/lib/required-check';
import { friendlySaveError } from '@/lib/save-error';
import { logSave } from '@/lib/audit-trail';
type TabKey = 'condition' | 'collateral' | 'guarantee' | 'details' | 'files';

// =====================================================================
// MA Detail — of
// =====================================================================
export function MADetail({ mode }: { mode: 'new' | 'edit' }) {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('details');
  const { codes: subCodes } = useSubsidiaryCodes(); // Subsidiary Master (ชื่อย่อตามผัง)
  const { can, scope, isAdmin } = useAuth(); // Approval flow — Maker/Approver
  // บริษัทคู่สัญญาต้องเป็นบริษัทที่ตัวเองดูแล — กันเลือกไปแล้วโดนตีกลับตอนบันทึก
  const mySubCodes = scope.all ? subCodes : subCodes.filter((c) => scope.codes.includes(c));
  const [openPrim, setOpenPrim] = useState(true);
  const [openCredit, setOpenCredit] = useState(true);

  // ---------- form state ----------
  const [ma, setMa] = useState<MasterAgreement>({
    id: '',
    finance_institution: '',
    ma_name: '',
    // ไม่ตั้งค่าเริ่มต้นเป็นบริษัทใดบริษัทหนึ่ง — บริษัทคู่สัญญาต้องเลือกเอง
    // เดิมฝัง MCR ไว้ตายตัว ทำให้กดบันทึกผ่านโดยไม่เคยเลือก แล้วสัญญาไปอยู่ผิดบริษัท
    subsidiary: '',
    status: 'Draft',
    start_date: fmtDateISO(new Date()),
    end_date: fmtDateISO(new Date()),
    credit_line: 0,
    utilization: 0,
    remaining_credit: 0,
    created_at: '',
    updated_at: '',
  });
  const [subs, setSubs] = useState<MASubsidiary[]>([]);
  // เลือกครบทุกบริษัทแล้ว ไม่มีอะไรเหลือให้แถวใหม่เลือก
  const noSubLeft = subCodes.every((c) => subs.some((x) => x.subsidiary === c));
  const [cond, setCond] = useState<MACondition>({
    ma_id: '',
    de_op: '<=',
    de_value: 4.0,
    dscr_op: '>=',
    dscr_value: 1.2,
    other_requirement: '',
    consent_waiver: '',
  });

  const [collaterals, setCollaterals] = useState<Collateral[]>([]);
  const [guarantors, setGuarantors] = useState<Guarantor[]>([]);
  const [guarRemark, setGuarRemark] = useState('');

  // ---------- fetch existing ----------
  const { data: existing } = useQuery({
    queryKey: ['ma', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [maRes, subsRes, condRes, casRes, colRes, guarRes] = await Promise.all([
        supabase.from('master_agreements').select('*').eq('id', id!).single(),
        supabase.from('ma_subsidiaries').select('*').eq('ma_id', id!).order('sort_order'),
        supabase.from('ma_conditions').select('*').eq('ma_id', id!).maybeSingle(),
        supabase.from('credit_agreements').select('*').eq('ma_id', id!).order('ca_name'),
        supabase.from('ma_collaterals').select('*').eq('ma_id', id!).order('sort_order'),
        supabase.from('ma_guarantors').select('*').eq('ma_id', id!).order('sort_order'),
      ]);
      if (maRes.error) throw maRes.error;
      return {
        ma: maRes.data as MasterAgreement,
        subs: (subsRes.data ?? []) as MASubsidiary[],
        cond: (condRes.data ?? null) as MACondition | null,
        cas: (casRes.data ?? []) as CreditAgreement[],
        cols: (colRes.data ?? []) as MACollateral[],
        guars: (guarRes.data ?? []) as MAGuarantor[],
      };
    },
  });

  useEffect(() => {
    if (existing) {
      setMa(existing.ma);
      setSubs(existing.subs);
      if (existing.cond) setCond(existing.cond);
      setCollaterals(
        // Merge flat columns (migration 0067) back into fields shape for UI compat
        existing.cols.map((c: any) => ({
          id: c.id,
          type: c.type as CollateralType,
          fields: {
            ...(c.fields ?? {}),                     // legacy JSONB (fallback)
            // Flat columns override JSONB (if migration ran)
            ...(c.asset_no       != null && { asset_no: c.asset_no }),
            ...(c.doc_no         != null && { doc_no: c.doc_no }),
            ...(c.location       != null && { location: c.location }),
            ...(c.value          != null && { value: c.value }),
            ...(c.appraisal      != null && { appraisal: c.appraisal }),
            ...(c.appr_date      != null && { appr_date: c.appr_date }),
            ...(c.mortgage_limit != null && { mortgage_limit: c.mortgage_limit }),
            ...(c.chassis_no     != null && { chassis_no: c.chassis_no }),
            ...(c.vreg           != null && { vreg: c.vreg }),
            ...(c.vmodel         != null && { vmodel: c.vmodel }),
            ...(c.pledge         != null && { pledge: c.pledge }),
            ...(c.bank           != null && { bank: c.bank }),
            ...(c.acct_no        != null && { acct_no: c.acct_no }),
            ...(c.acct_name      != null && { acct_name: c.acct_name }),
            ...(c.deposit_amt    != null && { deposit_amt: c.deposit_amt }),
            ...(c.pledge_amt     != null && { pledge_amt: c.pledge_amt }),
            ...(c.reg_no         != null && { reg_no: c.reg_no }),
            ...(c.reg_limit      != null && { reg_limit: c.reg_limit }),
            ...(c.desc_          != null && { desc: c.desc_ }),                  // column desc_ → UI key desc
            ...(c.secured_limit  != null && { secured_limit: c.secured_limit }),
            ...(c.source         != null && { _source: c.source }),              // column source → UI key _source
          },
        })),
      );
      setGuarantors(
        existing.guars.map((g: any) => ({
          id: g.id,
          type: g.type as any,
          name: g.name ?? g.fields?.name,                                       // fallback: aan JSONB เก่า (rollback safety)
          company_name: g.company_name ?? g.fields?.company,
          id_card_or_tax_id: g.id_card_or_tax_id ?? g.fields?.tax_id,
          position: g.position ?? g.fields?.position,
          amount: g.amount ?? g.fields?.amount,
          expiry_date: g.expiry_date ?? g.fields?.expiry_date,
          phone: g.phone ?? g.fields?.phone,
          address: g.address ?? g.fields?.address,
          remark: g.remark ?? g.fields?.remark,
        })),
      );
      // guarRemark stored in master_agreements.guarantee_remark (Migration 0070)
      setGuarRemark((existing.ma as any).guarantee_remark ?? '');
    }
  }, [existing]);

  // ยอดใช้วงเงินรายบริษัทย่อย — รวมจากวงเงินจริงที่อยู่ใต้สัญญาหลักนี้ ไม่ใช่ตัวเลขที่คนพิมพ์
  // เดิมเป็นช่องให้พิมพ์เอง ยอดใช้วงเงินของสัญญาหลักจึงเป็นค่าที่คนกรอก ไม่ใช่ยอดที่ธุรกรรมใช้จริง
  const { data: caUtilBySub } = useQuery({
    queryKey: ['ma-sub-utilization', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from('credit_agreements')
        .select('subsidiary, utilization')
        .eq('ma_id', id!);
      const m: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) {
        const k = String(r.subsidiary ?? '');
        m[k] = (m[k] ?? 0) + Number(r.utilization ?? 0);
      }
      return m;
    },
  });
  const utilOf = (subsidiary: string) => caUtilBySub?.[subsidiary] ?? 0;

  // ---------- live computations ----------
  const subTotal = useMemo(() => subs.reduce((s, x) => s + (x.credit_line || 0), 0), [subs]);
  const subUtilTotal = useMemo(
    () => subs.reduce((s, x) => s + utilOf(x.subsidiary), 0),
    [subs, caUtilBySub],
  );
  // Σ sub-allocation ต้อง "ไม่เกิน" credit line (จัดสรรน้อยกว่าได้ — เหลือ headroom) — ไม่บังคับให้เท่ากัน
  const subAllocOK = useMemo(() => subTotal <= (ma.credit_line || 0) + 0.01, [subTotal, ma.credit_line]);
  const userLabel = useCurrentUserLabel();
  const readOnly = useReadOnly();

  // อนุมัติแล้ว = ล็อก ต้องให้ผู้อนุมัติกด "ขอให้แก้ไข" ก่อนถึงจะแก้ได้
  // ถ้าปล่อยให้แก้ได้เงียบๆ ลายเซ็นอนุมัติจะไม่ผูกกับตัวเลขชุดไหนเลย
  const approvedLock = ma.status === 'Approved' && !isAdmin;
  // ---------- mutations ----------
  const save = useMutation({
    mutationFn: async () => {
      if (!ma.ma_name.trim()) throw new Error('กรอก Master Agreement Name');
      // เดิมช่องนี้มีค่าเริ่มต้นตายตัว จึงไม่เคยว่างและไม่เคยต้องตรวจ
      if (!ma.subsidiary) throw new Error('เลือกบริษัทคู่สัญญา (Subsidiary)');
      // กันสร้างสัญญาให้บริษัทที่ตัวเองไม่ได้ดูแล — ไม่งั้นจะสร้างได้แต่เปิดกลับมาแก้ไม่ได้
      const scopeErr = assertCanUseSubsidiary(scope, ma.subsidiary);
      if (scopeErr) throw new Error(scopeErr);
      const emptyRow = subs.findIndex((s) => !s.subsidiary);
      if (emptyRow >= 0) throw new Error(`ตารางจัดสรรวงเงิน แถวที่ ${emptyRow + 1} ยังไม่ได้เลือกบริษัท`);
      // บริษัทที่หายไปจากตารางแต่ยังมีวงเงินย่อยใช้โควตาอยู่ — กันไว้อีกชั้น
      // เผื่อสถานะวงเงินย่อยเปลี่ยนระหว่างที่หน้าจอเปิดค้างไว้
      const removed = (existing?.subs ?? [])
        .map((x) => x.subsidiary)
        .filter((code) => code && !subs.some((x) => x.subsidiary === code));
      for (const code of removed) {
        const why = removalBlockedReason(existing?.cas ?? [], code);
        if (why) throw new Error(why);
      }
      const dup = subs.map((s) => s.subsidiary).find((v, i, a) => v && a.indexOf(v) !== i);
      if (dup) throw new Error(`ตารางจัดสรรวงเงินมี ${dup} ซ้ำกัน — รวมเป็นแถวเดียว`);
      // ช่วงเวลาของสัญญาต้องเดินหน้าเสมอ — เดิมกรอกวันสิ้นสุดก่อนวันเริ่มแล้วบันทึกผ่าน
      // ทำให้วงเงินที่อ้างสัญญานี้คำนวณช่วงมีผลเพี้ยนตามไปด้วย
      if (ma.start_date && ma.end_date && ma.end_date < ma.start_date) {
        throw new Error(`วันสิ้นสุดสัญญา (${fmtDate(ma.end_date)}) ต้องไม่ก่อนวันเริ่มสัญญา (${fmtDate(ma.start_date)})`);
      }
      const badIds = invalidGuarantorIds(guarantors);
      if (badIds.length) throw new Error(badIds.join(' · '));
      // ระหว่างรออนุมัติ — Maker แก้ไขไม่ได้ (Approver ใช้ปุ่ม อนุมัติ/ส่งกลับแก้/ปฏิเสธ)
      if (approvedLock) {
        throw new Error('รายการนี้อนุมัติแล้ว — แก้ไขไม่ได้ · ให้ผู้อนุมัติกด "ขอให้แก้ไข" ก่อน');
      }
      if (ma.status === PENDING_STATUS && !can('ma', 'approve')) {
        throw new Error('รายการอยู่ระหว่างรออนุมัติ — แก้ไขไม่ได้จนกว่า Approver จะอนุมัติหรือส่งกลับ');
      }

      let maId = id;
      if (mode === 'new') {
        const { data, error } = await supabase
          .from('master_agreements')
          .insert({
            finance_institution: ma.finance_institution,
            ma_name: ma.ma_name,
            subsidiary: ma.subsidiary,
            status: ma.status,
            start_date: ma.start_date,
            end_date: ma.end_date,
            credit_line: ma.credit_line,
            // ยอดใช้วงเงินไม่ส่งไป — ฐานข้อมูลรวมขึ้นมาให้เองจากวงเงินย่อย
            // ถ้าส่งไปด้วยจะเป็นค่าที่คำนวณไว้ตอนเปิดหน้า ซึ่งอาจเก่าไปแล้ว
            guarantee_remark: guarRemark || null,
            created_by: userLabel,
            updated_by: userLabel,
          })
          .select()
          .single();
        if (error) throw error;
        maId = data.id;
      } else {
        const { error } = await supabase
          .from('master_agreements')
          .update({
            finance_institution: ma.finance_institution,
            ma_name: ma.ma_name,
            subsidiary: ma.subsidiary,
            status: ma.status,
            start_date: ma.start_date,
            end_date: ma.end_date,
            credit_line: ma.credit_line,
            guarantee_remark: guarRemark || null,
            updated_by: userLabel,
            updated_at: new Date().toISOString(),
          })
          .eq('id', maId!);
        if (error) throw error;
      }

      // Replace subsidiary rows
      await supabase.from('ma_subsidiaries').delete().eq('ma_id', maId!);
      if (subs.length > 0) {
        const { error } = await supabase.from('ma_subsidiaries').insert(
          subs.map((s, i) => ({
            ma_id: maId!,
            subsidiary: s.subsidiary,
            credit_line: s.credit_line,
            // ยอดใช้วงเงินไม่ส่งไป — ฐานข้อมูลเติมให้จากวงเงินย่อยของบริษัทนั้น
            sort_order: i,
          })),
        );
        if (error) throw error;
      }

      // Upsert conditions
      const { error: condErr } = await supabase.from('ma_conditions').upsert({ ...cond, ma_id: maId! });
      if (condErr) throw condErr;

      // BR-LEASE-026/BR-LOAN-014/BR-FP-017/BR-PN-013 — Chassis Exclusive Rule (MoM Option B)
      // เช็คเฉพาะ Manual entry (รถลูกค้าค้ำ) — FA-linked = MCR Rental fleet (คนละ pool กับ Inventory ไม่ต้องเช็ค)
      // same bank → BLOCK · different bank → WARN
      const maWarnings: string[] = [];
      for (const c of collaterals) {
        if (c.type !== 'vehicle') continue;
        const source = (c.fields as any)?._source;
        if (source === 'fa_linked') continue; // skip — เป็น MCR Rental ไม่ใช่ Inventory chassis
        const chassisNo = (c.fields as any)?.chassis_no?.trim();
        if (!chassisNo) continue;
        const conflicts = await checkChassisConflict(chassisNo, undefined, undefined, ma.finance_institution);
        const { blockers, warnings } = classifyConflicts(conflicts);
        if (blockers.length > 0) {
          const msg = blockers.map((x) => `${x.module} ${x.contract_no} ของ ${x.bank || '?'} (${x.status})`).join(', ');
          throw new Error(`รถนี้ (${chassisNo}) ใน Collateral ใช้อยู่ใน: ${msg} — แบงก์เดียวกัน บันทึกไม่ได้`);
        }
        if (warnings.length > 0) {
          const msg = warnings.map((x) => `${x.module} ${x.contract_no} ของ ${x.bank || '?'}`).join(', ');
          maWarnings.push(`${chassisNo}: ${msg} (ต่างแบงก์)`);
        }
      }
      if (maWarnings.length > 0) {
        toast.warning(`Collateral ใช้รถที่อยู่ในสัญญา Active ต่างแบงก์ (ดำเนินการต่อได้):\n${maWarnings.join('\n')}`, { duration: 6000 });
      }

      // Replace collateral rows — column-based (migration 0067) + dual-write JSONB for rollback
      await supabase.from('ma_collaterals').delete().eq('ma_id', maId!);
      if (collaterals.length > 0) {
        const { error } = await supabase.from('ma_collaterals').insert(
          collaterals.map((c, i) => {
            const f = c.fields ?? {};
            const asNum = (v: any) => (v == null || v === '' ? null : Number(v));
            return {
              ma_id: maId!,
              type: c.type,
              // Flat columns
              asset_no:       f.asset_no        ?? null,
              doc_no:         f.doc_no          ?? null,
              location:       f.location        ?? null,
              value:          asNum(f.value),
              appraisal:      asNum(f.appraisal),
              appr_date:      f.appr_date       || null,
              mortgage_limit: asNum(f.mortgage_limit),
              chassis_no:     f.chassis_no      ?? null,
              vreg:           f.vreg            ?? null,
              vmodel:         f.vmodel          ?? null,
              pledge:         asNum(f.pledge),
              bank:           f.bank            ?? null,
              acct_no:        f.acct_no         ?? null,
              acct_name:      f.acct_name       ?? null,
              deposit_amt:    asNum(f.deposit_amt),
              pledge_amt:     asNum(f.pledge_amt),
              reg_no:         f.reg_no          ?? null,
              reg_limit:      asNum(f.reg_limit),
              desc_:          f.desc            ?? null,   // UI key desc → column desc_
              secured_limit:  asNum(f.secured_limit),
              source:         f._source         ?? 'manual',
              fields: c.fields,                              // legacy JSONB — safe fallback
              sort_order: i,
            };
          }),
        );
        if (error) throw error;
      }

      // Replace guarantor rows — column-based (migration 0066)
      await supabase.from('ma_guarantors').delete().eq('ma_id', maId!);
      if (guarantors.length > 0) {
        const { error } = await supabase.from('ma_guarantors').insert(
          guarantors.map((g, i) => ({
            ma_id: maId!,
            type: g.type,
            name: g.name ?? null,
            company_name: g.company_name ?? null,
            id_card_or_tax_id: g.id_card_or_tax_id ?? null,
            position: g.position ?? null,
            amount: g.amount ?? null,
            expiry_date: g.expiry_date || null,
            phone: g.phone ?? null,
            address: g.address ?? null,
            remark: g.remark ?? null,
            sort_order: i,
          })),
        );
        if (error) throw error;
      }

      return maId;
    },
    onSuccess: (newId) => {
      logSave('master_agreements', newId ?? id, ma.ma_name, mode === 'new');
      qc.invalidateQueries({ queryKey: ['ma-list'] });
      qc.invalidateQueries({ queryKey: ['ma', newId] });
      toast.success(mode === 'new' ? '✓ สร้าง Master Agreement แล้ว' : '✓ บันทึกการแก้ไขแล้ว');
      if (mode === 'new' && newId) navigate(`/ma/${newId}`);
    },
    onError: (e: any) => toast.error(friendlySaveError(e)),
  });

  // ---------- ต้องมีเลขอ้างอิงของสัญญาก่อนจึงแนบไฟล์ได้ ----------
  // เดิมแนบไฟล์ตอนยังไม่ได้บันทึก ระบบจะแอบสร้างสัญญาชื่อขึ้นต้นว่า DRAFT- ให้เงียบๆ
  // ผู้ใช้กดยกเลิกต่อ รายการชื่อประหลาดจึงค้างอยู่ในระบบโดยไม่มีใครรู้
  // ตอนนี้บังคับให้กรอกช่องที่จำเป็นครบก่อน แล้วบันทึกเป็นสัญญาจริง พร้อมแจ้งผู้ใช้ว่าบันทึกให้แล้ว
  const ensureMaId = async (): Promise<string> => {
    if (id) return id;
    if (!checkRequiredFields()) throw new Error('กรอกข้อมูลที่จำเป็นให้ครบก่อนแนบไฟล์');
    toast.info('ยังไม่ได้บันทึกสัญญา — ระบบบันทึกให้ก่อนแนบไฟล์');
    const savedId = await save.mutateAsync();
    if (!savedId) throw new Error('บันทึกสัญญาไม่สำเร็จ — ลองใหม่อีกครั้ง');
    return savedId;
  };

  const titleNo = mode === 'new' ? 'New Master Agreement' : ma.ma_name || 'Loading...';
  const cas = existing?.cas ?? [];

  return (
    <ScopeGuard
      skip={mode === 'new'}
      subsidiary={mode === 'edit' ? (existing ? ma.subsidiary : undefined) : ma.subsidiary}
      allocated={subs.map((x) => x.subsidiary)}
    >
    <ReadOnlyContext.Provider value={readOnly || approvedLock}>
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/ma')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Master Agreement</h1>
          <p className="text-muted text-sm font-medium">{titleNo}</p>
        </div>
        <Button variant="primary" disabled={save.isPending || readOnly || approvedLock} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={() => navigate('/ma')}>Cancel</Button>
      </div>

      <AuditFooter
        createdBy={(ma as any).created_by}
        createdAt={(ma as any).created_at}
        updatedBy={(ma as any).updated_by}
        updatedAt={(ma as any).updated_at}
      />

      {/* ========== PRIMARY INFORMATION ========== */}
      <Section title="Primary Information" open={openPrim} onToggle={() => setOpenPrim((o) => !o)}>
        <ApprovalNote remark={ma.remark} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4 mt-3">
          <Field label="MASTER AGREEMENT NAME" required>
            <Input
              value={ma.ma_name}
              onChange={(e) => setMa((m) => ({ ...m, ma_name: e.target.value }))}
              placeholder="MGC-HP-2024-001"
            />
          </Field>
          <Field label="FINANCE INSTITUTION" required>
            <Select
              value={ma.finance_institution}
              onChange={(e) => setMa((m) => ({ ...m, finance_institution: e.target.value }))}
            >
              <option value="">— เลือกสถาบันการเงิน —</option>
              {bankCodes.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </Select>
          </Field>
          <Field label="SUBSIDIARY" required>
            <Select
              value={ma.subsidiary}
              onChange={(e) => setMa((m) => ({ ...m, subsidiary: e.target.value }))}
            >
              {!ma.subsidiary && <option value="">— เลือก —</option>}
              {mySubCodes.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>

          <Field label="START DATE" required>
            <Input type="date" value={ma.start_date} onChange={(e) => setMa((m) => ({ ...m, start_date: e.target.value }))} />
          </Field>
          <Field label="END DATE" required>
            <Input type="date" value={ma.end_date} onChange={(e) => setMa((m) => ({ ...m, end_date: e.target.value }))} />
          </Field>
          <Field label="STATUS" required>
            <ReadOnlyContext.Provider value={readOnly}>
              <Select value={ma.status} onChange={(e) => setMa((m) => ({ ...m, status: e.target.value as any }))}
                disabled={ma.status === PENDING_STATUS && !can('ma', 'approve')}>
                {filterStatusOptions(MA_STATUS, ma.status, can('ma', 'approve')).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </ReadOnlyContext.Provider>
            <div className="mt-2">
              <ApprovalActions menuKey="ma" table="master_agreements" id={id} status={ma.status}
                onChanged={(s) => { setMa((m) => ({ ...m, status: s as any })); qc.invalidateQueries({ queryKey: ['ma', id] }); qc.invalidateQueries({ queryKey: ['ma-list'] }); }} />
              <ApprovalTrail table="master_agreements" id={id} refreshKey={ma.status} />
            </div>
          </Field>
        </div>
      </Section>

      {/* ========== CREDIT LINE INFORMATION ========== */}
      <Section title="Credit Line Information" open={openCredit} onToggle={() => setOpenCredit((o) => !o)}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Field label="CREDIT LINE" required>
            <NumInput
              value={ma.credit_line}
              onChange={(v) => setMa((m) => ({ ...m, credit_line: v }))}
            />
            {!subAllocOK && subs.length > 0 && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠ Σ Sub-allocation ({fmtMoney(subTotal)}) เกิน Credit Line ({fmtMoney(ma.credit_line)}) — จัดสรรรวมต้องไม่เกินวงเงิน
              </p>
            )}
          </Field>
          <Field label="UTILIZATION">
            <Input readOnly value={fmtMoney(subUtilTotal)} className="bg-gray-50 text-right tabular-nums" />
          </Field>
          <Field label="REMAINING CREDIT LINE">
            <Input
              readOnly
              value={fmtMoney(ma.credit_line - subUtilTotal)}
              className="bg-gray-50 text-right tabular-nums"
            />
          </Field>
        </div>

        {/* Parent-Child Subsidiary table */}
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead className="bg-brand text-white">
              <tr>
                <th className="w-16 !text-white !bg-brand"></th>
                <th className="!text-white !bg-brand">Parent-Child (SUBSIDIARY)</th>
                <th className="!text-white !bg-brand text-right">CREDIT LINE</th>
                <th className="!text-white !bg-brand text-right">UTILIZATION</th>
                <th className="!text-white !bg-brand text-right">REMAINING CREDIT LINE</th>
                <th className="w-20 !text-white !bg-brand"></th>
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-6">
                    ยังไม่มี Sub-allocation — กด "+ Add Subsidiary"
                  </td>
                </tr>
              )}
              {subs.map((s, i) => (
                <tr key={i}>
                  <td>
                    <button type="button" className="text-brand text-xs hover:underline">
                      Edit
                    </button>
                  </td>
                  <td>
                    <Select
                      value={s.subsidiary}
                      onChange={(e) =>
                        setSubs((arr) => arr.map((x, j) => (j === i ? { ...x, subsidiary: e.target.value } : x)))
                      }
                    >
                      {!s.subsidiary && <option value="">— เลือก —</option>}
                      {/* ตัดบริษัทที่แถวอื่นเลือกไปแล้วออก — หนึ่งบริษัทมีได้แถวเดียว
                          ถ้าจะแบ่งวงเงินให้บริษัทเดิมเพิ่ม ให้แก้ตัวเลขในแถวเดิม */}
                      {subCodes
                        .filter((c) => c === s.subsidiary || !subs.some((x, j) => j !== i && x.subsidiary === c))
                        .map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                    </Select>
                  </td>
                  <td>
                    <NumInput
                      step="0.01"
                      value={s.credit_line}
                      onChange={(v) =>
                        setSubs((arr) =>
                          arr.map((x, j) =>
                            j === i ? { ...x, credit_line: v } : x,
                          ),
                        )
                      }
                      className="text-right tabular-nums"
                    />
                  </td>
                  {/* ยอดใช้วงเงินคำนวณจากวงเงินที่เปิดใต้บริษัทนี้ — แก้เองไม่ได้ เหมือนช่องยอดคงเหลือข้างๆ */}
                  <td className="text-right tabular-nums px-3" title="รวมจากวงเงินที่เปิดใต้บริษัทนี้">
                    {fmtMoney(utilOf(s.subsidiary))}
                  </td>
                  <td className="text-right tabular-nums px-3">
                    {fmtMoney(s.credit_line - utilOf(s.subsidiary))}
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        // ห้ามเอาออกถ้ายังมีวงเงินย่อยใช้โควตาของบริษัทนี้อยู่
                        // ไม่งั้นวงเงินย่อยจะลอย ไม่มีโควตารองรับ
                        const blocked = removalBlockedReason(cas, s.subsidiary);
                        if (blocked) { toast.error(blocked, { duration: 9000 }); return; }
                        // ไม่ถามยืนยัน — ปุ่ม Save เป็นด่านจริงอยู่แล้ว แถวหายแค่บนหน้าจอ
                        // ยังไม่แตะฐานข้อมูลจนกว่าจะกด Save · กดพลาดก็โหลดหน้าใหม่ได้
                        setSubs((arr) => arr.filter((_, j) => j !== i));
                      }}
                      title={removalBlockedReason(cas, s.subsidiary) ?? ''}
                      className="text-danger text-xs hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Button
            variant="primary"
            size="sm"
            disabled={noSubLeft}
            title={noSubLeft ? 'เลือกครบทุกบริษัทแล้ว — หนึ่งบริษัทมีได้แถวเดียว' : ''}
            onClick={() =>
              setSubs((arr) => [
                ...arr,
                {
                  id: crypto.randomUUID(),
                  ma_id: ma.id,
                  // แถวใหม่ต้องว่างไว้ให้เลือกเอง — เดิมเติมบริษัทตัวแรกในรายการให้
                  // ทำให้กด Add แล้วบันทึกเลย จะได้บริษัทที่ไม่มีใครตั้งใจเลือก
                  subsidiary: '',
                  credit_line: 0,
                  utilization: 0,
                  remaining: 0,
                  sort_order: arr.length,
                },
              ])
            }
          >
            <Plus className="w-4 h-4" /> Add Subsidiary
          </Button>
        </div>
      </Section>

      {/* ========== TABS ========== */}
      <div className="flex border-b border-line mb-0 mt-6">
        {(
          [
            ['condition', 'Condition'],
            ['collateral', 'Collateral'],
            ['guarantee', 'Guarantee'],
            ['details', 'Details Credit Agreement'],
            ['files', 'Document'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition',
              tab === key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="rounded-t-none">
        <CardContent>
          {tab === 'condition' && <ConditionPane cond={cond} setCond={setCond} />}
          {tab === 'collateral' && <CollateralCards items={collaterals} onChange={setCollaterals} />}
          {tab === 'guarantee' && (
            <div>
              {/* ลบผู้ค้ำประกันจนหมด → ล้างหมายเหตุท้ายแท็บด้วย เพราะเป็นหมายเหตุของชุดผู้ค้ำประกัน */}
              <GuarantorCards
                items={guarantors}
                onChange={(list) => { setGuarantors(list); if (list.length === 0) setGuarRemark(''); }}
              />
              <div className="mt-6">
                <FieldLabel>REMARK</FieldLabel>
                <textarea maxLength={2000}
                  className="input min-h-[80px]"
                  value={guarRemark}
                  onChange={(e) => setGuarRemark(e.target.value)}
                  placeholder="เงื่อนไขพิเศษ เช่น ค้ำแบบ Joint and Several หรือ Limited"
                />
                <CharCount value={guarRemark} max={2000} />
              </div>
            </div>
          )}
          {tab === 'details' && <DetailsPane cas={cas} />}
          {tab === 'files' && <DocumentTab maId={id} ensureMaId={ensureMaId} /> }
        </CardContent>
      </Card>
    </div>
    </ReadOnlyContext.Provider>
    </ScopeGuard>
  );
}

// =====================================================================
// Reusable bits
// =====================================================================
function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-4">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-5 py-3 border-b border-line text-left font-semibold text-sm tracking-wide bg-soft hover:bg-gray-100"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {title}
      </button>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="field-label flex items-center">
        <span className="tracking-wide">{label}</span>
        {required && (
          <span
            title="จำเป็นต้องกรอก"
            className="ml-1 mb-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/90 ring-2 ring-red-100"
          />
        )}
        <Help label={label} />
      </div>
      {children}
    </div>
  );
}

function Help({ title, label }: { title?: string; label?: string }) {
  // Resolve from TOOLTIPS dictionary by label (case-variants), fallback to title prop.
  const key = (label ?? '').replace(/\s*\*+\s*$/, '').trim();
  const tip = TOOLTIPS[key] ?? TOOLTIPS[key.toUpperCase()] ?? title;
  if (!tip) return null;
  return (
    <span className="relative inline-flex group ml-1">
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-[10px] text-gray-600 cursor-help group-hover:bg-brand group-hover:text-white transition">
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 hidden group-hover:block whitespace-normal w-max max-w-xs bg-gray-900 text-white text-xs leading-relaxed px-3 py-2 rounded shadow-lg"
      >
        {tip}
        <span className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-gray-900 rotate-45 -mt-1"></span>
      </span>
    </span>
  );
}

// =====================================================================
// Tab panes
// =====================================================================
function ConditionPane({
  cond,
  setCond,
}: {
  cond: MACondition;
  setCond: React.Dispatch<React.SetStateAction<MACondition>>;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Field label="D/E RATIO">
          <div className="flex items-center gap-2">
            <Select
              className="!w-20"
              value={cond.de_op ?? '<='}
              onChange={(e) => setCond((c) => ({ ...c, de_op: e.target.value as any }))}
            >
              {RATIO_OPS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
            <NumInput
              step="0.1"
              value={cond.de_value ?? 0}
              onChange={(v) => setCond((c) => ({ ...c, de_value: v || null }))}
              className="text-right tabular-nums"
            />
            <span className="text-sm text-muted whitespace-nowrap">เท่า</span>
          </div>
        </Field>
        <Field label="DSCR RATIO">
          <div className="flex items-center gap-2">
            <Select
              className="!w-20"
              value={cond.dscr_op ?? '>='}
              onChange={(e) => setCond((c) => ({ ...c, dscr_op: e.target.value as any }))}
            >
              {RATIO_OPS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
            <NumInput
              step="0.1"
              value={cond.dscr_value ?? 0}
              onChange={(v) => setCond((c) => ({ ...c, dscr_value: v || null }))}
              className="text-right tabular-nums"
            />
            <span className="text-sm text-muted whitespace-nowrap">เท่า</span>
          </div>
        </Field>
        <Field label="OTHER REQUIREMENT">
          <textarea maxLength={2000}
            className="input min-h-[110px]"
            value={cond.other_requirement ?? ''}
            onChange={(e) => setCond((c) => ({ ...c, other_requirement: e.target.value }))}
          />
          <CharCount value={cond.other_requirement ?? ''} max={2000} />
        </Field>
      </div>
      <div>
        <Field label="CONSENT / WAIVER">
          <textarea maxLength={2000}
            className="input min-h-[200px]"
            value={cond.consent_waiver ?? ''}
            onChange={(e) => setCond((c) => ({ ...c, consent_waiver: e.target.value }))}
          />
          <CharCount value={cond.consent_waiver ?? ''} max={2000} />
        </Field>
      </div>
    </div>
  );
}

function DetailsPane({ cas }: { cas: CreditAgreement[] }) {
  if (cas.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <p className="text-sm">ยังไม่มี Credit Agreement ภายใต้ MA นี้</p>
        <p className="text-xs mt-1">
          ไปที่ <a className="text-brand underline" href="/ca">Credit Agreement</a> เพื่อเพิ่ม
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>NAME</th>
            <th>CONTRACT NUMBER</th>
            <th>SUBSIDIARY</th>
            <th>START DATE</th>
            <th>END DATE</th>
            <th className="text-right">CREDIT LINE</th>
            <th className="text-right">UTILIZATION</th>
            <th className="text-right">REMAINING CREDIT LINE</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {cas.map((c) => (
            <tr key={c.id}>
              <td className="text-brand font-medium">{c.ca_name}</td>
              <td>{c.contract_number}</td>
              <td>{c.subsidiary}</td>
              <td>{fmtDate(c.start_date)}</td>
              <td>{fmtDate(c.end_date)}</td>
              <td className="text-right tabular-nums">{fmtMoney(c.credit_line)}</td>
              <td className="text-right tabular-nums">{fmtMoney(c.utilization)}</td>
              <td className="text-right tabular-nums">{fmtMoney(c.remaining)}</td>
              <td>
                <Badge variant={c.status === 'Approved' ? 'success' : 'default'}>{c.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

