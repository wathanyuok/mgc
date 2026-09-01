import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus as AddIcon, Search as SearchIcon, Trash2 as DeleteIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Box, Stack, Typography, Button, TextField, MenuItem, InputAdornment, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, IconButton, Link as MuiLink,
} from '@mui/material';
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtMoney, fmtPercent } from '@/lib/format';
import { type Loan } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { useBankCodes } from '@/lib/banks';
import { usePaged, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { filterByScope } from '@/lib/scope-filter';
import { deleteSchedule } from '@/lib/schedule-store';

import { logDelete } from '@/lib/audit-trail';

// สถานะทั้งหมดที่ตัวกรองต้องมีให้เลือก — เดิมตกไป 2 ค่า
// ทำให้สัญญาที่รออนุมัติและที่ถูกยกเลิก หาจากหน้ารายการไม่เจอเลย
const STATUS_FILTERS = ['Draft', 'Pending Approval', 'Active', 'Modified', 'Closed', 'Cancelled'];

export function LoanList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, scope } = useAuth();   // scope = บริษัทที่ผู้ใช้ดูแล
  const { filter, patch } = useModuleFilter('loan');
  const { search, bank: fi, statusFilter: status } = filter;

  const { data, isLoading } = useQuery({
    queryKey: ['loan-list', search, fi, status, scope.all, scope.codes.join(',')],
    queryFn: async () => {
      let q = supabase.from('loans').select('*').order('start_date', { ascending: false });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as Loan[];
      if (search) rows = rows.filter((r) => r.loan_no.toLowerCase().includes(search.toLowerCase()));
      // จำกัดตามบริษัทที่ผู้ใช้ดูแล — บริษัทของรายการมาจากวงเงินย่อยที่ผูกอยู่
      const scoped = await filterByScope(rows as any[], scope);
      return scoped as typeof rows;
    },
  });

  const del = useMutation({
    mutationFn: async (row: Loan) => {
      const id = row.id;
      // 1) สิทธิ์ — เดิมปุ่มลบไม่ตรวจอะไรเลย ใครเปิดหน้ารายการได้ก็ลบสัญญาได้
      if (!can('loan', 'edit')) throw new Error('ไม่มีสิทธิ์ลบสัญญา Loan');
      // 2) สัญญาที่ลงบัญชีไปแล้วห้ามลบ — ใบสำคัญจะกลายเป็นเอกสารลอยที่หาต้นทางไม่เจอ
      const { data: jes } = await supabase
        .from('journal_entries')
        .select('je_number')
        .in('source_type', ['LOAN_DRAWDOWN', 'LOAN_ACCRUED', 'LOAN_INT_PAY', 'LOAN_PREPAY'])
        .eq('source_id', id)
        .limit(3);
      if (jes && jes.length > 0) {
        throw new Error(
          `ลบไม่ได้ — สัญญานี้มีใบสำคัญผูกอยู่ (${jes.map((j: any) => j.je_number).join(', ')}) `
          + 'ถ้าต้องการยกเลิก ให้เปลี่ยนสถานะเป็น Cancelled แทน',
        );
      }
      // 3) สัญญาที่ยังใช้งานอยู่หรือปิดไปแล้ว ห้ามลบ — เหลือแค่ฉบับร่างและที่ยกเลิกไว้
      if (row.status !== 'Draft' && row.status !== 'Cancelled') {
        throw new Error(`ลบได้เฉพาะสัญญาสถานะ Draft หรือ Cancelled — สถานะปัจจุบัน: ${row.status}`);
      }
      const { error } = await supabase.from('loans').delete().eq('id', id);
      if (error) throw error;
      // 4) ล้างตารางงวดในตารางกลางตามไปด้วย — ตารางนี้ไม่ได้ผูก foreign key จึงไม่ถูกลบเอง
      //    ถ้าไม่ล้าง รายงานครบกำหนด/ค้างชำระจะยังขึ้นงวดของสัญญาที่ลบไปแล้ว
      await deleteSchedule('LOAN', id);
      logDelete('loans', id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loan-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Loan</Typography>
        <Typography variant="body2" color="text.secondary">Term loan with amortization schedule</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/loan/new')}>New Loan</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField inputProps={{ maxLength: 200 }} label="Search" placeholder="Loan No" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{bankCodes.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{STATUS_FILTERS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}><Typography sx={{ fontSize: 32, mb: 1 }}>💰</Typography><Typography variant="body2">ไม่พบ Loan</Typography></Box>
        ) : (
          <><TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>Loan No</TableCell><TableCell>FI</TableCell>
                  <TableCell align="right">Principal</TableCell><TableCell align="right">Rate</TableCell><TableCell align="right">Term (M)</TableCell>
                  <TableCell>Start</TableCell><TableCell>End</TableCell><TableCell>Status</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/tx/loan/${r.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/tx/loan/${r.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    <TableCell><MuiLink component={Link} to={`/tx/loan/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>{r.loan_no}</MuiLink></TableCell>
                    <TableCell>{r.finance_institution}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.principal)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPercent(r.annual_rate)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.term_months}</TableCell>
                    <TableCell>{fmtDate(r.start_date)}</TableCell>
                    {/* หน้าจอสัญญาเขียนวันสิ้นสุดลงช่อง installment_end_date — เดิมคอลัมน์นี้อ่านอีกช่อง
                        ที่ไม่มีใครเขียน ทุกแถวจึงขึ้นขีดตลอด */}
                    <TableCell>{r.installment_end_date ? fmtDate(r.installment_end_date) : '—'}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={r.status === 'Active' ? 'success' : 'default'} /></TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        sx={{ color: 'error.main' }}
                        disabled={del.isPending || !can('loan', 'edit')}
                        title={!can('loan', 'edit') ? 'ไม่มีสิทธิ์ลบสัญญา Loan' : 'ลบสัญญา'}
                        onClick={() => {
                          if (confirm(`ลบสัญญา ${r.loan_no}?\n\nตารางงวดที่ผูกอยู่จะถูกลบตามไปด้วย และย้อนกลับไม่ได้`)) del.mutate(r);
                        }}
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
