// --- CONFIGURATION ---
// Clients hardcoded excluded regardless of onboarding status — only bypass if explicitly in extraClients
const ALWAYS_EXCLUDED_CLIENTS = new Set([]);
// Source RMS data — the live "All Client RMS Report" sheet
const SPREADSHEET_ID = '1F4G6g6nqyOgnf5VOhWNo8nJKWEJo4CcemcIygIMKEcE';
const SHEET_NAME = 'All Client RMS Report';
const INVOICE_LOG_SPREADSHEET_ID = '1F4G6g6nqyOgnf5VOhWNo8nJKWEJo4CcemcIygIMKEcE';

const ONBOARDING_SPREADSHEET_ID = '1F4G6g6nqyOgnf5VOhWNo8nJKWEJo4CcemcIygIMKEcE';
const ONBOARDING_SHEET_NAME = 'Onboarding Tracker';
const INVOICE_LOG_SHEET_NAME = 'InvoiceLog';

const BILLING_SUMMARY_SPREADSHEET_ID = '1J_weTVTbY2cFgHNbs3TbjQ6ToWXAEbXf7RUMg_RjGEo';
const BILLING_SUMMARY_SHEET_NAME = 'Billing Summary';

const BILLED_STORAGE_KEY = 'billedCaseIDs_v2';
const VANTAGE_CUTOFF_KEY = 'VANTAGE_CUTOFF_DATE';
const CODE_VERSION = '20260627a'; // bump on each deploy to invalidate DA/FP caches
const DEFAULT_DASHBOARD_VIEW_KEY = 'defaultDashboardView_v1';
const DEFAULT_DASHBOARD_TIME_KEY = 'defaultDashboardTime_v1';

const MAIN_DATA_STORAGE_KEY = 'all_rms_report_data_v4'; // v4: switched source sheet to 1elkpl1

const DEFAULT_RATES = { 'DEFAULT': 0.22 };

// --- WEB APP FUNCTIONS ---
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  const logos = getLogoImages();
  template.logos = logos;
  return template.evaluate()
    .setTitle('WFS Billing Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function callGeminiAPI(payload) {
  try {
    var key = PropertiesService.getScriptProperties().getProperty('AI_STUDIO_KEY');
    if (!key) return { error: 'AI_STUDIO_KEY not set in Script Properties.' };
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + key;
    var body = {
      contents: payload.contents,
      generationConfig: { maxOutputTokens: 1500, temperature: 0.7 }
    };
    if (payload.systemContext) {
      body.systemInstruction = { parts: [{ text: payload.systemContext }] };
    }
    var response = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var data = JSON.parse(response.getContentText());
    if (data.error) return { error: data.error.message };
    var text = data.candidates && data.candidates[0] && data.candidates[0].content &&
               data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
               data.candidates[0].content.parts[0].text;
    return { text: text || '' };
  } catch(e) {
    return { error: e.message };
  }
}

function getUserSessionInfo() {
  const user = Session.getActiveUser();
  const email = user.getEmail();
  const name = email ? email.split('@')[0].split('.').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ') : 'Guest User';
  return {
    email: email || 'No Email Found (External Access)',
    name: name,
    initial: name.charAt(0).toUpperCase() || '?'
  };
}

// --- INITIAL LOAD ---
function getInitialPayload() {
  const compactData = fetchAndStoreSheetData();
  const allData = rehydrateData(compactData);
  const onboardingInfo = getClientOnboardingInfo();

  const billingSummary = getBillingSummary(allData, onboardingInfo);
  const activeClients = billingSummary.map(c => c.clientName).sort();

  // Hidden client list = hardcoded excluded + non-Client-status entries that have sheet data
  const allDataClientNames = [...new Set(allData.map(r => r['Client Name'] ? r['Client Name'].trim() : null).filter(Boolean))];
  const hiddenClientList = allDataClientNames.filter(name => {
    const key = name.toLowerCase();
    if (ALWAYS_EXCLUDED_CLIENTS.has(key)) return true;
    if (activeClients.map(c => c.toLowerCase()).includes(key)) return false;
    const info = onboardingInfo[name] || onboardingInfo[Object.keys(onboardingInfo).find(k => k.toLowerCase() === key)];
    return !info || info.status !== 'Client';
  }).sort();

  const defaultDashboardSettings = getDefaultDashboardSettings();
  const billingSummaryInfo = getBillingSummaryInfo();
  
  // If the saved time setting is not one of the standard valid ones, force 'thisMonth'
  const validTimes = ['thisMonth', 'lastMonth', 'specificMonth', '90days', 'lifetime'];
  let timeRange = defaultDashboardSettings.time;
  
  if (!timeRange || !validTimes.includes(timeRange)) {
      timeRange = 'thisMonth';
  }

  return {
    billingSummary: billingSummary,
    history: getBillingHistory(),
    billedIds: getBilledIdsFromServer(),
    onboardingInfo: onboardingInfo,
    defaultDashboardSettings: { ...defaultDashboardSettings, time: timeRange }, 
    dashboardAnalytics: calculateDashboardAnalytics(timeRange, onboardingInfo, allData, null, null, 'all', []),
    billingInsights: getBillingInsights(billingSummary),
    billingSummaryInfo: billingSummaryInfo,
    clientList: activeClients,
    hiddenClientList: hiddenClientList,
    userInfo: getUserSessionInfo(),
    lastSyncTime: compactData.timestamp || new Date().toISOString()
  };
}

// One-time auto-correction: un-bill the 4 wrongly-billed cases. Runs once, then flags itself done.
function _runOneTimeCleanup() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('CLEANUP_4CASES_V1')) return;
  try { unbillCaseIds(['14758541', '14969195', '14821054', '14674867']); } catch(e) { Logger.log('cleanup err: ' + e.message); }
  props.setProperty('CLEANUP_4CASES_V1', '1');
}

// Fast initial load — skips calculateDashboardAnalytics (deferred to client-side loadDashboardAnalytics call)
function getInitialPayloadFast() {
  _runOneTimeCleanup();
  const cache = CacheService.getScriptCache();
  const version = cache.get('COMPUTED_V') || '0';
  const fpKey = 'FP_v' + version + '_' + CODE_VERSION;

  // Try to serve computed parts from cache — skips rehydrateData + getBillingSummary entirely
  const fpCached = cache.get(fpKey);
  if (fpCached) {
    try {
      const partial = JSON.parse(fpCached);
      return {
        ...partial,
        onboardingInfo: getClientOnboardingInfo(),
        history: getBillingHistory(),
        billedIds: getBilledIdsFromServer(),
        userInfo: getUserSessionInfo(),
        vantageCutoff: PropertiesService.getScriptProperties().getProperty(VANTAGE_CUTOFF_KEY) || '2026-05-06'
      };
    } catch(e) {}
  }

  // Cache miss — full computation
  const compactData = fetchAndStoreSheetData();
  const allData = rehydrateData(compactData);
  const onboardingInfo = getClientOnboardingInfo();

  const billingSummary = getBillingSummary(allData, onboardingInfo);
  const activeClients = billingSummary.map(c => c.clientName).sort();

  const allDataClientNames = [...new Set(allData.map(r => r['Client Name'] ? r['Client Name'].trim() : null).filter(Boolean))];
  const hiddenClientList = allDataClientNames.filter(name => {
    const key = name.toLowerCase();
    if (ALWAYS_EXCLUDED_CLIENTS.has(key)) return true;
    if (activeClients.map(c => c.toLowerCase()).includes(key)) return false;
    const info = onboardingInfo[name] || onboardingInfo[Object.keys(onboardingInfo).find(k => k.toLowerCase() === key)];
    return !info || info.status !== 'Client';
  }).sort();

  const defaultDashboardSettings = getDefaultDashboardSettings();
  const billingSummaryInfo = getBillingSummaryInfo();

  const validTimes = ['thisMonth', 'lastMonth', 'specificMonth', '90days', 'lifetime'];
  let timeRange = defaultDashboardSettings.time;
  if (!timeRange || !validTimes.includes(timeRange)) timeRange = 'thisMonth';

  const billingInsights = getBillingInsights(billingSummary);

  // Cache computed parts (exclude onboardingInfo, history, billedIds, userInfo — those have own caches)
  const toCache = {
    billingSummary, defaultDashboardSettings: { ...defaultDashboardSettings, time: timeRange },
    billingInsights, billingSummaryInfo, clientList: activeClients,
    hiddenClientList, lastSyncTime: compactData.timestamp || new Date().toISOString()
  };
  try { cache.put(fpKey, JSON.stringify(toCache), 1200); } catch(e) {} // 20 min

  return {
    ...toCache,
    onboardingInfo,
    history: getBillingHistory(),
    billedIds: getBilledIdsFromServer(),
    userInfo: getUserSessionInfo(),
    vantageCutoff: PropertiesService.getScriptProperties().getProperty(VANTAGE_CUTOFF_KEY) || '2026-05-06'
  };
}

