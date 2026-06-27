'use client';

import { useState, useEffect } from 'react';
import { Table } from '@heroui/react';
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
    <span onClick={() => onSort(col)} style={{ display: 'flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: 3, cursor: 'pointer', userSelect: 'none', color: active ? '#11181c' : '#71717a', fontWeight: active ? 700 : 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
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

  const totalRecovered = history.reduce((s, r) => s + r.recovered, 0);
  const totalFee = history.reduce((s, r) => s + r.fee, 0);

  return (
    <>
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        button:hover { opacity: .88; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', height: 60, borderBottom: '1px solid #e4e4e7', background: '#fff' }}>
          <button onClick={onToggle} title="Toggle sidebar" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #e4e4e7', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a', flexShrink: 0, outline: 'none' }}>
            <PanelIcon />
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#11181c', letterSpacing: '-0.01em' }}>Summary</h1>
          <span style={{ fontSize: 13, color: '#a1a1aa' }}>All-time monthly breakdown</span>
        </div>

        {error && <div style={{ padding: '10px 20px', background: '#fff0f3', borderBottom: '1px solid #fca5a5', color: '#f31260', fontSize: 13 }}>{error}</div>}

        {/* Stat cards */}
        {!loading && history.length > 0 && (
          <div style={{ display: 'flex', gap: 12, padding: '16px 20px 0', flexWrap: 'wrap' }}>
            {[{ label: 'Total Recovered', value: fmtFull(totalRecovered) }, { label: 'Total Fees Earned', value: fmtFull(totalFee) }, { label: 'Months Active', value: String(history.length) }].map(card => (
              <div key={card.label} style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 12, padding: '14px 18px', flex: '1 1 150px', minWidth: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{card.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#11181c', letterSpacing: '-0.02em' }}>{card.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '12px 20px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'hidden', border: '1px solid #e4e4e7', borderRadius: 14, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} h={16} />)}
              </div>
            ) : (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <Table variant="secondary" style={{ width: '100%' }}>
                  <Table.ScrollContainer>
                    <Table.Content aria-label="Monthly History">
                      <Table.Header>
                        <Table.Column isRowHeader>
                          <ColHdr label="Month" col="label" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                        </Table.Column>
                        <Table.Column>
                          <ColHdr label="Recovered" col="recovered" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                        </Table.Column>
                        <Table.Column>
                          <ColHdr label="Fee" col="fee" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                        </Table.Column>
                        <Table.Column>
                          <ColHdr label="Cases" col="cases" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                        </Table.Column>
                        <Table.Column>
                          <ColHdr label="Growth" col="growth" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                        </Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {sorted.map((row, i) => (
                          <Table.Row key={row.sort || String(i)} id={row.sort || String(i)}>
                            <Table.Cell><span style={{ fontWeight: 600, color: '#11181c', fontSize: 13 }}>{row.label}</span></Table.Cell>
                            <Table.Cell><span style={{ display: 'block', textAlign: 'right', fontWeight: 700, color: '#006FEE', fontSize: 13 }}>{fmtFull(row.recovered)}</span></Table.Cell>
                            <Table.Cell><span style={{ display: 'block', textAlign: 'right', color: '#374151', fontSize: 13 }}>{fmtFull(row.fee)}</span></Table.Cell>
                            <Table.Cell><span style={{ display: 'block', textAlign: 'right', color: '#374151', fontSize: 13 }}>{row.approvedCount}</span></Table.Cell>
                            <Table.Cell>
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600, color: row.growth >= 0 ? '#17c964' : '#f31260', background: row.growth >= 0 ? '#f0fdf4' : '#fff0f3', borderRadius: 999, padding: '3px 8px' }}>
                                  <span style={{ fontSize: 9 }}>{row.growth >= 0 ? '▲' : '▼'}</span>
                                  {Math.abs(row.growth).toFixed(1)}%
                                </span>
                              </div>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                  <Table.Footer>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 140px 80px 100px', gap: 8, padding: '12px 16px', background: '#fafafa', borderRadius: 12, margin: '0 4px 4px', border: '1px solid #f0f0f0' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#11181c' }}>All-time total</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#006FEE', textAlign: 'right' }}>{fmtFull(totalRecovered)}</span>
                      <span style={{ fontSize: 13, color: '#374151', textAlign: 'right' }}>{fmtFull(totalFee)}</span>
                      <span style={{ fontSize: 13, color: '#374151', textAlign: 'right' }}>{history.reduce((s,r)=>s+r.approvedCount,0)}</span>
                      <span />
                    </div>
                  </Table.Footer>
                </Table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
