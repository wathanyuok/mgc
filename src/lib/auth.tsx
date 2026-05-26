import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';

export type PermAction = 'view' | 'edit' | 'approve';

export function AuthProvider({ children }: { children: ReactNode }) {
  const init = useAuthStore((s) => s._init);
  useEffect(() => init(), [init]);
  return <>{children}</>;
}

export function useAuth() {
  return useAuthStore((s) => ({
    loading: s.loading,
    authed: s.authed,
    session: s.session,
    user: s.user,
    group: s.group,
    isAdmin: s.isAdmin,
    provisioned: s.provisioned,
    can: s.can,
    devSignIn: s.devSignIn,
    signOut: s.signOut,
    refresh: s.refresh,
  }));
}

export function useCurrentUserLabel(): string {
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  return user?.name || user?.email || session?.user?.email || 'system';
}
