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
  // สัญญาเช่ามี 3 ชนิด รหัสสิทธิ์ต่างกัน — หน้า LeaseDetail ส่ง menuKey มาให้เอง
  leases: 'lease_hp',
  fx_forwards: 'fxf',
};
import { fmtDate } from '@/lib/format';

interface Props {
  facilityTable: ApprovalFacility;
  facilityId: string;
  /** ใช้เมื่อตารางเดียวมีหลายเมนู เช่น สัญญาเช่า 3 ชนิดใช้ตาราง leases ร่วมกัน */
  menuKeyOverride?: string;
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
  menuKeyOverride,
  statusField = 'status',
  approvedValue,
  hideWhenNotDraft = true,
  disableSubmit = false,
  disableSubmitHint,
}: Props) {
  const qc = useQueryClient();
  const userLabel = useCurrentUserLabel();
  const { can } = useAuth();
  const menuKey = menuKeyOverride ?? MENU_KEY_MAP[facilityTable];
  const canSubmit = can(menuKey, 'edit');    // Maker right — same as Save/edit
  const canApprove = can(menuKey, 'approve'); // Approver right
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: state } = useQuery({
    queryKey: ['approval-state', facilityTable, facilityId],
    queryFn: () => fetchApprovalState(facilityTable, facilityId),
    enabled: !!facilityId,
  });

  if (!facilityId) return null;
  // การ์ดนี้ "แสดงสถานะอย่างเดียว" — ปุ่มสั่งงานอยู่ที่ชุดปุ่มใต้ช่องสถานะที่เดียว
  //
  // เดิมมีปุ่มส่งขออนุมัติ/อนุมัติ/ตีกลับ 2 ชุดบนหน้าเดียวกันที่ทำงานคนละแบบ —
  // ชุดบนเขียนแค่ประวัติ สถานะไม่ขยับ ผู้อนุมัติจึงไม่เห็นในแจ้งเตือน
  // ส่วนชุดล่างเปลี่ยนสถานะแล้วการ์ดนี้ก็หายไป ผู้อนุมัติเลยไม่เห็นปุ่มอนุมัติ
  // กดคนละทางแล้วประวัติการอนุมัติไม่ครบ · ตอนนี้เหลือชุดเดียว การ์ดนี้สะท้อนผลอย่างเดียว
  if (currentStatus === 'Pending Approval') {
    return (
      <Card sx={{ mb: 2, backgroundColor: 'warning.50', borderColor: 'warning.light', border: 1 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, color: 'warning.dark' }}>
            ⏳ รอผู้อนุมัติ
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {state?.submitted_by
              ? <>ส่งขออนุมัติโดย <strong>{state.submitted_by}</strong> เมื่อ {fmtDate(state.submitted_at)}</>
              : 'ส่งขออนุมัติแล้ว'}
            {canApprove ? ' · กดอนุมัติได้ที่ปุ่มใต้ช่องสถานะ' : ' · คุณไม่มีสิทธิ์อนุมัติ'}
          </Typography>
        </CardContent>
      </Card>
    );
  }
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

  // State C: Draft — บอกสถานะและเหตุผลที่ถูกตีกลับ (ปุ่มส่งขออนุมัติอยู่ใต้ช่องสถานะ)
  return (
    <Card sx={{ mb: 2, backgroundColor: 'grey.50', borderColor: 'grey.300', border: 1 }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" label="Draft" />
          <Typography variant="body2" color={disableSubmit ? 'warning.dark' : 'text.secondary'}>
            {disableSubmit && disableSubmitHint
              ? disableSubmitHint
              : state.rejection_reason
                ? 'ถูกส่งกลับให้แก้ไข · แก้แล้วส่งขออนุมัติใหม่ได้ที่ปุ่มใต้ช่องสถานะ'
                : canSubmit
                  ? 'พร้อมส่งขออนุมัติเมื่อกรอกข้อมูลครบ · ปุ่มส่งอยู่ใต้ช่องสถานะ'
                  : 'คุณไม่มีสิทธิ์แก้ไข · ต้องมีสิทธิ์ Edit เพื่อส่งขออนุมัติ'}
          </Typography>
        </Stack>
        {state.rejection_reason && (
          <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.5 }}>
            เหตุผลที่ถูกส่งกลับ: {state.rejection_reason}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
