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
import type { Lease } from '@/types/database';

type LeaseRow = Lease & { credit_agreements?: { ca_name: string } | null };
import { useModuleFilter } from '@/stores/useFiltersStore';
import { usePaged, Pagination } from '@/components/ui';

import { logDelete } from '@/lib/audit-trail';
// ค่าต้องตรงกับตัวเลือก ASSET TYPE ในหน้ารายละเอียด ไม่งั้นตัวกรองจะไม่เจอแถวไหนเลย
const TYPES_CREDIT = ['ยานพาหนะ', 'อุปกรณ์'] as const;          // Hire Purchase · Leasing
const TYPES_OTHER = ['อาคาร / ที่ดิน', 'สำนักงาน', 'อุปกรณ์'] as const;  // Leasing Other
const LEASE_STATUSES = ['Draft', 'Approved', 'Active', 'Roll Over', 'Closed', 'Modified'] as const;

// สัญญาเช่า 3 ชนิด — ต่างกันที่แหล่งเงินและกรรมสิทธิ์ปลายทาง
const KINDS = {
  hp: {
    route: '/lease/hp', moduleKey: 'leaseHp', types: TYPES_CREDIT, emoji: '🚗',
    title: 'Hire Purchase',
    subtitle: 'เช่าซื้อ — ใช้วงเงินธนาคาร · กรรมสิทธิ์โอนเป็นของผู้เช่าซื้อเมื่อผ่อนครบ',
  },
  lease: {
    route: '/lease/leasing', moduleKey: 'leaseLeasing', types: TYPES_CREDIT, emoji: '🔑',
    title: 'Leasing',
    subtitle: 'เช่า — ใช้วงเงินธนาคาร · กรรมสิทธิ์ยังเป็นของผู้ให้เช่า',
  },
  other: {
    route: '/lease/other', moduleKey: 'leaseOther', types: TYPES_OTHER, emoji: '🏢',
    title: 'Leasing Other',
    subtitle: 'สัญญาเช่าอื่น — ที่ดิน อาคาร โกดัง · ไม่ใช้วงเงินธนาคาร เปิดสัญญาได้เลย',
  },
} as const;

export function LeaseList({ mode }: { mode: 'hp' | 'lease' | 'other' }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const kind = KINDS[mode];
  const { route: baseRoute, title, subtitle } = kind;
  // Leasing Other ไม่ใช้วงเงินธนาคาร จึงไม่มี Credit Agreement ให้แสดงหรือกรอง
  const usesCredit = mode !== 'other';
  const { filter, patch } = useModuleFilter(kind.moduleKey);
  const { search, caFilter, typeFilter, statusFilter: stFilter } = filter;
  const types = kind.types;

  const { data: caOptions = [] } = useQuery({
    queryKey: ['lease-list-ca-options'],
    enabled: usesCredit,
    queryFn: async () => {
      const { data } = await supabase.from('credit_agreements').select('id, ca_name').order('ca_name');
      return (data ?? []) as { id: string; ca_name: string }[];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['lease-list', mode, search, caFilter, typeFilter, stFilter],
    queryFn: async () => {
      let q = supabase
        .from('leases')
        .select('*, credit_agreements(ca_name)')
        .eq('mode', mode)
        .order('created_at', { ascending: false });
      if (usesCredit && caFilter) q = q.eq('ca_id', caFilter);
      if (typeFilter) q = q.eq('asset_type', typeFilter);
      if (stFilter) q = q.eq('status', stFilter);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as LeaseRow[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r) => r.lease_no.toLowerCase().includes(s) || r.asset_name.toLowerCase().includes(s));
      }
      return rows;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('leases').delete().eq('id', id);
      if (error) throw error;
      logDelete('leases', id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lease-list'] }); toast.success('ลบสัญญา Lease แล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Leases Agreement — {title}</Typography>
        <Typography variant="body2" color="text.secondary">{subtitle}</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate(`${baseRoute}/new`)}>New Lease Contract</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
            <TextField label="Search" placeholder="ค้นหา Lease Name / Contract Number…" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            {usesCredit && (
              <TextField label="Credit Agreement" select value={caFilter} onChange={(e) => patch({ caFilter: e.target.value })}>
                <MenuItem value="">– All –</MenuItem>
                {caOptions.map((c) => <MenuItem key={c.id} value={c.id}>{c.ca_name}</MenuItem>)}
              </TextField>
            )}
            <TextField label="Type" select value={typeFilter} onChange={(e) => patch({ typeFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{types.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={stFilter} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{LEASE_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
            <Typography sx={{ fontSize: 32, mb: 1 }}>{kind.emoji}</Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>ยังไม่มี {title}</Typography>
            <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate(`${baseRoute}/new`)}>สร้างใหม่</Button>
          </Box>
        ) : (
          <>
            <><TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                    <TableCell>Lease Name</TableCell><TableCell>Contract Number</TableCell><TableCell>Type</TableCell>
                    {usesCredit && <TableCell>Credit Agreement</TableCell>}<TableCell>Contract Date</TableCell>
                    <TableCell align="right">Term (M)</TableCell><TableCell align="right">Principal Amount</TableCell>
                    <TableCell align="right">Amount / Month</TableCell>
                    <TableCell>Classification</TableCell><TableCell>Status</TableCell><TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pg.rows.map((l) => (
                    <TableRow key={l.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                          <MuiLink component={Link} to={`${baseRoute}/${l.id}`} underline="hover">Edit</MuiLink>
                          <Box sx={{ color: 'grey.400' }}>|</Box>
                          <MuiLink component={Link} to={`${baseRoute}/${l.id}`} underline="hover">View</MuiLink>
                        </Stack>
                      </TableCell>
                      <TableCell><MuiLink component={Link} to={`${baseRoute}/${l.id}`} underline="hover" sx={{ fontWeight: 500 }}>{l.lease_no}</MuiLink></TableCell>
                      <TableCell>{l.lease_no}</TableCell>
                      <TableCell>{l.asset_type}</TableCell>
                      {usesCredit && <TableCell>{l.credit_agreements?.ca_name ?? '—'}</TableCell>}
                      <TableCell>{fmtDate(l.start_date)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{l.term_months}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(l.principal)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(estMonthly(l))}</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{mode === 'other' ? 'Operating' : 'Finance'}</TableCell>
                      <TableCell><Chip size="small" label={l.status} color={l.status === 'Active' ? 'success' : 'default'} /></TableCell>
                      <TableCell align="right">
                        <IconButton size="small" sx={{ color: 'error.main' }} onClick={() => { if (confirm(`ลบ ${l.lease_no}?`)) del.mutate(l.id); }}>
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
            <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider', fontSize: 12, color: 'text.secondary' }}>
              1 - {data.length} of {data.length}
            </Box>
          </>
        )}
      </Card>
    </Box>
  );
}

function estMonthly(l: Lease): number {
  const r = (l.annual_rate || 0) / 100 / 12;
  const n = l.term_months;
  const p = l.principal - (l.upfront_payment ?? 0);
  if (r === 0) return p / n;
  return (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}
