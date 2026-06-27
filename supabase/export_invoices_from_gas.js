// Run this in your Google Apps Script editor (one-time migration).
// It reads the InvoiceLog sheet and POSTs all invoices to your Next.js import endpoint.
// Replace IMPORT_URL with your deployed Vercel URL.

const IMPORT_URL = 'https://walmartbilling.vercel.app/api/invoices/import';

function exportInvoicesToNextjs() {
  const sheet = SpreadsheetApp.openById(INVOICE_LOG_SPREADSHEET_ID).getSheetByName(INVOICE_LOG_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('No invoices found.'); return; }

  const invoices = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // skip blank rows

    let caseIds = [];
    let caseSnapshot = [];
    try { caseIds = JSON.parse(row[5]); } catch(e) {}
    try { caseSnapshot = JSON.parse(row[6]); } catch(e) {}

    invoices.push({
      invoice_number: String(row[0]),
      client_name:    String(row[1]),
      billed_date:    row[2] instanceof Date ? row[2].toISOString() : new Date(row[2]).toISOString(),
      billed_fee:     Number(row[3]) || 0,
      total_reimbursed: Number(row[4]) || 0,
      case_ids:       caseIds.map(String),
      case_snapshot:  caseSnapshot,
      pdf_url:        row[7] ? String(row[7]) : '',
    });
  }

  Logger.log('Exporting ' + invoices.length + ' invoices...');

  const response = UrlFetchApp.fetch(IMPORT_URL, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(invoices),
    muteHttpExceptions: true,
  });

  const result = JSON.parse(response.getContentText());
  Logger.log('Result: ' + JSON.stringify(result));
  return result;
}
