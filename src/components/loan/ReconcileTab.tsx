// Loan Reconcile Tab — Feature C3 (T+2 Manual Adjust)
// ---------------------------------------------------------------
// Workshop guidance (3.txt §3-75):
//   Loan รอ Bank Statement T+2 · แบงก์ตัดยอดรวม (ไม่แยก P/I) ·
//   บางแบงก์คิดดอกถึงวันก่อนตัด · rate ลอยตัวเปลี่ยนกลางงวด ·
//   → user ต้อง Manual Adjust split เงินต้น/ดอกเบี้ย + reason + refund flag
//
// UI: side-by-side ตาราง "Schedule (คำนวณ)" vs "Bank (ที่ตัดจริง)"
//     + diff column · แถวที่ต้อง adjust จะเน้นสีเหลือง/แดง · คลิก Adjust
//     เปิด dialog เพื่อ split ใหม่ + reason

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
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtMoney } from '@/lib/format';
import { fetchBankConfirmed } from '@/lib/bank-statement-match';
import {
  postLoanAdjustment,
  listLoanAdjustments,
  markRefundReceived,
  type LoanAdjustReason,
  type LoanAdjustment,
} from '@/lib/loan-adjust';

interface ScheduleRow {
  id: string;
  period: number;
  due_date: string;
  principal: number;
  interest: number;
  payment: number;
  paid: boolean;
}

interface Props {
  loanId: string;
  loanNo?: string;
}

const REASON_LABEL: Record<LoanAdjustReason, string> = {
  rate_change: 'อัตราดอกเบี้ยเปลี่ยนกลางงวด',
  day_diff: 'วันตัดต่างจาก schedule',
  bank_overcut: 'ธนาคารตัดเกิน',
  other: 'อื่นๆ',
};

