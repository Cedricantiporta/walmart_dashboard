import { NextResponse } from 'next/server';
import { createServerClient, fetchAllRows } from '@/lib/supabase-server';
import { calculateDashboardAnalytics } from '@/lib/analytics';
import { DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo } from '@/types';

export const revalidate = 0;

export async function GET() {
  const db = createServerClient();

  const [
    allRms,
    { data: clientsRaw },
    { data: invoicesRaw },
    { data: premiumCon },
    { count: totalCount },
  ] = await Promise.all([
    fetchAllRows<RmsCase>(db, 'rms_cases'),
    db.from('clients').select('*'),
    db.from('invoices').select('case_ids, invoice_number, client_name').order('invoice_number', { ascending: false }),
    db.from('rms_cases').select('case_id,reimbursement_status,rms_posting_date,date_filed,reimbursement_amount').eq('client_name', 'Premium Convenience').limit(5),
    db.from('rms_cases').select('*', { count: 'exact', head: true }),
  ]);

  const billedIds = new Set<string>(
    (invoicesRaw ?? []).flatMap((inv: { case_ids: string[] }) => (inv.case_ids ?? []).map(String))
  );

  const onboardingInfo: Record<string, ClientInfo> = {};
  (clientsRaw ?? []).forEach((c: ClientInfo) => { onboardingInfo[c.client_name] = c; });

  const statusMap: Record<string, number> = {};
  allRms.forEach((r: RmsCase) => {
    const s = r.reimbursement_status ?? 'NULL';
    statusMap[s] = (statusMap[s] ?? 0) + 1;
  });

  const rmsClientNames = [...new Set(allRms.map((r: RmsCase) => r.client_name))].sort();
  const clientTableNames = Object.keys(onboardingInfo).sort();

  const lifetimeAnalytics = calculateDashboardAnalytics(
    { timeRange: 'lifetime', extraClients: [] },
    allRms,
    onboardingInfo,
    [...billedIds],
    DEFAULT_VANTAGE_CUTOFF,
    new Set()
  );

  const thisMonthAnalytics = calculateDashboardAnalytics(
    { timeRange: 'thisMonth', extraClients: [] },
    allRms,
    onboardingInfo,
    [...billedIds],
    DEFAULT_VANTAGE_CUTOFF,
    new Set()
  );

  return NextResponse.json({
    totalRmsRows: totalCount,
    fetchedRmsRows: allRms.length,
    statusBreakdown: statusMap,
    invoiceCount: (invoicesRaw ?? []).length,
    billedCaseIdCount: billedIds.size,
    clientNamesInRms: rmsClientNames,
    clientNamesInTracker: clientTableNames,
    premiumConvenienceRows: premiumCon,
    lifetimeMetrics: lifetimeAnalytics.metrics,
    thisMonthMetrics: thisMonthAnalytics.metrics,
    lifetimeMonthlyHistory: lifetimeAnalytics.monthlyHistory.slice(0, 12),
  });
}
