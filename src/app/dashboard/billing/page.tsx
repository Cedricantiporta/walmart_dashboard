'use client';

import { useState, useEffect, useRef } from 'react';
import { Table } from '@heroui/react';
import { clientGet, clientSet, clientClear } from '@/lib/client-cache';
import { downloadInvoicePDF } from '@/lib/invoice-pdf';
import { useSidebar } from '@/components/DashboardShell';

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
  const dataRows = clients.flatMap(c => c.cases.map(cs => gasRow(c.clientName, c.rate, cs)));
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
      {name.charAt(0).toUpperCase()}
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
  background: '#f4f4f5', border: '1px solid #d4d4d8',
  borderRadius: 999, padding: '6px 13px',
  cursor: 'pointer', outline: 'none', flexShrink: 0,
};

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
    await downloadInvoicePDF(
      { invoice_number: invoiceNumber, client_name: client.clientName, client_address: billingContact?.address ?? null, billed_date: billedDate, billed_fee: client.totalFee, total_reimbursed: client.totalAmount, case_ids: [...new Set(client.cases.map(c => c.caseId))] },
      client.cases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount }))
    );
    const inv = {
      invoice_number: invoiceNumber, client_name: client.clientName,
      billed_date: new Date(billedDate + 'T12:00:00').toISOString(),
      billed_fee: client.totalFee, total_reimbursed: client.totalAmount,
      case_ids: [...new Set(client.cases.map(c => c.caseId))],
      case_snapshot: client.cases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount, gtin: c.gtin ?? '', sku_id: c.sku_id ?? '', unit_amount: c.unit_amount ?? c.amount, reimbursed_qty: c.reimbursed_qty ?? 1 })),
      pdf_url: '',
    };
    const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv) });
    const data = await res.json();
    if (!res.ok) { setErr(data.error ?? 'Failed to save'); setSaving(false); return; }
    onSaved(data.invoice ?? inv);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Build Invoice</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{client.clientName} · {invoiceNumber}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', gap: 12 }}>
          {[{ label: 'Total Recovered', value: fmtUSD(client.totalAmount) }, { label: 'Cases', value: String(client.cases.length) }, { label: 'Total Fee', value: fmtUSD(client.totalFee) }].map(card => (
            <div key={card.label} style={{ flex: 1, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{card.label}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#111827' }}>{card.value}</div>
            </div>
          ))}
        </div>
        {err && <div style={{ padding: '8px 24px', background: '#fef2f2', color: '#dc2626', fontSize: 12 }}>{err}</div>}
        {confirming && (
          <div style={{ margin: '0 24px 16px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
            <strong>Mark {client.clientName} as billed?</strong><br />
            PDF downloaded, invoice {invoiceNumber} saved, client removed from Ready to Bill. Cannot be undone.
          </div>
        )}
        <div style={{ padding: '0 24px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {confirming ? (
            <>
              <button onClick={() => setConfirming(false)} style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', cursor: 'pointer', color: '#374151' }}>Cancel</button>
              <button onClick={handleMarkAsBilled} disabled={saving} style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', border: 'none', borderRadius: 999, background: saving ? '#86efac' : '#16a34a', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving…' : '✓ Confirm Billed'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => downloadClientCSV(client, invoiceNumber)} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', cursor: 'pointer', color: '#374151' }}>↓ CSV</button>
              <button onClick={async () => { await downloadInvoicePDF({ invoice_number: invoiceNumber, client_name: client.clientName, client_address: billingContact?.address ?? null, billed_date: billedDate, billed_fee: client.totalFee, total_reimbursed: client.totalAmount, case_ids: [...new Set(client.cases.map(c => c.caseId))] }, client.cases.map(c => ({ case_id: c.caseId, claim_type: c.claimType, rms_posting_date: c.postingDate, reimbursement_amount: c.amount }))); }} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', cursor: 'pointer', color: '#374151' }}>↓ PDF</button>
              <button onClick={() => setConfirming(true)} style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px', border: 'none', borderRadius: 999, background: '#2563eb', color: '#fff', cursor: 'pointer' }}>Mark as Billed</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── case sidebar ──────────────────────────────────────────────────────────────

function CaseSidebar({ client, onClose, highlight }: { client: ClientBilling; onClose: () => void; highlight?: string }) {
  const q = highlight?.toLowerCase() ?? '';
  const firstMatchIndex = q ? client.cases.findIndex(c => c.caseId.toLowerCase().includes(q)) : -1;
  const firstMatchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (firstMatchRef.current) firstMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [highlight, client.clientName]);

  return (
    <>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.clientName}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{client.cases.length} cases · {fmtUSD(client.totalFee)} fee</div>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ minWidth: 380 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px 75px 70px', gap: 4, padding: '8px 12px 6px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #f3f4f6', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
            <span>Case ID</span><span>Type</span><span>Posting</span><span style={{ textAlign: 'right' }}>Recovered</span><span style={{ textAlign: 'right' }}>Fee</span>
          </div>
          {client.cases.map((c, i) => {
            const isMatch = q ? c.caseId.toLowerCase().includes(q) : false;
            return (
              <div key={i} ref={i === firstMatchIndex ? firstMatchRef : undefined} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px 75px 70px', gap: 4, padding: '8px 12px', borderBottom: '1px solid #f3f4f6', background: isMatch ? '#fef9c3' : (!c.isCurrentMonth ? '#fffbeb' : '#fff'), fontSize: 11 }}>
                <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.caseId}</span>
                <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.claimType || 'N/A'}</span>
                <span style={{ color: '#6b7280' }}>{fmtDate(c.postingDate)}</span>
                <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.amount)}</span>
                <span style={{ fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(c.fee)}</span>
              </div>
            );
          })}
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px 75px 70px', gap: 4, padding: '9px 12px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', position: 'sticky', bottom: 0, zIndex: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Total</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(client.totalFee)}</span>
          </div>
        </div>
      </div>
    </>
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

  const { onToggle } = useSidebar();

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
        input:focus{outline:none;border-color:#2563eb!important;}
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
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', height: 60, borderBottom: '1px solid #e4e4e7', background: '#fff' }}>
          <button onClick={onToggle} title="Toggle sidebar" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #e4e4e7', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a', flexShrink: 0, outline: 'none' }}>
            <PanelIcon />
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#11181c', letterSpacing: '-0.01em' }}>Billing</h1>
          {currentMonthLabel && <span style={{ fontSize: 13, color: '#a1a1aa', fontWeight: 400 }}>Ready to bill — {currentMonthLabel}</span>}
        </div>

        {error && <div style={{ padding: '10px 20px', background: '#fef2f2', borderBottom: '1px solid #fca5a5', color: '#dc2626', fontSize: 13 }}>{error}</div>}

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Above-table toolbar */}
          {!loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#11181c' }}>
                  Ready to Bill <span style={{ fontWeight: 400, color: '#a1a1aa' }}>{filtered.length}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={toolbarPill}><IconFilter /> Filter</button>
                  <button style={toolbarPill}><IconSort /> Sort</button>
                  <button style={toolbarPill}><IconCols /> Columns</button>
                </div>
              </div>
              <input
                placeholder="Search client or case ID…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ fontSize: 13, padding: '7px 12px 7px 36px', border: '1px solid #e4e4e7', borderRadius: 999, width: 220, color: '#11181c', outline: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: '10px center' }}
              />
            </div>
          )}

          {/* Table + sliding sidebar */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', border: '1px solid #e4e4e7', borderRadius: 14, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

            {/* HeroUI Table */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[1,2,3,4,5].map(i => <Sk key={i} h={52} />)}
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                  {search ? 'No clients match.' : 'No clients ready to bill.'}
                </div>
              ) : (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <Table variant="secondary" style={{ width: '100%' }}>
                    <Table.ScrollContainer>
                      <Table.Content aria-label="Ready to Bill">
                        <Table.Header>
                          <Table.Column isRowHeader>
                            <ColHdr label="Client" col="name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                          </Table.Column>
                          <Table.Column>
                            <ColHdr label="Rate" col="rate" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
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
                          <Table.Column> </Table.Column>
                        </Table.Header>
                        <Table.Body>
                          {sorted.map(c => (
                            <Table.Row
                              key={c.clientName}
                              id={c.clientName}
                              style={{ cursor: 'pointer', background: selectedClient?.clientName === c.clientName ? '#f0f7ff' : undefined }}
                              onPress={() => setSelectedClient(c)}
                            >
                              <Table.Cell>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <Avatar name={c.clientName} size={30} />
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#11181c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.clientName}</div>
                                    {c.prevMonthFee > 0 && <span style={{ fontSize: 10, fontWeight: 600, background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '1px 6px' }}>+prev month</span>}
                                  </div>
                                </div>
                              </Table.Cell>
                              <Table.Cell><span style={{ display: 'block', textAlign: 'right', fontSize: 12, color: '#71717a' }}>{fmtPct(c.rate)}</span></Table.Cell>
                              <Table.Cell><span style={{ display: 'block', textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#006FEE' }}>{fmtUSD(c.totalAmount)}</span></Table.Cell>
                              <Table.Cell><span style={{ display: 'block', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#11181c' }}>{fmtUSD(c.totalFee)}</span></Table.Cell>
                              <Table.Cell><span style={{ display: 'block', textAlign: 'right', fontSize: 12, color: '#71717a' }}>{c.cases.length}</span></Table.Cell>
                              <Table.Cell>
                                <div onClick={e => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                  <button
                                    onClick={() => setActiveClient(c)}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '6px 14px', border: 'none', borderRadius: 999, background: '#006FEE', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                  >
                                    <IconInvoice /> Invoice
                                  </button>
                                </div>
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                    <Table.Footer>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 120px 60px 120px', gap: 8, padding: '12px 16px', background: '#fafafa', borderRadius: 12, margin: '0 4px 4px', border: '1px solid #f0f0f0' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#11181c' }}>Total</span>
                        <span />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#006FEE', textAlign: 'right' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalAmount,0))}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#11181c', textAlign: 'right' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalFee,0))}</span>
                        <span style={{ fontSize: 12, color: '#71717a', textAlign: 'right' }}>{filtered.reduce((s,c)=>s+c.cases.length,0)}</span>
                        <span />
                      </div>
                    </Table.Footer>
                  </Table>
                </div>
              )}
            </div>

            {/* Sliding case sidebar */}
            <div style={{ width: selectedClient ? 400 : 0, transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)', overflow: 'hidden', borderLeft: selectedClient ? '1px solid #e4e4e7' : 'none', background: '#fff', flexShrink: 0, display: 'flex' }}>
              {selectedClient && (
                <div style={{ width: 400, display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
                  <CaseSidebar client={selectedClient} onClose={() => setSelectedClient(null)} highlight={search || undefined} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
