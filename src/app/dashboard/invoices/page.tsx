'use client';

import { useState, useEffect } from 'react';

const fmtUSD = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const isoToday = () => new Date().toISOString().slice(0, 10);

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

function Sk({ h = 16, w = '100%' }: { h?: number; w?: string | number }) {
  return (
    <div style={{ height: h, width: w, borderRadius: 6, background: 'linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
  );
}

function InvoiceRow({ inv, onDelete }: { inv: Invoice; onDelete: (num: string) => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteInvoice() {
    if (!confirm(`Delete invoice ${inv.invoice_number}?`)) return;
    setDeleting(true);
    await fetch(`/api/invoices/${inv.invoice_number}`, { method: 'DELETE' });
    onDelete(inv.invoice_number);
  }

  function printInvoice() {
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) return;
    const snap = inv.case_snapshot ?? [];
    const rate = snap.length > 0 && inv.total_reimbursed > 0 ? inv.billed_fee / inv.total_reimbursed : 0;
    w.document.write(`<!DOCTYPE html><html><head><title>Invoice ${inv.invoice_number}</title><style>
      *{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Helvetica Neue',sans-serif;font-size:13px;color:#111;}
      table{width:100%;border-collapse:collapse;}
      th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;padding:0 8px 8px;border-bottom:2px solid #e5e7eb;}
      td{padding:8px;font-size:12px;border-bottom:1px solid #f3f4f6;}
      @media print{body{padding:24px;}}
    </style></head><body><div style="max-width:720px;margin:40px auto;padding:0 24px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:32px;">
        <div>
          <div style="font-size:22px;font-weight:800;color:#2563eb;">WFS Analytics</div>
          <div style="font-size:11px;color:#888;">Walmart Fulfillment Services Billing</div>
        </div>
        <div style="text-align:right;font-size:12px;color:#666;line-height:1.9;">
          <div style="font-size:18px;font-weight:800;color:#111;">INVOICE</div>
          <div><strong>Invoice #:</strong> ${inv.invoice_number}</div>
          <div><strong>Date:</strong> ${fmtDate(inv.billed_date?.slice(0, 10) ?? '')}</div>
        </div>
      </div>
      <div style="margin-bottom:28px;">
        <div style="font-size:10px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Bill To</div>
        <div style="font-size:16px;font-weight:700;">${inv.client_name}</div>
      </div>
      <table>
        <thead><tr>
          <th>Case ID</th><th>Claim Type</th><th>RMS Posting Date</th>
          <th style="text-align:right;">Recovered</th><th style="text-align:right;">Fee</th>
        </tr></thead>
        <tbody>
          ${snap.map(c => `<tr>
            <td style="font-family:monospace;">${c.case_id}</td>
            <td>${c.claim_type ?? ''}</td>
            <td>${c.rms_posting_date ? fmtDate(c.rms_posting_date.slice(0, 10)) : ''}</td>
            <td style="text-align:right;font-weight:600;color:#2563eb;">${fmtUSD(c.reimbursement_amount)}</td>
            <td style="text-align:right;font-weight:700;">${fmtUSD(c.reimbursement_amount * rate)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="background:#f9fafb;">
            <td colspan="3" style="padding:12px 8px;font-weight:700;">Total</td>
            <td style="padding:12px 8px;text-align:right;font-weight:700;color:#2563eb;">${fmtUSD(inv.total_reimbursed)}</td>
            <td style="padding:12px 8px;text-align:right;font-weight:800;">${fmtUSD(inv.billed_fee)}</td>
          </tr>
        </tfoot>
      </table>
      <div style="margin-top:36px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#aaa;text-align:right;">
        WFS Analytics Dashboard · Generated ${fmtDate(isoToday())}
      </div>
    </div></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  const snapCount = inv.case_snapshot?.length || inv.case_ids?.length || 0;

  return (
    <div style={{ borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 120px 110px 110px 90px', gap: 8, padding: '12px 16px', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#2563eb' }}>{inv.invoice_number}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.client_name}</span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{fmtDate(inv.billed_date?.slice(0, 10) ?? '')}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(inv.total_reimbursed)}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(inv.billed_fee)}</span>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={() => setOpen(o => !o)} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 6, background: open ? '#f9fafb' : '#fff', cursor: 'pointer', color: '#374151' }}>
            {snapCount} case{snapCount !== 1 ? 's' : ''}
          </button>
          <button onClick={printInvoice} title="Print PDF" style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer', padding: '4px 8px', fontSize: 13 }}>🖨</button>
          <button onClick={deleteInvoice} disabled={deleting} title="Delete" style={{ border: '1px solid #fca5a5', borderRadius: 6, background: '#fff', cursor: 'pointer', padding: '4px 8px', fontSize: 13, color: '#dc2626' }}>✕</button>
        </div>
      </div>

      {open && snapCount > 0 && (
        <div style={{ background: '#f9fafb', borderTop: '1px solid #f3f4f6' }}>
          {inv.case_snapshot && inv.case_snapshot.length > 0 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 130px 110px', gap: 8, padding: '8px 16px 6px 32px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                <span>Case ID</span><span>Type</span><span>Posting Date</span><span style={{ textAlign: 'right' }}>Recovered</span>
              </div>
              {inv.case_snapshot.map((c, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 130px 110px', gap: 8, padding: '7px 16px 7px 32px', borderTop: '1px solid #f3f4f6', fontSize: 12 }}>
                  <span style={{ fontFamily: 'monospace', color: '#374151' }}>{c.case_id}</span>
                  <span style={{ color: '#374151' }}>{c.claim_type}</span>
                  <span style={{ color: '#374151' }}>{c.rms_posting_date ? fmtDate(c.rms_posting_date.slice(0, 10)) : '—'}</span>
                  <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.reimbursement_amount)}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <div style={{ padding: '8px 16px 6px 32px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>Case IDs</div>
              <div style={{ padding: '4px 16px 12px 32px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(inv.case_ids ?? []).map((id, i) => (
                  <span key={i} style={{ fontFamily: 'monospace', fontSize: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 5, padding: '3px 8px', color: '#374151' }}>{id}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/invoices')
      .then(r => r.json())
      .then(d => { setInvoices(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = invoices.filter(inv =>
    !search ||
    inv.client_name?.toLowerCase().includes(search.toLowerCase()) ||
    inv.invoice_number?.toLowerCase().includes(search.toLowerCase())
  );

  const totalFee = filtered.reduce((s, i) => s + (i.billed_fee ?? 0), 0);
  const totalRecovered = filtered.reduce((s, i) => s + (i.total_reimbursed ?? 0), 0);

  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}} button:hover{opacity:.88} input:focus{outline:none;border-color:#2563eb!important;}`}</style>

      <div style={{ padding: '28px 32px', maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: '-0.01em' }}>Invoices</h1>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 3, fontWeight: 500 }}>
              {loading ? 'Loading…' : `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''} total`}
            </p>
          </div>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
          {loading ? [1, 2, 3].map(i => (
            <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px', flex: '1 1 140px' }}>
              <Sk h={10} w={70} /><div style={{ height: 10 }} /><Sk h={26} w={100} />
            </div>
          )) : (
            <>
              {[
                { label: 'Total Invoices', val: String(invoices.length), color: '#111827' },
                { label: 'Total Billed', val: fmtUSD(invoices.reduce((s, i) => s + (i.billed_fee ?? 0), 0)), color: '#111827' },
                { label: 'Total Recovered', val: fmtUSD(invoices.reduce((s, i) => s + (i.total_reimbursed ?? 0), 0)), color: '#2563eb' },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px', flex: '1 1 140px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: '-0.02em' }}>{val}</div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Table */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
              Invoice History {!loading && search && <span style={{ color: '#6b7280', fontWeight: 500 }}>({filtered.length})</span>}
            </h3>
            <input
              placeholder="Search invoice or client…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ fontSize: 13, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 8, width: 230, color: '#374151' }}
            />
          </div>

          {!loading && filtered.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 120px 110px 110px 90px', gap: 8, padding: '8px 16px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #f3f4f6' }}>
              <span>Invoice #</span><span>Client</span><span>Date</span>
              <span style={{ textAlign: 'right' }}>Recovered</span><span style={{ textAlign: 'right' }}>Fee</span><span />
            </div>
          )}

          {loading ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1, 2, 3, 4, 5].map(i => <Sk key={i} h={48} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              {search ? 'No invoices match.' : 'No invoices yet. Generate one from the Billing tab.'}
            </div>
          ) : (
            filtered.map(inv => (
              <InvoiceRow
                key={inv.invoice_number}
                inv={inv}
                onDelete={num => setInvoices(prev => prev.filter(i => i.invoice_number !== num))}
              />
            ))
          )}

          {!loading && filtered.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 120px 110px 110px 90px', gap: 8, padding: '12px 16px', borderTop: '2px solid #e5e7eb', background: '#f9fafb' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>
                {search ? `Filtered total (${filtered.length})` : `Total (${invoices.length})`}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(totalRecovered)}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(totalFee)}</span>
              <span />
            </div>
          )}
        </div>

      </div>
    </>
  );
}
