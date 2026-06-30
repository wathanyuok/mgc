// Supabase Database types — keep in sync with supabase/migrations/0001_init.sql

export const FINANCE_INSTITUTIONS = [
  'KBANK',
  'SCB',
  'BBL',
  'KTB',
  'BAY',
  'TTB',
  'UOB',
  'BMW Financial Services',
] as const;
export type FinanceInstitution = (typeof FINANCE_INSTITUTIONS)[number];

export const SUBSIDIARIES = [
  'Millennium Group Corporation (Asia) Plc.',
  'Millennium Cars (MCR)',
  'Millennium Auto Group (MAG)',
  'Millennium Industrial Estate (MIE)',
  'Master Auto Sales (MAS)',
] as const;
export type Subsidiary = (typeof SUBSIDIARIES)[number];

export const SUB_SHORT = ['MCR', 'MAG', 'MIE', 'MAS'] as const;

// Vendor Master (Migration 0046) — Phase 2 · MoM §3
export const VENDOR_TYPES = ['bank', 'lessor', 'dealer', 'supplier', 'importer', 'customer'] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];

export interface Vendor {
  id: string;
  code: string;
  name: string;
  tax_id: string | null;
  vendor_type: VendorType | null;
  /** NetSuite vendor record ID — required before any JE/AP sync that references this vendor */
  netsuite_vendor_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  remark: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export const MA_STATUS = ['Draft', 'Approved', 'Rejected', 'Expired', 'Terminated'] as const;
export type MAStatus = (typeof MA_STATUS)[number];

export const CA_STATUS = ['Draft', 'Approved', 'Expired', 'Closed', 'Terminated'] as const;
export type CAStatus = (typeof CA_STATUS)[number];

export const CA_FACILITY_TYPES = [
  'Hire Purchase',
  'P/N',
  'O/D',
  'T/R',
  'Floor Plan',
  'LG/BG',
  'FX Forward',
  'Lease',
  'LC (Letter of Credit)',
  'Loan',
  'SBLC (Standby LC)',
] as const;

export const CA_CREDIT_TYPES = ['Revolving', 'Non Revolving'] as const;

export const CA_SUBSIDIARIES_SHORT = ['MCR', 'MAG', 'I-24', 'MGCH', 'MGCL', 'MGCS'] as const;

export const RATIO_OPS = ['<=', '<', '=', '>=', '>'] as const;
export type RatioOp = (typeof RATIO_OPS)[number];

// ---------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------

export interface MasterAgreement {
  id: string;
  inactive: boolean;
  finance_institution: string;
  ma_name: string;
  subsidiary: string;
  status: MAStatus;
  start_date: string;
  end_date: string;
  credit_line: number;
  utilization: number;
  remaining_credit: number;
  created_at: string;
  updated_at: string;
}

export interface MASubsidiary {
  id: string;
  ma_id: string;
  subsidiary: string;
  credit_line: number;
  utilization: number;
  remaining: number;
  sort_order: number;
}

export interface MACondition {
  ma_id: string;
  de_op: RatioOp | null;
  de_value: number | null;
  dscr_op: RatioOp | null;
  dscr_value: number | null;
  other_requirement: string | null;
  consent_waiver: string | null;
}

export interface MACollateral {
  id: string;
  ma_id: string;
  type: string;
  fields: Record<string, any>;
  sort_order: number;
  created_at: string;
}

export interface MAGuarantor {
  id: string;
  ma_id: string;
  type: string;
  fields: Record<string, any>;
  sort_order: number;
  created_at: string;
}

export interface CreditAgreement {
  id: string;
  ma_id: string | null;
  ca_name: string;
  contract_number: string;
  subsidiary: string;
  facility_type: string;
  finance_institution: string | null;
  currency: string;
  credit_line: number;
  credit_line_foreign: number | null;
  fx_rate: number | null;
  fx_rate_date: string | null;
  credit_type: string;
  rollover_max_days: number | null;
  rollover_max_times: number | null;
  conversion_date: string | null;
  conversion_rate: number | null;
  loan_purpose: string | null;
  reference_contract: string | null;
  curtailment_option: boolean;
  remark: string | null;
  utilization: number;
  remaining: number;
  start_date: string;
  end_date: string;
  status: CAStatus;
  rate_cards?: any[];
  acct_cards?: any[];
  created_at: string;
  updated_at: string;
}

export interface CACondition {
  ca_id: string;
  de_op: string | null;
  de_value: number | null;
  dscr_op: string | null;
  dscr_value: number | null;
  other_requirement: string | null;
  consent_waiver: string | null;
}

export interface Lease {
  id: string;
  lease_no: string;
  ca_id: string | null;
  mode: 'hp' | 'other';
  use_bank_loan: boolean;
  contract_number: string | null;
  contract_date: string | null;
  classification: string;
  payment_frequency: string;
  payment_start_date: string | null;
  end_date: string | null;
  payment_type: string;
  asset_type: string;
  asset_name: string;
  chassis_no: string | null;  // HP mode — Migration 0044 — used by BR-LEASE-026 conflict check
  vendor: string | null;
  vehicle_price: number | null;
  down_payment: number | null;
  net_vehicle_cost: number | null;
  principal: number;
  annual_rate: number;
  term_months: number;
  start_date: string;
  balloon_amount: number | null;
  balloon_pattern: string | null;
  upfront_payment: number | null;
  grace_periods: number | null;
  prepaid_periods: number | null;
  discount_rate: number | null;
  rou_useful_life: number | null; // ROU Asset useful life (months); fallback = term_months
  vat_rate: number;
  posting_lease: boolean;
  inactive: boolean;
  calc_interest_end: boolean;
  include_balloon_installment: boolean;
  pay_eom: boolean;
  acct_cards: any[];
  rollover_parent_id: string | null;
  status: 'Draft' | 'Approved' | 'Active' | 'Closed' | 'Modified' | 'Roll Over';
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaseVersion {
  id: string;
  lease_id: string;
  version: number;
  effective_date: string;
  rou_asset: number;
  lease_liability: number;
  annual_rate: number | null;
  term_months: number | null;
  pl_amount: number;
  reason: string | null;
  je_id: string | null;
  created_at: string;
}

// ---------- Transactions ----------

export type FacilityType = 'PN' | 'LG' | 'BG' | 'FP' | 'OD' | 'TR' | 'FXF' | 'Loan' | 'Lease' | 'HP';

export interface PromissoryNote {
  id: string;
  name: string;
  pn_number: string | null;
  ca_id: string | null;
  finance_institution: string;
  facility_type: FacilityType;
  transaction_date: string;
  maturity_date: string | null;
  term_days: number | null;
  amount: number;
  currency: string;
  interest_rate_id: number | null;
  effective_rate: number | null;
  reference_contract: string | null;
  status: 'Draft' | 'Approved' | 'Active' | 'Roll Over' | 'Repaid' | 'Cancelled';
  remark: string | null;
  reference_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export const LG_TYPES = ['B/G', 'L/G', 'SDLC'] as const;
export type LGType = (typeof LG_TYPES)[number];

export const LG_STATUSES = ['Draft', 'Approved', 'Active', 'Roll Over', 'Expired', 'Closed', 'Cancelled', 'Terminated'] as const;
export type LGStatus = (typeof LG_STATUSES)[number];

export const PAYMENT_CYCLES = ['Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'One-Time'] as const;

export interface LetterGuarantee {
  id: string;
  lg_no: string; // Number — bank reference
  name: string | null; // internal name e.g. BGBBL001
  lg_type: string; // B/G | L/G | SDLC
  ca_id: string | null;
  finance_institution: string;
  beneficiary: string;
  subject: string | null;
  amount: number;
  amount_foreign: number | null;
  currency: string;
  conversion_date: string | null;
  conversion_rate: number | null;
  prepaid: boolean;
  reference_contract: string | null;
  issue_date: string; // Start Date
  expiry_date: string; // End Date
  value_date: string | null;
  status: LGStatus;
  remark: string | null;
  rate_cards: any[];
  payment_cycle: string | null;
  payment_date: string | null;
  fee_amount: number | null;
  rollover_parent_id: string | null;
  acct_cards: any[];
  created_at: string;
  updated_at: string;
}

export interface LGFee {
  id: string;
  lg_id: string;
  fee_date: string;
  description: string | null;
  rate_pct: number | null;
  amount: number;
  paid: boolean;
  paid_date: string | null;
  sort_order: number;
}

export type FPStatus = 'Draft' | 'Approved' | 'Active' | 'Roll Over' | 'Repaid' | 'Closed' | 'Cancelled';

export interface FloorPlan {
  id: string;
  fp_no: string;
  name: string | null;
  ca_id: string | null;
  finance_institution: string;
  vendor: string | null;
  schedule_mode: 'bmw' | 'other';
  start_date: string;
  end_date: string | null;
  transaction_date: string | null;
  maturity_date: string | null;
  term_days: number | null;
  amount: number;
  total_amount: number;
  used_amount: number;
  status: FPStatus;
  netting_ap: boolean;
  netting_ar: boolean;
  reference_contract: string | null;
  rollover_parent_id: string | null;
  inactive: boolean;
  currency: string;
  remark: string | null;
  rate_cards: any[];
  acct_cards: any[];
  /** MoM §12.1 — เพดานเบิกต่อรถ (% ของราคารถ). Default 80, config ได้ 50-100. */
  cap_pct: number;
  created_at: string;
  updated_at: string;
}

export interface FPChassis {
  id: string;
  fp_id: string;
  chassis_no: string;
  engine_no: string | null; // เลขเครื่อง
  model: string | null;
  receive_date: string | null;
  amount: number;
  /** Snapshot of chassis cost at Lookup time — basis for cap_pct (MoM §12.1) */
  chassis_price?: number | null;
  curtail_id: string | null;
  status: string;
  sort_order: number;
  original_location: string | null;
  current_location: string | null;
  location_modified_at: string | null;
}

export interface FPApBill {
  id: string;
  fp_id: string;
  invoice_no: string;
  vendor_name: string | null;
  inventory_amount: number;
  ap_amount: number;
  sort_order: number;
}

export interface FPArBill {
  id: string;
  fp_id: string;
  ar_invoice_no: string;
  customer_name: string | null;
  ar_amount: number;
  status: 'Pending' | 'Paid' | 'Cancelled' | string;
  sort_order: number;
}

export type ODStatus = 'Draft' | 'Approved' | 'Active' | 'Suspended' | 'Closed' | 'Cancelled';

export interface Overdraft {
  id: string;
  od_no: string;
  name: string | null;
  ca_id: string | null;
  finance_institution: string;
  facility_limit: number;
  used_amount: number;
  amount: number;
  interest_rate_id: number | null;
  effective_rate: number | null;
  start_date: string;
  end_date: string | null;
  transaction_date: string | null;
  account_no: string | null;
  status: ODStatus;
  rollover_parent_id: string | null;
  inactive: boolean;
  currency: string;
  remark: string | null;
  rate_cards: any[];
  acct_cards: any[];
  created_at: string;
  updated_at: string;
}

export interface ODBankTransaction {
  id: string;
  od_id: string;
  tx_date: string;
  ending_balance: number;
  source: 'Manual' | 'Import' | string;
  last_modified: string;
  remark: string | null;
}

export interface BankStatement {
  id: string;
  finance_institution: string;
  account_no: string;
  statement_name: string | null;
  statement_period: string | null;
  source: 'Manual' | 'Import' | string;
  inactive: boolean;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankStatementLine {
  id: string;
  statement_id: string;
  tx_date: string;
  tx_time: string | null;
  txn_code: string | null;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
  source: 'Manual' | 'Import' | string;
  remark: string | null;
  sort_order: number;
  // Facility link (migration 0038) — manual reconciliation per MoM Day 4 §8.1
  facility_type: 'P/N' | 'LG' | 'LC' | 'FP' | 'OD' | 'TR' | 'FXF' | 'Loan' | 'HP' | 'Lease' | null;
  facility_id: string | null;
  source_period: number | null;
}

export type TRStatus = 'Draft' | 'Approved' | 'Active' | 'Roll Over' | 'Repaid' | 'Closed' | 'Cancelled';

// Letter of Credit (L/C). Off-Balance / fee-based; Flow LC → TR.
export type LCStatus = 'Draft' | 'Approved' | 'Active' | 'Converted' | 'Expired' | 'Closed';

export interface LetterOfCredit {
  id: string;
  lc_no: string;
  name: string | null;
  ca_id: string | null;
  finance_institution: string;
  lc_type: string; // 'LC' | 'SBLC'
  beneficiary: string | null;
  applicant: string | null;
  currency: string;
  amount_foreign: number;
  conversion_rate: number | null;
  amount: number; // THB equivalent
  issue_date: string | null;
  expiry_date: string | null;
  transaction_date: string | null;
  term_days: number | null;
  fee_mode: string; // 'full_term' | 'engagement_prorated'
  fee_rate: number; // %
  engagement_fee: number;
  fee_amount: number;
  reference_fxf_id: string | null;
  reference_contract: string | null;
  shared_limit_with_tr: boolean;
  converted_tr_id: string | null;
  conversion_date: string | null;
  // Pay & Close (settle direct from bank
  settlement_date: string | null;
  settlement_amount: number | null; // THB actually paid (= foreign × settlement_fx_rate)
  settlement_fx_rate: number | null; // FX rate on settlement date (may differ from issue rate)
  closed_date: string | null;
  inactive: boolean;
  status: LCStatus;
  remark: string | null;
  rate_cards: any[];
  acct_cards: any[];
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrustReceipt {
  id: string;
  tr_no: string;
  name: string | null;
  ca_id: string | null;
  finance_institution: string;
  supplier: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  due_date: string;
  transaction_date: string | null;
  maturity_date: string | null;
  term_days: number | null;
  amount: number;
  amount_foreign: number | null;
  conversion_date: string | null;
  conversion_rate: number | null;
  currency: string;
  reference_contract: string | null;
  rollover_parent_id: string | null;
  inactive: boolean;
  interest_rate_id: number | null;
  effective_rate: number | null;
  status: TRStatus;
  remark: string | null;
  rate_cards: any[];
  acct_cards: any[];
  created_at: string;
  updated_at: string;
}

export interface TRImportedGoods {
  id: string;
  tr_id: string;
  reference_no: string;
  description: string | null;
  vendor: string | null;
  amount_foreign: number;
  sort_order: number;
}

export type FXFStatus = 'Draft' | 'Approved' | 'Active' | 'Settled' | 'Closed' | 'Cancelled';

export interface FXForward {
  id: string;
  fxf_no: string;
  name: string | null;
  ca_id: string | null;
  finance_institution: string;
  deal_date: string;
  value_date: string;
  transaction_date: string | null;
  maturity_date: string | null;
  term_days: number | null;
  direction: 'Buy' | 'Sell';
  ccy_buy: string;
  ccy_sell: string;
  currency: string;
  amount_buy: number;
  amount_sell: number;
  notional_amount_foreign: number | null;
  amount_thb: number | null;
  conversion_date: string | null;
  spot_rate: number | null;
  forward_rate: number;
  swap_points: number | null;
  reference_transaction: string | null;
  reference_tr_contract: string | null;
  inactive: boolean;
  status: FXFStatus;
  remark: string | null;
  acct_cards: any[];
  created_at: string;
  updated_at: string;
}

export interface FXFFee {
  id: string;
  fxf_id: string;
  gl_date: string;
  spot_fee: number;
  cancellation_amendment_fee: number;
  je_id: string | null;
  remark: string | null;
}

export interface FXFFairValue {
  id: string;
  fxf_id: string;
  accounting_period: string;
  fair_value: number;
  unrealized_gain_loss: number;
  je_id: string | null;
  remark: string | null;
}

export type LoanStatus = 'Draft' | 'Approved' | 'Active' | 'Closed' | 'Modified' | 'Rejected' | 'Cancelled';

export interface Loan {
  id: string;
  loan_no: string;
  name: string | null;
  ca_id: string | null;
  finance_institution: string;
  principal: number;
  amount: number | null;
  amount_foreign: number | null;
  conversion_date: string | null;
  conversion_rate: number | null;
  currency: string;
  annual_rate: number;
  term_months: number;
  start_date: string;
  end_date: string | null;
  transaction_date: string | null;
  installment_start_date: string | null;
  installment_end_date: string | null;
  pay_eom: boolean;
  payment_timing: string; // 'arrears' (ปลายงวด) | 'advance' (ต้นงวด)
  payment_type: string;
  grace_months: number;
  installment: number | null;
  residual_value: number;
  include_rv_in_installment: boolean;
  step_period: number | null; // Step-Up/Down boundary
  step_residual: number | null; // RV target at end of phase 1
  balloon_option: string | null;
  effective_rate: number | null;
  irr_month: number | null;
  allow_prepayment: string;
  prepayment_fee_base: string;
  rollover_parent_id: string | null;
  inactive: boolean;
  payment_freq: string;
  status: LoanStatus;
  closed_at: string | null;
  closed_reason: string | null;
  remark: string | null;
  rate_cards: any[];
  acct_cards: any[];
  created_at: string;
  updated_at: string;
}

export interface LoanPrepayment {
  id: string;
  loan_id: string;
  prepay_date: string;
  kind: 'Full' | 'Partial';
  amount: number;
  accrued_interest: number;
  fee: number;
  fee_rate: number;
  fee_base: string | null;
  reamortize_mode: string | null;
  total_paid: number;
  je_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface LoanChassis {
  id: string;
  loan_id: string;
  chassis_no: string;
  engine_no: string | null; // เลขเครื่อง
  car_model: string | null;
  location: string | null;
  cost: number;
  status: string;
  sort_order: number;
}

export interface LoanSchedule {
  id: string;
  loan_id: string;
  period: number;
  due_date: string;
  begin_balance: number;
  payment: number;
  interest: number;
  principal: number;
  end_balance: number;
  paid: boolean;
  paid_date: string | null;
  created_at: string;
}

export interface Repayment {
  id: string;
  repayment_no: string;
  facility_type: FacilityType;
  facility_id: string;
  pay_date: string;
  amount: number;
  principal: number;
  interest: number;
  fee: number;
  vat: number;
  wht: number;
  penalty: number;
  /**
   * Payment channel — 3 values per MoM Interface §4 (Migration 0047):
   *   Bank Statement — Direct debit / auto-deduct (recon via bank statement)
   *   AP — สั่ง NetSuite AP module ให้จ่ายเงิน (เลือก payment_type ต่อ)
   *   Cash — เงินสด
   *
   * Legacy 'AP Module' + 'Cheque' channels migrated → 'AP' with payment_type='Cheque'
   */
  channel: 'Bank Statement' | 'AP' | 'Cash' | string;
  /**
   * Payment method when channel = AP (Phase 1: Cheque only · Phase 2: Wire/EFT/CreditCard)
   * NULL when channel != AP.
   */
  payment_type: 'Cheque' | 'Wire' | 'EFT' | 'CreditCard' | null;
  reference_no: string | null;
  remark: string | null;
  status: 'Draft' | 'Posted' | 'Reversed';
  je_id: string | null;
  /**
   * FK to bank_statement_lines.id when Repayment was created from a Bank Statement line
   * (Source = Bank). NULL = Manual / CSV Import / AP Cheque source. Migration 0045.
   */
  bank_statement_line_id: string | null;
  created_at: string;
  updated_at: string;
}

export type RepaymentCategory = 'Principal' | 'Interest' | 'Fee' | 'Penalty';
export const REPAYMENT_CATEGORIES: RepaymentCategory[] = ['Principal', 'Interest', 'Fee', 'Penalty'];

// AP Cheque Requests (Migration 0043) — Per MoM_MGC_LoanLease_NetSuite §3.2
export type APChequeStatus = 'Pending' | 'Approved' | 'Issued' | 'Cleared' | 'Cancelled';
export const AP_CHEQUE_STATUSES: APChequeStatus[] = ['Pending', 'Approved', 'Issued', 'Cleared', 'Cancelled'];

export interface APChequeRequest {
  id: string;
  source_type: string;          // 'REPAYMENT' | 'LEASE_PAYMENT' | 'LOAN_INTEREST'
  source_id: string;
  repayment_id: string | null;

  vendor_name: string | null;
  amount: number;
  currency: string;
  due_date: string | null;
  memo: string | null;

  je_id: string | null;
  gl_account: string | null;

  cheque_no: string | null;
  issued_date: string | null;
  cleared_date: string | null;
  status: APChequeStatus;

  netsuite_ap_id: string | null;
  netsuite_payload: any;
  netsuite_response: any;
  sync_status: string | null;
  sync_error: string | null;

  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface RepaymentLine {
  id: string;
  repayment_id: string;
  facility_type: string;
  facility_id: string | null;
  contract_label: string | null;
  category: RepaymentCategory;
  amount: number;
  sort_order: number;
}

export const FACILITY_TYPES: FacilityType[] = ['PN', 'LG', 'BG', 'FP', 'OD', 'TR', 'FXF', 'Loan', 'Lease', 'HP'];

// ---------- Journal Entries (Phase 2) ----------

export type JEStatus = 'Draft' | 'Posted' | 'Reversed';

export const JE_SOURCE_TYPES = [
  // LG / BG
  'LG_FEE', 'LG_REFUND', 'LG_ISSUE_OFFBALANCE', 'LG_EXPIRE_REVERSE', 'LG_TERMINATE_REVERSE',
  // PN
  'PN_DRAWDOWN', 'PN_ACCRUED', 'PN_INT',
  // FP
  'FP_DRAWDOWN', 'FP_ACCRUED', 'FP_CURTAIL',
  // OD / TR
  'OD_ACCRUED', 'TR_DRAWDOWN', 'TR_ACCRUED', 'TR_INT',
  // FXF
  'FXF_FEE', 'FXF_FAIRVALUE', 'FXF_SETTLEMENT', 'FXF_SETTLE',
  // LC
  'LC_FEE', 'LC_FEE_RECOG', 'LC_CONVERT', 'LC_SETTLE',
  // Loan
  'LOAN_DRAWDOWN', 'LOAN_ACCRUED', 'LOAN_INT_PAY', 'LOAN_PAY', 'LOAN_PREPAY',
  // Lease / HP
  'LEASE_DAY1', 'LEASE_PAY', 'LEASE_DEPR', 'LEASE_REBATE', 'LEASE_REMEASURE', 'LEASE_TRANSFER',
  // Repayment & Manual
  'REPAYMENT', 'MANUAL',
] as const;
export type JESourceType = (typeof JE_SOURCE_TYPES)[number];

export interface JournalEntry {
  id: string;
  je_number: string;
  source_type: string;
  source_id: string | null;
  source_period: number | null;
  je_date: string;
  posting_period: string | null;
  description: string | null;
  total_dr: number;
  total_cr: number;
  status: JEStatus;
  posted_by: string | null;
  posted_at: string | null;
  reversed_by_je_id: string | null;
  is_reversal: boolean;
  remark: string | null;
  netsuite_je_id: string | null;
  netsuite_synced_at: string | null;
  sync_status: 'pending' | 'synced' | 'failed' | null;
  created_at: string;
  updated_at: string;
}

export interface JELine {
  id: string;
  je_id: string;
  line_no: number;
  account_code: string | null;
  account_name: string | null;
  dr: number;
  cr: number;
  description: string | null;
}

// ---------- Master Data ----------

export const INTEREST_TYPES = ['MLR', 'MOR', 'MRR', 'MMR', 'Fixed'] as const;
export type InterestType = (typeof INTEREST_TYPES)[number];

export interface InterestRate {
  id: number;
  finance_institution: string;
  interest_type: InterestType;
  base_rate: number;
  margin: number;
  effective_rate: number;
  date_effective: string;
  end_effective_date: string | null;
  status: 'Active' | 'Inactive';
  remark: string | null;
  created_at: string;
  updated_at: string;
}

// Chart of Accounts (COA) master.7. Feeds GL Account dropdown in Account Mapping.
export interface GLAccount {
  id: string;
  company: string | null;
  code: string;
  name: string;
  fs_no: string | null;
  fs_name: string | null;
  fs_group: string | null;
  conso_group: string | null;
  nfs_group: string | null;
  inactive: boolean;
  created_at: string;
}

export interface Curtailment {
  id: string;
  vendor: string;
  vehicle_type: string;
  effective_start_date: string;
  effective_end_date: string | null;
  tier1_days: number | null;
  tier1_pct: number | null;
  tier2_days: number | null;
  tier2_pct: number | null;
  tier3_days: number | null;
  tier3_pct: number | null;
  tier4_days: number | null;
  tier4_pct: number | null;
  tier5_days: number | null;
  tier5_pct: number | null;
  tier6_days: number | null;
  tier6_pct: number | null;
  status: 'Active' | 'Inactive';
  remark: string | null;
  created_at: string;
  updated_at: string;
}

// ─── User Management (RBAC) ───────────────────────────────────────────
export interface PermissionGroup {
  id: string;
  name: string;
  description: string | null;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface GroupPermission {
  id: string;
  group_id: string;
  menu_key: string;
  can_view: boolean;
  can_edit: boolean;
  can_approve: boolean;
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  group_id: string | null;
  status: 'Active' | 'Inactive';
  auth_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export const VENDORS = [
  'BMW (Thailand) Co., Ltd.',
  'Honda Automobile Co., Ltd.',
  'Toyota Motor Thailand Co., Ltd.',
  'Mercedes-Benz (Thailand)',
  'Nissan Motor (Thailand)',
] as const;

export const VEHICLE_TYPES = [
  'New2024',
  'Used2024',
  'New2025',
  'Used2025',
  'New2026',
  'Used2026',
] as const;

export interface LeaseScheduleRow {
  id: string;
  lease_id: string;
  period: number;
  due_date: string;
  begin_balance: number;
  payment: number;
  interest: number;
  principal: number;
  end_balance: number;
  vat: number;
  total_inc_vat: number;
  deferred_interest_balance: number;
  vat_balance: number;
  note: string | null;
  paid: boolean;
  paid_date: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------
// Supabase Database<> type for createClient<Database>(...)
// ---------------------------------------------------------------------

type Insertable<T> = Omit<T, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type Database = {
  public: {
    Tables: {
      master_agreements: { Row: MasterAgreement; Insert: Insertable<MasterAgreement>; Update: Partial<MasterAgreement> };
      ma_subsidiaries: { Row: MASubsidiary; Insert: Omit<MASubsidiary, 'id' | 'remaining'> & { id?: string }; Update: Partial<MASubsidiary> };
      ma_conditions: { Row: MACondition; Insert: MACondition; Update: Partial<MACondition> };
      ma_collaterals: { Row: MACollateral; Insert: Omit<MACollateral, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<MACollateral> };
      ma_guarantors: { Row: MAGuarantor; Insert: Omit<MAGuarantor, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<MAGuarantor> };
      credit_agreements: { Row: CreditAgreement; Insert: Insertable<CreditAgreement>; Update: Partial<CreditAgreement> };
      leases: { Row: Lease; Insert: Insertable<Lease>; Update: Partial<Lease> };
      lease_schedules: { Row: LeaseScheduleRow; Insert: Omit<LeaseScheduleRow, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<LeaseScheduleRow> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: { ma_status: MAStatus; ca_status: CAStatus; lease_mode: 'hp' | 'other'; lease_status: Lease['status'] };
  };
};
