'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { clientGet, clientSet, clientClear } from '@/lib/client-cache';
import { downloadInvoicePDF, generateInvoicePDFBlob } from '@/lib/invoice-pdf';
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

function matchAmt(q: string, amount: number): boolean {
  const s = q.replace(/[$,]/g, '').trim();
  if (!s || !/^\d/.test(s)) return false;
  return Math.floor(Math.abs(amount)).toString().startsWith(s.split('.')[0]);
}

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

const PanelIcon = () => <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="16" height="16" rx="3"/><line x1="7" y1="2" x2="7" y2="18"/></svg>;
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

const getInvoiceGrid = (select: boolean) =>
  select ? '32px 82px minmax(0,1fr) 42px 8px 94px 82px 80px 76px' : '82px minmax(0,1fr) 42px 8px 94px 82px 80px 76px';

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

const pillAction = (danger = false): React.CSSProperties => ({
  fontSize: 11, fontWeight: 600, padding: '3px 9px',
  border: danger ? 'none' : '1px solid #e4e4e7',
  borderRadius: 999,
  background: danger ? '#f31260' : '#fff',
  cursor: 'pointer',
  color: danger ? '#fff' : '#374151',
  whiteSpace: 'nowrap' as const,
});

// ── password modal ────────────────────────────────────────────────────────────

