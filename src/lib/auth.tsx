// Auth + RBAC context. Tracks Supabase session → matches an app_users row by
// email → loads the user's permission group + per-menu permissions. Exposes
// `can(menuKey, action)` for gating UI. First-ever login bootstraps as Admin.
// ⚠️ DEV MODE: AD is not connected yet, so login accepts ANY password and just
// signs in by email (stored locally). The real AD path (Edge Function `ad-login`
// + verifyOtp) is kept for later — swap Login.tsx back when AD is wired.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AppUser, PermissionGroup } from '@/types/database';

const DEV_KEY = 'mgc_dev_user';

export type PermAction = 'view' | 'edit' | 'approve';
type PermMap = Record<string, { view: boolean; edit: boolean; approve: boolean }>;

interface AuthState {
  loading: boolean;
  authed: boolean; // logged in (real session OR dev email)
  session: Session | null;
  user: AppUser | null;
  group: PermissionGroup | null;
  isAdmin: boolean;
  provisioned: boolean; // authed AND has an Active app_users record
  can: (menuKey: string, action?: PermAction) => boolean;
  devSignIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [devEmail, setDevEmail] = useState<string | null>(() => localStorage.getItem(DEV_KEY));
  const [user, setUser] = useState<AppUser | null>(null);
  const [group, setGroup] = useState<PermissionGroup | null>(null);
  const [perms, setPerms] = useState<PermMap>({});

  // Resolve the app_user (+ group + permissions) for an email. Bootstraps the
  // very first user as Admin so the system is usable from a clean database.
  const loadProfile = async (email: string | null, authUserId?: string | null) => {
    if (!email) { setUser(null); setGroup(null); setPerms({}); return; }
    let au: AppUser | null = null;
    const { data: found } = await supabase.from('app_users').select('*').eq('email', email).maybeSingle();
    au = (found as AppUser) ?? null;

    if (!au) {
      const { count } = await supabase.from('app_users').select('id', { count: 'exact', head: true });
      if ((count ?? 0) === 0) {
        const { data: adminGrp } = await supabase.from('permission_groups').select('id').eq('is_admin', true).limit(1).maybeSingle();
        const { data: created } = await supabase
          .from('app_users')
          .insert({ name: email.split('@')[0], email, group_id: (adminGrp as any)?.id ?? null, status: 'Active', auth_user_id: authUserId ?? null })
          .select().single();
        au = (created as AppUser) ?? null;
      }
    }
    setUser(au);

    if (au?.group_id) {
      const [{ data: g }, { data: gp }] = await Promise.all([
        supabase.from('permission_groups').select('*').eq('id', au.group_id).maybeSingle(),
        supabase.from('group_permissions').select('*').eq('group_id', au.group_id),
      ]);
      setGroup((g as PermissionGroup) ?? null);
      const map: PermMap = {};
      for (const r of (gp ?? []) as any[]) map[r.menu_key] = { view: r.can_view, edit: r.can_edit, approve: r.can_approve };
      setPerms(map);
    } else {
      setGroup(null); setPerms({});
    }
  };

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      const email = data.session?.user?.email ?? localStorage.getItem(DEV_KEY);
      await loadProfile(email ?? null, data.session?.user?.id ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, sess) => {
      setSession(sess);
      const email = sess?.user?.email ?? localStorage.getItem(DEV_KEY);
      await loadProfile(email ?? null, sess?.user?.id ?? null);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const authed = !!session || !!devEmail;
  const isAdmin = !!group?.is_admin;
  const provisioned = !!user && user.status === 'Active';
  const can = (menuKey: string, action: PermAction = 'view') => {
    if (isAdmin) return true;
    if (!provisioned) return false;
    return !!perms[menuKey]?.[action];
  };

  // DEV: sign in by email only (password ignored — AD not wired yet).
  const devSignIn = async (email: string) => {
    localStorage.setItem(DEV_KEY, email);
    setDevEmail(email);
    await loadProfile(email, null);
  };

  const signOut = async () => {
    localStorage.removeItem(DEV_KEY);
    setDevEmail(null);
    setUser(null); setGroup(null); setPerms({});
    await supabase.auth.signOut();
  };
  const refresh = async () => {
    const { data } = await supabase.auth.getSession();
    const email = data.session?.user?.email ?? localStorage.getItem(DEV_KEY);
    await loadProfile(email ?? null, data.session?.user?.id ?? null);
  };

  return (
    <Ctx.Provider value={{ loading, authed, session, user, group, isAdmin, provisioned, can, devSignIn, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within <AuthProvider>');
  return c;
}

/** Convenience: the label to stamp into created_by / updated_by. */
export function useCurrentUserLabel(): string {
  const { user, session } = useAuth();
  return user?.name || user?.email || session?.user?.email || 'system';
}
