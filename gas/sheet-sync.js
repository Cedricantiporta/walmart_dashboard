// ============================================================
// PASTE THIS ENTIRE FILE into the Apps Script editor of:
// https://docs.google.com/spreadsheets/d/1F4G6g6nqyOgnf5VOhWNo8nJKWEJo4CcemcIygIMKEcE
//
// Setup (one-time):
//   1. Extensions > Apps Script
//   2. Paste this code (replace any existing content)
//   3. Project Settings (gear icon) > Script Properties > Add:
//        NEXTJS_API_URL  =  https://your-app.vercel.app   (no trailing slash)
//        SYNC_SECRET     =  (value from your Vercel env vars — SYNC_SECRET)
//   4. Select setupAllTriggers > Run > authorize when prompted
//   5. Run syncRmsToSupabase() once manually for immediate full sync
// ============================================================

// MUST use openById — getActiveSpreadsheet() returns null in time-based triggers
const SHEET_ID    = '1F4G6g6nqyOgnf5VOhWNo8nJKWEJo4CcemcIygIMKEcE';
const RMS_SHEET   = 'All Client RMS Report';
const THROTTLE_MS = 30000; // 30 sec cooldown between onEdit syncs

// ---- TRIGGER HANDLERS ----

// Called by installable onEdit trigger (named differently from GAS built-in 'onEdit' to avoid conflicts)
function onRmsSheetEdit(e) {
  if (!e || !e.source) return;
  if (e.range.getSheet().getName() !== RMS_SHEET) return;

  const cache = CacheService.getScriptCache();
  const last  = parseInt(cache.get('LAST_SYNC_MS') || '0');
  const now   = Date.now();

  if (now - last < THROTTLE_MS) {
    // Too soon — schedule a 1-min delayed sync instead of skipping entirely
    _scheduleDelayedSync();
    return;
  }

  cache.put('LAST_SYNC_MS', String(now), 120);
  syncRmsToSupabase();
}

// One-shot trigger created by _scheduleDelayedSync — fires once, deletes itself
function _delayedSync() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === '_delayedSync') ScriptApp.deleteTrigger(t);
  });
  syncRmsToSupabase();
}

function _scheduleDelayedSync() {
  var already = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === '_delayedSync';
  });
  if (!already) {
    ScriptApp.newTrigger('_delayedSync').timeBased().after(60000).create();
  }
}

// ---- MAIN SYNC ----

function syncRmsToSupabase() {
  var props  = PropertiesService.getScriptProperties();
  var apiUrl = props.getProperty('NEXTJS_API_URL');
  var secret = props.getProperty('SYNC_SECRET');
  if (!apiUrl || !secret) {
    Logger.log('ERROR: Set NEXTJS_API_URL and SYNC_SECRET in Project Settings > Script Properties');
    return;
  }

  try {
    // openById works in ALL trigger types (time-based, onEdit, manual)
    // getActiveSpreadsheet() silently returns null in time-based triggers — DO NOT use it
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(RMS_SHEET);
    if (!sheet) { Logger.log('Sheet not found: ' + RMS_SHEET); return; }

    var all = sheet.getDataRange().getValues();
    if (all.length < 2) { Logger.log('No data rows in ' + RMS_SHEET); return; }

    var rawHeaders = all[0].map(function(h) { return String(h).trim(); });
    var headers    = rawHeaders.map(function(h) { return h.toLowerCase(); });

    function findCol(candidates) {
      for (var ci = 0; ci < candidates.length; ci++) {
        var idx = headers.indexOf(candidates[ci].toLowerCase());
        if (idx >= 0) return idx;
      }
      for (var ci2 = 0; ci2 < candidates.length; ci2++) {
        var idx2 = headers.findIndex(function(h) { return h.includes(candidates[ci2].toLowerCase()); });
        if (idx2 >= 0) return idx2;
      }
      return -1;
    }

    var ix = {
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

    if (ix.caseId === -1 || ix.client === -1) {
      Logger.log('ERROR: Required columns missing. Headers: ' + JSON.stringify(rawHeaders));
      return;
    }

    var now  = new Date().toISOString();
    var rows = all.slice(1)
      .filter(function(r) { return r[ix.client] && r[ix.caseId]; })
      .map(function(r) {
        return {
          case_id:              String(r[ix.caseId]),
          client_name:          String(r[ix.client]).trim(),
          date_filed:           _toDateStr(r[ix.dateFiled]),
          claim_type:           r[ix.claimType]  ? String(r[ix.claimType])  : null,
          reimbursement_status: r[ix.status]     ? String(r[ix.status])     : null,
          reimbursement_amount: parseFloat(String(r[ix.amount]).replace(/[^0-9.-]+/g, '')) || 0,
          rms_posting_date:     _toDateStr(r[ix.posting]),
          synced_at:            now,
          gtin:       ix.gtin      >= 0 && r[ix.gtin]      ? String(r[ix.gtin])  : null,
          sku_id:     ix.skuId     >= 0 && r[ix.skuId]     ? String(r[ix.skuId]) : null,
          unit_amount:  ix.unitAmount >= 0 ? (parseFloat(String(r[ix.unitAmount]).replace(/[^0-9.-]+/g,'')) || null) : null,
          reimbursed_qty: ix.reimQty >= 0 ? (parseInt(String(r[ix.reimQty]), 10) || null) : null,
        };
      });

    var res  = UrlFetchApp.fetch(apiUrl + '/api/sync', {
      method:             'POST',
      contentType:        'application/json',
      headers:            { 'Authorization': 'Bearer ' + secret },
      payload:            JSON.stringify({ type: 'rms_cases', data: rows }),
      muteHttpExceptions: true,
    });

    var code = res.getResponseCode();
    if (code === 200) {
      Logger.log('OK: synced ' + rows.length + ' rows at ' + now);
    } else {
      Logger.log('ERROR ' + code + ': ' + res.getContentText().slice(0, 400));
    }
  } catch (e) {
    Logger.log('syncRmsToSupabase EXCEPTION: ' + e.message + '\n' + e.stack);
  }
}

// ---- SETUP (run once from editor) ----

// Recommended: onEdit (instant) + 5-min time-based (catches anything missed)
function setupAllTriggers() {
  _deleteAllTriggers();
  // Installable onEdit — fires under owner auth, works with UrlFetchApp
  ScriptApp.newTrigger('onRmsSheetEdit')
    .forSpreadsheet(SpreadsheetApp.openById(SHEET_ID))
    .onEdit()
    .create();
  // 5-min fallback
  ScriptApp.newTrigger('syncRmsToSupabase')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Triggers set: onRmsSheetEdit (instant) + syncRmsToSupabase every 5 min');
}

function setup5MinTrigger() {
  _deleteAllTriggers();
  ScriptApp.newTrigger('syncRmsToSupabase')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Trigger set: syncRmsToSupabase every 5 min');
}

function setupOnEditTrigger() {
  _deleteAllTriggers();
  ScriptApp.newTrigger('onRmsSheetEdit')
    .forSpreadsheet(SpreadsheetApp.openById(SHEET_ID))
    .onEdit()
    .create();
  Logger.log('Trigger set: onRmsSheetEdit on edit');
}

function _deleteAllTriggers() {
  var fns = ['onEdit', 'onRmsSheetEdit', 'syncRmsToSupabase', '_delayedSync'];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (fns.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

// ---- DATE HELPER ----

function _toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  if (!s) return null;
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  return s.slice(0, 10);
}