function PasswordModal({ description, onConfirm, onCancel }: { description: string; onConfirm: () => void; onCancel: () => void }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function tryConfirm() {
    if (val === '7170') { onConfirm(); }
    else { setErr(true); setVal(''); setTimeout(() => inputRef.current?.focus(), 10); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '28px 28px 24px', width: 340, boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#fff0f3', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f31260" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#11181c', marginBottom: 6 }}>Admin Authorization Required</div>
          <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600, color: '#f31260' }}>This cannot be undone.</span>{' '}{description}
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            value={val}
            onChange={e => { setVal(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(false); }}
            onKeyDown={e => e.key === 'Enter' && val.length === 4 && tryConfirm()}
            style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: 26, fontWeight: 700, letterSpacing: 10, padding: '10px 16px', border: `1.5px solid ${err ? '#f31260' : '#e4e4e7'}`, borderRadius: 12, outline: 'none', color: '#11181c', background: err ? '#fff0f3' : '#fafafa', transition: 'border-color 0.15s' }}
          />
          {err && <div style={{ fontSize: 11, color: '#f31260', textAlign: 'center', marginTop: 5 }}>Incorrect password. Try again.</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '9px', borderRadius: 999, border: '1px solid #e4e4e7', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151', outline: 'none' }}>Cancel</button>
          <button onClick={tryConfirm} disabled={val.length !== 4} style={{ flex: 1, padding: '9px', borderRadius: 999, border: 'none', background: val.length === 4 ? '#f31260' : '#e4e4e7', color: val.length === 4 ? '#fff' : '#a1a1aa', fontSize: 13, fontWeight: 700, cursor: val.length !== 4 ? 'not-allowed' : 'pointer', outline: 'none' }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ── invoice sidebar (billing-style overlay) ───────────────────────────────────

const DlIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v13"/><polyline points="7 12 12 17 17 12"/><line x1="3" y1="21" x2="21" y2="21"/>
  </svg>
);

function InvoiceSidebar({ inv, onClose, searchQ }: {
  inv: Invoice; onClose: () => void; searchQ?: string;
}) {
  const [fetchedCases, setFetchedCases] = useState<CaseRow[] | null>(null);
  const [fetchingCases, setFetchingCases] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const firstMatchRef = useRef<HTMLDivElement | null>(null);

  const snapWithDate = (inv.case_snapshot ?? []).filter(c => !!c.rms_posting_date);
  const hasSnapshot = snapWithDate.length > 0;
  const activeCases: CaseRow[] = hasSnapshot
    ? snapWithDate.map(c => ({ case_id: c.case_id, claim_type: c.claim_type, rms_posting_date: c.rms_posting_date, reimbursement_amount: c.reimbursement_amount, gtin: c.gtin, sku_id: c.sku_id, unit_amount: c.unit_amount, reimbursed_qty: c.reimbursed_qty }))
    : (fetchedCases ?? []).filter(c => !!c.rms_posting_date);

  useEffect(() => {
    if (!hasSnapshot && (inv.case_ids?.length ?? 0) > 0) {
      setFetchingCases(true);
      fetchCasesByIds(inv.case_ids).then(rows => { setFetchedCases(rows); setFetchingCases(false); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.invoice_number]);

  useEffect(() => {
    if (firstMatchRef.current) firstMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [searchQ, fetchedCases]);

  useEffect(() => {
    let url = '';
    const cases = activeCases.length > 0 ? activeCases : [];
    if (cases.length === 0 && !hasSnapshot) return;
    generateInvoicePDFBlob(
      { invoice_number: inv.invoice_number, client_name: inv.client_name, billed_date: inv.billed_date?.slice(0, 10) ?? isoToday(), billed_fee: inv.billed_fee, total_reimbursed: inv.total_reimbursed, case_ids: inv.case_ids },
      cases.map(c => ({ case_id: c.case_id, claim_type: c.claim_type, rms_posting_date: c.rms_posting_date, reimbursement_amount: c.reimbursement_amount }))
    ).then(u => { url = u; setPdfUrl(u); });
    return () => { if (url) URL.revokeObjectURL(url); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.invoice_number, fetchedCases]);

  async function handleCSV() {
    const raw = hasSnapshot ? activeCases : (fetchedCases ?? await fetchCasesByIds(inv.case_ids ?? []));
    triggerCSVDownload(inv, raw.filter(c => !!c.rms_posting_date));
  }

  async function handlePDF() {
    if (inv.pdf_url) { window.open(inv.pdf_url, '_blank'); return; }
    const raw = activeCases.length > 0 ? activeCases : await fetchCasesByIds(inv.case_ids ?? []);
    const cases = raw.filter(c => !!c.rms_posting_date);
    await downloadInvoicePDF({ invoice_number: inv.invoice_number, client_name: inv.client_name, billed_date: inv.billed_date?.slice(0, 10) ?? isoToday(), billed_fee: inv.billed_fee, total_reimbursed: inv.total_reimbursed, case_ids: inv.case_ids }, cases);
  }

  const CG = '72px 1fr 70px 58px';
  const q = searchQ?.toLowerCase() ?? '';
  const firstMatchIdx = q ? activeCases.findIndex(c => c.case_id.toLowerCase().includes(q)) : -1;

  return (
    <div style={{ position: 'absolute', top: 6, right: 6, bottom: 6, width: 390, background: '#fff', borderRadius: 12, boxShadow: '-6px 0 32px rgba(0,0,0,0.13)', zIndex: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'slideInDrawer 0.18s cubic-bezier(0.4,0,0.2,1)' }}>

      {/* Topbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px 8px 12px', flexShrink: 0, borderBottom: '1px solid #f3f4f6', gap: 8 }}>
        <button
          onClick={() => pdfUrl && setShowPdfModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#f9fafb', fontSize: 11, fontWeight: 600, color: pdfUrl ? '#374151' : '#a1a1aa', cursor: pdfUrl ? 'pointer' : 'not-allowed', outline: 'none', flexShrink: 0 }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          View
        </button>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={handleCSV} title="Download CSV" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#f9fafb', fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer', outline: 'none' }}>
            <DlIcon /> CSV
          </button>
          <button onClick={handlePDF} title="Download PDF" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#f9fafb', fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer', outline: 'none' }}>
            <DlIcon /> PDF
          </button>
          <button onClick={onClose} style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 14, lineHeight: 1, outline: 'none', flexShrink: 0 }}>×</button>
        </div>
      </div>

      {showPdfModal && pdfUrl && <PdfPreviewModal pdfUrl={pdfUrl} filename={`${inv.invoice_number}-${inv.client_name.replace(/\s+/g, '-')}.pdf`} onClose={() => setShowPdfModal(false)} />}

      {/* Case rows — scrollable */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {fetchingCases ? (
          <div style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1,2,3,4,5].map(i => <Sk key={i} h={32} />)}
          </div>
        ) : activeCases.length === 0 ? (
          <div style={{ padding: '40px 12px', textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>
            {(inv.case_ids?.length ?? 0) === 0 ? 'No cases on this invoice.' : 'No case data found.'}
          </div>
        ) : activeCases.map((c, i) => {
          const isMatch = q ? c.case_id.toLowerCase().includes(q) : false;
          return (
            <div key={i} ref={i === firstMatchIdx ? firstMatchRef : undefined}
              style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 11, alignItems: 'center', background: isMatch ? '#fef9c3' : undefined }}>
              <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.case_id}</span>
              <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.claim_type || 'N/A'}</span>
              <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{c.rms_posting_date ? fmtDate(c.rms_posting_date.slice(0, 10)) : '—'}</span>
              <span style={{ fontWeight: 600, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(c.reimbursement_amount)}</span>
            </div>
          );
        })}
      </div>

      {/* Sticky total */}
      {activeCases.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: CG, gap: 4, padding: '9px 12px', borderTop: '2px solid #e5e7eb', background: '#f9fafb', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', gridColumn: '1/4' }}>Total ({activeCases.length})</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textAlign: 'right' }}>{fmtUSD(activeCases.reduce((s, c) => s + c.reimbursement_amount, 0))}</span>
        </div>
      )}
    </div>
  );
}

// ── invoice row ───────────────────────────────────────────────────────────────

function PdfPreviewModal({ pdfUrl, filename, onClose }: { pdfUrl: string; filename?: string; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 20, width: '90vw', maxWidth: 760, height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.28)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', flex: 1 }}>PDF Preview</span>
          <a href={pdfUrl} download={filename ?? 'invoice.pdf'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#f9fafb', fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer', textDecoration: 'none' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13"/><polyline points="7 12 12 17 17 12"/><line x1="3" y1="21" x2="21" y2="21"/></svg>
            Download PDF
          </a>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#f4f4f5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 16, outline: 'none' }}>×</button>
        </div>
        <iframe src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1`} style={{ flex: 1, width: '100%', border: 'none' }} title="Invoice Preview" />
      </div>
    </div>
  );
}

function InvoiceRow({ inv, onDelete, onOpen, selectMode = false, isSelected = false, isOpen = false, onToggleSelect, onUnbillRequest }: {
  inv: Invoice; onDelete: (num: string) => void;
  onOpen: () => void;
  selectMode?: boolean; isSelected?: boolean; isOpen?: boolean; onToggleSelect?: () => void;
  onUnbillRequest?: (num: string, doDelete: () => Promise<void>) => void;
}) {
  const snapCount = (inv.case_snapshot ?? []).filter(c => !!c.rms_posting_date).length || (inv.case_ids?.length ?? 0);
  const G = getInvoiceGrid(selectMode);

  return (
    <div onClick={onOpen} style={{ display: 'grid', gridTemplateColumns: G, padding: '9px 10px 9px 16px', gap: 8, cursor: 'pointer', borderBottom: '1px solid #f3f4f6', background: isOpen ? '#eff6ff' : '#fff', alignItems: 'center', minWidth: 700, transition: 'background 0.1s' }}
      onMouseEnter={e => (e.currentTarget.style.background = isOpen ? '#dbeafe' : '#fafafa')}
      onMouseLeave={e => (e.currentTarget.style.background = isOpen ? '#eff6ff' : '#fff')}
    >
      {selectMode && (
        <div onClick={e => { e.stopPropagation(); onToggleSelect?.(); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <input type="checkbox" checked={isSelected} onChange={() => {}} style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#006FEE' }} />
        </div>
      )}
      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#006FEE', fontSize: 12 }}>{inv.invoice_number}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#11181c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.client_name}</span>
      <span style={{ textAlign: 'right', fontSize: 12, color: '#71717a' }}>{snapCount}</span>
      <span />
      <span style={{ fontSize: 12, color: '#71717a' }}>{fmtDate(inv.billed_date?.slice(0, 10) ?? '')}</span>
      <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#006FEE' }}>{fmtUSD(inv.total_reimbursed)}</span>
      <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#11181c' }}>{fmtUSD(inv.billed_fee)}</span>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
        <button onClick={async e => {
          e.stopPropagation();
          if (onUnbillRequest) {
            onUnbillRequest(inv.invoice_number, async () => {
              await fetch(`/api/invoices/${inv.invoice_number}`, { method: 'DELETE' });
              onDelete(inv.invoice_number);
            });
          }
        }} style={pillAction(true)}>Unbill</button>
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

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    const c = clientGet<Invoice[]>('invoices');
    return Array.isArray(c) ? c : [];
  });
  const [loading, setLoading] = useState(() => !clientGet('invoices'));
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [openPopup, setOpenPopup] = useState<null|'filter'|'sort'>(null);
  const [filterType, setFilterType] = useState<'all'|'thisMonth'>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNums, setSelectedNums] = useState<Set<string>>(new Set());
  const [unbillBusy, setUnbillBusy] = useState(false);
  const [pwdModal, setPwdModal] = useState<{ description: string; onConfirm: () => void | Promise<void> } | null>(null);
  const [openInv, setOpenInv] = useState<Invoice | null>(null);
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

  function handleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  function handleUnbillSelected() {
    if (selectedNums.size === 0 || unbillBusy) return;
    const count = selectedNums.size;
    const nums = new Set(selectedNums);
    setPwdModal({
      description: `You are about to unbill ${count} selected invoice${count > 1 ? 's' : ''}.`,
      onConfirm: async () => {
        setPwdModal(null);
        setUnbillBusy(true);
        for (const num of [...nums]) {
          await fetch(`/api/invoices/${num}`, { method: 'DELETE' });
        }
        setInvoices(prev => prev.filter(i => !nums.has(i.invoice_number)));
        clientClear('invoices');
        setSelectedNums(new Set());
        setSelectMode(false);
        setUnbillBusy(false);
      },
    });
  }

  // Auto-open sidebar when search matches a case ID
  useEffect(() => {
    if (!search) return;
    const q = search.toLowerCase();
    const match = sorted.find(inv =>
      (inv.case_ids ?? []).some(id => String(id).toLowerCase().includes(q)) ||
      (inv.case_snapshot ?? []).some(c => c.case_id.toLowerCase().includes(q))
    );
    if (match) setOpenInv(match);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    const cached = clientGet<Invoice[]>('invoices');
    if (cached) { setInvoices(cached); setLoading(false); return; }
    fetch('/api/invoices')
      .then(r => r.json())
      .then(d => { const arr = Array.isArray(d) ? d : []; clientSet('invoices', arr); setInvoices(arr); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = invoices.filter(inv => {
    if (filterType === 'thisMonth') {
      const d = new Date(inv.billed_date);
      const now = new Date();
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return inv.client_name?.toLowerCase().includes(q) || inv.invoice_number?.toLowerCase().includes(q) || (inv.case_ids ?? []).some(id => id.toLowerCase().includes(q)) || (inv.case_snapshot ?? []).some(cs => cs.case_id.toLowerCase().includes(q)) || matchAmt(search, inv.total_reimbursed) || matchAmt(search, inv.billed_fee);
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
      <Suspense><SearchParamsInit onSearch={setSearch} /></Suspense>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}} @keyframes slideInDrawer{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}} button:hover{opacity:.88} input:focus{outline:none;box-shadow:0 0 0 2px rgba(0,111,238,0.2);}`}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', gap: 10, padding: '4px 20px 8px', height: 52, background: '#f4f4f5' }}>
          <button onClick={onToggle} title="Toggle sidebar" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#11181c', flexShrink: 0, outline: 'none' }}>
            <PanelIcon />
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 300, color: '#11181c', letterSpacing: '-0.01em' }}>Invoices</h1>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Toolbar: pills + search */}
          {!loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div ref={popupAreaRef} style={{ display: 'flex', gap: 6 }}>

                  {/* Filter popup */}
                  <div style={{ position: 'relative' }}>
                    <button onClick={() => setOpenPopup(p => p === 'filter' ? null : 'filter')} style={{ ...toolbarPill, ...(filterType !== 'all' ? { background: '#dbeafe', color: '#1d4ed8' } : {}) }}>
                      <IconFilter /> Filter{filterType !== 'all' ? ' ·' : ''}
                    </button>
                    {openPopup === 'filter' && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 18, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, minWidth: 190, padding: 4 }}>
                        {([{ val: 'all', lbl: 'All invoices' }, { val: 'thisMonth', lbl: 'This month' }] as const).map(({ val, lbl }) => (
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
                      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 18, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, minWidth: 170, padding: 4 }}>
                        {([{ col: 'date', lbl: 'Date' }, { col: 'client', lbl: 'Client name' }, { col: 'fee', lbl: 'Fee' }, { col: 'recovered', lbl: 'Recovered' }, { col: 'invoice', lbl: 'Invoice #' }, { col: 'cases', lbl: 'Cases' }] as const).map(({ col, lbl }) => (
                          <button key={col} onClick={() => { handleSort(col); setOpenPopup(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, border: 'none', borderRadius: 999, cursor: 'pointer', background: sortCol === col ? '#eaebec' : 'transparent', color: '#11181c', fontWeight: sortCol === col ? 600 : 400, transition: 'background 0.1s' }}>
                            {lbl}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Select mode */}
                  {!selectMode ? (
                    <button onClick={() => { setSelectMode(true); setSelectedNums(new Set()); setOpenPopup(null); }} style={toolbarPill}>
                      <IconCols /> Select
                    </button>
                  ) : (
                    <>
                      <button onClick={() => { setSelectMode(false); setSelectedNums(new Set()); }} style={toolbarPill}>
                        Cancel
                      </button>
                      <button
                        onClick={handleUnbillSelected}
                        disabled={selectedNums.size === 0 || unbillBusy}
                        style={{ ...toolbarPill, background: selectedNums.size > 0 ? '#f31260' : '#eaebec', color: selectedNums.size > 0 ? '#fff' : '#a1a1aa', cursor: selectedNums.size === 0 ? 'not-allowed' : 'pointer', opacity: unbillBusy ? 0.7 : 1 }}
                      >
                        {unbillBusy ? 'Unbilling…' : `Unbill${selectedNums.size > 0 ? ` (${selectedNums.size})` : ' All'}`}
                      </button>
                    </>
                  )}
                </div>
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                  <input
                    placeholder="Search invoice, client or case ID…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ fontSize: 13, padding: '7px 32px 7px 36px', border: '1px solid #e4e4e7', borderRadius: 999, width: 230, color: '#11181c', outline: 'none', background: "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E\") no-repeat 10px center" }}
                  />
                  {search && (
                    <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#a1a1aa', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none', flexShrink: 0 }}>×</button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflow: 'hidden', borderRadius: 16, background: '#eaebec', display: 'flex', flexDirection: 'column' }}>

            {/* Column headers — sit on grey layer */}
            {!loading && sorted.length > 0 && (() => {
              const G = getInvoiceGrid(selectMode);
              const allSelected = sorted.length > 0 && sorted.every(inv => selectedNums.has(inv.invoice_number));
              return (
                <div style={{ display: 'grid', gridTemplateColumns: G, padding: '10px 10px 10px 16px', gap: 8, flexShrink: 0, minWidth: 700 }}>
                  {selectMode && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <input type="checkbox" checked={allSelected} onChange={() => { if (allSelected) setSelectedNums(new Set()); else setSelectedNums(new Set(sorted.map(i => i.invoice_number))); }} style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#006FEE' }} />
                    </div>
                  )}
                  <ColHdr label="Invoice #" col="invoice" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHdr label="Client" col="client" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHdr label="Cases" col="cases" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  <span />
                  <ColHdr label="Date" col="date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <ColHdr label="Recovered" col="recovered" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  <ColHdr label="Fee" col="fee" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#71717a', textAlign: 'right' }}>Actions</span>
                </div>
              );
            })()}

            {/* Content area — relative for sidebar overlay */}
            <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>

              {/* White body card */}
              <div style={{ position: 'absolute', inset: '6px', background: '#fff', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {loading ? (
                  <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[1,2,3,4,5].map(i => <Sk key={i} h={44} />)}
                  </div>
                ) : sorted.length === 0 ? (
                  <div style={{ padding: '48px 16px', textAlign: 'center', color: '#a1a1aa', fontSize: 13 }}>
                    {search ? 'No invoices match.' : 'No invoices yet. Generate one from the Billing tab.'}
                  </div>
                ) : (
                  <>
                    <div style={{ flex: 1, overflow: 'auto' }}>
                      <div style={{ minWidth: 700 }}>
                        {sorted.map(inv => (
                          <InvoiceRow
                            key={inv.invoice_number}
                            inv={inv}
                            onDelete={num => { setInvoices(prev => { const next = prev.filter(i => i.invoice_number !== num); clientClear('invoices'); return next; }); if (openInv?.invoice_number === num) setOpenInv(null); }}
                            onOpen={() => setOpenInv(inv)}
                            selectMode={selectMode}
                            isSelected={selectedNums.has(inv.invoice_number)}
                            isOpen={openInv?.invoice_number === inv.invoice_number}
                            onToggleSelect={() => setSelectedNums(prev => { const next = new Set(prev); if (next.has(inv.invoice_number)) next.delete(inv.invoice_number); else next.add(inv.invoice_number); return next; })}
                            onUnbillRequest={(num, doDelete) => {
                              const found = invoices.find(i => i.invoice_number === num);
                              setPwdModal({
                                description: `You are about to unbill invoice ${num} for ${found?.client_name ?? num}.`,
                                onConfirm: async () => { setPwdModal(null); await doDelete(); setInvoices(prev => { const next = prev.filter(i => i.invoice_number !== num); clientClear('invoices'); return next; }); setOpenInv(null); },
                              });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    {/* Sticky total */}
                    {(() => { const G = getInvoiceGrid(selectMode); return (
                      <div style={{ display: 'grid', gridTemplateColumns: G, padding: '10px 10px 10px 16px', gap: 8, borderTop: '2px solid #f0f0f0', background: '#fafafa', flexShrink: 0, minWidth: 700 }}>
                        {selectMode && <span />}
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#11181c', gridColumn: selectMode ? '2/7' : '1/6' }}>
                          {search ? `Filtered (${filtered.length})` : `Total (${invoices.length})`}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#006FEE', textAlign: 'right' }}>{fmtUSD(totalRecovered)}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#11181c', textAlign: 'right' }}>{fmtUSD(totalFee)}</span>
                        <span />
                      </div>
                    ); })()}
                  </>
                )}
              </div>

              {/* Sidebar overlay */}
              {openInv && <InvoiceSidebar inv={openInv} onClose={() => setOpenInv(null)} searchQ={search || undefined} />}
            </div>
          </div>
        </div>
      </div>
      {pwdModal && (
        <PasswordModal
          description={pwdModal.description}
          onConfirm={pwdModal.onConfirm}
          onCancel={() => setPwdModal(null)}
        />
      )}
    </>
  );
}
