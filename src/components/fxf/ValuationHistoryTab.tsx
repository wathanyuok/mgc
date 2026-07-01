// FX Valuation History Tab — Feature v3-2
// ---------------------------------------------------------------
// Shows fx_valuations snapshots — one row per (FXF × valuation_date).
// User can filter by month/currency/status and click through to the JE.
// Metric cards summarise MTM totals for the visible filter.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box, Card, CardContent, Stack, Typography, TextField, MenuItem,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Chip, Link as MuiLink,
} from '@mui/material';
import { supabase } from '@/lib/supabase';
import { fmtDate, fmtMoney } from '@/lib/format';

interface ValuationRow {
  id: string;
  fxf_id: string;
  fxf_no: string;
  currency: string;
  valuation_date: string;
  contract_rate: number;
  month_end_rate: number;
  notional_amount: number;
  mtm_thb: number;
  status: 'Draft' | 'Posted' | 'Reversed';
  je_id: string | null;
  je_number: string | null;
}

const statusColor = (s: string): 'success' | 'default' | 'warning' =>
  s === 'Posted' ? 'success' : s === 'Reversed' ? 'default' : 'warning';

function monthLabelISO(iso: string): string {
  // YYYY-MM-DD → YYYY-MM (used for month filter values)
  return iso.slice(0, 7);
}

function monthDisplay(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const mi = parseInt(m, 10) - 1;
  return `${months[mi] ?? m} ${y}`;
}

export function ValuationHistoryTab() {
  const [monthKey, setMonthKey] = useState<string>('');
  const [ccy, setCcy] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: ['fx-valuations-history'],
    queryFn: async () => {
      // Fetch valuations + join FXF for fxf_no/currency + JE for je_number
      const { data: rows, error } = await supabase
        .from('fx_valuations')
        .select(`
          id, fxf_id, valuation_date, contract_rate, month_end_rate,
          notional_amount, mtm_thb, status, je_id,
          fx_forwards!inner(fxf_no, currency, ccy_buy, direction),
          journal_entries(je_number)
        `)
        .order('valuation_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (rows ?? []).map((r: any) => ({
        id: r.id,
        fxf_id: r.fxf_id,
        fxf_no: r.fx_forwards?.fxf_no ?? '—',
        currency: (r.fx_forwards?.currency || r.fx_forwards?.ccy_buy || '').toUpperCase(),
        valuation_date: r.valuation_date,
        contract_rate: Number(r.contract_rate),
        month_end_rate: Number(r.month_end_rate),
        notional_amount: Number(r.notional_amount),
        mtm_thb: Number(r.mtm_thb),
        status: r.status,
        je_id: r.je_id,
        je_number: r.journal_entries?.je_number ?? null,
      })) as ValuationRow[];
    },
  });

  // Derive filter options from data
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((r) => set.add(monthLabelISO(r.valuation_date)));
    return Array.from(set).sort().reverse();
  }, [data]);

  const ccyOptions = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((r) => r.currency && set.add(r.currency));
    return Array.from(set).sort();
  }, [data]);

  // Apply filters client-side
  const filtered = useMemo(() => {
    return (data ?? []).filter((r) => {
      if (monthKey && monthLabelISO(r.valuation_date) !== monthKey) return false;
      if (ccy && r.currency !== ccy) return false;
      if (status && r.status !== status) return false;
      return true;
    });
  }, [data, monthKey, ccy, status]);

  // Metrics
  const metrics = useMemo(() => {
    const total = filtered.reduce((s, r) => s + r.mtm_thb, 0);
    const posted = filtered.filter((r) => r.status === 'Posted').length;
    const reversed = filtered.filter((r) => r.status === 'Reversed').length;
    return { total, posted, reversed, count: filtered.length };
  }, [filtered]);

  return (
    <Box>
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            <TextField label="Month" select value={monthKey} onChange={(e) => setMonthKey(e.target.value)}>
              <MenuItem value="">– All –</MenuItem>
              {monthOptions.map((m) => (
                <MenuItem key={m} value={m}>{monthDisplay(m)}</MenuItem>
              ))}
            </TextField>
            <TextField label="Currency" select value={ccy} onChange={(e) => setCcy(e.target.value)}>
              <MenuItem value="">– All –</MenuItem>
              {ccyOptions.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>
            <TextField label="Status" select value={status} onChange={(e) => setStatus(e.target.value)}>
              <MenuItem value="">– All –</MenuItem>
              {['Draft', 'Posted', 'Reversed'].map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </TextField>
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        {isLoading ? (
          <Box sx={{ p: 3, color: 'text.secondary' }}>กำลังโหลด...</Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
            <Typography sx={{ fontSize: 32, mb: 1 }}>📜</Typography>
            <Typography variant="body2">ยังไม่มี Valuation ณ ตัวกรองนี้</Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
              กลับไป Tab "FX Forwards" → กดปุ่ม 🧮 รัน Valuation รายเดือน เพื่อสร้าง snapshot
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 110 }}>Valuation Date</TableCell>
                  <TableCell>FXF No</TableCell>
                  <TableCell>CCY</TableCell>
                  <TableCell align="right">Contract Rate</TableCell>
                  <TableCell align="right">Month-End Rate</TableCell>
                  <TableCell align="right">Notional</TableCell>
                  <TableCell align="right">MTM (THB)</TableCell>
                  <TableCell>JE</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>{fmtDate(r.valuation_date)}</TableCell>
                    <TableCell>
                      <MuiLink component={Link} to={`/tx/fxf/${r.fxf_id}`} underline="hover" sx={{ fontWeight: 500, fontSize: 13 }}>
                        {r.fxf_no}
                      </MuiLink>
                    </TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.contract_rate.toFixed(4)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.month_end_rate.toFixed(4)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(r.notional_amount, { decimals: 2 })}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 600,
                        color: r.mtm_thb > 0 ? 'success.main' : r.mtm_thb < 0 ? 'error.main' : 'inherit',
                      }}
                    >
                      {r.mtm_thb >= 0 ? '+' : ''}{fmtMoney(r.mtm_thb, { decimals: 2 })}
                    </TableCell>
                    <TableCell>
                      {r.je_id ? (
                        <MuiLink component={Link} to={`/je/${r.je_id}`} underline="hover" sx={{ fontSize: 12 }}>
                          {r.je_number ?? r.je_id.slice(0, 8)}
                        </MuiLink>
                      ) : (
                        <Box sx={{ color: 'text.disabled', fontSize: 12 }}>—</Box>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={r.status} color={statusColor(r.status)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
        <Card sx={{ flex: 1 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary">
              Total MTM ({monthKey ? monthDisplay(monthKey) : 'ทุกเดือน'}{ccy ? ` · ${ccy}` : ''})
            </Typography>
            <Typography
              sx={{
                fontSize: 18,
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: metrics.total > 0 ? 'success.main' : metrics.total < 0 ? 'error.main' : 'text.primary',
              }}
            >
              {metrics.total >= 0 ? '+' : ''}{fmtMoney(metrics.total, { decimals: 2 })} THB
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary">Snapshots</Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {metrics.count}
            </Typography>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" color="text.secondary">Posted / Reversed</Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {metrics.posted} / {metrics.reversed}
            </Typography>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
