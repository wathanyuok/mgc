import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Box, List, ListItemButton, ListItemIcon, ListItemText, Collapse, Typography, Divider,
} from '@mui/material';
import {
  Building2 as Building, FileText, ChevronDown, ChevronRight, LayoutDashboard, FileBarChart,
} from 'lucide-react';
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
  { to: '/tx/lc', label: 'L/C', key: 'lc' },
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
  { to: '/master/coa', label: 'Chart of Accounts', key: 'master_coa' },
];

const ACCOUNTING: LeafItem[] = [
  { to: '/je', label: 'Journal Entries', key: 'je' },
  { to: '/je/sync-log', label: 'NetSuite Sync Log', key: 'je' },
  { to: '/je/eod-sync', label: 'End-of-Day Sync', key: 'je' },
];

const ALERTS: LeafItem[] = [
  { to: '/notifications', label: 'Notifications', key: 'notifications' },
  { to: '/audit-trail', label: 'Audit Trail', key: 'notifications' },
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

const sectionHeaderSx = {
  px: 2, py: 1, bgcolor: 'background.default', fontSize: 11, fontWeight: 700,
  letterSpacing: '0.05em', color: 'text.secondary',
};

export function Sidebar() {
  const { can } = useAuth();
  const visible = (items: LeafItem[]) => items.filter((i) => can(i.key, 'view'));

  const reports = visible(REPORTS);
  const loanMgmt = visible(LOAN_MANAGEMENT);

  return (
    <Box component="aside" sx={{ width: 288, bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', fontSize: 13 }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>Loan Module</Typography>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.25 }}>MGC-Asia · NetSuite</Typography>
      </Box>

      {reports.length > 0 && (
        <>
          <Typography sx={sectionHeaderSx}>DASHBOARD & REPORTS</Typography>
          <List dense disablePadding>
            {reports.map((item) => (
              <NavItem
                key={item.to}
                to={item.to}
                label={item.label}
                icon={item.key === 'dashboard' ? <LayoutDashboard size={16} /> : <FileBarChart size={16} />}
              />
            ))}
          </List>
          <Divider />
        </>
      )}

      {loanMgmt.length > 0 && (
        <>
          <Typography sx={sectionHeaderSx}>LOAN MANAGEMENT</Typography>
          <List dense disablePadding>
            {loanMgmt.map((item) => (
              <NavItem
                key={item.to}
                to={item.to}
                label={item.label}
                icon={item.key === 'ma' ? <Building size={16} /> : <FileText size={16} />}
              />
            ))}
          </List>
          <Divider />
        </>
      )}

      <Box component="nav" sx={{ flex: 1, overflowY: 'auto' }}>
        {SECTIONS.map((sec) => {
          const items = visible(sec.items);
          if (items.length === 0) return null;
          return <CollapsibleSection key={sec.title} section={{ ...sec, items }} />;
        })}
      </Box>

      <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider', fontSize: 10, color: 'text.secondary' }}>v0.1.0 · prototype</Box>
    </Box>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon?: React.ReactNode }) {
  return (
    <ListItemButton
      component={NavLink}
      to={to}
      sx={{
        py: 1, px: 2, borderLeft: '3px solid transparent',
        '&.active': { borderLeftColor: 'primary.main', bgcolor: 'primary.light', color: 'primary.main', fontWeight: 600 },
        '&:hover': { bgcolor: 'background.default' },
      }}
    >
      {icon && <ListItemIcon sx={{ minWidth: 28, color: 'inherit' }}>{icon}</ListItemIcon>}
      <ListItemText primary={label} primaryTypographyProps={{ fontSize: 13 }} />
    </ListItemButton>
  );
}

function CollapsibleSection({ section }: { section: Section }) {
  const [open, setOpen] = useState(section.defaultOpen ?? false);
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Box
        component="button"
        onClick={() => setOpen((o) => !o)}
        sx={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 1, bgcolor: 'background.default', border: 0, cursor: 'pointer',
          fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'text.secondary',
          '&:hover': { bgcolor: 'grey.100' },
        }}
      >
        <span>{section.title}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </Box>
      <Collapse in={open} unmountOnExit>
        <List dense disablePadding>
          {section.items.map((item) => (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              sx={{
                pl: 5, pr: 2, py: 0.75, borderLeft: '3px solid transparent',
                '&.active': { borderLeftColor: 'primary.main', bgcolor: 'primary.light', color: 'primary.main', fontWeight: 600 },
                '&:hover': { bgcolor: 'background.default' },
              }}
            >
              <Box sx={{ color: 'text.secondary', mr: 1 }}>›</Box>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13 }} />
            </ListItemButton>
          ))}
        </List>
      </Collapse>
    </Box>
  );
}
