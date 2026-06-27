'use client';

import { useState, useEffect } from 'react';
import type { MonthlyHistory } from '@/types';
import { clientGet, clientSet } from '@/lib/client-cache';

const fmtFull = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

function Skeleton({ h = 20, w = '100%', radius = 6 }: { h?: number; w?: string | number; radius?: number }) {
  return (
    <div style={{
      height: h, width: w, borderRadius: radius,
      background: 'linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}

function MonthlyHistoryTable({ history }: { history: MonthlyHistory[] }) {
  if (!history.length) return <div style={{ color: '#9ca3af', fontSize: 13 }}>No data</div>;

  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          <tr>
            {['Month', 'Recovered', 'Fee', 'Cases', 'Growth'].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '0 12px 10px',
                color: '#6b7280', fontWeight: 600, fontSize: 11,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
                background: '#fff',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '10px 12px', fontWeight: 600, color: '#111827', whiteSpace: 'nowrap' }}>{row.label}</td>
              <td style={{ padding: '10px 12px', fontWeight: 700, color: '#2563eb' }}>{fmtFull(row.recovered)}</td>
              <td style={{ padding: '10px 12px', color: '#374151' }}>{fmtFull(row.fee)}</td>
              <td style={{ padding: '10px 12px', color: '#374151' }}>{row.approvedCount}</td>
              <td style={{ padding: '10px 12px', fontWeight: 600, color: row.growth >= 0 ? '#16a34a' : '#dc2626' }}>
                {row.growth >= 0 ? '+' : ''}{row.growth.toFixed(1)}%
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
      `}</style>

      <div style={{ padding: '28px 32px', maxWidth: 1200 }}>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: '-0.01em' }}>Summary</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 3, fontWeight: 500 }}>All-time monthly breakdown</p>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
            Failed to load: {error}
          </div>
        )}

        {/* Summary stat cards */}
        {!loading && history.length > 0 && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
            {[
              { label: 'Total Recovered', value: fmtFull(totalRecovered) },
              { label: 'Total Fees Earned', value: fmtFull(totalFee) },
              { label: 'Months Active', value: String(history.length) },
            ].map(card => (
              <div key={card.label} style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
                padding: '20px 22px', flex: '1 1 160px', minWidth: 0,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  {card.label}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#111827', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                  {card.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Monthly history table */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 260px)' }}>
          <div style={{ flexShrink: 0, padding: '16px 22px 12px', borderBottom: '1px solid #e5e7eb' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Monthly History</h3>
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
