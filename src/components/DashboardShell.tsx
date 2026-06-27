'use client';

import { useState, createContext, useContext } from 'react';
import Sidebar from './Sidebar';
import { PreloadTabs } from './PreloadTabs';

interface SidebarCtxType {
  collapsed: boolean;
  onToggle: () => void;
  syncTime: string;
  setSyncTime: (t: string) => void;
}

export const SidebarCtx = createContext<SidebarCtxType>({
  collapsed: false,
  onToggle: () => {},
  syncTime: '',
  setSyncTime: () => {},
});

export const useSidebar = () => useContext(SidebarCtx);

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [syncTime, setSyncTime] = useState('');

  return (
    <SidebarCtx.Provider value={{ collapsed, onToggle: () => setCollapsed(c => !c), syncTime, setSyncTime }}>
      <div style={{ display: 'flex', minHeight: '100vh', background: '#f4f4f5' }}>
        <Sidebar collapsed={collapsed} syncTime={syncTime} />
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
          {children}
        </main>
        <PreloadTabs />
      </div>
    </SidebarCtx.Provider>
  );
}
