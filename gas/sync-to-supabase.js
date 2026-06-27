// sync-to-supabase.js
// Pushes Google Sheet data → Supabase via Next.js /api/sync endpoint.
// Set these two Script Properties before use:
//   NEXTJS_API_URL  = https://your-app.vercel.app  (no trailing slash)
//   SYNC_SECRET     = same value as SYNC_SECRET env var in Vercel

function syncToSupabase() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('NEXTJS_API_URL');
  const secret = props.getProperty('SYNC_SECRET');
  if (!apiUrl || !secret) { Logger.log('Missing NEXTJS_API_URL or SYNC_SECRET'); return; }
  try {
    _syncRmsCases(apiUrl, secret);
    _syncClients(apiUrl, secret);
    _syncBillingContacts(apiUrl, secret);
    Logger.log('Supabase sync complete: ' + new Date().toISOString());
  } catch (e) {
    Logger.log('syncToSupabase error: ' + e.message);
  }
}

function _syncRmsCases(apiUrl, secret) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) return;
  const allValues = sheet.getDataRange().getValues();
  if (allValues.length < 2) return;
  const headers = allValues[0].map(h => String(h).trim());
  const idx = {
    caseId:    headers.indexOf('Case ID'),
    client:    headers.indexOf('Client Name'),
    dateFiled: headers.indexOf('Date Filed'),
    claimType: headers.indexOf('Claim Type'),
    status:    headers.indexOf('Reimbursement Status'),
    amount:    headers.indexOf('Reimbursement Amount (total)'),
    posting:   headers.indexOf('RMS Posting Date')
  };
  const now = new Date().toISOString();
  const rows = allValues.slice(1)
    .filter(r => r[idx.client] && r[idx.caseId])
    .map(r => ({
      case_id:               String(r[idx.caseId]),
      client_name:           String(r[idx.client]).trim(),
      date_filed:            _toDateStr(r[idx.dateFiled]),
      claim_type:            r[idx.claimType] ? String(r[idx.claimType]) : null,
      reimbursement_status:  r[idx.status]    ? String(r[idx.status])    : null,
      reimbursement_amount:  parseFloat(String(r[idx.amount]).replace(/[^0-9.-]+/g,'')) || 0,
      rms_posting_date:      _toDateStr(r[idx.posting]),
      synced_at:             now
    }));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    _post(apiUrl, secret, 'rms_cases', rows.slice(i, i + CHUNK));
  }
  Logger.log('rms_cases synced: ' + rows.length + ' rows');
}

function _syncClients(apiUrl, secret) {
  const sheet = SpreadsheetApp.openById(ONBOARDING_SPREADSHEET_ID).getSheetByName(ONBOARDING_SHEET_NAME);
  if (!sheet) return;
  const values = sheet.getRange('A2:Q' + sheet.getLastRow()).getValues();
  const now = new Date().toISOString();
  const rows = values.filter(r => r[3]).map(r => {
    const rawRate = r[16];
    const parsed = parseFloat(String(rawRate).replace('%','').trim());
    const rate = isNaN(parsed) ? 0.22 : (parsed >= 1 ? parsed / 100 : parsed);
    return {
      client_name:    String(r[3]).trim(),
      status:         r[1] ? String(r[1]).trim() : 'N/A',
      rate:           rate,
      start_date:     _toDateStr(r[11]),
      pilot_end_date: _toDateStr(r[12]),
      synced_at:      now
    };
  });
  _post(apiUrl, secret, 'clients', rows);
  Logger.log('clients synced: ' + rows.length + ' rows');
}

function _syncBillingContacts(apiUrl, secret) {
  const sheet = SpreadsheetApp.openById(BILLING_SUMMARY_SPREADSHEET_ID).getSheetByName(BILLING_SUMMARY_SHEET_NAME);
  if (!sheet) return;
  const values = sheet.getRange('B2:G' + sheet.getLastRow()).getValues();
  const now = new Date().toISOString();
  const rows = values.filter(r => r[0] && r[3]).map(r => ({
    client_name:   String(r[0]).trim(),
    invoice_date:  _toDateStr(r[3]),
    payment_terms: r[4] ? String(r[4]) : null,
    address:       r[5] ? String(r[5]) : null,
    synced_at:     now
  }));
  _post(apiUrl, secret, 'billing_contacts', rows);
  Logger.log('billing_contacts synced: ' + rows.length + ' rows');
}

// One-time: migrate existing invoice log from GAS → Supabase
function migrateInvoicesToSupabase() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('NEXTJS_API_URL');
  const secret = props.getProperty('SYNC_SECRET');
  if (!apiUrl || !secret) { Logger.log('Missing NEXTJS_API_URL or SYNC_SECRET'); return; }
  const history = getBillingHistory();
  Logger.log('Migrating ' + history.length + ' invoices...');
  _post(apiUrl, secret, 'invoices', history);
  Logger.log('Invoice migration done.');
}

// Install a time-driven trigger: every 3 minutes
function setupSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncToSupabase') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncToSupabase').timeBased().everyMinutes(3).create();
  Logger.log('Trigger set: syncToSupabase every 3 min');
}

function _toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) return Utilities.formatDate(val, 'UTC', 'yyyy-MM-dd');
  const s = String(val).trim();
  return s || null;
}

function _post(apiUrl, secret, type, data) {
  const res = UrlFetchApp.fetch(apiUrl + '/api/sync', {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + secret },
    payload: JSON.stringify({ type: type, data: data }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('Sync error [' + type + '] ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
}
