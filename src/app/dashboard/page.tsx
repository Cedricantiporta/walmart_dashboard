'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { DashboardAnalytics, Invoice, BillingInsights, MonthlyHistory } from '@/types';
import { clientGet, clientSet } from '@/lib/client-cache';
import { useSidebar } from '@/components/DashboardShell';

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtFull = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

const fmtCompact = (v: number) =>
  v >= 1000
    ? `$${(v / 1000).toFixed(1)}k`
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

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

function computeTotalFeesBilled(history: Invoice[], dateRange: { start: string; end: string }) {
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
    if (periodDate >= startRange && periodDate <= endRange) total += inv.billed_fee || 0;
  });
  return total;
}

// ── chart geometry ────────────────────────────────────────────────────────────

function pillBarPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(w / 2, 7);
  if (h < 1) return '';
  return `M ${x} ${y+h} H ${x+w} V ${y+r} Q ${x+w} ${y} ${x+w-r} ${y} H ${x+r} Q ${x} ${y} ${x} ${y+r} Z`;
}

function polarToXY(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutPath(cx: number, cy: number, outerR: number, innerR: number, s: number, e: number): string {
  if (e - s >= 360) e = s + 359.99;
  const p1 = polarToXY(cx, cy, outerR, s);
  const p2 = polarToXY(cx, cy, outerR, e);
  const p3 = polarToXY(cx, cy, innerR, e);
  const p4 = polarToXY(cx, cy, innerR, s);
  const large = e - s > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${outerR} ${outerR} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${innerR} ${innerR} 0 ${large} 0 ${p4.x} ${p4.y} Z`;
}

// ── icons ─────────────────────────────────────────────────────────────────────

const ArrowUp = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
  </svg>
);
const ArrowDown = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
  </svg>
);
const PanelIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="16" height="16" rx="3"/><line x1="7" y1="2" x2="7" y2="18"/>
  </svg>
);
const CalendarIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const UserIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);
const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

// ── pill dropdown ─────────────────────────────────────────────────────────────

function PillDropdown({
  value, options, onChange, icon,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', borderRadius: 999,
          border: '1px solid #d4d4d8', background: '#f4f4f5',
          color: '#11181c', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', outline: 'none', whiteSpace: 'nowrap',
        }}
      >
        {icon && <span style={{ color: '#71717a', display: 'flex' }}>{icon}</span>}
        {selected?.label}
        <span style={{ color: '#71717a', display: 'flex' }}><ChevronDownIcon /></span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          background: '#fff', border: '1px solid #e4e4e7', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100,
          minWidth: 190, overflow: 'hidden',
        }}>
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '9px 16px', fontSize: 13, border: 'none', cursor: 'pointer',
                color: opt.value === value ? '#006FEE' : '#11181c',
                background: opt.value === value ? '#f0f7ff' : 'transparent',
                fontWeight: opt.value === value ? 600 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, trend, format = 'currency',
}: {
  label: string; value: number; sub?: string; trend?: number; format?: 'currency' | 'number';
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
    <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: '14px 16px', minWidth: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      {/* Label + trend pill on same row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#71717a' }}>{label}</div>
        {trend !== undefined && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: trendUp ? '#17c964' : '#f31260', background: trendUp ? '#f0fdf4' : '#fff0f3', borderRadius: 999, padding: '2px 7px', flexShrink: 0 }}>
            {trendUp ? <ArrowUp /> : <ArrowDown />}
            {Math.abs(trend).toFixed(1)}%
          </div>
        )}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#11181c', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
        {mainDisplay}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ── bar chart (pill bars + hover tooltip) ─────────────────────────────────────

function SvgBarChart({ data }: { data: { label: string; recovered: number; fee: number }[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });

  if (!data.length) return <div style={{ color: '#a1a1aa', fontSize: 13 }}>No data</div>;

  const maxVal = Math.max(...data.map(d => d.recovered), 1);
  const H = 140, barW = 32, gap = 10, padTop = 24, padBot = 28;
  const totalW = data.length * (barW + gap) - gap;

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <svg width={totalW + 2} height={H + padTop + padBot} style={{ display: 'block', overflow: 'visible' }}>
        {data.map((d, i) => {
          const barH = Math.max((d.recovered / maxVal) * H, 3);
          const x = i * (barW + gap);
          const y = padTop + (H - barH);
          const month = d.label.split(' ')[0].slice(0, 3);
          const isHov = hov === i;
          const opacity = hov !== null && !isHov ? 0.25 : 0.45 + 0.55 * (d.recovered / maxVal);

          return (
            <g key={i} style={{ cursor: 'pointer' }}
              onMouseEnter={e => { setHov(i); setTip({ x: e.clientX, y: e.clientY }); }}
              onMouseLeave={() => setHov(null)}
              onMouseMove={e => setTip({ x: e.clientX, y: e.clientY })}
            >
              <path d={pillBarPath(x, y, barW, barH)} fill="#006FEE" opacity={opacity} style={{ transition: 'opacity 0.15s' }} />
              {isHov && d.recovered > 0 && (
                <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={10} fill="#11181c" fontWeight={700}>{fmtCompact(d.recovered)}</text>
              )}
              <text x={x + barW / 2} y={padTop + H + 18} textAnchor="middle" fontSize={11} fill="#71717a" fontWeight={500}>{month}</text>
            </g>
          );
        })}
      </svg>

      {hov !== null && (
        <div style={{ position: 'fixed', left: tip.x + 12, top: tip.y - 48, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8, padding: '7px 11px', fontSize: 12, zIndex: 200, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
          <div style={{ color: '#71717a', fontSize: 11, marginBottom: 4 }}>{data[hov].label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#006FEE' }} />
            <span style={{ color: '#71717a' }}>recovered</span>
            <span style={{ fontWeight: 700, color: '#11181c' }}>{fmtFull(data[hov].recovered)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── donut chart (category breakdown) ─────────────────────────────────────────

const CHART_COLORS = ['#006FEE','#17c964','#f5a524','#7828C8','#f31260','#00b7eb','#a1a1aa','#e4e4e7'];

function DonutChart({ data }: { data: { category: string; amount: number }[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });

  if (!data.length) return <div style={{ color: '#a1a1aa', fontSize: 13 }}>No data</div>;

  const total = data.reduce((s, d) => s + d.amount, 0);
  const cx = 75, cy = 75, outerR = 70, innerR = 44;
  let cum = 0;
  const slices = data.slice(0, 8).map((d, i) => {
    const frac = d.amount / total;
    const start = cum * 360;
    cum += frac;
    return { ...d, frac, start, end: cum * 360, color: CHART_COLORS[i % CHART_COLORS.length] };
  });

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flexShrink: 0 }}>
        <svg width={150} height={150} style={{ overflow: 'visible' }}>
          {slices.map((s, i) => (
            <path
              key={i}
              d={donutPath(cx, cy, outerR, innerR, s.start, s.end)}
              fill={s.color}
              opacity={hov === null || hov === i ? 1 : 0.2}
              onMouseEnter={e => { setHov(i); setTip({ x: e.clientX, y: e.clientY }); }}
              onMouseLeave={() => setHov(null)}
              onMouseMove={e => setTip({ x: e.clientX, y: e.clientY })}
              style={{ cursor: 'pointer', transition: 'opacity 0.15s', outline: 'none' }}
            />
          ))}
          <text x={cx} y={cy - 5} textAnchor="middle" fontSize={10} fill="#71717a">Total</text>
          <text x={cx} y={cy + 11} textAnchor="middle" fontSize={13} fontWeight={700} fill="#11181c">{fmtCompact(total)}</text>
        </svg>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {slices.map((s, i) => (
          <div key={i}
            onMouseEnter={() => setHov(i)}
            onMouseLeave={() => setHov(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7, opacity: hov === null || hov === i ? 1 : 0.35, transition: 'opacity 0.15s', cursor: 'pointer' }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#71717a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.category || 'Other'}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#11181c', flexShrink: 0 }}>{(s.frac * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>

      {hov !== null && (
        <div style={{ position: 'fixed', left: tip.x + 12, top: tip.y - 48, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8, padding: '7px 11px', fontSize: 12, zIndex: 200, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: slices[hov].color }} />
            <span style={{ fontWeight: 600, color: '#11181c' }}>{slices[hov].category || 'Other'}</span>
          </div>
          <div style={{ color: '#71717a' }}>{fmtFull(slices[hov].amount)} · {(slices[hov].frac * 100).toFixed(1)}%</div>
        </div>
      )}
    </div>
  );
}

function Skeleton({ h = 20, w = '100%', radius = 6 }: { h?: number; w?: string | number; radius?: number }) {
  return (
    <div style={{ height: h, width: w, borderRadius: radius, background: 'linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
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

  const { onToggle } = useSidebar();
  const timeOptions = getTimeOptions();

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
        .catch(e => { setError(e.message); setLoadingInit(false); });
    }

    fetch('/api/summary')
      .then(r => r.json())
      .then((d: Array<{ month_key: string; label: string; recovered: number; fee: number; approved_count: number; declined_count: number; growth: number }>) => {
        if (Array.isArray(d) && d.length) {
          setFullMonthlyHistory(d.map(r => ({
            label: r.label, sort: r.month_key,
            recovered: r.recovered, fee: r.fee,
            approvedCount: r.approved_count, declinedCount: r.declined_count, growth: r.growth,
          })));
        }
        setLoadingHistory(false);
      })
      .catch(() => setLoadingHistory(false));
  }, []);

  const fetchAnalytics = useCallback(() => {
    if (loadingInit) return;
    setLoadingAnalytics(true);
    const isYYYYMM = /^\d{4}-\d{2}$/.test(timeRange);
    const params = new URLSearchParams({ timeRange: isYYYYMM ? 'specificMonth' : timeRange, client });
    if (isYYYYMM) params.set('startDate', `${timeRange}-01`);
    fetch(`/api/dashboard/analytics?${params}`)
      .then(r => r.json())
      .then(d => { setAnalytics(d); setLoadingAnalytics(false); })
      .catch(() => setLoadingAnalytics(false));
  }, [timeRange, client, loadingInit]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const { metrics, trends, categoryData = [] } = analytics ?? {};
  const totalFeesBilled = analytics ? computeTotalFeesBilled(history, analytics.dateRange) : 0;

  const chartHistory = [...fullMonthlyHistory]
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .slice(-8)
    .map(h => ({ label: h.label, recovered: h.recovered, fee: h.fee }));

  const dateRangeLabel = analytics?.dateRange
    ? (() => {
        const s = new Date(analytics.dateRange.start);
        const e = new Date(analytics.dateRange.end);
        return `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      })()
    : '';

  const syncLabel = lastSync
    ? new Date(lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  // Accurate trends from monthly history (API only fetches current month → prevM = 0 → 100%)
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

  const displayTrends = timeRange === 'thisMonth' ? (historyTrends ?? trends) : trends;

  const clientOptions = [{ value: 'all', label: 'All Clients' }, ...clientList.map(c => ({ value: c, label: c }))];

  return (
    <>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        button:hover { opacity: .88; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

        {/* Top bar — aligned with sidebar brand section */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 20px', height: 60, borderBottom: '1px solid #e4e4e7', background: '#fff', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={onToggle} title="Toggle sidebar" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #e4e4e7', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a', flexShrink: 0, outline: 'none' }}>
              <PanelIcon />
            </button>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#11181c', letterSpacing: '-0.01em' }}>{greeting}</h1>
              {dateRangeLabel && <p style={{ fontSize: 11, color: '#a1a1aa', marginTop: 1 }}>{dateRangeLabel}</p>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {syncLabel && <span style={{ fontSize: 11, color: '#a1a1aa' }}>Synced {syncLabel}</span>}
            <PillDropdown value={timeRange} options={timeOptions} onChange={setTimeRange} icon={<CalendarIcon />} />
            <PillDropdown value={client} options={clientOptions} onChange={setClient} icon={<UserIcon />} />
          </div>
        </div>

        <div style={{ padding: '20px', maxWidth: 1200 }}>

        {error && (
          <div style={{ background: '#fff0f3', border: '1px solid #fca5a5', borderRadius: 10, padding: '10px 16px', marginBottom: 16, color: '#f31260', fontSize: 13 }}>
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
              <div key={i} style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Skeleton h={10} w={90} />
                  <Skeleton h={18} w={52} radius={999} />
                </div>
                <Skeleton h={28} w={110} />
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
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#11181c' }}>Monthly Recovery</h3>
              <span style={{ fontSize: 11, color: '#a1a1aa', background: '#f4f4f5', borderRadius: 999, padding: '3px 10px' }}>Last 8 months</span>
            </div>
            {loadingHistory ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 140 }}>
                {[60,80,45,100,70,90,55,85].map((h, i) => <Skeleton key={i} h={h} w={32} radius={7} />)}
              </div>
            ) : (
              <SvgBarChart data={chartHistory} />
            )}
          </div>

          {/* Donut chart */}
          <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#11181c', marginBottom: 16 }}>By Category</h3>
            {loadingAnalytics ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[1,2,3,4,5].map(i => <Skeleton key={i} h={10} />)}
              </div>
            ) : (
              <DonutChart data={categoryData ?? []} />
            )}
          </div>
        </div>

        </div>{/* end inner padding div */}
      </div>
    </>
  );
}
