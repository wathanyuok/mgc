import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus as AddIcon, Search as SearchIcon, Trash2 as DeleteIcon, Calculator as CalcIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Box, Stack, Typography, Button, TextField, MenuItem, InputAdornment, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Chip, IconButton, Link as MuiLink,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtDateISO, fmtMoney } from '@/lib/format';
import { type FXForward } from '@/types/database';
import { useModuleFilter } from '@/stores/useFiltersStore';
import { computeMTM, findActiveForValuation, postFXValuationJE, assertNoValuationJE, valuationPeriod } from '@/lib/fx-valuation';
import { fetchSpotRatesFromNetSuite } from '@/lib/netsuite-stub';
import { useBankCodes } from '@/lib/banks';
import { usePaged, Pagination } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { computeStatusLock } from '@/lib/status-lock';

import { logDelete } from '@/lib/audit-trail';

// แยกสีของแต่ละสถานะให้ต่างกันจริง
// เดิม Cancelled / Closed / Pending Approval ตกลงมาเป็นสีส้มเหมือน Draft ทั้งหมด
// ทำให้สัญญาที่ถูกยกเลิกกับสัญญาที่ยังเป็นร่างดูเหมือนกันบนหน้ารายการ
const STATUS_COLOR: Record<string, 'success' | 'default' | 'warning' | 'error' | 'info' | 'secondary'> = {
  Draft: 'default',
  'Pending Approval': 'warning',
  Approved: 'info',
  Active: 'success',
  Settled: 'info',
  Closed: 'secondary',
  Cancelled: 'error',
};
const statusColor = (s: string) => STATUS_COLOR[s] ?? 'default';

const STATUS_FILTER_OPTIONS = ['Draft', 'Pending Approval', 'Active', 'Settled', 'Closed', 'Cancelled'];

