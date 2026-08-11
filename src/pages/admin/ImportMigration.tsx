// Import Migration — upload Data Migration Template (5 sheets) → validate → import → summary
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, ArrowRight, RotateCcw } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import {
  parseWorkbook, validateWorkbook, runImport,
  type ParsedWorkbook, type ImportError, type ImportSummary,
} from '@/lib/import-migration';

type Step = 'upload' | 'validated' | 'importing' | 'done';

const MODULE_ROUTE: Record<string, string> = {
  PN: '/tx/pn', LG: '/tx/lg', BG: '/tx/lg', SBLC: '/tx/lg', LC: '/tx/lc',
  FP: '/tx/fp', OD: '/tx/od', TR: '/tx/tr', FXF: '/tx/fxf', Loan: '/tx/loan',
  'Hire Purchase': '/lease/hp', Leasing: '/lease/other', 'Leasing Other': '/lease/other',
};

export function ImportMigration() {
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hardErrors = errors.filter((e) => e.severity === 'error');
  const canImport = parsed && hardErrors.length === 0;

  const handleFile = async (f: File) => {
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    const p = parseWorkbook(buf);
    setParsed(p);
    setErrors(validateWorkbook(p));
    setStep('validated');
  };

  const handleImport = async () => {
    if (!parsed) return;
    setStep('importing');
    const s = await runImport(parsed, setProgress);
    setSummary(s);
    setStep('done');
  };

  const reset = () => {
    setStep('upload'); setParsed(null); setErrors([]); setSummary(null); setFileName('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const counts = parsed ? [
    ['01_Contract', parsed.contract.length],
    ['02_Interest Rate', parsed.interest.length],
    ['03_Repayment Terms', parsed.schedule.length],
    ['04_Collateral', parsed.collateral.length],
    ['05_Guarantor', parsed.guarantor.length],
  ] as const : [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Import Migration</h1>
          <p className="text-sm text-muted">นำเข้าข้อมูลตั้งต้น ณ วัน Cut-Off จาก Data Migration Template (5 sheets)</p>
        </div>
        {step !== 'upload' && (
          <Button variant="ghost" onClick={reset}><RotateCcw size={14} className="mr-1" /> เริ่มใหม่</Button>
        )}
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-xs font-medium">
        {(['1. Upload', '2. Validate', '3. Import', '4. สรุปผล'] as const).map((label, i) => {
          const active = ['upload', 'validated', 'importing', 'done'].indexOf(step) >= i;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <ArrowRight size={12} className="text-muted" />}
              <span className={`px-2.5 py-1 rounded-full ${active ? 'bg-brand text-white' : 'bg-soft text-muted'}`}>{label}</span>
            </div>
          );
        })}
      </div>

      {/* Step 1 — Upload */}
      {step === 'upload' && (
        <label className="block border-2 border-dashed border-line rounded-lg p-12 text-center cursor-pointer hover:border-brand hover:bg-soft/40 transition">
          <input
            ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <Upload size={32} className="mx-auto text-muted mb-3" />
          <p className="font-medium">เลือกไฟล์ MGC_DataMigration_Template (.xlsx)</p>
          <p className="text-xs text-muted mt-1">ระบบจะตรวจสอบความครบถ้วนก่อน ยังไม่บันทึกข้อมูลจนกว่าจะกดยืนยัน</p>
        </label>
      )}

      {/* Step 2 — Validation result */}
      {step === 'validated' && parsed && (
        <>
          <div className="rounded border border-line bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileSpreadsheet size={18} className="text-brand" />
              <span className="font-medium text-sm">{fileName}</span>
            </div>
            <div className="grid grid-cols-5 gap-3">
              {counts.map(([name, n]) => (
                <div key={name} className="rounded bg-soft/60 p-3 text-center">
                  <div className="text-lg font-bold tabular-nums">{n}</div>
                  <div className="text-[11px] text-muted">{name}</div>
                </div>
              ))}
            </div>
            {parsed.sheetsMissing.length > 0 && (
              <p className="text-xs text-amber-600 mt-2">⚠ ไม่พบ sheet: {parsed.sheetsMissing.join(', ')}</p>
            )}
          </div>

          {hardErrors.length === 0 ? (
            <div className="rounded border border-green-200 bg-green-50 p-4 flex items-center gap-3">
              <CheckCircle2 size={20} className="text-green-600" />
              <div className="flex-1">
                <p className="font-medium text-sm text-green-800">ตรวจสอบผ่าน — ข้อมูลครบถ้วน พร้อมนำเข้า</p>
                <p className="text-xs text-green-700">กด Import เพื่อบันทึกเข้าระบบ (MA ที่ซ้ำจะไม่ถูกสร้างซ้ำ)</p>
              </div>
              <Button onClick={handleImport}>Import เข้าระบบ</Button>
            </div>
          ) : (
            <div className="rounded border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <XCircle size={18} className="text-red-600" />
                <p className="font-medium text-sm text-red-800">
                  พบข้อผิดพลาด {hardErrors.length} จุด — แก้ในไฟล์ Excel แล้ว upload ใหม่
                </p>
              </div>
              <div className="max-h-80 overflow-auto rounded border border-red-100 bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-red-100/60 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-semibold">Sheet</th>
                      <th className="text-left px-2 py-1.5 font-semibold">แถว</th>
                      <th className="text-left px-2 py-1.5 font-semibold">Column</th>
                      <th className="text-left px-2 py-1.5 font-semibold">ปัญหา</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hardErrors.map((e, i) => (
                      <tr key={i} className="border-t border-line/60">
                        <td className="px-2 py-1 whitespace-nowrap">{e.sheet.slice(0, 13)}</td>
                        <td className="px-2 py-1 tabular-nums">{e.row || '—'}</td>
                        <td className="px-2 py-1">{e.column}</td>
                        <td className="px-2 py-1">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Step 3 — Importing */}
      {step === 'importing' && (
        <div className="rounded border border-line bg-white p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-brand border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm font-medium">{progress || 'กำลังนำเข้า...'}</p>
        </div>
      )}

      {/* Step 4 — Summary */}
      {step === 'done' && summary && (() => {
        const fails = summary.errors.filter((e) => e.severity === 'error');
        const skips = summary.errors.filter((e) => e.severity === 'warning');
        return (
        <>
          <div className={`rounded border p-4 flex items-center gap-3 ${fails.length === 0 ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            {fails.length === 0
              ? <CheckCircle2 size={22} className="text-green-600" />
              : <AlertTriangle size={22} className="text-amber-600" />}
            <div>
              <p className="font-semibold text-sm">
                {fails.length === 0
                  ? `นำเข้าครบถ้วน ✓${skips.length ? ` (ข้าม ${skips.length} รายการที่มีอยู่แล้ว)` : ''}`
                  : `นำเข้าเสร็จ แต่มี ${fails.length} รายการไม่สำเร็จ${skips.length ? ` · ข้าม ${skips.length} รายการที่มีอยู่แล้ว` : ''}`}
              </p>
              <p className="text-xs text-muted">ตรวจสอบรายละเอียดด้านล่าง แล้วเปิดดูข้อมูลจริงจากเมนูแต่ละโมดูลได้เลย</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Master Agreement" value={`${summary.ma.created} สร้างใหม่`} sub={summary.ma.existing ? `${summary.ma.existing} มีอยู่แล้ว (ข้าม)` : undefined} to="/ma" />
            <SummaryCard label="Credit Agreement" value={`${summary.ca.created} สร้างใหม่`} sub={summary.ca.existing ? `${summary.ca.existing} มีอยู่แล้ว (ข้าม)` : undefined} to="/ca" />
            <SummaryCard label="อัตราดอกเบี้ย (rate cards)" value={`${summary.rates} รายการ`} />
            <SummaryCard label="หลักประกัน / ผู้ค้ำ" value={`${summary.collaterals} / ${summary.guarantors}`} />
          </div>

          <div className="rounded border border-line bg-white p-4">
            <p className="text-sm font-semibold mb-2">Transaction ที่สร้าง</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.tx).map(([mod, n]) => (
                <Link key={mod} to={MODULE_ROUTE[mod] ?? '#'}>
                  <Badge variant="brand" className="cursor-pointer">{mod}: {n}</Badge>
                </Link>
              ))}
              {Object.keys(summary.tx).length === 0 && <span className="text-xs text-muted">— ไม่มี —</span>}
            </div>
          </div>

          {fails.length > 0 && (
            <ResultTable title="รายการที่ import ไม่สำเร็จ" tone="amber" rows={fails} />
          )}
          {skips.length > 0 && (
            <ResultTable title="รายการที่ข้าม — มีอยู่ในระบบแล้ว (ไม่สร้างซ้ำ)" tone="gray" rows={skips} />
          )}
        </>
        );
      })()}
    </div>
  );
}

function ResultTable({ title, tone, rows }: { title: string; tone: 'amber' | 'gray'; rows: ImportError[] }) {
  const border = tone === 'amber' ? 'border-amber-200' : 'border-line';
  const head = tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-soft text-muted';
  return (
    <div className={`rounded border ${border} bg-white`}>
      <p className={`text-sm font-semibold px-3 pt-3 pb-2 ${tone === 'amber' ? 'text-amber-700' : 'text-muted'}`}>{title}</p>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <thead className={`${head} sticky top-0`}>
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold">Sheet</th>
              <th className="text-left px-2 py-1.5 font-semibold">แถว</th>
              <th className="text-left px-2 py-1.5 font-semibold">สาเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={i} className="border-t border-line/60">
                <td className="px-2 py-1 whitespace-nowrap">{e.sheet.slice(0, 13)}</td>
                <td className="px-2 py-1 tabular-nums">{e.row || '—'}</td>
                <td className="px-2 py-1">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, to }: { label: string; value: string; sub?: string; to?: string }) {
  const body = (
    <div className="rounded border border-line bg-white p-3 hover:border-brand transition h-full">
      <div className="text-[11px] uppercase text-muted font-medium">{label}</div>
      <div className="text-sm font-bold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
