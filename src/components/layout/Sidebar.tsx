import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Building2, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

type LeafItem = { to: string; label: string };
type Section = { title: string; items: LeafItem[]; defaultOpen?: boolean };

const LOAN_MANAGEMENT: LeafItem[] = [
  { to: '/ma', label: 'Master Agreement' },
  { to: '/ca', label: 'Credit Agreement' },
];

const TRANSACTIONS: LeafItem[] = [
  { to: '/tx/pn', label: 'P/N' },
  { to: '/tx/lg', label: 'LG / BG' },
  { to: '/tx/fp', label: 'Floor Plan' },
  { to: '/tx/od', label: 'Overdraft (O/D)' },
  { to: '/tx/tr', label: 'T/R' },
  { to: '/tx/fxf', label: 'FX Forward Rate' },
  { to: '/tx/loan', label: 'Loan' },
  { to: '/tx/repayment', label: 'Repayment' },
];

const LEASE_MGMT: LeafItem[] = [
  { to: '/lease/hp', label: 'HP Motor' },
  { to: '/lease/other', label: 'Lease Other' },
];

const MASTER: LeafItem[] = [
  { to: '/master/interest-rate', label: 'Interest Rate' },
  { to: '/master/curtailment', label: 'Curtailment' },
  { to: '/master/bank-statement', label: 'Bank Statement' },
];

const ACCOUNTING: LeafItem[] = [
  { to: '/je', label: 'Journal Entries' },
];

const ALERTS: LeafItem[] = [
  { to: '/notifications', label: 'Notifications' },
];

const SECTIONS: Section[] = [
  { title: 'TRANSACTIONS', items: TRANSACTIONS, defaultOpen: true },
  { title: 'ALERTS', items: ALERTS, defaultOpen: true },
  { title: 'GL / NETSUITE SYNC', items: ACCOUNTING, defaultOpen: true },
  { title: 'LEASE MANAGEMENT', items: LEASE_MGMT, defaultOpen: true },
  { title: 'MASTER', items: MASTER, defaultOpen: true },
];

export function Sidebar() {
  return (
    <aside className="w-72 bg-white border-r border-line flex flex-col text-[13px]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-line flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 font-bold text-ink">
            <span>🏛️</span>
            <span>Loan Module</span>
          </div>
          <div className="text-[11px] text-muted mt-0.5">MGC-Asia · NetSuite</div>
        </div>
        <button className="text-muted hover:text-ink" title="Collapse">
          ◀
        </button>
      </div>

      {/* LOAN MANAGEMENT (always visible, no chevron) */}
      <div className="border-b border-line">
        <div className="px-4 py-2.5 bg-soft text-[11px] font-bold tracking-wider text-muted">
          LOAN MANAGEMENT
        </div>
        {LOAN_MANAGEMENT.map((item, i) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 px-4 py-2.5 border-l-[3px] transition',
                isActive
                  ? 'border-brand bg-white text-brand font-semibold'
                  : 'border-transparent text-ink hover:bg-soft',
              )
            }
          >
            {i === 0 ? (
              <Building2 className="w-4 h-4" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Collapsible sections */}
      <nav className="flex-1 overflow-y-auto">
        {SECTIONS.map((sec) => (
          <CollapsibleSection key={sec.title} section={sec} />
        ))}
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
                isActive
                  ? 'border-brand bg-brand-light text-brand font-semibold'
                  : 'border-transparent text-ink hover:bg-soft',
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
