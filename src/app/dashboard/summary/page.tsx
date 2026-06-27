'use client';

import { useState, useEffect } from 'react';
import type { MonthlyHistory } from '@/types';
import { clientGet, clientSet } from '@/lib/client-cache';
import { useSidebar } from '@/components/DashboardShell';

const fmtFull = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

function Skeleton({ h = 20, w = '100%', radius = 6 }: { h?: number; w?: string | number; radius?: number }) {
  return (
    <div style={{ height: h, width: w, borderRadius: radius, background: 'linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
  );
}

const PanelIcon = () => <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="16" height="16" rx="3"/><line x1="7" y1="2" x2="7" y2="18"/></svg>;

function ColHdr({ label, col, sortCol, sortDir, onSort, align = 'left' }: {
  label: string; col: string; sortCol: string; sortDir: 'asc'|'desc';
  onSort: (c: string) => void; align?: 'left'|'right';
}) {
  const active = sortCol === col;
  return (
    <span onClick={() => onSort(col)} style={{ display: 'flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: 3, cursor: 'pointer', userSelect: 'none', color: active ? '#11181c' : '#71717a', fontWeight: active ? 700 : 600, fontSize: 11, letterSpacing: 0 }}>
      {label}
      <span style={{ fontSize: 8 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
    </span>
  );
}

export default function SummaryPage() {
  const [history, setHistory] = useState<MonthlyHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortCol, setSortCol] = useState('sort');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const { onToggle } = useSidebar();

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  useEffect(() => {
    const cached = clientGet<MonthlyHistory[]>('summary');
    if (cached) { setHistory(cached); setLoading(false); return; }
    fetch('/api/summary')
      .then(r => r.json())
      .then((d: MonthlyHistory[]) => {
        const arr = Array.isArray(d) ? d : [];
        clientSet('summary', arr);
        setHistory(arr);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const sorted = [...history].sort((a, b) => {
    let av: number | string, bv: number | string;
    if (sortCol === 'label') { av = a.label; bv = b.label; }
    else if (sortCol === 'recovered') { av = a.recovered; bv = b.recovered; }
    else if (sortCol === 'fee') { av = a.fee; bv = b.fee; }
    else if (sortCol === 'cases') { av = a.approvedCount; bv = b.approvedCount; }
    else if (sortCol === 'growth') { av = a.growth; bv = b.growth; }
    else { av = a.sort; bv = b.sort; }
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return sortDir === 'asc' ? av - (bv as number) : (bv as number) - av;
  });

  return (
    <>
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        button:hover { opacity: .88; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: 10, padding: '8px 20px 10px', height: 68, background: '#f4f4f5' }}>
          <button onClick={onToggle} title="Toggle sidebar" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a', flexShrink: 0, outline: 'none' }}>
            <PanelIcon />
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#11181c', letterSpacing: '-0.02em' }}>Summary</h1>
        </div>

        {error && <div style={{ padding: '10px 20px', background: '#fff0f3', borderBottom: '1px solid #fca5a5', color: '#f31260', fontSize: 13 }}>{error}</div>}

        {/* Table */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '12px 20px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'hidden', borderRadius: 16, background: '#eaebec', display: 'flex', flexDirection: 'column' }}>

            {/* Column headers — sit on grey layer */}
            {!loading && sorted.length > 0 && (() => {
              const G = 'minmax(0,1fr) 150px 130px 80px 110px';
              return (
                <div style={{ display: 'grid', gridTemplateColumns: G, padding: '10px 10px 10px 16px', gap: 8, flexShrink: 0, minWidth: 500 }}>
                  <ColHdr label="Month" col="label" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHdr label="Recovered" col="recovered" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  <ColHdr label="Fee" col="fee" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  <ColHdr label="Cases" col="cases" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  <ColHdr label="Growth" col="growth" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                </div>
              );
            })()}

            {/* White body card */}
            <div style={{ flex: 1, overflow: 'hidden', background: '#fff', borderRadius: 12, margin: '0 6px 6px', display: 'flex', flexDirection: 'column' }}>
              {loading ? (
                <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} h={36} />)}
                </div>
              ) : (() => {
                const G = 'minmax(0,1fr) 150px 130px 80px 110px';
                return (
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <div style={{ minWidth: 500 }}>
                      {sorted.map((row, idx) => (
                        <div key={row.sort || String(idx)} style={{ display: 'grid', gridTemplateColumns: G, padding: '9px 10px 9px 16px', gap: 8, borderBottom: idx < sorted.length - 1 ? '1px solid #f3f4f6' : 'none', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, color: '#11181c', fontSize: 13 }}>{row.label}</span>
                          <span style={{ textAlign: 'right', fontWeight: 700, color: '#006FEE', fontSize: 13 }}>{fmtFull(row.recovered)}</span>
                          <span style={{ textAlign: 'right', color: '#374151', fontSize: 13 }}>{fmtFull(row.fee)}</span>
                          <span style={{ textAlign: 'right', color: '#374151', fontSize: 13 }}>{row.approvedCount}</span>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600, color: row.growth >= 0 ? '#17c964' : '#f31260', background: row.growth >= 0 ? '#f0fdf4' : '#fff0f3', borderRadius: 999, padding: '3px 8px' }}>
                              <span style={{ fontSize: 9 }}>{row.growth >= 0 ? '▲' : '▼'}</span>
                              {Math.abs(row.growth).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
