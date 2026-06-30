import { NextResponse } from 'next/server';
import { createServerClient, fetchAllRows } from '@/lib/supabase-server';
import { calculateDashboardAnalytics } from '@/lib/analytics';
import { DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo } from '@/types';

export const revalidate = 0;

// Monthly history = the SAME computation that drives the Overview cards (GAS parity).
// calculateDashboardAnalytics applies the backlog redirect: billed cases stay in their
// posting month, unbilled cases roll into the current month. So invoicing a month moves
// that recovery out of "current" and into that month's bar — exactly like the old GAS app.
export async function GET() {
  const db = createServerClient();

  const [
    allData,
    { data: clientsRaw },
    { data: config },
    { data: invoicesRaw },
    { data: hardcodedRaw },
    { data: excludedRaw },
  ] = await Promise.all([
    fetchAllRows<RmsCase>(db, 'rms_cases'),
    db.from('clients').select('*'),
    db.from('app_config').select('*'),
    db.from('invoices').select('case_ids'),
    db.from('hardcoded_billed_cases').select('case_id, rms_posting_date'),
    db.from('excluded_clients').select('client_name'),
  ]);

  const onboardingInfo: Record<string, ClientInfo> = {};
  (clientsRaw ?? []).forEach((c: ClientInfo) => { onboardingInfo[c.client_name] = c; });

  const settings: Record<string, string> = {};
  (config ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
  const vantageCutoff = settings['VANTAGE_CUTOFF_DATE'] ?? DEFAULT_VANTAGE_CUTOFF;

  const hardcodedBilledIds = (hardcodedRaw ?? []).map((r: { case_id: string; rms_posting_date: string | null }) =>
    r.rms_posting_date ? `${r.case_id}:${r.rms_posting_date}` : r.case_id
  );
  const invoiceBilledIds = [...new Set(
    (invoicesRaw ?? []).flatMap((inv: { case_ids: string[] }) => (inv.case_ids ?? []).map(String))
  )];
  const billedIds = [...new Set([...invoiceBilledIds, ...hardcodedBilledIds])];

  const excludedClients = new Set<string>(
    (excludedRaw ?? []).map((r: { client_name: string }) => r.client_name.toLowerCase())
  );

  const result = calculateDashboardAnalytics(
    { timeRange: 'thisMonth' },
    allData, onboardingInfo, billedIds, vantageCutoff, excludedClients
  );

  // Map to the shape the bar chart + Summary page already expect
  const history = result.monthlyHistory.map(m => ({
    month_key:      m.sort,
    label:          m.label,
    recovered:      m.recovered,
    fee:            m.fee,
    approved_count: m.approvedCount,
    declined_count: m.declinedCount,
    growth:         m.growth,
  }));

  return NextResponse.json(history);
}
