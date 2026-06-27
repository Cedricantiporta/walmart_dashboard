'use client';

import { useState, createContext, useContext } from 'react';
import Sidebar from './Sidebar';
import { PreloadTabs } from './PreloadTabs';

interface SidebarCtxType { collapsed: boolean; onToggle: () => void; }
export const SidebarCtx = createContext<SidebarCtxType>({ collapsed: false, onToggle: () => {} });
export const useSidebar = () => useContext(SidebarCtx);

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarCtx.Provider value={{ collapsed, onToggle: () => setCollapsed(c => !c) }}>
      <div style={{ display: 'flex', minHeight: '100vh', background: '#f4f4f5' }}>
        <Sidebar collapsed={collapsed} />
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
          {children}
        </main>
        <PreloadTabs />
      </div>
    </SidebarCtx.Provider>
  );
}
