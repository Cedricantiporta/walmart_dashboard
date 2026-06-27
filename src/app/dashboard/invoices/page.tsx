'use client';

import { useState, useEffect } from 'react';
import { clientGet, clientSet, clientClear } from '@/lib/client-cache';
import { downloadInvoicePDF } from '@/lib/invoice-pdf';

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
  case_snapshot: { case_id: string; claim_type: string; rms_posting_date: string; reimbursement_amount: number; gtin?: string; sku_id?: string; unit_amount?: number; reimbursed_qty?: number }[];
  pdf_url?: string;
};

function Sk({ h = 16, w = '100%' }: { h?: number; w?: string | number }) {
  return (
    <div style={{ height: h, width: w, borderRadius: 6, background: 'linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
  );
}

const GAS_HEADERS = 'Invoice To,Country,Walmart Posting Date,Item Description,Claim Type,GTIN,SKU ID,Case ID,Unit Amount,Rate,Quantity,Total Reimbursement,Conversion Rate,Currency,Total Reimbursed USD,Fee Amount';

function fmtMDY(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function fmtPctNum(r: number) {
  const p = Math.round(r * 100);
  return `${p}%`;
}

type CaseRow = { case_id: string; claim_type: string; rms_posting_date: string; reimbursement_amount: number; gtin?: string; sku_id?: string; unit_amount?: number; reimbursed_qty?: number };

async function fetchCasesByIds(ids: string[]): Promise<CaseRow[]> {
  if (!ids.length) return [];
  const res = await fetch('/api/cases/by-ids', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
  return res.ok ? res.json() : [];
}

function buildCSVRows(inv: Invoice, cases: CaseRow[]): string[] {
  const rate = inv.total_reimbursed > 0 ? inv.billed_fee / inv.total_reimbursed : 0;
  if (cases.length > 0) {
    return cases.map(c => {
      const unitAmt = (c.unit_amount ?? c.reimbursement_amount).toFixed(2);
      const qty = c.reimbursed_qty ?? 1;
      const total = c.reimbursement_amount.toFixed(2);
      return [
        `"${inv.client_name}"`, 'US', fmtMDY(c.rms_posting_date),
        `"Reimbursement Recovery for Case ID ${c.case_id} for $${total}"`,
        c.claim_type || 'N/A', c.gtin || '', c.sku_id || '', c.case_id,
        `$${unitAmt}`, fmtPctNum(rate), String(qty), `$${total}`, '', 'USD', `$${total}`,
        `$${(c.reimbursement_amount * rate).toFixed(2)}`,
      ].join(',');
    });
  }
  // Fallback: evenly divide (no rms_cases data available)
  const ids = inv.case_ids ?? [];
  const perCase = ids.length > 0 ? inv.total_reimbursed / ids.length : 0;
  const perFee = ids.length > 0 ? inv.billed_fee / ids.length : 0;
  const postingDate = fmtMDY(inv.billed_date?.slice(0, 10) ?? isoToday());
  return ids.map(id => {
    const amt = perCase.toFixed(2);
    return [
      `"${inv.client_name}"`, 'US', postingDate,
      `"Reimbursement Recovery for Case ID ${id} for $${amt}"`,
      'N/A', '', '', id,
      `$${amt}`, fmtPctNum(rate), '1', `$${amt}`, '', 'USD', `$${amt}`,
      `$${perFee.toFixed(2)}`,
    ].join(',');
  });
}

function triggerCSVDownload(inv: Invoice, cases: CaseRow[]) {
  const rows = buildCSVRows(inv, cases);
  const csv = [`${inv.invoice_number},,,,,,,,,,,,,,`, GAS_HEADERS, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${inv.invoice_number}-${inv.client_name.replace(/\s+/g, '-')}.csv`;
  a.click();
}

function InvoiceRow({ inv, onDelete }: { inv: Invoice; onDelete: (num: string) => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fetchedCases, setFetchedCases] = useState<CaseRow[] | null>(null);
  const [fetchingCases, setFetchingCases] = useState(false);

  const hasSnapshot = (inv.case_snapshot?.length ?? 0) > 0;
  const activeCases: CaseRow[] = (hasSnapshot
    ? inv.case_snapshot.map(c => ({
        case_id: c.case_id,
        claim_type: c.claim_type,
        rms_posting_date: c.rms_posting_date,
        reimbursement_amount: c.reimbursement_amount,
        gtin: c.gtin,
        sku_id: c.sku_id,
        unit_amount: c.unit_amount,
        reimbursed_qty: c.reimbursed_qty,
      }))
    : (fetchedCases ?? [])
  ).filter(c => !!c.rms_posting_date);

  function handleToggle() {
    setOpen(o => !o);
    if (!hasSnapshot && fetchedCases === null && !fetchingCases && inv.case_ids?.length) {
      setFetchingCases(true);
      fetchCasesByIds(inv.case_ids).then(rows => { setFetchedCases(rows); setFetchingCases(false); });
    }
  }

  async function deleteInvoice() {
    if (!confirm(`Delete invoice ${inv.invoice_number}?`)) return;
    setDeleting(true);
    await fetch(`/api/invoices/${inv.invoice_number}`, { method: 'DELETE' });
    onDelete(inv.invoice_number);
  }

  async function downloadPDF() {
    if (inv.pdf_url) { window.open(inv.pdf_url, '_blank'); return; }
    const cases = activeCases.length > 0 ? activeCases : await fetchCasesByIds(inv.case_ids ?? []);
    await downloadInvoicePDF({
      invoice_number: inv.invoice_number,
      client_name: inv.client_name,
      billed_date: inv.billed_date?.slice(0, 10) ?? isoToday(),
      billed_fee: inv.billed_fee,
      total_reimbursed: inv.total_reimbursed,
      case_ids: inv.case_ids,
    }, cases);
  }


  const snapCount = inv.case_snapshot?.length || inv.case_ids?.length || 0;

  return (
    <div style={{ borderBottom: '1px solid #f3f4f6' }}>
      <div
        onClick={handleToggle}
        style={{ display: 'grid', gridTemplateColumns: '130px 1fr 52px 110px 110px 110px 126px', gap: 12, padding: '9px 16px', alignItems: 'center', cursor: 'pointer', background: open ? '#f9fafb' : 'transparent' }}
      >
        <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#2563eb' }}>{inv.invoice_number}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.client_name}</span>
        <span style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>{snapCount}</span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{fmtDate(inv.billed_date?.slice(0, 10) ?? '')}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(inv.total_reimbursed)}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(inv.billed_fee)}</span>
        <div
          style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={async () => { const cases = hasSnapshot ? activeCases : (fetchedCases ?? await fetchCasesByIds(inv.case_ids ?? [])); triggerCSVDownload(inv, cases); }} style={{ fontSize: 11, fontWeight: 600, padding: '4px 7px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#374151' }}>CSV</button>
          <button onClick={downloadPDF} style={{ fontSize: 11, fontWeight: 600, padding: '4px 7px', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#374151' }}>PDF</button>
          <button onClick={deleteInvoice} disabled={deleting} style={{ border: '1px solid #fca5a5', borderRadius: 6, background: '#fff', cursor: 'pointer', padding: '4px 7px', fontSize: 12, color: '#dc2626' }}>✕</button>
        </div>
      </div>

      {open && snapCount > 0 && (
        <div style={{ background: '#f9fafb', borderTop: '1px solid #f3f4f6' }}>
          {fetchingCases ? (
            <div style={{ padding: '12px 16px 12px 32px', fontSize: 12, color: '#9ca3af' }}>Loading case data…</div>
          ) : activeCases.length > 0 ? (
            <>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 110px 90px 100px 100px 80px 55px 50px 95px 80px', gap: 6, padding: '8px 16px 6px 32px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em', minWidth: 860 }}>
                  <span>Case ID</span><span>Posting Date</span><span>Type</span><span>GTIN</span><span>SKU ID</span>
                  <span style={{ textAlign: 'right' }}>Unit Amt</span><span style={{ textAlign: 'right' }}>Rate</span><span style={{ textAlign: 'right' }}>Qty</span>
                  <span style={{ textAlign: 'right' }}>Recovered</span><span style={{ textAlign: 'right' }}>Fee</span>
                </div>
                {activeCases.map((c, i) => {
                  const rate = inv.total_reimbursed > 0 ? inv.billed_fee / inv.total_reimbursed : 0;
                  const unitAmt = c.unit_amount ?? c.reimbursement_amount;
                  const qty = c.reimbursed_qty ?? 1;
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 110px 90px 100px 100px 80px 55px 50px 95px 80px', gap: 6, padding: '7px 16px 7px 32px', borderTop: '1px solid #f3f4f6', fontSize: 11, minWidth: 860 }}>
                      <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.case_id}</span>
                      <span style={{ color: '#374151' }}>{c.rms_posting_date ? fmtDate(c.rms_posting_date.slice(0, 10)) : '—'}</span>
                      <span style={{ color: '#374151' }}>{c.claim_type || '—'}</span>
                      <span style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.gtin || '—'}</span>
                      <span style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sku_id || '—'}</span>
                      <span style={{ fontWeight: 600, color: '#374151', textAlign: 'right' }}>{fmtUSD(unitAmt)}</span>
                      <span style={{ color: '#6b7280', textAlign: 'right' }}>{fmtPctNum(rate)}</span>
                      <span style={{ color: '#374151', textAlign: 'right' }}>{qty}</span>
                      <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.reimbursement_amount)}</span>
                      <span style={{ fontWeight: 700, color: '#111827', textAlign: 'right' }}>{fmtUSD(c.reimbursement_amount * rate)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ padding: '8px 16px 12px 32px', fontSize: 12, color: '#9ca3af' }}>No case data found in database.</div>
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
    const cached = clientGet<Invoice[]>('invoices');
    if (cached) { setInvoices(cached); setLoading(false); return; }
    fetch('/api/invoices')
      .then(r => r.json())
      .then(d => { const arr = Array.isArray(d) ? d : []; clientSet('invoices', arr); setInvoices(arr); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = invoices.filter(inv => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      inv.client_name?.toLowerCase().includes(q) ||
      inv.invoice_number?.toLowerCase().includes(q) ||
      (inv.case_ids ?? []).some(id => id.toLowerCase().includes(q)) ||
      (inv.case_snapshot ?? []).some(cs => cs.case_id.toLowerCase().includes(q))
    );
  });

  const totalFee = filtered.reduce((s, i) => s + (i.billed_fee ?? 0), 0);
  const totalRecovered = filtered.reduce((s, i) => s + (i.total_reimbursed ?? 0), 0);

  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}} button:hover{opacity:.88} input:focus{outline:none;border-color:#2563eb!important;}`}</style>

      <div style={{ padding: '20px 28px', maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: '-0.01em' }}>Invoices</h1>
            {!loading && <span style={{ fontSize: 13, color: '#9ca3af', fontWeight: 500 }}>{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</span>}
          </div>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 160px)' }}>
          <div style={{ flexShrink: 0, padding: '14px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
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

          {loading ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1, 2, 3, 4, 5].map(i => <Sk key={i} h={48} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              {search ? 'No invoices match.' : 'No invoices yet. Generate one from the Billing tab.'}
            </div>
          ) : (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ minWidth: 760 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 52px 110px 110px 110px 126px', gap: 12, padding: '8px 16px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #f3f4f6', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
                  <span>Invoice #</span><span>Client</span><span style={{ textAlign: 'right' }}>Cases</span><span>Date</span>
                  <span style={{ textAlign: 'right' }}>Recovered</span><span style={{ textAlign: 'right' }}>Fee</span><span />
                </div>
                {filtered.map(inv => (
                  <InvoiceRow
                    key={inv.invoice_number}
                    inv={inv}
                    onDelete={num => setInvoices(prev => {
                      const next = prev.filter(i => i.invoice_number !== num);
                      clientClear('invoices');
                      return next;
                    })}
                  />
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 52px 110px 110px 110px 126px', gap: 12, padding: '12px 16px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', position: 'sticky', bottom: 0, zIndex: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', gridColumn: '1/5' }}>
                    {search ? `Filtered total (${filtered.length})` : `Total (${invoices.length})`}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(totalRecovered)}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', textAlign: 'right' }}>{fmtUSD(totalFee)}</span>
                  <span />
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
