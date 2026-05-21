import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Building2, FileText, ChevronDown, ChevronRight, LayoutDashboard, FileBarChart } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';

type LeafItem = { to: string; label: string; key: string };
type Section = { title: string; items: LeafItem[]; defaultOpen?: boolean };

const LOAN_MANAGEMENT: LeafItem[] = [
  { to: '/ma', label: 'Master Agreement', key: 'ma' },
  { to: '/ca', label: 'Credit Agreement', key: 'ca' },
];

const TRANSACTIONS: LeafItem[] = [
  { to: '/tx/pn', label: 'P/N', key: 'pn' },
  { to: '/tx/lg', label: 'LG / BG', key: 'lg' },
  { to: '/tx/fp', label: 'Floor Plan', key: 'fp' },
  { to: '/tx/od', label: 'Overdraft (O/D)', key: 'od' },
  { to: '/tx/tr', label: 'T/R', key: 'tr' },
  { to: '/tx/fxf', label: 'FX Forward Rate', key: 'fxf' },
  { to: '/tx/loan', label: 'Loan', key: 'loan' },
  { to: '/tx/repayment', label: 'Repayment', key: 'repayment' },
];

const LEASE_MGMT: LeafItem[] = [
  { to: '/lease/hp', label: 'HP Motor', key: 'lease_hp' },
  { to: '/lease/other', label: 'Lease Other', key: 'lease_other' },
];

const MASTER: LeafItem[] = [
  { to: '/master/interest-rate', label: 'Interest Rate', key: 'master_interest' },
  { to: '/master/curtailment', label: 'Curtailment', key: 'master_curtailment' },
  { to: '/master/bank-statement', label: 'Bank Statement', key: 'master_bank' },
];

const ACCOUNTING: LeafItem[] = [
  { to: '/je', label: 'Journal Entries', key: 'je' },
];

const ALERTS: LeafItem[] = [
  { to: '/notifications', label: 'Notifications', key: 'notifications' },
];

const REPORTS: LeafItem[] = [
  { to: '/dashboard', label: 'Dashboard', key: 'dashboard' },
  { to: '/reports', label: 'Reports', key: 'reports' },
];

const USER_MGMT: LeafItem[] = [
  { to: '/admin/groups', label: 'Permission Groups', key: 'user_mgmt' },
  { to: '/admin/users', label: 'Users', key: 'user_mgmt' },
];

const SECTIONS: Section[] = [
  { title: 'TRANSACTIONS', items: TRANSACTIONS, defaultOpen: true },
  { title: 'ALERTS', items: ALERTS, defaultOpen: true },
  { title: 'GL / NETSUITE SYNC', items: ACCOUNTING, defaultOpen: true },
  { title: 'LEASE MANAGEMENT', items: LEASE_MGMT, defaultOpen: true },
  { title: 'MASTER', items: MASTER, defaultOpen: true },
  { title: 'USER MANAGEMENT', items: USER_MGMT, defaultOpen: true },
];

export function Sidebar() {
  const { can } = useAuth();
  const visible = (items: LeafItem[]) => items.filter((i) => can(i.key, 'view'));

  const reports = visible(REPORTS);
  const loanMgmt = visible(LOAN_MANAGEMENT);

  return (
    <aside className="w-72 bg-white border-r border-line flex flex-col text-[13px]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-line flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 font-bold text-ink">
            <span>Loan Module</span>
          </div>
          <div className="text-[11px] text-muted mt-0.5">MGC-Asia · NetSuite</div>
        </div>
        <button className="text-muted hover:text-ink" title="Collapse">◀</button>
      </div>

      {/* DASHBOARD & REPORTS (always visible, top) */}
      {reports.length > 0 && (
        <div className="border-b border-line">
          <div className="px-4 py-2.5 bg-soft text-[11px] font-bold tracking-wider text-muted">
            DASHBOARD & REPORTS
          </div>
          {reports.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-4 py-2.5 border-l-[3px] transition',
                  isActive ? 'border-brand bg-white text-brand font-semibold' : 'border-transparent text-ink hover:bg-soft',
                )
              }
            >
              {item.key === 'dashboard' ? <LayoutDashboard className="w-4 h-4" /> : <FileBarChart className="w-4 h-4" />}
              {item.label}
            </NavLink>
          ))}
        </div>
      )}

      {/* LOAN MANAGEMENT (always visible, no chevron) */}
      {loanMgmt.length > 0 && (
        <div className="border-b border-line">
          <div className="px-4 py-2.5 bg-soft text-[11px] font-bold tracking-wider text-muted">
            LOAN MANAGEMENT
          </div>
          {loanMgmt.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-4 py-2.5 border-l-[3px] transition',
                  isActive ? 'border-brand bg-white text-brand font-semibold' : 'border-transparent text-ink hover:bg-soft',
                )
              }
            >
              {item.key === 'ma' ? <Building2 className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
              {item.label}
            </NavLink>
          ))}
        </div>
      )}

      {/* Collapsible sections */}
      <nav className="flex-1 overflow-y-auto">
        {SECTIONS.map((sec) => {
          const items = visible(sec.items);
          if (items.length === 0) return null;
          return <CollapsibleSection key={sec.title} section={{ ...sec, items }} />;
        })}
      </nav>

      <div className="px-4 py-2 border-t border-line text-[10px] text-muted">v0.1.0 · prototype</div>
    </aside>
  );
}

function CollapsibleSection({ section }: { section: Section }) {
  const [open, setOpen] = useState(section.defaultOpen ?? false);
  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-4 py-2.5 bg-soft text-[11px] font-bold tracking-wider text-muted hover:bg-gray-100"
      >
        {section.title}
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open &&
        section.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 pl-10 pr-4 py-2 border-l-[3px] transition',
                isActive ? 'border-brand bg-brand-light text-brand font-semibold' : 'border-transparent text-ink hover:bg-soft',
              )
            }
          >
            <span className="text-muted">›</span>
            {item.label}
          </NavLink>
        ))}
    </div>
  );
}
