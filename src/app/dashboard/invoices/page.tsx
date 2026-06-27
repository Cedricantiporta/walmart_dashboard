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

// ── avatar ────────────────────────────────────────────────────────────────────

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

// ── icons ─────────────────────────────────────────────────────────────────────

const IconFilter = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
const IconSort = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="8" y2="18"/></svg>;
const IconCols = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>;
const IconChevron = ({ open }: { open: boolean }) => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><polyline points="9 18 15 12 9 6"/></svg>;
const IconCSV = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
const IconPDF = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="11" y2="17"/></svg>;
const IconTrash = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;

const pillBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  fontSize: 13, fontWeight: 500, color: '#71717a',
  background: '#fff', border: '1px solid #e4e4e7',
  borderRadius: 999, padding: '5px 12px',
  cursor: 'pointer', outline: 'none', flexShrink: 0,
};

const iconBtn = (danger = false): React.CSSProperties => ({
  width: 30, height: 30, borderRadius: 999,
  border: danger ? '1px solid #fca5a5' : '1px solid #e4e4e7',
  background: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: danger ? '#f31260' : '#71717a',
  flexShrink: 0,
});

function ColHdr({ label, col, sortCol, sortDir, onSort, align = 'left' }: {
  label: string; col: string; sortCol: string; sortDir: 'asc'|'desc';
  onSort: (c: string) => void; align?: 'left'|'right';
}) {
  const active = sortCol === col;
  return (
    <span onClick={() => onSort(col)} style={{ display: 'flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: 3, cursor: 'pointer', userSelect: 'none', color: active ? '#11181c' : '#a1a1aa', fontWeight: active ? 700 : 600 }}>
      {label}
      <span style={{ fontSize: 8 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
    </span>
  );
}

// ── invoice row ───────────────────────────────────────────────────────────────

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
        style={{ display: 'grid', gridTemplateColumns: '130px 1fr 52px 110px 110px 110px 96px', gap: 12, padding: '11px 16px', alignItems: 'center', cursor: 'pointer', background: open ? '#fafafa' : undefined }}
      >
        <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#006FEE' }}>{inv.invoice_number}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Avatar name={inv.client_name} size={28} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#11181c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.client_name}</span>
        </div>
        <span style={{ fontSize: 12, color: '#71717a', textAlign: 'right' }}>{snapCount}</span>
        <span style={{ fontSize: 12, color: '#71717a' }}>{fmtDate(inv.billed_date?.slice(0, 10) ?? '')}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#006FEE', textAlign: 'right' }}>{fmtUSD(inv.total_reimbursed)}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#11181c', textAlign: 'right' }}>{fmtUSD(inv.billed_fee)}</span>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
          <button onClick={async () => { const cases = hasSnapshot ? activeCases : (fetchedCases ?? await fetchCasesByIds(inv.case_ids ?? [])); triggerCSVDownload(inv, cases); }} title="Download CSV" style={iconBtn()}>
            <IconCSV />
          </button>
          <button onClick={downloadPDF} title="Download PDF" style={iconBtn()}>
            <IconPDF />
          </button>
          <button onClick={deleteInvoice} disabled={deleting} title="Delete" style={iconBtn(true)}>
            <IconTrash />
          </button>
          <span style={{ color: '#a1a1aa' }}><IconChevron open={open} /></span>
        </div>
      </div>

      {open && snapCount > 0 && (
        <div style={{ background: '#fafafa', borderTop: '1px solid #f3f4f6' }}>
          {fetchingCases ? (
            <div style={{ padding: '12px 16px 12px 32px', fontSize: 12, color: '#a1a1aa' }}>Loading case data…</div>
          ) : activeCases.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 110px 90px 100px 100px 80px 55px 50px 95px 80px', gap: 6, padding: '8px 16px 6px 32px', fontSize: 10, fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '.04em', minWidth: 860 }}>
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
            <div style={{ padding: '8px 16px 12px 32px', fontSize: 12, color: '#a1a1aa' }}>No case data found in database.</div>
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
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');

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
    return (
      inv.client_name?.toLowerCase().includes(q) ||
      inv.invoice_number?.toLowerCase().includes(q) ||
      (inv.case_ids ?? []).some(id => id.toLowerCase().includes(q)) ||
      (inv.case_snapshot ?? []).some(cs => cs.case_id.toLowerCase().includes(q))
    );
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
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}} button:hover{opacity:.88} input:focus{outline:none;border-color:#006FEE!important;}`}</style>

      <div style={{ padding: '20px 28px', maxWidth: 1100 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#11181c', letterSpacing: '-0.01em' }}>Invoices</h1>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 160px)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

          {/* Toolbar */}
          <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#11181c' }}>
                Invoice History{' '}
                {!loading && <span style={{ fontSize: 14, color: '#a1a1aa', fontWeight: 500 }}>{filtered.length}</span>}
              </span>
              {!loading && (
                <>
                  <button style={pillBtn}><IconFilter /> Filter</button>
                  <button style={pillBtn}><IconSort /> Sort</button>
                  <button style={pillBtn}><IconCols /> Columns</button>
                </>
              )}
            </div>
            <input
              placeholder="Search invoice or client…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ fontSize: 13, padding: '7px 12px 7px 36px', border: '1px solid #e4e4e7', borderRadius: 999, width: 220, color: '#11181c', outline: 'none', backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: '10px center' }}
            />
          </div>

          {loading ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1, 2, 3, 4, 5].map(i => <Sk key={i} h={52} />)}
            </div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
              {search ? 'No invoices match.' : 'No invoices yet. Generate one from the Billing tab.'}
            </div>
          ) : (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <div style={{ minWidth: 760 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 52px 110px 110px 110px 96px', gap: 12, padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #f3f4f6', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
                  <ColHdr label="Invoice #" col="invoice" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHdr label="Client" col="client" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHdr label="Cases" col="cases" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  <ColHdr label="Date" col="date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHdr label="Recovered" col="recovered" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  <ColHdr label="Fee" col="fee" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  <span />
                </div>
                {sorted.map(inv => (
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
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 52px 110px 110px 110px 96px', gap: 12, padding: '12px 16px', borderTop: '2px solid #e4e4e7', background: '#fafafa', position: 'sticky', bottom: 0, zIndex: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#11181c', gridColumn: '1/5' }}>
                    {search ? `Filtered total (${filtered.length})` : `Total (${invoices.length})`}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#006FEE', textAlign: 'right' }}>{fmtUSD(totalRecovered)}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#11181c', textAlign: 'right' }}>{fmtUSD(totalFee)}</span>
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
