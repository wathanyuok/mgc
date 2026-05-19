import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { postJE, reverseJE, voidJE } from '@/lib/je';
import { Button, Card, CardContent, Badge } from '@/components/ui';
import { fmtDate, fmtMoney } from '@/lib/format';
import { type JournalEntry, type JELine } from '@/types/database';

const statusVariant: Record<string, any> = {
  Draft: 'warn',
  Posted: 'success',
  Reversed: 'default',
  Voided: 'danger',
};

export function JEDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['je', id],
    enabled: !!id,
    queryFn: async () => {
      const [hdr, lines] = await Promise.all([
        supabase.from('journal_entries').select('*').eq('id', id!).single(),
        supabase.from('je_lines').select('*').eq('je_id', id!).order('line_no'),
      ]);
      if (hdr.error) throw hdr.error;
      return { je: hdr.data as JournalEntry, lines: (lines.data ?? []) as JELine[] };
    },
  });

  const post = useMutation({
    mutationFn: async () => postJE(id!, 'user'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('✓ Posted to GL');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reverse = useMutation({
    mutationFn: async () => reverseJE(id!, 'user'),
    onSuccess: (newJE) => {
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success(`✓ Reversed → ${newJE.je_number}`);
      navigate(`/je/${newJE.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const voidIt = useMutation({
    mutationFn: async () => voidJE(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['je', id] });
      qc.invalidateQueries({ queryKey: ['je-list'] });
      toast.success('Voided');
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-muted">กำลังโหลด...</div>;
  if (!data) return <div className="p-6">ไม่พบ JE</div>;
  const { je, lines } = data;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/je')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{je.je_number}</h1>
            <Badge variant={statusVariant[je.status] ?? 'default'}>{je.status}</Badge>
            {je.is_reversal && <Badge variant="warn">REVERSAL</Badge>}
          </div>
          <p className="text-muted text-sm">{je.description}</p>
        </div>

        {je.status === 'Draft' && (
          <>
            <Button variant="primary" onClick={() => post.mutate()} disabled={post.isPending}>
              <CheckCircle className="w-4 h-4" /> Post to GL
            </Button>
            <Button variant="danger" onClick={() => { if (confirm(`Void ${je.je_number}?`)) voidIt.mutate(); }}>
              <XCircle className="w-4 h-4" /> Void
            </Button>
          </>
        )}
        {je.status === 'Posted' && !je.is_reversal && (
          <Button onClick={() => { if (confirm(`Reverse ${je.je_number}?`)) reverse.mutate(); }}>
            <RotateCcw className="w-4 h-4" /> Reverse
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <Card><CardContent>
          <div className="text-xs text-muted">JE Date</div>
          <div className="font-semibold">{fmtDate(je.je_date)}</div>
        </CardContent></Card>
        <Card><CardContent>
          <div className="text-xs text-muted">Posting Period</div>
          <div className="font-semibold">{je.posting_period}</div>
        </CardContent></Card>
        <Card><CardContent>
          <div className="text-xs text-muted">Source</div>
          <div className="font-semibold">
            <Badge variant="brand">{je.source_type}</Badge>
            {je.source_period != null && <span className="ml-2 text-xs">Period {je.source_period}</span>}
          </div>
        </CardContent></Card>
      </div>

      {je.posted_at && (
        <Card className="mb-4">
          <CardContent>
            <div className="text-xs text-muted">Posted by</div>
            <div className="text-sm">{je.posted_by} · {fmtDate(je.posted_at)}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="table-base">
            <thead>
              <tr className="bg-brand text-white">
                <th className="!text-white !bg-brand w-10">#</th>
                <th className="!text-white !bg-brand">Account</th>
                <th className="!text-white !bg-brand">Description</th>
                <th className="!text-white !bg-brand text-right w-32">Dr</th>
                <th className="!text-white !bg-brand text-right w-32">Cr</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="text-right tabular-nums">{l.line_no}</td>
                  <td>
                    {l.account_code && <span className="text-xs text-muted mr-2">{l.account_code}</span>}
                    {l.account_name}
                  </td>
                  <td className="text-xs">{l.description}</td>
                  <td className="text-right tabular-nums">{l.dr > 0 ? fmtMoney(l.dr) : '—'}</td>
                  <td className="text-right tabular-nums">{l.cr > 0 ? fmtMoney(l.cr) : '—'}</td>
                </tr>
              ))}
              <tr className="bg-soft font-bold border-t-2 border-line">
                <td colSpan={3} className="text-right">Total</td>
                <td className="text-right tabular-nums">{fmtMoney(je.total_dr)}</td>
                <td className="text-right tabular-nums">{fmtMoney(je.total_cr)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {je.remark && (
        <Card className="mt-4">
          <CardContent>
            <div className="text-xs text-muted mb-1">Remark</div>
            <div className="text-sm">{je.remark}</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
