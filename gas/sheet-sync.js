// ============================================================
// PASTE THIS ENTIRE FILE into the Apps Script editor of:
// https://docs.google.com/spreadsheets/d/1F4G6g6nqyOgnf5VOhWNo8nJKWEJo4CcemcIygIMKEcE
//
// Setup (one-time):
//   1. Extensions → Apps Script
//   2. Paste this code (replace any existing content)
//   3. Project Settings → Script Properties → Add:
//        NEXTJS_API_URL  =  https://walmart-dashboard.vercel.app   (no trailing slash)
//        SYNC_SECRET     =  (same value as SYNC_SECRET in Vercel env)
//   4. Select setupAllTriggers → click Run → authorize when prompted
//   5. Manually run syncRmsToSupabase() once to do an immediate full sync
// ============================================================

const RMS_SHEET   = 'All Client RMS Report';
const THROTTLE_MS = 30000; // min ms between onEdit syncs (30 sec)

// ---- AUTO TRIGGERS ----

// GAS calls this automatically on every edit.
// Throttled: if an edit fires within 30s of the last sync, schedule a 1-min delayed sync instead.
function onEdit(e) {
  if (!e || !e.source) return;
  if (e.range.getSheet().getName() !== RMS_SHEET) return;

  const cache = CacheService.getScriptCache();
  const last  = parseInt(cache.get('LAST_SYNC_MS') || '0');
  const now   = Date.now();

  if (now - last < THROTTLE_MS) {
    _scheduleDelayedSync();
    return;
  }

  cache.put('LAST_SYNC_MS', String(now), 120);
  syncRmsToSupabase();
}

// One-shot delayed trigger: fires 1 min after a throttled edit, then deletes itself.
function _delayedSync() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === '_delayedSync') ScriptApp.deleteTrigger(t);
  });
  syncRmsToSupabase();
}

function _scheduleDelayedSync() {
  const already = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === '_delayedSync');
  if (!already) {
    ScriptApp.newTrigger('_delayedSync').timeBased().after(60000).create();
  }
}

// ---- MAIN SYNC FUNCTION ----

function syncRmsToSupabase() {
  const props  = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('NEXTJS_API_URL');
  const secret = props.getProperty('SYNC_SECRET');
  if (!apiUrl || !secret) {
    Logger.log('ERROR: Set NEXTJS_API_URL and SYNC_SECRET in Project Settings → Script Properties');
    return;
  }

  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(RMS_SHEET);
    if (!sheet) { Logger.log('Sheet not found: ' + RMS_SHEET); return; }

    const all = sheet.getDataRange().getValues();
    if (all.length < 2) { Logger.log('No data rows in ' + RMS_SHEET); return; }

    const rawHeaders = all[0].map(h => String(h).trim());
    const headers    = rawHeaders.map(h => h.toLowerCase());

    function findCol(candidates) {
      for (const c of candidates) {
        const i = headers.indexOf(c.toLowerCase());
        if (i >= 0) return i;
      }
      for (const c of candidates) {
        const i = headers.findIndex(h => h.includes(c.toLowerCase()));
        if (i >= 0) return i;
      }
      return -1;
    }

    const idx = {
      caseId:     findCol(['case id', 'case_id', 'caseid']),
      client:     findCol(['client name', 'store name', 'account name', 'client']),
      dateFiled:  findCol(['date filed', 'filed date', 'date']),
      claimType:  findCol(['claim type', 'type']),
      status:     findCol(['reimbursement status', 'status']),
      amount:     findCol(['reimbursement amount (total)', 'reimbursement amount', 'amount']),
      posting:    findCol(['rms posting date', 'posting date', 'post date']),
      gtin:       findCol(['gtin']),
      skuId:      findCol(['sku id', 'sku_id', 'skuid']),
      unitAmount: findCol(['reimbursement amount/unit', 'amount/unit', 'unit amount']),
      reimQty:    findCol(['reimbursed qty', 'reimbursed_qty', 'reimbursed quantity']),
    };

    if (idx.caseId === -1 || idx.client === -1) {
      Logger.log('ERROR: Required columns missing. Headers found: ' + JSON.stringify(rawHeaders));
      return;
    }

    const now  = new Date().toISOString();
    const rows = all.slice(1)
      .filter(r => r[idx.client] && r[idx.caseId])
      .map(r => ({
        case_id:              String(r[idx.caseId]),
        client_name:          String(r[idx.client]).trim(),
        date_filed:           _toDateStr(r[idx.dateFiled]),
        claim_type:           r[idx.claimType]  ? String(r[idx.claimType])  : null,
        reimbursement_status: r[idx.status]     ? String(r[idx.status])     : null,
        reimbursement_amount: parseFloat(String(r[idx.amount]).replace(/[^0-9.-]+/g, '')) || 0,
        rms_posting_date:     _toDateStr(r[idx.posting]),
        synced_at:            now,
        gtin:                 idx.gtin      >= 0 && r[idx.gtin]      ? String(r[idx.gtin])                                                 : null,
        sku_id:               idx.skuId     >= 0 && r[idx.skuId]     ? String(r[idx.skuId])                                                : null,
        unit_amount:          idx.unitAmount >= 0                     ? (parseFloat(String(r[idx.unitAmount]).replace(/[^0-9.-]+/g,'')) || null) : null,
        reimbursed_qty:       idx.reimQty   >= 0                     ? (parseInt(String(r[idx.reimQty]), 10) || null)                      : null,
      }));

    const res  = UrlFetchApp.fetch(apiUrl + '/api/sync', {
      method:          'POST',
      contentType:     'application/json',
      headers:         { 'Authorization': 'Bearer ' + secret },
      payload:         JSON.stringify({ type: 'rms_cases', data: rows }),
      muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    if (code === 200) {
      Logger.log('Synced ' + rows.length + ' rows → Supabase (' + now + ')');
    } else {
      Logger.log('Sync API error ' + code + ': ' + res.getContentText().slice(0, 400));
    }
  } catch (e) {
    Logger.log('syncRmsToSupabase error: ' + e.message + '\n' + e.stack);
  }
}

// ---- SETUP (run once) ----

// Recommended: onEdit for instant updates + every-5-min fallback for missed edits
function setupAllTriggers() {
  _deleteAllTriggers();
  ScriptApp.newTrigger('onEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  ScriptApp.newTrigger('syncRmsToSupabase')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Triggers active: onEdit (instant) + every 5 min');
}

// Only time-based (safer for very large sheets)
function setup5MinTrigger() {
  _deleteAllTriggers();
  ScriptApp.newTrigger('syncRmsToSupabase')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Trigger active: every 5 min');
}

// Only onEdit
function setupOnEditTrigger() {
  _deleteAllTriggers();
  ScriptApp.newTrigger('onEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  Logger.log('Trigger active: onEdit');
}

function _deleteAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['onEdit', 'syncRmsToSupabase', '_delayedSync'].includes(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

// ---- HELPER ----

function _toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  return s.slice(0, 10);
}
