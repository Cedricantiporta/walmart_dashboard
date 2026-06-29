'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { clientGet, clientSet, clientClear } from '@/lib/client-cache';
import { downloadInvoicePDF, generateInvoicePDFBlob, generateInvoicePDFBlobRaw } from '@/lib/invoice-pdf';
import { useSidebar } from '@/components/DashboardShell';
import { supabase } from '@/lib/supabase';

// ── formatters ────────────────────────────────────────────────────────────────

const fmtUSD = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
const fmtPct = (r: number) => `${(r * 100 % 1 === 0 ? (r * 100).toFixed(0) : (r * 100).toFixed(1))}%`;
const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const isoToday = () => new Date().toISOString().slice(0, 10);

// ── types ─────────────────────────────────────────────────────────────────────

type BillingCase = {
  caseId: string; claimType: string; postingDate: string;
  amount: number; fee: number; isCurrentMonth: boolean;
  gtin?: string; sku_id?: string; unit_amount?: number; reimbursed_qty?: number;
};
type ClientBilling = {
  clientName: string; rate: number; totalAmount: number; totalFee: number;
  currentMonthFee: number; prevMonthFee: number; cases: BillingCase[];
  previouslyBilledFee: number; previouslyBilledReimbursed: number;
  mostRecentBilledDate?: string | null;
  pendingCases: BillingCase[]; pendingAmount: number; pendingFee: number;
  overdueCases: BillingCase[]; overdueAmount: number; overdueFee: number;
};
type BillingContactInfo = {
  client_name: string; invoice_date: string | null;
  payment_terms: string | null; address: string | null;
};
type BillingData = {
  clients: ClientBilling[]; totalFee: number; totalAmount: number;
  totalCases: number; currentMonthStart: string; isGracePeriod: boolean;
  billingSummaryInfo: Record<string, BillingContactInfo>;
};
type Invoice = {
  id?: number; invoice_number: string; client_name: string;
  billed_date: string; billed_fee: number; total_reimbursed: number;
  case_ids: string[];
  case_snapshot: { case_id: string; claim_type: string; rms_posting_date: string; reimbursement_amount: number }[];
  pdf_url?: string;
};

// ── helpers ───────────────────────────────────────────────────────────────────

function matchAmt(q: string, amount: number): boolean {
  const s = q.replace(/[$,]/g, '').trim();
  if (!s || !/^\d/.test(s)) return false;
  return Math.floor(Math.abs(amount)).toString().startsWith(s.split('.')[0]);
}

const GAS_HEADERS = 'Invoice To,Country,Walmart Posting Date,Item Description,Claim Type,GTIN,SKU ID,Case ID,Unit Amount,Rate,Quantity,Total Reimbursement,Conversion Rate,Currency,Total Reimbursed USD,Fee Amount';

