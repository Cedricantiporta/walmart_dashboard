import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { DEFAULT_RATE, DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo, BillingContact } from '@/types';

export const revalidate = 0;

export async function GET() {
  const db = createServerClient();

  // Anchor to Asia/Singapore (GAS project tz) so the month boundary + grace window match the
  // user's calendar, not Vercel's UTC clock — critical on the 1st–3rd when billing happens.
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().slice(0, 10);

  const RMS_COLS = 'case_id,client_name,claim_type,reimbursement_amount,rms_posting_date,date_filed,gtin,sku_id,unit_amount,reimbursed_qty,reimbursement_status';

  const nextMonthStartEarly = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);

  // Fire non-paginated queries immediately so they run in parallel with the pagination loop below
  const otherQueriesPromise = Promise.all([
    db.from('rms_cases').select(RMS_COLS)
      .gte('rms_posting_date', twoYearsAgo)
      .lt('rms_posting_date', prevMonthStart)
      .gt('reimbursement_amount', 0)
      .order('rms_posting_date', { ascending: false })
      .limit(2000),
    db.from('clients').select('*'),
    db.from('invoices').select('case_ids'),
    db.from('invoices').select('client_name, billed_fee, total_reimbursed, billed_date'),
    db.from('hardcoded_billed_cases').select('case_id, rms_posting_date'),
    db.from('app_config').select('*'),
    db.from('billing_contacts').select('*'),
  ]);

  // Paginate main billing data — Supabase caps single queries at 1000 rows; analytics uses fetchAllRows which paginates
  const allData: RmsCase[] = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data } = await db.from('rms_cases').select(RMS_COLS)
        .gte('rms_posting_date', prevMonthStart)
        .gt('reimbursement_amount', 0)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      allData.push(...(data as RmsCase[]));
      if (data.length < PAGE) break;
    }
  }

  const [
    { data: overdueRaw },
    { data: clientsRaw },
    { data: invoicesRaw },
    { data: allInvoicesRaw },
    { data: hardcodedRaw },
    { data: config },
    { data: billingContactsRaw },
  ] = await otherQueriesPromise;

  const settings: Record<string, string> = {};
  (config ?? []).forEach((row: { key: string; value: string }) => { settings[row.key] = row.value; });
  const vantageCutoff = settings['VANTAGE_CUTOFF_DATE'] ?? DEFAULT_VANTAGE_CUTOFF;
  const vCutoff = new Date(vantageCutoff + 'T00:00:00');

  const onboardingInfo: Record<string, ClientInfo> = {};
  (clientsRaw ?? []).forEach((c: ClientInfo) => { onboardingInfo[c.client_name] = c; });

  const billingSummaryInfo: Record<string, BillingContact> = {};
  (billingContactsRaw ?? []).forEach((c: BillingContact) => { billingSummaryInfo[c.client_name] = c; });

  // Build billed set (composite case_id:date or plain case_id)
  const hardcodedBilledIds = (hardcodedRaw ?? []).map(
    (r: { case_id: string; rms_posting_date: string | null }) =>
      r.rms_posting_date ? `${r.case_id}:${r.rms_posting_date}` : r.case_id
  );
  const invoiceBilledIds = [...new Set(
    (invoicesRaw ?? []).flatMap((inv: { case_ids: string[] }) => (inv.case_ids ?? []).map(String))
  )];
  const billedSet = new Set([...invoiceBilledIds, ...hardcodedBilledIds]);
  const caseIdsWithDateEntries = new Set(
    hardcodedBilledIds.filter(id => id.includes(':')).map(id => id.split(':')[0])
  );

  const nextMonthStart = nextMonthStartEarly;
  type BillingCase = {
    caseId: string;
    claimType: string;
    postingDate: string;
    amount: number;
    fee: number;
    isCurrentMonth: boolean;
    gtin: string;
    sku_id: string;
    unit_amount: number;
    reimbursed_qty: number;
  };

  const isGracePeriod = now.getDate() <= 7;

  type ClientBilling = {
    clientName: string;
    rate: number;
    totalAmount: number;
    totalFee: number;
    currentMonthFee: number;
    prevMonthFee: number;
    previouslyBilledFee: number;
    previouslyBilledReimbursed: number;
    cases: BillingCase[];
    pendingCases: BillingCase[];
    pendingAmount: number;
    pendingFee: number;
    overdueCases: BillingCase[];
    overdueAmount: number;
    overdueFee: number;
  };

  const clientMap: Record<string, ClientBilling> = {};

  // Reimbursed only: an RMS Posting Date is required everywhere — RTB and Pending alike.
  // A case without a posting date is not yet reimbursed, so it appears in neither bucket.
  allData.forEach(row => {
    if (!row.rms_posting_date) return;
    if (row.reimbursement_amount <= 0) return;
    if (row.reimbursement_status?.trim().toLowerCase() !== 'approved') return;

    const effectiveDateStr = row.rms_posting_date;
    // Pending = a reimbursed CURRENT-month case during the grace window (1st–7th). Held back so
    // it can't be billed with the prior month. RTB = prior-month reimbursed cases.
    const isCurrentMonth = effectiveDateStr >= currentMonthStart;
    const isPending = isGracePeriod && isCurrentMonth;

    const clientName = row.client_name?.trim();
    if (!clientName) return;

    // Vantage pre-cutoff exclusion
    const effectiveDate = new Date(effectiveDateStr);
    if (clientName.toLowerCase() === 'vantage inc' && effectiveDate < vCutoff) return;

    // Check if billed (composite key uses rms_posting_date; null-posting rows use plain case_id path)
    const caseId = String(row.case_id);
    const dateKey = `${caseId}:${row.rms_posting_date}`;
    const isBilledByDate = billedSet.has(dateKey);
    const isBilledByCase = billedSet.has(caseId) && !caseIdsWithDateEntries.has(caseId);
    if (isBilledByDate || isBilledByCase) return;

    // Skip future cases
    if (effectiveDateStr >= nextMonthStart) return;

    const info = onboardingInfo[clientName] ??
      onboardingInfo[Object.keys(onboardingInfo).find(k => k.toLowerCase() === clientName.toLowerCase()) ?? ''];
    const rate = info?.rate ?? DEFAULT_RATE;

    // Contract start check
    if (info) {
      const billableStart = info.pilot_end_date ?? info.start_date;
      if (billableStart && row.date_filed) {
        if (new Date(row.date_filed) < new Date(billableStart)) return;
      }
    }

    if (!clientMap[clientName]) {
      clientMap[clientName] = { clientName, rate, totalAmount: 0, totalFee: 0, currentMonthFee: 0, prevMonthFee: 0, previouslyBilledFee: 0, previouslyBilledReimbursed: 0, cases: [], pendingCases: [], pendingAmount: 0, pendingFee: 0, overdueCases: [], overdueAmount: 0, overdueFee: 0 };
    }

    const amount = row.reimbursement_amount;
    const fee = amount * rate;

    const caseObj: BillingCase = {
      caseId,
      claimType: row.claim_type ?? 'Other',
      postingDate: effectiveDateStr,
      amount,
      fee,
      isCurrentMonth,
      gtin: row.gtin ?? '',
      sku_id: row.sku_id ?? '',
      unit_amount: row.unit_amount ?? amount,
      reimbursed_qty: row.reimbursed_qty ?? 1,
    };

    if (isPending) {
      clientMap[clientName].pendingCases.push(caseObj);
      clientMap[clientName].pendingAmount += amount;
      clientMap[clientName].pendingFee += fee;
    } else {
      clientMap[clientName].totalAmount += amount;
      clientMap[clientName].totalFee += fee;
      if (isCurrentMonth) clientMap[clientName].currentMonthFee += fee;
      else clientMap[clientName].prevMonthFee += fee;
      clientMap[clientName].cases.push(caseObj);
    }
  });

  // Overdue cases: unbilled cases with posting date before prevMonthStart
  (overdueRaw ?? []).forEach(row => {
    if (!row.rms_posting_date) return;
    if (row.reimbursement_amount <= 0) return;

    const clientName = row.client_name?.trim();
    if (!clientName) return;

    const postingDate = new Date(row.rms_posting_date);
    if (clientName.toLowerCase() === 'vantage inc' && postingDate < vCutoff) return;

    const caseId = String(row.case_id);
    const dateKey = `${caseId}:${row.rms_posting_date}`;
    const isBilledByDate = billedSet.has(dateKey);
    const isBilledByCase = billedSet.has(caseId) && !caseIdsWithDateEntries.has(caseId);
    if (isBilledByDate || isBilledByCase) return;

    const info = onboardingInfo[clientName] ??
      onboardingInfo[Object.keys(onboardingInfo).find(k => k.toLowerCase() === clientName.toLowerCase()) ?? ''];
    const rate = info?.rate ?? DEFAULT_RATE;

    if (info) {
      const billableStart = info.pilot_end_date ?? info.start_date;
      if (billableStart && row.date_filed) {
        if (new Date(row.date_filed) < new Date(billableStart)) return;
      }
    }

    if (!clientMap[clientName]) {
      clientMap[clientName] = { clientName, rate, totalAmount: 0, totalFee: 0, currentMonthFee: 0, prevMonthFee: 0, previouslyBilledFee: 0, previouslyBilledReimbursed: 0, cases: [], pendingCases: [], pendingAmount: 0, pendingFee: 0, overdueCases: [], overdueAmount: 0, overdueFee: 0 };
    }

    const amount = row.reimbursement_amount;
    const fee = amount * rate;
    const caseObj: BillingCase = {
      caseId, claimType: row.claim_type ?? 'Other', postingDate: row.rms_posting_date,
      amount, fee, isCurrentMonth: false,
      gtin: row.gtin ?? '', sku_id: row.sku_id ?? '',
      unit_amount: row.unit_amount ?? amount, reimbursed_qty: row.reimbursed_qty ?? 1,
    };
    clientMap[clientName].overdueCases.push(caseObj);
    clientMap[clientName].overdueAmount += amount;
    clientMap[clientName].overdueFee += fee;
  });

  // Build previouslyBilledFee map from all invoices (matches GAS's previouslyBilledFee)
  const prevBilledMap: Record<string, { fee: number; recovered: number }> = {};
  let lastBillingMonth = '';
  (allInvoicesRaw ?? []).forEach((inv: { client_name: string; billed_fee: number; total_reimbursed: number; billed_date: string | null }) => {
    if (!prevBilledMap[inv.client_name]) prevBilledMap[inv.client_name] = { fee: 0, recovered: 0 };
    prevBilledMap[inv.client_name].fee += Number(inv.billed_fee) || 0;
    prevBilledMap[inv.client_name].recovered += Number(inv.total_reimbursed) || 0;
    if (inv.billed_date) {
      const ym = inv.billed_date.slice(0, 7); // YYYY-MM
      if (ym > lastBillingMonth) lastBillingMonth = ym;
    }
  });
  // Clients billed in the most recent billing month
  const lastBilledClients: string[] = [];
  if (lastBillingMonth) {
    (allInvoicesRaw ?? []).forEach((inv: { client_name: string; billed_date: string | null }) => {
      if (inv.billed_date?.slice(0, 7) === lastBillingMonth && !lastBilledClients.includes(inv.client_name)) {
        lastBilledClients.push(inv.client_name);
      }
    });
  }

  // Sort cases within each client by postingDate desc
  const clients = Object.values(clientMap)
    .filter(c => c.cases.length > 0 || c.overdueCases.length > 0)
    .sort((a, b) => b.totalFee - a.totalFee);

  clients.forEach(c => {
    c.cases.sort((a, b) => b.postingDate.localeCompare(a.postingDate));
    c.overdueCases.sort((a, b) => b.postingDate.localeCompare(a.postingDate));
    // Attach previouslyBilledFee from invoices
    const pb = prevBilledMap[c.clientName];
    c.previouslyBilledFee = pb?.fee ?? 0;
    c.previouslyBilledReimbursed = pb?.recovered ?? 0;
  });

  // Add billed-only clients (have invoices but no current RTB cases) — matches GAS's billingSummaryData
  const rtbNames = new Set(clients.map(c => c.clientName));
  for (const [clientName, pb] of Object.entries(prevBilledMap)) {
    if (rtbNames.has(clientName)) continue;
    const infoKey = Object.keys(onboardingInfo).find(k => k.toLowerCase() === clientName.toLowerCase());
    const info = onboardingInfo[clientName] ?? (infoKey ? onboardingInfo[infoKey] : undefined);
    if (!info || info.status !== 'Client') continue;
    clients.push({
      clientName,
      rate: info.rate ?? DEFAULT_RATE,
      totalAmount: 0,
      totalFee: 0,
      currentMonthFee: 0,
      prevMonthFee: 0,
      previouslyBilledFee: pb.fee,
      previouslyBilledReimbursed: pb.recovered,
      cases: [],
      pendingCases: [],
      pendingAmount: 0,
      pendingFee: 0,
      overdueCases: [],
      overdueAmount: 0,
      overdueFee: 0,
    });
  }

  const totalFee = clients.reduce((s, c) => s + c.totalFee, 0);
  const totalAmount = clients.reduce((s, c) => s + c.totalAmount, 0);
  const totalCases = clients.reduce((s, c) => s + c.cases.length, 0);

  const result = { clients, totalFee, totalAmount, totalCases, currentMonthStart, billingSummaryInfo, isGracePeriod, lastBilledClients };
  return NextResponse.json(result);
}
