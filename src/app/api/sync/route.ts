import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { type, data } = body as { type: string; data: Record<string, unknown>[] };

  if (!type || !Array.isArray(data)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const db = createServerClient();

  if (type === 'rms_cases') {
    const CHUNK = 500;
    for (let i = 0; i < data.length; i += CHUNK) {
      const { error } = await db.from('rms_cases').upsert(data.slice(i, i + CHUNK), { onConflict: 'case_id' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ synced: data.length, type });
  }

  if (type === 'clients') {
    const { error } = await db.from('clients').upsert(data, { onConflict: 'client_name' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ synced: data.length, type });
  }

  if (type === 'billing_contacts') {
    const { error } = await db.from('billing_contacts').upsert(data, { onConflict: 'client_name' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ synced: data.length, type });
  }

  if (type === 'invoices') {
    // One-time migration: map GAS camelCase to DB snake_case
    const mapped = data.map((inv: Record<string, unknown>) => ({
      invoice_number: inv.invoiceNumber,
      client_name: inv.clientName,
      billed_date: inv.billedDate,
      billed_fee: inv.billedFee,
      total_reimbursed: inv.totalReimbursed,
      case_ids: inv.caseIds ?? [],
      case_snapshot: inv.caseSnapshot ?? [],
      pdf_url: inv.pdfUrl ?? '',
    }));
    const { error } = await db.from('invoices').upsert(mapped, { onConflict: 'invoice_number' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ synced: mapped.length, type });
  }

  return NextResponse.json({ error: 'Unknown sync type' }, { status: 400 });
}
