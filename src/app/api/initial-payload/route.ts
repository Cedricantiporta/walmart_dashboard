import { NextResponse } from 'next/server';
import { createServerClient, fetchRowsFrom } from '@/lib/supabase-server';
import { getCached, setCached } from '@/lib/server-cache';
import { getBillingSummary, getBillingInsights } from '@/lib/billing';
import { calculateDashboardAnalytics } from '@/lib/analytics';
import { VALID_TIME_RANGES, DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo, BillingContact, Invoice } from '@/types';

export const revalidate = 0;

export async function GET() {
  const db = createServerClient();

  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const cacheKey = `initial:${currentMonthStart}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const RMS_COLS = 'case_id,client_name,claim_type,reimbursement_amount,rms_posting_date,date_filed,gtin,sku_id,unit_amount,reimbursed_qty,synced_at';

  const [
    { data: allDataRaw },
    { data: clientsRaw },
    { data: billingContactsRaw },
    { data: invoicesRaw },
    { data: config },
    { data: hardcodedBilledRaw },
    { data: excludedClientsRaw },
    { count: totalRmsCount },
  ] = await Promise.all([
    db.from('rms_cases').select(RMS_COLS)
      .gte('rms_posting_date', currentMonthStart)
      .gt('reimbursement_amount', 0),
    db.from('clients').select('*'),
    db.from('billing_contacts').select('*'),
    db.from('invoices').select('*').order('invoice_number', { ascending: false }),
    db.from('app_config').select('*'),
    db.from('hardcoded_billed_cases').select('case_id, rms_posting_date'),
    db.from('excluded_clients').select('client_name'),
    db.from('rms_cases').select('id', { count: 'exact', head: true }),
  ]);

  const onboardingInfo: Record<string, ClientInfo> = {};
  (clientsRaw ?? []).forEach((c: ClientInfo) => { onboardingInfo[c.client_name] = c; });

  const billingSummaryInfo: Record<string, BillingContact> = {};
  (billingContactsRaw ?? []).forEach((c: BillingContact) => { billingSummaryInfo[c.client_name] = c; });

  const settings: Record<string, string> = {};
  (config ?? []).forEach((row: { key: string; value: string }) => { settings[row.key] = row.value; });

  const vantageCutoff = settings['VANTAGE_CUTOFF_DATE'] ?? DEFAULT_VANTAGE_CUTOFF;

  // Hardcoded billed IDs — supports plain case_id OR composite "case_id:date" for row-level control
  const hardcodedBilledIds = (hardcodedBilledRaw ?? []).map(
    (r: { case_id: string; rms_posting_date: string | null }) =>
      r.rms_posting_date ? `${r.case_id}:${r.rms_posting_date}` : r.case_id
  );

  // Excluded clients from DB
  const excludedClientsSet = new Set<string>(
    (excludedClientsRaw ?? []).map((r: { client_name: string }) => r.client_name.toLowerCase())
  );

  const history: Invoice[] = (invoicesRaw ?? []).map((inv: Record<string, unknown>) => ({
    id:               inv.id as number,
    invoice_number:   inv.invoice_number as string,
    client_name:      inv.client_name as string,
    billed_date:      inv.billed_date as string,
    billed_fee:       inv.billed_fee as number,
    total_reimbursed: inv.total_reimbursed as number,
    case_ids:         (inv.case_ids as string[]) ?? [],
    case_snapshot:    (inv.case_snapshot as []) ?? [],
    pdf_url:          (inv.pdf_url as string) ?? '',
  }));

  // All billed IDs = invoice case_ids + hardcoded
  const billedIdsFromInvoices = [...new Set(history.flatMap(inv => inv.case_ids.map(String)))];
  const billedIds = [...new Set([...billedIdsFromInvoices, ...hardcodedBilledIds])];

  const allData = (allDataRaw ?? []) as RmsCase[];
  const billingSummary = getBillingSummary(allData, onboardingInfo, billedIds, vantageCutoff, [], excludedClientsSet);

  // Client list comes from the clients table directly — not derived from rms_cases
  // so the dropdown shows all active clients even when rms_cases is empty
  const activeClients = (clientsRaw ?? [])
    .filter((c: ClientInfo) => c.status === 'Client')
    .map((c: ClientInfo) => c.client_name)
    .sort() as string[];

  const hiddenClientList: string[] = [];

  let timeRange = settings['DEFAULT_DASHBOARD_TIME'] ?? 'thisMonth';
  if (!VALID_TIME_RANGES.includes(timeRange as typeof VALID_TIME_RANGES[number])) timeRange = 'thisMonth';

  const dashboardAnalytics = calculateDashboardAnalytics(
    { timeRange, extraClients: [] },
    allData, onboardingInfo, billedIds, vantageCutoff, excludedClientsSet
  );

  const billingInsights = getBillingInsights(billingSummary);

  const { data: lastSync } = await db.from('rms_cases').select('synced_at').order('synced_at', { ascending: false }).limit(1).single();

  const isGracePeriod = now.getDate() <= 7;
  const pendingAmount = isGracePeriod ? allData.reduce((s, r) => s + (r.reimbursement_amount ?? 0), 0) : 0;

  const payload = {
    billingSummary,
    history,
    billedIds,
    onboardingInfo,
    defaultDashboardSettings: {
      time:       timeRange,
      startupTab: settings['DEFAULT_STARTUP_TAB'] ?? 'dashboard',
      billingTab: settings['DEFAULT_BILLING_TAB'] ?? 'ready',
      feeRate:    settings['DEFAULT_FEE_RATE'] ?? '0',
      theme:      settings['DEFAULT_THEME'] ?? 'light',
      vantageCutoff,
    },
    dashboardAnalytics,
    billingInsights,
    billingSummaryInfo,
    clientList:       activeClients,
    hiddenClientList,
    lastSyncTime:  lastSync?.synced_at ?? new Date().toISOString(),
    vantageCutoff,
    rmsCasesCount: totalRmsCount ?? allData.length,
    pendingAmount,
    isGracePeriod,
  };

  setCached(cacheKey, payload, 90 * 1000);
  return NextResponse.json(payload);
}
