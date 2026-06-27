import { RmsCase, ClientInfo, ClientSummary, BillingInsights } from '@/types';
import { ALWAYS_EXCLUDED_CLIENTS, DEFAULT_RATE, HARDCODED_BILLED_IDS, DEFAULT_VANTAGE_CUTOFF } from './constants';

export function getBillingSummary(
  allData: RmsCase[],
  clientOnboardingInfo: Record<string, ClientInfo>,
  billedIds: string[],
  vantageCutoff: string = DEFAULT_VANTAGE_CUTOFF,
  extraClients: string[] = [],
  excludedClients: Set<string> = new Set()
): ClientSummary[] {
  const extraSet = new Set(extraClients.map(c => c.trim().toLowerCase()));
  // billedIds already includes hardcoded IDs (merged in the API route)
  const billedCaseIdSet = new Set(billedIds.map(String));
  const vCutoff = new Date(vantageCutoff + 'T00:00:00');

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const startOfNextMonth = new Date(currentYear, currentMonth + 1, 1);

  const clientSummary: Record<string, ClientSummary> = {};

  allData.forEach(item => {
    const rawClient = item.client_name?.trim();
    if (!rawClient) return;

    const clientKey = rawClient.toLowerCase();
    const isExtra = extraSet.has(clientKey);

    if ((ALWAYS_EXCLUDED_CLIENTS.has(clientKey) || excludedClients.has(clientKey)) && !isExtra) return;

    const info =
      clientOnboardingInfo[rawClient] ??
      clientOnboardingInfo[Object.keys(clientOnboardingInfo).find(k => k.toLowerCase() === clientKey) ?? ''];

    const isRegularClient = info?.status === 'Client' || rawClient === 'Premium Convenience';
    if (!isRegularClient && !isExtra) return;

    if (!clientSummary[rawClient]) {
      clientSummary[rawClient] = {
        clientName: rawClient,
        isBillableClient: isRegularClient || isExtra,
        casesFiled: 0,
        readyToBillCases: 0,
        totalReimbursed: 0,
        readyToBillFee: 0,
        previouslyBilledFee: 0,
        pendingCases: 0,
        pendingFee: 0,
        pendingReimbursed: 0,
        rate: info?.rate ?? DEFAULT_RATE,
        hasPreviousMonthBill: false,
      };
    }
    clientSummary[rawClient].casesFiled++;

    const caseFiledDate = new Date(item.date_filed ?? '');
    let isBillableCase = false;

    if (isRegularClient || isExtra) {
      if (rawClient === 'Premium Convenience' || isExtra) {
        isBillableCase = true;
      } else {
        const billableStartDateStr = info?.pilot_end_date ?? info?.start_date;
        if (!billableStartDateStr) {
          isBillableCase = true;
        } else {
          isBillableCase = caseFiledDate >= new Date(billableStartDateStr);
        }
      }
    }

    const caseId = String(item.case_id);
    const status = item.reimbursement_status;
    const amount = item.reimbursement_amount ?? 0;
    const rate = clientSummary[rawClient].rate;

    if (status === 'Approved' && amount > 0) {
      const fee = amount * rate;
      const postingDate = item.rms_posting_date ? new Date(item.rms_posting_date) : null;

      if (clientKey === 'vantage inc' && !isExtra && postingDate && postingDate < vCutoff) return;

      const isVantageFreePeriod = clientKey === 'vantage inc' && postingDate && postingDate < vCutoff;

      if (billedCaseIdSet.has(caseId)) {
        if (isBillableCase) clientSummary[rawClient].previouslyBilledFee += fee;
      } else if (isVantageFreePeriod) {
        clientSummary[rawClient].totalReimbursed += amount;
        if (postingDate && (postingDate.getMonth() !== currentMonth || postingDate.getFullYear() !== currentYear)) {
          clientSummary[rawClient].hasPreviousMonthBill = true;
        }
      } else if (isBillableCase) {
        if (!postingDate || isNaN(postingDate.getTime())) return;
        if (postingDate >= startOfNextMonth) {
          clientSummary[rawClient].pendingCases++;
          clientSummary[rawClient].pendingFee += fee;
          clientSummary[rawClient].pendingReimbursed += amount;
          return;
        }
        clientSummary[rawClient].readyToBillCases++;
        clientSummary[rawClient].readyToBillFee += fee;
        clientSummary[rawClient].totalReimbursed += amount;
        if (postingDate && (postingDate.getMonth() !== currentMonth || postingDate.getFullYear() !== currentYear)) {
          clientSummary[rawClient].hasPreviousMonthBill = true;
        }
      }
    }
  });

  return Object.values(clientSummary);
}

export function getBillingInsights(billingSummary: ClientSummary[]): BillingInsights {
  if (!billingSummary.length) {
    return { highestClient: null, mostCasesClient: null, clientCount: 0, clientsWithPreviousBills: 0 };
  }

  const amt = (c: ClientSummary) => (c.readyToBillFee ?? 0) + (c.pendingFee ?? 0);
  const cnt = (c: ClientSummary) => (c.readyToBillCases ?? 0) + (c.pendingCases ?? 0);

  const clientsReadyToBill = billingSummary.filter(c => amt(c) > 0);
  const clientsWithPreviousBills = billingSummary.filter(c => c.hasPreviousMonthBill).length;

  const highestClient = clientsReadyToBill.length
    ? clientsReadyToBill.reduce((max, c) => (amt(max) > amt(c) ? max : c))
    : null;

  const mostCasesClient = billingSummary.length
    ? billingSummary.reduce((max, c) => (cnt(max) > cnt(c) ? max : c))
    : null;

  return {
    highestClient: highestClient ? { name: highestClient.clientName, amount: amt(highestClient) } : null,
    mostCasesClient: mostCasesClient && cnt(mostCasesClient) > 0
      ? { name: mostCasesClient.clientName, count: cnt(mostCasesClient) }
      : null,
    clientCount: clientsReadyToBill.length,
    clientsWithPreviousBills,
  };
}
