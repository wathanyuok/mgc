import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus as AddIcon, Search as SearchIcon, Trash2 as DeleteIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Box, Stack, Typography, Button, TextField, MenuItem, InputAdornment, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, IconButton, Link as MuiLink,
} from '@mui/material';
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type TrustReceipt } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { useBankCodes } from '@/lib/banks';
import { usePaged, Pagination } from '@/components/ui';

import { logDelete } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { filterByScope } from '@/lib/scope-filter';
import { useReadOnly } from '@/lib/readonly';
import { deleteSchedule } from '@/lib/schedule-store';

// สีของสถานะ — เดิมสัญญาที่ถูกยกเลิกขึ้นสีเดียวกับฉบับร่าง แยกด้วยตาไม่ออก
const statusColor = (s: string): 'success' | 'default' | 'warning' | 'error' | 'info' =>
  s === 'Active' ? 'success'
    : s === 'Cancelled' ? 'error'
      : s === 'Roll Over' ? 'info'
        : s === 'Repaid' || s === 'Closed' ? 'default'
          : 'warning';

export function TRList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { filter, patch } = useModuleFilter('tr');
  const { search, bank: fi, statusFilter: status } = filter;

  const { can, scope } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['tr-list', search, fi, status, scope.all, scope.codes.join(',')],
    queryFn: async () => {
      let q = supabase.from('trust_receipts').select('*').order('due_date', { ascending: true });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as TrustReceipt[];
      if (search) rows = rows.filter((r) => r.tr_no.toLowerCase().includes(search.toLowerCase()) || (r.supplier ?? '').toLowerCase().includes(search.toLowerCase()));
      // จำกัดตามบริษัทที่ผู้ใช้ดูแล — บริษัทของรายการมาจากวงเงินย่อยที่ผูกอยู่
      const scoped = await filterByScope(rows as any[], scope);
      return scoped as typeof rows;
    },
  });
  const viewOnly = useReadOnly();
  const canDelete = !viewOnly && can('tr', 'edit');

  const del = useMutation({
    mutationFn: async (row: TrustReceipt) => {
      const id = row.id;
      // 1) สิทธิ์ — เดิมปุ่มลบไม่ตรวจอะไรเลย ใครเปิดหน้ารายการได้ก็ลบสัญญาได้
      if (!can('tr', 'edit')) throw new Error('ไม่มีสิทธิ์ลบทรัสต์รีซีท');
      // 2) สัญญาที่ลงบัญชีไปแล้วห้ามลบ — ใบสำคัญจะกลายเป็นเอกสารลอยที่หาต้นทางไม่เจอ
      const { data: jes } = await supabase
        .from('journal_entries')
        .select('je_number')
        .in('source_type', ['TR_DRAWDOWN', 'TR_ACCRUED'])
        .eq('source_id', id)
        .limit(3);
      if (jes && jes.length > 0) {
        throw new Error(
          `ลบไม่ได้ — สัญญานี้มีใบสำคัญผูกอยู่ (${jes.map((j: any) => j.je_number).join(', ')}) `
          + 'ถ้าต้องการยกเลิก ให้เปลี่ยนสถานะเป็น Cancelled แทน',
        );
      }
      // 3) สัญญาที่ยังใช้งานอยู่หรือจบไปแล้ว ห้ามลบ — เหลือแค่ฉบับร่างและที่ยกเลิกไว้
      if (row.status !== 'Draft' && row.status !== 'Cancelled') {
        throw new Error(`ลบได้เฉพาะสัญญาสถานะ Draft หรือ Cancelled — สถานะปัจจุบัน: ${row.status}`);
      }
      const { error } = await supabase.from('trust_receipts').delete().eq('id', id);
      if (error) throw error;
      // 4) ล้างตารางงวดในตารางกลางตามไปด้วย — ตารางนี้ไม่ได้ผูก foreign key จึงไม่ถูกลบเอง
      //    ถ้าไม่ล้าง รายงานครบกำหนด/ค้างชำระจะยังขึ้นงวดของสัญญาที่ลบไปแล้ว
      await deleteSchedule('TR', id);
      // ส่งเลขที่ไปด้วย ไม่งั้นบันทึกในประวัติจะไม่มีอะไรบอกว่าลบรายการไหน
      logDelete('trust_receipts', id, row.tr_no);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tr-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Trust Receipt</Typography>
        <Typography variant="body2" color="text.secondary">List</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/tr/new')}>New Trust Receipt</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField inputProps={{ maxLength: 200 }} label="Search" placeholder="TR No / Supplier" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{bankCodes.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              {/* ตัวกรองต้องมีครบทุกสถานะที่หน้ารายละเอียดใช้ — เดิมขาดรออนุมัติ · ต่อสัญญา · ปิดสัญญา
                  ทำให้กรองหาสัญญาที่รออนุมัติหรือต่อสัญญาไปแล้วไม่ได้เลย */}
              <MenuItem value="">– All –</MenuItem>
              {['Draft', 'Pending Approval', 'Active', 'Roll Over', 'Repaid', 'Closed', 'Cancelled']
                .map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary', fontSize: 14 }}>ไม่พบ Trust Receipt</Box>
        ) : (
          <><TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>TR No</TableCell><TableCell>FI</TableCell><TableCell>Supplier</TableCell>
                  <TableCell>Invoice No</TableCell><TableCell>Invoice Date</TableCell><TableCell>Due Date</TableCell>
                  <TableCell align="right">Term (Days)</TableCell><TableCell align="right">Amount</TableCell>
                  <TableCell>Currency</TableCell><TableCell>Status</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/tx/tr/${r.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/tx/tr/${r.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    <TableCell><MuiLink component={Link} to={`/tx/tr/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>{r.tr_no}</MuiLink></TableCell>
                    <TableCell>{r.finance_institution}</TableCell><TableCell>{r.supplier}</TableCell>
                    <TableCell>{r.invoice_no}</TableCell>
                    <TableCell>{r.invoice_date ? fmtDate(r.invoice_date) : '—'}</TableCell>
                    <TableCell>{fmtDate(r.due_date)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.term_days}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount)}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={statusColor(r.status)} /></TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        sx={{ color: 'error.main' }}
                        disabled={!canDelete}
                        title={canDelete ? `ลบ ${r.tr_no}` : 'ไม่มีสิทธิ์ลบทรัสต์รีซีท'}
                        onClick={() => { if (confirm(`ลบ ${r.tr_no}?`)) del.mutate(r); }}
                      >
                        <DeleteIcon size={14} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
            <Pagination {...pg} />
          </>
        )}
      </Card>
    </Box>
  );
}
