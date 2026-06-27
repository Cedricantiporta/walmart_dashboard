import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getCached, setCached } from '@/lib/server-cache';
import { DEFAULT_RATE, DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo } from '@/types';

export const revalidate = 0;

type MonthRow = {
  month_key: string;
  label: string;
  recovered: number;
  fee: number;
  approved_count: number;
  declined_count: number;
};

export async function GET() {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const cacheKey = `summary:${currentMonthKey}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const db = createServerClient();

  const [
    { data: pastRows },
    currentCases,
    { data: clientsRaw },
    { data: invoicesRaw },
    { data: hardcodedRaw },
    { data: config },
  ] = await Promise.all([
    db.from('monthly_history').select('*').order('month_key', { ascending: false }),
    // Current month only — small query, always fresh
    db.from('rms_cases').select('reimbursement_status, reimbursement_amount, rms_posting_date, client_name, case_id, date_filed')
      .gte('rms_posting_date', currentMonthStart),
    db.from('clients').select('*'),
    db.from('invoices').select('case_ids'),
    db.from('hardcoded_billed_cases').select('case_id, rms_posting_date'),
    db.from('app_config').select('*'),
  ]);

  const settings: Record<string, string> = {};
  (config ?? []).forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
  const vantageCutoff = settings['VANTAGE_CUTOFF_DATE'] ?? DEFAULT_VANTAGE_CUTOFF;
  const vCutoff = new Date(vantageCutoff + 'T00:00:00');

  const onboardingInfo: Record<string, ClientInfo> = {};
  (clientsRaw ?? []).forEach((c: ClientInfo) => { onboardingInfo[c.client_name] = c; });

  const hardcodedBilledIds = (hardcodedRaw ?? []).map(
    (r: { case_id: string; rms_posting_date: string | null }) =>
      r.rms_posting_date ? `${r.case_id}:${r.rms_posting_date}` : r.case_id
  );
  const invoiceBilledIds = [...new Set(
    (invoicesRaw ?? []).flatMap((inv: { case_ids: string[] }) => (inv.case_ids ?? []).map(String))
  )];
  const billedSet = new Set([...invoiceBilledIds, ...hardcodedBilledIds]);

  // Compute current month totals dynamically
  let curRecovered = 0;
  let curFee = 0;
  let curApproved = 0;
  let curDeclined = 0;

  type CurrentRow = { reimbursement_status: string | null; reimbursement_amount: number; rms_posting_date: string | null; client_name: string; case_id: string; date_filed: string | null };
  (currentCases.data ?? []).forEach((row: CurrentRow) => {
    const clientName = row.client_name?.trim();
    if (!clientName) return;
    const status = row.reimbursement_status?.trim().toLowerCase();

    if (status === 'declined') { curDeclined++; return; }
    if (status !== 'approved') return;
    if (!row.rms_posting_date) return;
    if (row.reimbursement_amount <= 0) return;

    // Vantage pre-cutoff exclusion
    if (clientName.toLowerCase() === 'vantage inc' && new Date(row.rms_posting_date) < vCutoff) return;

    const info = onboardingInfo[clientName] ??
      onboardingInfo[Object.keys(onboardingInfo).find(k => k.toLowerCase() === clientName.toLowerCase()) ?? ''];
    if (!info || info.status !== 'Client') return;

    const caseId = String(row.case_id);
    const dateKey = `${caseId}:${row.rms_posting_date}`;
    if (billedSet.has(dateKey) || billedSet.has(caseId)) return;

    const rate = info?.rate ?? DEFAULT_RATE;
    curRecovered += row.reimbursement_amount;
    curFee += row.reimbursement_amount * rate;
    curApproved++;
  });

  const curLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const currentMonthRow = {
    month_key: currentMonthKey,
    label: curLabel,
    recovered: curRecovered,
    fee: curFee,
    approved_count: curApproved,
    declined_count: curDeclined,
    growth: 0,
  };

  // Past months from pre-computed table (exclude current month if it sneaked in)
  const pastMonths = (pastRows ?? [])
    .filter((r: MonthRow) => r.month_key !== currentMonthKey)
    .map((r: MonthRow) => ({
      month_key: r.month_key,
      label: r.label,
      recovered: Number(r.recovered),
      fee: Number(r.fee),
      approved_count: Number(r.approved_count),
      declined_count: Number(r.declined_count),
      growth: 0,
    }));

  // Combine: current month first, then past months newest→oldest
  const history = [currentMonthRow, ...pastMonths];

  // Compute growth (each month vs the one before it)
  for (let i = 0; i < history.length - 1; i++) {
    const cur = history[i].recovered;
    const prev = history[i + 1].recovered;
    history[i].growth = prev === 0 ? (cur > 0 ? 100 : 0) : ((cur - prev) / prev) * 100;
  }

  // Cache for 3 minutes — current month changes, but not that fast
  setCached(cacheKey, history, 3 * 60 * 1000);
  return NextResponse.json(history);
}
