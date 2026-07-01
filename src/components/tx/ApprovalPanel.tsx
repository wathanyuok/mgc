// Approval Panel — Feature C2 (Maker / Checker / Approver)
// ---------------------------------------------------------------
// Renders a compact banner + action buttons that reflect the row's
// approval state. Parent Detail page hands over:
//   - facilityTable  (e.g. 'loans')
//   - facilityId
//   - currentStatus  (existing status enum — 'Draft' / 'Approved' / ...)
//   - statusField    (column name that holds the enum value)
//   - approvedValue  (value to set on approval, e.g. 'Active' for Loan)

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box, Card, CardContent, Typography, Stack, Chip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from '@mui/material';
import { CheckCircle2 as CheckIcon, Send as SendIcon, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth, useCurrentUserLabel } from '@/lib/auth';
import {
  fetchApprovalState,
  submitForApproval,
  approveFacility,
  rejectFacility,
  type ApprovalFacility,
} from '@/lib/approval-workflow';

// Map the DB table name to the menu-key used by the permission system
// (matches the abbreviations used across LoanDetail / PNDetail / etc.).
const MENU_KEY_MAP: Record<ApprovalFacility, string> = {
  loans: 'loan',
  promissory_notes: 'pn',
  floor_plans: 'fp',
  overdrafts: 'od',
  trust_receipts: 'tr',
  letter_guarantees: 'lg',
  letters_of_credit: 'lc',
  leases: 'lease',
  fx_forwards: 'fxf',
};
import { fmtDate } from '@/lib/format';

interface Props {
  facilityTable: ApprovalFacility;
  facilityId: string;
  currentStatus: string;
  /** Field name on the row that holds status (e.g. 'status') · optional if module doesn't auto-move */
  statusField?: string;
  /** Enum value to set on approval (e.g. 'Active' for Loan) · optional if manual */
  approvedValue?: string;
  /** Show the panel only when row is in Draft (default true) */
  hideWhenNotDraft?: boolean;
  /** Block the "ส่งขออนุมัติ" button (typically true when form has unsaved edits) */
  disableSubmit?: boolean;
  /** Tooltip shown on the disabled submit button explaining why it's locked */
  disableSubmitHint?: string;
}

