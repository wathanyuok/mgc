// Bank Statement Import Dialog — user picks a CSV/TXT exported by their
// bank, we auto-detect the format (KBANK or SCB), preview the parsed rows,
// then bulk-insert into bank_statements + bank_statement_lines.
//
// Flow: Upload → Preview → Confirm.
//   Upload: <input type="file"> + parse button.
//   Preview: detected bank, account, period, and first 20 rows.
//   Confirm: single button that persists everything.
//
// The dialog is deliberately dumb about de-duplication — a duplicate
// (account, period) will just create another statement row and let the user
// delete the old one via the list page. That matches how the existing manual
// entry flow behaves.

import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Stack, Typography, Button, Alert, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { Upload, FileText, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { fmtMoney } from '@/lib/format';
import {
  parseBankStatement,
  decodeCP874,
  type ParsedBankStatement,
} from '@/lib/bank-statement-parser';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (statementId: string) => void;
}

type Step = 'upload' | 'preview';

const PREVIEW_ROWS = 20;

export function BankStatementImportDialog({ open, onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedBankStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep('upload');
    setFile(null);
    setParsed(null);
    setError(null);
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleParse = async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const text = await decodeCP874(file);
      const result = parseBankStatement(text);
      setParsed(result);
      setStep('preview');
    } catch (e: any) {
      setError(e?.message ?? 'อ่านไฟล์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!parsed) return;
    setError(null);
    setBusy(true);
    try {
      // 1) Insert the statement header.
      const { data: header, error: hErr } = await supabase
        .from('bank_statements')
        .insert({
          finance_institution: parsed.bank,
          account_no: parsed.account_no,
          statement_name: parsed.statement_name ?? null,
          statement_period: parsed.statement_period,
          source: 'Import',
          inactive: false,
          remark: `นำเข้าอัตโนมัติจากไฟล์ ${file?.name ?? ''}`.trim() || null,
        })
        .select('id')
        .single();
      if (hErr) throw hErr;

      // 2) Bulk-insert lines. Chunk at 500 rows to stay under PostgREST's
      //    default row-count safety limits.
      const rows = parsed.lines.map((l, i) => {
        // Fold non-columnar fields into remark so nothing is lost.
        const remarkParts: string[] = [];
        if (l.channel) remarkParts.push(`ช่องทาง ${l.channel}`);
        if (l.cheque_no) remarkParts.push(`เช็ค ${l.cheque_no}`);
        if (l.raw_remark) remarkParts.push(l.raw_remark);
        const remark = remarkParts.length ? remarkParts.join(' · ') : null;
        return {
          statement_id: header.id,
          tx_date: l.tx_date,
          tx_time: l.tx_time ?? null,
          txn_code: l.txn_code ?? null,
          description: l.description || null,
          debit: l.debit,
          credit: l.credit,
          balance: l.balance,
          source: 'Import',
          remark,
          sort_order: i,
          facility_type: null,
          facility_id: null,
          source_period: null,
        };
      });

      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error: lErr } = await supabase.from('bank_statement_lines').insert(slice);
        if (lErr) throw lErr;
      }

      toast.success(`นำเข้า ${parsed.bank} · ${rows.length} รายการ`);
      onImported(header.id);
      reset();
    } catch (e: any) {
      const msg = e?.message ?? 'บันทึกไม่สำเร็จ';
      setError(msg);
      toast.error(msg, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Upload size={20} />
          <span>นำเข้า Bank Statement จากไฟล์</span>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          รองรับ KBANK และ SCB · ไฟล์ CSV ที่ดาวน์โหลดจากธนาคาร (encoding cp874)
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        {error && (
          <Alert severity="error" icon={<AlertTriangle size={18} />} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {step === 'upload' && (
          <Stack spacing={2}>
            <Box
              sx={{
                border: '2px dashed',
                borderColor: 'divider',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                bgcolor: 'grey.50',
              }}
            >
              <FileText size={32} style={{ margin: '0 auto 8px', color: '#666' }} />
              <input
                type="file"
                accept=".csv,.txt"
                id="bank-stmt-import-file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setError(null);
                }}
              />
              <Box>
                <Button
                  variant="outlined"
                  component="label"
                  htmlFor="bank-stmt-import-file"
                  sx={{ mb: 1 }}
                >
                  เลือกไฟล์ .csv / .txt
                </Button>
              </Box>
              {file && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  <strong>{file.name}</strong>{' '}
                  <Typography component="span" variant="caption" color="text.secondary">
                    ({(file.size / 1024).toFixed(1)} KB)
                  </Typography>
                </Typography>
              )}
            </Box>

            <Alert severity="info" sx={{ fontSize: 13 }}>
              ระบบจะตรวจสอบรูปแบบไฟล์อัตโนมัติ · ถ้าไม่ใช่ KBANK หรือ SCB จะแจ้งเตือนก่อนบันทึก
            </Alert>
          </Stack>
        )}

        {step === 'preview' && parsed && (
          <Stack spacing={2}>
            <Alert severity="success" icon={<CheckCircle2 size={18} />}>
              อ่านไฟล์สำเร็จ · ตรวจสอบข้อมูลก่อนบันทึก
            </Alert>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 2,
                p: 2,
                bgcolor: 'grey.50',
                borderRadius: 2,
              }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">ธนาคาร</Typography>
                <Box><Chip label={parsed.bank} color="primary" size="small" /></Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">เลขที่บัญชี</Typography>
                <Typography sx={{ fontFamily: 'monospace' }}>{parsed.account_no}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">งวด</Typography>
                <Typography>{parsed.statement_period}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">จำนวนรายการ</Typography>
                <Typography sx={{ fontWeight: 600 }}>
                  {parsed.lines.length.toLocaleString()} รายการ
                </Typography>
              </Box>
            </Box>

            <Box>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                ตัวอย่าง {Math.min(PREVIEW_ROWS, parsed.lines.length)} รายการแรก:
              </Typography>
              <TableContainer sx={{ maxHeight: 340, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>วันที่</TableCell>
                      <TableCell>เวลา</TableCell>
                      <TableCell>รายละเอียด</TableCell>
                      <TableCell align="right">Debit</TableCell>
                      <TableCell align="right">Credit</TableCell>
                      <TableCell align="right">Balance</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {parsed.lines.slice(0, PREVIEW_ROWS).map((l, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{l.tx_date}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{l.tx_time ?? '—'}</TableCell>
                        <TableCell sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.description}>
                          {l.description}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: l.debit > 0 ? 'error.main' : 'text.disabled' }}>
                          {l.debit > 0 ? fmtMoney(l.debit, { decimals: 2 }) : '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: l.credit > 0 ? 'success.dark' : 'text.disabled' }}>
                          {l.credit > 0 ? fmtMoney(l.credit, { decimals: 2 }) : '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmtMoney(l.balance, { decimals: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {parsed.lines.length > PREVIEW_ROWS && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  แสดง {PREVIEW_ROWS} จาก {parsed.lines.length.toLocaleString()} รายการ · ระบบจะบันทึกครบทั้งหมด
                </Typography>
              )}
            </Box>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
        {step === 'upload' && (
          <>
            <Button onClick={handleClose} disabled={busy}>ยกเลิก</Button>
            <Button
              variant="contained"
              onClick={handleParse}
              disabled={!file || busy}
            >
              {busy ? 'กำลังอ่าน...' : 'อ่านไฟล์'}
            </Button>
          </>
        )}
        {step === 'preview' && (
          <>
            <Button onClick={() => { setStep('upload'); setParsed(null); }} disabled={busy}>
              ← เลือกไฟล์ใหม่
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button onClick={handleClose} disabled={busy}>ยกเลิก</Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleSave}
              disabled={busy || !parsed}
            >
              {busy ? 'กำลังบันทึก...' : `บันทึกเข้าระบบ (${parsed?.lines.length ?? 0} รายการ)`}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
