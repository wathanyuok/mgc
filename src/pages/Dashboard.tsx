import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Box, Card, CardContent, Stack, Typography, Avatar } from '@mui/material';
import { FileText, Car, CreditCard, AlertCircle } from 'lucide-react';

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
    </Box>
  );
}
