'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import { PreloadTabs } from './PreloadTabs';

function PanelIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="16" height="16" rx="3"/>
      <line x1="7" y1="2" x2="7" y2="18"/>
    </svg>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarW = collapsed ? 64 : 220;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f4f4f5' }}>
      <Sidebar collapsed={collapsed} />

      {/* Sidebar toggle — straddles sidebar/content border */}
      <button
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{
          position: 'fixed',
          top: 22,
          left: sidebarW - 14,
          zIndex: 60,
          transition: 'left 0.2s cubic-bezier(0.4,0,0.2,1)',
          width: 28,
          height: 28,
          border: '1px solid #e4e4e7',
          borderRadius: 8,
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#71717a',
          boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
          outline: 'none',
        }}
      >
        <PanelIcon />
      </button>

      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
        {children}
      </main>
      <PreloadTabs />
    </div>
  );
}
