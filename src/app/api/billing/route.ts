import { NextResponse } from 'next/server';
import { createServerClient, fetchRowsFrom } from '@/lib/supabase-server';
import { getCached, setCached } from '@/lib/server-cache';
import { DEFAULT_RATE, DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo, BillingContact } from '@/types';

export const revalidate = 0;

export async function GET() {
  const db = createServerClient();

  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);

  const cacheKey = `billing:${currentMonthStart}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const [
    allData,
    { data: clientsRaw },
    { data: invoicesRaw },
    { data: hardcodedRaw },
    { data: config },
    { data: billingContactsRaw },
  ] = await Promise.all([
    fetchRowsFrom<RmsCase>(db, 'rms_cases', prevMonthStart),
    db.from('clients').select('*'),
    db.from('invoices').select('case_ids'),
    db.from('hardcoded_billed_cases').select('case_id, rms_posting_date'),
    db.from('app_config').select('*'),
    db.from('billing_contacts').select('*'),
  ]);

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

  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);

  type BillingCase = {
    caseId: string;
    claimType: string;
    postingDate: string;
    amount: number;
    fee: number;
    isCurrentMonth: boolean;
  };

  type ClientBilling = {
    clientName: string;
    rate: number;
    totalAmount: number;
    totalFee: number;
    currentMonthFee: number;
    prevMonthFee: number;
    cases: BillingCase[];
  };

  const clientMap: Record<string, ClientBilling> = {};

  allData.forEach(row => {
    if (row.reimbursement_status?.trim().toLowerCase() !== 'approved') return;
    if (!row.rms_posting_date) return; // must have a posting date
    if (row.reimbursement_amount <= 0) return;

    const clientName = row.client_name?.trim();
    if (!clientName) return;

    // Vantage pre-cutoff exclusion
    const postingDate = new Date(row.rms_posting_date);
    if (clientName.toLowerCase() === 'vantage inc' && postingDate < vCutoff) return;

    // Check if billed
    const caseId = String(row.case_id);
    const dateKey = `${caseId}:${row.rms_posting_date}`;
    const isBilledByDate = billedSet.has(dateKey);
    const isBilledByCase = billedSet.has(caseId) && !caseIdsWithDateEntries.has(caseId);
    if (isBilledByDate || isBilledByCase) return; // already invoiced

    // Skip future cases
    if (row.rms_posting_date >= nextMonthStart) return;

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
      clientMap[clientName] = { clientName, rate, totalAmount: 0, totalFee: 0, currentMonthFee: 0, prevMonthFee: 0, cases: [] };
    }

    const amount = row.reimbursement_amount;
    const fee = amount * rate;
    const isCurrentMonth = row.rms_posting_date >= currentMonthStart;

    clientMap[clientName].totalAmount += amount;
    clientMap[clientName].totalFee += fee;
    if (isCurrentMonth) clientMap[clientName].currentMonthFee += fee;
    else clientMap[clientName].prevMonthFee += fee;

    clientMap[clientName].cases.push({
      caseId,
      claimType: row.claim_type ?? 'Other',
      postingDate: row.rms_posting_date,
      amount,
      fee,
      isCurrentMonth,
    });
  });

  // Sort cases within each client by postingDate desc
  const clients = Object.values(clientMap)
    .filter(c => c.cases.length > 0)
    .sort((a, b) => b.totalFee - a.totalFee);

  clients.forEach(c => {
    c.cases.sort((a, b) => b.postingDate.localeCompare(a.postingDate));
  });

  const totalFee = clients.reduce((s, c) => s + c.totalFee, 0);
  const totalAmount = clients.reduce((s, c) => s + c.totalAmount, 0);
  const totalCases = clients.reduce((s, c) => s + c.cases.length, 0);

  const result = { clients, totalFee, totalAmount, totalCases, currentMonthStart, billingSummaryInfo };
  setCached(cacheKey, result, 5 * 60 * 1000);
  return NextResponse.json(result);
}
