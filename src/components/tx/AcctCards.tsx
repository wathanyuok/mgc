import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useReadOnly } from '@/lib/readonly';

// Searchable GL combobox — click shows the full list (pick a new value directly,
// no need to clear first); typing filters. Dropdown rendered via Portal at
// document.body so it escapes parent overflow/stacking contexts (Tabs, Cards, etc.).
function GLCombo({ value, options, disabled, onChange }: {
  value: string; options: string[]; disabled: boolean; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number; dropUp: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const s = text.trim().toLowerCase();
    const noFilter = !s || text === value;
    const list = noFilter ? options : options.filter((o) => o.toLowerCase().includes(s));
    return list.slice(0, 300);
  }, [text, value, options]);

  // Compute portal position relative to viewport (fixed)
  const recompute = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const dropUp = spaceBelow < 260 && r.top > 260;
    setPos({
      top: dropUp ? r.top - 4 : r.bottom + 4,
      left: r.left,
      width: r.width,
      dropUp,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
    const onScroll = () => recompute();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={wrapRef} className="relative flex-1">
      <input
        ref={inputRef}
        className="input text-xs w-full"
        disabled={disabled}
        value={open ? text : value}
        placeholder="ค้นหารหัส/ชื่อบัญชี…"
        onFocus={(e) => {
          if (disabled) return;
          setText(value); setOpen(true); e.target.select();
        }}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
      />
      {open && shown.length > 0 && pos && createPortal(
        <ul
          ref={listRef}
          style={{
            position: 'fixed',
            top: pos.dropUp ? undefined : pos.top,
            bottom: pos.dropUp ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            width: pos.width,
          }}
          className="z-[9999] max-h-60 overflow-auto bg-white border border-line rounded-lg shadow-lg text-xs"
        >
          {shown.map((o) => (
            <li
              key={o}
              className={`px-2 py-1 hover:bg-blue-50 cursor-pointer truncate ${o === value ? 'bg-blue-50 font-medium' : ''}`}
              onMouseDown={() => { onChange(o); setText(o); setOpen(false); }}
            >
              {o}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

export const ACCT_TYPES = [
  'CASH / BANK ACCOUNT',
  'INTEREST ACCOUNT',
  'INTEREST EXPENSE ACCOUNT',
  'NOTE PAYABLE ACCOUNT',
  'ACCRUED INTEREST ACCOUNT',
  'INVENTORY FLOOR PLAN ACCOUNT',
  'INVENTORY ACCOUNT',
  'AP CAR ACCOUNT',
  'AR CAR ACCOUNT',
  'FEE ACCOUNT',
  'FEE EXPENSE ACCOUNT',
  'FEE INCOME ACCOUNT',
  'PREPAID ACCOUNT',
  'FX GAIN ACCOUNT',
  'FX LOSS ACCOUNT',
  'UNREALIZED GAIN/LOSS ACCOUNT',
  'CHARGE ACCOUNT',
  'RIGHT-OF-USE ASSET',
  'DOWN PAYMENT',
  'DEFERRED INTEREST',
  'UNDUE INPUT VAT',
  'LEASE LIABILITY',
  'CURRENT PORTION OF LEASE LIABILITY',
  'CURRENT PORTION OF DEFERRED INTEREST',
  'RENTAL EXPENSES CONTRA',
  'GAIN(LOSS) ON MODIFICATION',
  'ROU ASSETS WRITE-DOWN',
  'GAIN/LOSS ON LEASE CONTRACT',
  'SUSPENSE - ROU',
  'SUSPENSE - VEHICLE',
  'OTHER ACCOUNT',
];

export const GL_ACCOUNTS = [
  '100000 Cheque Account',
  // Asset — Prepaid / ROU
  '1193 Prepaid Expenses - L/G, B/G',
  '1194 Prepaid Expenses - Other',
  '1240100 Right-of-Use Asset',
  // Liability — Borrowings & accruals
  '2142101 เงินกู้ยืมระยะสั้นสถาบันการเงิน',
  '2142102 เงินกู้ยืมระยะยาวสถาบันการเงิน',
  '2194109 ดอกเบี้ยค้างจ่าย-สถาบันการเงิน',
  '2195100 Forward Contract',
  '2240100 Lease Liability',
  // Revenue
  '4112101 รายได้-ค่าธรรมเนียม',
  '4112102 รายได้-FX Gain',
  // Modification / Termination
  '540001 Gain/Loss on Modification',
  '550001 Gain/Loss on Terminate Contract',
  // Expense — Fee
  '5511101 ค่าธรรมเนียมธนาคาร',
  '5512201 ค่าธรรมเนียมจ่าย',
  // Expense — Interest
  '5512101 ดอกเบี้ยจ่าย-เงินเบิกเกินบัญชี',
  '5512102 ดอกเบี้ยจ่าย-ตั๋วสัญญาใช้เงิน',
  '5512103 ดอกเบี้ยจ่าย-เงินกู้ยืมระยะสั้น',
  '5512105 ดอกเบี้ยจ่าย-Floor Plan',
  '5512301 ขาดทุน-FX Loss',
  // Lease-specific
  '560001 ROU Write-down',
  '610000 Lease Interest Expense',
  '642000 RENTAL EXPENSE-CONTRA',
  // Misc
  '7100022 Unrealized Gain/Loss',
  'Suspense Vehicle',
];

export interface AcctCard {
  id: string;
  type?: string; // kept for backward-compat (legacy GL-by-type mapping); UI no longer sets it
  gl: string; // "code name" — selected from Chart of Accounts master (gl_accounts)
}

export function newAcctCard(): AcctCard {
  return { id: crypto.randomUUID(), gl: '' };
}

/** Load GL accounts from the COA master (gl_accounts); fall back to the built-in list. */
function useGLOptions(): string[] {
  const { data } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gl_accounts')
        .select('code, name')
        .eq('inactive', false)
        .order('code');
      if (error) throw error;
      return (data ?? []).map((r: any) => `${r.code} ${r.name}`);
    },
    staleTime: 5 * 60 * 1000,
  });
  return data && data.length > 0 ? data : GL_ACCOUNTS;
}

export function AcctCards({ accounts, onChange }: { accounts: AcctCard[]; onChange: (n: AcctCard[]) => void }) {
  const ro = useReadOnly();
  const glOptions = useGLOptions();
  return (
    <div>
      {accounts.length === 0 && (
        <div className="text-center text-muted py-6">ยังไม่มี Account — กด "+ Add Account"</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((a, i) => (
          <div key={a.id} className="border border-line rounded p-3 bg-soft flex items-center gap-2">
            <GLCombo
              value={a.gl}
              options={glOptions}
              disabled={ro}
              onChange={(v) => onChange(accounts.map((x, j) => j === i ? { ...x, gl: v } : x))}
            />
            <button type="button" disabled={ro} hidden={ro} onClick={() => onChange(accounts.filter((_, j) => j !== i))} className="text-danger hover:underline text-xs flex items-center">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      {!ro && (
        <Button variant="primary" size="sm" className="mt-3" onClick={() => onChange([...accounts, newAcctCard()])}>
          <Plus className="w-4 h-4" /> Add Account
        </Button>
      )}
    </div>
  );
}
