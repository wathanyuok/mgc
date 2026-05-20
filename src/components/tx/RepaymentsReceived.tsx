import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fmtMoney, fmtDate } from '@/lib/format';
import { REPAYMENT_CATEGORIES } from '@/types/database';

/**
 * Shows actual repayments received on a facility (any TX type), pulled from the
 * Repayment module (Posted only). Makes a repayment visibly "ตัด" the contract.
 * Matches by facility_id (UUID is unique across tables).
 *
 * Optional `principal` / `interest` props show a Remaining column when given.
 */
export function RepaymentsReceived({
  facilityId,
  principal,
  interest,
}: {
  facilityId?: string;
  principal?: number;
  interest?: number;
}) {
  const { data: rows = [] } = useQuery({
    queryKey: ['fac-repaid', facilityId],
    enabled: !!facilityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('repayment_lines')
        .select('category, amount, repayments!inner(status, repayment_no, pay_date, channel)')
        .eq('facility_id', facilityId!)
        .eq('repayments.status', 'Posted');
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const totals: Record<string, number> = { Principal: 0, Interest: 0, Fee: 0, Penalty: 0 };
  let grand = 0;
  for (const r of rows) {
    totals[r.category] = (totals[r.category] ?? 0) + (r.amount ?? 0);
    grand += r.amount ?? 0;
  }

  if (!facilityId) return null;

  return (
    <div className="mt-4">
      <div className="text-sm font-semibold mb-2">Repayments Received (Actual)</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted bg-soft border border-line rounded p-3">
          ยังไม่มี Repayment ที่ Posted สำหรับสัญญานี้ (ทำได้ที่เมนู Repayment)
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-3">
            {REPAYMENT_CATEGORIES.map((c) => (
              <div key={c} className="rounded border border-line bg-soft p-2.5">
                <div className="text-[10px] text-muted uppercase tracking-wide">{c}</div>
                <div className="text-right tabular-nums font-semibold text-emerald-700">{fmtMoney(totals[c])}</div>
              </div>
            ))}
            <div className="rounded border border-brand bg-blue-50 p-2.5">
              <div className="text-[10px] text-brand uppercase tracking-wide font-semibold">Total Paid</div>
              <div className="text-right tabular-nums font-bold text-brand">{fmtMoney(grand)}</div>
            </div>
          </div>

          {(principal != null || interest != null) && (
            <div className="overflow-x-auto max-w-md mb-3">
              <table className="table-base text-xs">
                <thead>
                  <tr>
                    <th>Outstanding</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Repaid</th>
                    <th className="text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {principal != null && (
                    <tr>
                      <td className="font-semibold">Principal</td>
                      <td className="text-right tabular-nums">{fmtMoney(principal)}</td>
                      <td className="text-right tabular-nums text-emerald-700">{fmtMoney(totals.Principal)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtMoney(Math.max(0, principal - totals.Principal))}</td>
                    </tr>
                  )}
                  {interest != null && (
                    <tr>
                      <td className="font-semibold">Interest</td>
                      <td className="text-right tabular-nums">{fmtMoney(interest)}</td>
                      <td className="text-right tabular-nums text-emerald-700">{fmtMoney(totals.Interest)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtMoney(Math.max(0, interest - totals.Interest))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="table-base text-xs">
              <thead>
                <tr>
                  <th>RP No</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Channel</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.repayments?.repayment_no}</td>
                    <td>{r.repayments?.pay_date ? fmtDate(r.repayments.pay_date) : '—'}</td>
                    <td>{r.category}</td>
                    <td className="text-muted">{r.repayments?.channel ?? '—'}</td>
                    <td className="text-right tabular-nums">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
