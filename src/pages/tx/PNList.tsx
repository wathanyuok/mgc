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
import { type PromissoryNote, FINANCE_INSTITUTIONS } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';

const PN_STATUSES = ['Draft', 'Approved', 'Active', 'Roll Over', 'Repaid', 'Cancelled'] as const;

const statusColor = (s: string): 'success' | 'default' | 'warning' | 'error' =>
  s === 'Active' || s === 'Approved' ? 'success' : s === 'Repaid' ? 'default' : s === 'Cancelled' ? 'error' : 'warning';

export function PNList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { filter, patch } = useModuleFilter('pn');
  const { search, bank: fi, statusFilter: status } = filter;

  const { data, isLoading } = useQuery({
    queryKey: ['pn-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('promissory_notes').select('*').order('transaction_date', { ascending: false });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as PromissoryNote[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r) => r.name.toLowerCase().includes(s) || (r.pn_number ?? '').toLowerCase().includes(s));
      }
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('promissory_notes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pn-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Promissory Note</Typography>
        <Typography variant="body2" color="text.secondary">List</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/pn/new')}>
          New Promissory Note
        </Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField
              label="Search" placeholder="ค้นหา Name / P/N Number…"
              value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }}
            />
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>
              {FINANCE_INSTITUTIONS.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>
              {PN_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box>
        ) : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
            <Typography sx={{ fontSize: 32, mb: 1 }}>📜</Typography>
            <Typography variant="body2">ไม่พบ Promissory Note</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>P/N Number</TableCell>
                  <TableCell>Finance Institution</TableCell>
                  <TableCell>Transaction Date</TableCell>
                  <TableCell>Maturity Date</TableCell>
                  <TableCell align="right">Term (Days)</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Currency</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/tx/pn/${r.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/tx/pn/${r.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    <TableCell><MuiLink component={Link} to={`/tx/pn/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>{r.name}</MuiLink></TableCell>
                    <TableCell>{r.pn_number}</TableCell>
                    <TableCell>{r.finance_institution}</TableCell>
                    <TableCell>{fmtDate(r.transaction_date)}</TableCell>
                    <TableCell>{r.maturity_date ? fmtDate(r.maturity_date) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.term_days ?? '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount)}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={statusColor(r.status)} /></TableCell>
                    <TableCell align="right">
                      <IconButton size="small" sx={{ color: 'error.main' }} onClick={() => { if (confirm(`ลบ ${r.name}?`)) del.mutate(r.id); }}>
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
