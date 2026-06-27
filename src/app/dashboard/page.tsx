'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { DashboardAnalytics, Invoice, BillingInsights, MonthlyHistory } from '@/types';
import { clientGet, clientSet } from '@/lib/client-cache';

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtFull = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

const fmtCompact = (v: number) =>
  v >= 1000
    ? `$${(v / 1000).toFixed(1)}k`
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

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

// Cards 1-3 use analytics.metrics directly (same source as Monthly History).
// Card 4 (Total Fees Billed) = invoices issued that fall in the selected period.
function computeTotalFeesBilled(
  history: Invoice[],
  dateRange: { start: string; end: string },
) {
  const startRange = new Date(dateRange.start);
  const endRange = new Date(dateRange.end);
  startRange.setHours(0, 0, 0, 0);
  endRange.setHours(23, 59, 59, 999);

  let total = 0;
  history.forEach(inv => {
    let billedDate = new Date(inv.billed_date);
    if (inv.client_name === 'TheSavingsMart' && inv.invoice_number === 'NV-1042a') {
      billedDate = new Date('2026-02-02T12:00:00Z');
    }
    const periodDate = new Date(billedDate);
    if (billedDate.getDate() <= 7) periodDate.setMonth(periodDate.getMonth() - 1);
    if (periodDate >= startRange && periodDate <= endRange) {
      total += inv.billed_fee || 0;
    }
  });
  return total;
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
  const trendUp = trend !== undefined && trend >= 0;

  let mainDisplay: React.ReactNode;
  if (format === 'currency') {
    const full = fmtFull(value);
    const dotIdx = full.lastIndexOf('.');
    const main = dotIdx >= 0 ? full.slice(0, dotIdx) : full;
    const cents = dotIdx >= 0 ? full.slice(dotIdx) : '';
    mainDisplay = (
      <>
        {main}
        <span style={{ fontSize: '0.6em', fontWeight: 600, color: '#9ca3af', letterSpacing: 0 }}>{cents}</span>
      </>
    );
  } else {
    mainDisplay = String(Math.round(value));
  }

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e4e4e7',
      borderRadius: 14,
      padding: '16px 18px',
      minWidth: 0,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: '#a1a1aa', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#11181c', lineHeight: 1.15, letterSpacing: '-0.02em', marginBottom: 8 }}>
        {mainDisplay}
      </div>
      {trend !== undefined && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          fontSize: 11, fontWeight: 600,
          color: trendUp ? '#17c964' : '#f31260',
          background: trendUp ? '#f0fdf4' : '#fff0f3',
          borderRadius: 999, padding: '3px 8px',
        }}>
          <span style={{ fontSize: 9 }}>{trendUp ? '▲' : '▼'}</span>
          {Math.abs(trend).toFixed(1)}%
        </div>
      )}
      {sub && (
        <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 6 }}>{sub}</div>
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
                  {fmtCompact(d.recovered)}
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
  const [history, setHistory] = useState<Invoice[]>([]);
  const [billingInsights, setBillingInsights] = useState<BillingInsights | null>(null);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [fullMonthlyHistory, setFullMonthlyHistory] = useState<MonthlyHistory[]>([]);
  const [lastSync, setLastSync] = useState('');
  const [rmsCasesCount, setRmsCasesCount] = useState<number | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');

  const timeOptions = getTimeOptions();

  // Fetch initial payload once (client-cached for instant tab re-visits)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cached = clientGet<any>('initial-payload');
    if (cached) {
      setClientList(cached.clientList ?? []);
      setHistory(cached.history ?? []);
      setBillingInsights(cached.billingInsights ?? null);
      setLastSync(cached.lastSyncTime ?? '');
      setRmsCasesCount(cached.rmsCasesCount ?? 0);
      if (cached.dashboardAnalytics) setAnalytics(cached.dashboardAnalytics);
      setLoadingInit(false);
    } else {
      fetch('/api/initial-payload')
        .then(r => r.json())
        .then(d => {
          clientSet('initial-payload', d);
          setClientList(d.clientList ?? []);
          setHistory(d.history ?? []);
          setBillingInsights(d.billingInsights ?? null);
          setLastSync(d.lastSyncTime ?? '');
          setRmsCasesCount(d.rmsCasesCount ?? 0);
          if (d.dashboardAnalytics) setAnalytics(d.dashboardAnalytics);
          setLoadingInit(false);
        })
        .catch(e => {
          setError(e.message);
          setLoadingInit(false);
        });
    }

    // Background fetch: monthly history from pre-computed table + current month live
    fetch('/api/summary')
      .then(r => r.json())
      .then((d: Array<{ month_key: string; label: string; recovered: number; fee: number; approved_count: number; declined_count: number; growth: number }>) => {
        if (Array.isArray(d) && d.length) {
          setFullMonthlyHistory(d.map(r => ({
            label: r.label,
            sort: r.month_key,
            recovered: r.recovered,
            fee: r.fee,
            approvedCount: r.approved_count,
            declinedCount: r.declined_count,
            growth: r.growth,
          })));
        }
        setLoadingHistory(false);
      })
      .catch(() => setLoadingHistory(false));
  }, []);

  // Fetch analytics whenever filters change (skip if still loading init)
  const fetchAnalytics = useCallback(() => {
    if (loadingInit) return;
    setLoadingAnalytics(true);
    const isYYYYMM = /^\d{4}-\d{2}$/.test(timeRange);
    const params = new URLSearchParams({
      timeRange: isYYYYMM ? 'specificMonth' : timeRange,
      client,
    });
    if (isYYYYMM) params.set('startDate', `${timeRange}-01`);

    fetch(`/api/dashboard/analytics?${params}`)
      .then(r => r.json())
      .then(d => { setAnalytics(d); setLoadingAnalytics(false); })
      .catch(() => setLoadingAnalytics(false));
  }, [timeRange, client, loadingInit]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const loading = loadingInit || loadingAnalytics;

  const { metrics, trends, categoryData = [] } = analytics ?? {};

  // Real trend % from monthly history: compare last 2 months
  const historyTrends = useMemo(() => {
    if (fullMonthlyHistory.length < 2) return null;
    const sorted = [...fullMonthlyHistory].sort((a, b) => a.sort.localeCompare(b.sort));
    const cur = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const t = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100;
    return {
      totalReimbursed: t(cur.recovered, prev.recovered),
      totalFees: t(cur.fee, prev.fee),
      approvedCases: t(cur.approvedCount, prev.approvedCount),
      approvalRate: 0,
    };
  }, [fullMonthlyHistory]);

  // Use history-based trends for current month (API only fetches current month data
  // so prevM is always 0 → 100% trend). For other timeframes, analytics computes correctly.
  const displayTrends = timeRange === 'thisMonth' ? (historyTrends ?? trends) : trends;
  const totalFeesBilled = analytics ? computeTotalFeesBilled(history, analytics.dateRange) : 0;

  const chartHistory = [...fullMonthlyHistory]
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

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const pillSelect: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: '#11181c',
    background: '#fff', border: '1px solid #e4e4e7',
    borderRadius: 999, padding: '6px 14px',
    cursor: 'pointer', outline: 'none', appearance: 'none' as const,
  };

  return (
    <>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .pill-select:hover { border-color: #a1a1aa !important; }
        .pill-btn:hover { background: #f4f4f5 !important; }
      `}</style>

      <div style={{ padding: '24px 28px', maxWidth: 1200 }}>

        {/* Greeting row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#11181c', letterSpacing: '-0.02em' }}>{greeting}</h1>
            {dateRangeLabel && <p style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}>{dateRangeLabel}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {syncLabel && <span style={{ fontSize: 11, color: '#a1a1aa' }}>Synced {syncLabel}</span>}
            {/* Timeframe pill select */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 12, pointerEvents: 'none', fontSize: 13, color: '#71717a' }}>📅</span>
              <select value={timeRange} onChange={e => setTimeRange(e.target.value)} className="pill-select" style={{ ...pillSelect, paddingLeft: 32, paddingRight: 28 }}>
                {timeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span style={{ position: 'absolute', right: 10, pointerEvents: 'none', fontSize: 10, color: '#71717a' }}>▾</span>
            </div>
            {/* Client pill select */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <select value={client} onChange={e => setClient(e.target.value)} className="pill-select" style={{ ...pillSelect, paddingRight: 28 }}>
                <option value="all">All Clients</option>
                {clientList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span style={{ position: 'absolute', right: 10, pointerEvents: 'none', fontSize: 10, color: '#71717a' }}>▾</span>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fff0f0', border: '1px solid #fecdd3', borderRadius: 10, padding: '10px 16px', marginBottom: 16, color: '#be123c', fontSize: 13 }}>
            Failed to load data: {error}
          </div>
        )}

        {rmsCasesCount === 0 && !loadingInit && (
          <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#854d0e', lineHeight: 1.6 }}>
            <strong>⚠ No RMS cases.</strong> Run <code style={{ background: '#fef9c3', padding: '1px 5px', borderRadius: 3 }}>migrateAll()</code> + <code style={{ background: '#fef9c3', padding: '1px 5px', borderRadius: 3 }}>setupSyncTrigger()</code> in GAS.
          </div>
        )}

        {/* Metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
          {loadingAnalytics ? (
            [1,2,3,4].map(i => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: '16px 18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <Skeleton h={10} w={80} /><div style={{ height: 10 }} />
                <Skeleton h={28} w={110} /><div style={{ height: 8 }} />
                <Skeleton h={10} w={60} />
              </div>
            ))
          ) : metrics ? (
            <>
              <MetricCard label="Total Reimbursed" value={metrics.totalReimbursed} trend={displayTrends?.totalReimbursed} />
              <MetricCard label="Total Fees" value={metrics.totalFees} trend={displayTrends?.totalFees} />
              <MetricCard label="Approved Cases" value={metrics.approvedCases} trend={displayTrends?.approvedCases} format="number" />
              <MetricCard label="Total Fees Billed" value={totalFeesBilled} />
            </>
          ) : null}
        </div>

        {/* Charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 12, marginBottom: 16 }}>
          {/* Monthly bar chart */}
          <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#11181c' }}>Monthly Recovery</h3>
              </div>
              <span style={{ fontSize: 11, color: '#a1a1aa', background: '#f4f4f5', borderRadius: 999, padding: '3px 10px' }}>Last 8 months</span>
            </div>
            {loadingHistory ? (
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', height: 150 }}>
                {[60,80,45,100,70,90,55,85].map((h, i) => <Skeleton key={i} h={h} w={36} radius={6} />)}
              </div>
            ) : (
              <SvgBarChart data={chartHistory} />
            )}
          </div>

          {/* Category breakdown */}
          <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#11181c', marginBottom: 16 }}>By Category</h3>
            {loadingAnalytics ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[1,2,3,4,5].map(i => <Skeleton key={i} h={10} />)}
              </div>
            ) : (
              <CategoryBreakdown data={categoryData ?? []} />
            )}
          </div>
        </div>

      </div>
    </>
  );
}
