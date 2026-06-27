'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import { PreloadTabs } from './PreloadTabs';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f9fafb' }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
        {children}
      </main>
      <PreloadTabs />
    </div>
  );
}
