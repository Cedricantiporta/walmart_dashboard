'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  )},
  { href: '/dashboard/billing', label: 'Billing', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  )},
  { href: '/dashboard/invoices', label: 'Invoices', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )},
  { href: '/dashboard/summary', label: 'Summary', icon: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  )},
];

export default function Sidebar({ collapsed, syncTime }: { collapsed: boolean; syncTime?: string }) {
  const pathname = usePathname();

  const syncLabel = syncTime
    ? new Date(syncTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <>
      <style>{`
        .sidebar-nav-link { transition: background 0.12s, color 0.12s; }
        .sidebar-nav-link:hover:not(.active) { background: #e4e4e7 !important; }
      `}</style>

      <aside style={{
        width: collapsed ? 56 : 210,
        transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1)',
        height: '100vh',
        background: '#f4f4f5',
        borderRight: '1px solid #e4e4e7',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        flexShrink: 0,
        overflow: 'hidden',
      }}>

        {/* Brand / user section */}
        <div style={{
          padding: collapsed ? '14px 0' : '14px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          minHeight: 68,
          gap: 8,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'linear-gradient(135deg, #006FEE 0%, #7828C8 100%)',
            flexShrink: 0,
          }} />
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#11181c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>WFS Analytics</div>
              <div style={{ fontSize: 12, color: '#71717a', fontWeight: 400, whiteSpace: 'nowrap' }}>Admin</div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '4px 6px', overflowY: 'auto', overflowX: 'hidden' }}>
          {NAV.map(({ href, label, icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`sidebar-nav-link${isActive ? ' active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: collapsed ? '9px 0' : '9px 11px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 999,
                  marginBottom: 2,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#11181c' : '#71717a',
                  background: isActive ? '#e4e4e7' : 'transparent',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                <span style={{ color: isActive ? '#11181c' : '#71717a', flexShrink: 0, lineHeight: 1, display: 'flex' }}>{icon}</span>
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div style={{ padding: '10px 14px', flexShrink: 0, borderTop: '1px solid #e4e4e7' }}>
            <div style={{ fontSize: 12, color: '#a1a1aa', fontWeight: 400 }}>WFS Billing v1.0</div>
            {syncLabel && (
              <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 3 }}>Synced {syncLabel}</div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
