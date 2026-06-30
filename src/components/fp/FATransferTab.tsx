// FA Transfer Tab — Feature B6 (used in Floor Plan Detail)
// Lets user record "received asset → transfer out of suspense" per chassis or lump-sum.
//
// Workshop guidance (3.txt §575-580):
//   "เข้ามาบันทึกที่พักก่อน · แล้วค่อยโอนลิสต์วิ่งเข้ามาเป็นรถ"

import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Stack, Button, TextField, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { Truck as TruckIcon } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fmtDate, fmtMoney } from '@/lib/format';
import { listFATransfers, postFATransfer } from '@/lib/fa-transfer';

interface Props {
  fpId: string;
  // Optional: pass chassis options so the form can pre-select
  chassisOptions?: Array<{ id: string; chassis_no: string; amount?: number }>;
}

export function FATransferTab({ fpId, chassisOptions = [] }: Props) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<string>('');
  const [chassisId, setChassisId] = useState<string>('');
  const [chassisNo, setChassisNo] = useState<string>('');
  const [transferDate, setTransferDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [remark, setRemark] = useState<string>('');

  const { data: transfers, isLoading } = useQuery({
    queryKey: ['fa-transfers', fpId],
    queryFn: () => listFATransfers('floor_plan', fpId),
  });

  const create = useMutation({
    mutationFn: async () =>
      postFATransfer({
        facility_type: 'floor_plan',
        facility_id: fpId,
        chassis_id: chassisId || null,
        chassis_no: chassisNo || null,
        transferred_amount: Number(amount),
        transfer_date: transferDate,
        remark: remark || undefined,
      }),
    onSuccess: () => {
      toast.success('✓ โอนเข้า Fixed Asset สำเร็จ — สร้าง JE แล้ว');
      setAmount('');
      setChassisId('');
      setChassisNo('');
      setRemark('');
      qc.invalidateQueries({ queryKey: ['fa-transfers', fpId] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'transfer failed'),
  });

  const totalPosted = (transfers ?? [])
    .filter((t) => t.status === 'Posted')
    .reduce((s, t) => s + Number(t.transferred_amount), 0);

  return (
    <Box>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>
            🚗 รับรถ — โอนเข้า Fixed Asset
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            เมื่อรถมาถึงจริง · กดโอนจากบัญชีพักเข้า Vehicle Asset
            {' · '}ระบบสร้าง JE Dr Vehicle Asset / Cr Vehicle Suspense
          </Typography>

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            alignItems={{ md: 'end' }}
            sx={{ mb: 1 }}
          >
            <TextField
              type="date"
              label="Transfer Date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 160 }}
            />
            <TextField
              label="Chassis No."
              value={chassisNo}
              onChange={(e) => {
                setChassisNo(e.target.value);
                const hit = chassisOptions.find((c) => c.chassis_no === e.target.value);
                if (hit) {
                  setChassisId(hit.id);
                  if (hit.amount) setAmount(String(hit.amount));
                } else {
                  setChassisId('');
                }
              }}
              placeholder="เลือกจาก list หรือพิมพ์"
              sx={{ minWidth: 200 }}
            />
            <TextField
              type="number"
              label="Amount (THB)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              sx={{ minWidth: 180 }}
            />
            <TextField
              label="Remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              sx={{ flex: 1, minWidth: 200 }}
            />
            <Button
              variant="contained"
              startIcon={<TruckIcon size={16} />}
              disabled={create.isPending || !amount || Number(amount) <= 0}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'กำลังโอน...' : 'โอนเข้า FA'}
            </Button>
          </Stack>

          {chassisOptions.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {chassisOptions.map((c) => (
                <Chip
                  key={c.id}
                  label={`${c.chassis_no}${c.amount ? ` · ${fmtMoney(c.amount)}` : ''}`}
                  onClick={() => {
                    setChassisId(c.id);
                    setChassisNo(c.chassis_no);
                    if (c.amount) setAmount(String(c.amount));
                  }}
                  variant={chassisId === c.id ? 'filled' : 'outlined'}
                  size="small"
                />
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1.5 }}>
            <Typography sx={{ fontWeight: 700 }}>ประวัติการโอน</Typography>
            <Chip
              label={`รวมโอนแล้ว ${fmtMoney(totalPosted)}`}
              size="small"
              color="success"
            />
          </Stack>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Chassis</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>JE</TableCell>
                  <TableCell>Remark</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ textAlign: 'center', py: 3 }}>
                      กำลังโหลด...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && (transfers ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
                      ยังไม่มีการโอนเข้า Fixed Asset
                    </TableCell>
                  </TableRow>
                )}
                {(transfers ?? []).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{fmtDate(t.transfer_date)}</TableCell>
                    <TableCell>{t.chassis_no ?? '—'}</TableCell>
                    <TableCell align="right">{fmtMoney(t.transferred_amount)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={t.status}
                        color={t.status === 'Posted' ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell>{t.je_id ? t.je_id.slice(0, 8) : '—'}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                      {t.remark ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}
