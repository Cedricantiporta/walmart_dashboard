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

const GAS_HEADERS = 'Invoice To,Country,Walmart Posting Date,Item Description,Claim Type,GTIN,SKU ID,Case ID,Unit Amount,Rate,Quantity,Total Reimbursement,Conversion Rate,Currency,Total Reimbursed USD,Fee Amount';

function fmtMDY(iso: string) {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function fmtPctNum(r: number) {
  const p = Math.round(r * 100);
  return `${p}%`;
}

type CaseRow = { case_id: string; claim_type: string; rms_posting_date: string; reimbursement_amount: number };

async function fetchCasesByIds(ids: string[]): Promise<CaseRow[]> {
  if (!ids.length) return [];
  const res = await fetch('/api/cases/by-ids', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
  return res.ok ? res.json() : [];
}

function buildCSVRows(inv: Invoice, cases: CaseRow[]): string[] {
  const rate = inv.total_reimbursed > 0 ? inv.billed_fee / inv.total_reimbursed : 0;
  if (cases.length > 0) {
    return cases.map(c => {
      const amt = c.reimbursement_amount.toFixed(2);
      return [
        `"${inv.client_name}"`, 'US', fmtMDY(c.rms_posting_date),
        `"Reimbursement Recovery for Case ID ${c.case_id} for $${amt}"`,
        c.claim_type || 'N/A', '', '', c.case_id,
        `$${amt}`, fmtPctNum(rate), '1', `$${amt}`, '', 'USD', `$${amt}`,
        `$${(c.reimbursement_amount * rate).toFixed(2)}`,
      ].join(',');
    });
  }
  // Fallback: evenly divide (no rms_cases data)
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
  const activeCases: CaseRow[] = hasSnapshot
    ? inv.case_snapshot.map(c => ({ case_id: c.case_id, claim_type: c.claim_type, rms_posting_date: c.rms_posting_date, reimbursement_amount: c.reimbursement_amount }))
    : (fetchedCases ?? []);

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

  async function printInvoice() {
    const cases = activeCases.length > 0 ? activeCases : await fetchCasesByIds(inv.case_ids ?? []);
    const w = window.open('', '_blank', 'width=820,height=1060');
    if (!w) return;
    const rate = inv.total_reimbursed > 0 ? inv.billed_fee / inv.total_reimbursed : 0;
    const billedDateStr = inv.billed_date?.slice(0, 10) ?? isoToday();
    const dueDate = (() => {
      const d = new Date(billedDateStr + 'T12:00:00'); d.setDate(d.getDate() + 7);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    })();
    const tableRows = cases.length > 0
      ? cases.map(c => `<tr>
          <td style="font-family:monospace;">${c.case_id}</td>
          <td>${c.claim_type || 'N/A'}</td>
          <td>${c.rms_posting_date ? fmtDate(c.rms_posting_date.slice(0, 10)) : ''}</td>
          <td class="num" style="font-weight:600;color:#2563eb;">${fmtUSD(c.reimbursement_amount)}</td>
          <td class="num" style="color:#6b7280;">${fmtPctNum(rate)}</td>
          <td class="num" style="font-weight:700;">${fmtUSD(c.reimbursement_amount * rate)}</td>
        </tr>`).join('')
      : (inv.case_ids ?? []).map(id => `<tr>
          <td style="font-family:monospace;">${id}</td>
          <td colspan="2" style="color:#6b7280;">—</td>
          <td class="num" style="color:#6b7280;">—</td>
          <td class="num" style="color:#6b7280;">${fmtPctNum(rate)}</td>
          <td class="num" style="color:#6b7280;">—</td>
        </tr>`).join('');
    w.document.write(`<!DOCTYPE html><html><head><title>Invoice ${inv.invoice_number}</title><style>
      *{margin:0;padding:0;box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
      body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#111827;padding:48px;}
      table{width:100%;border-collapse:collapse;}
      th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
         color:#fff !important;background:#111827 !important;padding:10px 8px;}
      td{padding:9px 8px;font-size:12px;border-bottom:1px solid #f3f4f6;}
      .num{text-align:right;}
      .amount-due{background:#f3f4f6 !important;}
      @page{margin:0;}
      @media print{body{padding:32px 48px;}}
    </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;">
        <div>
          <div style="font-size:15px;font-weight:800;color:#111827;margin-bottom:6px;">Threecolts</div>
          <div style="font-size:11px;color:#6b7280;line-height:1.7;">16192 Coastal Highway<br/>Lewes, Delaware 19958<br/>United States<br/>support@threecolts.com</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:28px;font-weight:900;color:#111827;letter-spacing:-0.02em;margin-bottom:10px;">INVOICE</div>
          <div style="font-size:12px;color:#6b7280;line-height:2;">
            <div><strong style="color:#374151;">Invoice #:</strong> ${inv.invoice_number}</div>
            <div><strong style="color:#374151;">Date:</strong> ${fmtDate(billedDateStr)}</div>
            <div><strong style="color:#374151;">Due Date:</strong> ${dueDate}</div>
          </div>
        </div>
      </div>
      <div style="margin-bottom:28px;">
        <div style="font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Bill To</div>
        <div style="height:1px;background:#e5e7eb;margin-bottom:12px;"></div>
        <div style="font-size:13px;font-weight:700;color:#111827;">${inv.client_name}</div>
      </div>
      <table>
        <thead><tr>
          <th>Case ID</th><th>Description</th><th>Approval Date</th>
          <th class="num">Recovered</th><th class="num">Fee Rate</th><th class="num">Fee Amount</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:24px;">
        <div style="width:260px;">
          <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f3f4f6;">
            <span style="font-size:12px;color:#374151;">Total Recovered:</span>
            <span style="font-size:12px;font-weight:600;">${fmtUSD(inv.total_reimbursed)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f3f4f6;">
            <span style="font-size:12px;color:#374151;">Subtotal:</span>
            <span style="font-size:12px;font-weight:600;">${fmtUSD(inv.billed_fee)}</span>
          </div>
          <div class="amount-due" style="display:flex;justify-content:space-between;padding:12px 10px;margin-top:4px;border-radius:4px;">
            <span style="font-size:13px;font-weight:700;">Amount Due (USD):</span>
            <span style="font-size:14px;font-weight:800;">${fmtUSD(inv.billed_fee)}</span>
          </div>
        </div>
      </div>
    </body></html>`);
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
          <button onClick={handleToggle} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 6, background: open ? '#f9fafb' : '#fff', cursor: 'pointer', color: '#374151' }}>
            {snapCount} case{snapCount !== 1 ? 's' : ''}
          </button>
          <button onClick={async () => { const cases = hasSnapshot ? activeCases : (fetchedCases ?? await fetchCasesByIds(inv.case_ids ?? [])); triggerCSVDownload(inv, cases); }} title="Download CSV" style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer', padding: '4px 8px', fontSize: 12, fontWeight: 600, color: '#374151' }}>↓</button>
          <button onClick={printInvoice} title="Print PDF" style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer', padding: '4px 8px', fontSize: 13 }}>🖨</button>
          <button onClick={deleteInvoice} disabled={deleting} title="Delete" style={{ border: '1px solid #fca5a5', borderRadius: 6, background: '#fff', cursor: 'pointer', padding: '4px 8px', fontSize: 13, color: '#dc2626' }}>✕</button>
        </div>
      </div>

      {open && snapCount > 0 && (
        <div style={{ background: '#f9fafb', borderTop: '1px solid #f3f4f6' }}>
          {fetchingCases ? (
            <div style={{ padding: '12px 16px 12px 32px', fontSize: 12, color: '#9ca3af' }}>Loading case data…</div>
          ) : activeCases.length > 0 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 130px 110px', gap: 8, padding: '8px 16px 6px 32px', fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                <span>Case ID</span><span>Type</span><span>Posting Date</span><span style={{ textAlign: 'right' }}>Recovered</span>
              </div>
              {activeCases.map((c, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 130px 110px', gap: 8, padding: '7px 16px 7px 32px', borderTop: '1px solid #f3f4f6', fontSize: 12 }}>
                  <span style={{ fontFamily: 'monospace', color: '#374151' }}>{c.case_id}</span>
                  <span style={{ color: '#374151' }}>{c.claim_type}</span>
                  <span style={{ color: '#374151' }}>{c.rms_posting_date ? fmtDate(c.rms_posting_date.slice(0, 10)) : '—'}</span>
                  <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.reimbursement_amount)}</span>
                </div>
              ))}
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
