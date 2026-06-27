'use client';

import { useState, useEffect } from 'react';
import type { MonthlyHistory } from '@/types';
import { clientGet, clientSet } from '@/lib/client-cache';

const fmtFull = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

function Skeleton({ h = 20, w = '100%', radius = 6 }: { h?: number; w?: string | number; radius?: number }) {
  return (
    <div style={{ height: h, width: w, borderRadius: radius, background: 'linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
  );
}

const IconFilter = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
const IconSort = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="8" y2="18"/></svg>;
const IconCols = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>;

const pillBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontSize: 13, fontWeight: 500, color: '#71717a',
  background: '#fff', border: '1px solid #e4e4e7',
  borderRadius: 999, padding: '5px 12px',
  cursor: 'pointer', outline: 'none', flexShrink: 0,
};

function ColHdr({ label, col, sortCol, sortDir, onSort, align = 'left' }: {
  label: string; col: string; sortCol: string; sortDir: 'asc'|'desc';
  onSort: (c: string) => void; align?: 'left'|'right';
}) {
  const active = sortCol === col;
  return (
    <span onClick={() => onSort(col)} style={{ display: 'flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: 3, cursor: 'pointer', userSelect: 'none', color: active ? '#11181c' : '#a1a1aa', fontWeight: active ? 700 : 600 }}>
      {label}
      <span style={{ fontSize: 8 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
    </span>
  );
}

function MonthlyHistoryTable({ history }: { history: MonthlyHistory[] }) {
  const [sortCol, setSortCol] = useState('sort');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

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

  if (!history.length) return <div style={{ color: '#a1a1aa', fontSize: 13, padding: '48px 16px', textAlign: 'center' }}>No data</div>;

  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fff' }}>
          <tr>
            {[
              { label: 'Month', col: 'label', align: 'left' as const },
              { label: 'Recovered', col: 'recovered', align: 'right' as const },
              { label: 'Fee', col: 'fee', align: 'right' as const },
              { label: 'Cases', col: 'cases', align: 'right' as const },
              { label: 'Growth', col: 'growth', align: 'right' as const },
            ].map(h => (
              <th key={h.col} style={{ textAlign: h.align, padding: '0 14px 10px', borderBottom: '1px solid #e4e4e7', whiteSpace: 'nowrap' }}>
                <ColHdr label={h.label} col={h.col} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align={h.align} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '11px 14px', fontWeight: 600, color: '#11181c', whiteSpace: 'nowrap' }}>{row.label}</td>
              <td style={{ padding: '11px 14px', fontWeight: 700, color: '#006FEE', textAlign: 'right' }}>{fmtFull(row.recovered)}</td>
              <td style={{ padding: '11px 14px', color: '#374151', textAlign: 'right' }}>{fmtFull(row.fee)}</td>
              <td style={{ padding: '11px 14px', color: '#374151', textAlign: 'right' }}>{row.approvedCount}</td>
              <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontSize: 12, fontWeight: 600,
                  color: row.growth >= 0 ? '#17c964' : '#f31260',
                  background: row.growth >= 0 ? '#f0fdf4' : '#fff0f3',
                  borderRadius: 999, padding: '3px 8px',
                }}>
                  <span style={{ fontSize: 9 }}>{row.growth >= 0 ? '▲' : '▼'}</span>
                  {Math.abs(row.growth).toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SummaryPage() {
  const [history, setHistory] = useState<MonthlyHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const totalRecovered = history.reduce((s, r) => s + r.recovered, 0);
  const totalFee = history.reduce((s, r) => s + r.fee, 0);

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        button:hover { opacity: .88; }
      `}</style>

      <div style={{ padding: '20px 28px', maxWidth: 1200 }}>

        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#11181c', letterSpacing: '-0.01em' }}>Summary</h1>
          <span style={{ fontSize: 13, color: '#a1a1aa', fontWeight: 500 }}>All-time monthly breakdown</span>
        </div>

        {error && (
          <div style={{ background: '#fff0f3', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#f31260', fontSize: 13 }}>
            Failed to load: {error}
          </div>
        )}

        {/* Summary stat cards */}
        {!loading && history.length > 0 && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
            {[
              { label: 'Total Recovered', value: fmtFull(totalRecovered) },
              { label: 'Total Fees Earned', value: fmtFull(totalFee) },
              { label: 'Months Active', value: String(history.length) },
            ].map(card => (
              <div key={card.label} style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: '18px 22px', flex: '1 1 160px', minWidth: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>{card.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#11181c', lineHeight: 1.15, letterSpacing: '-0.02em' }}>{card.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Monthly history table */}
        <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 260px)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#11181c' }}>
              Monthly History{' '}
              {!loading && <span style={{ fontSize: 14, color: '#a1a1aa', fontWeight: 500 }}>{history.length}</span>}
            </span>
            {!loading && (
              <>
                <button style={pillBtn}><IconFilter /> Filter</button>
                <button style={pillBtn}><IconSort /> Sort</button>
                <button style={pillBtn}><IconCols /> Columns</button>
              </>
            )}
          </div>
          {loading ? (
            <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} h={16} />)}
            </div>
          ) : (
            <MonthlyHistoryTable history={history} />
          )}
        </div>

      </div>
    </>
  );
}
