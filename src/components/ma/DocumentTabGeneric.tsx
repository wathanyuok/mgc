// Generic Document tab — works for any parent table (MA, CA, ...)
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { fmtDate } from '@/lib/format';
import { useReadOnly } from '@/lib/readonly';

interface GenericDoc {
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
  parentId: string | undefined;
  ensureParentId: () => Promise<string>;
  bucketName: string; // e.g. 'ca-documents'
  tableName: string; // e.g. 'ca_documents'
  parentFkColumn: string; // e.g. 'ca_id'
}

export function DocumentTabGeneric({ parentId, ensureParentId, bucketName, tableName, parentFkColumn }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const ro = useReadOnly();
  const [dragging, setDragging] = useState(false);
  const queryKey = [`${tableName}-list`, parentId];

  const { data: docs, isLoading } = useQuery({
    queryKey,
    enabled: !!parentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq(parentFkColumn, parentId!)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as GenericDoc[];
    },
  });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const targetId = await ensureParentId();
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: ขนาดเกิน 20 MB`);
        const ext = file.name.split('.').pop() ?? 'bin';
        const path = `${targetId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from(bucketName).upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from(tableName).insert({
          [parentFkColumn]: targetId,
          file_name: file.name,
          file_type: file.type,
          size_bytes: file.size,
          storage_path: path,
        });
        if (insErr) throw insErr;
      }
      return targetId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success('Upload เรียบร้อย');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (doc: GenericDoc) => {
      if (doc.storage_path) await supabase.storage.from(bucketName).remove([doc.storage_path]);
      const { error } = await supabase.from(tableName).delete().eq('id', doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success('ลบไฟล์แล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onView = (d: GenericDoc) => {
    if (!d.storage_path) return toast.error('ไม่พบไฟล์');
    const { data } = supabase.storage.from(bucketName).getPublicUrl(d.storage_path);
    window.open(data.publicUrl, '_blank');
  };
  const onDownload = async (d: GenericDoc) => {
    if (!d.storage_path) return;
    const { data, error } = await supabase.storage.from(bucketName).download(d.storage_path);
    if (error) return toast.error(error.message);
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = d.file_name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {!parentId && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded text-sm mb-4">
          💡 อัปโหลดเลย ระบบจะสร้าง Draft อัตโนมัติ
        </div>
      )}
      {!ro && (
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) upload.mutate(e.dataTransfer.files);
        }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-md p-8 text-center transition cursor-pointer ${
          dragging ? 'bg-brand-light border-brand' : 'bg-soft border-line hover:bg-brand-light hover:border-brand'
        }`}
      >
        <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
        <div className="text-sm font-semibold text-brand">คลิกหรือลากไฟล์มาวางที่นี่</div>
        <div className="text-xs text-muted">PDF, JPG, PNG · ≤ 20 MB ต่อไฟล์</div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => e.target.files && e.target.files.length > 0 && upload.mutate(e.target.files)}
        />
        {upload.isPending && <div className="text-xs text-brand mt-2">⏳ กำลังอัปโหลด...</div>}
      </div>
      )}

      <div className="mt-6">
        <div className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" /> Document List ({docs?.length ?? 0})
        </div>
        {!parentId ? (
          <div className="text-muted text-sm text-center py-6">ยังไม่มีไฟล์</div>
        ) : isLoading ? (
          <div className="text-muted text-sm">กำลังโหลด...</div>
        ) : !docs || docs.length === 0 ? (
          <div className="text-muted text-sm text-center py-6">ยังไม่มีไฟล์</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-40">Action</th>
                  <th>File Name</th>
                  <th>Type</th>
                  <th className="text-right">Size</th>
                  <th>Uploaded Date</th>
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
                        <span className="text-gray-300">|</span>
                        {!ro && <button onClick={() => { if (confirm(`ลบ ${d.file_name}?`)) del.mutate(d); }} className="text-danger hover:underline">Delete</button>}
                      </div>
                    </td>
                    <td>{fileIcon(d.file_type)} {d.file_name}</td>
                    <td className="uppercase text-xs">{d.file_type?.split('/').pop() ?? '—'}</td>
                    <td className="text-right tabular-nums">{fmtBytes(d.size_bytes)}</td>
                    <td>{fmtDate(d.uploaded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