// --- DATA FETCHERS ---
function getBillingAndHistoryData(extraClients) {
    const compactData = fetchAndStoreSheetData();
    const allData = rehydrateData(compactData);
    const onboardingInfo = getClientOnboardingInfo();
    const billingSummary = getBillingSummary(allData, onboardingInfo, extraClients || []);
    return {
        billingSummary: billingSummary,
        history: getBillingHistory(),
        billedIds: getBilledIdsFromServer(),
        billingInsights: getBillingInsights(billingSummary)
    };
}

function getDashboardAnalytics(timeRange, startDateStr, endDateStr, specificClient, extraClients) {
  const cache = CacheService.getScriptCache();
  const version = cache.get('COMPUTED_V') || '0';
  const extraKey = (extraClients || []).slice().sort().join('|');
  const daKey = `DA_v${version}_${CODE_VERSION}_${timeRange}_${startDateStr||''}_${endDateStr||''}_${specificClient||'all'}_${extraKey}`;

  const hit = cache.get(daKey);
  if (hit) { try { return JSON.parse(hit); } catch(e) {} }

  const compactData = fetchAndStoreSheetData();
  const allData = rehydrateData(compactData);
  const onboardingInfo = getClientOnboardingInfo();
  const result = calculateDashboardAnalytics(timeRange, onboardingInfo, allData, startDateStr, endDateStr, specificClient || 'all', extraClients || []);
  try { cache.put(daKey, JSON.stringify(result), 900); } catch(e) {} // 15 min
  return result;
}

