import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui';
import { FileText, Car, CreditCard, AlertCircle } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color }: any) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div>
          <div className="text-xs text-muted">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { data: maCount } = useQuery({
    queryKey: ['ma-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('master_agreements')
        .select('*', { count: 'exact', head: true });
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
      const { count, error } = await supabase
        .from('credit_agreements')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-muted mb-6">ภาพรวมโมดูล Lease + HP + IFRS 16</p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard icon={FileText} label="Master Agreements" value={maCount ?? '–'} color="bg-brand" />
        <StatCard icon={CreditCard} label="Credit Agreements" value={caCount ?? '–'} color="bg-emerald-600" />
        <StatCard icon={Car} label="Leases" value={leaseCount ?? '–'} color="bg-purple-600" />
        <StatCard icon={AlertCircle} label="Pending Review" value="0" color="bg-amber-500" />
      </div>
    </div>
  );
}
