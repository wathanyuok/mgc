import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  sidebarCollapsed: boolean;
  themeMode: 'light' | 'dark';
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setThemeMode: (m: 'light' | 'dark') => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      themeMode: 'light',
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setThemeMode: (themeMode) => set({ themeMode }),
    }),
    { name: 'mgc-ui' },
  ),
);
