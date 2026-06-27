import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export const revalidate = 0;

export async function GET() {
  const db = createServerClient();

  const [
    { data: sample },
    { data: premiumCon },
    { data: approvedNullPosting },
    { data: allStatuses },
    { count: totalCount },
  ] = await Promise.all([
    db.from('rms_cases').select('case_id,client_name,reimbursement_status,rms_posting_date,date_filed,reimbursement_amount').limit(10),
    db.from('rms_cases').select('case_id,reimbursement_status,rms_posting_date,date_filed,reimbursement_amount').eq('client_name', 'Premium Convenience').limit(10),
    db.from('rms_cases').select('case_id,client_name,date_filed').eq('reimbursement_status', 'Approved').is('rms_posting_date', null).limit(20),
    db.from('rms_cases').select('reimbursement_status').limit(5000),
    db.from('rms_cases').select('*', { count: 'exact', head: true }),
  ]);

  const statusMap: Record<string, number> = {};
  (allStatuses ?? []).forEach((r: { reimbursement_status: string | null }) => {
    const s = r.reimbursement_status ?? 'NULL';
    statusMap[s] = (statusMap[s] ?? 0) + 1;
  });

  return NextResponse.json({
    totalRows: totalCount,
    statusBreakdown: statusMap,
    sampleRows: sample,
    premiumConvenienceRows: premiumCon,
    approvedNullPostingDate: { count: (approvedNullPosting ?? []).length, sample: approvedNullPosting },
  });
}
