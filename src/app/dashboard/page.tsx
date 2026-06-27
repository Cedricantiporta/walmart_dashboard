'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DashboardAnalytics, ClientSummary, Invoice, BillingInsights, MonthlyHistory } from '@/types';

// ── helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const fmtFull = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

const fmtTrend = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

function getTimeOptions() {
  const now = new Date();
  const opts: { value: string; label: string }[] = [
    { value: 'thisMonth', label: 'Current Month' },
  ];
  for (let i = 1; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    opts.push({ value: val, label });
  }
  opts.push(
    { value: '90days', label: 'Last 90 Days' },
    { value: 'lifetime', label: 'All Time' },
  );
  return opts;
}

// Matches original GAS displayMetrics computation from billingSummary + history
function computeDisplayMetrics(
  billingSummary: ClientSummary[],
  history: Invoice[],
  dateRange: { start: string; end: string },
  timeRange: string,
) {
  const startRange = new Date(dateRange.start);
  const endRange = new Date(dateRange.end);
  startRange.setHours(0, 0, 0, 0);
  endRange.setHours(23, 59, 59, 999);

  const today = new Date();
  const todayInRange = today >= startRange && today <= endRange;
  const isCurrentMonth = timeRange === 'thisMonth';

  let displayRecovered = 0, displayFees = 0, displayCases = 0, displayTotalPrev = 0;

  if (todayInRange) {
    billingSummary.forEach(client => {
      const fee = client.readyToBillFee || 0;
      if (fee > 0.001) {
        displayFees += fee;
        displayRecovered += client.totalReimbursed || 0;
        displayCases += client.readyToBillCases || 0;
      }
      displayTotalPrev += client.previouslyBilledFee || 0;
    });
  }

  history.forEach(inv => {
    let billedDate = new Date(inv.billed_date);
    // TheSavingsMart special case (NV-1042a)
    if (
      inv.client_name === 'TheSavingsMart' &&
      inv.invoice_number === 'NV-1042a'
    ) {
      billedDate = new Date('2026-02-02T12:00:00Z');
    }
    const periodDate = new Date(billedDate);
    if (billedDate.getDate() <= 7) periodDate.setMonth(periodDate.getMonth() - 1);

    if (periodDate >= startRange && periodDate <= endRange) {
      displayFees += inv.billed_fee || 0;
      displayRecovered += inv.total_reimbursed || 0;
      displayCases += 1;
      if (!isCurrentMonth) displayTotalPrev += inv.billed_fee || 0;
    }
  });

  return { displayRecovered, displayFees, displayCases, displayTotalPrev };
}

// ── sub-components ────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  trend,
  format = 'currency',
}: {
  label: string;
  value: number;
  sub?: string;
  trend?: number;
  format?: 'currency' | 'number';
}) {
  const displayVal = format === 'currency' ? fmt(value) : String(Math.round(value));
  const trendUp = trend !== undefined && trend >= 0;

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      padding: '20px 22px',
      flex: '1 1 180px',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
        {displayVal}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{sub}</div>
      )}
      {trend !== undefined && (
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: trendUp ? '#16a34a' : '#dc2626', display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 14 }}>{trendUp ? '↑' : '↓'}</span>
          <span>{fmtTrend(trend)} vs prev period</span>
        </div>
      )}
    </div>
  );
}

