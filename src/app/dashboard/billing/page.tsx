'use client';

import { useState, useEffect, useRef } from 'react';

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

function downloadCSV(clients: ClientBilling[]) {
  const rows: string[] = [
    'Client,Case ID,Claim Type,Posting Date,Recovered,Fee,Rate',
  ];
  clients.forEach(c => {
    c.cases.forEach(cs => {
      rows.push([
        `"${c.clientName}"`,
        cs.caseId,
        `"${cs.claimType}"`,
        cs.postingDate,
        cs.amount.toFixed(2),
        cs.fee.toFixed(2),
        fmtPct(c.rate),
      ].join(','));
    });
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `billing-rtb-${isoToday()}.csv`;
  a.click();
}

function downloadClientCSV(client: ClientBilling) {
  const rows: string[] = ['Case ID,Claim Type,Posting Date,Recovered,Fee'];
  client.cases.forEach(cs => {
    rows.push([cs.caseId, `"${cs.claimType}"`, cs.postingDate, cs.amount.toFixed(2), cs.fee.toFixed(2)].join(','));
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `invoice-${client.clientName.replace(/\s+/g, '-')}-${isoToday()}.csv`;
  a.click();
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
  onClose,
  onSaved,
}: {
  client: ClientBilling;
  invoiceNumber: string;
  onClose: () => void;
  onSaved: (inv: Invoice) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [invNum, setInvNum] = useState(invoiceNumber);
  const [billedDate, setBilledDate] = useState(isoToday());
  const printRef = useRef<HTMLDivElement>(null);

  async function saveInvoice() {
    setSaving(true);
    setErr('');
    const inv = {
      invoice_number: invNum,
      client_name: client.clientName,
      billed_date: new Date(billedDate).toISOString(),
      billed_fee: client.totalFee,
      total_reimbursed: client.totalAmount,
      case_ids: [...new Set(client.cases.map(c => c.caseId))],
      case_snapshot: client.cases.map(c => ({
        case_id: c.caseId,
        claim_type: c.claimType,
        rms_posting_date: c.postingDate,
        reimbursement_amount: c.amount,
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

  function printInvoice() {
    const el = printRef.current;
    if (!el) return;
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Invoice ${invNum}</title><style>
      *{margin:0;padding:0;box-sizing:border-box;}
      body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#111;}
      .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;}
      .logo{font-size:20px;font-weight:800;color:#2563eb;}
      .meta{text-align:right;font-size:12px;color:#555;line-height:1.8;}
      .section{margin-bottom:24px;}
      .label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:4px;}
      .value{font-size:14px;font-weight:600;}
      table{width:100%;border-collapse:collapse;margin-top:8px;}
      th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;padding:0 8px 8px;border-bottom:2px solid #e5e7eb;}
      td{padding:8px;font-size:12px;border-bottom:1px solid #f3f4f6;}
      .num{text-align:right;}
      .total-row{font-weight:700;font-size:13px;background:#f9fafb;}
      .footer{margin-top:40px;font-size:11px;color:#888;text-align:center;}
      @media print{body{padding:24px;}}
    </style></head><body><div style="max-width:720px;margin:40px auto;padding:0 24px;">`);
    w.document.write(el.innerHTML);
    w.document.write('</div></body></html>');
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>

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
            <button onClick={() => downloadClientCSV(client)} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#374151' }}>
              ↓ CSV
            </button>
            <button onClick={printInvoice} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#374151' }}>
              🖨 Print PDF
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
          <div ref={printRef} style={{ background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', padding: 32 }}>

            {/* Header */}
            <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
              <div>
                <div className="logo" style={{ fontSize: 22, fontWeight: 800, color: '#2563eb', marginBottom: 4 }}>WFS Analytics</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>Walmart Fulfillment Services Billing</div>
              </div>
              <div className="meta" style={{ textAlign: 'right', fontSize: 12, color: '#6b7280', lineHeight: 1.9 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>INVOICE</div>
                <div><strong>Invoice #:</strong> {invNum}</div>
                <div><strong>Date:</strong> {fmtDate(billedDate)}</div>
              </div>
            </div>

            {/* Bill to */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Bill To</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{client.clientName}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Fee Rate: {fmtPct(client.rate)}</div>
            </div>

            {/* Cases table */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Case ID', 'Claim Type', 'RMS Posting Date', 'Recovered', 'Fee'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Recovered' || h === 'Fee' ? 'right' : 'left', padding: '0 8px 10px', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '2px solid #e5e7eb' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {client.cases.map((c, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6', background: !c.isCurrentMonth ? '#fffbeb' : '#fff' }}>
                    <td style={{ padding: '9px 8px', fontFamily: 'monospace', fontSize: 12, color: '#374151' }}>{c.caseId}</td>
                    <td style={{ padding: '9px 8px', fontSize: 12, color: '#374151' }}>{c.claimType}</td>
                    <td style={{ padding: '9px 8px', fontSize: 12, color: '#374151' }}>
                      {fmtDate(c.postingDate)}
                      {!c.isCurrentMonth && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '1px 4px' }}>PREV</span>}
                    </td>
                    <td style={{ padding: '9px 8px', fontSize: 12, fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.amount)}</td>
                    <td style={{ padding: '9px 8px', fontSize: 12, fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(c.fee)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f9fafb' }}>
                  <td colSpan={3} style={{ padding: '12px 8px', fontSize: 13, fontWeight: 700, color: '#111827' }}>Total</td>
                  <td style={{ padding: '12px 8px', fontSize: 13, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</td>
                  <td style={{ padding: '12px 8px', fontSize: 14, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(client.totalFee)}</td>
                </tr>
              </tfoot>
            </table>

            {/* Footer */}
            <div style={{ marginTop: 36, paddingTop: 16, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>
                <div style={{ fontWeight: 600, color: '#6b7280', marginBottom: 2 }}>Payment</div>
                <div>Amount due: {fmtUSD(client.totalFee)}</div>
                <div>Cases covered: {client.cases.length}</div>
                <div>Total recovered: {fmtUSD(client.totalAmount)}</div>
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'right' }}>
                <div>WFS Analytics Dashboard</div>
                <div>Generated {fmtDate(isoToday())}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── client RTB row ────────────────────────────────────────────────────────────

function ClientRow({ client, onGenerateInvoice }: { client: ClientBilling; onGenerateInvoice: (c: ClientBilling) => void }) {
  const [open, setOpen] = useState(false);
  const hasPrev = client.prevMonthFee > 0;

  return (
    <div style={{ borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 110px 70px 120px', gap: 8, padding: '11px 16px', alignItems: 'center', cursor: 'pointer', background: open ? '#f9fafb' : 'transparent' }}>
        <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.clientName}</span>
          {hasPrev && <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '2px 5px', flexShrink: 0 }}>+PREV</span>}
        </div>
        <div onClick={() => setOpen(o => !o)} style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{fmtPct(client.rate)}</div>
        <div onClick={() => setOpen(o => !o)} style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</div>
        <div onClick={() => setOpen(o => !o)} style={{ fontSize: 13, fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(client.totalFee)}</div>
        <div onClick={() => setOpen(o => !o)} style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{client.cases.length}</div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={() => downloadClientCSV(client)} style={{ fontSize: 11, fontWeight: 600, padding: '5px 9px', border: '1px solid #e5e7eb', borderRadius: 7, background: '#fff', cursor: 'pointer', color: '#374151' }}>CSV</button>
          <button onClick={() => onGenerateInvoice(client)} style={{ fontSize: 11, fontWeight: 600, padding: '5px 9px', border: 'none', borderRadius: 7, background: '#2563eb', color: '#fff', cursor: 'pointer' }}>Invoice</button>
        </div>
      </div>

      {open && (
        <div style={{ background: '#f9fafb', borderTop: '1px solid #f3f4f6' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 130px 110px 110px', gap: 8, padding: '8px 16px 6px 24px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            <span>Case ID</span><span>Type</span><span>Posting Date</span><span style={{ textAlign: 'right' }}>Recovered</span><span style={{ textAlign: 'right' }}>Fee</span>
          </div>
          {client.cases.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 130px 110px 110px', gap: 8, padding: '8px 16px 8px 24px', borderTop: '1px solid #f3f4f6', alignItems: 'center', background: !c.isCurrentMonth ? '#fffbeb' : '#fff', fontSize: 12 }}>
              <span style={{ fontFamily: 'monospace', color: '#374151' }}>{c.caseId}</span>
              <span style={{ color: '#374151' }}>{c.claimType}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ color: '#374151' }}>{fmtDate(c.postingDate)}</span>
                {!c.isCurrentMonth && <span style={{ fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#92400e', borderRadius: 3, padding: '1px 4px' }}>PREV</span>}
              </div>
              <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.amount)}</span>
              <span style={{ fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(c.fee)}</span>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 130px 110px 110px', gap: 8, padding: '10px 16px 10px 24px', borderTop: '1px solid #e5e7eb', background: '#f3f4f6' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Subtotal</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(client.totalAmount)}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(client.totalFee)}</span>
          </div>
        </div>
      )}
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
  const [nextNum, setNextNum] = useState('NV-1001');

  useEffect(() => {
    fetch('/api/billing')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });

    fetch('/api/invoices/next-number')
      .then(r => r.json())
      .then(d => setNextNum(d.nextNumber ?? 'NV-1001'));
  }, []);

  function handleInvoiceSaved(inv: Invoice) {
    const parts = nextNum.split('-');
    const n = parseInt(parts[1] ?? '1000');
    setNextNum(`${parts[0]}-${n + 1}`);
    if (data) {
      setData({ ...data, clients: data.clients.filter(c => c.clientName !== inv.client_name) });
    }
    setActiveClient(null);
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
          onClose={() => setActiveClient(null)}
          onSaved={handleInvoiceSaved}
        />
      )}

      <div style={{ padding: '28px 32px', maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: '-0.01em' }}>Billing</h1>
            {currentMonthLabel && <p style={{ fontSize: 13, color: '#6b7280', marginTop: 3, fontWeight: 500 }}>Ready to bill — {currentMonthLabel}</p>}
          </div>
          {!loading && data && (
            <button onClick={() => downloadCSV(data.clients)} style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#374151' }}>
              ↓ Export All CSV
            </button>
          )}
        </div>

        {error && <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>{error}</div>}

        {/* Summary cards */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
          {loading ? [1,2,3,4].map(i => (
            <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px', flex: '1 1 140px' }}>
              <Sk h={10} w={70} /><div style={{ height: 10 }} /><Sk h={26} w={100} />
            </div>
          )) : (<>
            {[
              { label: 'Total Fees RTB', val: fmtUSD(data?.totalFee ?? 0), color: '#111827' },
              { label: 'Total Recovered', val: fmtUSD(data?.totalAmount ?? 0), color: '#2563eb' },
              { label: 'Clients Ready', val: String(data?.clients.length ?? 0), color: '#111827' },
              { label: 'Total Cases', val: String(data?.totalCases ?? 0), color: '#111827' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px', flex: '1 1 140px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.02em' }}>{val}</div>
              </div>
            ))}
          </>)}
        </div>

        {/* RTB Client table */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '16px 16px 0', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                Ready to Bill {!loading && <span style={{ color: '#6b7280', fontWeight: 500 }}>({filtered.length})</span>}
              </h3>
              <input placeholder="Search client…" value={search} onChange={e => setSearch(e.target.value)}
                style={{ fontSize: 13, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 8, width: 180, color: '#374151' }} />
            </div>
            {!loading && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 110px 70px 120px', gap: 8, padding: '0 0 10px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>
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
            filtered.map(c => <ClientRow key={c.clientName} client={c} onGenerateInvoice={c => setActiveClient(c)} />)
          )}

          {!loading && filtered.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 110px 70px 120px', gap: 8, padding: '13px 16px', borderTop: '2px solid #e5e7eb', background: '#f9fafb' }}>
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
