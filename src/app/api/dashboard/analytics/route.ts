import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, fetchAllRows, fetchRowsFrom } from '@/lib/supabase-server';
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

  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const useFilter = timeRange === 'thisMonth';

  const [
    allData,
    { data: clientsRaw },
    { data: config },
    { data: invoicesRaw },
    { data: hardcodedRaw },
    { data: excludedRaw },
  ] = await Promise.all([
    useFilter
      ? fetchRowsFrom<RmsCase>(db, 'rms_cases', currentMonthStart)
      : fetchAllRows<RmsCase>(db, 'rms_cases'),
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

  // For historical months: override headline metrics with invoice data so they match Summary page.
  // Charts/categories still come from rms_cases (posting date context).
  if (timeRange === 'specificMonth' && startDateStr) {
    const [sy, sm] = startDateStr.split('-').map(Number);
    const curKey  = `${sy}-${String(sm).padStart(2, '0')}`;
    const prevDate = new Date(sy, sm - 2, 1);
    const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const inv = { cur: { r: 0, f: 0, c: 0 }, prev: { r: 0, f: 0 } };
    (invoicesRaw ?? []).forEach((row: InvRow) => {
      if (!row.billed_date) return;
      const bd = new Date(row.billed_date);
      const pd = new Date(bd);
      if (bd.getDate() <= 7) pd.setMonth(pd.getMonth() - 1);
      const mk = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`;
      if (mk === curKey) {
        inv.cur.r += Number(row.total_reimbursed) || 0;
        inv.cur.f += Number(row.billed_fee) || 0;
        inv.cur.c += (row.case_ids ?? []).length;
      } else if (mk === prevKey) {
        inv.prev.r += Number(row.total_reimbursed) || 0;
        inv.prev.f += Number(row.billed_fee) || 0;
      }
    });

    const trend = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100;
    result.metrics.totalReimbursed = inv.cur.r;
    result.metrics.totalFees       = inv.cur.f;
    result.metrics.approvedCases   = inv.cur.c;
    result.trends.totalReimbursed  = trend(inv.cur.r, inv.prev.r);
    result.trends.totalFees        = trend(inv.cur.f, inv.prev.f);
    result.trends.approvedCases    = trend(inv.cur.c, 0);
  }

  setCached(cacheKey, result, 90 * 1000);

  return NextResponse.json(result);
}
