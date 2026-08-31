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
import { type FloorPlan } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { useBankCodes } from '@/lib/banks';
import { usePaged, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { friendlySaveError } from '@/lib/save-error';

import { logDelete } from '@/lib/audit-trail';
export function FPList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canEdit = can('fp', 'edit');
  const { filter, patch } = useModuleFilter('fp');
  const { search, bank: fi, statusFilter: status } = filter;

  const { data, isLoading } = useQuery({
    queryKey: ['fp-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('floor_plans').select('*').order('start_date', { ascending: false });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as FloorPlan[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r) => r.fp_no.toLowerCase().includes(s) || (r.vendor ?? '').toLowerCase().includes(s));
      }
      return rows;
    },
  });

  // ลบได้เฉพาะรายการที่ยังไม่เดินเรื่อง และต้องไม่มีอะไรผูกอยู่
  // เดิมกดปุ่มถังขยะแล้วลบทันที ไม่ว่าจะลงบัญชีไปแล้วหรือต่อสัญญาไปแล้วก็ตาม
  const del = useMutation({
    mutationFn: async (row: FloorPlan) => {
      if (!canEdit) throw new Error('ไม่มีสิทธิ์ลบสัญญาสินเชื่อสต๊อกรถ');
      if (row.status !== 'Draft' && row.status !== 'Cancelled') {
        throw new Error(`ลบไม่ได้ — สถานะ ${row.status} · ลบได้เฉพาะฉบับร่างหรือรายการที่ถูกปฏิเสธ`);
      }
      const [je, children] = await Promise.all([
        supabase.from('journal_entries').select('id', { count: 'exact', head: true }).eq('source_id', row.id),
        supabase.from('floor_plans').select('id', { count: 'exact', head: true }).eq('rollover_parent_id', row.id),
      ]);
      if ((je.count ?? 0) > 0) throw new Error('ลบไม่ได้ — มีใบสำคัญทางบัญชีผูกอยู่กับรายการนี้');
      if ((children.count ?? 0) > 0) throw new Error('ลบไม่ได้ — มีสัญญาที่ต่อจากรายการนี้อยู่');

      const { error } = await supabase.from('floor_plans').delete().eq('id', row.id);
      if (error) throw error;
      logDelete('floor_plans', row.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fp-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(friendlySaveError(e)),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Floor Plan</Typography>
        <Typography variant="body2" color="text.secondary">List</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/fp/new')}>New Floor Plan</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField inputProps={{ maxLength: 200 }} label="Search" placeholder="FP No / Vendor" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>
              {bankCodes.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>
              {['Draft', 'Pending Approval', 'Active', 'Roll Over', 'Repaid', 'Closed', 'Cancelled'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}><Typography sx={{ fontSize: 32, mb: 1 }}>📦</Typography><Typography variant="body2">ไม่พบ Floor Plan</Typography></Box>
        ) : (
          <><TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>FP No</TableCell><TableCell>Finance Institution</TableCell><TableCell>Vendor</TableCell>
                  {/* หน้ารายละเอียดกรอกวันทำรายการกับวันครบกำหนด — เดิมหัวคอลัมน์เป็นวันเริ่ม/วันสิ้นสุด
                      ซึ่งไม่มีช่องให้กรอกที่ไหนเลย จึงขึ้นขีดว่างตลอด */}
                  <TableCell>Schedule Mode</TableCell><TableCell>Transaction Date</TableCell><TableCell>Maturity Date</TableCell>
                  <TableCell align="right">Total Amount</TableCell><TableCell align="right">Used</TableCell>
                  <TableCell>Status</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/tx/fp/${r.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/tx/fp/${r.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    <TableCell><MuiLink component={Link} to={`/tx/fp/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>{r.fp_no}</MuiLink></TableCell>
                    <TableCell>{r.finance_institution}</TableCell>
                    <TableCell>{r.vendor}</TableCell>
                    <TableCell><Chip size="small" label={r.schedule_mode.toUpperCase()} color={r.schedule_mode === 'bmw' ? 'primary' : 'default'} /></TableCell>
                    <TableCell>{r.transaction_date ? fmtDate(r.transaction_date) : '—'}</TableCell>
                    <TableCell>{r.maturity_date ? fmtDate(r.maturity_date) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.total_amount)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.used_amount)}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={r.status === 'Active' ? 'success' : 'default'} /></TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        sx={{ color: 'error.main' }}
                        disabled={!canEdit || del.isPending}
                        title={!canEdit ? 'ไม่มีสิทธิ์ลบ' : 'ลบรายการนี้'}
                        onClick={() => { if (confirm(`ลบ ${r.fp_no}?`)) del.mutate(r); }}
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
