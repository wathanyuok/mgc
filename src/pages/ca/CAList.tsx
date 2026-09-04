import { Link, useNavigate } from 'react-router-dom';
import { ClearFilters } from '@/components/shared/ClearFilters';
import { useAuth } from '@/lib/auth';
import { canSeeSubsidiary } from '@/lib/subsidiary-scope';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus as AddIcon, Search as SearchIcon, Trash2 as DeleteIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Box, Stack, Typography, Button, TextField, MenuItem, InputAdornment, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, IconButton, Link as MuiLink,
} from '@mui/material';
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtMoney } from '@/lib/format';
import {
  type CreditAgreement,
  CA_STATUS,
} from '@/types/database';
import { useFacilityTypes } from '@/lib/facility-types';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { useBankCodes } from '@/lib/banks';
import { usePaged, Pagination } from '@/components/ui';

import { logDelete } from '@/lib/audit-trail';
const statusColor = (s: string): 'success' | 'default' | 'warning' | 'error' => {
  if (s === 'Approved') return 'success';
  if (s === 'Expired') return 'warning';
  if (s === 'Terminated') return 'error';
  return 'default';
};

export function CAList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { filter, patch, clear } = useModuleFilter('ca');
  const { search, bank: fi, typeFilter: ft, statusFilter: status } = filter;
  const { facilityTypes } = useFacilityTypes();
  const { scope } = useAuth();   // บริษัทที่ผู้ใช้ดูแล

  const { data, isLoading } = useQuery({
    queryKey: ['ca-list', search, fi, ft, status, scope.all, scope.codes.join(',')],
    queryFn: async () => {
      let q = supabase
        .from('credit_agreements')
        .select('*, master_agreements(ma_name), facility_types(id, code, name_en)')
        .order('created_at', { ascending: false })
        .order('ca_name');
      if (fi) q = q.eq('finance_institution', fi);
      if (ft) q = q.eq('facility_type_id', ft);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as any[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r) => r.ca_name.toLowerCase().includes(s) || (r.contract_number ?? '').toLowerCase().includes(s));
      }
      // จำกัดตามบริษัทที่ผู้ใช้ดูแล — วงเงินย่อยมีบริษัทของตัวเองอยู่แล้ว ดูช่องเดียวจบ
      if (!scope.all) rows = rows.filter((r) => canSeeSubsidiary(scope, r.subsidiary));
      return rows as (CreditAgreement & { master_agreements: { ma_name: string } | null })[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('credit_agreements').delete().eq('id', id);
      if (error) throw error;
      logDelete('credit_agreements', id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ca-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1500, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Credit Agreement</Typography>
        <Typography variant="body2" color="text.secondary">List</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/ca/new')}>New Credit Agreement</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr) auto' }, gap: 1.5 }}>
            <TextField inputProps={{ maxLength: 200 }} label="Search" placeholder="ค้นหา Credit Agreement Name…" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{bankCodes.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Facility Type" select value={ft} onChange={(e) => patch({ typeFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>
              {facilityTypes.map((f) => <MenuItem key={f.id} value={f.id}>{f.name_en}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{CA_STATUS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <ClearFilters filter={filter} onClear={clear} />
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary', fontSize: 14 }}>
            ไม่พบ Credit Agreement
          </Box>
        ) : (
          <><TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>Name</TableCell><TableCell>Contract Number</TableCell><TableCell>Master Agreement</TableCell>
                  <TableCell>Subsidiary</TableCell><TableCell>Facility Type</TableCell><TableCell>Finance Institution</TableCell>
                  <TableCell>Start Date</TableCell><TableCell>End Date</TableCell>
                  <TableCell align="right">Credit Line</TableCell><TableCell align="right">Utilization</TableCell><TableCell align="right">Remaining</TableCell>
                  <TableCell>Status</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/ca/${c.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/ca/${c.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    <TableCell><MuiLink component={Link} to={`/ca/${c.id}`} underline="hover" sx={{ fontWeight: 500 }}>{c.ca_name}</MuiLink></TableCell>
                    <TableCell>{c.contract_number}</TableCell>
                    <TableCell>{c.master_agreements?.ma_name ?? '—'}</TableCell>
                    <TableCell>{c.subsidiary}</TableCell>
                    <TableCell><Chip size="small" label={(c as any).facility_types?.name_en ?? '—'} color="primary" variant="outlined" /></TableCell>
                    <TableCell>{c.finance_institution ?? '—'}</TableCell>
                    <TableCell>{fmtDate(c.start_date)}</TableCell>
                    <TableCell>{fmtDate(c.end_date)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.credit_line)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.utilization)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.remaining)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={c.status} color={statusColor(c.status)} />
                      {/* ฉบับร่างที่เคยถูกตีกลับ — แยกจากร่างที่ยังไม่เคยส่งด้วยตาไม่ได้ */}
                      {c.status === 'Draft' && (c as any).rejection_reason && (
                        <Chip size="small" label="ถูกส่งกลับแก้" color="warning" variant="outlined"
                          title={String((c as any).rejection_reason)} sx={{ ml: 0.5 }} />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" sx={{ color: 'error.main' }} onClick={() => { if (confirm(`ลบ ${c.ca_name}?`)) del.mutate(c.id); }}>
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
