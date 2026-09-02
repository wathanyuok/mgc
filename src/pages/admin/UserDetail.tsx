import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Card, CardContent, Input, Select, FieldLabel } from '@/components/ui';
import { type AppUser, type PermissionGroup } from '@/types/database';

import { checkRequiredFields } from '@/lib/required-check';
import { logSave } from '@/lib/audit-trail';
import { useAuth } from '@/lib/auth';
import { useReadOnly } from '@/lib/readonly';
import { useUnsavedGuard } from '@/lib/unsaved-guard';

/** รูปแบบอีเมลพื้นฐาน — ต้องมี @ และโดเมนที่มีจุด */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Form = {
  name: string; email: string; group_id: string; status: 'Active' | 'Inactive';
  /** ดูแลทุกบริษัท — ติ๊กแล้วไม่ต้องเลือกรายบริษัท */
  all_subsidiaries: boolean;
  /** รหัสบริษัทที่ดูแล (id ของ subsidiaries) */
  subsidiary_ids: string[];
};
const blank: Form = {
  name: '', email: '', group_id: '', status: 'Active',
  all_subsidiaries: false, subsidiary_ids: [],
};

export function UserDetail({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank);
  const { can } = useAuth();
  const viewOnly = useReadOnly();
  const canEdit = !viewOnly && can('user_mgmt', 'edit');
  const guard = useUnsavedGuard(form, () => navigate('/admin/users'));

  const { data: groups = [] } = useQuery({
    queryKey: ['perm-groups-opts'],
    queryFn: async () => {
      const { data } = await supabase.from('permission_groups').select('id, name').order('name');
      return (data ?? []) as Pick<PermissionGroup, 'id' | 'name'>[];
    },
  });

  // รายชื่อบริษัทในกลุ่ม — ตัวเดียวกับที่สัญญาหลักและวงเงินย่อยใช้
  // ต้องเป็นแหล่งเดียวกัน ไม่งั้นตอนกรองข้อมูลเทียบกันไม่ได้
  const { data: subOptions = [] } = useQuery({
    queryKey: ['subsidiary-options'],
    queryFn: async () => {
      const { data } = await supabase
        .from('subsidiaries')
        .select('id, code, name')
        .eq('active', true)
        .order('code');
      return (data ?? []) as { id: string; code: string; name: string }[];
    },
  });

  const { data: existing } = useQuery({
    queryKey: ['app-user', id],
    enabled: mode === 'edit' && !!id,
    queryFn: async () => {
      const [u, s] = await Promise.all([
        supabase.from('app_users').select('*').eq('id', id!).single(),
        supabase.from('app_user_subsidiaries').select('subsidiary_id').eq('user_id', id!),
      ]);
      if (u.error) throw u.error;
      return {
        user: u.data as AppUser,
        subsidiaryIds: ((s.data ?? []) as any[]).map((r) => r.subsidiary_id as string),
      };
    },
  });

  useEffect(() => {
    if (existing) {
      guard.reset(
        {
          name: existing.user.name,
          email: existing.user.email,
          group_id: existing.user.group_id ?? '',
          status: existing.user.status,
          all_subsidiaries: !!existing.user.all_subsidiaries,
          subsidiary_ids: existing.subsidiaryIds,
        },
        setForm,
      );
    }
  }, [existing]);

  const toggleSub = (sid: string) =>
    setForm((f) => ({
      ...f,
      subsidiary_ids: f.subsidiary_ids.includes(sid)
        ? f.subsidiary_ids.filter((x) => x !== sid)
        : [...f.subsidiary_ids, sid],
    }));

  const save = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      const email = form.email.trim().toLowerCase();
      if (!name) throw new Error('กรอกชื่อก่อน');
      if (!email) throw new Error('กรอกอีเมลก่อน');
      // อีเมลผิดรูปแบบ = ผู้ใช้รายนั้นเข้าระบบไม่ได้ตลอดไป เพราะระบบจับคู่ด้วยอีเมล
      if (!EMAIL_RE.test(email)) {
        throw new Error(`อีเมล "${form.email.trim()}" ไม่ถูกรูปแบบ — ต้องเป็นแบบ name@company.com`);
      }
      // ต้องระบุขอบเขตบริษัท ไม่งั้นผู้ใช้เข้าระบบมาแล้วไม่เห็นข้อมูลอะไรเลย
      // แล้วไม่มีใครรู้ว่าเพราะยังไม่ได้ตั้งค่า หรือเพราะตั้งใจไม่ให้เห็น
      if (!form.all_subsidiaries && form.subsidiary_ids.length === 0) {
        throw new Error('เลือกบริษัทที่ผู้ใช้ดูแล หรือติ๊ก "ดูแลทุกบริษัท"');
      }

      // ตรวจอีเมลซ้ำเองก่อน โดยไม่นับตัวเอง — จะได้บอกได้ว่าไปชนกับใคร
      // ปล่อยให้ฐานข้อมูลปฏิเสธอย่างเดียวไม่พอ เพราะข้อความที่ได้กลับมาไม่บอกชื่อคน
      {
        let q = supabase.from('app_users').select('id, name').eq('email', email);
        if (mode === 'edit' && id) q = q.neq('id', id);
        const { data: clash } = await q.limit(1);
        if (clash?.length) {
          throw new Error(
            `อีเมล ${email} ใช้อยู่กับผู้ใช้ "${clash[0].name}" แล้ว — อีเมลต้องไม่ซ้ำกัน เพราะระบบใช้จับคู่ผู้ใช้ตอนเข้าระบบ`,
          );
        }
      }

      const payload = {
        name, email, group_id: form.group_id || null, status: form.status,
        all_subsidiaries: form.all_subsidiaries,
      };
      let uid = id;
      if (mode === 'new') {
        const { data, error } = await supabase.from('app_users').insert(payload).select().single();
        if (error) throw error;
        uid = data.id;
      } else {
        const { error } = await supabase.from('app_users').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id!);
        if (error) throw error;
      }

      // บริษัทที่ดูแล — ลบของเดิมแล้วใส่ใหม่ ง่ายกว่าไล่เทียบทีละแถว
      // ติ๊กดูแลทุกบริษัทแล้วไม่ต้องเก็บรายบริษัท เพราะเปิดบริษัทใหม่ก็ครอบให้เอง
      await supabase.from('app_user_subsidiaries').delete().eq('user_id', uid!);
      if (!form.all_subsidiaries && form.subsidiary_ids.length > 0) {
        const { error } = await supabase.from('app_user_subsidiaries').insert(
          [...new Set(form.subsidiary_ids)].map((sid) => ({ user_id: uid!, subsidiary_id: sid })),
        );
        if (error) throw error;
      }
      return uid;
    },
    onSuccess: (uid) => {
      logSave('app_users', uid ?? id, form.email.trim(), mode === 'new');
      guard.markSaved();
      qc.invalidateQueries({ queryKey: ['app-users'] });
      qc.invalidateQueries({ queryKey: ['app-user', uid] });
      toast.success(mode === 'new' ? 'สร้างผู้ใช้แล้ว' : 'บันทึกแล้ว');
      if (mode === 'new') navigate(`/admin/users/${uid}`);
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? '');
      // 23505 = ค่าซ้ำ แต่การบันทึกแตะสองตาราง ต้องดูชื่อ constraint ว่าซ้ำที่ไหน
      // เดิมเหมารวมว่าเป็นอีเมลเสมอ พอบริษัทที่ดูแลชนกันเองเลยขึ้นว่าอีเมลซ้ำ
      // ทั้งที่อีเมลไม่ได้ผิดอะไร แก้ยังไงก็ไม่หาย
      if (/app_users_email_key/i.test(msg)) {
        toast.error(`อีเมล ${form.email.trim()} ถูกใช้กับผู้ใช้รายอื่นแล้ว`, {
          description: 'อีเมลต้องไม่ซ้ำกัน เพราะระบบใช้อีเมลจับคู่ผู้ใช้ตอนเข้าระบบ',
          duration: 8000,
        });
        return;
      }
      if (/uq_user_subsidiary/i.test(msg)) {
        toast.error('บริษัทที่ดูแลมีรายการซ้ำ', {
          description: 'ลองกด Save อีกครั้ง — ถ้ายังไม่หาย ให้เอาบริษัทออกทั้งหมดแล้วเลือกใหม่',
          duration: 8000,
        });
        return;
      }
      toast.error(msg, { duration: 8000 });
    },
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={guard.leave}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">User</h1>
          <p className="text-muted text-sm font-medium">{mode === 'new' ? '+ New User' : form.name}</p>
        </div>
        <Button variant="primary" disabled={save.isPending || !canEdit} title={canEdit ? '' : 'ไม่มีสิทธิ์แก้ไข'} onClick={() => { if (checkRequiredFields()) save.mutate(); }}>
          <Save className="w-4 h-4" /> {save.isPending ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <Card>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel required>NAME</FieldLabel>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="ชื่อ-นามสกุล" />
            </div>
            <div>
              <FieldLabel required>EMAIL</FieldLabel>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="name@mgc-asia.com" />
            </div>
            <div>
              <FieldLabel>PERMISSION GROUP</FieldLabel>
              <Select value={form.group_id} onChange={(e) => setForm((f) => ({ ...f, group_id: e.target.value }))}>
                <option value="">— เลือกกลุ่มสิทธิ์ —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>STATUS</FieldLabel>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Form['status'] }))}>
                <option>Active</option>
                <option>Inactive</option>
              </Select>
            </div>
          </div>
          {/* บริษัทที่ดูแล — เก็บที่ผู้ใช้ ไม่ใช่ที่กลุ่มสิทธิ์
              เพราะคนกลุ่มเดียวกันดูแลคนละบริษัทได้ เช่นบัญชีที่สังกัดบริษัทแม่
              แต่รับผิดชอบดูแลบริษัทลูกคนละแห่ง */}
          <div className="mt-6 border-t border-gray-200 pt-5">
            <FieldLabel required>บริษัทที่ดูแล</FieldLabel>
            <p className="mb-3 text-xs text-muted">คลิกเลือก · เลือกได้หลายบริษัท</p>

            <div className="flex flex-wrap gap-2">
              {/* ปุ่มแรกเป็นทางลัดสำหรับคนที่ต้องเห็นทั้งกลุ่ม
                  ใช้ธงแทนการติ๊กทั้ง 16 บริษัท เพราะเปิดบริษัทใหม่แล้วครอบให้เอง */}
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setForm((f) => ({ ...f, all_subsidiaries: !f.all_subsidiaries, subsidiary_ids: [] }))}
                className={
                  'rounded-full border px-3.5 py-1.5 text-xs transition disabled:cursor-not-allowed ' +
                  (form.all_subsidiaries
                    ? 'border-brand bg-brand font-medium text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400')
                }
              >
                ทุกบริษัท
              </button>

              {subOptions.map((s) => {
                const on = form.all_subsidiaries || form.subsidiary_ids.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!canEdit || form.all_subsidiaries}
                    title={s.name}
                    onClick={() => toggleSub(s.id)}
                    className={
                      'rounded-full border px-3.5 py-1.5 text-xs transition disabled:cursor-not-allowed ' +
                      (on
                        ? 'border-brand bg-brand text-white ' + (form.all_subsidiaries ? 'opacity-50' : '')
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400')
                    }
                  >
                    {s.code}
                  </button>
                );
              })}
            </div>

            {!form.all_subsidiaries && form.subsidiary_ids.length === 0 && (
              <p className="mt-2 text-xs text-amber-700">
                ต้องเลือกอย่างน้อยหนึ่งบริษัท หรือกด "ทุกบริษัท"
              </p>
            )}
          </div>

          <p className="text-xs text-muted mt-4 italic">* หน้านี้จัดการผู้ใช้และกลุ่มสิทธิ์ · การยืนยันตัวตนตอนเข้าระบบจะเชื่อมกับระบบขององค์กรในขั้นถัดไป</p>
        </CardContent>
      </Card>
    </div>
  );
}
