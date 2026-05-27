// Menu catalog for RBAC permission matrix (View / Edit / Approve per menu).
// `approve` flags which menus actually have an approval action (others show
// the Approve column disabled). Used by the Permission Group editor.

export interface MenuDef {
  key: string;
  label: string;
  section: string;
  approve: boolean; // has a meaningful approve action
}

export const MENU_CATALOG: MenuDef[] = [
  { key: 'dashboard', label: 'Dashboard', section: 'Dashboard & Reports', approve: false },
  { key: 'reports', label: 'Reports', section: 'Dashboard & Reports', approve: false },

  { key: 'ma', label: 'Master Agreement', section: 'Loan Management', approve: true },
  { key: 'ca', label: 'Credit Agreement', section: 'Loan Management', approve: true },

  { key: 'pn', label: 'P/N', section: 'Transactions', approve: true },
  { key: 'lg', label: 'LG / BG', section: 'Transactions', approve: true },
  { key: 'lc', label: 'L/C', section: 'Transactions', approve: true },
  { key: 'fp', label: 'Floor Plan', section: 'Transactions', approve: true },
  { key: 'od', label: 'Overdraft (O/D)', section: 'Transactions', approve: true },
  { key: 'tr', label: 'T/R', section: 'Transactions', approve: true },
  { key: 'fxf', label: 'FX Forward', section: 'Transactions', approve: true },
  { key: 'loan', label: 'Loan', section: 'Transactions', approve: true },
  { key: 'repayment', label: 'Repayment', section: 'Transactions', approve: true },

  { key: 'lease_hp', label: 'Lease — HP Motor', section: 'Lease Management', approve: true },
  { key: 'lease_other', label: 'Lease — Other', section: 'Lease Management', approve: true },

  { key: 'je', label: 'Journal Entries / NetSuite Sync', section: 'Accounting', approve: true },

  { key: 'master_interest', label: 'Interest Rate', section: 'Master', approve: false },
  { key: 'master_curtailment', label: 'Curtailment', section: 'Master', approve: false },
  { key: 'master_bank', label: 'Bank Statement', section: 'Master', approve: false },
  { key: 'master_coa', label: 'Chart of Accounts', section: 'Master', approve: false },

  { key: 'notifications', label: 'Notifications', section: 'Alerts', approve: false },
  { key: 'user_mgmt', label: 'User Management', section: 'Admin', approve: false },
];

// Sections in display order (for grouping rows in the editor).
export const MENU_SECTIONS = [
  'Dashboard & Reports', 'Loan Management', 'Transactions',
  'Lease Management', 'Accounting', 'Master', 'Alerts', 'Admin',
];
