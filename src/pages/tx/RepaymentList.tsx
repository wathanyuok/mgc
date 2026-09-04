import { useState } from 'react';
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
import { type Repayment, FACILITY_TYPES, type APChequeRequest } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { useFacilityTypesMap } from '@/lib/facility-types';
import { usePaged, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { friendlySaveError } from '@/lib/save-error';

import { logDelete } from '@/lib/audit-trail';
// Add facility_type as computed field derived from FK for display + export.
type RepaymentWithCode = Repayment & { facility_type?: string };

const statusColor = (s: string): 'success' | 'error' | 'default' =>
  s === 'Posted' ? 'success' : s === 'Reversed' ? 'error' : 'default';

const chequeStatusColor = (s: string): 'warning' | 'info' | 'success' | 'error' | 'default' => {
  if (s === 'Pending') return 'warning';
  if (s === 'Approved' || s === 'Issued') return 'info';
  if (s === 'Cleared') return 'success';
  if (s === 'Cancelled') return 'error';
  return 'default';
};

type RepaymentRow = RepaymentWithCode & {
  _cheque?: APChequeRequest | null;
  /** สัญญาที่ใบนี้ตัดชำระให้ — หัวรายการเก็บได้แค่ใบแรก จึงต้องนับจากบรรทัดจริง */
  _contracts?: string[];
};

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
  const { can } = useAuth();
  const { filter, patch } = useModuleFilter('repayment');
  const { search, typeFilter: type, statusFilter: status } = filter;
  // Source filter — not persisted (transient) since most users default to "All"
  const [sourceFilter, setSourceFilter] = useState<'' | RepaymentSource>('');
  const { codeToId } = useFacilityTypesMap();

  const { data, isLoading } = useQuery<RepaymentRow[]>({
    queryKey: ['rep-list', search, type, status, sourceFilter],
    queryFn: async () => {
      // Migration 0076: filter on facility_type_id (FK); join facility_types(code) for display.
      let q = supabase.from('repayments').select('*, facility_types(code)').order('pay_date', { ascending: false });
      if (type) {
        const ftId = codeToId(type);
        if (ftId) q = q.eq('facility_type_id', ftId);
      }
      if (status) q = q.eq('status', status);
      if (sourceFilter === 'Bank') q = q.not('bank_statement_line_id', 'is', null);
      const { data: reps, error } = await q;
      if (error) throw error;
      let rows = (reps ?? []).map((r: any) => ({
        ...r,
        facility_type: r.facility_types?.code ?? '',
      })) as RepaymentWithCode[];
      if (search) rows = rows.filter((r) => r.repayment_no.toLowerCase().includes(search.toLowerCase()));
      // Apply Cheque/Manual filters in JS (channel-based)
      if (sourceFilter === 'Cheque') {
        rows = rows.filter((r) => !r.bank_statement_line_id && r.channel === 'AP');
      } else if (sourceFilter === 'Manual') {
        rows = rows.filter((r) => !r.bank_statement_line_id && r.channel !== 'AP');
      }
      // ไม่จำกัดตามบริษัทที่ผู้ใช้ดูแล — ตั้งใจไม่กรอง
      //
      // ใบตัดชำระเป็นงานของฝ่ายการเงินซึ่งทำงานรวมศูนย์ ไม่ได้แยกตามบริษัท
      // และเอกสารหนึ่งใบอ้างถึงสัญญาได้หลายฉบับซึ่งอาจเป็นคนละบริษัท
      // จะตัดสินว่าใบนี้เป็นของบริษัทไหนไม่ได้ · กรองแล้วผู้ใช้จะงงว่าทำไมบางใบหาย
      //
      // สิทธิ์เมนูกันไว้อยู่แล้ว — คนนอกฝ่ายเข้าเมนูนี้ไม่ได้ตั้งแต่ต้น
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
      // สัญญาที่ถูกตัดชำระจริง — หัวรายการเก็บไว้แค่ใบแรก ถ้าโชว์ช่องนั้นจะเข้าใจผิดว่าตัดใบเดียว
      const { data: allocLines } = await supabase
        .from('repayment_lines')
        .select('repayment_id, facility_id, contract_label')
        .in('repayment_id', repaymentIds);
      const contractMap = new Map<string, string[]>();
      (allocLines ?? []).forEach((l: any) => {
        if (!l.repayment_id || !l.facility_id) return;
        const list = contractMap.get(l.repayment_id) ?? [];
        const label = l.contract_label || l.facility_id;
        if (!list.includes(label)) list.push(label);
        contractMap.set(l.repayment_id, list);
      });
      return rows.map((r) => ({
        ...r,
        _cheque: chequeMap.get(r.id) ?? null,
        _contracts: contractMap.get(r.id) ?? [],
      }));
    },
  });

  const del = useMutation({
    mutationFn: async (row: RepaymentRow) => {
      const id = row.id;
      // 1) สิทธิ์ — เดิมปุ่มลบไม่ตรวจอะไรเลย ใครเปิดหน้ารายการได้ก็ลบใบตัดชำระได้
      if (!can('repayment', 'edit')) throw new Error('ไม่มีสิทธิ์ลบใบตัดชำระ');
      // 2) ใบที่ลงบัญชีแล้วห้ามลบ — ยอดที่ตัดไปแล้วจะหายจากรายงาน แต่ใบสำคัญยังค้างอยู่
      if (row.status === 'Posted') {
        throw new Error('ลบไม่ได้ — ใบนี้ลงบัญชีไปแล้ว ต้องกลับรายการใบสำคัญก่อน');
      }
      // 3) มีใบสำคัญผูกอยู่ก็ห้ามลบ — ใบสำคัญจะกลายเป็นเอกสารลอยที่หาต้นทางไม่เจอ
      const { data: jes } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_type', 'REPAYMENT')
        .eq('source_id', id)
        .limit(3);
      if (jes && jes.length > 0) {
        throw new Error(
          `ลบไม่ได้ — ใบนี้มีใบสำคัญผูกอยู่ (${jes.map((j: any) => j.je_number).join(', ')}) `
          + 'ต้องกลับรายการใบสำคัญก่อน',
        );
      }
      const { error } = await supabase.from('repayments').delete().eq('id', id);
      if (error) throw error;
      logDelete('repayments', id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rep-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => toast.error(friendlySaveError(e)),
  });



  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>Repayment</Typography>
        <Typography variant="body2" color="text.secondary">บันทึกการรับชำระรวมทุกประเภทวงเงิน · ติดตามเช็คจ่าย</Typography>
      </Stack>
      {/* ส่งออก Excel ย้ายไปที่เมนูรายงานทั้งหมด — หน้ารายการทุกหน้าจึงไม่มีปุ่มนี้ */}
      <Box sx={{ mb: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/repayment/new')}>New Repayment</Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
            <TextField inputProps={{ maxLength: 200 }} label="Search" placeholder="Repayment No" value={search} onChange={(e) => patch({ search: e.target.value })}
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
          <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary', fontSize: 14 }}>ไม่พบ Repayment</Box>
        ) : (
          <><TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>Repayment No</TableCell>
                  <TableCell>Facility</TableCell>
                  <TableCell>Contracts</TableCell>
                  <TableCell>Pay Date</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Principal</TableCell>
                  <TableCell align="right">Interest</TableCell>
                  <TableCell align="right">Fee</TableCell>
                  <TableCell>Channel</TableCell>
                  {/* หัวตารางเดิมตกคอลัมน์นี้ไป ข้อมูลทุกแถวจึงเลื่อนไปคนละช่องกับหัว */}
                  <TableCell>Source</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Cheque No</TableCell>
                  <TableCell>AP Status</TableCell>
                  <TableCell>NetSuite AP</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((r) => (
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
                    {/* ใบเดียวตัดได้หลายสัญญา — โชว์เลขที่เมื่อมีใบเดียว ถ้าหลายใบให้บอกจำนวน */}
                    <TableCell sx={{ fontSize: 12 }} title={(r._contracts ?? []).join(', ')}>
                      {!r._contracts || r._contracts.length === 0
                        ? <Typography variant="caption" color="text.secondary">—</Typography>
                        : r._contracts.length === 1
                          ? r._contracts[0]
                          : `${r._contracts.length} สัญญา`}
                    </TableCell>
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
                      <IconButton
                        size="small"
                        sx={{ color: 'error.main' }}
                        disabled={!can('repayment', 'edit') || r.status === 'Posted'}
                        title={
                          !can('repayment', 'edit') ? 'ไม่มีสิทธิ์ลบใบตัดชำระ'
                            : r.status === 'Posted' ? 'ลงบัญชีแล้ว — ต้องกลับรายการใบสำคัญก่อน'
                              : 'ลบ'
                        }
                        onClick={() => { if (confirm(`ลบ ${r.repayment_no}?`)) del.mutate(r); }}
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