// --- CORE ANALYTICS LOGIC (DASHBOARD) ---
function calculateDashboardAnalytics(timeRange = 'thisMonth', onboardingInfo, allData, startDateStr, endDateStr, specificClient = 'all', extraClients) {
  try {
    if (!allData || allData.length === 0) {
        return { 
            metrics: { totalReimbursed: 0, totalFees: 0, approvedCases: 0, approvalRate: 0 }, 
            trends: { totalReimbursed: 0, totalFees: 0, approvedCases: 0, approvalRate: 0 }, 
            dailyData: { labels: [], current: [], previous: [] }, 
            categoryData: [],
            monthlyHistory: []
        };
    }

    const billedIds = new Set(getBilledIdsFromServer().map(String));
    billedIds.add('13011996'); // Hardcoded mark as billed
    billedIds.add('14969195'); // Hardcoded mark as billed
    const extraSet = new Set((extraClients || []).map(c => c.trim().toLowerCase()));
    const vCutoff = new Date((PropertiesService.getScriptProperties().getProperty(VANTAGE_CUTOFF_KEY) || '2026-05-06') + 'T00:00:00');

    // For historical month selection, use raw RMS Posting Date without effectiveDate manipulation
    const isHistoricalMonth = (timeRange === 'specificMonth') && !!startDateStr;

    // Get current calendar month and year to check against
    const rightNow = new Date();
    const currentMonth = rightNow.getMonth();
    const currentYear = rightNow.getFullYear();

    const processedRows = allData.map(row => {
        const rawName = row['Client Name'];
        if (!rawName) return null;
        const clientName = rawName.trim();

        const isExtra = extraSet.has(clientName.toLowerCase());

        if (specificClient !== 'all' && clientName.toLowerCase() !== specificClient.toLowerCase()) {
            return null;
        }

        let info = onboardingInfo[clientName];
        if (!info) {
            const matchKey = Object.keys(onboardingInfo).find(k => k.toLowerCase() === clientName.toLowerCase());
            if (matchKey) info = onboardingInfo[matchKey];
        }

        if (ALWAYS_EXCLUDED_CLIENTS.has(clientName.toLowerCase()) && !isExtra) return null;
        if (!isExtra && (!info || info.status !== 'Client')) {
            if (clientName !== 'Premium Convenience') return null;
        }

        const dateFiledStr = row['Date Filed'];
        if (!dateFiledStr) return null;
        
        const startStr = info ? (info.pilotEndDate || info.startDate) : null;
        if (startStr && startStr.trim() !== '') {
            const fileDate = new Date(dateFiledStr); fileDate.setHours(0,0,0,0);
            const contractStart = new Date(startStr); contractStart.setHours(0,0,0,0);
            if (fileDate < contractStart) return null;
        }

        const approvalStr = row['RMS Posting Date'];
        const caseStatus = row['Reimbursement Status'];

        if (!approvalStr || caseStatus !== 'Approved') return null; 

        const caseId = String(row['Case ID']);
        let effectiveDate = new Date(approvalStr);

        // Pre-May-6 Vantage cases are hidden by default — only visible when explicitly toggled (isExtra)
        if (clientName.toLowerCase() === 'vantage inc' && !isExtra && effectiveDate < vCutoff) {
            return null;
        }

        // Vantage free period: cases posted before May 6 2026 are forever unbillable (free service). Keep actual date.
        const isVantageFreePeriod = clientName.toLowerCase() === 'vantage inc' && effectiveDate < vCutoff;

        // For historical month selection: use raw RMS Posting Date (no manipulation)
        // For current-period views: redirect unbilled past-month cases to today so they appear in current period
        // Exception: Vantage free-period cases stay at their actual date (forever unbillable, not a billing backlog)
        if (!isHistoricalMonth && !billedIds.has(caseId) && !isVantageFreePeriod) {
            if (effectiveDate.getMonth() !== currentMonth || effectiveDate.getFullYear() !== currentYear) {
                effectiveDate = new Date(); // Move old backlog items to today
            }
        }

        const amountStr = String(row['Reimbursement Amount (total)']).replace(/[^0-9.-]+/g,"");
        const amount = parseFloat(amountStr) || 0;

        let rate = 0.22;
        if (info && typeof info.rate === 'number') rate = info.rate;

        const fee = isVantageFreePeriod ? 0 : amount * rate;

        return {
            date: effectiveDate,
            amount: amount,
            fee: fee,
            id: caseId,
            type: row['Claim Type'] || 'Other',
            isVantageFree: isVantageFreePeriod
        };
    }).filter(item => item !== null);

    const monthlyHistoryMap = {};
    processedRows.forEach(item => {
        const key = item.date.getFullYear() + '-' + String(item.date.getMonth() + 1).padStart(2, '0');
        const monthLabel = item.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        if (!monthlyHistoryMap[key]) {
            monthlyHistoryMap[key] = { label: monthLabel, sort: key, recovered: 0, fee: 0, approvedCount: 0, declinedCount: 0 };
        }
        monthlyHistoryMap[key].recovered += item.amount;
        monthlyHistoryMap[key].fee += item.fee;
        monthlyHistoryMap[key].approvedCount += 1;
    });

    // Also need to count declined... wait, processedRows only has Approved.
    // Let's re-scan allData for Declined count.
    allData.forEach(row => {
        const dateStr = row['Date Filed'];
        if (!dateStr) return;
        const status = row['Reimbursement Status'];
        if (status !== 'Declined') return;

        const date = new Date(dateStr);
        const key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
        if (monthlyHistoryMap[key]) {
            monthlyHistoryMap[key].declinedCount += 1;
        }
    });

    const monthlyHistory = Object.values(monthlyHistoryMap)
        .sort((a, b) => b.sort.localeCompare(a.sort));

    // Calculate growth %
    for(let i=0; i<monthlyHistory.length; i++) {
        const current = monthlyHistory[i].recovered;
        const previous = (i + 1 < monthlyHistory.length) ? monthlyHistory[i+1].recovered : 0;
        monthlyHistory[i].growth = (previous === 0) ? (current > 0 ? 100 : 0) : ((current - previous) / previous) * 100;
    }

    const now = new Date();
    now.setHours(0,0,0,0);
    let curStart, curEnd, prevStart, prevEnd;

    const getMonthRange = (y, m) => ({ 
        start: new Date(y, m, 1), 
        end: new Date(y, m + 1, 0, 23, 59, 59, 999) 
    });

    if (timeRange === 'specificMonth' && startDateStr) {
        const [y, m] = startDateStr.split('-').map(Number);
        const cur = getMonthRange(y, m - 1);
        const prev = getMonthRange(y, m - 2);
        curStart = cur.start; curEnd = cur.end;
        prevStart = prev.start; prevEnd = prev.end;
    } 
    else if (timeRange === 'thisMonth') {
        const cur = getMonthRange(now.getFullYear(), now.getMonth());
        const prev = getMonthRange(now.getFullYear(), now.getMonth() - 1);
        curStart = cur.start; curEnd = cur.end;
        prevStart = prev.start; prevEnd = prev.end;
    } 
    else if (timeRange === 'lastMonth') {
        const cur = getMonthRange(now.getFullYear(), now.getMonth() - 1);
        const prev = getMonthRange(now.getFullYear(), now.getMonth() - 2);
        curStart = cur.start; curEnd = cur.end;
        prevStart = prev.start; prevEnd = prev.end;
    }
    else if (timeRange === 'lifetime') {
        curStart = new Date(1990, 0, 1); curEnd = new Date(2100, 0, 1);
        prevStart = new Date(1900, 0, 1); prevEnd = new Date(1900, 0, 1);
    }
    else if (timeRange === 'last30Days' || timeRange === '30') {
        curEnd = new Date(); curEnd.setHours(23,59,59,999);
        curStart = new Date(); curStart.setDate(now.getDate() - 30); curStart.setHours(0,0,0,0);
        const dur = curEnd - curStart;
        prevEnd = new Date(curStart.getTime() - 1);
        prevStart = new Date(prevEnd.getTime() - dur);
    }
    else if (timeRange === 'last90Days' || timeRange === '90') {
        curEnd = new Date(); curEnd.setHours(23,59,59,999);
        curStart = new Date(); curStart.setDate(now.getDate() - 90); curStart.setHours(0,0,0,0);
        const dur = curEnd - curStart;
        prevEnd = new Date(curStart.getTime() - 1);
        prevStart = new Date(prevEnd.getTime() - dur);
    }
    else {
        let days = parseInt(timeRange) || 90;
        if (timeRange === 'custom' && startDateStr && endDateStr) {
            curStart = new Date(startDateStr); curStart.setHours(0,0,0,0);
            curEnd = new Date(endDateStr); curEnd.setHours(23,59,59,999);
            days = Math.ceil((curEnd - curStart) / (1000 * 60 * 60 * 24));
        } else {
            curEnd = new Date(); curEnd.setHours(23,59,59,999);
            curStart = new Date(); curStart.setDate(now.getDate() - days); curStart.setHours(0,0,0,0);
        }
        const dur = curEnd - curStart;
        prevEnd = new Date(curStart.getTime() - 1);
        prevStart = new Date(prevEnd.getTime() - dur);
    }

    const filterByDate = (items, start, end) => items.filter(i => i.date >= start && i.date <= end);
    const currentItems = filterByDate(processedRows, curStart, curEnd);
    const previousItems = filterByDate(processedRows, prevStart, prevEnd);

    const calcMetrics = (items) => {
        let total = 0, feeTotal = 0;
        const uniqueIds = new Set();
        items.forEach(i => {
            uniqueIds.add(i.id);
            total += i.amount;
            feeTotal += i.fee;
        });
        const count = uniqueIds.size;
        return { total, fee: feeTotal, cases: count };
    };

    const curM = calcMetrics(currentItems);
    const prevM = calcMetrics(previousItems);

    
    // Vantage free-period total in current period
    let vantageFreePeriodAmount = 0;
    currentItems.forEach(i => { if (i.isVantageFree) vantageFreePeriodAmount += i.amount; });

    const catMap = {};
    currentItems.forEach(i => {
        catMap[i.type] = (catMap[i.type] || 0) + i.amount;
    });

    const calcTrend = (c, p) => (p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100);

    const trends = {
        totalReimbursed: calcTrend(curM.total, prevM.total),
        totalFees: calcTrend(curM.fee, prevM.fee),
        approvedCases: calcTrend(curM.cases, prevM.cases),
        approvalRate: 0 
    };

    const daySpan = Math.ceil((curEnd - curStart) / (1000 * 60 * 60 * 24)) || 1;
    const labels = [];
    const currentPoints = new Array(daySpan).fill(0);
    const previousPoints = new Array(daySpan).fill(0);

    for(let i=0; i<daySpan; i++) {
        const d = new Date(curStart);
        d.setDate(d.getDate() + i);
        labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }

    const fillChart = (items, targetArr, startRef) => {
        items.forEach(i => {
            const diff = Math.floor((i.date - startRef) / (1000 * 60 * 60 * 24));
            if(diff >= 0 && diff < daySpan) targetArr[diff] += i.amount;
        });
    };

    fillChart(currentItems, currentPoints, curStart);
    fillChart(previousItems, previousPoints, prevStart);

    

    // --- MONTH COMPARISON CHART: current vs previous calendar month by RMS Posting Date ---
    // Always uses the two calendar months from the selected range, regardless of effectiveDate manipulation.
    // Current line = unbilled cases approved in curStart's month, by day-of-month.
    // Previous line = all cases approved in prevStart's month, by day-of-month.
    const curChartMonth = curStart.getMonth();
    const curChartYear = curStart.getFullYear();
    const prevChartMonth = prevStart.getMonth();
    const prevChartYear = prevStart.getFullYear();
    const daysInCurMonth = new Date(curChartYear, curChartMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(prevChartYear, prevChartMonth + 1, 0).getDate();
    const maxChartDays = Math.max(daysInCurMonth, daysInPrevMonth);
    const chartLabels = Array.from({ length: maxChartDays }, (_, i) => String(i + 1));
    const chartCurrent = new Array(maxChartDays).fill(0);
    const chartPrevious = new Array(maxChartDays).fill(0);

    // Build up to 4 additional prior months (months -2 through -5 relative to current)
    const extraPrevMonths = [];
    for (let offset = 2; offset <= 5; offset++) {
        const d = new Date(curChartYear, curChartMonth - offset, 1);
        const m = d.getMonth();
        const y = d.getFullYear();
        const days = new Date(y, m + 1, 0).getDate();
        extraPrevMonths.push({
            month: m, year: y,
            label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
            data: new Array(Math.max(days, maxChartDays)).fill(0)
        });
    }

    allData.forEach(row => {
        const rawName = row['Client Name'];
        if (!rawName) return;
        const clientName = rawName.trim();
        let info = onboardingInfo[clientName];
        if (!info) {
            const mk = Object.keys(onboardingInfo).find(k => k.toLowerCase() === clientName.toLowerCase());
            if (mk) info = onboardingInfo[mk];
        }
        const isExtraChart = extraSet.has(clientName.toLowerCase());
        if (ALWAYS_EXCLUDED_CLIENTS.has(clientName.toLowerCase()) && !isExtraChart) return;
        if (!isExtraChart && (!info || info.status !== 'Client') && clientName !== 'Premium Convenience') return;
        if (row['Reimbursement Status'] !== 'Approved') return;
        const approvalStr = row['RMS Posting Date'];
        if (!approvalStr) return;
        const approvalDate = new Date(approvalStr);
        if (isNaN(approvalDate)) return;
        const aMonth = approvalDate.getMonth();
        const aYear = approvalDate.getFullYear();
        const dayIdx = approvalDate.getDate() - 1;
        const caseId = String(row['Case ID']);
        const amount = parseFloat(String(row['Reimbursement Amount (total)']).replace(/[^0-9.-]+/g, '')) || 0;
        const rate = (info && typeof info.rate === 'number') ? info.rate : 0.22;
        const rawFee = amount * rate;
        const isVantageChartFreePeriod = clientName.toLowerCase() === 'vantage inc' && approvalDate < vCutoff;
        const fee = isVantageChartFreePeriod ? 0 : rawFee;
        // For historical months: include all cases (billed+unbilled) in current line
        // For current month: only include unbilled (billed ones are already in history)
        const includeInCurrent = isHistoricalMonth ? true : !billedIds.has(caseId);
        if (aMonth === curChartMonth && aYear === curChartYear && includeInCurrent && dayIdx < maxChartDays) {
            chartCurrent[dayIdx] += fee;
        }
        if (aMonth === prevChartMonth && aYear === prevChartYear && dayIdx < maxChartDays) {
            chartPrevious[dayIdx] += fee;
        }
        extraPrevMonths.forEach(ep => {
            if (aMonth === ep.month && aYear === ep.year && dayIdx < ep.data.length) {
                ep.data[dayIdx] += fee;
            }
        });
    });

    const dynamicHiddenClientsSet = new Set();
    const allNames = [...new Set(allData.map(r => r['Client Name'] ? r['Client Name'].trim() : null).filter(Boolean))];
    
    allNames.forEach(name => {
        const key = name.toLowerCase();
        if (ALWAYS_EXCLUDED_CLIENTS.has(key)) {
            dynamicHiddenClientsSet.add(name);
            return;
        }
        let info = onboardingInfo[name];
        if (!info) {
            const matchKey = Object.keys(onboardingInfo).find(k => k.toLowerCase() === key);
            if (matchKey) info = onboardingInfo[matchKey];
        }
        if ((!info || info.status !== 'Client') && name !== 'Premium Convenience') {
            dynamicHiddenClientsSet.add(name);
            return;
        }
        // Vantage pre-May-6 periods: hide by default (free period, not a paying client yet)
        if (key === 'vantage inc' && curEnd < vCutoff) {
            dynamicHiddenClientsSet.add(name);
        }
    });
    const dynamicHiddenClients = [...dynamicHiddenClientsSet].sort();

    return {
        metrics: {
            totalReimbursed: curM.total,
            totalFees: curM.fee,
            approvedCases: curM.cases,
            approvalRate: 1
        },
        trends,
        dailyData: { labels, current: currentPoints, previous: previousPoints },
        chartData: { labels: chartLabels, current: chartCurrent, previous: chartPrevious, curMonthLabel: curStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), prevMonthLabel: prevStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), isHistorical: isHistoricalMonth, extraPrevMonths: extraPrevMonths.map(ep => ({ label: ep.label, data: ep.data })) },
        categoryData: Object.keys(catMap).map(k => ({ category: k, amount: catMap[k] })).sort((a, b) => b.amount - a.amount),
        monthlyHistory,
        dateRange: { start: curStart.toISOString(), end: curEnd.toISOString() },
        dynamicHiddenClients: dynamicHiddenClients,
        vantageFreePeriodAmount: vantageFreePeriodAmount
    };

  } catch (e) {
    Logger.log("Error: " + e.message);
    return { 
        metrics: { totalReimbursed: 0, totalFees: 0, approvedCases: 0, approvalRate: 0 }, 
        trends: { totalReimbursed: 0 }, 
        dailyData: { labels: [], current: [] }, 
        categoryData: [],
        monthlyHistory: []
    };
  }
}