function SvgBarChart({ data }: { data: { label: string; recovered: number; fee: number }[] }) {
  if (!data.length) return <div style={{ color: '#9ca3af', fontSize: 13 }}>No data</div>;

  const maxVal = Math.max(...data.map(d => d.recovered), 1);
  const H = 150;
  const barW = 36;
  const gap = 14;
  const paddingTop = 28;
  const paddingBottom = 28;
  const totalW = data.length * (barW + gap) - gap;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width={totalW + 2}
        height={H + paddingTop + paddingBottom}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {data.map((d, i) => {
          const barH = Math.max((d.recovered / maxVal) * H, 3);
          const x = i * (barW + gap);
          const y = paddingTop + (H - barH);
          const labelY = paddingTop + H + 18;
          const month = d.label.split(' ')[0].slice(0, 3);
          const opacity = 0.45 + 0.55 * (d.recovered / maxVal);

          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx={6} fill="#2563eb" opacity={opacity} />
              {d.recovered > 0 && (
                <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={10} fill="#374151" fontWeight={700}>
                  {d.recovered >= 1000 ? `$${(d.recovered / 1000).toFixed(0)}k` : fmt(d.recovered)}
                </text>
              )}
              <text x={x + barW / 2} y={labelY} textAnchor="middle" fontSize={11} fill="#6b7280" fontWeight={500}>
                {month}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CategoryBreakdown({ data }: { data: { category: string; amount: number }[] }) {
  if (!data.length) return <div style={{ color: '#9ca3af', fontSize: 13 }}>No data</div>;
  const maxAmt = data[0]?.amount || 1;

  return (
    <div>
      {data.slice(0, 10).map((c, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
            <span style={{ color: '#374151', fontWeight: 500, flex: 1, marginRight: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.category || 'Other'}
            </span>
            <span style={{ color: '#6b7280', fontWeight: 600, flexShrink: 0 }}>{fmtFull(c.amount)}</span>
          </div>
          <div style={{ height: 4, background: '#f3f4f6', borderRadius: 2 }}>
            <div style={{
              height: '100%',
              width: `${(c.amount / maxAmt) * 100}%`,
              background: '#2563eb',
              borderRadius: 2,
              opacity: 0.5 + 0.5 * (c.amount / maxAmt),
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthlyHistoryTable({ history }: { history: MonthlyHistory[] }) {
  if (!history.length) return <div style={{ color: '#9ca3af', fontSize: 13 }}>No data</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {['Month', 'Recovered', 'Fee', 'Cases', 'Growth'].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '0 12px 10px',
                color: '#6b7280', fontWeight: 600, fontSize: 11,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap',
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

// ── main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState('thisMonth');
  const [client, setClient] = useState('all');
  const [clientList, setClientList] = useState<string[]>([]);
  const [hiddenClientList, setHiddenClientList] = useState<string[]>([]);
  const [extraClients, setExtraClients] = useState<string[]>([]);
  const [billingSummary, setBillingSummary] = useState<ClientSummary[]>([]);
  const [history, setHistory] = useState<Invoice[]>([]);
  const [billingInsights, setBillingInsights] = useState<BillingInsights | null>(null);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [lastSync, setLastSync] = useState('');
  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [error, setError] = useState('');

  const timeOptions = getTimeOptions();

  // Fetch initial payload once
  useEffect(() => {
    fetch('/api/initial-payload')
      .then(r => r.json())
      .then(d => {
        setClientList(d.clientList ?? []);
        setHiddenClientList(d.hiddenClientList ?? []);
        setBillingSummary(d.billingSummary ?? []);
        setHistory(d.history ?? []);
        setBillingInsights(d.billingInsights ?? null);
        setLastSync(d.lastSyncTime ?? '');
        // Use the pre-computed analytics from initial-payload for first load
        if (d.dashboardAnalytics) setAnalytics(d.dashboardAnalytics);
        setLoadingInit(false);
      })
      .catch(e => {
        setError(e.message);
        setLoadingInit(false);
      });
  }, []);

  // Fetch analytics whenever filters change (skip if still loading init)
  const fetchAnalytics = useCallback(() => {
    if (loadingInit) return;
    setLoadingAnalytics(true);
    const isYYYYMM = /^\d{4}-\d{2}$/.test(timeRange);
    const params = new URLSearchParams({
      timeRange: isYYYYMM ? 'specificMonth' : timeRange,
      client,
      extraClients: extraClients.join(','),
    });
    if (isYYYYMM) params.set('startDate', `${timeRange}-01`);

    fetch(`/api/dashboard/analytics?${params}`)
      .then(r => r.json())
      .then(d => { setAnalytics(d); setLoadingAnalytics(false); })
      .catch(() => setLoadingAnalytics(false));
  }, [timeRange, client, extraClients, loadingInit]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const loading = loadingInit || loadingAnalytics;

  // Compute displayed metric values
  const displayMetrics = analytics
    ? computeDisplayMetrics(billingSummary, history, analytics.dateRange, timeRange)
    : null;

  const { metrics, trends, monthlyHistory = [], categoryData = [] } = analytics ?? {};

  const chartHistory = [...monthlyHistory]
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .slice(-8)
    .map(h => ({ label: h.label, recovered: h.recovered, fee: h.fee }));

  // Date range display
  const dateRangeLabel = analytics?.dateRange
    ? (() => {
        const s = new Date(analytics.dateRange.start);
        const e = new Date(analytics.dateRange.end);
        return `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      })()
    : '';

  // Format last sync
  const syncLabel = lastSync
    ? new Date(lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  const isHiddenIncluded = (name: string) => extraClients.includes(name);
  const toggleHidden = (name: string) => {
    setExtraClients(prev =>
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]
    );
  };

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        select:hover { border-color: #9ca3af !important; }
      `}</style>

      <div style={{ padding: '28px 32px', maxWidth: 1200 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: '-0.01em' }}>Overview</h1>
            {dateRangeLabel && (
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: 3, fontWeight: 500 }}>{dateRangeLabel}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {syncLabel && (
              <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 4 }}>Synced {syncLabel}</span>
            )}
            {/* Time range */}
            <select
              value={timeRange}
              onChange={e => setTimeRange(e.target.value)}
              style={{ fontSize: 13, fontWeight: 500, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 10px', cursor: 'pointer', outline: 'none' }}
            >
              {timeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {/* Client filter */}
            <select
              value={client}
              onChange={e => setClient(e.target.value)}
              style={{ fontSize: 13, fontWeight: 500, color: '#374151', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 10px', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">All Clients</option>
              {clientList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 20, color: '#dc2626', fontSize: 13 }}>
            Failed to load data: {error}
          </div>
        )}

        {/* Metric cards */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
          {loading && !analytics ? (
            [1,2,3,4].map(i => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 22px', flex: '1 1 180px' }}>
                <Skeleton h={10} w={80} /><div style={{ height: 10 }} />
                <Skeleton h={32} w={120} /><div style={{ height: 8 }} />
                <Skeleton h={12} w={100} />
              </div>
            ))
          ) : displayMetrics ? (
            <>
              <MetricCard
                label="Total Reimbursed"
                value={displayMetrics.displayRecovered}
                trend={trends?.totalReimbursed}
              />
              <MetricCard
                label="Total Fees"
                value={displayMetrics.displayFees}
                trend={trends?.totalFees}
              />
              <MetricCard
                label="Approved Cases"
                value={displayMetrics.displayCases}
                trend={trends?.approvedCases}
                format="number"
              />
              <MetricCard
                label="Total Fees Billed"
                value={displayMetrics.displayTotalPrev}
                sub={billingInsights ? `${billingInsights.clientCount} client${billingInsights.clientCount !== 1 ? 's' : ''} ready to bill` : undefined}
              />
            </>
          ) : null}
        </div>

        {/* Charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16, marginBottom: 24 }}>
          {/* Monthly bar chart */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Monthly Recovery</h3>
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>Last 8 months</span>
            </div>
            {loading && !analytics ? (
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', height: 150 }}>
                {[60,80,45,100,70,90,55,85].map((h, i) => (
                  <Skeleton key={i} h={h} w={36} radius={6} />
                ))}
              </div>
            ) : (
              <SvgBarChart data={chartHistory} />
            )}
          </div>

          {/* Category breakdown */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 22px' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 18 }}>By Category</h3>
            {loading && !analytics ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[1,2,3,4,5].map(i => <Skeleton key={i} h={10} />)}
              </div>
            ) : (
              <CategoryBreakdown data={categoryData ?? []} />
            )}
          </div>
        </div>

        {/* Hidden clients toggle */}
        {hiddenClientList.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 22px', marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>
              Hidden Clients
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, marginLeft: 8 }}>
                (toggle to include in analytics)
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {hiddenClientList.map(name => {
                const included = isHiddenIncluded(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggleHidden(name)}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                      border: `1px solid ${included ? '#2563eb' : '#e5e7eb'}`,
                      background: included ? '#eff6ff' : '#f9fafb',
                      color: included ? '#2563eb' : '#6b7280',
                      cursor: 'pointer',
                    }}
                  >
                    {name} {included ? '✓' : '+'}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly history table */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 22px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 18 }}>Monthly History</h3>
          {loading && !analytics ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1,2,3,4,5].map(i => <Skeleton key={i} h={16} />)}
            </div>
          ) : (
            <MonthlyHistoryTable history={monthlyHistory ?? []} />
          )}
        </div>

      </div>
    </>
  );
}
