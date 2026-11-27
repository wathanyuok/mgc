import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { confirmDelete } from '@/lib/confirm';
import { ClearFilters } from '@/components/shared/ClearFilters';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus as AddIcon, Search as SearchIcon, Trash2 as DeleteIcon, ChevronRight, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  Box, Stack, Typography, Button, TextField, MenuItem, InputAdornment, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, IconButton, Link as MuiLink,
} from '@mui/material';
import { supabase } from '@/lib/supabase';
import { statusBadgeColor } from '@/lib/status-lock';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type LetterOfCredit } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { useBankCodes } from '@/lib/banks';
import { usePaged, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { filterByScope } from '@/lib/scope-filter';
import { friendlySaveError } from '@/lib/save-error';

import { logDelete } from '@/lib/audit-trail';

export function LCList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, scope } = useAuth();   // scope = บริษัทที่ผู้ใช้ดูแล
  const canEdit = can('lc', 'edit');
  const { filter, patch, clear } = useModuleFilter('lc');
  const { search, bank: fi, statusFilter: status } = filter;

  const { data, isLoading } = useQuery({
    queryKey: ['lc-list', search, fi, status, scope.all, scope.codes.join(',')],
    queryFn: async () => {
      // ปกติแสดงเฉพาะสัญญาแม่ — สัญญาย่อย (lot รับมอบ) ไปดูในหน้าสัญญาแม่ · กันยอดรวมนับซ้ำ
      // แต่ตอน "ค้นหา" ให้เจอ sub-LC ด้วย (พิมพ์ LC-001-S1 แล้วเจอ) — โชว์ badge บอกว่าเป็น lot ของตัวแม่
      const hasSearch = !!search;
      let q = supabase.from('letters_of_credit').select('*')
        .order('created_at', { ascending: false });
      if (!hasSearch) q = q.is('parent_lc_id', null);   // ลิสต์เปล่า = เฉพาะแม่ · ค้นหา = รวมลูก
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as LetterOfCredit[];
      if (search) rows = rows.filter((r) => r.lc_no.toLowerCase().includes(search.toLowerCase()) || (r.beneficiary ?? '').toLowerCase().includes(search.toLowerCase()));
      // จำกัดตามบริษัทที่ผู้ใช้ดูแล — บริษัทของรายการมาจากวงเงินย่อยที่ผูกอยู่
      const scoped = await filterByScope(rows as any[], scope);
      return scoped as typeof rows;
    },
  });

  // sub-LC (lot การรับมอบ) ทั้งหมด จัดกลุ่มตามตัวแม่ — ใช้แตกแถวใต้ LC แม่ (expandable)
  // โหลดเฉพาะตอนไม่ได้ search (ตอน search แสดงผล flat อยู่แล้ว)
  const { data: childMap } = useQuery({
    queryKey: ['lc-children', scope.all, scope.codes.join(',')],
    enabled: !search,
    queryFn: async () => {
      const { data, error } = await supabase.from('letters_of_credit').select('*')
        .not('parent_lc_id', 'is', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const scoped = await filterByScope((data ?? []) as any[], scope) as LetterOfCredit[];
      const m: Record<string, LetterOfCredit[]> = {};
      for (const c of scoped) {
        const pid = (c as any).parent_lc_id as string;
        (m[pid] ??= []).push(c);
      }
      return m;
    },
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ลบได้เฉพาะรายการที่ยังไม่เดินเรื่อง และต้องไม่มีอะไรผูกอยู่
  // เดิมกดปุ่มถังขยะแล้วลบทันที ไม่ว่าจะลงบัญชีไปแล้วหรือแตกสัญญาย่อยไปแล้วก็ตาม
  const del = useMutation({
    mutationFn: async (row: LetterOfCredit) => {
      if (!canEdit) throw new Error('ไม่มีสิทธิ์ลบเลตเตอร์ออฟเครดิต');
      if (row.status !== 'Draft' && row.status !== 'Cancelled') {
        throw new Error(`ลบไม่ได้ — สถานะ ${row.status} · ลบได้เฉพาะฉบับร่างหรือรายการที่ถูกปฏิเสธ`);
      }
      if ((row as any).converted_tr_id) {
        throw new Error('ลบไม่ได้ — แปลงเป็นทรัสต์รีซีทไปแล้ว');
      }
      const [je, subs, trs] = await Promise.all([
        supabase.from('journal_entries').select('id', { count: 'exact', head: true }).eq('source_id', row.id),
        supabase.from('letters_of_credit').select('id', { count: 'exact', head: true }).eq('parent_lc_id', row.id),
        supabase.from('trust_receipts').select('id', { count: 'exact', head: true }).eq('source_lc_id', row.id),
      ]);
      if ((je.count ?? 0) > 0) throw new Error('ลบไม่ได้ — มีใบสำคัญทางบัญชีผูกอยู่กับรายการนี้');
      if ((subs.count ?? 0) > 0) throw new Error('ลบไม่ได้ — มีสัญญาย่อยจากการรับมอบแบบทยอยอยู่');
      if ((trs.count ?? 0) > 0) throw new Error('ลบไม่ได้ — มีทรัสต์รีซีทที่แปลงไปจากรายการนี้');

      const { error } = await supabase.from('letters_of_credit').delete().eq('id', row.id);
      if (error) throw error;
      logDelete('letters_of_credit', row.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lc-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(friendlySaveError(e)),
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ

  // แถวเดียวของตาราง — ใช้ซ้ำทั้งแถวแม่และแถวลูก (lot)
  const renderRow = (r: LetterOfCredit, opts: { isChild?: boolean; hasChildren?: boolean; open?: boolean } = {}) => {
    const { isChild, hasChildren, open } = opts;
    return (
      <TableRow key={r.id} hover sx={isChild ? { bgcolor: 'grey.50' } : undefined}>
        <TableCell>
          <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
            <MuiLink component={Link} to={`/tx/lc/${r.id}`} underline="hover">Edit</MuiLink>
            <Box sx={{ color: 'grey.400' }}>|</Box>
            <MuiLink component={Link} to={`/tx/lc/${r.id}?view=1`} underline="hover">View</MuiLink>
          </Stack>
        </TableCell>
        <TableCell>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ pl: isChild ? 7 : 0 }}>
            {hasChildren ? (
              <IconButton size="small" sx={{ p: 0.25, width: 22, height: 22 }} onClick={() => toggle(r.id)}
                title={open ? 'ย่อ lot' : 'แตกดู lot'}>
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </IconButton>
            ) : !isChild ? <Box sx={{ width: 22 }} /> : null}
            <Box>
              <MuiLink component={Link} to={`/tx/lc/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>{r.lc_no}</MuiLink>
              {(r as any).parent_lc_id && (
                <Box sx={{ fontSize: 10, color: 'grey.500' }}>↳ lot ของ {r.lc_no.replace(/-S\d+$/, '')}</Box>
              )}
            </Box>
          </Stack>
        </TableCell>
        <TableCell><Chip size="small" label={r.lc_type} color={r.lc_type === 'SBLC' ? 'warning' : 'default'} /></TableCell>
        <TableCell>{r.finance_institution}</TableCell>
        <TableCell>{r.beneficiary}</TableCell>
        <TableCell>{r.issue_date ? fmtDate(r.issue_date) : '—'}</TableCell>
        <TableCell>{r.expiry_date ? fmtDate(r.expiry_date) : '—'}</TableCell>
        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount_foreign)}</TableCell>
        <TableCell>{r.currency}</TableCell>
        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount)}</TableCell>
        <TableCell>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
            <Chip size="small" label={r.status} color={statusBadgeColor(r.status)} />
            {r.status === 'Draft' && (r as any).rejection_reason && (
              <Chip size="small" label="ถูกส่งกลับแก้" color="warning" variant="outlined"
                title={String((r as any).rejection_reason)} />
            )}
          </div>
        </TableCell>
        <TableCell align="right">
          <IconButton size="small" sx={{ color: 'error.main' }}
            disabled={!canEdit || del.isPending}
            title={!canEdit ? 'ไม่มีสิทธิ์ลบ' : 'ลบรายการนี้'}
            onClick={async () => { if (await confirmDelete({ title: `ลบ ${r.lc_no}?` })) del.mutate(r); }}>
            <DeleteIcon size={14} />
          </IconButton>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Letter of Credit</Typography>
        <Typography variant="body2" color="text.secondary">Off-Balance / Fee-based · Flow LC → TR</Typography>
      </Stack>
      <Box sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/lc/new')}>New Letter of Credit</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr) auto' }, gap: 1.5 }}>
            <TextField inputProps={{ maxLength: 200 }} label="Search" placeholder="LC No / Beneficiary" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{bankCodes.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{['Draft', 'Pending Approval', 'Active', 'Converted', 'Expired', 'Closed', 'Cancelled'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <ClearFilters filter={filter} onClear={clear} />
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary', fontSize: 14 }}>ไม่พบ Letter of Credit</Box>
        ) : (
          <><TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell sx={{ pl: '42px' }}>LC No</TableCell><TableCell>Type</TableCell><TableCell>FI</TableCell>
                  <TableCell>Beneficiary</TableCell><TableCell>Issue</TableCell><TableCell>Expiry</TableCell>
                  <TableCell align="right">Amount (Foreign)</TableCell><TableCell>Ccy</TableCell>
                  <TableCell align="right">THB Equiv.</TableCell><TableCell>Status</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((r) => {
                  const kids = (!search && childMap?.[r.id]) || [];
                  const open = expanded.has(r.id);
                  return [
                    renderRow(r, { hasChildren: kids.length > 0, open }),
                    ...(open ? kids.map((c) => renderRow(c, { isChild: true })) : []),
                  ];
                })}
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