export function FXFList() {
  const { codes: bankCodes } = useBankCodes(); // Bank Master (vendors)
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { filter, patch } = useModuleFilter('fxf');
  const { search, bank: fi, statusFilter: status } = filter;
  const [valuationOpen, setValuationOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['fxf-list', search, fi, status],
    queryFn: async () => {
      let q = supabase.from('fx_forwards').select('*').order('value_date', { ascending: true });
      if (fi) q = q.eq('finance_institution', fi);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as FXForward[];
      if (search) rows = rows.filter((r) => r.fxf_no.toLowerCase().includes(search.toLowerCase()));
      return rows;
    },
  });

  // ลบสัญญา — เดิมไม่ตรวจอะไรเลย
  //   • ใครเปิดหน้าได้ก็ลบได้
  //   • ลบสัญญาที่ปิดไปแล้วได้ ใบสำคัญค้างโดยไม่มีต้นเรื่อง
  //   • หนังสือเครดิตที่ผูกสัญญานี้ไว้ถูกล้างการอ้างอิงเงียบๆ (ฐานข้อมูลตั้งค่าเป็นล้างให้อัตโนมัติ)
  const del = useMutation({
    mutationFn: async (row: FXForward) => {
      if (!can('fxf', 'edit')) throw new Error('ไม่มีสิทธิ์ลบสัญญาซื้อขายเงินตราล่วงหน้า');
      if (computeStatusLock('FXF', row.status).isTerminal) {
        throw new Error(`สัญญาสถานะ ${row.status} ลบไม่ได้ — เป็นสัญญาที่จบแล้ว ต้องเก็บไว้เป็นหลักฐาน`);
      }

      const { data: jes } = await supabase
        .from('journal_entries')
        .select('je_number')
        .eq('source_id', row.id)
        .limit(1);
      if (jes && jes.length > 0) {
        throw new Error(`ลบไม่ได้ — มีใบสำคัญ ${jes[0].je_number} อ้างอิงสัญญานี้อยู่ · ต้องกลับรายการใบสำคัญก่อน`);
      }

      const { data: lcs } = await supabase
        .from('letters_of_credit')
        .select('lc_no')
        .eq('reference_fxf_id', row.id);
      if (lcs && lcs.length > 0) {
        const list = lcs.map((l: any) => l.lc_no).join(', ');
        const ok = window.confirm(
          `หนังสือเครดิต ${list} ผูกสัญญานี้ไว้อยู่ — ถ้าลบ การอ้างอิงและอัตราที่ดึงจากสัญญานี้จะหายไป\n\nยืนยันลบหรือไม่?`,
        );
        if (!ok) throw new Error('ยกเลิกการลบ');
      }

      const { error } = await supabase.from('fx_forwards').delete().eq('id', row.id);
      if (error) throw error;
      logDelete('fx_forwards', row.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fxf-list'] }); toast.success('ลบแล้ว'); },
    onError: (e: any) => { if (e.message !== 'ยกเลิกการลบ') toast.error(e.message); },
  });


  const pg = usePaged(data);   // แบ่งหน้ารายการ
  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Stack sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>FX Forward Rate</Typography>
        <Typography variant="body2" color="text.secondary">List</Typography>
      </Stack>
      <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
        <Button variant="contained" startIcon={<AddIcon size={16} />} onClick={() => navigate('/tx/fxf/new')}>New FX Forward</Button>
        <Button variant="outlined" startIcon={<CalcIcon size={16} />}
          disabled={!can('fxf', 'edit')}
          title={!can('fxf', 'edit') ? 'ไม่มีสิทธิ์ลงบัญชีตีราคา' : ''}
          onClick={() => setValuationOpen(true)}>
          🧮 ตีราคาสิ้นเดือนทั้งพอร์ต
        </Button>
      </Box>

      <MonthlyValuationDialog
        open={valuationOpen}
        canPost={can('fxf', 'edit')}
        onClose={() => setValuationOpen(false)}
        onPosted={() => qc.invalidateQueries({ queryKey: ['fxf-list'] })}
      />

      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField label="Search" placeholder="FXF No" value={search} onChange={(e) => patch({ search: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon size={14} /></InputAdornment> } }} />
            <TextField label="Finance Institution" select value={fi} onChange={(e) => patch({ bank: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{bankCodes.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => patch({ statusFilter: e.target.value })}>
              <MenuItem value="">– All –</MenuItem>{STATUS_FILTER_OPTIONS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box> : !data || data.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}><Typography sx={{ fontSize: 32, mb: 1 }}>💱</Typography><Typography variant="body2">ไม่พบ FX Forward</Typography></Box>
        ) : (
          <><TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Edit | View</TableCell>
                  <TableCell>FXF No</TableCell><TableCell>FI</TableCell><TableCell>Direction</TableCell>
                  <TableCell>Pair</TableCell>
                  <TableCell align="right">Amount Buy</TableCell><TableCell align="right">Amount Sell</TableCell>
                  <TableCell align="right">Forward Rate</TableCell>
                  <TableCell>Deal Date</TableCell><TableCell>Value Date</TableCell><TableCell>Status</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pg.rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ fontSize: 12 }}>
                        <MuiLink component={Link} to={`/tx/fxf/${r.id}`} underline="hover">Edit</MuiLink>
                        <Box sx={{ color: 'grey.400' }}>|</Box>
                        <MuiLink component={Link} to={`/tx/fxf/${r.id}?view=1`} underline="hover">View</MuiLink>
                      </Stack>
                    </TableCell>
                    <TableCell><MuiLink component={Link} to={`/tx/fxf/${r.id}`} underline="hover" sx={{ fontWeight: 500 }}>{r.fxf_no}</MuiLink></TableCell>
                    <TableCell>{r.finance_institution}</TableCell>
                    <TableCell><Chip size="small" label={r.direction} color={r.direction === 'Buy' ? 'success' : 'warning'} /></TableCell>
                    <TableCell>{r.ccy_buy}/{r.ccy_sell}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount_buy, { decimals: 4 })}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount_sell, { decimals: 2 })}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.forward_rate.toFixed(6)}</TableCell>
                    <TableCell>{fmtDate(r.deal_date)}</TableCell>
                    <TableCell>{fmtDate(r.value_date)}</TableCell>
                    <TableCell><Chip size="small" label={r.status} color={statusColor(r.status)} /></TableCell>
                    <TableCell align="right">
                      <IconButton size="small" sx={{ color: 'error.main' }} disabled={!can('fxf', 'edit')}
                        title={!can('fxf', 'edit') ? 'ไม่มีสิทธิ์ลบ' : 'ลบรายการ'}
                        onClick={() => { if (confirm(`ลบ ${r.fxf_no}?`)) del.mutate(r); }}>
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

