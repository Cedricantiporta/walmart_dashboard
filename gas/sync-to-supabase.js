// sync-to-supabase.js
// Reads from the consolidated spreadsheet 1F4G6g6nqyOgnf5VOhWNo8nJKWEJo4CcemcIygIMKEcE
//   Sheet "All Client RMS Report"  → rms_cases
//   Sheet "Onboarding Tracker"     → clients
//   Sheet "InvoiceLog"             → invoices (one-time migration)
//
// Script Properties required (set these before first use):
//   NEXTJS_API_URL   = https://your-app.vercel.app  (no trailing slash)
//   SYNC_SECRET      = same value as SYNC_SECRET in Vercel env vars

const SYNC_SOURCE_ID = '1F4G6g6nqyOgnf5VOhWNo8nJKWEJo4CcemcIygIMKEcE';
const SYNC_RMS_SHEET = 'All Client RMS Report';
const SYNC_ONBOARDING_SHEET = 'Onboarding Tracker';
const SYNC_INVOICE_SHEET = 'InvoiceLog';

function syncToSupabase() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('NEXTJS_API_URL');
  const secret = props.getProperty('SYNC_SECRET');
  if (!apiUrl || !secret) { Logger.log('Missing NEXTJS_API_URL or SYNC_SECRET'); return; }
  try {
    _syncRmsCases(apiUrl, secret);
    _syncOnboardingTracker(apiUrl, secret);
    Logger.log('Supabase sync complete: ' + new Date().toISOString());
  } catch (e) {
    Logger.log('syncToSupabase error: ' + e.message + '\n' + e.stack);
  }
}

// Run once after first Vercel deploy — migrates ALL existing invoice history
function migrateAll() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('NEXTJS_API_URL');
  const secret = props.getProperty('SYNC_SECRET');
  if (!apiUrl || !secret) { Logger.log('Missing NEXTJS_API_URL or SYNC_SECRET'); return; }
  Logger.log('=== Starting full migration ===');
  _syncRmsCases(apiUrl, secret);
  _syncOnboardingTracker(apiUrl, secret);
  _migrateInvoiceLog(apiUrl, secret);
  Logger.log('=== Migration complete ===');
}

function _syncRmsCases(apiUrl, secret) {
  const ss = SpreadsheetApp.openById(SYNC_SOURCE_ID);
  const sheet = ss.getSheetByName(SYNC_RMS_SHEET);
  if (!sheet) { Logger.log('Sheet not found: ' + SYNC_RMS_SHEET); return; }

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

  if (idx.caseId === -1 || idx.client === -1) {
    Logger.log('ERROR: Required columns not found in ' + SYNC_RMS_SHEET + '. Headers: ' + JSON.stringify(headers));
    return;
  }

  const now = new Date().toISOString();
  const rows = allValues.slice(1)
    .filter(r => r[idx.client] && r[idx.caseId])
    .map(r => ({
      case_id:              String(r[idx.caseId]),
      client_name:          String(r[idx.client]).trim(),
      date_filed:           _toDateStr(r[idx.dateFiled]),
      claim_type:           r[idx.claimType]  ? String(r[idx.claimType])  : null,
      reimbursement_status: r[idx.status]     ? String(r[idx.status])     : null,
      reimbursement_amount: parseFloat(String(r[idx.amount]).replace(/[^0-9.-]+/g,'')) || 0,
      rms_posting_date:     _toDateStr(r[idx.posting]),
      synced_at:            now
    }));

  // Full-replace sync: server deletes all then inserts fresh.
  // case_id is NOT unique — same case can have multiple rows (diff amounts/statuses).
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    _post(apiUrl, secret, 'rms_cases', rows.slice(i, i + CHUNK));
  }
  Logger.log('rms_cases synced: ' + rows.length);
}

