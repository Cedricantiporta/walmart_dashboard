import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, fetchAllRows } from '@/lib/supabase-server';
import { calculateDashboardAnalytics } from '@/lib/analytics';
import { DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo } from '@/types';

export const revalidate = 0;

function getDateFilter(timeRange: string, startDateStr: string | null): { from: string; to: string } | null {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  if (timeRange === 'thisMonth') {
    const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const to = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`;
    return { from, to };
  }

  if (timeRange === 'specificMonth' && startDateStr) {
    const [y, m] = startDateStr.split('-').map(Number);
    const from = `${y}-${pad(m)}-01`;
    const next = new Date(y, m, 1);
    const to = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`;
    return { from, to };
  }

  if (timeRange === '90days') {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const to = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`;
    return { from, to };
  }

  return null; // lifetime — fetch all
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const timeRange      = searchParams.get('timeRange') ?? 'thisMonth';
  const startDateStr   = searchParams.get('startDate');
  const endDateStr     = searchParams.get('endDate');
  const specificClient = searchParams.get('client') ?? 'all';
  const extraClients   = searchParams.get('extraClients')?.split(',').filter(Boolean) ?? [];

  const db = createServerClient();
  const dateFilter = getDateFilter(timeRange, startDateStr);

  async function loadRmsCases(): Promise<RmsCase[]> {
    if (!dateFilter) return fetchAllRows<RmsCase>(db, 'rms_cases');
    // DB-side filter: only load rows whose posting date falls in the range.
    // Also include approved rows with null posting date (not yet posted but approved).
    const PAGE = 1000;
    const results: RmsCase[] = [];
    let from = 0;
    while (true) {
      const { data } = await db
        .from('rms_cases')
        .select('*')
        .gte('rms_posting_date', dateFilter.from)
        .lt('rms_posting_date', dateFilter.to)
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      results.push(...(data as RmsCase[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    // Also pull approved cases with null posting date (recently approved, not yet posted)
    const { data: nullPosting } = await db
      .from('rms_cases')
      .select('*')
      .eq('reimbursement_status', 'Approved')
      .is('rms_posting_date', null);
    if (nullPosting) results.push(...(nullPosting as RmsCase[]));
    return results;
  }

  const [
    allData,
    { data: clientsRaw },
    { data: config },
    { data: invoicesRaw },
    { data: hardcodedRaw },
    { data: excludedRaw },
  ] = await Promise.all([
    loadRmsCases(),
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
