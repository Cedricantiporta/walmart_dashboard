// Client-side only — call from event handlers, never during SSR

export type PDFCase = {
  case_id: string;
  claim_type?: string | null;
  rms_posting_date?: string | null;
  reimbursement_amount: number;
};

export type PDFInvoiceData = {
  invoice_number: string;
  client_name: string;
  client_address?: string | null;
  billed_date: string;
  billed_fee: number;
  total_reimbursed: number;
  case_ids?: string[];
};

function _fmtUSD(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
}
function _fmtDate(iso: string) {
  return new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function _fmtPct(r: number) {
  const p = r * 100;
  return `${p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
}

export async function downloadInvoicePDF(inv: PDFInvoiceData, cases: PDFCase[]) {
  const { default: jsPDF } = await import('jspdf');
  await import('jspdf-autotable');

  const rate = inv.total_reimbursed > 0 ? inv.billed_fee / inv.total_reimbursed : 0;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 15;

  const billedDateStr = (inv.billed_date ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const dueD = new Date(billedDateStr + 'T12:00:00');
  dueD.setDate(dueD.getDate() + 7);
  const dueDate = dueD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  let y = M;

  // Left: Threecolts sender
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(17, 24, 39);
  doc.text('Threecolts', M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(107, 114, 128);
  ['16192 Coastal Highway', 'Lewes, Delaware 19958', 'United States', 'support@threecolts.com'].forEach((line, i) => {
    doc.text(line, M, y + 6 + i * 4.8);
  });

  // Right: INVOICE block
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(17, 24, 39);
  doc.text('INVOICE', W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 114, 128);
  [
    `Invoice #: ${inv.invoice_number}`,
    `Date: ${_fmtDate(billedDateStr)}`,
    `Due Date: ${dueDate}`,
  ].forEach((line, i) => {
    doc.text(line, W - M, y + 9 + i * 5.5, { align: 'right' });
  });

  y += 40;

  // Bill To
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(156, 163, 175);
  doc.text('BILL TO', M, y);
  doc.setDrawColor(229, 231, 235); doc.line(M, y + 2, W - M, y + 2);
  y += 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(17, 24, 39);
  doc.text(inv.client_name, M, y);
  if (inv.client_address) {
    y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(107, 114, 128);
    inv.client_address.split('\n').forEach((line, i) => { doc.text(line.trim(), M, y + i * 4.5); });
    y += inv.client_address.split('\n').length * 4.5;
  }
  y += 12;

  // Cases table
  const tableBody: string[][] = cases.length > 0
    ? cases.map(c => [
        c.case_id,
        c.rms_posting_date ? _fmtDate(c.rms_posting_date.slice(0, 10)) : '—',
        c.claim_type || 'N/A',
        _fmtUSD(c.reimbursement_amount),
        _fmtPct(rate),
        _fmtUSD(c.reimbursement_amount * rate),
      ])
    : (inv.case_ids ?? []).map(id => [id, '—', '—', '—', _fmtPct(rate), '—']);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).autoTable({
    head: [['Case ID', 'Posting Date', 'Description', 'Recovered', 'Fee Rate', 'Fee Amount']],
    body: tableBody,
    startY: y,
    margin: { left: M, right: M, bottom: 22 },
    styles: { fontSize: 8.5, cellPadding: { top: 3.5, bottom: 3.5, left: 3, right: 3 } },
    headStyles: { fillColor: [17, 24, 39], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    showHead: 'firstPage',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY: number = (doc as any).lastAutoTable.finalY;

  // Summary block — bottom right, after table
  const sumX = W - M - 72;
  let sy = finalY + 10;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(55, 65, 81);
  doc.text('Total Recovered:', sumX, sy);
  doc.setFont('helvetica', 'bold'); doc.text(_fmtUSD(inv.total_reimbursed), W - M, sy, { align: 'right' });
  sy += 6;
  doc.setDrawColor(229, 231, 235); doc.line(sumX, sy, W - M, sy);
  sy += 5;
  doc.setFont('helvetica', 'normal'); doc.text('Subtotal:', sumX, sy);
  doc.setFont('helvetica', 'bold'); doc.text(_fmtUSD(inv.billed_fee), W - M, sy, { align: 'right' });
  sy += 6;
  doc.setDrawColor(229, 231, 235); doc.line(sumX, sy, W - M, sy);
  sy += 5;
  doc.setFillColor(243, 244, 246);
  doc.roundedRect(sumX - 2, sy - 1, W - M - sumX + 2, 11, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(17, 24, 39);
  doc.text('Amount Due (USD):', sumX, sy + 6);
  doc.text(_fmtUSD(inv.billed_fee), W - M, sy + 6, { align: 'right' });

  // Page numbers x/total on every page (after all content is drawn)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalPages: number = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(8); doc.setTextColor(150); doc.setFont('helvetica', 'normal');
    doc.text(`${p}/${totalPages}`, W - M, 287, { align: 'right' });
  }

  doc.save(`${inv.invoice_number}-${inv.client_name.replace(/\s+/g, '-')}.pdf`);
}
