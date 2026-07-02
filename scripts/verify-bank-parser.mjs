// Manual smoke-check for the bank-statement parsers.
//
// This is a scratch script — not part of CI, no test framework — that verifies
// the parsers against real cp874 samples. Run it after changing anything in
// src/lib/bank-statement-parser/.
//
// Usage:
//   1) Compile the parser to plain .js:
//        mkdir -p .verify-out
//        npx tsc --outDir .verify-out --module esnext --target es2022 \
//          --moduleResolution nodenext --skipLibCheck \
//          src/lib/bank-statement-parser/*.ts
//        # nodenext preserves .js extensions on relative imports for Node ESM
//   2) Point SAMPLES_DIR at a folder containing the two CSVs:
//        SAMPLES_DIR=/path/to/uploads node scripts/verify-bank-parser.mjs
//
// Expected output ends with "✓ all checks passed".

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARSER_DIR = path.resolve(__dirname, '../.verify-out');
const parserUrl = pathToFileURL(path.join(PARSER_DIR, 'index.js')).href;

const SAMPLES_DIR = process.env.SAMPLES_DIR;
if (!SAMPLES_DIR) {
  console.error('Set SAMPLES_DIR to a folder that contains the sample CSVs.');
  process.exit(2);
}
const KBANK_PATH = path.join(SAMPLES_DIR, 'ตัวอย่าง Statement KBANK ไฟล์ CSV.csv');
const SCB_PATH = path.join(SAMPLES_DIR, 'ตัวอย่าง Statement ของ SCB ไฟล์ CSV.csv');

function decodeCP874(buf) {
  return new TextDecoder('windows-874').decode(buf);
}

let fail = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok  :', msg);
  else { console.log('  FAIL:', msg); fail++; }
}

async function main() {
  const { parseBankStatement, parseKBankDate, parseSCBDate } = await import(parserUrl);

  console.log('KBANK →', KBANK_PATH);
  if (!existsSync(KBANK_PATH)) {
    console.warn('  (skipped — file not found)');
  } else {
    const parsed = parseBankStatement(decodeCP874(readFileSync(KBANK_PATH)));
    console.log(`  bank=${parsed.bank}  account_no=${parsed.account_no}  period=${parsed.statement_period}  lines=${parsed.lines.length}`);
    parsed.lines.slice(0, 3).forEach((l) => console.log('   ', JSON.stringify(l)));
    assert(parsed.bank === 'KBANK', 'detected KBANK');
    assert(parsed.lines.length > 200, `>200 lines (${parsed.lines.length})`);
    assert(parsed.statement_period === '2026-04', 'period 2026-04');
    assert(parsed.account_no === '1002820559', 'account_no stripped apostrophe');
  }

  console.log('\nSCB →', SCB_PATH);
  if (!existsSync(SCB_PATH)) {
    console.warn('  (skipped — file not found)');
  } else {
    const parsed = parseBankStatement(decodeCP874(readFileSync(SCB_PATH)));
    console.log(`  bank=${parsed.bank}  account_no=${parsed.account_no}  period=${parsed.statement_period}  lines=${parsed.lines.length}`);
    parsed.lines.slice(0, 3).forEach((l) => console.log('   ', JSON.stringify(l)));
    assert(parsed.bank === 'SCB', 'detected SCB');
    assert(parsed.lines.length > 6, `>6 lines (${parsed.lines.length})`);
    assert(parsed.account_no === '1402534172', 'account_no captured');
    assert(parsed.lines[0].credit === 22338, 'first row comma-stripped credit');
  }

  console.log('\nDate helpers:');
  assert(parseKBankDate('01-เม.ย.-2569') === '2026-04-01', 'BE 2569 + เม.ย. → 2026-04-01');
  assert(parseKBankDate('15-ธ.ค.-2568') === '2025-12-15', 'BE 2568 + ธ.ค. → 2025-12-15');
  assert(parseSCBDate('01/04/2026') === '2026-04-01', 'SCB 01/04/2026 → 2026-04-01');

  console.log(fail === 0 ? '\n✓ all checks passed' : `\n✗ ${fail} check(s) failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
