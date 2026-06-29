'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import logoSrc from './WFS_Logo.png';
import { supabase } from '@/lib/supabase';
import { clientGet } from '@/lib/client-cache';
import { useSidebar } from './DashboardShell';

type USrc = 'Billing' | 'Invoices';
type UResult = { source: USrc; label: string; detail: string; term: string };
type UCacheB = { clients: Array<{ clientName: string; cases?: Array<{ caseId: string; amount: number }> }> };
type UCacheI = Array<{ invoice_number: string; client_name: string; total_reimbursed: number; billed_fee: number; case_ids?: string[]; case_snapshot?: Array<{ case_id: string }> }>;

function matchUAmt(q: string, amount: number): boolean {
  const s = q.replace(/[$,]/g, '').trim();
  if (!s || !/^\d/.test(s)) return false;
  return Math.floor(Math.abs(amount)).toString().startsWith(s.split('.')[0]);
}

function getUniversalResults(q: string): UResult[] {
  if (!q || q.trim().length < 2) return [];
  const ql = q.toLowerCase().trim();
  const out: UResult[] = [];
  const seen = new Set<string>();
  const fmtU = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

  const billing = clientGet<UCacheB>('billing');
  if (billing?.clients) {
    for (const c of billing.clients) {
      if (c.clientName.toLowerCase().includes(ql) && !seen.has(`b:c:${c.clientName}`)) {
        seen.add(`b:c:${c.clientName}`);
        out.push({ source: 'Billing', label: c.clientName, detail: '', term: c.clientName });
      }
      for (const cs of (c.cases ?? [])) {
        if (cs.caseId.toLowerCase().includes(ql) && !seen.has(`b:id:${cs.caseId}`)) {
          seen.add(`b:id:${cs.caseId}`);
          out.push({ source: 'Billing', label: cs.caseId, detail: c.clientName, term: cs.caseId });
        }
        if (matchUAmt(q, cs.amount) && !seen.has(`b:a:${c.clientName}`)) {
          seen.add(`b:a:${c.clientName}`);
          out.push({ source: 'Billing', label: fmtU(cs.amount), detail: c.clientName, term: c.clientName });
        }
      }
    }
  }

  const invs = clientGet<UCacheI>('invoices');
  if (Array.isArray(invs)) {
    for (const inv of invs) {
      if (inv.client_name?.toLowerCase().includes(ql) && !seen.has(`i:c:${inv.client_name}`)) {
        seen.add(`i:c:${inv.client_name}`);
        out.push({ source: 'Invoices', label: inv.client_name, detail: '', term: inv.client_name });
      }
      if (inv.invoice_number?.toLowerCase().includes(ql) && !seen.has(`i:n:${inv.invoice_number}`)) {
        seen.add(`i:n:${inv.invoice_number}`);
        out.push({ source: 'Invoices', label: inv.invoice_number, detail: inv.client_name, term: inv.invoice_number });
      }
      const ids = [...new Set([...(inv.case_ids ?? []), ...(inv.case_snapshot ?? []).map(c => c.case_id)])];
      for (const id of ids) {
        if (id.toLowerCase().includes(ql) && !seen.has(`i:id:${id}`)) {
          seen.add(`i:id:${id}`);
          out.push({ source: 'Invoices', label: id, detail: inv.client_name, term: id });
        }
      }
      if ((matchUAmt(q, inv.total_reimbursed) || matchUAmt(q, inv.billed_fee)) && !seen.has(`i:a:${inv.invoice_number}`)) {
        seen.add(`i:a:${inv.invoice_number}`);
        out.push({ source: 'Invoices', label: fmtU(inv.total_reimbursed), detail: inv.client_name, term: inv.invoice_number });
      }
    }
  }

  return out.slice(0, 10);
}

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

const SyncIcon = ({ spinning }: { spinning?: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ animation: spinning ? 'spin 1s linear infinite' : 'none' }}>
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const SunIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