function fmtMDY(iso: string) {
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function gasRow(clientName: string, rate: number, cs: BillingCase) {
  const unitAmt = (cs.unit_amount ?? cs.amount).toFixed(2);
  const qty = cs.reimbursed_qty ?? 1;
  const total = cs.amount.toFixed(2);
  return [`"${clientName}"`, 'US', fmtMDY(cs.postingDate), `"Reimbursement Recovery for Case ID ${cs.caseId} for $${total}"`, cs.claimType || 'N/A', cs.gtin || '', cs.sku_id || '', cs.caseId, `$${unitAmt}`, fmtPct(rate), String(qty), `$${total}`, '', 'USD', `$${total}`, `$${cs.fee.toFixed(2)}`].join(',');
}

function buildGasCSV(invNum: string, clients: { clientName: string; rate: number; cases: BillingCase[] }[]) {
  const dataRows = clients.flatMap(c => c.cases.filter(cs => !!cs.postingDate).map(cs => gasRow(c.clientName, c.rate, cs)));
  return [`${invNum},,,,,,,,,,,,,,`, GAS_HEADERS, ...dataRows].join('\n');
}

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function downloadClientCSV(client: ClientBilling, invNum = '') {
  triggerDownload(buildGasCSV(invNum, [client]), `invoice-${client.clientName.replace(/\s+/g, '-')}-${isoToday()}.csv`);
}

// ── skeleton ──────────────────────────────────────────────────────────────────

function Sk({ h = 16, w = '100%' }: { h?: number; w?: string | number }) {
  return (
    <div style={{ height: h, width: w, borderRadius: 6, background: 'linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
  );
}

// ── avatar + icons ────────────────────────────────────────────────────────────

function avatarGradient(name: string): [string, string] {
  const pairs: [string, string][] = [
    ['#006FEE','#7828C8'],['#17c964','#006FEE'],['#f31260','#7828C8'],
    ['#f5a524','#f31260'],['#7828C8','#17c964'],['#00b7eb','#006FEE'],
    ['#f31260','#f5a524'],['#17c964','#7828C8'],
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return pairs[h % pairs.length];
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const [from, to] = avatarGradient(name);
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: `linear-gradient(135deg,${from} 0%,${to} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: Math.round(size * 0.38), fontWeight: 700, flexShrink: 0 }}>
    </div>
  );
}

const IconFilter = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
const IconSort = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="8" y2="18"/></svg>;
const IconCols = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>;
const IconInvoice = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
const PanelIcon = () => <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="16" height="16" rx="3"/><line x1="7" y1="2" x2="7" y2="18"/></svg>;

const toolbarPill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontSize: 13, fontWeight: 500, color: '#11181c',
  background: '#eaebec', border: 'none',
  borderRadius: 999, padding: '6px 13px',
  cursor: 'pointer', outline: 'none', flexShrink: 0,
};

const OPTIONAL_COLS = [
  { key: 'rate',      label: 'Rate',      width: '80px',  compactWidth: '58px'  },
  { key: 'recovered', label: 'Recovered', width: '130px', compactWidth: '88px' },
  { key: 'fee',       label: 'Fee',       width: '120px', compactWidth: '88px' },
  { key: 'cases',     label: 'Cases',     width: '70px',  compactWidth: '52px'  },
] as const;

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

// ── invoice modal ─────────────────────────────────────────────────────────────

const DlIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v13"/><polyline points="7 12 12 17 17 12"/><line x1="3" y1="21" x2="21" y2="21"/>
  </svg>
);

function InvoiceModal({ client, invoiceNumber, billingContact, onClose, onSaved }: {
  client: ClientBilling; invoiceNumber: string;
  billingContact: BillingContactInfo | null;
  onClose: () => void; onSaved: (inv: Invoice) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const billedDate = isoToday();
  const billedCases = client.cases.filter(c => !!c.postingDate);
  const pdfData = {
    invoice_number: invoiceNumber, client_name: client.clientName,
    client_address: billingContact?.address ?? null, billed_date: billedDate,
    billed_fee: client.totalFee, total_reimbursed: client.totalAmount,
    case_ids: [...new Set(billedCases.map(c => c.caseId))],
  };
  const pdfCases = billedCases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount }));

  useEffect(() => {
    let url = '';
    generateInvoicePDFBlob(pdfData, pdfCases).then(u => { url = u; setPdfUrl(u); });
    return () => { if (url) URL.revokeObjectURL(url); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleMarkAsBilled() {
    setSaving(true); setErr('');
    await downloadInvoicePDF(pdfData, pdfCases);
    const inv = {
      invoice_number: invoiceNumber, client_name: client.clientName,
      billed_date: new Date(billedDate + 'T12:00:00').toISOString(),
      billed_fee: client.totalFee, total_reimbursed: client.totalAmount,
      case_ids: pdfData.case_ids,
      case_snapshot: billedCases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount, gtin: c.gtin ?? '', sku_id: c.sku_id ?? '', unit_amount: c.unit_amount ?? c.amount, reimbursed_qty: c.reimbursed_qty ?? 1 })),
      pdf_url: '',
    };
    const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv) });
    const data = await res.json();
    if (!res.ok) { setErr(data.error ?? 'Failed to save'); setSaving(false); return; }
    onSaved(data.invoice ?? inv);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 720, boxShadow: '0 32px 80px rgba(0,0,0,0.28)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 48px)' }}>

        {/* Toolbar */}
        <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
          {/* Row 1: client name | invoice# | X */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#111827', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.clientName}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>{invoiceNumber}</div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #e5e7eb', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 15, lineHeight: 1, flexShrink: 0, outline: 'none', marginLeft: 4 }}>×</button>
          </div>
          {/* Row 2: fee | buttons far right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.02em' }}>{fmtUSD(client.totalFee)}</div>
            <div style={{ flex: 1 }} />
            <button onClick={() => downloadClientCSV(client, invoiceNumber)} title="Download CSV" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#f9fafb', fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer', outline: 'none' }}>
              <DlIcon /> CSV
            </button>
            <button onClick={() => downloadInvoicePDF(pdfData, pdfCases)} title="Download PDF" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#f9fafb', fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer', outline: 'none' }}>
              <DlIcon /> PDF
            </button>
            {!confirming && (
              <button onClick={() => setConfirming(true)} style={{ padding: '4px 10px', border: 'none', borderRadius: 999, background: '#2563eb', fontSize: 11, fontWeight: 700, color: '#fff', cursor: 'pointer', outline: 'none' }}>
                Mark Billed
              </button>
            )}
          </div>
        </div>

        {/* Confirm strip */}
        {confirming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: '#fffbeb', borderBottom: '1px solid #fcd34d', flexShrink: 0 }}>
            <span style={{ flex: 1, fontSize: 12, color: '#92400e' }}><strong>Mark {client.clientName} as billed?</strong> PDF will download and invoice saved.</span>
            <button onClick={handleMarkAsBilled} disabled={saving} style={{ padding: '6px 14px', border: 'none', borderRadius: 999, background: saving ? '#86efac' : '#16a34a', fontSize: 12, fontWeight: 700, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', outline: 'none' }}>
              {saving ? 'Saving…' : '✓ Confirm'}
            </button>
            <button onClick={() => setConfirming(false)} style={{ padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer', outline: 'none' }}>Cancel</button>
          </div>
        )}

        {err && <div style={{ padding: '8px 16px', background: '#fef2f2', color: '#dc2626', fontSize: 12, flexShrink: 0 }}>{err}</div>}

        {/* PDF preview */}
        <div style={{ flex: 1, background: '#e5e7eb', minHeight: 480, position: 'relative', overflow: 'hidden' }}>
          {pdfUrl ? (
            <iframe src={pdfUrl + '#toolbar=0&navpanes=0&scrollbar=1'} style={{ width: '100%', height: '100%', minHeight: 480, border: 'none', display: 'block' }} title="Invoice Preview" />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 13 }}>
              Generating preview…
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── case sidebar ──────────────────────────────────────────────────────────────

type HistoricalCase = {
  case_id: string; claim_type: string; rms_posting_date: string;
  reimbursement_amount: number; invoice_number: string; billed_date: string;
  gtin?: string; sku_id?: string; unit_amount?: number; reimbursed_qty?: number; rate?: number;
};

// Module-level cache persists across drawer open/close without refetching
const prevCasesCache = new Map<string, HistoricalCase[]>();

function CaseSidebar({ client, highlight, view, isPendingTab, isOverdueTab }: { client: ClientBilling; highlight?: string; view: 'current' | 'previous'; isPendingTab?: boolean; isOverdueTab?: boolean }) {
  const q = highlight?.toLowerCase() ?? '';
  const firstMatchIndex = q ? client.cases.findIndex(c => c.caseId.toLowerCase().includes(q)) : -1;
  const firstMatchRef = useRef<HTMLDivElement | null>(null);
  const prevFirstMatchRef = useRef<HTMLDivElement | null>(null);
  const [prevCases, setPrevCases] = useState<HistoricalCase[] | null>(() => prevCasesCache.get(client.clientName) ?? null);
  const [loadingPrev, setLoadingPrev] = useState(false);

  useEffect(() => {
    if (view === 'current' && firstMatchRef.current) firstMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (view === 'previous' && prevFirstMatchRef.current) prevFirstMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight, client.clientName, view, prevCases]);

  // On client change: reset from cache or null, then preload in background
  useEffect(() => {
    const cached = prevCasesCache.get(client.clientName);
    if (cached) { setPrevCases(cached); return; }
    setPrevCases(null);
    // Start preloading immediately so Previous tab is instant when clicked
    doFetchPrevious(client.clientName);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.clientName]);

  const doFetchPrevious = useCallback(async (clientName: string) => {
    if (prevCasesCache.has(clientName)) { setPrevCases(prevCasesCache.get(clientName)!); return; }
    setLoadingPrev(true);
    // Step 1: get all invoices for this client (for case_ids + rate)
    const { data: invs } = await supabase
      .from('invoices')
      .select('invoice_number, billed_date, total_reimbursed, billed_fee, case_ids')
      .eq('client_name', clientName)
      .order('billed_date', { ascending: false });
    if (!invs?.length) {
      prevCasesCache.set(clientName, []);
      setPrevCases([]); setLoadingPrev(false); return;
    }
    const invMap: Record<string, { invoice_number: string; billed_date: string; rate: number }> = {};
    const allIds: string[] = [];
    for (const inv of invs) {
      const rate = Number(inv.total_reimbursed) > 0 ? Number(inv.billed_fee) / Number(inv.total_reimbursed) : 0;
      for (const id of (inv.case_ids ?? [])) {
        invMap[String(id)] = { invoice_number: inv.invoice_number, billed_date: inv.billed_date, rate };
        allIds.push(String(id));
      }
    }
    const caseRows: { case_id: string; claim_type: string; rms_posting_date: string; reimbursement_amount: number; gtin?: string; sku_id?: string; unit_amount?: number; reimbursed_qty?: number }[] =
      allIds.length > 0
        ? await fetch('/api/cases/by-ids', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...new Set(allIds)] }) })
            .then(r => r.ok ? r.json() : []).catch(() => [])
        : [];
    const cases: HistoricalCase[] = caseRows
      .filter(c => !!c.rms_posting_date)
      .map(c => ({
        ...c,
        invoice_number: invMap[c.case_id]?.invoice_number ?? '',
        billed_date: invMap[c.case_id]?.billed_date ?? '',
        rate: invMap[c.case_id]?.rate ?? 0,
      })).sort((a, b) => (b.billed_date ?? '').localeCompare(a.billed_date ?? ''));
    prevCasesCache.set(clientName, cases);
    setPrevCases(cases);
    setLoadingPrev(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const CG = '72px 1fr 70px 58px';
  const prevTotalAmt = (prevCases ?? []).reduce((s, c) => s + c.reimbursement_amount, 0);

  const showOverdueTotal = isOverdueTab && (client.overdueCases ?? []).length > 0;
  const showPendingTotal = isPendingTab && (client.pendingCases ?? []).length > 0;
  const showCurrentTotal = !isOverdueTab && !isPendingTab && view === 'current' && client.cases.length > 0;
  const showPrevTotal = !isOverdueTab && !isPendingTab && view === 'previous' && !loadingPrev && (prevCases?.length ?? 0) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Scrollable cases — no total rows inside */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {isOverdueTab ? (
          (client.overdueCases ?? []).length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>No overdue cases.</div>
          ) : (client.overdueCases ?? []).map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderBottom: '1px solid #f3f4f6', background: '#fff7ed', fontSize: 11, alignItems: 'center' }}>
              <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.caseId}</span>
              <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.claimType || 'N/A'}</span>
              <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDate(c.postingDate)}</span>
              <span style={{ fontWeight: 600, color: '#c2410c', textAlign: 'right' }}>{fmtUSD(c.amount)}</span>
            </div>
          ))
        ) : isPendingTab ? (
          (client.pendingCases ?? []).length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>No pending cases.</div>
          ) : (client.pendingCases ?? []).map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderBottom: '1px solid #f3f4f6', background: '#f0f7ff', fontSize: 11, alignItems: 'center' }}>
              <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.caseId}</span>
              <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.claimType || 'N/A'}</span>
              <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDate(c.postingDate)}</span>
              <span style={{ fontWeight: 600, color: '#1d4ed8', textAlign: 'right' }}>{fmtUSD(c.amount)}</span>
            </div>
          ))
        ) : view === 'current' ? (
          client.cases.map((c, i) => {
            const isMatch = q ? c.caseId.toLowerCase().includes(q) : false;
            return (
              <div key={i} ref={i === firstMatchIndex ? firstMatchRef : undefined}
                style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderBottom: '1px solid #f3f4f6', background: isMatch ? '#fef9c3' : (!c.isCurrentMonth ? '#fffbeb' : undefined), fontSize: 11, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.caseId}</span>
                <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.claimType || 'N/A'}</span>
                <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDate(c.postingDate)}</span>
                <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.amount)}</span>
              </div>
            );
          })
        ) : loadingPrev ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>Loading…</div>
        ) : prevCases?.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>No billing history found.</div>
        ) : (
          (() => {
            const prevMatchIndex = q ? (prevCases ?? []).findIndex(c => c.case_id.toLowerCase().includes(q)) : -1;
            return (prevCases ?? []).map((c, i) => {
              const isMatch = q ? c.case_id.toLowerCase().includes(q) : false;
              return (
                <div key={i} ref={i === prevMatchIndex ? prevFirstMatchRef : undefined}
                  style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 11, alignItems: 'center', background: isMatch ? '#fef9c3' : undefined }}>
                  <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.case_id}</span>
                  <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.claim_type || 'N/A'}</span>
                  <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDate(c.rms_posting_date.slice(0, 10))}</span>
                  <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.reimbursement_amount)}</span>
                </div>
              );
            });
          })()
        )}
      </div>

      {/* Sticky total — always at bottom edge */}
      {showOverdueTotal && (
        <div style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Overdue Total</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#c2410c', textAlign: 'right' }}>{fmtUSD(client.overdueAmount ?? 0)}</span>
        </div>
      )}
      {showPendingTotal && (
        <div style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Pending Total</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', textAlign: 'right' }}>{fmtUSD(client.pendingAmount ?? 0)}</span>
        </div>
      )}
      {showCurrentTotal && (
        <div style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Total</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</span>
        </div>
      )}
      {showPrevTotal && (
        <div style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Total</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(prevTotalAmt)}</span>
        </div>
      )}
    </div>
  );
}

// ── bulk modal ────────────────────────────────────────────────────────────────

function BulkModal({ rtbClients, startInvoiceNum, billingSummaryInfo, onClose, onAllBilled }: {
  rtbClients: ClientBilling[];
  startInvoiceNum: string;
  billingSummaryInfo: Record<string, BillingContactInfo>;
  onClose: () => void;
  onAllBilled: (count: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [err, setErr] = useState('');

  const parts = startInvoiceNum.split('-');
  const prefix = parts[0];
  const startN = parseInt(parts[1] ?? '1001');

  const clientsWithNums = rtbClients.filter(c => c.cases.length > 0).map((c, i) => ({
    client: c,
    invoiceNum: `${prefix}-${startN + i}`,
  }));

  const totalCases = clientsWithNums.reduce((s, { client }) => s + client.cases.length, 0);
  const totalFee = clientsWithNums.reduce((s, { client }) => s + client.totalFee, 0);
  const totalRecovered = clientsWithNums.reduce((s, { client }) => s + client.totalAmount, 0);

  async function handleAllCSVs() {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const { client, invoiceNum } of clientsWithNums) {
      const csv = buildGasCSV(invoiceNum, [client]);
      zip.file(`${invoiceNum}-${client.clientName.replace(/\s+/g, '-')}.csv`, csv);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `invoices-csvs-${isoToday()}.zip`; a.click();
  }

  async function handleAllPDFs() {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const { client, invoiceNum } of clientsWithNums) {
      const bc = billingSummaryInfo[client.clientName] ?? null;
      const billedCases = client.cases.filter(c => !!c.postingDate);
      const pdfData = { invoice_number: invoiceNum, client_name: client.clientName, client_address: bc?.address ?? null, billed_date: isoToday(), billed_fee: client.totalFee, total_reimbursed: client.totalAmount, case_ids: [...new Set(billedCases.map(c => c.caseId))] };
      const blob = await generateInvoicePDFBlobRaw(pdfData, billedCases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount })));
      zip.file(`${invoiceNum}-${client.clientName.replace(/\s+/g, '-')}.pdf`, blob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `invoices-pdfs-${isoToday()}.zip`; a.click();
  }

  async function handleMarkAllBilled() {
    setProgress({ current: 0, total: clientsWithNums.length });
    setErr('');
    for (let i = 0; i < clientsWithNums.length; i++) {
      const { client, invoiceNum } = clientsWithNums[i];
      const bc = billingSummaryInfo[client.clientName] ?? null;
      const billedCases = client.cases.filter(c => !!c.postingDate);
      const pdfData = { invoice_number: invoiceNum, client_name: client.clientName, client_address: bc?.address ?? null, billed_date: isoToday(), billed_fee: client.totalFee, total_reimbursed: client.totalAmount, case_ids: [...new Set(billedCases.map(c => c.caseId))] };
      const pdfCases = billedCases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount }));
      await downloadInvoicePDF(pdfData, pdfCases);
      const inv = { invoice_number: invoiceNum, client_name: client.clientName, billed_date: new Date(isoToday() + 'T12:00:00').toISOString(), billed_fee: client.totalFee, total_reimbursed: client.totalAmount, case_ids: pdfData.case_ids, case_snapshot: billedCases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount, gtin: c.gtin ?? '', sku_id: c.sku_id ?? '', unit_amount: c.unit_amount ?? c.amount, reimbursed_qty: c.reimbursed_qty ?? 1 })), pdf_url: '' };
      const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv) });
      if (!res.ok) { const d = await res.json(); setErr(d.error ?? 'Failed'); setProgress(null); return; }
      setProgress({ current: i + 1, total: clientsWithNums.length });
    }
    onAllBilled(clientsWithNums.length);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 520, boxShadow: '0 32px 80px rgba(0,0,0,0.28)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 17, color: '#11181c' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Bulk Invoice
            </div>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #e5e7eb', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 15, lineHeight: 1, outline: 'none' }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, background: '#eaebec', borderRadius: 999, padding: '3px 10px', color: '#374151' }}>{clientsWithNums.length} clients</span>
            <span style={{ fontSize: 12, fontWeight: 600, background: '#eaebec', borderRadius: 999, padding: '3px 10px', color: '#374151' }}>{totalCases} cases</span>
            <span style={{ fontSize: 12, fontWeight: 600, background: '#dbeafe', borderRadius: 999, padding: '3px 10px', color: '#1d4ed8' }}>{fmtUSD(totalRecovered)} recovered</span>
            <span style={{ fontSize: 12, fontWeight: 700, background: '#dcfce7', borderRadius: 999, padding: '3px 10px', color: '#15803d' }}>{fmtUSD(totalFee)} fee</span>
          </div>
        </div>

        {/* Client list */}
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {clientsWithNums.map(({ client, invoiceNum }) => (
            <div key={client.clientName} style={{ display: 'flex', alignItems: 'center', padding: '7px 20px', gap: 10, borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#11181c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.clientName}</div>
                <div style={{ fontSize: 10, color: '#71717a' }}>{client.cases.length} cases</div>
              </div>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#71717a', flexShrink: 0 }}>{invoiceNum}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#11181c', flexShrink: 0 }}>{fmtUSD(client.totalFee)}</span>
            </div>
          ))}
        </div>

        {err && <div style={{ padding: '8px 20px', background: '#fef2f2', color: '#dc2626', fontSize: 12 }}>{err}</div>}

        {/* Confirm strip */}
        {confirming && !progress && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: '#fffbeb', borderTop: '1px solid #fcd34d' }}>
            <span style={{ flex: 1, fontSize: 12, color: '#92400e' }}><strong>Mark all {clientsWithNums.length} clients as billed?</strong> A PDF will download for each one.</span>
            <button onClick={handleMarkAllBilled} style={{ padding: '6px 14px', border: 'none', borderRadius: 999, background: '#16a34a', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', outline: 'none' }}>✓ Confirm</button>
            <button onClick={() => setConfirming(false)} style={{ padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer', outline: 'none' }}>Cancel</button>
          </div>
        )}

        {/* Progress bar */}
        {progress && (
          <div style={{ padding: '12px 20px', background: '#f0fdf4', borderTop: '1px solid #bbf7d0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#15803d', marginBottom: 6 }}>Billing {progress.current} of {progress.total}…</div>
            <div style={{ height: 6, background: '#dcfce7', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#16a34a', borderRadius: 999, width: `${(progress.current / progress.total) * 100}%`, transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!progress && (
          <div style={{ padding: '14px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: confirming ? 'none' : '1px solid #e5e7eb' }}>
            <button onClick={handleAllCSVs} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 16px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#f9fafb', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', outline: 'none' }}>
              <DlIcon /> All CSVs
            </button>
            <button onClick={handleAllPDFs} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 16px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#f9fafb', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', outline: 'none' }}>
              <DlIcon /> All PDFs
            </button>
            {!confirming && (
              <button onClick={() => setConfirming(true)} style={{ padding: '7px 18px', border: 'none', borderRadius: 999, background: '#006FEE', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', outline: 'none' }}>
                Mark All Billed
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchParamsInit({ onSearch }: { onSearch: (q: string) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) onSearch(q);
  }, [searchParams, onSearch]);
  return null;
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(() => clientGet<BillingData>('billing') ?? null);
  const [loading, setLoading] = useState(() => !clientGet('billing'));
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeClient, setActiveClient] = useState<ClientBilling | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClientBilling | null>(null);
  const [nextNum, setNextNum] = useState('NV-1001');
  const [sortCol, setSortCol] = useState('fee');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [openPopup, setOpenPopup] = useState<null|'filter'|'sort'|'cols'>(null);
  const [filterType, setFilterType] = useState<'all'|'prevMonth'>('all');
  const [billingTab, setBillingTab] = useState<'rtb'|'pending'|'overdue'|'billed'|'all'>('rtb');
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [sidebarView, setSidebarView] = useState<'current' | 'previous'>('current');
  const [showBulk, setShowBulk] = useState(false);
  const popupAreaRef = useRef<HTMLDivElement>(null);

  const { onToggle } = useSidebar();

  useEffect(() => {
    if (!openPopup) return;
    function handler(e: MouseEvent) {
      if (popupAreaRef.current && !popupAreaRef.current.contains(e.target as Node)) setOpenPopup(null);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openPopup]);

  function handleDragStart(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(220, Math.min(640, startW + startX - ev.clientX)));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  useEffect(() => {
    const cached = clientGet<BillingData>('billing');
    if (cached) { setData(cached); setLoading(false); }
    else {
      fetch('/api/billing').then(r => r.json()).then(d => { clientSet('billing', d); setData(d); setLoading(false); }).catch(e => { setError(e.message); setLoading(false); });
    }
    fetch('/api/invoices/next-number').then(r => r.json()).then(d => setNextNum(d.nextNumber ?? 'NV-1001'));
  }, []);

  function handleInvoiceSaved(inv: Invoice) {
    const parts = nextNum.split('-');
    const n = parseInt(parts[1] ?? '1000');
    setNextNum(`${parts[0]}-${n + 1}`);
    clientClear('billing'); clientClear('invoices');
    if (data) setData({ ...data, clients: data.clients.filter(c => c.clientName !== inv.client_name) });
    setActiveClient(null); setSelectedClient(null);
  }

  function handleAllBilledDone(count: number) {
    const parts = nextNum.split('-');
    const n = parseInt(parts[1] ?? '1000');
    setNextNum(`${parts[0]}-${n + count}`);
    clientClear('billing'); clientClear('invoices');
    setShowBulk(false); setLoading(true);
    fetch('/api/billing').then(r => r.json()).then(d => { clientSet('billing', d); setData(d); setLoading(false); }).catch(() => setLoading(false));
  }

  const isGracePeriod = data?.isGracePeriod ?? false;
  // Compute 2-month lookback: only show clients billed in the last ~60 days
  const billedCutoff = data?.currentMonthStart
    ? (() => { const d = new Date(data.currentMonthStart + 'T12:00:00'); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })()
    : null;
  // Matches GAS: billed = previouslyBilledFee > 0 && readyToBillFee === 0
  // Restricted to clients billed within last 2 months to avoid showing all-time history
  const billedClients = (data?.clients ?? []).filter(c =>
    c.previouslyBilledFee > 0 && c.totalFee === 0 &&
    (!billedCutoff || (c.mostRecentBilledDate != null && c.mostRecentBilledDate >= billedCutoff))
  );
  const pendingClients = (data?.clients ?? []).filter(c => (c.pendingFee ?? 0) > 0);
  const overdueClients = (data?.clients ?? []).filter(c => (c.overdueAmount ?? 0) > 0);

  const filtered = billingTab === 'billed' ? billedClients.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.clientName.toLowerCase().includes(q) || matchAmt(search, c.previouslyBilledReimbursed) || matchAmt(search, c.previouslyBilledFee);
  }) : billingTab === 'pending' ? pendingClients.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.clientName.toLowerCase().includes(q) || (c.pendingCases ?? []).some(cs => cs.caseId.toLowerCase().includes(q) || matchAmt(search, cs.amount));
  }) : billingTab === 'overdue' ? overdueClients.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.clientName.toLowerCase().includes(q) || (c.overdueCases ?? []).some(cs => cs.caseId.toLowerCase().includes(q) || matchAmt(search, cs.amount));
  }) : (data?.clients ?? []).filter(c => {
    if (billingTab === 'rtb' && c.totalFee === 0) return false;
    if (filterType === 'prevMonth' && c.prevMonthFee === 0) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return c.clientName.toLowerCase().includes(q) || c.cases.some(cs => cs.caseId.toLowerCase().includes(q) || matchAmt(search, cs.amount));
  });

  const [prevMatchedClient, setPrevMatchedClient] = useState<ClientBilling | null>(null);

  const sortedBase = [...filtered].sort((a, b) => {
    let av: number | string, bv: number | string;
    if (sortCol === 'name') { av = a.clientName; bv = b.clientName; }
    else if (sortCol === 'rate') { av = a.rate; bv = b.rate; }
    else if (sortCol === 'recovered') { av = a.totalAmount; bv = b.totalAmount; }
    else if (sortCol === 'cases') { av = a.cases.length; bv = b.cases.length; }
    else { av = a.totalFee; bv = b.totalFee; }
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return sortDir === 'asc' ? av - (bv as number) : (bv as number) - av;
  });
  // Pin prev-match client at top when not already in filtered list
  const sorted = prevMatchedClient && !sortedBase.find(c => c.clientName === prevMatchedClient.clientName)
    ? [prevMatchedClient, ...sortedBase]
    : sortedBase;

  // Current-case search: auto-select client when case ID matches
  useEffect(() => {
    if (!search) { setPrevMatchedClient(null); return; }
    const q = search.toLowerCase();
    const byCase = (data?.clients ?? []).find(c => c.cases.some(cs => cs.caseId.toLowerCase().includes(q)) && !c.clientName.toLowerCase().includes(q));
    if (byCase) { setPrevMatchedClient(null); setSelectedClient(byCase); setSidebarView('current'); return; }

    // Previous-case search: check module-level cache first, then invoices API
    setPrevMatchedClient(null);
    for (const [clientName, cases] of prevCasesCache.entries()) {
      if (cases.some(c => c.case_id.toLowerCase().includes(q))) {
        const client = (data?.clients ?? []).find(c => c.clientName === clientName);
        if (client) { setPrevMatchedClient(client); setSelectedClient(client); setSidebarView('previous'); return; }
      }
    }
    // Fallback: search invoices table (small dataset, client-side filter)
    supabase.from('invoices').select('client_name, case_ids').then(({ data: invs }) => {
      if (!invs) return;
      const match = invs.find((inv: { client_name: string; case_ids: string[] }) =>
        (inv.case_ids ?? []).some((id: string) => String(id).toLowerCase().includes(q))
      );
      if (!match) return;
      const client = (data?.clients ?? []).find(c => c.clientName === match.client_name);
      if (client) { setPrevMatchedClient(client); setSelectedClient(client); setSidebarView('previous'); }
    });
  }, [search, data]);


  const currentMonthLabel = data?.currentMonthStart
    ? new Date(data.currentMonthStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  return (
    <>
      <Suspense><SearchParamsInit onSearch={setSearch} /></Suspense>
      <style>{`
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes slideInDrawer{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
        button:hover{opacity:.88}
        input:focus{outline:none;box-shadow:0 0 0 2px rgba(37,99,235,0.2);}

      `}</style>

      {activeClient && (
        <InvoiceModal
          client={activeClient} invoiceNumber={nextNum}
          billingContact={data?.billingSummaryInfo?.[activeClient.clientName] ?? null}
          onClose={() => setActiveClient(null)} onSaved={handleInvoiceSaved}
        />
      )}
      {showBulk && (
        <BulkModal
          rtbClients={(data?.clients ?? []).filter(c => c.totalFee > 0 && c.cases.length > 0)}
          startInvoiceNum={nextNum}
          billingSummaryInfo={data?.billingSummaryInfo ?? {}}
          onClose={() => setShowBulk(false)}
          onAllBilled={handleAllBilledDone}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: 10, padding: '4px 20px 8px', height: 52, background: '#f4f4f5' }}>
          <button onClick={onToggle} title="Toggle sidebar" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#11181c', flexShrink: 0, outline: 'none' }}>
            <PanelIcon />
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#11181c', letterSpacing: '-0.02em' }}>Billing</h1>
        </div>

        {error && <div style={{ padding: '10px 20px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', color: '#dc2626', fontSize: 13 }}>{error}</div>}

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Above-table toolbar */}
          {!loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div ref={popupAreaRef} style={{ display: 'flex', gap: 6 }}>

                  {/* Filter popup */}
                  <div style={{ position: 'relative' }}>
                    <button onClick={() => setOpenPopup(p => p === 'filter' ? null : 'filter')} style={{ ...toolbarPill, ...(filterType !== 'all' ? { background: '#dbeafe', color: '#1d4ed8' } : {}) }}>
                      <IconFilter /> Filter{filterType !== 'all' ? ' ·' : ''}
                    </button>
                    {openPopup === 'filter' && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 18, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, minWidth: 210, padding: 4 }}>
                        {([{ val: 'all', lbl: 'All clients' }, { val: 'prevMonth', lbl: 'Previous month charges only' }] as const).map(({ val, lbl }) => (
                          <button key={val} onClick={() => { setFilterType(val); setOpenPopup(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, border: 'none', borderRadius: 999, cursor: 'pointer', background: filterType === val ? '#eaebec' : 'transparent', color: '#11181c', fontWeight: filterType === val ? 600 : 400, transition: 'background 0.1s' }}>{lbl}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Sort popup */}
                  <div style={{ position: 'relative' }}>
                    <button onClick={() => setOpenPopup(p => p === 'sort' ? null : 'sort')} style={toolbarPill}>
                      <IconSort /> Sort
                    </button>
                    {openPopup === 'sort' && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 18, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, minWidth: 180, padding: 4 }}>
                        {([{ col: 'fee', lbl: 'Fee' }, { col: 'recovered', lbl: 'Recovered' }, { col: 'name', lbl: 'Client name' }, { col: 'rate', lbl: 'Rate' }, { col: 'cases', lbl: 'Cases' }] as const).map(({ col, lbl }) => (
                          <button key={col} onClick={() => { handleSort(col); setOpenPopup(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, border: 'none', borderRadius: 999, cursor: 'pointer', background: sortCol === col ? '#eaebec' : 'transparent', color: '#11181c', fontWeight: sortCol === col ? 600 : 400, transition: 'background 0.1s' }}>
                            {lbl}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
                <div style={{ flex: 1 }} />
                {billingTab === 'rtb' && (data?.clients ?? []).some(c => c.totalFee > 0 && c.cases.length > 0) && (
                  <button onClick={() => setShowBulk(true)} style={{ ...toolbarPill, background: '#006FEE', color: '#fff' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    Bulk Invoice
                  </button>
                )}
              </div>
              {/* Tab switcher + search on same row */}
              {(() => {
                const all = data?.clients ?? [];
                const counts: Record<string, number> = {
                  rtb: all.filter(c => c.totalFee > 0).length,
                  pending: pendingClients.length,
                  overdue: overdueClients.length,
                  billed: billedClients.length,
                  all: all.length,
                };
                const TABS: { key: typeof billingTab; label: string }[] = [
                  { key: 'rtb', label: 'Ready to Bill' },
                  { key: 'pending', label: 'Pending' },
                  { key: 'overdue', label: 'Overdue' },
                  { key: 'billed', label: 'Billed' },
                  { key: 'all', label: 'All' },
                ];
                return (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', background: '#eaebec', borderRadius: 999, padding: 4, gap: 2 }}>
                      {TABS.map(({ key, label }) => (
                        <button key={key} onClick={() => setBillingTab(key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 13px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: billingTab === key ? 700 : 500, cursor: 'pointer', background: billingTab === key ? '#fff' : 'transparent', color: billingTab === key ? '#11181c' : '#71717a', boxShadow: billingTab === key ? '0 1px 4px rgba(0,0,0,0.10)' : 'none', transition: 'all 0.12s', outline: 'none', whiteSpace: 'nowrap' }}>
                          {label}
                          {counts[key] > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: billingTab === key ? '#eaebec' : 'transparent', borderRadius: 999, padding: '1px 5px', color: billingTab === key ? '#374151' : '#a1a1aa' }}>{counts[key]}</span>}
                        </button>
                      ))}
                    </div>
                    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      <input
                        placeholder="Search client or case ID…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ fontSize: 13, padding: '7px 32px 7px 36px', border: '1px solid #e4e4e7', borderRadius: 999, width: 220, color: '#11181c', outline: 'none', background: "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E\") no-repeat 10px center" }}
                      />
                      {search && (
                        <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#a1a1aa', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Two-panel: RTB/Billed/All table + case detail */}
          {(() => {
            const showHdr = !loading && filtered.length > 0;
            const visOpt = OPTIONAL_COLS.filter(c => !hiddenCols.has(c.key));
            const G = `minmax(0,1fr) ${visOpt.map(c => selectedClient ? c.compactWidth : c.width).join(' ')} 120px`;
            return (
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden', borderRadius: 16, background: '#eaebec', flexDirection: 'column' }}>

                {/* Shared header row */}
                {showHdr && (
                  <div style={{ display: 'flex', flexShrink: 0 }}>
                    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: G, padding: '10px 10px 10px 22px', gap: 8, minWidth: 420, alignItems: 'center' }}>
                      <ColHdr label="Client" col="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      {visOpt.map(c => (
                        <ColHdr key={c.key} label={c.label} col={c.key} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                      ))}
                      <span style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 11, fontWeight: 600, color: '#71717a' }}>{billingTab !== 'billed' ? 'Actions' : ''}</span>
                    </div>
                  </div>
                )}

                {/* Content row — client list always full width; drawer overlays */}
                <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>

                  {/* Client list card — always full width, flex column for sticky total */}
                  <div style={{ position: 'absolute', inset: '6px', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>

                    {/* Scrollable rows */}
                    <div style={{ flex: 1, overflow: 'auto' }}>
                      {loading ? (
                        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {[1,2,3,4,5].map(i => <Sk key={i} h={44} />)}
                        </div>
                      ) : billingTab === 'pending' ? (
                        !filtered.length ? (
                          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>No pending cases this month.</div>
                        ) : (
                          <div style={{ minWidth: 420 }}>
                            {filtered.map((c, idx) => (
                              <div key={c.clientName}
                                onClick={() => { setSelectedClient(c); setSidebarView('current'); }}
                                style={{ display: 'grid', gridTemplateColumns: G, padding: '9px 10px 9px 16px', gap: 8, cursor: 'pointer', borderBottom: idx < filtered.length - 1 ? '1px solid #f3f4f6' : 'none', background: selectedClient?.clientName === c.clientName ? '#f0f7ff' : '#fff', alignItems: 'center', transition: 'background 0.1s' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: '#11181c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.clientName}</span>
                                  <span style={{ fontSize: 10, fontWeight: 600, background: '#f0f7ff', color: '#1d4ed8', borderRadius: 999, padding: '1px 6px', alignSelf: 'flex-start' }}>pending this month</span>
                                </div>
                                {!hiddenCols.has('rate') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{fmtPct(c.rate)}</span>}
                                {!hiddenCols.has('recovered') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#006FEE' }}>{fmtUSD(c.pendingAmount ?? 0)}</span>}
                                {!hiddenCols.has('fee') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#71717a' }}>{fmtUSD(c.pendingFee ?? 0)}</span>}
                                {!hiddenCols.has('cases') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{(c.pendingCases ?? []).length}</span>}
                                <div />
                              </div>
                            ))}
                          </div>
                        )
                      ) : billingTab === 'overdue' ? (
                        !filtered.length ? (
                          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>No overdue cases found.</div>
                        ) : (
                          <div style={{ minWidth: 420 }}>
                            {filtered.map((c, idx) => (
                              <div key={c.clientName}
                                onClick={() => { setSelectedClient(c); setSidebarView('current'); }}
                                style={{ display: 'grid', gridTemplateColumns: G, padding: '9px 10px 9px 16px', gap: 8, cursor: 'pointer', borderBottom: idx < filtered.length - 1 ? '1px solid #f3f4f6' : 'none', background: selectedClient?.clientName === c.clientName ? '#fff7ed' : '#fff', alignItems: 'center', transition: 'background 0.1s' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: '#11181c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.clientName}</span>
                                  <span style={{ fontSize: 10, fontWeight: 600, background: '#fff7ed', color: '#c2410c', borderRadius: 999, padding: '1px 6px', alignSelf: 'flex-start' }}>overdue — not yet billed</span>
                                </div>
                                {!hiddenCols.has('rate') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{fmtPct(c.rate)}</span>}
                                {!hiddenCols.has('recovered') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#ea580c' }}>{fmtUSD(c.overdueAmount ?? 0)}</span>}
                                {!hiddenCols.has('fee') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#9a3412' }}>{fmtUSD(c.overdueFee ?? 0)}</span>}
                                {!hiddenCols.has('cases') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{(c.overdueCases ?? []).length}</span>}
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                                  {(c.overdueCases ?? []).length > 0 && (
                                    <button onClick={() => {
                                      const overdueClient = { ...c, cases: c.overdueCases, totalAmount: c.overdueAmount, totalFee: c.overdueFee, currentMonthFee: 0, prevMonthFee: c.overdueFee };
                                      setActiveClient(overdueClient);
                                    }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, padding: '4px 9px', border: 'none', borderRadius: 999, background: '#ea580c', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                      <IconInvoice /> Invoice
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      ) : billingTab === 'billed' ? (
                        !filtered.length ? (
                          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>No billed clients.</div>
                        ) : (
                          <div style={{ minWidth: 420 }}>
                            {filtered.map((c, idx) => (
                              <div key={c.clientName}
                                onClick={() => { setSelectedClient(c); setSidebarView('previous'); }}
                                style={{ display: 'grid', gridTemplateColumns: G, padding: '9px 10px 9px 16px', gap: 8, cursor: 'pointer', borderBottom: idx < filtered.length - 1 ? '1px solid #f3f4f6' : 'none', background: selectedClient?.clientName === c.clientName ? '#f0f7ff' : '#fff', alignItems: 'center', transition: 'background 0.1s' }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: '#11181c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.clientName}</span>
                                {!hiddenCols.has('rate') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{fmtPct(c.rate)}</span>}
                                {!hiddenCols.has('recovered') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#006FEE' }}>{fmtUSD(c.previouslyBilledReimbursed)}</span>}
                                {!hiddenCols.has('fee') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#11181c' }}>{fmtUSD(c.previouslyBilledFee)}</span>}
                                {!hiddenCols.has('cases') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>—</span>}
                                <div />
                              </div>
                            ))}
                          </div>
                        )
                      ) : sorted.length === 0 ? (
                        <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                          {search ? 'No clients match.' : 'No clients ready to bill.'}
                        </div>
                      ) : (
                        <div style={{ minWidth: 420 }}>
                          {sorted.map((c, idx) => (
                            <div key={c.clientName}
                              onClick={() => { setSelectedClient(c); setSidebarView('current'); }}
                              style={{ display: 'grid', gridTemplateColumns: G, padding: '9px 10px 9px 16px', gap: 8, cursor: 'pointer', borderBottom: idx < sorted.length - 1 ? '1px solid #f3f4f6' : 'none', background: selectedClient?.clientName === c.clientName ? '#f0f7ff' : '#fff', alignItems: 'center', transition: 'background 0.1s' }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: '#11181c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.clientName}</span>
                                {c.prevMonthFee > 0 && <span style={{ fontSize: 10, fontWeight: 600, background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '1px 6px', alignSelf: 'flex-start' }}>+prev month</span>}
                              </div>
                              {!hiddenCols.has('rate') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{fmtPct(c.rate)}</span>}
                              {!hiddenCols.has('recovered') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#006FEE' }}>{fmtUSD(c.totalAmount)}</span>}
                              {!hiddenCols.has('fee') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#11181c' }}>{fmtUSD(c.totalFee)}</span>}
                              {!hiddenCols.has('cases') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{c.cases.length}</span>}
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                                {c.cases.length > 0 && (
                                  <button onClick={() => setActiveClient(c)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, padding: '4px 9px', border: 'none', borderRadius: 999, background: '#006FEE', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                    <IconInvoice /> Invoice
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Sticky total row — always at bottom edge, same row height as client rows */}
                    {!loading && filtered.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: G, padding: '9px 10px 9px 16px', gap: 8, borderTop: '2px solid #f0f0f0', background: '#fafafa', flexShrink: 0, minWidth: 420 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#11181c' }}>Total</span>
                        {!hiddenCols.has('rate') && <span />}
                        {billingTab === 'pending' ? (
                          <>
                            {!hiddenCols.has('recovered') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#006FEE' }}>{fmtUSD(filtered.reduce((s,c)=>s+(c.pendingAmount??0),0))}</span>}
                            {!hiddenCols.has('fee') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#71717a' }}>{fmtUSD(filtered.reduce((s,c)=>s+(c.pendingFee??0),0))}</span>}
                            {!hiddenCols.has('cases') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{filtered.reduce((s,c)=>s+(c.pendingCases??[]).length,0)}</span>}
                          </>
                        ) : billingTab === 'overdue' ? (
                          <>
                            {!hiddenCols.has('recovered') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#ea580c' }}>{fmtUSD(filtered.reduce((s,c)=>s+(c.overdueAmount??0),0))}</span>}
                            {!hiddenCols.has('fee') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#9a3412' }}>{fmtUSD(filtered.reduce((s,c)=>s+(c.overdueFee??0),0))}</span>}
                            {!hiddenCols.has('cases') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{filtered.reduce((s,c)=>s+(c.overdueCases??[]).length,0)}</span>}
                          </>
                        ) : billingTab === 'billed' ? (
                          <>
                            {!hiddenCols.has('recovered') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#006FEE' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.previouslyBilledReimbursed,0))}</span>}
                            {!hiddenCols.has('fee') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#11181c' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.previouslyBilledFee,0))}</span>}
                            {!hiddenCols.has('cases') && <span />}
                          </>
                        ) : (
                          <>
                            {!hiddenCols.has('recovered') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#006FEE' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalAmount,0))}</span>}
                            {!hiddenCols.has('fee') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#11181c' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalFee,0))}</span>}
                            {!hiddenCols.has('cases') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{filtered.reduce((s,c)=>s+c.cases.length,0)}</span>}
                          </>
                        )}
                        <span />
                      </div>
                    )}
                  </div>

                  {/* Overlay drawer — slides in from right, does not affect client list width */}
                  {selectedClient && (
                    <div style={{ position: 'absolute', top: 6, right: 6, bottom: 6, width: sidebarWidth, background: '#fff', borderRadius: 12, boxShadow: '-6px 0 32px rgba(0,0,0,0.13)', zIndex: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideInDrawer 0.18s cubic-bezier(0.4,0,0.2,1)' }}>
                      {/* Resize handle on left edge */}
                      <div onMouseDown={handleDragStart} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 1 }} />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 6px 10px', flexShrink: 0, borderBottom: '1px solid #f3f4f6' }}>
                        <div style={{ display: 'flex', background: '#eaebec', borderRadius: 999, padding: 2, gap: 1 }}>
                          {(['current', 'previous'] as const).map(tab => (
                            <button key={tab} onClick={() => setSidebarView(tab)} style={{ padding: '3px 10px', borderRadius: 999, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer', background: sidebarView === tab ? '#fff' : 'transparent', color: sidebarView === tab ? '#11181c' : '#71717a', boxShadow: sidebarView === tab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', outline: 'none', whiteSpace: 'nowrap' }}>
                              {tab === 'current' ? 'Current' : 'Previous'}
                            </button>
                          ))}
                        </div>
                        <button onClick={() => setSelectedClient(null)} style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 14, lineHeight: 1, outline: 'none', flexShrink: 0 }}>×</button>
                      </div>
                      <CaseSidebar client={selectedClient} highlight={search || undefined} view={sidebarView} isPendingTab={billingTab === 'pending'} isOverdueTab={billingTab === 'overdue'} />
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}
