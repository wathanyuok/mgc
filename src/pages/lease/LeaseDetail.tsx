import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save, Calculator } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select, Badge } from '@/components/ui';
import { fmtMoney, fmtDate } from '@/lib/format';
import { buildSchedule, pmt } from '@/lib/lease-calc';
import type { Lease } from '@/types/database';

const schema = z.object({
  lease_no: z.string().min(1, 'กรอก Lease No'),
  mode: z.enum(['hp', 'other']),
  use_bank_loan: z.boolean(),
  asset_type: z.string().min(1),
  asset_name: z.string().min(1, 'กรอกชื่อสินทรัพย์'),
  vendor: z.string().optional(),
  vehicle_price: z.coerce.number().nullable().optional(),
  down_payment: z.coerce.number().nullable().optional(),
  principal: z.coerce.number().min(0, 'เงินต้นต้อง >= 0'),
  annual_rate: z.coerce.number().min(0).max(100),
  term_months: z.coerce.number().int().min(1, 'อย่างน้อย 1 งวด'),
  start_date: z.string().min(1),
  balloon_amount: z.coerce.number().nullable().optional(),
  balloon_pattern: z.string().nullable().optional(),
  upfront_payment: z.coerce.number().nullable().optional(),
  grace_periods: z.coerce.number().int().nullable().optional(),
  prepaid_periods: z.coerce.number().int().nullable().optional(),
  discount_rate: z.coerce.number().nullable().optional(),
  status: z.enum(['Draft', 'Active', 'Closed', 'Modified']),
  remark: z.string().nullable().optional(),
});

type FormData = z.infer<typeof schema>;

