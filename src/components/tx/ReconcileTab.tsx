// Facility Reconcile Tab — Feature C3 (polymorphic across Loan-side facilities)
// ---------------------------------------------------------------
// Workshop guidance (3.txt §3-75):
//   "Loan" in MoM = ทุก Loan-side facility ที่รอ Bank Statement (T+2):
//     Loan, PN, FP, OD, TR (Lease/HP excluded — schedule-driven)
//
// Parent Detail page passes in:
//   - facilityType + facilityId + facilityNo (for JE tag)
//   - schedule: [{ period, due_date, principal, interest, payment, paid? }]
// The tab handles: bank confirm lookup, diff row highlighting, Adjust dialog,
// refund tracking. Schedule loading stays with each module (they all differ).

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box, Card, CardContent, Typography, Stack, TextField, MenuItem, Button, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Dialog, DialogTitle, DialogContent, DialogActions, Link as MuiLink,
  FormControlLabel, Checkbox,
} from '@mui/material';
import { Wrench as WrenchIcon, CheckCircle2 as CheckIcon } from 'lucide-react';
import { toast } from 'sonner';
import { NumInput, HelpDot } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { fetchBankConfirmed, type FacilityType } from '@/lib/bank-statement-match';
import {
  postFacilityAdjustment,
  listFacilityAdjustments,
  markRefundReceived,
  type LoanAdjustReason,
  type FacilityAdjustment,
  type AdjustFacilityType,
} from '@/lib/facility-adjust';

export interface ReconcileScheduleRow {
  id: string;
  period: number;
  due_date: string;
  principal: number;
  interest: number;
  payment: number;
  paid?: boolean;
}

interface Props {
  facilityType: AdjustFacilityType;
  facilityId: string;
  facilityNo?: string;
  /** Schedule computed/queried by the parent Detail page (fields shape-mapped to ReconcileScheduleRow). */
  schedule: ReconcileScheduleRow[];
  /** Optional label under the header — e.g. "งวด/รอบดอกเบี้ย" per module. */
}

const REASON_LABEL: Record<LoanAdjustReason, string> = {
  rate_change: 'อัตราดอกเบี้ยเปลี่ยนกลางงวด',
  day_diff: 'วันตัดต่างจาก schedule',
  bank_overcut: 'ธนาคารตัดเกิน',
  other: 'อื่นๆ',
};

// bank_statement_match uses slightly different facility labels
const BANK_FACILITY_MAP: Record<AdjustFacilityType, FacilityType> = {
  Loan: 'Loan',
  PN: 'P/N',
  FP: 'FP',
  OD: 'OD',
  TR: 'TR',
};

// รหัสเมนูสำหรับตรวจสิทธิ์ — ต้องตรงกับโมดูลที่เปิดแท็บนี้ ไม่ใช่เมนูรวม
const MENU_KEY_MAP: Record<AdjustFacilityType, string> = {
  Loan: 'loan',
  PN: 'pn',
  FP: 'fp',
  OD: 'od',
  TR: 'tr',
};

/** หัวคอลัมน์พร้อมจุด ? อธิบาย — ตารางนี้มีศัพท์ที่ตีความได้หลายแบบ
 *  โดยเฉพาะคำว่า Principal ที่แท็บอื่นหมายถึงยอดคงค้าง แต่ที่นี่หมายถึงยอดที่ต้องคืนงวดนี้ */
function Th({ label, tip, align }: { label: string; tip: string; align?: 'right' | 'left' }) {
  return (
    <TableCell align={align}>
      <Box
        component="span"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}
      >
        {label}
        <HelpDot tip={tip} />
      </Box>
    </TableCell>
  );
}

