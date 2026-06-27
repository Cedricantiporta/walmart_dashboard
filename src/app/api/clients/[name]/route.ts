import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const clientName = decodeURIComponent(name);
  const db = createServerClient();

  const [{ data: cases }, { data: invoicesRaw }] = await Promise.all([
    db.from('rms_cases').select('*').ilike('client_name', clientName),
    db.from('invoices').select('case_ids'),
  ]);

  const billedIds = [...new Set(
    (invoicesRaw ?? []).flatMap((inv: { case_ids: string[] }) => (inv.case_ids ?? []).map(String))
  )];

  return NextResponse.json({ cases: cases ?? [], billedIds });
}
