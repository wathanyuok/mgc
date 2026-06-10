import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Box, Card, CardContent, Stack, Typography, Avatar, Chip, LinearProgress } from '@mui/material';
import { FileText, Car, CreditCard, AlertCircle, Globe, ShieldCheck, AlertTriangle } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: any; color: string }) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Avatar sx={{ width: 48, height: 48, bgcolor: color, borderRadius: 1.5 }}>
            <Icon size={22} />
          </Avatar>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
            <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>{value}</Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

// FX Exposure Monitor (TOR353 — Foreign Currency Monitor) ------------------------------
type FxRow = { currency: string; exposure: number; hedged: number };

const ACTIVE_LIABILITY = ['Active', 'Issued', 'Modified', 'Drawn', 'Roll Over'];
const ACTIVE_FXF = ['Active', 'Hedged', 'Open'];

function useFxExposure() {
  return useQuery<FxRow[]>({
    queryKey: ['fx-exposure'],
    queryFn: async () => {
      // Sum foreign-currency liabilities across modules where status is active
      const [loans, lcs, trs, lgs, fxfs] = await Promise.all([
        supabase.from('loans').select('currency, amount_foreign, status').not('currency', 'eq', 'THB').not('amount_foreign', 'is', null),
        supabase.from('letter_of_credit').select('currency, amount_foreign, status').not('currency', 'eq', 'THB').not('amount_foreign', 'is', null),
        supabase.from('trust_receipts').select('currency, amount_foreign, status').not('currency', 'eq', 'THB').not('amount_foreign', 'is', null),
        supabase.from('letter_guarantees').select('currency, amount_foreign, status').not('currency', 'eq', 'THB').not('amount_foreign', 'is', null),
        supabase.from('fx_forwards').select('currency, notional_amount_foreign, status').not('currency', 'eq', 'THB').not('notional_amount_foreign', 'is', null),
      ]);

      const buckets: Record<string, FxRow> = {};
      const addExposure = (rows: any[] | null, statusList: string[]) => {
        if (!rows) return;
        for (const r of rows) {
          if (!statusList.includes(r.status)) continue;
          const ccy = (r.currency || 'OTHER').toUpperCase();
          const amt = Number(r.amount_foreign) || 0;
          if (!buckets[ccy]) buckets[ccy] = { currency: ccy, exposure: 0, hedged: 0 };
          buckets[ccy].exposure += amt;
        }
      };
      const addHedge = (rows: any[] | null) => {
        if (!rows) return;
        for (const r of rows) {
          if (!ACTIVE_FXF.includes(r.status)) continue;
          const ccy = (r.currency || 'OTHER').toUpperCase();
          const amt = Number(r.notional_amount_foreign) || 0;
          if (!buckets[ccy]) buckets[ccy] = { currency: ccy, exposure: 0, hedged: 0 };
          buckets[ccy].hedged += amt;
        }
      };

      addExposure(loans.data, ACTIVE_LIABILITY);
      addExposure(lcs.data, ACTIVE_LIABILITY);
      addExposure(trs.data, ACTIVE_LIABILITY);
      addExposure(lgs.data, ACTIVE_LIABILITY);
      addHedge(fxfs.data);

      return Object.values(buckets).sort((a, b) => b.exposure - a.exposure);
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

function FxExposureMonitor() {
  const { data: rows = [], isLoading } = useFxExposure();
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
          <Avatar sx={{ width: 36, height: 36, bgcolor: '#0ea5e9', borderRadius: 1.5 }}>
            <Globe size={18} />
          </Avatar>
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Foreign Currency Monitor</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
              ภาระผูกพันต่างประเทศรวมจาก Loan / LC / TR / LG เทียบกับ FX Forward ที่ Hedge ไว้
            </Typography>
          </Box>
        </Stack>

        {isLoading && <LinearProgress />}
        {!isLoading && rows.length === 0 && (
          <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 2, textAlign: 'center' }}>
            ไม่มีภาระผูกพันสกุลต่างประเทศที่ active
          </Typography>
        )}

        {!isLoading && rows.length > 0 && (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 1, alignItems: 'center' }}>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>Currency</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600, textAlign: 'right' }}>Exposure</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600, textAlign: 'right' }}>Hedged (FXF)</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600, textAlign: 'right' }}>Unhedged</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 600, textAlign: 'right' }}>Cover %</Typography>

            {rows.map((r) => {
              const unhedged = Math.max(0, r.exposure - r.hedged);
              const coverPct = r.exposure > 0 ? Math.min(100, (r.hedged / r.exposure) * 100) : 0;
              const risk = coverPct < 50;
              return (
                <Box key={r.currency} sx={{ display: 'contents' }}>
                  <Chip size="small" label={r.currency} sx={{ width: 60, fontWeight: 700 }} />
                  <Typography sx={{ fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.exposure)}</Typography>
                  <Typography sx={{ fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'success.main' }}>{fmt(r.hedged)}</Typography>
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                    {risk && unhedged > 0 && <AlertTriangle size={13} color="#ef4444" />}
                    {!risk && coverPct >= 100 && <ShieldCheck size={13} color="#10b981" />}
                    <Typography sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: risk ? 'error.main' : 'text.primary', fontWeight: risk ? 600 : 400 }}>
                      {fmt(unhedged)}
                    </Typography>
                  </Stack>
                  <Box>
                    <LinearProgress
                      variant="determinate"
                      value={coverPct}
                      color={coverPct >= 80 ? 'success' : coverPct >= 50 ? 'warning' : 'error'}
                      sx={{ height: 6, borderRadius: 1 }}
                    />
                    <Typography sx={{ fontSize: 10, textAlign: 'right', color: 'text.secondary', mt: 0.2 }}>{coverPct.toFixed(0)}%</Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { data: maCount } = useQuery({
    queryKey: ['ma-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('master_agreements').select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: leaseCount } = useQuery({
    queryKey: ['lease-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('leases').select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: caCount } = useQuery({
    queryKey: ['ca-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('credit_agreements').select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
      <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, mb: 0.5 }}>Dashboard</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>ภาพรวมโมดูล Lease + HP + IFRS 16</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 3 }}>
        <StatCard icon={FileText} label="Master Agreements" value={maCount ?? '–'} color="primary.main" />
        <StatCard icon={CreditCard} label="Credit Agreements" value={caCount ?? '–'} color="success.main" />
        <StatCard icon={Car} label="Leases" value={leaseCount ?? '–'} color="#7c3aed" />
        <StatCard icon={AlertCircle} label="Pending Review" value="0" color="warning.main" />
      </Box>

      <FxExposureMonitor />
    </Box>
  );
}
