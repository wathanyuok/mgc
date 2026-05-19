import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { fmtDate } from '@/lib/format';

interface MaDoc {
  id: string;
  ma_id: string;
  file_name: string;
  file_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

const BUCKET = 'ma-documents';

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

export function DocumentTab({
  maId,
  ensureMaId,
}: {
  maId: string | undefined;
  ensureMaId: () => Promise<string>;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const { data: docs, isLoading } = useQuery({
    queryKey: ['ma-docs', maId],
    enabled: !!maId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ma_documents')
        .select('*')
        .eq('ma_id', maId!)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as MaDoc[];
    },
  });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      // Auto-create MA draft if needed
      const targetId = await ensureMaId();
      const uploads = Array.from(files);
      for (const file of uploads) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: ขนาดเกิน 20 MB`);
        const ext = file.name.split('.').pop() ?? 'bin';
        const path = `${targetId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from('ma_documents').insert({
          ma_id: targetId,
          file_name: file.name,
          file_type: file.type,
          size_bytes: file.size,
          storage_path: path,
        });
        if (insErr) throw insErr;
      }
      return targetId;
    },
    onSuccess: (targetId) => {
      qc.invalidateQueries({ queryKey: ['ma-docs', targetId] });
      qc.invalidateQueries({ queryKey: ['ma-list'] });
      toast.success('Upload เรียบร้อย');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (doc: MaDoc) => {
      if (doc.storage_path) {
        await supabase.storage.from(BUCKET).remove([doc.storage_path]);
      }
      const { error } = await supabase.from('ma_documents').delete().eq('id', doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ma-docs', maId] });
      toast.success('ลบไฟล์แล้ว');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onPickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    upload.mutate(files);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onPickFiles(e.dataTransfer.files);
  };

  const onView = (doc: MaDoc) => {
    if (!doc.storage_path) return toast.error('ไม่พบไฟล์');
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(doc.storage_path);
    window.open(data.publicUrl, '_blank');
  };

  const onDownload = async (doc: MaDoc) => {
    if (!doc.storage_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).download(doc.storage_path);
    if (error) return toast.error(error.message);
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.file_name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {!maId && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded text-sm mb-4">
          💡 อัปโหลดเลย ระบบจะสร้าง Master Agreement Draft อัตโนมัติ
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-md p-8 text-center transition cursor-pointer ${
          dragging
            ? 'bg-brand-light border-brand'
            : 'bg-soft border-line hover:bg-brand-light hover:border-brand'
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
          onChange={(e) => onPickFiles(e.target.files)}
        />
        {upload.isPending && <div className="text-xs text-brand mt-2">⏳ กำลังอัปโหลด...</div>}
      </div>

      <div className="mt-6">
        <div className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" /> Document List ({docs?.length ?? 0})
        </div>
        {!maId ? (
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
                        <button onClick={() => onView(d)} className="text-brand hover:underline">
                          View
                        </button>
                        <span className="text-gray-300">|</span>
                        <button onClick={() => onDownload(d)} className="text-brand hover:underline">
                          Download
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          onClick={() => {
                            if (confirm(`ลบ ${d.file_name}?`)) del.mutate(d);
                          }}
                          className="text-danger hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                    <td>
                      {fileIcon(d.file_type)} {d.file_name}
                    </td>
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
