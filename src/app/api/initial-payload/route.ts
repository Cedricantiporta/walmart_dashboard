import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getBillingSummary, getBillingInsights } from '@/lib/billing';
import { calculateDashboardAnalytics } from '@/lib/analytics';
import { VALID_TIME_RANGES, DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo, BillingContact, Invoice } from '@/types';

export const revalidate = 0;

export async function GET() {
  const db = createServerClient();

  const [
    { data: rmsCases },
    { data: clientsRaw },
    { data: billingContactsRaw },
    { data: invoicesRaw },
    { data: config },
  ] = await Promise.all([
    db.from('rms_cases').select('*'),
    db.from('clients').select('*'),
    db.from('billing_contacts').select('*'),
    db.from('invoices').select('*').order('invoice_number', { ascending: false }),
    db.from('app_config').select('*'),
  ]);

  const allData: RmsCase[] = rmsCases ?? [];
  const onboardingInfo: Record<string, ClientInfo> = {};
  (clientsRaw ?? []).forEach((c: ClientInfo) => { onboardingInfo[c.client_name] = c; });

  const billingSummaryInfo: Record<string, BillingContact> = {};
  (billingContactsRaw ?? []).forEach((c: BillingContact) => { billingSummaryInfo[c.client_name] = c; });

  const settings: Record<string, string> = {};
  (config ?? []).forEach((row: { key: string; value: string }) => { settings[row.key] = row.value; });

  const vantageCutoff = settings['VANTAGE_CUTOFF_DATE'] ?? DEFAULT_VANTAGE_CUTOFF;

  const history: Invoice[] = (invoicesRaw ?? []).map((inv: Record<string, unknown>) => ({
    id: inv.id as number,
    invoice_number: inv.invoice_number as string,
    client_name: inv.client_name as string,
    billed_date: inv.billed_date as string,
    billed_fee: inv.billed_fee as number,
    total_reimbursed: inv.total_reimbursed as number,
    case_ids: (inv.case_ids as string[]) ?? [],
    case_snapshot: (inv.case_snapshot as []) ?? [],
    pdf_url: (inv.pdf_url as string) ?? '',
  }));

  const billedIds = [...new Set(history.flatMap(inv => inv.case_ids.map(String)))];

  const billingSummary = getBillingSummary(allData, onboardingInfo, billedIds, vantageCutoff);
  const activeClients = billingSummary.map(c => c.clientName).sort();

  const allDataClientNames = [...new Set(allData.map(r => r.client_name?.trim()).filter(Boolean))] as string[];
  const hiddenClientList = allDataClientNames.filter(name => {
    const key = name.toLowerCase();
    if (activeClients.map(c => c.toLowerCase()).includes(key)) return false;
    const info = onboardingInfo[name] ?? onboardingInfo[Object.keys(onboardingInfo).find(k => k.toLowerCase() === key) ?? ''];
    return !info || info.status !== 'Client';
  }).sort();

  let timeRange = settings['DEFAULT_DASHBOARD_TIME'] ?? 'thisMonth';
  if (!VALID_TIME_RANGES.includes(timeRange as typeof VALID_TIME_RANGES[number])) timeRange = 'thisMonth';

  const dashboardAnalytics = calculateDashboardAnalytics(
    { timeRange, extraClients: [] },
    allData, onboardingInfo, billedIds, vantageCutoff
  );

  const billingInsights = getBillingInsights(billingSummary);

  const lastSyncRow = await db.from('rms_cases').select('synced_at').order('synced_at', { ascending: false }).limit(1).single();
  const lastSyncTime = lastSyncRow.data?.synced_at ?? new Date().toISOString();

  return NextResponse.json({
    billingSummary,
    history,
    billedIds,
    onboardingInfo,
    defaultDashboardSettings: {
      time: timeRange,
      startupTab: settings['DEFAULT_STARTUP_TAB'] ?? 'dashboard',
      billingTab: settings['DEFAULT_BILLING_TAB'] ?? 'ready',
      feeRate: settings['DEFAULT_FEE_RATE'] ?? '0',
      theme: settings['DEFAULT_THEME'] ?? 'light',
      vantageCutoff,
    },
    dashboardAnalytics,
    billingInsights,
    billingSummaryInfo,
    clientList: activeClients,
    hiddenClientList,
    lastSyncTime,
    vantageCutoff,
  });
}