export function LeaseDetail({
  mode: pageMode,
  leaseMode,
}: {
  mode: 'new' | 'edit';
  leaseMode: 'hp' | 'other';
}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showSchedule, setShowSchedule] = useState(false);
  const baseRoute = leaseMode === 'hp' ? '/lease/hp' : '/lease/other';

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      lease_no: '',
      mode: leaseMode,
      use_bank_loan: leaseMode === 'hp' ? true : true,
      asset_type: leaseMode === 'hp' ? 'ยานพาหนะ' : 'อาคาร / ที่ดิน',
      asset_name: '',
      vendor: '',
      vehicle_price: 0,
      down_payment: 0,
      principal: 0,
      annual_rate: 4.65,
      term_months: 48,
      start_date: new Date().toISOString().slice(0, 10),
      balloon_amount: 0,
      balloon_pattern: 'with-last',
      upfront_payment: 0,
      grace_periods: 0,
      prepaid_periods: 0,
      discount_rate: 4.65,
      status: 'Draft',
      remark: '',
    },
  });

  const watched = useWatch({ control });

  const { data: existing } = useQuery({
    queryKey: ['lease', id],
    enabled: pageMode === 'edit' && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('leases').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as Lease;
    },
  });

  useEffect(() => {
    if (existing) {
      reset({
        lease_no: existing.lease_no,
        mode: existing.mode,
        use_bank_loan: existing.use_bank_loan,
        asset_type: existing.asset_type,
        asset_name: existing.asset_name,
        vendor: existing.vendor ?? '',
        vehicle_price: existing.vehicle_price ?? 0,
        down_payment: existing.down_payment ?? 0,
        principal: existing.principal,
        annual_rate: existing.annual_rate,
        term_months: existing.term_months,
        start_date: existing.start_date,
        balloon_amount: existing.balloon_amount ?? 0,
        balloon_pattern: existing.balloon_pattern ?? 'with-last',
        upfront_payment: existing.upfront_payment ?? 0,
        grace_periods: existing.grace_periods ?? 0,
        prepaid_periods: existing.prepaid_periods ?? 0,
        discount_rate: existing.discount_rate ?? 4.65,
        status: existing.status,
        remark: existing.remark ?? '',
      });
    }
  }, [existing, reset]);

  // HP auto-compute: Net Vehicle Cost = Vehicle Price - Down Payment → Principal
  useEffect(() => {
    if (watched.mode === 'hp') {
      const net = (watched.vehicle_price ?? 0) - (watched.down_payment ?? 0);
      if (net >= 0) setValue('principal', net, { shouldDirty: false });
    }
  }, [watched.vehicle_price, watched.down_payment, watched.mode, setValue]);

  // Build live schedule preview
  const schedule = useMemo(() => {
    if (!watched.principal || !watched.term_months || !watched.start_date) return [];
    try {
      return buildSchedule({
        principal: watched.principal,
        annualRate: watched.annual_rate ?? 0,
        termMonths: watched.term_months,
        startDate: watched.start_date,
        balloon: watched.balloon_amount ?? 0,
        upfront: watched.upfront_payment ?? 0,
        gracePeriods: watched.grace_periods ?? 0,
        prepaidPeriods: watched.prepaid_periods ?? 0,
      });
    } catch {
      return [];
    }
  }, [watched]);

  const monthlyEst = useMemo(() => {
    if (!watched.principal || !watched.term_months) return 0;
    return pmt(
      (watched.principal ?? 0) - (watched.upfront_payment ?? 0),
      watched.annual_rate ?? 0,
      Math.max(1, (watched.term_months ?? 0) - (watched.grace_periods ?? 0) - (watched.prepaid_periods ?? 0)),
      watched.balloon_amount ?? 0,
    );
  }, [watched]);

  const totalPayment = useMemo(
    () => schedule.reduce((sum, r) => sum + r.payment, 0),
    [schedule],
  );
  const totalInterest = useMemo(
    () => schedule.reduce((sum, r) => sum + r.interest, 0),
    [schedule],
  );

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const payload: any = {
        ...form,
        net_vehicle_cost:
          form.mode === 'hp' ? (form.vehicle_price ?? 0) - (form.down_payment ?? 0) : null,
      };
      let result: any;
      if (pageMode === 'new') {
        const { data, error } = await supabase.from('leases').insert(payload).select().single();
        if (error) throw error;
        result = data;
      } else {
        const { data, error } = await supabase
          .from('leases')
          .update(payload)
          .eq('id', id!)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      // Regenerate schedule rows
      await supabase.from('lease_schedules').delete().eq('lease_id', result.id);
      if (schedule.length > 0) {
        const rows = schedule.map((r) => ({
          lease_id: result.id,
          period: r.period,
          due_date: r.date,
          begin_balance: r.beginBalance,
          payment: r.payment,
          interest: r.interest,
          principal: r.principal,
          end_balance: r.endBalance,
          note: r.note ?? null,
        }));
        const { error: schedErr } = await supabase.from('lease_schedules').insert(rows);
        if (schedErr) throw schedErr;
      }

      return result;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['lease-list'] });
      qc.invalidateQueries({ queryKey: ['lease', id] });
      toast.success(
        pageMode === 'new'
          ? `สร้างสัญญา Lease + Schedule ${schedule.length} งวด`
          : `อัปเดตสัญญา + Schedule ${schedule.length} งวด`,
      );
      if (pageMode === 'new') navigate(`${baseRoute}/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const isHP = watched.mode === 'hp';
  const isLeaseOther = watched.mode === 'other';

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(baseRoute)}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {pageMode === 'new' ? 'New Lease' : existing?.lease_no ?? 'Loading...'}
          </h1>
          <p className="text-muted text-sm">
            {isHP ? 'Hire Purchase (HP) — เช่าซื้อ' : 'สัญญาเช่า (Leasing) — ภายใต้ TFRS 16'}
          </p>
        </div>
        <Button variant="primary" disabled={!isDirty || save.isPending} onClick={handleSubmit((d) => save.mutate(d))}>
          <Save className="w-4 h-4" /> {save.isPending ? 'กำลังบันทึก...' : 'Save + Generate Schedule'}
        </Button>
      </div>

      <form onSubmit={handleSubmit((d) => save.mutate(d))} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>โหมด / ประเภทสัญญา</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Lease No *</label>
                  <Input {...register('lease_no')} placeholder="MGC-LSE-2026-001" />
                  {errors.lease_no && <p className="text-xs text-danger mt-1">{errors.lease_no.message}</p>}
                </div>
                <div>
                  <label className="field-label">Mode *</label>
                  <Select {...register('mode')}>
                    <option value="hp">HP Motor — เช่าซื้อรถ</option>
                    <option value="other">Lease (TFRS 16) — เช่าทรัพย์สิน</option>
                  </Select>
                </div>
              </div>

              {isLeaseOther && (
                <div className="bg-amber-50 border border-amber-200 rounded p-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" {...register('use_bank_loan')} className="rounded" />
                    ใช้สินเชื่อจากธนาคาร (Bank Loan)
                  </label>
                  <p className="text-xs text-muted mt-1">
                    {watched.use_bank_loan
                      ? '📥 Bank Statement direct cut (Case A)'
                      : '🔄 AP Module + WHT 3% — Pure IFRS 16 (Case B)'}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Asset Type</label>
                  <Select {...register('asset_type')}>
                    <option>ยานพาหนะ</option>
                    <option>อุปกรณ์</option>
                    <option>อาคาร / ที่ดิน</option>
                    <option>สำนักงาน</option>
                  </Select>
                </div>
                <div>
                  <label className="field-label">Asset Name *</label>
                  <Input {...register('asset_name')} placeholder="BMW 320i 2026" />
                  {errors.asset_name && (
                    <p className="text-xs text-danger mt-1">{errors.asset_name.message}</p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="field-label">Vendor</label>
                  <Input {...register('vendor')} placeholder="MCR Co., Ltd." />
                </div>
              </div>
            </CardContent>
          </Card>

          {isHP && (
            <Card>
              <CardHeader>
                <CardTitle>HP — ราคารถ / Down Payment</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="field-label">Vehicle Price</label>
                    <Input type="number" step="0.01" {...register('vehicle_price', { valueAsNumber: true })} />
                  </div>
                  <div>
                    <label className="field-label">Down Payment</label>
                    <Input type="number" step="0.01" {...register('down_payment', { valueAsNumber: true })} />
                  </div>
                  <div>
                    <label className="field-label">Net Vehicle Cost (auto)</label>
                    <Input
                      readOnly
                      value={fmtMoney((watched.vehicle_price ?? 0) - (watched.down_payment ?? 0))}
                      className="bg-gray-50"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Financial Terms</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="field-label">Principal *</label>
                  <Input
                    type="number"
                    step="0.01"
                    {...register('principal', { valueAsNumber: true })}
                    className={isHP ? 'bg-gray-50' : ''}
                    readOnly={isHP}
                  />
                  {isHP && <p className="text-xs text-muted mt-1">คำนวณจาก Net Vehicle Cost</p>}
                </div>
                <div>
                  <label className="field-label">Annual Rate (%)</label>
                  <Input type="number" step="0.01" {...register('annual_rate', { valueAsNumber: true })} />
                  <p className="text-xs text-muted mt-1">Hint: BBL 4.95% / SCB 4.35%</p>
                </div>
                <div>
                  <label className="field-label">Term (months)</label>
                  <Input type="number" {...register('term_months', { valueAsNumber: true })} />
                  <div className="text-xs mt-1">
                    {(watched.term_months ?? 0) >= 12 ? (
                      <Badge variant="brand">Long-term</Badge>
                    ) : (
                      <Badge variant="warn">Short-term</Badge>
                    )}
                  </div>
                </div>
                <div>
                  <label className="field-label">Start Date</label>
                  <Input type="date" {...register('start_date')} />
                </div>
                <div>
                  <label className="field-label">Status</label>
                  <Select {...register('status')}>
                    <option>Draft</option>
                    <option>Active</option>
                    <option>Closed</option>
                    <option>Modified</option>
                  </Select>
                </div>
                {isLeaseOther && (
                  <div>
                    <label className="field-label">Discount Rate (%)</label>
                    <Input type="number" step="0.01" {...register('discount_rate', { valueAsNumber: true })} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {isLeaseOther && (
            <Card>
              <CardHeader>
                <CardTitle>Upfront / Grace / Prepaid (Lease only)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="field-label">Upfront Payment</label>
                    <Input
                      type="number"
                      step="0.01"
                      {...register('upfront_payment', { valueAsNumber: true })}
                    />
                  </div>
                  <div>
                    <label className="field-label">Grace Periods (months)</label>
                    <Input type="number" {...register('grace_periods', { valueAsNumber: true })} />
                  </div>
                  <div>
                    <label className="field-label">Prepaid Periods (months)</label>
                    <Input type="number" {...register('prepaid_periods', { valueAsNumber: true })} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Balloon (optional)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Balloon Amount</label>
                  <Input type="number" step="0.01" {...register('balloon_amount', { valueAsNumber: true })} />
                </div>
                <div>
                  <label className="field-label">Pattern</label>
                  <Select {...register('balloon_pattern')}>
                    <option value="with-last">พร้อมงวดสุดท้าย</option>
                    <option value="after-last">หลังงวดสุดท้าย</option>
                    <option value="before-last">ก่อนงวดสุดท้าย</option>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Remark</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea className="input min-h-[80px]" {...register('remark')} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <Calculator className="inline w-4 h-4 mr-2" />
                Live Calculation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Monthly Payment (est.)" value={fmtMoney(monthlyEst)} bold />
              <Row label="จำนวนงวด" value={schedule.length} />
              <Row label="Total Payment" value={fmtMoney(totalPayment)} />
              <Row label="Total Interest" value={fmtMoney(totalInterest)} />
              <Row
                label="Channel"
                value={watched.use_bank_loan ? '📥 Bank Statement' : '🔄 AP + WHT3%'}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full mt-3"
                onClick={() => setShowSchedule((s) => !s)}
              >
                {showSchedule ? 'ซ่อน' : 'ดู'} Amortization Schedule
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>คำแนะนำ</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted space-y-2">
              <p>• HP — Net Vehicle Cost คำนวณอัตโนมัติจาก Vehicle Price − Down Payment</p>
              <p>• IFRS 16 — กรณีไม่ใช้สินเชื่อ ส่งจ่ายผ่าน AP + WHT 3%</p>
              <p>• Schedule แสดงผลแบบ live; กด Save จะ insert ลง Supabase</p>
            </CardContent>
          </Card>
        </div>

        {showSchedule && schedule.length > 0 && (
          <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle>Amortization Schedule ({schedule.length} งวด)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[500px]">
                  <table className="table-base">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th>#</th>
                        <th>Due Date</th>
                        <th className="text-right">Begin</th>
                        <th className="text-right">Payment</th>
                        <th className="text-right">Interest</th>
                        <th className="text-right">Principal</th>
                        <th className="text-right">End</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.map((r) => (
                        <tr key={r.period} className="hover:bg-gray-50">
                          <td className="font-medium">{r.period}</td>
                          <td>{fmtDate(r.date)}</td>
                          <td className="text-right tabular-nums">{fmtMoney(r.beginBalance)}</td>
                          <td className="text-right tabular-nums font-medium">{fmtMoney(r.payment)}</td>
                          <td className="text-right tabular-nums text-amber-700">{fmtMoney(r.interest)}</td>
                          <td className="text-right tabular-nums text-emerald-700">
                            {fmtMoney(r.principal)}
                          </td>
                          <td className="text-right tabular-nums">{fmtMoney(r.endBalance)}</td>
                          <td>{r.note && <Badge variant="brand">{r.note}</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </form>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: any; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={bold ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</span>
    </div>
  );
}
