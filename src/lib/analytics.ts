import { RmsCase, ClientInfo, DashboardAnalytics, MonthlyHistory } from '@/types';
import { ALWAYS_EXCLUDED_CLIENTS, DEFAULT_RATE, DEFAULT_VANTAGE_CUTOFF } from './constants';

interface AnalyticsParams {
  timeRange: string;
  startDateStr?: string | null;
  endDateStr?: string | null;
  specificClient?: string;
  extraClients?: string[];
}

function getMonthRange(y: number, m: number) {
  return {
    start: new Date(y, m, 1),
    end: new Date(y, m + 1, 0, 23, 59, 59, 999),
  };
}

export function calculateDashboardAnalytics(
  params: AnalyticsParams,
  allData: RmsCase[],
  clientOnboardingInfo: Record<string, ClientInfo>,
  billedIds: string[],
  vantageCutoff: string = DEFAULT_VANTAGE_CUTOFF,
  excludedClients: Set<string> = new Set()
): DashboardAnalytics {
  const empty: DashboardAnalytics = {
    metrics: { totalReimbursed: 0, totalFees: 0, approvedCases: 0, approvalRate: 0 },
    trends: { totalReimbursed: 0, totalFees: 0, approvedCases: 0, approvalRate: 0 },
    dailyData: { labels: [], current: [], previous: [] },
    chartData: { labels: [], current: [], previous: [], curMonthLabel: '', prevMonthLabel: '', isHistorical: false, extraPrevMonths: [] },
    categoryData: [],
    monthlyHistory: [],
    dateRange: { start: '', end: '' },
    dynamicHiddenClients: [],
    vantageFreePeriodAmount: 0,
  };

  if (!allData.length) return empty;

  const { timeRange, startDateStr, endDateStr, specificClient = 'all', extraClients = [] } = params;

  // billedIds already includes hardcoded IDs (merged in the API route before calling this)
  // billedIds kept for future billing-tab use (not used in monthly analytics view)
  const billedCaseIdSet = new Set(billedIds.map(String));
  const extraSet = new Set(extraClients.map(c => c.trim().toLowerCase()));
  const vCutoff = new Date(vantageCutoff + 'T00:00:00');
  const isHistoricalMonth = timeRange === 'specificMonth' && !!startDateStr;

  // "Now" anchored to Asia/Singapore (the GAS project timezone) so the current-month
  // boundary matches what the user sees — not the UTC clock Vercel runs on.
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  type ProcessedRow = { date: Date; amount: number; fee: number; id: string; type: string; isVantageFree: boolean };

  const processedRows: ProcessedRow[] = allData.flatMap(row => {
    const rawName = row.client_name;
    if (!rawName) return [];
    const clientName = rawName.trim();
    const isExtra = extraSet.has(clientName.toLowerCase());

    if (specificClient !== 'all' && clientName.toLowerCase() !== specificClient.toLowerCase()) return [];

    let info = clientOnboardingInfo[clientName];
    if (!info) {
      const mk = Object.keys(clientOnboardingInfo).find(k => k.toLowerCase() === clientName.toLowerCase());
      if (mk) info = clientOnboardingInfo[mk];
    }

    const isExcluded = ALWAYS_EXCLUDED_CLIENTS.has(clientName.toLowerCase()) || excludedClients.has(clientName.toLowerCase());
    if (isExcluded && !isExtra) return [];
    // Skip only when client is explicitly in the tracker with non-Client status.
    // Unknown clients (no tracker entry) are included with DEFAULT_RATE so no cases are silently dropped.
    if (!isExtra && info && info.status !== 'Client' && clientName !== 'Premium Convenience') return [];

    const dateFiledStr = row.date_filed;
    if (!dateFiledStr) return [];

    const startStr = info ? (info.pilot_end_date ?? info.start_date) : null;
    if (startStr?.trim()) {
      const fileDate = new Date(dateFiledStr);
      fileDate.setHours(0, 0, 0, 0);
      const contractStart = new Date(startStr);
      contractStart.setHours(0, 0, 0, 0);
      if (fileDate < contractStart) return [];
    }

    if (row.reimbursement_status?.trim().toLowerCase() !== 'approved') return [];
    // Skip $0 (or negative) approved cases — no real recovery. Matches the billing/RTB route,
    // and stops zero-dollar cases showing as phantom "N cases, $0" in the current month.
    if ((row.reimbursement_amount ?? 0) <= 0) return [];
    // Use rms_posting_date when available; fall back to date_filed for approved-but-not-yet-posted cases.
    const approvalStr = row.rms_posting_date || row.date_filed;
    if (!approvalStr) return [];

    const caseId = String(row.case_id);
    let effectiveDate = new Date(approvalStr);

    if (clientName.toLowerCase() === 'vantage inc' && !isExtra && effectiveDate < vCutoff) return [];

    const isVantageFreePeriod = clientName.toLowerCase() === 'vantage inc' && effectiveDate < vCutoff;

    // Backlog redirect (GAS parity): an UNBILLED case posted in a prior month moves to the
    // current month so "Current Month" reflects all outstanding (not-yet-invoiced) recovery.
    // BILLED cases keep their real posting month — that is where their history lives. So
    // invoicing a month's cases moves that recovery out of "current" and into that month's bar.
    // Skipped for historical-month views (raw posting dates) and vantage free-period cases.
    if (!isHistoricalMonth && !billedCaseIdSet.has(caseId) && !isVantageFreePeriod) {
      if (effectiveDate.getMonth() !== currentMonth || effectiveDate.getFullYear() !== currentYear) {
        effectiveDate = new Date(currentYear, currentMonth, 15);
      }
    }

    const amount = row.reimbursement_amount ?? 0;
    const rate = info?.rate ?? DEFAULT_RATE;
    const fee = isVantageFreePeriod ? 0 : amount * rate;

    return [{ date: effectiveDate, amount, fee, id: caseId, type: row.claim_type ?? 'Other', isVantageFree: isVantageFreePeriod }];
  });

  // Monthly history
  const monthlyHistoryMap: Record<string, MonthlyHistory> = {};
  processedRows.forEach(item => {
    const key = `${item.date.getFullYear()}-${String(item.date.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = item.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (!monthlyHistoryMap[key]) {
      monthlyHistoryMap[key] = { label: monthLabel, sort: key, recovered: 0, fee: 0, approvedCount: 0, declinedCount: 0, growth: 0 };
    }
    monthlyHistoryMap[key].recovered += item.amount;
    monthlyHistoryMap[key].fee += item.fee;
    monthlyHistoryMap[key].approvedCount++;
  });

  allData.forEach(row => {
    if (!row.date_filed || row.reimbursement_status !== 'Declined') return;
    const date = new Date(row.date_filed);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (monthlyHistoryMap[key]) monthlyHistoryMap[key].declinedCount++;
  });

  const monthlyHistory = Object.values(monthlyHistoryMap).sort((a, b) => b.sort.localeCompare(a.sort));
  for (let i = 0; i < monthlyHistory.length; i++) {
    const cur = monthlyHistory[i].recovered;
    const prev = i + 1 < monthlyHistory.length ? monthlyHistory[i + 1].recovered : 0;
    monthlyHistory[i].growth = prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;
  }

  // Date ranges — reuse the Asia/Singapore-anchored "now" so month boundaries match the user
  const nowDay = new Date(now);
  nowDay.setHours(0, 0, 0, 0);
  let curStart: Date, curEnd: Date, prevStart: Date, prevEnd: Date;

  if (timeRange === 'specificMonth' && startDateStr) {
    const [y, m] = startDateStr.split('-').map(Number);
    const cur = getMonthRange(y, m - 1);
    const prev = getMonthRange(y, m - 2);
    ({ start: curStart, end: curEnd } = cur);
    ({ start: prevStart, end: prevEnd } = prev);
  } else if (timeRange === 'thisMonth') {
    ({ start: curStart, end: curEnd } = getMonthRange(nowDay.getFullYear(), nowDay.getMonth()));
    ({ start: prevStart, end: prevEnd } = getMonthRange(nowDay.getFullYear(), nowDay.getMonth() - 1));
  } else if (timeRange === 'lastMonth') {
    ({ start: curStart, end: curEnd } = getMonthRange(nowDay.getFullYear(), nowDay.getMonth() - 1));
    ({ start: prevStart, end: prevEnd } = getMonthRange(nowDay.getFullYear(), nowDay.getMonth() - 2));
  } else if (timeRange === 'lifetime' || timeRange === '90days') {
    if (timeRange === 'lifetime') {
      curStart = new Date(1990, 0, 1); curEnd = new Date(2100, 0, 1);
      prevStart = new Date(1900, 0, 1); prevEnd = new Date(1900, 0, 1);
    } else {
      curEnd = new Date(); curEnd.setHours(23, 59, 59, 999);
      curStart = new Date(); curStart.setDate(nowDay.getDate() - 90); curStart.setHours(0, 0, 0, 0);
      const dur = curEnd.getTime() - curStart.getTime();
      prevEnd = new Date(curStart.getTime() - 1);
      prevStart = new Date(prevEnd.getTime() - dur);
    }
  } else if (timeRange === 'custom' && startDateStr && endDateStr) {
    curStart = new Date(startDateStr); curStart.setHours(0, 0, 0, 0);
    curEnd = new Date(endDateStr); curEnd.setHours(23, 59, 59, 999);
    const dur = curEnd.getTime() - curStart.getTime();
    prevEnd = new Date(curStart.getTime() - 1);
    prevStart = new Date(prevEnd.getTime() - dur);
  } else {
    ({ start: curStart, end: curEnd } = getMonthRange(nowDay.getFullYear(), nowDay.getMonth()));
    ({ start: prevStart, end: prevEnd } = getMonthRange(nowDay.getFullYear(), nowDay.getMonth() - 1));
  }

  const filterByDate = (items: ProcessedRow[], s: Date, e: Date) => items.filter(i => i.date >= s && i.date <= e);
  // No billed filter here — the backlog redirect above already keeps billed cases in their
  // real month and pulls unbilled cases into the current month (GAS parity).
  const currentItems = filterByDate(processedRows, curStart, curEnd);
  const previousItems = filterByDate(processedRows, prevStart, prevEnd);

  const calcMetrics = (items: ProcessedRow[]) => {
    let total = 0, feeTotal = 0;
    const uniqueIds = new Set<string>();
    items.forEach(i => { uniqueIds.add(i.id); total += i.amount; feeTotal += i.fee; });
    return { total, fee: feeTotal, cases: items.length };
  };

  const curM = calcMetrics(currentItems);
  const prevM = calcMetrics(previousItems);

  let vantageFreePeriodAmount = 0;
  currentItems.forEach(i => { if (i.isVantageFree) vantageFreePeriodAmount += i.amount; });

  const catMap: Record<string, number> = {};
  currentItems.forEach(i => { catMap[i.type] = (catMap[i.type] ?? 0) + i.amount; });

  const calcTrend = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100;

  // Chart: daily data
  const daySpan = Math.ceil((curEnd.getTime() - curStart.getTime()) / (1000 * 60 * 60 * 24)) || 1;
  const labels: string[] = [];
  const currentPoints = new Array(daySpan).fill(0);
  const previousPoints = new Array(daySpan).fill(0);
  for (let i = 0; i < daySpan; i++) {
    const d = new Date(curStart);
    d.setDate(d.getDate() + i);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  const fillChart = (items: ProcessedRow[], arr: number[], startRef: Date) => {
    items.forEach(i => {
      const diff = Math.floor((i.date.getTime() - startRef.getTime()) / (1000 * 60 * 60 * 24));
      if (diff >= 0 && diff < daySpan) arr[diff] += i.amount;
    });
  };
  fillChart(currentItems, currentPoints, curStart);
  fillChart(previousItems, previousPoints, prevStart);

  // Month comparison chart (by RMS Posting Date, by day-of-month)
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

  const extraPrevMonthsRaw: { month: number; year: number; label: string; data: number[] }[] = [];
  for (let offset = 2; offset <= 5; offset++) {
    const d = new Date(curChartYear, curChartMonth - offset, 1);
    const m = d.getMonth(); const y = d.getFullYear();
    const days = new Date(y, m + 1, 0).getDate();
    extraPrevMonthsRaw.push({ month: m, year: y, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), data: new Array(Math.max(days, maxChartDays)).fill(0) });
  }

  allData.forEach(row => {
    const rawName = row.client_name;
    if (!rawName) return;
    const clientName = rawName.trim();
    let info = clientOnboardingInfo[clientName];
    if (!info) {
      const mk = Object.keys(clientOnboardingInfo).find(k => k.toLowerCase() === clientName.toLowerCase());
      if (mk) info = clientOnboardingInfo[mk];
    }
    const isExtraChart = extraSet.has(clientName.toLowerCase());
    if ((ALWAYS_EXCLUDED_CLIENTS.has(clientName.toLowerCase()) || excludedClients.has(clientName.toLowerCase())) && !isExtraChart) return;
    if (!isExtraChart && info && info.status !== 'Client' && clientName !== 'Premium Convenience') return;
    if (row.reimbursement_status?.trim().toLowerCase() !== 'approved') return;
    const approvalStr = row.rms_posting_date || row.date_filed;
    if (!approvalStr) return;
    const approvalDate = new Date(approvalStr);
    if (isNaN(approvalDate.getTime())) return;
    const aMonth = approvalDate.getMonth();
    const aYear = approvalDate.getFullYear();
    const dayIdx = approvalDate.getDate() - 1;
    const caseId = String(row.case_id);
    const amount = row.reimbursement_amount ?? 0;
    const rate = info?.rate ?? DEFAULT_RATE;
    const isVantageChartFree = clientName.toLowerCase() === 'vantage inc' && approvalDate < vCutoff;
    const fee = isVantageChartFree ? 0 : amount * rate;
    const includeInCurrent = true; // date already determines the month, no billed-filtering needed
    if (aMonth === curChartMonth && aYear === curChartYear && includeInCurrent && dayIdx < maxChartDays) chartCurrent[dayIdx] += fee;
    if (aMonth === prevChartMonth && aYear === prevChartYear && dayIdx < maxChartDays) chartPrevious[dayIdx] += fee;
    extraPrevMonthsRaw.forEach(ep => {
      if (aMonth === ep.month && aYear === ep.year && dayIdx < ep.data.length) ep.data[dayIdx] += fee;
    });
  });

  // Dynamic hidden clients
  const dynamicHiddenClientsSet = new Set<string>();
  const allNames = [...new Set(allData.map(r => r.client_name?.trim()).filter(Boolean))] as string[];
  allNames.forEach(name => {
    const key = name.toLowerCase();
    if (ALWAYS_EXCLUDED_CLIENTS.has(key) || excludedClients.has(key)) { dynamicHiddenClientsSet.add(name); return; }
    let info = clientOnboardingInfo[name];
    if (!info) { const mk = Object.keys(clientOnboardingInfo).find(k => k.toLowerCase() === key); if (mk) info = clientOnboardingInfo[mk]; }
    if (info && info.status !== 'Client' && name !== 'Premium Convenience') { dynamicHiddenClientsSet.add(name); return; }
    if (key === 'vantage inc' && curEnd < vCutoff) dynamicHiddenClientsSet.add(name);
  });

  return {
    metrics: { totalReimbursed: curM.total, totalFees: curM.fee, approvedCases: curM.cases, approvalRate: 1 },
    trends: {
      totalReimbursed: calcTrend(curM.total, prevM.total),
      totalFees: calcTrend(curM.fee, prevM.fee),
      approvedCases: calcTrend(curM.cases, prevM.cases),
      approvalRate: 0,
    },
    dailyData: { labels, current: currentPoints, previous: previousPoints },
    chartData: {
      labels: chartLabels, current: chartCurrent, previous: chartPrevious,
      curMonthLabel: curStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      prevMonthLabel: prevStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      isHistorical: isHistoricalMonth,
      extraPrevMonths: extraPrevMonthsRaw.map(ep => ({ label: ep.label, data: ep.data })),
    },
    categoryData: Object.keys(catMap).map(k => ({ category: k, amount: catMap[k] })).sort((a, b) => b.amount - a.amount),
    monthlyHistory,
    dateRange: { start: curStart.toISOString(), end: curEnd.toISOString() },
    dynamicHiddenClients: [...dynamicHiddenClientsSet].sort(),
    vantageFreePeriodAmount,
  };
}
