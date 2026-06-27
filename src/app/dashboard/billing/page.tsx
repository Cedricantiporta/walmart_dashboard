'use client';

import { useState, useEffect } from 'react';
import { clientGet, clientSet, clientClear } from '@/lib/client-cache';
import { downloadInvoicePDF } from '@/lib/invoice-pdf';

// ── formatters ────────────────────────────────────────────────────────────────

const fmtUSD = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
const fmtPct = (r: number) => `${(r * 100 % 1 === 0 ? (r * 100).toFixed(0) : (r * 100).toFixed(1))}%`;
const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const isoToday = () => new Date().toISOString().slice(0, 10);

// ── types ─────────────────────────────────────────────────────────────────────

type BillingCase = {
  caseId: string;
  claimType: string;
  postingDate: string;
  amount: number;
  fee: number;
  isCurrentMonth: boolean;
  gtin?: string;
  sku_id?: string;
  unit_amount?: number;
  reimbursed_qty?: number;
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
type BillingContactInfo = {
  client_name: string;
  invoice_date: string | null;
  payment_terms: string | null;
  address: string | null;
};
type BillingData = {
  clients: ClientBilling[];
  totalFee: number;
  totalAmount: number;
  totalCases: number;
  currentMonthStart: string;
  billingSummaryInfo: Record<string, BillingContactInfo>;
};
type Invoice = {
  id?: number;
  invoice_number: string;
  client_name: string;
  billed_date: string;
  billed_fee: number;
  total_reimbursed: number;
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
  return [
    `"${clientName}"`,
    'US',
    fmtMDY(cs.postingDate),
    `"Reimbursement Recovery for Case ID ${cs.caseId} for $${total}"`,
    cs.claimType || 'N/A',
    cs.gtin || '',
    cs.sku_id || '',
    cs.caseId,
    `$${unitAmt}`,
    fmtPct(rate),
    String(qty),
    `$${total}`,
    '',
    'USD',
    `$${total}`,
    `$${cs.fee.toFixed(2)}`,
  ].join(',');
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

function downloadCSV(clients: ClientBilling[]) {
  triggerDownload(buildGasCSV('', clients), `billing-rtb-${isoToday()}.csv`);
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

// ── invoice print modal ───────────────────────────────────────────────────────

function InvoiceModal({
  client,
  invoiceNumber,
  billingContact,
  onClose,
  onSaved,
}: {
  client: ClientBilling;
  invoiceNumber: string;
  billingContact: BillingContactInfo | null;
  onClose: () => void;
  onSaved: (inv: Invoice) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [invNum, setInvNum] = useState(invoiceNumber);
  const [billedDate, setBilledDate] = useState(isoToday());

  const dueDate = (() => {
    const d = new Date(billedDate + 'T12:00:00');
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  })();

  async function saveInvoice() {
    setSaving(true);
    setErr('');
    const inv = {
      invoice_number: invNum,
      client_name: client.clientName,
      billed_date: new Date(billedDate + 'T12:00:00').toISOString(),
      billed_fee: client.totalFee,
      total_reimbursed: client.totalAmount,
      case_ids: [...new Set(client.cases.map(c => c.caseId))],
      case_snapshot: client.cases.map(c => ({
        case_id: c.caseId,
        claim_type: c.claimType,
        rms_posting_date: c.postingDate,
        reimbursement_amount: c.amount,
        gtin: c.gtin ?? '',
        sku_id: c.sku_id ?? '',
        unit_amount: c.unit_amount ?? c.amount,
        reimbursed_qty: c.reimbursed_qty ?? 1,
      })),
      pdf_url: '',
    };
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inv),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data.error ?? 'Failed to save'); setSaving(false); return; }
    onSaved(data.invoice ?? inv);
  }

  async function handleDownloadPDF() {
    await downloadInvoicePDF(
      {
        invoice_number: invNum,
        client_name: client.clientName,
        client_address: billingContact?.address ?? null,
        billed_date: billedDate,
        billed_fee: client.totalFee,
        total_reimbursed: client.totalAmount,
        case_ids: [...new Set(client.cases.map(c => c.caseId))],
      },
      client.cases.map(c => ({
        case_id: c.caseId,
        claim_type: c.claimType,
        rms_posting_date: c.postingDate,
        reimbursement_amount: c.amount,
      }))
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 800, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>

        {/* Modal header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>Generate Invoice — {client.clientName}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1 }}>×</button>
        </div>

        {/* Invoice controls */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Invoice #</span>
            <input value={invNum} onChange={e => setInvNum(e.target.value)} style={{ fontSize: 13, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6, width: 130, fontWeight: 600 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Invoice Date</span>
            <input type="date" value={billedDate} onChange={e => setBilledDate(e.target.value)} style={{ fontSize: 13, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 6 }} />
          </label>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => downloadClientCSV(client, invNum)} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#374151' }}>
              ↓ CSV
            </button>
            <button onClick={handleDownloadPDF} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#374151' }}>
              ↓ Download PDF
            </button>
            <button onClick={saveInvoice} disabled={saving} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', border: 'none', borderRadius: 8, background: saving ? '#93c5fd' : '#2563eb', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : '✓ Save Invoice'}
            </button>
          </div>
        </div>

        {err && (
          <div style={{ padding: '8px 24px', background: '#fef2f2', color: '#dc2626', fontSize: 12, flexShrink: 0 }}>{err}</div>
        )}

        {/* Invoice preview (scrollable) */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', padding: 36 }}>

            {/* Header: sender left, INVOICE right */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', marginBottom: 6 }}>Threecolts</div>
                <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.7 }}>
                  16192 Coastal Highway<br />
                  Lewes, Delaware 19958<br />
                  United States<br />
                  support@threecolts.com
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#111827', letterSpacing: '-0.02em', marginBottom: 10 }}>INVOICE</div>
                <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 2 }}>
                  <div><strong style={{ color: '#374151' }}>Invoice #:</strong> {invNum}</div>
                  <div><strong style={{ color: '#374151' }}>Date:</strong> {fmtDate(billedDate)}</div>
                  <div><strong style={{ color: '#374151' }}>Due Date:</strong> {dueDate}</div>
                  {billingContact?.payment_terms && (
                    <div><strong style={{ color: '#374151' }}>Terms:</strong> {billingContact.payment_terms}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Bill To */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Bill To</div>
              <div style={{ height: 1, background: '#e5e7eb', marginBottom: 12 }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 4 }}>{client.clientName}</div>
              {billingContact?.address && (
                <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{billingContact.address}</div>
              )}
            </div>

            {/* Cases table — black header, GAS column names */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#111827' }}>
                  {['Case ID', 'Description', 'Approval Date', 'Recovered', 'Fee Rate', 'Fee Amount'].map(h => (
                    <th key={h} style={{ textAlign: ['Recovered', 'Fee Rate', 'Fee Amount'].includes(h) ? 'right' : 'left', padding: '10px 8px', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {client.cases.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6', background: !c.isCurrentMonth ? '#fffbeb' : '#fff' }}>
                    <td style={{ padding: '9px 8px', fontFamily: 'monospace', fontSize: 12, color: '#374151' }}>{c.caseId}</td>
                    <td style={{ padding: '9px 8px', fontSize: 12, color: '#374151' }}>{c.claimType || 'N/A'}</td>
                    <td style={{ padding: '9px 8px', fontSize: 12, color: '#374151' }}>
                      {fmtDate(c.postingDate)}
                      {!c.isCurrentMonth && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '1px 4px' }}>PREV</span>}
                    </td>
                    <td style={{ padding: '9px 8px', fontSize: 12, fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.amount)}</td>
                    <td style={{ padding: '9px 8px', fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{fmtPct(client.rate)}</td>
                    <td style={{ padding: '9px 8px', fontSize: 12, fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(c.fee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Summary block — bottom right, GAS style */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
              <div style={{ width: 260 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 12, color: '#374151' }}>Total Recovered:</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{fmtUSD(client.totalAmount)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 12, color: '#374151' }}>Subtotal:</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{fmtUSD(client.totalFee)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 10px', marginTop: 4, background: '#f3f4f6', borderRadius: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Amount Due (USD):</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>{fmtUSD(client.totalFee)}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ── client RTB row ────────────────────────────────────────────────────────────

function ClientRow({ client, selected, onRowClick, onGenerateInvoice }: { client: ClientBilling; selected: boolean; onRowClick: (c: ClientBilling) => void; onGenerateInvoice: (c: ClientBilling) => void }) {
  const hasPrev = client.prevMonthFee > 0;
  return (
    <div
      onClick={() => onRowClick(client)}
      style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: selected ? '#eff6ff' : 'transparent' }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 110px 60px 110px', gap: 8, padding: '10px 16px', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.clientName}</span>
          {hasPrev && <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '2px 5px', flexShrink: 0 }}>+PREV</span>}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{fmtPct(client.rate)}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(client.totalFee)}</div>
        <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{client.cases.length}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onGenerateInvoice(client)} style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', border: 'none', borderRadius: 7, background: '#2563eb', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>Invoice</button>
        </div>
      </div>
    </div>
  );
}

// ── case sidebar ──────────────────────────────────────────────────────────────

function CaseSidebar({ client, onClose }: {
  client: ClientBilling;
  onClose: () => void;
}) {
  return (
    <>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.clientName}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{client.cases.length} cases · {fmtUSD(client.totalFee)} fee</div>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af', lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 95px 80px 75px', gap: 4, padding: '8px 12px 6px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #f3f4f6', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <span>Case ID</span><span>Type</span><span>Posting</span><span style={{ textAlign: 'right' }}>Recovered</span><span style={{ textAlign: 'right' }}>Fee</span>
        </div>
        {client.cases.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 95px 80px 75px', gap: 4, padding: '8px 12px', borderBottom: '1px solid #f3f4f6', background: !c.isCurrentMonth ? '#fffbeb' : '#fff', fontSize: 11 }}>
            <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.caseId}</span>
            <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.claimType || 'N/A'}</span>
            <span style={{ color: '#6b7280' }}>{fmtDate(c.postingDate)}</span>
            <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.amount)}</span>
            <span style={{ fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(c.fee)}</span>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 95px 80px 75px', gap: 4, padding: '9px 12px', borderTop: '2px solid #e5e7eb', background: '#f9fafb' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Total</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(client.totalFee)}</span>
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

  useEffect(() => {
    const cached = clientGet<BillingData>('billing');
    if (cached) { setData(cached); setLoading(false); }
    else {
      fetch('/api/billing')
        .then(r => r.json())
        .then(d => { clientSet('billing', d); setData(d); setLoading(false); })
        .catch(e => { setError(e.message); setLoading(false); });
    }

    fetch('/api/invoices/next-number')
      .then(r => r.json())
      .then(d => setNextNum(d.nextNumber ?? 'NV-1001'));
  }, []);

  function handleInvoiceSaved(inv: Invoice) {
    const parts = nextNum.split('-');
    const n = parseInt(parts[1] ?? '1000');
    setNextNum(`${parts[0]}-${n + 1}`);
    clientClear('billing');
    clientClear('invoices');
    if (data) {
      const next = { ...data, clients: data.clients.filter(c => c.clientName !== inv.client_name) };
      setData(next);
    }
    setActiveClient(null);
    setSelectedClient(null);
  }

  const filtered = (data?.clients ?? []).filter(c =>
    !search || c.clientName.toLowerCase().includes(search.toLowerCase())
  );

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
          client={activeClient}
          invoiceNumber={nextNum}
          billingContact={data?.billingSummaryInfo?.[activeClient.clientName] ?? null}
          onClose={() => setActiveClient(null)}
          onSaved={handleInvoiceSaved}
        />
      )}

      <div style={{ padding: '28px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: '-0.01em' }}>Billing</h1>
          {currentMonthLabel && <p style={{ fontSize: 13, color: '#6b7280', marginTop: 3, fontWeight: 500 }}>Ready to bill — {currentMonthLabel}</p>}
        </div>

        {error && <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>{error}</div>}

        {/* RTB Client table + overlay sidebar */}
        <div style={{ position: 'relative' }}>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflowX: 'auto' }}>
            <div style={{ padding: '16px 16px 0', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                  Ready to Bill {!loading && <span style={{ color: '#6b7280', fontWeight: 500 }}>({filtered.length})</span>}
                </h3>
                <input placeholder="Search client…" value={search} onChange={e => setSearch(e.target.value)}
                  style={{ fontSize: 13, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 8, width: 180, color: '#374151' }} />
              </div>
              {!loading && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 110px 60px 110px', gap: 8, padding: '0 0 10px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', minWidth: 580 }}>
                  <span>Client</span><span style={{ textAlign: 'right' }}>Rate</span>
                  <span style={{ textAlign: 'right' }}>Recovered</span><span style={{ textAlign: 'right' }}>Fee</span>
                  <span style={{ textAlign: 'right' }}>Cases</span><span />
                </div>
              )}
            </div>

            {loading ? (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1,2,3,4,5].map(i => <Sk key={i} h={44} />)}
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                {search ? 'No clients match.' : 'No clients ready to bill.'}
              </div>
            ) : (
              filtered.map(c => (
                <ClientRow
                  key={c.clientName}
                  client={c}
                  selected={selectedClient?.clientName === c.clientName}
                  onRowClick={c => setSelectedClient(c)}
                  onGenerateInvoice={c => setActiveClient(c)}
                />
              ))
            )}

            {!loading && filtered.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 110px 60px 110px', gap: 8, padding: '13px 16px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', minWidth: 580 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Total</span>
                <span />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalAmount,0))}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(filtered.reduce((s,c)=>s+c.totalFee,0))}</span>
                <span style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{filtered.reduce((s,c)=>s+c.cases.length,0)}</span>
                <span />
              </div>
            )}
          </div>

          {/* Case sidebar — overlays the table, aligned to table top */}
          {selectedClient && (
            <div style={{ position: 'absolute', top: 0, right: 0, width: 480, height: '100%', minHeight: 360, maxHeight: 'calc(100vh - 160px)', zIndex: 10, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '-8px 0 32px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              <CaseSidebar
                client={selectedClient}
                onClose={() => setSelectedClient(null)}
              />
            </div>
          )}
        </div>

      </div>
    </>
  );
}
