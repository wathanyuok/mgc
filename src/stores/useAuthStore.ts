import { create } from 'zustand';
import { type SubsidiaryScope, EMPTY_SCOPE } from '@/lib/subsidiary-scope';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AppUser, PermissionGroup } from '@/types/database';

import { logAudit } from '@/lib/audit-trail';
const DEV_KEY = 'mgc_dev_user';

export type PermAction = 'view' | 'edit' | 'approve';
type PermMap = Record<string, { view: boolean; edit: boolean; approve: boolean }>;

interface AuthState {
  loading: boolean;
  authed: boolean;
  session: Session | null;
  user: AppUser | null;
  group: PermissionGroup | null;
  perms: PermMap;
  isAdmin: boolean;
  provisioned: boolean;
  /** บริษัทที่ผู้ใช้คนนี้ดูแล — ใช้กรองว่าเห็นข้อมูลของใครได้บ้าง */
  scope: SubsidiaryScope;
  can: (menuKey: string, action?: PermAction) => boolean;
  devSignIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  _init: () => () => void;
}

/**
 * บริษัทที่ผู้ใช้ดูแล
 *
 * ติ๊ก "ดูแลทุกบริษัท" แล้วไม่ต้องอ่านตารางรายบริษัท — เปิดบริษัทใหม่ก็ครอบให้เอง
 * ผู้ดูแลระบบเห็นทุกบริษัทเสมอ ตามที่ตกลงไว้เรื่องสิทธิ์
 */
async function loadScope(au: AppUser): Promise<SubsidiaryScope> {
  if ((au as any).all_subsidiaries) return { all: true, codes: [] };
  const { data } = await supabase
    .from('app_user_subsidiaries')
    .select('subsidiaries(code)')
    .eq('user_id', au.id);
  const codes = ((data ?? []) as any[])
    .map((r) => r.subsidiaries?.code as string | undefined)
    .filter((c): c is string => !!c);
  return { all: false, codes };
}

async function loadProfile(
  email: string | null,
  authUserId: string | null,
): Promise<Pick<AuthState, 'user' | 'group' | 'perms' | 'scope'>> {
  if (!email) return { user: null, group: null, perms: {}, scope: EMPTY_SCOPE };
  let au: AppUser | null = null;
  const { data: found } = await supabase.from('app_users').select('*').eq('email', email).maybeSingle();
  au = (found as AppUser) ?? null;
  if (!au) {
    const { count } = await supabase.from('app_users').select('id', { count: 'exact', head: true });
    if ((count ?? 0) === 0) {
      const { data: adminGrp } = await supabase.from('permission_groups').select('id').eq('is_admin', true).limit(1).maybeSingle();
      const { data: created } = await supabase
        .from('app_users')
        .insert({ name: email.split('@')[0], email, group_id: (adminGrp as any)?.id ?? null, status: 'Active', auth_user_id: authUserId })
        .select().single();
      au = (created as AppUser) ?? null;
    }
  }
  if (!au) return { user: null, group: null, perms: {}, scope: EMPTY_SCOPE };
  const scope = await loadScope(au);
  if (!au.group_id) return { user: au, group: null, perms: {}, scope };
  const [{ data: g }, { data: gp }] = await Promise.all([
    supabase.from('permission_groups').select('*').eq('id', au.group_id).maybeSingle(),
    supabase.from('group_permissions').select('*').eq('group_id', au.group_id),
  ]);
  const perms: PermMap = {};
  for (const r of (gp ?? []) as any[]) perms[r.menu_key] = { view: r.can_view, edit: r.can_edit, approve: r.can_approve };
  const grp = (g as PermissionGroup) ?? null;
  // ผู้ดูแลระบบเห็นทุกบริษัทเสมอ ไม่ต้องไปตั้งค่าให้ทีละคน
  return { user: au, group: grp, perms, scope: grp?.is_admin ? { all: true, codes: [] } : scope };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  loading: true,
  authed: false,
  session: null,
  user: null,
  group: null,
  perms: {},
  isAdmin: false,
  scope: EMPTY_SCOPE,
  provisioned: false,

  can: (menuKey, action = 'view') => {
    const { isAdmin, provisioned, perms } = get();
    // ต้องเช็คสถานะก่อนเสมอ — เดิมเช็คว่าเป็นผู้ดูแลระบบก่อน ทำให้ผู้ใช้ที่ถูกปิดใช้งาน
    // แต่อยู่ในกลุ่มผู้ดูแลระบบ ยังเข้าได้ทุกเมนูเต็มสิทธิ์ · การปิดใช้งานจึงไม่มีผลกับคนที่มีสิทธิ์สูงสุด
    if (!provisioned) return false;
    if (isAdmin) return true;
    return !!perms[menuKey]?.[action];
  },

  devSignIn: async (email) => {
    localStorage.setItem(DEV_KEY, email);
    const profile = await loadProfile(email, null);
    set({
      ...profile,
      authed: true,
      isAdmin: !!profile.group?.is_admin,
      provisioned: !!profile.user && profile.user.status === 'Active',
    });
    // บันทึกการเข้าระบบลงประวัติการใช้งาน
    // ไม่ใส่ชื่อคนในช่องรายการ เพราะซ้ำกับคอลัมน์ผู้ใช้อยู่แล้ว — ช่องรายการมีไว้บอกว่าไปทำอะไรกับรายการไหน
    void logAudit({ action: 'login', table: 'auth', summary: 'เข้าสู่ระบบ' });
  },

  signOut: async () => {
    const who = get().user?.name || get().user?.email || localStorage.getItem(DEV_KEY) || 'system';
    void who;   // ชื่อผู้ทำถูกบันทึกในคอลัมน์ผู้ใช้อยู่แล้ว
    await logAudit({ action: 'logout', table: 'auth', summary: 'ออกจากระบบ' });
    localStorage.removeItem(DEV_KEY);
    set({ user: null, group: null, perms: {}, scope: EMPTY_SCOPE, authed: false, isAdmin: false, provisioned: false, session: null });
    await supabase.auth.signOut();
  },

  refresh: async () => {
    const { data } = await supabase.auth.getSession();
    const email = data.session?.user?.email ?? localStorage.getItem(DEV_KEY);
    const profile = await loadProfile(email ?? null, data.session?.user?.id ?? null);
    set({
      ...profile,
      session: data.session,
      authed: !!data.session || !!localStorage.getItem(DEV_KEY),
      isAdmin: !!profile.group?.is_admin,
      provisioned: !!profile.user && profile.user.status === 'Active',
    });
  },

  _init: () => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const email = data.session?.user?.email ?? localStorage.getItem(DEV_KEY);
      const profile = await loadProfile(email ?? null, data.session?.user?.id ?? null);
      set({
        ...profile,
        session: data.session,
        authed: !!data.session || !!localStorage.getItem(DEV_KEY),
        isAdmin: !!profile.group?.is_admin,
        provisioned: !!profile.user && profile.user.status === 'Active',
        loading: false,
      });
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, sess) => {
      const email = sess?.user?.email ?? localStorage.getItem(DEV_KEY);
      const profile = await loadProfile(email ?? null, sess?.user?.id ?? null);
      set({
        ...profile,
        session: sess,
        authed: !!sess || !!localStorage.getItem(DEV_KEY),
        isAdmin: !!profile.group?.is_admin,
        provisioned: !!profile.user && profile.user.status === 'Active',
      });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  },
}));
