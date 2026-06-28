'use client';

import { useState, useEffect, createContext, useContext } from 'react';
import Sidebar from './Sidebar';
import { PreloadTabs } from './PreloadTabs';

interface SidebarCtxType {
  collapsed: boolean;
  onToggle: () => void;
  syncTime: string;
  setSyncTime: (t: string) => void;
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
}

export const SidebarCtx = createContext<SidebarCtxType>({
  collapsed: false,
  onToggle: () => {},
  syncTime: '',
  setSyncTime: () => {},
  darkMode: false,
  setDarkMode: () => {},
});

export const useSidebar = () => useContext(SidebarCtx);

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [syncTime, setSyncTimeState] = useState('');
  const [darkMode, setDarkModeState] = useState(false);

  useEffect(() => {
    const savedSync = localStorage.getItem('wfs_last_sync_time');
    if (savedSync) setSyncTimeState(savedSync);
    const savedDark = localStorage.getItem('darkMode');
    if (savedDark === '1') setDarkModeState(true);
  }, []);

  function setSyncTime(t: string) {
    setSyncTimeState(t);
    if (t) localStorage.setItem('wfs_last_sync_time', t);
  }

  function setDarkMode(v: boolean) {
    setDarkModeState(v);
    localStorage.setItem('darkMode', v ? '1' : '0');
    document.documentElement.setAttribute('data-theme', v ? 'dark' : 'light');
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  return (
    <SidebarCtx.Provider value={{ collapsed, onToggle: () => setCollapsed(c => !c), syncTime, setSyncTime, darkMode, setDarkMode }}>
      <div style={{ display: 'flex', minHeight: '100vh', background: darkMode ? '#18181b' : '#f4f4f5' }}>
        <Sidebar collapsed={collapsed} syncTime={syncTime} darkMode={darkMode} onThemeToggle={() => setDarkMode(!darkMode)} />
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
          {children}
        </main>
        <PreloadTabs />
      </div>
    </SidebarCtx.Provider>
  );
}
