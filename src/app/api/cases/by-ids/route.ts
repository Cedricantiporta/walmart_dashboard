import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json([]);
  }

  const db = createServerClient();
  const { data, error } = await db
    .from('rms_cases')
    .select('case_id, claim_type, rms_posting_date, reimbursement_amount')
    .in('case_id', ids.map(String));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
