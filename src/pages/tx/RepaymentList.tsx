import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus as AddIcon, Search as SearchIcon, Trash2 as DeleteIcon, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import {
  Box, Stack, Typography, Button, TextField, MenuItem, InputAdornment, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, IconButton, Link as MuiLink,
} from '@mui/material';
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type Repayment, FACILITY_TYPES, type APChequeRequest } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';

const statusColor = (s: string): 'success' | 'error' | 'default' =>
  s === 'Posted' ? 'success' : s === 'Reversed' ? 'error' : 'default';

const chequeStatusColor = (s: string): 'warning' | 'info' | 'success' | 'error' | 'default' => {
  if (s === 'Pending') return 'warning';
  if (s === 'Approved' || s === 'Issued') return 'info';
  if (s === 'Cleared') return 'success';
  if (s === 'Cancelled') return 'error';
  return 'default';
};

type RepaymentRow = Repayment & { _cheque?: APChequeRequest | null };

// Source classification — derived from where the Repayment was created.
// Bank      = back-linked to a bank_statement_lines row (Source = Bank Statement Import)
// Cheque    = channel uses Cheque / AP Module (cheque-issued workflow)
// Manual    = no FK + non-cheque channel (user typed on form)
type RepaymentSource = 'Bank' | 'Cheque' | 'Manual';
const SOURCE_OPTIONS: RepaymentSource[] = ['Bank', 'Cheque', 'Manual'];

function deriveSource(r: Repayment): RepaymentSource {
  if (r.bank_statement_line_id) return 'Bank';
  // Migration 0047: channel='AP' replaces legacy 'AP Module' + 'Cheque' channels
  if (r.channel === 'AP') return 'Cheque';
  return 'Manual';
}

const sourceColor = (s: RepaymentSource): 'primary' | 'warning' | 'default' =>
  s === 'Bank' ? 'primary' : s === 'Cheque' ? 'warning' : 'default';

export function RepaymentList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { filter, patch } = useModuleFilter('repayment');
  const { search, typeFilter: type, statusFilter: status } = filter;
  // Source filter — not persisted (transient) since most users default to "All"
  const [sourceFilter, setSourceFilter] = useState<'' | RepaymentSource>('');

  const { data, isLoading } = useQuery<RepaymentRow[]>({
    queryKey: ['rep-list', search, type, status, sourceFilter],
    queryFn: async () => {
      let q = supabase.from('repayments').select('*').order('pay_date', { ascending: false });
      if (type) q = q.eq('facility_type', type);
      if (status) q = q.eq('status', status);
      if (sourceFilter === 'Bank') q = q.not('bank_statement_line_id', 'is', null);
      const { data: reps, error } = await q;
      if (error) throw error;
      let rows = (reps ?? []) as Repayment[];
      if (search) rows = rows.filter((r) => r.repayment_no.toLowerCase().includes(search.toLowerCase()));
      // Apply Cheque/Manual filters in JS (channel-based)
      if (sourceFilter === 'Cheque') {
        rows = rows.filter((r) => !r.bank_statement_line_id && r.channel === 'AP');
      } else if (sourceFilter === 'Manual') {
        rows = rows.filter((r) => !r.bank_statement_line_id && r.channel !== 'AP');
      }
      if (rows.length === 0) return [];
      // Pull cheque info for repayments using Cheque/AP Module
      const repaymentIds = rows.map((r) => r.id);
      const { data: cheques } = await supabase
        .from('ap_cheque_requests')
        .select('*')
        .in('repayment_id', repaymentIds);
      const chequeMap = new Map<string, APChequeRequest>();
      (cheques ?? []).forEach((c: any) => {
        if (c.repayment_id) chequeMap.set(c.repayment_id, c as APChequeRequest);
      });
      return rows.map((r) => ({ ...r, _cheque: chequeMap.get(r.id) ?? null }));
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('repayments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rep-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleExport = async () => {
    if (!data || data.length === 0) {
      toast.error('ไม่มีข้อมูลให้ export');
      return;
    }
    const XLSX = await import('xlsx');
    const rows = data.map((r) => ({
      'Repayment No': r.repayment_no,
      'Facility': r.facility_type,
      'Pay Date': r.pay_date,
      'Amount': r.amount,
      'Principal': r.principal,
      'Interest': r.interest,
      'Fee': r.fee,
      'Channel': r.channel,
      'Status': r.status,
      'Cheque No': r._cheque?.cheque_no ?? '',
      'Issued Date': r._cheque?.issued_date ?? '',
      'AP Status': r._cheque?.status ?? '',
      'NetSuite AP ID': r._cheque?.netsuite_ap_id ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Repayments');
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Repayments_${today}.xlsx`);
    toast.success(`Exported ${data.length} records → Excel`);
  };

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Repayment</Typography>
        <Typography variant="body2" color="text.secondary">Centralized repayment journal — covers all facility types · AP Cheque tracking (per MoM §3.2)</Typography>
      </Stack>
      <Box sx={{ mb: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/repayment/new')}>New Repayment</Button>
        <Button variant="outlined" startIcon={<FileSpreadsheet size={16} />} onClick={handleExport}>Export Excel</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
            <TextField label="Search" placeholder="Repayment No" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Facility Type" select value={type} onChange={(e) => patch({ typeFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{FACILITY_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{['Draft', 'Posted', 'Reversed'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField label="Source" select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as any)}
              helperText="ที่มาของ Repayment">
              <MenuItem value="">– All –</MenuItem>
              {SOURCE_OPTIONS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}><Typography variant="body2">ไม่พบ Repayment</Typography></Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>Repayment No</TableCell>
                  <TableCell>Facility</TableCell>
                  <TableCell>Pay Date</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Principal</TableCell>
                  <TableCell align="right">Interest</TableCell>
                  <TableCell align="right">Fee</TableCell>
                  <TableCell>Channel</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Cheque No</TableCell>
                  <TableCell>AP Status</TableCell>
                  <TableCell>NetSuite AP</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/tx/repayment/${r.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/tx/repayment/${r.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    <TableCell><MuiLink component={Link} to={`/tx/repayment/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>{r.repayment_no}</MuiLink></TableCell>
                    <TableCell><Chip size="small" label={r.facility_type} color="primary" /></TableCell>
                    <TableCell>{fmtDate(r.pay_date)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmtMoney(r.amount)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.principal)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'warning.dark' }}>{fmtMoney(r.interest)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.fee)}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.channel}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant={deriveSource(r) === 'Manual' ? 'outlined' : 'filled'}
                        label={deriveSource(r)}
                        color={sourceColor(deriveSource(r))}
                        title={r.bank_statement_line_id ? `Linked Bank Line: ${r.bank_statement_line_id.slice(0, 8)}...` : ''}
                      />
                    </TableCell>
                    <TableCell><Chip size="small" label={r.status} color={statusColor(r.status)} /></TableCell>
                    <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>{r._cheque?.cheque_no ?? '—'}</TableCell>
                    <TableCell>
                      {r._cheque ? (
                        <Chip size="small" label={r._cheque.status} color={chequeStatusColor(r._cheque.status)} />
                      ) : (
                        <Typography variant="caption" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 11, fontFamily: 'monospace', color: 'text.secondary' }}>{r._cheque?.netsuite_ap_id ?? '—'}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" sx={{ color: 'error.main' }} onClick={() => { if (confirm(`ลบ ${r.repayment_no}?`)) del.mutate(r.id); }}>
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