function _syncOnboardingTracker(apiUrl, secret) {
  const ss = SpreadsheetApp.openById(SYNC_SOURCE_ID);
  const sheet = ss.getSheetByName(SYNC_ONBOARDING_SHEET);
  if (!sheet) { Logger.log('Sheet not found: ' + SYNC_ONBOARDING_SHEET); return; }

  const allValues = sheet.getDataRange().getValues();
  if (allValues.length < 2) return;

  const rawHeaders = allValues[0].map(h => String(h).trim());
  const headers = rawHeaders.map(h => h.toLowerCase());

  // Flexible header detection — handles renamed columns
  function findCol(candidates) {
    for (const c of candidates) {
      const i = headers.findIndex(h => h === c || h.includes(c) || c.includes(h));
      if (i >= 0) return i;
    }
    return -1;
  }

  const idx = {
    client:       findCol(['client name', 'client', 'store name', 'account name']),
    status:       findCol(['status', 'client status', 'billing status', 'account status']),
    rate:         findCol(['rate', 'billing rate', 'fee rate', 'fee %', '% fee', 'commission', '% commission']),
    startDate:    findCol(['start date', 'go live', 'contract start', 'billable from', 'live date', 'start']),
    pilotEndDate: findCol(['(pilot) end date', 'pilot end', 'billable start', 'end of pilot', 'pilot end date', 'post-pilot']),
  };

  Logger.log('Onboarding Tracker columns: ' + JSON.stringify(
    Object.fromEntries(Object.entries(idx).map(([k,v]) => [k, v >= 0 ? rawHeaders[v] + ' (col ' + (v+1) + ')' : 'NOT FOUND']))
  ));

  if (idx.client === -1) {
    Logger.log('ERROR: Client Name column not found. Headers: ' + JSON.stringify(rawHeaders));
    return;
  }

  const now = new Date().toISOString();
  const rows = allValues.slice(1)
    .filter(r => r[idx.client])
    .map(r => {
      const rawRate = idx.rate >= 0 ? r[idx.rate] : null;
      let rate = 0.22;
      if (rawRate !== null && rawRate !== '') {
        const parsed = parseFloat(String(rawRate).replace(/[^0-9.-]+/g,''));
        if (!isNaN(parsed)) rate = parsed >= 1 ? parsed / 100 : parsed;
      }
      return {
        client_name:   String(r[idx.client]).trim(),
        status:        idx.status >= 0 && r[idx.status] ? String(r[idx.status]).trim() : 'N/A',
        rate:          rate,
        start_date:    idx.startDate    >= 0 ? _toDateStr(r[idx.startDate])    : null,
        pilot_end_date: idx.pilotEndDate >= 0 ? _toDateStr(r[idx.pilotEndDate]) : null,
        synced_at:     now
      };
    });

  _post(apiUrl, secret, 'clients', rows);
  Logger.log('Onboarding Tracker synced: ' + rows.length);
}

// One-time: migrate full InvoiceLog to Supabase
function _migrateInvoiceLog(apiUrl, secret) {
  const ss = SpreadsheetApp.openById(SYNC_SOURCE_ID);
  const sheet = ss.getSheetByName(SYNC_INVOICE_SHEET);
  if (!sheet) { Logger.log('Sheet not found: ' + SYNC_INVOICE_SHEET); return; }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) { Logger.log('InvoiceLog is empty'); return; }

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    try {
      const row = data[i];
      if (!row[0]) continue; // skip empty rows
      let caseIds = [];
      let caseSnapshot = [];
      try { caseIds = JSON.parse(row[5]); } catch(e) {}
      try { caseSnapshot = JSON.parse(row[6]); } catch(e) {}
      rows.push({
        invoice_number:   String(row[0]),
        client_name:      String(row[1]),
        billed_date:      row[2] instanceof Date ? row[2].toISOString() : new Date(String(row[2])).toISOString(),
        billed_fee:       parseFloat(row[3]) || 0,
        total_reimbursed: parseFloat(row[4]) || 0,
        case_ids:         Array.isArray(caseIds) ? caseIds.map(String) : [],
        case_snapshot:    Array.isArray(caseSnapshot) ? caseSnapshot : [],
        pdf_url:          row[7] ? String(row[7]) : ''
      });
    } catch(e) {
      Logger.log('Skipping InvoiceLog row ' + (i+1) + ': ' + e.message);
    }
  }

  // invoices already have invoice_number format, post directly (not camelCase conversion needed)
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    _postRaw(apiUrl, secret, 'invoices_raw', rows.slice(i, i + CHUNK));
  }
  Logger.log('InvoiceLog migrated: ' + rows.length + ' invoices');
}

// Install time-driven trigger: every 3 minutes
function setupSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncToSupabase') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncToSupabase').timeBased().everyMinutes(3).create();
  Logger.log('Trigger created: syncToSupabase every 3 min');
}

// ---- helpers ----

function _toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return Utilities.formatDate(val, 'UTC', 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (!s) return null;
  // Try to parse common date formats
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  return s.slice(0, 10); // fallback: first 10 chars
}

function _post(apiUrl, secret, type, data) {
  const res = UrlFetchApp.fetch(apiUrl + '/api/sync', {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + secret },
    payload: JSON.stringify({ type: type, data: data }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) Logger.log('[' + type + '] sync API error ' + code + ': ' + res.getContentText().slice(0, 300));
  return code === 200;
}

// Used for invoice migration — already snake_case, different type key
function _postRaw(apiUrl, secret, type, data) {
  const res = UrlFetchApp.fetch(apiUrl + '/api/sync', {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + secret },
    payload: JSON.stringify({ type: 'invoices_raw', data: data }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) Logger.log('[invoices_raw] sync error ' + code + ': ' + res.getContentText().slice(0, 300));
}
