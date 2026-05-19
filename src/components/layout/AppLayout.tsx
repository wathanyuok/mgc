import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Bell, User } from 'lucide-react';

export function AppLayout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-line flex items-center justify-between px-6">
          <div className="text-sm text-muted">YIP Consulting × MGC-Asia</div>
          <div className="flex items-center gap-4">
            <button className="text-muted hover:text-ink" aria-label="Notifications">
              <Bell className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center font-semibold">
                N
              </div>
              <span>Nuii</span>
              <User className="w-4 h-4 text-muted" />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
