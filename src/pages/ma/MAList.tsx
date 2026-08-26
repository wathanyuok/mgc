import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Box, Stack, Typography, Button, TextField, MenuItem, InputAdornment, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, IconButton, Link as MuiLink,
} from '@mui/material';
import { Plus as AddIcon, Search as SearchIcon, Trash2 as DeleteOutlineIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtMoney } from '@/lib/format';
import {
  type MasterAgreement,
  MA_STATUS,
} from '@/types/database';
import { useSubsidiaryCodes } from '@/lib/subsidiaries';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { useBankCodes } from '@/lib/banks';
import { usePaged, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { friendlySaveError } from '@/lib/save-error';

import { logDelete } from '@/lib/audit-trail';
const statusColor: Record<string, 'success' | 'default' | 'error' | 'warning'> = {
  Approved: 'success',
  Draft: 'default',
  Rejected: 'error',
  Expired: 'warning',
  Terminated: 'error',
};

export function MAList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { codes: subCodes } = useSubsidiaryCodes(); // Subsidiary Master (ชื่อย่อตามผัง)
  const { can } = useAuth();          // สิทธิ์แก้ไข — ผู้ที่ดูได้อย่างเดียวต้องลบไม่ได้
  const canEdit = can('ma', 'edit');
  const { filter, patch } = useModuleFilter('ma');
  const { search, subsidiary: subFilter, bank: fiFilter, statusFilter: stFilter } = filter;

  const { data, isLoading, error } = useQuery({
    queryKey: ['ma-list', search, subFilter, fiFilter, stFilter],
    queryFn: async () => {
      let q = supabase.from('master_agreements').select('*').order('ma_name');
      if (search) q = q.ilike('ma_name', `%${search}%`);
      if (subFilter) q = q.eq('subsidiary', subFilter);
      if (fiFilter) q = q.eq('finance_institution', fiFilter);
      if (stFilter) q = q.eq('status', stFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as MasterAgreement[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      // ทำไมต้องเช็คก่อนลบ: ความสัมพันธ์ในฐานข้อมูลตั้งเป็นแบบ "ล้างค่า" เมื่อสัญญาหลักถูกลบ
      // วงเงินที่ผูกอยู่จึงไม่หายไปด้วย แต่กลายเป็นวงเงินลอยที่ช่องสัญญาหลักว่าง (แสดงเป็น —)
      // ต้องกันไว้ตั้งแต่ต้น ไม่ให้ผู้ใช้ทำข้อมูลขาดต้นทางโดยไม่รู้ตัว
      const { data: linked, error: linkErr } = await supabase
        .from('credit_agreements')
        .select('ca_name, contract_number')
        .eq('ma_id', id)
        .order('ca_name');
      if (linkErr) throw linkErr;
      if (linked && linked.length > 0) {
        const sample = linked
          .slice(0, 3)
          .map((c: any) => c.contract_number || c.ca_name || '(ไม่มีเลขที่)')
          .join(' · ');
        throw new Error(
          `ลบไม่ได้ — มีวงเงินผูกอยู่กับสัญญาหลักนี้ ${linked.length} รายการ ` +
          `(${sample}${linked.length > 3 ? ' และอื่นๆ' : ''}) · ` +
          'ย้ายวงเงินไปสัญญาหลักอื่นหรือลบวงเงินเหล่านี้ก่อน',
        );
      }

      const { error } = await supabase.from('master_agreements').delete().eq('id', id);
      if (error) throw error;
      logDelete('master_agreements', id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ma-list'] });
      toast.success('ลบสัญญาแล้ว');
    },
    onError: (e: any) => toast.error(friendlySaveError(e)),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography variant="h1" sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Master Agreement</Typography>
        <Typography variant="body2" color="text.secondary">List</Typography>
      </Stack>

      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/ma/new')}>
          New Master Agreement
        </Button>
      </Box>

      {/* Filter bar */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
            <TextField
              label="Search"
              placeholder="ค้นหา Agreement Name…"
              value={search}
              onChange={(e) => patch({ search: e.target.value })}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon size={14} />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <TextField
              label="Subsidiary"
              select
              value={subFilter}
              onChange={(e) => patch({ subsidiary: e.target.value })}
            >
              <MenuItem value="">– All –</MenuItem>
              {subCodes.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Finance Institution"
              select
              value={fiFilter}
              onChange={(e) => patch({ bank: e.target.value })}
            >
              <MenuItem value="">– All –</MenuItem>
              {bankCodes.map((f) => (
                <MenuItem key={f} value={f}>{f}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Status"
              select
              value={stFilter}
              onChange={(e) => patch({ statusFilter: e.target.value })}
            >
              <MenuItem value="">– All –</MenuItem>
              {MA_STATUS.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {error ? (
          <Box sx={{ p: 3, color: 'error.main', fontSize: 14 }}>เกิดข้อผิดพลาด: {(error as any).message}</Box>
        ) : isLoading ? (
          <Box sx={{ p: 3, color: 'text.secondary', fontSize: 14 }}>กำลังโหลด...</Box>
        ) : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="h2" sx={{ mb: 1 }}>📄</Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>ไม่พบ Master Agreement</Typography>
            <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/ma/new')}>
              สร้างใหม่
            </Button>
          </Box>
        ) : (
          <>
            <><TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Subsidiary</TableCell>
                    <TableCell>Finance Institution</TableCell>
                    <TableCell>Start Date</TableCell>
                    <TableCell>End Date</TableCell>
                    <TableCell align="right">Credit Line</TableCell>
                    <TableCell align="right">Utilization</TableCell>
                    <TableCell align="right">Remaining</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pg.rows.map((m) => (
                    <TableRow key={m.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                          <MuiLink component={Link} to={`/ma/${m.id}`} underline="hover">Edit</MuiLink>
                          <Box sx={{ color: 'grey.400' }}>|</Box>
                          <MuiLink component={Link} to={`/ma/${m.id}?view=1`} underline="hover">View</MuiLink>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <MuiLink component={Link} to={`/ma/${m.id}`} underline="hover" sx={{ fontWeight: 500 }}>
                          {m.ma_name}
                        </MuiLink>
                      </TableCell>
                      <TableCell>{m.subsidiary}</TableCell>
                      <TableCell>{m.finance_institution}</TableCell>
                      <TableCell>{fmtDate(m.start_date)}</TableCell>
                      <TableCell>{fmtDate(m.end_date)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(m.credit_line)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(m.utilization)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(m.remaining_credit)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={m.status} color={statusColor[m.status] ?? 'default'} />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          disabled={!canEdit || del.isPending}
                          title={canEdit ? 'ลบสัญญาหลัก' : 'ไม่มีสิทธิ์ลบ'}
                          onClick={() => {
                            // กันไว้อีกชั้นเผื่อปุ่มถูกกดผ่านทางอื่น
                            if (!canEdit) { toast.error('ไม่มีสิทธิ์ลบสัญญาหลัก'); return; }
                            if (confirm(`ลบ ${m.ma_name}?`)) del.mutate(m.id);
                          }}
                          aria-label="delete"
                          sx={{ color: 'error.main' }}
                        >
                          <DeleteOutlineIcon size={14} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Pagination {...pg} />
          </>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1, borderTop: 1, borderColor: 'divider', fontSize: 12, color: 'text.secondary' }}>
              <span>1 - {data.length} of {data.length}</span>
            </Box>
          </>
        )}
      </Card>
    </Box>
  );
}