export function ApprovalPanel({
  facilityTable, facilityId, currentStatus,
  statusField = 'status',
  approvedValue,
  hideWhenNotDraft = true,
  disableSubmit = false,
  disableSubmitHint,
}: Props) {
  const qc = useQueryClient();
  const userLabel = useCurrentUserLabel();
  const { can } = useAuth();
  const menuKey = MENU_KEY_MAP[facilityTable];
  const canSubmit = can(menuKey, 'edit');    // Maker right — same as Save/edit
  const canApprove = can(menuKey, 'approve'); // Approver right
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: state } = useQuery({
    queryKey: ['approval-state', facilityTable, facilityId],
    queryFn: () => fetchApprovalState(facilityTable, facilityId),
    enabled: !!facilityId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['approval-state', facilityTable, facilityId] });
    qc.invalidateQueries({ queryKey: [facilityTable] });
    // Detail pages often use singular query keys like ['loan', id] instead
    // of the plural table name. Use a predicate to catch any query whose
    // key array includes this facilityId — refreshes chip + form state.
    qc.invalidateQueries({
      predicate: (query) => query.queryKey.includes(facilityId),
    });
  };

  const submit = useMutation({
    mutationFn: () => submitForApproval(facilityTable, facilityId, userLabel),
    onSuccess: () => { toast.success('ส่งขออนุมัติแล้ว · รอผู้อนุมัติ'); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? 'submit failed'),
  });

  const approve = useMutation({
    mutationFn: () => approveFacility(facilityTable, facilityId, userLabel, statusField, approvedValue),
    onSuccess: () => {
      toast.success(`✓ อนุมัติแล้ว${approvedValue ? ` · สถานะ → ${approvedValue}` : ''}`);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'approve failed'),
  });

  const reject = useMutation({
    mutationFn: () => rejectFacility(facilityTable, facilityId, userLabel, rejectReason),
    onSuccess: () => {
      toast.success('ส่งกลับให้ผู้ทำรายการแก้ไขแล้ว');
      setRejectOpen(false);
      setRejectReason('');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'send-back failed'),
  });

  if (!facilityId) return null;
  if (hideWhenNotDraft && currentStatus !== 'Draft' && !state?.is_approved) return null;
  if (!state) return null;

  // ─── State rendering ─────────────────────────────────────────
  // State A: Approved (already passed workflow) — small badge
  if (state.is_approved) {
    return (
      <Card sx={{ mb: 2, backgroundColor: 'success.50', borderColor: 'success.light', border: 1 }}>
        <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <CheckIcon size={16} color="green" />
            <Typography variant="body2" sx={{ color: 'success.dark' }}>
              ✓ อนุมัติโดย <strong>{state.approved_by}</strong> เมื่อ {fmtDate(state.approved_at)}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  // State B: Submitted, waiting for approver
  if (state.is_submitted) {
    return (
      <Card sx={{ mb: 2, backgroundColor: 'warning.50', borderColor: 'warning.light', border: 1 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, color: 'warning.dark' }}>
                ⏳ รอผู้อนุมัติ
              </Typography>
              <Typography variant="caption" color="text.secondary">
                ส่งขออนุมัติโดย <strong>{state.submitted_by}</strong> เมื่อ {fmtDate(state.submitted_at)}
              </Typography>
            </Box>
            {canApprove ? (
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  color="success"
                  size="small"
                  startIcon={<CheckIcon size={14} />}
                  disabled={approve.isPending}
                  onClick={() => approve.mutate()}
                >
                  {approve.isPending ? 'กำลังอนุมัติ...' : 'Approve'}
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  size="small"
                  startIcon={<XIcon size={14} />}
                  onClick={() => setRejectOpen(true)}
                >
                  Request Changes
                </Button>
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                คุณไม่มีสิทธิ์อนุมัติ · รอผู้มีสิทธิ์ Approve
              </Typography>
            )}
          </Stack>
        </CardContent>

        <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>ปฏิเสธการอนุมัติ</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                กรุณาระบุเหตุผลที่ปฏิเสธ · สัญญาจะกลับสู่สถานะ Draft ให้ผู้ทำรายการแก้ไข
              </Typography>
              <TextField
                label="เหตุผล"
                multiline
                minRows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                autoFocus
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              color="error"
              disabled={!rejectReason.trim() || reject.isPending}
              onClick={() => reject.mutate()}
            >
              {reject.isPending ? 'กำลังบันทึก...' : 'ปฏิเสธ'}
            </Button>
          </DialogActions>
        </Dialog>
      </Card>
    );
  }

  // State C: Draft — show submit button (+ rejection history if any)
  return (
    <Card sx={{ mb: 2, backgroundColor: 'grey.50', borderColor: 'grey.300', border: 1 }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} justifyContent="space-between">
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" label="Draft" />
              <Typography variant="body2" color={disableSubmit ? 'warning.dark' : 'text.secondary'}>
                {disableSubmit && disableSubmitHint
                  ? disableSubmitHint
                  : state.rejection_reason
                    ? 'ถูกปฏิเสธการอนุมัติ · กรุณาแก้ไขและส่งใหม่'
                    : 'พร้อมส่งขออนุมัติเมื่อกรอกข้อมูลครบ'}
              </Typography>
            </Stack>
            {state.rejection_reason && (
              <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.5 }}>
                เหตุผลที่ถูกปฏิเสธ: {state.rejection_reason}
              </Typography>
            )}
          </Box>
          {canSubmit ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<SendIcon size={14} />}
              disabled={submit.isPending || disableSubmit}
              onClick={() => submit.mutate()}
              title={disableSubmit ? (disableSubmitHint ?? 'มีการแก้ไขที่ยังไม่บันทึก') : ''}
            >
              {submit.isPending ? 'กำลังส่ง...' : 'ส่งขออนุมัติ'}
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              คุณไม่มีสิทธิ์แก้ไข · ต้องมีสิทธิ์ Edit เพื่อส่งขออนุมัติ
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
