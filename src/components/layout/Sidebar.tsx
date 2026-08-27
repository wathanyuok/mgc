// Sidebar — modern SaaS nav: ไอคอนต่อเมนู · active pill · section ยุบ/ขยาย
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Building2, FileSignature, FileText, ShieldCheck, Globe, Car, Wallet, Package,
  ArrowLeftRight, Banknote, HandCoins, CarFront, Building, Percent, BadgePercent,
  Landmark, BookOpen, BookText, Bell, ScrollText, LayoutDashboard, FileBarChart,
  Users, Shield, Upload, ChevronDown, CalendarClock, Layers, AlertTriangle, KeyRound,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

type LeafItem = { to: string; label: string; key: string; icon: React.ReactNode };
type Section = { title: string; items: LeafItem[]; defaultOpen?: boolean; icon?: React.ReactNode };

const ic = (C: any) => <C size={15} strokeWidth={1.8} />;

const REPORTS: LeafItem[] = [
  { to: '/dashboard', label: 'Dashboard', key: 'dashboard', icon: ic(LayoutDashboard) },
];

// รายงาน — แยกเป็นเมนูย่อยรายฉบับ (เดิมเป็นแท็บในหน้าเดียว มากเกินไป)
const REPORT_ITEMS: LeafItem[] = [
  { to: '/reports/std_ma',          label: 'Master Agreement',      key: 'reports', icon: ic(FileText) },
  { to: '/reports/std_ca',          label: 'Credit Agreement',      key: 'reports', icon: ic(FileSignature) },
  { to: '/reports/std_tx',          label: 'Credit Transaction',    key: 'reports', icon: ic(Banknote) },
  { to: '/reports/std_car',         label: 'Car Stock Movement',    key: 'reports', icon: ic(Car) },
  { to: '/reports/std_maturity',    label: 'Maturity',              key: 'reports', icon: ic(CalendarClock) },
  { to: '/reports/std_repay',       label: 'Repayment',             key: 'reports', icon: ic(HandCoins) },
  { to: '/reports/std_due',         label: 'Due Payment',           key: 'reports', icon: ic(CalendarClock) },
  { to: '/reports/std_overdue',     label: 'Overdue Payment',       key: 'reports', icon: ic(AlertTriangle) },
  { to: '/reports/chassis_move',    label: 'Chassis Movement',      key: 'reports', icon: ic(CarFront) },
  { to: '/reports/chassis_overlap', label: 'Chassis Cross-Facility', key: 'reports', icon: ic(Layers) },
];

const LOAN_MANAGEMENT: LeafItem[] = [
  { to: '/ma', label: 'Master Agreement', key: 'ma', icon: ic(Building2) },
  { to: '/ca', label: 'Credit Agreement', key: 'ca', icon: ic(FileSignature) },
];

const TRANSACTIONS: LeafItem[] = [
  { to: '/tx/pn', label: 'Promissory Note', key: 'pn', icon: ic(FileText) },
  { to: '/tx/lg', label: 'LG / BG', key: 'lg', icon: ic(ShieldCheck) },
  { to: '/tx/lc', label: 'Letter of Credit', key: 'lc', icon: ic(Globe) },
  { to: '/tx/fp', label: 'Floor Plan', key: 'fp', icon: ic(Car) },
  { to: '/tx/od', label: 'Overdraft', key: 'od', icon: ic(Wallet) },
  { to: '/tx/tr', label: 'Trust Receipt', key: 'tr', icon: ic(Package) },
  { to: '/tx/fxf', label: 'FX Forward Rate', key: 'fxf', icon: ic(ArrowLeftRight) },
  { to: '/tx/loan', label: 'Loan', key: 'loan', icon: ic(Banknote) },
  // สัญญาเช่า 3 ชนิด — เป็นธุรกรรมเหมือนวงเงินอื่น จึงอยู่กลุ่มเดียวกัน
  // Hire Purchase กับ Leasing ใช้วงเงินธนาคาร (ต้องมี Master/Credit Agreement ก่อน)
  // Leasing Other ไม่ใช้วงเงิน เปิดสัญญาได้เลย
  { to: '/lease/hp', label: 'Hire Purchase', key: 'lease_hp', icon: ic(CarFront) },
  { to: '/lease/leasing', label: 'Leasing', key: 'lease_leasing', icon: ic(KeyRound) },
  { to: '/lease/other', label: 'Leasing Other', key: 'lease_other', icon: ic(Building) },
];

// Repayment ใช้ร่วมทุกประเภทวงเงิน รวม Lease/HP ด้วย จึงไม่ได้อยู่ใต้ Transactions
const REPAYMENT: LeafItem[] = [
  { to: '/tx/repayment', label: 'Repayment', key: 'repayment', icon: ic(HandCoins) },
];

const MASTER: LeafItem[] = [
  { to: '/master/interest-rate', label: 'Interest Rate', key: 'master_interest', icon: ic(Percent) },
  { to: '/master/curtailment', label: 'Curtailment', key: 'master_curtailment', icon: ic(BadgePercent) },
  { to: '/master/bank-statement', label: 'Bank Statement', key: 'master_bank', icon: ic(Landmark) },
  { to: '/master/coa', label: 'Chart of Accounts', key: 'master_coa', icon: ic(BookOpen) },
];

const ACCOUNTING: LeafItem[] = [
  { to: '/je', label: 'Journal Entries', key: 'je', icon: ic(BookText) },
];

// Alerts = สิ่งที่ระบบเตือนให้ไปทำต่อ · ผู้ใช้ทั่วไปเปิดดูทุกวัน
const ALERTS: LeafItem[] = [
  { to: '/notifications', label: 'Notifications', key: 'notifications', icon: ic(Bell) },
];

