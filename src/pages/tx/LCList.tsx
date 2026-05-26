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
import { type LetterOfCredit, FINANCE_INSTITUTIONS } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';

const statusColor = (s: string): 'success' | 'primary' | 'default' | 'warning' =>
  s === 'Active' ? 'success' : s === 'Converted' ? 'primary' : s === 'Expired' || s === 'Closed' ? 'default' : 'warning';

export function LCList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { filter, patch } = useModuleFilter('lc');
  const { search, bank: fi, statusFilter: status } = filter;

  const { data, isLoading } = useQuery({
    queryKey: ['lc-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('letters_of_credit').select('*').order('expiry_date', { ascending: true });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as LetterOfCredit[];
      if (search) rows = rows.filter((r) => r.lc_no.toLowerCase().includes(search.toLowerCase()) || (r.beneficiary ?? '').toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('letters_of_credit').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lc-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Letter of Credit (L/C)</Typography>
        <Typography variant="body2" color="text.secondary">Off-Balance / Fee-based · Flow LC → TR</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/lc/new')}>New Letter of Credit</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField label="Search" placeholder="LC No / Beneficiary" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{FINANCE_INSTITUTIONS.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{['Draft', 'Approved', 'Active', 'Converted', 'Expired', 'Closed'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}><Typography sx={{ fontSize: 32, mb: 1 }}>📄</Typography><Typography variant="body2">ไม่พบ Letter of Credit</Typography></Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>LC No</TableCell><TableCell>Type</TableCell><TableCell>FI</TableCell>
                  <TableCell>Beneficiary</TableCell><TableCell>Issue</TableCell><TableCell>Expiry</TableCell>
                  <TableCell align="right">Amount (Foreign)</TableCell><TableCell>Ccy</TableCell>
                  <TableCell align="right">THB Equiv.</TableCell><TableCell>Status</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/tx/lc/${r.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/tx/lc/${r.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    <TableCell><MuiLink component={Link} to={`/tx/lc/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>{r.lc_no}</MuiLink></TableCell>
                    <TableCell><Chip size="small" label={r.lc_type} color={r.lc_type === 'SBLC' ? 'warning' : 'default'} /></TableCell>
                    <TableCell>{r.finance_institution}</TableCell>
                    <TableCell>{r.beneficiary}</TableCell>
                    <TableCell>{r.issue_date ? fmtDate(r.issue_date) : '—'}</TableCell>
                    <TableCell>{r.expiry_date ? fmtDate(r.expiry_date) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount_foreign)}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount)}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={statusColor(r.status)} /></TableCell>
                    <TableCell align="right">
                      <IconButton size="small" sx={{ color: 'error.main' }} onClick={() => { if (confirm(`ลบ ${r.lc_no}?`)) del.mutate(r.id); }}>
                        <DeleteIcon size={14} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
}