// ════════════════════════════════════════════════════════════════════════════
// กล่องตีราคาสิ้นเดือนทั้งพอร์ต — ลงบัญชีผ่านทางเดียวกับปุ่มในหน้ารายละเอียด (lib/fx-valuation)
// ════════════════════════════════════════════════════════════════════════════

function lastDayOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

interface PreviewRow {
  fxf: FXForward;
  mtm_thb: number;
  notional_thb: number;
  month_end_rate: number;
  alreadyPosted: boolean;
}

function MonthlyValuationDialog({
  open, canPost, onClose, onPosted,
}: {
  open: boolean;
  canPost: boolean;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [valuationDate, setValuationDate] = useState<string>(() => fmtDateISO(lastDayOfMonth(new Date())));
  // Per-currency spot rates the user pastes in (e.g. USD=35.60)
  const [ratesText, setRatesText] = useState<string>('USD=35.60\nJPY=0.2400\nEUR=38.50');
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [posting, setPosting] = useState(false);
  const [fetchingRates, setFetchingRates] = useState(false);

  async function fetchRatesFromNS() {
    setFetchingRates(true);
    try {
      // Find currencies of currently-active FX Forwards so we only fetch what we need
      const active = await findActiveForValuation(valuationDate);
      const ccysNeeded = Array.from(new Set(
        active
          .map((a) => (a.currency || a.ccy_buy || '').toUpperCase())
          .filter(Boolean),
      ));
      const list = await fetchSpotRatesFromNetSuite(
        valuationDate,
        ccysNeeded.length > 0 ? ccysNeeded : undefined,
      );
      const text = list.map((r) => `${r.ccy}=${r.rate.toFixed(4)}`).join('\n');
      setRatesText(text);
      toast.success(`✓ ดึง rate จาก NetSuite สำเร็จ (${list.length} สกุล)`);
    } catch (e: any) {
      toast.error(e.message ?? 'fetch rates failed');
    } finally {
      setFetchingRates(false);
    }
  }

  const ratesMap = useMemo(() => {
    const m = new Map<string, number>();
    ratesText.split('\n').forEach((line) => {
      const [ccy, rate] = line.split('=').map((s) => s.trim());
      const n = Number(rate);
      if (ccy && Number.isFinite(n) && n > 0) m.set(ccy.toUpperCase(), n);
    });
    return m;
  }, [ratesText]);

  async function runPreview() {
    setPreviewing(true);
    try {
      const active = await findActiveForValuation(valuationDate);
      // Find already-posted to avoid double-posting
      const ids = active.map((a) => a.id);
      let posted = new Set<string>();
      if (ids.length > 0) {
        const { data: existing } = await supabase
          .from('fx_valuations')
          .select('fxf_id')
          .in('fxf_id', ids)
          .eq('valuation_date', valuationDate);
        posted = new Set((existing ?? []).map((r: any) => r.fxf_id as string));
      }
      const rows: PreviewRow[] = active.map((fxf) => {
        const rate = ratesMap.get((fxf.currency || fxf.ccy_buy || '').toUpperCase()) ?? 0;
        const { mtm_thb, notional_thb } = computeMTM(fxf, rate, valuationDate);
        return { fxf, mtm_thb, notional_thb, month_end_rate: rate, alreadyPosted: posted.has(fxf.id) };
      });
      setPreview(rows);
      if (rows.length === 0) toast.info('ไม่มี FX Forward ที่ Active ณ วันที่นี้');
    } catch (e: any) {
      toast.error(e.message ?? 'preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function postAll() {
    if (!preview) return;
    // ปุ่มลงบัญชีทั้งพอร์ตเดิมไม่ตรวจสิทธิ์เลย ใครเปิดหน้าได้ก็ลงบัญชีทั้งพอร์ตได้
    if (!canPost) { toast.error('ไม่มีสิทธิ์ลงบัญชีตีราคา'); return; }
    setPosting(true);
    let postedCnt = 0;
    let skipped = 0;
    try {
      for (const row of preview) {
        if (row.alreadyPosted) { skipped++; continue; }
        if (row.month_end_rate <= 0) { skipped++; continue; }
        // งวดนี้มีใบสำคัญอยู่แล้วหรือยัง — ตรวจอีกชั้นเผื่อมีคนลงจากหน้ารายละเอียดระหว่างกำลังดูตัวอย่าง
        try {
          await assertNoValuationJE(row.fxf.id, valuationPeriod(valuationDate));
        } catch { skipped++; continue; }
        // Insert valuation row (Draft)
        const { data: val, error } = await supabase
          .from('fx_valuations')
          .insert({
            fxf_id: row.fxf.id,
            valuation_date: valuationDate,
            month_end_rate: row.month_end_rate,
            contract_rate: row.fxf.forward_rate,
            notional_amount: row.fxf.notional_amount_foreign ?? row.fxf.amount_buy ?? 0,
            notional_thb: row.notional_thb,
            mtm_thb: row.mtm_thb,
            status: 'Draft',
          })
          .select()
          .single();
        if (error) { skipped++; continue; }
        // ใช้ผังบัญชีที่ผูกไว้กับสัญญาแต่ละใบ — ถ้าไม่ได้ผูกจะตกไปใช้ค่าตั้งต้นเอง
        await postFXValuationJE(val as any, row.fxf.fxf_no, row.fxf.acct_cards as any);
        postedCnt++;
      }
      toast.success(`✓ Posted ${postedCnt} · Skipped ${skipped}`);
      onPosted();
      onClose();
      setPreview(null);
    } catch (e: any) {
      toast.error(e.message ?? 'post failed');
    } finally {
      setPosting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>🧮 FX Forward — Monthly Valuation (MTM)</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            ณ สิ้นเดือนต้อง revalue FX Forward ที่ Active ทั้งหมด → post Unrealized FX Gain/Loss
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 2 }}>
            <TextField
              type="date"
              label="Valuation Date (สิ้นเดือน)"
              value={valuationDate}
              onChange={(e) => setValuationDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Spot Rates per Currency (วางทีละบรรทัด)"
              multiline
              minRows={3}
              value={ratesText}
              onChange={(e) => setRatesText(e.target.value)}
              helperText="รูปแบบ CCY=rate เช่น USD=35.60"
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="outlined" disabled={fetchingRates} onClick={fetchRatesFromNS}>
              {fetchingRates ? 'กำลังดึง rate...' : '⬇ ดึง Spot Rate จาก NetSuite'}
            </Button>
            <Button variant="outlined" disabled={previewing} onClick={runPreview}>
              {previewing ? 'กำลังคำนวณ...' : 'Preview'}
            </Button>
          </Box>

          {preview && (
            <TableContainer component={Card} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>FXF</TableCell>
                    <TableCell>CCY</TableCell>
                    <TableCell align="right">Notional</TableCell>
                    <TableCell align="right">Contract Rate</TableCell>
                    <TableCell align="right">Month-End Rate</TableCell>
                    <TableCell align="right">MTM (THB)</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.length === 0 && (
                    <TableRow><TableCell colSpan={7} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>ไม่พบ FX Forward ที่ Active ณ วันที่นี้</TableCell></TableRow>
                  )}
                  {preview.map((r) => (
                    <TableRow key={r.fxf.id}>
                      <TableCell>{r.fxf.fxf_no}</TableCell>
                      <TableCell>{r.fxf.currency}</TableCell>
                      <TableCell align="right">{fmtMoney(r.fxf.notional_amount_foreign ?? r.fxf.amount_buy)}</TableCell>
                      <TableCell align="right">{Number(r.fxf.forward_rate).toFixed(4)}</TableCell>
                      <TableCell align="right">{r.month_end_rate > 0 ? r.month_end_rate.toFixed(4) : <Chip size="small" label="missing" color="warning" />}</TableCell>
                      <TableCell align="right" sx={{ color: r.mtm_thb > 0 ? 'success.main' : r.mtm_thb < 0 ? 'error.main' : 'inherit', fontWeight: 600 }}>
                        {fmtMoney(r.mtm_thb)}
                      </TableCell>
                      <TableCell>
                        {r.alreadyPosted ? <Chip size="small" label="posted" color="success" /> : r.month_end_rate <= 0 ? <Chip size="small" label="no rate" color="warning" /> : <Chip size="small" label="ready" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!preview || preview.length === 0 || posting || !canPost}
          title={!canPost ? 'ไม่มีสิทธิ์ลงบัญชีตีราคา' : ''}
          onClick={postAll}
        >
          {posting ? 'กำลังลงบัญชี...' : 'ลงบัญชีทั้งหมด'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