// Administration = งานของผู้ดูแลระบบ · ประวัติการใช้งานย้ายมาจากกลุ่ม Alerts
// (เป็นบันทึกย้อนหลัง ไม่ใช่การเตือน — คนใช้คือผู้ดูแลระบบและผู้ตรวจสอบ)
const USER_MGMT: LeafItem[] = [
  { to: '/admin/groups', label: 'Permission Groups', key: 'user_mgmt', icon: ic(Shield) },
  { to: '/admin/users', label: 'Users', key: 'user_mgmt', icon: ic(Users) },
  { to: '/admin/import-migration', label: 'Import Migration', key: 'user_mgmt', icon: ic(Upload) },
  { to: '/audit-trail', label: 'Audit Trail', key: 'audit_trail', icon: ic(ScrollText) },
];

// ลำดับเมนูเรียงตามสายงานจริง — เบิกใช้วงเงิน → ตัดชำระ → ลงบัญชี ต้องต่อกันเป็นชุดเดียว
// เดิม Alerts แทรกอยู่ระหว่างการตัดชำระกับการลงบัญชี ทำให้สายงานเงินขาดตอน
// ย้ายขึ้นไปไว้บนสุดใต้ Dashboard แทน เพราะเป็น "งานที่รออยู่วันนี้" ที่ผู้ใช้เปิดดูเป็นอย่างแรก
const SECTIONS: Section[] = [
  { title: 'Transactions', items: TRANSACTIONS, defaultOpen: true },
  { title: 'Payments', items: REPAYMENT, defaultOpen: true, icon: ic(HandCoins) },
  { title: 'GL / NetSuite Sync', items: ACCOUNTING, defaultOpen: true },
  { title: 'Master', items: MASTER, defaultOpen: true },
  { title: 'Administration', items: USER_MGMT, defaultOpen: true },
];

export function Sidebar() {
  const { can } = useAuth();
  const visible = (items: LeafItem[]) => items.filter((i) => can(i.key, 'view'));

  const reports = visible(REPORTS);
  const reportItems = visible(REPORT_ITEMS);
  const loanMgmt = visible(LOAN_MANAGEMENT);
  const alerts = visible(ALERTS);

  return (
    <aside className="flex w-[268px] shrink-0 flex-col border-r border-gray-200/80 bg-white">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-gray-100">
        <img src="/mgc-asia-logo.png" alt="MGC-ASIA" className="h-6 w-auto" />
        <p className="mt-1.5 text-[10.5px] text-gray-400">Loan &amp; Lease Module · NetSuite</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
        {reports.length > 0 && (
          <div>
            <SectionLabel>Dashboard</SectionLabel>
            <ul className="space-y-0.5">{reports.map((i) => <NavItem key={i.to} item={i} />)}</ul>
          </div>
        )}
        {/* งานที่ระบบเตือนให้ไปทำต่อ — อยู่บนสุดเพราะผู้ใช้เปิดดูเป็นอย่างแรกของวัน
            ไม่มีหัวข้อกลุ่มครอบ เพราะหัวข้อ "Alerts" กับเมนู "Notifications" แปลว่าเรื่องเดียวกัน
            เหลือบรรทัดเดียวอ่านง่ายกว่า */}
        {alerts.length > 0 && (
          <ul className="space-y-0.5">{alerts.map((i) => <NavItem key={i.to} item={i} />)}</ul>
        )}
        {reportItems.length > 0 && (
          <CollapsibleSection title="Reports" items={reportItems} defaultOpen={false} icon={ic(FileBarChart)} />
        )}
        {loanMgmt.length > 0 && (
          <div>
            <SectionLabel>Loan Management</SectionLabel>
            <ul className="space-y-0.5">{loanMgmt.map((i) => <NavItem key={i.to} item={i} />)}</ul>
          </div>
        )}
        {SECTIONS.map((sec) => {
          const items = visible(sec.items);
          if (items.length === 0) return null;
          return <CollapsibleSection key={sec.title} title={sec.title} items={items} defaultOpen={sec.defaultOpen} icon={sec.icon} />;
        })}
      </nav>

      <div className="border-t border-gray-100 px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> v0.1.0 · prototype
        </span>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </p>
  );
}

function NavItem({ item }: { item: LeafItem }) {
  return (
    <li>
      <NavLink
        to={item.to}
        className={({ isActive }) =>
          cn(
            'group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors',
            isActive
              ? 'bg-brand-light text-brand'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
          )
        }
      >
        {({ isActive }: any) => (
          <>
            <span className={cn('shrink-0 transition-colors', isActive ? 'text-brand' : 'text-gray-400 group-hover:text-gray-600')}>
              {item.icon}
            </span>
            <span className="truncate" title={item.label}>{item.label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}

function CollapsibleSection({ title, items, defaultOpen = false, icon }: { title: string; items: LeafItem[]; defaultOpen?: boolean; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group mb-1 flex w-full items-center justify-between rounded-md px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 transition hover:text-gray-600"
      >
        <span className="flex items-center gap-2">
          {icon && <span className="text-gray-400 group-hover:text-gray-600">{icon}</span>}
          {title}
        </span>
        <ChevronDown size={12} className={cn('transition-transform duration-200', open ? '' : '-rotate-90')} />
      </button>
      {open && (
        <ul className="ml-3 space-y-0.5 border-l border-gray-100 pl-2">
          {items.map((i) => <NavItem key={i.to} item={i} />)}
        </ul>
      )}
    </div>
  );
}
