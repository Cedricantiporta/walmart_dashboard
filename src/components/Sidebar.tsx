'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  )},
  { href: '/dashboard/billing', label: 'Billing', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  )},
  { href: '/dashboard/invoices', label: 'Invoices', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )},
  { href: '/dashboard/summary', label: 'Summary', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  )},
];

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();

  return (
    <aside style={{
      width: collapsed ? 64 : 220,
      transition: 'width 0.18s ease',
      height: '100vh',
      background: '#fff',
      borderRight: '1px solid #e5e7eb',
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 0,
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {/* Logo + toggle */}
      <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 8, minHeight: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: collapsed ? 0 : 1 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v5"/><path d="M12 17v5"/>
              <path d="M20.5 6.5l-4.5 2.5"/><path d="M8 15l-4.5 2.5"/>
              <path d="M20.5 17.5l-4.5-2.5"/><path d="M8 9L3.5 6.5"/>
            </svg>
          </div>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', lineHeight: 1.2, whiteSpace: 'nowrap' }}>WFS Analytics</div>
              <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap' }}>Dashboard</div>
            </div>
          )}
        </div>
        <button
          onClick={onToggle}
          style={{ border: 'none', background: '#f3f4f6', cursor: 'pointer', padding: '5px 6px', borderRadius: 6, color: '#6b7280', display: 'flex', alignItems: 'center', flexShrink: 0, lineHeight: 1 }}
        >
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
        </button>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px' }}>
        {NAV.map(({ href, label, icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: collapsed ? '9px 0' : '9px 10px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: 8,
                marginBottom: 2,
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#2563eb' : '#374151',
                background: isActive ? '#eff6ff' : 'transparent',
                textDecoration: 'none',
                transition: 'background 0.1s, color 0.1s',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
            >
              <span style={{ color: isActive ? '#2563eb' : '#9ca3af', flexShrink: 0 }}>{icon}</span>
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, whiteSpace: 'nowrap' }}>WFS Billing v1.0</div>
        </div>
      )}
    </aside>
  );
}
