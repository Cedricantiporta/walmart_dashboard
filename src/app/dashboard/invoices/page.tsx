'use client';

import { useState, useEffect } from 'react';
import { Table } from '@heroui/react';
import { clientGet, clientSet, clientClear } from '@/lib/client-cache';
import { downloadInvoicePDF } from '@/lib/invoice-pdf';
import { useSidebar } from '@/components/DashboardShell';

const fmtUSD = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const isoToday = () => new Date().toISOString().slice(0, 10);

type Invoice = {
  id?: number; invoice_number: string; client_name: string;
  billed_date: string; billed_fee: number; total_reimbursed: number;
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
function fmtPctNum(r: number) { return `${Math.round(r * 100)}%`; }

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
      return [`"${inv.client_name}"`, 'US', fmtMDY(c.rms_posting_date), `"Reimbursement Recovery for Case ID ${c.case_id} for $${total}"`, c.claim_type || 'N/A', c.gtin || '', c.sku_id || '', c.case_id, `$${unitAmt}`, fmtPctNum(rate), String(qty), `$${total}`, '', 'USD', `$${total}`, `$${(c.reimbursement_amount * rate).toFixed(2)}`].join(',');
    });
  }
  const ids = inv.case_ids ?? [];
  const perCase = ids.length > 0 ? inv.total_reimbursed / ids.length : 0;
  const perFee = ids.length > 0 ? inv.billed_fee / ids.length : 0;
  const postingDate = fmtMDY(inv.billed_date?.slice(0, 10) ?? isoToday());
  return ids.map(id => {
    const amt = perCase.toFixed(2);
    return [`"${inv.client_name}"`, 'US', postingDate, `"Reimbursement Recovery for Case ID ${id} for $${amt}"`, 'N/A', '', '', id, `$${amt}`, fmtPctNum(rate), '1', `$${amt}`, '', 'USD', `$${amt}`, `$${perFee.toFixed(2)}`].join(',');
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

// ── icons ─────────────────────────────────────────────────────────────────────

const PanelIcon = () => <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="16" height="16" rx="3"/><line x1="7" y1="2" x2="7" y2="18"/></svg>;
const IconFilter = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
const IconSort = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="8" y2="18"/></svg>;
const IconCols = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>;

const toolbarPill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontSize: 13, fontWeight: 500, color: '#11181c',
  background: '#eaebec', border: 'none',
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

const pillAction = (danger = false): React.CSSProperties => ({
  fontSize: 12, fontWeight: 600, padding: '5px 12px',
  border: `1px solid ${danger ? '#fca5a5' : '#e4e4e7'}`,
  borderRadius: 999, background: '#fff', cursor: 'pointer',
  color: danger ? '#f31260' : '#374151',
  whiteSpace: 'nowrap' as const,
});

// ── invoice row ───────────────────────────────────────────────────────────────

function InvoiceRow({ inv, onDelete }: { inv: Invoice; onDelete: (num: string) => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fetchedCases, setFetchedCases] = useState<CaseRow[] | null>(null);
  const [fetchingCases, setFetchingCases] = useState(false);

  const hasSnapshot = (inv.case_snapshot?.length ?? 0) > 0;
  const activeCases: CaseRow[] = (hasSnapshot
    ? inv.case_snapshot.map(c => ({ case_id: c.case_id, claim_type: c.claim_type, rms_posting_date: c.rms_posting_date, reimbursement_amount: c.reimbursement_amount, gtin: c.gtin, sku_id: c.sku_id, unit_amount: c.unit_amount, reimbursed_qty: c.reimbursed_qty }))
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
    await downloadInvoicePDF({ invoice_number: inv.invoice_number, client_name: inv.client_name, billed_date: inv.billed_date?.slice(0, 10) ?? isoToday(), billed_fee: inv.billed_fee, total_reimbursed: inv.total_reimbursed, case_ids: inv.case_ids }, cases);
  }

  const snapCount = inv.case_snapshot?.length || inv.case_ids?.length || 0;

  return (
    <>
      <Table.Row key={inv.invoice_number} id={inv.invoice_number} onClick={handleToggle} style={{ cursor: 'pointer', background: open ? '#fafafa' : undefined }}>
        <Table.Cell><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#006FEE', fontSize: 12 }}>{inv.invoice_number}</span></Table.Cell>
        <Table.Cell>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#11181c' }}>{inv.client_name}</span>
        </Table.Cell>
        <Table.Cell><span style={{ display: 'block', textAlign: 'right', fontSize: 12, color: '#71717a' }}>{snapCount}</span></Table.Cell>
        <Table.Cell><span style={{ fontSize: 12, color: '#71717a' }}>{fmtDate(inv.billed_date?.slice(0, 10) ?? '')}</span></Table.Cell>
        <Table.Cell><span style={{ display: 'block', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#006FEE' }}>{fmtUSD(inv.total_reimbursed)}</span></Table.Cell>
        <Table.Cell><span style={{ display: 'block', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#11181c' }}>{fmtUSD(inv.billed_fee)}</span></Table.Cell>
        <Table.Cell>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
            <button onClick={async e => { e.stopPropagation(); const cases = hasSnapshot ? activeCases : (fetchedCases ?? await fetchCasesByIds(inv.case_ids ?? [])); triggerCSVDownload(inv, cases); }} style={pillAction()}>CSV</button>
            <button onClick={async e => { e.stopPropagation(); await downloadPDF(); }} style={pillAction()}>PDF</button>
            <button onClick={async e => { e.stopPropagation(); await deleteInvoice(); }} disabled={deleting} style={pillAction(true)}>Delete</button>
          </div>
        </Table.Cell>
      </Table.Row>
      {open && snapCount > 0 && (
        <Table.Row id={`${inv.invoice_number}-detail`} style={{ background: '#fafafa' }}>
          <Table.Cell colSpan={7}>
            {fetchingCases ? (
              <div style={{ padding: '12px 16px', fontSize: 12, color: '#a1a1aa' }}>Loading case data…</div>
            ) : activeCases.length > 0 ? (
              <div style={{ overflowX: 'auto', paddingLeft: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 110px 90px 100px 100px 80px 55px 50px 95px 80px', gap: 6, padding: '8px 0 6px', fontSize: 10, fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '.04em', minWidth: 860 }}>
                  <span>Case ID</span><span>Posting Date</span><span>Type</span><span>GTIN</span><span>SKU ID</span>
                  <span style={{ textAlign: 'right' }}>Unit Amt</span><span style={{ textAlign: 'right' }}>Rate</span><span style={{ textAlign: 'right' }}>Qty</span>
                  <span style={{ textAlign: 'right' }}>Recovered</span><span style={{ textAlign: 'right' }}>Fee</span>
                </div>
                {activeCases.map((c, i) => {
                  const rate = inv.total_reimbursed > 0 ? inv.billed_fee / inv.total_reimbursed : 0;
                  const unitAmt = c.unit_amount ?? c.reimbursement_amount;
                  const qty = c.reimbursed_qty ?? 1;
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 110px 90px 100px 100px 80px 55px 50px 95px 80px', gap: 6, padding: '7px 0', borderTop: '1px solid #f3f4f6', fontSize: 11, minWidth: 860 }}>
                      <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.case_id}</span>
                      <span style={{ color: '#374151' }}>{c.rms_posting_date ? fmtDate(c.rms_posting_date.slice(0, 10)) : '—'}</span>
                      <span style={{ color: '#374151' }}>{c.claim_type || '—'}</span>
                      <span style={{ color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.gtin || '—'}</span>
                      <span style={{ color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sku_id || '—'}</span>
                      <span style={{ fontWeight: 600, color: '#374151', textAlign: 'right' }}>{fmtUSD(unitAmt)}</span>
                      <span style={{ color: '#71717a', textAlign: 'right' }}>{fmtPctNum(rate)}</span>
                      <span style={{ color: '#374151', textAlign: 'right' }}>{qty}</span>
                      <span style={{ fontWeight: 600, color: '#006FEE', textAlign: 'right' }}>{fmtUSD(c.reimbursement_amount)}</span>
                      <span style={{ fontWeight: 700, color: '#11181c', textAlign: 'right' }}>{fmtUSD(c.reimbursement_amount * rate)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '8px 0', fontSize: 12, color: '#a1a1aa' }}>No case data found.</div>
            )}
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const { onToggle } = useSidebar();

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

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
    return inv.client_name?.toLowerCase().includes(q) || inv.invoice_number?.toLowerCase().includes(q) || (inv.case_ids ?? []).some(id => id.toLowerCase().includes(q)) || (inv.case_snapshot ?? []).some(cs => cs.case_id.toLowerCase().includes(q));
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: number | string, bv: number | string;
    if (sortCol === 'invoice') { av = a.invoice_number; bv = b.invoice_number; }
    else if (sortCol === 'client') { av = a.client_name; bv = b.client_name; }
    else if (sortCol === 'cases') { av = a.case_ids?.length ?? 0; bv = b.case_ids?.length ?? 0; }
    else if (sortCol === 'recovered') { av = a.total_reimbursed; bv = b.total_reimbursed; }
    else if (sortCol === 'fee') { av = a.billed_fee; bv = b.billed_fee; }
    else { av = a.billed_date; bv = b.billed_date; }
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return sortDir === 'asc' ? av - (bv as number) : (bv as number) - av;
  });

  const totalFee = filtered.reduce((s, i) => s + (i.billed_fee ?? 0), 0);
  const totalRecovered = filtered.reduce((s, i) => s + (i.total_reimbursed ?? 0), 0);

  return (
    <>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}} button:hover{opacity:.88} input:focus{outline:none;box-shadow:0 0 0 2px rgba(0,111,238,0.2);} .invtable table th{height:46px!important;padding:0 16px!important;vertical-align:middle;} .invtable table td{padding:12px 16px!important;vertical-align:middle;}`}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', height: 60, background: '#f4f4f5' }}>
          <button onClick={onToggle} title="Toggle sidebar" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #e4e4e7', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a', flexShrink: 0, outline: 'none' }}>
            <PanelIcon />
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#11181c', letterSpacing: '-0.01em' }}>Invoices</h1>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Toolbar: pills + search */}
          {!loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#11181c' }}>
                Invoices <span style={{ fontWeight: 400, color: '#a1a1aa' }}>{filtered.length}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={toolbarPill}><IconFilter /> Filter</button>
                  <button style={toolbarPill}><IconSort /> Sort</button>
                  <button style={toolbarPill}><IconCols /> Columns</button>
                </div>
                <input
                  placeholder="Search invoice or client…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ fontSize: 13, padding: '7px 12px 7px 36px', border: 'none', borderRadius: 999, width: 230, color: '#11181c', outline: 'none', background: "#eaebec url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E\") no-repeat 10px center" }}
                />
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflow: 'hidden', borderRadius: 16, background: '#e4e4e7', padding: '0 6px 6px', border: '1px solid #d4d4d8', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflow: 'hidden', background: '#fff', borderRadius: 10, display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1,2,3,4,5].map(i => <Sk key={i} h={52} />)}
              </div>
            ) : sorted.length === 0 ? (
              <div style={{ padding: '48px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                {search ? 'No invoices match.' : 'No invoices yet. Generate one from the Billing tab.'}
              </div>
            ) : (
              <div className="invtable" style={{ flex: 1, overflow: 'auto' }}>
                <Table variant="secondary" style={{ width: '100%' }}>
                  <Table.ScrollContainer>
                    <Table.Content aria-label="Invoice History">
                      <Table.Header>
                        <Table.Column isRowHeader>
                          <ColHdr label="Invoice #" col="invoice" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                        </Table.Column>
                        <Table.Column>
                          <ColHdr label="Client" col="client" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                        </Table.Column>
                        <Table.Column>
                          <ColHdr label="Cases" col="cases" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                        </Table.Column>
                        <Table.Column>
                          <ColHdr label="Date" col="date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                        </Table.Column>
                        <Table.Column>
                          <ColHdr label="Recovered" col="recovered" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                        </Table.Column>
                        <Table.Column>
                          <ColHdr label="Fee" col="fee" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                        </Table.Column>
                        <Table.Column> </Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {sorted.map(inv => (
                          <InvoiceRow
                            key={inv.invoice_number}
                            inv={inv}
                            onDelete={num => setInvoices(prev => { const next = prev.filter(i => i.invoice_number !== num); clientClear('invoices'); return next; })}
                          />
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                  <Table.Footer>
                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px 120px 120px 120px 120px', gap: 12, padding: '12px 16px', background: '#fafafa', borderRadius: 12, margin: '0 4px 4px', border: '1px solid #f0f0f0' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#11181c', gridColumn: '1/5' }}>
                        {search ? `Filtered (${filtered.length})` : `Total (${invoices.length})`}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#006FEE', textAlign: 'right' }}>{fmtUSD(totalRecovered)}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#11181c', textAlign: 'right' }}>{fmtUSD(totalFee)}</span>
                      <span />
                    </div>
                  </Table.Footer>
                </Table>
              </div>
            )}
          </div>{/* white inner */}
          </div>{/* grey outer */}
        </div>
      </div>
    </>
  );
}
