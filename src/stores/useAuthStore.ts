import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AppUser, PermissionGroup } from '@/types/database';

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
  can: (menuKey: string, action?: PermAction) => boolean;
  devSignIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  _init: () => () => void;
}

async function loadProfile(
  email: string | null,
  authUserId: string | null,
): Promise<Pick<AuthState, 'user' | 'group' | 'perms'>> {
  if (!email) return { user: null, group: null, perms: {} };
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
  if (!au?.group_id) return { user: au, group: null, perms: {} };
  const [{ data: g }, { data: gp }] = await Promise.all([
    supabase.from('permission_groups').select('*').eq('id', au.group_id).maybeSingle(),
    supabase.from('group_permissions').select('*').eq('group_id', au.group_id),
  ]);
  const perms: PermMap = {};
  for (const r of (gp ?? []) as any[]) perms[r.menu_key] = { view: r.can_view, edit: r.can_edit, approve: r.can_approve };
  return { user: au, group: (g as PermissionGroup) ?? null, perms };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  loading: true,
  authed: false,
  session: null,
  user: null,
  group: null,
  perms: {},
  isAdmin: false,
  provisioned: false,

  can: (menuKey, action = 'view') => {
    const { isAdmin, provisioned, perms } = get();
    if (isAdmin) return true;
    if (!provisioned) return false;
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
  },

  signOut: async () => {
    localStorage.removeItem(DEV_KEY);
    set({ user: null, group: null, perms: {}, authed: false, isAdmin: false, provisioned: false, session: null });
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
