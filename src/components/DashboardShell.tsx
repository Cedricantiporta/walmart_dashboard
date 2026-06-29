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
  isMobile: boolean;
}

export const SidebarCtx = createContext<SidebarCtxType>({
  collapsed: false,
  onToggle: () => {},
  syncTime: '',
  setSyncTime: () => {},
  darkMode: false,
  setDarkMode: () => {},
  isMobile: false,
});

export const useSidebar = () => useContext(SidebarCtx);

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [syncTime, setSyncTimeState] = useState('');
  const [darkMode, setDarkModeState] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const savedSync = localStorage.getItem('wfs_last_sync_time');
    if (savedSync) setSyncTimeState(savedSync);
    const savedDark = localStorage.getItem('darkMode');
    if (savedDark === '1') setDarkModeState(true);
    const savedCollapsed = localStorage.getItem('sidebar_collapsed');
    if (savedCollapsed === '1') setCollapsed(true);
  }, []);

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setMobileOpen(false);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
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

  function onToggle() {
    if (isMobile) {
      setMobileOpen(m => !m);
    } else {
      setCollapsed(c => {
        const next = !c;
        localStorage.setItem('sidebar_collapsed', next ? '1' : '0');
        return next;
      });
    }
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  return (
    <SidebarCtx.Provider value={{ collapsed, onToggle, syncTime, setSyncTime, darkMode, setDarkMode, isMobile }}>
      <div style={{ display: 'flex', minHeight: '100vh', background: darkMode ? '#050606' : '#f4f4f5' }}>
        {/* Mobile backdrop */}
        {isMobile && mobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 199, touchAction: 'none' }}
          />
        )}
        <Sidebar
          collapsed={collapsed}
          syncTime={syncTime}
          darkMode={darkMode}
          onThemeToggle={() => setDarkMode(!darkMode)}
          isMobile={isMobile}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
          {children}
        </main>
        <PreloadTabs />
      </div>
    </SidebarCtx.Provider>
  );
}
