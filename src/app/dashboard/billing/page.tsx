'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { clientGet, clientSet, clientClear } from '@/lib/client-cache';
import { downloadInvoicePDF } from '@/lib/invoice-pdf';
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
};
type BillingContactInfo = {
  client_name: string; invoice_date: string | null;
  payment_terms: string | null; address: string | null;
};
type BillingData = {
  clients: ClientBilling[]; totalFee: number; totalAmount: number;
  totalCases: number; currentMonthStart: string;
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
const PanelIcon = () => <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="16" height="16" rx="3"/><line x1="7" y1="2" x2="7" y2="18"/></svg>;

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

function InvoiceModal({ client, invoiceNumber, billingContact, onClose, onSaved }: {
  client: ClientBilling; invoiceNumber: string;
  billingContact: BillingContactInfo | null;
  onClose: () => void; onSaved: (inv: Invoice) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);
  const billedDate = isoToday();

  async function handleMarkAsBilled() {
    setSaving(true); setErr('');
    const billedCases = client.cases.filter(c => !!c.postingDate);
    await downloadInvoicePDF(
      { invoice_number: invoiceNumber, client_name: client.clientName, client_address: billingContact?.address ?? null, billed_date: billedDate, billed_fee: client.totalFee, total_reimbursed: client.totalAmount, case_ids: [...new Set(billedCases.map(c => c.caseId))] },
      billedCases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount }))
    );
    const inv = {
      invoice_number: invoiceNumber, client_name: client.clientName,
      billed_date: new Date(billedDate + 'T12:00:00').toISOString(),
      billed_fee: client.totalFee, total_reimbursed: client.totalAmount,
      case_ids: [...new Set(billedCases.map(c => c.caseId))],
      case_snapshot: billedCases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount, gtin: c.gtin ?? '', sku_id: c.sku_id ?? '', unit_amount: c.unit_amount ?? c.amount, reimbursed_qty: c.reimbursed_qty ?? 1 })),
      pdf_url: '',
    };
    const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv) });
    const data = await res.json();
    if (!res.ok) { setErr(data.error ?? 'Failed to save'); setSaving(false); return; }
    onSaved(data.invoice ?? inv);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 24, width: '100%', maxWidth: 360, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', position: 'relative' }}>

        {/* Close */}
        <button onClick={onClose} style={{ position: 'absolute', top: 14, right: 14, border: 'none', background: '#f4f4f5', cursor: 'pointer', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 15, lineHeight: 1 }}>×</button>

        {/* Header — centered */}
        <div style={{ padding: '28px 24px 0', textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#111827', lineHeight: 1.3, padding: '0 20px' }}>{client.clientName}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#9ca3af', marginTop: 6, fontFamily: 'monospace' }}>{invoiceNumber}</div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', margin: '20px 24px 0', background: '#f4f4f5', borderRadius: 14, overflow: 'hidden', gap: 1 }}>
          <div style={{ background: '#fff', padding: '12px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#a1a1aa', marginBottom: 4 }}>Recovered</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#006FEE' }}>{fmtUSD(client.totalAmount)}</div>
          </div>
          <div style={{ background: '#fff', padding: '12px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#a1a1aa', marginBottom: 4 }}>Fee</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{fmtUSD(client.totalFee)}</div>
          </div>
          <div style={{ background: '#fff', padding: '12px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#a1a1aa', marginBottom: 4 }}>Cases</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{client.cases.length}</div>
          </div>
        </div>

        {err && <div style={{ margin: '12px 24px 0', background: '#fef2f2', color: '#dc2626', fontSize: 12, borderRadius: 8, padding: '8px 12px' }}>{err}</div>}

        {confirming && (
          <div style={{ margin: '12px 24px 0', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
            <strong>Mark as billed?</strong><br />
            PDF downloaded, invoice {invoiceNumber} saved. Cannot be undone.
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {confirming ? (
            <>
              <button onClick={handleMarkAsBilled} disabled={saving} style={{ width: '100%', fontSize: 14, fontWeight: 700, padding: '13px', border: 'none', borderRadius: 999, background: saving ? '#86efac' : '#16a34a', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving…' : '✓ Confirm Billed'}
              </button>
              <button onClick={() => setConfirming(false)} style={{ width: '100%', fontSize: 13, fontWeight: 600, padding: '11px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', cursor: 'pointer', color: '#374151' }}>Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => setConfirming(true)} style={{ width: '100%', fontSize: 14, fontWeight: 700, padding: '13px', border: 'none', borderRadius: 999, background: '#2563eb', color: '#fff', cursor: 'pointer' }}>Mark as Billed</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => downloadClientCSV(client, invoiceNumber)} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '10px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13"/><polyline points="7 12 12 17 17 12"/><line x1="3" y1="21" x2="21" y2="21"/></svg>
                  CSV
                </button>
                <button onClick={async () => { await downloadInvoicePDF({ invoice_number: invoiceNumber, client_name: client.clientName, client_address: billingContact?.address ?? null, billed_date: billedDate, billed_fee: client.totalFee, total_reimbursed: client.totalAmount, case_ids: [...new Set(client.cases.map(c => c.caseId))] }, client.cases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount }))); }} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '10px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13"/><polyline points="7 12 12 17 17 12"/><line x1="3" y1="21" x2="21" y2="21"/></svg>
                  PDF
                </button>
              </div>
            </>
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
};

function CaseSidebar({ client, highlight }: { client: ClientBilling; highlight?: string }) {
  const q = highlight?.toLowerCase() ?? '';
  const firstMatchIndex = q ? client.cases.findIndex(c => c.caseId.toLowerCase().includes(q)) : -1;
  const firstMatchRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<'current' | 'previous'>('current');
  const [prevCases, setPrevCases] = useState<HistoricalCase[] | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);

  useEffect(() => {
    if (firstMatchRef.current) firstMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [highlight, client.clientName]);

  useEffect(() => { setView('current'); setPrevCases(null); }, [client.clientName]);

  const fetchPrevious = useCallback(async () => {
    if (prevCases !== null) return;
    setLoadingPrev(true);
    const { data } = await supabase
      .from('invoices')
      .select('invoice_number, billed_date, case_snapshot')
      .eq('client_name', client.clientName)
      .order('billed_date', { ascending: false });
    const cases: HistoricalCase[] = (data ?? []).flatMap((inv: { invoice_number: string; billed_date: string; case_snapshot: { case_id: string; claim_type: string; rms_posting_date: string; reimbursement_amount: number }[] }) =>
      (inv.case_snapshot ?? [])
        .filter(c => !!c.rms_posting_date)
        .map(c => ({ ...c, invoice_number: inv.invoice_number, billed_date: inv.billed_date }))
    );
    setPrevCases(cases);
    setLoadingPrev(false);
  }, [client.clientName, prevCases]);

  useEffect(() => {
    if (view === 'previous') fetchPrevious();
  }, [view, fetchPrevious]);

  const CG = '72px 1fr 70px 58px 46px';
  const prevTotalAmt = (prevCases ?? []).reduce((s, c) => s + c.reimbursement_amount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Tab switcher header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #f3f4f6', background: '#fafafa', flexShrink: 0, gap: 6 }}>
        <div style={{ display: 'flex', background: '#eaebec', borderRadius: 999, padding: 3, gap: 2 }}>
          {(['current', 'previous'] as const).map(tab => (
            <button key={tab} onClick={() => setView(tab)} style={{ padding: '4px 12px', borderRadius: 999, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: view === tab ? '#fff' : 'transparent', color: view === tab ? '#11181c' : '#71717a', boxShadow: view === tab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.12s', outline: 'none' }}>
              {tab === 'current' ? 'Current' : 'Previous'}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 10, color: '#a1a1aa' }}>
          {view === 'current' ? `${client.cases.length} cases` : prevCases !== null ? `${prevCases.length} cases` : ''}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {view === 'current' ? (
          <>
            {client.cases.map((c, i) => {
              const isMatch = q ? c.caseId.toLowerCase().includes(q) : false;
              return (
                <div key={i} ref={i === firstMatchIndex ? firstMatchRef : undefined}
                  style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderBottom: '1px solid #f3f4f6', background: isMatch ? '#fef9c3' : (!c.isCurrentMonth ? '#fffbeb' : undefined), fontSize: 11, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.caseId}</span>
                  <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.claimType || 'N/A'}</span>
                  <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDate(c.postingDate)}</span>
                  <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.amount)}</span>
                  <span style={{ fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(c.fee)}</span>
                </div>
              );
            })}
            <div style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', position: 'sticky', bottom: 0, zIndex: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Total</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(client.totalFee)}</span>
            </div>
          </>
        ) : loadingPrev ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>Loading…</div>
        ) : prevCases?.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>No billing history found.</div>
        ) : (
          <>
            {(prevCases ?? []).map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 11, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.case_id}</span>
                <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.claim_type || 'N/A'}</span>
                <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{fmtDate(c.rms_posting_date)}</span>
                <span style={{ fontWeight: 600, color: '#006FEE', textAlign: 'right' }}>{fmtUSD(c.reimbursement_amount)}</span>
                <span style={{ fontSize: 10, color: '#a1a1aa', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.invoice_number}</span>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', position: 'sticky', bottom: 0, zIndex: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>All-time</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#006FEE', textAlign: 'right' }}>{fmtUSD(prevTotalAmt)}</span>
              <span />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [billingTab, setBillingTab] = useState<'all'|'rtb'|'pending'|'overdue'|'billed'>('all');
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
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

  const filtered = (data?.clients ?? []).filter(c => {
    if (filterType === 'prevMonth' && c.prevMonthFee === 0) return false;
    if (billingTab === 'rtb' && c.currentMonthFee === 0) return false;
    if (billingTab === 'pending' && !(c.prevMonthFee > 0 && c.currentMonthFee > 0)) return false;
    if (billingTab === 'overdue' && !(c.prevMonthFee > 0 && c.currentMonthFee === 0)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return c.clientName.toLowerCase().includes(q) || c.cases.some(cs => cs.caseId.toLowerCase().includes(q));
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: number | string, bv: number | string;
    if (sortCol === 'name') { av = a.clientName; bv = b.clientName; }
    else if (sortCol === 'rate') { av = a.rate; bv = b.rate; }
    else if (sortCol === 'recovered') { av = a.totalAmount; bv = b.totalAmount; }
    else if (sortCol === 'cases') { av = a.cases.length; bv = b.cases.length; }
    else { av = a.totalFee; bv = b.totalFee; }
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return sortDir === 'asc' ? av - (bv as number) : (bv as number) - av;
  });

  useEffect(() => {
    if (!search) return;
    const q = search.toLowerCase();
    const byCase = (data?.clients ?? []).find(c => c.cases.some(cs => cs.caseId.toLowerCase().includes(q)) && !c.clientName.toLowerCase().includes(q));
    if (byCase) setSelectedClient(byCase);
  }, [search, data]);

  const currentMonthLabel = data?.currentMonthStart
    ? new Date(data.currentMonthStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  return (
    <>
      <style>{`
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
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

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: 10, padding: '8px 20px 10px', height: 68, background: '#f4f4f5' }}>
          <button onClick={onToggle} title="Toggle sidebar" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a', flexShrink: 0, outline: 'none' }}>
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
              {/* Tab switcher */}
              {(() => {
                const all = data?.clients ?? [];
                const counts = {
                  all: all.length,
                  rtb: all.filter(c => c.currentMonthFee > 0).length,
                  pending: all.filter(c => c.prevMonthFee > 0 && c.currentMonthFee > 0).length,
                  overdue: all.filter(c => c.prevMonthFee > 0 && c.currentMonthFee === 0).length,
                  billed: 0,
                };
                const TABS: { key: typeof billingTab; label: string }[] = [
                  { key: 'all', label: 'All' },
                  { key: 'rtb', label: 'Ready to Bill' },
                  { key: 'pending', label: 'Pending' },
                  { key: 'overdue', label: 'Overdue' },
                  { key: 'billed', label: 'Billed' },
                ];
                return (
                  <div style={{ display: 'flex', background: '#eaebec', borderRadius: 999, padding: 4, gap: 2, alignSelf: 'flex-start' }}>
                    {TABS.map(({ key, label }) => (
                      <button key={key} onClick={() => setBillingTab(key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 13px', borderRadius: 999, border: 'none', fontSize: 12, fontWeight: billingTab === key ? 700 : 500, cursor: 'pointer', background: billingTab === key ? '#fff' : 'transparent', color: billingTab === key ? '#11181c' : '#71717a', boxShadow: billingTab === key ? '0 1px 4px rgba(0,0,0,0.10)' : 'none', transition: 'all 0.12s', outline: 'none', whiteSpace: 'nowrap' }}>
                        {label}
                        {counts[key] > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: billingTab === key ? '#eaebec' : 'transparent', borderRadius: 999, padding: '1px 5px', color: billingTab === key ? '#374151' : '#a1a1aa' }}>{counts[key]}</span>}
                      </button>
                    ))}
                  </div>
                );
              })()}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div ref={popupAreaRef} style={{ display: 'flex', gap: 6 }}>

                  {/* Filter popup */}
                  <div style={{ position: 'relative' }}>
                    <button onClick={() => setOpenPopup(p => p === 'filter' ? null : 'filter')} style={{ ...toolbarPill, ...(filterType !== 'all' ? { background: '#dbeafe', color: '#1d4ed8' } : {}) }}>
                      <IconFilter /> Filter{filterType !== 'all' ? ' ·' : ''}
                    </button>
                    {openPopup === 'filter' && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 18, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, minWidth: 210, padding: 4 }}>
                        {([{ val: 'all', lbl: 'All clients' }, { val: 'prevMonth', lbl: 'Previous month charges only' }] as const).map(({ val, lbl }) => (
                          <button key={val} onClick={() => { setFilterType(val); setOpenPopup(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, border: 'none', borderRadius: 8, cursor: 'pointer', background: filterType === val ? '#f0f7ff' : 'transparent', color: filterType === val ? '#006FEE' : '#11181c', fontWeight: filterType === val ? 600 : 400 }}>{lbl}</button>
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
                          <button key={col} onClick={() => { handleSort(col); setOpenPopup(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, border: 'none', borderRadius: 8, cursor: 'pointer', background: sortCol === col ? '#f0f7ff' : 'transparent', color: sortCol === col ? '#006FEE' : '#11181c', fontWeight: sortCol === col ? 600 : 400 }}>
                            {lbl}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
                <input
                  placeholder="Search client or case ID…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ fontSize: 13, padding: '7px 12px 7px 36px', border: '1px solid #e4e4e7', borderRadius: 999, width: 220, color: '#11181c', outline: 'none', background: "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E\") no-repeat 10px center" }}
                />
              </div>
            </div>
          )}

          {/* Two-panel: RTB table + case detail */}
          {(() => {
            const showHdr = !loading && filtered.length > 0;
            const visOpt = OPTIONAL_COLS.filter(c => !hiddenCols.has(c.key));
            const G = `minmax(0,1fr) ${visOpt.map(c => selectedClient ? c.compactWidth : c.width).join(' ')} 120px`;
            return (
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden', borderRadius: 16, background: '#eaebec', flexDirection: 'column' }}>

                {/* Shared header row — grey, spans RTB cols + empty sidebar placeholder */}
                {showHdr && (
                  <div style={{ display: 'flex', flexShrink: 0 }}>
                    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: G, padding: '10px 10px 10px 22px', gap: 8, minWidth: 420 }}>
                      <ColHdr label="Client" col="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      {visOpt.map(c => (
                        <ColHdr key={c.key} label={c.label} col={c.key} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                      ))}
                      <span style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 11, fontWeight: 600, color: '#71717a' }}>Actions</span>
                    </div>
                    {selectedClient && <div style={{ width: sidebarWidth + 18, flexShrink: 0 }} />}
                  </div>
                )}

                {/* Content row: left card + divider + right card */}
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                  {/* LEFT white card */}
                  <div style={{ flex: 1, minWidth: 0, overflow: 'auto', background: '#fff', borderRadius: selectedClient ? '12px 0 0 12px' : 12, margin: selectedClient ? '6px 0 6px 6px' : '6px 6px 6px 6px' }}>
                    {loading ? (
                      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[1,2,3,4,5].map(i => <Sk key={i} h={44} />)}
                      </div>
                    ) : filtered.length === 0 ? (
                      <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                        {search ? 'No clients match.' : billingTab === 'billed' ? 'Billed clients are in Invoices.' : billingTab === 'overdue' ? 'No overdue clients.' : billingTab === 'pending' ? 'No pending clients.' : 'No clients ready to bill.'}
                      </div>
                    ) : (
                      <div style={{ minWidth: 420 }}>
                        {sorted.map((c, idx) => (
                          <div key={c.clientName}
                            onClick={() => setSelectedClient(prev => prev?.clientName === c.clientName ? null : c)}
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
                              <button onClick={() => setActiveClient(c)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', border: 'none', borderRadius: 999, background: '#006FEE', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                <IconInvoice /> Invoice
                              </button>
                            </div>
                          </div>
                        ))}
                        <div style={{ display: 'grid', gridTemplateColumns: G, padding: '10px 10px 10px 16px', gap: 8, borderTop: '2px solid #f0f0f0', background: '#fafafa' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#11181c' }}>Total</span>
                          {!hiddenCols.has('rate') && <span />}
                          {!hiddenCols.has('recovered') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#006FEE' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalAmount,0))}</span>}
                          {!hiddenCols.has('fee') && <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#11181c' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalFee,0))}</span>}
                          {!hiddenCols.has('cases') && <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{filtered.reduce((s,c)=>s+c.cases.length,0)}</span>}
                          <span />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Draggable divider */}
                  {selectedClient && (
                    <div
                      onMouseDown={handleDragStart}
                      style={{ width: 12, flexShrink: 0, cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none', zIndex: 3 }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {[0,1,2,3].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: '#a1a1aa' }} />)}
                      </div>
                    </div>
                  )}

                  {/* RIGHT sidebar panel */}
                  <div style={{ width: selectedClient ? sidebarWidth : 0, overflow: 'hidden', transition: selectedClient ? 'none' : 'width 0.2s cubic-bezier(0.4,0,0.2,1)', flexShrink: 0, display: 'flex' }}>
                    {selectedClient && (
                      <div style={{ width: sidebarWidth, flexShrink: 0, background: '#fff', borderRadius: '0 12px 12px 0', margin: '6px 6px 6px 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <CaseSidebar client={selectedClient} highlight={search || undefined} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}
