import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus as AddIcon, Search as SearchIcon, Trash2 as DeleteIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Box, Stack, Typography, Button, TextField, MenuItem, InputAdornment, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, IconButton, Link as MuiLink,
} from '@mui/material';
import { supabase } from '@/lib/supabase';
import { LG_TYPES, LG_STATUSES } from '@/types/database';
import { fmtDate, fmtMoney, fmtDateISO} from '@/lib/format';
import { type LetterGuarantee } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { useBankCodes } from '@/lib/banks';
import { usePaged, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  reverseOffBalance, LG_ISSUE_SOURCE, LG_REVERSE_SOURCES,
} from '@/lib/offbalance-reverse';

import { logDelete } from '@/lib/audit-trail';

// บัญชีนอกงบของหนังสือค้ำประกัน — ต้องตรงกับที่หน้ารายละเอียดใช้ตอนบันทึกภาระผูกพัน
const LG_GL = {
  contingent:       { code: '900100', name: 'Contingent Liability — LG/BG (Off-Balance)' },
  contingentContra: { code: '900200', name: 'Contra — LG/BG Commitment' },
};

export function LGList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { filter, patch } = useModuleFilter('lg');
  const { search, typeFilter: type, bank: fi, statusFilter: status } = filter;

  const { data, isLoading } = useQuery({
    queryKey: ['lg-list', search, type, fi, status],
    queryFn: async () => {
      const today = fmtDateISO(new Date());
      // หน้ารายการเป็นคนเปลี่ยนสถานะเป็นหมดอายุให้เอง จึงต้องกลับรายการภาระผูกพันนอกงบตรงนี้ด้วย
      // เดิมกลับรายการเฉพาะตอนมีคนเปิดหน้ารายละเอียด — ถ้าไม่มีใครเปิด ยอดนอกงบจะค้างอยู่ตลอด
      const { data: toExpire } = await supabase
        .from('letter_guarantees')
        .select('id, name, lg_no, amount, expiry_date')
        .in('status', ['Approved', 'Active'])
        .lt('expiry_date', today);
      for (const row of toExpire ?? []) {
        try {
          await reverseOffBalance({
            sourceId: row.id,
            issueSourceType: LG_ISSUE_SOURCE,
            reverseSourceType: 'LG_EXPIRE_REVERSE',
            allReverseSourceTypes: LG_REVERSE_SOURCES,
            amount: row.amount ?? 0,
            jeDate: today,
            label: row.name ?? row.lg_no,
            reason: `ครบกำหนด (วันสิ้นสุด ${row.expiry_date})`,
            accounts: LG_GL,
          });
        } catch (e) {
          console.warn('กลับรายการภาระผูกพันนอกงบไม่สำเร็จ:', e);
        }
      }
      if (toExpire && toExpire.length > 0) {
        await supabase.from('letter_guarantees').update({ status: 'Expired' })
          .in('id', toExpire.map((r) => r.id));
        qc.invalidateQueries({ queryKey: ['je-list'] });
      }
      let q = supabase.from('letter_guarantees').select('*').order('issue_date', { ascending: false });
      if (type) q = q.eq('lg_type', type);
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as LetterGuarantee[];
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter((r) => r.lg_no.toLowerCase().includes(s) || r.beneficiary.toLowerCase().includes(s));
      }
      return rows;
    },
  });

  // ลบรายการ — เดิมไม่ตรวจอะไรเลย ใครเปิดหน้ารายการได้ก็ลบฉบับที่ใช้งานอยู่และลงบัญชีไปแล้วได้
  const del = useMutation({
    mutationFn: async (row: LetterGuarantee) => {
      const id = row.id;
      if (!can('lg', 'edit')) throw new Error('ไม่มีสิทธิ์ลบหนังสือค้ำประกัน');
      // ฉบับที่ลงบัญชีไปแล้วห้ามลบ — ใบสำคัญจะกลายเป็นเอกสารลอยที่หาต้นทางไม่เจอ
      const { data: jes } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_id', id)
        .limit(3);
      if (jes && jes.length > 0) {
        throw new Error(
          `ลบไม่ได้ — มีใบสำคัญผูกอยู่ (${jes.map((j: any) => j.je_number).join(', ')}) `
          + 'ถ้าต้องการยกเลิก ให้เปลี่ยนสถานะเป็น Cancelled แทน',
        );
      }
      // เหลือลบได้เฉพาะฉบับร่างกับฉบับที่ยกเลิกไว้ — ฉบับที่ใช้งานอยู่หรือจบแล้วต้องเก็บเป็นหลักฐาน
      if (row.status !== 'Draft' && row.status !== 'Cancelled') {
        throw new Error(`ลบได้เฉพาะสถานะ Draft หรือ Cancelled — สถานะปัจจุบัน: ${row.status}`);
      }
      const { error } = await supabase.from('letter_guarantees').delete().eq('id', id);
      if (error) throw error;
      logDelete('letter_guarantees', id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lg-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(e.message),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Letter of Guarantee / Bank Guarantee</Typography>
        <Typography variant="body2" color="text.secondary">List</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/lg/new')}>New LG / BG</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
            <TextField label="Search" placeholder="ค้นหา LG No / Beneficiary…" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Type" select value={type} onChange={(e) => patch({ typeFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{LG_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>
              {bankCodes.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>
              {LG_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}><Typography sx={{ fontSize: 32, mb: 1 }}>🛡️</Typography><Typography variant="body2">ไม่พบ LG / BG</Typography></Box>
        ) : (
          <><TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>LG No</TableCell><TableCell>Type</TableCell><TableCell>Finance Institution</TableCell>
                  <TableCell>Beneficiary</TableCell><TableCell align="right">Amount</TableCell>
                  <TableCell>Issue Date</TableCell><TableCell>Expiry Date</TableCell><TableCell>Status</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/tx/lg/${r.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/tx/lg/${r.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    <TableCell><MuiLink component={Link} to={`/tx/lg/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>{r.lg_no}</MuiLink></TableCell>
                    <TableCell><Chip size="small" label={r.lg_type} color={r.lg_type === 'L/G' ? 'primary' : r.lg_type === 'B/G' ? 'warning' : 'default'} /></TableCell>
                    <TableCell>{r.finance_institution}</TableCell>
                    <TableCell>{r.beneficiary}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount)}</TableCell>
                    <TableCell>{fmtDate(r.issue_date)}</TableCell>
                    <TableCell>{fmtDate(r.expiry_date)}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={r.status === 'Active' ? 'success' : 'default'} /></TableCell>
                    <TableCell align="right">
                      <IconButton size="small" sx={{ color: 'error.main' }} onClick={() => { if (confirm(`ลบ ${r.lg_no}?`)) del.mutate(r); }}>
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