// --- BILLING LOGIC (Source of Truth) ---
function getBillingSummary(allData, clientOnboardingInfo, extraClients) {
  const extraSet = new Set((extraClients || []).map(c => c.trim().toLowerCase()));
  const billedCaseIdSet = new Set(getBilledIdsFromServer().map(String));
  const vCutoff = new Date((PropertiesService.getScriptProperties().getProperty(VANTAGE_CUTOFF_KEY) || '2026-05-06') + 'T00:00:00');
  const clientSummary = {};

  // Get current month and year to filter reimbursements
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  // Billable through the end of the current month — only future-month postings are held (Pending)
  const startOfNextMonth = new Date(currentYear, currentMonth + 1, 1);

    allData.forEach(item => {
    const rawClient = item['Client Name'] ? item['Client Name'].trim() : null;
    if (!rawClient) return;

    const clientKey = rawClient.toLowerCase();
    const isExtra = extraSet.has(clientKey);

    // Restore hardcoded exclusions unless explicitly toggled on
    if (ALWAYS_EXCLUDED_CLIENTS.has(clientKey) && !isExtra) return;

    const info = clientOnboardingInfo[rawClient] ||
                 clientOnboardingInfo[Object.keys(clientOnboardingInfo).find(k => k.toLowerCase() === clientKey)] || {};
    // Skip non-Client status entries unless explicitly toggled on
    const isRegularClient = info.status === 'Client' || rawClient === 'Premium Convenience';
    if (!isRegularClient && !isExtra) return;

    const client = rawClient;

    if (!clientSummary[client]) {
      clientSummary[client] = {
        isBillableClient: isRegularClient || isExtra,
        casesFiled: 0,
        readyToBillCases: 0,
        totalReimbursed: 0,
        readyToBillFee: 0,
        previouslyBilledFee: 0,
        pendingCases: 0,
        pendingFee: 0,
        pendingReimbursed: 0,
        rate: info.rate || DEFAULT_RATES['DEFAULT'],
        hasPreviousMonthBill: false
      };
    }
    clientSummary[client].casesFiled++;

    const caseFiledDate = new Date(item['Date Filed']);
    
    let isBillableCase = false;
    const isExtraClient = extraSet.has(client.toLowerCase());
    if ((info && info.status === 'Client') || client === 'Premium Convenience' || isExtraClient) {
        if (client === 'Premium Convenience' || isExtraClient) {
            isBillableCase = true;
        } else {
            const billableStartDateStr = info.pilotEndDate || info.startDate;
            if (!billableStartDateStr) {
                isBillableCase = true;
            } else {
                const billableStartDate = new Date(billableStartDateStr);
                if (caseFiledDate >= billableStartDate) {
                    isBillableCase = true;
                }
            }
        }
    }
    
    const caseId = String(item['Case ID']);
    const status = item['Reimbursement Status'];
    const amountStr = String(item['Reimbursement Amount (total)']).replace(/[^0-9.-]+/g, "");
    const amount = parseFloat(amountStr) || 0;

    if (status === 'Approved' && amount > 0) {
      const fee = amount * clientSummary[client].rate;
      const postingDateStr = item['RMS Posting Date'];
      const postingDate = postingDateStr ? new Date(postingDateStr) : null;

      // Pre-May-6 Vantage cases: skip unless explicitly toggled
      if (client.toLowerCase() === 'vantage inc' && !isExtraClient && postingDate && postingDate < vCutoff) return;

      // Vantage free period: cases posted before May 6 2026 are forever unbillable (free service).
      const isVantageFreePeriod = client.toLowerCase() === 'vantage inc' && postingDate && postingDate < vCutoff;

      if (billedCaseIdSet.has(caseId) || caseId === '13011996' || caseId === '14969195') {
          if (isBillableCase) clientSummary[client].previouslyBilledFee += fee;
      } else if (isVantageFreePeriod) {
          // Informational only: show reimbursed amount, $0 fee, not billable
          clientSummary[client].totalReimbursed += amount;
          if (postingDate && (postingDate.getMonth() !== currentMonth || postingDate.getFullYear() !== currentYear)) {
              clientSummary[client].hasPreviousMonthBill = true;
          }
      } else if (isBillableCase) {
          // Require an RMS Posting Date — a case with no posting date isn't reimbursed yet, so never bill it
          if (!postingDate || isNaN(postingDate)) return;
          // Future-month postings are Pending — visible, but held for next month's run
          if (postingDate >= startOfNextMonth) {
              clientSummary[client].pendingCases++;
              clientSummary[client].pendingFee += fee;
              clientSummary[client].pendingReimbursed += amount;
              return;
          }
          clientSummary[client].readyToBillCases++;
          clientSummary[client].readyToBillFee += fee;
          clientSummary[client].totalReimbursed += amount;
          if (postingDate && (postingDate.getMonth() !== currentMonth || postingDate.getFullYear() !== currentYear)) {
              clientSummary[client].hasPreviousMonthBill = true;
          }
      }
    }
  });

  return Object.keys(clientSummary).map(clientName => ({
    clientName: clientName,
    ...clientSummary[clientName]
  }));
}

// --- HELPERS ---
function findClientByCaseId(caseId) {
  if (!caseId) return null;
  const compactData = fetchAndStoreSheetData();
  const allData = rehydrateData(compactData);
  const match = allData.find(row => String(row['Case ID']).trim() === String(caseId).trim());
  return match ? (match['Client Name'] ? match['Client Name'].trim() : null) : null;
}

function getClientDetails(clientName) {
  if (!clientName) { throw new Error("Client name is required."); }
  const compactData = fetchAndStoreSheetData();
  const searchName = clientName.trim().toLowerCase();
  const clientNameIdx = compactData.headers.indexOf('Client Name');
  // Filter compact rows BEFORE rehydrating — avoids building objects for every row
  const filteredCompact = {
    headers: compactData.headers,
    rows: compactData.rows.filter(row => row[clientNameIdx] && String(row[clientNameIdx]).trim().toLowerCase() === searchName)
  };
  const clientCases = rehydrateData(filteredCompact);
  return { cases: clientCases, billedIds: getBilledIdsFromServer() };
}

function getBillingInsights(billingSummary) {
    if (!billingSummary || billingSummary.length === 0) return { highestClient: null, mostCasesClient: null, clientCount: 0, clientsWithPreviousBills: 0 };

    // Overview insight counts Ready-to-Bill + Pending together (everything not yet billed)
    const amt = c => (c.readyToBillFee || 0) + (c.pendingFee || 0);
    const cnt = c => (c.readyToBillCases || 0) + (c.pendingCases || 0);

    const clientsReadyToBill = billingSummary.filter(c => amt(c) > 0);
    const clientsWithPreviousBills = billingSummary.filter(c => c.hasPreviousMonthBill).length;

    const highestClient = clientsReadyToBill.length > 0
        ? clientsReadyToBill.reduce((max, client) => amt(max) > amt(client) ? max : client)
        : null;

    const mostCasesClient = billingSummary.length > 0
        ? billingSummary.reduce((max, client) => cnt(max) > cnt(client) ? max : client)
        : null;

    return {
        highestClient: highestClient ? { name: highestClient.clientName, amount: amt(highestClient) } : null,
        mostCasesClient: (mostCasesClient && cnt(mostCasesClient) > 0) ? { name: mostCasesClient.clientName, count: cnt(mostCasesClient) } : null,
        clientCount: clientsReadyToBill.length,
        clientsWithPreviousBills: clientsWithPreviousBills
    };
}