export function ReconcileTab({ facilityType, facilityId, facilityNo, schedule }: Props) {
  const qc = useQueryClient();
  // เดิมแท็บนี้ไม่ตรวจอะไรเลย — โหมดดูอย่างเดียวก็ยังกดปรับปรุงและสร้างใบสำคัญได้
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const locked = viewOnly || !can(MENU_KEY_MAP[facilityType], 'edit');

  // Bank confirmed lines (indexed by period)
  const { data: bankLines } = useQuery({
    queryKey: ['reconcile-bank-confirmed', facilityType, facilityId],
    queryFn: () => fetchBankConfirmed(BANK_FACILITY_MAP[facilityType], facilityId),
  });

  // Adjustment history
  const { data: adjustments = [] } = useQuery({
    queryKey: ['reconcile-adjustments', facilityType, facilityId],
    queryFn: () => listFacilityAdjustments(facilityType, facilityId),
  });

  const adjByPeriod = useMemo(() => {
    const m = new Map<number, FacilityAdjustment>();
    adjustments.forEach((a) => {
      const prev = m.get(a.period);
      if (!prev || a.created_at > prev.created_at) m.set(a.period, a);
    });
    return m;
  }, [adjustments]);

  const [dialogRow, setDialogRow] = useState<ReconcileScheduleRow | null>(null);
  const [refundRow, setRefundRow] = useState<FacilityAdjustment | null>(null);
  const [refundDate, setRefundDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['reconcile-adjustments', facilityType, facilityId] });
    qc.invalidateQueries({ queryKey: ['je-list'] });
  };

  const refundReceive = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => {
      if (locked) throw new Error('ไม่มีสิทธิ์แก้ไข หรืออยู่ในโหมดดูอย่างเดียว');
      return markRefundReceived(id, date);
    },
    onSuccess: () => {
      toast.success('บันทึกวันรับเงินคืนแล้ว');
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? 'save failed'),
  });

  /** ยอดเงินในตาราง — ศูนย์แสดงเป็นขีด เพราะ 0.00 ทำให้เข้าใจผิดว่าคำนวณพลาด
   *  เช่นตั๋วสัญญาใช้เงินไม่ตัดเงินต้นระหว่างทาง งวด 1-3 จึงไม่มีเงินต้น */
  const money = (n: number | null | undefined) =>
    !n || Math.abs(n) < 0.005 ? '—' : fmtMoney(n, { decimals: 2 });

  return (
    <Box>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {/* ต้องมีคำว่า Due — เป็น "ยอดที่ต้องชำระงวดนี้" ไม่ใช่ยอดคงค้าง
                      แท็บตารางดอกเบี้ยมี Principal Bal. ที่เป็นยอดคงค้าง ถ้าเรียกสั้นว่า Principal
                      เหมือนกันจะสับสนทันที เพราะตั๋วสัญญาใช้เงินคงเงินต้นไว้ตลอด แต่คืนทีเดียวงวดท้าย */}
                  <Th label="Period" tip="งวดที่เท่าไรของสัญญา นับจากวันเบิกเงิน" />
                  <Th label="Due Date" tip="วันครบกำหนดชำระของงวดนี้" />
                  <Th
                    align="right"
                    label="Principal Due"
                    tip={'เงินต้นที่ต้องคืนในงวดนี้ ไม่ใช่ยอดคงค้าง · ' +
                      'ตั๋วสัญญาใช้เงินและทรัสต์รีซีทคืนเงินต้นทีเดียวตอนครบกำหนด งวดระหว่างทางจึงเป็นขีด · ' +
                      'ถ้าอยากดูยอดคงค้างให้ไปที่แท็บตารางดอกเบี้ย คอลัมน์ Principal Bal.'}
                  />
                  <Th
                    align="right"
                    label="Interest Due"
                    tip="ดอกเบี้ยของงวดนี้ตามตาราง คิดจากยอดคงค้าง × อัตรา × จำนวนวันจริง ÷ 365"
                  />
                  <Th align="right" label="Total Due" tip="เงินต้นบวกดอกเบี้ยที่ต้องชำระในงวดนี้" />
                  <Th
                    align="right"
                    label="Bank Amount"
                    tip="ยอดที่ธนาคารตัดจริง ดึงจากใบแจ้งยอดที่ผูกกับงวดนี้ · ขีดแปลว่ายังไม่มีรายการเข้ามา"
                  />
                  <Th
                    align="right"
                    label="Diff"
                    tip="ยอดที่ธนาคารตัด ลบ ยอดที่ต้องชำระ · เป็นบวกแปลว่าตัดเกิน เป็นลบแปลว่าตัดขาด"
                  />
                  <Th
                    label="Status"
                    tip={'Unpaid ยังไม่มีรายการจากธนาคาร · Bank Confirmed ธนาคารตัดแล้วยอดตรง · ' +
                      'Adjusted แก้สัดส่วนเงินต้นกับดอกเบี้ยแล้ว'}
                  />
                  <Th
                    align="right"
                    label="Action"
                    tip="กด Adjust เมื่อธนาคารแบ่งเงินต้นกับดอกเบี้ยไม่ตรงกับตาราง เพื่อบันทึกสัดส่วนที่ถูกต้อง"
                  />
                </TableRow>
              </TableHead>
              <TableBody>
                {schedule.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
                      ยังไม่มี Schedule
                    </TableCell>
                  </TableRow>
                )}
                {schedule.map((r) => {
                  const bank = bankLines?.byPeriod.get(r.period);
                  const bankAmt = bank ? Number(bank.amount) : null;
                  const diff = bankAmt != null ? bankAmt - r.payment : 0;
                  const adjusted = adjByPeriod.get(r.period);

                  const state: 'unpaid' | 'bank_matched' | 'adjusted' | 'overcut' =
                    adjusted
                      ? adjusted.refund_pending
                        ? 'overcut'
                        : 'adjusted'
                      : bank
                        ? 'bank_matched'
                        : 'unpaid';

                  const rowBg =
                    state === 'overcut' ? 'rgba(255, 152, 0, 0.08)'
                    : state === 'adjusted' ? 'rgba(76, 175, 80, 0.05)'
                    : bank && Math.abs(diff) > 0.01 ? 'rgba(255, 235, 59, 0.10)'
                    : 'inherit';

                  return (
                    <TableRow key={r.id} sx={{ backgroundColor: rowBg }}>
                      <TableCell>{r.period}</TableCell>
                      <TableCell>{fmtDate(r.due_date)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {money(adjusted?.adjusted_principal ?? r.principal)}
                        {adjusted && (
                          <Box sx={{ fontSize: 10, color: 'text.disabled', textDecoration: 'line-through' }}>
                            {money(r.principal)}
                          </Box>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {money(adjusted?.adjusted_interest ?? r.interest)}
                        {adjusted && (
                          <Box sx={{ fontSize: 10, color: 'text.disabled', textDecoration: 'line-through' }}>
                            {money(r.interest)}
                          </Box>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                        {fmtMoney(r.payment, { decimals: 2 })}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {bank ? (
                          <MuiLink
                            component={Link}
                            to={`/master/bank-statement/${bank.bank_statement_id}`}
                            underline="hover"
                          >
                            {fmtMoney(bankAmt as number, { decimals: 2 })}
                          </MuiLink>
                        ) : (
                          <Box sx={{ color: 'text.disabled' }}>—</Box>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{
                        fontVariantNumeric: 'tabular-nums',
                        color: Math.abs(diff) < 0.01 ? 'text.disabled' : diff > 0 ? 'warning.dark' : 'error.main',
                        fontWeight: 500,
                      }}>
                        {bank ? (diff >= 0 ? '+' : '') + fmtMoney(diff, { decimals: 2 }) : '—'}
                      </TableCell>
                      <TableCell>
                        {state === 'overcut' && <Chip size="small" label="แบงก์ตัดเกิน" color="warning" />}
                        {state === 'adjusted' && (
                          <Chip size="small" label="Adjusted" color="success" icon={<CheckIcon size={12} />} />
                        )}
                        {state === 'bank_matched' && <Chip size="small" label="Bank Confirmed" color="primary" />}
                        {state === 'unpaid' && <Chip size="small" label="Unpaid" />}
                      </TableCell>
                      <TableCell align="right">
                        {bank && (
                          <Button
                            size="small"
                            startIcon={<WrenchIcon size={14} />}
                            variant={adjusted ? 'outlined' : 'contained'}
                            disabled={locked}
                            title={locked ? 'ไม่มีสิทธิ์แก้ไข หรืออยู่ในโหมดดูอย่างเดียว' : undefined}
                            onClick={() => setDialogRow(r)}
                          >
                            {adjusted ? 'Re-adjust' : 'Adjust'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {adjustments.some((a) => a.refund_pending) && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography sx={{ fontWeight: 700, mb: 1 }}>💰 Refund Pending (แบงก์ค้างคืน)</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>งวด</TableCell>
                    <TableCell align="right">ยอดที่ค้างคืน</TableCell>
                    <TableCell>วันที่ Adjust</TableCell>
                    <TableCell>Note</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {adjustments.filter((a) => a.refund_pending).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.period}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMoney(a.refund_amount, { decimals: 2 })}
                      </TableCell>
                      <TableCell>{fmtDate(a.created_at)}</TableCell>
                      <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>{a.notes ?? '—'}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          disabled={locked}
                          title={locked ? 'ไม่มีสิทธิ์แก้ไข หรืออยู่ในโหมดดูอย่างเดียว' : undefined}
                          onClick={() => {
                            setRefundRow(a);
                            setRefundDate(new Date().toISOString().slice(0, 10));
                          }}
                        >
                          ได้รับแล้ว
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      <Dialog open={refundRow != null} onClose={() => setRefundRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle>💰 บันทึกวันที่ได้รับเงินคืนจากธนาคาร</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {refundRow && (
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.secondary">งวดที่แบงก์ตัดเกิน</Typography>
                  <Typography>งวด {refundRow.period} · ยอด {fmtMoney(refundRow.refund_amount, { decimals: 2 })} บาท</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    Adjust เมื่อ {fmtDate(refundRow.created_at)}
                    {refundRow.notes ? ` · ${refundRow.notes}` : ''}
                  </Typography>
                </CardContent>
              </Card>
            )}
            <TextField
              type="date"
              label="วันที่ได้รับเงินคืน"
              value={refundDate}
              onChange={(e) => setRefundDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              autoFocus
            />
            <Typography variant="caption" color="text.secondary">
              ธนาคารมักคืนเงินภายใน 2-3 วัน ถึง 1 สัปดาห์
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRefundRow(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!refundDate || refundReceive.isPending}
            onClick={() => {
              if (refundRow) {
                refundReceive.mutate(
                  { id: refundRow.id, date: refundDate },
                  { onSuccess: () => setRefundRow(null) },
                );
              }
            }}
          >
            {refundReceive.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogActions>
      </Dialog>

      <AdjustDialog
        row={dialogRow}
        bankAmount={dialogRow ? Number(bankLines?.byPeriod.get(dialogRow.period)?.amount ?? dialogRow.payment) : 0}
        bankLineId={dialogRow ? bankLines?.byPeriod.get(dialogRow.period)?.id ?? null : null}
        facilityType={facilityType}
        facilityId={facilityId}
        facilityNo={facilityNo}
        locked={locked}
        onClose={() => setDialogRow(null)}
        onDone={refresh}
      />
    </Box>
  );
}

// ────────────────────────────────────────────────────────────────
// Adjust dialog
// ────────────────────────────────────────────────────────────────
function AdjustDialog({
  row, bankAmount, bankLineId, facilityType, facilityId, facilityNo, locked, onClose, onDone,
}: {
  row: ReconcileScheduleRow | null;
  bankAmount: number;
  bankLineId: string | null;
  facilityType: AdjustFacilityType;
  facilityId: string;
  facilityNo?: string;
  locked: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const isOvercut = row ? bankAmount - row.payment > 0.005 : false;
  // ไม่เลือกเหตุผลล่วงหน้า — คนกดต้องเลือกเองก่อนบันทึก ไม่งั้นจะได้เหตุผลมั่วติดไปกับใบสำคัญ
  const [reason, setReason] = useState<LoanAdjustReason | ''>('');
  const [newP, setNewP] = useState<number>(row?.principal ?? 0);
  const [newI, setNewI] = useState<number>(row?.interest ?? 0);
  const [refundPending, setRefundPending] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useMemo(() => {
    if (row) {
      setNewP(row.principal);
      setNewI(row.interest);
      setRefundPending(isOvercut);
      setReason(isOvercut ? 'bank_overcut' : '');   // ตัดเกินมีเหตุผลเดียว เลือกให้ได้
      setNotes('');
    }
  }, [row?.id]);

  if (!row) return null;
  const r = row;

  const origTotal = round2(r.payment);
  const bankTotal = round2(bankAmount);
  const newTotal = round2(newP + newI);
  const refundAmount = isOvercut ? round2(bankTotal - origTotal) : 0;

  const reallocTotal = origTotal;
  const totalMatches = Math.abs(newTotal - reallocTotal) < 0.01;

  /** แก้ช่องหนึ่ง อีกช่องปรับให้เอง — ยอดรวมคงเดิมเสมอ
   *  เดิมต้องบวกเลขเองให้ครบพอดี ซึ่งพลาดง่ายและกดบันทึกไม่ได้จนกว่าจะตรง */
  const editPrincipal = (v: number) => {
    const p = Math.max(0, Math.min(round2(v), reallocTotal));
    setNewP(p);
    setNewI(round2(reallocTotal - p));
  };
  const editInterest = (v: number) => {
    const i = Math.max(0, Math.min(round2(v), reallocTotal));
    setNewI(i);
    setNewP(round2(reallocTotal - i));
  };
  const isChanged =
    Math.abs(newP - r.principal) > 0.005 || Math.abs(newI - r.interest) > 0.005;

  async function save() {
    if (locked) {
      toast.error('ไม่มีสิทธิ์แก้ไข หรืออยู่ในโหมดดูอย่างเดียว');
      return;
    }
    if (!reason) {
      toast.error('เลือกเหตุผลก่อนบันทึก');
      return;
    }
    if (!totalMatches) {
      toast.error(`ยอดรวมต้องเท่ากับ ${fmtMoney(reallocTotal, { decimals: 2 })}`);
      return;
    }
    setSaving(true);
    try {
      await postFacilityAdjustment({
        facility_type: facilityType,
        facility_id: facilityId,
        facility_no: facilityNo,
        period: r.period,
        bank_statement_line_id: bankLineId,
        original_principal: r.principal,
        original_interest: r.interest,
        adjusted_principal: newP,
        adjusted_interest: newI,
        reason: reason as LoanAdjustReason,
        refund_pending: isOvercut ? refundPending : false,
        refund_amount: refundAmount,
        notes: notes || undefined,
      });
      toast.success(`✓ Adjust งวด ${r.period} แล้ว · สร้าง JE reallocation`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Adjust Payment Split — {facilityType} Period {r.period}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Due {fmtDate(r.due_date)}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* ประโยคเดียวที่บอกว่าจอนี้มีไว้ทำอะไร — เดิมไม่มี คนเปิดมาแล้วไม่รู้ว่าต้องแก้อะไร */}
          <Typography variant="body2" color="text.secondary">
            ธนาคารตัด <strong>{fmtMoney(bankTotal, { decimals: 2 })}</strong>{' '}
            {isOvercut ? 'มากกว่ายอดตามตาราง' : 'เท่ากับยอดตามตาราง'} ·
            แก้สัดส่วนเงินต้นกับดอกเบี้ยในช่อง Adjusted ให้ตรงกับใบแจ้งยอด โดยยอดรวมต้องเท่าเดิม
          </Typography>

          {/* ตามตาราง กับ ช่องแก้ วางคู่กัน จะได้เห็นทันทีว่าต่างตรงไหน */}
          {/* เส้นคั่นกลาง แยกฝั่งตารางกับฝั่งที่แก้ได้ให้ขาดจากกันชัดๆ */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: '96px minmax(110px, 1fr) 1px minmax(150px, 1fr)',
            columnGap: 2.5,
            rowGap: 1.5,
            alignItems: 'center',
          }}>
            <Box sx={{ gridColumn: 3, gridRow: '1 / span 3', bgcolor: 'divider', width: '1px', height: '100%' }} />
            <Box sx={{ gridColumn: 1, gridRow: 1 }} />
            <Typography variant="caption" color="text.secondary" sx={{ gridColumn: 2, textAlign: 'right' }}>
              Schedule
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ gridColumn: 4 }}>
              Adjusted
            </Typography>

            <Typography variant="body2" sx={{ gridColumn: 1 }}>Principal Due</Typography>
            <Typography sx={{ gridColumn: 2, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {!r.principal || Math.abs(r.principal) < 0.005 ? '—' : fmtMoney(r.principal, { decimals: 2 })}
            </Typography>
            <Box sx={{ gridColumn: 4 }}>
              <NumInput value={newP} onChange={editPrincipal} step="0.01" decimals={2} />
            </Box>

            <Typography variant="body2" sx={{ gridColumn: 1 }}>Interest Due</Typography>
            <Typography sx={{ gridColumn: 2, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {fmtMoney(r.interest, { decimals: 2 })}
            </Typography>
            <Box sx={{ gridColumn: 4 }}>
              <NumInput value={newI} onChange={editInterest} step="0.01" decimals={2} />
            </Box>

            <Box sx={{ gridColumn: '1 / -1', borderTop: 1, borderColor: 'divider' }} />

            <Typography variant="body2" sx={{ gridColumn: 1, fontWeight: 600 }}>Total Due</Typography>
            <Typography sx={{ gridColumn: 2, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {fmtMoney(origTotal, { decimals: 2 })}
            </Typography>
            <Typography
              sx={{
                gridColumn: 4,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: totalMatches ? 'success.dark' : 'error.dark',
              }}
            >
              {fmtMoney(newTotal, { decimals: 2 })} {totalMatches ? '✓' : '✗'}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">
              แก้ช่องใดช่องหนึ่ง อีกช่องจะปรับให้อัตโนมัติ ยอดรวมคงเดิม
            </Typography>
            {isChanged && (
              <Button
                size="small"
                onClick={() => { setNewP(r.principal); setNewI(r.interest); }}
              >
                คืนค่าตามตาราง
              </Button>
            )}
          </Box>

          {!totalMatches && (
            <Typography variant="caption" color="error.dark">
              ยอดรวมต้องเท่ากับ {fmtMoney(reallocTotal, { decimals: 2 })} · ขาดอยู่{' '}
              {fmtMoney(newTotal - reallocTotal, { decimals: 2 })}
            </Typography>
          )}

          <TextField
            label="Reason"
            select
            required
            value={reason}
            onChange={(e) => setReason(e.target.value as LoanAdjustReason)}
            fullWidth
            size="small"
            helperText={reason ? ' ' : 'เลือกเหตุผลก่อนบันทึก'}
          >
            {(Object.keys(REASON_LABEL) as LoanAdjustReason[]).map((k) => (
              <MenuItem key={k} value={k}>{REASON_LABEL[k]}</MenuItem>
            ))}
          </TextField>

          {isOvercut && (
            <FormControlLabel
              control={<Checkbox checked={refundPending} onChange={(e) => setRefundPending(e.target.checked)} />}
              label={`ธนาคารตัดเกิน ${fmtMoney(refundAmount, { decimals: 2 })} · รอรับคืน`}
            />
          )}

          <TextField inputProps={{ maxLength: 2000 }}
            label="Notes"
            multiline
            minRows={2}
            size="small"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="เช่น อัตราลอยตัวเปลี่ยนวันที่ 15 มี.ค. จาก 4% เป็น 4.5%"
            helperText={`${notes.length.toLocaleString()} / 2,000`}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={locked || !totalMatches || !reason || saving} onClick={save}>
          {saving ? 'Saving…' : 'Post Adjustment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
