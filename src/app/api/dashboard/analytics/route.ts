import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, fetchAllRows } from '@/lib/supabase-server';
import { calculateDashboardAnalytics } from '@/lib/analytics';
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
    db.from('hardcoded_billed_cases').select('case_id'),
    db.from('excluded_clients').select('client_name'),
  ]);

  const onboardingInfo: Record<string, ClientInfo> = {};
  (clientsRaw ?? []).forEach((c: ClientInfo) => { onboardingInfo[c.client_name] = c; });

  const settings: Record<string, string> = {};
  (config ?? []).forEach((row: { key: string; value: string }) => { settings[row.key] = row.value; });
  const vantageCutoff = settings['VANTAGE_CUTOFF_DATE'] ?? DEFAULT_VANTAGE_CUTOFF;

  const hardcodedBilledIds = new Set<string>((hardcodedRaw ?? []).map((r: { case_id: string }) => r.case_id));
  const excludedClients = new Set<string>((excludedRaw ?? []).map((r: { client_name: string }) => r.client_name.toLowerCase()));

  const invoiceBilledIds = [...new Set(
    (invoicesRaw ?? []).flatMap((inv: { case_ids: string[] }) => (inv.case_ids ?? []).map(String))
  )];
  const billedIds = [...new Set([...invoiceBilledIds, ...hardcodedBilledIds])];

  const result = calculateDashboardAnalytics(
    { timeRange, startDateStr, endDateStr, specificClient, extraClients },
    allData, onboardingInfo, billedIds, vantageCutoff, excludedClients
  );

  return NextResponse.json(result);
}