export default function Sidebar({ collapsed, syncTime, darkMode, onThemeToggle, isMobile, mobileOpen, onMobileClose }: {
  collapsed: boolean;
  syncTime?: string;
  darkMode?: boolean;
  onThemeToggle?: () => void;
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { setSyncTime } = useSidebar();

  const [uq, setUq] = useState('');
  const [uResults, setUResults] = useState<UResult[]>([]);
  const [showU, setShowU] = useState(false);
  const uRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!uq.trim()) { setUResults([]); setShowU(false); return; }
    const r = getUniversalResults(uq);
    setUResults(r);
    setShowU(r.length > 0);
  }, [uq]);

  useEffect(() => {
    if (!showU) return;
    function h(e: MouseEvent) {
      if (uRef.current && !uRef.current.contains(e.target as Node)) setShowU(false);
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showU]);

  function handleUClick(r: UResult) {
    const path = r.source === 'Billing'
      ? `/dashboard/billing?q=${encodeURIComponent(r.term)}`
      : `/dashboard/invoices?q=${encodeURIComponent(r.term)}`;
    setShowU(false);
    setUq('');
    router.push(path);
  }

  useEffect(() => {
    if (pathname.startsWith('/dashboard')) localStorage.setItem('wfs_last_page', pathname);
    if (isMobile && onMobileClose) onMobileClose();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const u = session.user;
        const name = u.user_metadata?.full_name ?? u.user_metadata?.name ?? u.email?.split('@')[0] ?? 'User';
        setUser({ name, email: u.email ?? '' });
      }
    });
  }, []);

  const syncLabel = syncTime
    ? (() => {
        const d = new Date(syncTime);
        const isToday = d.toDateString() === new Date().toDateString();
        const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return isToday ? `Today ${time}` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + time;
      })()
    : null;

  async function handleSync() {
    setSyncing(true);
    await fetch('/api/cache-clear', { method: 'POST' }).catch(() => {});
    setTimeout(() => { setSyncing(false); window.location.reload(); }, 600);
  }

  const initial = (user?.name?.charAt(0) ?? 'A').toUpperCase();

  // Theme tokens
  const bg      = darkMode ? '#1a1a1b' : '#f4f4f5';
  const border  = darkMode ? '#27272a' : '#e4e4e7';
  const txt     = darkMode ? '#f4f4f5' : '#11181c';
  const muted   = darkMode ? '#71717a' : '#71717a';
  const pill    = darkMode ? '#27272a' : '#eaebec';
  const pillHov = darkMode ? '#3f3f46' : '#dcdcdd';

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .sidebar-nav-link { transition: background 0.12s, color 0.12s; }
        .sidebar-nav-link:hover:not(.active) { background: ${darkMode ? pillHov : '#eaebec'} !important; }
      `}</style>

      <aside style={isMobile ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: 210,
        height: '100vh',
        zIndex: 200,
        background: bg,
        borderRight: `1px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: mobileOpen ? '4px 0 32px rgba(0,0,0,0.18)' : 'none',
      } : {
        width: collapsed ? 56 : 210,
        transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1)',
        height: '100vh',
        background: bg,
        borderRight: `1px solid ${border}`,
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        flexShrink: 0,
        overflow: 'hidden',
      }}>

        {/* Brand */}
        <div style={{
          padding: collapsed ? '18px 0 10px' : '18px 10px 10px',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: collapsed ? 'center' : 'flex-start',
          minHeight: 56,
          gap: 8,
        }}>
          <Image src={logoSrc} alt="WFS" width={32} height={32} style={{ borderRadius: 6, flexShrink: 0, objectFit: 'contain', marginBottom: 4 }} />
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: txt, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>WFS Analytics</div>
              <div style={{ fontSize: 12, color: muted, fontWeight: 400, whiteSpace: 'nowrap' }}>Dashboard</div>
            </div>
          )}
        </div>

        {/* Universal search */}
        {!collapsed && (
          <div ref={uRef} style={{ padding: '0 8px 6px', flexShrink: 0, position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <input
                value={uq}
                onChange={e => setUq(e.target.value)}
                onFocus={() => uq.trim() && setShowU(uResults.length > 0)}
                placeholder="Search anything…"
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 10px 6px 28px', borderRadius: 8, border: `1px solid ${border}`, background: pill, color: txt, outline: 'none', fontFamily: 'inherit' }}
              />
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            {showU && uResults.length > 0 && (
              <div style={{ position: 'absolute', left: 8, right: 8, top: '100%', marginTop: 4, background: darkMode ? '#27272a' : '#fff', border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 999 }}>
                {(['Billing', 'Invoices'] as const).map(src => {
                  const grp = uResults.filter(r => r.source === src);
                  if (!grp.length) return null;
                  return (
                    <div key={src}>
                      <div style={{ padding: '5px 10px 2px', fontSize: 10, fontWeight: 700, color: muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{src}</div>
                      {grp.map((r, i) => (
                        <button key={i} onClick={() => handleUClick(r)} style={{ width: '100%', textAlign: 'left', padding: '5px 10px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: txt }}>
                          <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                          {r.detail && <span style={{ fontSize: 11, color: muted, flexShrink: 0, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</span>}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Nav */}
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
                  color: txt,
                  background: isActive ? pill : 'transparent',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                <span style={{ color: isActive ? txt : muted, flexShrink: 0, lineHeight: 1, display: 'flex' }}>{icon}</span>
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        {!collapsed ? (
          <div style={{ padding: '10px 12px 14px', flexShrink: 0 }}>

            {/* Sync row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: muted, fontWeight: 500, letterSpacing: '0.02em' }}>Last synced</div>
                <div style={{ fontSize: 11, color: muted, marginTop: 1 }}>{syncLabel ?? '—'}</div>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                title={syncing ? 'Syncing…' : 'Sync'}
                style={{ width: 28, height: 28, borderRadius: '50%', border: `1px solid ${border}`, background: pill, cursor: syncing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: txt, flexShrink: 0, outline: 'none', opacity: syncing ? 0.6 : 1 }}
              >
                <SyncIcon spinning={syncing} />
              </button>
            </div>

            {/* User + theme row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #006FEE 0%, #7828C8 100%)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name ?? 'Admin'}</div>
                <div style={{ fontSize: 10, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email ?? ''}</div>
              </div>
              <button
                onClick={onThemeToggle}
                title={darkMode ? 'Light mode' : 'Dark mode'}
                style={{ width: 28, height: 28, borderRadius: '50%', border: `1px solid ${border}`, background: pill, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: muted, flexShrink: 0, outline: 'none' }}
              >
                {darkMode ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>

          </div>
        ) : (
          <div style={{ padding: '10px 0 14px', flexShrink: 0, borderTop: `1px solid ${border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <button onClick={handleSync} disabled={syncing} title="Sync" style={{ width: 32, height: 32, borderRadius: '50%', border: `1px solid ${border}`, background: pill, cursor: syncing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: txt, outline: 'none', opacity: syncing ? 0.6 : 1 }}>
              <SyncIcon spinning={syncing} />
            </button>
            <button onClick={onThemeToggle} title={darkMode ? 'Light mode' : 'Dark mode'} style={{ width: 32, height: 32, borderRadius: '50%', border: `1px solid ${border}`, background: pill, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: muted, outline: 'none' }}>
              {darkMode ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        )}

      </aside>
    </>
  );
}
