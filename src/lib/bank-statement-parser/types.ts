// Multi-bank statement parser — shared types.
//
// The parser lives in-browser: user uploads a CSV/TXT (typically cp874-encoded
// for Thai banks), we auto-detect the bank format, produce ParsedBankStatement,
// preview it in a dialog, then bulk-insert into bank_statements +
// bank_statement_lines.

export type BankCode = 'KBANK' | 'SCB' | 'BBL';

export interface ParsedLine {
  /** ISO date 'YYYY-MM-DD' (converted from bank's native format). */
  tx_date: string;
  /** 'HH:MM' 24h — optional; some banks omit time. */
  tx_time?: string;
  /**
   * Bank-native transaction code / type label.
   * KBANK: Thai description e.g. 'ฝากด้วยเช็ค'.
   * SCB: short code e.g. 'X1', 'XR'.
   */
  txn_code?: string;
  /** Human-readable description (bank's "รายละเอียด" / Description column). */
  description: string;
  /** Positive number; 0 when the row is a credit. */
  debit: number;
  /** Positive number; 0 when the row is a debit. */
  credit: number;
  /** Running balance after the transaction. Sign already applied. */
  balance: number;
  /** Cheque number if present (KBANK "เลขที่เช็ค" / SCB "Cheque Number"). */
  cheque_no?: string;
  /** Channel — 'โอนเข้า/หักบัญชีอัตโนมัติ', 'BCMS', 'ATS', ... */
  channel?: string;
  /**
   * Anything we didn't map to a field above — packed into the DB `remark`
   * column so the raw source stays traceable.
   */
  raw_remark?: string;
}

export interface ParsedBankStatement {
  bank: BankCode;
  account_no: string;
  /** 'YYYY-MM' — matches bank_statements.statement_period convention. */
  statement_period: string;
  /** Optional pretty name — e.g. 'KBANK เม.ย. 2026'. */
  statement_name?: string;
  lines: ParsedLine[];
}
