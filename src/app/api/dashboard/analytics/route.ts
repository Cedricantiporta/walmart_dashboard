import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, fetchAllRows } from '@/lib/supabase-server';
import { calculateDashboardAnalytics } from '@/lib/analytics';
import { getCached, setCached } from '@/lib/server-cache';
import { DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo } from '@/types';

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const timeRange      = searchParams.get('timeRange') ?? 'thisMonth';
  const startDateStr   = searchParams.get('startDate');
  const endDateStr     = searchParams.get('endDate');
  const specificClient = searchParams.get('client') ?? 'all';
  const extraClients   = searchParams.get('extraClients')?.split(',').filter(Boolean) ?? [];

  // Include current month in key so warm lambda doesn't serve last month's thisMonth cache
  const _cm = new Date(); _cm.setDate(1); _cm.setHours(0,0,0,0);
  const monthTag = timeRange === 'thisMonth' ? `:${_cm.toISOString().slice(0,7)}` : '';
  const cacheKey = `analytics:${timeRange}${monthTag}:${specificClient}:${startDateStr ?? ''}:${extraClients.join(',')}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const db = createServerClient();

  // Fetch ALL rows: the backlog-redirect in calculateDashboardAnalytics needs every unbilled
  // case (any month) to roll forward into the current month — GAS parity, matches Summary.
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
    db.from('invoices').select('case_ids, billed_fee, total_reimbursed, billed_date'),
    db.from('hardcoded_billed_cases').select('case_id, rms_posting_date'),
    db.from('excluded_clients').select('client_name'),
  ]);

  const onboardingInfo: Record<string, ClientInfo> = {};
  (clientsRaw ?? []).forEach((c: ClientInfo) => { onboardingInfo[c.client_name] = c; });

  const settings: Record<string, string> = {};
  (config ?? []).forEach((row: { key: string; value: string }) => { settings[row.key] = row.value; });
  const vantageCutoff = settings['VANTAGE_CUTOFF_DATE'] ?? DEFAULT_VANTAGE_CUTOFF;

  const hardcodedBilledIds = (hardcodedRaw ?? []).map((r: { case_id: string; rms_posting_date: string | null }) =>
    r.rms_posting_date ? `${r.case_id}:${r.rms_posting_date}` : r.case_id
  );
  const excludedClients = new Set<string>((excludedRaw ?? []).map((r: { client_name: string }) => r.client_name.toLowerCase()));

  type InvRow = { case_ids: string[]; billed_fee: number; total_reimbursed: number; billed_date: string };

  const invoiceBilledIds = [...new Set(
    (invoicesRaw ?? []).flatMap((inv: InvRow) => (inv.case_ids ?? []).map(String))
  )];
  const billedIds = [...new Set([...invoiceBilledIds, ...hardcodedBilledIds])];

  const result = calculateDashboardAnalytics(
    { timeRange, startDateStr, endDateStr, specificClient, extraClients },
    allData, onboardingInfo, billedIds, vantageCutoff, excludedClients
  );

  setCached(cacheKey, result, 90 * 1000);

  return NextResponse.json(result);
}
