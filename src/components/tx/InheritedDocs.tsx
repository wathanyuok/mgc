// Inherited Documents — read-only display of MA + CA documents within a Transaction's Document tab.
// Audit trail: MA → CA → TX should be visible in a single page.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface InheritedDoc {
  id: string;
  file_name: string;
  file_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  uploaded_at: string;
}

function fmtBytes(n: number | null): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fileIcon(type: string | null): string {
  if (!type) return '📄';
  if (type.startsWith('image/')) return '🖼';
  if (type === 'application/pdf') return '📕';
  return '📄';
}

interface Props {
  caId: string | null | undefined;
}

/**
 * Reads MA + CA documents from a TX's linked CA → MA chain.
 * Renders two collapsible, read-only sections.
 * If caId is null/empty, shows a hint instead of crashing.
 */
export function InheritedDocs({ caId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['inherited-docs', caId],
    enabled: !!caId,
    queryFn: async () => {
      // 1) Get CA → ma_id
      const { data: ca, error: caErr } = await supabase
        .from('credit_agreements')
        .select('id, ca_name, contract_number, ma_id')
        .eq('id', caId!)
        .maybeSingle();
      if (caErr) throw caErr;

      // 2) Parallel: ca_documents + (if ma_id) ma_documents + ma header
      const caDocsP = supabase
        .from('ca_documents')
        .select('*')
        .eq('ca_id', caId!)
        .order('uploaded_at', { ascending: false });

      const maDocsP = ca?.ma_id
        ? supabase
            .from('ma_documents')
            .select('*')
            .eq('ma_id', ca.ma_id)
            .order('uploaded_at', { ascending: false })
        : Promise.resolve({ data: [], error: null });

      const maHeaderP = ca?.ma_id
        ? supabase
            .from('master_agreements')
            .select('id, ma_name')
            .eq('id', ca.ma_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [caDocsR, maDocsR, maHeaderR] = await Promise.all([caDocsP, maDocsP, maHeaderP]);
      if (caDocsR.error) throw caDocsR.error;
      if (maDocsR.error) throw maDocsR.error;

      return {
        ca,
        ma: maHeaderR.data,
        caDocs: (caDocsR.data ?? []) as InheritedDoc[],
        maDocs: (maDocsR.data ?? []) as InheritedDoc[],
      };
    },
  });

  if (!caId) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded text-xs mb-4">
        ⚠️ ยังไม่ได้เลือก <strong>Credit Agreement</strong> — ไม่สามารถดึงเอกสาร MA / CA มาแสดงได้
      </div>
    );
  }

  if (isLoading) {
    return <div className="text-muted text-sm mb-4">กำลังโหลดเอกสาร MA / CA...</div>;
  }

  if (!data) return null;

  const { ca, ma, caDocs, maDocs } = data;

  return (
    <div className="space-y-3 mb-4">
      <InheritedSection
        title="From Master Agreement"
        parentLabel={ma ? `${(ma as any).ma_name ?? ''}`.trim() : '—'}
        parentLink={ma ? `/ma/${ma.id}` : null}
        bucketName="ma-documents"
        docs={maDocs}
        emptyMsg={ca?.ma_id ? 'MA นี้ยังไม่มีเอกสาร' : 'CA นี้ยังไม่ได้ผูก MA'}
        defaultOpen
      />
      <InheritedSection
        title="From Credit Agreement"
        parentLabel={ca ? `${(ca as any).ca_name ?? ''}${(ca as any).contract_number ? ` · ${(ca as any).contract_number}` : ''}`.trim() : '—'}
        parentLink={ca ? `/ca/${ca.id}` : null}
        bucketName="ca-documents"
        docs={caDocs}
        emptyMsg="CA นี้ยังไม่มีเอกสาร"
        defaultOpen
      />
    </div>
  );
}

function InheritedSection({
  title,
  parentLabel,
  parentLink,
  bucketName,
  docs,
  emptyMsg,
  defaultOpen = true,
}: {
  title: string;
  parentLabel: string;
  parentLink: string | null;
  bucketName: string;
  docs: InheritedDoc[];
  emptyMsg: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const onView = (d: InheritedDoc) => {
    if (!d.storage_path) return toast.error('ไม่พบไฟล์');
    const { data } = supabase.storage.from(bucketName).getPublicUrl(d.storage_path);
    window.open(data.publicUrl, '_blank');
  };

  const onDownload = async (d: InheritedDoc) => {
    if (!d.storage_path) return;
    const { data, error } = await supabase.storage.from(bucketName).download(d.storage_path);
    if (error) return toast.error(error.message);
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = d.file_name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="border border-line rounded bg-soft">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-100 text-sm"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <FileText className="w-4 h-4 text-brand" />
          <span className="font-semibold">{title}</span>
          <span className="text-xs text-muted">({docs.length})</span>
          {parentLink && (
            <a
              href={parentLink}
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-brand hover:underline ml-2"
              title={parentLabel}
            >
              {parentLabel.length > 40 ? parentLabel.slice(0, 40) + '…' : parentLabel} →
            </a>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted bg-white border border-line px-2 py-0.5 rounded">
          read-only
        </span>
      </button>
      {open && (
        <div className="border-t border-line bg-white p-3">
          {docs.length === 0 ? (
            <div className="text-muted text-xs text-center py-3">{emptyMsg}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-32">Action</th>
                    <th>File Name</th>
                    <th>Type</th>
                    <th className="text-right">Size</th>
                    <th>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <div className="flex gap-1 text-xs">
                          <button onClick={() => onView(d)} className="text-brand hover:underline">View</button>
                          <span className="text-gray-300">|</span>
                          <button onClick={() => onDownload(d)} className="text-brand hover:underline">Download</button>
                        </div>
                      </td>
                      <td>{fileIcon(d.file_type)} {d.file_name}</td>
                      <td className="uppercase text-xs">{d.file_type?.split('/').pop() ?? '—'}</td>
                      <td className="text-right tabular-nums">{fmtBytes(d.size_bytes)}</td>
                      <td>{new Date(d.uploaded_at).toLocaleDateString('en-GB')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
