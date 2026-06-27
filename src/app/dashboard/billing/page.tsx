'use client';

import { useState, useEffect } from 'react';

const fmtUSD = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

const fmtPct = (r: number) => `${(r * 100).toFixed(0)}%`;

const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

type BillingCase = {
  caseId: string;
  claimType: string;
  postingDate: string;
  amount: number;
  fee: number;
  isCurrentMonth: boolean;
};

type ClientBilling = {
  clientName: string;
  rate: number;
  totalAmount: number;
  totalFee: number;
  currentMonthFee: number;
  prevMonthFee: number;
  cases: BillingCase[];
};

type BillingData = {
  clients: ClientBilling[];
  totalFee: number;
  totalAmount: number;
  totalCases: number;
  currentMonthStart: string;
};

function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: string | number }) {
  return (
    <div style={{
      height: h, width: w, borderRadius: 6,
      background: 'linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
    }} />
  );
}

function ClientRow({ client, currentMonthStart }: { client: ClientBilling; currentMonthStart: string }) {
  const [open, setOpen] = useState(false);
  const hasPrev = client.prevMonthFee > 0;
  const hasCurrent = client.currentMonthFee > 0;

  return (
    <div style={{ borderBottom: '1px solid #f3f4f6' }}>
      {/* Client header row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 110px 110px 110px 80px 28px',
          gap: 8,
          padding: '12px 16px',
          cursor: 'pointer',
          alignItems: 'center',
          background: open ? '#f9fafb' : 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {client.clientName}
          </span>
          {hasPrev && (
            <span style={{ fontSize: 10, fontWeight: 600, background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '2px 6px', flexShrink: 0 }}>
              PREV
            </span>
          )}
          {hasCurrent && !hasPrev && (
            <span style={{ fontSize: 10, fontWeight: 600, background: '#d1fae5', color: '#065f46', borderRadius: 4, padding: '2px 6px', flexShrink: 0 }}>
              CURRENT
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{fmtPct(client.rate)}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(client.totalFee)}</div>
        <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{client.cases.length} case{client.cases.length !== 1 ? 's' : ''}</div>
        <div style={{ color: '#9ca3af', textAlign: 'center', fontSize: 16, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }}>⌄</div>
      </div>

      {/* Expanded cases */}
      {open && (
        <div style={{ background: '#f9fafb', borderTop: '1px solid #f3f4f6' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '130px 1fr 120px 110px 110px',
            gap: 8, padding: '8px 16px 6px 32px',
            fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <span>Case ID</span>
            <span>Type</span>
            <span>Posting Date</span>
            <span style={{ textAlign: 'right' }}>Recovered</span>
            <span style={{ textAlign: 'right' }}>Fee</span>
          </div>
          {client.cases.map((c, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '130px 1fr 120px 110px 110px',
              gap: 8, padding: '8px 16px 8px 32px',
              borderTop: '1px solid #f3f4f6',
              alignItems: 'center',
              background: c.isCurrentMonth ? '#fff' : '#fffbeb',
            }}>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#374151' }}>{c.caseId}</span>
              <span style={{ fontSize: 12, color: '#374151' }}>{c.claimType}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#374151' }}>{fmtDate(c.postingDate)}</span>
                {!c.isCurrentMonth && (
                  <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '1px 4px' }}>PREV</span>
                )}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.amount)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(c.fee)}</span>
            </div>
          ))}
          {/* Client subtotal */}
          <div style={{
            display: 'grid', gridTemplateColumns: '130px 1fr 120px 110px 110px',
            gap: 8, padding: '10px 16px 10px 32px',
            borderTop: '1px solid #e5e7eb',
            background: '#f3f4f6',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Subtotal</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(client.totalFee)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/billing')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const currentMonthLabel = data?.currentMonthStart
    ? new Date(data.currentMonthStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  const filtered = (data?.clients ?? []).filter(c =>
    !search || c.clientName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        input:focus { outline: none; border-color: #2563eb !important; }
      `}</style>

      <div style={{ padding: '28px 32px', maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: '-0.01em' }}>Billing</h1>
          {currentMonthLabel && (
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 3, fontWeight: 500 }}>
              Ready to bill as of {currentMonthLabel}
            </p>
          )}
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Summary cards */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
          {loading ? [1,2,3].map(i => (
            <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px', flex: '1 1 160px' }}>
              <Skeleton h={10} w={80} /><div style={{ height: 10 }} /><Skeleton h={28} w={110} />
            </div>
          )) : (
            <>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px', flex: '1 1 160px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Total Fees RTB</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', letterSpacing: '-0.02em' }}>{fmtUSD(data?.totalFee ?? 0)}</div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px', flex: '1 1 160px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Total Recovered</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#2563eb', letterSpacing: '-0.02em' }}>{fmtUSD(data?.totalAmount ?? 0)}</div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px', flex: '1 1 160px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Clients Ready</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', letterSpacing: '-0.02em' }}>{data?.clients.length ?? 0}</div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px', flex: '1 1 160px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Total Cases</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', letterSpacing: '-0.02em' }}>{data?.totalCases ?? 0}</div>
              </div>
            </>
          )}
        </div>

        {/* Client table */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ padding: '16px 16px 0', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                Clients Ready to Bill {!loading && filtered.length > 0 && <span style={{ color: '#6b7280', fontWeight: 500 }}>({filtered.length})</span>}
              </h3>
              <input
                placeholder="Search client..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ fontSize: 13, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 8, width: 180, color: '#374151' }}
              />
            </div>
            {/* Column labels */}
            {!loading && (
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 110px 110px 110px 80px 28px',
                gap: 8, padding: '0 0 10px',
                fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                <span>Client</span>
                <span style={{ textAlign: 'right' }}>Rate</span>
                <span style={{ textAlign: 'right' }}>Recovered</span>
                <span style={{ textAlign: 'right' }}>Fee</span>
                <span style={{ textAlign: 'right' }}>Cases</span>
                <span />
              </div>
            )}
          </div>

          {loading ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1,2,3,4,5].map(i => <Skeleton key={i} h={44} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              {search ? 'No clients match your search.' : 'No clients ready to bill.'}
            </div>
          ) : (
            filtered.map(client => (
              <ClientRow key={client.clientName} client={client} currentMonthStart={data?.currentMonthStart ?? ''} />
            ))
          )}

          {/* Grand total footer */}
          {!loading && filtered.length > 0 && (
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 110px 110px 110px 80px 28px',
              gap: 8, padding: '14px 16px',
              borderTop: '2px solid #e5e7eb',
              background: '#f9fafb',
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Total</span>
              <span />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalAmount,0))}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalFee,0))}</span>
              <span style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{filtered.reduce((s,c)=>s+c.cases.length,0)}</span>
              <span />
            </div>
          )}
        </div>

      </div>
    </>
  );
}
