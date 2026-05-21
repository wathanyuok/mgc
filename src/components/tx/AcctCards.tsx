import { Plus, X } from 'lucide-react';
import { Button, Select } from '@/components/ui';
import { useReadOnly } from '@/lib/readonly';

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
  type: string;
  gl: string;
}

export function newAcctCard(): AcctCard {
  return { id: crypto.randomUUID(), type: 'OTHER ACCOUNT', gl: GL_ACCOUNTS[0] };
}

export function AcctCards({ accounts, onChange }: { accounts: AcctCard[]; onChange: (n: AcctCard[]) => void }) {
  const ro = useReadOnly();
  return (
    <div>
      {accounts.length === 0 && (
        <div className="text-center text-muted py-6">ยังไม่มี Account — กด "+ Add Account"</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((a, i) => (
          <div key={a.id} className="border border-line rounded p-3 bg-soft">
            <div className="flex justify-between items-center mb-2">
              <Select
                value={a.type}
                onChange={(e) => onChange(accounts.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                className="text-xs"
              >
                {ACCT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
              <button type="button" disabled={ro} hidden={ro} onClick={() => onChange(accounts.filter((_, j) => j !== i))} className="text-danger hover:underline text-xs ml-2 flex items-center gap-0.5">
                <X className="w-3 h-3" />
              </button>
            </div>
            <Select value={a.gl} onChange={(e) => onChange(accounts.map((x, j) => j === i ? { ...x, gl: e.target.value } : x))} className="text-xs">
              {GL_ACCOUNTS.map((g) => <option key={g}>{g}</option>)}
            </Select>
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
