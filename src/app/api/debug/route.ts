import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export const revalidate = 0;

export async function GET() {
  const db = createServerClient();

  const [
    { data: sample, error: e1 },
    { data: statusCounts, error: e2 },
    { data: premiumCon, error: e3 },
    { data: nullPostingApproved, error: e4 },
    { count: totalCount },
  ] = await Promise.all([
    db.from('rms_cases').select('case_id,client_name,reimbursement_status,rms_posting_date,date_filed,reimbursement_amount').limit(10),
    db.rpc('get_status_counts').catch ? db.from('rms_cases').select('reimbursement_status').limit(1000) : db.from('rms_cases').select('reimbursement_status').limit(1000),
    db.from('rms_cases').select('case_id,reimbursement_status,rms_posting_date,date_filed,reimbursement_amount').eq('client_name', 'Premium Convenience').limit(10),
    db.from('rms_cases').select('case_id,client_name,date_filed').eq('reimbursement_status', 'Approved').is('rms_posting_date', null).limit(20),
    db.from('rms_cases').select('*', { count: 'exact', head: true }),
  ]);

  // Count distinct statuses from the full table
  const { data: allStatuses } = await db.from('rms_cases').select('reimbursement_status').limit(5000);
  const statusMap: Record<string, number> = {};
  (allStatuses ?? []).forEach((r: { reimbursement_status: string | null }) => {
    const s = r.reimbursement_status ?? 'NULL';
    statusMap[s] = (statusMap[s] ?? 0) + 1;
  });

  const { data: approvedCount } = await db.from('rms_cases').select('*', { count: 'exact', head: true }).ilike('reimbursement_status', 'approved');

  return NextResponse.json({
    totalRows: totalCount,
    approvedRows: (approvedCount as unknown as { count: number })?.count ?? 'err',
    statusBreakdown: statusMap,
    sampleRows: sample ?? e1?.message,
    premiumConvenienceRows: premiumCon ?? e3?.message,
    approvedNullPostingDate: {
      count: (nullPostingApproved ?? []).length,
      sample: nullPostingApproved ?? e4?.message,
    },
  });
}
