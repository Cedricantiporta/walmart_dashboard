'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { DashboardAnalytics, Invoice, BillingInsights, MonthlyHistory } from '@/types';
import { clientGet, clientSet } from '@/lib/client-cache';
import { useSidebar } from '@/components/DashboardShell';
import AiChat from '@/components/AiChat';

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
  const r = Math.min(w / 2, h / 2);
  if (h < 1) return '';
  return `M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r} V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
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
  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
  const [hovered, setHovered] = useState<string | null>(null);
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
          border: 'none', background: '#eaebec',
          color: '#11181c', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', outline: 'none', whiteSpace: 'nowrap',
        }}
      >
        {icon && <span style={{ color: '#11181c', display: 'flex' }}>{icon}</span>}
        {selected?.label}
        <span style={{ color: '#11181c', display: 'flex' }}><ChevronDownIcon /></span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          background: '#fff', border: '1px solid #e4e4e7', borderRadius: 18,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100,
          minWidth: 190, maxHeight: 240, overflowY: 'auto',
        }}>
          <div style={{ padding: 4 }}>
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              onMouseEnter={() => setHovered(opt.value)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                borderRadius: 999,
                color: '#11181c',
                background: hovered === opt.value ? '#e4e4e7' : (opt.value === value ? '#eaebec' : 'transparent'),
                fontWeight: opt.value === value ? 600 : 400,
                transition: 'background 0.1s',
              }}
            >
              {opt.label}
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── count-up animation ────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1100): number {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (target === 0) { setDisplay(0); return; }
    let startTs: number | null = null;
    let raf: number;
    function step(ts: number) {
      if (!startTs) startTs = ts;
      const progress = Math.min((ts - startTs) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(target * eased);
      if (progress < 1) raf = requestAnimationFrame(step);
      else setDisplay(target);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

// ── metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, trend, format = 'currency',
}: {
  label: string; value: number; sub?: string; trend?: number; format?: 'currency' | 'number';
}) {
  const animated = useCountUp(value);
  const trendUp = trend !== undefined && trend >= 0;

  let mainDisplay: React.ReactNode;
  if (format === 'currency') {
    const full = fmtFull(animated);
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
    mainDisplay = String(Math.round(animated));
  }

  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', minWidth: 0, boxShadow: '0 2px 6px rgba(0,0,0,0.06)', animation: 'cardIn 0.4s ease-out both' }}>
      {/* Label + trend pill on same row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#71717a' }}>{label}</div>
        {trend !== undefined && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: trendUp ? '#17c964' : '#f31260', background: trendUp ? '#f0fdf4' : '#fff0f3', borderRadius: 999, padding: '2px 7px', flexShrink: 0 }}>
            {trendUp ? <ArrowUp /> : <ArrowDown />}
            {Math.abs(trend).toFixed(1)}%
          </div>
        )}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#11181c', lineHeight: 1.15, letterSpacing: '-0.02em', marginTop: 4 }}>
        {mainDisplay}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ── bar chart (two-tone pill bars + hover tooltip) ────────────────────────────

function SvgBarChart({ data }: { data: { label: string; recovered: number; fee: number }[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });

  if (!data.length) return <div style={{ color: '#a1a1aa', fontSize: 13 }}>No data</div>;

  const maxVal = Math.max(...data.map(d => d.recovered), 1);
  const H = 200, padTop = 36, padBot = 28;
  const n = data.length;
  const gap = 18;
  const barW = n > 0 ? Math.floor((600 - (n - 1) * gap) / n) : 40;
  const totalW = n * (barW + gap) - gap;
  const svgH = H + padTop + padBot;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${totalW + 2} ${svgH}`} width="100%" height={svgH} style={{ display: 'block', overflow: 'visible' }}>
        {data.map((d, i) => {
          const recoveredH = Math.max((d.recovered / maxVal) * H, 3);
          const x = i * (barW + gap);
          const recoveredY = padTop + (H - recoveredH);
          const month = d.label.split(' ')[0].slice(0, 3);
          const dimmed = hov !== null && hov !== i;

          return (
            <g key={i} style={{ cursor: 'pointer', animation: `barIn 0.55s cubic-bezier(0.34,1.4,0.64,1) ${i * 0.045}s both` }}
              onMouseEnter={e => { setHov(i); setTip({ x: e.clientX, y: e.clientY }); }}
              onMouseLeave={() => setHov(null)}
              onMouseMove={e => setTip({ x: e.clientX, y: e.clientY })}
            >
              {/* recovered amount label above bar */}
              <text x={x + barW / 2} y={recoveredY - 5} textAnchor="middle" fontSize={9} fill="#374151" fontWeight={600}>{fmtCompact(d.recovered)}</text>
              {/* recovered — blue full-height pill */}
              <path d={pillBarPath(x, recoveredY, barW, recoveredH)} fill="#006FEE" opacity={dimmed ? 0.35 : 1} style={{ transition: 'opacity 0.15s' }} />
              <text x={x + barW / 2} y={padTop + H + 18} textAnchor="middle" fontSize={11} fill="#71717a" fontWeight={500}>{month}</text>
            </g>
          );
        })}
      </svg>

      {hov !== null && (
        <div style={{ position: 'fixed', left: tip.x + 12, top: tip.y - 104, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 10, padding: '10px 14px', fontSize: 12, zIndex: 200, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 162 }}>
          <div style={{ color: '#71717a', fontSize: 11, fontWeight: 600, marginBottom: 7 }}>{data[hov].label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#006FEE', flexShrink: 0 }} />
            <span style={{ color: '#71717a', flex: 1 }}>Recovered</span>
            <span style={{ fontWeight: 700, color: '#11181c' }}>{fmtFull(data[hov].recovered)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#11181c', flexShrink: 0 }} />
            <span style={{ color: '#71717a', flex: 1 }}>Fee</span>
            <span style={{ fontWeight: 700, color: '#11181c' }}>{fmtFull(data[hov].fee)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── gauge chart (semicircle + legend below) ───────────────────────────────────

const CHART_COLORS = [
  '#0071CE', // Walmart blue
  '#F5A524', // Walmart orange
  '#6BB8F5', // light blue
  '#FFCA7A', // light orange
  '#004B9A', // darker blue
  '#C97A00', // darker orange
  '#A8D4F7', // very light blue
  '#FFE0A0', // very light orange
];

function GaugeChart({ data, totalRate = 0 }: { data: { category: string; amount: number }[]; totalRate?: number }) {
  const [hov, setHov] = useState<number | null>(null);
  const [tip, setTip] = useState({ x: 0, y: 0 });

  if (!data.length) return <div style={{ color: '#a1a1aa', fontSize: 13 }}>No data</div>;

  const total = data.reduce((s, d) => s + d.amount, 0);
  const cx = 120, cy = 108, outerR = 96, innerR = 60;
  let cum = 0;
  const slices = data.slice(0, 8).map((d, i) => {
    const frac = d.amount / total;
    const start = 270 + cum * 180;
    cum += frac;
    return { ...d, frac, start, end: 270 + cum * 180, color: CHART_COLORS[i % CHART_COLORS.length] };
  });

  const GCX = 140, GCY = 128, GOR = 118, GIR = 74;

  return (
    <div>
      <svg viewBox="0 0 280 132" width="100%" style={{ display: 'block', overflow: 'visible' }}>
        {/* grey background arc */}
        <path d={donutPath(GCX, GCY, GOR, GIR, 270, 450)} fill="#f4f4f5" />
        {slices.map((s, i) => {
          const isHov = hov === i;
          return (
            <path key={i}
              d={donutPath(GCX, GCY, isHov ? GOR + 10 : GOR, GIR, s.start, s.end)}
              fill={s.color}
              opacity={hov === null || isHov ? 1 : 0.2}
              onMouseEnter={e => { setHov(i); setTip({ x: e.clientX, y: e.clientY }); }}
              onMouseLeave={() => setHov(null)}
              onMouseMove={e => setTip({ x: e.clientX, y: e.clientY })}
              style={{ cursor: 'pointer', transition: 'opacity 0.15s, d 0.15s', outline: 'none', animation: `sliceIn 0.45s ease-out ${i * 0.07}s both`, filter: isHov ? 'drop-shadow(0 2px 8px rgba(0,0,0,0.18))' : 'none' }}
            />
          );
        })}
      </svg>

      {/* Category legend — 1 per row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
        {slices.map((s, i) => (
          <div key={i}
            onMouseEnter={() => setHov(i)}
            onMouseLeave={() => setHov(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, opacity: hov === null || hov === i ? 1 : 0.35, transition: 'opacity 0.15s', cursor: 'pointer' }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#71717a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.category || 'Other'}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#11181c', flexShrink: 0 }}>{fmtCompact(s.amount)}</span>
          </div>
        ))}
      </div>

      {hov !== null && (
        <div style={{ position: 'fixed', left: tip.x + 12, top: tip.y - 84, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8, padding: '8px 12px', fontSize: 12, zIndex: 200, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 164 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: slices[hov].color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: '#11181c', flex: 1 }}>{slices[hov].category || 'Other'}</span>
            <span style={{ fontSize: 11, color: '#71717a' }}>{(slices[hov].frac * 100).toFixed(1)}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: '#71717a', marginBottom: 3 }}>
            <span>Recovered</span>
            <span style={{ fontWeight: 600, color: '#006FEE' }}>{fmtFull(slices[hov].amount)}</span>
          </div>
          {totalRate > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: '#71717a' }}>
              <span>Fee</span>
              <span style={{ fontWeight: 600, color: '#11181c' }}>{fmtFull(slices[hov].amount * totalRate)}</span>
            </div>
          )}
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

function parseSummaryCache(d: unknown[]): MonthlyHistory[] {
  return d.map((r: unknown) => {
    const row = r as { month_key: string; label: string; recovered: number; fee: number; approved_count: number; declined_count: number; growth: number };
    return { label: row.label, sort: row.month_key, recovered: row.recovered, fee: row.fee, approvedCount: row.approved_count, declinedCount: row.declined_count, growth: row.growth };
  });
}

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState('thisMonth');
  const [client, setClient] = useState('all');
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerStart, setPickerStart] = useState('');
  const [pickerEnd, setPickerEnd] = useState('');

  // Initialize state from cache so tab-switching never shows skeletons when data exists
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [clientList, setClientList] = useState<string[]>(() => clientGet<any>('initial-payload')?.clientList ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [history, setHistory] = useState<Invoice[]>(() => clientGet<any>('initial-payload')?.history ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [billingInsights, setBillingInsights] = useState<BillingInsights | null>(() => clientGet<any>('initial-payload')?.billingInsights ?? null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(() => clientGet<any>('initial-payload')?.dashboardAnalytics ?? null);
  const [fullMonthlyHistory, setFullMonthlyHistory] = useState<MonthlyHistory[]>(() => {
    const c = clientGet<unknown[]>('summary');
    return Array.isArray(c) && c.length ? parseSummaryCache(c) : [];
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [lastSync, setLastSync] = useState<string>(() => clientGet<any>('initial-payload')?.lastSyncTime ?? '');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rmsCasesCount, setRmsCasesCount] = useState<number | null>(() => clientGet<any>('initial-payload')?.rmsCasesCount ?? null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pendingAmount, setPendingAmount] = useState<number>(() => clientGet<any>('initial-payload')?.pendingAmount ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [loadingInit, setLoadingInit] = useState(() => !clientGet<any>('initial-payload'));
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(() => {
    const c = clientGet<unknown[]>('summary');
    return !Array.isArray(c) || c.length === 0;
  });
  const [error, setError] = useState('');

  const { onToggle, setSyncTime } = useSidebar();
  const timeOptions = getTimeOptions();
  const datePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDatePicker) return;
    function handler(e: MouseEvent) {
      const path = e.composedPath ? e.composedPath() : [];
      const clickedInside = datePickerRef.current && (
        datePickerRef.current.contains(e.target as Node) ||
        path.some(el => el === datePickerRef.current)
      );
      if (!clickedInside) setShowDatePicker(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDatePicker]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cached = clientGet<any>('initial-payload');
    if (cached) {
      setClientList(cached.clientList ?? []);
      setHistory(cached.history ?? []);
      setBillingInsights(cached.billingInsights ?? null);
      setLastSync(cached.lastSyncTime ?? '');
      setRmsCasesCount(cached.rmsCasesCount ?? 0);
      setPendingAmount(cached.pendingAmount ?? 0);
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
          if (d.lastSyncTime) setSyncTime(d.lastSyncTime);
          setRmsCasesCount(d.rmsCasesCount ?? 0);
          setPendingAmount(d.pendingAmount ?? 0);
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
    const isYYYYMM = /^\d{4}-\d{2}$/.test(timeRange);
    const effectiveRange = timeRange === 'custom' && customRange ? 'custom' : (isYYYYMM ? 'specificMonth' : timeRange);
    const params = new URLSearchParams({ timeRange: effectiveRange, client });
    if (isYYYYMM) params.set('startDate', `${timeRange}-01`);
    if (timeRange === 'custom' && customRange) {
      params.set('startDate', customRange.start);
      params.set('endDate', customRange.end);
    }
    const analyticsKey = `analytics:${timeRange}:${client}`;
    const cachedAnalytics = clientGet<DashboardAnalytics>(analyticsKey);
    if (cachedAnalytics) { setAnalytics(cachedAnalytics); return; }
    setLoadingAnalytics(true);
    fetch(`/api/dashboard/analytics?${params}`)
      .then(r => r.json())
      .then(d => { clientSet(analyticsKey, d); setAnalytics(d); setLoadingAnalytics(false); })
      .catch(() => setLoadingAnalytics(false));
  }, [timeRange, client, loadingInit, customRange]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const { metrics, trends, categoryData = [] } = analytics ?? {};
  const totalFeesBilled = fullMonthlyHistory.reduce((s, h) => s + h.fee, 0);

  const chartHistory = [...fullMonthlyHistory]
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .slice(-12)
    .map(h => ({ label: h.label, recovered: h.recovered, fee: h.fee }));

  const dateRangeLabel = analytics?.dateRange
    ? (() => {
        const s = new Date(analytics.dateRange.start);
        const e = new Date(analytics.dateRange.end);
        if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
        return `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      })()
    : '';

  const displayDateRange = (() => {
    const now = new Date();
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (timeRange === 'custom' && customRange) {
      const s = new Date(customRange.start + 'T12:00:00');
      const e = new Date(customRange.end + 'T12:00:00');
      return `${fmt(s)} – ${fmt(e)}`;
    }
    if (timeRange === 'thisMonth') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return `${fmt(s)} – ${fmt(e)}`;
    }
    if (timeRange === 'lastMonth') {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return `${fmt(s)} – ${fmt(e)}`;
    }
    if (timeRange === 'last3Months') {
      const s = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return `${fmt(s)} – ${fmt(e)}`;
    }
    if (/^\d{4}-\d{2}$/.test(timeRange)) {
      const [y, m] = timeRange.split('-').map(Number);
      const s = new Date(y, m - 1, 1);
      const e = new Date(y, m, 0);
      return `${fmt(s)} – ${fmt(e)}`;
    }
    return dateRangeLabel;
  })();

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
        @keyframes barIn { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
        @keyframes sliceIn { from { opacity:0; transform-box:fill-box; transform-origin:center; transform:scale(0.7); } to { opacity:1; transform:scale(1); } }
        @keyframes cardIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        button:hover { opacity: .88; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

        {/* Top bar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, padding: '4px 20px 8px', height: 52, background: '#f4f4f5' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <button onClick={onToggle} title="Toggle sidebar" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#11181c', flexShrink: 0, outline: 'none' }}>
              <PanelIcon />
            </button>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#11181c', letterSpacing: '-0.02em' }}>{greeting}</h1>
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

        {/* Dropdowns row — date range left, selectors right */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <div ref={datePickerRef} style={{ position: 'relative' }}>
            <button
              onClick={() => { setPickerStart(customRange?.start ?? ''); setPickerEnd(customRange?.end ?? ''); setShowDatePicker(p => !p); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: '#11181c', background: '#eaebec', borderRadius: 999, padding: '6px 14px', border: 'none', cursor: 'pointer', outline: 'none' }}
            >
              <CalendarIcon /> {displayDateRange}
            </button>
            {showDatePicker && (
              <div style={{ position: 'absolute', top: '110%', left: 0, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.14)', zIndex: 300, padding: '20px', minWidth: 300 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#11181c' }}>Custom Range</span>
                  <button onClick={() => setShowDatePicker(false)} style={{ width: 24, height: 24, borderRadius: '50%', border: 'none', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a', fontSize: 16, lineHeight: 1, outline: 'none', flexShrink: 0 }}>×</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ background: '#f9fafb', borderRadius: 12, padding: '10px 14px', border: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#a1a1aa', letterSpacing: '0.08em', marginBottom: 5, textTransform: 'uppercase' as const }}>From</div>
                    <input type="date" value={pickerStart} onChange={e => setPickerStart(e.target.value)} style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 14, fontWeight: 600, color: '#11181c', outline: 'none', cursor: 'pointer' }} />
                  </div>
                  <div style={{ background: '#f9fafb', borderRadius: 12, padding: '10px 14px', border: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#a1a1aa', letterSpacing: '0.08em', marginBottom: 5, textTransform: 'uppercase' as const }}>To</div>
                    <input type="date" value={pickerEnd} onChange={e => setPickerEnd(e.target.value)} style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 14, fontWeight: 600, color: '#11181c', outline: 'none', cursor: 'pointer' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => { setCustomRange(null); setTimeRange('thisMonth'); setShowDatePicker(false); }} style={{ flex: 1, padding: '9px', borderRadius: 999, border: '1px solid #e4e4e7', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151', outline: 'none' }}>Reset</button>
                  <button onClick={() => { if (pickerStart && pickerEnd) { setCustomRange({ start: pickerStart, end: pickerEnd }); setTimeRange('custom'); } setShowDatePicker(false); }} disabled={!pickerStart || !pickerEnd} style={{ flex: 1, padding: '9px', borderRadius: 999, border: 'none', background: pickerStart && pickerEnd ? '#006FEE' : '#e4e4e7', color: pickerStart && pickerEnd ? '#fff' : '#a1a1aa', fontSize: 13, fontWeight: 700, cursor: !pickerStart || !pickerEnd ? 'not-allowed' : 'pointer', outline: 'none' }}>Apply</button>
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
          <PillDropdown value={timeRange === 'custom' ? 'thisMonth' : timeRange} options={timeOptions} onChange={v => { setTimeRange(v); setCustomRange(null); setShowDatePicker(false); }} icon={<CalendarIcon />} />
          <PillDropdown value={client} options={clientOptions} onChange={setClient} icon={<UserIcon />} />
          </div>
        </div>

        {/* Metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 16 }}>
          {!metrics ? (
            [1,2,3,4].map(i => (
              <div key={i} style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Skeleton h={10} w={90} />
                  <Skeleton h={18} w={52} radius={999} />
                </div>
                <Skeleton h={28} w={110} />
              </div>
            ))
          ) : (
            <>
              <MetricCard label="Reimbursed" value={metrics.totalReimbursed} trend={displayTrends?.totalReimbursed} />
              <MetricCard label="Fees" value={metrics.totalFees} trend={displayTrends?.totalFees} />
              <MetricCard label="Cases" value={metrics.approvedCases} trend={displayTrends?.approvedCases} format="number" />
              <MetricCard label="Pending" value={pendingAmount} />
            </>
          )}
        </div>

        {/* Charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 12, marginBottom: 16 }}>
          {/* Monthly bar chart */}
          <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#11181c' }}>Monthly Recovery</h3>
              <span style={{ fontSize: 11, color: '#a1a1aa', background: '#f4f4f5', borderRadius: 999, padding: '3px 10px' }}>Last 12 months</span>
            </div>
            {loadingHistory && !chartHistory.length ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 200 }}>
                {[60,80,45,100,70,90,55,85,65,95,75,110].map((h, i) => <Skeleton key={i} h={h} w={26} radius={7} />)}
              </div>
            ) : (
              <SvgBarChart data={chartHistory} />
            )}
          </div>

          {/* Donut chart */}
          <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#11181c', marginBottom: 16 }}>By Category</h3>
            {loadingAnalytics && !categoryData?.length ? (
              <div>
                <Skeleton h={110} w="100%" radius={10} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 8px', marginTop: 14 }}>
                  {[1,2,3,4,5,6].map(i => <Skeleton key={i} h={10} />)}
                </div>
              </div>
            ) : (
              <GaugeChart data={categoryData ?? []} totalRate={metrics && metrics.totalReimbursed > 0 ? metrics.totalFees / metrics.totalReimbursed : 0} />
            )}
          </div>
        </div>

        </div>{/* end inner padding div */}
      </div>
      {/* <AiChat /> */}
    </>
  );
}