export function ReconcileTab({ loanId, loanNo }: Props) {
  const qc = useQueryClient();

  // 1. Loan schedule
  const { data: schedule = [], isLoading: sLoad } = useQuery({
    queryKey: ['loan-schedule', loanId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loan_schedules')
        .select('id, period, due_date, principal, interest, payment, paid')
        .eq('loan_id', loanId)
        .order('period');
      if (error) throw error;
      return (data ?? []) as ScheduleRow[];
    },
  });

  // 2. Bank confirmed lines (indexed by period)
  const { data: bankLines } = useQuery({
    queryKey: ['loan-bank-confirmed', loanId],
    queryFn: () => fetchBankConfirmed('Loan', loanId),
  });

  // 3. Adjustment history for this loan
  const { data: adjustments = [] } = useQuery({
    queryKey: ['loan-adjustments', loanId],
    queryFn: () => listLoanAdjustments(loanId),
  });

  // Index adjustments by period → latest per period
  const adjByPeriod = useMemo(() => {
    const m = new Map<number, LoanAdjustment>();
    adjustments.forEach((a) => {
      const prev = m.get(a.period);
      if (!prev || a.created_at > prev.created_at) m.set(a.period, a);
    });
    return m;
  }, [adjustments]);

  // Dialog state
  const [dialogRow, setDialogRow] = useState<ScheduleRow | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['loan-adjustments', loanId] });
    qc.invalidateQueries({ queryKey: ['je-list'] });
  };

  const refundReceive = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) => markRefundReceived(id, date),
    onSuccess: () => {
      toast.success('บันทึกวันรับเงินคืนแล้ว');
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? 'save failed'),
  });

  return (
    <Box>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>
            🔧 Reconcile — Loan Schedule vs Bank Statement
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Loan ต้องรอ Bank Statement T+2 · ธนาคารตัดยอดเป็นก้อนเดียว · เมื่อ P/I split
            ไม่ตรงตาราง (rate เปลี่ยน · วันตัดต่าง · ธนาคารตัดเกิน) กด <strong>Adjust</strong>
            เพื่อบันทึกการแบ่งใหม่ + ระบบสร้าง JE reallocation ให้อัตโนมัติ
          </Typography>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 60 }}>งวด</TableCell>
                  <TableCell sx={{ width: 100 }}>Due Date</TableCell>
                  <TableCell align="right">Schedule Principal</TableCell>
                  <TableCell align="right">Schedule Interest</TableCell>
                  <TableCell align="right">Schedule Total</TableCell>
                  <TableCell align="right">Bank Amount</TableCell>
                  <TableCell align="right">Diff</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sLoad && (
                  <TableRow>
                    <TableCell colSpan={9} sx={{ textAlign: 'center', py: 3 }}>กำลังโหลด...</TableCell>
                  </TableRow>
                )}
                {!sLoad && schedule.length === 0 && (
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
                    : Math.abs(diff) > 0.01 ? 'rgba(255, 235, 59, 0.10)'
                    : 'inherit';

                  return (
                    <TableRow key={r.id} sx={{ backgroundColor: rowBg }}>
                      <TableCell>{r.period}</TableCell>
                      <TableCell>{fmtDate(r.due_date)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMoney(adjusted?.adjusted_principal ?? r.principal, { decimals: 2 })}
                        {adjusted && (
                          <Box sx={{ fontSize: 10, color: 'text.disabled', textDecoration: 'line-through' }}>
                            {fmtMoney(r.principal, { decimals: 2 })}
                          </Box>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMoney(adjusted?.adjusted_interest ?? r.interest, { decimals: 2 })}
                        {adjusted && (
                          <Box sx={{ fontSize: 10, color: 'text.disabled', textDecoration: 'line-through' }}>
                            {fmtMoney(r.interest, { decimals: 2 })}
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
                        {state === 'overcut' && (
                          <Chip size="small" label="แบงก์ตัดเกิน" color="warning" />
                        )}
                        {state === 'adjusted' && (
                          <Chip size="small" label="Adjusted" color="success" icon={<CheckIcon size={12} />} />
                        )}
                        {state === 'bank_matched' && (
                          <Chip size="small" label="Bank Confirmed" color="primary" />
                        )}
                        {state === 'unpaid' && <Chip size="small" label="Unpaid" />}
                      </TableCell>
                      <TableCell align="right">
                        {bank && (
                          <Button
                            size="small"
                            startIcon={<WrenchIcon size={14} />}
                            variant={adjusted ? 'outlined' : 'contained'}
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

      {/* Refund tracking (pending) */}
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
                          onClick={() => {
                            const d = window.prompt('วันที่ได้รับเงินคืน (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
                            if (d) refundReceive.mutate({ id: a.id, date: d });
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

      <AdjustDialog
        row={dialogRow}
        bankAmount={dialogRow ? Number(bankLines?.byPeriod.get(dialogRow.period)?.amount ?? dialogRow.payment) : 0}
        bankLineId={dialogRow ? bankLines?.byPeriod.get(dialogRow.period)?.id ?? null : null}
        loanId={loanId}
        loanNo={loanNo}
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
  row, bankAmount, bankLineId, loanId, loanNo, onClose, onDone,
}: {
  row: ScheduleRow | null;
  bankAmount: number;
  bankLineId: string | null;
  loanId: string;
  loanNo?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const isOvercut = row ? bankAmount - row.payment > 0.005 : false;
  const [reason, setReason] = useState<LoanAdjustReason>('day_diff');
  const [newP, setNewP] = useState<number>(row?.principal ?? 0);
  const [newI, setNewI] = useState<number>(row?.interest ?? 0);
  const [refundPending, setRefundPending] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Reset when row changes
  useMemo(() => {
    if (row) {
      setNewP(row.principal);
      setNewI(row.interest);
      // If bank cut more, default: keep P/I same, flag refund_pending
      setRefundPending(isOvercut);
      setReason(isOvercut ? 'bank_overcut' : 'day_diff');
      setNotes('');
    }
  }, [row?.id]);

  if (!row) return null;

  const origTotal = round2(row.payment);
  const bankTotal = round2(bankAmount);
  const newTotal = round2(newP + newI);
  const refundAmount = isOvercut ? round2(bankTotal - origTotal) : 0;

  // For reallocation, the "target total" must match origTotal (not bankTotal).
  // Refund is handled separately via refund_pending flag.
  const reallocTotal = origTotal;
  const totalMatches = Math.abs(newTotal - reallocTotal) < 0.01;

  async function save() {
    if (!totalMatches) {
      toast.error(`ผลรวมใหม่ต้องเท่ากับยอดเดิม ${fmtMoney(reallocTotal, { decimals: 2 })}`);
      return;
    }
    if (!row) return;
    const r = row;
    setSaving(true);
    try {
      await postLoanAdjustment({
        loan_id: loanId,
        loan_no: loanNo,
        period: r.period,
        bank_statement_line_id: bankLineId,
        original_principal: r.principal,
        original_interest: r.interest,
        adjusted_principal: newP,
        adjusted_interest: newI,
        reason,
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
      <DialogTitle>
        Adjust งวด {row.period} · Due {fmtDate(row.due_date)}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Card variant="outlined">
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Original (จาก Schedule)</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, fontVariantNumeric: 'tabular-nums' }}>
                <Box><Typography variant="caption">Principal</Typography><Typography>{fmtMoney(row.principal, { decimals: 2 })}</Typography></Box>
                <Box><Typography variant="caption">Interest</Typography><Typography>{fmtMoney(row.interest, { decimals: 2 })}</Typography></Box>
                <Box><Typography variant="caption">Total</Typography><Typography sx={{ fontWeight: 600 }}>{fmtMoney(origTotal, { decimals: 2 })}</Typography></Box>
              </Box>
            </CardContent>
          </Card>

          <Card variant="outlined">
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">Bank Statement</Typography>
              <Typography sx={{ fontVariantNumeric: 'tabular-nums', fontSize: 18, fontWeight: 600 }}>
                {fmtMoney(bankTotal, { decimals: 2 })}
              </Typography>
              {isOvercut && (
                <Chip size="small" color="warning" label={`ตัดเกิน ${fmtMoney(refundAmount, { decimals: 2 })}`} />
              )}
            </CardContent>
          </Card>

          <TextField label="Reason" select value={reason} onChange={(e) => setReason(e.target.value as LoanAdjustReason)} fullWidth>
            {(Object.keys(REASON_LABEL) as LoanAdjustReason[]).map((k) => (
              <MenuItem key={k} value={k}>{REASON_LABEL[k]}</MenuItem>
            ))}
          </TextField>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <TextField
              label="New Principal"
              type="number"
              value={newP}
              onChange={(e) => setNewP(Number(e.target.value))}
              inputProps={{ step: '0.01' }}
            />
            <TextField
              label="New Interest"
              type="number"
              value={newI}
              onChange={(e) => setNewI(Number(e.target.value))}
              inputProps={{ step: '0.01' }}
            />
          </Box>

          <Box sx={{
            p: 1,
            borderRadius: 1,
            backgroundColor: totalMatches ? 'success.50' : 'error.50',
            color: totalMatches ? 'success.dark' : 'error.dark',
            border: 1,
            borderColor: totalMatches ? 'success.light' : 'error.light',
          }}>
            <Typography variant="caption">
              ผลรวมใหม่ = {fmtMoney(newTotal, { decimals: 2 })}
              {totalMatches
                ? ` ✓ ตรงกับยอดเดิม ${fmtMoney(reallocTotal, { decimals: 2 })}`
                : ` ✗ ต้องเท่ากับ ${fmtMoney(reallocTotal, { decimals: 2 })} (ห่าง ${fmtMoney(newTotal - reallocTotal, { decimals: 2 })})`}
            </Typography>
          </Box>

          {isOvercut && (
            <FormControlLabel
              control={
                <Checkbox checked={refundPending} onChange={(e) => setRefundPending(e.target.checked)} />
              }
              label={`แบงก์ตัดเกิน ${fmtMoney(refundAmount, { decimals: 2 })} · ค้างคืนจากธนาคาร`}
            />
          )}

          <TextField
            label="Notes"
            multiline
            minRows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="เช่น อัตราลอยตัวเปลี่ยน 15 มี.ค. จาก 4% เป็น 4.5%"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!totalMatches || saving} onClick={save}>
          {saving ? 'กำลังบันทึก...' : 'Post Adjustment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
