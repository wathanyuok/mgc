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
import { type Overdraft } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { useBankCodes } from '@/lib/banks';
import { usePaged, Pagination } from '@/components/ui';

import { logDelete } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
export function ODList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { filter, patch } = useModuleFilter('od');
  const { search, bank: fi, statusFilter: status } = filter;

  const { data, isLoading } = useQuery({
    queryKey: ['od-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('overdrafts').select('*').order('start_date', { ascending: false });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as Overdraft[];
      // ค้นได้ทั้งเลขที่ระบบออกให้และเลขที่จากธนาคาร — หน้ารายละเอียดแสดงเลขที่ระบบออกให้เป็นหลัก
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r) => (r.name ?? '').toLowerCase().includes(s) || r.od_no.toLowerCase().includes(s));
      }
      return rows;
    },
  });

  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canDelete = !viewOnly && can('od', 'edit');

  const del = useMutation({
    mutationFn: async ({ id, odNo }: { id: string; odNo: string }) => {
      const { error } = await supabase.from('overdrafts').delete().eq('id', id);
      if (error) throw error;
      // ส่งเลขที่ไปด้วย ไม่งั้นบันทึกในประวัติจะไม่มีอะไรบอกว่าลบรายการไหน
      logDelete('overdrafts', id, odNo);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['od-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Overdraft</Typography>
        <Typography variant="body2" color="text.secondary">List</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/od/new')}>New Overdraft</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField inputProps={{ maxLength: 200 }} label="Search" placeholder="OD No" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>
              {bankCodes.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>
              {['Draft', 'Pending Approval', 'Active', 'Suspended', 'Closed', 'Cancelled'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}><Typography sx={{ fontSize: 32, mb: 1 }}>💳</Typography><Typography variant="body2">ไม่พบ Overdraft</Typography></Box>
        ) : (
          <><TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>OD No</TableCell><TableCell>FI</TableCell><TableCell>Account No</TableCell>
                  <TableCell align="right">Limit</TableCell><TableCell align="right">Used</TableCell><TableCell align="right">Available</TableCell>
                  <TableCell>Start</TableCell><TableCell>End</TableCell><TableCell>Status</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/tx/od/${r.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/tx/od/${r.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    {/* แสดงเลขที่เดียวกับหน้ารายละเอียด — เดิมหน้านี้โชว์ DRAFT-xxxx
                        ส่วนหน้ารายละเอียดโชว์เลขที่ระบบออกให้ ทำให้หากันไม่เจอ */}
                    <TableCell>
                      <MuiLink component={Link} to={`/tx/od/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>
                        {r.name ?? r.od_no}
                      </MuiLink>
                      {r.name && r.od_no && r.name !== r.od_no && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.od_no}</Typography>
                      )}
                    </TableCell>
                    <TableCell>{r.finance_institution}</TableCell>
                    <TableCell>{r.account_no}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.facility_limit)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.used_amount)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.facility_limit - r.used_amount)}</TableCell>
                    <TableCell>{fmtDate(r.start_date)}</TableCell>
                    <TableCell>{r.end_date ? fmtDate(r.end_date) : '—'}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={r.status === 'Active' ? 'success' : 'default'} /></TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        sx={{ color: 'error.main' }}
                        disabled={!canDelete}
                        title={canDelete ? `ลบ ${r.od_no}` : 'ไม่มีสิทธิ์ลบ O/D'}
                        onClick={() => { if (confirm(`ลบ ${r.od_no}?`)) del.mutate({ id: r.id, odNo: r.od_no }); }}
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
