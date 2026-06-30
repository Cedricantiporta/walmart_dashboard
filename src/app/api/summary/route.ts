import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getCached, setCached } from '@/lib/server-cache';
import { DEFAULT_RATE, DEFAULT_VANTAGE_CUTOFF } from '@/lib/constants';
import { RmsCase, ClientInfo } from '@/types';

export const revalidate = 0;


export async function GET() {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const cacheKey = `summary:${currentMonthKey}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const db = createServerClient();

  const [
    { data: allInvoices },
    currentCases,
    { data: clientsRaw },
    { data: invoicesRaw },
    { data: hardcodedRaw },
    { data: config },
    { data: declinedRaw },
  ] = await Promise.all([
    // All invoices for historical months — same source GAS uses
    db.from('invoices').select('client_name, billed_fee, total_reimbursed, billed_date, case_ids').order('billed_date', { ascending: false }),
    // Current month only — small query, always fresh
    db.from('rms_cases').select('reimbursement_status, reimbursement_amount, rms_posting_date, client_name, case_id, date_filed')
      .gte('rms_posting_date', currentMonthStart),
    db.from('clients').select('*'),
    db.from('invoices').select('case_ids'),
    db.from('hardcoded_billed_cases').select('case_id, rms_posting_date'),
    db.from('app_config').select('*'),
    // All-time declined cases for historical month counts
    db.from('rms_cases').select('rms_posting_date').ilike('reimbursement_status', 'declined'),
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

  // Group invoices by billing period — 7-day grace (matches GAS renderMonthlyHistorySummary)
  type InvoiceRow = { client_name: string; billed_fee: number; total_reimbursed: number; billed_date: string; case_ids: string[] };
  const monthGroups: Record<string, { recovered: number; fee: number; approvedCases: number; declinedCases: number; label: string }> = {};
  (allInvoices ?? []).forEach((inv: InvoiceRow) => {
    if (!inv.billed_date) return;
    const billedDate = new Date(inv.billed_date);
    const periodDate = new Date(billedDate);
    if (billedDate.getDate() <= 7) periodDate.setMonth(periodDate.getMonth() - 1);
    const mk = `${periodDate.getFullYear()}-${String(periodDate.getMonth() + 1).padStart(2, '0')}`;
    if (mk === currentMonthKey) return;
    if (!monthGroups[mk]) {
      monthGroups[mk] = {
        recovered: 0, fee: 0, approvedCases: 0, declinedCases: 0,
        label: periodDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      };
    }
    monthGroups[mk].recovered += Number(inv.total_reimbursed) || 0;
    monthGroups[mk].fee += Number(inv.billed_fee) || 0;
    monthGroups[mk].approvedCases += (inv.case_ids ?? []).length;
  });

  // Tally all-time declined cases by posting month
  (declinedRaw ?? []).forEach((r: { rms_posting_date: string | null }) => {
    if (!r.rms_posting_date) return;
    const mk = r.rms_posting_date.slice(0, 7);
    if (mk === currentMonthKey) return; // current month already counted
    if (monthGroups[mk]) monthGroups[mk].declinedCases++;
  });

  // During grace period (first 7 days of month), prev month isn't invoiced yet.
  // Compute it live from rms_cases so the bar chart reflects RTB data.
  const isGracePeriod = now.getDate() <= 7;
  const prevMonthKey = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`; // e.g. 2026-06
  if (isGracePeriod && !monthGroups[prevMonthKey]) {
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const caseIdsWithDateEntries = new Set(
      hardcodedBilledIds.filter(id => id.includes(':')).map(id => id.split(':')[0])
    );

    // Paginate: billing period can exceed 1000 rows (Supabase cap)
    const prevCases: { reimbursement_status: string | null; reimbursement_amount: number; rms_posting_date: string | null; client_name: string; case_id: string; date_filed: string | null }[] = [];
    {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data } = await db.from('rms_cases')
          .select('reimbursement_status, reimbursement_amount, rms_posting_date, client_name, case_id, date_filed')
          .gte('rms_posting_date', prevMonthStart)
          .lt('rms_posting_date', currentMonthStart)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (!data || data.length === 0) break;
        prevCases.push(...(data as typeof prevCases));
        if (data.length < PAGE) break;
      }
    }
    // Also null-posting cases with date_filed in prev month
    const { data: nullPostingPrev } = await db.from('rms_cases')
      .select('reimbursement_status, reimbursement_amount, rms_posting_date, client_name, case_id, date_filed')
      .is('rms_posting_date', null)
      .gte('date_filed', prevMonthStart)
      .lt('date_filed', currentMonthStart);
    const allPrevCases = [...prevCases, ...(nullPostingPrev ?? [])];

    let prevRecovered = 0, prevFee = 0, prevApproved = 0;
    allPrevCases.forEach(row => {
      const effectiveDateStr = row.rms_posting_date || row.date_filed;
      if (!effectiveDateStr) return;
      if (row.reimbursement_status?.trim().toLowerCase() !== 'approved') return;
      if ((row.reimbursement_amount ?? 0) <= 0) return;
      const clientName = row.client_name?.trim();
      if (!clientName) return;
      if (clientName.toLowerCase() === 'vantage inc' && new Date(effectiveDateStr) < vCutoff) return;
      const info = onboardingInfo[clientName] ?? onboardingInfo[Object.keys(onboardingInfo).find(k => k.toLowerCase() === clientName.toLowerCase()) ?? ''];
      if (!info || info.status !== 'Client') return;
      const caseId = String(row.case_id);
      const dateKey = `${caseId}:${row.rms_posting_date}`;
      if (billedSet.has(dateKey) || (billedSet.has(caseId) && !caseIdsWithDateEntries.has(caseId))) return;
      const rate = info.rate ?? DEFAULT_RATE;
      prevRecovered += row.reimbursement_amount;
      prevFee += row.reimbursement_amount * rate;
      prevApproved++;
    });

    monthGroups[prevMonthKey] = {
      recovered: prevRecovered, fee: prevFee,
      approvedCases: prevApproved, declinedCases: 0,
      label: new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }

  const pastMonths = Object.entries(monthGroups)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([mk, g]) => ({
      month_key: mk,
      label: g.label,
      recovered: g.recovered,
      fee: g.fee,
      approved_count: g.approvedCases,
      declined_count: g.declinedCases,
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