// --- SHEET DATA HANDLING ---
function fetchAndStoreSheetData() {
  const cache = CacheService.getScriptCache();
  const EXPIRATION_SECONDS = 300; // 5 min — cases update throughout the day
  const CHUNK_SIZE = 90000; // 90KB per chunk (CacheService limit is 100KB)

  const metaStr = cache.get(MAIN_DATA_STORAGE_KEY + '_meta');
  if (metaStr) {
    try {
      const meta = JSON.parse(metaStr);
      const ageMinutes = (new Date().getTime() - new Date(meta.timestamp).getTime()) / 60000;
      if (ageMinutes < 360) {
        let fullJson = '';
        for (let i = 0; i < meta.chunks; i++) {
          const chunk = cache.get(MAIN_DATA_STORAGE_KEY + '_chunk_' + i);
          if (!chunk) { fullJson = null; break; }
          fullJson += chunk;
        }
        if (fullJson) return JSON.parse(fullJson);
      }
    } catch(e) {}
  }

  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found.`);
    const allValues = sheet.getDataRange().getValues();
    if (allValues.length < 2) return { headers: [], rows: [], timestamp: new Date().toISOString() };
    const headers = allValues[0].map(h => h.trim());
    const dataRows = allValues.slice(1);
    const clientNameIndex = headers.indexOf('Client Name');
    const caseIdIndex = headers.indexOf('Case ID');
    if (clientNameIndex === -1 || caseIdIndex === -1) throw new Error('Required columns missing.');
    const validRows = dataRows.filter(row => row[clientNameIndex] && row[caseIdIndex]);
    const dataToStore = { headers: headers, rows: validRows, timestamp: new Date().toISOString() };

    const fullJson = JSON.stringify(dataToStore);
    const numChunks = Math.ceil(fullJson.length / CHUNK_SIZE);
    const cacheEntries = {};
    for (let i = 0; i < numChunks; i++) {
      cacheEntries[MAIN_DATA_STORAGE_KEY + '_chunk_' + i] = fullJson.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    }
    cacheEntries[MAIN_DATA_STORAGE_KEY + '_meta'] = JSON.stringify({ chunks: numChunks, timestamp: dataToStore.timestamp });
    cache.putAll(cacheEntries, EXPIRATION_SECONDS);
    // Fresh sheet read — bump version so computed caches (analytics, fast payload) regenerate
    const cv = parseInt(cache.get('COMPUTED_V') || '0') + 1;
    cache.put('COMPUTED_V', String(cv), 86400);

    return dataToStore;
  } catch (e) {
    Logger.log('Error in fetchAndStoreSheetData: ' + e.toString());
    throw new Error('Could not process Google Sheet: ' + e.message);
  }
}

function rehydrateData(compactData) {
    if (!compactData || !compactData.headers || !compactData.rows) { return []; }
    return compactData.rows.map(row => { const record = {}; compactData.headers.forEach((header, index) => { record[header] = row[index] instanceof Date ? row[index].toISOString() : row[index]; }); return record; });
}

function getClientOnboardingInfo() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('ONBOARDING_INFO');
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  try {
    const sheet = SpreadsheetApp.openById(ONBOARDING_SPREADSHEET_ID).getSheetByName(ONBOARDING_SHEET_NAME);
    if (!sheet) return {};
    const values = sheet.getRange('A2:Q' + sheet.getLastRow()).getValues();
    const infoMap = {};
    values.forEach(row => {
      const clientName = row[3];
      if (clientName) {
        let numericRate; const rateStr = row[16]; const parsedVal = parseFloat(String(rateStr).replace('%', '').trim());
        if (isNaN(parsedVal)) { numericRate = DEFAULT_RATES['DEFAULT']; } else if (parsedVal >= 1) { numericRate = parsedVal / 100; } else { numericRate = parsedVal; }
        infoMap[clientName.trim()] = { status: row[1] ? String(row[1]).trim() : 'N/A', rate: numericRate, startDate: row[11] instanceof Date ? row[11].toISOString() : null, pilotEndDate: row[12] instanceof Date ? row[12].toISOString() : null };
      }
    });
    cache.put('ONBOARDING_INFO', JSON.stringify(infoMap), 900);
    return infoMap;
  } catch (e) { return {}; }
}

function getBillingSummaryInfo() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('BILLING_INFO');
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  try {
    const sheet = SpreadsheetApp.openById(BILLING_SUMMARY_SPREADSHEET_ID).getSheetByName(BILLING_SUMMARY_SHEET_NAME);
    if (!sheet) return {};
    const values = sheet.getRange('B2:G' + sheet.getLastRow()).getValues();
    const infoMap = {};
    values.forEach(row => {
      const clientName = row[0];
      if (clientName && row[3]) {
        infoMap[clientName.trim()] = { invoiceDate: row[3] instanceof Date ? row[3].toISOString() : null, paymentTerms: row[4], address: row[5] };
      }
    });
    cache.put('BILLING_INFO', JSON.stringify(infoMap), 900);
    return infoMap;
  } catch (e) { return {}; }
}

function getDefaultDashboardSettings() {
    const properties = PropertiesService.getScriptProperties();
    return { 
        view: 'billable', 
        time: properties.getProperty(DEFAULT_DASHBOARD_TIME_KEY) || 'thisMonth',
        startupTab: properties.getProperty('DEFAULT_STARTUP_TAB') || 'dashboard',
        billingTab: properties.getProperty('DEFAULT_BILLING_TAB') || 'ready',
        feeRate: properties.getProperty('DEFAULT_FEE_RATE') || '0',
        theme: properties.getProperty('DEFAULT_THEME') || 'light'
    };
}

function saveDefaultDashboardSettings(settings) {
    const properties = PropertiesService.getScriptProperties();
    if (settings.time) { properties.setProperty(DEFAULT_DASHBOARD_TIME_KEY, settings.time); }
    if (settings.startupTab) { properties.setProperty('DEFAULT_STARTUP_TAB', settings.startupTab); }
    if (settings.billingTab) { properties.setProperty('DEFAULT_BILLING_TAB', settings.billingTab); }
    if (settings.feeRate) { properties.setProperty('DEFAULT_FEE_RATE', settings.feeRate); }
    if (settings.theme) { properties.setProperty('DEFAULT_THEME', settings.theme); }
    
    // Invalidate Fast Payload cache so changes appear on refresh
    const cache = CacheService.getScriptCache();
    const cv = parseInt(cache.get('COMPUTED_V') || '0') + 1;
    cache.put('COMPUTED_V', String(cv), 86400);
    
    return getDefaultDashboardSettings();
}

function setVantageCutoffDate(dateStr) {
  PropertiesService.getScriptProperties().setProperty(VANTAGE_CUTOFF_KEY, dateStr);
  const cache = CacheService.getScriptCache();
  cache.put('COMPUTED_V', String(parseInt(cache.get('COMPUTED_V') || '0') + 1), 86400);
  return dateStr;
}

// --- LOGGING & INVOICING ---
function getInvoiceLogSheet() {
  const ss = SpreadsheetApp.openById(INVOICE_LOG_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(INVOICE_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(INVOICE_LOG_SHEET_NAME);
    sheet.appendRow(['Invoice Number', 'Client Name', 'Date Billed', 'Amount Billed', 'Total Recovered', 'Case IDs Billed', 'Case Snapshot', 'PDF URL']);
    sheet.hideSheet();
  }
  return sheet;
}

// Drive folder that holds archived invoice PDFs
function _getInvoiceFolder() {
  const name = 'WFS Invoice Archive';
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

// Save the client-generated PDF (base64) to Drive, return a shareable URL. Returns '' on failure/no data.
function _saveInvoicePdfToDrive(invoiceNumber, clientName, pdfBase64) {
  try {
    if (!pdfBase64) return '';
    const bytes = Utilities.base64Decode(pdfBase64);
    const safeClient = String(clientName || 'Client').replace(/[\\/:*?"<>|]/g, '_');
    const blob = Utilities.newBlob(bytes, 'application/pdf', `Invoice_${invoiceNumber}_${safeClient}.pdf`);
    const file = _getInvoiceFolder().createFile(blob);
    try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); }
    catch(e) { try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e2) {} }
    return file.getUrl();
  } catch(e) {
    Logger.log('PDF archive failed: ' + e.message);
    return '';
  }
}

function getNextInvoiceNumber() {
  const sheet = getInvoiceLogSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { return 'INV-1001'; }
  
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let maxNum = 1000;
  
  values.forEach(row => {
    if (row[0] && typeof row[0] === 'string') {
      const parts = row[0].split('-');
      if (parts.length > 1) {
        const num = parseInt(parts[1]);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  });
  
  return `INV-${maxNum + 1}`;
}

function peekNextInvoiceNumber() { return getNextInvoiceNumber(); }

function prepareInvoiceGeneration(clientName) {
  return {
    invoiceNumber: peekNextInvoiceNumber(),
    clientDetails: getClientDetails(clientName)
  };
}

function finalizeBillingForClient(invoiceNumber, clientName, caseIds, totalFee, totalReimbursed, billedDateStr, snapshot, pdfBase64) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getInvoiceLogSheet();
    const billedDate = billedDateStr ? new Date(billedDateStr) : new Date();
    // Col 7 = frozen case snapshot (hard copy); Col 8 = archived PDF URL on Drive
    const pdfUrl = _saveInvoicePdfToDrive(invoiceNumber, clientName, pdfBase64);
    sheet.appendRow([invoiceNumber, clientName, billedDate, totalFee, totalReimbursed, JSON.stringify(caseIds), JSON.stringify(snapshot || []), pdfUrl]);
    _invalidateInvoiceCache();
    return { success: true, pdfUrl: pdfUrl };
  } catch(e) { throw new Error(`Error: ${e.message}`); } finally { lock.releaseLock(); }
}

function saveInvoiceFromBuilder(invoiceNumber, clientName, dateBilled, caseIds, totalFee, totalReimbursed) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getInvoiceLogSheet();
    const data = sheet.getDataRange().getValues();
    let rowToUpdate = -1;
    
    // Check if invoice exists
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === invoiceNumber) {
        rowToUpdate = i + 1;
        break;
      }
    }
    
    // Use ISO string for date representation
    const validDate = dateBilled ? new Date(dateBilled) : new Date();
    
    if (rowToUpdate > -1) {
      // Update existing
      sheet.getRange(rowToUpdate, 2).setValue(clientName);
      sheet.getRange(rowToUpdate, 3).setValue(validDate);
      sheet.getRange(rowToUpdate, 4).setValue(totalFee);
      sheet.getRange(rowToUpdate, 5).setValue(totalReimbursed);
      sheet.getRange(rowToUpdate, 6).setValue(JSON.stringify(caseIds));
    } else {
      // Insert new
      sheet.appendRow([invoiceNumber, clientName, validDate, totalFee, totalReimbursed, JSON.stringify(caseIds)]);
    }

    _invalidateInvoiceCache();
    return true;
  } catch(e) { throw new Error(`Error: ${e.message}`); } finally { lock.releaseLock(); }
}

function unbillInvoice(invoiceNumber) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getInvoiceLogSheet();
    const data = sheet.getDataRange().getValues();
    let rowToDelete = -1;
    let caseIdsToUnbill = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === invoiceNumber) {
        rowToDelete = i + 1;
        try { caseIdsToUnbill = JSON.parse(data[i][5]); } catch(e) {}
        break;
      }
    }
    if (rowToDelete > -1) {
      sheet.deleteRow(rowToDelete);
      _invalidateInvoiceCache();
      return true;
    }
    return false;
  } catch(e) { throw new Error(`Error: ${e.message}`); } finally { lock.releaseLock(); }
}

// Surgically remove specific Case IDs from ALL invoice rows. Returns a report of what changed.
// If a row's case list becomes empty, the whole invoice row is deleted.
function unbillCaseIds(caseIds) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const targets = new Set((caseIds || []).map(String));
    const sheet = getInvoiceLogSheet();
    const data = sheet.getDataRange().getValues();
    const report = [];
    const rowsToDelete = [];
    for (let i = 1; i < data.length; i++) {
      let ids;
      try { ids = JSON.parse(data[i][5]); } catch(e) { continue; }
      if (!Array.isArray(ids)) continue;
      const removed = ids.filter(id => targets.has(String(id)));
      if (removed.length === 0) continue;
      const kept = ids.filter(id => !targets.has(String(id)));
      report.push({
        invoiceNumber: data[i][0],
        clientName: data[i][1],
        billedDate: data[i][2] instanceof Date ? data[i][2].toISOString() : String(data[i][2]),
        fee: data[i][3],
        removedCaseIds: removed.map(String),
        remainingCount: kept.length,
        action: kept.length === 0 ? 'ROW DELETED' : 'IDs removed (review fee total)'
      });
      if (kept.length === 0) rowsToDelete.push(i + 1);
      else sheet.getRange(i + 1, 6).setValue(JSON.stringify(kept));
    }
    rowsToDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r)); // bottom-up keeps indices valid
    _invalidateInvoiceCache();
    return { success: true, affected: report };
  } catch(e) { throw new Error(`Error unbilling: ${e.message}`); } finally { lock.releaseLock(); }
}

// One-time cleanup runner for the 3 wrongly-billed cases. Run from the Apps Script editor.
function unbillWronglyBilledCases() {
  const result = unbillCaseIds(['14758541', '14969195', '14821054', '14674867']);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// Health check — surfaces billing desyncs. Run from the editor, read the Logs.
// Flags: cases billed but no longer Approved, cases whose RMS Posting Date is AFTER the
// invoice's billed date (the "billed before it was posted" anomaly), orphan IDs not in the
// source sheet, and Case IDs billed on more than one invoice.
function auditBillingData() {
  const allData = rehydrateData(fetchAndStoreSheetData());
  const caseMap = {};
  allData.forEach(r => {
    const id = String(r['Case ID']);
    if (!caseMap[id]) caseMap[id] = {
      status: r['Reimbursement Status'],
      posting: r['RMS Posting Date'] ? new Date(r['RMS Posting Date']) : null,
      client: r['Client Name'] ? r['Client Name'].trim() : ''
    };
  });

  const history = getBillingHistory();
  const issues = { billedButNotApproved: [], postedAfterBilledDate: [], orphanNotInSheet: [], duplicateAcrossInvoices: [] };
  const seen = {};

  history.forEach(inv => {
    const billedDate = new Date(inv.billedDate);
    (inv.caseIds || []).forEach(rawId => {
      const id = String(rawId);
      if (seen[id]) issues.duplicateAcrossInvoices.push({ caseId: id, invoices: [seen[id], inv.invoiceNumber] });
      else seen[id] = inv.invoiceNumber;

      const c = caseMap[id];
      if (!c) { issues.orphanNotInSheet.push({ caseId: id, invoice: inv.invoiceNumber }); return; }
      if (c.status !== 'Approved') issues.billedButNotApproved.push({ caseId: id, invoice: inv.invoiceNumber, status: c.status, client: c.client });
      if (c.posting && c.posting > billedDate) issues.postedAfterBilledDate.push({
        caseId: id, invoice: inv.invoiceNumber, client: c.client,
        billedDate: billedDate.toISOString().slice(0, 10),
        rmsPostingDate: c.posting.toISOString().slice(0, 10)
      });
    });
  });

  const summary = {
    totalBilledCases: Object.keys(seen).length,
    billedButNotApproved: issues.billedButNotApproved.length,
    postedAfterBilledDate: issues.postedAfterBilledDate.length,
    orphanNotInSheet: issues.orphanNotInSheet.length,
    duplicateAcrossInvoices: issues.duplicateAcrossInvoices.length
  };
  Logger.log('SUMMARY: ' + JSON.stringify(summary, null, 2));
  Logger.log('DETAIL: ' + JSON.stringify(issues, null, 2));
  return { summary, issues };
}

function getBillingHistory() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('BILLING_HISTORY');
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }

  const sheet = getInvoiceLogSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const history = [];
  for (let i = 1; i < data.length; i++) {
    try {
      let caseSnapshot = [];
      if (data[i][6]) { try { caseSnapshot = JSON.parse(data[i][6]); } catch(e) {} }
      history.push({ invoiceNumber: data[i][0], clientName: data[i][1], billedDate: new Date(data[i][2]).toISOString(), billedFee: data[i][3], totalReimbursed: data[i][4], caseIds: JSON.parse(data[i][5]), caseSnapshot: caseSnapshot, pdfUrl: data[i][7] || '' });
    } catch(e) {}
  }
  const sorted = history.sort((a, b) => {
    const numA = parseInt(a.invoiceNumber.split('-')[1]) || 0;
    const numB = parseInt(b.invoiceNumber.split('-')[1]) || 0;
    return numB - numA;
  });
  try { cache.put('BILLING_HISTORY', JSON.stringify(sorted), 300); } catch(e) {}
  return sorted;
}

let _billedIdsCache = null;
function getBilledIdsFromServer() {
  if (_billedIdsCache !== null) return _billedIdsCache;
  const cache = CacheService.getScriptCache();
  const cached = cache.get('BILLED_IDS');
  if (cached) { try { _billedIdsCache = JSON.parse(cached); return _billedIdsCache; } catch(e) {} }
  try {
    const sheet = getInvoiceLogSheet();
    const data = sheet.getDataRange().getValues();
    const idSet = new Set();
    for (let i = 1; i < data.length; i++) {
      try {
        const ids = JSON.parse(data[i][5]);
        if (Array.isArray(ids)) ids.forEach(id => idSet.add(String(id)));
      } catch(e) {}
    }
    _billedIdsCache = [...idSet];
    try { cache.put('BILLED_IDS', JSON.stringify(_billedIdsCache), 300); } catch(e) {}
  } catch(e) {
    _billedIdsCache = [];
  }
  return _billedIdsCache;
}

function _invalidateInvoiceCache() {
  _billedIdsCache = null;
  const cache = CacheService.getScriptCache();
  cache.remove('BILLED_IDS');
  cache.remove('BILLING_HISTORY');
  // Bump computed version — invalidates all analytics + fast payload caches
  const v = parseInt(cache.get('COMPUTED_V') || '0') + 1;
  cache.put('COMPUTED_V', String(v), 86400);
}

function forceDataSync() {
  const cache = CacheService.getScriptCache();
  // Clear sheet data chunks
  try {
    const metaStr = cache.get(MAIN_DATA_STORAGE_KEY + '_meta');
    if (metaStr) {
      const meta = JSON.parse(metaStr);
      const keys = [MAIN_DATA_STORAGE_KEY + '_meta'];
      for (let i = 0; i < meta.chunks; i++) keys.push(MAIN_DATA_STORAGE_KEY + '_chunk_' + i);
      cache.removeAll(keys);
    }
  } catch(e) {}
  // Clear all other caches
  cache.removeAll(['BILLED_IDS', 'BILLING_HISTORY', 'ONBOARDING_INFO', 'BILLING_INFO']);
  _billedIdsCache = null;
  // Bump version — orphans all FP + DA caches
  const v = parseInt(cache.get('COMPUTED_V') || '0') + 1;
  cache.put('COMPUTED_V', String(v), 86400);
  // Return fresh full payload
  return getInitialPayloadFast();
}

function getLogoImages() {
  const LIGHT_LOGO_ID = '1Zp9zVuUuKapi5KqQk9f_oTw9nPKYw97T';
  const DARK_LOGO_ID = '1DZS7kgORVuh9jM0ZswotWsGdlp7zLW0H';
  try {
    const lightFile = DriveApp.getFileById(LIGHT_LOGO_ID);
    const darkFile = DriveApp.getFileById(DARK_LOGO_ID);
    return {
      lightLogo: `data:image/png;base64,${Utilities.base64Encode(lightFile.getBlob().getBytes())}`,
      darkLogo: `data:image/png;base64,${Utilities.base64Encode(darkFile.getBlob().getBytes())}`
    };
  } catch (e) { return { lightLogo: '', darkLogo: '' }; }
}

function fixSavingsMartInvoices() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  
  try {
    const clientName = "TheSavingsMart";
    
    // Case IDs
    const janCaseId = "13011166";
    const febCaseIds = ["13507066", "13517373", "13914612"];
    
    // Amounts
    const janRecovered = 21.68;
    const janFee = 5.42; 
    const febRecovered = 233.53; 
    const febFee = 58.38;        
    
    const sheet = SpreadsheetApp.openById(INVOICE_LOG_SPREADSHEET_ID).getSheetByName(INVOICE_LOG_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    
    // Delete the corrupted ones if they exist
    for(let i = data.length - 1; i >= 1; i--) {
      if(data[i][0] === 'INV-1051' || data[i][0] === 'INV-1024') {
        sheet.deleteRow(i + 1);
      }
    }
    
    // Create INV-1024 (Dated: 1/1/2026)
    sheet.appendRow([
      'INV-1024', 
      clientName, 
      new Date('2026-01-01T12:00:00Z'), 
      janFee, 
      janRecovered, 
      JSON.stringify([janCaseId])
    ]);
    
    // Create INV-1051 (Dated: 3/3/2026)
    sheet.appendRow([
      'INV-1051', 
      clientName, 
      new Date('2026-03-03T12:00:00Z'), 
      febFee, 
      febRecovered, 
      JSON.stringify(febCaseIds)
    ]);
    
    _invalidateInvoiceCache();

  } catch(e) {
    Logger.log("Error: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

// --- ONE-TIME CLEANUP: Run this once manually to clear bloated PropertiesService data ---
function clearBloatedProperties() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const KEEP = new Set([
    'DEFAULT_DASHBOARD_TIME_KEY',
    'DEFAULT_DASHBOARD_VIEW_KEY',
    'DEFAULT_STARTUP_TAB',
    'DEFAULT_BILLING_TAB',
    'DEFAULT_FEE_RATE',
    'SUPABASE_SERVICE_ROLE_KEY'
  ]);
  const deleted = [];
  Object.keys(all).forEach(key => {
    if (!KEEP.has(key)) {
      props.deleteProperty(key);
      deleted.push(key);
    }
  });
  const remaining = Object.keys(props.getProperties());
  Logger.log('Deleted ' + deleted.length + ' legacy keys: ' + JSON.stringify(deleted));
  Logger.log('Remaining keys: ' + JSON.stringify(remaining));
}

// --- EMAIL & AUTOMATION ---
function getInvoiceEmailTemplate() {
  const props = PropertiesService.getScriptProperties();
  const defaultTemplate = `
<html>
<body style="font-family: Arial, sans-serif; color: #333;">
  <h2>Invoice {{invoiceNumber}}</h2>
  <p><strong>Client:</strong> {{clientName}}</p>
  <p><strong>Date:</strong> {{billedDate}}</p>
  <hr/>
  <p><strong>Total Recovered:</strong> ${{totalReimbursed}}</p>
  <p><strong>Fee ({{rate}}%):</strong> ${{totalFee}}</p>
  <p><strong>Case IDs:</strong> {{caseIds}}</p>
  <hr/>
  <p>Thank you for your business.</p>
</body>
</html>
  `;
  return props.getProperty('INVOICE_EMAIL_TEMPLATE') || defaultTemplate;
}

function setInvoiceEmailTemplate(html) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('INVOICE_EMAIL_TEMPLATE', html);
  return true;
}

function sendInvoiceEmail(clientName, invoiceNumber, totalFee, totalReimbursed, caseIds, billedDate, recipientEmail) {
  const onboardingInfo = getClientOnboardingInfo();
  const info = onboardingInfo[clientName] || {};
  const rate = (info.rate || DEFAULT_RATES['DEFAULT']) * 100;

  const template = getInvoiceEmailTemplate();
  const html = template
    .replace(/{{invoiceNumber}}/g, invoiceNumber)
    .replace(/{{clientName}}/g, clientName)
    .replace(/{{billedDate}}/g, billedDate)
    .replace(/{{totalReimbursed}}/g, totalReimbursed.toFixed(2))
    .replace(/{{totalFee}}/g, totalFee.toFixed(2))
    .replace(/{{rate}}/g, rate.toFixed(0))
    .replace(/{{caseIds}}/g, Array.isArray(caseIds) ? caseIds.join(', ') : caseIds);

  GmailApp.sendEmail(recipientEmail, `Invoice ${invoiceNumber} - ${clientName}`, '', { htmlBody: html });
  return true;
}

function exportInvoicesAsCSV() {
  const history = getBillingHistory();
  if (history.length === 0) return '';

  const headers = ['Invoice Number', 'Client Name', 'Billed Date', 'Fee', 'Reimbursed', 'Case IDs'];
  const rows = [headers.map(h => `"${h}"`).join(',')];

  history.forEach(inv => {
    rows.push([
      `"${inv.invoiceNumber}"`,
      `"${inv.clientName}"`,
      `"${new Date(inv.billedDate).toLocaleDateString()}"`,
      inv.billedFee,
      inv.totalReimbursed,
      `"${Array.isArray(inv.caseIds) ? inv.caseIds.join(', ') : inv.caseIds}"`
    ].join(','));
  });

  return rows.join('\n');
}

function createInvoiceZip() {
  const history = getBillingHistory();
  if (history.length === 0) return { error: 'No invoices to export' };

  const zip = new java.util.zip.ZipOutputStream(new java.io.ByteArrayOutputStream());
  const csv = exportInvoicesAsCSV();

  const entry = new java.util.zip.ZipEntry('invoices.csv');
  zip.putNextEntry(entry);
  zip.write(csv.getBytes());
  zip.closeEntry();
  zip.close();

  return { success: true, size: zip.size };
}

function markCasesAsBilled(caseIds, invoiceNumber) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const billedIds = getBilledIdsFromServer();
    const newIds = [...new Set([...billedIds, ...caseIds.map(String)])];

    const sheet = getInvoiceLogSheet();
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === invoiceNumber) {
        sheet.getRange(i + 1, 6).setValue(JSON.stringify(caseIds));
        break;
      }
    }

    _invalidateInvoiceCache();
    return { success: true, markedCount: caseIds.length };
  } catch(e) {
    throw new Error(`Error marking cases: ${e.message}`);
  } finally {
    lock.releaseLock();
  }
}

function bulkMarkBilled(clientNames) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const compactData = fetchAndStoreSheetData();
    const allData = rehydrateData(compactData);
    const onboardingInfo = getClientOnboardingInfo();

    let totalCaseIds = [];
    const snapshot = [];
    let totalReimbursed = 0, totalFee = 0;
    const clientNameSet = new Set(clientNames.map(c => c.toLowerCase()));
    const alreadyBilled = new Set(getBilledIdsFromServer().map(String));
    const vCutoff = new Date((PropertiesService.getScriptProperties().getProperty(VANTAGE_CUTOFF_KEY) || '2026-05-06') + 'T00:00:00');
    const _now = new Date();
    const startOfNextMonth = new Date(_now.getFullYear(), _now.getMonth() + 1, 1);

    allData.forEach(row => {
      const clientName = row['Client Name'] ? row['Client Name'].trim() : null;
      if (clientName && clientNameSet.has(clientName.toLowerCase())) {
        const status = row['Reimbursement Status'];
        const amount = parseFloat(String(row['Reimbursement Amount (total)']).replace(/[^0-9.-]+/g, '')) || 0;
        if (status !== 'Approved' || amount <= 0) return;
        const caseId = String(row['Case ID']);
        if (alreadyBilled.has(caseId)) return; // never re-bill
        const postingDate = row['RMS Posting Date'] ? new Date(row['RMS Posting Date']) : null;
        // Require an RMS Posting Date — no posting date = not reimbursed yet, never bill
        if (!postingDate || isNaN(postingDate)) return;
        // Future-month postings belong to next month's run
        if (postingDate >= startOfNextMonth) return;
        // Vantage free-period: skip pre-cutoff
        if (clientName.toLowerCase() === 'vantage inc' && postingDate < vCutoff) return;
        // Resolve client rate for fee + snapshot
        let info = onboardingInfo[clientName];
        if (!info) { const k = Object.keys(onboardingInfo).find(key => key.toLowerCase() === clientName.toLowerCase()); if (k) info = onboardingInfo[k]; }
        const rate = (info && typeof info.rate === 'number') ? info.rate : DEFAULT_RATES['DEFAULT'];
        totalCaseIds.push(caseId);
        totalReimbursed += amount;
        totalFee += amount * rate;
        snapshot.push({
          'Case ID': caseId,
          'Claim Type': row['Claim Type'] || '',
          'RMS Posting Date': row['RMS Posting Date'] || '',
          'Reimbursement Amount (total)': row['Reimbursement Amount (total)']
        });
      }
    });

    const sheet = getInvoiceLogSheet();
    const invoiceNumber = getNextInvoiceNumber();
    const billedDate = new Date();

    sheet.appendRow([
      invoiceNumber,
      clientNames.join(', '),
      billedDate,
      totalFee,
      totalReimbursed,
      JSON.stringify(totalCaseIds),
      JSON.stringify(snapshot)
    ]);

    _invalidateInvoiceCache();
    return { success: true, invoiceNumber: invoiceNumber, markedCount: totalCaseIds.length };
  } catch(e) {
    throw new Error(`Error bulk marking: ${e.message}`);
  } finally {
    lock.releaseLock();
  }
}

function getClientDetailsCsv(clientNames) {
  const compactData = fetchAndStoreSheetData();
  const allData = rehydrateData(compactData);
  const onboardingInfo = getClientOnboardingInfo();

  const result = [];
  const clientNameSet = new Set(clientNames.map(c => c.toLowerCase()));

  clientNames.forEach(targetClient => {
    const clientData = allData.filter(row => {
      const clientName = row['Client Name'] ? row['Client Name'].trim() : null;
      return clientName && clientName.toLowerCase() === targetClient.toLowerCase();
    });

    const headers = ['Case ID', 'Date Filed', 'Claim Type', 'Recovered', 'Fee'];
    const rows = [headers.join(',')];

    let info = onboardingInfo[targetClient];
    if (!info) {
      const k = Object.keys(onboardingInfo).find(key => key.toLowerCase() === targetClient.toLowerCase());
      if (k) info = onboardingInfo[k];
    }
    const rate = (info && info.rate) || DEFAULT_RATES['DEFAULT'];

    clientData.forEach(row => {
      if (row['Reimbursement Status'] === 'Approved') {
        const amt = parseFloat(String(row['Reimbursement Amount (total)']).replace(/[^0-9.-]+/g, '')) || 0;
        if (amt > 0) {
          rows.push([
            row['Case ID'],
            row['Date Filed'],
            row['Claim Type'] || '',
            amt.toFixed(2),
            (amt * rate).toFixed(2)
          ].join(','));
        }
      }
    });

    result.push(rows.join('\n'));
  });

  return result;
}


function bulkGenerateInvoices(clientNames) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const compactData = fetchAndStoreSheetData();
    const allData = rehydrateData(compactData);
    const onboardingInfo = getClientOnboardingInfo();
    const sheet = getInvoiceLogSheet();

    clientNames.forEach(clientName => {
      let info = onboardingInfo[clientName];
      if (!info) {
        const k = Object.keys(onboardingInfo).find(key => key.toLowerCase() === clientName.toLowerCase());
        if (k) info = onboardingInfo[k];
      }

      const clientCases = allData.filter(row => {
        const cn = row['Client Name'] ? row['Client Name'].trim() : null;
        return cn && cn.toLowerCase() === clientName.toLowerCase() &&
               row['Reimbursement Status'] === 'Approved' &&
               parseFloat(String(row['Reimbursement Amount (total)']).replace(/[^0-9.-]+/g, '')) > 0;
      });

      if (clientCases.length === 0) return;

      let totalReimbursed = 0;
      let totalFee = 0;
      let caseIds = [];
      const rate = (info && info.rate) || DEFAULT_RATES['DEFAULT'];

      clientCases.forEach(c => {
        const amt = parseFloat(String(c['Reimbursement Amount (total)']).replace(/[^0-9.-]+/g, '')) || 0;
        if (amt > 0) {
          totalReimbursed += amt;
          totalFee += amt * rate;
          caseIds.push(String(c['Case ID']));
        }
      });

      const invoiceNumber = getNextInvoiceNumber();
      const billedDate = new Date();

      sheet.appendRow([
        invoiceNumber,
        clientName,
        billedDate,
        totalFee,
        totalReimbursed,
        JSON.stringify(caseIds)
      ]);
    });

    _invalidateInvoiceCache();
    return { success: true, count: clientNames.length };
  } catch(e) {
    throw new Error(`Error generating invoices: ${e.message}`);
  } finally {
    lock.releaseLock();
  }
}

function sendBulkInvoiceEmails(clientNames, template) {
  const onboardingInfo = getClientOnboardingInfo();
  const compactData = fetchAndStoreSheetData();
  const allData = rehydrateData(compactData);

  clientNames.forEach(clientName => {
    let info = onboardingInfo[clientName];
    if (!info) {
      const k = Object.keys(onboardingInfo).find(key => key.toLowerCase() === clientName.toLowerCase());
      if (k) info = onboardingInfo[k];
    }

    const clientCases = allData.filter(row => {
      const cn = row['Client Name'] ? row['Client Name'].trim() : null;
      return cn && cn.toLowerCase() === clientName.toLowerCase() && row['Reimbursement Status'] === 'Approved';
    });

    let totalReimbursed = 0;
    let caseIds = [];
    const rate = (info && info.rate) || DEFAULT_RATES['DEFAULT'];

    clientCases.forEach(c => {
      const amt = parseFloat(String(c['Reimbursement Amount (total)']).replace(/[^0-9.-]+/g, '')) || 0;
      if (amt > 0) {
        totalReimbursed += amt;
        caseIds.push(String(c['Case ID']));
      }
    });

    const totalFee = totalReimbursed * rate;
    const ratePercent = (rate * 100).toFixed(0);

    const html = template
      .replace(/{{clientName}}/g, clientName)
      .replace(/{{totalReimbursed}}/g, totalReimbursed.toFixed(2))
      .replace(/{{totalFee}}/g, totalFee.toFixed(2))
      .replace(/{{rate}}/g, ratePercent)
      .replace(/{{caseIds}}/g, caseIds.join(', '));

    try {
      const billingSummaryInfo = getBillingSummaryInfo();
      const billingInfo = billingSummaryInfo[clientName];
      const recipientEmail = billingInfo && billingInfo.email ? billingInfo.email : null;

      if (recipientEmail) {
        GmailApp.sendEmail(recipientEmail, `Invoice - ${clientName}`, '', { htmlBody: html });
      }
    } catch(e) {
      Logger.log(`Error sending email to ${clientName}: ${e.message}`);
    }
  });

  return true;
}
