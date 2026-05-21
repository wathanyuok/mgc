import { Outlet, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { Bell, LogOut, Eye } from 'lucide-react';
import { getAllNotifications } from '@/lib/notifications';
import { useAuth } from '@/lib/auth';
import { ReadOnlyContext } from '@/lib/readonly';

export function AppLayout() {
  const { user, group, session, isAdmin, signOut } = useAuth();
  const [searchParams] = useSearchParams();
  const viewMode = searchParams.get('view') === '1';
  const displayName = user?.name || session?.user?.email || 'User';
  const roleLabel = isAdmin ? 'Admin' : group?.name ?? (user ? 'ยังไม่กำหนดกลุ่ม' : 'ยังไม่ provision');
  const initial = (displayName[0] ?? 'U').toUpperCase();

  const { data: notis = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => getAllNotifications(30),
    refetchInterval: 5 * 60 * 1000,
  });
  const count = notis.length;
  const urgent = notis.filter((n) => n.severity === 'overdue').length;

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-line flex items-center justify-between px-6">
          <div className="text-sm text-muted">YIP Consulting × MGC-Asia</div>
          <div className="flex items-center gap-4">
            <Link to="/notifications" className="relative text-muted hover:text-ink" aria-label="Notifications" title={`${count} แจ้งเตือน${urgent ? ` · ${urgent} เกินกำหนด` : ''}`}>
              <Bell className="w-5 h-5" />
              {count > 0 && (
                <span className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${urgent > 0 ? 'bg-danger' : 'bg-brand'}`}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </Link>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center font-semibold">
                {initial}
              </div>
              <div className="leading-tight">
                <div className="font-medium">{displayName}</div>
                <div className="text-[11px] text-muted">{roleLabel}</div>
              </div>
              <button onClick={() => signOut()} className="ml-1 text-muted hover:text-danger" title="ออกจากระบบ" aria-label="Logout">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          {viewMode && (
            <div className="max-w-[1400px] mx-auto mb-3 flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
              <Eye className="w-4 h-4" />
              โหมดดูอย่างเดียว (View) — แก้ไขไม่ได้
            </div>
          )}
          <ReadOnlyContext.Provider value={viewMode}>
            <Outlet />
          </ReadOnlyContext.Provider>
        </main>
      </div>
    </div>
  );
}
