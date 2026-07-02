// Tiny CSV helpers used by the bank-statement parsers.
//
// We intentionally avoid pulling a full CSV library — bank exports are
// well-behaved (comma-separated, double-quote for values containing commas,
// no embedded newlines inside quoted values in the samples we've seen).

/** Split a CSV line into fields, respecting double-quoted values. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        // Escaped quote: "" → literal "
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parse a bank-formatted number.
 *   ""            → 0
 *   " "           → 0    (KBANK uses a single space for "no amount")
 *   "22,338.00"   → 22338
 *   "1044"        → 1044
 */
export function parseAmount(v: string | undefined | null): number {
  if (v == null) return 0;
  const trimmed = String(v).replace(/,/g, '').trim();
  if (trimmed === '' || trimmed === '-') return 0;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : 0;
}

/** Split text into non-empty lines, tolerant of CRLF / trailing whitespace. */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}
